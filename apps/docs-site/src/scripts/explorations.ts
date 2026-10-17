// Studio Changes > Explorations: the list (summary first), the detail in place (?exploration=N), the "Start an
// exploration" form, and Promote to review / Close. An exploration is a draft pull request labeled `exploration` on an
// `explore/<slug>` branch; starting, promoting and closing go through the core helpers (explorations-github.ts) with
// the viewer's token, the same code the MCP server and the CLI run. Reads stay inside the anonymous budget: the open
// pull requests In review already read, plus the request list the Requests view caches. Pure rules: lib/explorations-view.ts.
import { closeExplorationOnGitHub, EXPLORATION_PREFIX, EXPLORATION_TIER_LABEL, EXPLORATION_USE_CASES, GitHubClient, promoteExplorationOnGitHub, startExplorationOnGitHub, type ExplorationUseCase } from '@bridge-ds/core';
import {
  branchFor,
  explorationRows,
  explorationsSummary,
  implementOnCommand,
  openRequestNumbers,
  promoteCommand,
  runningCount,
  startCommand,
  startProblems,
  type ExplorationPullLike,
  type ExplorationRow,
  type ExplorationsConfig,
  tryItCopy,
  tryItFromComments,
} from '../lib/explorations-view';
import type { PullLike } from '../lib/requests-view';
import { currentViewer, esc, getToken, ghGet, initGitHubConnect, RateLimitError, readRepo, relativeTime, setButtonBusy } from './github-session';
import { loadRequestRows } from './requests';

