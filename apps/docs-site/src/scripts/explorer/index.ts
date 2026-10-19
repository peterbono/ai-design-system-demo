// Token explorer (components/explorer/TokenExplorer.astro): lens + tree on the left, a Figma-like grid with one
// column per relevant mode in the center, a detail panel with the token flow on the right. Builds the token set in
// the browser with @bridge-ds/core from the embedded token files. In edit mode, cells edit through the existing
// token editor (draft, guardrails, tray, pull request); the page's "Edit tokens" toggle switches modes at runtime.
import { TIER_ORDER, type Tier } from '@bridge-ds/core';
import { CATEGORY_LABEL, CATEGORY_ORDER, modeName, STUDIO_TIER_NAMES, typeCategory, type Syntax, type TypeCategory } from '../../lib/explorer/format';
import {
  activeFilterCount,
  applyFilters,
  buildTokens,
  categoryList,
  collectionTree,
  componentScope,
  defaultCtx,
  emptyFilters,
  inSelection,
  modesOf,
  planColumns,
  resolveFocus,
  studioHref,
  varyingOf,
  type Selection,
  type UsageMap,
} from '../../lib/explorer/model';
import { initTokenHistoryPanel } from '../history/token-panel';
import { editorReady, editorSnapshot, initTokenEditor, setEditing } from '../token-editor';
import { cellValue } from '../../lib/explorer/model';
import { codeSyntax } from '../../lib/explorer/format';
import { initReview } from './review';
import { loadExplorerData, readJson } from './data';
import { onSelectPick, setSelect } from '../../lib/select-bridge';
import { paintVanilla } from '../vanilla-controls';
import { renderDetail, syntaxes } from './detail';
import { refreshRow, renderGrid } from './grid';
import { closeInlineEditor, inlineEditorOpen, openInlineEditor } from './inline-edit';
import type { ExplorerData, ExplorerMode, ExplorerState, View } from './types';
import { copyText, esc, icon } from './util';
import { selectSegment } from '../shell';
import { buildTokenSet, contrastScope, evaluatePairs, formatValue, layoutOptions, loadConfig } from '@bridge-ds/core';
import { bannerBody, changedTokens, isTogether } from '../../lib/view-scope';
import { currentPull, pageScope, readFailure, scopeLibrary, setBannerBody, setBannerError } from '../view-change';

const NARROW = '(max-width: 1099px)';
let historyPanelReady = false;

