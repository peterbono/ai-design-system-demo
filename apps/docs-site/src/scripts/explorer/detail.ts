// Right detail panel (a drawer on narrow screens): name, description, introduced version, names to copy, values per
// mode, the token flow (upstream alias chain per mode, downstream tokens and components), contrast pairs with AA
// badges per brand and theme, and the token's history (the existing history panel fills itself in).
import { contextLabel, TIER_NAMES, tokenHistory } from '@bridge-ds/core';
import { aliasLabel, CATEGORY_LABEL, codeSyntax, SYNTAX_LABEL, type Syntax } from '../../lib/explorer/format';
import { componentsUsing, contrastFor, stylesUsing, usedByLine, directDependents, introducedIn, transitiveDependents, upstreamLanes, type PairRow } from '../../lib/explorer/flow';
import { cellValue, studioHref, type Column } from '../../lib/explorer/model';
import { activeReport, loadHistory } from '../history/state';
import { cellHtml } from './cells';
import type { ExplorerData, ExplorerState, View } from './types';
import { swatchLabel } from '../../lib/explorer/swatch-ramp';
import { copyButton, esc, icon } from './util';

const SYNTAXES: Syntax[] = ['css', 'js', 'dtcg'];
const MAX_DOWNSTREAM = 12;

function names(path: string, tier: Parameters<typeof codeSyntax>[1]): string {
  const rows = [...SYNTAXES.map((s) => [SYNTAX_LABEL[s], codeSyntax(path, tier, s)] as const), ['Figma variable', path.split('.').join('/')] as const];
  return `<dl class="xp-names">${rows
    .map(([k, v]) => `<div class="xp-names-row"><dt>${esc(k)}</dt><dd><code>${esc(v)}</code>${copyButton(v, `${k} ${v}`, 'is-visible')}</dd></div>`)
    .join('')}</dl>`;
}

function values(d: ExplorerData, path: string, columns: Column[]): string {
  return `<div class="xp-d-values" style="--xp-n:${Math.min(columns.length, 2)}">${columns
    .map((c) => `<div class="xp-d-value"><span class="xp-d-value-label">${esc(c.label)}</span>${cellHtml(d, path, c, false)}</div>`)
    .join('')}</div>`;
}

function swatch(hex?: string) {
  return hex ? `<span class="xp-mini" style="background-color:${hex}" aria-hidden="true"></span>` : '';
}

function flowParts(d: ExplorerData, path: string, columns: Column[]) {
  const lanes = upstreamLanes(d.set, path, columns);
  const type = d.set.byPath.get(path)?.type;
  const upstream = lanes
    .map((lane) => {
      const label = lane.columns.length === columns.length && columns.length > 1 ? 'Every mode' : lane.columns.map((c) => c.label).join(', ');
      const nodes = lane.nodes
        .map((n, i) => {
          const self = i === 0;
          const tier = n.tier ? TIER_NAMES[n.tier] : 'Missing';
          const sw = type === 'color' ? `<span class="xp-node-sw">${lane.columns.map((c) => swatch(n.values[c.key]?.hex)).join('')}</span>` : '';
          const last = i === lane.nodes.length - 1;
          const value = last ? `<span class="xp-node-value mono">${esc(lane.columns.map((c) => n.values[c.key]?.css ?? '').filter((v, j, a) => a.indexOf(v) === j).join(' / '))}</span>` : '';
          const name = self
            ? `<span class="xp-node-name mono">${esc(n.path)}</span>`
            : `<button type="button" class="xp-node-name xp-link mono" data-goto="${esc(n.path)}">${esc(n.path)}</button>`;
          return `<li class="xp-node${self ? ' is-self' : ''}${n.override ? ' is-override' : ''}">${sw}<span class="xp-node-body"><span class="xp-node-tier">${esc(tier)}${
            n.override ? ', brand override' : ''
          }</span>${name}${value}</span></li>`;
        })
        .join('');
      const err = lane.error ? `<p class="xp-flow-error">${icon('alert', 14)} Does not resolve: ${esc(lane.error)}</p>` : '';
      return `<div class="xp-lane"><p class="xp-lane-label">${esc(label)}</p><ol class="xp-chain">${nodes}</ol>${err}</div>`;
    })
    .join('');

  const deps = directDependents(d.set, path);
  const all = transitiveDependents(d.set, path);
  const comps = componentsUsing(path, all, d.usage);
  const styles = stylesUsing(path, all, d.usage);
  const depList = deps.length
    ? `<ul class="xp-deps">${deps
        .slice(0, MAX_DOWNSTREAM)
        .map((x) => `<li><button type="button" class="xp-chip" data-goto="${esc(x.path)}" title="${esc(x.path)}">${esc(aliasLabel(x.path))}</button><span class="xp-dep-tier">${esc(TIER_NAMES[x.tier])}</span></li>`)
        .join('')}</ul>${deps.length > MAX_DOWNSTREAM ? `<p class="small muted">and ${deps.length - MAX_DOWNSTREAM} more</p>` : ''}`
    : '<p class="xp-empty-line">No token aliases this one.</p>';
  const compList = comps.length
    ? `<ul class="xp-comps">${comps.map((c) => `<li><a href="${esc(c.href)}">${esc(c.name)}</a></li>`).join('')}</ul>`
    : '<p class="xp-empty-line">No component reads it, directly or through an alias.</p>';
  const styleList = styles.length
    ? `<h4 class="xp-d-sub">Global styles <span class="xp-d-n">${styles.length}</span></h4><ul class="xp-comps">${styles.map((f) => `<li><span class="mono">${esc(f)}</span></li>`).join('')}</ul>`
    : '';
  const aliased = `<h4 class="xp-d-sub">Aliased by <span class="xp-d-n">${deps.length}</span>${all.length > deps.length ? `<span class="muted small"> (${all.length} through aliases)</span>` : ''}</h4>${depList}`;
  const steps = Math.max(0, ...lanes.map((l) => l.nodes.length));
  return { upstream, aliased, compList, comps, styles, styleList, steps };
}

