// Component change requests in the browser: the Changes > Requests list and its detail (?request=N), and the open
// count the Overview shows. Requests are GitHub issues labeled component-change; a pull request that says
// "Closes #N" implements one. Reads stay inside the anonymous budget: one issues list, plus the open pull requests the
// page already has (or one list read) and one closed pull request list, each kept in sessionStorage for 10 minutes.
// Pure rules live in lib/requests-view.ts.
import { assignRequestOnGitHub, closingIssueNumbers, declineReasonProblems, declineRequestOnGitHub, REQUEST_LABEL, REQUEST_STATUS_LABEL, requestIssueTitle, type IntegrationsConfig } from '@bridge-ds/core';
import {
  assigneeOptions,
  buildState,
  declineAudience,
  requestDecision,
  requestTone,
  freshList,
  implementCommand,
  onItLabel,
  requestImages,
  wantsToChange,
  requestRows,
  requestsCacheKey,
  requestsSummary,
  type CachedList,
  type IssueLike,
  type PullLike,
  type RequestRow,
} from '../lib/requests-view';
import { currentViewer, esc, getToken, ghGet, hasWorkingToken, initGitHubConnect, RateLimitError, readRepo, studioClient } from './github-session';
import { owners } from './pr-status';
import { ASSIGN_EVENT, DECLINE_EVENT, type AssignAskDetail, type DeclineAskDetail } from '../components/ds/studio/RequestDecide';

const repo = readRepo();
const REPO_KEY = `${repo.owner}/${repo.repo}`;
const R = `/repos/${repo.owner}/${repo.repo}`;

export const integrations = (): IntegrationsConfig => {
  try {
    return (JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { integrations?: IntegrationsConfig }).integrations ?? {};
  } catch {
    return {};
  }
};

function readCache<T>(what: 'issues' | 'closed-pulls'): CachedList<T> | null {
  try {
    const raw = sessionStorage.getItem(requestsCacheKey(REPO_KEY, what));
    return raw ? (JSON.parse(raw) as CachedList<T>) : null;
  } catch {
    return null;
  }
}

