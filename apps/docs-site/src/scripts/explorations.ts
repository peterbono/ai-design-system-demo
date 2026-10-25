// Studio Branches > Explorations: the list (summary first), the detail in place (?exploration=N), the "Start an
// exploration" form, and Promote to review / Close. An exploration is a draft pull request labeled `exploration` on an
// `explore/<slug>` branch; starting, promoting and closing go through the core helpers (explorations-github.ts) with
// the viewer's token, the same code the MCP server and the CLI run. Reads stay inside the anonymous budget: the open
// pull requests In review already read, plus the request list the Requests view caches. Pure rules: lib/explorations-view.ts.
import {
  type BranchPreview,
  entryLabel,
  type BranchPreviewSources,
  closeExplorationOnGitHub,
  promoteExplorationOnGitHub,
  requestIssueTitle,
  subjectTitle,
  type ExplorationUseCase,
} from '@bridge-ds/core';
import { loadTeams, siteApproverEntries } from './teams';
import {
  branchFor,
  explorationPreviews,
  explorationRows,
  explorationStateLine,
  explorationsSummary,
  openRequestNumbers,
  runningCount,
  startProblems,
  type ExplorationPullLike,
  type ExplorationRow,
  previewRowCopy,
  promoteAsk,
  promotedLine,
  purposeLine,
  useCaseHint,
} from '../lib/explorations-view';
import { touchesVisuals } from '../lib/visual-impact';
import type { Tier } from '../lib/review-rules';
import type { PromoteAskDetail } from '../components/ds/studio/PromoteToReview';
import { loadVisualImpact, renderTopChange } from './reviews/visual-impact';
import { explorationFromRequest, type PullLike, type RequestRow } from '../lib/requests-view';
import { explorationWork } from '../lib/work-nature';
import { devTag, markWork, natureAttr } from './work-filter';
import { badgeHtml } from '@bridge-ds/react/dom';
import { paintPeople, personHtml } from './people';
import { sampleVisitor } from './demo-gate';
import { currentViewer, esc, ghGet, hasWorkingToken, initGitHubConnect, prefersSignIn, RateLimitError, readRepo, relativeTime, setButtonBusy, showGhError } from './github-session';
import { EXPLORATION_SUGGEST_LINE, ghAction, rateLimitedLine } from '../lib/gh-wording';
import { changesModeOnPage } from './changes-mode';
import { explorationClient, explorationsConfig, startLinkedExploration } from './exploration-start';
import { forgetRequests, loadRequestRows, requestRow } from './requests';
import { setSelect } from '../lib/select-bridge';
import { jiraKeyOf, parseJiraKey, VOCAB } from '../lib/vocabulary';
import { isProductBranch } from '../lib/product-branch';
import { attrUrl } from '../lib/html';
import { studioHref } from '../lib/team-path';

// The use case menu of Start an exploration (BridgedSelect id).
const USE_CASE = 'ex-use-case';

const repo = readRepo();
const R = `/repos/${repo.owner}/${repo.repo}`;
const CFG = explorationsConfig();

