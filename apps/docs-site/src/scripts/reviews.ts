// Changes > In review and the pull request detail: open pull requests of the configured repo, read client-side
// from the GitHub REST API, most urgent first, with a designer-friendly token diff and governance-aware actions.
// Without a token every action deep-links to GitHub. When GitHub cannot be read, the last list this browser saw
// stays on screen, labelled with its time (lib/changes.ts).
import { classifyRisk, isActiveExploration, type Rights } from '@bridge-ds/core';
import { isRunningExploration, tierSlot } from '../lib/explorations-view';
import {
  allowedMergeMethods,
  canWrite,
  approverLists,
  mergeGate,
  NO_OVERRIDE,
  openPulls,
  OVERRIDE_HEADING,
  overrideComment,
  overrideReasonProblem,
  overrideRefusedComment,
  parseChangeset,
  parseOverrideComment,
  parseTier,
  pullState,
  shipPolicy,
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
  filterByTier,
  listSource,
  needFromDetail,
  openerFor,
  readSnapshot,
  tierLabel,
  tierParam,
  whoActs,
  writeSnapshot,
  type ApprovalRow,
  type CachedPull,
  type People,
  type WhoActs,
} from '../lib/changes';
import { iconSvg } from '../brand/icons';
import { orphanBranches, branchEntry, pullEntry, type BranchEntry, type BranchesConfig } from '../lib/branches';
import { currentViewer, esc, ghGet, ghWrite, hasWorkingToken, initGitHubConnect, RateLimitError, readRepo, relativeTime, showGhError } from './github-session';
import { analyzeTokenFiles, isTokenFile, type TokenReview } from './reviews/token-review';
import { loadVisualImpact, renderTopChange } from './reviews/visual-impact';
import { ciFor, loadStatuses, whoChip, type PullStatus } from './pr-status';
import { mdTitleHtml, mdTitleText } from '../lib/markdown';
import { humanTitle } from '../lib/pr-title';
import { touchesVisuals } from '../lib/visual-impact';
import { isDocsFile } from '../lib/pr-docs';
import { loadDocsSection, renderDocsSection } from './reviews/docs-section';

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
// Approvals count against who holds each right (governance.rights), shipping against the ship right.
const OWNERS = approverLists(SITE.owners ?? { design: [], tech: [] }, SITE.rights);
const SHIP = shipPolicy(SITE.owners ?? { design: [], tech: [] }, SITE.rights);
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

const tierTag = (t: Tier | null) => `<span class="pill cg-tier">${tierLabel(t)}</span>`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** People around a pull request, for the who-acts line (lib/changes whoActs). */
function people(author: string, extra: Partial<People> = {}): People {
  return { owners: OWNERS, author, viewer: currentViewer()?.login ?? null, overrideBy: OVERRIDE.allowed, shippers: SHIP?.logins, ...extra };
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
  /** From the status read: who approved, who asked for changes, how many checks fail. */
  approvers?: string[];
  changesRequested?: string[];
  failing?: number;
}

function rowHtml(r: Row) {
  const title = humanTitle(mdTitleText(r.title));
  return `<li class="cg-row" data-pr="${r.number}"><a class="cg-row-link" href="?pr=${r.number}" data-open-pr="${r.number}">
    <span class="cg-row-title"><span class="cg-row-name" title="${esc(title)}">${esc(title)}</span> <span class="cg-num">#${r.number}</span></span>
    ${tierTag(r.tier)}
    ${chip(r)}
    <time class="cg-date" datetime="${esc(r.updated_at)}">${esc(shortDate(r.updated_at))}</time></a></li>`;
}

function paintRows(rows: Row[], loading: boolean) {
  const list = $('rv-list');
  const tier = tierParam(location.search);
  const sorted = filterByTier(byUrgency(rows), tier);
  list.innerHTML = sorted.length ? sorted.map(rowHtml).join('') : `<li class="cg-row cg-none">No open pull request at ${esc(tierLabel(tier))}.</li>`;
  const filter = document.getElementById('cg-tier-filter');
  if (filter) {
    filter.hidden = !tier;
    const label = filter.querySelector('[data-tier-label]');
    if (label) label.textContent = tierLabel(tier);
  }
  const count = $('rv-count');
  count.textContent = String(rows.length);
  count.hidden = rows.length === 0;
  const opener = openerFor(rows);
  const sentence = $('cg-open-sentence');
  const cta = document.getElementById('cg-open-cta') as HTMLAnchorElement | null;
  sentence.textContent = loading ? `${plural(rows.length, 'change')} open. Checking their checks and approvals.` : opener.sentence;
  if (cta && opener.action) {
    cta.href = `?pr=${opener.action.pr}`;
    cta.dataset.openPr = String(opener.action.pr);
    cta.textContent = opener.action.label;
    cta.hidden = false;
  }
}

