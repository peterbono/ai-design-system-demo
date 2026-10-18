// Changes > History: the next release on top (from the release pull request the changesets action keeps open, with
// the action owned by whoever holds the ship right), then one timeline of shipped token changes grouped by release,
// an entry detail with the designer diff, and "Undo this change" (the side panel in ./planner). Real history only in
// production; in development the demo switch at the bottom swaps in the fixture report and a banner. Filters wait
// behind the Filter button.
import type { HistoryEntry, HistoryFilter, HistoryReport } from '@bridge-ds/core';
import { authorsOf, countsLabel, shortDate, viewTimeline } from '../../lib/history-view';
import { renderTokenReview } from '../reviews';
import { currentViewer, esc, ghGet, hasWorkingToken, initGitHubConnect, readRepo } from '../github-session';
import { mdTitleHtml } from '../../lib/markdown';
import { approvalNeedLabel, releasePull, type QueuePull } from '../../lib/review-queue';
import { historySummary, parseReleaseBody, releaseCard } from '../../lib/release-view';
import { owners, shippers } from '../pr-status';
import { loadTeams } from '../teams';
import { openRevertPlanner } from './planner';
import { activeReport, DEMO_EVENT, demoOn, loadHistory, setDemo, type Loaded } from './state';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let L: Loaded | null = null;
const BASE = '/studio/changes/?view=history';

const repoUrl = () => {
  const r = L?.config.repo;
  if (r) return `https://github.com/${r.owner}/${r.name}`;
  const x = readRepo();
  return `https://github.com/${x.owner}/${x.repo}`;
};

function current(): { report: HistoryReport | null; demo: boolean } {
  return L ? activeReport(L.data) : { report: null, demo: false };
}

function filter(): HistoryFilter {
  const token = $<HTMLInputElement>('hs-token').value.trim();
  const author = $<HTMLSelectElement>('hs-author').value;
  const tier = Number($<HTMLSelectElement>('hs-tier').value);
  return { ...(token ? { token } : {}), ...(author ? { author } : {}), ...(tier ? { tier: tier as 1 | 2 | 3 } : {}) };
}

const entryHref = (e: HistoryEntry) => `${BASE}&entry=${encodeURIComponent(e.id)}`;
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
/** A human summary (the changeset line the author wrote, else the cleaned title), never a raw commit subject. */
const title = (e: HistoryEntry) => historySummary(e);

/** A row: summary and #, what approval it needed in plain words (or Demo), the date. Counts live in the detail. */
function row(e: HistoryEntry, demo: boolean): string {
  const num = e.pr ? ` <span class="cg-num">#${e.pr.number}</span>` : '';
  const tag = `<span class="cg-need">${e.bulk ? 'Import' : `${demo ? 'Demo, ' : ''}${approvalNeedLabel(e.tier)}`}</span>`;
  return `<li class="cg-row"><a class="cg-row-link" href="${entryHref(e)}" data-hs-open="${esc(e.id)}">
    <span class="cg-row-title"><span class="cg-row-name" title="${esc(title(e))}">${esc(title(e))}</span>${num}</span>
    ${tag}
    <time class="cg-date" datetime="${esc(e.date)}">${esc(dayMonth(e.date))}</time></a></li>`;
}

/** Imports and restructures fold into one line per release, opened on demand. */
function importsRow(items: HistoryEntry[], demo: boolean): string {
  if (!items.length) return '';
  const edits = items.reduce((n, e) => n + e.counts.total, 0);
  return `<li class="cg-row cg-imports"><details><summary class="cg-imports-sum"><span class="cg-row-title">${items.length} ${items.length === 1 ? 'import' : 'imports'}, ${edits.toLocaleString('en-US')} token edits</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
    <ul class="cg-list">${items.map((e) => row(e, demo)).join('')}</ul></details></li>`;
}

