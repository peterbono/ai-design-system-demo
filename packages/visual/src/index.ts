// @bridge-ds/visual: visual impact analysis for design system pull requests.
export { runImpact, planImpact, changedTokens, type ImpactOptions, type ImpactResult, type Plan } from './run.js';
export { selectImpact, storiesFromSource, storyId, storyComponent, type SelectInput } from './select.js';
export { diffPngs, boxesFromDiff, boxesFromCells, padTo, decodePng, encodePng, type DiffResult } from './diff.js';
export { COMMENT_MARKER, hasVisualChange, rankShots, renderComment, summarize, summaryLine, type CommentOptions } from './manifest.js';
export { DEFAULT_ROUTES, DEFAULT_TENANTS, routeUrl, storyUrl, shotKey } from './routes.js';
export { captureFigmaReferences, type ReferencesOptions, type ReferencesResult } from './references.js';
export { linkNodeModules } from './workspace.js';
export { openMeasurePage } from './capture.js';
export type * from './types.js';