function writeCache(what: 'issues' | 'closed-pulls', data: unknown[]) {
  try {
    sessionStorage.setItem(requestsCacheKey(REPO_KEY, what), JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* private mode or quota: no cache, one more read next time */
  }
}

/** Forget the cached list (a request was just opened from this browser). */
export function forgetRequests() {
  try {
    sessionStorage.removeItem(requestsCacheKey(REPO_KEY, 'issues'));
  } catch {
    /* ignore */
  }
}

// Only what the view reads is kept: the cache stays small and a pull request body shrinks to its closing refs.
const slimIssue = (i: IssueLike): IssueLike => ({
  number: i.number,
  title: i.title,
  body: i.body ?? '',
  html_url: i.html_url,
  state: i.state,
  state_reason: i.state_reason ?? null,
  labels: i.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
  user: i.user ? { login: i.user.login } : null,
  assignees: (i.assignees ?? []).map((a) => ({ login: a.login })),
  created_at: i.created_at,
});
const slimPull = (p: PullLike): PullLike => ({
  number: p.number,
  body: closingIssueNumbers(p.body)
    .map((n) => `Closes #${n}`)
    .join(' '),
  state: p.state,
  merged_at: p.merged_at ?? null,
  html_url: p.html_url,
  user: p.user ? { login: p.user.login } : null,
  head: p.head ? { ref: p.head.ref } : null,
});

async function cachedList<T>(what: 'issues' | 'closed-pulls', path: string, slim: (x: T) => T): Promise<T[]> {
  const hit = readCache<T>(what);
  if (freshList(hit, Date.now())) return hit.data;
  const f = await ghGet<T[]>(path);
  const data = f.data.map(slim);
  if (!f.stale) writeCache(what, data);
  return data;
}

/**
 * Request rows, newest waiting first. `openPulls`: the open pull requests the page already read (no request then).
 * `closed: false` skips the closed pull request list (the Overview only needs what waits).
 */
export async function loadRequestRows(opts: { openPulls?: PullLike[] | null; closed?: boolean } = {}): Promise<RequestRow[]> {
  const issues = await cachedList<IssueLike>('issues', `${R}/issues?labels=${encodeURIComponent(REQUEST_LABEL)}&state=all&per_page=50&sort=created&direction=desc`, slimIssue);
  if (!issues.length) return [];
  const open = opts.openPulls?.every((p) => 'body' in p) ? opts.openPulls : (await ghGet<PullLike[]>(`${R}/pulls?state=open&per_page=100`)).data;
  const closed = opts.closed === false ? [] : await cachedList<PullLike>('closed-pulls', `${R}/pulls?state=closed&per_page=50&sort=updated&direction=desc`, slimPull).catch(() => []);
  return requestRows(issues, [...open, ...closed]);
}

// ---------------------------------------------------------------------------------------------------------------
// Changes > Requests

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pill = (text: string, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;

let rows: RequestRow[] = [];
let loaded: Promise<RequestRow[]> | null = null;

function jiraUrl(key: string): string | null {
  const base = integrations().jira?.baseUrl;
  return base ? `${base.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}` : null;
}

/** The row thumbnail: the request's first image, else the component's preview (filled from #rq-previews). */
function thumbHtml(r: RequestRow) {
  const img = requestImages(r).thumb;
  return img
    ? `<span class="rq-thumb" aria-hidden="true"><img src="${esc(img)}" alt="" loading="lazy" /></span>`
    : `<span class="rq-thumb" aria-hidden="true" data-preview="${esc(r.component)}"></span>`;
}

function rowHtml(r: RequestRow) {
  return `<li class="cg-row" data-request="${r.number}"><a class="cg-row-link rq-row-link" href="?request=${r.number}" data-open-request="${r.number}">
    ${thumbHtml(r)}
    <span class="rq-row-main"><span class="cg-row-title"><span class="cg-row-name" title="${esc(r.title)}"><span class="rq-comp">${esc(r.component)}</span> ${esc(r.title)}</span> <span class="cg-num">#${r.number}</span></span>
    <span class="rq-meta">${esc(wantsToChange(r.requester, r.component))}, ${esc(r.kindLabel.toLowerCase())}${r.jiraKey ? `, <span class="mono">${esc(r.jiraKey)}</span>` : ''}</span></span>
    <span class="rq-onit">${esc(onItLabel(r))}</span>
    ${pill(r.statusLabel, `rv-status ${r.tone}`)}
    <time class="cg-date" datetime="${esc(r.createdAt)}">${esc(shortDate(r.createdAt))}</time></a></li>`;
}

/** Component previews rendered at build time, cloned into the rows that have no image of their own. */
function fillPreviews(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.rq-thumb[data-preview]').forEach((slot) => {
    const tpl = document.querySelector<HTMLTemplateElement>(`#rq-previews template[data-component="${CSS.escape(slot.dataset.preview ?? '')}"]`);
    if (!tpl) return;
    const box = document.createElement('span');
    box.className = 'rq-thumb-scale';
    box.setAttribute('inert', '');
    box.append(tpl.content.cloneNode(true));
    slot.append(box);
  });
}

function paint() {
  const empty = rows.length === 0;
  $('rq-empty').hidden = !empty;
  $('rq-opener').hidden = empty;
  $('rq-sentence').textContent = requestsSummary(rows);
  // Open work at rest; done and declined ones collapsed below, with their count.
  const open = rows.filter((r) => r.status === 'requested' || r.status === 'in-progress');
  const closed = rows.filter((r) => r.status === 'done' || r.status === 'declined');
  $('rq-table').hidden = empty || open.length === 0;
  $('rq-list').innerHTML = open.map(rowHtml).join('');
  fillPreviews($('rq-list'));
  $('rq-closed').hidden = closed.length === 0;
  $('rq-closed-n').textContent = String(closed.length);
  $('rq-closed-list').innerHTML = closed.map(rowHtml).join('');
  fillPreviews($('rq-closed-list'));
  const waiting = rows.filter((r) => r.status === 'requested').length;
  const count = $('rq-count');
  count.textContent = String(waiting);
  count.hidden = waiting === 0;
}

/** Loads (once per page) and paints the Requests view. */
export function loadRequests(openPulls?: Promise<PullLike[] | null>): Promise<RequestRow[]> {
  loaded ??= (async () => {
    const list = $('rq-list');
    list.setAttribute('aria-busy', 'true');
    try {
      rows = await loadRequestRows({ openPulls: openPulls ? await openPulls.catch(() => null) : null });
      paint();
    } catch (err) {
      $('rq-table').hidden = true;
      $('rq-sentence').textContent =
        err instanceof RateLimitError
          ? 'GitHub limits anonymous reads to 60 an hour and this browser has used them. Connect GitHub, or try again later.'
          : `Could not load requests: ${(err as Error).message}.`;
    } finally {
      list.removeAttribute('aria-busy');
    }
    return rows;
  })();
  return loaded;
}