function showEmpty(empty: boolean) {
  $('cg-opener').hidden = empty;
  $('cg-table').hidden = empty;
  $('cg-empty').hidden = !empty;
}

function paintAsOf(at: string | null) {
  const el = $('cg-asof');
  el.hidden = !at;
  if (at) el.textContent = `Showing the list ${asOf(at)}: GitHub cannot be read right now. Connect GitHub for live status.`;
}

const toRow = (p: Pull | CachedPull, kind: ReviewStatusKind | null): Row => ({
  number: p.number,
  title: p.title,
  updated_at: p.updated_at,
  tier: 'labels' in p ? parseTier(p.labels, p.body) : p.tier,
  kind,
  skipped: false,
  head: { ref: p.head.ref, sha: p.head.sha },
  user: { login: p.user.login },
  draft: p.draft,
});

/** Loads and paints the In review list. Returns every open pull request (running explorations included, which the list leaves out). */
export async function loadList(): Promise<{ number: number; head: { ref: string } }[]> {
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
    // Running explorations live in the Explorations view: never merged as is, so they are not waiting for review.
    live = { pulls: allOpen.filter((p) => !isRunningExploration(p)), staleAt: f.stale ? (f.cachedAt ?? new Date(0).toISOString()) : null };
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
        ? 'GitHub limits anonymous reads to 60 an hour and this browser has used them, with no saved list yet. Connect GitHub, or try again later.'
        : `Could not load pull requests: ${(failure as Error | null)?.message ?? 'GitHub did not answer'}.`;
    return [];
  }

  if (src.kind === 'cached') {
    const rows = src.pulls.map((p) => ({ ...toRow(p, p.kind), skipped: !p.kind }));
    showEmpty(rows.length === 0);
    paintRows(rows, false);
    paintAsOf(src.at);
    void loadOtherBranches(src.pulls);
    return src.pulls;
  }

  const pulls = src.pulls;
  paintAsOf(src.kind === 'stale' ? src.at : null);
  showEmpty(pulls.length === 0);
  if (!pulls.length) {
    $('rv-count').hidden = true;
    writeSnapshot(storage(), REPO_KEY, [], new Date());
    void loadOtherBranches(allOpen);
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
    if (st && st.kind !== 'unknown') Object.assign(r, { approvers: st.approvers, changesRequested: st.changesRequested, failing: st.failing });
    paintRows([...rows.values()], false);
  });
  paintRows([...rows.values()], false);
  if (src.kind === 'live') {
    writeSnapshot(
      storage(),
      REPO_KEY,
      pulls.map((p) => ({ number: p.number, title: p.title, html_url: p.html_url, updated_at: p.updated_at, tier: rows.get(p.number)!.tier, kind: rows.get(p.number)!.kind, head: { ref: p.head.ref, sha: p.head.sha }, user: { login: p.user.login }, draft: p.draft })),
      new Date(),
    );
  }
  void loadOtherBranches(allOpen);
  return allOpen;
}

function branchRow(e: BranchEntry) {
  const links = e.previews.map((p) => `<a href="${esc(p.url)}">${esc(p.label)}</a>`);
  return `<li class="cg-row cg-branch"><span class="cg-row-title"><span class="mono cg-row-name">${esc(e.branch)}</span> <span class="cg-num mono">${esc(e.sha.slice(0, 7))}</span></span>
    <span class="cg-branch-links">${[...links, `<a href="${esc(e.url)}">View on GitHub</a>`].join('')}</span></li>`;
}

