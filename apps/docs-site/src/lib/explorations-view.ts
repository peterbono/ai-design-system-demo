// Studio Changes > Explorations: the pure rules behind the list, the detail and the "Start an exploration" form. No
// DOM, no fetch: unit tested in explorations-view.test.ts.
//
// An exploration is a draft pull request labeled `exploration` on an `explore/<slug>` branch (packages/core
// explorations.ts). It ships to a product staging branch as a snapshot and is never merged as is: it is promoted to
// review or closed. Color only says status, and every exploration status is neutral grey: running, promoted and
// closed are states, not verdicts. The tier slot reads "Exploration (not mergeable)".
import {
  EXPLORATION_STATUS_LABEL,
  EXPLORATION_TIER_LABEL,
  EXPLORATION_USE_CASES,
  explorationBranch,
  explorationProblems,
  explorationSlug,
  explorationSummary,
  explorationTryIt,
  findPreviewComment,
  isActiveExploration,
  isExplorationPull,
  resolveBranchPreviews,
  type BranchPreview,
  type BranchPreviewSources,
  type ExplorationStatus,
  type ExplorationTryIt,
  type PreviewApps,
  type PullRequestSummary,
} from '@bridge-ds/core';
import { tierLabel } from './changes';
import type { Tier } from './review-rules';
import { requestRows, type IssueLike, type PullLike as RequestPullLike, type RequestRow } from './requests-view';

/** The fields of a GitHub pull request (REST list or get) the Explorations view reads. */
export interface ExplorationPullLike {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  labels: ({ name?: string } | string)[];
  head: { ref: string; sha: string };
  user?: { login: string } | null;
  updated_at: string;
  html_url: string;
}

export interface ExplorationsConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
  apps: PreviewApps;
  packages: string[];
}

export interface LinkedRequest {
  number: number;
  title: string;
  component: string;
  url: string;
  statusLabel: string;
  open: boolean;
}

export interface ExplorationRow {
  number: number;
  url: string;
  branch: string;
  slug: string;
  name: string;
  purpose: string;
  useCaseLabel: string | null;
  status: ExplorationStatus;
  statusLabel: string;
  /** Pill class: always neutral (grey). */
  tone: string;
  author: string;
  updatedAt: string;
  previews: { app: string; label: string; url: string }[];
  /** Head commit: the preview comment's snapshot must match it before its install command is shown. */
  headSha: string;
  requests: LinkedRequest[];
}

const labelName = (l: { name?: string } | string) => (typeof l === 'string' ? l : (l.name ?? ''));

/** REST pull request -> the core summary shape. */
export function toSummary(p: ExplorationPullLike): PullRequestSummary {
  return {
    number: p.number,
    title: p.title,
    state: p.merged_at ? 'merged' : p.state,
    draft: Boolean(p.draft),
    author: p.user?.login ?? 'unknown',
    headRef: p.head.ref,
    headSha: p.head.sha,
    baseRef: '',
    labels: p.labels.map(labelName).filter(Boolean),
    url: p.html_url,
    updatedAt: p.updated_at,
    body: p.body ?? '',
  };
}

/** True for a pull request that is or was an exploration. */
export const isExploration = (p: ExplorationPullLike) => isExplorationPull({ state: p.state, labels: p.labels, headRef: p.head.ref, body: p.body });

/** True while the pull request is a running exploration (open, label on): it stays out of In review. */
export const isRunningExploration = (p: Pick<ExplorationPullLike, 'state' | 'labels'>) => p.state === 'open' && isActiveExploration(p.labels);

/** Requests filed for an exploration branch (`exploration: explore/<slug>` in the request block). */
export function linkedRequests(branch: string, rows: RequestRow[]): LinkedRequest[] {
  return rows
    .filter((r) => r.request?.exploration === branch)
    .map((r) => ({ number: r.number, title: r.title, component: r.component, url: r.url, statusLabel: r.statusLabel, open: r.status === 'requested' || r.status === 'in-progress' }));
}

const ORDER: Record<ExplorationStatus, number> = { active: 0, promoted: 1, closed: 2 };

