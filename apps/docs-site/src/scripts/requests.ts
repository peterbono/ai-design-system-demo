// Component change requests in the browser: the Changes > Requests list and its detail (?request=N), and the open
// count the Overview shows. Requests are GitHub issues labeled component-change; a pull request that says
// "Closes #N" implements one. Reads stay inside the anonymous budget: one issues list, plus the open pull requests the
// page already has (or one list read) and one closed pull request list, each kept in sessionStorage for 10 minutes.
// Pure rules live in lib/requests-view.ts.
import { closingIssueNumbers, REQUEST_LABEL, type IntegrationsConfig } from '@bridge-ds/core';
import {
  buildState,
  freshList,
  implementCommand,
  onItLabel,
  requestImages,
  requestStateLine,
  requestRows,
  requestsCacheKey,
  requestsSummary,
  type CachedList,
  type IssueLike,
  type PullLike,
  type RequestRow,
} from '../lib/requests-view';
import { esc, ghGet, RateLimitError, readRepo } from './github-session';

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
    <span class="rq-meta">${esc(r.kindLabel)}${r.requester ? `, asked by @${esc(r.requester)}` : ''}${r.jiraKey ? `, <span class="mono">${esc(r.jiraKey)}</span>` : ''}</span></span>
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

export function renderRequestDetail(r: RequestRow): string {
  const req = r.request;
  const open = r.prs.find((p) => p.state === 'open');
  const merged = r.prs.find((p) => p.merged);
  const pr = open ?? merged;
  // One primary action, only when there is something to look at: the change that builds the request.
  const primary = pr ? `<a class="btn btn-primary btn-lg" href="?pr=${pr.number}" data-open-pr="${pr.number}">${open ? 'Review the change' : 'Open the change'}</a>` : '';
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
    ? `<ul class="rq-prs">${r.prs.map((p) => `<li><a href="?pr=${p.number}" data-open-pr="${p.number}">Change #${p.number}</a> <span class="cg-muted">${p.merged ? 'shipped' : p.state === 'open' ? 'in review' : 'closed'}${p.author ? `, by @${esc(p.author)}` : ''}</span></li>`).join('')}</ul>`
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
    <p class="cg-pr-meta">${pill(r.kindLabel)}${pill(r.statusLabel, `rv-status ${r.tone}`)}${r.requester ? `<span>Asked by @${esc(r.requester)}</span>` : ''}<time datetime="${esc(r.createdAt)}">${esc(shortDate(r.createdAt))}</time>${jira}<a href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub</a></p>
    <p class="cg-pr-state">${esc(requestStateLine(r))}</p>
    ${primary ? `<p class="cg-pr-cta">${primary}</p>` : ''}
  </header>
  <div class="cg-secs">
    ${section('rq-sec-summary', 'Summary', esc(r.kindLabel), `<p class="rq-summary">${esc(req?.summary || 'The issue has no Bridge summary. Open it on GitHub to read it.')}</p>${design}`, true)}
    ${pictures ? section('rq-sec-images', pictures.title, '', pictures.body, true) : ''}
    ${section('rq-sec-changes', 'Changes', String(changes.length), table, changes.length > 0)}
    ${r.prs.length ? section('rq-sec-build', 'Built by a developer', esc(build), buildBody) : ''}
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
  d.innerHTML = r
    ? renderRequestDetail(r)
    : `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="?view=requests" data-back-requests>Requests</a><span aria-hidden="true">/</span><span class="mono">#${n}</span></nav><p class="cg-muted">#${n} is not a component change request in ${esc(REPO_KEY)}, or GitHub cannot be read right now. <a href="https://github.com/${esc(REPO_KEY)}/issues/${n}">Open it on GitHub</a>.</p>`;
}
