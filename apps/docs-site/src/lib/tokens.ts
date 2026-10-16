// Reads the DTCG token sources directly (not the generated CSS) so every page can show the full alias chain:
// component -> semantic -> brand palette role -> primitive -> resolved value, per brand x theme (and density).
// Resolution order mirrors packages/tokens/build.mjs.
import { exists, listDir, readJson } from './repo';

export type Mode = 'light' | 'dark';
export const MODES: Mode[] = ['light', 'dark'];
export type Brand = 'bridge' | 'ocean';
export const BRANDS: Brand[] = ['bridge', 'ocean'];
export const DEFAULT_BRAND: Brand = 'bridge';
export type Density = 'comfortable' | 'compact';
export const DENSITIES: Density[] = ['comfortable', 'compact'];
export const DEFAULT_DENSITY: Density = 'comfortable';
export const BRAND_LABEL: Record<Brand, string> = { bridge: 'Bridge', ocean: 'Ocean' };
export const DENSITY_LABEL: Record<Density, string> = { comfortable: 'Comfortable', compact: 'Compact' };

/** Token tiers, in resolution order: primitive <- brand <- semantic <- component. Density sits beside semantic. */
export type Tier = 'primitive' | 'brand' | 'semantic' | 'density' | 'component';

type Json = Record<string, unknown>;

export interface RawToken {
  path: string[];
  type: string;
  value: unknown;
  description?: string;
  /** DTCG $deprecated: true, or a string explaining what to use instead. */
  deprecated?: boolean | string;
  file: string;
}

export interface Primitive {
  path: string;
  segments: string[];
  type: string;
  css: string; // resolved CSS value
  hex?: string;
  cssVar: string;
  figma: string;
  description?: string;
  deprecated?: boolean | string;
  raw: unknown;
  file: string;
}

export interface SemanticMode {
  alias: string | null; // first alias target, or null when the value is literal
  chain: string[]; // every alias hop, from the token to the final primitive (palette roles included)
  css: string;
  hex?: string;
}

export interface Semantic {
  path: string;
  segments: string[];
  type: string;
  cssVar: string;
  figma: string;
  description?: string;
  group: string; // e.g. "color.action" or "elevation"
  deprecated?: boolean | string;
  tier: Exclude<Tier, 'primitive'>;
  /** Source file(s) the token is declared in. */
  file: string;
  /** Values per theme in the default brand (bridge) and default density. */
  modes: Record<Mode, SemanticMode>;
  /** Values per brand x theme (default density). */
  brands: Record<Brand, Record<Mode, SemanticMode>>;
  /** Density tokens only: value per density. */
  densities?: Record<Density, SemanticMode>;
  /** True when the brand x theme values differ from the default brand. */
  brandSpecific: boolean;
}

export const TOKENS_SRC = 'packages/tokens/src';
export const PRIMITIVES_DIR = `${TOKENS_SRC}/primitives`;
export const SEMANTIC_DIR = `${TOKENS_SRC}/semantic`;
export const BRANDS_DIR = `${TOKENS_SRC}/brands`;
export const DENSITY_DIR = `${TOKENS_SRC}/density`;
export const COMPONENT_TOKENS_DIR = `${TOKENS_SRC}/components`;
export const semanticFile = (mode: Mode) => `${SEMANTIC_DIR}/${mode}.tokens.json`;
export const BASE_FILE = `${SEMANTIC_DIR}/base.tokens.json`;
export const brandFile = (b: Brand) => `${BRANDS_DIR}/${b}.tokens.json`;
export const overrideFile = (b: Brand, m: Mode) => `${BRANDS_DIR}/${b}.${m}.tokens.json`;
export const densityFile = (d: Density) => `${DENSITY_DIR}/${d}.tokens.json`;
const jsonFiles = (dir: string) =>
  listDir(dir)
    .filter((f) => f.endsWith('.tokens.json'))
    .sort()
    .map((f) => `${dir}/${f}`);