export function initTokenExplorer() {
  const found = document.querySelector<HTMLElement>('[data-xp]');
  if (!found || found.dataset.ready) return;
  const root: HTMLElement = found;
  root.dataset.ready = '';
  const t0 = performance.now();

  // ---- data
  const d: ExplorerData = loadExplorerData();
  const { modes } = d;
  let { results } = d;
  // Studio Tokens can show the library as an open change (lib/view-scope ?change=N): read only, its values in the
  // table, the tokens it changes marked. Editing a change is ?change=N&edit=1 (the token editor scoped to it).
  const viewing = root.dataset.surface === 'app' && pageScope().kind === 'view';
  const buildMs = performance.now() - t0;

  // ---- elements
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const grid = $<HTMLElement>('[data-xp-grid]');
  const scroller = $<HTMLElement>('[data-xp-scroll]');
  const main = $<HTMLElement>('[data-xp-main]');
  // The Library's lens and collections tree; Studio has none (type chips and the Options menu instead).
  const tree = root.querySelector<HTMLElement>('[data-xp-tree]');
  const detail = $<HTMLElement>('[data-xp-detail]');
  const scrim = $<HTMLElement>('[data-xp-scrim]');
  const q = $<HTMLInputElement>('[data-xp-q]');
  const exact = $<HTMLButtonElement>('[data-xp-exact]');
  const filtersEl = $<HTMLDetailsElement>('[data-xp-filters]');
  const filterN = $<HTMLElement>('[data-xp-filter-n]');
  const modebar = $<HTMLElement>('[data-xp-modebar]');
  // The code syntax menu is a DS Select island (components/ds/BridgedSelect, id xp-syntax).
  const SYNTAX_SELECT = 'xp-syntax';
  const descBtn = $<HTMLButtonElement>('[data-xp-desc]');
  const title = $<HTMLElement>('[data-xp-title]');
  const count = $<HTMLElement>('[data-xp-count]');
  const empty = $<HTMLElement>('[data-xp-empty]');
  // Static DS SegmentedControls (data-vanilla): scripts/shell.ts handles clicks and arrow keys and reports a change
  // with a bubbling bridge:segment event; this script keeps the state and selects with selectSegment().
  const lens = root.querySelector<HTMLElement>('[data-xp-lens]');
  const chips = root.querySelector<HTMLElement>('[data-xp-chips]');
  const brandSeg = root.querySelector<HTMLElement>('[data-xp-brand]');
  const densitySeg = root.querySelector<HTMLElement>('[data-xp-density]');
  const brandField = root.querySelector<HTMLElement>('[data-xp-mode-field="brand"]');
  const densityField = root.querySelector<HTMLElement>('[data-xp-mode-field="density"]');
  // Switches and filter checkboxes and radios are static DS controls (data-vanilla, scripts/vanilla-controls.ts).
  const combosBtn = root.querySelector<HTMLElement>('[data-combos]');
  const combosField = root.querySelector<HTMLElement>('[data-combos-field]');
  // Studio surface only: the Modes and View menus, and the row density control.
  const app = root.dataset.surface === 'app';
  const modesMenu = root.querySelector<HTMLDetailsElement>('[data-xp-modes-menu]');
  const modesLabel = root.querySelector<HTMLElement>('[data-xp-modes-label]');
  const rowsSeg = root.querySelector<HTMLElement>('[data-xp-rows]');
  const menus = [...root.querySelectorAll<HTMLDetailsElement>('details.xp-menu, details[data-xp-filters]')];
  const narrow = window.matchMedia(NARROW);

  // Studio's default scope: the tokens a product team edits, Semantic and Base (theme-independent semantics).
  const APP_TIERS: Tier[] = ['semantic', 'base'];
  const tierRank = (t: Tier) => (APP_TIERS.includes(t) ? APP_TIERS.indexOf(t) - APP_TIERS.length : TIER_ORDER.indexOf(t));
  const isDefaultTiers = (t: Tier[]) => t.length === APP_TIERS.length && APP_TIERS.every((x) => t.includes(x));

  // ---- state (URL first, then the focus prop, then defaults)
  const params = new URLSearchParams(location.search);
  const focus = params.get('focus') || params.get('t') || root.dataset.focus || '';
  const base = defaultCtx(modes);
  const s: ExplorerState = {
    mode: root.dataset.mode === 'edit' ? 'edit' : 'read',
    selection: { lens: 'collections', tier: 'semantic' },
    filters: emptyFilters(),
    view: { brand: params.get('brand') && modes.brands.includes(params.get('brand')!) ? params.get('brand')! : base.brand, theme: base.theme, density: base.density, allCombos: params.get('combos') === '1' },
    syntax: (syntaxes as string[]).includes(params.get('syntax') ?? '') ? (params.get('syntax') as Syntax) : 'css',
    // Studio shows Name and the mode columns only; the View menu brings a code column back.
    showCode: root.dataset.surface !== 'app' || (syntaxes as string[]).includes(params.get('syntax') ?? ''),
    showDescription: params.get('desc') === '1',
    flat: app,
    collapsed: new Set(),
    treeOpen: new Set(),
    selected: null,
    active: null,
  };
  const tierParam = (params.get('c') || params.get('layer')) as Tier | 'all' | null;
  const cat = params.get('cat') as TypeCategory | null;
  const oldType = params.get('type');
  if (params.get('lens') === 'types' || cat || oldType) {
    const category = cat && CATEGORY_ORDER.includes(cat) ? cat : oldType ? typeCategory({ path: '', type: oldType }) : 'color';
    s.selection = { lens: 'types', category: params.get('cat') === 'all' ? 'all' : category };
  } else if (tierParam && (tierParam === 'all' || TIER_ORDER.includes(tierParam))) {
    s.selection = { lens: 'collections', tier: tierParam, group: params.get('g') || undefined };
  }
  s.filters.query = params.get('q') ?? '';
  s.filters.exact = params.get('exact') === '1';
  const usageParam = params.get('usage');
  if (usageParam === 'used' || usageParam === 'unused') s.filters.usage = usageParam;
  s.filters.tiers = (params.get('ft') ?? '').split(',').filter((x): x is Tier => TIER_ORDER.includes(x as Tier));
  s.filters.categories = (params.get('fc') ?? '').split(',').filter((x): x is TypeCategory => CATEGORY_ORDER.includes(x as TypeCategory));
  const target = resolveFocus(d.tokens, focus);
  if (target?.kind === 'token') {
    s.selection = { lens: 'collections', tier: target.tier };
    s.selected = target.path;
  } else if (target?.kind === 'group') {
    s.selection = { lens: 'collections', tier: target.tier, group: target.group };
  }
  // Studio: one flat table over every collection, scoped by the Options collections (Semantic and Base by default) and
  // the type chips. Older links (?c=, ?lens=types&cat=) map onto those; a group focus (?focus=color.text) stays a
  // selection so the table shows that group only.
  if (app) {
    const sel = s.selection;
    if (sel.lens === 'types') {
      if (sel.category !== 'all' && !s.filters.categories.length) s.filters.categories = [sel.category];
      s.selection = { lens: 'collections', tier: 'all' };
    } else if (sel.tier !== 'all' && !sel.group) {
      // An explicit ?c= link scopes to that collection; the built-in default (Semantic) gives way to APP_TIERS.
      if (!s.filters.tiers.length && tierParam && tierParam !== 'all' && target?.kind !== 'token') s.filters.tiers = [sel.tier];
      s.selection = { lens: 'collections', tier: 'all' };
    }
    if (!s.filters.tiers.length && !params.get('ft') && s.selection.lens === 'collections' && !s.selection.group) s.filters.tiers = [...APP_TIERS];
    if (target?.kind === 'token' && s.filters.tiers.length && !s.filters.tiers.includes(target.tier)) s.filters.tiers = [...s.filters.tiers, target.tier];
    s.filters.categories = s.filters.categories.slice(0, 1);
  }
  // Studio ?component=<slug> (Studio > Components, Edit tokens): exactly the tokens that component reads, across every
  // collection, shown as a removable chip in the chip row. Clearing it returns to the default scope.
  const componentIndex = readJson<Record<string, { name: string; paths: string[]; via?: string[] }>>('xp-components', {});
  const compSlug = params.get('component') ?? '';
  let comp = app && componentIndex[compSlug] ? { slug: compSlug, ...componentIndex[compSlug]! } : null;
  if (comp && !params.get('ft')) {
    s.filters.tiers = [...TIER_ORDER];
    s.selection = { lens: 'collections', tier: 'all' };
  }
  /** "IconButton (incl. Button)" when the component paints with another component's stylesheet too. */
  const compLabel = (c: { name: string; via?: string[] }) => (c.via?.length ? `${c.name} (incl. ${c.via.join(', ')})` : c.name);
  const isAllTiers = (t: Tier[]) => TIER_ORDER.every((x) => t.includes(x));
  function clearComponent() {
    comp = null;
    if (isAllTiers(s.filters.tiers)) s.filters.tiers = [...APP_TIERS];
  }
  q.value = s.filters.query;

  // ---- derived view
  let view: View = computeView();
  function computeView(): View {
    const inSel = d.tokens.filter((t) => inSelection(t, s.selection));
    const visible = applyFilters(comp ? componentScope(inSel, comp.paths) : inSel, s.filters);
    if (!app) {
      const plan = planColumns(s.selection, d.modes, s.view, varyingOf(inSel));
      return { visible, plan, columns: plan.columns };
    }
    // Studio: Semantic rows first, then Base, then the other collections in order (a stable sort keeps token order).
    visible.sort((x, y) => tierRank(x.tier) - tierRank(y.tier));
    // Showing a change: the tokens it changes come first, so the first screen shows them.
    if (d.marks?.size) visible.sort((x, y) => Number(d.marks!.has(y.path)) - Number(d.marks!.has(x.path)));
    // The columns follow the collections in scope (one collection: its own modes, like the Library tree).
    const scope = scoped();
    const sel = s.selection;
    const planSel = sel.lens === 'collections' && sel.tier === 'all' && s.filters.tiers.length === 1 ? { lens: 'collections' as const, tier: s.filters.tiers[0]! } : sel;
    const plan = planColumns(planSel, d.modes, s.view, varyingOf(scope));
    return { visible, plan, columns: plan.columns };
  }
  /** Studio: tokens in the selection and the Options collections, before the type chip, usage and the filter field. */
  function scoped() {
    const inScope = d.tokens.filter((t) => inSelection(t, s.selection) && (!s.filters.tiers.length || s.filters.tiers.includes(t.tier)));
    return comp ? componentScope(inScope, comp.paths) : inScope;
  }

  const syncUrl = () => {
    const p = new URLSearchParams();
    const sel = s.selection;
    if (sel.lens === 'types') {
      p.set('lens', 'types');
      p.set('cat', sel.category);
    } else if (!app || sel.tier !== 'all' || sel.group) {
      p.set('c', sel.tier);
      if (sel.group) p.set('g', sel.group);
    }
    if (comp) p.set('component', comp.slug);
    if (s.filters.query) p.set('q', s.filters.query);
    if (s.filters.exact) p.set('exact', '1');
    if (s.filters.usage) p.set('usage', s.filters.usage);
    const grouped = sel.lens === 'collections' && Boolean(sel.group);
    const defaultScope = comp ? isAllTiers(s.filters.tiers) : isDefaultTiers(s.filters.tiers);
    if (s.filters.tiers.length ? !(app && defaultScope) : app && !grouped) p.set('ft', s.filters.tiers.join(',') || 'all');
    if (s.filters.categories.length) p.set('fc', s.filters.categories.join(','));
    if (s.view.brand !== base.brand) p.set('brand', s.view.brand);
    if (s.view.allCombos) p.set('combos', '1');
    if (app ? s.showCode : s.syntax !== 'css') p.set('syntax', s.syntax);
    if (s.showDescription) p.set('desc', '1');
    if (s.selected) p.set('t', s.selected);
    if (params.get('edit') === '1') p.set('edit', '1');
    // The editor scoped to a change (lib/continue-change) keeps its change in the URL.
    if (params.get('change')) p.set('change', params.get('change')!);
    // The Library page's "Edit in Studio" door follows the selection.
    const door = document.querySelector<HTMLAnchorElement>('[data-xp-studio-link]');
    if (door) {
      const f = s.selected ?? (sel.lens === 'collections' ? sel.group : undefined);
      door.href = f ? studioHref(f) : '/studio/tokens/';
    }
    try {
      history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
    } catch {
      /* sandboxed: state still works */
    }
  };

  // ---- left pane
  function counts() {
    const f = { ...s.filters };
    return applyFilters(d.tokens, f);
  }
  function renderTree() {
    if (!tree || !lens) return;
    const matching = counts();
    const n = (pred: (t: (typeof d.tokens)[number]) => boolean) => matching.filter(pred).length;
    selectSegment(lens, s.selection.lens);
    lens.querySelectorAll<HTMLElement>('[data-segment]').forEach((b) => {
      const c = b.querySelector('[data-lens-n]');
      if (c) c.textContent = String(b.dataset.value === 'collections' ? collectionTree(d.tokens).length : categoryList(d.tokens).length);
    });
    const sel = s.selection;
    const item = (label: string, count: number, attrs: string, current: boolean, extra = '', depth = 0) =>
      `<li class="xp-tree-item depth-${depth}"><button type="button" class="xp-tree-btn" ${attrs} ${current ? 'aria-current="true"' : ''}><span class="xp-tree-label">${esc(label)}</span><span class="xp-tree-n">${count}</span></button>${extra}</li>`;
    if (sel.lens === 'collections') {
      const all = item('All collections', matching.length, 'data-tier="all"', sel.tier === 'all' && !sel.group);
      const cols = collectionTree(d.tokens)
        .map((c) => {
          const open = sel.tier === c.tier || s.treeOpen.has(c.tier);
          const groups = open
            ? `<ul class="xp-tree-sub" role="list">${c.groups
                .map((g) => {
                  const gOpen = s.treeOpen.has(`${c.tier}:${g.key}`) || (sel.group ?? '').startsWith(`${g.key}.`);
                  const kids =
                    g.children.length && gOpen
                      ? `<ul class="xp-tree-sub" role="list">${g.children
                          .map((k) => item(k.label, n((t) => t.tier === c.tier && t.path.startsWith(`${k.key}.`)), `data-tier="${c.tier}" data-group="${esc(k.key)}"`, sel.tier === c.tier && sel.group === k.key, '', 2))
                          .join('')}</ul>`
                      : '';
                  const toggle = g.children.length
                    ? `<button type="button" class="xp-tree-twist" data-twist="${esc(`${c.tier}:${g.key}`)}" aria-expanded="${gOpen}" aria-label="${gOpen ? 'Collapse' : 'Expand'} ${esc(g.label)}">${icon('chevron', 12)}</button>`
                    : '';
                  return item(g.label, n((t) => t.tier === c.tier && (t.path === g.key || t.path.startsWith(`${g.key}.`))), `data-tier="${c.tier}" data-group="${esc(g.key)}"`, sel.tier === c.tier && sel.group === g.key, kids, 1).replace(
                    '<button type="button" class="xp-tree-btn"',
                    `${toggle}<button type="button" class="xp-tree-btn"`,
                  );
                })
                .join('')}</ul>`
            : '';
          return item(c.label, n((t) => t.tier === c.tier), `data-tier="${c.tier}"`, sel.tier === c.tier && !sel.group, groups);
        })
        .join('');
      tree.innerHTML = `<ul class="xp-tree-list" role="list">${all}${cols}</ul><p class="xp-tree-note">Same collections the Figma plugin creates.</p>`;
    } else {
      const all = item('All types', matching.length, 'data-category="all"', sel.category === 'all');
      const cats = categoryList(d.tokens)
        .map((c) => item(c.label, n((t) => t.category === c.category), `data-category="${c.category}"`, sel.category === c.category))
        .join('');
      tree.innerHTML = `<ul class="xp-tree-list" role="list">${all}${cats}</ul>`;
    }
  }

  // ---- toolbar
  /** Type chips of the Studio toolbar: All, then each type in scope, with counts that follow the filter field. */
  const CHIP_LABEL: Partial<Record<TypeCategory, string>> = { motion: 'Motion' };
  function renderChips() {
    if (!chips) return;
    const scope = scoped();
    const matching = applyFilters(scope, { ...s.filters, categories: [] });
    const cats = [...new Set(scope.map((t) => t.category))]
      .map((c) => ({ c, label: CHIP_LABEL[c] ?? CATEGORY_LABEL[c] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const current = s.filters.categories[0] ?? 'all';
    const chip = (value: string, label: string, n: number) =>
      `<button type="button" class="xp-chip-btn" aria-pressed="${current === value}" data-xp-chip="${value}">${esc(label)} <span class="xp-chip-n num">${n}</span></button>`;
    const used = comp
      ? `<button type="button" class="xp-chip-btn xp-chip-filter" data-xp-chip-clear aria-label="Remove filter: used by ${esc(compLabel(comp))}" title="Show every token again">Used by ${esc(compLabel(comp))} ${icon('close', 12)}</button>`
      : '';
    chips.innerHTML = [used, chip('all', 'All', matching.length), ...cats.map(({ c, label }) => chip(c, label, matching.filter((t) => t.category === c).length))].join('');
  }

  function renderAppToolbar() {
    const sel = s.selection;
    const scope = scoped();
    const tiers = s.filters.tiers.length ? [...s.filters.tiers].sort((a, b) => tierRank(a) - tierRank(b)) : [];
    const tierWord = (t: Tier) => (t === 'primitive' ? 'Primitive' : STUDIO_TIER_NAMES[t]);
    const names = tiers.map((t, i) => (i ? tierWord(t).toLowerCase() : tierWord(t)));
    const which = comp
      ? `Tokens used by ${compLabel(comp)}`
      : sel.lens === 'collections' && sel.group
        ? `${STUDIO_TIER_NAMES[sel.tier as Tier] ?? 'All'} tokens in ${sel.group}`
        : !names.length || names.length === TIER_ORDER.length
          ? 'All tokens'
          : `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} tokens`;
    const brandMatters = view.plan.selectors.includes('brand') || view.plan.combos;
    const brandNote = s.view.allCombos ? ', every brand and theme.' : comp ? `, ${modeName(s.view.brand)} brand.` : ` of the ${modeName(s.view.brand)} brand.`;
    title.textContent = `${which}${brandMatters ? brandNote : '.'}`;
    q.placeholder = `Filter ${scope.length} tokens`;
    count.textContent = `${view.visible.length} of ${scope.length} tokens shown`;
    const n = ((comp ? isAllTiers(s.filters.tiers) : isDefaultTiers(s.filters.tiers)) || sel.lens !== 'collections' || sel.group ? 0 : 1) + (s.filters.usage ? 1 : 0) + (s.filters.exact ? 1 : 0);
    filterN.textContent = String(n);
    filterN.hidden = n === 0;
    // Collections and usage live under Advanced in Options: open it while one of them filters the table.
    const adv = filtersEl.querySelector<HTMLDetailsElement>('[data-xp-advanced]');
    if (adv && n - (s.filters.exact ? 1 : 0) > 0) adv.open = true;
    renderChips();
  }

  function renderToolbar() {
    const sel = s.selection;
    const label =
      sel.lens === 'types'
        ? sel.category === 'all'
          ? 'All types'
          : CATEGORY_LABEL[sel.category]
        : sel.tier === 'all'
          ? 'All collections'
          : `${collectionTree(d.tokens).find((c) => c.tier === sel.tier)?.label ?? sel.tier}${sel.group ? ` / ${sel.group.split('.').join(' / ')}` : ''}`;
    if (app) renderAppToolbar();
    else {
      title.textContent = label;
      const total = d.tokens.filter((t) => inSelection(t, sel)).length;
      count.textContent = view.visible.length === total ? `${total} tokens` : `${view.visible.length} of ${total} tokens`;
      const fN = activeFilterCount(s.filters);
      filterN.textContent = String(fN);
      filterN.hidden = fN === 0;
    }
    exact.setAttribute(exact.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(s.filters.exact));
    filtersEl.querySelectorAll<HTMLInputElement>('input[name="xp-ft"]').forEach(
      (i) =>
        (i.checked =
          !app || s.filters.tiers.length
            ? s.filters.tiers.includes(i.value as Tier)
            : sel.lens !== 'collections' || sel.tier === 'all' || sel.tier === i.value),
    );
    filtersEl.querySelectorAll<HTMLInputElement>('input[name="xp-fc"]').forEach((i) => (i.checked = s.filters.categories.includes(i.value as TypeCategory)));
    filtersEl.querySelectorAll<HTMLInputElement>('input[name="xp-usage"]').forEach((i) => (i.checked = i.value === s.filters.usage));
    paintVanilla(filtersEl);
    setSelect(SYNTAX_SELECT, { value: s.showCode ? s.syntax : '' });
    descBtn.setAttribute(descBtn.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(s.showDescription));

    // Brand and density selectors and the combinations switch are rendered by TokenExplorer.astro; show the ones
    // this selection's columns need and sync their state.
    const plan = view.plan;
    // Studio always shows the brand switch in Options (with New brand under it); the Library only when a column needs it.
    const showBrand = (plan.selectors.includes('brand') || app) && !s.view.allCombos;
    const showDensity = plan.selectors.includes('density');
    if (brandField) brandField.hidden = !showBrand;
    if (densityField) densityField.hidden = !showDensity;
    if (brandSeg) selectSegment(brandSeg, s.view.brand);
    if (densitySeg) selectSegment(densitySeg, s.view.density);
    if (combosBtn) {
      if (combosField) combosField.hidden = !plan.combos;
      combosBtn.setAttribute('aria-checked', String(s.view.allCombos));
    }
    const any = showBrand || showDensity || plan.combos;
    if (app && modesMenu) {
      modesMenu.hidden = !any;
      if (modesLabel) {
        const bits: string[] = [];
        if (s.view.allCombos) bits.push(`All ${d.modes.brands.length * d.modes.themes.length} combinations`);
        else if (plan.selectors.includes('brand')) bits.push(modeName(s.view.brand));
        if (plan.selectors.includes('density')) bits.push(modeName(s.view.density));
        modesLabel.textContent = bits.length ? bits.join(', ') : 'Modes';
      }
      return;
    }
    modebar.hidden = !any;
  }

  // ---- grid
  let lastRender = { firstMs: 0, totalMs: 0 };
  function render(opts: { keepScroll?: boolean; sync?: boolean } = {}) {
    closeInlineEditor(false);
    view = computeView();
    const top = scroller.scrollTop;
    const r = renderGrid(grid, d, view, s, { sync: opts.sync });
    lastRender.firstMs = r.firstMs;
    void r.done.then((ms) => {
      lastRender.totalMs = ms;
      root.dataset.renderMs = `${lastRender.firstMs.toFixed(1)}/${ms.toFixed(1)}`;
      markActive();
    });
    empty.hidden = view.visible.length > 0;
    grid.hidden = view.visible.length === 0;
    if (opts.keepScroll) scroller.scrollTop = top;
    else scroller.scrollTop = 0;
    renderTree();
    renderToolbar();
    markActive();
    syncUrl();
  }

  // ---- roving focus
  const rows = () => [...grid.querySelectorAll<HTMLElement>('.xp-tr[data-path], .xp-tr.is-section')].filter((r) => r.offsetParent !== null || r.closest('.xp-group'));
  const rowKey = (r: HTMLElement) => r.dataset.path ?? `sec:${r.dataset.section}`;
  const cellsOf = (r: HTMLElement) => [...r.querySelectorAll<HTMLElement>('[data-col]')];
  function findRow(key: string) {
    return key.startsWith('sec:')
      ? grid.querySelector<HTMLElement>(`.xp-tr.is-section[data-section="${CSS.escape(key.slice(4))}"]`)
      : grid.querySelector<HTMLElement>(`.xp-tr[data-path="${CSS.escape(key)}"]`);
  }
  function markActive() {
    grid.querySelectorAll<HTMLElement>('[data-col][tabindex="0"]').forEach((c) => (c.tabIndex = -1));
    let row = s.active ? findRow(s.active.row) : null;
    if (!row) {
      row = (s.selected ? findRow(s.selected) : null) ?? grid.querySelector<HTMLElement>('.xp-tr[data-path]');
      if (row) s.active = { row: rowKey(row), col: s.active?.col ?? 0 };
    }
    if (!row || !s.active) return;
    const cells = cellsOf(row);
    const cell = cells[Math.min(s.active.col, cells.length - 1)];
    if (cell) cell.tabIndex = 0;
  }
  // Scroll the grid scroller only, never the page: the page header and toolbar stay put on a ?focus= or ?t= load.
  function reveal(el: HTMLElement, align: 'nearest' | 'center') {
    if (scroller.scrollHeight <= scroller.clientHeight && scroller.scrollWidth <= scroller.clientWidth) return;
    const box = scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const headH = scroller.querySelector<HTMLElement>('.xp-head')?.offsetHeight ?? 0;
    // The visible part of the scroller: it may run past the window, and the draft tray floats over its bottom.
    const tray = document.getElementById('ed-tray')?.getBoundingClientRect();
    const viewTop = Math.max(box.top, 0) + headH;
    const viewBottom = Math.min(box.bottom, window.innerHeight, tray && tray.height > 0 ? tray.top : Infinity);
    const viewH = Math.max(viewBottom - viewTop, r.height);
    if (align === 'center') scroller.scrollTop += r.top - viewTop - (viewH - r.height) / 2;
    else if (r.top < viewTop) scroller.scrollTop -= viewTop - r.top;
    else if (r.bottom > viewBottom) scroller.scrollTop += r.bottom - viewBottom;
    if (r.left < box.left) scroller.scrollLeft -= box.left - r.left;
    else if (r.right > box.right) scroller.scrollLeft += Math.min(r.right - box.right, r.left - box.left);
  }
  function focusCell(row: HTMLElement, col: number) {
    const cells = cellsOf(row);
    const c = Math.max(0, Math.min(col, cells.length - 1));
    s.active = { row: rowKey(row), col: row.classList.contains('is-section') ? (s.active?.col ?? 0) : c };
    grid.querySelectorAll<HTMLElement>('[data-col][tabindex="0"]').forEach((x) => (x.tabIndex = -1));
    const cell = cells[row.classList.contains('is-section') ? 0 : c]!;
    cell.tabIndex = 0;
    cell.focus({ preventScroll: true });
    reveal(cell, 'nearest');
  }

  // ---- detail panel
  let returnFocus: HTMLElement | null = null;
  function openDetail(path: string, opts: { focusTitle?: boolean } = {}) {
    if (!d.byPath.has(path) && !d.set.byPath.has(path)) return;
    s.selected = path;
    grid.querySelectorAll('.xp-tr[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
    findRow(path)?.setAttribute('aria-selected', 'true');
    renderDetail(detail, d, view, s, path);
    detail.hidden = false;
    root.classList.add('has-detail');
    const drawer = narrow.matches;
    detail.setAttribute('role', drawer ? 'dialog' : 'region');
    if (drawer) detail.setAttribute('aria-modal', 'true');
    else detail.removeAttribute('aria-modal');
    scrim.hidden = !drawer;
    document.body.classList.toggle('no-scroll', drawer);
    if (drawer || opts.focusTitle) {
      returnFocus ??= document.activeElement as HTMLElement | null;
      // Studio focuses its title; the Library details take focus on the panel (the heading is not a control).
      detail.tabIndex = -1;
      (detail.querySelector<HTMLElement>('#xp-d-title[tabindex]') ?? detail).focus();
    }
    syncUrl();
  }
  function closeDetail(restoreFocus = true) {
    if (detail.hidden) return;
    detail.hidden = true;
    scrim.hidden = true;
    root.classList.remove('has-detail');
    document.body.classList.remove('no-scroll');
    s.selected = null;
    grid.querySelectorAll('.xp-tr[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
    syncUrl();
    const back = returnFocus ?? (s.active ? cellsOf(findRow(s.active.row) ?? grid)[s.active.col] : null);
    returnFocus = null;
    if (restoreFocus) back?.focus();
  }

  /** Shows a token: switches to its collection when the current view hides it, then selects and reveals it. */
  function goto(path: string) {
    const x = d.byPath.get(path);
    if (!x) return;
    if (!view.visible.some((t) => t.path === path)) {
      if (app) {
        if (comp && !comp.paths.includes(path)) clearComponent();
        s.selection = { lens: 'collections', tier: 'all' };
        const tiers = s.filters.tiers.length ? s.filters.tiers : comp ? [...TIER_ORDER] : [...APP_TIERS];
        s.filters = { ...emptyFilters(), tiers: tiers.includes(x.tier) ? tiers : [...tiers, x.tier] };
      } else {
        s.selection = { lens: 'collections', tier: x.tier };
        s.filters = { ...emptyFilters() };
      }
      q.value = '';
      s.collapsed.clear();
      render({ sync: true });
    } else if (!findRow(path)) {
      s.collapsed.delete(view.visible.find((t) => t.path === path)?.group ?? '');
      render({ keepScroll: true, sync: true });
    }
    const row = findRow(path);
    if (row) {
      s.active = { row: path, col: 0 };
      focusCell(row, 0);
      reveal(row, 'center');
    }
    openDetail(path);
  }

  function openEditorFor(row: HTMLElement, cell: HTMLElement) {
    if (s.mode !== 'edit' || !editorReady() || !row.dataset.path || !cell.classList.contains('is-mode')) return false;
    const col = view.columns[Number(cell.dataset.col) - 1];
    if (!col) return false;
    if (!detail.hidden) closeDetail(false);
    openInlineEditor({ container: main, cell, d, path: row.dataset.path, col, columns: view.columns });
    return true;
  }

  /** What C copies: the value of a value cell (hex for colors), the CSS variable of a name cell. */
  function copyFrom(row: HTMLElement, cell: HTMLElement, button?: HTMLElement | null) {
    const path = row.dataset.path;
    if (!path) return;
    const col = cell.classList.contains('is-mode') ? view.columns[Number(cell.dataset.col) - 1] : undefined;
    const t = d.set.byPath.get(path);
    if (col) {
      const v = cellValue(d.set, path, col.ctx);
      void copyText(t?.type === 'color' ? (v.hex ?? v.css) : v.css, button);
    } else if (t) void copyText(codeSyntax(path, t.tier, 'css'), button);
  }

  // ---- row menu (Studio): copy, details and edit, one menu at a time
  let rowMenu: HTMLElement | null = null;
  function closeRowMenu(focusBack = true) {
    if (!rowMenu) return;
    const anchor = rowMenu.dataset.anchor ? grid.querySelector<HTMLElement>(`.xp-tr[data-path="${CSS.escape(rowMenu.dataset.anchor)}"] [data-xp-rowmenu]`) : null;
    rowMenu.remove();
    rowMenu = null;
    anchor?.setAttribute('aria-expanded', 'false');
    if (focusBack) anchor?.focus();
  }
  function openRowMenu(btn: HTMLElement) {
    closeRowMenu(false);
    const row = btn.closest<HTMLElement>('.xp-tr');
    const path = row?.dataset.path;
    const t = path ? d.set.byPath.get(path) : undefined;
    if (!row || !path || !t) return;
    const menu = document.createElement('div');
    menu.className = 'xp-rowmenu-pop';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Actions for ${path}`);
    menu.dataset.anchor = path;
    const items = [
      `<button type="button" role="menuitem" data-act="edit">${icon('pencil', 16)}Edit value</button>`,
      `<button type="button" role="menuitem" data-act="details">${icon('info', 16)}Details</button>`,
      `<button type="button" role="menuitem" data-act="copy-var">${icon('copy', 16)}Copy CSS variable</button>`,
      ...view.columns.map((c, i) => `<button type="button" role="menuitem" data-act="copy-col" data-i="${i}">${icon('copy', 16)}Copy ${esc(c.label.toLowerCase())} value</button>`),
    ];
    menu.innerHTML = items.join('');
    main.append(menu);
    const m = main.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom - m.top + 4}px`;
    menu.style.left = `${Math.max(8, r.right - m.left - menu.offsetWidth)}px`;
    btn.setAttribute('aria-expanded', 'true');
    rowMenu = menu;
    const buttons = [...menu.querySelectorAll<HTMLElement>('button')];
    buttons[0]?.focus();
    menu.addEventListener('keydown', (e) => {
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus();
      else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
      else if (e.key === 'Escape' || e.key === 'Tab') closeRowMenu();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      closeRowMenu(act !== 'edit' && act !== 'details');
      const cells = cellsOf(row);
      if (act === 'edit') {
        const cell = row.querySelector<HTMLElement>('.xp-td.is-mode');
        if (cell) {
          focusCell(row, Number(cell.dataset.col));
          openEditorFor(row, cell);
        }
      } else if (act === 'details') openDetail(path, { focusTitle: true });
      else if (act === 'copy-var') copyFrom(row, cells[0]!);
      else if (act === 'copy-col') {
        const cell = row.querySelectorAll<HTMLElement>('.xp-td.is-mode')[Number(b.dataset.i)];
        if (cell) copyFrom(row, cell);
      }
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (rowMenu && !rowMenu.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-xp-rowmenu]')) closeRowMenu(false);
  });

  // ---- events: left pane
  const segValue = (e: Event) => (e as CustomEvent<{ value: string }>).detail.value;
  lens?.addEventListener('bridge:segment', (e) => {
    s.selection = segValue(e) === 'types' ? { lens: 'types', category: 'color' } : { lens: 'collections', tier: 'semantic' };
    s.collapsed.clear();
    render();
  });
  tree?.addEventListener('click', (e) => {
    const twist = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-twist]');
    if (twist) {
      const k = twist.dataset.twist!;
      if (s.treeOpen.has(k)) s.treeOpen.delete(k);
      else s.treeOpen.add(k);
      renderTree();
      tree?.querySelector<HTMLElement>(`[data-twist="${CSS.escape(k)}"]`)?.focus();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.xp-tree-btn');
    if (!b) return;
    if (b.dataset.category) s.selection = { lens: 'types', category: b.dataset.category as TypeCategory | 'all' };
    else s.selection = { lens: 'collections', tier: b.dataset.tier as Tier | 'all', group: b.dataset.group || undefined };
    if (b.dataset.group && b.dataset.tier) s.treeOpen.add(`${b.dataset.tier}:${b.dataset.group.split('.')[0]}`);
    s.collapsed.clear();
    render();
    const sel = tree?.querySelector<HTMLElement>('[aria-current="true"]');
    sel?.focus();
  });

  // ---- events: toolbar
  let qTimer = 0;
  q.addEventListener('input', () => {
    window.clearTimeout(qTimer);
    qTimer = window.setTimeout(() => {
      s.filters.query = q.value;
      render();
    }, 90);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const row = grid.querySelector<HTMLElement>('.xp-tr[data-path]');
      if (row) focusCell(row, 0);
    } else if (e.key === 'Escape' && q.value) {
      e.stopPropagation();
      q.value = '';
      s.filters.query = '';
      render();
    }
  });
  exact.addEventListener('click', () => {
    s.filters.exact = !s.filters.exact;
    render();
  });
  chips?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-xp-chip-clear]')) {
      clearComponent();
      render();
      chips.querySelector<HTMLElement>('[data-xp-chip]')?.focus();
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-xp-chip]');
    if (!b) return;
    const c = b.dataset.xpChip!;
    s.filters.categories = c === 'all' ? [] : [c as TypeCategory];
    render();
    chips.querySelector<HTMLElement>(`[data-xp-chip="${CSS.escape(c)}"]`)?.focus();
  });
  filtersEl.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (!['xp-ft', 'xp-fc', 'xp-usage'].includes(el.name)) return;
    if (el.name === 'xp-ft' && app) {
      // Studio: the collections are the table's scope; a group focus gives way to them.
      const all = s.filters.tiers.length ? s.filters.tiers : TIER_ORDER.filter((t) => s.selection.lens !== 'collections' || s.selection.tier === 'all' || t === s.selection.tier);
      s.filters.tiers = el.checked ? [...new Set([...all, el.value as Tier])] : all.filter((x) => x !== el.value);
      if (!s.filters.tiers.length) s.filters.tiers = [el.value as Tier];
      s.selection = { lens: 'collections', tier: 'all' };
    } else if (el.name === 'xp-ft') s.filters.tiers = el.checked ? [...s.filters.tiers, el.value as Tier] : s.filters.tiers.filter((x) => x !== el.value);
    if (el.name === 'xp-fc') s.filters.categories = el.checked ? [...s.filters.categories, el.value as TypeCategory] : s.filters.categories.filter((x) => x !== el.value);
    if (el.name === 'xp-usage') s.filters.usage = el.value as '' | 'used' | 'unused';
    render();
  });
  filtersEl.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-xp-clear-filters]')) return;
    s.filters = app ? { ...emptyFilters(), query: s.filters.query, tiers: comp ? [...TIER_ORDER] : [...APP_TIERS], categories: s.filters.categories } : { ...emptyFilters(), query: s.filters.query, exact: s.filters.exact };
    if (app) s.selection = { lens: 'collections', tier: 'all' };
    render();
  });
  filtersEl.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && filtersEl.open) {
      e.stopPropagation();
      filtersEl.open = false;
      filtersEl.querySelector('summary')?.focus();
    }
  });
  root.querySelector('[data-xp-clear]')?.addEventListener('click', () => {
    comp = null;
    s.filters = app ? { ...emptyFilters(), tiers: [...APP_TIERS] } : emptyFilters();
    if (app) s.selection = { lens: 'collections', tier: 'all' };
    q.value = '';
    render();
    q.focus();
  });
  // Re-render the grid (and the open detail) after a view change; focus stays on the control that changed it.
  const changeView = (apply: () => void) => {
    const from = document.activeElement as HTMLElement | null;
    apply();
    render({ keepScroll: true });
    if (s.selected) openDetail(s.selected);
    from?.focus();
  };
  brandSeg?.addEventListener('bridge:segment', (e) => changeView(() => (s.view.brand = segValue(e))));
  densitySeg?.addEventListener('bridge:segment', (e) => changeView(() => (s.view.density = segValue(e))));
  combosBtn?.addEventListener('click', () => changeView(() => (s.view.allCombos = !s.view.allCombos)));
  onSelectPick(SYNTAX_SELECT, (v) => {
    s.showCode = v !== '';
    if (s.showCode) s.syntax = v as Syntax;
    render({ keepScroll: true });
  });
  descBtn.addEventListener('click', () => {
    s.showDescription = !s.showDescription;
    render({ keepScroll: true });
  });

  // Row density (Studio): compact by default, remembered in this browser. The Library keeps its own comfortable rows.
  const ROWS_KEY = 'bridge.xp.rows';
  if (rowsSeg) {
    try {
      const saved = localStorage.getItem(ROWS_KEY);
      if (saved === 'compact' || saved === 'comfortable') root.dataset.rows = saved;
    } catch {
      /* private mode: default rows */
    }
    selectSegment(rowsSeg, root.dataset.rows ?? 'compact');
    rowsSeg.addEventListener('bridge:segment', (e) => {
      const rows = segValue(e);
      if (rows === root.dataset.rows) return;
      changeView(() => {
        root.dataset.rows = rows;
        try {
          localStorage.setItem(ROWS_KEY, rows);
        } catch {
          /* ignore */
        }
      });
    });
  }

  // Toolbar menus (Filters, Modes, View): one open at a time, closed by a click outside or Esc.
  for (const m of menus) {
    m.addEventListener('toggle', () => {
      if (m.open) for (const o of menus) if (o !== m) o.open = false;
    });
    if (m.hasAttribute('data-xp-filters')) continue;
    m.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && m.open) {
        e.stopPropagation();
        m.open = false;
        m.querySelector('summary')?.focus();
      }
    });
  }
  document.addEventListener('click', (e) => {
    for (const m of menus) if (m.open && !m.contains(e.target as Node)) m.open = false;
  });

  // ---- events: grid
  grid.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy) {
      void copyText(copy.dataset.copy!, copy);
      return;
    }
    const menuBtn = target.closest<HTMLElement>('[data-xp-rowmenu]');
    if (menuBtn) {
      if (rowMenu?.dataset.anchor === menuBtn.closest<HTMLElement>('.xp-tr')?.dataset.path) closeRowMenu();
      else openRowMenu(menuBtn);
      return;
    }
    const chip = target.closest<HTMLElement>('[data-goto]');
    if (chip) {
      goto(chip.dataset.goto!);
      return;
    }
    const row = target.closest<HTMLElement>('.xp-tr');
    if (!row) return;
    if (row.classList.contains('is-section')) {
      toggleSection(row);
      return;
    }
    const cell = target.closest<HTMLElement>('[data-col]');
    if (cell) focusCell(row, Number(cell.dataset.col));
    const editing = s.mode === 'edit' && cell?.classList.contains('is-mode');
    // Studio: a value opens its editor (one surface), the name opens the read-only details. Library: both open details.
    if (cell && editing) openEditorFor(row, cell);
    else if (row.dataset.path) openDetail(row.dataset.path);
  });

  function toggleSection(row: HTMLElement) {
    const key = row.dataset.section!;
    if (s.collapsed.has(key)) s.collapsed.delete(key);
    else s.collapsed.add(key);
    s.active = { row: `sec:${key}`, col: s.active?.col ?? 0 };
    render({ keepScroll: true, sync: true });
    const again = findRow(`sec:${key}`);
    if (again) focusCell(again, 0);
  }

  grid.addEventListener('keydown', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-col]');
    const row = cell?.closest<HTMLElement>('.xp-tr');
    if (!cell || !row) return;
    const all = rows();
    const i = all.indexOf(row);
    const col = Number(cell.dataset.col);
    const move = (r: HTMLElement | undefined, c = s.active?.col ?? col) => {
      if (!r) return;
      e.preventDefault();
      focusCell(r, c);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(all[i + 1]);
      case 'ArrowUp':
        if (i === 0) {
          e.preventDefault();
          q.focus();
          return;
        }
        return move(all[i - 1]);
      case 'ArrowRight':
        if (row.classList.contains('is-section')) {
          if (s.collapsed.has(row.dataset.section!)) toggleSection(row);
          e.preventDefault();
          return;
        }
        return move(row, col + 1);
      case 'ArrowLeft':
        if (row.classList.contains('is-section')) {
          if (!s.collapsed.has(row.dataset.section!)) toggleSection(row);
          e.preventDefault();
          return;
        }
        return move(row, col - 1);
      case 'Home':
        return e.ctrlKey || e.metaKey ? move(all[0], 0) : move(row, 0);
      case 'End':
        return e.ctrlKey || e.metaKey ? move(all[all.length - 1]) : move(row, cellsOf(row).length - 1);
      case 'PageDown':
        return move(all[Math.min(all.length - 1, i + 10)]);
      case 'PageUp':
        return move(all[Math.max(0, i - 10)]);
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (row.classList.contains('is-section')) return toggleSection(row);
        if (openEditorFor(row, cell)) return;
        if (row.dataset.path) openDetail(row.dataset.path, { focusTitle: e.key === 'Enter' });
        return;
      case 'c':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (s.mode === 'edit') copyFrom(row, cell);
        else cell.querySelector<HTMLElement>('[data-copy]')?.click();
        return;
      case 'Escape':
        if (!detail.hidden) {
          e.preventDefault();
          closeDetail();
        }
        return;
    }
  });

  // ---- events: detail panel
  detail.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy) return void copyText(copy.dataset.copy!, copy);
    const go = target.closest<HTMLElement>('[data-goto]');
    if (go) return goto(go.dataset.goto!);
    if (target.closest('[data-xp-close]')) return closeDetail();
    if (target.closest('[data-xp-edit-cell]') && s.selected) {
      // One editor in the product: Edit closes the details and opens the cell popover on the row.
      const row = findRow(s.selected);
      const cell = row?.querySelector<HTMLElement>('.xp-td.is-mode');
      if (row && cell) {
        closeDetail(false);
        focusCell(row, Number(cell.dataset.col));
        openEditorFor(row, cell);
      }
    }
  });
  detail.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDetail();
    }
  });
  scrim.addEventListener('click', () => closeDetail());

  // ---- global keys: "/" stays the site-wide search palette everywhere. "F" focuses this explorer's search (from the
  // table, the tree or the page); Esc closes the inline editor, then the panel.
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    if (el.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]') || inlineEditorOpen()) return;
    e.preventDefault();
    q.focus();
    q.select();
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    const typing = el.closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape' && !typing) {
      if (rowMenu) closeRowMenu();
      else if (inlineEditorOpen()) closeInlineEditor();
      else if (!detail.hidden && (root.contains(el) || el === document.body)) closeDetail();
    }
  });
  narrow.addEventListener('change', () => {
    if (!detail.hidden && s.selected) openDetail(s.selected);
  });

  // ---- edit mode: draft changes repaint the cells, the page toggle switches modes
  let draftTimer = 0;
  function useSnapshot() {
    const snap = editorSnapshot();
    if (!snap) return false;
    const pathsBefore = d.set.byPath.size;
    d.set = s.mode === 'edit' ? snap.proposed : d.head;
    d.results = s.mode === 'edit' && snap.contrastAfter.length ? snap.contrastAfter : results;
    d.before = s.mode === 'edit' ? snap.contrastBefore : [];
    const changedPaths = d.set.byPath.size !== pathsBefore || [...d.set.byPath.keys()].some((p) => !d.byPath.has(p));
    if (changedPaths) {
      d.tokens = buildTokens(d.set, d.usage);
      d.byPath = new Map(d.tokens.map((t) => [t.path, t]));
    }
    return changedPaths;
  }
  let started = false;
  function setMode(mode: ExplorerMode) {
    if (mode === 'edit' && (!editorReady() || viewing)) return;
    s.mode = mode;
    root.dataset.mode = mode;
    useSnapshot();
    if (!started) return;
    render({ keepScroll: true });
    if (s.selected) openDetail(s.selected);
  }
  document.addEventListener('bridge:editing', (e) => setMode((e as CustomEvent<boolean>).detail ? 'edit' : 'read'));
  document.addEventListener('bridge:draft', () => {
    if (s.mode !== 'edit') return;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      const structural = useSnapshot();
      if (structural) render({ keepScroll: true });
      else grid.querySelectorAll<HTMLElement>('.xp-tr[data-path]').forEach((r) => refreshRow(grid, d, view, s, r.dataset.path!));
      if (s.selected && !detail.hidden) {
        const sc = detail.querySelector<HTMLElement>('[data-xp-detail-body]')?.scrollTop ?? 0;
        renderDetail(detail, d, view, s, s.selected);
        const body = detail.querySelector<HTMLElement>('[data-xp-detail-body]');
        if (body) body.scrollTop = sc;
      }
    }, 30);
  });

  /** Reads the change in the address and shows its token set, the tokens it changes marked (Changed in this change). */
  async function showChange() {
    if (!currentPull()) return;
    try {
      const config = loadConfig(document.getElementById('xp-config')?.textContent || '{}');
      const main = readJson<Record<string, string>>('xp-files', {});
      // One change, or several shown together (the latest library plus their edits, each mark saying which one).
      const lib = await scopeLibrary(main, config.tokens.root);
      const head = buildTokenSet(lib.files, layoutOptions(config));
      const marks = changedTokens(d.head, head);
      if (lib.from) for (const [path, m] of marks.marks) m.from = lib.from[path];
      d.set = head;
      d.head = head;
      d.tokens = buildTokens(head, d.usage);
      d.byPath = new Map(d.tokens.map((t) => [t.path, t]));
      d.results = results = evaluatePairs(head.byPath, d.pairs, contrastScope(head));
      d.marks = marks.marks;
      d.formatBefore = (type, v) => formatValue(type, v);
      const values = [...marks.marks.values()];
      setBannerBody(bannerBody('tokens', { changed: values.filter((m) => m.kind === 'changed').length, added: values.filter((m) => m.kind === 'added').length, removed: marks.removed.length, together: Boolean(lib.from), picked: lib.picked }));
      root.dataset.view = 'ready';
      render({ keepScroll: true, sync: Boolean(s.selected) });
      if (s.selected && !detail.hidden) openDetail(s.selected);
    } catch (err) {
      root.dataset.view = 'error';
      setBannerError(readFailure(err, isTogether(pageScope()) ? 'These branches' : 'This branch'));
    }
  }

  // ---- start
  if (!historyPanelReady) {
    historyPanelReady = true;
    initTokenHistoryPanel();
  }
  // The editing kit (TokenEditorKit.astro) is on the page in mode="edit", or on a page that toggles edit mode.
  const wantsEdit = s.mode === 'edit' && !viewing;
  s.mode = 'read';
  root.dataset.mode = 'read';
  if (document.querySelector('[data-xp-kit]') || document.getElementById('ed-tray')) initTokenEditor();
  if (wantsEdit && editorReady()) {
    setEditing(true);
    initReview(d);
  }
  started = true;
  if (viewing) {
    root.dataset.view = 'loading';
    void showChange();
  }
  render({ sync: Boolean(s.selected) });
  if (s.selected) {
    const row = findRow(s.selected);
    if (row) {
      reveal(row, 'center');
      // The draft tray settles after the first frame; center again so it does not cover the row.
      requestAnimationFrame(() => requestAnimationFrame(() => reveal(row, 'center')));
    }
    openDetail(s.selected);
  }
  root.dataset.buildMs = buildMs.toFixed(1);
  (window as unknown as { __xp?: unknown }).__xp = {
    perf: () => ({ buildMs, ...lastRender, tokens: d.tokens.length }),
    renderAll: async () => {
      const prev = { selection: s.selection, filters: s.filters };
      s.selection = { lens: 'collections', tier: 'all' };
      s.filters = emptyFilters();
      const t = performance.now();
      view = computeView();
      const r = renderGrid(grid, d, view, s, { sync: true });
      const ms = performance.now() - t;
      s.selection = prev.selection;
      s.filters = prev.filters;
      return { syncAllMs: ms, firstChunkMs: r.firstMs, rows: view.visible.length };
    },
  };
}
