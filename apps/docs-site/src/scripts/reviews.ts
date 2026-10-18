// Changes > In review and the pull request detail: the review queue of the configured repo (lib/review-queue: open
// pull requests minus running explorations and release automation), read client-side from the GitHub REST API, most
// urgent first, with a designer-friendly token diff and governance-aware actions. Designer words on screen: a change
// ships, it is not merged; developer details sit in one "For developers" fold.
// Without a token every action deep-links to GitHub. When GitHub cannot be read, the last list this browser saw
// stays on screen, labelled with its time (lib/changes.ts).
import { findPreviewComment, isActiveExploration, type Rights, type ShipPolicy } from '@bridge-ds/core';
import { loadTeams, siteApprovers, siteShipPolicy, teamDirectory } from './teams';
import { approvalNeedLabel, approvalNeedLong, effectiveTier, isAutomationPull, reviewQueue } from '../lib/review-queue';
import {
  allowedMergeMethods,
  canOverride,
  canWrite,
  mergeGate,
  NO_OVERRIDE,
  openPulls,
  OVERRIDE_HEADING,
  overrideComment,
  overrideReasonProblem,
  overrideRefusedComment,
  parseChangeset,
  parseOverrideComment,
  pullState,
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
  currentPackageName,
  eligibleFor,
  filterByTier,
  listSource,
  needFromDetail,
  readSnapshot,
  tierParam,
  whoActs,
  writeSnapshot,
  type ApprovalRow,
  type CachedPull,
  type People,
  type WhoActs,
} from '../lib/changes';
import { iconSvg } from '../brand/icons';
import { pullEntry, type BranchesConfig } from '../lib/branches';
import type { Root } from 'react-dom/client';
import { currentViewer, esc, ghGet, ghWrite, GitHubError, hasWorkingToken, initGitHubConnect, prefersSignIn, RateLimitError, readRepo, relativeTime, showGhError } from './github-session';
import { ghAction, ghVerb } from '../lib/gh-wording';
import { analyzeTokenFiles, isTokenFile, type TokenReview } from './reviews/token-review';
import { loadVisualImpact, renderTopChange } from './reviews/visual-impact';
import { ciFor, loadStatuses, teamPeople, whoChip, type PullStatus } from './pr-status';
import { mdTitleHtml, mdTitleText } from '../lib/markdown';
import { humanTitle } from '../lib/pr-title';
import { touchesVisuals } from '../lib/visual-impact';
import { isDocsFile } from '../lib/pr-docs';
import { loadDocsSection, renderDocsSection } from './reviews/docs-section';
import { workNature, type FileSignals, type WorkNature } from '../lib/work-nature';
import { devTag, markWork, natureAttr } from './work-filter';
import {
  approvalHelp,
  checkStory,
  classifyCheck,
  failingSentence,
  jobIdFromUrl,
  reviewAskMessage,
  shipWhen,
  type CheckFacts,
  type CheckLine,
  type ClassifiedCheck,
  type DesignFacts,
} from '../lib/check-explain';
import { productPreview, topScreen, tryInProductUrl } from '../lib/try-in-product';
import { canShare, shareState, showShare, type ShareState } from '../lib/share-change';
import { addedNotice, canAddTo, dismissedApprovals, dismissedSentence, isTokenChange } from '../lib/continue-change';
import { backToDraft, detailStatus, mountStatus, statusFallback, unmountStatus, type DetailStatus } from './change-status';
import { currentStatus, initStatusFilter, lifecycleChip, lifecycleOfRow } from './status-filter';
import { byLifecycle, emptyFilterLine, needsClosed, showsUnderStatus, statusOpener } from '../lib/change-status';
import { behindTag, conflictLine, conflictRows, freshness, libraryLine, nextSteps, resolveLabel, type CompareLike, type Freshness } from '../lib/library-sync';
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

const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const detailEl = () => $('rv-detail');
const notice = () => $('rv-notice');

function showNotice(tone: 'warn' | 'fail' | 'info', text: string) {
  const n = notice();
  n.hidden = false;
  n.className = `rv-notice is-${tone}`;
  n.textContent = text;
}

/** What approval the change needs, in plain words and no color ("Design + tech"). Empty while the files are read. */
const needTag = (t: Tier | null) => `<span class="cg-need">${esc(approvalNeedLabel(t))}</span>`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** People around a pull request, for the who-acts line (lib/changes whoActs). */
function people(author: string, extra: Partial<People> = {}): People {
  return { owners: OWNERS(), ...teamPeople(), author, viewer: currentViewer()?.login ?? null, overrideBy: OVERRIDE.allowed, shippers: SHIP()?.logins, ...extra };
}

/** One chip per row: the status color and who acts now (pr-status whoChip, shared with the Overview). */
const chip = (r: Row) => whoChip(r.kind, { author: r.user.login, approvers: r.approvers, changesRequested: r.changesRequested, failing: r.failing, skipped: r.skipped });

function avatar(u: User | null, size = 24) {
  if (!u) return '';
  return `<img class="rv-avatar" src="${esc(u.avatar_url)}&s=${size * 2}" alt="" width="${size}" height="${size}" loading="lazy" />`;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------------------------------------------------
// In review

interface Row {
  number: number;
  title: string;
  updated_at: string;
  tier: Tier | null;
  kind: ReviewStatusKind | null;
  skipped: boolean;
  head: { ref: string; sha: string };
  user: { login: string };
  draft?: boolean;
  /** Pull request state and merge time: Shipped and Closed rows (status filter). */
  state?: string;
  merged_at?: string | null;
  labels?: { name: string }[];
  /** Design or developer work (lib/work-nature): title and labels first, then the changed files once read. */
  nature: WorkNature;
  /** From the status read: who approved, who asked for changes, how many checks fail. */
  approvers?: string[];
  changesRequested?: string[];
  failing?: number;
  /** The design approval is in, and the names of the failing checks: the waiting-for-code rule (lib/change-status). */
  design?: boolean;
  failingChecks?: string[];
  /** Library updates since the change started (compare behind_by), read with a token only. */
  behindBy?: number | null;
}

function rowHtml(r: Row) {
  const title = humanTitle(mdTitleText(r.title));
  return `<li class="cg-row" data-pr="${r.number}" ${natureAttr(r.nature)}><a class="cg-row-link" href="?pr=${r.number}" data-open-pr="${r.number}">
    <span class="cg-row-title"><span class="cg-row-name" title="${esc(title)}">${esc(title)}</span> <span class="cg-num">#${r.number}</span> ${devTag(r.nature)}${behindHtml(r.behindBy)}</span>
    ${needTag(r.tier)}
    ${lifecycleChip(r) ?? chip(r)}
    <time class="cg-date" datetime="${esc(r.updated_at)}">${esc(shortDate(r.updated_at))}</time></a></li>`;
}

/** The open rows last painted, and the recently closed ones once the Shipped or Closed filter asked for them. */
let openRows: Row[] = [];
let closedRows: Row[] | null = null;
/** "12 updates behind" after the title: plain words, no color (the status chip holds the color). */
function behindHtml(n: number | null | undefined) {
  const tag = behindTag(n);
  return tag ? ` <span class="cg-behind">${esc(tag)}</span>` : '';
}

function paintRows(rows: Row[], loading: boolean) {
  openRows = rows;
  const list = $('rv-list');
  const tier = tierParam(location.search);
  const status = currentStatus();
  const pool = needsClosed(status) ? (closedRows ?? []) : rows;
  // Most urgent first, then waiting for code, then drafts (lib/change-status byLifecycle); then the status filter.
  const sorted = byLifecycle(filterByTier(byUrgency(pool), tier).map((r) => ({ r, lifecycle: lifecycleOfRow(r) })))
    .filter((x) => showsUnderStatus(status, x.lifecycle))
    .map((x) => x.r);
  const none = status !== 'open' ? emptyFilterLine(status) : `Nothing waits here: ${approvalNeedLong(tier).toLowerCase()}.`;
  list.innerHTML = sorted.length ? sorted.map(rowHtml).join('') : `<li class="cg-row cg-none">${esc(needsClosed(status) && !closedRows ? 'Reading recent changes from GitHub.' : none)}</li>`;
  // Another status than Open always shows its list, even when nothing is open; the opener speaks about open changes.
  if (status !== 'open') {
    $('cg-table').hidden = false;
    $('cg-empty').hidden = true;
    $('cg-opener').hidden = true;
  } else if (rows.length) $('cg-opener').hidden = false;
  markWork(list);
  const filter = document.getElementById('cg-tier-filter');
  if (filter) {
    filter.hidden = !tier;
    const label = filter.querySelector('[data-tier-label]');
    if (label) label.textContent = approvalNeedLong(tier).toLowerCase();
  }
  const count = $('rv-count');
  count.textContent = String(rows.length);
  count.hidden = rows.length === 0;
  const opener = statusOpener(rows.map((r) => ({ ...r, lifecycle: lifecycleOfRow(r) })));
  const sentence = $('cg-open-sentence');
  const cta = document.getElementById('cg-open-cta') as HTMLAnchorElement | null;
  sentence.textContent = loading ? `${plural(rows.length, 'change')} in review. Checking their tests and approvals.` : opener.sentence;
  if (cta && opener.action) {
    cta.href = `?pr=${opener.action.pr}`;
    cta.dataset.openPr = String(opener.action.pr);
    cta.textContent = opener.action.label;
    cta.hidden = false;
  } else if (cta && !loading) cta.hidden = true;
}

function showEmpty(empty: boolean) {
  $('cg-opener').hidden = empty;
  $('cg-table').hidden = empty;
  $('cg-empty').hidden = !empty;
}

function paintAsOf(at: string | null) {
  const el = $('cg-asof');
  el.hidden = !at;
  if (at) el.textContent = `Showing the list ${asOf(at)}: GitHub cannot be read right now. ${ghAction('see live status', prefersSignIn())}.`;
}

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
  user: { login: p.user.login },
  draft: p.draft,
  ...('state' in p ? { state: p.state, merged_at: p.merged_at } : {}),
  ...('labels' in p ? { labels: p.labels } : {}),
  nature: natureOf(p.title, 'labels' in p ? p.labels : undefined),
});

