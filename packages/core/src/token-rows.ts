// Token rows for documentation pages: one record per token with the full alias chain
// (component -> semantic -> brand palette role -> primitive -> resolved value), per brand x theme (and density).
// Moved from the docs site (apps/docs-site/src/lib/tokens.ts) so the build and the browser share one reader.
// Every folder comes from bridge.config.json (tokens.root and the tier folders), never from a hardcoded path.
// Resolution order mirrors packages/tokens/build.mjs. Pure: takes file bodies, reads nothing itself.

import { tokensPath, type BridgeConfig } from './config';

/** Token tiers of the rows, in resolution order: primitive <- brand <- semantic <- component. Density sits beside semantic. */
export type TokenRowTier = 'primitive' | 'brand' | 'semantic' | 'density' | 'component';

type Json = Record<string, unknown>;

export interface RawTokenEntry {
  path: string[];
  type: string;
  value: unknown;
  description?: string;
  /** DTCG $deprecated: true, or a string explaining what to use instead. */
  deprecated?: boolean | string;
  /** Repo-relative file the token is declared in. */
  file: string;
}

export interface PrimitiveRow {
  path: string;
  segments: string[];
  type: string;
  /** Resolved CSS value. */
  css: string;
  hex?: string;
  cssVar: string;
  figma: string;
  description?: string;
  deprecated?: boolean | string;
  raw: unknown;
  file: string;
}

export interface TokenRowMode {
  /** First alias target, or null when the value is literal. */
  alias: string | null;
  /** Every alias hop, from the token to the final primitive (palette roles included). */
  chain: string[];
  css: string;
  hex?: string;
}

export interface TokenRow {
  path: string;
  segments: string[];
  type: string;
  cssVar: string;
  figma: string;
  description?: string;
  /** e.g. "color.action" or "elevation". */
  group: string;
  deprecated?: boolean | string;
  tier: Exclude<TokenRowTier, 'primitive'>;
  /** Source file(s) the token is declared in, repo-relative. */
  file: string;
  /** Values per theme in the default brand and default density. */
  modes: Record<string, TokenRowMode>;
  /** Values per brand x theme (default density). */
  brands: Record<string, Record<string, TokenRowMode>>;
  /** Density tokens only: value per density. */
  densities?: Record<string, TokenRowMode>;
  /** True when the brand x theme values differ from the default brand. */
  brandSpecific: boolean;
}

/** Brand, theme and density lists the rows are computed for, with their defaults and display names. */
export interface TokenRowAxes {
  brands: string[];
  defaultBrand: string;
  /** Display name per brand: the name a brand file records ($extensions dev.bridge.brand.name), else the slug in title case. */
  brandLabels: Record<string, string>;
  themes: string[];
  densities: string[];
  defaultDensity: string;
}

/** Repo-relative token files the rows read, from the tier folders of the config. */
export interface TokenRowFiles {
  primitivesDir: string;
  semanticDir: string;
  brandsDir: string;
  densityDir: string;
  componentsDir: string;
  baseFile: string;
  semanticFile(theme: string): string;
  brandFile(brand: string): string;
  overrideFile(brand: string, theme: string): string;
  densityFile(density: string): string;
}

export interface TokenRows extends TokenRowAxes {
  primitives: PrimitiveRow[];
  /** Semantic tier: themed (one file per theme) and theme-independent (base). */
  semantic: TokenRow[];
  /** Brand tier: palette, radius and font roles per brand. */
  brand: TokenRow[];
  density: TokenRow[];
  component: TokenRow[];
  /** Every non-primitive token: brand, semantic, density, component. */
  all: TokenRow[];
  /** Repo-relative paths of every token source file, in tier order (what the "last updated" line watches). */
  sources: string[];
}

// Today's values, used when bridge.config.json names no axis (the docs site's fallbacks).
const FALLBACK_BRANDS = ['bridge', 'ocean'];
const FALLBACK_THEMES = ['light', 'dark'];
const FALLBACK_DENSITIES = ['comfortable', 'compact'];

