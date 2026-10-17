// WCAG 2.2 contrast for the foreground/background pairs the token build gates on: packages/tokens/src/contrast.checks.json.
// Computed here for every brand x theme so the pages show exactly what the build enforces.
import { exists, readJson } from './repo';
import { BRANDS, DEFAULT_BRAND, loadTokens, MODES, type Brand, type Mode, type Semantic } from './tokens';

export const CONTRAST_FILE = 'packages/tokens/src/contrast.checks.json';

export interface PairSpec {
  fg: string;
  bg: string;
  usage: 'text' | 'ui';
  /** Minimum ratio the build enforces for this pair. */
  min: number;
}

export interface ModeResult {
  fgHex: string;
  bgHex: string;
  ratio: number;
  aa: boolean;
  aaa: boolean | null; // null when AAA is not defined (non-text UI)
}

export interface PairResult extends PairSpec {
  fgToken: Semantic;
  bgToken: Semantic;
  /** Default brand (bridge), per theme. */
  modes: Record<Mode, ModeResult>;
  brands: Record<Brand, Record<Mode, ModeResult>>;
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG thresholds: body text 4.5:1 (AA) and 7:1 (AAA); UI parts and graphics 3:1 (AA, 1.4.11). */
export const THRESHOLDS = { text: { aa: 4.5, aaa: 7 }, ui: { aa: 3, aaa: null } } as const;

interface ChecksFile {
  pairs: Array<[string, string, number] | { fg: string; bg: string; min: number }>;
}

export function pairSpecs(): PairSpec[] {
  if (!exists(CONTRAST_FILE)) return [];
  return readJson<ChecksFile>(CONTRAST_FILE).pairs.map((p) => {
    const [fg, bg, min] = Array.isArray(p) ? p : [p.fg, p.bg, p.min];
    return { fg, bg, min, usage: min >= THRESHOLDS.text.aa ? 'text' : 'ui' };
  });
}

let cache: PairResult[] | null = null;

/** Resolve pair specs against the tokens in every brand and theme. */
export function evaluatePairs(specs: PairSpec[]): PairResult[] {
  const bySemantic = new Map(loadTokens().all.map((s) => [s.path, s]));
  return specs.map((spec) => {
    const fgToken = bySemantic.get(spec.fg);
    const bgToken = bySemantic.get(spec.bg);
    if (!fgToken || !bgToken) {
      throw new Error(`docs-site: contrast pair ${spec.fg} on ${spec.bg} references a token that does not exist`);
    }
    const t = THRESHOLDS[spec.usage];
    const result = (b: Brand, m: Mode): ModeResult => {
      const fgHex = fgToken.brands[b][m].hex!;
      const bgHex = bgToken.brands[b][m].hex!;
      const r = ratio(fgHex, bgHex);
      // Round down to 2 decimals so 4.496 never displays as a passing 4.50.
      const shown = Math.floor(r * 100) / 100;
      return { fgHex, bgHex, ratio: shown, aa: r >= spec.min, aaa: t.aaa === null ? null : r >= t.aaa };
    };
    const brands = Object.fromEntries(
      BRANDS.map((b) => [b, Object.fromEntries(MODES.map((m) => [m, result(b, m)]))]),
    ) as Record<Brand, Record<Mode, ModeResult>>;
    return { ...spec, fgToken, bgToken, modes: brands[DEFAULT_BRAND], brands };
  });
}

export function contrastPairs(): PairResult[] {
  cache ??= evaluatePairs(pairSpecs());
  return cache;
}

/**
 * Screenshot and review fixture, dev server only: `BRIDGE_CONTRAST_FIXTURE=fail npm run docs:dev` adds pairs that
 * really fail with today's tokens, so the failing state of the Accessibility page can be seen without breaking a
 * token. Never set in a build, and the build gate (packages/tokens) never reads it.
 */
export const FAILING_FIXTURE: PairSpec[] = [
  { fg: 'color.text.muted', bg: 'color.bg.muted', min: 4.5, usage: 'text' },
  { fg: 'color.border.default', bg: 'color.surface.default', min: 3, usage: 'ui' },
];

export function pagePairs(dev: boolean): PairResult[] {
  const extra = dev && process.env.BRIDGE_CONTRAST_FIXTURE === 'fail' ? evaluatePairs(FAILING_FIXTURE) : [];
  return [...contrastPairs(), ...extra];
}
