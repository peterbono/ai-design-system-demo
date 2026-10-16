// WCAG 2.2 contrast for the real foreground/background pairs listed in packages/tokens/src/contrast-pairs.json.
import { exists, readJson } from './repo';
import { loadTokens, MODES, type Mode, type Semantic } from './tokens';

export const CONTRAST_FILE = 'packages/tokens/src/contrast-pairs.json';

export interface PairSpec {
  fg: string;
  bg: string;
  usage: 'text' | 'ui';
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
  modes: Record<Mode, ModeResult>;
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

export function contrastPairs(): PairResult[] {
  if (!exists(CONTRAST_FILE)) return [];
  const specs = readJson<PairSpec[]>(CONTRAST_FILE);
  const bySemantic = new Map(loadTokens().semantic.map((s) => [s.path, s]));
  return specs.map((spec) => {
    const fgToken = bySemantic.get(spec.fg);
    const bgToken = bySemantic.get(spec.bg);
    if (!fgToken || !bgToken) {
      throw new Error(`docs-site: contrast pair ${spec.fg} on ${spec.bg} references a token that does not exist`);
    }
    const t = THRESHOLDS[spec.usage];
    const modes = Object.fromEntries(
      MODES.map((m) => {
        const fgHex = fgToken.modes[m].hex!;
        const bgHex = bgToken.modes[m].hex!;
        const r = ratio(fgHex, bgHex);
        // Round down to 2 decimals so 4.496 never displays as a passing 4.50.
        const shown = Math.floor(r * 100) / 100;
        return [m, { fgHex, bgHex, ratio: shown, aa: r >= t.aa, aaa: t.aaa === null ? null : r >= t.aaa }];
      }),
    ) as Record<Mode, ModeResult>;
    return { ...spec, fgToken, bgToken, modes };
  });
}
