// WCAG 2.2 contrast of the foreground/background pairs the token build gates on (bridge.config.json contrast.path),
// for every brand x theme of the token rows, so pages show exactly what the build enforces. Moved from the docs site
// (apps/docs-site/src/lib/contrast.ts). Pure: takes the checks file text and the rows.

import type { TokenRow, TokenRows } from './token-rows';

export interface ContrastPairSpec {
  fg: string;
  bg: string;
  usage: 'text' | 'ui';
  /** Minimum ratio the build enforces for this pair. */
  min: number;
}

export interface ContrastModeResult {
  fgHex: string;
  bgHex: string;
  /** Rounded down to 2 decimals, so 4.496 never displays as a passing 4.50. */
  ratio: number;
  aa: boolean;
  /** null when AAA is not defined (non-text UI). */
  aaa: boolean | null;
}

export interface ContrastPairResult extends ContrastPairSpec {
  fgToken: TokenRow;
  bgToken: TokenRow;
  /** Default brand, per theme. */
  modes: Record<string, ContrastModeResult>;
  brands: Record<string, Record<string, ContrastModeResult>>;
}

/** WCAG thresholds: body text 4.5:1 (AA) and 7:1 (AAA); UI parts and graphics 3:1 (AA, 1.4.11). */
export const CONTRAST_THRESHOLDS = { text: { aa: 4.5, aaa: 7 }, ui: { aa: 3, aaa: null } } as const;

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a #rrggbb color. */
export function hexLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Contrast ratio of two opaque #rrggbb colors. */
export function hexContrastRatio(a: string, b: string): number {
  const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The pairs of a contrast checks file ({ "pairs": [[fg, bg, min] | { fg, bg, min }] }). Empty when there is no file. */
export function parseContrastSpecs(text: string | null | undefined): ContrastPairSpec[] {
  if (!text) return [];
  const data = JSON.parse(text) as { pairs?: Array<[string, string, number] | { fg: string; bg: string; min: number }> };
  return (data.pairs ?? []).map((p) => {
    const [fg, bg, min] = Array.isArray(p) ? p : [p.fg, p.bg, p.min];
    return { fg, bg, min, usage: min >= CONTRAST_THRESHOLDS.text.aa ? 'text' : 'ui' };
  });
}

/** Resolves pair specs against the token rows in every brand and theme. Throws on a pair naming a missing token. */
export function evaluateContrastPairs(specs: ContrastPairSpec[], rows: Pick<TokenRows, 'all' | 'brands' | 'themes' | 'defaultBrand'>): ContrastPairResult[] {
  const byPath = new Map(rows.all.map((s) => [s.path, s]));
  return specs.map((spec) => {
    const fgToken = byPath.get(spec.fg);
    const bgToken = byPath.get(spec.bg);
    if (!fgToken || !bgToken) throw new Error(`contrast: pair ${spec.fg} on ${spec.bg} references a token that does not exist`);
    const t = CONTRAST_THRESHOLDS[spec.usage];
    const result = (b: string, m: string): ContrastModeResult => {
      const fgHex = fgToken.brands[b]![m]!.hex!;
      const bgHex = bgToken.brands[b]![m]!.hex!;
      const r = hexContrastRatio(fgHex, bgHex);
      return { fgHex, bgHex, ratio: Math.floor(r * 100) / 100, aa: r >= spec.min, aaa: t.aaa === null ? null : r >= t.aaa };
    };
    const brands = Object.fromEntries(rows.brands.map((b) => [b, Object.fromEntries(rows.themes.map((m) => [m, result(b, m)]))])) as Record<string, Record<string, ContrastModeResult>>;
    return { ...spec, fgToken, bgToken, modes: brands[rows.defaultBrand]!, brands };
  });
}
