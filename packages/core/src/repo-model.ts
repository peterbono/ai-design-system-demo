// The repo model: everything the docs site and Studio read from a design system repo, computed from a RepoSource.
// One function for the build (fsSource over the checkout) and the browser (a GitHub source over any team's repo):
// bridge.config.json parsed once, the token rows, contrast results, the component scan (props, CSS tokens, stories,
// docs.json) and the Figma coverage of component-specs.json. Every path comes from the config; the defaults are
// the paths this repo used before the config named them. Pure: no Node, no DOM.

import { ConfigError, defineConfig, loadConfig, tokensPath, CONFIG_FILE, DEFAULT_CHANGES_MODE, DEFAULT_OVERRIDE, type BridgeConfig, type BridgeConfigInput, type ChangesMode } from './config';
import { scanComponents, parseComponentFamilies, type ScannedComponent } from './component-scan';
import { parseComponentSpecs, type ComponentSpecsFile, type SpecCoverage } from './component-spec';
import { evaluateContrastPairs, parseContrastSpecs, type ContrastPairResult, type ContrastPairSpec } from './contrast-model';
import { selectTokenFiles } from './layered';
import { DEFAULT_PRODUCTS, type ProductConfig } from './products';
import { readRepoTexts, parentDir, type RepoSource, type RepoSourceRef } from './repo-source';
import type { IntegrationsConfig } from './requests';
import type { Rights, VisualImpactMode } from './rights';
import { buildTokenRows, tokenRowAxes, tokenRowIndex, type TokenRows, type TokenRowTier } from './token-rows';

/** Paths used when bridge.config.json does not name them: where this repo kept them before the config did. */
export const REPO_MODEL_DEFAULTS = {
  tokensRoot: 'packages/tokens/src',
  componentsDir: 'packages/react/src/components',
  componentSpecs: 'packages/react/component-specs.json',
  /** Optional token usage notes (group -> sentence), relative to tokens.root, when tokens.usage is not set. */
  tokensUsage: 'usage.json',
  repo: { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main' },
} as const;

/** The repository settings the site and Studio act on (roles, owners, mode), derived from bridge.config.json. */
export interface SiteRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** GitHub logins that count as design and tech owners for Tier 3 approvals. Empty: any two distinct approvers. */
  owners: { design: string[]; tech: string[] };
  /** Who may merge past missing approvals from Reviews, with a reason. `allowed` empty: no override. */
  override: { allowed: string[]; requireReason: boolean; minReasonLength: number };
  /** Which owner group approves design, approves tech and ships. null: not set. */
  rights: Rights | null;
  /** governance.soloOwnerCanApproveBoth: the only owner's approval covers design and tech. Default false. */
  soloOwnerCanApproveBoth: boolean;
  /** Visual before and after: on every pull request (auto) or when someone asks (on-demand, label visual-check). */
  visualImpact: { mode: VisualImpactMode };
  /** Token root in the repo. */
  tokensRoot: string;
  /** Where component change requests go besides the GitHub issue. Empty: GitHub only. */
  integrations: IntegrationsConfig;
  /** The apps that consume the design system, the library being the default. */
  products: ProductConfig[];
  /** How changes reach the code: "suggest" (default) or "direct". */
  changes: ChangesMode;
}

type LegacyRaw = { owner?: unknown; defaultBranch?: unknown; owners?: { design?: string[]; tech?: string[] }; governance?: { owners?: unknown } } | null | undefined;

/**
 * SiteRepo from a parsed config. `raw` (the file as parsed JSON) carries the older top-level keys loadConfig does not
 * keep (`owner`, `defaultBranch`, `owners`); `fallback` names the repo when the config does not.
 */
export function siteRepoFromConfig(
  config: BridgeConfig,
  raw?: unknown,
  fallback: { owner: string; repo: string; defaultBranch: string } = REPO_MODEL_DEFAULTS.repo,
): SiteRepo {
  const legacy = (raw && typeof raw === 'object' ? raw : undefined) as LegacyRaw;
  const g = config.governance;
  const legacyOwners = legacy?.governance?.owners === undefined ? legacy?.owners : undefined;
  return {
    owner: typeof legacy?.owner === 'string' && legacy.owner ? legacy.owner : (config.repo?.owner ?? fallback.owner),
    repo: config.repo?.name ?? fallback.repo,
    defaultBranch: typeof legacy?.defaultBranch === 'string' && legacy.defaultBranch ? legacy.defaultBranch : (config.repo?.defaultBranch ?? fallback.defaultBranch),
    owners: legacyOwners ? { design: legacyOwners.design ?? [], tech: legacyOwners.tech ?? [] } : { design: [...g.owners.design], tech: [...g.owners.tech] },
    override: g.override ? { ...g.override } : { ...DEFAULT_OVERRIDE },
    rights: g.rights ?? null,
    soloOwnerCanApproveBoth: g.soloOwnerCanApproveBoth === true,
    visualImpact: { mode: config.visualImpact?.mode === 'on-demand' ? 'on-demand' : 'auto' },
    tokensRoot: config.tokens.root,
    integrations: config.integrations ?? {},
    products: config.products.length ? config.products : DEFAULT_PRODUCTS.map((p) => ({ ...p })),
    changes: config.changes ?? DEFAULT_CHANGES_MODE,
  };
}

