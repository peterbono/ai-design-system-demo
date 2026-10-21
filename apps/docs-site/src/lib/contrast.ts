// WCAG 2.2 contrast for the foreground/background pairs the token build gates on (bridge.config.json contrast.path),
// for every brand x theme, so the pages show exactly what the build enforces. Computed once by the repo model
// (lib/model.ts, @bridge-ds/core contrast-model); this module names the results for the pages.
import { CONTRAST_THRESHOLDS, evaluateContrastPairs, hexContrastRatio, hexLuminance, tokensPath, type ContrastModeResult, type ContrastPairSpec } from '@bridge-ds/core';
import { repoModel } from './model';
import type { Brand, Mode, Semantic } from './tokens';

/** Repo-relative contrast checks file: bridge.config.json contrast.path, else contrast.checks.json in tokens.root. */
export const CONTRAST_FILE = repoModel.contrast.path ?? tokensPath(repoModel.config, 'contrast.checks.json');

export type PairSpec = ContrastPairSpec;
export type ModeResult = ContrastModeResult;

export interface PairResult extends PairSpec {
  fgToken: Semantic;
  bgToken: Semantic;
  /** Default brand, per theme. */
  modes: Record<Mode, ModeResult>;
  brands: Record<Brand, Record<Mode, ModeResult>>;
}

export const luminance = hexLuminance;
export const ratio = hexContrastRatio;

/** WCAG thresholds: body text 4.5:1 (AA) and 7:1 (AAA); UI parts and graphics 3:1 (AA, 1.4.11). */
export const THRESHOLDS = CONTRAST_THRESHOLDS;

export const pairSpecs = (): PairSpec[] => repoModel.contrast.specs;

/** Resolve pair specs against the tokens in every brand and theme. */
export const evaluatePairs = (specs: PairSpec[]): PairResult[] => evaluateContrastPairs(specs, repoModel.tokens.rows) as unknown as PairResult[];

export const contrastPairs = (): PairResult[] => repoModel.contrast.pairs as unknown as PairResult[];

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
