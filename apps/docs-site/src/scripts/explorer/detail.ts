// Right detail panel (a drawer on narrow screens and on the Library foundation pages). Library (read mode): the name
// as a plain heading, one summary first (a large specimen next to the value with copy, where the value comes from on
// one line, one plain sentence), then collapsed rows: Aliased by, Used by, Contrast, History, and Names in code and
// Figma (with one quiet "Open on GitHub" link to the file). One action, "Edit in Studio", in the footer.
// Studio (edit mode): renderStudioDetail, read-only and compact. The history panel fills its section itself.
import { contextLabel, TIER_NAMES, tokenHistory } from '@bridge-ds/core';
import { contrastMeta, definedIn, splitDescription, summarySentence, usedByRows, type UsedByRow } from '../../lib/explorer/detail-summary';
import { aliasLabel, bezierPath, CATEGORY_LABEL, codeSyntax, colorAlpha, isForeground, numericValue, STUDIO_TIER_NAMES, SYNTAX_LABEL, type Syntax } from '../../lib/explorer/format';
import { componentsUsing, contrastFor, stylesUsing, usedByLine, directDependents, introducedIn, transitiveDependents, upstreamLanes, type PairRow } from '../../lib/explorer/flow';
import { cellValue, pairedBackground, studioHref, type CellValue, type Column } from '../../lib/explorer/model';
import { activeReport, loadHistory } from '../history/state';
import type { ExplorerData, ExplorerState, View } from './types';
import { swatchLabel } from '../../lib/explorer/swatch-ramp';
import { copyButton, esc, icon } from './util';

const SYNTAXES: Syntax[] = ['css', 'js', 'dtcg'];
const MAX_DOWNSTREAM = 12;

function names(path: string, tier: Parameters<typeof codeSyntax>[1]): string {
  const rows = [...SYNTAXES.map((s) => [SYNTAX_LABEL[s], codeSyntax(path, tier, s)] as const), ['Figma variable', path.split('.').join('/')] as const];
  return `<dl class="xp-names">${rows
    .map(([k, v]) => `<div class="xp-names-row"><dt>${esc(k)}</dt><dd><code>${esc(v)}</code>${copyButton(v, `${k} ${v}`, 'is-visible', true)}</dd></div>`)
    .join('')}</dl>`;
}

function swatch(hex?: string) {
  return hex ? `<span class="xp-mini" style="background-color:${hex}" aria-hidden="true"></span>` : '';
}

/** Studio words the flow uses: collection names for designers, and plain headings. */
interface FlowWords {
  tiers: Record<string, string>;
  aliasedBy: string;
}
const STUDIO_WORDS: FlowWords = { tiers: STUDIO_TIER_NAMES, aliasedBy: 'Tokens that point to it' };

