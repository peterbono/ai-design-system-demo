// "History" panel in the token explorer drawer: every recorded change of the open token (renames followed), each
// with "Restore this value". Real history by default; demo only with the toggle, under the same banner.
import { tokenHistory, type TokenHistoryItem } from '@bridge/core';
import { shortDate } from '../../lib/history-view';
import { esc } from '../github-session';
import { openRestorePlanner } from './planner';
import { activeReport, DEMO_BANNER, DEMO_EVENT, demoOn, loadHistory, setDemo } from './state';

const val = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const chip = (raw: unknown, css?: string) =>
  raw === undefined
    ? '<span class="muted">none</span>'
    : `<span class="rv-val">${css && /^#[0-9a-f]{6,8}$/i.test(css) ? `<span class="rv-sw" style="background-color:${esc(css)}"></span>` : ''}<span class="mono">${esc(val(raw))}</span></span>`;

let items: TokenHistoryItem[] = [];
let shownPath = '';
let shownDemo = false;

function itemHtml(it: TokenHistoryItem, i: number, demo: boolean): string {
  const what =
    it.kind === 'renamed'
      ? `Renamed from <span class="mono">${esc(it.from ?? '')}</span>`
      : it.kind === 'added'
        ? `Added ${chip(it.after, it.afterCss)}`
        : it.kind === 'removed'
          ? `Removed (was ${chip(it.before, it.beforeCss)})`
          : it.fields.includes('value')
            ? `${chip(it.before, it.beforeCss)} <span class="rv-arrow" aria-label="became">-></span> ${chip(it.after, it.afterCss)}`
            : 'Description changed';
  const title = demo ? esc(it.title) : `<a href="/history/?entry=${encodeURIComponent(it.entryId)}">${esc(it.title)}</a>`;
  const canRestore = it.after !== undefined && it.kind !== 'removed' && (it.kind !== 'changed' || it.fields.includes('value'));
  return `<li class="hs-ti">
    <p class="hs-ti-head"><span class="pill">${esc(it.modeLabel)}</span> <span class="small muted">${esc(shortDate(it.date))}, ${esc(it.author)}${it.pr ? `, #${it.pr.number}` : ''}</span></p>
    <p class="hs-ti-what">${what}</p>
    <p class="small">${title}</p>
    ${canRestore ? `<button type="button" class="btn btn-secondary btn-sm" data-hs-restore="${i}">Restore this value</button>` : ''}
  </li>`;
}

async function fill(path: string, section: HTMLElement) {
  const L = await loadHistory();
  const { report, demo } = activeReport(L.data);
  items = report ? tokenHistory(report.entries, path, L.config) : [];
  shownPath = path;
  shownDemo = demo;
  const n = items.length;
  const toggle = `<button type="button" class="hs-switch hs-switch-sm" data-hs-demo role="switch" aria-checked="${demo}"><span class="hs-switch-track" aria-hidden="true"><span class="hs-switch-thumb"></span></span><span>Show demo history</span></button>`;
  const banner = demo ? `<p class="hs-banner"><strong>${esc(DEMO_BANNER)}</strong></p>` : '';
  const body = n
    ? `<ol class="hs-token-list">${items.map((it, i) => itemHtml(it, i, demo)).join('')}</ol>`
    : `<p class="tx-empty-line">${demo ? 'No demo change touches this token. The demo history changes color.text.muted, button.radius and alert.radius.' : report ? 'No recorded change to this token in the history Bridge can read. Changes merged from now on show up here.' : 'History is not available in this build.'}</p>`;
  section.innerHTML = `<h3>History <span class="tx-d-n">${n}</span></h3>${banner}${body}<div class="hs-panel-foot">${toggle}<a class="small" href="/history/">See the whole history</a></div>`;
}

export function initTokenHistoryPanel() {
  document.addEventListener('bridge:token-detail', (e) => {
    const { path, body } = (e as CustomEvent<{ path: string; body: HTMLElement }>).detail;
    const section = document.createElement('section');
    section.className = 'tx-d-sec hs-panel';
    section.setAttribute('aria-label', 'History');
    section.innerHTML = '<h3>History</h3><p class="tx-empty-line">Reading history</p>';
    const foot = body.querySelector('.tx-d-foot');
    if (foot) foot.before(section);
    else body.append(section);
    fill(path, section).catch((err) => (section.innerHTML = `<h3>History</h3><p class="tx-empty-line">${esc((err as Error).message)}</p>`));
  });
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.hs-panel [data-hs-demo]')) {
      setDemo(!demoOn());
      return;
    }
    const b = t.closest<HTMLElement>('.hs-panel [data-hs-restore]');
    if (b) {
      const it = items[Number(b.dataset.hsRestore)];
      if (it) void openRestorePlanner(shownPath, it, shownDemo);
    }
  });
  document.addEventListener(DEMO_EVENT, () => {
    const section = document.querySelector<HTMLElement>('.hs-panel');
    if (section && shownPath) void fill(shownPath, section);
  });
}