function paintList() {
  const { report, demo } = current();
  const tl = $('hs-timeline');
  tl.setAttribute('aria-busy', 'false');
  $('hs-banner').hidden = !demo;
  document.getElementById('hs-demo')?.setAttribute('aria-checked', String(demo));
  const entries = report?.entries ?? [];
  // Filters follow the report on screen.
  const authorSel = $<HTMLSelectElement>('hs-author');
  const keep = authorSel.value;
  authorSel.innerHTML = `<option value="">Anyone</option>${authorsOf(entries).map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}`;
  authorSel.value = authorsOf(entries).includes(keep) ? keep : '';
  const paths = [...new Set(entries.filter((e) => !e.bulk).flatMap((e) => e.changes.map((c) => c.path)))].sort();
  $('hs-paths').innerHTML = paths.map((p) => `<option value="${esc(p)}"></option>`).join('');

  if (!report || !entries.length) {
    tl.innerHTML = `<p class="cg-muted">No shipped token change yet. Changes land here once a change from Tokens ships.</p>`;
    $('hs-none').hidden = true;
    return;
  }
  const groups = viewTimeline(report, filter());
  $('hs-none').hidden = groups.length > 0;
  tl.innerHTML = groups
    .map((g) => {
      const name = g.version === 'Unreleased' ? 'Next release' : `Version ${g.version}`;
      // Token changes only: the "Next release" card above counts every change, this group the token ones.
      const facts = [`${g.items.length} token ${g.items.length === 1 ? 'change' : 'changes'}`, g.breaking ? 'breaking' : '', `${g.pending ? 'latest' : 'released'} ${shortDate(g.date)}`].filter(Boolean).join(', ');
      const reviewable = g.items.filter((e) => !e.bulk);
      const imports = g.items.filter((e) => e.bulk);
      return `<section class="cg-rel" aria-label="${esc(name)}"><h2 class="cg-rel-h">${esc(name)} <span class="cg-rel-meta">${esc(facts)}</span></h2>
        <ul class="fg-card cg-list">${reviewable.map((e) => row(e, demo)).join('')}${importsRow(imports, demo)}</ul></section>`;
    })
    .join('');
}