export const primitiveFiles = () => jsonFiles(PRIMITIVES_DIR);
export const componentTokenFiles = () => jsonFiles(COMPONENT_TOKENS_DIR);
export const TOKEN_SOURCE_FILES = () => [
  ...primitiveFiles(),
  ...jsonFiles(BRANDS_DIR),
  semanticFile('light'),
  semanticFile('dark'),
  BASE_FILE,
  ...jsonFiles(DENSITY_DIR),
  ...componentTokenFiles(),
];

function flatten(node: Json, file: string, path: string[] = [], inheritedType = ''): RawToken[] {
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
  const out: RawToken[] = [];
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || typeof child !== 'object' || child === null) continue;
    out.push(...flatten(child as Json, file, [...path, key], type));
  }
  return out;
}

const toHex2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');

interface ColorValue {
  components: number[];
  alpha?: number;
  hex?: string;
}
interface DimValue {
  value: number;
  unit: string;
}

function colorCss(c: unknown): { css: string; hex?: string } {
  if (typeof c === 'string') return { css: c, hex: /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined };
  const v = c as ColorValue;
  const [r = 0, g = 0, b = 0] = v.components;
  const hex = (v.hex ?? `#${[r, g, b].map(toHex2).join('')}`).toLowerCase();
  const alpha = v.alpha ?? 1;
  if (alpha < 1) return { css: `rgb(${[r, g, b].map((x) => Math.round(x * 255)).join(' ')} / ${alpha})`, hex };
  return { css: hex, hex };
}

const dimCss = (d: unknown) => (typeof d === 'object' && d !== null ? `${(d as DimValue).value}${(d as DimValue).unit}` : String(d));

function shadowCss(s: unknown): string {
  if (typeof s === 'string') return s;
  const layers = (Array.isArray(s) ? s : [s]) as Array<Record<string, unknown>>;
  return layers
    .map((l) =>
      [l.inset ? 'inset' : '', dimCss(l.offsetX), dimCss(l.offsetY), dimCss(l.blur), dimCss(l.spread), colorCss(l.color).css]
        .filter(Boolean)
        .join(' '),
    )
    .join(', ');
}

function valueCss(type: string, value: unknown): { css: string; hex?: string } {
  switch (type) {
    case 'color':
      return colorCss(value);
    case 'dimension':
      return { css: dimCss(value) };
    case 'shadow':
      return { css: shadowCss(value) };
    case 'duration':
      return { css: dimCss(value) };
    case 'cubicBezier':
      return { css: Array.isArray(value) ? `cubic-bezier(${value.join(', ')})` : String(value) };
    case 'fontFamily':
      return { css: Array.isArray(value) ? value.map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(', ') : String(value) };
    default:
      return { css: String(value) };
  }
}

export const cssVarOf = (segments: string[]) => `--${segments.join('-')}`;
export const figmaNameOf = (segments: string[]) => segments.join('/');
/** Anchor id used across pages: the CSS variable name without the leading dashes. */
export const anchorOf = (cssVar: string) => cssVar.replace(/^--/, '');

const isAlias = (v: unknown): v is string => typeof v === 'string' && /^\{[^}]+\}$/.test(v);
const aliasTarget = (v: string) => v.slice(1, -1);

interface Loaded {
  primitives: Primitive[];
  /** Semantic tier: themed (light/dark) and theme-independent (base). */
  semantic: Semantic[];
  /** Brand tier: palette, radius and font roles per brand. */
  brand: Semantic[];
  density: Semantic[];
  component: Semantic[];
  /** Every non-primitive token. */
  all: Semantic[];
}

let cache: Loaded | null = null;

const flatFile = (f: string) => (exists(f) ? flatten(readJson<Json>(f), f) : []);
const byPathOf = (tokens: RawToken[]) => new Map(tokens.map((t) => [t.path.join('.'), t]));

