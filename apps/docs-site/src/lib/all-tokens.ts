// All tokens: the Library's read-only reference of every semantic token in the latest release, bridge brand, light
// and dark. Pure: the page passes the loaded tokens in, the browser script reuses the filter. No collections, modes or
// drafts here; Studio Tokens is where tokens change.
// No imports: the browser script reuses the filter, so nothing here may pull the token tooling into the bundle.

export type AllType = 'color' | 'dimension' | 'typography' | 'shadow' | 'motion' | 'number';

/** Type of a token for the chips: DTCG $type, with durations and easings under motion (as the Studio "By type" lens). */
export function typeOf(t: { path: string; type: string }): AllType {
  if (t.type === 'color') return 'color';
  if (t.type === 'shadow') return 'shadow';
  if (t.type === 'duration' || t.type === 'cubicBezier') return 'motion';
  if (t.type === 'fontFamily' || t.type === 'fontWeight' || /(^|\.)font(\.|$)/.test(t.path)) return 'typography';
  if (t.type === 'dimension') return 'dimension';
  return 'number';
}

/** Chip order and labels. Motion covers durations and easings. */
export const ALL_TYPE_ORDER: AllType[] = ['color', 'dimension', 'typography', 'motion', 'number', 'shadow'];
export const ALL_TYPE_LABEL: Record<AllType, string> = {
  color: 'Color',
  dimension: 'Dimension',
  typography: 'Typography',
  motion: 'Motion',
  number: 'Number',
  shadow: 'Shadow',
};

/** The slice of a loaded semantic token this page needs (lib/tokens.ts Semantic). */
export interface SemanticInput {
  path: string;
  cssVar: string;
  type: string;
  tier: string;
  description?: string;
  deprecated?: boolean | string;
  modes: Record<'light' | 'dark', { chain: string[]; css: string; hex?: string }>;
}

export interface AllModeValue {
  /** Full CSS value, as tokens.css writes it. */
  css: string;
  /** What the value column shows: the hex, the CSS value, or the source primitive when the value is long. */
  short: string;
  /** Where the value comes from: the palette role step for colors ("primary.200"), else the primitive. */
  source: string;
}

export interface AllTokenRow {
  path: string;
  cssVar: string;
  type: AllType;
  description: string;
  deprecated: boolean;
  light: AllModeValue;
  dark: AllModeValue;
  /** Lowercase text the filter matches: path, CSS variable, values and the whole alias chain. */
  search: string;
}

/** "palette.primary.200" reads "primary.200"; a direct primitive keeps its path; a literal has no source. */
export function sourceLabel(chain: string[]): string {
  const first = chain[0];
  if (!first) return '';
  return first.startsWith('palette.') ? first.slice('palette.'.length) : chain[chain.length - 1];
}

/** Long values (shadows, easing curves, font stacks) show their primitive in the list; the panel shows them whole. */
export function shortValue(css: string, hex: string | undefined, source: string, max = 14): string {
  if (hex) return hex;
  if (css.length <= max || !source) return css;
  return source;
}

function modeValue(m: { chain: string[]; css: string; hex?: string }): AllModeValue {
  const source = sourceLabel(m.chain);
  return { css: m.css, short: shortValue(m.css, m.hex, source), source };
}

/** Semantic tier only, in source order (the order of the token files). */
export function allTokenRows(tokens: readonly SemanticInput[]): AllTokenRow[] {
  return tokens
    .filter((t) => t.tier === 'semantic')
    .map((t) => {
      const light = modeValue(t.modes.light);
      const dark = modeValue(t.modes.dark);
      const search = [t.path, t.cssVar, light.css, dark.css, ...t.modes.light.chain, ...t.modes.dark.chain].join(' ').toLowerCase();
      return {
        path: t.path,
        cssVar: t.cssVar,
        type: typeOf(t),
        description: t.description ?? '',
        deprecated: Boolean(t.deprecated),
        light,
        dark,
        search,
      };
    });
}

export interface TypeChip {
  value: AllType | 'all';
  label: string;
  count: number;
}

/** "All" first, then every type that has at least one token, in chip order. */
export function typeChips(rows: readonly Pick<AllTokenRow, 'type'>[]): TypeChip[] {
  const counts = new Map<AllType, number>();
  for (const r of rows) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return [
    { value: 'all', label: 'All', count: rows.length },
    ...ALL_TYPE_ORDER.filter((t) => counts.get(t)).map((t) => ({ value: t, label: ALL_TYPE_LABEL[t], count: counts.get(t)! })),
  ];
}

/** Normalizes what people type or paste: trims, lowercases, accepts "var(--x)", "--x", dots or dashes. */
export function normalizeQuery(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/^var\(\s*/, '')
    .replace(/\s*\)$/, '');
}

/** Every word of the query must appear; "color.bg.zone" also finds "--color-bg-zone". */
export function matchesRow(row: Pick<AllTokenRow, 'type' | 'search'>, query: string, type: AllType | 'all' = 'all'): boolean {
  if (type !== 'all' && row.type !== type) return false;
  const q = normalizeQuery(query);
  if (!q) return true;
  return q.split(/\s+/).every((word) => row.search.includes(word) || row.search.includes(word.replace(/\./g, '-')));
}

/** The row a deep link (?t= or ?focus=) points to, or null when it names no semantic token. */
export function rowForLink(rows: readonly Pick<AllTokenRow, 'path' | 'cssVar'>[], link: string | null): string | null {
  if (!link) return null;
  const want = normalizeQuery(link);
  const hit = rows.find((r) => r.path === want || r.cssVar === want || r.cssVar === `--${want}`);
  return hit ? hit.path : null;
}