/** Branches without a pull request (the old Branches page): one more request, skipped quietly when it fails. */
async function loadOtherBranches(pulls: { head: { ref: string } }[]) {
  try {
    const b = await ghGet<{ name: string; commit: { sha: string } }[]>(`${R}/branches?per_page=100`);
    const rest = orphanBranches(b.data, pulls as never, BRANCHES.defaultBranch).map((x) => branchEntry(x, BRANCHES));
    const box = $<HTMLDetailsElement>('other-branches');
    if (!rest.length) return;
    $('cg-other-n').textContent = String(rest.length);
    $('cg-other-list').innerHTML = rest.map(branchRow).join('');
    box.hidden = false;
    if (location.hash === '#other-branches') {
      box.open = true;
      box.scrollIntoView({ block: 'start' });
    }
  } catch {
    /* rate limited with nothing saved: the section stays hidden */
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Detail

let current: { pull: Pull; tier: Tier | null } | null = null;

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
    if (pf.stale) showNotice('warn', `GitHub cannot be read right now, so this shows pull request #${n} ${asOf(pf.cachedAt ?? '')}. Connect GitHub for live status.`);
    const pull = pf.data;
    const [files, reviews, comments, ci, access, statuses] = await Promise.all([
      ghGet<PrFile[]>(`${R}/pulls/${n}/files?per_page=100`).then((f) => f.data),
      ghGet<Review[]>(`${R}/pulls/${n}/reviews?per_page=100`).then((f) => f.data).catch(() => [] as Review[]),
      ghGet<Comment[]>(`${R}/issues/${n}/comments?per_page=100`).then((f) => f.data).catch(() => [] as Comment[]),
      ciFor(pull.head.sha).catch(() => summarizeCi([])),
      readAccess(),
      // Same request as ciFor's commit status (shared in flight): the Vercel statuses say which previews are built.
      ghGet<{ statuses: { context: string; state: string; target_url?: string | null }[] }>(`${R}/commits/${pull.head.sha}/status`).then((f) => f.data.statuses).catch(() => []),
    ]);
    // A newer openPr (other PR, or the viewer changed) owns the page now.
    if (seq !== openSeq) return;
    // Highest tier wins: the label or checkbox the author set, or what the shared classifier (the one the
    // plugin, the editor and the MCP server use) computes from the changed files.
    const labelled = parseTier(pull.labels, pull.body);
    const computed = classifyRisk({ files: files.map((f) => ({ path: f.filename, status: f.status })) }).tier;
    const tier = Math.max(labelled ?? 0, computed) as Tier;
    current = { pull, tier };
    const approvals = summarizeApprovals(reviews, OWNERS, pull.user.login);
    const gate = mergeGate({ tier, ci, approvals, draft: pull.draft, mergeable: pull.mergeable, state: pull.state, merged_at: pull.merged_at, viewer: access?.login, override: OVERRIDE, exploration: isActiveExploration(pull.labels), ship: SHIP });
    const tokenFiles = files.filter((f) => isTokenFile(f.filename));
    const changesets = files.filter((f) => /^\.changeset\/(?!README).+\.md$/.test(f.filename) && f.status !== 'removed');
    const visual = touchesVisuals(files.map((f) => f.filename));

    const docsPaths = files.filter((f) => isDocsFile(f.filename) && f.status !== 'removed').map((f) => f.filename);
    d.innerHTML = renderDetail({ pull, tier, files, reviews, comments, ci, approvals, gate, tokenCount: tokenFiles.length, changesetCount: changesets.length, visual, access, docsPaths, statuses });
    wireActions(pull, gate, access);
    wireVisualLink(d);

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
        })
        .catch((err) => {
          slot.innerHTML = `<p class="rv-error">Could not read the visual impact: ${esc((err as Error).message)}</p>`;
          $('rv-what-visual').innerHTML = `<p class="rv-error">Could not read the before and after: ${esc((err as Error).message)}</p>`;
        });
    }

    if (tokenFiles.length) {
      const slot = $('rv-tokens');
      analyzeTokenFiles({ owner: repo.owner, repo: repo.repo, baseSha: pull.base.sha, headSha: pull.head.sha, files: tokenFiles })
        .then((review) => (slot.innerHTML = renderTokenReview(review)))
        .catch((err) => (slot.innerHTML = `<p class="rv-error">Could not compute the token diff: ${esc((err as Error).message)}</p>`));
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
    if (err instanceof RateLimitError) showNotice('warn', 'GitHub limits anonymous reads to 60 an hour. Connect GitHub, or open this pull request on GitHub.');
    else showNotice('fail', `Could not load pull request #${n}: ${(err as Error).message}`);
  }
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
}

