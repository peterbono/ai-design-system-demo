// Reads the DTCG token sources directly (not the generated CSS) so every page can show the full alias chain:
// semantic token -> primitive -> resolved value, per theme.
import { listDir, readJson } from './repo';

export type Mode = 'light' | 'dark';
export const MODES: Mode[] = ['light', 'dark'];

type Json = Record<string, unknown>;

export interface RawToken {
  path: string[];
  type: string;
  value: unknown;
  description?: string;
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
  raw: unknown;
  file: string;
}

export interface SemanticMode {
  alias: string | null; // primitive path, or null when the value is literal
  chain: string[]; // every alias hop, from the semantic token to the final primitive
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
  modes: Record<Mode, SemanticMode>;
}

export const PRIMITIVES_DIR = 'packages/tokens/src/primitives';
export const SEMANTIC_DIR = 'packages/tokens/src/semantic';
export const semanticFile = (mode: Mode) => `${SEMANTIC_DIR}/${mode}.tokens.json`;
export const primitiveFiles = () =>
  listDir(PRIMITIVES_DIR)
    .filter((f) => f.endsWith('.tokens.json'))
    .sort()
    .map((f) => `${PRIMITIVES_DIR}/${f}`);
export const TOKEN_SOURCE_FILES = () => [...primitiveFiles(), semanticFile('light'), semanticFile('dark')];

function flatten(node: Json, file: string, path: string[] = [], inheritedType = ''): RawToken[] {
  const type = (node.$type as string) ?? inheritedType;
  if ('$value' in node) {
    return [{ path, type, value: node.$value, description: node.$description as string | undefined, file }];
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

let cache: { primitives: Primitive[]; semantic: Semantic[] } | null = null;

export function loadTokens() {
  if (cache) return cache;
  const rawPrimitives = primitiveFiles().flatMap((f) => flatten(readJson<Json>(f), f));
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
      raw: t.value,
      file: t.file,
    };
  });
  const byPath = new Map(primitives.map((p) => [p.path, p]));

  const perMode = Object.fromEntries(
    MODES.map((m) => [m, flatten(readJson<Json>(semanticFile(m)), semanticFile(m))]),
  ) as Record<Mode, RawToken[]>;

  const resolveMode = (mode: Mode, value: unknown, type: string): SemanticMode => {
    const local = new Map(perMode[mode].map((t) => [t.path.join('.'), t]));
    const chain: string[] = [];
    let current = value;
    let guard = 0;
    while (isAlias(current) && guard++ < 20) {
      const target = aliasTarget(current);
      chain.push(target);
      const prim = byPath.get(target);
      if (prim) return { alias: chain[0] ?? null, chain, css: prim.css, hex: prim.hex };
      const sem = local.get(target);
      if (!sem) throw new Error(`docs-site: alias {${target}} does not resolve in ${mode}`);
      current = sem.value;
    }
    const { css, hex } = valueCss(type, current);
    return { alias: chain[0] ?? null, chain, css, hex };
  };

  const lightTokens = perMode.light;
  const darkByPath = new Map(perMode.dark.map((t) => [t.path.join('.'), t]));
  const semantic: Semantic[] = lightTokens.map((t) => {
    const path = t.path.join('.');
    const dark = darkByPath.get(path);
    if (!dark) throw new Error(`docs-site: semantic token ${path} is missing in dark.tokens.json`);
    const group = t.path[0] === 'color' ? t.path.slice(0, 2).join('.') : t.path[0]!;
    return {
      path,
      segments: t.path,
      type: t.type,
      cssVar: cssVarOf(t.path),
      figma: figmaNameOf(t.path),
      description: t.description ?? dark.description,
      group,
      modes: { light: resolveMode('light', t.value, t.type), dark: resolveMode('dark', dark.value, dark.type) },
    };
  });

  cache = { primitives, semantic };
  return cache;
}

/** Every CSS variable the system defines, mapped to where it is documented. */
export function tokenIndex() {
  const { primitives, semantic } = loadTokens();
  const map = new Map<string, { path: string; kind: 'primitive' | 'semantic'; type: string; href: string }>();
  for (const p of primitives) map.set(p.cssVar, { path: p.path, kind: 'primitive', type: p.type, href: hrefForVar(p.cssVar, p.type) });
  for (const s of semantic) map.set(s.cssVar, { path: s.path, kind: 'semantic', type: s.type, href: hrefForVar(s.cssVar, s.type) });
  return map;
}

export function hrefForVar(cssVar: string, type?: string): string {
  const id = anchorOf(cssVar);
  if (id.startsWith('color-') || id === 'focus-ring-color') return `/foundations/color/#${id}`;
  if (id.startsWith('space-')) return `/foundations/spacing/#${id}`;
  if (id.startsWith('radius-') || id.startsWith('border-') || id === 'focus-ring-width') return `/foundations/radius/#${id}`;
  if (id.startsWith('font-')) return `/foundations/typography/#${id}`;
  if (id.startsWith('shadow-') || id.startsWith('elevation-') || type === 'shadow') return `/foundations/elevation/#${id}`;
  return `/foundations/color/#${id}`;
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
