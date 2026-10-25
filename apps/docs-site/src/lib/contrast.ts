// WCAG 2.2 contrast of this build, for the pages: thin wrappers over the pure lib/library/contrast.ts with the
// build-time repo model (lib/model.ts), so the pages show exactly what the token build enforces.
import { repoModel } from './model';
import * as lib from './library/contrast';
import type { PairResult, PairSpec } from './library/contrast';

export type { ModeResult, PairResult, PairSpec } from './library/contrast';
export { luminance, ratio, THRESHOLDS } from './library/contrast';

/** Repo-relative contrast checks file: bridge.config.json contrast.path, else contrast.checks.json in tokens.root. */
export const CONTRAST_FILE = lib.contrastFile(repoModel);

export const pairSpecs = (): PairSpec[] => lib.pairSpecs(repoModel);

/** Resolve pair specs against the tokens in every brand and theme. */
export const evaluatePairs = (specs: PairSpec[]): PairResult[] => lib.evaluatePairs(repoModel, specs);

export const contrastPairs = (): PairResult[] => lib.contrastPairs(repoModel);

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