/** Row icon: a check when approved, a cross when changes were requested, an empty circle while it waits. */
const ROW_ICON: Record<ApprovalRow['state'], string> = {
  approved: `<span class="rv-ap-icon is-approved">${iconSvg('check', 16)}</span>`,
  changes: `<span class="rv-ap-icon is-changes">${iconSvg('x', 16)}</span>`,
  waiting: '<span class="rv-ap-icon is-waiting"></span>',
};

/** The approval checklist: one row per approval the tier needs, the action on the row of the role the viewer holds. */
function approvalsHtml(rows: ApprovalRow[], who: WhoActs, tier: Tier | null) {
  if (!rows.length) return `<p class="cg-line">No approval needed at ${esc(tierLabel(tier))}.</p>`;
  return `<ul class="rv-ap" aria-label="Approvals">${rows
    .map((r) => {
      const primary = who.yourTurn && who.action === (r.role === 'design' ? 'approve-design' : r.role === 'tech' ? 'approve-tech' : 'approve');
      const act = r.canAct ? `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-lg rv-ap-act" data-act="APPROVE">${esc(r.actionLabel)}</button>` : '';
      const state = r.state === 'approved' ? 'Approved' : r.state === 'changes' ? 'Changes requested' : 'Waiting';
      return `<li class="rv-ap-row" data-state="${r.state}">${ROW_ICON[r.state]}<span class="rv-ap-role">${esc(r.label)}</span><span class="rv-ap-text"><span class="sr-only">${state}: </span>${esc(r.text)}</span>${act}</li>`;
    })
    .join('')}</ul>`;
}

/** The author's next step happens on GitHub: the button names it. */
const AUTHOR_CTA: Partial<Record<WhoActs['action'], string>> = {
  'fix-checks': 'See the checks on GitHub',
  'address-changes': 'Answer the review on GitHub',
  'resolve-conflict': 'Resolve the conflict on GitHub',
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
    needFromDetail({ state: lifecycle, ci, gate, changesRequestedBy: approvals.changesRequested, exploration: isActiveExploration(pull.labels) }),
    people(pull.user.login, { viewer: access?.login ?? null, approvers: approvals.approvers, canMerge: write && gate.canShip, overridable: showOverride }),
  );
  const rows = approvalRows({ tier, approvals, people: people(pull.user.login, { viewer: access?.login ?? null }), open });
  const rowAction = rows.some((r) => r.canAct);

  // One primary action per view. Your turn: the action the who-acts line names (an approval sits on its row). Not
  // your turn: connect when the viewer is anonymous, else nothing: the sentence says who acts.
  const failingRun = ci.failed.find((f) => f.url)?.url;
  let headerCta = '';
  let headerMerge = false;
  let headerOverride = false;
  if (who.yourTurn) {
    if (who.action === 'merge' && gate.allowed && write) {
      headerCta = '<button type="button" class="btn btn-primary btn-lg" data-act="MERGE">Merge</button>';
      headerMerge = true;
    } else if (who.action === 'override' && showOverride) {
      headerCta = '<button type="button" class="btn btn-primary btn-lg" data-override-open>Merge as owner override</button>';
      headerOverride = true;
    } else if (who.action === 'fix-checks' && failingRun) headerCta = `<a class="btn btn-primary btn-lg" href="${esc(failingRun)}" target="_blank" rel="noopener">Open failing run</a>`;
    else if (AUTHOR_CTA[who.action]) headerCta = `<a class="btn btn-primary btn-lg" href="${esc(pull.html_url)}" target="_blank" rel="noopener">${AUTHOR_CTA[who.action]}</a>`;
  } else if (!access && (lifecycle === 'open' || lifecycle === 'draft')) headerCta = '<button type="button" class="btn btn-primary btn-lg" data-gh-open>Connect GitHub to review</button>';

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
    OVERRIDE: 'merged as owner override',
    OVERRIDE_REFUSED: 'tried an owner override',
  };

  const fileList = `<ul class="rv-files">${files
    .slice(0, 40)
    .map((f) => `<li><span class="mono">${esc(f.filename)}</span><span class="rv-delta"><span class="is-add">+${f.additions}</span> <span class="is-del">-${f.deletions}</span></span></li>`)
    .join('')}</ul>${files.length > 40 ? `<p class="cg-muted">${files.length - 40} more on <a href="${esc(pull.html_url)}/files">GitHub</a>.</p>` : ''}`;
  const filesBody = `<p class="cg-muted">Branch <span class="mono">${esc(pull.head.ref)}</span> into <span class="mono">${esc(pull.base.ref)}</span>.</p>${fileList}`;

  const failing = ci.failed.length;
  const checksMeta = ci.total === 0 ? 'none yet' : failing ? `${failing} failing` : ci.pending.length ? `${ci.pending.length} running` : `all ${ci.total} pass`;
  const checksBody = ci.total
    ? `<ul class="rv-checks">${[...ci.failed.map((c) => ({ ...c, s: 'fail' })), ...ci.pending.map((c) => ({ ...c, s: 'pending' }))]
        .map((c) => `<li class="is-${c.s}"><span class="rv-check" aria-hidden="true"></span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}<span class="cg-muted">${c.s === 'fail' ? 'failing' : 'running'}</span></li>`)
        .join('')}<li class="is-pass"><span class="rv-check" aria-hidden="true"></span>${plural(ci.passed, 'check')} passing</li></ul>`
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

  const convBody = conversation.length
    ? `<ol class="rv-conv">${conversation
        .map(
          (c) =>
            `<li><div class="rv-conv-head">${avatar(c.user, 20)}<strong>${esc(c.user?.login ?? 'someone')}</strong> <span class="rv-kind">${kindLabel[c.kind] ?? c.kind.toLowerCase()}</span> <a class="cg-muted" href="${esc(c.url)}" target="_blank" rel="noopener">${c.at ? relativeTime(c.at) : ''}</a></div>${c.body ? `<div class="rv-conv-body">${esc(c.body).replace(/\n/g, '<br>')}</div>` : ''}</li>`,
        )
        .join('')}</ol>`
    : '<p class="cg-muted">No reviews or comments yet.</p>';

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
  const mergeBits = write
    ? `<div class="cg-act-end">
        ${showOverride && !headerOverride ? '<button type="button" class="btn btn-secondary btn-sm" data-override-open>Merge as owner override</button>' : ''}
        <button type="button" class="btn btn-secondary btn-sm rv-danger" data-act="CLOSE">Close</button>
        ${headerMerge ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-act="MERGE" ${gate.allowed ? '' : 'disabled aria-describedby="rv-merge-why"'}>Merge</button>`}
      </div>`
    : access
      ? `<p class="cg-muted">@${esc(access.login)} cannot write to ${esc(repo.owner)}/${esc(repo.repo)}, so merge and close are off.</p>`
      : '';
  const why = gate.allowed || lifecycle === 'merged' || lifecycle === 'closed' ? '' : `<p class="cg-muted" id="rv-merge-why">Merge unlocks when: ${gate.reasons.map((r) => esc(r)).join(' ')}${showOverride ? ' Only approvals are missing: as a listed owner you can merge with the owner override.' : ''}</p>`;

  // What it looks like: the biggest before/after first (filled by openPr), then the token diff as the "what changed"
  // of a token-only change. The full visual list stays one click away.
  const what = x.visual
    ? `<div id="rv-what-visual"><p class="rv-loading">Reading the before and after</p></div>`
    : '<p class="cg-line rv-what-quiet">No visual change.</p>';
  const tokens = x.tokenCount ? `<div class="rv-what-tokens"><h3 class="rv-what-sub">Token changes</h3><div id="rv-tokens"><p class="rv-loading">Resolving tokens at both versions</p></div></div>` : '';

  const devMeta = [plural(files.length, 'file'), ci.total === 0 ? 'no checks yet' : failing ? `${failing} failing ${failing === 1 ? 'check' : 'checks'}` : ci.pending.length ? 'checks running' : 'checks pass'].join(', ');

  return `
  <nav class="cg-crumbs" aria-label="Breadcrumb"><a href="./" data-back>Changes</a><span aria-hidden="true">/</span><span class="mono">#${pull.number}</span></nav>
  <header class="zone cg-pr-open">
    <p class="cg-pr-who" data-who="${who.yourTurn ? 'you' : esc(who.who)}">${esc(who.sentence)}</p>
    <h1 class="cg-pr-title">${esc(humanTitle(mdTitleText(pull.title)))} <span class="cg-num">#${pull.number}</span></h1>
    <p class="cg-pr-meta">${avatar(pull.user, 20)}<span>${esc(pull.user.login)}</span><span class="pill cg-tier">${esc(tierSlot(pull.labels, tier))}</span><a href="${esc(pull.html_url)}" target="_blank" rel="noopener">Open on GitHub</a><a href="/how-review-works/">How review works</a></p>
    ${approvalsHtml(rows, who, tier)}
    ${headerCta ? `<p class="cg-pr-cta">${headerCta}</p>` : ''}
  </header>
  <section class="rv-what" aria-label="What changed">${what}${tokens}</section>
  <div class="cg-secs">
    ${x.visual ? section('cg-sec-visual', 'All visual changes', 'Reading', `<div id="rv-visual"><p class="rv-loading">Reading the visual impact for ${esc(pull.head.sha.slice(0, 7))}</p></div>`) : ''}
    ${x.docsPaths.length ? section('cg-sec-docs', 'Docs', 'Reading', renderDocsSection(x.docsPaths)) : ''}
    ${section('cg-sec-conv', 'Conversation', String(conversation.length), convBody)}
    <details class="cg-sec cg-dev" id="cg-sec-dev"><summary class="cg-sec-head"><span class="cg-sec-title">For developers</span><span class="cg-sec-meta">${esc(devMeta)}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
      <div class="cg-sec-body cg-dev-body">
        ${section('cg-sec-files', 'Files', String(files.length), filesBody)}
        ${section('cg-sec-checks', 'Checks', checksMeta, checksBody, failing > 0)}
        ${section('cg-sec-changeset', 'Changeset', x.changesetCount ? 'Reading' : 'missing', `<div id="rv-changeset">${x.changesetCount ? '<p class="rv-loading">Reading changeset</p>' : '<p class="cg-muted">No changeset in this pull request. CI asks for one when a package changes.</p>'}</div>`)}
        ${section('cg-sec-preview', 'Preview and install', previewMeta, previewBody)}
      </div>
    </details>
  </div>
  <footer class="cg-actbar" id="rv-actions" aria-label="Review actions">
    ${why}
    <div class="cg-actbar-row">${reviewForm}${mergeBits}</div>
    <p class="rv-act-status" id="rv-act-status" role="status" aria-live="polite"></p>
  </footer>
  ${showOverride ? overrideDialog(pull, gate, access!) : ''}`;
}

