// Changes > In review and the pull request detail: the review queue of the configured repo (lib/review-queue: open
// pull requests minus running explorations and release automation), read client-side from the GitHub REST API, most
// urgent first, and the branch review (components/ds/studio/BranchReview, rules in lib/review-page): the change itself
// by type, the conversation, one line about checks and one decision bar. Designer words on screen, the Figma branching
// ones (lib/vocabulary): a branch is reviewed and merged into main. Developers get the GitHub link from "More actions",
// "Copy link", "Link for a developer"; the page itself never links to GitHub.
// Without a token the bar's primary connects GitHub. When GitHub cannot be read, the last list this browser saw
// stays on screen, labelled with its time (lib/changes.ts).
import { findPreviewComment, isActiveExploration, type Rights, type ShipPolicy } from '@bridge-ds/core';
import { loadTeams, siteApprovers, siteShipPolicy, teamDirectory } from './teams';
import { approvalNeedLong, effectiveTier, isAutomationPull, reviewQueue } from '../lib/review-queue';
import {
  allowedMergeMethods,
  canWrite,
  mergeGate,
  NO_OVERRIDE,
  openPulls,
  OVERRIDE_HEADING,
  overrideComment,
  overrideReasonProblem,
  overrideRefusedComment,
  parseOverrideComment,
  pullState,
  REVIEW_STATUS,
  summarizeApprovals,
  summarizeCi,
  type MergeMethod,
  type OverridePolicy,
  type ReviewLike,
  type ReviewStatusKind,
  type Tier,
} from '../lib/review-rules';
import {
  asOf,
  byUrgency,
  approvalRows,
  eligibleFor,
  filterByTier,
  listSource,
  needFromDetail,
  pendingApprovals,
  readSnapshot,
  tierParam,
  whoActs,
  writeSnapshot,
  statusTone,
  type CachedPull,
  type People,
  type ApprovalRole,
} from '../lib/changes';
import { badgeHtml, closeDialog, openDialog, tokenValueHtml } from '@bridge-ds/react/dom';
import { pullEntry, type BranchesConfig } from '../lib/branches';
import type { Root } from 'react-dom/client';
import { currentViewer, esc, ghGet, ghWrite, GitHubError, hasWorkingToken, initGitHubConnect, prefersSignIn, RateLimitError, readRepo, showGhError } from './github-session';
import { ghAction, ghVerb } from '../lib/gh-wording';
import { analyzeTokenFiles, isTokenFile, type TokenReview } from './reviews/token-review';
import { loadVisualImpact } from './reviews/visual-impact';
import { ciFor, loadStatuses, rowWho, teamPeople, type PullStatus } from './pr-status';
import { mdTitleText } from '../lib/markdown';
import { humanTitle } from '../lib/pr-title';
import { jiraKeyOf, VOCAB, withoutJiraKey } from '../lib/vocabulary';
import { touchesVisuals } from '../lib/visual-impact';
import { componentOfDocsPath, isDocsFile } from '../lib/pr-docs';
import { docsFileText } from '../lib/docs-draft-model';
import { agentMade, workNature, type FileSignals, type WorkNature } from '../lib/work-nature';
import {
  checkStory,
  classifyCheck,
  failingSentence,
  jobIdFromUrl,
  type CheckFacts,
  type ClassifiedCheck,
  type DesignFacts,
} from '../lib/check-explain';
import { productPreview, topScreen, tryInProductUrl } from '../lib/try-in-product';
import { canShare, shareState, showShare, type ShareState } from '../lib/share-change';
import { addedNotice, canAddTo, dismissedApprovals, dismissedSentence, editInChangeHref, isTokenChange } from '../lib/continue-change';
import { backToDraft, detailStatus, statusActionFor, takeSaid, type StatusActionRun } from './change-status';
import { ACTION_LABEL } from '../lib/change-status';
import { PRODUCTS } from '../lib/branches-page';
import {
  checksLine,
  conversation,
  guidanceMeta,
  guidanceView,
  isClaudeDraft,
  LOOKED_KEY,
  namesIn,
  readLooked,
  reviewActions,
  reviewCrumbs,
  reviewLink,
  splitChanges,
  whoLine,
  writeLooked,
  type ConvInput,
  type GuidanceDocs,
} from '../lib/review-page';
import type { ActKind, BranchReviewProps, GuidanceView, PersonRef, TokenRowView, VisualView } from '../components/ds/studio/BranchReview';
/** The Motion change id (components/ds/studio/BranchReview MOTION_CHANGE), kept here so the island loads lazily. */
const MOTION_CHANGE = 'tokens:motion';
import { lifecycleOfRow } from './status-filter';
import { byLifecycle, LIFECYCLE, lifecycleTone, type Lifecycle } from '../lib/change-status';
import { isRunningExploration } from '../lib/explorations-view';
import type { BranchesListProps, ListRow } from '../components/ds/studio/BranchesList';
import { conflictLine, conflictRows, freshness, libraryLine, nextSteps, resolveLabel, type CompareLike, type Freshness } from '../lib/library-sync';
import { bringInLatest, checkGuardrail, commitResolution, readCompare, readConflicts, readDismissStale, waitForNewHead } from './reviews/library-sync';

interface User {
  login: string;
  avatar_url: string;
  html_url?: string;
}
interface Pull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  user: User;
  body: string | null;
  labels: { name: string; color?: string }[];
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  mergeable?: boolean | null;
  comments?: number;
  review_comments?: number;
}
interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
  raw_url?: string;
}
interface Comment {
  user: User | null;
  body: string;
  created_at: string;
  html_url: string;
}
interface Review extends ReviewLike {
  body: string | null;
  html_url: string;
  user: User | null;
}

const repo = readRepo();
const REPO_KEY = `${repo.owner}/${repo.repo}`;
const R = `/repos/${repo.owner}/${repo.repo}`;
const SITE = (() => {
  try {
    return JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { owners?: { design: string[]; tech: string[] }; override?: OverridePolicy; rights?: Rights | null };
  } catch {
    return {};
  }
})();
// Approvals count against who holds each right (governance.rights), shipping against the ship right. GitHub teams
// in governance.owners count as their members once read (scripts/teams.ts): read at call time, not at load.
const OWNERS = () => siteApprovers();
const SHIP = () => siteShipPolicy();
const OVERRIDE: OverridePolicy = SITE.override ?? NO_OVERRIDE;
const BRANCHES: BranchesConfig = (() => {
  try {
    return JSON.parse(document.getElementById('bridge-branches')?.textContent || '{}') as BranchesConfig;
  } catch {
    return { owner: repo.owner, repo: repo.repo, defaultBranch: repo.defaultBranch, apps: {}, packages: [] };
  }
})();

const storage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

interface RepoInfo {
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
}
/** What the connected token may do on this repo; null without a token. */
interface Access {
  login: string;
  write: boolean;
  methods: MergeMethod[];
}

