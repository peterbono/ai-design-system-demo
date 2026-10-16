// History page: the version timeline with filters, an entry detail with the Reviews diff, and "Undo this change".
// Real history by default; the demo toggle swaps in the fixture report and a banner, never both at once.
import type { HistoryEntry, HistoryFilter, HistoryReport } from '@bridge/core';
import { authorsOf, countsLabel, shortDate, viewTimeline } from '../../lib/history-view';
import { renderTokenReview } from '../reviews';
import { esc, initGitHubConnect, readRepo } from '../github-session';
import { openRevertPlanner } from './planner';
import { activeReport, DEMO_EVENT, demoOn, loadHistory, setDemo, type Loaded } from './state';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let L: Loaded | null = null;

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

const tierPill = (t: number) => `<span class="pill rv-tier is-t${t}">Tier ${t}</span>`;

function refLink(e: HistoryEntry, demo: boolean): string {
  if (demo) return `<span class="pill is-info">Demo</span>`;
  const pr = e.pr ? `<a href="${esc(e.pr.url ?? `${repoUrl()}/pull/${e.pr.number}`)}">#${e.pr.number}</a>` : '';
  return `${pr}<a href="${esc(`${repoUrl()}/commit/${e.sha}`)}" title="Commit"><code>${esc(e.sha.slice(0, 7))}</code></a>`;
}

function row(e: HistoryEntry, demo: boolean): string {
  const kind = e.bulk ? '<span class="pill">Import</span>' : e.breaking ? '<span class="pill is-fail">Breaking</span>' : tierPill(e.tier);
  if (e.bulk) {
    return `<li class="entry-row hs-row is-bulk">${kind}<div class="entry-main">
      <details class="hs-bulk"><summary><span class="entry-title">${esc(e.title)}</span></summary>
      <p class="entry-foryou">An import or a restructure of ${e.counts.total} tokens (${esc(countsLabel(e.counts))}), not a reviewable edit. Bridge does not offer to undo it.</p>
      <p class="small"><a href="?entry=${encodeURIComponent(e.id)}" data-hs-open="${esc(e.id)}">See the tokens it touched</a></p></details>
      <p class="entry-foryou">${esc(e.author)}, ${esc(shortDate(e.date))}</p></div>
      <div class="entry-ref">${refLink(e, demo)}</div></li>`;
  }
  return `<li class="entry-row hs-row">${kind}<div class="entry-main">
    <p class="entry-title"><a href="?entry=${encodeURIComponent(e.id)}" data-hs-open="${esc(e.id)}">${esc(e.title)}</a></p>
    <p class="entry-foryou">${esc(e.why !== e.title ? e.why : countsLabel(e.counts))}</p>
    <p class="entry-foryou">${esc(e.author)}, ${esc(shortDate(e.date))}, ${esc(countsLabel(e.counts))}</p>
    <p class="hs-row-actions"><button type="button" class="btn btn-secondary btn-sm" data-hs-undo="${esc(e.id)}">Undo this change</button></p></div>
    <div class="entry-ref">${refLink(e, demo)}</div></li>`;
}

function paintList() {
  const { report, demo } = current();
  const tl = $('hs-timeline');
  tl.setAttribute('aria-busy', 'false');
  $('hs-banner').hidden = !demo;
  $('hs-sparse').hidden = demo;
  const sw = $('hs-demo');
  sw.setAttribute('aria-checked', String(demo));
  const entries = report?.entries ?? [];
  // Filters follow the report on screen.
  const authorSel = $<HTMLSelectElement>('hs-author');
  const keep = authorSel.value;
  authorSel.innerHTML = `<option value="">Anyone</option>${authorsOf(entries).map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}`;
  authorSel.value = authorsOf(entries).includes(keep) ? keep : '';
  const paths = [...new Set(entries.filter((e) => !e.bulk).flatMap((e) => e.changes.map((c) => c.path)))].sort();
  $('hs-paths').innerHTML = paths.map((p) => `<option value="${esc(p)}"></option>`).join('');

  if (!report) {
    tl.innerHTML = '';
    $('hs-none').hidden = true;
    return;
  }
  const groups = viewTimeline(report, filter());
  $('hs-none').hidden = groups.length > 0 || !entries.length;
  tl.innerHTML = groups
    .map((g) => {
      const meta = [
        g.pending ? '<span class="pill is-warn">Not released yet</span>' : '<span class="pill is-pass">Released</span>',
        g.breaking ? '<span class="pill is-fail">Breaking</span>' : '',
        `<span class="pill">${esc(g.bump)}</span>`,
        `<span class="muted small">${g.pending ? 'Latest change' : 'Released'} <time datetime="${esc(g.date)}">${esc(shortDate(g.date))}</time></span>`,
      ].join('');
      const prs = g.prs.length ? g.prs.map((n) => `#${n}`).join(', ') : 'none';
      return `<li class="tl-item"${g.pending ? ' data-pending' : ''}><span class="tl-node" aria-hidden="true"></span>
        <section class="release-card" aria-label="${esc(g.version)}">
          <header class="release-head"><div class="release-title"><h2>${esc(g.version === 'Unreleased' ? 'Unreleased' : `Version ${g.version}`)}</h2><p class="release-meta">${meta}</p></div>
            <ul class="release-counts" aria-label="In this version">
              <li><strong class="num">${g.items.length}</strong> <span class="muted">change${g.items.length === 1 ? '' : 's'}</span></li>
              <li><strong class="num">${g.tokenChanges}</strong> <span class="muted">token edits</span></li>
              <li><span class="muted">Pull requests</span> <span class="small">${esc(prs)}</span></li>
            </ul></header>
          <ul class="entries">${g.items.map((e) => row(e, demo)).join('')}</ul>
        </section></li>`;
    })
    .join('');
}

