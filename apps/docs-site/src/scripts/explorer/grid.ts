// The center table: an ARIA grid (div based, so section groups can use content-visibility and stay cheap with 535
// rows). Groups are collapsible section rows, the header is sticky, there is one column per relevant mode, plus code
// syntax and description columns. Rows render in chunks: the first screenful synchronously, the rest on idle.
import { codeSyntax, modeName, SYNTAX_LABEL } from '../../lib/explorer/format';
import { ADDED_LABEL, beforeText, CHANGED_LABEL, fromLabel, type TokenMark } from '../../lib/view-scope';
import { sectionsFor, type Column, type Section, type XToken } from '../../lib/explorer/model';
import { cellHtml, cellLabel, studioCellHtml } from './cells';
import { editedModes } from '../token-editor';
import { modeKeyFor } from '../../lib/explorer/model';
import type { ExplorerData, ExplorerState, View } from './types';
import { copyButton, esc, icon } from './util';

export const ROW_HEIGHT = 56;

/** Minimum width of a mode column in rem: Studio cells carry the alias, the value and a chevron. */
const modeMin = (s: ExplorerState) => (s.mode === 'edit' || s.flat ? 12 : 10.5);

/** CSS grid-template-columns for the current columns. */
export function gridTemplate(view: View, s: ExplorerState): string {
  const modes = view.columns.map(() => `minmax(${modeMin(s)}rem, 1fr)`).join(' ');
  // Studio gives the name the larger share: names stay on one line next to the details panel at laptop widths.
  const name = s.mode === 'edit' || s.flat ? 'minmax(9.5rem, 1.6fr)' : 'minmax(9.5rem, 1.1fr)';
  return [name, modes, s.showCode ? 'minmax(13rem, 0.9fr)' : '', s.showDescription ? 'minmax(16rem, 1.2fr)' : ''].filter(Boolean).join(' ');
}

export const colCount = (view: View, s: ExplorerState) => 1 + view.columns.length + (s.showCode ? 1 : 0) + (s.showDescription ? 1 : 0);

function header(view: View, s: ExplorerState): string {
  const cols = view.columns
    .map(
      (c, i) =>
        `<div role="columnheader" class="xp-th is-mode" aria-colindex="${i + 2}"><span class="xp-th-label">${esc(c.label)}</span>${
          c.axis === undefined ? '' : `<span class="xp-th-sub">${esc(subLabel(c))}</span>`
        }</div>`,
    )
    .join('');
  let n = view.columns.length + 2;
  const code = s.showCode ? `<div role="columnheader" class="xp-th" aria-colindex="${n++}">${esc(SYNTAX_LABEL[s.syntax])}</div>` : '';
  const desc = s.showDescription ? `<div role="columnheader" class="xp-th" aria-colindex="${n++}">Description</div>` : '';
  return `<div role="rowgroup" class="xp-head"><div role="row" class="xp-tr" aria-rowindex="1"><div role="columnheader" class="xp-th is-name" aria-colindex="1">Name</div>${cols}${code}${desc}</div></div>`;
}

/** Small context under a mode header: what the other axes are fixed to. */
function subLabel(c: Column): string {
  if (c.key.startsWith('combo:')) return 'Brand and theme';
  if (c.axis === 'theme') return `${c.ctx.brand.charAt(0).toUpperCase()}${c.ctx.brand.slice(1)} brand`;
  if (c.axis === 'brand') return 'Brand';
  return 'Density';
}

