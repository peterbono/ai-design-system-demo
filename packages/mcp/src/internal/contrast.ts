// WCAG 2.2 contrast over resolved tokens, for every mode combination the gate covers.
// TO BE REPLACED by contrast in @bridge/core at merge time (see ../core-adapter.ts).
import { comboKey, rgbaToHex, toRgba, type Combo, type Rgba, type TokenSet } from './dtcg.js';

export interface ContrastPair {
  fg: string;
  bg: string;
  min: number;
}

export interface ContrastResult {
  fg: string;
  bg: string;
  min: number;
  modes: string;
  ratio: number | null;
  pass: boolean;
  fgValue?: string;
  bgValue?: string;
  note?: string;
}

export function parsePairs(text: string): ContrastPair[] {
  const json = JSON.parse(text) as { pairs?: unknown[] } | unknown[];
  const list = Array.isArray(json) ? json : (json.pairs ?? []);
  return list.map((p) => {
    if (Array.isArray(p)) return { fg: String(p[0]), bg: String(p[1]), min: Number(p[2] ?? 4.5) };
    const o = p as Record<string, unknown>;
    return { fg: String(o.fg ?? o.foreground), bg: String(o.bg ?? o.background), min: Number(o.min ?? o.ratio ?? 4.5) };
  });
}

const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
// Same rounding as the token build: luminance from 8-bit channels.
const q = (x: number) => Math.round(x * 255) / 255;
export const luminance = (c: Rgba) => 0.2126 * lin(q(c.r)) + 0.7152 * lin(q(c.g)) + 0.0722 * lin(q(c.b));
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, r) => r - p);
  return (x! + 0.05) / (y! + 0.05);
}
const over = (fg: Rgba, bg: Rgba): Rgba => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });

export function checkPair(set: TokenSet, pair: ContrastPair, combo: Combo): ContrastResult {
  const base = { fg: pair.fg, bg: pair.bg, min: pair.min, modes: comboKey(combo) };
  const f = set.resolve(pair.fg, combo);
  const b = set.resolve(pair.bg, combo);
  if (f.error || b.error) return { ...base, ratio: null, pass: false, note: f.error ?? b.error };
  const fc = toRgba(f.value);
  const bc = toRgba(b.value);
  if (!fc || !bc) return { ...base, ratio: null, pass: false, note: 'not a color Bridge can measure (needs srgb or hex)' };
  if (bc.a < 1) return { ...base, ratio: null, pass: false, note: 'background is translucent: contrast depends on what is behind it' };
  const ratio = Math.round(contrastRatio(over(fc, bc), bc) * 100) / 100;
  return { ...base, ratio, pass: ratio >= pair.min, fgValue: rgbaToHex(fc), bgValue: rgbaToHex(bc), ...(fc.a < 1 ? { note: 'foreground alpha composited over background' } : {}) };
}

export function runContrast(set: TokenSet, pairs: ContrastPair[], modes?: string[]): ContrastResult[] {
  const combos = set.combos(modes ?? set.config.contrast?.modes);
  return combos.flatMap((c) => pairs.map((p) => checkPair(set, p, c)));
}

export interface ContrastDelta {
  fg: string;
  bg: string;
  min: number;
  modes: string;
  before: number | null;
  after: number | null;
  passBefore: boolean;
  passAfter: boolean;
}

/** Pairs whose ratio moved between two token sets, plus the ones that fail after. */
export function contrastDelta(before: ContrastResult[], after: ContrastResult[]): ContrastDelta[] {
  const key = (r: ContrastResult) => `${r.fg}|${r.bg}|${r.modes}`;
  const prev = new Map(before.map((r) => [key(r), r]));
  return after
    .map((a) => {
      const b = prev.get(key(a));
      return { fg: a.fg, bg: a.bg, min: a.min, modes: a.modes, before: b?.ratio ?? null, after: a.ratio, passBefore: b?.pass ?? true, passAfter: a.pass };
    })
    .filter((d) => d.before !== d.after || !d.passAfter);
}