// Who approves: the owner lists after rights, the same lists the review counts approvals against. A GitHub team is
// named as a team with its size once read ("@acme/design (4 people)").
async function approverNames(): Promise<{ design: string[]; tech: string[] }> {
  const teams = await loadTeams();
  const e = siteApproverEntries();
  return { design: e.design.map((x) => entryLabel(x, teams)), tech: e.tech.map((x) => entryLabel(x, teams)) };
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const connected = () => Boolean(hasWorkingToken() && currentViewer());
const client = () => explorationClient(CFG);

let rows: ExplorationRow[] = [];
/** What the rows were read from: the pull request (body, labels) and the requests each exploration implements. */
let pullsBy = new Map<number, ExplorationPullLike>();
let requestRowsRead: RequestRow[] = [];
let loaded: Promise<ExplorationRow[]> | null = null;
let openPullsSource: (() => Promise<ExplorationPullLike[] | null>) | null = null;

/** The count of running explorations, where a page shows one (none on Branches since explorations are list rows). */
export function paintExplorationCount(pulls: ExplorationPullLike[]) {
  const n = runningCount(explorationRows(pulls, CFG));
  const count = $('ex-count');
  if (!count) return;
  count.textContent = String(n);
  count.hidden = n === 0;
}

/** Design or developer work, and who made it (lib/work-nature), from the pull request and the requests it implements. */
function workOf(r: ExplorationRow) {
  const pull = pullsBy.get(r.number);
  const requests = requestRowsRead.filter((q) => q.request?.exploration === r.branch).map((q) => ({ kind: q.kind, source: q.request?.source ?? null }));
  return explorationWork({ name: r.name, author: r.author, body: pull?.body ?? null, labels: pull?.labels ?? null, source: r.source, agent: r.agent, requests }, currentViewer()?.login ?? null);
}

export function rowHtml(r: ExplorationRow) {
  const preview = r.previews[0];
  const w = workOf(r);
  const nature = w.nature.nature;
  const key = jiraKeyOf(pullsBy.get(r.number)?.title ?? '');
  const reqs = r.requests.length ? `, ${r.requests.length} ${r.requests.length === 1 ? 'request' : 'requests'}` : '';
  return `<li class="cg-row ex-row" data-exploration="${r.number}" ${natureAttr(nature)}>
    <div class="ex-row-main">
      <p class="ex-row-title">${key ? `<span class="mono cg-jira">${esc(key)}</span> ` : ''}<a class="ex-name" href="?exploration=${r.number}" data-open-exploration="${r.number}">${esc(r.name)}</a> <span class="cg-num">#${r.number}</span> ${badgeHtml(r.statusLabel, { tone: r.tone, size: 'sm', className: 'rv-status' })} ${devTag(nature)}</p>
      ${purposeLine(r.name, r.purpose) ? `<p class="ex-purpose">${esc(r.purpose)}</p>` : ''}
      <p class="ex-meta">${personHtml(r.author, { agent: w.maker.kind === 'claude' })}, updated <time datetime="${esc(r.updatedAt)}">${esc(shortDate(r.updatedAt))}</time>${esc(reqs)}${preview ? `, <a href="${attrUrl(preview.url)}" target="_blank" rel="noopener">${esc(preview.label)} preview</a>` : ''}</p>
    </div>
  </li>`;
}

function paint() {
  const empty = rows.length === 0;
  $('ex-sentence').textContent = explorationsSummary(rows);
  $('ex-empty').hidden = !empty;
  $('ex-table').hidden = empty;
  $('ex-list').innerHTML = rows.map(rowHtml).join('');
  void paintPeople($('ex-list'));
  markWork($('ex-list'));
  paintExplorationCount([...pullsBy.values()]);
}

async function readRows(): Promise<ExplorationRow[]> {
  const pulls = (openPullsSource ? await openPullsSource().catch(() => null) : null) ?? (await ghGet<ExplorationPullLike[]>(`${R}/pulls?state=open&per_page=100`)).data;
  const requests = await loadRequestRows({ openPulls: pulls as unknown as PullLike[], closed: false }).catch(() => []);
  pullsBy = new Map(pulls.map((p) => [p.number, p]));
  requestRowsRead = requests;
  return explorationRows(pulls, CFG, { requests });
}

/** Loads (once per page, or again after a write) and paints the Explorations view. */
export function loadExplorations(openPulls?: () => Promise<ExplorationPullLike[] | null>, fresh = false): Promise<ExplorationRow[]> {
  if (openPulls) openPullsSource = openPulls;
  if (fresh) loaded = null;
  loaded ??= (async () => {
    const list = $('ex-list');
    list.setAttribute('aria-busy', 'true');
    try {
      rows = await readRows();
      paint();
    } catch (err) {
      $('ex-table').hidden = true;
      $('ex-sentence').textContent =
        err instanceof RateLimitError
          ? rateLimitedLine(prefersSignIn())
          : `Could not load explorations: ${(err as Error).message}.`;
    } finally {
      list.removeAttribute('aria-busy');
    }
    return rows;
  })();
  return loaded;
}

// ---------------------------------------------------------------------------------------------------------------
// Start an exploration

function readStart(form: HTMLFormElement) {
  const v = (name: string) => ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').toString();
  return { name: v('name'), purpose: v('purpose'), useCase: v('useCase'), jira: v('jira') };
}

/** Signed in: Start exploration; signed out: the sign-in button. */
function paintStartAuth() {
  const on = connected();
  document.querySelectorAll<HTMLElement>('#ex-start [data-gh-only]').forEach((el) => (el.hidden = !on));
  document.querySelectorAll<HTMLElement>('#ex-start [data-no-gh]').forEach((el) => (el.hidden = on));
}

/**
 * Suggest mode: an exploration is a branch, so the opener says why Bridge does not start one, in place of the
 * "Start an exploration" button, and the form never opens. True when it did.
 */
function paintSuggestMode(): boolean {
  const suggest = changesModeOnPage() === 'suggest';
  const opener = document.getElementById('ex-start-open');
  const note = document.getElementById('ex-suggest');
  if (opener) opener.hidden = suggest;
  if (note) {
    note.textContent = suggest ? EXPLORATION_SUGGEST_LINE : '';
    note.hidden = !suggest;
  }
  if (suggest) {
    const form = document.getElementById('ex-start');
    if (form) form.hidden = true;
  }
  return suggest;
}

function paintStartPreview(form: HTMLFormElement) {
  const f = readStart(form);
  $('ex-uc-hint').textContent = useCaseHint(f.useCase);
}

/** The request the form answers, when it was opened from one (Start an exploration on a request). */
let forRequest: RequestRow | null = null;

function paintFor() {
  const note = $('ex-for');
  if (!note) return;
  note.hidden = !forRequest;
  note.innerHTML = forRequest
    ? `For the request <a href="?request=${forRequest.number}" data-open-request="${forRequest.number}">${esc(requestIssueTitle(forRequest))}</a>. Once it starts, the request shows you are exploring it.`
    : '';
}

/** Opens the form filled from a request (?view=explorations&for=N): its title as the name, its summary as the purpose. */
export async function startForRequest(n: number) {
  const form = $<HTMLFormElement>('ex-start');
  const opener = $<HTMLButtonElement>('ex-start-open');
  if (!form || !opener) return;
  if (paintSuggestMode()) return;
  const r = await requestRow(n);
  if (Number(new URLSearchParams(location.search).get('for')) !== n) return;
  forRequest = r;
  form.hidden = false;
  opener.setAttribute('aria-expanded', 'true');
  $('ex-done').hidden = true;
  if (r) {
    const f = explorationFromRequest(r);
    (form.elements.namedItem('name') as HTMLInputElement).value = f.name;
    (form.elements.namedItem('purpose') as HTMLTextAreaElement).value = f.purpose;
  }
  paintFor();
  paintStartAuth();
  paintStartPreview(form);
  form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
}

function closeStart(focus = true) {
  const form = $<HTMLFormElement>('ex-start');
  const opener = $<HTMLButtonElement>('ex-start-open');
  forRequest = null;
  paintFor();
  if (new URLSearchParams(location.search).has('for')) history.replaceState({}, '', '?view=explorations');
  form.reset();
  setSelect(USE_CASE, { value: '' });
  form.hidden = true;
  $('ex-start-error').hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  opener.setAttribute('aria-expanded', 'false');
  if (focus) opener.focus();
}

function wireStart() {
  const form = $<HTMLFormElement>('ex-start');
  const opener = $<HTMLButtonElement>('ex-start-open');
  const error = $('ex-start-error');
  const submit = $<HTMLButtonElement>('ex-start-submit');
  if (!form || !opener) return;
  paintSuggestMode();
  opener.addEventListener('click', () => {
    if (paintSuggestMode()) return;
    const open = form.hidden;
    if (!open) return closeStart();
    form.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    $('ex-done').hidden = true;
    paintStartAuth();
    paintStartPreview(form);
    form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
  });
  form.querySelector('[data-ex-cancel]')?.addEventListener('click', () => closeStart());
  form.addEventListener('input', (e) => {
    (e.target as HTMLElement).removeAttribute('aria-invalid');
    error.hidden = true;
    paintStartPreview(form);
  });
  // The use case is a DS Select island (components/ds/BridgedSelect, name useCase): its hidden input holds the pick
  // and sends change once it holds it.
  form.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).name !== 'useCase') return;
    error.hidden = true;
    paintStartPreview(form);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = readStart(form);
    const problems = startProblems(f);
    let jira: string | null = null;
    try {
      jira = parseJiraKey(f.jira);
    } catch (err) {
      problems.push((err as Error).message);
      form.querySelector('[name="jira"]')?.setAttribute('aria-invalid', 'true');
    }
    if (problems.length) {
      if (!branchFor(f.name)) form.querySelector('[name="name"]')?.setAttribute('aria-invalid', 'true');
      if (!f.purpose.trim()) form.querySelector('[name="purpose"]')?.setAttribute('aria-invalid', 'true');
      error.textContent = problems.join(' ');
      error.hidden = false;
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (!hasWorkingToken()) {
      error.textContent = `${ghAction('start it here', prefersSignIn())}.`;
      error.hidden = false;
      return;
    }
    setButtonBusy(submit, true, 'Starting exploration');
    const req = forRequest;
    try {
      // Started for a request: linked the way `bridge request create --exploration` does, the starter put on it.
      const author = currentViewer()?.login;
      const { started: s, link } = await startLinkedExploration(
        CFG,
        { name: f.name, purpose: f.purpose, ...(f.useCase ? { useCase: f.useCase as ExplorationUseCase } : {}), ...(author ? { author } : {}), ...(jira ? { jira } : {}) },
        req ? { number: req.number, title: requestIssueTitle(req) } : null,
      );
      let linked = '';
      if (req && link) {
        if ('error' in link) linked = ` <span class="cg-muted">The request could not be linked: ${esc(link.error)}</span>`;
        else {
          forgetRequests();
          const warn = link.warnings.length ? ` <span class="cg-muted">${link.warnings.map(esc).join(' ')}</span>` : '';
          linked = ` The request <a href="?request=${req.number}" data-open-request="${req.number}">${esc(requestIssueTitle(req))}</a> is linked to it.${warn}`;
        }
      }
      closeStart(false);
      const done = $('ex-done');
      done.hidden = false;
      done.innerHTML = `<p><strong>${esc(f.name.trim())} is ready.</strong> <a href="?exploration=${s.pr}" data-open-exploration="${s.pr}">Open exploration #${s.pr}</a>. Its previews appear in a few minutes.${linked}</p>`;
      void loadExplorations(undefined, true).then(() => {
        // The list from GitHub may not show the new pull request yet: keep it on screen.
        if (!rows.some((r) => r.number === s.pr)) $('ex-sentence').textContent = `${explorationsSummary(rows)} #${s.pr} appears here in a moment.`;
      });
    } catch (err) {
      showGhError(error, err, (err as Error).message, 'start explorations');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Start exploration');
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Detail

function section(id: string, title: string, meta: string, body: string, open = false) {
  return `<details class="cg-sec" id="${id}"${open ? ' open' : ''}><summary class="cg-sec-head"><span class="cg-sec-title">${title}</span><span class="cg-sec-meta">${meta}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary><div class="cg-sec-body">${body}</div></details>`;
}

const crumbs = (n: number) => `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="${studioHref('changes/')}" data-back>Changes</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav>`;

/** The preview rows: one per app, a link with its designer name, or what is missing on the same line. */
export function previewList(previews: BranchPreview[]): string {
  return `<ul class="ex-previews">${previews
    .map(previewRowCopy)
    .map((p) => `<li>${p.url ? `<a class="btn btn-secondary btn-lg" href="${attrUrl(p.url)}" target="_blank" rel="noopener">Open ${esc(p.label)}</a>` : `<span class="ex-preview-name">${esc(p.label)}</span>`}${p.note ? ` <span class="cg-muted">${esc(p.note)}</span>` : ''}</li>`)
    .join('')}</ul>`;
}

export function renderExplorationDetail(r: ExplorationRow, opts: { connected: boolean }): string {
  const actions =
    r.status !== 'active'
      ? `<a class="btn btn-primary btn-lg" href="?pr=${r.number}" data-open-pr="${r.number}">Open the change</a>`
      : opts.connected
        ? `<button type="button" class="btn btn-primary btn-lg" data-ex-promote="${r.number}">Promote to review</button> <button type="button" class="btn btn-secondary btn-lg" data-ex-close-ask="${r.number}">Close</button>`
        : sampleVisitor()
          ? // The sample team: the button says what it does; a click opens the demo dialog (scripts/demo-gate.ts).
            `<button type="button" class="btn btn-primary btn-lg" data-demo-write="keep an exploration">Promote to review</button>`
          : `<button type="button" class="btn btn-primary btn-lg" data-gh-open data-demo-write="keep an exploration">${ghAction('promote it', prefersSignIn())}</button>`;
  // Filled again by paintTryIt with what Vercel reports: a long branch alias is shortened with a hash, never guessed.
  const resolved = explorationPreviews(r, CFG.apps);
  const previews = resolved.length ? `<div id="ex-previews" aria-live="polite">${previewList(resolved)}</div>` : '<p class="cg-muted">Previews are not set up for this library yet.</p>';
  const reqs = r.requests.length
    ? `<ul class="rq-prs">${r.requests.map((q) => `<li><a href="?request=${q.number}" data-open-request="${q.number}">${esc(subjectTitle(q.component, q.title))}</a> <span class="cg-muted">#${q.number}, ${esc(q.statusLabel)}</span></li>`).join('')}</ul>`
    : '<p class="cg-muted">No request is built on this exploration yet.</p>';
  const purpose = purposeLine(r.name, r.purpose);
  const key = jiraKeyOf(pullsBy.get(r.number)?.title ?? '');
  return `${crumbs(r.number)}
  <header class="zone cg-pr-open">
    <h1 class="cg-pr-title">${key ? `<span class="mono cg-jira">${esc(key)}</span> ` : ''}${esc(r.name)} <span class="cg-num">#${r.number}</span></h1>
    ${purpose ? `<p class="ex-purpose-line">${esc(purpose)}</p>` : ''}
    <p class="cg-pr-meta">${badgeHtml(r.statusLabel, { tone: r.tone, className: 'rv-status' })}${badgeHtml('Exploration', { className: 'cg-tier' })}${r.useCaseLabel ? `<span>${esc(r.useCaseLabel)}</span>` : ''}<span>@${esc(r.author)}</span><span>Updated ${esc(relativeTime(r.updatedAt))}</span><a class="cg-gh" href="${attrUrl(r.url)}" target="_blank" rel="noopener">${VOCAB.openOnGitHub}<span class="sr-only"> (opens in a new tab)</span></a></p>
    <p class="cg-pr-state">${esc(explorationStateLine(r.status))}</p>
    <div class="cg-pr-cta ex-actions" id="ex-actions">${actions}</div>
    <div class="ex-confirm" id="ex-confirm" hidden>
      <p>Close ${esc(r.name)} without merging it? Its previews stay for reference.</p>
      <p class="ex-actions"><button type="button" class="btn btn-secondary rv-danger" data-ex-close="${r.number}">Close exploration</button> <button type="button" class="btn btn-secondary" data-ex-close-cancel>Keep it</button></p>
    </div>
    <p class="gh-error" id="ex-action-error" role="alert" hidden></p>
  </header>
  <section class="ex-hero" aria-labelledby="ex-h-previews">
    <h2 class="ex-h" id="ex-h-previews">Try it</h2>
    ${previews}
  </section>
  <section class="ex-hero rv-what" aria-labelledby="ex-h-visual">
    <h2 class="ex-h" id="ex-h-visual">Compared with the official library</h2>
    <div id="ex-visual" aria-live="polite"><p class="rv-loading">Reading the before and after</p></div>
  </section>
  <div class="cg-secs">
    ${section('ex-sec-requests', 'Requests built on it', String(r.requests.length), reqs, r.requests.length > 0)}
  </div>`;
}

let current: ExplorationRow | null = null;

/**
 * The preview URLs Vercel reports (its comment on the branch, the head's statuses). Two reads. A failed read keeps
 * the previews painted from the configured templates.
 */
async function paintTryIt(r: ExplorationRow) {
  let sources: BranchPreviewSources | null = null;
  try {
    const [comments, statuses] = await Promise.all([
      ghGet<{ body?: string | null }[]>(`${R}/issues/${r.number}/comments?per_page=100`).then((f) => f.data),
      ghGet<{ statuses: { context: string; state: string; target_url?: string | null }[] }>(`${R}/commits/${r.headSha}/status`).then((f) => f.data.statuses).catch(() => []),
    ]);
    sources = { comments, statuses };
  } catch {
    return;
  }
  if (current?.number !== r.number || !sources) return;
  const pv = document.getElementById('ex-previews');
  if (pv) pv.innerHTML = previewList(explorationPreviews(r, CFG.apps, sources));
}

/**
 * The before and after against the official library: the visual impact workflow runs on pull requests, and an
 * exploration is one, so its manifest is read the same way as on a change in review (the biggest change on top).
 * An exploration that touches no token or component file has nothing to compare: one quiet line says so.
 */
async function paintVisual(r: ExplorationRow) {
  const slot = document.getElementById('ex-visual');
  if (!slot) return;
  try {
    const files = (await ghGet<{ filename: string }[]>(`${R}/pulls/${r.number}/files?per_page=100`)).data;
    if (current?.number !== r.number) return;
    if (!touchesVisuals(files.map((f) => f.filename))) {
      slot.innerHTML = '<p class="cg-line rv-what-quiet">Nothing here changes how components look yet. The before and after appears once tokens or components change.</p>';
      return;
    }
    // The full list is not repeated here: "See all" opens the branch, where every screen is listed.
    const v = await loadVisualImpact(
      document.createElement('div'),
      { owner: CFG.owner, repo: CFG.repo, pr: r.number, sha: r.headSha, actionsUrl: `https://github.com/${CFG.owner}/${CFG.repo}/actions/workflows/visual-impact.yml` },
      slot,
    );
    if (current?.number !== r.number) return;
    renderTopChange(slot, v, `?pr=${r.number}`);
  } catch (err) {
    slot.innerHTML = `<p class="cg-line rv-what-quiet">${err instanceof RateLimitError ? `GitHub limits anonymous reads. ${ghAction('see the before and after', prefersSignIn())}.` : `Could not read the before and after: ${esc((err as Error).message)}`}</p>`;
  }
}

async function rowFor(n: number): Promise<ExplorationRow | null> {
  const list = await loadExplorations();
  const hit = list.find((x) => x.number === n);
  if (hit) return hit;
  // A closed or promoted exploration is not in the open list: read it once.
  try {
    const p = (await ghGet<ExplorationPullLike>(`${R}/pulls/${n}`)).data;
    return explorationRows([p], CFG)[0] ?? null;
  } catch {
    return null;
  }
}

/** Opens an exploration in place (?exploration=N). */
export async function openExploration(n: number, push = true) {
  if (push) history.pushState({ exploration: n }, '', `?exploration=${n}`);
  const d = $('rv-detail');
  d.hidden = false;
  d.innerHTML = `${crumbs(n)}<p class="rv-loading">Loading exploration #${n}</p>`;
  window.scrollTo({ top: 0 });
  const r = await rowFor(n);
  if (Number(new URLSearchParams(location.search).get('exploration')) !== n) return;
  current = r;
  // A branch started for a product: the product branch page (its missing pieces and their library branches).
  const pull = r ? pullsBy.get(r.number) : undefined;
  if (r && pull) {
    const pb = await import('./product-branch');
    const products = pb.siteProducts();
    const product = isProductBranch(pull.labels, products);
    if (product) return pb.openProductBranch(d, r, pull, product, products, () => void openExploration(n, false));
  }
  d.innerHTML = r
    ? renderExplorationDetail(r, { connected: connected() })
    : `${crumbs(n)}<p class="cg-muted">#${n} is not an exploration in ${esc(`${CFG.owner}/${CFG.repo}`)}, or GitHub cannot be read right now. <a href="https://github.com/${esc(`${CFG.owner}/${CFG.repo}`)}/pull/${n}" target="_blank" rel="noopener">${VOCAB.openOnGitHub}</a>.</p>`;
  if (r) {
    void paintTryIt(r);
    void paintVisual(r);
  }
}

function actionError(message: string | null, err?: unknown, action?: string) {
  const el = document.getElementById('ex-action-error');
  if (!el) return;
  if (message !== null && err !== undefined) showGhError(el, err, message, action);
  else el.textContent = message ?? '';
  el.hidden = message === null;
}

/**
 * Promote to review: a DS Dialog first (components/ds/studio/PromoteToReview.tsx) that says who will be asked to
 * approve, from a dry run of the promotion (the tier of the files it changes, no write) and the owners after rights.
 * Confirmed, it promotes; the header then says where the change went, with the link next to it.
 */
function promote(btn: HTMLButtonElement) {
  if (!current) return;
  const r = current;
  actionError(null);
  const detail: PromoteAskDetail = {
    number: r.number,
    name: r.name,
    ask: async () => {
      const plan = await promoteExplorationOnGitHub(client(), r.number, { requests: openRequestNumbers(r), dryRun: true });
      return promoteAsk(plan.tier as Tier, await approverNames());
    },
    confirm: async () => {
      try {
        const p = await promoteExplorationOnGitHub(client(), r.number, { requests: openRequestNumbers(r) });
        const warn = p.warnings.length ? `<p class="cg-muted ex-note">${p.warnings.map(esc).join(' ')}</p>` : '';
        // The header now says where the branch went, in one sentence with the link next to it.
        $('ex-confirm').hidden = true;
        document.querySelector('#rv-detail .cg-pr-meta .rv-status')?.replaceChildren('Promoted to review');
        document.querySelector('#rv-detail .cg-pr-meta .cg-tier')?.remove();
        document.querySelector('#rv-detail .cg-pr-state')?.remove();
        $('ex-actions').outerHTML = `<p class="cg-pr-state ex-done" id="ex-actions" role="status">${esc(promotedLine(r.number))} <a href="?pr=${r.number}" data-open-pr="${r.number}">Open the change</a></p>${warn}`;
        void loadExplorations(undefined, true);
      } catch (err) {
        throw new Error(`${(err as Error).message} You can also mark it ready for review on GitHub.`);
      }
    },
    closed: (promoted) => {
      if (promoted) document.querySelector<HTMLAnchorElement>('#ex-actions a')?.focus();
      else if (btn.isConnected) btn.focus();
    },
  };
  document.dispatchEvent(new CustomEvent('bridge:promote-ask', { detail }));
}

async function close(btn: HTMLButtonElement) {
  if (!current) return;
  const r = current;
  actionError(null);
  setButtonBusy(btn, true, 'Closing');
  try {
    await closeExplorationOnGitHub(client(), r.number);
    $('ex-confirm').hidden = true;
    document.querySelector('#rv-detail .cg-pr-meta .rv-status')?.replaceChildren('Closed');
    document.querySelector('#rv-detail .cg-pr-state')?.remove();
    $('ex-actions').outerHTML = '<p class="cg-pr-state ex-done" id="ex-actions" role="status">Closed without adding it to the library. Its previews stay for reference.</p>';
    void loadExplorations(undefined, true);
  } catch (err) {
    actionError((err as Error).message, err, 'close changes');
    setButtonBusy(btn, false, 'Close exploration');
  }
}

let wired = false;

/** Wires the form and the detail actions once. */
export function initExplorations() {
  if (wired) return;
  wired = true;
  wireStart();
  initGitHubConnect(() => {
    paintStartAuth();
    if (current && !$('rv-detail').hidden && new URLSearchParams(location.search).get('exploration')) {
      $('rv-detail').innerHTML = renderExplorationDetail(current, { connected: connected() });
      void paintTryIt(current);
      void paintVisual(current);
    }
  });
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const p = t.closest<HTMLButtonElement>('[data-ex-promote]');
    if (p) return void promote(p);
    if (t.closest('[data-ex-close-ask]')) {
      $('ex-confirm').hidden = false;
      $('ex-confirm').querySelector<HTMLButtonElement>('[data-ex-close]')?.focus();
      return;
    }
    if (t.closest('[data-ex-close-cancel]')) {
      $('ex-confirm').hidden = true;
      document.querySelector<HTMLButtonElement>('[data-ex-close-ask]')?.focus();
      return;
    }
    const c = t.closest<HTMLButtonElement>('[data-ex-close]');
    if (c) void close(c);
  });
}