/** Fills the paths a config leaves out with REPO_MODEL_DEFAULTS (tokens.root, components.dir). */
function withModelDefaults(raw: Record<string, unknown>): Record<string, unknown> {
  const tokens = (raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {}) as Record<string, unknown>;
  return {
    ...raw,
    tokens: { ...tokens, root: tokens.root ?? REPO_MODEL_DEFAULTS.tokensRoot },
    components: raw.components ?? { dir: REPO_MODEL_DEFAULTS.componentsDir },
  };
}

/** The config the model uses when the repo has no bridge.config.json (or an invalid one): the defaults above. */
export const defaultModelConfig = (): BridgeConfig => defineConfig(withModelDefaults({}) as BridgeConfigInput);

/** bridge.config.json text -> config, parsed once. Never throws: problems are returned and the defaults stand in. */
export function parseModelConfig(text: string | null): { config: BridgeConfig; raw: unknown; problems: string[] } {
  if (text === null) return { config: defaultModelConfig(), raw: undefined, problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { config: defaultModelConfig(), raw: undefined, problems: [`${CONFIG_FILE} is not valid JSON (${(err as Error).message})`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { config: defaultModelConfig(), raw, problems: [`${CONFIG_FILE}: top level must be an object`] };
  try {
    return { config: loadConfig(withModelDefaults(raw as Record<string, unknown>)), raw, problems: [] };
  } catch (err) {
    const problems = err instanceof ConfigError ? err.problems.map((p) => `${CONFIG_FILE}: ${p}`) : [`${CONFIG_FILE}: ${(err as Error).message}`];
    return { config: defaultModelConfig(), raw, problems };
  }
}

export interface RepoModel {
  ref: RepoSourceRef;
  /** bridge.config.json as read, null when the repo has none. */
  configText: string | null;
  config: BridgeConfig;
  site: SiteRepo;
  /** What could not be read (invalid config, a docs.json that does not parse, an alias that does not resolve). */
  problems: string[];
  tokens: {
    /** tokens.root, repo-relative. */
    root: string;
    /** Token file bodies keyed by path relative to tokens.root, as buildTokenSet and the token explorer read them. */
    files: Record<string, string>;
    rows: TokenRows;
    /** Notes per token group (tokens.usage), null when the repo has none. */
    usage: Record<string, string> | null;
  };
  contrast: {
    /** Repo-relative checks file, undefined when the config names none. */
    path: string | undefined;
    specs: ContrastPairSpec[];
    pairs: ContrastPairResult[];
  };
  /** Null when the scan was skipped (options.components false). */
  components: {
    dir: string;
    /** Barrel file the families come from, when it exists. */
    index: string | undefined;
    families: { name: string; members: string[] }[];
    list: ScannedComponent[];
  } | null;
  specs: {
    path: string;
    /** Parsed component-specs.json, null when missing or of another version. */
    file: ComponentSpecsFile | null;
    /** Figma coverage entries, read even from an older file. */
    coverage: SpecCoverage[];
  };
}

export interface RepoModelOptions {
  /** Scan components (3-4 files per component). Default true. */
  components?: boolean;
  /** Docs link of a token's CSS variable (the caller's routing). Default: none. */
  href?: (cssVar: string, type: string, tier: TokenRowTier) => string | undefined;
  /** Requests in flight. Default 8. */
  concurrency?: number;
}

const emptyRows = (config: BridgeConfig): TokenRows => ({ ...tokenRowAxes(config), primitives: [], semantic: [], brand: [], density: [], component: [], all: [], sources: [] });

/** Reads a repo through `source` and computes its model. Never throws on repo content: see `problems`. */
export async function loadRepoModel(source: RepoSource, options: RepoModelOptions = {}): Promise<RepoModel> {
  const concurrency = options.concurrency ?? 8;
  const problems: string[] = [];
  // A file the source refuses as too large (status 413) is a problem of the repo, not a failure of the read.
  // Anything else (rate limit, network) still throws, so the caller can retry.
  const tooLarge = (path: string, err: unknown): null => {
    if ((err as { status?: unknown } | null)?.status !== 413) throw err;
    problems.push(`${path}: ${(err as Error).message}`);
    return null;
  };
  const configText = await source.text(CONFIG_FILE);
  const parsed = parseModelConfig(configText);
  const { config } = parsed;
  problems.push(...parsed.problems);
  const fallbackRepo = source.ref.owner && source.ref.repo ? { owner: source.ref.owner, repo: source.ref.repo, defaultBranch: REPO_MODEL_DEFAULTS.repo.defaultBranch } : REPO_MODEL_DEFAULTS.repo;
  const site = siteRepoFromConfig(config, parsed.raw, fallbackRepo);

  // Token files, the contrast checks and the usage notes.
  const root = config.tokens.root;
  const underRoot = await source.list(root === '.' ? '' : root);
  const tokenRel = selectTokenFiles(config, underRoot);
  const contrastPath = config.contrast?.path;
  const usagePath = tokensPath(config, config.tokens.usage ?? REPO_MODEL_DEFAULTS.tokensUsage);
  const tokenPaths = tokenRel.map((f) => tokensPath(config, f));
  const bodies = await readRepoTexts(source, [...tokenPaths, ...(contrastPath ? [contrastPath] : []), usagePath], concurrency, tooLarge);
  const read = (p: string) => bodies.get(p) ?? undefined;
  const files: Record<string, string> = {};
  tokenRel.forEach((rel, i) => {
    const body = read(tokenPaths[i]!);
    if (body !== undefined) files[rel] = body;
  });
  const listFiles = (dir: string) => underRoot.filter((p) => parentDir(p) === dir);

  let rows: TokenRows;
  try {
    rows = buildTokenRows(config, read, listFiles);
  } catch (err) {
    problems.push((err as Error).message);
    rows = emptyRows(config);
  }

  let usage: Record<string, string> | null = null;
  const usageText = read(usagePath);
  if (usageText !== undefined) {
    try {
      usage = JSON.parse(usageText) as Record<string, string>;
    } catch (err) {
      problems.push(`${usagePath}: ${(err as Error).message}`);
    }
  }

  let specs: ContrastPairSpec[] = [];
  let pairs: ContrastPairResult[] = [];
  try {
    specs = parseContrastSpecs(contrastPath ? read(contrastPath) : undefined);
    pairs = evaluateContrastPairs(specs, rows);
  } catch (err) {
    problems.push((err as Error).message);
  }

  // Components and the Figma coverage.
  const index = tokenRowIndex(rows);
  const describeVar = (cssVar: string) => {
    const hit = index.get(cssVar);
    return hit ? { path: hit.path, kind: hit.kind, href: options.href?.(cssVar, hit.type, hit.kind) } : undefined;
  };
  const comps = config.components ?? { dir: REPO_MODEL_DEFAULTS.componentsDir, docsSuffix: '.docs.json', styleSuffix: '.module.css' };
  const specsPath = comps.specs ?? REPO_MODEL_DEFAULTS.componentSpecs;
  let components: RepoModel['components'] = null;
  const extra: string[] = [specsPath];
  let compFiles: string[] = [];
  const indexPath = comps.index ?? (parentDir(comps.dir) ? `${parentDir(comps.dir)}/index.ts` : 'index.ts');
  if (options.components !== false) {
    compFiles = await source.list(comps.dir);
    const wanted = compFiles.filter((f) => {
      const parts = f.slice(comps.dir.length + 1).split('/');
      if (parts.length !== 2) return false;
      const [n, file] = parts as [string, string];
      return [`${n}.tsx`, `${n}${comps.styleSuffix}`, `${n}.stories.tsx`, `${n}${comps.docsSuffix}`].includes(file);
    });
    extra.push(...wanted, indexPath);
  }
  const more = await readRepoTexts(source, extra, concurrency, tooLarge);
  const readMore = (p: string) => more.get(p) ?? undefined;
  if (options.components !== false) {
    const indexText = readMore(indexPath);
    const indexDir = parentDir(indexPath);
    const indexRel = indexDir && comps.dir.startsWith(`${indexDir}/`) ? comps.dir.slice(indexDir.length + 1) : comps.dir;
    const list = scanComponents({ dir: comps.dir, files: compFiles, readText: readMore, indexText, indexRel, docsSuffix: comps.docsSuffix, styleSuffix: comps.styleSuffix, describeVar, problems });
    components = { dir: comps.dir, index: indexText === undefined ? undefined : indexPath, families: indexText === undefined ? [] : parseComponentFamilies(indexText, indexRel), list };
  }

  const specsText = readMore(specsPath);
  let specsFile: ComponentSpecsFile | null = null;
  let coverage: SpecCoverage[] = [];
  if (specsText !== undefined) {
    try {
      specsFile = parseComponentSpecs(specsText);
    } catch {
      /* another version: coverage below may still read */
    }
    try {
      coverage = (JSON.parse(specsText) as { coverage?: SpecCoverage[] }).coverage ?? [];
    } catch (err) {
      problems.push(`${specsPath}: ${(err as Error).message}`);
    }
  }

  return {
    ref: source.ref,
    configText,
    config,
    site,
    problems,
    tokens: { root, files, rows, usage },
    contrast: { path: contrastPath, specs, pairs },
    components,
    specs: { path: specsPath, file: specsFile, coverage },
  };
}