function overrideDialog(pull: Pull, gate: ReturnType<typeof mergeGate>, access: Access) {
  const min = OVERRIDE.requireReason ? OVERRIDE.minReasonLength : 0;
  return `<dialog class="gh-dialog rv-ov-dialog" id="rv-ov" role="alertdialog" aria-modal="true" aria-labelledby="rv-ov-title" aria-describedby="rv-ov-desc">
    <form method="dialog" class="gh-dialog-box" novalidate>
      <header class="gh-dialog-head"><h2 id="rv-ov-title">Merge #${pull.number} as owner override?</h2></header>
      <div id="rv-ov-desc">
        <p>This merges into <span class="mono">${esc(pull.base.ref)}</span> without:</p>
        <ul class="rv-ov-missing">${gate.missing.map((m) => `<li>${esc(m[0]!.toUpperCase() + m.slice(1))}</li>`).join('')}</ul>
        <p>CI passes and nobody requested changes. Bridge posts your reason on the pull request as <strong>Bridge owner override</strong>, then merges, so History and the timeline show who skipped the approvals and why.</p>
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
        <button type="button" class="btn btn-primary btn-sm" id="rv-ov-go">Post reason and merge</button>
      </footer>
    </form>
  </dialog>`;
}

function syncAuthViews() {
  const has = Boolean(hasWorkingToken() && currentViewer());
  document.querySelectorAll<HTMLElement>('[data-needs-token]').forEach((el) => (el.hidden = !has));
  document.querySelectorAll<HTMLElement>('[data-no-token]').forEach((el) => (el.hidden = has));
}

