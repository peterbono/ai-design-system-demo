// WCAG 2.x contrast for declared foreground/background token pairs.

import { type PathIndex, type ResolveContext, type StepSource, resolve } from './resolver';
import { type Rgba, hexToRgba, parseColor } from './values';

export type PairKind = 'text' | 'large-text' | 'ui';

/** One entry of contrast.checks.json: foreground and background token paths and the minimum ratio. */
export interface ContrastPair {
  foreground: string;
  background: string;
  /** Minimum ratio from contrast.checks.json (4.5 for text, 3 for non-text UI). */
  min: number;
  /** Derived from `min`: 4.5 or more is text, anything lower is a UI component (WCAG 1.4.11). */
  kind: PairKind;
}

/** contrast.checks.json in the tokens path: the one source of contrast pairs (the token build uses it too). */
export const CONTRAST_CHECKS_FILE = 'contrast.checks.json';

/** Minimum ratio for WCAG AA per pair kind (1.4.3 and 1.4.11). */
export const AA_MIN: Record<PairKind, number> = { text: 4.5, 'large-text': 3, ui: 3 };
/** Minimum ratio for WCAG AAA (1.4.6). UI components have no AAA criterion; 4.5 is used as a stretch goal. */
export const AAA_MIN: Record<PairKind, number> = { text: 7, 'large-text': 4.5, ui: 4.5 };

const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Relative luminance of an opaque sRGB color (channels 0..1, rounded to 8-bit like browsers render). */
export function luminance(c: Rgba): number {
  const q = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255) / 255;
  return 0.2126 * channel(q(c.r)) + 0.7152 * channel(q(c.g)) + 0.0722 * channel(q(c.b));
}

/** Composite a possibly translucent foreground over an opaque background. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

export function contrastRatio(fg: Rgba | string, bg: Rgba | string): number {
  const f = typeof fg === 'string' ? hexToRgba(fg) : fg;
  const b = typeof bg === 'string' ? hexToRgba(bg) : bg;
  if (!f || !b) throw new Error('Invalid color');
  const opaqueBg = { ...b, a: 1 };
  const l1 = luminance(composite(f, opaqueBg));
  const l2 = luminance(opaqueBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = 'AAA' | 'AA' | 'fail';

/** AAA when it meets the AAA ratio of its kind, AA when it meets `min` (the pair's own minimum), else fail. */
export function contrastLevel(ratio: number, kind: PairKind, min = AA_MIN[kind]): ContrastLevel {
  if (ratio < min) return 'fail';
  if (ratio >= AAA_MIN[kind]) return 'AAA';
  return 'AA';
}

/** One token visited while resolving a pair: its path and whether a brand override supplied the value. */
export interface ContrastStep {
  path: string;
  via: StepSource;
}

export interface ContrastResult {
  pair: ContrastPair;
  /** Brand mode key; undefined when the repo has no brands. */
  brand: string | undefined;
  /** Theme mode key. */
  theme: string;
  ratio?: number;
  level?: ContrastLevel;
  /** Why the ratio could not be computed (unresolvable alias, not a color). */
  error?: string;
  /** Every token both colors resolve through in this brand x theme (used to find what a change affects). */
  steps: ContrastStep[];
}

/** Brand x theme combinations a set is checked in, like the token build (density does not change colors). */
export interface ContrastScope {
  brands: string[];
  themes: string[];
  density?: string | undefined;
  overrides?: Map<string, unknown> | undefined;
}

export function contrastScope(set: { layout: { brands: { mode: string }[]; themes: { mode: string }[]; densities: { mode: string }[] }; overrideIndex: Map<string, unknown> }): ContrastScope {
  return {
    brands: set.layout.brands.map((b) => b.mode),
    themes: set.layout.themes.map((t) => t.mode),
    density: set.layout.densities[0]?.mode,
    overrides: set.overrideIndex,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Ocean dark", or "Dark" when the repo has a single unnamed brand. */
export const contextLabel = (r: { brand: string | undefined; theme: string }) => (r.brand ? `${cap(r.brand)} ${r.theme}` : cap(r.theme));

/**
 * The color a browser renders: tokens.css writes the `hex` of a DTCG color when it has one, and
 * components can round differently at the 8-bit boundary, so hex wins (same as the token build).
 */
export function renderedColor(value: unknown): Rgba | undefined {
  const c = parseColor(value);
  const hex = value && typeof value === 'object' ? (value as { hex?: unknown }).hex : undefined;
  const fromHex = typeof hex === 'string' ? hexToRgba(hex) : undefined;
  return c && fromHex ? { ...fromHex, a: c.a } : c;
}

/** Ratios of every pair in every brand x theme. Ratios are rounded to 2 decimals. */
export function evaluatePairs(index: PathIndex, pairs: ContrastPair[], scope: ContrastScope): ContrastResult[] {
  const out: ContrastResult[] = [];
  const brands = scope.brands.length ? scope.brands : [undefined];
  for (const brand of brands) {
    for (const theme of scope.themes) {
      const ctx: ResolveContext = { brand, theme, density: scope.density, overrides: scope.overrides };
      for (const pair of pairs) {
        const steps: ContrastStep[] = [];
        const color = (path: string): Rgba | string => {
          const r = resolve(index, path, ctx);
          r.via.forEach((via, i) => steps.push({ path: r.chain[i]!, via }));
          if (r.error) return `${path} cannot be resolved (${r.error === 'broken' ? `missing ${r.at}` : r.error})`;
          return renderedColor(r.value) ?? `${path} is not a color`;
        };
        const fg = color(pair.foreground);
        const bg = color(pair.background);
        if (typeof fg === 'string' || typeof bg === 'string') {
          out.push({ pair, brand, theme, steps, error: typeof fg === 'string' ? fg : (bg as string) });
          continue;
        }
        const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
        out.push({ pair, brand, theme, ratio, level: contrastLevel(ratio, pair.kind, pair.min), steps });
      }
    }
  }
  return out;
}

/** Text pair when the minimum is 4.5:1 or more, UI pair (WCAG 1.4.11) below that. */
export const kindForMin = (min: number): PairKind => (min >= AA_MIN.text ? 'text' : 'ui');

/**
 * Parse contrast.checks.json: `{ "$description": "...", "pairs": [[fg, bg, min], ...] }`.
 * Entries that are not a [string, string, number] triple are skipped.
 */
export function parseContrastChecks(text: string | undefined): ContrastPair[] {
  if (!text) return [];
  const data = JSON.parse(text) as { pairs?: unknown };
  if (!Array.isArray(data.pairs)) return [];
  const out: ContrastPair[] = [];
  for (const p of data.pairs) {
    if (!Array.isArray(p) || typeof p[0] !== 'string' || typeof p[1] !== 'string' || typeof p[2] !== 'number' || !(p[2] > 0)) continue;
    out.push({ foreground: p[0], background: p[1], min: p[2], kind: kindForMin(p[2]) });
  }
  return out;
}

export const pairKey = (r: { pair: ContrastPair; brand: string | undefined; theme: string }) => `${r.brand ?? ''}/${r.theme}:${r.pair.foreground}|${r.pair.background}`;