function section(id: string, title: string, meta: string, body: string, open = false) {
  return `<details class="cg-sec" id="${id}"${open ? ' open' : ''}><summary class="cg-sec-head"><span class="cg-sec-title">${title}</span><span class="cg-sec-meta">${meta}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary><div class="cg-sec-body">${body}</div></details>`;
}

/** Before and after side by side, each with its label, or the single image the request carries. */
function picturesHtml(r: RequestRow): { title: string; body: string } | null {
  const { pair, single } = requestImages(r);
  const figure = (src: string, label: string, alt: string) =>
    `<figure class="rq-fig">${label ? `<figcaption class="rq-fig-cap">${esc(label)}</figcaption>` : ''}<a href="${esc(src)}" target="_blank" rel="noopener"><img class="rq-img" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" /></a></figure>`;
  if (pair) {
    return {
      title: 'Before and after',
      body: `<div class="rq-pair-imgs">${figure(pair.before, 'Before: the baseline', `${r.component} before`)}${figure(pair.after, 'After: in Figma', `${r.component} after, in Figma`)}</div>`,
    };
  }
  if (!single.length) return null;
  const fromFigma = r.request?.source === 'figma';
  return {
    title: single.length === 1 ? (fromFigma ? 'In Figma' : 'Image') : 'Images',
    body: `<div class="rq-imgs">${single.map((u, i) => figure(u, single.length === 1 ? '' : `Image ${i + 1}`, `${r.component} design ${i + 1}`)).join('')}</div>`,
  };
}

export interface DetailContext {
  viewer: string | null;
  /** Design and tech owners after rights: they decide on a request nobody is on. */
  owners: string[];
}

/** The viewer and the owners, read now (the viewer changes when someone connects). */
export function detailContext(): DetailContext {
  const o = owners();
  return { viewer: hasWorkingToken() ? (currentViewer()?.login ?? null) : null, owners: [...new Set([...o.design, ...o.tech])] };
}

/**
 * The top action. While nobody is on the request and the viewer decides: Start an exploration (primary), Assign
 * someone and Decline, on one row (wired in initRequests). Otherwise the change or the exploration that builds it.
 */
function primaryAction(r: RequestRow, decide: boolean): string {
  if (decide)
    return `<a class="btn btn-primary btn-lg" href="?view=explorations&amp;for=${r.number}" data-start-for="${r.number}">Start an exploration</a><button type="button" class="btn btn-secondary btn-lg" data-rq-assign="${r.number}">Assign someone</button><button type="button" class="btn btn-secondary btn-lg" data-rq-decline="${r.number}">Decline</button>`;
  const open = r.prs.find((p) => p.state === 'open');
  const pr = open ?? r.prs.find((p) => p.merged);
  if (!pr) return '';
  if (pr.exploration) return `<a class="btn btn-primary btn-lg" href="?exploration=${pr.number}" data-open-exploration="${pr.number}">Open the exploration</a>`;
  return `<a class="btn btn-primary btn-lg" href="?pr=${pr.number}" data-open-pr="${pr.number}">${open ? 'Review the change' : 'Open the change'}</a>`;
}

