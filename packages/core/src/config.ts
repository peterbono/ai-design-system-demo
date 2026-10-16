// bridge.config.json: where a design system repo keeps its tokens, and which modes it has.
// Schema: packages/core/bridge.config.schema.json. Nothing in @bridge/core assumes a repo; callers
// pass a config (or let the defaults describe the conventional layout below).
//
//   <tokens.root>/<primitives>/*.tokens.json       primitive tier
//   <tokens.root>/<brands>/<brand>.tokens.json     brand tier (one file per brand)
//   <tokens.root>/<brands>/<brand>.<theme>.tokens.json  brand x theme overrides of semantic tokens
//   <tokens.root>/<semantic>/<theme>.tokens.json   semantic tier (one file per theme)
//   <tokens.root>/<semantic>/<base>.tokens.json    theme-independent semantic tokens
//   <tokens.root>/<density>/<density>.tokens.json  density tier (one file per density)
//   <tokens.root>/<components>/*.tokens.json       component tier
//   <tokens.root>/<contrastChecks>                 contrast pairs: { "pairs": [[fg, bg, min], ...] }

/** File name Bridge looks for at the repository root. */
export const CONFIG_FILE = 'bridge.config.json';

export interface RepoRef {
  owner: string;
  name: string;
  /** Branch pull requests target and pulls read from. */
  defaultBranch: string;
}

/** Token locations. `root` is relative to the repository root; the others are relative to `root`. */
export interface TokenPaths {
  root: string;
  primitives: string;
  brands: string;
  semantic: string;
  /** Stem of the theme-independent semantic file inside `semantic` ("base" -> semantic/base.tokens.json). */
  base: string;
  density: string;
  components: string;
  contrastChecks: string;
}

export interface ModeConfig {
  /** Known modes, default first. Empty means "whatever files exist". */
  brands: string[];
  themes: string[];
  densities: string[];
  defaults: { brand?: string | undefined; theme?: string | undefined; density?: string | undefined };
}

export interface BridgeConfig {
  repo: RepoRef;
  tokens: TokenPaths;
  /** Code components (for tooling that maps tokens to components). Relative to the repository root. */
  components?: { dir: string } | undefined;
  modes: ModeConfig;
  /** Package a changeset bumps for a token change; no changeset is written when absent. */
  changeset?: { package: string } | undefined;
}

/** What a config file may contain: everything but `repo` is optional. */
export interface BridgeConfigInput {
  $schema?: string;
  repo: Partial<RepoRef> & { owner: string; name: string };
  tokens?: Partial<TokenPaths>;
  components?: { dir: string };
  modes?: Partial<Omit<ModeConfig, 'defaults'>> & { defaults?: ModeConfig['defaults'] };
  changeset?: { package: string };
}

export const DEFAULT_TOKEN_PATHS: TokenPaths = {
  root: 'tokens',
  primitives: 'primitives',
  brands: 'brands',
  semantic: 'semantic',
  base: 'base',
  density: 'density',
  components: 'components',
  contrastChecks: 'contrast.checks.json',
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`${CONFIG_FILE} is invalid: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

const trimSlashes = (p: string) => p.trim().replace(/^\.?\/+|\/+$/g, '');

/** Fill defaults. Typed helper for configs written in code. */
export function defineConfig(input: BridgeConfigInput): BridgeConfig {
  const tokens = { ...DEFAULT_TOKEN_PATHS, ...input.tokens };
  for (const k of Object.keys(tokens) as (keyof TokenPaths)[]) tokens[k] = trimSlashes(tokens[k]);
  const brands = input.modes?.brands ?? [];
  const themes = input.modes?.themes ?? [];
  const densities = input.modes?.densities ?? [];
  const defaults = {
    brand: input.modes?.defaults?.brand ?? brands[0],
    theme: input.modes?.defaults?.theme ?? themes[0],
    density: input.modes?.defaults?.density ?? densities[0],
  };
  return {
    repo: { owner: input.repo.owner, name: input.repo.name, defaultBranch: input.repo.defaultBranch ?? 'main' },
    tokens,
    components: input.components ? { dir: trimSlashes(input.components.dir) } : undefined,
    modes: { brands, themes, densities, defaults },
    changeset: input.changeset,
  };
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);

/** Parse and validate bridge.config.json (text or parsed object). Throws ConfigError listing every problem. */
export function loadConfig(source: string | unknown): BridgeConfig {
  let data: unknown = source;
  if (typeof source === 'string') {
    try {
      data = JSON.parse(source);
    } catch (err) {
      throw new ConfigError([`not valid JSON (${(err as Error).message})`]);
    }
  }
  const problems: string[] = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ConfigError(['top level must be an object']);
  const d = data as Record<string, unknown>;
  const repo = d.repo as Record<string, unknown> | undefined;
  if (!repo || typeof repo !== 'object') problems.push('"repo" is required ({ "owner", "name" })');
  else {
    if (!isStr(repo.owner)) problems.push('"repo.owner" must be a non-empty string');
    if (!isStr(repo.name)) problems.push('"repo.name" must be a non-empty string');
    if (repo.defaultBranch !== undefined && !isStr(repo.defaultBranch)) problems.push('"repo.defaultBranch" must be a non-empty string');
  }
  const tokens = d.tokens as Record<string, unknown> | undefined;
  if (tokens !== undefined) {
    if (!tokens || typeof tokens !== 'object') problems.push('"tokens" must be an object');
    else for (const [k, v] of Object.entries(tokens)) {
      if (!(k in DEFAULT_TOKEN_PATHS)) problems.push(`"tokens.${k}" is not a known key`);
      else if (!isStr(v)) problems.push(`"tokens.${k}" must be a non-empty string`);
    }
  }
  const modes = d.modes as Record<string, unknown> | undefined;
  if (modes !== undefined) {
    for (const k of ['brands', 'themes', 'densities']) {
      if (modes[k] !== undefined && !isStrList(modes[k])) problems.push(`"modes.${k}" must be a list of names`);
    }
    const defs = modes.defaults as Record<string, unknown> | undefined;
    const lists: Record<string, string> = { brand: 'brands', theme: 'themes', density: 'densities' };
    for (const [k, list] of Object.entries(lists)) {
      const v = defs?.[k];
      if (v === undefined) continue;
      if (!isStr(v)) problems.push(`"modes.defaults.${k}" must be a string`);
      else if (isStrList(modes[list]) && !(modes[list] as string[]).includes(v)) problems.push(`"modes.defaults.${k}" ("${v}") is not in "modes.${list}"`);
    }
  }
  const comps = d.components as Record<string, unknown> | undefined;
  if (comps !== undefined && !isStr(comps?.dir)) problems.push('"components.dir" must be a non-empty string');
  const cs = d.changeset as Record<string, unknown> | undefined;
  if (cs !== undefined && !isStr(cs?.package)) problems.push('"changeset.package" must be a non-empty string');
  if (problems.length) throw new ConfigError(problems);
  return defineConfig(d as unknown as BridgeConfigInput);
}

/** Path of a file under the tokens root, relative to the repository root. */
export const tokensPath = (config: BridgeConfig, rel = '') => [config.tokens.root, rel].filter(Boolean).join('/');
