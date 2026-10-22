// WCAG 2.2 contrast of a repo model: the foreground/background pairs its token build gates on (bridge.config.json
// contrast.path), for every brand x theme, as @bridge-ds/core contrast-model computed them. Pure: functions of the model.
import { CONTRAST_THRESHOLDS, evaluateContrastPairs, hexContrastRatio, hexLuminance, tokensPath, type ContrastModeResult, type ContrastPairSpec, type RepoModel } from '@bridge-ds/core';
import type { Brand, Mode, Semantic } from './tokens';

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

/** Repo-relative contrast checks file: bridge.config.json contrast.path, else contrast.checks.json in tokens.root. */
export const contrastFile = (model: RepoModel): string => model.contrast.path ?? tokensPath(model.config, 'contrast.checks.json');

export const pairSpecs = (model: RepoModel): PairSpec[] => model.contrast.specs;

/** Resolve pair specs against the model's tokens in every brand and theme. */
export const evaluatePairs = (model: RepoModel, specs: PairSpec[]): PairResult[] =>
  evaluateContrastPairs(specs, model.tokens.rows) as unknown as PairResult[];

export const contrastPairs = (model: RepoModel): PairResult[] => model.contrast.pairs as unknown as PairResult[];