async function readAccess(): Promise<Access | null> {
  const v = currentViewer();
  if (!hasWorkingToken() || !v) return null;
  try {
    const info = (await ghGet<RepoInfo>(R)).data;
    return { login: v.login, write: canWrite(info.permissions), methods: allowedMergeMethods(info) };
  } catch {
    return { login: v.login, write: false, methods: ['squash'] };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const detailEl = () => $('rv-detail');
const notice = () => $('rv-notice');

function showNotice(tone: 'warn' | 'fail' | 'info', text: string) {
  const n = notice();
  n.hidden = false;
  n.className = `rv-notice is-${tone}`;
  n.textContent = text;
}

/** People around a pull request, for the who-acts line (lib/changes whoActs). */
function people(author: string, extra: Partial<People> = {}): People {
  return { owners: OWNERS(), ...teamPeople(), author, viewer: currentViewer()?.login ?? null, overrideBy: OVERRIDE.allowed, shippers: SHIP()?.logins, ...extra };
}

/** The facts of a row the who-acts rules read (pr-status rowWho, shared with the Home). */
const facts = (r: Row) => ({ author: r.user.login, approvers: r.approvers, changesRequested: r.changesRequested, failing: r.failing, failingChecks: r.failingChecks, pending: r.pending, skipped: r.skipped });
/** Who acts now on a row: the viewer's turn feeds Waiting on me. */
function turnOf(r: Row) {
  const who = rowWho(r.kind, facts(r));
  return { yourTurn: who?.yourTurn ?? false, developer: who?.who === 'developer' };
}


// ---------------------------------------------------------------------------------------------------------------
// The Branches list (components/ds/studio/BranchesList): every open branch, the running explorations with them, and
// the recently closed ones behind one line. This file reads GitHub and hands the rows over; the list groups, filters
// and selects.

interface Row {
  number: number;
  title: string;
  updated_at: string;
  tier: Tier | null;
  kind: ReviewStatusKind | null;
  skipped: boolean;
  head: { ref: string; sha: string };
  base?: { ref: string; sha: string };
  user: { login: string };
  body?: string | null;
  draft?: boolean;
  /** Pull request state and merge time: Merged and Closed rows. */
  state?: string;
  merged_at?: string | null;
  labels?: { name: string }[];
  /** A running exploration: tried, never reviewed as is (status pill "Exploration"). */
  exploration?: boolean;
  /** Design or developer work (lib/work-nature): title and labels first, then the changed files once read. */
  nature: WorkNature;
  /** What the changed files say, once the status read them. */
  signals?: FileSignals | null;
  guidance?: boolean;
  /** From the status read: who approved, who asked for changes, how many checks fail. */
  approvers?: string[];
  changesRequested?: string[];
  failing?: number;
  /** The design approval is in, and the names of the failing checks: the waiting-for-code rule (lib/change-status). */
  design?: boolean;
  failingChecks?: string[];
  /** Approvals still missing: an approval the viewer can give comes before a developer's fix (lib/changes whoActs). */
  pending?: ApprovalRole[];
  /** Library updates since the change started (compare behind_by), read with a token only. */
  behindBy?: number | null;
}

/** How many recently closed branches are read for "N merged this month" (one request). */
const CLOSED_LIMIT = 30;

/** The open rows last painted, the open explorations, and the recently closed ones once read. */
let openRows: Row[] = [];
let exploreRows: Row[] = [];
let closedRows: Row[] | null = null;
let listLoading = true;

/** The status pill of a row: its lifecycle in words, else who acts now (pr-status rowWho), the same tone rules. */
function pillOf(r: Row, lifecycle: Lifecycle | 'exploration'): ListRow['pill'] {
  if (lifecycle === 'exploration') return { label: 'Exploration', tone: 'neutral' };
  if (lifecycle !== 'ready') return { label: LIFECYCLE[lifecycle].short, tone: lifecycleTone(lifecycle) };
  if (r.skipped) return { label: 'Status unknown', tone: 'neutral' };
  if (!r.kind) return { label: 'Checking', tone: 'neutral' };
  const who = rowWho(r.kind, facts(r));
  return { label: who?.short ?? REVIEW_STATUS[r.kind].label, tone: statusTone(r.kind) };
}

function listRow(r: Row): ListRow {
  const lifecycle: Lifecycle | 'exploration' = r.exploration ? 'exploration' : lifecycleOfRow(r);
  return {
    number: r.number,
    title: humanTitle(mdTitleText(withoutJiraKey(r.title))),
    jira: jiraKeyOf(r.title),
    author: r.user.login,
    agent: agentMade({ body: r.body ?? null, labels: r.labels ?? null }),
    opens: r.exploration ? 'exploration' : 'pr',
    pill: pillOf(r, lifecycle),
    lifecycle,
    yourTurn: !r.exploration && lifecycle !== 'shipped' && lifecycle !== 'closed' && turnOf(r).yourTurn,
    behindBy: r.behindBy ?? null,
    signals: r.signals ?? null,
    guidance: Boolean(r.guidance),
    head: r.head,
    base: r.base ?? null,
    merged_at: r.merged_at ?? null,
  };
}

let listMount: HTMLElement | null = null;

function paintRows(rows: Row[], loading: boolean) {
  openRows = rows;
  listLoading = loading;
  const el = (listMount ??= document.getElementById('cg-list'));
  if (!el) return;
  const tier = tierParam(location.search);
  // Most urgent first, then waiting for code, then drafts (lib/change-status byLifecycle); explorations last.
  const sorted = byLifecycle(filterByTier(byUrgency(rows), tier).map((r) => ({ r, lifecycle: lifecycleOfRow(r) }))).map((x) => x.r);
  const closed = closedRows ? filterByTier(closedRows, tier) : null;
  const props: BranchesListProps = {
    rows: [...sorted, ...(tier ? [] : exploreRows)].map(listRow),
    closed: closed ? closed.map(listRow) : null,
    closedLimit: CLOSED_LIMIT,
    loading,
    viewer: currentViewer()?.login ?? null,
    connected: hasWorkingToken(),
    admin: el.dataset.admin || null,
    tokensRoot: el.dataset.tokensRoot || 'packages/tokens/src',
    tierLabel: tier ? approvalNeedLong(tier).toLowerCase() : null,
    failure: (err) =>
      err instanceof RateLimitError ? `GitHub limits anonymous reads to 60 an hour. ${ghVerb(prefersSignIn())} to preview ${VOCAB.branches} together.` : `Could not read a checked ${VOCAB.branch}: ${(err as Error).message}`,
    readClosed: () => void loadClosed(),
  };
  void import('../components/ds/studio/BranchesList').then(({ paintBranchesList }) => paintBranchesList(el, props));
}

function showEmpty(empty: boolean) {
  $('cg-list').hidden = empty;
  $('cg-empty').hidden = !empty;
}

/** The muted line under the filters when GitHub cannot be read live. */
function paintAsOf(text: string | null) {
  const el = $('cg-asof');
  el.hidden = !text;
  if (text) el.textContent = text;
}

const asOfLine = (at: string) => `Showing the list ${asOf(at)}: GitHub cannot be read right now. ${ghAction('see live status', prefersSignIn())}.`;

const natureOf = (title: string, labels: { name: string }[] | undefined, files: FileSignals | null = null) => workNature({ title: humanTitle(mdTitleText(title)), labels: labels ?? null, files }).nature;

const toRow = (p: Pull | CachedPull, kind: ReviewStatusKind | null): Row => ({
  number: p.number,
  title: p.title,
  updated_at: p.updated_at,
  // A label decides at once; the files (read with the status) complete it, the same rule as the detail.
  tier: 'labels' in p ? effectiveTier(p.labels, p.body, null) : p.tier,
  kind,
  skipped: false,
  head: { ref: p.head.ref, sha: p.head.sha },
  ...('base' in p && p.base ? { base: { ref: p.base.ref, sha: p.base.sha } } : {}),
  user: { login: p.user.login },
  draft: p.draft,
  ...('body' in p ? { body: p.body } : {}),
  ...('state' in p ? { state: p.state, merged_at: p.merged_at } : {}),
  ...('labels' in p ? { labels: p.labels } : {}),
  nature: natureOf(p.title, 'labels' in p ? p.labels : undefined),
});

/** The most recently closed branches, read once: the "N merged this month" line and Show merged. */
let closedRead: Promise<void> | null = null;
function loadClosed(): Promise<void> {
  closedRead ??= (async () => {
    try {
      const f = await ghGet<Pull[]>(`${R}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_LIMIT}`);
      // Release automation stays out (History holds releases).
      closedRows = f.data.filter((p) => !isAutomationPull(p)).map((p) => toRow(p, pullState(p) === 'merged' ? 'merged' : 'closed'));
    } catch (err) {
      closedRows = [];
      showNotice('warn', err instanceof RateLimitError ? `GitHub limits anonymous reads to 60 an hour. ${ghVerb(prefersSignIn())} to see merged and closed ${VOCAB.branches}.` : `Could not read recent ${VOCAB.branches}: ${(err as Error).message}`);
    }
    paintRows(openRows, listLoading);
  })();
  return closedRead;
}

/**
 * Loads and paints the Branches list. Returns every open pull request (running explorations and the release pull
 * request included: Explorations and History read them from here).
 */
export async function loadList(): Promise<{ number: number; head: { ref: string } }[]> {
  const snapshot = readSnapshot(storage(), REPO_KEY);
  const known = new Map<number, ReviewStatusKind | null>((snapshot?.pulls ?? []).map((p) => [p.number, p.kind]));
  let live: { pulls: Pull[]; staleAt?: string | null } | null = null;
  let failure: unknown = null;
  let allOpen: Pull[] = [];
  paintRows([], true);
  try {
    const f = await ghGet<Pull[]>(`${R}/pulls?state=open&per_page=100`);
    allOpen = openPulls(f.data);
    // The review queue, and the running explorations listed with it under their own status.
    live = { pulls: reviewQueue(allOpen), staleAt: f.stale ? (f.cachedAt ?? new Date(0).toISOString()) : null };
    exploreRows = allOpen.filter((p) => isRunningExploration({ state: p.state, labels: p.labels as never })).map((p) => ({ ...toRow(p, null), exploration: true }));
  } catch (err) {
    failure = err;
  }
  // The closed list is one read, after the open one; the line it feeds sits at the end of the list.
  void loadClosed();
  const src = listSource(live, snapshot);

  if (src.kind === 'unavailable') {
    showEmpty(false);
    paintRows([], false);
    paintAsOf(
      failure instanceof RateLimitError
        ? `GitHub limits anonymous reads to 60 an hour and this browser has used them, with no saved list yet. ${ghVerb(prefersSignIn())}, or try again later.`
        : `Could not load ${VOCAB.branches}: ${(failure as Error | null)?.message ?? 'GitHub did not answer'}.`,
    );
    return [];
  }

  if (src.kind === 'cached') {
    // A snapshot saved before automation left the queue may still hold the release pull request.
    const rows = src.pulls.filter((p) => !isAutomationPull(p)).map((p) => ({ ...toRow(p, p.kind), skipped: !p.kind }));
    showEmpty(rows.length === 0);
    paintRows(rows, false);
    paintAsOf(asOfLine(src.at));
    return src.pulls;
  }

  const pulls = src.pulls;
  paintAsOf(src.kind === 'stale' ? asOfLine(src.at) : null);
  showEmpty(pulls.length === 0 && exploreRows.length === 0);
  if (!pulls.length) {
    paintRows([], false);
    writeSnapshot(storage(), REPO_KEY, [], new Date());
    return allOpen;
  }
  // A stale list starts from the statuses saved with the snapshot; a live one starts from "Checking".
  const rows = new Map(pulls.map((p) => [p.number, toRow(p, src.kind === 'stale' ? (known.get(p.number) ?? null) : null)]));
  paintRows([...rows.values()], src.kind === 'live');
  // Status per row (CI and reviews), in the background, within the request budget (lib/status-budget). A failed
  // read never replaces a status this browser already knows.
  await loadStatuses(pulls, (p, st: PullStatus | null, skipped) => {
    const r = rows.get(p.number)!;
    const prior = r.kind;
    r.kind = st && st.kind === 'unknown' && prior ? prior : (st?.kind ?? (skipped ? (known.get(p.number) ?? null) : null));
    r.skipped = skipped && !r.kind;
    if (st && st.kind !== 'unknown') Object.assign(r, { approvers: st.approvers, changesRequested: st.changesRequested, failing: st.failing, design: st.design, failingChecks: st.failingChecks, pending: st.pending });
    if (st?.tier) r.tier = st.tier;
    if (st?.files) {
      r.nature = natureOf(r.title, r.labels, st.files);
      r.signals = st.files;
    }
    if (st?.guidanceOnly) r.guidance = true;
    paintRows([...rows.values()], false);
  });
  paintRows([...rows.values()], false);
  // How far each change is behind the library: one compare each, with a token only (anonymous reads stay for status).
  if (src.kind === 'live' && hasWorkingToken()) {
    await Promise.all(
      pulls.map((p) =>
        readCompare(repo.owner, repo.repo, p.base.ref, p.head.sha).then((c) => {
          rows.get(p.number)!.behindBy = c?.behind_by ?? null;
        }),
      ),
    );
    paintRows([...rows.values()], false);
  }
  if (src.kind === 'live') {
    writeSnapshot(
      storage(),
      REPO_KEY,
      pulls.map((p) => ({ number: p.number, title: p.title, html_url: p.html_url, updated_at: p.updated_at, tier: rows.get(p.number)!.tier, kind: rows.get(p.number)!.kind, head: { ref: p.head.ref, sha: p.head.sha }, user: { login: p.user.login }, draft: p.draft })),
      new Date(),
    );
  }
  return allOpen;
}

// ---------------------------------------------------------------------------------------------------------------
// Detail: the branch review (components/ds/studio/BranchReview, rules in lib/review-page)

let current: { pull: Pull; tier: Tier | null } | null = null;
let openSeq = 0;
/** The props painted last, so a later read (the visual impact) repaints only what it adds. */
let view: BranchReviewProps | null = null;
/** The review island, once loaded (closing it is synchronous then). */
let reviewModule: typeof import('../components/ds/studio/BranchReview') | null = null;

function repaint(patch: Partial<BranchReviewProps>) {
  if (!view) return;
  view = { ...view, ...patch };
  void import('../components/ds/studio/BranchReview').then(({ paintBranchReview }) => view && paintBranchReview(detailEl(), view));
}

/** What a designer reads for a login, until profile names are known: the login, without @ and [bot]. */
const nameOf = (login: string) => login.replace(/^@/, '').replace(/\[bot\]$/i, '');
const named = (text: string) => namesIn(text, nameOf);

/** The docs.json at a commit, parsed, or null (missing or unreadable). */
async function docsAt(sha: string, path: string): Promise<GuidanceDocs | null> {
  try {
    const r = await ghGet<string>(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${sha}/${path}`, { raw: true });
    return JSON.parse(r.data) as GuidanceDocs;
  } catch {
    return null;
  }
}

export async function openPr(n: number, push = true) {
  const seq = ++openSeq;
  runCurrent = null;
  if (push) history.pushState({ pr: n }, '', `?pr=${n}`);
  document.dispatchEvent(new CustomEvent('bridge:changes-view', { detail: 'detail' }));
  const d = detailEl();
  d.hidden = false;
  view = null;
  const { unmountBranchReview, paintBranchReview } = (reviewModule ??= await import('../components/ds/studio/BranchReview'));
  unmountBranchReview();
  unmountLib();
  d.removeAttribute('data-can-approve');
  d.removeAttribute('data-can-suggest');
  d.innerHTML = `<p class="rv-loading">Loading the ${VOCAB.branch}</p>`;
  window.scrollTo({ top: 0 });
  try {
    const pf = await ghGet<Pull>(`${R}/pulls/${n}`);
    if (pf.stale) showNotice('warn', `GitHub cannot be read right now, so this shows the ${VOCAB.branch} ${asOf(pf.cachedAt ?? '')}. ${ghAction('see live status', prefersSignIn())}.`);
    const pull = pf.data;
    // GitHub computes whether it merges cleanly on the first read (null meanwhile): read it once more while the rest
    // loads, so the page never says "waiting for approval" on one load and "conflict" on the next.
    const mergeable: Promise<boolean | null | undefined> =
      pull.mergeable === null && pullState(pull) === 'open'
        ? new Promise((r) => setTimeout(r, 1500))
            .then(() => ghGet<Pull>(`${R}/pulls/${n}`))
            .then((f) => f.data.mergeable)
            .catch(() => null)
        : Promise.resolve(pull.mergeable);
    const live = pullState(pull) === 'open' || pullState(pull) === 'draft';
    const [files, reviews, comments, lineComments, ci, access, statuses, merges, compare] = await Promise.all([
      ghGet<PrFile[]>(`${R}/pulls/${n}/files?per_page=100`).then((f) => f.data),
      ghGet<Review[]>(`${R}/pulls/${n}/reviews?per_page=100`).then((f) => f.data).catch(() => [] as Review[]),
      ghGet<Comment[]>(`${R}/issues/${n}/comments?per_page=100`).then((f) => f.data).catch(() => [] as Comment[]),
      // Comments on a file: they belong to the change that file is part of.
      ghGet<(Comment & { path?: string })[]>(`${R}/pulls/${n}/comments?per_page=100`).then((f) => f.data).catch(() => [] as (Comment & { path?: string })[]),
      ciFor(pull.head.sha).catch(() => summarizeCi([])),
      readAccess(),
      // Same request as ciFor's commit status (shared in flight): the Vercel statuses say which previews are built.
      ghGet<{ statuses: { context: string; state: string; target_url?: string | null }[] }>(`${R}/commits/${pull.head.sha}/status`).then((f) => f.data.statuses).catch(() => []),
      mergeable,
      // How far the change is behind the library it started from (behind_by), and what it changed since.
      live ? readCompare(repo.owner, repo.repo, pull.base.ref, pull.head.sha) : Promise.resolve(null),
      loadTeams(),
    ]);
    pull.mergeable = merges;
    if (seq !== openSeq) return;
    const tier = effectiveTier(pull.labels, pull.body, files);
    current = { pull, tier };
    const approvals = summarizeApprovals(reviews, OWNERS(), pull.user.login);
    const ship = await viewerShipPolicy(SHIP(), access?.login);
    if (seq !== openSeq) return;
    const gateOf = (a: typeof approvals) =>
      mergeGate({ tier, ci, approvals: a, draft: pull.draft, mergeable: pull.mergeable, state: pull.state, merged_at: pull.merged_at, viewer: access?.login, override: OVERRIDE, exploration: isActiveExploration(pull.labels), ship });
    const gate = gateOf(approvals);
    const tokenFiles = files.filter((f) => isTokenFile(f.filename));
    const docsPaths = files.filter((f) => isDocsFile(f.filename) && f.status !== 'removed').map((f) => f.filename);
    // Guidance alone never changes a screen: the before and after is for tokens and components.
    const visual = touchesVisuals(files.map((f) => f.filename).filter((f) => !isDocsFile(f)));
    const [review, failedFacts, docs] = await Promise.all([
      tokenFiles.length
        ? analyzeTokenFiles({ owner: repo.owner, repo: repo.repo, baseSha: pull.base.sha, headSha: pull.head.sha, files: tokenFiles }).catch((err) => err as Error)
        : Promise.resolve(null),
      Promise.all(ci.failed.map(readCheckFacts)),
      Promise.all(docsPaths.map(async (path) => ({ path, base: await docsAt(pull.base.sha, path), head: await docsAt(pull.head.sha, path) }))),
    ]);
    if (seq !== openSeq) return;
    const checks = failedFacts.map(classifyCheck);
    const fresh = freshness({ compare, mergeable: pull.mergeable, open: live });
    const props = await detailProps({ pull, tier, files, reviews, comments, lineComments, ci, approvals, gate, gateOf, access, statuses, review, checks, fresh, docs, visual, seq });
    if (!props || seq !== openSeq) return;
    view = props;
    d.innerHTML = '';
    paintBranchReview(d, props);
    // The review queue reads what the open review offers (its own bar replaces this one there).
    d.toggleAttribute('data-can-approve', props.actions.primary?.kind === 'approve' || props.actions.primary?.kind === 'approve-merge');
    d.toggleAttribute('data-can-suggest', props.actions.suggest);
    d.dataset.title = props.title;
    d.dataset.developer = pull.html_url;
    runCurrent = (kind, text) => props.onAct(kind, text);
    wireLibrary({ pull, fresh, compare, access, checks: ci.total, visual, approvals: approvals.approvers.length, seq });

    // Motion changes (scripts/reviews/motion-changes, #153): below "What changes" on a single change, its own change
    // under Tokens on a busy branch. Only when the branch touches token files or components; nothing when no motion
    // changed or the read fails.
    if (files.some((f) => isTokenFile(f.filename) || f.filename.startsWith('packages/react/')))
      void import('./reviews/motion-changes')
        .then((m) => m.readMotionChanges({ owner: repo.owner, repo: repo.repo, baseSha: pull.base.sha, headSha: pull.head.sha }))
        .then((motion) => {
          if (seq !== openSeq || !view || !motion.changes.length) return;
          const multi = view.changes.length > 1;
          const n = motion.changes.length;
          const change = { id: MOTION_CHANGE, kind: 'tokens' as const, title: 'Motion', meta: `${n} ${n === 1 ? 'change' : 'changes'}`, paths: [] };
          const at = view.changes.filter((c) => c.kind === 'tokens').length;
          repaint({ motion, ...(multi ? { changes: [...view.changes.slice(0, at), change, ...view.changes.slice(at)] } : {}) });
        })
        .catch(() => undefined);

    if (visual) {
      const slot = document.getElementById('rv-visual');
      if (slot)
        loadVisualImpact(slot, { owner: repo.owner, repo: repo.repo, pr: pull.number, sha: pull.head.sha, actionsUrl: `https://github.com/${repo.owner}/${repo.repo}/actions/workflows/visual-impact.yml` }, document.getElementById('rv-visual-ask') ?? undefined)
          .then((v) => {
            if (seq !== openSeq) return;
            const state: VisualView['state'] = v.error ? 'error' : v.changed === null ? 'not-run' : v.changed === 0 ? 'no-change' : 'changes';
            const base = productPreviewOf(pull, comments, statuses);
            const screen = topScreen(v.shots);
            repaint({ visual: { state, shots: v.shots ?? [], base: v.base, error: v.error, ask: Boolean(v.paintedTop) }, tryUrl: base && state === 'changes' ? tryInProductUrl(base, pull.number, screen) : null, actions: { ...view!.actions, menu: { ...view!.actions.menu, share: view!.actions.menu.share && state === 'changes' } } });
          })
          .catch((err) => repaint({ visual: { state: 'error', shots: [], error: (err as Error).message } }));
    }
  } catch (err) {
    if (seq !== openSeq) return;
    d.innerHTML = `<p class="rv-loading"><a href="./" data-back>Branches</a></p>`;
    if (err instanceof RateLimitError) showNotice('warn', `GitHub limits anonymous reads to 60 an hour. ${ghVerb(prefersSignIn())}, or try again later.`);
    else showNotice('fail', `Could not load this ${VOCAB.branch}: ${(err as Error).message}`);
  }
}

/** The admin preview GitHub reports for the change (Vercel), or null. */
function productPreviewOf(pull: Pull, comments: Comment[], statuses: { context: string; state: string; target_url?: string | null }[]) {
  const entry = pullEntry(pull as never, BRANCHES, { comments, statuses });
  return productPreview(BRANCHES.apps, { branch: pull.head.ref, pr: pull.number, sha: pull.head.sha, fromFork: entry.fromFork }, { comments, statuses });
}

/** Failing checks whose job is read (two GETs each, one anonymous): the rest are classified by name. */
const MAX_CHECK_READS = 6;
const ANON_CHECK_READS = 3;

interface JobRun {
  steps?: { name: string; conclusion: string | null }[];
}
interface Annotation {
  path?: string;
  annotation_level?: string;
  title?: string | null;
  message?: string;
}

/** What a failing check found: its failing step and failing test annotations. A failed read keeps the name only. */
async function readCheckFacts(f: { name: string; url?: string }, i: number): Promise<CheckFacts> {
  const id = jobIdFromUrl(f.url);
  // Anonymous reads share 60 an hour: the failing step of the first few checks only, no test annotations.
  const connected = hasWorkingToken();
  if (!id || i >= (connected ? MAX_CHECK_READS : ANON_CHECK_READS)) return f;
  const [job, notes] = await Promise.all([
    ghGet<JobRun>(`${R}/actions/jobs/${id}`).then((r) => r.data).catch(() => null),
    connected ? ghGet<Annotation[]>(`${R}/check-runs/${id}/annotations?per_page=50`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    ...f,
    step: job?.steps?.find((s) => s.conclusion === 'failure')?.name ?? null,
    failures: notes?.filter((a) => a.annotation_level === 'failure').map((a) => ({ path: a.path, title: a.title ?? '', message: a.message ?? '' })),
  };
}

/** The token review reduced to what the check sentences need. */
function designFacts(review: TokenReview, designCheckFails: boolean): DesignFacts {
  return {
    checked: review.checked ?? 0,
    passing: review.passing ?? 0,
    failingPairs: review.contrast.filter((p) => p.after < p.min),
    changedTokens: [...new Set(review.changes.map((c) => c.path))],
    colorsOnly: review.changes.length > 0 && review.changes.every((c) => Boolean(c.after?.hex ?? c.before?.hex)),
    // Token set problems count only when a design check fails: the head may carry older ones the change did not add.
    problems: designCheckFails ? review.problems : [],
  };
}

/**
 * The ship policy for the gate, with the viewer's team membership checked on GitHub (one membership read per team,
 * cached; none when the viewer is listed by name or no team holds the right). A member is added to the logins.
 */
async function viewerShipPolicy(policy: ShipPolicy | null, viewer: string | null | undefined): Promise<ShipPolicy | null> {
  if (!policy || !viewer || !policy.entries?.some((e) => e.includes('/'))) return policy;
  if (policy.logins.some((l) => l.toLowerCase() === viewer.toLowerCase())) return policy;
  const r = await teamDirectory().memberOfAny(policy.entries, viewer).catch(() => ({ member: false }));
  return r.member ? { ...policy, logins: [...policy.logins, viewer] } : policy;
}

interface DetailInput {
  pull: Pull;
  tier: Tier | null;
  files: PrFile[];
  reviews: Review[];
  comments: Comment[];
  lineComments: (Comment & { path?: string })[];
  ci: ReturnType<typeof summarizeCi>;
  approvals: ReturnType<typeof summarizeApprovals>;
  gate: ReturnType<typeof mergeGate>;
  gateOf: (a: ReturnType<typeof summarizeApprovals>) => ReturnType<typeof mergeGate>;
  access: Access | null;
  statuses: { context: string; state: string; target_url?: string | null }[];
  review: TokenReview | Error | null;
  checks: ClassifiedCheck[];
  fresh: Freshness;
  docs: { path: string; base: GuidanceDocs | null; head: GuidanceDocs | null }[];
  visual: boolean;
  seq: number;
}

/** Token rows, one per token, with the modes it changes in. */
function tokenRows(review: TokenReview): TokenRowView[] {
  const by = new Map<string, TokenRowView>();
  for (const c of review.changes) {
    const row = by.get(c.path);
    if (row) {
      if (c.context && !row.contexts.includes(c.context)) row.contexts.push(c.context);
    } else by.set(c.path, { path: c.path, kind: c.kind, before: c.before, after: c.after, contexts: c.context ? [c.context] : [] });
  }
  return [...by.values()];
}

/** Everything the review shows, from what GitHub said. Null when a newer review owns the page. */
async function detailProps(x: DetailInput): Promise<BranchReviewProps | null> {
  const { pull, tier, files, reviews, comments, ci, approvals, gate, access } = x;
  const write = Boolean(access?.write);
  const lifecycle = pullState(pull);
  const open = lifecycle === 'open';
  const exploration = isActiveExploration(pull.labels);
  const showOverride = gate.overridable && write;
  const login = access?.login ?? null;
  const isAuthor = Boolean(login && login.toLowerCase() === pull.user.login.toLowerCase());
  const who = whoActs(
    needFromDetail({ state: lifecycle, ci, gate, changesRequestedBy: approvals.changesRequested, exploration, mergeable: pull.mergeable }),
    people(pull.user.login, { viewer: login, approvers: approvals.approvers, canMerge: write && gate.canShip, overridable: showOverride }),
  );
  const viewerPeople = people(pull.user.login, { viewer: login });
  const rows = approvalRows({ tier, approvals, people: viewerPeople, open });
  const review = x.review instanceof Error ? null : x.review;
  const tokenOnly = files.length > 0 && files.every((f) => isTokenFile(f.filename) || f.filename.startsWith('.changeset/'));
  const story = checkStory({ failed: x.checks, pending: ci.pending.length, passed: ci.passed, design: review ? designFacts(review, x.checks.some((c) => c.kind === 'design')) : null, tokenOnly });

  // The who-acts sentence, designer first: developer failures never make "fix checks" the designer's turn.
  let sentence = who.sentence;
  let yourTurn = who.yourTurn;
  const designRow = rows.find((r) => r.role === 'design' && r.canAct);
  if (open && who.action === 'fix-checks') {
    const f = failingSentence({ story, author: pull.user.login, viewerIsAuthor: isAuthor, viewerApprovesDesign: Boolean(designRow) && !story.designFails, approvalsMissing: gate.missing.length > 0 });
    sentence = f.sentence;
    yourTurn = f.yourTurn;
  } else if (who.yourTurn && who.action === 'override' && showOverride) sentence = 'Your turn: no other owner can approve, so merge it with the owner override.';
  const dismissed = open ? dismissedSentence(dismissedApprovals(reviews as never, pull.head.sha)) : null;
  const status = detailStatus({ pull, tier, approvals, story, checks: x.checks, files: files.map((f) => f.filename), exploration, isAuthor, sentence, yourTurn });
  if (dismissed) status.sentence = `${dismissed} ${status.sentence}`;
  const reload = () => openPr(pull.number, false);
  const statusRun = await statusActionFor(status, { pull, isAuthor, canWrite: write, viewer: login, exploration, review, reload });
  if (x.seq !== openSeq) return null;

  // The change itself: tokens by group, components, guidance files (lib/review-page splitChanges).
  const guidance: Record<string, GuidanceView> = {};
  for (const g of x.docs) {
    const name = componentOfDocsPath(g.path).name;
    guidance[g.path] = g.head
      ? { path: g.path, name, docs: g.head, sections: guidanceView(g.base, g.head) }
      : { path: g.path, name, docs: null, sections: [], error: `Could not read the ${name} guidance. Reload the page to try again.` };
  }
  const changes = splitChanges({
    files,
    tokens: review?.changes ?? null,
    guidanceMeta: Object.fromEntries(Object.values(guidance).map((g) => [g.path, guidanceMeta(g.sections)])),
  });
  const guidanceOnly = changes.length > 0 && changes.every((c) => c.kind === 'guidance');
  const agent = agentMade({ body: pull.body, labels: pull.labels }) || (guidanceOnly && x.docs.some((g) => isClaudeDraft(g.head)));
  const sameRepo = !pull.head.repo?.full_name || pull.head.repo.full_name === `${repo.owner}/${repo.repo}`;
  const canEditGuidance = write && sameRepo && (lifecycle === 'open' || lifecycle === 'draft');

  // The decision bar (lib/review-page reviewActions).
  const canApprove = rows.some((r) => r.canAct);
  const withMine = login ? summarizeApprovals([...reviews, { user: { login }, state: 'APPROVED', submitted_at: new Date().toISOString() }], OWNERS(), pull.user.login) : approvals;
  const entry = pullEntry(pull as never, BRANCHES, { comments, statuses: x.statuses });
  const shareState = shareFor(pull, files, comments);
  const shareable = canShare({ fromFork: entry.fromFork, packages: BRANCHES.packages }) && showShare(lifecycle, shareState);
  const actions = reviewActions({
    lifecycle: status.lifecycle,
    connected: Boolean(access),
    canWrite: write,
    isAuthor,
    canApprove,
    canMerge: gate.allowed && write,
    mergeAfterApprove: x.gateOf(withMine).allowed && write,
    overrideOnly: showOverride && who.action === 'override',
    // Sharing waits for the before and after to say something changed (repainted once read).
    visual: x.visual,
    shareable,
    exploration,
    statusAction: statusRun.kind === 'reopen' || statusRun.kind === 'restart' ? statusRun.kind : null,
    inQueue: Boolean(detailEl().closest('[data-review-queue]')),
  });
  if (actions.primary?.kind === 'connect') actions.primary.label = ghAction('review', prefersSignIn());
  if (actions.primary && (actions.primary.kind === 'reopen' || actions.primary.kind === 'restart') && statusRun.kind) actions.primary.label = ACTION_LABEL[statusRun.kind];
  const openOverride = showOverride && access ? wireOverride(pull, access, gate) : null;

  // Conversation: people only (bots say what the page shows elsewhere).
  const reviewers = [...OWNERS().design, ...OWNERS().tech];
  const entries: ConvInput[] = [
    ...reviews.filter((r) => r.state !== 'PENDING').map((r) => ({ login: r.user?.login ?? null, at: r.submitted_at ?? '', body: r.body ?? '', kind: r.state })),
    ...comments.map((c) => {
      const ov = parseOverrideComment(c.body);
      return { login: c.user?.login ?? null, at: c.created_at, body: ov ? c.body.replace(OVERRIDE_HEADING, '').trim() : c.body, kind: ov ? (ov.merged ? 'OVERRIDE' : 'OVERRIDE_REFUSED') : 'COMMENT' };
    }),
    ...x.lineComments.map((c) => ({ login: c.user?.login ?? null, at: c.created_at, body: c.body, kind: 'COMMENT', path: c.path ?? null })),
  ].map((e) => ({ ...e, body: named(mdTitleText(e.body)) }));
  const conv = conversation(entries, { author: pull.user.login, reviewers });
  const peopleMap: Record<string, PersonRef> = {};
  for (const u of [pull.user, ...reviews.map((r) => r.user), ...comments.map((c) => c.user), ...x.lineComments.map((c) => c.user)]) {
    if (u) peopleMap[u.login.toLowerCase()] = { login: u.login, name: nameOf(u.login), avatarUrl: u.avatar_url };
  }

  const title = humanTitle(mdTitleText(withoutJiraKey(pull.title)));
  const asked = status.yourTurn && !isAuthor && canApprove;
  const line = whoLine({ author: nameOf(pull.user.login), agent, guidanceOnly, canEdit: canEditGuidance, asked, lifecycle: status.lifecycle, sentence: named(statusRun.sentence) });
  const editable = tokenFilesOf(files) > 0 && isTokenChange(pull, REPO_KEY) && canAddTo(pull, login ?? undefined, write);
  const added = Number(new URLSearchParams(location.search).get('added'));
  if (added > 0) history.replaceState(history.state, '', `?pr=${pull.number}`);
  const update = x.fresh.state === 'current' && justIn?.pr === pull.number ? 'done' : x.fresh.state === 'behind' || x.fresh.state === 'conflict' ? x.fresh.state : null;
  const note = access && !write && (lifecycle === 'open' || lifecycle === 'draft') ? `${nameOf(access.login)} cannot write to this library, so merging and closing are off.` : null;

  return {
    pr: pull.number,
    crumbs: reviewCrumbs(files.map((f) => f.filename), title),
    title,
    jira: jiraKeyOf(pull.title),
    status: { label: status.label, tone: status.tone, lifecycle: status.lifecycle },
    who: { person: { login: pull.user.login, name: nameOf(pull.user.login), avatarUrl: pull.user.avatar_url, agent }, lead: line.lead, rest: line.rest },
    added: added > 0 ? addedNotice(added) : null,
    changes,
    looked: [...readLookedNow(pull.number)],
    onLooked: (ids) => {
      writeLookedNow(pull.number, new Set(ids));
      repaint({ looked: ids });
    },
    tokens: x.review instanceof Error ? { rows: [], error: `Could not compute the token changes: ${x.review.message}. Reload the page to try again.` } : review ? { rows: tokenRows(review), editHref: editable ? editInChangeHref(pull.number) : null } : null,
    guidance,
    canEditGuidance,
    onSaveGuidance: async (path, docsNow) => {
      const original = x.docs.find((g) => g.path === path);
      const { commitDocsToBranch } = await import('./docs-commit');
      const text = docsFileText(docsNow as never, null);
      try {
        await commitDocsToBranch(path, pull.head.ref, componentOfDocsPath(path).name, text);
      } catch (err) {
        const msg = (err as Error).message;
        throw new Error(/failed to fetch|network/i.test(msg) ? 'Not saved: GitHub could not be reached. Check your connection, then save again.' : `Not saved: ${msg.replace(/[.\s]+$/, '')}. Save again, or reload the page if the branch moved.`);
      }
      if (original) original.head = docsNow;
      const g = guidance[path]!;
      guidance[path] = { ...g, docs: docsNow, sections: guidanceView(original?.base ?? null, docsNow) };
      repaint({ guidance: { ...guidance } });
    },
    visual: x.visual ? { state: 'loading', shots: [] } : null,
    product: PRODUCTS.find((p) => p.key === 'admin')!.label,
    tryUrl: null,
    people: peopleMap,
    conversation: conv,
    fileComments: conv.all.filter((c) => c.path),
    checks: checksLine(story),
    approvals: rows.map((r) => ({ label: r.role === 'approval' ? 'Approval' : `${r.label} approval`, state: r.state, text: named(status.lifecycle === 'draft' && r.state === 'waiting' ? 'Not asked until a review is requested' : r.text) })),
    update,
    actions,
    onAct: (kind, text) => act(kind, text, { pull, gate, docs: x.docs, write, statusRun }),
    onOverride: () => openOverride?.(),
    onDraft: () => backToDraft(pull.number, reload).then(() => undefined),
    onClose: () => act('close', '', { pull, gate, docs: x.docs, write, statusRun }),
    links: { review: reviewLink(location.origin, pull.number), developer: pull.html_url },
    share: shareable
      ? {
          title,
          state: shareState,
          packages: BRANCHES.packages,
          url: pull.html_url,
          tryUrl: () => view?.tryUrl ?? null,
        }
      : null,
    said: takeSaid(),
    note,
    inQueue: Boolean(detailEl().closest('[data-review-queue]')),
  };
}

const tokenFilesOf = (files: PrFile[]) => files.filter((f) => isTokenFile(f.filename)).length;

function readLookedNow(pr: number): Set<string> {
  try {
    return readLooked(localStorage.getItem(LOOKED_KEY), pr);
  } catch {
    return new Set();
  }
}
function writeLookedNow(pr: number, ids: Set<string>) {
  try {
    localStorage.setItem(LOOKED_KEY, writeLooked(localStorage.getItem(LOOKED_KEY), pr, ids));
  } catch {
    /* storage blocked: the marks last for this page */
  }
}

/**
 * Accepts the Claude drafts of the branch's guidance (needsReview false), one commit each: approving the branch
 * accepts its content. Returns the new head when something was committed.
 */
async function acceptDrafts(branch: string, docs: { path: string; head: GuidanceDocs | null }[]): Promise<string | null> {
  let head: string | null = null;
  const { acceptDocsOnBranch } = await import('./docs-commit');
  for (const g of docs) {
    if (g.head?.needsReview !== true) continue;
    const sha = await acceptDocsOnBranch(g.path, branch, componentOfDocsPath(g.path).name);
    if (sha) head = sha;
  }
  return head;
}

/** Approves a branch: its guidance drafts are accepted first (with write access), then the approval is posted. */
async function approve(pull: { number: number; head: { ref: string; sha: string } }, docs: { path: string; head: GuidanceDocs | null }[], write: boolean, body: string): Promise<string> {
  const moved = write ? await acceptDrafts(pull.head.ref, docs) : null;
  await ghWrite('POST', `${R}/pulls/${pull.number}/reviews`, { event: 'APPROVE', body: body || undefined, commit_id: moved ?? pull.head.sha });
  return moved ?? pull.head.sha;
}

/** One decision from the bar. Resolves with the line to say (the review repaints), throws with how to fix it. */
async function act(kind: ActKind | 'close', text: string, x: { pull: Pull; gate: ReturnType<typeof mergeGate>; docs: { path: string; head: GuidanceDocs | null }[]; write: boolean; statusRun: StatusActionRun }): Promise<string | void> {
  const { pull } = x;
  const verb = kind === 'merge' || kind === 'approve-merge' ? 'merge branches' : kind === 'close' ? 'close branches' : 'review branches';
  try {
    if (kind === 'connect') return;
    if (kind === 'request-review' || kind === 'reopen' || kind === 'restart') return (await x.statusRun.run?.()) ?? undefined;
    if (kind === 'suggest') await ghWrite('POST', `${R}/pulls/${pull.number}/reviews`, { event: 'REQUEST_CHANGES', body: text, commit_id: pull.head.sha });
    else if (kind === 'comment') await ghWrite('POST', `${R}/issues/${pull.number}/comments`, { body: text });
    else if (kind === 'approve') await approve(pull, x.docs, x.write, text);
    else if (kind === 'merge') await ghWrite('PUT', `${R}/pulls/${pull.number}/merge`, { merge_method: 'squash', sha: pull.head.sha });
    else if (kind === 'approve-merge') {
      const sha = await approve(pull, x.docs, x.write, text);
      try {
        await ghWrite('PUT', `${R}/pulls/${pull.number}/merge`, { merge_method: 'squash', sha });
      } catch (err) {
        await openPr(pull.number, false);
        return `Approved. Not merged yet: ${(err as Error).message.replace(/[.\s]+$/, '')}. Merge it once the checks finish.`;
      }
    } else if (kind === 'close') await ghWrite('PATCH', `${R}/pulls/${pull.number}`, { state: 'closed' });
  } catch (err) {
    const el = document.createElement('p');
    showGhError(el, err, `GitHub refused it: ${(err as Error).message}`, verb);
    throw new Error(el.textContent ?? (err as Error).message);
  }
  const said = { suggest: 'Changes suggested.', comment: 'Comment posted.', approve: 'Approved.', merge: 'Merged.', 'approve-merge': 'Approved and merged.', close: 'Closed.' }[kind as string] ?? 'Done.';
  await openPr(pull.number, false);
  return said;
}

/** Runs a decision on the open review (the review queue's own bar). False when nothing open or nothing sent. */
let runCurrent: ((kind: ActKind, text: string) => Promise<string | void>) | null = null;

/**
 * The review queue's decisions, on any branch (the queue moves on before an approval is sent, so Undo can cancel it).
 * Approving accepts the branch's guidance drafts first, as on the review page.
 */
export async function approveBranch(n: number, body = ''): Promise<void> {
  const pull = (await ghGet<Pull>(`${R}/pulls/${n}`)).data;
  const files = (await ghGet<PrFile[]>(`${R}/pulls/${n}/files?per_page=100`)).data;
  const docsPaths = files.filter((f) => isDocsFile(f.filename) && f.status !== 'removed').map((f) => f.filename);
  const docs = await Promise.all(docsPaths.map(async (path) => ({ path, head: await docsAt(pull.head.sha, path) })));
  const access = await readAccess();
  await approve(pull, docs, Boolean(access?.write), body);
}

export async function suggestChanges(n: number, body: string): Promise<void> {
  const pull = (await ghGet<Pull>(`${R}/pulls/${n}`)).data;
  await ghWrite('POST', `${R}/pulls/${n}/reviews`, { event: 'REQUEST_CHANGES', body, commit_id: pull.head.sha });
}

/**
 * "Ask someone else to review": requests the review from the other people who can give the missing approvals, and
 * takes the viewer off the requested reviewers. Resolves with who was asked; throws when nobody else can.
 */
export async function askSomeoneElse(n: number): Promise<string[]> {
  const pull = (await ghGet<Pull & { requested_reviewers?: { login: string }[] }>(`${R}/pulls/${n}`)).data;
  const reviews = (await ghGet<Review[]>(`${R}/pulls/${n}/reviews?per_page=100`)).data;
  const tier = effectiveTier(pull.labels, pull.body, null);
  const approvals = summarizeApprovals(reviews, OWNERS(), pull.user.login);
  const viewer = currentViewer()?.login ?? null;
  const p = people(pull.user.login, { viewer, approvers: approvals.approvers });
  const roles = pendingApprovals(tier, approvals);
  const others = [...new Set(roles.flatMap((r) => eligibleFor(r, p).logins))].filter((l) => l.toLowerCase() !== (viewer ?? '').toLowerCase() && l.toLowerCase() !== pull.user.login.toLowerCase());
  if (!others.length) throw new Error('Nobody else can give the missing approval. Review it, or ask an owner in Settings to add a reviewer.');
  await ghWrite('POST', `${R}/pulls/${n}/requested_reviewers`, { reviewers: others });
  if (viewer && pull.requested_reviewers?.some((r) => r.login.toLowerCase() === viewer.toLowerCase())) await ghWrite('DELETE', `${R}/pulls/${n}/requested_reviewers`, { reviewers: [viewer] }).catch(() => undefined);
  return others.map(nameOf);
}

/** Approves the open branch review through the same path as its own button. False when nothing is open or sent. */
export async function actOnOpenBranch(kind: 'approve' | 'suggest', text = ''): Promise<boolean> {
  if (!runCurrent) return false;
  try {
    await runCurrent(kind, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fills the owner override dialog (the DS Dialog for scripts, rv-ov in pages/studio/changes.astro) for this change and
 * returns how to open it, or null when the page has none. The dialog outlives a repaint of the detail, so its
 * listeners are replaced, never stacked: the previous change's are aborted first.
 */
let overrideWiring: AbortController | null = null;
function wireOverride(pull: Pull, access: Access, gate: ReturnType<typeof mergeGate>): (() => void) | null {
  const root = document.getElementById('rv-ov');
  if (!root) return null;
  overrideWiring?.abort();
  overrideWiring = new AbortController();
  const { signal } = overrideWiring;
  const part = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-rv-ov="${name}"]`)!;
  const reason = part<HTMLTextAreaElement>('reason');
  // The DS Textarea's hint (the field's description paragraph) carries the live count. The page is static, so the
  // textarea is described by it here rather than by the Field on hydration.
  const count = reason.parentElement?.parentElement?.querySelector<HTMLElement>(':scope > p') ?? document.createElement('p');
  if (count.id) reason.setAttribute('aria-describedby', count.id);
  const error = part('error');
  const errorText = part('error-text');
  const go = part<HTMLButtonElement>('go');
  const min = OVERRIDE.requireReason ? OVERRIDE.minReasonLength : 0;
  const allowed: MergeMethod[] = access.methods.length ? access.methods : ['squash'];
  const countText = () => {
    const n = reason.value.trim().length;
    if (!min) return 'Optional. Shown on the branch.';
    if (n === 0) return `At least ${min} characters. Shown on the branch.`;
    return n >= min ? `${n} characters. Shown on the branch.` : `${n} of at least ${min} characters.`;
  };
  // The first method the repository allows (squash when it allows it), as before: no picker on a Studio screen.
  const method = (): MergeMethod => allowed[0]!;
  const ready = () => {
    go.disabled = false;
    go.textContent = 'Post reason and merge';
  };

  // This branch: its number and the approvals it skips.
  const title = document.getElementById('rv-ov-title');
  if (title) title.textContent = `Merge #${pull.number} as owner override?`;
  part('missing').innerHTML = gate.missing.map((m) => `<li>${esc(m[0]!.toUpperCase() + m.slice(1))}</li>`).join('');
  reason.value = '';
  reason.removeAttribute('aria-invalid');
  if (min) reason.setAttribute('aria-required', 'true');
  else reason.removeAttribute('aria-required');
  count.textContent = countText();
  error.hidden = true;
  ready();

  reason.addEventListener(
    'input',
    () => {
      count.textContent = countText();
      reason.removeAttribute('aria-invalid');
      error.hidden = true;
    },
    { signal },
  );
  go.addEventListener(
    'click',
    async () => {
      const problem = overrideReasonProblem(reason.value, OVERRIDE);
      if (problem) {
        // One message, under the field it is about (its hint); the Alert below is for what GitHub answers.
        reason.setAttribute('aria-invalid', 'true');
        count.textContent = problem;
        error.hidden = true;
        reason.focus();
        return;
      }
      error.hidden = true;
      go.disabled = true;
      go.textContent = 'Posting reason';
      const body = overrideComment(access.login, reason.value, gate.missing);
      let comment: { id: number } | null = null;
      try {
        comment = await ghWrite<{ id: number }>('POST', `${R}/issues/${pull.number}/comments`, { body });
      } catch (err) {
        showGhError(errorText, err, `GitHub did not take the comment, so nothing merged: ${(err as Error).message}`, 'comment on branches');
        error.hidden = false;
        ready();
        return;
      }
      go.textContent = 'Merging';
      const m = method();
      try {
        await ghWrite('PUT', `${R}/pulls/${pull.number}/merge`, {
          merge_method: m,
          sha: pull.head.sha,
          ...(m === 'rebase' ? {} : { commit_message: body.replace(OVERRIDE_HEADING, '').trim() }),
        });
      } catch (err) {
        const msg = (err as Error).message.trim().replace(/[.\s]+$/, '');
        await ghWrite('PATCH', `${R}/issues/comments/${comment.id}`, { body: overrideRefusedComment(body, msg) }).catch(() => undefined);
        showGhError(errorText, err, `GitHub refused to merge it: ${msg}. Your reason stays on the branch, marked not merged. The protection of main may need an approving review or an admin bypass.`, 'merge branches');
        error.hidden = false;
        ready();
        return;
      }
      closeDialog(root, 'merged');
      await openPr(pull.number, false);
      const done = document.getElementById('rv-act-status');
      if (done) done.textContent = `Merged as owner override. The reason is on #${pull.number}.`;
    },
    { signal },
  );
  return () => {
    error.hidden = true;
    openDialog(root, { initialFocus: reason });
  };
}

/**
 * "Share with a product team": the preview install command the Preview packages workflow posted for the latest
 * update (its sticky comment), or why there is none yet (lib/share-change). Read on the data the detail already has.
 */
function shareFor(pull: Pull, files: PrFile[], comments: Comment[]): ShareState {
  return shareState({ lifecycle: pullState(pull), files: files.map((f) => f.filename), packages: BRANCHES.packages, comment: findPreviewComment(comments)?.body, headSha: pull.head.sha });
}

// ---------------------------------------------------------------------------------------------------------------
// Latest library: behind and conflicts (lib/library-sync, scripts/reviews/library-sync)

let libRoot: Root | null = null;
/** The Update from main action (DS Button and resolver dialog): unmounted before the review repaints. */
function unmountLib() {
  libRoot?.unmount();
  libRoot = null;
}
/** The change that just brought the library in, and what to say on its row. */
let justIn: { pr: number; said: string } | null = null;

/** After a write: wait for GitHub's new head, then repaint the change (checks, approvals and the before and after). */
async function refreshAfterLibrary(pull: Pull, said: string) {
  const fresh = await waitForNewHead(repo.owner, repo.repo, pull.number, pull.head.sha);
  justIn = { pr: pull.number, said: fresh ? said : `${said} It can take a minute: reload if the checks have not restarted.` };
  await openPr(pull.number, false);
}

/**
 * Fills the Latest library row: what happens next (checks, approvals, from the branch rules), then the action. Behind
 * with no conflict: GitHub's update-branch. A conflict: what both sides touched decides who resolves it; a pure
 * token-file conflict opens the resolver, anything in code stays with a developer (Open on GitHub, on the author line).
 */
function wireLibrary(x: { pull: Pull; fresh: Freshness; compare: CompareLike | null; access: Access | null; checks: number; visual: boolean; approvals: number; seq: number }) {
  const row = document.getElementById('rv-lib');
  const slot = document.getElementById('rv-lib-act');
  const textEl = document.getElementById('rv-lib-text');
  const hintEl = document.getElementById('rv-lib-hint');
  if (!row || !slot || !textEl || !hintEl) return;
  const { pull } = x;
  // The decision bar holds the view's primary: updating from main is a secondary step above it.
  const primary = false;
  if (x.fresh.state === 'current') {
    textEl.textContent = justIn?.pr === pull.number ? justIn.said : '';
    return;
  }
  textEl.textContent = x.fresh.state === 'conflict' ? conflictLine({ kind: 'tokens', files: [] }, null) : (libraryLine(x.fresh) ?? '');
  hintEl.textContent = x.fresh.state === 'conflict' ? ` ${libraryLine(x.fresh) ?? ''}` : '';
  const sameRepo = !pull.head.repo?.full_name || pull.head.repo.full_name === `${repo.owner}/${repo.repo}`;
  const canAct = Boolean(x.access?.write) && sameRepo;
  const cannot = !x.access ? `${ghAction('update it from main', prefersSignIn())}.` : !sameRepo ? 'It comes from a fork: its author updates it from main.' : `${nameOf(x.access.login)} cannot write to this branch, so someone with write access updates it from main.`;
  const mount = (props: Parameters<typeof import('../components/ds/studio/LibraryCatchUp').mountLibraryCatchUp>[1]) =>
    void import('../components/ds/studio/LibraryCatchUp').then(({ mountLibraryCatchUp }) => {
      if (x.seq !== openSeq || !slot.isConnected) return;
      libRoot?.unmount();
      libRoot = mountLibraryCatchUp(slot, props);
    });
  const next = readDismissStale(repo.owner, repo.repo, pull.base.ref).then((dismissStale) => nextSteps({ checks: x.checks, visual: x.visual, approvals: x.approvals, dismissStale }));

  if (x.fresh.state === 'behind') {
    void next.then((n) => {
      if (x.seq === openSeq) hintEl.textContent = ` ${canAct ? n : `${n} ${cannot}`}`;
    });
    if (!canAct) return;
    mount({
      label: VOCAB.updateFromMain,
      primary,
      onUpdate: async () => {
        hintEl.textContent = 'Updating from main.';
        try {
          await bringInLatest(repo.owner, repo.repo, pull);
        } catch (err) {
          const msg = (err as Error).message;
          if (/conflict/i.test(msg)) hintEl.textContent = 'GitHub could not combine them: they changed the same lines. Reload the page to resolve the conflicts here.';
          else showGhError(hintEl, err, `GitHub did not update it from main: ${msg.replace(/[.\s]+$/, '')}. Reload the page and try again.`, 'update branches');
          return;
        }
        await refreshAfterLibrary(pull, `Up to date with main. ${await next}`);
      },
    });
    return;
  }

  // A conflict: read what both sides touched, then the tokens.
  void (async () => {
    let data: Awaited<ReturnType<typeof readConflicts>>;
    try {
      if (!x.compare) throw new Error('compare not read');
      data = await readConflicts(repo.owner, repo.repo, x.compare, pull.head.sha);
    } catch {
      if (x.seq !== openSeq) return;
      textEl.textContent = conflictLine({ kind: 'code', alsoTokens: false, files: [] }, null);
      return;
    }
    if (x.seq !== openSeq) return;
    const t = data.tokens;
    if (data.route.kind === 'code' || !t) {
      textEl.textContent = conflictLine(data.route, null);
      return;
    }
    if (t.plan.problems.length) {
      textEl.textContent = `Bridge could not read a token file (${t.plan.problems[0]}). A developer resolves it.`;
      return;
    }
    const n = t.plan.conflicts.length;
    textEl.textContent = conflictLine(data.route, n);
    if (!canAct) {
      hintEl.textContent = `${hintEl.textContent ?? ''} ${cannot}`.trim();
      return;
    }
    const nextText = await next;
    if (x.seq !== openSeq) return;
    mount({
      label: resolveLabel(n),
      primary,
      resolver: {
        conflicts: t.plan.conflicts,
        rows: conflictRows(t.plan.conflicts, t.sets),
        next: nextText,
        check: (choices) => checkGuardrail(data, choices),
        apply: async (choices) => {
          try {
            await commitResolution(repo.owner, repo.repo, pull, data, choices, x.access?.login ?? null);
          } catch (err) {
            // Bridge's own checks already say how to fix it; only GitHub's answers get wrapped.
            if (!(err instanceof GitHubError)) throw err;
            const msg = err.message.replace(/[.\s]+$/, '');
            throw new Error(/fast.forward|Update is not a fast/i.test(msg) ? 'The branch moved while you were choosing. Close this, reload the page and resolve again.' : `GitHub refused it: ${msg}. Reload the page and try again.`);
          }
          void refreshAfterLibrary(pull, `Conflicts resolved, up to date with main. ${nextText}`);
        },
      },
    });
  })();
}

// ---------------------------------------------------------------------------------------------------------------
// Token diff rendering

/** One side of a token change: the alias or literal, the resolved value muted after an alias, the before struck through. */
function valueCell(v: { css?: string | null; hex?: string | null; alias?: string | null } | null, previous = false) {
  if (!v) return '<span class="muted">Not set</span>';
  return tokenValueHtml(v.alias ? `{${v.alias}}` : (v.css ?? ''), { resolved: v.alias ? (v.css ?? undefined) : undefined, swatch: v.hex ?? false, previous });
}

export function renderTokenReview(review: TokenReview): string {
  if (!review.changes.length) return '<p class="muted">The token files changed, but no token value did (formatting or descriptions only).</p>';
  const rows = review.changes
    .map(
      (c) => `<tr>
        <th scope="row"><span class="mono">${esc(c.path)}</span><span class="rv-kind-tag is-${c.kind}">${c.kind}</span>${c.context ? `<span class="muted small">${esc(c.context)}</span>` : ''}</th>
        <td>${valueCell(c.before, true)}</td>
        <td><span class="rv-arrow"><span aria-hidden="true">→</span><span class="sr-only">becomes</span></span></td>
        <td>${valueCell(c.after)}</td>
      </tr>`,
    )
    .join('');
  const fails = review.contrast.some((p) => p.after < p.min);
  const n = review.contrast.length;
  // Nothing fails: the pairs that moved stay one click away (the checklist above already says they pass).
  const contrastTable = `<div class="table-wrap"><table class="rv-table rv-contrast"><thead><tr><th scope="col">Pair</th><th scope="col">Where</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Min</th></tr></thead><tbody>${review.contrast
         .map(
           (p) => `<tr class="${p.after < p.min ? 'is-fail' : p.after < p.before ? 'is-down' : ''}">
          <th scope="row"><span class="rv-pair"><span class="rv-aa" style="background-color:${esc(p.bgHexAfter)};color:${esc(p.fgHexAfter)}">Aa</span><span class="mono small">${esc(p.fg)}<br><span class="muted">on</span> ${esc(p.bg)}</span></span></th>
          <td class="small">${esc(p.where)}</td>
          <td class="num">${p.before.toFixed(2)}:1</td>
          <td class="num"><strong>${p.after.toFixed(2)}:1</strong> ${p.after < p.min ? badgeHtml('Fails', { tone: 'danger', size: 'sm' }) : p.after >= p.before ? '' : badgeHtml('Lower', { tone: 'warning', size: 'sm' })}</td>
          <td class="num">${p.min}:1</td></tr>`,
         )
         .join('')}</tbody></table></div>`;
  const contrast = !n
    ? '<p class="small muted">No checked contrast pair depends on these tokens.</p>'
    : fails
      ? `<h3 class="rv-sub">Contrast, before -> after</h3>
       <p class="small muted">Checked pairs whose ratio moves because either color resolves through a changed token, in each brand and theme. Failing pairs come first.</p>${contrastTable}`
      : `<details class="cg-more rv-contrast-more"><summary>Show the ${n === 1 ? 'contrast pair' : `${n} contrast pairs`} that moved</summary>
       <p class="small muted">Each still meets its minimum, in each brand and theme.</p>${contrastTable}</details>`;
  return `<div class="table-wrap"><table class="rv-table"><thead><tr><th scope="col">Token</th><th scope="col">Before</th><th scope="col"><span class="sr-only">Change</span></th><th scope="col">After</th></tr></thead><tbody>${rows}</tbody></table></div>${contrast}${
    review.failing ? `<p class="rv-error">${review.failing} contrast check${review.failing > 1 ? 's' : ''} would fail after this change. The token build will block it.</p>` : ''
  }`;
}

// ---------------------------------------------------------------------------------------------------------------

/** Back from a pull request to the list (the page controller repaints the view). */
export function closePr() {
  openSeq++;
  unmountLib();
  view = null;
  reviewModule?.unmountBranchReview();
  current = null;
  runCurrent = null;
  detailEl().hidden = true;
  detailEl().innerHTML = '';
  notice().hidden = true;
}

/** Repaint an open pull request when the viewer changes: the gate depends on who is connected. */
export function initReviewAuth() {
  let lastLogin: string | null | undefined;
  initGitHubConnect((v) => {
    const login = v?.login ?? null;
    const n = Number(new URLSearchParams(location.search).get('pr'));
    if (n && login !== (lastLogin ?? null)) void openPr(n, false);
    lastLogin = login;
  });
}

export const _current = () => current;