function paintDetail(e: HistoryEntry, report: HistoryReport, demo: boolean) {
  const review = L!.data.reviews[`${demo ? 'demo' : 'real'}:${e.id}`];
  const diff = e.bulk
    ? `<p class="small muted">Imports are listed, not diffed. First ${Math.min(40, e.changes.length)} of ${e.changes.length} tokens:</p><ul class="hs-paths">${e.changes
        .slice(0, 40)
        .map((c) => `<li><span class="mono">${esc(c.path)}</span> <span class="rv-kind-tag is-${c.kind === 'renamed' ? 'changed' : c.kind}">${c.kind}</span></li>`)
        .join('')}</ul>`
    : review
      ? renderTokenReview(review)
      : '<p class="small muted">No designer diff for this change.</p>';
  const facts = [
    e.bulk ? '<span class="pill">Import</span>' : tierPill(e.tier),
    `<span class="pill">${esc(e.bump)}</span>`,
    e.breaking ? '<span class="pill is-fail">Breaking</span>' : '',
    `<span class="pill">${esc(e.version ?? 'Unreleased')}</span>`,
    demo ? '<span class="pill is-info">Demo</span>' : '',
  ].join(' ');
  $('hs-detail').innerHTML = `<p><a href="/history/" data-hs-back>Back to the timeline</a></p>
    <article class="rv-card hs-card">
      <header class="hs-detail-head"><div><h2>${esc(e.title)}</h2>
        <p class="small muted">${esc(e.author)}, ${esc(shortDate(e.date))}. ${demo ? 'Fixture change.' : `<span class="entry-ref hs-inline-ref">${refLink(e, false)}</span>`}</p>
        <p class="hs-facts">${facts}</p></div>
        ${e.bulk ? '' : `<button type="button" class="btn btn-primary btn-sm" data-hs-undo="${esc(e.id)}">Undo this change</button>`}</header>
      <section><h3 class="rv-sub">Why</h3><p>${esc(e.why)}</p>${e.changesets.length ? `<p class="small muted">From ${e.changesets.map((c) => `<code>${esc(c.path)}</code>`).join(', ')}.</p>` : ''}</section>
      <section><h3 class="rv-sub">Token changes <span class="tx-d-n">${e.counts.total}</span></h3>${diff}</section>
    </article>`;
  void report;
}

function route() {
  const id = new URLSearchParams(location.search).get('entry');
  const { report, demo } = current();
  const e = id && report ? report.entries.find((x) => x.id === id) : undefined;
  if (e && report) {
    paintDetail(e, report, demo);
    $('hs-list-view').hidden = true;
    $('hs-detail').hidden = false;
    $('hs-detail').querySelector('h2')?.setAttribute('tabindex', '-1');
    ($('hs-detail').querySelector('h2') as HTMLElement | null)?.focus();
  } else {
    $('hs-detail').hidden = true;
    $('hs-list-view').hidden = false;
    paintList();
  }
}

export function initHistoryPage() {
  initGitHubConnect();
  document.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const open = t.closest<HTMLAnchorElement>('[data-hs-open]');
    if (open && !(ev as MouseEvent).metaKey && !(ev as MouseEvent).ctrlKey) {
      ev.preventDefault();
      history.pushState({}, '', `?entry=${encodeURIComponent(open.dataset.hsOpen!)}`);
      route();
      return;
    }
    if (t.closest('[data-hs-back]')) {
      ev.preventDefault();
      history.pushState({}, '', location.pathname);
      route();
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
  $('hs-demo').addEventListener('click', () => setDemo(!demoOn()));
  document.addEventListener(DEMO_EVENT, () => {
    history.replaceState({}, '', location.pathname);
    route();
  });
  let timer = 0;
  $('hs-filters').addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(paintList, 100);
  });
  $('hs-filters').addEventListener('reset', () => setTimeout(paintList, 0));
  window.addEventListener('popstate', route);
  loadHistory()
    .then((l) => {
      L = l;
      route();
    })
    .catch((err) => {
      $('hs-timeline').innerHTML = `<li class="rv-notice is-fail">${esc((err as Error).message)}</li>`;
    });
}
