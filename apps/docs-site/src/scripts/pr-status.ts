// Status chip of an open pull request, read live from GitHub: CI (check runs + commit statuses), reviews, the
// changed files (for the approval rule, the same as the pull request header: lib/review-queue effectiveTier) and
// whether it merges cleanly, then reviewStatus() from lib/review-rules. Shared by the Studio Overview and the In
// review list. Reads go through ghGet, so they are cached in this browser and survive a rate limit; statuses are
// kept per head commit for 10 minutes (lib/status-budget).
import { effectiveTier } from '../lib/review-queue';
import { currentViewer, esc, ghGet, hasWorkingToken, readRepo } from './github-session';
import { needFromStatus, statusTone, whoActs } from '../lib/changes';
import { planStatusReads, statusCacheKey, type CachedStatus } from '../lib/status-budget';
import type { Rights } from '@bridge-ds/core';
import {
  approverLists,
  shipPolicy,
  parseTier,
  pullState,
  reviewStatus,
  summarizeApprovals,
  summarizeCi,
  type CheckRunLike,
  type LabelLike,
  type ReviewLike,
  type ReviewStatus,
  type ReviewStatusKind,
  type StatusLike,
  type Tier,
  REVIEW_STATUS,
} from '../lib/review-rules';

export interface PullForStatus {
  number: number;
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  body?: string | null;
  labels?: LabelLike[];
  user: { login: string };
  head: { sha: string; ref: string };
}

/** Who may ship (governance.rights), undefined without rights: the owners ship then. */
export function shippers(): string[] | undefined {
  try {
    const site = JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { owners?: { design: string[]; tech: string[] }; rights?: Rights | null };
    return shipPolicy(site.owners ?? { design: [], tech: [] }, site.rights)?.logins;
  } catch {
    return undefined;
  }
}

/** Who counts as the design and the tech approver: the owner lists, through governance.rights when it is set. */
export function owners(): { design: string[]; tech: string[] } {
  try {
    const site = JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { owners?: { design: string[]; tech: string[] }; rights?: Rights | null };
    return approverLists(site.owners ?? { design: [], tech: [] }, site.rights);
  } catch {
    return { design: [], tech: [] };
  }
}

/**
 * CI summary of a commit: check runs plus the combined commit status. `lean` (anonymous budget) reads the commit
 * status only when the commit has no check runs, so a status costs two requests instead of three.
 */
export async function ciFor(sha: string, opts: { lean?: boolean } = {}) {
  const { owner, repo } = readRepo();
  const R = `/repos/${owner}/${repo}`;
  const readStatuses = () =>
    ghGet<{ statuses: StatusLike[] }>(`${R}/commits/${sha}/status`)
      .then((f) => f.data.statuses)
      .catch(() => [] as StatusLike[]);
  if (opts.lean) {
    const runs = (await ghGet<{ check_runs: CheckRunLike[] }>(`${R}/commits/${sha}/check-runs?per_page=100`)).data.check_runs;
    return summarizeCi(runs, runs.length ? [] : await readStatuses());
  }
  const [runs, statuses] = await Promise.all([ghGet<{ check_runs: CheckRunLike[] }>(`${R}/commits/${sha}/check-runs?per_page=100`), readStatuses()]);
  return summarizeCi(runs.data.check_runs, statuses);
}