function paintDetail(e: HistoryEntry, demo: boolean) {
  const review = L!.data.reviews[`${demo ? 'demo' : 'real'}:${e.id}`];
  const diff = e.bulk
    ? `<p class="cg-muted">Imports are listed, not diffed. First ${Math.min(40, e.changes.length)} of ${e.changes.length} tokens:</p><ul class="hs-paths">${e.changes
        .slice(0, 40)
        .map((c) => `<li><span class="mono">${esc(c.path)}</span> <span class="cg-muted">${esc(c.kind)}</span></li>`)
        .join('')}</ul>`
    : review
      ? renderTokenReview(review)
      : '<p class="cg-muted">No designer diff for this change.</p>';
  const ref = demo
    ? 'Fixture change'
    : [e.pr ? `<a href="${esc(e.pr.url ?? `${repoUrl()}/pull/${e.pr.number}`)}">#${e.pr.number}</a>` : '', `<a href="${esc(`${repoUrl()}/commit/${e.sha}`)}"><code>${esc(e.sha.slice(0, 7))}</code></a>`].filter(Boolean).join(' ');
  const facts = [e.bulk ? 'Import' : approvalNeedLabel(e.tier), e.breaking ? 'breaking' : '', e.version && e.version !== 'Unreleased' ? e.version : 'next release'].filter(Boolean).join(', ');
  $('hs-detail').innerHTML = `<nav class="cg-crumbs" aria-label="Breadcrumb"><a href="${BASE}" data-hs-back>History</a><span aria-hidden="true">/</span><span>${esc(e.pr ? `#${e.pr.number}` : e.sha.slice(0, 7))}</span></nav>
    <header class="zone cg-pr-open">
      <h2 class="cg-pr-title" tabindex="-1">${mdTitleHtml(e.title)}</h2>
      <p class="cg-pr-meta"><span>${esc(e.author)}, ${esc(shortDate(e.date))}</span><span>${ref}</span><span>${esc(facts)}</span></p>
      <p class="cg-pr-state">${e.why !== e.title ? mdTitleHtml(e.why) : esc(countsLabel(e.counts))}</p>
      ${e.bulk ? '' : `<p class="cg-pr-cta"><button type="button" class="btn btn-primary" data-hs-undo="${esc(e.id)}">Undo this change</button></p>`}
    </header>
    <div class="cg-secs">
      <details class="cg-sec" open><summary class="cg-sec-head"><span class="cg-sec-title">Token changes</span><span class="cg-sec-meta">${esc(countsLabel(e.counts))}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary><div class="cg-sec-body">${diff}${e.changesets.length ? `<p class="cg-muted">From ${e.changesets.map((c) => `<code>${esc(c.path)}</code>`).join(', ')}.</p>` : ''}</div></details>
    </div>`;
}

/** Paints the History view from the URL (?view=history, &entry=). */
export function routeHistory() {
  const id = new URLSearchParams(location.search).get('entry');
  const { report, demo } = current();
  const e = id && report ? report.entries.find((x) => x.id === id) : undefined;
  const head = document.querySelector<HTMLElement>('.cg-hs-head');
  if (e && report) {
    paintDetail(e, demo);
    $('hs-list-view').hidden = true;
    if (head) head.hidden = true;
    $('hs-filters').hidden = true;
    $('hs-detail').hidden = false;
    ($('hs-detail').querySelector('h2') as HTMLElement | null)?.focus();
  } else {
    $('hs-detail').hidden = true;
    $('hs-list-view').hidden = false;
    if (head) head.hidden = false;
    $('hs-filters').hidden = $('hs-filter-toggle').getAttribute('aria-expanded') !== 'true';
    paintList();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Next release: the release pull request in plain words, the action for whoever holds the ship right

interface ReleasePullLike extends QueuePull {
  number: number;
  body: string | null;
}

const at = (xs: string[]) => (xs.length <= 2 ? xs.map((x) => `@${x}`).join(' or ') : `${xs.slice(0, 2).map((x) => `@${x}`).join(', ')} or ${xs.length - 2} more`);

let release: ReleasePullLike | null = null;

/** Fills the "Next release" card. Without a release pull request the build-time line stays. Never writes. */
function paintNextRelease() {
  if (!release) return;
  const card = releaseCard(parseReleaseBody(release.body));
  $('hs-next-title').textContent = card.breaking ? `${card.title} Some of it needs action from product teams.` : card.title;
  const lines = $('hs-next-lines');
  lines.innerHTML = [...card.lines, ...(card.tools ? [card.tools] : [])].map((l) => `<li>${esc(l)}</li>`).join('');
  lines.hidden = !lines.innerHTML;
  // Publishing is shipping the release: whoever holds the ship right (governance.rights), else the owners.
  const o = owners();
  const holders = (shippers() ?? [...new Set([...o.design, ...o.tech])]).map((x) => x.replace(/^@/, ''));
  const viewer = hasWorkingToken() ? currentViewer()?.login : null;
  const mine = Boolean(viewer && holders.some((h) => h.toLowerCase() === viewer.toLowerCase()));
  const cta = $<HTMLAnchorElement>('hs-next-cta');
  cta.href = `/studio/changes/?pr=${release.number}`;
  cta.dataset.openPr = String(release.number);
  cta.hidden = !mine;
  const who = $('hs-next-who');
  who.hidden = mine;
  who.innerHTML = `${holders.length ? `${esc(at(holders))} can publish it.` : 'An owner can publish it.'} <a href="/studio/changes/?pr=${release.number}" data-open-pr="${release.number}">See what it holds</a>`;
}

function loadNextRelease() {
  const r = readRepo();
  ghGet<ReleasePullLike[]>(`/repos/${r.owner}/${r.repo}/pulls?state=open&per_page=100`)
    .then((f) => {
      release = releasePull(f.data);
      paintNextRelease();
    })
    .catch(() => {
      /* rate limited with nothing saved: the build-time line stays */
    });
}

let started = false;

/** Wires the History view once, the first time it is shown, then loads the history data. */
export function initHistory() {
  if (started) {
    routeHistory();
    return;
  }
  started = true;
  // The card's action depends on who is connected: repaint it when the viewer changes.
  // GitHub teams in the owner lists count as their members once read (no request without teams).
  initGitHubConnect(() => void loadTeams().then(paintNextRelease));
  loadNextRelease();
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const open = t.closest<HTMLAnchorElement>('[data-hs-open]');
    if (open && !(ev as MouseEvent).metaKey && !(ev as MouseEvent).ctrlKey) {
      ev.preventDefault();
      history.pushState({}, '', `${BASE}&entry=${encodeURIComponent(open.dataset.hsOpen!)}`);
      routeHistory();
      return;
    }
    if (t.closest('[data-hs-back]')) {
      ev.preventDefault();
      history.pushState({}, '', BASE);
      routeHistory();
      return;
    }
    if (t.closest('[data-hs-clear]')) {
      ($('hs-filters') as HTMLFormElement).reset();
      paintList();
      return;
    }
    const undo = t.closest<HTMLElement>('[data-hs-undo]');
    if (undo) {
      const { report, demo } = current();
      const e = report?.entries.find((x) => x.id === undo.dataset.hsUndo);
      if (e && report) void openRevertPlanner(e, report, demo);
    }
  });
  const toggle = $('hs-filter-toggle');
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(on));
    $('hs-filters').hidden = !on;
    if (on) $<HTMLInputElement>('hs-token').focus();
  });
  document.getElementById('hs-demo')?.addEventListener('click', () => setDemo(!demoOn()));
  document.addEventListener(DEMO_EVENT, () => {
    history.replaceState({}, '', BASE);
    routeHistory();
  });
  let timer = 0;
  $('hs-filters').addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(paintList, 100);
  });
  $('hs-filters').addEventListener('reset', () => setTimeout(paintList, 0));
  // Deep link from a token drawer: ?view=history&token=color.text.muted opens the filters, prefilled.
  const token = new URLSearchParams(location.search).get('token');
  const tokenInput = document.getElementById('hs-token') as HTMLInputElement | null;
  if (token && tokenInput) {
    tokenInput.value = token;
    toggle.setAttribute('aria-expanded', 'true');
  }
  loadHistory()
    .then((l) => {
      L = l;
      routeHistory();
    })
    .catch((err) => {
      $('hs-timeline').innerHTML = `<p class="rv-notice is-fail">${esc((err as Error).message)}</p>`;
    });
}
