// Token explorer model, as pure functions over a @bridge-ds/core TokenSet: one record per token, the two lenses
// (Collections, mirroring the Figma plugin collections, and By type), the mode columns a selection shows, cell
// values per column, search and filters. The DOM side lives in src/scripts/explorer/. Tested in model.test.ts.
import { TIER_AXIS, TIER_NAMES, TIER_ORDER, resolve, valueIn, type LogicalToken, type Tier, type TokenSet } from '@bridge-ds/core';
import { CATEGORY_LABEL, CATEGORY_ORDER, aliasOf, colorHex, cssText, cssVarName, modeName, typeCategory, valueLine, type TypeCategory } from './format';

export type Axis = 'brand' | 'theme' | 'density';
export const AXES: Axis[] = ['brand', 'theme', 'density'];

export interface ComponentLink {
  name: string;
  href: string;
}
/** Build-time usage per token path: does a component read it (directly or through an alias), and which ones. */
export type UsageMap = Record<string, { used: boolean; usedBy: ComponentLink[] }>;

export interface Modes {
  brands: string[];
  themes: string[];
  densities: string[];
}

export interface Ctx {
  brand?: string | undefined;
  theme?: string | undefined;
  density?: string | undefined;
}

export interface XToken {
  path: string;
  tier: Tier;
  type: string;
  category: TypeCategory;
  /** Figma collection name (TIER_NAMES), e.g. "Semantic". */
  collection: string;
  /** Group path: every segment but the last ("color.text" for color.text.muted). */
  group: string;
  name: string;
  description?: string | undefined;
  cssVar: string;
  used: boolean;
  usedBy: ComponentLink[];
  /** Axes along which the resolved value changes (from the default context). */
  varies: Axis[];
  /** Lowercase haystack for search: path, CSS variable, Figma name, resolved hexes. */
  search: string;
}

export function modesOf(set: Pick<TokenSet, 'layout'>): Modes {
  return {
    brands: set.layout.brands.map((b) => b.mode),
    themes: set.layout.themes.map((t) => t.mode),
    densities: set.layout.densities.map((d) => d.mode),
  };
}

export function defaultCtx(m: Modes): Required<Ctx> {
  return { brand: m.brands[0] ?? '', theme: m.themes[0] ?? '', density: m.densities[0] ?? '' };
}

const axisValues = (m: Modes, a: Axis) => (a === 'brand' ? m.brands : a === 'theme' ? m.themes : m.densities);

const fullCtx = (set: TokenSet, ctx: Ctx) => ({ ...ctx, overrides: set.overrideIndex });

/** Value of a token in one context: the raw value (alias or literal) and the resolved end of the chain. */
export interface CellValue {
  raw: unknown;
  /** Alias target of the raw value, when it is an alias. */
  alias?: string | undefined;
  /** The raw value came from a brand x theme override file. */
  override: boolean;
  resolved: unknown;
  css: string;
  hex?: string | undefined;
  /** Short secondary line (hex, value, "2 layers"). */
  line: string;
  chain: string[];
  error?: string | undefined;
}

