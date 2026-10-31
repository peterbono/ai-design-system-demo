// Studio Branches > Explorations: the list (summary first), the detail in place (?exploration=N), the "Start an
// exploration" form, and Done exploring / Archive. An exploration is a draft pull request labeled `exploration` on an
// `explore/<slug>` branch, a living prototype: "Done exploring" hands it to the developers and "Archive" hides it, and
// neither closes it, so its preview link stays alive. Both go through the core helpers (exploration-done-github.ts,
// explorations-github.ts) with the viewer's token, the same code the MCP server and the CLI run. Reads stay inside the
// anonymous budget: the open pull requests In review already read, plus the request list the Requests view caches.
// Pure rules: lib/explorations-view.ts.
import {
  type BranchPreview,
  type BranchPreviewSources,
  archiveExplorationOnGitHub,
  requestIssueTitle,
  subjectTitle,
  type ExplorationUseCase,
} from '@bridge-ds/core';
import {
  ARCHIVED_LINE,
  branchFor,
  explorationHref,
  explorationKey,
  explorationParam,
  explorationPreviews,
  explorationRows,
  mergeExplorationRows,
  productPreviews,
  explorationStateLine,
  explorationsSummary,
  runningCount,
  startProblems,
  takeItLines,
  type ExplorationPullLike,
  type ExplorationRow,
  previewRowCopy,
  purposeLine,
  unreadableExplorationLine,
  useCaseHint,
} from '../lib/explorations-view';
import { touchesVisuals } from '../lib/visual-impact';
import { askDoneExploring } from './exploration-done';
import { loadVisualImpact, renderTopChange } from './reviews/visual-impact';
import { explorationFromRequest, type PullLike, type RequestRow } from '../lib/requests-view';
import { explorationWork } from '../lib/work-nature';
import { devTag, markWork, natureAttr } from './work-filter';
import { badgeHtml } from '@bridge-ds/react/dom';
import { paintPeople, personHtml } from './people';
import { sampleVisitor } from './demo-gate';
import { currentAccess, currentContributor, currentViewer, esc, ghGet, hasWorkingToken, initGitHubConnect, limitLine, prefersSignIn, RateLimitError, readRepo, relativeTime, setButtonBusy, showGhError } from './github-session';
import { canKeepExploration, keepExplorationLine, productKeeperLine } from '../lib/write-route';
import { viewerRole } from './needs-you';
import { EXPLORATION_SUGGEST_LINE, ghAction, rateLimitedLine } from '../lib/gh-wording';
import { changesModeOnPage } from './changes-mode';
import { explorationClient, explorationsConfig, startLinkedExploration } from './exploration-start';
import { forgetRequests, loadRequestRows, requestRow } from './requests';
import { setSelect } from '../lib/select-bridge';
import { jiraKeyOf, parseJiraKey, VOCAB } from '../lib/vocabulary';
import { isProductBranch } from '../lib/product-branch';
import { attrUrl } from '../lib/html';
import { studioHref } from '../lib/team-path';
import { productClient, productRepoByKey, readProductPulls, type ProductPull } from './product-repos';
import { defaultProduct, EXPLORATION_LABEL, isUnlabeledExploration, type GitHubClient } from '@bridge-ds/core';

// The use case menu of Start an exploration (BridgedSelect id).
const USE_CASE = 'ex-use-case';

const repo = readRepo();
const R = `/repos/${repo.owner}/${repo.repo}`;
const CFG = explorationsConfig();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const connected = () => Boolean(hasWorkingToken() && currentViewer());
const client = () => explorationClient(CFG);

let rows: ExplorationRow[] = [];
/**
 * What the rows were read from: the pull request (body, labels) and the requests each exploration implements. Keyed by
 * explorationKey: "12" in the design system repository, "shop#12" in the shop's own one.
 */
let pullsBy = new Map<string, ExplorationPullLike>();
const pullOf = (r: { number: number; product?: string | null | undefined }) => pullsBy.get(explorationKey(r));
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
  const pull = pullOf(r);
  const requests = requestRowsRead.filter((q) => q.request?.exploration === r.branch).map((q) => ({ kind: q.kind, source: q.request?.source ?? null }));
  return explorationWork({ name: r.name, author: r.author, body: pull?.body ?? null, labels: pull?.labels ?? null, source: r.source, agent: r.agent, requests }, currentViewer()?.login ?? null);
}