export function loadTokens(): Loaded {
  if (cache) return cache;
  const rawPrimitives = primitiveFiles().flatMap((f) => flatFile(f));
  const primitives: Primitive[] = rawPrimitives.map((t) => {
    const { css, hex } = valueCss(t.type, t.value);
    return {
      path: t.path.join('.'),
      segments: t.path,
      type: t.type,
      css,
      hex,
      cssVar: cssVarOf(t.path),
      figma: figmaNameOf(t.path),
      description: t.description,
      deprecated: t.deprecated,
      raw: t.value,
      file: t.file,
    };
  });
  const primByPath = new Map(primitives.map((p) => [p.path, p]));

  const brandRaw = Object.fromEntries(BRANDS.map((b) => [b, flatFile(brandFile(b))])) as Record<Brand, RawToken[]>;
  const themeRaw = Object.fromEntries(MODES.map((m) => [m, flatFile(semanticFile(m))])) as Record<Mode, RawToken[]>;
  const baseRaw = flatFile(BASE_FILE);
  const densityRaw = Object.fromEntries(DENSITIES.map((d) => [d, flatFile(densityFile(d))])) as Record<Density, RawToken[]>;
  const componentRaw = componentTokenFiles().flatMap((f) => flatFile(f));

  // Lookup layers for one combination, highest priority first (mirrors packages/tokens/build.mjs).
  const layersFor = (b: Brand, m: Mode, d: Density) => [
    byPathOf(flatFile(overrideFile(b, m))),
    byPathOf(themeRaw[m]),
    byPathOf(baseRaw),
    byPathOf(densityRaw[d]),
    byPathOf(componentRaw),
    byPathOf(brandRaw[b]),
  ];
  const layerCache = new Map<string, Map<string, RawToken>[]>();
  const layers = (b: Brand, m: Mode, d: Density) => {
    const k = `${b}.${m}.${d}`;
    if (!layerCache.has(k)) layerCache.set(k, layersFor(b, m, d));
    return layerCache.get(k)!;
  };

  const resolve = (b: Brand, m: Mode, d: Density, value: unknown, type: string): SemanticMode => {
    const chain: string[] = [];
    let current = value;
    let currentType = type;
    let guard = 0;
    while (isAlias(current) && guard++ < 30) {
      const target = aliasTarget(current);
      chain.push(target);
      const prim = primByPath.get(target);
      if (prim) return { alias: chain[0] ?? null, chain, css: prim.css, hex: prim.hex };
      const hit = layers(b, m, d).map((l) => l.get(target)).find(Boolean);
      if (!hit) throw new Error(`docs-site: alias {${target}} does not resolve in ${b} ${m} ${d}`);
      current = hit.value;
      currentType = hit.type || currentType;
    }
    const { css, hex } = valueCss(currentType, current);
    return { alias: chain[0] ?? null, chain, css, hex };
  };

  const same = (a: SemanticMode, c: SemanticMode) => a.css === c.css && a.chain.join() === c.chain.join();

  /** Builds one documented token. `valueFor` returns the raw token for a brand x theme (x density). */
  const build = (
    t: RawToken,
    tier: Semantic['tier'],
    valueFor: (b: Brand, m: Mode, d: Density) => RawToken | undefined,
  ): Semantic => {
    const path = t.path.join('.');
    const at = (b: Brand, m: Mode, d: Density = DEFAULT_DENSITY) => {
      const raw = valueFor(b, m, d) ?? t;
      return resolve(b, m, d, raw.value, raw.type || t.type);
    };
    const brands = Object.fromEntries(
      BRANDS.map((b) => [b, Object.fromEntries(MODES.map((m) => [m, at(b, m)]))]),
    ) as Record<Brand, Record<Mode, SemanticMode>>;
    const group = t.path[0] === 'color' ? t.path.slice(0, 2).join('.') : t.path[0]!;
    return {
      path,
      segments: t.path,
      type: t.type,
      cssVar: cssVarOf(t.path),
      figma: figmaNameOf(t.path),
      description: t.description,
      group,
      deprecated: t.deprecated,
      tier,
      file: t.file,
      modes: brands[DEFAULT_BRAND],
      brands,
      densities:
        tier === 'density'
          ? (Object.fromEntries(DENSITIES.map((d) => [d, at(DEFAULT_BRAND, 'light', d)])) as Record<Density, SemanticMode>)
          : undefined,
      brandSpecific: BRANDS.some((b) => MODES.some((m) => !same(brands[b][m], brands[DEFAULT_BRAND][m]))),
    };
  };

  const brand = brandRaw[DEFAULT_BRAND].map((t) =>
    build(t, 'brand', (b) => byPathOf(brandRaw[b]).get(t.path.join('.'))),
  );

  const darkByPath = byPathOf(themeRaw.dark);
  const themed = themeRaw.light.map((t) => {
    const path = t.path.join('.');
    const dark = darkByPath.get(path);
    if (!dark) throw new Error(`docs-site: semantic token ${path} is missing in dark.tokens.json`);
    const s = build(t, 'semantic', (b, m) => byPathOf(flatFile(overrideFile(b, m))).get(path) ?? (m === 'dark' ? dark : t));
    s.description = t.description ?? dark.description;
    s.deprecated = t.deprecated ?? dark.deprecated;
    s.file = `${semanticFile('light')}, ${semanticFile('dark')}`;
    return s;
  });
  const base = baseRaw.map((t) => build(t, 'semantic', () => t));
  const semantic = [...themed, ...base];

  const density = densityRaw[DEFAULT_DENSITY].map((t) =>
    build(t, 'density', (_b, _m, d) => byPathOf(densityRaw[d]).get(t.path.join('.'))),
  );
  const component = componentRaw.map((t) => build(t, 'component', () => t));

  cache = { primitives, semantic, brand, density, component, all: [...brand, ...semantic, ...density, ...component] };
  return cache;
}