/** Brand, theme and density lists from bridge.config.json, as the docs pages iterate them. */
export function tokenRowAxes(config: BridgeConfig, readText: (path: string) => string | undefined = () => undefined): TokenRowAxes {
  const brandAxis = config.axes.brand;
  const brands = brandAxis?.values.length ? [...brandAxis.values] : [...FALLBACK_BRANDS];
  const defaultBrand = brandAxis?.default ?? brands[0]!;
  const themes = config.modes.themes.length ? [...config.modes.themes] : [...FALLBACK_THEMES];
  const densities = config.modes.densities.length ? [...config.modes.densities] : [...FALLBACK_DENSITIES];
  const files = tokenRowFiles(config);
  const brandName = (b: string): string => {
    try {
      const text = readText(files.brandFile(b));
      const name = text ? (JSON.parse(text) as { $extensions?: Record<string, { name?: unknown }> }).$extensions?.['dev.bridge.brand']?.name : undefined;
      if (typeof name === 'string' && name) return name;
    } catch {
      /* unreadable brand file: fall back to the slug */
    }
    return b
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  };
  return {
    brands,
    defaultBrand,
    brandLabels: Object.fromEntries(brands.map((b) => [b, brandName(b)])),
    themes,
    densities,
    defaultDensity: config.modes.defaults.density ?? densities[0]!,
  };
}

/** The token files of each tier, repo-relative, from the config's tokens.root and tier folders. */
export function tokenRowFiles(config: BridgeConfig): TokenRowFiles {
  const t = config.tokens;
  const at = (rel: string) => tokensPath(config, rel);
  return {
    primitivesDir: at(t.primitives),
    semanticDir: at(t.semantic),
    brandsDir: at(t.brands),
    densityDir: at(t.density),
    componentsDir: at(t.components),
    baseFile: at(`${t.semantic}/${t.base}.tokens.json`),
    semanticFile: (theme) => at(`${t.semantic}/${theme}.tokens.json`),
    brandFile: (brand) => at(`${t.brands}/${brand}.tokens.json`),
    overrideFile: (brand, theme) => at(`${t.brands}/${brand}.${theme}.tokens.json`),
    densityFile: (density) => at(`${t.density}/${density}.tokens.json`),
  };
}

/** Flattens one DTCG document into raw tokens, inheriting $type from groups. */
export function flattenTokenFile(node: Json, file: string, path: string[] = [], inheritedType = ''): RawTokenEntry[] {
  const type = (node.$type as string) ?? inheritedType;
  if ('$value' in node) {
    return [
      {
        path,
        type,
        value: node.$value,
        description: node.$description as string | undefined,
        deprecated: node.$deprecated as boolean | string | undefined,
        file,
      },
    ];
  }
  const out: RawTokenEntry[] = [];
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || typeof child !== 'object' || child === null) continue;
    out.push(...flattenTokenFile(child as Json, file, [...path, key], type));
  }
  return out;
}

const toHex2 = (n: number) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, '0');

function colorCss(c: unknown): { css: string; hex?: string } {
  if (typeof c === 'string') return { css: c, hex: /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined };
  const v = c as { components: number[]; alpha?: number; hex?: string };
  const [r = 0, g = 0, b = 0] = v.components;
  const hex = (v.hex ?? `#${[r, g, b].map(toHex2).join('')}`).toLowerCase();
  const alpha = v.alpha ?? 1;
  if (alpha < 1) return { css: `rgb(${[r, g, b].map((x) => Math.round(x * 255)).join(' ')} / ${alpha})`, hex };
  return { css: hex, hex };
}

const dimCss = (d: unknown) => (typeof d === 'object' && d !== null ? `${(d as { value: number }).value}${(d as { unit: string }).unit}` : String(d));

function shadowCss(s: unknown): string {
  if (typeof s === 'string') return s;
  const layers = (Array.isArray(s) ? s : [s]) as Array<Record<string, unknown>>;
  return layers
    .map((l) => [l.inset ? 'inset' : '', dimCss(l.offsetX), dimCss(l.offsetY), dimCss(l.blur), dimCss(l.spread), colorCss(l.color).css].filter(Boolean).join(' '))
    .join(', ');
}

/** CSS text (and hex for colors) of a literal DTCG value. */
export function tokenValueCss(type: string, value: unknown): { css: string; hex?: string } {
  switch (type) {
    case 'color':
      return colorCss(value);
    case 'dimension':
    case 'duration':
      return { css: dimCss(value) };
    case 'shadow':
      return { css: shadowCss(value) };
    case 'cubicBezier':
      return { css: Array.isArray(value) ? `cubic-bezier(${value.join(', ')})` : String(value) };
    case 'fontFamily':
      return { css: Array.isArray(value) ? value.map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(', ') : String(value) };
    default:
      return { css: String(value) };
  }
}