export function rowHtml(r: ExplorationRow) {
  const preview = r.previews[0];
  const w = workOf(r);
  const nature = w.nature.nature;
  const key = jiraKeyOf(pullOf(r)?.title ?? '');
  const reqs = r.requests.length ? `, ${r.requests.length} ${r.requests.length === 1 ? 'request' : 'requests'}` : '';
  const product = r.product ? ` data-product="${esc(r.product)}"` : '';
  return `<li class="cg-row ex-row" data-exploration="${esc(explorationKey(r))}" ${natureAttr(nature)}>
    <div class="ex-row-main">
      <p class="ex-row-title">${key ? `<span class="mono cg-jira">${esc(key)}</span> ` : ''}<a class="ex-name" href="${explorationHref(r)}" data-open-exploration="${r.number}"${product}>${esc(r.name)}</a> <span class="cg-num">#${r.number}</span> ${badgeHtml(r.statusLabel, { tone: r.tone, size: 'sm', className: 'rv-status' })} ${devTag(nature)}</p>
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
  // The design system's open branches and, in parallel, one read per product repository (skipped when unreachable).
  const [pulls, products] = await Promise.all([
    (async () => (openPullsSource ? await openPullsSource().catch(() => null) : null) ?? (await ghGet<ExplorationPullLike[]>(`${R}/pulls?state=open&per_page=100`)).data)(),
    readProductPulls(),
  ]);
  const requests = await loadRequestRows({ openPulls: pulls as unknown as PullLike[], closed: false }).catch(() => []);
  pullsBy = new Map([...pulls.map((p) => [explorationKey(p), p] as const), ...products.flatMap((x) => (x.pulls ?? []).map((p) => [explorationKey(p), p] as const))]);
  requestRowsRead = requests;
  return mergeExplorationRows(explorationRows(pulls, CFG, { requests }), ...products.map((x) => (x.pulls ? explorationRows(x.pulls, CFG, { inProduct: x.at }) : [])));
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
          ? (limitLine(err, 'Explorations') ?? rateLimitedLine(prefersSignIn()))
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
      const unlabeled = s.labelsMissing?.length ? ` <span class="cg-muted">GitHub did not take its exploration label yet: Bridge adds it again when you open it.</span>` : '';
      done.innerHTML = `<p><strong>${esc(f.name.trim())} is ready.</strong> <a href="?exploration=${s.pr}" data-open-exploration="${s.pr}">Open exploration #${s.pr}</a>. Its previews appear in a few minutes.${linked}${unlabeled}</p>`;
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

/** "Changes / #12", or "Changes / Shop / #12" for an exploration in a product's own repository (board P2). */
const crumbs = (n: number, product?: string | null) => {
  const name = product ? productRepoByKey(product)?.product.name : null;
  return `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="${studioHref('changes/')}" data-back>Changes</a><span aria-hidden="true">/</span>${name ? `<span>${esc(name)}</span><span aria-hidden="true">/</span>` : ''}<span class="mono">#${n}</span></nav>`;
};

/** The preview rows: one per app, a link with its designer name, or what is missing on the same line. */
export function previewList(previews: BranchPreview[]): string {
  return `<ul class="ex-previews">${previews
    .map(previewRowCopy)
    .map((p) => `<li>${p.url ? `<a class="btn btn-secondary btn-lg" href="${attrUrl(p.url)}" target="_blank" rel="noopener">Open ${esc(p.label)}</a>` : `<span class="ex-preview-name">${esc(p.label)}</span>`}${p.note ? ` <span class="cg-muted">${esc(p.note)}</span>` : ''}</li>`)
    .join('')}</ul>`;
}

/**
 * `suggest`: the team works in suggest mode (bridge.config.json "changes"): promoting and closing are branch writes,
 * so they are not offered, as on the product page (scripts/product-branch.ts). Absent: read from the page.
 * `keeper`: Send for review and Close are for the person who started it or a reviewer, with write access
 * (lib/write-route); false: others read who can.
 */
// In a product's own repository the design system's write access says nothing: GitHub answers for the write itself.
const keeperOf = (r: ExplorationRow) => canKeepExploration({ viewer: currentViewer()?.login ?? null, author: r.author, reviewer: viewerRole() === 'reviewer', write: r.repo ? null : (currentAccess()?.write ?? null) });

/**
 * The header actions. Running: Done exploring (primary) and Archive. With the developers: Archive only. Archived: the
 * line that says so and Unarchive. Nothing ever closes the exploration, so its preview link stays alive. Promoted the
 * older way: the change it became.
 */
function detailActions(r: ExplorationRow, opts: { connected: boolean; suggest: boolean; keeper?: boolean }): string {
  if (r.status === 'promoted') return `<a class="btn btn-primary btn-lg" href="?pr=${r.number}" data-open-pr="${r.number}">Open the change</a>`;
  const open = r.status === 'active' || r.status === 'ready' || r.status === 'building';
  if (!open || opts.suggest) return r.archived ? `<p class="cg-muted">${esc(ARCHIVED_LINE)}</p>` : '';
  if (opts.connected && opts.keeper === false) return `<p class="cg-muted">${esc(keepExplorationLine(r.author))}</p>`;
  // An email member writes through Bridge in the design system only: someone with GitHub on the product takes it on.
  if (r.product && currentContributor()) return `<p class="cg-muted">${esc(productKeeperLine(productRepoByKey(r.product)?.product.name ?? r.product))}</p>`;
  if (!opts.connected) {
    if (r.status !== 'active') return '';
    // The sample team: the button says what it does; a click opens the demo dialog (scripts/demo-gate.ts).
    return sampleVisitor()
      ? `<button type="button" class="btn btn-primary btn-lg" data-demo-write="keep an exploration">Done exploring</button>`
      : `<button type="button" class="btn btn-primary btn-lg" data-gh-open data-demo-write="keep an exploration">${ghAction('say it is done exploring', prefersSignIn())}</button>`;
  }
  if (r.archived) return `<p class="cg-muted">${esc(ARCHIVED_LINE)}</p> <button type="button" class="btn btn-secondary btn-lg" data-ex-archive="${r.number}" data-unarchive>Unarchive</button>`;
  const archive = `<button type="button" class="btn btn-secondary btn-lg" data-ex-archive="${r.number}">Archive</button>`;
  return r.status === 'active' ? `<button type="button" class="btn btn-primary btn-lg" data-ex-done="${r.number}">Done exploring</button> ${archive}` : archive;
}

/**
 * "For developers", folded: the branch and the two commands to take it, labeled as a starting point (Claude's
 * prototype code is never reviewed or tested). Developer words live here only, never in the designer's flow.
 */
export function developerSection(r: Pick<ExplorationRow, 'branch' | 'url' | 'status'> & { repo?: string | undefined }): string {
  if (r.status === 'closed') return '';
  const t = takeItLines(r.branch);
  const body = `<p class="cg-line">${esc(t.note)}</p>
    <p class="cg-line">Branch <code class="mono">${esc(t.branch)}</code>${r.repo ? ` in <code class="mono">${esc(r.repo)}</code>, the product's own repository` : ''}</p>
    <pre class="ex-take"><code>${esc(t.commands.join('\n'))}</code></pre>
    <p class="cg-line"><a href="${attrUrl(r.url)}" target="_blank" rel="noopener">${VOCAB.openOnGitHub}<span class="sr-only"> (opens in a new tab)</span></a></p>`;
  return section('ex-sec-dev', 'For developers', 'Starting point', body);
}

export function renderExplorationDetail(r: ExplorationRow, opts: { connected: boolean; suggest?: boolean; keeper?: boolean }): string {
  const suggest = opts.suggest ?? changesModeOnPage() === 'suggest';
  const actions = detailActions(r, { connected: opts.connected, suggest, ...(opts.keeper !== undefined ? { keeper: opts.keeper } : {}) });
  // Filled again by paintTryIt with what Vercel reports: a long branch alias is shortened with a hash, never guessed.
  const at = productRepoByKey(r.product);
  const resolved = at ? productPreviews(r, at.product) : explorationPreviews(r, CFG.apps);
  const previews = resolved.length
    ? `<div id="ex-previews" aria-live="polite">${previewList(resolved)}</div>`
    : `<p class="cg-muted">${at ? `Previews are not set up for ${esc(at.product.name)} yet.` : 'Previews are not set up for this library yet.'}</p>`;
  const reqs = r.requests.length
    ? `<ul class="rq-prs">${r.requests.map((q) => `<li><a href="?request=${q.number}" data-open-request="${q.number}">${esc(subjectTitle(q.component, q.title))}</a> <span class="cg-muted">#${q.number}, ${esc(q.statusLabel)}</span></li>`).join('')}</ul>`
    : '<p class="cg-muted">No request is built on this exploration yet.</p>';
  const purpose = purposeLine(r.name, r.purpose);
  const key = jiraKeyOf(pullOf(r)?.title ?? '');
  return `${crumbs(r.number, r.product)}
  <header class="zone cg-pr-open">
    <h1 class="cg-pr-title">${key ? `<span class="mono cg-jira">${esc(key)}</span> ` : ''}${esc(r.name)} <span class="cg-num">#${r.number}</span></h1>
    ${purpose ? `<p class="ex-purpose-line">${esc(purpose)}</p>` : ''}
    <p class="cg-pr-meta">${badgeHtml(r.statusLabel, { tone: r.tone, className: 'rv-status' })}${badgeHtml('Exploration', { className: 'cg-tier' })}${r.useCaseLabel ? `<span>${esc(r.useCaseLabel)}</span>` : ''}<span>@${esc(r.author)}</span><span>Updated ${esc(relativeTime(r.updatedAt))}</span><a class="cg-gh" href="${attrUrl(r.url)}" target="_blank" rel="noopener">${VOCAB.openOnGitHub}<span class="sr-only"> (opens in a new tab)</span></a></p>
    <p class="cg-pr-state">${esc(explorationStateLine(r.status))}</p>
    <div class="cg-pr-cta ex-actions" id="ex-actions">${actions}</div>
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
    ${r.product ? '' : section('ex-sec-requests', 'Requests built on it', String(r.requests.length), reqs, r.requests.length > 0)}
    ${developerSection(r)}
  </div>`;
}

let current: ExplorationRow | null = null;
const isCurrent = (r: { number: number; product?: string | null | undefined }) => Boolean(current && explorationKey(current) === explorationKey(r));

/** The API path of the repository an exploration lives in: the design system's, or the product's own. */
const repoPath = (r: { product?: string | null | undefined }) => {
  const at = productRepoByKey(r.product);
  return at ? `/repos/${at.repo}` : R;
};

/** The client that writes an exploration: the design system's, or one for the product's own repository. */
function clientFor(r: ExplorationRow): GitHubClient {
  const at = productRepoByKey(r.product);
  return at ? productClient(at.repo, pullOf(r)?.base?.ref) : client();
}

/**
 * A running exploration whose `exploration` label is missing (the label call failed when it started): put back, once
 * per page, by a viewer who can write. Everything already reads it as running (core isUnlabeledExploration), so a
 * refusal changes nothing on screen.
 */
const repaired = new Set<string>();
async function repairLabel(r: ExplorationRow, pull: ExplorationPullLike) {
  const k = explorationKey(r);
  if (repaired.has(k) || !isUnlabeledExploration({ state: pull.state, draft: pull.draft, labels: pull.labels, headRef: pull.head.ref, body: pull.body })) return;
  if (!connected() || currentContributor() || (!r.repo && !currentAccess()?.write)) return;
  repaired.add(k);
  if (await clientFor(r).addLabels(r.number, [EXPLORATION_LABEL]).catch(() => false)) {
    pullsBy.set(k, { ...pull, labels: [...pull.labels, { name: EXPLORATION_LABEL }] });
    void loadExplorations(undefined, true);
  }
}

/** What Vercel reported per exploration (by explorationKey), kept for the preview link "Done exploring" puts on each request. */
const sourcesBy = new Map<string, BranchPreviewSources>();

/** Every preview of an exploration with what was reported: the library's apps, or the product's own preview. */
const previewsOf = (r: ExplorationRow, sources: BranchPreviewSources = {}): BranchPreview[] => {
  const at = productRepoByKey(r.product);
  return at ? productPreviews(r, at.product, sources) : explorationPreviews(r, CFG.apps, sources);
};

/**
 * The preview URLs Vercel reports (its comment on the branch, the head's statuses), in the repository the exploration
 * lives in. Two reads. A failed read keeps the previews painted from the configured templates.
 */
async function paintTryIt(r: ExplorationRow) {
  let sources: BranchPreviewSources | null = null;
  const RR = repoPath(r);
  try {
    const [comments, statuses] = await Promise.all([
      ghGet<{ body?: string | null }[]>(`${RR}/issues/${r.number}/comments?per_page=100`).then((f) => f.data),
      ghGet<{ statuses: { context: string; state: string; target_url?: string | null }[] }>(`${RR}/commits/${r.headSha}/status`).then((f) => f.data.statuses).catch(() => []),
    ]);
    sources = { comments, statuses };
  } catch {
    return;
  }
  sourcesBy.set(explorationKey(r), sources);
  if (!isCurrent(r) || !sources) return;
  const pv = document.getElementById('ex-previews');
  if (pv) pv.innerHTML = previewList(previewsOf(r, sources));
}

/**
 * The before and after against the official library: the visual impact workflow runs on pull requests, and an
 * exploration is one, so its manifest is read the same way as on a change in review (the biggest change on top).
 * An exploration that touches no token or component file has nothing to compare: one quiet line says so. In a
 * product's own repository the workflow does not run: the product preview is the comparison.
 */
async function paintVisual(r: ExplorationRow) {
  const slot = document.getElementById('ex-visual');
  if (!slot) return;
  if (r.product) {
    slot.innerHTML = '<p class="cg-line rv-what-quiet">This exploration lives in the product: open its preview above to see it with the library.</p>';
    return;
  }
  try {
    const files = (await ghGet<{ filename: string }[]>(`${R}/pulls/${r.number}/files?per_page=100`)).data;
    if (!isCurrent(r)) return;
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
    if (!isCurrent(r)) return;
    renderTopChange(slot, v, `?pr=${r.number}`);
  } catch (err) {
    slot.innerHTML = `<p class="cg-line rv-what-quiet">${err instanceof RateLimitError ? esc(limitLine(err, 'The before and after') ?? `GitHub limits anonymous reads. ${ghAction('see the before and after', prefersSignIn())}.`) : `Could not read the before and after: ${esc((err as Error).message)}`}</p>`;
  }
}

/** One exploration read again from its own repository (a closed or promoted one, or after a write). */
async function readOne(n: number, product: string | null): Promise<ExplorationRow | null> {
  const at = productRepoByKey(product);
  if (product && !at) return null;
  const p = (await ghGet<ExplorationPullLike>(`${at ? `/repos/${at.repo}` : R}/pulls/${n}`)).data;
  const tagged: ExplorationPullLike = at ? { ...p, repo: at.repo, product: at.product.key } : p;
  pullsBy.set(explorationKey(tagged), tagged);
  return explorationRows([tagged], CFG, { archived: 'include', ...(at ? { inProduct: at } : {}) })[0] ?? null;
}

async function rowFor(n: number, product: string | null, fresh = false): Promise<ExplorationRow | null> {
  // After a write (Done exploring, Archive) the list read at page load still holds the state it just left: read the
  // pull request again, and the lists after it.
  if (fresh) {
    if (product) void readProductPulls(true);
    void loadExplorations(undefined, true);
    const one = await readOne(n, product).catch(() => null);
    if (one) return one;
  }
  const list = await loadExplorations();
  const key = explorationKey({ number: n, product });
  const hit = list.find((x) => explorationKey(x) === key);
  if (hit) return hit;
  // A closed or promoted exploration is not in the open list: read it once.
  try {
    return await readOne(n, product);
  } catch {
    return null;
  }
}

/**
 * Opens an exploration in place (?exploration=N, &product=<key> when it lives in a product's own repository).
 * `after`: a write just changed it. `fresh` reads it again, `said` is the line the page it lands on shows.
 */
export async function openExploration(n: number, push = true, product: string | null = null, after: { fresh?: boolean; said?: string } = {}) {
  if (push) history.pushState({ exploration: n, product }, '', explorationHref({ number: n, product }));
  const d = $('rv-detail');
  d.hidden = false;
  d.innerHTML = `${crumbs(n, product)}<p class="rv-loading">Loading exploration #${n}</p>`;
  window.scrollTo({ top: 0 });
  const r = await rowFor(n, product, after.fresh === true);
  // Taken now: a list read finishing later replaces what the rows were read from.
  const pull = r ? pullOf(r) : undefined;
  const asked = explorationParam(location.search);
  if (asked?.number !== n || asked.product !== product) return;
  current = r;
  // A branch started for a product: the product branch page (its missing pieces and their library branches). In the
  // product's own repository, the repository says which product it is.
  if (r && pull) void repairLabel(r, pull);
  if (r && pull) {
    const pb = await import('./product-branch');
    const products = pb.siteProducts();
    const of = productRepoByKey(r.product)?.product ?? isProductBranch(pull.labels, products);
    // While it runs (boards X1 and X2): not started or exploring, for a product or the library.
    const xp = await import('./exploration-page');
    // After a write: read again, and the page it lands on says what happened.
    const reopen = (said?: string) => void openExploration(n, false, product, { fresh: true, ...(said ? { said } : {}) });
    if (xp.runsHere(r)) {
      pb.closeProductBranch();
      return xp.openExplorationPage(d, r, pull, of ?? defaultProduct(products), products, reopen, after.said);
    }
    xp.closeExplorationPage();
    if (of) return pb.openProductBranch(d, r, pull, of, products, reopen, after.said);
  }
  const at = product ? productRepoByKey(product) : null;
  const where = product ? (at?.product.name ?? product) : `${CFG.owner}/${CFG.repo}`;
  // The pull request on GitHub, in the repository the exploration lives in (the product's own one when it has one).
  const ghLink = product ? (at ? `https://github.com/${at.repo}/pull/${n}` : null) : `https://github.com/${CFG.owner}/${CFG.repo}/pull/${n}`;
  const line = unreadableExplorationLine(n, where, { product: Boolean(product), signedOut: !currentViewer() && !currentContributor() });
  d.innerHTML = r
    ? renderExplorationDetail(r, { connected: connected(), keeper: keeperOf(r) })
    : `${crumbs(n, product)}<p class="cg-muted">${esc(line)}${ghLink ? ` <a href="${attrUrl(ghLink)}" target="_blank" rel="noopener">${VOCAB.openOnGitHub}</a>.` : ''}</p>`;
  if (r && after.said) saySaid(after.said);
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

/** The line a write produced, in the state line of the detail. */
function saySaid(said: string) {
  const state = document.querySelector('#rv-detail .cg-pr-state');
  if (!state) return;
  state.textContent = said;
  state.setAttribute('role', 'status');
}

/** Paints the detail again from a fresh read of the pull request (after Done exploring or Archive). */
async function repaintDetail(target: Pick<ExplorationRow, 'number' | 'product'>, said: string) {
  const r = await readOne(target.number, target.product ?? null).catch(() => null);
  if (!r || !isCurrent(r)) return;
  current = r;
  $('rv-detail').innerHTML = renderExplorationDetail(r, { connected: connected(), keeper: keeperOf(r) });
  if (said) saySaid(said);
  void paintTryIt(r);
  void paintVisual(r);
}

/** The preview each request links to: a URL Vercel reported, never a template it may have shortened. */
function reportedPreview(r: ExplorationRow): string | null {
  const s = sourcesBy.get(explorationKey(r));
  if (!s) return null;
  return previewsOf(r, s).find((p) => p.url && p.source !== 'template' && p.state !== 'failed' && !p.skipped)?.url ?? null;
}

async function archive(btn: HTMLButtonElement) {
  if (!current) return;
  const r = current;
  const archived = !btn.hasAttribute('data-unarchive');
  actionError(null);
  setButtonBusy(btn, true, archived ? 'Archiving' : 'Unarchiving');
  try {
    await archiveExplorationOnGitHub(clientFor(r), r.number, { archived });
    if (r.product) void readProductPulls(true);
    void loadExplorations(undefined, true);
    await repaintDetail(r, archived ? ARCHIVED_LINE : 'Back in the lists.');
  } catch (err) {
    actionError((err as Error).message, err, 'archive explorations');
    setButtonBusy(btn, false, archived ? 'Archive' : 'Unarchive');
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
      $('rv-detail').innerHTML = renderExplorationDetail(current, { connected: connected(), keeper: keeperOf(current) });
      void paintTryIt(current);
      void paintVisual(current);
    }
  });
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const d = t.closest<HTMLButtonElement>('[data-ex-done]');
    if (d && current) {
      const r = current;
      actionError(null);
      // Done exploring: the dialog lists the new pieces to tick, then the branch goes to the developers. Nothing closes.
      // In a product's own repository the requests are filed in the design system's, where the DS lead works.
      return void askDoneExploring(r, pullOf(r)?.body, {
        client: () => clientFor(r),
        ...(r.product ? { library: client } : {}),
        previewUrl: reportedPreview(r),
        focus: d,
        after: (line) => {
          if (r.product) void readProductPulls(true);
          void loadExplorations(undefined, true);
          void repaintDetail(r, line);
        },
      });
    }
    const a = t.closest<HTMLButtonElement>('[data-ex-archive]');
    if (a) void archive(a);
  });
}
