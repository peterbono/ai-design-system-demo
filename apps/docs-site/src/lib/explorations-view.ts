// Studio Changes > Explorations: the pure rules behind the list, the detail and the "Start an exploration" form. No
// DOM, no fetch: unit tested in explorations-view.test.ts.
//
// An exploration is a draft pull request labeled `exploration` on an `explore/<slug>` branch (packages/core
// explorations.ts). It ships to a product staging branch as a snapshot and is never merged as is. It is a living
// prototype: "Done exploring" hands it to the developers (waiting for code, then being built, then shipped) and
// "Archive" hides it from the lists, both keeping its preview link alive. Color only says status, and every
// exploration status is neutral grey: states, not verdicts. The tier slot reads "Exploration (not mergeable)".
import {
  EXPLORATION_STARTING_POINT,
  EXPLORATION_STATUS_LABEL,
  EXPLORATION_TIER_LABEL,
  EXPLORATION_USE_CASES,
  explorationTakeCommands,
  isArchivedExploration,
  parsePiecesRecord,
  explorationBranch,
  explorationProblems,
  explorationSlug,
  explorationSummary,
  explorationTryIt,
  findPreviewComment,
  previewUrl,
  productRepos,
  isActiveExploration,
  isHeldExploration,
  isUnlabeledExploration,
  isExplorationPull,
  resolveBranchPreviews,
  type BranchPreview,
  type BranchPreviewSources,
  type ExplorationSource,
  type ExplorationStatus,
  type ExplorationTryIt,
  type PreviewApps,
  type ProductConfig,
  type PullRequestSummary,
} from '@bridge-ds/core';
import { tierLabel, type StatusTone } from './changes';
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
  /** When it was started (the pull request's creation). */
  created_at?: string;
  html_url: string;
  /** The branch it targets (the product's default branch, for a client that never writes it). */
  base?: { ref: string } | null;
  /** Read in a product's own repository (tagProductPulls): that repository and the product key. */
  repo?: string;
  product?: string;
}

export interface ExplorationsConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
  apps: PreviewApps;
  packages: string[];
  /** Production URL of each app: "Try it in the product" opens it when a branch has no build of its own. */
  production?: PreviewApps;
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
  /** Archived (the `archived` label): out of the default lists and counts, its preview still alive. */
  archived?: boolean;
  /** DS Badge tone: always neutral (grey). */
  tone: StatusTone;
  author: string;
  /** Where it was started and the AI agent that started it, when the exploration block says so (packages/core). */
  source: ExplorationSource | null;
  agent: string | null;
  updatedAt: string;
  previews: { app: string; label: string; url: string }[];
  /** Head commit: the preview comment's snapshot must match it before its install command is shown. */
  headSha: string;
  requests: LinkedRequest[];
  /**
   * Set when the exploration lives in a product's own repository (bridge.config.json products[].repo): that
   * repository ("owner/name") and the product key. Absent in the design system repository.
   */
  repo?: string;
  product?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Explorations in a product's own repository: one key, one address

/** A product whose explorations live in its own repository, and that repository. */
export interface ProductRepo {
  product: ProductConfig;
  repo: string;
}

/** The products of the site that have their own repository (core productRepos), the design system one left out. */
export const productReposOf = (products: readonly ProductConfig[], cfg: Pick<ExplorationsConfig, 'owner' | 'repo'>): ProductRepo[] => productRepos(products, `${cfg.owner}/${cfg.repo}`);

/**
 * The one key of an exploration across repositories: "12" in the design system repository, "shop#12" in a product's
 * own one, so the design system's #12 and the shop's #12 never collide in a map or a list.
 */
export const explorationKey = (x: { number: number; product?: string | null | undefined }): string => (x.product ? `${x.product}#${x.number}` : String(x.number));

/** Where an exploration opens on Changes: `?exploration=12`, or `?exploration=12&product=shop` for a product's own repository. */
export const explorationHref = (x: { number: number; product?: string | null | undefined }): string =>
  x.product ? `?exploration=${x.number}&product=${encodeURIComponent(x.product)}` : `?exploration=${x.number}`;

/** The exploration an address asks for: its number and, for a product's own repository, the product key. Null: none. */
export function explorationParam(search: string): { number: number; product: string | null } | null {
  const q = new URLSearchParams(search);
  const n = Number(q.get('exploration'));
  if (!Number.isInteger(n) || n <= 0) return null;
  const product = q.get('product')?.trim().toLowerCase() || null;
  return { number: n, product: product && /^[a-z0-9][a-z0-9-]*$/.test(product) ? product : null };
}