/** CSS variable of a token path ("color.bg.default" segments -> "--color-bg-default"). */
export const tokenRowCssVar = (segments: string[]) => `--${segments.join('-')}`;
/** Figma variable name of a token path. */
export const tokenRowFigmaName = (segments: string[]) => segments.join('/');

const isAlias = (v: unknown): v is string => typeof v === 'string' && /^\{[^}]+\}$/.test(v);

/**
 * Builds the rows from the token files of a repo. `readText` returns a repo-relative file body (undefined when
 * missing); `listFiles` returns the repo-relative files directly inside a directory. Throws on an alias that does not
 * resolve and on a themed token missing from another theme, as the token build does.
 */
export function buildTokenRows(config: BridgeConfig, readText: (path: string) => string | undefined, listFiles: (dir: string) => string[]): TokenRows {
  const axes = tokenRowAxes(config, readText);
  const { brands: BRANDS, defaultBrand: DEFAULT_BRAND, themes: MODES, densities: DENSITIES, defaultDensity: DEFAULT_DENSITY } = axes;
  const files = tokenRowFiles(config);
  const REF_THEME = MODES[0]!;

  const jsonFiles = (dir: string) =>
    listFiles(dir)
      .filter((f) => f.endsWith('.tokens.json'))
      .sort();
  const flatCache = new Map<string, RawTokenEntry[]>();
  const flatFile = (f: string): RawTokenEntry[] => {
    if (!flatCache.has(f)) {
      const text = readText(f);
      flatCache.set(f, text === undefined ? [] : flattenTokenFile(JSON.parse(text) as Json, f));
    }
    return flatCache.get(f)!;
  };
  const byPathOf = (tokens: RawTokenEntry[]) => new Map(tokens.map((t) => [t.path.join('.'), t]));

  const primitiveFiles = jsonFiles(files.primitivesDir);
  const componentFiles = jsonFiles(files.componentsDir);
  const sources = [
    ...primitiveFiles,
    ...jsonFiles(files.brandsDir),
    ...MODES.map(files.semanticFile),
    files.baseFile,
    ...jsonFiles(files.densityDir),
    ...componentFiles,
  ];

  const primitives: PrimitiveRow[] = primitiveFiles
    .flatMap((f) => flatFile(f))
    .map((t) => {
      const { css, hex } = tokenValueCss(t.type, t.value);
      return {
        path: t.path.join('.'),
        segments: t.path,
        type: t.type,
        css,
        hex,
        cssVar: tokenRowCssVar(t.path),
        figma: tokenRowFigmaName(t.path),
        description: t.description,
        deprecated: t.deprecated,
        raw: t.value,
        file: t.file,
      };
    });
  const primByPath = new Map(primitives.map((p) => [p.path, p]));

  const brandRaw = Object.fromEntries(BRANDS.map((b) => [b, flatFile(files.brandFile(b))]));
  const themeRaw = Object.fromEntries(MODES.map((m) => [m, flatFile(files.semanticFile(m))]));
  const baseRaw = flatFile(files.baseFile);
  const densityRaw = Object.fromEntries(DENSITIES.map((d) => [d, flatFile(files.densityFile(d))]));
  const componentRaw = componentFiles.flatMap((f) => flatFile(f));

  // Lookup layers for one combination, highest priority first (mirrors packages/tokens/build.mjs).
  const layerCache = new Map<string, Map<string, RawTokenEntry>[]>();
  const layers = (b: string, m: string, d: string) => {
    const k = `${b}.${m}.${d}`;
    if (!layerCache.has(k))
      layerCache.set(k, [
        byPathOf(flatFile(files.overrideFile(b, m))),
        byPathOf(themeRaw[m] ?? []),
        byPathOf(baseRaw),
        byPathOf(densityRaw[d] ?? []),
        byPathOf(componentRaw),
        byPathOf(brandRaw[b] ?? []),
      ]);
    return layerCache.get(k)!;
  };

  const resolve = (b: string, m: string, d: string, value: unknown, type: string): TokenRowMode => {
    const chain: string[] = [];
    let current = value;
    let currentType = type;
    let guard = 0;
    while (isAlias(current) && guard++ < 30) {
      const target = current.slice(1, -1);
      chain.push(target);
      const prim = primByPath.get(target);
      if (prim) return { alias: chain[0] ?? null, chain, css: prim.css, hex: prim.hex };
      const hit = layers(b, m, d)
        .map((l) => l.get(target))
        .find(Boolean);
      if (!hit) throw new Error(`tokens: alias {${target}} does not resolve in ${b} ${m} ${d}`);
      current = hit.value;
      currentType = hit.type || currentType;
    }
    const { css, hex } = tokenValueCss(currentType, current);
    return { alias: chain[0] ?? null, chain, css, hex };
  };

  const same = (a: TokenRowMode, c: TokenRowMode) => a.css === c.css && a.chain.join() === c.chain.join();

  /** Builds one documented token. `valueFor` returns the raw token for a brand x theme (x density). */
  const build = (t: RawTokenEntry, tier: TokenRow['tier'], valueFor: (b: string, m: string, d: string) => RawTokenEntry | undefined): TokenRow => {
    const at = (b: string, m: string, d: string = DEFAULT_DENSITY) => {
      const raw = valueFor(b, m, d) ?? t;
      return resolve(b, m, d, raw.value, raw.type || t.type);
    };
    const brands = Object.fromEntries(BRANDS.map((b) => [b, Object.fromEntries(MODES.map((m) => [m, at(b, m)]))])) as Record<string, Record<string, TokenRowMode>>;
    return {
      path: t.path.join('.'),
      segments: t.path,
      type: t.type,
      cssVar: tokenRowCssVar(t.path),
      figma: tokenRowFigmaName(t.path),
      description: t.description,
      group: t.path[0] === 'color' ? t.path.slice(0, 2).join('.') : t.path[0]!,
      deprecated: t.deprecated,
      tier,
      file: t.file,
      modes: brands[DEFAULT_BRAND]!,
      brands,
      densities: tier === 'density' ? Object.fromEntries(DENSITIES.map((d) => [d, at(DEFAULT_BRAND, REF_THEME, d)])) : undefined,
      brandSpecific: BRANDS.some((b) => MODES.some((m) => !same(brands[b]![m]!, brands[DEFAULT_BRAND]![m]!))),
    };
  };

  const brand = (brandRaw[DEFAULT_BRAND] ?? []).map((t) => build(t, 'brand', (b) => byPathOf(brandRaw[b] ?? []).get(t.path.join('.'))));

  // Themed semantic tokens: the first theme is the reference, every other theme must define the same paths.
  const themedBy = Object.fromEntries(MODES.map((m) => [m, byPathOf(themeRaw[m] ?? [])]));
  const themed = (themeRaw[REF_THEME] ?? []).map((t) => {
    const path = t.path.join('.');
    const others = MODES.slice(1).map((m) => {
      const hit = themedBy[m]!.get(path);
      if (!hit) throw new Error(`tokens: semantic token ${path} is missing in ${files.semanticFile(m)}`);
      return hit;
    });
    const s = build(t, 'semantic', (b, m) => byPathOf(flatFile(files.overrideFile(b, m))).get(path) ?? (m === REF_THEME ? t : themedBy[m]!.get(path)));
    s.description = [t, ...others].map((x) => x.description).find((x) => x !== undefined);
    s.deprecated = [t, ...others].map((x) => x.deprecated).find((x) => x !== undefined);
    s.file = MODES.map(files.semanticFile).join(', ');
    return s;
  });
  const base = baseRaw.map((t) => build(t, 'semantic', () => t));
  const semantic = [...themed, ...base];

  const density = (densityRaw[DEFAULT_DENSITY] ?? []).map((t) => build(t, 'density', (_b, _m, d) => byPathOf(densityRaw[d] ?? []).get(t.path.join('.'))));
  const component = componentRaw.map((t) => build(t, 'component', () => t));

  return { ...axes, primitives, semantic, brand, density, component, all: [...brand, ...semantic, ...density, ...component], sources };
}

/** Every CSS variable the rows define: cssVar -> token path, tier and type. */
export function tokenRowIndex(rows: Pick<TokenRows, 'primitives' | 'all'>): Map<string, { path: string; kind: TokenRowTier; type: string }> {
  const map = new Map<string, { path: string; kind: TokenRowTier; type: string }>();
  for (const p of rows.primitives) map.set(p.cssVar, { path: p.path, kind: 'primitive', type: p.type });
  for (const s of rows.all) map.set(s.cssVar, { path: s.path, kind: s.tier, type: s.type });
  return map;
}
