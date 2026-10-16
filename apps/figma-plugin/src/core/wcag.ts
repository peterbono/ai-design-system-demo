// WCAG 2.x contrast for declared foreground/background token pairs.

import { type PathIndex, resolve } from './resolver';
import { type Rgba, hexToRgba, parseColor } from './values';

export type PairKind = 'text' | 'large-text' | 'ui';

export interface ContrastPair {
  foreground: string;
  background: string;
  kind: PairKind;
}

export interface ContrastPairsFile {
  pairs: ContrastPair[];
}

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

export function contrastLevel(ratio: number, kind: PairKind): ContrastLevel {
  if (ratio >= AAA_MIN[kind]) return 'AAA';
  if (ratio >= AA_MIN[kind]) return 'AA';
  return 'fail';
}

export interface ContrastResult {
  pair: ContrastPair;
  mode: string;
  ratio?: number;
  level?: ContrastLevel;
  /** Why the ratio could not be computed (unresolvable alias, not a color). */
  error?: string;
}

/** Ratios of every pair in every theme mode. Ratios are rounded to 2 decimals. */
export function evaluatePairs(index: PathIndex, pairs: ContrastPair[], modes: string[]): ContrastResult[] {
  const out: ContrastResult[] = [];
  const color = (path: string, mode: string): Rgba | string => {
    const r = resolve(index, path, mode);
    if (r.error) return `${path} cannot be resolved (${r.error === 'broken' ? `missing ${r.at}` : r.error})`;
    return parseColor(r.value) ?? `${path} is not a color`;
  };
  for (const mode of modes) {
    for (const pair of pairs) {
      const fg = color(pair.foreground, mode);
      const bg = color(pair.background, mode);
      if (typeof fg === 'string' || typeof bg === 'string') {
        out.push({ pair, mode, error: typeof fg === 'string' ? fg : (bg as string) });
        continue;
      }
      const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
      out.push({ pair, mode, ratio, level: contrastLevel(ratio, pair.kind) });
    }
  }
  return out;
}

export function parseContrastPairs(text: string | undefined): ContrastPair[] {
  if (!text) return [];
  const data = JSON.parse(text) as Partial<ContrastPairsFile>;
  if (!Array.isArray(data.pairs)) return [];
  return data.pairs.filter(
    (p): p is ContrastPair =>
      !!p && typeof p.foreground === 'string' && typeof p.background === 'string' && (p.kind === 'text' || p.kind === 'large-text' || p.kind === 'ui'),
  );
}

export const pairKey = (r: { pair: ContrastPair; mode: string }) => `${r.mode}:${r.pair.foreground}|${r.pair.background}`;