function rowHtml(d: ExplorerData, t: XToken, view: View, s: ExplorerState, section: Section, index: number): string {
  const editable = s.mode === 'edit';
  // Studio (flat) cells look the same read only (a change shown, lib/view-scope) as in edit mode, without the editor.
  const studio = editable || s.flat;
  const rel = !s.flat && section.key === t.group ? t.name : t.path;
  const mark = d.marks?.get(t.path);
  // Usage is the latest library's: a token new in the change has none to say.
  const unused = t.used || mark?.kind === 'added' ? '' : '<span class="xp-flag">Unused</span>';
  const changed = mark ? markHtml(mark, d) : '';
  // Studio: the name opens the read-only details, the value cells open the editor. No copy buttons in the cells
  // (C copies, and the row menu); the row menu sits at the end of the name cell.
  const nameEnd = editable
    ? `<button type="button" class="xp-rowmenu" data-xp-rowmenu tabindex="-1" aria-label="Actions for ${esc(t.path)}" aria-haspopup="menu">${icon('more', 16)}</button>`
    : studio
      ? ''
      : copyButton(codeSyntax(t.path, t.tier, s.syntax), `${SYNTAX_LABEL[s.syntax]} ${codeSyntax(t.path, t.tier, s.syntax)}`);
  // Studio: a long name wraps at its dots (never mid-segment) instead of hiding behind an ellipsis when the details
  // panel narrows the table. The Library keeps one line with the full name on hover.
  const shownName = studio ? esc(rel).replace(/\./g, '.<wbr>') : esc(rel);
  const name = `<div role="rowheader" class="xp-td is-name" aria-colindex="1" tabindex="-1" data-col="0"><span class="xp-name"><span class="xp-name-main mono"${studio ? '' : ` title="${esc(t.path)}"`}>${shownName}</span>${changed}${unused}</span>${nameEnd}</div>`;
  const edited = editable ? editedModes(t.path) : new Set<string>();
  const cells = view.columns
    .map(
      (c, i) =>
        `<div role="gridcell" class="xp-td is-mode" aria-colindex="${i + 2}" tabindex="-1" data-col="${i + 1}" data-colkey="${esc(c.key)}" aria-label="${esc(cellLabel(d, t.path, c))}"${
          editable ? ' aria-readonly="false" aria-haspopup="dialog"' : ''
        }>${studio ? studioCellHtml(d, t.path, c, edited.has(modeKeyFor(t.tier, c))) : cellHtml(d, t.path, c, editable)}</div>`,
    )
    .join('');
  let n = view.columns.length + 1;
  const code = s.showCode
    ? `<div role="gridcell" class="xp-td is-code" aria-colindex="${n + 1}" tabindex="-1" data-col="${n++}"><code class="xp-code">${esc(codeSyntax(t.path, t.tier, s.syntax))}</code></div>`
    : '';
  const desc = s.showDescription
    ? `<div role="gridcell" class="xp-td is-desc" aria-colindex="${n + 1}" tabindex="-1" data-col="${n++}">${t.description ? esc(t.description) : '<span class="muted">No description</span>'}</div>`
    : '';
  const selected = s.selected === t.path;
  return `<div role="row" class="xp-tr" data-path="${esc(t.path)}" aria-rowindex="${index}" aria-selected="${selected}">${name}${cells}${code}${desc}</div>`;
}

/** "Changed in this change" on a token the viewed change defines differently; its latest library value on hover and for screen readers. */
function markHtml(mark: TokenMark, d: ExplorerData): string {
  const before = beforeText(mark, d.formatBefore ?? ((_t, v) => JSON.stringify(v)), modeName);
  // Changes shown together: the mark names the change the value comes from.
  const label = mark.from?.length ? fromLabel(mark.kind, mark.from) : mark.kind === 'added' ? ADDED_LABEL : CHANGED_LABEL;
  return `<span class="xp-flag xp-flag-change" data-before="${esc(before)}">${esc(label)}<span class="sr-only">. ${esc(before)}</span></span>`;
}

function sectionHead(sec: Section, view: View, s: ExplorerState, index: number): string {
  const open = !s.collapsed.has(sec.key);
  return `<div role="row" class="xp-tr is-section" data-section="${esc(sec.key)}" aria-rowindex="${index}"><div role="gridcell" class="xp-td is-section" aria-colspan="${colCountOf(
    view,
    s,
  )}"><button type="button" class="xp-sec" data-col="0" tabindex="-1" aria-expanded="${open}"><span class="xp-sec-icon">${icon('chevron', 14)}</span><span class="xp-sec-label">${esc(
    sec.label,
  )}</span><span class="xp-sec-n">${sec.tokens.length}<span class="sr-only"> tokens</span></span></button></div></div>`;
}

const colCountOf = colCount;

export interface RenderResult {
  /** Milliseconds to build and insert the first chunk. */
  firstMs: number;
  /** Resolves when every row is in the DOM, with the total time. */
  done: Promise<number>;
}

let generation = 0;

/**
 * Renders the grid into `host`. Sections become rowgroups with `content-visibility: auto` and an intrinsic height,
 * so offscreen groups cost no layout or paint. The first ~`firstRows` rows go in synchronously; the rest follow in
 * idle chunks, unless `sync` (tests, perf runs, keyboard jumps to a far row).
 */
