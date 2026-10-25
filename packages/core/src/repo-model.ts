// The repo model: everything the docs site and Studio read from a design system repo, computed from a RepoSource.
// One function for the build (fsSource over the checkout) and the browser (a GitHub source over any team's repo):
// bridge.config.json parsed once, the token rows, contrast results, the component scan (props, CSS tokens, stories,
// docs.json) and the Figma coverage of component-specs.json. Every path comes from the config; the defaults are
// the paths this repo used before the config named them. Pure: no Node, no DOM.

import { ConfigError, defineConfig, loadConfig, tokensPath, CONFIG_FILE, DEFAULT_CHANGES_MODE, DEFAULT_OVERRIDE, type BridgeConfig, type BridgeConfigInput, type ChangesMode, type DemoConfig } from './config';
import { scanComponents, parseComponentFamilies, type ScannedComponent } from './component-scan';
import { parseComponentSpecs, type ComponentSpecsFile, type SpecCoverage } from './component-spec';
import { evaluateContrastPairs, parseContrastSpecs, type ContrastPairResult, type ContrastPairSpec } from './contrast-model';
import { globToRegExp, selectTokenFiles } from './layered';
import { DEFAULT_PRODUCTS, type ProductConfig } from './products';
import { readRepoTexts, parentDir, type RepoSource, type RepoSourceRef } from './repo-source';
import type { IntegrationsConfig } from './requests';
import type { Rights, VisualImpactMode } from './rights';
import { cssVarsIn } from './usage';
import { buildTokenRows, tokenRowAxes, tokenRowIndex, type TokenRows, type TokenRowTier } from './token-rows';

/** Paths used when bridge.config.json does not name them: where this repo kept them before the config did. */
export const REPO_MODEL_DEFAULTS = {
  tokensRoot: 'packages/tokens/src',
  componentsDir: 'packages/react/src/components',
  componentSpecs: 'packages/react/component-specs.json',
  /** Optional token usage notes (group -> sentence), relative to tokens.root, when tokens.usage is not set. */
  tokensUsage: 'usage.json',
  /** Most global stylesheets read (components.styles): a broad glob never turns into hundreds of reads. */
  maxStylesheets: 50,
  repo: { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main' },
} as const;

/** The repository settings the site and Studio act on (roles, owners, mode), derived from bridge.config.json. */
export interface SiteRepo {
  /** The team's display name from bridge.config.json `name`, when set. */
  name?: string;
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
  /** governance.leadsPublishTier1: leads publish Tier 1 changes without review. Default true. */
  leadsPublishTier1: boolean;
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
  /** A public demo's persona (config "demo"), when set. */
  demo?: DemoConfig;
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
    leadsPublishTier1: g.leadsPublishTier1 !== false,
    visualImpact: { mode: config.visualImpact?.mode === 'on-demand' ? 'on-demand' : 'auto' },
    tokensRoot: config.tokens.root,
    integrations: config.integrations ?? {},
    products: config.products.length ? config.products : DEFAULT_PRODUCTS.map((p) => ({ ...p })),
    changes: config.changes ?? DEFAULT_CHANGES_MODE,
    ...(config.demo ? { demo: { ...config.demo } } : {}),
    ...(config.name ? { name: config.name } : {}),
  };
}

/**
 * The global stylesheet globs of a config: components.styles, else every .css file under the styles/ and theme/
 * folders next to the components folder (packages/react/src/styles, packages/react/src/theme here).
 */
export function styleGlobs(config: BridgeConfig): string[] {
  if (config.components?.styles) return [...config.components.styles];
  const parent = parentDir(config.components?.dir ?? REPO_MODEL_DEFAULTS.componentsDir);
  const at = (dir: string) => (parent ? `${parent}/${dir}/**/*.css` : `${dir}/**/*.css`);
  return [at('styles'), at('theme')];
}