function flow(d: ExplorerData, path: string, columns: Column[]): string {
  const f = flowParts(d, path, columns);
  return `<section class="xp-d-sec" aria-labelledby="xp-d-flow"><h3 id="xp-d-flow">Token flow</h3>
    <h4 class="xp-d-sub">Upstream</h4>${f.upstream}
    ${f.aliased}
    <h4 class="xp-d-sub">Used by components <span class="xp-d-n">${f.comps.length}</span></h4>${f.compList}
    ${f.styleList}
  </section>`;
}

/**
 * Studio: the details are read-only and compact. Name, one line of description, the value per mode, then Token flow,
 * Used by and History collapsed with their counts, and one Edit that opens the cell editor (there is one editor).
 */
function renderStudioDetail(host: HTMLElement, d: ExplorerData, view: View, path: string) {
  const x = d.byPath.get(path)!;
  const columns = view.columns;
  const f = flowParts(d, path, columns);
  const val = (c: Column) => {
    const v = cellValue(d.set, path, c.ctx);
    const sw = v.hex ? `<span class="xp-d-ms" style="background-color:${esc(v.css)}" aria-hidden="true"></span>` : '';
    return `<div class="xp-d-val">${sw}<span><span class="xp-d-val-label">${esc(c.label)}</span><span class="xp-d-val-main mono">${esc(v.alias ? swatchLabel(v.alias) : v.line)}</span>${
      v.alias ? `<span class="xp-d-val-sub mono">${esc(v.hex ?? v.line)}</span>` : ''
    }</span></div>`;
  };
  const acc = (key: string, ic: 'branch' | 'box' | 'clock', label: string, meta: string, content: string) =>
    `<details class="xp-d-acc" data-acc="${key}"><summary>${icon(ic, 18)}<span class="xp-d-acc-label">${esc(label)}</span><span class="xp-d-acc-meta" data-acc-meta>${esc(meta)}</span><span class="xp-d-acc-chev">${icon(
      'chevron',
      16,
    )}</span></summary><div class="xp-d-acc-body">${content}</div></details>`;
  host.innerHTML = `
    <div class="xp-d-bar is-studio">
      <h2 class="xp-d-name mono" id="xp-d-title" tabindex="-1">${esc(path)}</h2>
      <button type="button" class="icon-btn" data-xp-close aria-label="Close token details">${icon('close', 18)}</button>
    </div>
    <div class="xp-d-body is-studio" data-xp-detail-body>
      ${x.description ? `<p class="xp-d-line" title="${esc(x.description)}">${esc(x.description)}</p>` : '<p class="xp-d-line muted">No description yet.</p>'}
      <div class="xp-d-vals" style="--xp-n:${Math.min(columns.length, 2)}">${columns.map(val).join('')}</div>
      <div class="xp-d-accs">
        ${acc('flow', 'branch', 'Token flow', `${f.steps} step${f.steps === 1 ? '' : 's'}`, `<h4 class="xp-d-sub">Upstream</h4>${f.upstream}${f.aliased}`)}
        ${acc('used', 'box', 'Used by', usedByLine(f.comps.length, f.styles), `${f.comps.length || !f.styles.length ? f.compList : ''}${f.styleList}`)}
        ${acc('history', 'clock', 'History', 'Reading', '<div class="tx-d-foot" hidden></div>')}
      </div>
    </div>
    <div class="xp-d-editbar"><button type="button" class="btn btn-secondary" data-xp-edit-cell>${icon('pencil', 16)}Edit</button><span class="xp-d-editnote">Opens the value editor on the row.</span></div>`;
  // The history panel (scripts/history/token-panel.ts) fills the History section; its count becomes the meta.
  const histBody = host.querySelector<HTMLElement>('[data-acc="history"] .xp-d-acc-body')!;
  const meta = host.querySelector<HTMLElement>('[data-acc="history"] [data-acc-meta]')!;
  const obs = new MutationObserver(() => {
    const n = histBody.querySelector('.tx-d-n')?.textContent?.trim();
    const empty = histBody.querySelector('.tx-empty-line');
    if (n) meta.textContent = `${n} change${n === '1' ? '' : 's'}`;
    else if (empty && !/Reading/.test(empty.textContent ?? '')) meta.textContent = 'No change';
  });
  obs.observe(histBody, { childList: true, subtree: true, characterData: true });
  document.dispatchEvent(new CustomEvent('bridge:token-detail', { detail: { path, body: histBody } }));
}