/** A status plus the review facts the who-acts line and the row need (lib/changes whoActs). */
export interface PullStatus extends ReviewStatus {
  approvers?: string[];
  changesRequested?: string[];
  failing?: number;
  /** The approval rule of the change: label or computed from its files, highest wins. Null when unknown. */
  tier?: Tier | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether the pull request merges cleanly. GitHub computes it on the first read and answers null meanwhile, so a
 * null is read once more after a short wait. Undefined when it could not be read at all.
 */
async function mergeableOf(p: PullForStatus): Promise<boolean | null | undefined> {
  const { owner, repo } = readRepo();
  const read = () => ghGet<{ mergeable: boolean | null }>(`/repos/${owner}/${repo}/pulls/${p.number}`).then((f) => f.data.mergeable);
  try {
    const first = await read();
    if (first !== null) return first;
    await wait(1500);
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * The status of one pull request. Never throws: a failed read gives "Status unknown", never "Ready to ship". The
 * files are read only when no label already says the highest rule, and whether it merges cleanly only when nothing
 * else blocks it first, so the anonymous budget stays small.
 */
export async function pullStatus(p: PullForStatus, opts: { lean?: boolean } = {}): Promise<PullStatus> {
  const { owner, repo } = readRepo();
  const labelled = parseTier(p.labels ?? [], p.body);
  const [ci, reviews, files] = await Promise.all([
    ciFor(p.head.sha, opts).catch(() => null),
    ghGet<ReviewLike[]>(`/repos/${owner}/${repo}/pulls/${p.number}/reviews?per_page=100`)
      .then((f) => f.data)
      .catch(() => null),
    labelled === 3
      ? Promise.resolve(null)
      : ghGet<{ filename: string; status: string }[]>(`/repos/${owner}/${repo}/pulls/${p.number}/files?per_page=100`)
          .then((f) => f.data)
          .catch(() => null),
  ]);
  const approvals = reviews ? summarizeApprovals(reviews, owners(), p.user.login) : null;
  const tier = effectiveTier(p.labels ?? [], p.body, files);
  const before = reviewStatus({ state: p.state, draft: p.draft, merged_at: p.merged_at, ci, approvals, tier });
  // Only an open change that nothing else blocks needs to know whether it merges cleanly.
  const needsMergeable = pullState(p) === 'open' && !['ci-failing', 'changes-requested', 'ci-running', 'unknown'].includes(before.kind);
  const status = needsMergeable ? reviewStatus({ state: p.state, draft: p.draft, merged_at: p.merged_at, ci, approvals, tier, mergeable: await mergeableOf(p) }) : before;
  return { ...status, approvers: approvals?.approvers, changesRequested: approvals?.changesRequested, failing: ci?.failed.length, tier };
}

/** Shown on rows left out of the anonymous budget. */
export const SKIPPED_HINT = 'Connect GitHub for live status';

/**
 * Pill markup of a status. `null` shows a neutral placeholder while the reads run. `skipped` marks a row the
 * anonymous budget did not read: "Status unknown", with a tooltip that says how to get the live status.
 */
export function statusChip(s: ReviewStatus | null, opts: { skipped?: boolean } = {}): string {
  if (opts.skipped)
    return `<span class="pill rv-status has-tip" data-status="unknown" data-tip="${SKIPPED_HINT}." aria-label="Status unknown. ${SKIPPED_HINT}.">Status unknown</span>`;
  if (!s) return '<span class="pill rv-status is-loading" aria-label="Checking status">Checking</span>';
  return `<span class="pill rv-status ${s.tone}" data-status="${esc(s.kind)}">${esc(s.label)}</span>`;
}

/**
 * The row chip of a pull request in every list (In review, Overview): color says the status group, the words say
 * who acts now ("Design owner to approve", "Your turn: approve design"), from the same whoActs as the pull request
 * header. Falls back to the plain status label when the who-acts line adds nothing (unknown, merged, closed).
 */
export function whoChip(
  kind: ReviewStatusKind | null,
  o: { author: string; approvers?: string[]; changesRequested?: string[]; failing?: number; skipped?: boolean },
): string {
  if (o.skipped || !kind) return statusChip(null, { skipped: o.skipped });
  const who = whoActs(needFromStatus(kind, { failing: o.failing, changesRequestedBy: o.changesRequested }), {
    owners: owners(),
    shippers: shippers(),
    author: o.author,
    viewer: currentViewer()?.login ?? null,
    approvers: o.approvers,
  });
  const label = who.short ?? REVIEW_STATUS[kind].label;
  return `<span class="pill rv-status ${statusTone(kind)}" data-status="${esc(kind)}"${who.yourTurn ? ' data-yours' : ''}${who.short ? ` title="${esc(who.sentence)}"` : ''}>${esc(label)}</span>`;
}

function readCached(p: PullForStatus): CachedStatus | null {
  try {
    const { owner, repo } = readRepo();
    const raw = sessionStorage.getItem(statusCacheKey(`${owner}/${repo}`, p.number, p.head.sha));
    return raw ? (JSON.parse(raw) as CachedStatus) : null;
  } catch {
    return null;
  }
}

function writeCached(p: PullForStatus, status: PullStatus) {
  // A failed read, or GitHub still computing whether it merges, is not worth keeping: the next load tries again.
  if (status.kind === 'unknown' || status.kind === 'checking') return;
  try {
    const { owner, repo } = readRepo();
    const entry: CachedStatus = { sha: p.head.sha, at: Date.now(), status };
    sessionStorage.setItem(statusCacheKey(`${owner}/${repo}`, p.number, p.head.sha), JSON.stringify(entry));
  } catch {
    /* private mode or quota: no cache, the budget still holds */
  }
}

/**
 * Statuses for a list of pull requests, within the request budget (lib/status-budget). With a token: every row,
 * in parallel. Without: cached rows first, then the first few rows one after the other, the rest marked skipped.
 * `onStatus` runs once per row; `skipped` is true for rows that were not read.
 */
export async function loadStatuses(
  pulls: PullForStatus[],
  onStatus: (p: PullForStatus, status: PullStatus | null, skipped: boolean) => void,
): Promise<void> {
  const connected = hasWorkingToken();
  const plan = planStatusReads(pulls, { connected, read: readCached, now: Date.now() });
  const byNumber = new Map(pulls.map((p) => [p.number, p]));
  for (const [n, st] of plan.cached) onStatus(byNumber.get(n)!, st, false);
  for (const n of plan.skipped) onStatus(byNumber.get(n)!, null, true);
  const read = async (n: number) => {
    const p = byNumber.get(n)!;
    const st = await pullStatus(p, { lean: !connected });
    if (!connected) writeCached(p, st);
    onStatus(p, st, false);
  };
  if (connected) await Promise.all(plan.fetch.map(read));
  else for (const n of plan.fetch) await read(n);
}