/**
 * Loads and paints the In review list. Returns every open pull request (running explorations and the release pull
 * request included, which the list leaves out: Explorations and History read them from here).
 */
/** Shipped and Closed: the 30 most recently closed changes, read once. */
async function loadClosed() {
  if (closedRows) return;
  try {
    const f = await ghGet<Pull[]>(`${R}/pulls?state=closed&sort=updated&direction=desc&per_page=30`);
    // Release automation and explorations have their own places (History, Explorations).
    closedRows = f.data.filter((p) => !isAutomationPull(p) && !p.labels.some((l) => l.name === 'exploration')).map((p) => toRow(p, pullState(p) === 'merged' ? 'merged' : 'closed'));
  } catch (err) {
    closedRows = [];
    showNotice('warn', err instanceof RateLimitError ? `GitHub limits anonymous reads to 60 an hour. ${ghVerb(prefersSignIn())} to see shipped and closed changes.` : `Could not read recent changes: ${(err as Error).message}`);
  }
  paintRows(openRows, false);
}

let statusFilterOn = false;

export async function loadList(): Promise<{ number: number; head: { ref: string } }[]> {
  if (!statusFilterOn) {
    statusFilterOn = true;
    initStatusFilter(() => {
      paintRows(openRows, false);
      if (needsClosed(currentStatus())) void loadClosed();
    });
    if (needsClosed(currentStatus())) void loadClosed();
  }
  const list = $('rv-list');
  list.setAttribute('aria-busy', 'true');
  const snapshot = readSnapshot(storage(), REPO_KEY);
  const known = new Map<number, ReviewStatusKind | null>((snapshot?.pulls ?? []).map((p) => [p.number, p.kind]));
  let live: { pulls: Pull[]; staleAt?: string | null } | null = null;
  let failure: unknown = null;
  let allOpen: Pull[] = [];
  try {
    const f = await ghGet<Pull[]>(`${R}/pulls?state=open&per_page=100`);
    allOpen = openPulls(f.data);
    // The review queue: running explorations live in Explorations, the release pull request in History.
    live = { pulls: reviewQueue(allOpen), staleAt: f.stale ? (f.cachedAt ?? new Date(0).toISOString()) : null };
  } catch (err) {
    failure = err;
  }
  const src = listSource(live, snapshot);
  list.removeAttribute('aria-busy');

  if (src.kind === 'unavailable') {
    showEmpty(false);
    $('cg-table').hidden = true;
    $('cg-open-sentence').textContent =
      failure instanceof RateLimitError
        ? `GitHub limits anonymous reads to 60 an hour and this browser has used them, with no saved list yet. ${ghVerb(prefersSignIn())}, or try again later.`
        : `Could not load pull requests: ${(failure as Error | null)?.message ?? 'GitHub did not answer'}.`;
    return [];
  }

  if (src.kind === 'cached') {
    // A snapshot saved before automation left the queue may still hold the release pull request.
    const rows = src.pulls.filter((p) => !isAutomationPull(p)).map((p) => ({ ...toRow(p, p.kind), skipped: !p.kind }));
    showEmpty(rows.length === 0);
    paintRows(rows, false);
    paintAsOf(src.at);
    return src.pulls;
  }

  const pulls = src.pulls;
  paintAsOf(src.kind === 'stale' ? src.at : null);
  showEmpty(pulls.length === 0);
  if (!pulls.length) {
    $('rv-count').hidden = true;
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
    if (st && st.kind !== 'unknown') Object.assign(r, { approvers: st.approvers, changesRequested: st.changesRequested, failing: st.failing, design: st.design, failingChecks: st.failingChecks });
    if (st?.tier) r.tier = st.tier;
    if (st?.files) r.nature = natureOf(r.title, r.labels, st.files);
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
// Detail

let current: { pull: Pull; tier: Tier | null } | null = null;
/** The lifecycle status of the change renderDetail painted last (scripts/change-status), mounted once wired. */
let statusNow: DetailStatus | null = null;

/** "See all N" under the before/after: opens the full visual list and brings it into view. Wired once per element. */
function wireVisualLink(d: HTMLElement) {
  if (d.dataset.visualLink) return;
  d.dataset.visualLink = '1';
  d.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-open-visual]');
    const sec = document.getElementById('cg-sec-visual') as HTMLDetailsElement | null;
    if (!a || !sec) return;
    e.preventDefault();
    sec.open = true;
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}
let openSeq = 0;

/** Points "Try it in the product" at the admin screen that changes most, once the visual impact names one. */
function aimTryInProduct(pr: number, shots: Parameters<typeof topScreen>[0]) {
  const a = document.getElementById('rv-try') as HTMLAnchorElement | null;
  const screen = topScreen(shots);
  if (!a?.dataset.preview || !screen) return;
  a.href = tryInProductUrl(a.dataset.preview, pr, screen);
  const what = document.querySelector('#rv-try-hint [data-try-what]');
  if (what) what.textContent = `Opens ${screen.label.toLowerCase()}, the screen that changes most, in the demo admin.`;
}

function section(id: string, title: string, meta: string, body: string, open = false) {
  return `<details class="cg-sec" id="${id}"${open ? ' open' : ''}><summary class="cg-sec-head"><span class="cg-sec-title">${title}</span><span class="cg-sec-meta" data-sec-meta>${meta}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary><div class="cg-sec-body">${body}</div></details>`;
}

export async function openPr(n: number, push = true) {
  const seq = ++openSeq;
  if (push) history.pushState({ pr: n }, '', `?pr=${n}`);
  document.dispatchEvent(new CustomEvent('bridge:changes-view', { detail: 'detail' }));
  const d = detailEl();
  d.hidden = false;
  d.innerHTML = `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="./" data-back>Changes</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav><p class="rv-loading">Loading pull request #${n}</p>`;
  window.scrollTo({ top: 0 });
  try {
    const pf = await ghGet<Pull>(`${R}/pulls/${n}`);
    if (pf.stale) showNotice('warn', `GitHub cannot be read right now, so this shows change #${n} ${asOf(pf.cachedAt ?? '')}. ${ghAction('see live status', prefersSignIn())}.`);
    const pull = pf.data;
    // GitHub computes whether it merges cleanly on the first read (null meanwhile): read it once more while the rest
    // loads, so the header never says "waiting for approval" on one load and "conflict" on the next.
    const mergeable: Promise<boolean | null | undefined> =
      pull.mergeable === null && pullState(pull) === 'open'
        ? new Promise((r) => setTimeout(r, 1500))
            .then(() => ghGet<Pull>(`${R}/pulls/${n}`))
            .then((f) => f.data.mergeable)
            .catch(() => null)
        : Promise.resolve(pull.mergeable);
    const live = pullState(pull) === 'open' || pullState(pull) === 'draft';
    const [files, reviews, comments, ci, access, statuses, merges, compare] = await Promise.all([
      ghGet<PrFile[]>(`${R}/pulls/${n}/files?per_page=100`).then((f) => f.data),
      ghGet<Review[]>(`${R}/pulls/${n}/reviews?per_page=100`).then((f) => f.data).catch(() => [] as Review[]),
      ghGet<Comment[]>(`${R}/issues/${n}/comments?per_page=100`).then((f) => f.data).catch(() => [] as Comment[]),
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
    // A newer openPr (other PR, or the viewer changed) owns the page now.
    if (seq !== openSeq) return;
    // Highest wins: the label or checkbox the author set, or what the shared classifier (the one the plugin, the
    // editor and the MCP server use) computes from the changed files. The In review rows use the same rule.
    const tier = effectiveTier(pull.labels, pull.body, files);
    current = { pull, tier };
    const approvals = summarizeApprovals(reviews, OWNERS(), pull.user.login);
    const ship = await viewerShipPolicy(SHIP(), access?.login);
    if (seq !== openSeq) return;
    const gate = mergeGate({ tier, ci, approvals, draft: pull.draft, mergeable: pull.mergeable, state: pull.state, merged_at: pull.merged_at, viewer: access?.login, override: OVERRIDE, exploration: isActiveExploration(pull.labels), ship });
    const tokenFiles = files.filter((f) => isTokenFile(f.filename));
    const changesets = files.filter((f) => /^\.changeset\/(?!README).+\.md$/.test(f.filename) && f.status !== 'removed');
    const visual = touchesVisuals(files.map((f) => f.filename));
    // Designer first: the first sentence says whether the design is the problem, so the token review (contrast) and
    // what each failing check found (its failing step and test annotations) are read before the page paints.
    const [review, failedFacts] = await Promise.all([
      tokenFiles.length
        ? analyzeTokenFiles({ owner: repo.owner, repo: repo.repo, baseSha: pull.base.sha, headSha: pull.head.sha, files: tokenFiles }).catch((err) => err as Error)
        : Promise.resolve(null),
      Promise.all(ci.failed.map(readCheckFacts)),
    ]);
    if (seq !== openSeq) return;
    const checks = failedFacts.map(classifyCheck);

    const docsPaths = files.filter((f) => isDocsFile(f.filename) && f.status !== 'removed').map((f) => f.filename);
    unmountMore();
    unmountStatus();
    unmountLib();
    unmountShare();
    const fresh = freshness({ compare, mergeable: pull.mergeable, open: live });
    d.innerHTML = renderDetail({ pull, tier, files, reviews, comments, ci, approvals, gate, tokenCount: tokenFiles.length, changesetCount: changesets.length, visual, access, docsPaths, statuses, review, checks, fresh });
    wireActions(pull, gate, access);
    wireLibrary({ pull, fresh, compare, access, checks: ci.total, visual, approvals: approvals.approvers.length, seq });
    wireVisualLink(d);
    wireShare(pull, files, comments, seq);
    if (statusNow)
      void mountStatus($('rv-status'), statusNow, {
        pull,
        isAuthor: Boolean(access && access.login.toLowerCase() === pull.user.login.toLowerCase()),
        canWrite: Boolean(access?.write),
        viewer: access?.login ?? null,
        exploration: isActiveExploration(pull.labels),
        review: review instanceof Error ? null : review,
        reload: () => openPr(n, false),
        isCurrent: () => seq === openSeq,
      });
    // Continue a change: "Edit tokens in this change", and what was just added when back from the token editor.
    const editSlot = document.getElementById('rv-edit-in-change');
    const addedSlot = document.getElementById('rv-added');
    if (editSlot || addedSlot)
      void import('../components/ds/studio/ContinueChange').then(({ mountAddedNotice, mountEditInChange }) => {
        if (seq !== openSeq) return;
        if (editSlot?.isConnected) mountEditInChange(editSlot, `/studio/tokens/?change=${pull.number}`);
        if (addedSlot?.isConnected) {
          mountAddedNotice(addedSlot, addedSlot.dataset.text ?? '');
          // Said once: a reload or a shared link shows the change without it.
          history.replaceState(history.state, '', `?pr=${pull.number}`);
        }
      });

    if (docsPaths.length) {
      const branch = pull.head.ref;
      const sameRepo = !(pull.head as { repo?: { full_name?: string } }).repo?.full_name || (pull.head as { repo?: { full_name?: string } }).repo!.full_name === `${repo.owner}/${repo.repo}`;
      loadDocsSection(
        $('rv-docs'),
        docsPaths,
        { owner: repo.owner, repo: repo.repo, pr: pull.number, sha: pull.head.sha, branch, canWrite: Boolean(access?.write) && sameRepo && pullState(pull) === 'open' },
        (path, name) => import('./docs-commit').then((m) => m.acceptDocsOnBranch(path, branch, name)),
      ).catch((err) => ($('rv-docs').innerHTML = `<p class="rv-error">Could not read the docs: ${esc((err as Error).message)}</p>`));
    }

    if (visual) {
      const slot = $('rv-visual');
      loadVisualImpact(slot, {
        owner: repo.owner,
        repo: repo.repo,
        pr: pull.number,
        sha: pull.head.sha,
        actionsUrl: `https://github.com/${repo.owner}/${repo.repo}/actions/workflows/visual-impact.yml`,
      }, $('rv-what-visual'))
        .then((v) => {
          if (seq !== openSeq) return;
          const meta = document.querySelector('#cg-sec-visual [data-sec-meta]');
          if (meta) meta.innerHTML = v.changed === null ? (v.asked ? 'Asked' : 'Not run yet') : v.changed === 0 ? 'No change' : `${plural(v.changed, 'screen')} changed${v.thumb}`;
          // The full list only adds something when there is more than the before/after on top.
          const sec = document.getElementById('cg-sec-visual');
          if (sec) sec.hidden = !v.changed || v.changed < 2;
          renderTopChange($('rv-what-visual'), v, '#cg-sec-visual');
          aimTryInProduct(pull.number, v.shots);
        })
        .catch((err) => {
          slot.innerHTML = `<p class="rv-error">Could not read the visual impact: ${esc((err as Error).message)}</p>`;
          $('rv-what-visual').innerHTML = `<p class="rv-error">Could not read the before and after: ${esc((err as Error).message)}</p>`;
        });
    }

    if (changesets.length) {
      const slot = $('rv-changeset');
      Promise.all(
        changesets.map((f) =>
          ghGet<string>(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${pull.head.sha}/${f.filename}`, { raw: true }).then((r) => ({ f, text: r.data })),
        ),
      )
        .then((all) => {
          const parsed = all.map(({ f, text }) => ({ f, c: parseChangeset(text) }));
          const bumps = parsed.flatMap((x) => x.c.bumps.map((b) => ({ ...b, pkg: currentPackageName(b.pkg) })));
          const meta = document.querySelector('#cg-sec-changeset [data-sec-meta]');
          if (meta) meta.textContent = [...new Set(bumps.map((b) => b.bump))].join(', ') || 'no bump';
          slot.innerHTML = parsed
            .map(
              ({ f, c }) =>
                `<div class="rv-cs"><p class="cg-cs-bumps">${c.bumps.map((b) => `<span class="mono">${esc(currentPackageName(b.pkg))}</span> ${esc(b.bump)}`).join(', ')}</p><p>${mdTitleHtml(c.summary)}</p><p class="cg-muted mono">${esc(f.filename)}</p></div>`,
            )
            .join('');
        })
        .catch(() => (slot.innerHTML = '<p class="cg-muted">Could not read the changeset.</p>'));
    }
  } catch (err) {
    if (seq !== openSeq) return;
    d.innerHTML = `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="./" data-back>Changes</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav>`;
    if (err instanceof RateLimitError) showNotice('warn', `GitHub limits anonymous reads to 60 an hour. ${ghVerb(prefersSignIn())}, or open this change on GitHub.`);
    else showNotice('fail', `Could not load pull request #${n}: ${(err as Error).message}`);
  }
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
  ci: ReturnType<typeof summarizeCi>;
  approvals: ReturnType<typeof summarizeApprovals>;
  gate: ReturnType<typeof mergeGate>;
  tokenCount: number;
  changesetCount: number;
  visual: boolean;
  access: Access | null;
  /** docs.json files the pull request adds or changes. */
  docsPaths: string[];
  /** Commit statuses of the head (Vercel reports each preview there). */
  statuses?: { context: string; state: string; target_url?: string | null }[];
  /** The token review, an Error when it could not be computed, null when no token file changed. */
  review: TokenReview | Error | null;
  /** The failing checks, classified (design rule or developer). */
  checks: ClassifiedCheck[];
  /** How the change stands against the latest library (lib/library-sync). */
  fresh: Freshness;
}

/** Row icon: a check when approved, a cross when changes were requested, an empty circle while it waits. */
const ROW_ICON: Record<ApprovalRow['state'], string> = {
  approved: `<span class="rv-ap-icon is-approved">${iconSvg('check', 16)}</span>`,
  changes: `<span class="rv-ap-icon is-changes">${iconSvg('x', 16)}</span>`,
  waiting: '<span class="rv-ap-icon is-waiting"></span>',
};

const LINE_ICON: Record<CheckLine['state'], string> = { pass: ROW_ICON.approved, fail: ROW_ICON.changes, pending: ROW_ICON.waiting };
const LINE_STATE: Record<CheckLine['state'], string> = { pass: 'Passes', fail: 'Fails', pending: 'Running' };

const lineRow = (label: string, l: CheckLine) =>
  `<li class="rv-ap-row" data-state="${l.state === 'pass' ? 'approved' : l.state === 'fail' ? 'changes' : 'waiting'}">${LINE_ICON[l.state]}<span class="rv-ap-role">${esc(label)}</span><span class="rv-ap-text"><span class="sr-only">${LINE_STATE[l.state]}: </span>${esc(l.text)}</span></li>`;

/** The primary action of the header, when it sits in the checklist. */
type ListPrimary = 'approve-design' | 'approve-tech' | 'approve' | 'ask' | 'override' | null;

/**
 * What the change needs to ship, as one checklist (like the merge box of a pull request): the design rules, the
 * developer tests, then one row per approval the tier needs. Each row says its state in words; the action sits on the
 * row it acts on. A footer says why an approval is blocked for the author, with "Ask for review" and the override.
 */
function needsHtml(x: {
  story: ReturnType<typeof checkStory>;
  rows: ApprovalRow[];
  rowText: Partial<Record<ApprovalRow['role'], string>>;
  why: string | null;
  ask: string | null;
  override: boolean;
  primary: ListPrimary;
  /** The Latest library row, when the change is behind or conflicts. */
  library?: string;
}) {
  const checks = [x.story.design ? lineRow('Design rules', x.story.design) : '', x.story.developer ? lineRow('Developer tests', x.story.developer) : '', x.library ?? ''].join('');
  const approvals = x.rows
    .map((r) => {
      const primary = x.primary === (r.role === 'design' ? 'approve-design' : r.role === 'tech' ? 'approve-tech' : 'approve');
      const act = r.canAct ? `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-lg rv-ap-act" data-act="APPROVE">${esc(r.actionLabel)}</button>` : '';
      const state = r.state === 'approved' ? 'Approved' : r.state === 'changes' ? 'Changes requested' : 'Waiting';
      const label = r.role === 'approval' ? 'Approval' : `${r.label} approval`;
      const text = (r.state === 'waiting' && x.rowText[r.role]) || r.text;
      return `<li class="rv-ap-row" data-state="${r.state}">${ROW_ICON[r.state]}<span class="rv-ap-role">${esc(label)}</span><span class="rv-ap-text"><span class="sr-only">${state}: </span>${esc(text)}</span>${act}</li>`;
    })
    .join('');
  const acts = [
    x.ask ? `<button type="button" class="btn ${x.primary === 'ask' ? 'btn-primary' : 'btn-secondary'} btn-lg" data-ask-review data-copy="${esc(x.ask)}"><span data-copy-label>Ask for review</span></button>` : '',
    x.override ? `<button type="button" class="btn ${x.primary === 'override' ? 'btn-primary' : 'btn-secondary'} btn-lg" data-open-override>Ship with owner override</button>` : '',
  ].join('');
  const why = x.why ? esc(x.why).replace('in Settings', 'in <a href="/studio/settings/#roles">Settings</a>') : '';
  const foot = why || acts ? `<li class="rv-ap-foot">${why ? `<p class="rv-ap-why">${why}</p>` : ''}${acts ? `<p class="rv-ap-acts">${acts}</p>` : ''}<p class="rv-ap-said" id="rv-ap-said" role="status" aria-live="polite"></p></li>` : '';
  if (!checks && !approvals && !foot) return '<p class="cg-line">No approval needed.</p>';
  return `<ul class="rv-ap" aria-label="What it needs to ship">${checks}${approvals || (x.rows.length ? '' : '<li class="rv-ap-row" data-state="approved">' + ROW_ICON.approved + '<span class="rv-ap-role">Approval</span><span class="rv-ap-text">No approval needed.</span></li>')}${foot}</ul>`;
}

/** A draft asks nobody yet: its approval rows say so instead of "Waiting". */
const DRAFT_ROWS: Partial<Record<ApprovalRow['role'], string>> = { design: 'Not asked until it is marked ready', tech: 'Not asked until it is marked ready', approval: 'Not asked until it is marked ready' };

/** The author's next step happens on GitHub: the button names it. */
const AUTHOR_CTA: Partial<Record<WhoActs['action'], string>> = {
  'fix-checks': 'See the checks on GitHub',
  'address-changes': 'Answer the review on GitHub',
  'mark-ready': 'Mark ready on GitHub',
  promote: 'Promote on GitHub',
};

function renderDetail(x: DetailInput) {
  const { pull, tier, files, reviews, comments, ci, approvals, gate, access } = x;
  const write = Boolean(access?.write);
  const showOverride = gate.overridable && write;
  const lifecycle = pullState(pull);
  const open = lifecycle === 'open';
  const who = whoActs(
    needFromDetail({ state: lifecycle, ci, gate, changesRequestedBy: approvals.changesRequested, exploration: isActiveExploration(pull.labels), mergeable: pull.mergeable }),
    people(pull.user.login, { viewer: access?.login ?? null, approvers: approvals.approvers, canMerge: write && gate.canShip, overridable: showOverride }),
  );
  const viewerPeople = people(pull.user.login, { viewer: access?.login ?? null });
  const rows = approvalRows({ tier, approvals, people: viewerPeople, open });
  const rowAction = rows.some((r) => r.canAct);
  const login = access?.login ?? null;
  const isAuthor = Boolean(login && login.toLowerCase() === pull.user.login.toLowerCase());

  // The checks, designer first: design rules (contrast, token rules) and developer tests, each in plain words.
  const review = x.review instanceof Error ? null : x.review;
  const tokenOnly = files.length > 0 && files.every((f) => isTokenFile(f.filename) || f.filename.startsWith('.changeset/'));
  const story = checkStory({
    failed: x.checks,
    pending: ci.pending.length,
    passed: ci.passed,
    design: review ? designFacts(review, x.checks.some((c) => c.kind === 'design')) : null,
    tokenOnly,
  });

  // Why an approval waits, for the author: GitHub never lets authors approve their own change.
  const waiting = rows.filter((r) => r.state === 'waiting').map((r) => r.role);
  const eligibleNow = { ...viewerPeople, approvers: approvals.approvers };
  const help = open
    ? approvalHelp({
        viewerIsAuthor: isAuthor,
        waiting,
        eligible: Object.fromEntries(waiting.map((r) => [r, eligibleFor(r, eligibleNow).logins])),
        viewerHoldsOverride: write && canOverride(login, OVERRIDE),
        testsPass: ci.state === 'pass' || ci.state === 'none',
      })
    : null;
  const ask = help ? reviewAskMessage({ title: humanTitle(mdTitleText(pull.title)), number: pull.number, url: `${location.origin}${location.pathname}?pr=${pull.number}`, roles: waiting, others: help.others }) : null;

  // One primary action per view. Developer failures never make "fix checks" the designer's turn: design review goes
  // on (Approve design), the author asks for review; "Open failing test" lives under For developers.
  let sentence = who.sentence;
  let yourTurn = who.yourTurn;
  let primary: ListPrimary = null;
  let headerCta = '';
  let headerShip = false;
  const designRow = rows.find((r) => r.role === 'design' && r.canAct);
  if (open && who.action === 'fix-checks') {
    const f = failingSentence({ story, author: pull.user.login, viewerIsAuthor: isAuthor, viewerApprovesDesign: Boolean(designRow) && !story.designFails, approvalsMissing: gate.missing.length > 0 });
    sentence = f.sentence;
    yourTurn = f.yourTurn;
    if (story.designFails) {
      if (isAuthor && review?.contrast.some((c) => c.after < c.min)) headerCta = '<a class="btn btn-primary btn-lg" href="#rv-tokens">See the failing pairs</a>';
    } else if (designRow) primary = 'approve-design';
    else if (help) primary = 'ask';
  } else if (who.yourTurn) {
    if (who.action === 'merge' && gate.allowed && write) {
      headerCta = '<button type="button" class="btn btn-primary btn-lg" data-act="MERGE">Ship</button>';
      headerShip = true;
    } else if (who.action === 'override' && showOverride) {
      primary = 'override';
      sentence = 'Your turn: no other owner can approve, so ship it with the owner override.';
    } else if (who.action === 'approve-design' || who.action === 'approve-tech' || who.action === 'approve') primary = who.action;
    else if (AUTHOR_CTA[who.action]) headerCta = `<a class="btn btn-primary btn-lg" href="${esc(pull.html_url)}" target="_blank" rel="noopener">${AUTHOR_CTA[who.action]}</a>`;
  } else if (help) primary = 'ask';
  // The lifecycle status line (scripts/change-status) leads the header. Waiting for code: no designer action, the
  // approval rows keep theirs as secondary. Draft: Mark as ready is the status line's own primary.
  const exploration = isActiveExploration(pull.labels);
  // Approvals GitHub dismissed (for example after new edits) and nobody gave again: the headline's first words.
  const dismissed = open ? dismissedSentence(dismissedApprovals(reviews as never, pull.head.sha)) : null;
  const status = detailStatus({ pull, tier, ci, approvals, story, checks: x.checks, files: files.map((f) => f.filename), exploration, isAuthor, sentence, yourTurn });
  if (dismissed) status.sentence = `${dismissed} ${status.sentence}`;
  statusNow = status;
  if (status.lifecycle === 'waiting') {
    primary = null;
    headerCta = '';
  }
  if (status.lifecycle === 'draft' && isAuthor && write && !exploration) headerCta = '';
  if (!access && !headerCta && (lifecycle === 'open' || lifecycle === 'draft')) headerCta = `<button type="button" class="btn btn-primary btn-lg" data-gh-open>${ghAction('review', prefersSignIn())}</button>`;
  // Latest library: one row in the checklist when the change is behind or conflicts, its action on the row (mounted by
  // wireLibrary). Resolving a conflict is the view's primary only when nothing else holds it.
  const libraryRow = libraryRowHtml(x.fresh, !headerCta && primary === null && who.action === 'resolve-conflict', pull.number);
  const failingRun = ci.failed.find((f) => f.url)?.url;

  // Conversation: how many, the last word, and GitHub for the thread (it is where people answer).
  const conversation = [
    ...reviews
      .filter((r) => r.state !== 'PENDING')
      .map((r) => ({ at: r.submitted_at ?? '', user: r.user, kind: r.state, body: r.body ?? '', url: r.html_url })),
    ...comments.map((c) => {
      const ov = parseOverrideComment(c.body);
      return { at: c.created_at, user: c.user, kind: ov ? (ov.merged ? 'OVERRIDE' : 'OVERRIDE_REFUSED') : 'COMMENT', body: ov ? c.body.replace(OVERRIDE_HEADING, '').trim() : c.body, url: c.html_url };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const kindLabel: Record<string, string> = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'requested changes',
    COMMENTED: 'reviewed',
    DISMISSED: 'review dismissed',
    COMMENT: 'commented',
    OVERRIDE: 'shipped it as owner override',
    OVERRIDE_REFUSED: 'tried an owner override',
  };
  // The last word from a person: bot comments (deploy previews, release notes) never stand for the conversation.
  const isBot = (c: { user: User | null }) => /\[bot\]$/.test(c.user?.login ?? '');
  const humans = conversation.filter((c) => !isBot(c));
  const last = humans[humans.length - 1] ?? conversation[conversation.length - 1];
  // A bot's body is markup for GitHub (preview tables, release notes): name it, do not quote it.
  const quote = last && !isBot(last) ? last.body : '';
  const excerpt = (text: string) => {
    const one = mdTitleText(text).replace(/\s+/g, ' ').trim();
    return one.length > 160 ? `${one.slice(0, 157).replace(/\s+\S*$/, '')}...` : one;
  };
  const convHtml = `<section class="rv-conv-last" aria-labelledby="rv-conv-h">
      <h2 class="rv-conv-h" id="rv-conv-h">Conversation <span class="cg-num">${conversation.length}</span></h2>
      ${
        last
          ? `<p class="rv-conv-line">${avatar(last.user, 20)}<span><strong>${esc(last.user?.login ?? 'someone')}</strong> ${esc(kindLabel[last.kind] ?? last.kind.toLowerCase())}${last.at ? `, ${esc(relativeTime(last.at))}` : ''}${quote ? `: <span class="rv-conv-quote">${esc(excerpt(quote))}</span>` : '.'}</span></p>`
          : '<p class="cg-muted rv-conv-line">No reviews or comments yet.</p>'
      }
      <a class="rv-conv-gh" href="${esc(pull.html_url)}" target="_blank" rel="noopener">Reply on GitHub</a>
    </section>`;

  const fileList = `<ul class="rv-files">${files
    .slice(0, 40)
    .map((f) => `<li><span class="mono">${esc(f.filename)}</span><span class="rv-delta"><span class="is-add">+${f.additions}</span> <span class="is-del">-${f.deletions}</span></span></li>`)
    .join('')}</ul>${files.length > 40 ? `<p class="cg-muted">${files.length - 40} more on <a href="${esc(pull.html_url)}/files">GitHub</a>.</p>` : ''}`;
  const filesBody = `<p class="cg-muted">Branch <span class="mono">${esc(pull.head.ref)}</span> into <span class="mono">${esc(pull.base.ref)}</span>.</p>${fileList}`;

  const failing = ci.failed.length;
  const checksMeta = ci.total === 0 ? 'none yet' : failing ? `${failing} failing` : ci.pending.length ? `${ci.pending.length} running` : `all ${ci.total} pass`;
  // Each failing check with its kind (design rule or developer), the step that failed and the failing test cases.
  const KIND_LABEL = { design: 'design rule', developer: 'developer check' } as const;
  const failedRows = x.checks.map((c) => {
    const what = [KIND_LABEL[c.kind], c.step ? `failed at ${c.step}` : ''].filter(Boolean).join(', ');
    const cases = c.cases.length
      ? `<ul class="rv-cases">${c.cases
          .slice(0, 4)
          .map((t) => `<li><span class="mono">${esc(t.title)}</span><span class="cg-muted">${esc(t.message)}</span></li>`)
          .join('')}${c.cases.length > 4 ? `<li class="cg-muted">${c.cases.length - 4} more in the run.</li>` : ''}</ul>`
      : '';
    return `<li class="is-fail"><span class="rv-check" aria-hidden="true"></span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}<span class="cg-muted">${esc(what)}</span>${cases}</li>`;
  });
  const pendingRows = ci.pending.map((c) => `<li class="is-pending"><span class="rv-check" aria-hidden="true"></span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}<span class="cg-muted">running</span></li>`);
  const checksBody = ci.total
    ? `${failingRun ? `<p class="cg-links"><a class="btn btn-secondary btn-sm" href="${esc(failingRun)}" target="_blank" rel="noopener">Open failing test</a></p>` : ''}<ul class="rv-checks">${[...failedRows, ...pendingRows].join('')}<li class="is-pass"><span class="rv-check" aria-hidden="true"></span>${plural(ci.passed, 'check')} passing</li></ul>`
    : '<p class="cg-muted">No checks reported for the head commit yet.</p>';

  // Real URLs (the Vercel comment and statuses, never a template Vercel shortened) and the install command the
  // Preview packages workflow published for the head commit, never a guessed one.
  const entry = pullEntry(pull as never, BRANCHES, { comments, statuses: x.statuses });
  const previewLinks = entry.previews.map((p) => `<a class="btn btn-secondary btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.label)}</a>`).join('');
  const pending = entry.pendingPreviews.length ? `<p class="cg-muted">${esc(entry.pendingPreviews.join(' and '))}: link not reported by Vercel yet. Its comment on <a href="${esc(pull.html_url)}" target="_blank" rel="noopener">the pull request</a> has it once the deploy starts.</p>` : '';
  const install =
    entry.installState === 'ready' && entry.install
      ? `<div class="cg-install"><button type="button" class="btn btn-secondary btn-sm" data-copy-from="cg-install-cmd" data-copy><span data-copy-label>Copy install command</span></button>
        <details class="cg-more"><summary>Show the command</summary><code class="cg-cmd" id="cg-install-cmd">${esc(entry.install)}</code></details></div>`
      : entry.installState === 'failed'
        ? '<p class="cg-muted">The test build did not finish for the latest commit. The Preview packages run on the pull request says why.</p>'
        : entry.installState === 'building'
          ? '<p class="cg-muted">The test build of the latest commit is being prepared. The install command appears here when the Preview packages workflow posts it.</p>'
          : '';
  const previewBody = previewLinks || pending || install ? `${previewLinks ? `<p class="cg-links">${previewLinks}</p>` : ''}${pending}${install}` : `<p class="cg-muted">${entry.fromFork ? 'Pull request from a fork: no preview deploys or snapshots.' : 'No preview deploys configured for this repository.'}</p>`;
  const previewMeta = entry.previews.length ? entry.previews.map((p) => p.label).join(', ') : entry.install ? 'install only' : entry.pendingPreviews.length ? 'waiting for Vercel' : 'none';

  const reviewForm = `<div data-needs-token class="cg-act-review">
      <details class="cg-more"><summary>Write a review</summary>
        <label class="rv-label" for="rv-body">Comment</label>
        <textarea id="rv-body" rows="4" placeholder="Say what to change and why. Required for Request changes."></textarea>
        <div class="rv-btns">
          ${rowAction ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-act="APPROVE">Approve</button>'}
          <button type="button" class="btn btn-secondary btn-sm" data-act="REQUEST_CHANGES">Request changes</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="COMMENT">Comment</button>
        </div>
      </details>
    </div>
    <p data-no-token class="cg-muted">Read only until connected. Or <a href="${esc(pull.html_url)}/files#submit-review" target="_blank" rel="noopener">review on GitHub</a>.</p>`;
  // Ship sits at the end of the bar; the owner override and Close wait in More (rare, and Close is destructive). When
  // the owner override is how this change ships (the header's primary), a disabled Ship next to it only competes.
  const overridePath = primary === 'override' && !gate.allowed;
  const hasMore = write && (open || lifecycle === 'draft');
  const shipBits = write
    ? `<div class="cg-act-end">
        ${hasMore ? '<span class="rv-more" id="rv-more"></span>' : ''}
        ${headerShip || !open || overridePath ? '' : `<button type="button" class="btn btn-secondary" data-act="MERGE" ${gate.allowed ? '' : 'disabled aria-describedby="rv-merge-why"'}>Ship</button>`}
      </div>`
    : access
      ? `<p class="cg-muted">@${esc(access.login)} cannot write to ${esc(repo.owner)}/${esc(repo.repo)}, so ship and close are off.</p>`
      : '';
  // Ship unlocks once..., in plain words: the header already says what fails and who acts.
  const unlocks = shipWhen({
    draft: pull.draft,
    ciFail: ci.state === 'fail',
    ciPending: ci.state === 'pending',
    changesRequested: approvals.changesRequested.length > 0,
    missingApprovals: gate.missing.length,
    conflict: pull.mergeable === false,
  });
  const notShipper = gate.canShip ? [] : gate.reasons.filter((r) => /ship/i.test(r));
  const whyText = [unlocks ?? '', ...notShipper].filter(Boolean).join(' ');
  const quietWhy = status.lifecycle === 'draft' || status.lifecycle === 'waiting';
  const why = gate.allowed || overridePath || lifecycle === 'merged' || lifecycle === 'closed' || quietWhy || !whyText ? '' : `<p class="cg-muted" id="rv-merge-why">${esc(whyText)}</p>`;

  // What it looks like: the biggest before/after first (filled by openPr), then the token diff as the "what changed"
  // of a token-only change. The full visual list stays one click away.
  // What changes on screen, right under the reasons and actions: the biggest before/after, then the token diff. The
  // full visual list stays one click away.
  // "Try it in the product": the change's admin preview as GitHub reports it, with the Bridge toolbar on. The block's
  // lead action; primary only when the header holds no primary already (one primary per view).
  // Only while the change is open: a shipped or closed change has nothing left to compare.
  const product = x.visual && (open || lifecycle === 'draft') ? productPreview(BRANCHES.apps, { branch: pull.head.ref, pr: pull.number, sha: pull.head.sha, fromFork: entry.fromFork }, { comments, statuses: x.statuses }) : null;
  // Secondary (the header holds the view's primary), above the checklist so it is seen without scrolling, with what
  // it opens as its sub-label.
  // "Share with a product team" (lib/share-change), on the same line: the preview install command for a developer.
  const share = canShare({ fromFork: entry.fromFork, packages: BRANCHES.packages }) && showShare(lifecycle, shareFor(pull, files, comments)) ? '<span class="rv-share" id="rv-share"></span>' : '';
  const tryLink = product
    ? `<a class="btn btn-secondary btn-lg rv-try" id="rv-try" href="${esc(tryInProductUrl(product, pull.number, null))}" data-preview="${esc(product)}" target="_blank" rel="noopener" aria-describedby="rv-try-hint">Try it in the product<span class="sr-only"> (opens in a new tab)</span></a>`
    : '';
  const tryIt =
    tryLink || share
      ? `<div class="rv-try-block">${tryLink}${share}${tryLink ? '<p class="rv-try-hint" id="rv-try-hint"><span data-try-what>Opens the demo admin with this change.</span><span class="rv-try-key"> Press B there to flip.</span></p>' : ''}</div>`
      : '';
  const what = x.visual
    ? `<div class="rv-what-visual"><h2 class="rv-what-sub">What changes on screen</h2><div id="rv-what-visual"><p class="rv-loading">Reading the before and after</p></div></div>`
    : '<p class="cg-line rv-what-quiet">No visual change.</p>';
  const tokenBody =
    x.review instanceof Error ? `<p class="rv-error">Could not compute the token diff: ${esc(x.review.message)}. Reload the page to try again.</p>` : x.review ? renderTokenReview(x.review) : '';
  // Continue a change: the author or a writer adds more token edits to it from the token editor (lib/continue-change).
  const editable = x.tokenCount > 0 && isTokenChange(pull, REPO_KEY) && canAddTo(pull, access?.login, write);
  const tokens = x.tokenCount
    ? `<div class="rv-what-tokens"><div class="rv-tokens-head"><h3 class="rv-what-sub">Token changes</h3>${editable ? `<span class="rv-edit-in" id="rv-edit-in-change" data-change="${pull.number}"></span>` : ''}</div><div id="rv-tokens">${tokenBody}</div></div>`
    : '';

  const devMeta = [plural(files.length, 'file'), ci.total === 0 ? 'no checks yet' : failing ? `${failing} failing ${failing === 1 ? 'check' : 'checks'}` : ci.pending.length ? 'checks running' : 'checks pass'].join(', ');
  // What approval it needs, in plain words and no color. An exploration is tried, never shipped as is.
  const need = isActiveExploration(pull.labels) ? 'Exploration' : approvalNeedLabel(tier);

  const added = Number(new URLSearchParams(location.search).get('added'));
  return `
  <nav class="cg-crumbs" aria-label="Breadcrumb"><a href="./" data-back>Changes</a></nav>
  ${added > 0 ? `<div class="cg-added" id="rv-added" data-text="${esc(addedNotice(added))}"></div>` : ''}
  <header class="zone cg-pr-open">
    <div class="cg-pr-status" id="rv-status">${statusFallback(status)}</div>
    <h1 class="cg-pr-title">${esc(humanTitle(mdTitleText(pull.title)))}</h1>
    <p class="cg-pr-meta">${avatar(pull.user, 20)}<span>${esc(pull.user.login)}</span>${need ? `<span class="cg-need">${esc(need)}</span>` : ''}</p>
    ${tryIt}
    ${status.lifecycle === 'shipped' || status.lifecycle === 'closed' ? '' : needsHtml({ story, rows, rowText: status.lifecycle === 'draft' ? DRAFT_ROWS : status.lifecycle === 'waiting' ? {} : (help?.rowText ?? {}), why: primary === 'override' || status.lifecycle === 'waiting' ? null : (help?.why ?? (showOverride ? OVERRIDE_RULE : null)), ask: status.lifecycle === 'waiting' ? null : ask, override: showOverride, primary, library: libraryRow })}
    ${headerCta ? `<p class="cg-pr-cta">${headerCta}</p>` : ''}
  </header>
  <section class="rv-what" aria-label="What changed">${what}${tokens}</section>
  <div class="cg-secs">
    ${x.visual ? section('cg-sec-visual', 'All visual changes', 'Reading', `<div id="rv-visual"><p class="rv-loading">Reading the visual impact for ${esc(pull.head.sha.slice(0, 7))}</p></div>`) : ''}
    ${x.docsPaths.length ? section('cg-sec-docs', 'Docs', 'Reading', renderDocsSection(x.docsPaths)) : ''}
    ${convHtml}
    <details class="cg-sec cg-dev" id="cg-sec-dev"><summary class="cg-sec-head"><span class="cg-sec-title">For developers</span><span class="cg-sec-meta">${esc(devMeta)}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
      <div class="cg-sec-body cg-dev-body">
        <p class="cg-links rv-dev-links"><a href="${esc(pull.html_url)}" target="_blank" rel="noopener">Open on GitHub</a>${x.fresh.state === 'conflict' ? `<a href="${esc(pull.html_url)}/conflicts" target="_blank" rel="noopener">Resolve the conflict on GitHub</a>` : ''}<a href="/how-review-works/">How review works</a></p>
        ${section('cg-sec-files', 'Files', String(files.length), filesBody)}
        ${section('cg-sec-checks', 'Checks', checksMeta, checksBody, failing > 0)}
        ${section('cg-sec-changeset', 'Changeset', x.changesetCount ? 'Reading' : 'missing', `<div id="rv-changeset">${x.changesetCount ? '<p class="rv-loading">Reading changeset</p>' : '<p class="cg-muted">No changeset in this pull request. CI asks for one when a package changes.</p>'}</div>`)}
        ${section('cg-sec-preview', 'Preview and install', previewMeta, previewBody)}
      </div>
    </details>
  </div>
  <footer class="cg-actbar" id="rv-actions" aria-label="Review actions">
    ${why}
    <div class="cg-actbar-row">${(status.lifecycle === 'draft' && isAuthor) || status.lifecycle === 'shipped' || status.lifecycle === 'closed' ? '' : reviewForm}${shipBits}</div>
    <p class="rv-act-status" id="rv-act-status" role="status" aria-live="polite"></p>
  </footer>
  ${showOverride ? overrideDialog(pull, gate, access!) : ''}`;
}

function overrideDialog(pull: Pull, gate: ReturnType<typeof mergeGate>, access: Access) {
  const min = OVERRIDE.requireReason ? OVERRIDE.minReasonLength : 0;
  return `<dialog class="gh-dialog rv-ov-dialog" id="rv-ov" role="alertdialog" aria-modal="true" aria-labelledby="rv-ov-title" aria-describedby="rv-ov-desc">
    <form method="dialog" class="gh-dialog-box" novalidate>
      <header class="gh-dialog-head"><h2 id="rv-ov-title">Ship #${pull.number} as owner override?</h2></header>
      <div id="rv-ov-desc">
        <p>This ships the change into the library (<span class="mono">${esc(pull.base.ref)}</span>) without:</p>
        <ul class="rv-ov-missing">${gate.missing.map((m) => `<li>${esc(m[0]!.toUpperCase() + m.slice(1))}</li>`).join('')}</ul>
        <p>Tests pass and nobody requested changes. Bridge posts your reason on the change as <strong>Bridge owner override</strong>, then ships it, so History and the timeline show who skipped the approvals and why.</p>
      </div>
      <label class="gh-field" for="rv-ov-reason">
        <span>Reason${OVERRIDE.requireReason ? '' : ' (optional)'}</span>
        <textarea id="rv-ov-reason" rows="3" ${min ? `minlength="${min}" required aria-required="true"` : ''} aria-describedby="rv-ov-count" placeholder="Solo maintainer, CI green, I reviewed the token diff and contrast."></textarea>
      </label>
      <p class="small muted" id="rv-ov-count">${min ? `At least ${min} characters.` : 'Shown on the pull request.'}</p>
      ${
        access.methods.length > 1
          ? `<label class="gh-field" for="rv-ov-method"><span>Merge method</span><select id="rv-ov-method">${access.methods.map((m) => `<option value="${m}">${METHOD_LABEL[m]}</option>`).join('')}</select></label>`
          : `<input type="hidden" id="rv-ov-method" value="${access.methods[0] ?? 'squash'}" />`
      }
      <p class="gh-error" id="rv-ov-error" role="alert" hidden></p>
      <footer class="gh-dialog-foot">
        <span class="gh-spacer"></span>
        <button type="submit" value="cancel" class="btn btn-secondary btn-sm" autofocus>Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="rv-ov-go">Post reason and ship</button>
      </footer>
    </form>
  </dialog>`;
}

function syncAuthViews() {
  const has = Boolean(hasWorkingToken() && currentViewer());
  document.querySelectorAll<HTMLElement>('[data-needs-token]').forEach((el) => (el.hidden = !has));
  document.querySelectorAll<HTMLElement>('[data-no-token]').forEach((el) => (el.hidden = has));
}

/** Wires the override dialog and returns how to open it (the More menu item), or null when there is none. */
function wireOverride(pull: Pull, access: Access, gate: ReturnType<typeof mergeGate>): (() => void) | null {
  const dialog = document.getElementById('rv-ov') as HTMLDialogElement | null;
  if (!dialog) return null;
  const reason = $<HTMLTextAreaElement>('rv-ov-reason');
  const count = $('rv-ov-count');
  const error = $('rv-ov-error');
  const go = $<HTMLButtonElement>('rv-ov-go');
  const method = () => (document.getElementById('rv-ov-method') as HTMLSelectElement | HTMLInputElement).value as MergeMethod;
  const min = OVERRIDE.requireReason ? OVERRIDE.minReasonLength : 0;
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  const openDialog = () => {
    error.hidden = true;
    dialog.showModal();
  };
  reason.addEventListener('input', () => {
    const n = reason.value.trim().length;
    count.textContent = min ? (n >= min ? `${n} characters.` : `${n} of at least ${min} characters.`) : 'Shown on the pull request.';
    reason.removeAttribute('aria-invalid');
    error.hidden = true;
  });
  go.addEventListener('click', async () => {
    const problem = overrideReasonProblem(reason.value, OVERRIDE);
    if (problem) {
      reason.setAttribute('aria-invalid', 'true');
      fail(problem);
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
      showGhError(error, err, `GitHub did not take the comment, so nothing was merged: ${(err as Error).message}`, 'comment on pull requests');
      error.hidden = false;
      go.disabled = false;
      go.textContent = 'Post reason and ship';
      return;
    }
    go.textContent = 'Shipping';
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
      showGhError(error, err, `GitHub refused the merge: ${msg}. Your reason stays on the pull request, marked not merged. Branch protection may need an approving review or an admin bypass.`, 'merge pull requests');
      error.hidden = false;
      go.disabled = false;
      go.textContent = 'Post reason and ship';
      return;
    }
    dialog.close();
    await openPr(pull.number, false);
    const done = document.getElementById('rv-act-status');
    if (done) done.textContent = `Shipped as owner override. The reason is on #${pull.number}.`;
  });
  return openDialog;
}

/** The More menu of the open change (DS Menu, a React root): unmounted before the detail repaints. */
let moreMenu: Root | null = null;
function unmountMore() {
  moreMenu?.unmount();
  moreMenu = null;
}

/** The Latest library action (DS Button and resolver dialog): unmounted before the detail repaints. */
function unmountLib() {
  libRoot?.unmount();
  libRoot = null;
}

/** "Share with a product team" (DS Button and Dialog): unmounted before the detail repaints. */
let shareRoot: Root | null = null;
function unmountShare() {
  shareRoot?.unmount();
  shareRoot = null;
}

/** The owner override in one sentence: what it skips, what it never skips, and the trace it leaves. */
const OVERRIDE_RULE = 'Owners can ship without the missing approvals once tests pass, with a reason posted on the change.';

function wireActions(pull: Pull, gate: ReturnType<typeof mergeGate>, access: Access | null) {
  syncAuthViews();
  const openOverride = access && gate.overridable && access.write ? wireOverride(pull, access, gate) : null;
  const status = $('rv-act-status');
  const body = document.getElementById('rv-body') as HTMLTextAreaElement | null;

  /** One action, from a button or the More menu. Returns false when nothing was sent (so a button stays enabled). */
  async function run(act: string, b?: HTMLButtonElement) {
    const text = body?.value.trim() ?? '';
    if (act === 'REQUEST_CHANGES' && !text) {
      status.textContent = 'Add a comment that says what to change.';
      body?.focus();
      return;
    }
    if (act === 'COMMENT' && !text) {
      status.textContent = 'Write a comment first.';
      body?.focus();
      return;
    }
    if (act === 'MERGE' && !gate.allowed) return;
    if (act === 'CLOSE' && !window.confirm(`Close change #${pull.number} without shipping it?`)) return;
    if (act === 'MERGE' && !window.confirm(`Ship change #${pull.number} into the library? It goes out with the next release.`)) return;
    if (b) b.disabled = true;
    status.textContent = 'Sending to GitHub';
    try {
      if (act === 'APPROVE' || act === 'REQUEST_CHANGES' || act === 'COMMENT') {
        await ghWrite('POST', `${R}/pulls/${pull.number}/reviews`, { event: act, body: text || undefined, commit_id: pull.head.sha });
      } else if (act === 'MERGE') {
        await ghWrite('PUT', `${R}/pulls/${pull.number}/merge`, { merge_method: 'squash', sha: pull.head.sha });
      } else if (act === 'CLOSE') {
        await ghWrite('PATCH', `${R}/pulls/${pull.number}`, { state: 'closed' });
      }
      status.textContent = { APPROVE: 'Approved.', REQUEST_CHANGES: 'Changes requested.', COMMENT: 'Comment posted.', MERGE: 'Shipped.', CLOSE: 'Closed.' }[act] ?? 'Done.';
      if (body) body.value = '';
      await openPr(pull.number, false);
    } catch (err) {
      const verb = act === 'MERGE' ? 'merge pull requests' : act === 'CLOSE' ? 'close pull requests' : 'review pull requests';
      showGhError(status, err, `GitHub refused: ${(err as Error).message}`, verb);
      if (b) b.disabled = false;
    }
  }

  document.querySelectorAll<HTMLButtonElement>('#rv-detail [data-act]').forEach((b) => b.addEventListener('click', () => void run(b.dataset.act!, b)));
  // The owner override sits on the approvals it skips (the checklist footer), not in More.
  document.querySelector<HTMLButtonElement>('#rv-detail [data-open-override]')?.addEventListener('click', () => openOverride?.());
  // Ask for review copies a ready message (shell.ts copies data-copy); say what was copied and where it goes.
  document.querySelector<HTMLButtonElement>('#rv-detail [data-ask-review]')?.addEventListener('click', () => {
    const said = document.getElementById('rv-ap-said');
    if (said) said.textContent = navigator.clipboard ? 'Review request copied. Paste it where your team talks, with the link to this change.' : 'Copy is not available in this browser. Share the link to this page instead.';
  });

  const slot = document.getElementById('rv-more');
  if (slot) {
    const seq = openSeq;
    void import('../components/ds/studio/PrMoreMenu').then(({ mountPrMoreMenu }) => {
      // The detail moved on (another change, back to the list) while the menu loaded.
      if (seq !== openSeq || !slot.isConnected) return;
      unmountMore();
      const author = Boolean(access && access.login.toLowerCase() === pull.user.login.toLowerCase());
      moreMenu = mountPrMoreMenu(slot, {
        override: null,
        // The author takes a change in review back to draft (an exploration has its own flow).
        onDraft:
          author && pullState(pull) === 'open' && !isActiveExploration(pull.labels)
            ? () => void backToDraft(pull.number, () => openPr(pull.number, false)).catch((err) => showGhError(status, err, `GitHub refused: ${(err as Error).message}`, 'write pull requests'))
            : null,
        onClose: () => void run('CLOSE'),
      });
    });
  }
}

/**
 * "Share with a product team": the preview install command the Preview packages workflow posted for the latest
 * update (its sticky comment), or why there is none yet (lib/share-change). Read on the data the detail already has.
 */
function shareFor(pull: Pull, files: PrFile[], comments: Comment[]): ShareState {
  return shareState({ lifecycle: pullState(pull), files: files.map((f) => f.filename), packages: BRANCHES.packages, comment: findPreviewComment(comments)?.body, headSha: pull.head.sha });
}

function wireShare(pull: Pull, files: PrFile[], comments: Comment[], seq: number) {
  const slot = document.getElementById('rv-share');
  if (!slot) return;
  const state = shareFor(pull, files, comments);
  void import('../components/ds/studio/ShareChange').then(({ mountShareChange }) => {
    if (seq !== openSeq || !slot.isConnected) return;
    unmountShare();
    shareRoot = mountShareChange(slot, {
      title: humanTitle(mdTitleText(pull.title)),
      state,
      packages: BRANCHES.packages,
      url: pull.html_url,
      // The link as "Try it in the product" points now (at the screen that changes most once the visual impact says).
      tryUrl: () => (document.getElementById('rv-try') as HTMLAnchorElement | null)?.href ?? null,
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Latest library: behind and conflicts (lib/library-sync, scripts/reviews/library-sync)

let libRoot: Root | null = null;
/** The change that just brought the library in, and what to say on its row. */
let justIn: { pr: number; said: string } | null = null;

/**
 * The Latest library row of the checklist: behind (an empty circle, it does not block) or in conflict (a cross, it
 * blocks shipping). The sentence first, then a hint line filled by wireLibrary (what happens next), and the action
 * slot. Nothing when the change is up to date, finished, or the compare could not be read.
 */
function libraryRowHtml(f: Freshness, primary: boolean, pr: number): string {
  // Right after bringing the library in, the row stays, checked, where the designer pressed the button.
  if (f.state === 'current' && justIn?.pr === pr) return `<li class="rv-ap-row rv-lib" id="rv-lib" data-state="approved">${ROW_ICON.approved}<span class="rv-ap-role">Latest library</span><span class="rv-ap-text"><span class="sr-only">Up to date: </span>${esc(justIn.said)}</span></li>`;
  if (f.state !== 'behind' && f.state !== 'conflict') return '';
  const conflict = f.state === 'conflict';
  const text = conflict ? conflictLine({ kind: 'tokens', files: [] }, null) : (libraryLine(f) ?? '');
  const hint = conflict ? (libraryLine(f) ?? '') : '';
  return `<li class="rv-ap-row rv-lib" id="rv-lib" data-state="${conflict ? 'changes' : 'waiting'}"${primary ? ' data-primary' : ''}>${conflict ? ROW_ICON.changes : ROW_ICON.waiting}<span class="rv-ap-role">Latest library</span><span class="rv-ap-text"><span class="sr-only">${conflict ? 'Conflict' : 'Behind'}: </span><span id="rv-lib-text">${esc(text)}</span><span class="rv-lib-hint" id="rv-lib-hint" aria-live="polite">${esc(hint)}</span></span><span class="rv-ap-act rv-lib-act" id="rv-lib-act"></span></li>`;
}

/** After a write: wait for GitHub's new head, then repaint the change (checks, approvals and the before and after). */
async function refreshAfterLibrary(pull: Pull, said: string) {
  const fresh = await waitForNewHead(repo.owner, repo.repo, pull.number, pull.head.sha);
  justIn = { pr: pull.number, said: fresh ? said : `${said} It can take a minute: reload if the checks have not restarted.` };
  await openPr(pull.number, false);
}

/**
 * Fills the Latest library row: what happens next (checks, approvals, from the branch rules), then the action. Behind
 * with no conflict: GitHub's update-branch. A conflict: what both sides touched decides who resolves it; a pure
 * token-file conflict opens the resolver, anything in code stays with a developer (GitHub link in For developers).
 */
function wireLibrary(x: { pull: Pull; fresh: Freshness; compare: CompareLike | null; access: Access | null; checks: number; visual: boolean; approvals: number; seq: number }) {
  const row = document.getElementById('rv-lib');
  const slot = document.getElementById('rv-lib-act');
  const textEl = document.getElementById('rv-lib-text');
  const hintEl = document.getElementById('rv-lib-hint');
  if (!row || !slot || !textEl || !hintEl) return;
  const { pull } = x;
  const primary = row.hasAttribute('data-primary');
  const sameRepo = !pull.head.repo?.full_name || pull.head.repo.full_name === `${repo.owner}/${repo.repo}`;
  const canAct = Boolean(x.access?.write) && sameRepo;
  const cannot = !x.access ? `${ghAction('bring it in', prefersSignIn())}.` : !sameRepo ? 'It comes from a fork: its author brings the library in.' : `@${x.access.login} cannot write to this change, so someone with write access brings it in.`;
  const mount = (props: Parameters<typeof import('../components/ds/studio/LibraryCatchUp').mountLibraryCatchUp>[1]) =>
    void import('../components/ds/studio/LibraryCatchUp').then(({ mountLibraryCatchUp }) => {
      if (x.seq !== openSeq || !slot.isConnected) return;
      libRoot?.unmount();
      libRoot = mountLibraryCatchUp(slot, props);
    });
  const next = readDismissStale(repo.owner, repo.repo, pull.base.ref).then((dismissStale) => nextSteps({ checks: x.checks, visual: x.visual, approvals: x.approvals, dismissStale }));

  if (x.fresh.state === 'behind') {
    void next.then((n) => {
      if (x.seq === openSeq) hintEl.textContent = canAct ? n : `${n} ${cannot}`;
    });
    if (!canAct) return;
    mount({
      label: 'Bring in the latest library',
      primary,
      onUpdate: async () => {
        hintEl.textContent = 'Bringing in the latest library.';
        try {
          await bringInLatest(repo.owner, repo.repo, pull);
        } catch (err) {
          const msg = (err as Error).message;
          if (/conflict/i.test(msg)) hintEl.textContent = 'GitHub could not combine them: they changed the same lines. Reload the page to resolve the conflicts here.';
          else showGhError(hintEl, err, `GitHub did not bring the library in: ${msg.replace(/[.\s]+$/, '')}. Reload the page and try again.`, 'update pull requests');
          return;
        }
        await refreshAfterLibrary(pull, `Up to date with the latest library. ${await next}`);
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
            throw new Error(/fast.forward|Update is not a fast/i.test(msg) ? 'The change moved while you were choosing. Close this, reload the page and resolve again.' : `GitHub refused it: ${msg}. Reload the page and try again.`);
          }
          void refreshAfterLibrary(pull, `Conflicts resolved, up to date with the latest library. ${nextText}`);
        },
      },
    });
  })();
}

// ---------------------------------------------------------------------------------------------------------------
// Token diff rendering

const swatch = (hex?: string | null) => (hex ? `<span class="rv-sw" style="background-color:${esc(hex)}"></span>` : '');

function valueCell(v: { css?: string | null; hex?: string | null; alias?: string | null } | null) {
  if (!v) return '<span class="muted">none</span>';
  return `<span class="rv-val">${swatch(v.hex)}<span class="mono">${esc(v.alias ? `{${v.alias}}` : (v.css ?? ''))}</span>${v.alias && v.css ? `<span class="muted mono small">${esc(v.css)}</span>` : ''}</span>`;
}

export function renderTokenReview(review: TokenReview): string {
  if (!review.changes.length) return '<p class="muted">The token files changed, but no token value did (formatting or descriptions only).</p>';
  const rows = review.changes
    .map(
      (c) => `<tr>
        <th scope="row"><span class="mono">${esc(c.path)}</span><span class="rv-kind-tag is-${c.kind}">${c.kind}</span>${c.context ? `<span class="muted small">${esc(c.context)}</span>` : ''}</th>
        <td>${valueCell(c.before)}</td>
        <td><span class="rv-arrow" aria-label="becomes">-></span></td>
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
          <td class="num"><strong>${p.after.toFixed(2)}:1</strong> ${p.after < p.min ? '<span class="pill is-fail">Fails</span>' : p.after >= p.before ? '' : '<span class="pill is-warn">Lower</span>'}</td>
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
  unmountMore();
  unmountStatus();
  unmountLib();
  unmountShare();
  current = null;
  detailEl().hidden = true;
  detailEl().innerHTML = '';
  notice().hidden = true;
}

/** Repaint an open pull request when the viewer changes: the gate depends on who is connected. */
export function initReviewAuth() {
  let lastLogin: string | null | undefined;
  initGitHubConnect((v) => {
    syncAuthViews();
    const login = v?.login ?? null;
    const n = Number(new URLSearchParams(location.search).get('pr'));
    if (n && login !== (lastLogin ?? null)) void openPr(n, false);
    lastLogin = login;
  });
}

export const _current = () => current;