function pairRow(d: ExplorerData, r: PairRow, edit: boolean, through = false): string {
  const cells = r.cells
    .map((c) => {
      const ctx = { brand: c.brand, theme: c.theme, density: d.modes.densities[0] };
      const fg = cellValue(d.set, r.fg, ctx).css;
      const bg = cellValue(d.set, r.bg, ctx).css;
      const sample = r.kind === 'ui' ? `<span class="xp-ratio-aa" style="background-color:${esc(bg)}" aria-hidden="true"><i class="xp-ratio-ui" style="border-color:${esc(fg)}"></i></span>` : `<span class="xp-ratio-aa" style="background-color:${esc(bg)};color:${esc(fg)}" aria-hidden="true">Aa</span>`;
      const ratio = c.ratio === undefined ? 'n/a' : `${c.ratio.toFixed(2)}:1`;
      const moved = edit && c.before !== undefined && c.ratio !== undefined && c.before !== c.ratio;
      const tone = !c.passes ? 'is-fail' : c.badge === 'AA large' ? 'is-warn' : 'is-pass';
      return `<li class="xp-ratio ${tone}">${sample}<span class="xp-ratio-ctx">${esc(contextLabel(c))}</span><span class="xp-ratio-num num">${
        moved ? `<span class="muted">${c.before!.toFixed(2)}</span> ${icon('arrowRight', 12)} ` : ''
      }${esc(ratio)}</span><span class="xp-badge ${tone}">${icon(c.passes ? 'check' : 'x', 12)}${esc(c.badge)}</span></li>`;
    })
    .join('');
  const need = r.kind === 'ui' ? 'UI, needs 3:1' : `text, needs ${r.min}:1`;
  const link = (p: string) => `<button type="button" class="xp-link mono" data-goto="${esc(p)}">${esc(p)}</button>`;
  const head = through ? `${link(r.fg)} on ${link(r.bg)}` : `${r.role === 'fg' ? 'On' : 'Under'} ${link(r.other)}`;
  return `<li class="xp-pair${r.failing ? ' has-fail' : ''}"><p class="xp-pair-head">${head} <span class="muted small">(${esc(need)})</span></p><ul class="xp-ratios">${cells}</ul></li>`;
}

function contrast(d: ExplorerData, path: string, edit: boolean): string {
  const t = d.set.byPath.get(path);
  if (t?.type !== 'color') return '';
  const { direct, through } = contrastFor(path, d.results, edit ? d.before : []);
  const failing = direct.reduce((s, r) => s + r.failing, 0);
  const body = direct.length
    ? `<ul class="xp-pairs">${direct.map((r) => pairRow(d, r, edit)).join('')}</ul>`
    : through.length
      ? ''
      : '<p class="xp-empty-line">Not part of any checked pair. Add it to contrast.checks.json to gate it.</p>';
  const via = through.length
    ? `<details class="xp-through"${direct.length ? '' : ' open'}><summary>${through.length} pair${through.length > 1 ? 's' : ''} resolve through this token${
        through.some((r) => r.failing) ? `, <strong class="xp-fail-text">${through.filter((r) => r.failing).length} failing</strong>` : ''
      }</summary><ul class="xp-pairs">${through
        .slice(0, 8)
        .map((r) => pairRow(d, r, edit, true))
        .join('')}</ul>${through.length > 8 ? `<p class="small muted">and ${through.length - 8} more</p>` : ''}</details>`
    : '';
  return `<section class="xp-d-sec" aria-labelledby="xp-d-contrast"><h3 id="xp-d-contrast">Contrast <span class="xp-d-n">${direct.length}</span>${
    failing ? `<span class="xp-badge is-fail">${icon('x', 12)}${failing} failing</span>` : ''
  }</h3>${body}${via}</section>`;
}

