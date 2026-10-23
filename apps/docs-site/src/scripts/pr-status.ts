// Status chip of an open pull request, read live from GitHub: CI (check runs + commit statuses), reviews, the
// changed files (for the approval rule, the same as the pull request header: lib/review-queue effectiveTier) and
// whether it merges cleanly, then core branchVerdict (the verdict the MCP server and the CLI read too). Shared by the Studio Overview and the In
// review list. Reads go through ghGet, so they are cached in this browser and survive a rate limit; statuses are
// kept per head commit for 10 minutes (lib/status-budget).
import { effectiveTier } from '../lib/review-queue';
import { isGuidanceOnly } from '../lib/overview-todo';
import { touchesVisuals } from '../lib/visual-impact';
import { fileSignals, type FileSignals } from '../lib/work-nature';
import { badgeHtml, tooltipAttributes } from '@bridge-ds/react/dom';
import { currentViewer, ghGet, hasWorkingToken, prefersSignIn, readRepo } from './github-session';
import { ghAction } from '../lib/gh-wording';
import { needFromStatus, pendingApprovals, statusPill, whoActs, type ApprovalRole, type WhoActs } from '../lib/changes';
import { developerOnlyFailures } from '../lib/check-explain';
import { guestActivity } from './guest-activity';
import { planStatusReads, statusCacheKey, type CachedStatus } from '../lib/status-budget';
import { canOverride, closingIssueNumbers, DEFAULT_OVERRIDE, ownerOverridePolicy, type OverridePolicy, type TeamStates } from '@bridge-ds/core';
import { approvedSuggestionOf } from './suggestions';
import { siteConfig } from './repo-context';
import { loadTeams, siteApproverEntries, siteApprovers, siteRoles, siteShipPolicy, siteSoloOwner, teamSnapshot } from './teams';
import {
  parseTier,
  pullState,
  REVIEW_STATUS,
  studioVerdict,
  summarizeCi,
  type CheckRunLike,
  type LabelLike,
  type ReviewLike,
  type ReviewStatus,
  type ReviewStatusKind,
  type StatusLike,
  type Tier,
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

/** Who may ship (governance.rights), undefined without rights: the owners ship then. GitHub teams count as their members once read. */
export function shippers(): string[] | undefined {
  return siteShipPolicy()?.logins;
}

/**
 * Who counts as the design and the tech approver: the owner lists, through governance.rights when it is set, GitHub
 * teams expanded to their members once read (loadTeams). A team not read yet holds its place and matches nobody.
 */
export function owners(): { design: string[]; tech: string[] } {
  return siteApprovers();
}

/** People fields for whoActs that name teams as teams: the config entries and the team states read so far. */
export function teamPeople(): { entries: { design: string[]; tech: string[] }; shipEntries?: string[]; teams?: TeamStates } {
  const ship = siteShipPolicy();
  const teams = teamSnapshot();
  return { entries: siteApproverEntries(), ...(ship?.entries ? { shipEntries: ship.entries } : {}), ...(teams ? { teams } : {}) };
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
  /** The design approval is in (summarizeApprovals design): the waiting-for-code rule reads it (lib/change-status). */
  design?: boolean;
  changesRequested?: string[];
  failing?: number;
  /** Names of the failing checks ("Changeset present"), so the Overview can name the blocker. */
  failingChecks?: string[];
  /** Approvals still missing (lib/changes pendingApprovals), so a failing test never hides an approval the viewer can give. */
  pending?: ApprovalRole[];
  /** From the changed files (when read): it touches what the visual impact run captures, or only usage guidance. */
  touchesVisuals?: boolean;
  guidanceOnly?: boolean;
  /** What the changed files say about the nature of the work (lib/work-nature): design or developer. */
  files?: FileSignals;
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
  // Approvals count against team members: read the teams of governance.owners first (no request without teams).
  await loadTeams();
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
  const tier = effectiveTier(p.labels ?? [], p.body, files);
  // The pull request that applies an approved suggestion carries its approvals: never gated twice for the same one.
  // One verdict for every surface (lib/review-rules studioVerdict, core branchVerdict): the same the branch page, the
  // MCP server and the CLI read.
  const suggestion = reviews && closingIssueNumbers(p.body).length ? await approvedSuggestionOf(p.body) : null;
  const verdict = (mergeable?: boolean | null) => studioVerdict({ site: siteRoles(), teams: teamSnapshot(), pull: p, tier, ci, reviews, suggestion, mergeable });
  const first = verdict();
  const approvals = first.approvals;
  // Only an open change that nothing else blocks needs to know whether it merges cleanly.
  const needsMergeable = pullState(p) === 'open' && !['ci-failing', 'changes-requested', 'ci-running', 'unknown'].includes(first.status);
  const kind = needsMergeable ? verdict(await mergeableOf(p)).status : first.status;
  const status: ReviewStatus = { kind, ...REVIEW_STATUS[kind] };
  const names = files?.map((f) => f.filename) ?? null;
  return {
    ...status,
    approvers: approvals?.approvers,
    design: approvals?.design,
    changesRequested: approvals?.changesRequested,
    failing: ci?.failed.length,
    failingChecks: ci?.failed.map((f) => f.name),
    pending: pendingApprovals(tier, approvals),
    tier,
    ...(names ? { touchesVisuals: touchesVisuals(names), guidanceOnly: isGuidanceOnly(names), files: fileSignals(names) } : {}),
  };
}

/** Shown on rows left out of the anonymous budget. */
export const skippedHint = () => ghAction('see live status', prefersSignIn());

/**
 * DS Badge markup of a status. `null` shows a neutral placeholder while the reads run. `skipped` marks a row the
 * anonymous budget did not read: "Status unknown", with a tooltip that says how to get the live status.
 */
export function statusChip(s: ReviewStatus | null, opts: { skipped?: boolean } = {}): string {
  if (opts.skipped) {
    const hint = skippedHint();
    return badgeHtml('Status unknown', { size: 'sm', className: 'rv-status', attributes: { 'data-status': 'unknown', ...tooltipAttributes(`${hint}.`, { focusable: true }) } });
  }
  if (!s) return badgeHtml('Checking', { size: 'sm', className: 'rv-status', attributes: { 'aria-label': 'Checking status' } });
  return badgeHtml(s.label, { tone: s.tone, size: 'sm', className: 'rv-status', attributes: { 'data-status': s.kind } });
}

/**
 * The row chip of a pull request in every list (In review, Overview): color says the status group, the words say
 * who acts now ("Design owner to approve", "Your turn: approve design"), from the same whoActs as the pull request
 * header. Falls back to the plain status label when the who-acts line adds nothing (unknown, merged, closed).
 */
type RowFacts = { author: string; approvers?: string[]; changesRequested?: string[]; failing?: number; failingChecks?: string[]; pending?: ApprovalRole[]; skipped?: boolean };

/** governance.override from bridge.config.json, as the layout embeds it (none when the site has no config). */
/** The owner override, limited to the owners it names (core overrideHolders): Settings, Home and the branch page agree. */
function overridePolicy(): OverridePolicy {
  let policy: OverridePolicy;
  try {
    policy = (siteConfig() as { override?: OverridePolicy }).override ?? DEFAULT_OVERRIDE;
  } catch {
    policy = DEFAULT_OVERRIDE;
  }
  return ownerOverridePolicy(policy, owners()) ?? DEFAULT_OVERRIDE;
}

/**
 * Who acts now on a list row (lib/changes whoActs), or null while its status is unknown. Shared by the chip, the
 * opener and the home, with the same people as the branch page (who may use the owner override), so a row and the
 * page header say the same thing.
 */
export function rowWho(kind: ReviewStatusKind | null, o: RowFacts): WhoActs | null {
  if (o.skipped || !kind) return null;
  const viewer = currentViewer()?.login ?? null;
  const policy = overridePolicy();
  return whoActs(needFromStatus(kind, { failing: o.failing, changesRequestedBy: o.changesRequested, developerOnly: developerOnlyFailures(o.failingChecks), pending: o.pending }), {
    owners: owners(),
    shippers: shippers(),
    ...teamPeople(),
    author: o.author,
    viewer,
    approvers: o.approvers,
    overrideBy: policy.allowed,
    overridable: canOverride(viewer, policy),
    soloOwner: siteSoloOwner(),
  });
}

export function whoChip(kind: ReviewStatusKind | null, o: RowFacts): string {
  const who = rowWho(kind, o);
  if (!who || !kind) return statusChip(null, { skipped: o.skipped });
  const { label, tone } = statusPill(kind, who);
  return badgeHtml(label, {
    tone,
    size: 'sm',
    className: 'rv-status',
    attributes: { 'data-status': kind, 'data-yours': who.yourTurn, ...(who.short ? tooltipAttributes(who.sentence, { focusable: true }) : {}) },
  });
}

/** The status kept for this version of a change in this tab, or null (no read). */
export function readCached(p: PullForStatus): CachedStatus | null {
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
  // A guest whose team published fresh activity reads every row from it (no API request): no budget then.
  const recorded = !connected && (await guestActivity())?.fresh === true;
  const plan = planStatusReads(pulls, { connected: connected || recorded, read: readCached, now: Date.now() });
  const byNumber = new Map(pulls.map((p) => [p.number, p]));
  for (const [n, st] of plan.cached) onStatus(byNumber.get(n)!, st, false);
  for (const n of plan.skipped) onStatus(byNumber.get(n)!, null, true);
  const read = async (n: number) => {
    const p = byNumber.get(n)!;
    const st = await pullStatus(p, { lean: !connected });
    if (!connected) writeCached(p, st);
    onStatus(p, st, false);
  };
  if (connected || recorded) await Promise.all(plan.fetch.map(read));
  else for (const n of plan.fetch) await read(n);
}
