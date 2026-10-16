// core-adapter.ts: the one place @bridge/mcp reaches for design-system logic. Every function is
// @bridge/core: layered token sets, validation, contrast, minimal-diff edits, diff and impact, the shared
// risk classifier (same tiers as the Figma plugin and the docs site), the PR body, changesets and the
// GitHub client. The adapter only shapes them for the MCP tools and the CLI.
import {
  type BridgeConfig,
  type ChangeTier,
  type ContrastDelta,
  type ContrastPair,
  type EditResult,
  type ImpactEntry,
  type LayerIssue,
  type LayeredChange,
  type LayeredContrastResult,
  type LayeredResolution,
  type ProposalBodyInput,
  type Rgba,
  type SemverBump,
  type TokenEdit,
  applyTokenEdits,
  changeTable,
  checkLayeredPair,
  classifyLayered,
  coerceValue,
  comboKey,
  composeProposalBody,
  contrastDelta,
  contrastDeltaTable,
  contrastPair,
  diffLayered,
  formatChangeset,
  GitHubClient,
  GitHubError,
  layeredImpact,
  layeredParityIssues,
  LayeredTokenSet,
  parseContrastChecks,
  parseRepo,
  renderedColor,
  rgbaToHex,
  runLayeredContrast,
  selectTokenFiles,
  slugify,
  validateLayered,
} from '@bridge/core';
import type { RepoSource } from './source.js';

export type { Combo } from '@bridge/core';
export type Issue = LayerIssue;
export type Resolved = LayeredResolution;
export type TokenSet = LayeredTokenSet;
export type ContrastResult = LayeredContrastResult;
export type TokenChange = LayeredChange;
export type TierResult = ChangeTier;
export type { ContrastDelta, ContrastPair, EditResult, ImpactEntry, TokenEdit };
export { GitHubClient, GitHubError, LayeredTokenSet };

/** Pair as MCP clients pass it: `{ fg, bg, min }`. */
export interface PairInput {
  fg: string;
  bg: string;
  min: number;
}

export interface BridgeCore {
  loadTokenSet(source: RepoSource, config: BridgeConfig): Promise<TokenSet>;
  tokenSetFromFiles(config: BridgeConfig, files: Map<string, string>): TokenSet;
  validate(set: TokenSet): Issue[];
  parityIssues(set: TokenSet): Issue[];
  readContrastPairs(source: RepoSource, config: BridgeConfig): Promise<ContrastPair[]>;
  toPairs(input: PairInput[]): ContrastPair[];
  runContrast(set: TokenSet, pairs: ContrastPair[], modes?: string[]): ContrastResult[];
  checkPair: typeof checkLayeredPair;
  contrastDelta(before: ContrastResult[], after: ContrastResult[]): ContrastDelta[];
  applyEdits(set: TokenSet, edits: TokenEdit[]): EditResult;
  coerceValue(input: unknown, type?: string, existing?: unknown): unknown;
  diff(before: TokenSet, after: TokenSet): TokenChange[];
  impact(before: TokenSet, after: TokenSet, direct: TokenChange[], limit?: number): { total: number; entries: ImpactEntry[] };
  /** The shared classifier (risk.ts in @bridge/core). */
  classify(changes: TokenChange[], otherFiles?: string[], config?: BridgeConfig): TierResult;
  prBody(input: ProposalBodyInput): string;
  changeset(pkg: string, bump: SemverBump, summary: string): string;
  tokenTable: typeof changeTable;
  contrastTable: typeof contrastDeltaTable;
  slugify(text: string): string;
  comboKey: typeof comboKey;
  toRgba(v: unknown): Rgba | null;
  rgbaToHex: typeof rgbaToHex;
  parseRepo: typeof parseRepo;
}

async function readTokenFiles(source: RepoSource, config: BridgeConfig): Promise<Map<string, string>> {
  const root = config.tokens.root.replace(/\/$/, '');
  const picked = selectTokenFiles(config, await source.list(root === '.' ? '' : root));
  const texts = await Promise.all(picked.map(async (f) => [f, await source.read(root === '.' ? f : `${root}/${f}`)] as const));
  return new Map(texts.filter((t): t is readonly [string, string] => t[1] !== null));
}

export const core: BridgeCore = {
  async loadTokenSet(source, config) {
    return new LayeredTokenSet(config, await readTokenFiles(source, config));
  },
  tokenSetFromFiles: (config, files) => new LayeredTokenSet(config, files),
  validate: validateLayered,
  parityIssues: layeredParityIssues,
  async readContrastPairs(source, config) {
    if (!config.contrast) return [];
    // A repo without a contrast file simply has no gate yet.
    return parseContrastChecks((await source.read(config.contrast.path)) ?? undefined);
  },
  toPairs: (input) => input.map((p) => contrastPair(p.fg, p.bg, p.min)),
  runContrast: runLayeredContrast,
  checkPair: checkLayeredPair,
  contrastDelta,
  applyEdits: applyTokenEdits,
  coerceValue,
  diff: diffLayered,
  impact: layeredImpact,
  classify: (changes, otherFiles = [], config) => classifyLayered(changes, otherFiles, config),
  prBody: composeProposalBody,
  changeset: (pkg, bump, summary) => formatChangeset(pkg, bump, summary),
  tokenTable: changeTable,
  contrastTable: contrastDeltaTable,
  slugify: (text) => slugify(text, 48) || 'change',
  comboKey,
  toRgba: (v) => renderedColor(v) ?? null,
  rgbaToHex,
  parseRepo,
};