const repo = readRepo();
const R = `/repos/${repo.owner}/${repo.repo}`;
const CFG: ExplorationsConfig = (() => {
  try {
    const b = JSON.parse(document.getElementById('bridge-branches')?.textContent || '{}') as Partial<ExplorationsConfig>;
    return { owner: b.owner ?? repo.owner, repo: b.repo ?? repo.repo, defaultBranch: b.defaultBranch ?? repo.defaultBranch, apps: b.apps ?? {}, packages: b.packages ?? [] };
  } catch {
    return { owner: repo.owner, repo: repo.repo, defaultBranch: repo.defaultBranch, apps: {}, packages: [] };
  }
})();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pill = (text: string, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;
const connected = () => Boolean(getToken() && currentViewer());
const client = () => new GitHubClient(`${CFG.owner}/${CFG.repo}`, getToken() ?? '', undefined, undefined, { protectedBranches: [CFG.defaultBranch], branchPrefix: EXPLORATION_PREFIX });

let rows: ExplorationRow[] = [];
let loaded: Promise<ExplorationRow[]> | null = null;
let openPullsSource: (() => Promise<ExplorationPullLike[] | null>) | null = null;

/** The tab count: running explorations, from the open pull requests the page already read. */
export function paintExplorationCount(pulls: ExplorationPullLike[]) {
  const n = runningCount(explorationRows(pulls, CFG));
  const count = $('ex-count');
  if (!count) return;
  count.textContent = String(n);
  count.hidden = n === 0;
}

function rowHtml(r: ExplorationRow) {
  const preview = r.previews[0];
  const reqs = r.requests.length ? `, ${r.requests.length} ${r.requests.length === 1 ? 'request' : 'requests'}` : '';
  return `<li class="cg-row ex-row" data-exploration="${r.number}">
    <div class="ex-row-main">
      <p class="ex-row-title"><a class="ex-name" href="?exploration=${r.number}" data-open-exploration="${r.number}">${esc(r.name)}</a> <span class="cg-num">#${r.number}</span> ${pill(r.statusLabel, `rv-status ${r.tone}`)}</p>
      ${r.purpose ? `<p class="ex-purpose">${esc(r.purpose)}</p>` : ''}
      <p class="ex-meta"><span class="mono">${esc(r.branch)}</span>, @${esc(r.author)}, updated <time datetime="${esc(r.updatedAt)}">${esc(shortDate(r.updatedAt))}</time>${esc(reqs)}${preview ? `, <a href="${esc(preview.url)}" target="_blank" rel="noopener">${esc(preview.label)} preview</a>` : ''}</p>
    </div>
  </li>`;
}

function paint() {
  const empty = rows.length === 0;
  $('ex-sentence').textContent = explorationsSummary(rows);
  $('ex-empty').hidden = !empty;
  $('ex-table').hidden = empty;
  $('ex-list').innerHTML = rows.map(rowHtml).join('');
  const n = runningCount(rows);
  const count = $('ex-count');
  count.textContent = String(n);
  count.hidden = n === 0;
}

async function readRows(): Promise<ExplorationRow[]> {
  const pulls = (openPullsSource ? await openPullsSource().catch(() => null) : null) ?? (await ghGet<ExplorationPullLike[]>(`${R}/pulls?state=open&per_page=100`)).data;
  const requests = await loadRequestRows({ openPulls: pulls as unknown as PullLike[], closed: false }).catch(() => []);
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
          ? 'GitHub limits anonymous reads to 60 an hour and this browser has used them. Connect GitHub, or try again later.'
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
  return { name: v('name'), purpose: v('purpose'), useCase: v('useCase') };
}

function paintStartAuth() {
  const on = connected();
  document.querySelectorAll<HTMLElement>('#ex-start [data-gh-only]').forEach((el) => (el.hidden = !on));
  document.querySelectorAll<HTMLElement>('#ex-start [data-no-gh]').forEach((el) => (el.hidden = on));
}

function paintStartPreview(form: HTMLFormElement) {
  const f = readStart(form);
  const branch = branchFor(f.name);
  $('ex-branch').textContent = branch ? `Creates ${branch} from ${CFG.defaultBranch} and a draft pull request labeled exploration.` : `Creates explore/<name> from ${CFG.defaultBranch} and a draft pull request labeled exploration.`;
  $('ex-start-cmd').textContent = startCommand(f);
  const uc = EXPLORATION_USE_CASES.find((u) => u.value === f.useCase);
  $('ex-uc-hint').textContent = uc ? uc.hint : 'Optional. It goes in the pull request, so reviewers know why it exists.';
}

function closeStart(focus = true) {
  const form = $<HTMLFormElement>('ex-start');
  const opener = $<HTMLButtonElement>('ex-start-open');
  form.reset();
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
  opener.addEventListener('click', () => {
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = readStart(form);
    const problems = startProblems(f);
    if (problems.length) {
      if (!branchFor(f.name)) form.querySelector('[name="name"]')?.setAttribute('aria-invalid', 'true');
      if (!f.purpose.trim()) form.querySelector('[name="purpose"]')?.setAttribute('aria-invalid', 'true');
      error.textContent = problems.join(' ');
      error.hidden = false;
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (!getToken()) {
      error.textContent = 'Connect GitHub to start it here, or run the command below in the design system repo.';
      error.hidden = false;
      return;
    }
    setButtonBusy(submit, true, 'Starting exploration');
    try {
      const s = await startExplorationOnGitHub(
        client(),
        { name: f.name, purpose: f.purpose, ...(f.useCase ? { useCase: f.useCase as ExplorationUseCase } : {}), ...(currentViewer()?.login ? { author: currentViewer()!.login } : {}) },
        { base: CFG.defaultBranch, packages: CFG.packages, apps: CFG.apps },
      );
      closeStart(false);
      const done = $('ex-done');
      done.hidden = false;
      done.innerHTML = `<p><strong>${esc(s.branch)} is ready.</strong> Draft pull request <a href="?exploration=${s.pr}" data-open-exploration="${s.pr}">#${s.pr}</a> is labeled exploration. Snapshots and previews appear after the first CI run.</p>`;
      void loadExplorations(undefined, true).then(() => {
        // The list from GitHub may not show the new pull request yet: keep it on screen.
        if (!rows.some((r) => r.number === s.pr)) $('ex-sentence').textContent = `${explorationsSummary(rows)} #${s.pr} appears here in a moment.`;
      });
    } catch (err) {
      error.textContent = (err as Error).message;
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

const crumbs = (n: number) => `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="?view=explorations" data-back-explorations>Explorations</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav>`;

function cmdRow(id: string, cmd: string, label: string) {
  return `<div class="rq-cmd-row"><code class="cg-cmd rq-cmd" id="${id}">${esc(cmd)}</code><button type="button" class="btn btn-secondary btn-sm" data-copy data-copy-from="${id}"><span data-copy-label>${esc(label)}</span></button></div>`;
}

function stateSentence(r: ExplorationRow): string {
  if (r.status === 'promoted') return `Promoted to review: #${r.number} is a normal pull request now and goes through the usual gates.`;
  if (r.status === 'closed') return 'Closed without merging. The branch stays for reference.';
  return `Running on ${r.branch}. It is never merged as is: promote it to review when the idea is validated, or close it.`;
}

export function renderExplorationDetail(r: ExplorationRow, opts: { connected: boolean }): string {
  const actions =
    r.status !== 'active'
      ? `<a class="btn btn-primary" href="?pr=${r.number}" data-open-pr="${r.number}">Open pull request #${r.number}</a>`
      : opts.connected
        ? `<button type="button" class="btn btn-primary" data-ex-promote="${r.number}">Promote to review</button> <button type="button" class="btn btn-secondary" data-ex-close-ask="${r.number}">Close</button>`
        : `<a class="btn btn-primary" href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub</a> <button type="button" class="btn btn-secondary" data-gh-open>Connect GitHub</button>`;
  const noToken =
    r.status === 'active' && !opts.connected
      ? `<p class="cg-muted ex-note">To promote it without connecting, use "Ready for review" on GitHub and remove the exploration label, or run <code class="mono">${esc(promoteCommand(r.slug))}</code>.</p>`
      : '';
  const previews = r.previews.length
    ? `<ul class="rq-prs">${r.previews.map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.label)}</a> <span class="cg-muted mono">${esc(new URL(p.url).host)}</span></li>`).join('')}</ul>`
    : '<p class="cg-muted">Preview deploys are not set up: add previews.apps to bridge.config.json.</p>';
  // Filled by paintTryIt from the pull request's preview comment: the command that works, never a guess.
  const install = CFG.packages.length
    ? `<div id="ex-tryit" aria-live="polite"><p class="cg-muted">Checking the test build.</p></div>`
    : '<p class="cg-muted">No snapshot package configured: add previews.packages to bridge.config.json.</p>';
  const reqs = r.requests.length
    ? `<ul class="rq-prs">${r.requests.map((q) => `<li><a href="?request=${q.number}" data-open-request="${q.number}">#${q.number} ${esc(q.component)}: ${esc(q.title)}</a> <span class="cg-muted">${esc(q.statusLabel)}</span></li>`).join('')}</ul>`
    : '<p class="cg-muted">No request is filed on this exploration yet.</p>';
  const first = r.requests.find((q) => q.open)?.number ?? null;
  const claude = `<p>Claude works on ${esc(r.branch)}, never on main, and never opens a pull request to main.</p>
    ${cmdRow('ex-implement-cmd', implementOnCommand(first, r.branch), 'Copy command')}
    <p class="cg-muted">In Claude Code with the Bridge MCP server, ask to work on exploration ${esc(r.slug)}: token edits take <span class="mono">branch: "${esc(r.branch)}"</span>, and <span class="mono">bridge_start_exploration</span> starts a new one.</p>`;
  return `${crumbs(r.number)}
  <header class="zone cg-pr-open">
    <h1 class="cg-pr-title">${esc(r.name)} <span class="cg-num">#${r.number}</span></h1>
    <p class="cg-pr-meta">${pill(r.statusLabel, `rv-status ${r.tone}`)}<span class="pill cg-tier">${esc(EXPLORATION_TIER_LABEL)}</span><span>@${esc(r.author)}</span><span>Updated ${esc(relativeTime(r.updatedAt))}</span><span class="mono">${esc(r.branch)}</span><a href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub</a></p>
    <p class="cg-pr-state">${esc(stateSentence(r))}</p>
    <p class="cg-pr-cta ex-actions" id="ex-actions">${actions}</p>
    ${noToken}
    <div class="ex-confirm" id="ex-confirm" hidden>
      <p>Close #${r.number} without merging? The branch stays for reference and the preview prerelease is removed.</p>
      <p class="ex-actions"><button type="button" class="btn btn-secondary rv-danger" data-ex-close="${r.number}">Close exploration</button> <button type="button" class="btn btn-secondary" data-ex-close-cancel>Keep it</button></p>
    </div>
    <p class="gh-error" id="ex-action-error" role="alert" hidden></p>
  </header>
  <div class="cg-secs">
    ${section('ex-sec-purpose', 'Purpose', esc(r.useCaseLabel ?? 'Exploration'), `<p class="rq-summary">${esc(r.purpose || 'The pull request has no Bridge exploration block. Open it on GitHub to read it.')}</p>`, true)}
    ${section('ex-sec-install', 'Try it in a product staging branch', CFG.packages.length ? `${CFG.packages.length} packages` : 'not set up', install, r.status === 'active')}
    ${section('ex-sec-previews', 'Previews', String(r.previews.length), previews)}
    ${section('ex-sec-requests', 'Requests', String(r.requests.length), reqs)}
    ${r.status === 'active' ? section('ex-sec-claude', 'Implement on this exploration', 'CLI or MCP', claude) : ''}
  </div>`;
}

let current: ExplorationRow | null = null;

/** The install command from the pull request's sticky preview comment (one read), or "being prepared". */
async function paintTryIt(r: ExplorationRow) {
  if (!document.getElementById('ex-tryit')) return;
  let html: string;
  try {
    const comments = (await ghGet<{ body?: string | null }[]>(`${R}/issues/${r.number}/comments?per_page=100`)).data;
    const t = tryItCopy(tryItFromComments(comments, r.headSha));
    html = `<p>${esc(t.sentence)}</p>${t.command ? cmdRow('ex-install-cmd', t.command, 'Copy install command') : ''}`;
  } catch (err) {
    html = `<p class="cg-muted">${err instanceof RateLimitError ? 'GitHub limits anonymous reads: connect GitHub to see the install command here.' : `Could not read the pull request comments: ${esc((err as Error).message)}.`} The "Try this exploration in your product" comment on <a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.number}</a> has it.</p>`;
  }
  const el = document.getElementById('ex-tryit');
  if (el && current?.number === r.number) el.innerHTML = html;
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
  d.innerHTML = r
    ? renderExplorationDetail(r, { connected: connected() })
    : `${crumbs(n)}<p class="cg-muted">#${n} is not an exploration in ${esc(`${CFG.owner}/${CFG.repo}`)}, or GitHub cannot be read right now. <a href="https://github.com/${esc(`${CFG.owner}/${CFG.repo}`)}/pull/${n}">Open it on GitHub</a>.</p>`;
  if (r) void paintTryIt(r);
}

function actionError(message: string | null) {
  const el = document.getElementById('ex-action-error');
  if (!el) return;
  el.textContent = message ?? '';
  el.hidden = message === null;
}

async function promote(btn: HTMLButtonElement) {
  if (!current) return;
  const r = current;
  actionError(null);
  setButtonBusy(btn, true, 'Promoting');
  try {
    const p = await promoteExplorationOnGitHub(client(), r.number, { requests: openRequestNumbers(r) });
    const warn = p.warnings.length ? `<p class="cg-muted">${p.warnings.map(esc).join(' ')}</p>` : '';
    $('ex-actions').innerHTML = `<a class="btn btn-primary" href="?pr=${r.number}" data-open-pr="${r.number}">Review pull request #${r.number}</a>`;
    $('ex-actions').insertAdjacentHTML('afterend', `<p class="ex-done" role="status"><strong>Promoted to review.</strong> Tier ${p.tier}, ready for review${p.addLabels.length ? `, labeled ${esc(p.addLabels.join(', '))}` : ''}.</p>${warn}`);
    void loadExplorations(undefined, true);
  } catch (err) {
    actionError(`${(err as Error).message} You can also use "Ready for review" on GitHub, or ${promoteCommand(r.slug)}.`);
    setButtonBusy(btn, false, 'Promote to review');
  }
}

async function close(btn: HTMLButtonElement) {
  if (!current) return;
  const r = current;
  actionError(null);
  setButtonBusy(btn, true, 'Closing');
  try {
    await closeExplorationOnGitHub(client(), r.number);
    $('ex-confirm').hidden = true;
    $('ex-actions').innerHTML = `<a class="btn btn-secondary" href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub</a>`;
    $('ex-actions').insertAdjacentHTML('afterend', '<p class="ex-done" role="status"><strong>Closed.</strong> The branch stays for reference.</p>');
    void loadExplorations(undefined, true);
  } catch (err) {
    actionError((err as Error).message);
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
    if (current && !$('rv-detail').hidden && new URLSearchParams(location.search).get('exploration')) $('rv-detail').innerHTML = renderExplorationDetail(current, { connected: connected() });
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