/** Tier of any token path. */
export function tierOf(path: string): Tier {
  const { primitives, all } = loadTokens();
  if (primitives.some((p) => p.path === path)) return 'primitive';
  return all.find((s) => s.path === path)?.tier ?? 'semantic';
}

export type TokenKind = Tier;

/** Every CSS variable the system defines, mapped to where it is documented. */
export function tokenIndex() {
  const { primitives, all } = loadTokens();
  const map = new Map<string, { path: string; kind: TokenKind; type: string; href: string }>();
  for (const p of primitives) map.set(p.cssVar, { path: p.path, kind: 'primitive', type: p.type, href: hrefForVar(p.cssVar, p.type) });
  for (const s of all) map.set(s.cssVar, { path: s.path, kind: s.tier, type: s.type, href: hrefForVar(s.cssVar, s.type) });
  return map;
}

const NON_FOUNDATION = /^(palette|button|control|input|table|dialog|card|badge|tag|avatar|tooltip|menu|popover|toast|alert|tabs|drawer|accordion|layout|field|checkbox|radio|switch|slider|progress|skeleton|spinner|sidebar|pagination|breadcrumb|kbd|divider|empty|link|select|combobox|data|display|overlay|surface-tier|font-role)-/;

export function hrefForVar(cssVar: string, type?: string): string {
  const id = anchorOf(cssVar);
  const all = loadTokens().all;
  const tok = all.find((t) => t.cssVar === cssVar);
  if (tok && (tok.tier === 'brand' || tok.tier === 'component' || tok.tier === 'density')) return `/tokens/?t=${encodeURIComponent(tok.path)}`;
  if (NON_FOUNDATION.test(id)) return `/tokens/?q=${encodeURIComponent(id)}`;
  if (id.startsWith('color-') || id === 'focus-ring-color') return `/foundations/color/#${id}`;
  if (id.startsWith('space-')) return `/foundations/spacing/#${id}`;
  if (id.startsWith('radius-') || id.startsWith('border-') || id === 'focus-ring-width') return `/foundations/radius/#${id}`;
  if (id.startsWith('font-')) return `/foundations/typography/#${id}`;
  if (id.startsWith('shadow-') || id.startsWith('elevation-') || type === 'shadow') return `/foundations/elevation/#${id}`;
  if (type === 'color') return `/foundations/color/#${id}`;
  return `/tokens/?q=${encodeURIComponent(id)}`;
}

export const primitivesOf = (prefix: string) => loadTokens().primitives.filter((p) => p.path.startsWith(prefix + '.'));

/** Primitive color ramps, grouped by hue in source order. */
export function colorRamps() {
  const ramps = new Map<string, Primitive[]>();
  for (const p of loadTokens().primitives.filter((x) => x.type === 'color')) {
    const hue = p.segments[1]!;
    if (!ramps.has(hue)) ramps.set(hue, []);
    ramps.get(hue)!.push(p);
  }
  return [...ramps.entries()].map(([hue, steps]) => ({ hue, steps }));
}