export function renderRequestDetail(r: RequestRow, ctx: DetailContext = { viewer: null, owners: [] }): string {
  const req = r.request;
  const decision = requestDecision(r, ctx);
  const primary = primaryAction(r, decision.kind === 'decide');
  const jira = r.jiraKey ? (jiraUrl(r.jiraKey) ? `<a href="${esc(jiraUrl(r.jiraKey)!)}" target="_blank" rel="noopener">${esc(r.jiraKey)}</a>` : `<span class="mono">${esc(r.jiraKey)}</span>`) : '';
  const changes = req?.changes ?? [];
  const table = changes.length
    ? `<div class="table-wrap"><table class="rv-table"><thead><tr><th scope="col">What</th><th scope="col">Now</th><th scope="col">Requested</th></tr></thead><tbody>${changes
        .map((c) => `<tr><th scope="row" class="mono">${esc(c.field)}</th><td>${esc(c.before ?? '') || '<span class="cg-muted">none</span>'}</td><td>${esc(c.after ?? '') || '<span class="cg-muted">removed</span>'}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="cg-muted">No field-by-field change listed. The summary says what to do.</p>';
  const pictures = picturesHtml(r);
  const design = req?.figma?.url ? `<p><a href="${esc(req.figma.url)}" target="_blank" rel="noopener">Open the design in Figma${req.figma.nodeName ? `: ${esc(req.figma.nodeName)}` : ''}</a></p>` : '';
  const build = buildState(r);
  const buildBody = r.prs.length
    ? `<ul class="rq-prs">${r.prs
        .map((p) =>
          p.exploration
            ? `<li><a href="?exploration=${p.number}" data-open-exploration="${p.number}">Exploration #${p.number}</a> <span class="cg-muted">${p.state === 'open' ? 'running' : p.merged ? 'shipped' : 'closed'}${p.author ? `, by @${esc(p.author)}` : ''}</span></li>`
            : `<li><a href="?pr=${p.number}" data-open-pr="${p.number}">Change #${p.number}</a> <span class="cg-muted">${p.merged ? 'shipped' : p.state === 'open' ? 'in review' : 'closed'}${p.author ? `, by @${esc(p.author)}` : ''}</span></li>`,
        )
        .join('')}</ul>`
    : '';
  const cmd = implementCommand(r.number);
  const active = r.status === 'requested' || r.status === 'in-progress';
  const dev = `<details class="cg-sec cg-dev" id="rq-sec-dev"><summary class="cg-sec-head"><span class="cg-sec-title">For developers</span><span class="cg-sec-meta">${active ? 'Implement with Claude, GitHub' : 'GitHub'}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
    <div class="cg-sec-body">
      <p>GitHub issue <a href="${esc(r.url)}" target="_blank" rel="noopener">#${r.number}</a>, labeled <span class="mono">component-change</span>. The pull request that implements it says "Closes #${r.number}".${
        r.prs.length ? ` Linked: ${r.prs.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">pull request #${p.number}</a>`).join(', ')}.` : ''
      }</p>
      ${
        active
          ? `<h3 class="ex-dev-h">Implement with Claude</h3>
      <p>Claude reads the request, the component's files and the repo rules, then opens a pull request that closes #${r.number}.</p>
      <div class="rq-cmd-row"><code class="cg-cmd rq-cmd" id="rq-cmd">${esc(cmd)}</code><button type="button" class="btn btn-secondary btn-sm" data-copy data-copy-from="rq-cmd"><span data-copy-label>Copy command</span></button></div>
      <p class="cg-muted">In Claude with the Bridge MCP server, ask for the <span class="mono">bridge_get_request</span> tool with request ${r.number}.</p>`
          : ''
      }
    </div></details>`;

  return `
  <nav class="cg-crumbs" aria-label="Breadcrumb"><a href="?view=requests" data-back-requests>Requests</a><span aria-hidden="true">/</span><span class="mono">#${r.number}</span></nav>
  <header class="zone cg-pr-open">
    <h1 class="cg-pr-title">${esc(r.component)}: ${esc(r.title.charAt(0).toLowerCase() + r.title.slice(1))} <span class="cg-num">#${r.number}</span></h1>
    <p class="cg-pr-meta">${pill(r.kindLabel)}${pill(r.statusLabel, `rv-status ${r.tone}`)}<span>${esc(wantsToChange(r.requester, r.component))}</span><time datetime="${esc(r.createdAt)}">${esc(shortDate(r.createdAt))}</time>${jira}<a href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub</a></p>
    <p class="cg-pr-state" id="rq-state" role="status" tabindex="-1">${esc(decision.sentence)}</p>
    ${primary ? `<p class="cg-pr-cta rq-decide" id="rq-actions">${primary}</p>` : ''}
    <div id="rq-assign-slot" hidden></div>
  </header>
  <div class="cg-secs">
    ${section('rq-sec-summary', 'Summary', esc(r.kindLabel), `<p class="rq-summary">${esc(req?.summary || 'The issue has no Bridge summary. Open it on GitHub to read it.')}</p>${design}`, true)}
    ${pictures ? section('rq-sec-images', pictures.title, '', pictures.body, true) : ''}
    ${section('rq-sec-changes', 'Changes', String(changes.length), table, changes.length > 0)}
    ${r.prs.length ? section('rq-sec-build', 'Where it is built', esc(build), buildBody) : ''}
    ${dev}
  </div>`;
}