/** Rows for the list: running first, then promoted, then closed; newest activity first inside each. */
export function explorationRows(pulls: ExplorationPullLike[], cfg: ExplorationsConfig, opts: { requests?: RequestRow[]; issues?: IssueLike[]; requestPulls?: RequestPullLike[] } = {}): ExplorationRow[] {
  const reqs = opts.requests ?? (opts.issues?.length ? requestRows(opts.issues, opts.requestPulls ?? []) : []);
  const seen = new Set<number>();
  return pulls
    .filter((p) => {
      if (seen.has(p.number)) return false;
      seen.add(p.number);
      return isExploration(p);
    })
    .map((p) => {
      const s = explorationSummary(toSummary(p), cfg.owner, cfg.repo, { packages: cfg.packages, apps: cfg.apps });
      return {
        number: s.number,
        url: s.url,
        branch: s.branch,
        slug: s.slug,
        name: s.name,
        purpose: s.purpose,
        useCaseLabel: EXPLORATION_USE_CASES.find((u) => u.value === s.useCase)?.label ?? null,
        status: s.status,
        statusLabel: EXPLORATION_STATUS_LABEL[s.status],
        tone: '',
        author: s.author,
        updatedAt: s.updatedAt,
        previews: s.previews,
        headSha: p.head.sha,
        requests: linkedRequests(s.branch, reqs),
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number);
}

/** "2 explorations running." Summary first; promoted ones that still wait for review are counted after. */
export function explorationsSummary(rows: Pick<ExplorationRow, 'status'>[]): string {
  const running = rows.filter((r) => r.status === 'active').length;
  const promoted = rows.filter((r) => r.status === 'promoted').length;
  const first = running ? `${running} ${running === 1 ? 'exploration' : 'explorations'} running` : 'No exploration running';
  return promoted ? `${first}, ${promoted} promoted to review.` : `${first}.`;
}

/** The count on the Explorations tab: running ones only. */
export const runningCount = (rows: Pick<ExplorationRow, 'status'>[]) => rows.filter((r) => r.status === 'active').length;

/** Open requests a promotion closes ("Closes #n" in the review body). */
export const openRequestNumbers = (r: Pick<ExplorationRow, 'requests'>) => r.requests.filter((q) => q.open).map((q) => q.number);

/** The tier slot of a pull request: "Exploration (not mergeable)" while the label is on, else the neutral tier. */
export function tierSlot(labels: ExplorationPullLike['labels'], tier: Tier | null): string {
  return isActiveExploration(labels) ? EXPLORATION_TIER_LABEL : tierLabel(tier);
}

// ---------------------------------------------------------------------------------------------------------------
// Start an exploration

export interface StartForm {
  name: string;
  purpose: string;
  useCase: string;
}

/** Problems that block the submit, as sentences that say how to fix them. */
export function startProblems(f: StartForm): string[] {
  const out = explorationProblems({ name: f.name, purpose: f.purpose });
  if (f.useCase && !EXPLORATION_USE_CASES.some((u) => u.value === f.useCase)) out.push('Pick a use case from the list, or leave it empty.');
  return out;
}

/** The branch the form will create, or null while the name has no letter or digit. */
export const branchFor = (name: string): string | null => (explorationSlug(name).length >= 2 ? explorationBranch(name) : null);

const shellQuote = (s: string) => `"${s.trim().replace(/(["\\$`])/g, '\\$1')}"`;

/** The same thing from a terminal: `bridge explore start "Pill buttons" --purpose "..."`. */
export function startCommand(f: Pick<StartForm, 'name' | 'purpose'>): string {
  return `bridge explore start ${shellQuote(f.name || 'Pill buttons')} --purpose ${shellQuote(f.purpose || 'What you want to learn')}`;
}

/** What Claude runs to implement a request on this exploration. */
export const implementOnCommand = (request: number | null, branch: string) => `bridge request implement ${request ?? '<number>'} --branch ${branch}`;
export const promoteCommand = (slug: string) => `bridge explore promote ${slug}`;

// ---------------------------------------------------------------------------------------------------------------
// Try it in a product staging branch: the command the preview workflow actually published (its sticky comment),
// never a guessed pkg.pr.new URL.

/** Where the test build stands, from the pull request's comments and the head commit. */
export const tryItFromComments = (comments: { body?: string | null }[], headSha: string): ExplorationTryIt => explorationTryIt({ comment: findPreviewComment(comments)?.body, headSha });

/** The sentence and the command (when there is one) the detail shows. */
export function tryItCopy(t: ExplorationTryIt): { sentence: string; command: string | null } {
  if (t.state === 'ready') {
    return {
      sentence: `In the product repo, on a branch that deploys to staging (production keeps the released version). ${t.source === 'release' ? 'Tarballs of the latest commit, from the preview prerelease.' : t.source === 'pkg.pr.new' ? 'pkg.pr.new snapshot of the latest commit.' : 'Snapshot of the latest commit.'}`,
      command: t.command,
    };
  }
  if (t.state === 'failed') return { sentence: 'The test build did not finish for the latest commit. The Preview packages run on the pull request says why.', command: null };
  return { sentence: 'The test build is being prepared, a few minutes. The command appears here and on the pull request when it is ready.', command: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Previews: the URLs Vercel reports (its pull request comment, the commit statuses), never a template it shortened.

/** Every configured app of an exploration with its real URL (null while Vercel has not reported it) and build state. */
export const explorationPreviews = (r: Pick<ExplorationRow, 'branch' | 'number' | 'headSha'>, apps: PreviewApps, sources: BranchPreviewSources = {}): BranchPreview[] =>
  resolveBranchPreviews(apps, { branch: r.branch, pr: r.number, sha: r.headSha }, sources);

/** One preview row as the detail shows it: the link, or what is missing. */
export function previewRowCopy(p: BranchPreview): { label: string; url: string | null; host: string | null; note: string | null } {
  const host = p.url ? new URL(p.url).host : null;
  const note = !p.url ? 'Link not reported by Vercel yet' : p.state === 'building' ? 'Building the latest commit' : p.state === 'failed' ? 'The latest deploy failed' : null;
  return { label: p.label, url: p.url, host, note };
}
