// =====================================================================================================
// core-adapter.ts: the ONLY place @bridge/mcp reaches for design-system logic.
//
// TEMPORARY. @bridge/core (branch integrate/bridge-v1) provides DTCG resolve, contrast, diff, minimal-diff
// JSON, PR body builder, tier classifier, changeset writer and a fetch GitHub client. It was not importable
// when this package was written, so ./internal/* holds a local implementation behind this interface.
//
// At merge time: implement `BridgeCore` with @bridge/core, delete ./internal/{dtcg,contrast,diff,edits,
// json-edit,github}.ts, and keep the tests (they exercise this interface, not the internals).
// Reconcile bridge.config.json with @bridge/core's schema first (see bridge.config.schema.json).
// =====================================================================================================
import type { BridgeConfig } from './config.js';
import type { RepoSource } from './source.js';
import { TokenSet, validate, parityIssues, comboKey, toRgba, rgbaToHex, type Combo, type Issue, type Resolved, type TokenDef } from './internal/dtcg.js';
import { contrastDelta, parsePairs, runContrast, checkPair, type ContrastDelta, type ContrastPair, type ContrastResult } from './internal/contrast.js';
import { buildChangeset, buildPrBody, classify, contrastTable, diffTokenSets, impact, slugify, tokenTable, type ImpactEntry, type TierResult, type TokenChange } from './internal/diff.js';
import { applyEdits, coerceValue, type EditResult, type TokenEdit } from './internal/edits.js';
import { GitHubClient, GitHubError, parseRepo, type PullSummary } from './internal/github.js';
import { globToRegExp } from './internal/dtcg.js';

export type { Combo, Issue, Resolved, TokenDef, ContrastPair, ContrastResult, ContrastDelta, TokenChange, ImpactEntry, TierResult, TokenEdit, EditResult, PullSummary };
export { TokenSet, GitHubClient, GitHubError };

export interface BridgeCore {
  loadTokenSet(source: RepoSource, config: BridgeConfig): Promise<TokenSet>;
  tokenSetFromFiles(config: BridgeConfig, files: Map<string, string>): TokenSet;
  validate(set: TokenSet): Issue[];
  parityIssues(set: TokenSet): Issue[];
  readContrastPairs(source: RepoSource, config: BridgeConfig): Promise<ContrastPair[]>;
  runContrast(set: TokenSet, pairs: ContrastPair[], modes?: string[]): ContrastResult[];
  checkPair(set: TokenSet, pair: ContrastPair, combo: Combo): ContrastResult;
  contrastDelta(before: ContrastResult[], after: ContrastResult[]): ContrastDelta[];
  applyEdits(set: TokenSet, edits: TokenEdit[]): EditResult;
  coerceValue(input: unknown, type?: string, existing?: unknown): unknown;
  diff(before: TokenSet, after: TokenSet): TokenChange[];
  impact(before: TokenSet, after: TokenSet, direct: TokenChange[], limit?: number): { total: number; entries: ImpactEntry[] };
  classify(changes: TokenChange[], otherFiles?: string[], guardrails?: string[], componentsDir?: string): TierResult;
  prBody: typeof buildPrBody;
  changeset: typeof buildChangeset;
  tokenTable: typeof tokenTable;
  contrastTable: typeof contrastTable;
  slugify: typeof slugify;
  comboKey: typeof comboKey;
  toRgba: typeof toRgba;
  rgbaToHex: typeof rgbaToHex;
  parseRepo: typeof parseRepo;
}

/** Token files of a source: under tokens.root, matching include and not exclude. Paths relative to root. */
async function readTokenFiles(source: RepoSource, config: BridgeConfig): Promise<Map<string, string>> {
  const root = config.tokens.root.replace(/\/$/, '');
  const rel = (f: string) => (root === '.' || !root ? f : f.slice(root.length + 1));
  const inc = config.tokens.include.map(globToRegExp);
  const exc = config.tokens.exclude.map(globToRegExp);
  const contrast = config.contrast?.path;
  const all = await source.list(root === '.' ? '' : root);
  const picked = all.filter((f) => f !== contrast).map(rel).filter((f) => inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f)));
  const texts = await Promise.all(picked.map(async (f) => [f, await source.read(root === '.' ? f : `${root}/${f}`)] as const));
  return new Map(texts.filter((t): t is readonly [string, string] => t[1] !== null).map(([f, t]) => [f, t]));
}

export const core: BridgeCore = {
  async loadTokenSet(source, config) {
    return new TokenSet(config, await readTokenFiles(source, config));
  },
  tokenSetFromFiles: (config, files) => new TokenSet(config, files),
  validate,
  parityIssues,
  async readContrastPairs(source, config) {
    if (!config.contrast) return [];
    const text = await source.read(config.contrast.path);
    if (!text) throw new Error(`Contrast file ${config.contrast.path} not found.`);
    return parsePairs(text);
  },
  runContrast,
  checkPair,
  contrastDelta,
  applyEdits,
  coerceValue,
  diff: diffTokenSets,
  impact,
  classify,
  prBody: buildPrBody,
  changeset: buildChangeset,
  tokenTable,
  contrastTable,
  slugify,
  comboKey,
  toRgba,
  rgbaToHex,
  parseRepo,
};