export function renderGrid(host: HTMLElement, d: ExplorerData, view: View, s: ExplorerState, opts: { sync?: boolean; firstRows?: number } = {}): RenderResult {
  const t0 = performance.now();
  const gen = ++generation;
  // Flat (Studio): one group without a section row, full token names.
  // Chunks of 50 rows keep content-visibility cheap on long scopes.
  const sections: Section[] = s.flat
    ? Array.from({ length: Math.ceil(view.visible.length / 50) }, (_, i) => ({ key: `rows-${i}`, label: '', tokens: view.visible.slice(i * 50, i * 50 + 50) }))
    : sectionsFor(view.visible, s.selection);
  host.style.setProperty('--xp-cols', gridTemplate(view, s));
  host.style.setProperty('--xp-n', String(view.columns.length));
  host.style.setProperty('--xp-minw', `${9.5 + modeMin(s) * view.columns.length + (s.showCode ? 13 : 0) + (s.showDescription ? 16 : 0)}rem`);
  host.setAttribute('aria-colcount', String(colCount(view, s)));
  host.setAttribute('aria-rowcount', String(1 + (s.flat ? 0 : sections.length) + view.visible.length));
  host.setAttribute('aria-readonly', String(s.mode !== 'edit'));
  // Placeholder height of groups not painted yet: the row height of the current density (--xp-row on the explorer).
  const rowH = parseFloat(getComputedStyle(host).getPropertyValue('--xp-row')) || ROW_HEIGHT;

  let rowIndex = s.flat ? 1 : 2;
  const groups = sections.map((sec) => {
    const start = rowIndex;
    rowIndex += (s.flat ? 0 : 1) + sec.tokens.length;
    return { sec, start };
  });
  const groupHtml = ({ sec, start }: (typeof groups)[number]) => {
    const collapsed = !s.flat && s.collapsed.has(sec.key);
    const rows = collapsed ? '' : sec.tokens.map((t, i) => rowHtml(d, t, view, s, sec, start + 1 + i)).join('');
    const head = s.flat ? '' : sectionHead(sec, view, s, start);
    return `<div role="rowgroup" class="xp-group" data-group="${esc(sec.key)}" style="contain-intrinsic-size:auto ${(collapsed ? 1 : (s.flat ? 0 : 1) + sec.tokens.length) * rowH}px">${head}${rows}</div>`;
  };

  const budget = opts.sync ? Infinity : (opts.firstRows ?? 80);
  let first = 0;
  let used = 0;
  while (first < groups.length && (used < budget || first === 0)) {
    used += groups[first]!.sec.tokens.length + 1;
    first++;
  }
  host.innerHTML = header(view, s) + groups.slice(0, first).map(groupHtml).join('');
  const firstMs = performance.now() - t0;

  const done = new Promise<number>((resolveDone) => {
    let i = first;
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 120 }) : window.setTimeout(cb, 16));
    const step = () => {
      if (gen !== generation) return resolveDone(performance.now() - t0);
      let chunk = '';
      let rows = 0;
      while (i < groups.length && rows < 120) {
        chunk += groupHtml(groups[i]!);
        rows += groups[i]!.sec.tokens.length + 1;
        i++;
      }
      if (chunk) host.insertAdjacentHTML('beforeend', chunk);
      if (i < groups.length) idle(step);
      else resolveDone(performance.now() - t0);
    };
    if (i >= groups.length) resolveDone(firstMs);
    else idle(step);
  });
  return { firstMs, done };
}

/** Re-renders the mode cells of one row in place (after a draft edit), keeping focus. */
export function refreshRow(host: HTMLElement, d: ExplorerData, view: View, s: ExplorerState, path: string) {
  const row = host.querySelector<HTMLElement>(`.xp-tr[data-path="${CSS.escape(path)}"]`);
  if (!row) return;
  const t = d.set.byPath.get(path);
  const edited = s.mode === 'edit' ? editedModes(path) : new Set<string>();
  row.querySelectorAll<HTMLElement>('.xp-td.is-mode').forEach((cell, i) => {
    const col = view.columns[i];
    if (!col) return;
    cell.innerHTML = (s.mode === 'edit' || s.flat) && t ? studioCellHtml(d, path, col, edited.has(modeKeyFor(t.tier, col))) : cellHtml(d, path, col, false);
    cell.setAttribute('aria-label', cellLabel(d, path, col));
  });
}