function flowParts(d: ExplorerData, path: string, columns: Column[], words: FlowWords) {
  const lanes = upstreamLanes(d.set, path, columns);
  const type = d.set.byPath.get(path)?.type;
  const upstream = lanes
    .map((lane) => {
      const label = lane.columns.length === columns.length && columns.length > 1 ? 'Every mode' : lane.columns.map((c) => c.label).join(', ');
      const nodes = lane.nodes
        .map((n, i) => {
          const self = i === 0;
          const tier = n.tier ? words.tiers[n.tier] : 'Missing';
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
        .map((x) => `<li><button type="button" class="xp-chip" data-goto="${esc(x.path)}" title="${esc(x.path)}">${esc(aliasLabel(x.path))}</button><span class="xp-dep-tier">${esc(words.tiers[x.tier] ?? x.tier)}</span></li>`)
        .join('')}</ul>${deps.length > MAX_DOWNSTREAM ? `<p class="small muted">and ${deps.length - MAX_DOWNSTREAM} more</p>` : ''}`
    : '<p class="xp-empty-line">No token aliases this one.</p>';
  const compList = comps.length
    ? `<ul class="xp-comps">${comps.map((c) => `<li><a href="${esc(c.href)}">${esc(c.name)}</a></li>`).join('')}</ul>`
    : '<p class="xp-empty-line">No component reads it, directly or through an alias.</p>';
  const styleList = styles.length
    ? `<h4 class="xp-d-sub">Global styles <span class="xp-d-n">${styles.length}</span></h4><ul class="xp-comps">${styles.map((f) => `<li><span class="mono">${esc(f)}</span></li>`).join('')}</ul>`
    : '';
  const aliased = `<h4 class="xp-d-sub">${esc(words.aliasedBy)} <span class="xp-d-n">${deps.length}</span>${all.length > deps.length ? `<span class="muted small"> (${all.length} through aliases)</span>` : ''}</h4>${depList}`;
  const steps = Math.max(0, ...lanes.map((l) => l.nodes.length));
  return { upstream, aliased, compList, comps, styles, styleList, steps };
}

/**
 * Studio: the details are read-only and compact. Name, one line of description, the value per mode, then "Where the
 * value comes from" (the alias chain), Used by and History collapsed with their counts, and one Edit that opens the
 * cell editor (there is one editor).
 */
function renderStudioDetail(host: HTMLElement, d: ExplorerData, view: View, path: string) {
  const x = d.byPath.get(path)!;
  const columns = view.columns;
  const f = flowParts(d, path, columns, STUDIO_WORDS);
  const val = (c: Column) => {
    const v = cellValue(d.set, path, c.ctx);
    const sw = v.hex ? `<span class="xp-d-ms" style="background-color:${esc(v.css)}" aria-hidden="true"></span>` : '';
    return `<div class="xp-d-val">${sw}<span><span class="xp-d-val-label">${esc(c.label)}</span><span class="xp-d-val-main mono">${esc(v.alias ? swatchLabel(v.alias) : v.line)}</span>${
      v.alias ? `<span class="xp-d-val-sub mono">${esc(v.hex ?? v.line)}</span>` : ''
    }</span></div>`;
  };
  host.innerHTML = `
    <div class="xp-d-bar is-studio">
      <h2 class="xp-d-name mono" id="xp-d-title" tabindex="-1">${esc(path)}</h2>
      <button type="button" class="icon-btn" data-xp-close aria-label="Close token details">${icon('close', 18)}</button>
    </div>
    <div class="xp-d-body is-studio" data-xp-detail-body>
      ${x.description ? `<p class="xp-d-line" title="${esc(x.description)}">${esc(x.description)}</p>` : '<p class="xp-d-line muted">No description yet.</p>'}
      <div class="xp-d-vals" style="--xp-n:${Math.min(columns.length, 2)}">${columns.map(val).join('')}</div>
      <div class="xp-d-accs">
        ${acc('flow', 'branch', 'Where the value comes from', `${f.steps} step${f.steps === 1 ? '' : 's'}`, `${f.upstream}${f.aliased}`)}
        ${acc('used', 'box', 'Used by', usedByLine(f.comps.length, f.styles), `${f.comps.length || !f.styles.length ? f.compList : ''}${f.styleList}`)}
        ${acc('history', 'clock', 'History', 'Reading', '<div class="tx-d-foot" hidden></div>')}
      </div>
    </div>
    <div class="xp-d-editbar"><button type="button" class="btn btn-secondary" data-xp-edit-cell>${icon('pencil', 16)}Edit</button><span class="xp-d-editnote">Opens the value editor on the row.</span></div>`;
  watchHistory(host, path);
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

/** Contrast pairs of a color token: the list (direct pairs, then the pairs that resolve through it) and counts. */
function contrastParts(d: ExplorerData, path: string): { body: string; pairs: number; failing: number } {
  const { direct, through } = contrastFor(path, d.results);
  const failing = [...direct, ...through].filter((r) => r.failing).length;
  const list = direct.length ? `<ul class="xp-pairs">${direct.map((r) => pairRow(d, r, false)).join('')}</ul>` : '';
  const via = through.length
    ? `<details class="xp-through"${direct.length ? '' : ' open'}><summary>${through.length} pair${through.length > 1 ? 's' : ''} resolve through this token${
        through.some((r) => r.failing) ? `, <strong class="xp-fail-text">${through.filter((r) => r.failing).length} failing</strong>` : ''
      }</summary><ul class="xp-pairs">${through
        .slice(0, 8)
        .map((r) => pairRow(d, r, false, true))
        .join('')}</ul>${through.length > 8 ? `<p class="small muted">and ${through.length - 8} more</p>` : ''}</details>`
    : '';
  const body = list || via ? `${list}${via}` : '<p class="xp-empty-line">No contrast check reads this color yet.</p>';
  return { body, pairs: direct.length + through.length, failing };
}

/** A collapsed row with its count on the end: the same disclosure as the Studio details. */
const acc = (key: string, ic: 'branch' | 'box' | 'clock' | 'link' | 'contrast' | 'code', label: string, meta: string, content: string) =>
  `<details class="xp-d-acc" data-acc="${key}"><summary>${icon(ic, 18)}<span class="xp-d-acc-label">${esc(label)}</span><span class="xp-d-acc-meta" data-acc-meta>${esc(meta)}</span><span class="xp-d-acc-chev">${icon(
    'chevron',
    16,
  )}</span></summary><div class="xp-d-acc-body">${content}</div></details>`;

/** The History row's meta follows the history panel (scripts/history/token-panel.ts) as it fills in. */
function watchHistory(host: HTMLElement, path: string) {
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

// ---------------------------------------------------------------------------------------------------------------
// Library details

/** Rows a list shows before "Show all N". */
const ROWS_SHOWN = 5;

/** A large specimen of the value, drawn on the mode's own canvas where the color matters. */
function specimen(d: ExplorerData, type: string, path: string, v: CellValue, col: Column): string {
  const cls = 'xp-dd-spec';
  if (v.resolved === undefined) return `<span class="${cls} is-broken" aria-hidden="true"></span>`;
  const css = esc(v.css);
  const canvas = d.set.byPath.has('color.bg.default') ? esc(cellValue(d.set, 'color.bg.default', col.ctx).css) : 'transparent';
  switch (type) {
    case 'color': {
      if (isForeground(path)) {
        const bg = pairedBackground(path, (p) => d.set.byPath.has(p), d.pairs);
        return `<span class="${cls} is-type" style="background-color:${esc(cellValue(d.set, bg, col.ctx).css)};color:${css}" aria-hidden="true">Aa</span>`;
      }
      return `<span class="${cls} is-color${colorAlpha(v.resolved) < 0.9995 ? ' has-alpha' : ''}" style="background-color:${canvas}" aria-hidden="true"><i style="background-color:${css}"></i></span>`;
    }
    case 'shadow':
      return `<span class="${cls}" style="background-color:${canvas}" aria-hidden="true"><span class="xp-dd-card" style="box-shadow:${css}"></span></span>`;
    case 'fontFamily':
      return `<span class="${cls} is-type" style="font-family:${css}" aria-hidden="true">Ag</span>`;
    case 'fontWeight':
      return `<span class="${cls} is-type" style="font-weight:${css}" aria-hidden="true">Ag</span>`;
    case 'cubicBezier': {
      const p = bezierPath(v.resolved, 40);
      return p ? `<span class="${cls}" aria-hidden="true"><svg viewBox="-4 -4 48 48" width="48" height="48"><path d="M0 40 L40 0" class="xp-curve-ref" fill="none"/><path d="${p}" class="xp-curve" fill="none"/></svg></span>` : '';
    }
    case 'duration': {
      const ms = numericValue(v.resolved) ?? 0;
      return `<span class="${cls} is-track" aria-hidden="true"><i class="xp-dot" style="animation-duration:${Math.max(ms, 1)}ms"></i></span>`;
    }
    case 'dimension': {
      const px = numericValue(v.resolved) ?? 0;
      if (/(^|\.)radius(\.|$)/.test(path)) return `<span class="${cls}" aria-hidden="true"><span class="xp-dd-corner" style="border-top-left-radius:${Math.min(px, 48)}px"></span></span>`;
      if (/font\.size/.test(path)) return `<span class="${cls} is-type" style="font-size:${Math.min(px, 64)}px" aria-hidden="true">Ag</span>`;
      if (/(tracking|letter-spacing)/.test(path)) return `<span class="${cls} is-type is-word" style="letter-spacing:${css}" aria-hidden="true">Tracking</span>`;
      if (/(border|stroke|ring)/.test(path) && px <= 8) return `<span class="${cls}" aria-hidden="true"><span class="xp-dd-stroke" style="border-top-width:${px}px"></span></span>`;
      return `<span class="${cls} is-bar" aria-hidden="true"><i style="width:${Math.max(Math.min(px, 160), 1)}px"></i></span>`;
    }
    case 'number':
      if (/line-height/.test(path)) return `<span class="${cls} is-type is-leading" style="line-height:${css}" aria-hidden="true">Ag<br />Ag</span>`;
      return '';
    default:
      return '';
  }
}

/** The value once per mode: specimen, value, copy. The mode label shows only when there is more than one mode. */
function valueCards(d: ExplorerData, path: string, type: string, columns: Column[]): string {
  const many = columns.length > 1;
  const card = (c: Column) => {
    const v = cellValue(d.set, path, c.ctx);
    const copy = type === 'color' ? (v.hex ?? v.css) : v.css;
    const text = v.error ? v.line : v.line || v.css;
    return `<div class="xp-dd-val">${specimen(d, type, path, v, c)}<div class="xp-dd-val-row"><span class="xp-dd-val-text">${
      many ? `<span class="xp-dd-val-label">${esc(c.label)}</span>` : ''
    }<span class="xp-dd-val-main mono${v.error ? ' xp-fail-text' : ''}">${esc(text)}</span></span>${copy ? copyButton(copy, `${many ? `${c.label} ` : ''}value ${copy}`, 'is-visible', true) : ''}</div></div>`;
  };
  return `<div class="xp-dd-vals" style="--xp-n:${Math.min(columns.length, 2)}">${columns.map(card).join('')}</div>`;
}

/**
 * Where the value comes from, one line per distinct chain, each link opens that token: "Comes from
 * palette.primary.700 > color.harbor.700". Modes with different chains get a line each, under one "Comes from".
 * A primitive (no alias) shows nothing.
 */
function chainLines(d: ExplorerData, path: string, columns: Column[]): string {
  const lanes = upstreamLanes(d.set, path, columns).filter((l) => l.nodes.length > 1 || l.error);
  if (!lanes.length) return '';
  const many = lanes.length > 1;
  const sep = `<span class="xp-dd-arrow" aria-hidden="true">${icon('arrowRight', 14)}</span><span class="sr-only">, then</span>`;
  const lines = lanes.map((lane) => {
    const label = many ? `<span class="xp-dd-chain-label">${esc(lane.columns.map((c) => c.label).join(', '))}</span>` : '<span class="muted">Comes from</span>';
    const links = lane.nodes
      .slice(1)
      .map((n) => `<button type="button" class="xp-link mono" data-goto="${esc(n.path)}">${esc(n.path)}</button>${n.override ? '<span class="muted">(brand override)</span>' : ''}`)
      .join(sep);
    const err = lane.error ? `<span class="xp-fail-text">${icon('alert', 14)} Does not resolve: ${esc(lane.error)}</span>` : '';
    return `<p class="xp-dd-chain">${label}${links}${err}</p>`;
  });
  return `<div class="xp-dd-from">${many ? '<p class="xp-dd-from-head muted">Comes from</p>' : ''}${lines.join('')}</div>`;
}

/** One row component for "Aliased by" and "Used by": the first rows, then "Show all N". */
function rowList(rows: string[]): string {
  const more = rows.length - ROWS_SHOWN;
  return `<ul class="xp-dd-rows">${rows.map((r, i) => (i >= ROWS_SHOWN ? r.replace('<li class="xp-dd-row"', '<li class="xp-dd-row" hidden') : r)).join('')}</ul>${
    more > 0 ? `<button type="button" class="btn btn-secondary btn-sm xp-dd-more" data-xp-more>Show all ${rows.length}</button>` : ''
  }`;
}

/** A row: the name that opens it, what it is on the end. */
const tokenRow = (p: string, kind: string) =>
  `<li class="xp-dd-row"><button type="button" class="xp-dd-row-name xp-link mono" data-goto="${esc(p)}">${esc(p)}</button><span class="xp-dd-row-meta">${esc(kind)}</span></li>`;

const usedRow = (r: UsedByRow) =>
  `<li class="xp-dd-row">${r.href ? `<a class="xp-dd-row-name" href="${esc(r.href)}">${esc(r.name)}</a>` : `<span class="xp-dd-row-name mono">${esc(r.name)}</span>`}<span class="xp-dd-row-meta${
    r.via.includes('.') ? ' mono' : ''
  }">${esc(r.via)}</span></li>`;

function renderLibraryDetail(host: HTMLElement, d: ExplorerData, view: View, path: string) {
  const x = d.byPath.get(path)!;
  const t = d.set.byPath.get(path)!;
  const columns = view.columns;
  const deps = directDependents(d.set, path);
  const all = transitiveDependents(d.set, path);
  const comps = componentsUsing(path, all, d.usage);
  const styles = stylesUsing(path, all, d.usage);
  const desc = splitDescription(x.description);
  const override = columns.map((c) => ({ c, v: cellValue(d.set, path, c.ctx) })).find((e) => e.v.override);
  const sentence = summarySentence({ tier: t.tier, aliasedBy: deps.map((dep) => dep.tier), components: comps.length, styles: styles.length, overriddenBy: override?.c.ctx.brand });

  const aliased = deps.length
    ? acc('aliased', 'link', 'Aliased by', `${deps.length} token${deps.length === 1 ? '' : 's'}`, rowList(deps.map((dep) => tokenRow(dep.path, TIER_NAMES[dep.tier] ?? dep.tier))))
    : '';
  const used = comps.length + styles.length ? acc('used', 'box', 'Used by', usedByLine(comps.length, styles), rowList(usedByRows(path, all, comps, styles, d.reads).map(usedRow))) : '';
  const c = t.type === 'color' ? contrastParts(d, path) : undefined;
  const contrast = c ? acc('contrast', 'contrast', 'Contrast', contrastMeta(c.pairs, c.failing), c.body) : '';
  // The names a token goes by in code and in Figma, the same for designers and developers. Where it is defined is one
  // quiet link to GitHub on that line; install notes in the description belong to the Install page, not here.
  const files = definedIn(t.files, d.tokensRoot ?? '');
  const source = files.length && d.repo ? `https://github.com/${d.repo.owner}/${d.repo.name}/blob/${d.repo.defaultBranch}/${files[0]}` : null;
  const named = acc(
    'names',
    'code',
    'Names in code and Figma',
    'CSS, JS, DTCG and Figma',
    `${names(path, t.tier)}${source ? `<p class="xp-dd-files"><a href="${esc(source)}" target="_blank" rel="noopener">Open on GitHub</a></p>` : ''}`,
  );

  host.innerHTML = `
    <div class="xp-d-bar">
      <span class="xp-d-crumb">${esc(x.collection)} <span aria-hidden="true">/</span> ${esc(CATEGORY_LABEL[x.category])}</span>
      <button type="button" class="icon-btn" data-xp-close aria-label="Close token details">${icon('close', 18)}</button>
    </div>
    <div class="xp-d-body xp-dd" data-xp-detail-body>
      <header class="xp-dd-head">
        <h2 class="xp-dd-name mono" id="xp-d-title">${esc(path)}</h2>
        ${desc.lead ? `<p class="xp-dd-lead">${esc(desc.lead)}</p>` : ''}
      </header>
      <section class="xp-dd-summary" aria-label="Value">
        ${valueCards(d, path, t.type, columns)}
        ${chainLines(d, path, columns)}
        <p class="xp-dd-sentence">${esc(sentence)} <span data-xp-introduced hidden></span></p>
      </section>
      <div class="xp-d-accs">
        ${aliased}${used}${contrast}
        ${acc('history', 'clock', 'History', 'Reading', '<div class="tx-d-foot" hidden></div>')}
        ${named}
      </div>
    </div>
    <div class="xp-d-editbar xp-dd-editbar" data-maintainer-only><a class="btn btn-primary xp-dd-edit" href="${esc(studioHref(path))}" data-xp-studio>${icon('pencil', 16)}Edit in Studio</a></div>`;
  host.querySelectorAll<HTMLElement>('[data-xp-more]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      b.previousElementSibling?.querySelectorAll<HTMLElement>('.xp-dd-row[hidden]').forEach((r) => (r.hidden = false));
      b.remove();
    }),
  );
  watchHistory(host, path);
  void fillIntroduced(host, path);
}

export function renderDetail(host: HTMLElement, d: ExplorerData, view: View, s: ExplorerState, path: string) {
  const x = d.byPath.get(path);
  const t = d.set.byPath.get(path);
  if (!x || !t) {
    host.innerHTML = `<div class="xp-d-body"><p class="xp-empty-line">This token is not in the token files this page was built from.</p></div>`;
    return;
  }
  if (s.mode === 'edit') return renderStudioDetail(host, d, view, path);
  renderLibraryDetail(host, d, view, path);
}

async function fillIntroduced(host: HTMLElement, path: string) {
  try {
    const L = await loadHistory();
    const { report, demo } = activeReport(L.data);
    if (!report || demo) return;
    const v = introducedIn(tokenHistory(report.entries, path, L.config));
    const el = host.querySelector<HTMLElement>('[data-xp-introduced]');
    if (!v || !el || host.querySelector('#xp-d-title')?.textContent !== path) return;
    el.textContent = `Introduced in v${v}.`;
    el.hidden = false;
  } catch {
    /* no history in this build: omit the line */
  }
}

export const syntaxes = SYNTAXES;