export function renderDetail(host: HTMLElement, d: ExplorerData, view: View, s: ExplorerState, path: string) {
  const x = d.byPath.get(path);
  const t = d.set.byPath.get(path);
  if (!x || !t) {
    host.innerHTML = `<div class="xp-d-body"><p class="xp-empty-line">This token is not in the token files this page was built from.</p></div>`;
    return;
  }
  const columns = view.columns;
  const edit = s.mode === 'edit';
  if (edit) return renderStudioDetail(host, d, view, path);
  const studio = studioHref(path);
  // Library: the one edit affordance, shown only to maintainers (a GitHub token with write access, see the shell).
  const actions = `<div class="xp-d-actions" data-maintainer-only><a class="btn btn-secondary btn-sm" href="${esc(studio)}" data-xp-studio data-maintainer-only>${icon('pencil', 16)}Edit in Studio</a></div>`;
  const firstValue = cellValue(d.set, path, columns[0]!.ctx);
  host.innerHTML = `
    <div class="xp-d-bar">
      <span class="xp-d-crumb">${esc(x.collection)} <span aria-hidden="true">/</span> ${esc(CATEGORY_LABEL[x.category])}</span>
      <button type="button" class="icon-btn" data-xp-close aria-label="Close token details">${icon('close', 18)}</button>
    </div>
    <div class="xp-d-body" data-xp-detail-body>
      <header class="xp-d-head">
        <h2 class="xp-d-title mono" id="xp-d-title" tabindex="-1">${esc(path)}</h2>
        <p class="xp-d-meta">
          <span class="pill">${esc(x.collection)}</span><span class="pill">${esc(CATEGORY_LABEL[x.category])}</span>${x.used ? '' : '<span class="pill is-warn">Unused</span>'}${
            firstValue.override ? '<span class="pill is-info">Brand override</span>' : ''
          }<span class="xp-introduced" data-xp-introduced hidden></span>
        </p>
        ${x.description ? `<p class="xp-d-desc">${esc(x.description)}</p>` : ''}
        ${actions}
      </header>
      <section class="xp-d-sec" aria-labelledby="xp-d-values"><h3 id="xp-d-values">Values</h3>${values(d, path, columns)}</section>
      ${flow(d, path, columns)}
      ${contrast(d, path, edit)}
      <section class="xp-d-sec" aria-labelledby="xp-d-names"><h3 id="xp-d-names">Names</h3>${names(path, t.tier)}</section>
      <p class="tx-d-foot xp-d-foot">${
        edit
          ? `<a href="/tokens/?t=${encodeURIComponent(path)}">See it in the Library</a> <span class="muted">or</span> <a href="/studio/versions/?token=${encodeURIComponent(path)}" data-keep-branch>its history</a>`
          : `<a href="/studio/versions/?token=${encodeURIComponent(path)}">See its history</a>`
      }</p>
    </div>`;
  // The history panel (scripts/history/token-panel.ts) inserts itself before the footer.
  const body = host.querySelector<HTMLElement>('[data-xp-detail-body]')!;
  document.dispatchEvent(new CustomEvent('bridge:token-detail', { detail: { path, body } }));
  void fillIntroduced(host, path);
}

async function fillIntroduced(host: HTMLElement, path: string) {
  try {
    const L = await loadHistory();
    const { report, demo } = activeReport(L.data);
    if (!report || demo) return;
    const v = introducedIn(tokenHistory(report.entries, path, L.config));
    const el = host.querySelector<HTMLElement>('[data-xp-introduced]');
    if (!v || !el || host.querySelector('#xp-d-title')?.textContent !== path) return;
    el.textContent = `Introduced in v${v}`;
    el.hidden = false;
  } catch {
    /* no history in this build: omit the line */
  }
}

export const syntaxes = SYNTAXES;