/** The folder to list for a glob: its segments before the first wildcard ('' for the whole repository). */
export function globBase(glob: string): string {
  const segs = glob.split('/');
  const fixed: string[] = [];
  for (const seg of segs.slice(0, -1)) {
    if (/[*?[{]/.test(seg)) break;
    fixed.push(seg);
  }
  return fixed.join('/');
}

/**
 * The global stylesheets of a repository (styleGlobs): one listing per glob folder, files under the components folder
 * left to the component scan, at most REPO_MODEL_DEFAULTS.maxStylesheets (a problem says when more match).
 */
export async function listStylesheets(source: RepoSource, config: BridgeConfig): Promise<{ globs: string[]; paths: string[]; problems: string[] }> {
  const globs = styleGlobs(config);
  const matchers = globs.map(globToRegExp);
  const compDir = config.components?.dir ?? REPO_MODEL_DEFAULTS.componentsDir;
  const bases = [...new Set(globs.map(globBase))].filter((b, _, all) => !all.some((o) => o !== b && (o === '' || b.startsWith(`${o}/`))));
  const listed = (await Promise.all(bases.map((b) => source.list(b)))).flat();
  const paths = [...new Set(listed)].filter((p) => matchers.some((re) => re.test(p)) && !p.startsWith(`${compDir}/`)).sort();
  const max = REPO_MODEL_DEFAULTS.maxStylesheets;
  if (paths.length <= max) return { globs, paths, problems: [] };
  return { globs, paths: paths.slice(0, max), problems: [`components.styles matches ${paths.length} files: Bridge reads the first ${max}. Narrow the globs to the stylesheets the library ships.`] };
}

/**
 * The global stylesheets of a repository with the CSS custom properties each reads: what RepoModel.styles holds.
 * loadRepoModel reads them with everything else; a model computed without them (an older snapshot) can be completed
 * with this alone.
 */
export async function readStylesheets(source: RepoSource, config: BridgeConfig, concurrency = 8): Promise<RepoModel['styles'] & { problems: string[] }> {
  const { globs, paths, problems } = await listStylesheets(source, config);
  const bodies = await readRepoTexts(source, paths, concurrency);
  const vars: Record<string, string[]> = {};
  for (const p of paths) {
    const text = bodies.get(p);
    if (typeof text === 'string') vars[p] = cssVarsIn(text);
  }
  return { globs, vars, problems };
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
  /**
   * Global stylesheets of the library (components.styles): the globs read, and each matching file with the CSS custom
   * properties it reads (`var(--x)`), so a token read only by base styles counts as in use.
   */
  styles: {
    globs: string[];
    vars: Record<string, string[]>;
  };
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
  /** Docs link of a token's CSS variable (the caller's routing), given its type, tier and token path. Default: none. */
  href?: (cssVar: string, type: string, tier: TokenRowTier, path: string) => string | undefined;
  /** Requests in flight. Default 8. */
  concurrency?: number;
  /**
   * Hears how far the read has gone, in real file counts: once with every phase's total before the first body is
   * read, then once per file settled. Phases run in order: tokens (token files, contrast checks, usage notes), then
   * components (code, styles, stories, the index, the global stylesheets and the Figma specs), then docs (each component's docs file).
   */
  onProgress?: (progress: RepoModelProgress) => void;
}

/** The three reads of loadRepoModel, in the order they run. */
export type RepoModelPhase = 'tokens' | 'components' | 'docs';

export interface RepoModelProgress {
  /** The phase being read. */
  phase: RepoModelPhase;
  /** Files of this phase settled so far, and in all (a phase with nothing to read reports 0 of 0). */
  done: number;
  total: number;
  /** Across every phase: the bar of the whole read. `filesTotal` is known from the first report and never moves. */
  filesDone: number;
  filesTotal: number;
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
  const tokenRead = [...new Set([...tokenPaths, ...(contrastPath ? [contrastPath] : []), usagePath])];

  // Every path of the components and docs phases is known from the listing, before any body: the progress total is
  // exact from the first report.
  const comps = config.components ?? { dir: REPO_MODEL_DEFAULTS.componentsDir, docsSuffix: '.docs.json', styleSuffix: '.module.css' };
  const specsPath = comps.specs ?? REPO_MODEL_DEFAULTS.componentSpecs;
  const indexPath = comps.index ?? (parentDir(comps.dir) ? `${parentDir(comps.dir)}/index.ts` : 'index.ts');
  let compFiles: string[] = [];
  const codeRead: string[] = [specsPath];
  const docsRead: string[] = [];
  if (options.components !== false) {
    compFiles = await source.list(comps.dir);
    for (const f of compFiles) {
      const parts = f.slice(comps.dir.length + 1).split('/');
      if (parts.length !== 2) continue;
      const [n, file] = parts as [string, string];
      if (file === `${n}${comps.docsSuffix}`) docsRead.push(f);
      else if ([`${n}.tsx`, `${n}${comps.styleSuffix}`, `${n}.stories.tsx`].includes(file)) codeRead.push(f);
    }
    codeRead.push(indexPath);
  }
  // Global stylesheets (components.styles): their paths are known from listings, before any body.
  const listedStyles = await listStylesheets(source, config);
  problems.push(...listedStyles.problems);
  const stylePaths = listedStyles.paths;
  codeRead.push(...stylePaths);
  // A path is read once, in the first phase that asks for it.
  const seen = new Set<string>();
  const fresh = (paths: string[]) =>
    paths.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
  const phases: [RepoModelPhase, string[]][] = [
    ['tokens', fresh(tokenRead)],
    ['components', fresh(codeRead)],
    ['docs', fresh(docsRead)],
  ];
  const filesTotal = phases.reduce((n, [, paths]) => n + paths.length, 0);
  // Every body is known now: a source that batches reads asks for them in a few requests instead of one each.
  await source.prefetch?.(phases.flatMap(([, paths]) => paths)).catch(() => undefined);
  let before = 0;
  const readPhase = async (phase: RepoModelPhase, paths: string[]) => {
    const offset = before;
    const out = await readRepoTexts(source, paths, concurrency, tooLarge, (done, total) => options.onProgress?.({ phase, done, total, filesDone: offset + done, filesTotal }));
    before += paths.length;
    return out;
  };
  const bodies = await readPhase('tokens', phases[0]![1]);
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
    return hit ? { path: hit.path, kind: hit.kind, href: options.href?.(cssVar, hit.type, hit.kind, hit.path) } : undefined;
  };
  let components: RepoModel['components'] = null;
  const code = await readPhase('components', phases[1]![1]);
  const docs = await readPhase('docs', phases[2]![1]);
  const readMore = (p: string) => code.get(p) ?? docs.get(p) ?? bodies.get(p) ?? undefined;
  if (options.components !== false) {
    const indexText = readMore(indexPath);
    const indexDir = parentDir(indexPath);
    const indexRel = indexDir && comps.dir.startsWith(`${indexDir}/`) ? comps.dir.slice(indexDir.length + 1) : comps.dir;
    const list = scanComponents({ dir: comps.dir, files: compFiles, readText: readMore, indexText, indexRel, docsSuffix: comps.docsSuffix, styleSuffix: comps.styleSuffix, describeVar, problems });
    components = { dir: comps.dir, index: indexText === undefined ? undefined : indexPath, families: indexText === undefined ? [] : parseComponentFamilies(indexText, indexRel), list };
  }

  const styleVars: Record<string, string[]> = {};
  for (const p of stylePaths) {
    const text = readMore(p);
    if (text !== undefined) styleVars[p] = cssVarsIn(text);
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
    styles: { globs: listedStyles.globs, vars: styleVars },
    specs: { path: specsPath, file: specsFile, coverage },
  };
}