/** Opens a request in place (?request=N), from the loaded list. */
export async function openRequest(n: number, push = true, openPulls?: Promise<PullLike[] | null>) {
  if (push) history.pushState({ request: n }, '', `?request=${n}`);
  const d = $('rv-detail');
  d.hidden = false;
  d.innerHTML = `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="?view=requests" data-back-requests>Requests</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav><p class="rv-loading">Loading request #${n}</p>`;
  window.scrollTo({ top: 0 });
  const list = await loadRequests(openPulls);
  const r = list.find((x) => x.number === n);
  if (Number(new URLSearchParams(location.search).get('request')) !== n) return;
  current = r ?? null;
  d.innerHTML = r
    ? renderRequestDetail(r, detailContext())
    : `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="?view=requests" data-back-requests>Requests</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav><p class="cg-muted">#${n} is not a component change request in ${esc(REPO_KEY)}, or GitHub cannot be read right now. <a href="https://github.com/${esc(REPO_KEY)}/issues/${n}">Open it on GitHub</a>.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Deciding on a request nobody is on: Assign someone (a DS Combobox in place) and Decline (a DS Dialog), from
// components/ds/studio/RequestDecide, with the viewer's own token. Start an exploration opens the Explorations form
// filled from the request (scripts/explorations.ts startForRequest).

let current: RequestRow | null = null;

const client = () => studioClient(REPO_KEY, getToken() ?? '');

/** The detail again, after a decision or a connect: the decision zone becomes the status sentence. */
function repaint() {
  const d = document.getElementById('rv-detail');
  if (!current || !d || d.hidden || Number(new URLSearchParams(location.search).get('request')) !== current.number) return;
  d.innerHTML = renderRequestDetail(current, detailContext());
}

/** A decision changes the row in place (the list shows it too) and drops the cached list. */
function changed(r: RequestRow, patch: Partial<Pick<RequestRow, 'assignees' | 'status'>>) {
  Object.assign(r, patch);
  r.statusLabel = REQUEST_STATUS_LABEL[r.status];
  r.tone = requestTone(r.status);
  forgetRequests();
  if (document.getElementById('rq-list')) paint();
  repaint();
}

/** After a decision: focus lands on the sentence that now says who is on it. */
const focusState = () => requestAnimationFrame(() => document.getElementById('rq-state')?.focus());

/** The decision row and the assign slot swap: one set of actions at a time. */
function showAssign(on: boolean) {
  const row = document.getElementById('rq-actions');
  const slot = document.getElementById('rq-assign-slot');
  if (row) row.hidden = on;
  if (slot) slot.hidden = !on;
}

function assign(btn: HTMLButtonElement) {
  const r = current;
  const slot = document.getElementById('rq-assign-slot');
  if (!r || !slot) return;
  const o = owners();
  const role = (who: string) => {
    const l = who.toLowerCase();
    const design = o.design.some((x) => x.toLowerCase() === l);
    const tech = o.tech.some((x) => x.toLowerCase() === l);
    return design && tech ? 'Design and tech owner' : design ? 'Design owner' : tech ? 'Tech owner' : undefined;
  };
  showAssign(true);
  const detail: AssignAskDetail = {
    number: r.number,
    title: requestIssueTitle(r),
    slot,
    people: async () => {
      try {
        const people = await client().listCollaborators('push');
        return assigneeOptions(people, currentViewer()?.login ?? null).map((p) => {
          const d = role(p.value);
          return d ? { ...p, description: d } : p;
        });
      } catch (err) {
        throw new Error(`Could not read who can edit the library: ${(err as Error).message}`);
      }
    },
    confirm: async (who) => {
      const assignees = await assignRequestOnGitHub(client(), r.number, who);
      changed(r, { assignees });
    },
    closed: (done) => {
      if (done) return focusState();
      showAssign(false);
      if (btn.isConnected) btn.focus();
    },
  };
  document.dispatchEvent(new CustomEvent(ASSIGN_EVENT, { detail }));
}

function decline(btn: HTMLButtonElement) {
  const r = current;
  if (!r) return;
  const detail: DeclineAskDetail = {
    number: r.number,
    title: requestIssueTitle(r),
    audience: declineAudience(r.requester),
    problems: declineReasonProblems,
    confirm: async (reason) => {
      await declineRequestOnGitHub(client(), r.number, reason, currentViewer()?.login ?? null);
      changed(r, { status: 'declined' });
    },
    closed: (done) => {
      if (done) focusState();
      else if (btn.isConnected) btn.focus();
    },
  };
  document.dispatchEvent(new CustomEvent(DECLINE_EVENT, { detail }));
}

let wired = false;

/** Wires the decision buttons once, and paints the detail again when someone connects or disconnects. */
export function initRequests() {
  if (wired) return;
  wired = true;
  initGitHubConnect(repaint);
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLButtonElement>('[data-rq-assign]');
    if (a) return void assign(a);
    const d = t.closest<HTMLButtonElement>('[data-rq-decline]');
    if (d) return void decline(d);
  });
}

/** A request from the loaded list (or one list read), for the Start an exploration form. */
export async function requestRow(n: number): Promise<RequestRow | null> {
  const list = rows.length ? rows : await loadRequestRows({ closed: false }).catch(() => []);
  return list.find((x) => x.number === n) ?? null;
}