/** The read of one product repository's open branches: one request per repository, cached like the design system list. */
export const productPullsPath = (repo: string) => `/repos/${repo}/pulls?state=open&per_page=100`;

/**
 * Pull requests read in a product's own repository, tagged with that product so the rows, the home and the address
 * know where they live. Only explorations stay: a product repository's other branches are not Bridge's.
 */
export function tagProductPulls<P extends ExplorationPullLike>(pulls: readonly P[], at: ProductRepo): (P & { repo: string; product: string })[] {
  return pulls.filter(isExploration).map((p) => ({ ...p, repo: at.repo, product: at.product.key }));
}

/** The product's preview of an exploration (its `preview` template, as on the product's Vercel project), or none. */
export function productPreviewLinks(product: ProductConfig, ctx: { branch: string; number: number; headSha: string }): { app: string; label: string; url: string }[] {
  const url = previewUrl(product.preview, { branch: ctx.branch, pr: ctx.number, sha: ctx.headSha });
  return url ? [{ app: product.key, label: product.name, url }] : [];
}

/**
 * The previews of a product's own exploration, with what Vercel reports in that repository (its statuses and comment
 * on the branch), read against the product's template the way the library's apps are. Named after the product.
 */
export function productPreviews(r: Pick<ExplorationRow, 'branch' | 'number' | 'headSha'>, product: ProductConfig, sources: BranchPreviewSources = {}): BranchPreview[] {
  if (!product.preview) return [];
  // The admin slot carries the product's template: core matches Vercel projects by the template's host.
  return resolveBranchPreviews({ admin: product.preview }, { branch: r.branch, pr: r.number, sha: r.headSha }, sources).map((p) => ({ ...p, app: product.key as keyof PreviewApps, label: product.name }));
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
export const isRunningExploration = (p: Pick<ExplorationPullLike, 'state' | 'labels'> & Partial<Pick<ExplorationPullLike, 'draft' | 'head' | 'body'>>) =>
  p.state === 'open' && (isActiveExploration(p.labels) || isUnlabeledExploration({ state: p.state, draft: p.draft, labels: p.labels, headRef: p.head?.ref, body: p.body }));

/**
 * The open explorations the Changes list shows under their own status, out of In review: running, or with the
 * developers while still a draft (core isHeldExploration). Archived ones wait behind the Archived filter.
 */
export const isListedExploration = (p: Pick<ExplorationPullLike, 'state' | 'labels' | 'draft'> & Partial<Pick<ExplorationPullLike, 'head' | 'body'>>) => isHeldExploration(p) && !isArchivedExploration(p.labels);

/** An open archived exploration: listed only under the Archived filter. */
export const isArchivedOpen = (p: Pick<ExplorationPullLike, 'state' | 'labels'>) => p.state === 'open' && isArchivedExploration(p.labels);

/** Requests filed for an exploration branch (`exploration: explore/<slug>` in the request block). */
export function linkedRequests(branch: string, rows: RequestRow[]): LinkedRequest[] {
  return rows
    .filter((r) => r.request?.exploration === branch)
    .map((r) => ({ number: r.number, title: r.title, component: r.component, url: r.url, statusLabel: r.statusLabel, open: r.status === 'requested' || r.status === 'in-progress' }));
}

const ORDER: Record<ExplorationStatus, number> = { active: 0, ready: 1, building: 2, promoted: 3, shipped: 4, closed: 5 };

/**
 * Rows for the list: running first, then waiting for code, being built, promoted, shipped, closed; newest activity
 * first inside each. Archived ones are left out unless `archived` is 'include' (a detail opened by link) or 'only'
 * (the Archived filter).
 */
export function explorationRows(
  pulls: ExplorationPullLike[],
  cfg: ExplorationsConfig,
  opts: {
    requests?: RequestRow[];
    issues?: IssueLike[];
    requestPulls?: RequestPullLike[];
    archived?: 'exclude' | 'include' | 'only';
    /** The pulls were read in this product's own repository: rows carry it, and its preview. */
    inProduct?: ProductRepo;
  } = {},
): ExplorationRow[] {
  const reqs = opts.requests ?? (opts.issues?.length ? requestRows(opts.issues, opts.requestPulls ?? []) : []);
  const archived = opts.archived ?? 'exclude';
  const seen = new Set<string>();
  return pulls
    .filter((p) => {
      if (seen.has(explorationKey(p))) return false;
      seen.add(explorationKey(p));
      return isExploration(p) && (archived === 'include' || (archived === 'only') === isArchivedExploration(p.labels));
    })
    .map((p) => {
      const s = explorationSummary(toSummary(p), cfg.owner, cfg.repo, { packages: cfg.packages, apps: cfg.apps });
      return {
        number: s.number,
        url: s.url,
        branch: s.branch,
        slug: s.slug,
        // Sentence case, like every title in Studio: "button normal again" reads "Button normal again".
        name: s.name.charAt(0).toUpperCase() + s.name.slice(1),
        purpose: s.purpose,
        useCaseLabel: EXPLORATION_USE_CASES.find((u) => u.value === s.useCase)?.label ?? null,
        status: s.status,
        statusLabel: EXPLORATION_STATUS_LABEL[s.status],
        archived: s.archived,
        tone: 'neutral' as const,
        author: s.author,
        source: s.source ?? null,
        agent: s.agent ?? null,
        updatedAt: s.updatedAt,
        previews: s.previews.map((v) => ({ ...v, label: previewName(v.app as keyof PreviewApps, v.label) })),
        headSha: p.head.sha,
        // Requests are filed in the design system repository: they name design system branches only.
        requests: opts.inProduct ? [] : linkedRequests(s.branch, reqs),
        ...(opts.inProduct
          ? { repo: opts.inProduct.repo, product: opts.inProduct.product.key, previews: productPreviewLinks(opts.inProduct.product, { branch: s.branch, number: s.number, headSha: p.head.sha }) }
          : {}),
      };
    })
    .sort(byStatus);
}

const byStatus = (a: ExplorationRow, b: ExplorationRow) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number;

/**
 * The design system's rows and each product repository's rows in one list, in the same order as explorationRows, one
 * row per key (explorationKey). A product repository Bridge could not read simply adds nothing.
 */
export function mergeExplorationRows(...lists: ExplorationRow[][]): ExplorationRow[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((r) => {
      const k = explorationKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(byStatus);
}

/** "2 explorations running, 1 with the developers." Summary first; promoted ones that still wait for review after. */
export function explorationsSummary(rows: Pick<ExplorationRow, 'status'>[]): string {
  const running = rows.filter((r) => r.status === 'active').length;
  const handed = rows.filter((r) => r.status === 'ready' || r.status === 'building').length;
  const promoted = rows.filter((r) => r.status === 'promoted').length;
  const first = running ? `${running} ${running === 1 ? 'exploration' : 'explorations'} running` : 'No exploration running';
  const more = [handed ? `${handed} with the developers` : '', promoted ? `${promoted} promoted to review` : ''].filter(Boolean);
  return `${[first, ...more].join(', ')}.`;
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
  return `bridge explore start ${shellQuote(f.name || 'Pill buttons')}${f.purpose.trim() ? ` --purpose ${shellQuote(f.purpose)}` : ''}`;
}

/** What Claude runs to implement a request on this exploration. */
export const implementOnCommand = (request: number | null, branch: string) => `bridge request implement ${request ?? '<number>'} --branch ${branch}`;
export const doneCommand = (slug: string) => `bridge explore done ${slug}`;

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
  // Vercel skipped the build (nothing it is built from changed): its link opens a canceled deployment, so none.
  if (p.skipped) return { label: previewName(p.app, p.label), url: null, host: null, note: 'Same as today. Your preview appears after the first change.' };
  const host = p.url ? new URL(p.url).host : null;
  const note = !p.url ? 'Link not ready yet' : p.state === 'building' ? 'Updating to the latest version' : p.state === 'failed' ? 'The latest update did not build' : null;
  return { label: previewName(p.app, p.label), url: p.url, host, note };
}

/** Designer names of the preview apps: the Library, the component sandbox (Storybook), the admin demo. */
export const PREVIEW_NAMES: Partial<Record<keyof PreviewApps, string>> = { docs: 'Library', storybook: 'Component sandbox', admin: 'Admin demo' };
export const previewName = (app: keyof PreviewApps, fallback: string) => PREVIEW_NAMES[app] ?? fallback;

// ---------------------------------------------------------------------------------------------------------------
// Designer words on the first screen: no branch, pull request or main.

/** Use-case help in Studio. The core hints speak to developers (branches, main); these say the same for designers. */
export const USE_CASE_HINTS: Record<string, string> = {
  'user-test': 'A coded prototype with the real components and tokens, for a user test in staging.',
  'stakeholder-demo': 'Show an idea on real screens before anyone decides on it.',
  'ab-idea': 'Try a variant in staging and compare it with what is live.',
  terminal: 'You work with Claude Code on this exploration, never on the official library.',
  other: 'Anything else worth trying before it goes to review.',
};
export const USE_CASE_EMPTY_HINT = 'Optional. Reviewers see it, so they know why the exploration exists.';
export const useCaseHint = (value: string) => USE_CASE_HINTS[value] ?? USE_CASE_EMPTY_HINT;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The purpose under the title, or null when it only repeats the name ("button normal again" twice). */
export function purposeLine(name: string, purpose: string): string | null {
  const p = purpose.trim();
  if (!p || norm(p) === norm(name)) return null;
  return p;
}

/** The status sentence of an exploration detail, without branch names. */
export function explorationStateLine(status: ExplorationStatus): string {
  if (status === 'ready') return 'Done exploring. Your developers take it from here, and this preview stays for everyone to come back to.';
  if (status === 'building') return 'Your developers are building it. This preview follows their work.';
  if (status === 'shipped') return 'Shipped. This preview stays for reference.';
  if (status === 'promoted') return 'Promoted to review: it is in review now, and goes through the usual approvals.';
  if (status === 'closed') return 'Closed. Its previews are gone, its history stays on GitHub.';
  return 'A living prototype: share its preview, come back to it, and say when you are done exploring.';
}

// ---------------------------------------------------------------------------------------------------------------
// Done exploring: the pieces to propose, and how developers take it

export interface DonePiece {
  id: string;
  title: string;
  summary: string;
}

/**
 * The pieces "Done exploring" offers to tick: the ones the last check found that have no library side yet. The ones
 * already sent are counted, never offered twice. `checked` is false when the exploration was never checked.
 */
export function donePieces(body: string | null | undefined): { checked: boolean; pieces: DonePiece[]; sent: number } {
  const r = parsePiecesRecord(body);
  if (!r) return { checked: false, pieces: [], sent: 0 };
  const linked = new Set(r.links.map((l) => l.piece));
  return { checked: true, pieces: r.pieces.filter((p) => !linked.has(p.id)).map((p) => ({ id: p.id, title: p.title, summary: p.summary })), sent: r.pieces.filter((p) => linked.has(p.id)).length };
}

/** What the Done exploring dialog says, before any write. */
export function doneExploringCopy(x: { checked: boolean; pieces: number; sent: number; canCheck?: boolean }): { description: string; piecesLine: string | null } {
  const description = 'Nothing closes: the preview stays for you, your DS lead and stakeholders. Your developers take it from here.';
  if (!x.checked) return { description, piecesLine: x.canCheck ? 'Bridge could not check it against the library this time. You can go on without proposing pieces.' : 'Not checked against the library yet. Ask Claude what is missing first, or go on without proposing pieces.' };
  if (!x.pieces) return { description, piecesLine: x.sent ? 'Every piece it needs is already with your DS lead.' : null };
  return { description, piecesLine: 'New pieces for the library. Each one you tick goes to your DS lead as a request, with a link to this preview.' };
}

/** The line after Done exploring: what went where, in one sentence. */
export function doneLine(requests: number): string {
  return requests ? `Done exploring. ${requests} ${requests === 1 ? 'piece went' : 'pieces went'} to your DS lead, and your developers take it from here.` : 'Done exploring. Your developers take it from here.';
}

/** The developer fold: the branch, the two commands to take it, and the note that it is a starting point. */
export function takeItLines(branch: string): { branch: string; commands: [string, string]; note: string } {
  return { branch, commands: explorationTakeCommands(branch), note: EXPLORATION_STARTING_POINT };
}

/** Archived, in one line next to its action. */
export const ARCHIVED_LINE = 'Archived: hidden from the lists, its preview still works.';

/** Renamed, in one line: the link and the preview keep their address. */
export const RENAMED_LINE = 'Renamed. Its link and preview stay the same.';

/** Back to exploring, in one line: the exploration runs again. */
export const BACK_TO_EXPLORING_LINE = 'Back to exploring. Say Done exploring again when it is ready for developers.';

/**
 * What an exploration's page says when it cannot read it. A product's own repository that is private is not read for
 * people who are signed out (Bridge's proxy reads only public product repositories for visitors), so they are told to
 * sign in instead of being left with "cannot be read".
 */
export function unreadableExplorationLine(n: number, where: string, opts: { product: boolean; signedOut: boolean }): string {
  const line = `#${n} is not an exploration in ${where}, or it cannot be read right now.`;
  return opts.product && opts.signedOut ? `${line} Signed out, Bridge only shows explorations of public products: sign in to see it.` : line;
}