export function cellValue(set: TokenSet, path: string, ctx: Ctx): CellValue {
  const t = set.byPath.get(path);
  const c = fullCtx(set, ctx);
  const own = t ? valueIn(t, c) : { value: undefined, via: 'token' as const };
  const r = resolve(set.byPath, path, c);
  const type = t?.type ?? '';
  return {
    raw: own.value,
    alias: aliasOf(own.value),
    override: own.via === 'override',
    resolved: r.value,
    css: r.value === undefined ? '' : cssText(type, r.value),
    hex: type === 'color' ? colorHex(r.value) : undefined,
    line: r.value === undefined ? (r.error ? `Unresolved: ${r.error === 'broken' ? `${r.at} is missing` : r.error}` : '') : valueLine(type, r.value),
    chain: r.chain,
    error: r.error,
  };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Axes along which a token's resolved value changes, compared with the default context. */
export function varyingAxes(set: TokenSet, path: string, modes: Modes): Axis[] {
  const base = defaultCtx(modes);
  const ref = resolve(set.byPath, path, fullCtx(set, base)).value;
  return AXES.filter((a) => {
    const values = axisValues(modes, a);
    // Brand x theme overrides only show when both change: check every theme for the brand axis.
    const themes = a === 'brand' ? modes.themes : [base.theme];
    return values.some((v) =>
      themes.some((th) => {
        const here = resolve(set.byPath, path, fullCtx(set, { ...base, theme: th, [a]: v })).value;
        const there = resolve(set.byPath, path, fullCtx(set, { ...base, theme: th })).value;
        return a === 'brand' ? !sameValue(here, there) : !sameValue(here, ref);
      }),
    );
  });
}

export function buildTokens(set: TokenSet, usage: UsageMap = {}): XToken[] {
  const modes = modesOf(set);
  const ctxs = [defaultCtx(modes), { ...defaultCtx(modes), theme: modes.themes[1] }];
  const tierRank = (t: Tier) => TIER_ORDER.indexOf(t);
  return [...set.byPath.values()]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => tierRank(a.t.tier) - tierRank(b.t.tier) || a.i - b.i)
    .map(({ t }) => {
      const segs = t.path.split('.');
      const u = usage[t.path];
      const hexes = t.type === 'color' ? ctxs.map((c) => cellValue(set, t.path, c).hex ?? '') : [];
      return {
        path: t.path,
        tier: t.tier,
        type: t.type,
        category: typeCategory(t),
        collection: TIER_NAMES[t.tier],
        group: segs.slice(0, -1).join('.'),
        name: segs[segs.length - 1] ?? t.path,
        description: t.description,
        cssVar: cssVarName(t.path),
        used: u ? u.used : false,
        usedBy: u?.usedBy ?? [],
        varies: varyingAxes(set, t.path, modes),
        search: [t.path, cssVarName(t.path), segs.join('/'), ...hexes].join(' ').toLowerCase(),
      };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Lenses

export type Lens = 'collections' | 'types';

/** What the center table shows: a collection (optionally one group in it), a type category, or everything. */
export type Selection =
  | { lens: 'collections'; tier: Tier | 'all'; group?: string | undefined }
  | { lens: 'types'; category: TypeCategory | 'all' };

export interface TreeNode {
  key: string;
  label: string;
  count: number;
  children: TreeNode[];
}

export interface CollectionNode {
  tier: Tier;
  label: string;
  count: number;
  groups: TreeNode[];
}

/** Collections in Figma plugin order, each with its group tree (two levels) and counts. */
export function collectionTree(tokens: XToken[]): CollectionNode[] {
  return TIER_ORDER.map((tier) => {
    const list = tokens.filter((t) => t.tier === tier);
    const top = new Map<string, Map<string, number>>();
    for (const t of list) {
      const segs = t.group ? t.group.split('.') : [];
      const k1 = segs[0] ?? t.name;
      const level = top.get(k1) ?? top.set(k1, new Map()).get(k1)!;
      if (segs.length >= 2) {
        const k2 = segs.slice(0, 2).join('.');
        level.set(k2, (level.get(k2) ?? 0) + 1);
      } else level.set('', (level.get('') ?? 0) + 1);
    }
    const groups: TreeNode[] = [...top.entries()].map(([k1, level]) => {
      const children = [...level.entries()].filter(([k]) => k).map(([k, n]) => ({ key: k, label: k.split('.').slice(1).join('.'), count: n, children: [] }));
      const count = [...level.values()].reduce((s, n) => s + n, 0);
      return { key: k1, label: k1, count, children: children.length > 1 ? children : [] };
    });
    return { tier, label: TIER_NAMES[tier], count: list.length, groups };
  }).filter((c) => c.count > 0);
}

export interface CategoryNode {
  category: TypeCategory;
  label: string;
  count: number;
}

export function categoryList(tokens: XToken[]): CategoryNode[] {
  return CATEGORY_ORDER.map((category) => ({ category, label: CATEGORY_LABEL[category], count: tokens.filter((t) => t.category === category).length })).filter(
    (c) => c.count > 0,
  );
}

export function inSelection(t: XToken, s: Selection): boolean {
  if (s.lens === 'types') return s.category === 'all' || t.category === s.category;
  if (s.tier !== 'all' && t.tier !== s.tier) return false;
  if (!s.group) return true;
  return t.path === s.group || t.path.startsWith(`${s.group}.`);
}

export interface Section {
  key: string;
  label: string;
  tokens: XToken[];
}

/**
 * Section rows of the table. One collection: its groups (Figma groups, "color / text"). Everything else: one section
 * per collection, so tokens from different tiers never mix inside a group.
 */
export function sectionsFor(tokens: XToken[], s: Selection): Section[] {
  const byCollection = s.lens === 'types' || s.tier === 'all';
  const out = new Map<string, Section>();
  for (const t of tokens) {
    const key = byCollection ? t.tier : t.group || t.name;
    const label = byCollection ? t.collection : (t.group || t.name).split('.').join(' / ');
    const sec = out.get(key) ?? out.set(key, { key, label, tokens: [] }).get(key)!;
    sec.tokens.push(t);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Mode columns

export interface Column {
  key: string;
  label: string;
  ctx: Required<Ctx>;
  /** The axis this column varies (undefined for a single Value column). */
  axis?: Axis | undefined;
}

export interface ColumnPlan {
  columns: Column[];
  /** Axes the toolbar offers a selector for (fixed for every column). */
  selectors: Axis[];
  /** The "All brand and theme combinations" toggle applies. */
  combos: boolean;
}

export interface ViewState {
  brand: string;
  theme: string;
  density: string;
  /** Show every brand x theme combination side by side. */
  allCombos: boolean;
}

/** The axis a tier's own modes vary along (Brand: brand, Semantic: theme, Density: density). */
export const tierAxis = (tier: Tier): Axis | undefined => TIER_AXIS[tier];

/** Mode key a cell edits: the column's value on the token's own axis, or the single "value" mode. */
export function modeKeyFor(tier: Tier, col: Column): string {
  const axis = tierAxis(tier);
  return axis ? col.ctx[axis] : 'value';
}

/**
 * Columns for a selection: one per mode of the selected collection (Primitives: Value, Brand: one per brand,
 * Semantic: Light and Dark, Density: one per density). Single-mode collections, type lenses and "all" use the axes
 * their tokens actually vary along, so a Component color shows Light and Dark while a z-index shows one Value.
 */
export function planColumns(s: Selection, modes: Modes, view: ViewState, varying: Axis[]): ColumnPlan {
  const ctx = { brand: view.brand, theme: view.theme, density: view.density };
  const along = (axis: Axis, base = ctx): Column[] =>
    axisValues(modes, axis).map((v) => ({ key: `${axis}:${v}`, label: modeName(v), ctx: { ...base, [axis]: v }, axis }));
  const value: Column = { key: 'value', label: 'Value', ctx };
  const tier = s.lens === 'collections' && s.tier !== 'all' ? s.tier : undefined;

  if (tier === 'primitive') return { columns: [value], selectors: [], combos: false };
  if (tier === 'brand') return { columns: along('brand'), selectors: [], combos: false };
  if (tier === 'density') return { columns: along('density'), selectors: [], combos: false };

  const themed = tier === 'semantic' || varying.includes('theme');
  if (themed) {
    const brandMatters = tier === 'semantic' || varying.includes('brand');
    const rest = varying.filter((a) => a === 'density');
    if (brandMatters && view.allCombos && modes.brands.length > 1) {
      const columns = modes.brands.flatMap((b) =>
        modes.themes.map((th) => ({ key: `combo:${b}:${th}`, label: `${modeName(b)} · ${modeName(th)}`, ctx: { ...ctx, brand: b, theme: th }, axis: 'theme' as Axis })),
      );
      return { columns, selectors: rest, combos: true };
    }
    return { columns: along('theme'), selectors: [...(brandMatters && modes.brands.length > 1 ? (['brand'] as Axis[]) : []), ...rest], combos: brandMatters && modes.brands.length > 1 };
  }
  if (varying.includes('density')) return { columns: along('density'), selectors: varying.filter((a) => a === 'brand'), combos: false };
  if (varying.includes('brand')) return { columns: along('brand'), selectors: [], combos: false };
  return { columns: [value], selectors: [], combos: false };
}

/** Union of the axes the tokens vary along. */
export function varyingOf(tokens: XToken[]): Axis[] {
  return AXES.filter((a) => tokens.some((t) => t.varies.includes(a)));
}

// ---------------------------------------------------------------------------------------------------------------
// Search and filters

export interface Filters {
  query: string;
  exact: boolean;
  tiers: Tier[];
  categories: TypeCategory[];
  usage: '' | 'used' | 'unused';
}

export const emptyFilters = (): Filters => ({ query: '', exact: false, tiers: [], categories: [], usage: '' });

/** Number of active filters (search excluded), for the badge on the Filters button. */
export function activeFilterCount(f: Filters): number {
  return f.tiers.length + f.categories.length + (f.usage ? 1 : 0);
}

const normalizeQuery = (q: string) =>
  q
    .trim()
    .toLowerCase()
    .replace(/^var\((.*)\)$/, '$1')
    .replace(/^\{(.*)\}$/, '$1');

/**
 * Search: every word must appear in the token's haystack. Exact: the query is the token path, its CSS variable,
 * its Figma name, var(--x), {path} or one of its resolved hexes.
 */
export function matchesQuery(t: XToken, query: string, exact: boolean): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  if (exact) return t.search.split(' ').includes(q);
  return q.split(/\s+/).every((w) => t.search.includes(w));
}

export function matchesFilters(t: XToken, f: Filters): boolean {
  if (f.tiers.length && !f.tiers.includes(t.tier)) return false;
  if (f.categories.length && !f.categories.includes(t.category)) return false;
  if (f.usage === 'used' && !t.used) return false;
  if (f.usage === 'unused' && t.used) return false;
  return matchesQuery(t, f.query, f.exact);
}

export function applyFilters(tokens: XToken[], f: Filters): XToken[] {
  return tokens.filter((t) => matchesFilters(t, f));
}