function wireOverride(pull: Pull, access: Access, gate: ReturnType<typeof mergeGate>) {
  const dialog = document.getElementById('rv-ov') as HTMLDialogElement | null;
  if (!dialog) return;
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
  document.querySelector('[data-override-open]')?.addEventListener('click', () => {
    error.hidden = true;
    dialog.showModal();
  });
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
      go.textContent = 'Post reason and merge';
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
      showGhError(error, err, `GitHub refused the merge: ${msg}. Your reason stays on the pull request, marked not merged. Branch protection may need an approving review or an admin bypass.`, 'merge pull requests');
      error.hidden = false;
      go.disabled = false;
      go.textContent = 'Post reason and merge';
      return;
    }
    dialog.close();
    await openPr(pull.number, false);
    const done = document.getElementById('rv-act-status');
    if (done) done.textContent = `Merged as owner override. The reason is on #${pull.number}.`;
  });
}

function wireActions(pull: Pull, gate: ReturnType<typeof mergeGate>, access: Access | null) {
  syncAuthViews();
  if (access && gate.overridable && access.write) wireOverride(pull, access, gate);
  const status = $('rv-act-status');
  const body = document.getElementById('rv-body') as HTMLTextAreaElement | null;
  document.querySelectorAll<HTMLButtonElement>('#rv-detail [data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.act!;
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
      if (act === 'CLOSE' && !window.confirm(`Close pull request #${pull.number} without merging?`)) return;
      if (act === 'MERGE' && !window.confirm(`Merge pull request #${pull.number} into ${pull.base.ref}?`)) return;
      b.disabled = true;
      status.textContent = 'Sending to GitHub';
      try {
        if (act === 'APPROVE' || act === 'REQUEST_CHANGES' || act === 'COMMENT') {
          await ghWrite('POST', `${R}/pulls/${pull.number}/reviews`, { event: act, body: text || undefined, commit_id: pull.head.sha });
        } else if (act === 'MERGE') {
          await ghWrite('PUT', `${R}/pulls/${pull.number}/merge`, { merge_method: 'squash', sha: pull.head.sha });
        } else if (act === 'CLOSE') {
          await ghWrite('PATCH', `${R}/pulls/${pull.number}`, { state: 'closed' });
        }
        status.textContent = { APPROVE: 'Approved.', REQUEST_CHANGES: 'Changes requested.', COMMENT: 'Comment posted.', MERGE: 'Merged.', CLOSE: 'Closed.' }[act] ?? 'Done.';
        if (body) body.value = '';
        await openPr(pull.number, false);
      } catch (err) {
        const verb = act === 'MERGE' ? 'merge pull requests' : act === 'CLOSE' ? 'close pull requests' : 'review pull requests';
        showGhError(status, err, `GitHub refused: ${(err as Error).message}`, verb);
        b.disabled = false;
      }
    }),
  );
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
  const contrast = review.contrast.length
    ? `<h3 class="rv-sub">Contrast, before -> after</h3>
       <p class="small muted">Checked pairs whose ratio moves because either color resolves through a changed token, in each brand and theme. Failing pairs that run through a changed token stay listed.</p>
       <div class="table-wrap"><table class="rv-table rv-contrast"><thead><tr><th scope="col">Pair</th><th scope="col">Where</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Min</th></tr></thead><tbody>${review.contrast
         .map(
           (p) => `<tr class="${p.after < p.min ? 'is-fail' : p.after < p.before ? 'is-down' : ''}">
          <th scope="row"><span class="rv-pair"><span class="rv-aa" style="background-color:${esc(p.bgHexAfter)};color:${esc(p.fgHexAfter)}">Aa</span><span class="mono small">${esc(p.fg)}<br><span class="muted">on</span> ${esc(p.bg)}</span></span></th>
          <td class="small">${esc(p.where)}</td>
          <td class="num">${p.before.toFixed(2)}:1</td>
          <td class="num"><strong>${p.after.toFixed(2)}:1</strong> ${p.after < p.min ? '<span class="pill is-fail">Fails</span>' : p.after >= p.before ? '' : '<span class="pill is-warn">Lower</span>'}</td>
          <td class="num">${p.min}:1</td></tr>`,
         )
         .join('')}</tbody></table></div>`
    : '<p class="small muted">No checked contrast pair depends on these tokens.</p>';
  return `<div class="table-wrap"><table class="rv-table"><thead><tr><th scope="col">Token</th><th scope="col">Before</th><th scope="col"><span class="sr-only">Change</span></th><th scope="col">After</th></tr></thead><tbody>${rows}</tbody></table></div>${contrast}${
    review.failing ? `<p class="rv-error">${review.failing} contrast check${review.failing > 1 ? 's' : ''} would fail after this change. The token build will block it.</p>` : ''
  }`;
}

// ---------------------------------------------------------------------------------------------------------------

/** Back from a pull request to the list (the page controller repaints the view). */
export function closePr() {
  openSeq++;
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
