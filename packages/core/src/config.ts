// bridge.config.json: where a design system repo keeps its tokens, which modes it has, and how Bridge may
// propose changes to it. One file, one schema (packages/core/bridge.config.schema.json), read by
// @bridge-ds/core, the DS Bridge Figma plugin, the docs site, the CLI and the MCP server.
//
// The canonical form names tiers, ordered layers and modes:
//
//   tokens.root      directory holding every token file (repo-relative)
//   tokens.include   token file globs, relative to root (default **/*.tokens.json)
//   tokens.tiers     tier -> directories or files, relative to root
//   tokens.layers    resolution order, lowest first; {mode} placeholders pick the file per mode value
//   modes            mode name -> { values, default, parity }
//   contrast.path    contrast pairs: { "pairs": [[fg, bg, min], ...] } (repo-relative)
//
// The older flat form (tokens.primitives/brands/semantic/base/density/components/contrastChecks and
// modes.brands/themes/densities/defaults) is still read, so commits from before the merge load too.
// loadConfig normalizes both into one BridgeConfig.

import type { IntegrationsConfig } from './requests';
import { PREVIEW_APP_LABELS, type PreviewApps, type PreviewsConfig } from './previews';
import { normalizeRights, rightsProblems, visualImpactProblems, type Rights, type VisualImpactConfig } from './rights';

/** File name Bridge looks for at the repository root. */
export const CONFIG_FILE = 'bridge.config.json';

export interface RepoRef {
  owner: string;
  name: string;
  /** Branch pull requests target and pulls read from. Bridge never writes to it. */
  defaultBranch: string;
}

/** Tier folders, relative to `root`. Derived from `tiers` when the canonical form is used. */
export interface TokenPaths {
  root: string;
  primitives: string;
  brands: string;
  semantic: string;
  /** Stem of the theme-independent semantic file inside `semantic` ("base" -> semantic/base.tokens.json). */
  base: string;
  density: string;
  components: string;
  /** Contrast checks file, relative to `root` (see `contrast.path` for the repo-relative path). */
  contrastChecks: string;
}

export interface TokenLayer {
  /** Glob relative to tokens.root. `{mode}` placeholders pick the file for a mode value; `*` and `**` match many. */
  files: string;
  /** A missing file is fine (brand overrides only some brands have). */
  optional: boolean;
}

export interface TokenConfig extends TokenPaths {
  include: string[];
  exclude: string[];
  /** Tier name -> directories or files relative to root. First match wins. */
  tiers: Record<string, string[]>;
  layers: TokenLayer[];
}

export interface ModeAxis {
  values: string[];
  default: string;
  /** Every token defined for one value must exist for the others (light and dark). */
  parity: boolean;
}

/** Brand, theme and density lists (default first), as the tier model and the Figma plugin use them. */
export interface ModeConfig {
  brands: string[];
  themes: string[];
  densities: string[];
  defaults: { brand?: string | undefined; theme?: string | undefined; density?: string | undefined };
}

export interface ComponentsConfig {
  /** Code components directory, repo-relative. */
  dir: string;
  docsSuffix: string;
  styleSuffix: string;
  /** Component whose docs.json keys new components copy. */
  reference?: string | undefined;
  /** Barrel file new components are exported from. */
  index?: string | undefined;
  /** Generated component specs the Figma plugin pulls (default packages/react/component-specs.json). */
  specs?: string | undefined;
}

export interface Owners {
  design: string[];
  tech: string[];
}

/** Who may merge past missing approvals, from Bridge, with a written reason. Absent: nobody. */
export interface OverridePolicy {
  /** GitHub logins allowed to merge as owner override. */
  allowed: string[];
  /** Ask for a written reason, posted on the pull request before the merge. Default true. */
  requireReason: boolean;
  /** Shortest accepted reason, in characters. Default 20. */
  minReasonLength: number;
}

export const DEFAULT_OVERRIDE: OverridePolicy = { allowed: [], requireReason: true, minReasonLength: 20 };

export interface GovernanceConfig {
  /** Branches no Bridge surface writes to (the default branch is always added). */
  protectedBranches: string[];
  /** Prefix of branches Bridge creates for proposals made by agents (MCP, CLI). */
  branchPrefix: string;
  /** Labels added to pull requests Bridge opens from an agent. */
  labels: string[];
  /** Files whose change is Tier 3 on its own, repo-relative; a trailing "/" matches a directory. */
  guardrails: string[];
  /** GitHub logins that count as design and tech owners. Empty: two distinct approvers stand in. */
  owners: Owners;
  /** Owner override for missing approvals only (never CI, changes requested or drafts). Absent: no override. */
  override?: OverridePolicy | undefined;
  /**
   * Which owner group may approve design, approve tech and ship (see rights.ts). Absent: approvals follow `owners`
   * and anyone with write access may ship, as before the field existed.
   */
  rights?: Rights | undefined;
}

/** `bridge audit` settings: how product code that consumes the design system is measured. */
export interface AuditConfig {
  /** Packages the DS components are imported from. Default: the package that holds components.dir, plus @bridge-ds/react. */
  packages?: string[] | undefined;
  /** Extra import prefixes counted as foreign UI libraries (MUI, antd, Chakra, Radix... are built in). */
  foreignLibraries?: string[] | undefined;
  /** Native elements that should be DS components. Default: button, input, select, textarea, dialog, table, a (with href), img. */
  nativeElements?: string[] | undefined;
  /** Path globs (relative to the audited folder) to skip. */
  exclude?: string[] | undefined;
}

export interface BridgeConfig {
  /** GitHub repository. Undefined only for a detected config of a repo with no known remote. */
  repo: RepoRef | undefined;
  tokens: TokenConfig;
  /** Named modes, in the order layers and contrast checks iterate them. */
  axes: Record<string, ModeAxis>;
  /** Brand, theme and density view of `axes`. */
  modes: ModeConfig;
  contrast: { path: string; modes?: string[] | undefined } | undefined;
  components?: ComponentsConfig | undefined;
  docs: { designLanguage?: string | undefined; guidelines?: string | undefined; governance?: string | undefined };
  /** Package a token changeset bumps and where changesets go; no changeset is written without it. */
  changesets: { dir: string; package: string } | undefined;
  /** Same package, under the older name. */
  changeset?: { package: string } | undefined;
  cssVar: { prefix: string; separator: string };
  governance: GovernanceConfig;
  audit?: AuditConfig | undefined;
  /** Branch previews: snapshot packages, per-branch deploy URL templates and production URLs (see previews.ts). */
  previews?: PreviewsConfig | undefined;
  /** Where component change requests go besides the GitHub issue (see requests.ts). */
  integrations?: IntegrationsConfig | undefined;
  /** Visual before and after on pull requests: automatic (default) or on demand (label `visual-check`). */
  visualImpact?: VisualImpactConfig | undefined;
}

type Partialish<T> = { [K in keyof T]?: T[K] | undefined };

/** What a config file may contain (canonical or flat form). Everything is optional. */
export interface BridgeConfigInput {
  $schema?: string;
  version?: number;
  repo?: (Partial<RepoRef> & { owner: string; name: string }) | string;
  /** Flat form: base branch. */
  branch?: string;
  tokens?: Partialish<TokenPaths> & {
    include?: string[];
    exclude?: string[];
    tiers?: Record<string, string | string[]>;
    layers?: (string | { files: string; optional?: boolean })[];
  };
  modes?:
    | (Partial<Omit<ModeConfig, 'defaults'>> & { defaults?: ModeConfig['defaults'] })
    | Record<string, { values: string[]; default?: string; parity?: boolean }>;
  contrast?: { path: string; modes?: string[] };
  components?: Partial<ComponentsConfig> & { dir: string };
  docs?: BridgeConfig['docs'];
  changesets?: { dir?: string; package: string };
  changeset?: { package: string };
  cssVar?: Partial<BridgeConfig['cssVar']>;
  governance?: Partial<Omit<GovernanceConfig, 'owners' | 'override' | 'rights'>> & { owners?: Partial<Owners>; override?: Partial<OverridePolicy>; rights?: Partial<Rights> };
  audit?: AuditConfig;
  previews?: { packages?: string[]; apps?: PreviewApps; production?: PreviewApps };
  integrations?: IntegrationsConfig;
  visualImpact?: Partial<VisualImpactConfig>;
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

export const DEFAULT_GOVERNANCE: GovernanceConfig = {
  protectedBranches: ['main', 'master'],
  branchPrefix: 'bridge/',
  labels: ['source: mcp'],
  guardrails: ['AGENTS.md', 'CLAUDE.md', 'docs/GOVERNANCE.md', '.stylelintrc.json', '.github/', CONFIG_FILE],
  owners: { design: [], tech: [] },
};

const FLAT_TOKEN_KEYS = ['primitives', 'brands', 'semantic', 'base', 'density', 'components', 'contrastChecks'] as const;
const CANONICAL_TOKEN_KEYS = ['root', 'include', 'exclude', 'tiers', 'layers'];
const FLAT_MODE_KEYS = ['brands', 'themes', 'densities', 'defaults'];
const AXIS_OF: Record<string, 'brand' | 'theme' | 'density'> = { brands: 'brand', themes: 'theme', densities: 'density' };

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`${CONFIG_FILE} is invalid: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

const trimSlashes = (p: string) => p.trim().replace(/^\.?\/+|\/+$/g, '');
const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const isFlatModes = (m: NonNullable<BridgeConfigInput['modes']>): m is Partial<ModeConfig> =>
  Object.keys(m).some((k) => FLAT_MODE_KEYS.includes(k)) || Object.keys(m).length === 0;

function parseRepoInput(repo: BridgeConfigInput['repo'], branch: string | undefined): RepoRef | undefined {
  if (!repo) return undefined;
  if (typeof repo === 'string') {
    const [owner, name] = repo.split('/');
    return { owner: owner!, name: name!, defaultBranch: branch ?? 'main' };
  }
  return { owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch ?? branch ?? 'main' };
}

/** Layers of the conventional layout, for flat configs that do not list them. */
function conventionalLayers(p: TokenPaths): TokenLayer[] {
  return [
    { files: `${p.primitives}/*.tokens.json`, optional: false },
    { files: `${p.semantic}/${p.base}.tokens.json`, optional: true },
    { files: `${p.brands}/{brand}.tokens.json`, optional: false },
    { files: `${p.semantic}/{theme}.tokens.json`, optional: false },
    { files: `${p.brands}/{brand}.{theme}.tokens.json`, optional: true },
    { files: `${p.density}/{density}.tokens.json`, optional: false },
    { files: `${p.components}/*.tokens.json`, optional: false },
  ];
}

/** Fill defaults and normalize either form. Typed helper for configs written in code. */
export function defineConfig(input: BridgeConfigInput): BridgeConfig {
  const t = input.tokens ?? {};
  const root = trimSlashes(t.root ?? DEFAULT_TOKEN_PATHS.root) || '.';
  const tiersIn = t.tiers ? Object.fromEntries(Object.entries(t.tiers).map(([k, v]) => [k, list(v).map(trimSlashes)])) : undefined;
  const firstDir = (tier: string) => tiersIn?.[tier]?.find((d) => !d.endsWith('.json'));
  const baseFile = tiersIn?.base?.find((d) => d.endsWith('.json'));
  const contrastPath = input.contrast?.path ? trimSlashes(input.contrast.path) : undefined;
  const underRoot = (p: string) => (root === '.' ? p : p.startsWith(`${root}/`) ? p.slice(root.length + 1) : undefined);
  const paths: TokenPaths = {
    root,
    primitives: trimSlashes(t.primitives ?? firstDir('primitive') ?? DEFAULT_TOKEN_PATHS.primitives),
    brands: trimSlashes(t.brands ?? firstDir('brand') ?? DEFAULT_TOKEN_PATHS.brands),
    semantic: trimSlashes(t.semantic ?? firstDir('semantic') ?? DEFAULT_TOKEN_PATHS.semantic),
    base: trimSlashes(t.base ?? (baseFile ? baseFile.split('/').pop()!.replace(/(\.tokens)?\.json$/, '') : DEFAULT_TOKEN_PATHS.base)),
    density: trimSlashes(t.density ?? firstDir('density') ?? DEFAULT_TOKEN_PATHS.density),
    components: trimSlashes(t.components ?? firstDir('component') ?? DEFAULT_TOKEN_PATHS.components),
    contrastChecks: trimSlashes(t.contrastChecks ?? (contrastPath ? (underRoot(contrastPath) ?? contrastPath) : DEFAULT_TOKEN_PATHS.contrastChecks)),
  };
  const tiers = tiersIn ?? {
    primitive: [paths.primitives],
    brand: [paths.brands],
    base: [`${paths.semantic}/${paths.base}.tokens.json`],
    semantic: [paths.semantic],
    density: [paths.density],
    component: [paths.components],
  };
  const layers = t.layers?.length
    ? t.layers.map((l) => (typeof l === 'string' ? { files: l, optional: false } : { files: l.files, optional: l.optional ?? false }))
    : conventionalLayers(paths);

  // Modes: named axes (canonical) or brand/theme/density lists (flat).
  const axes: Record<string, ModeAxis> = {};
  const m = input.modes ?? {};
  if (isFlatModes(m)) {
    for (const key of ['brands', 'themes', 'densities'] as const) {
      const values = m[key] ?? [];
      if (!values.length) continue;
      const axis = AXIS_OF[key]!;
      const def = m.defaults?.[axis] ?? values[0]!;
      axes[axis] = { values, default: def, parity: axis === 'theme' };
    }
  } else {
    for (const [name, a] of Object.entries(m)) axes[name] = { values: a.values, default: a.default ?? a.values[0]!, parity: a.parity ?? false };
  }
  const ordered = (axis: string) => {
    const a = axes[axis];
    return a ? [a.default, ...a.values.filter((v) => v !== a.default)] : [];
  };
  const modes: ModeConfig = {
    brands: ordered('brand'),
    themes: ordered('theme'),
    densities: ordered('density'),
    defaults: { brand: axes.brand?.default, theme: axes.theme?.default, density: axes.density?.default },
  };

  const pkg = input.changesets?.package ?? input.changeset?.package;
  const g = input.governance ?? {};
  const contrastFile = contrastPath ?? [root === '.' ? '' : root, paths.contrastChecks].filter(Boolean).join('/');
  return {
    repo: parseRepoInput(input.repo, input.branch),
    tokens: { ...paths, include: input.tokens?.include ?? ['**/*.tokens.json'], exclude: input.tokens?.exclude ?? [], tiers, layers },
    axes,
    modes,
    contrast: { path: contrastFile, modes: input.contrast?.modes },
    components: input.components
      ? {
          dir: trimSlashes(input.components.dir),
          docsSuffix: input.components.docsSuffix ?? '.docs.json',
          styleSuffix: input.components.styleSuffix ?? '.module.css',
          reference: input.components.reference,
          index: input.components.index,
          specs: input.components.specs,
        }
      : undefined,
    docs: { ...input.docs },
    changesets: pkg ? { dir: trimSlashes(input.changesets?.dir ?? '.changeset'), package: pkg } : undefined,
    changeset: pkg ? { package: pkg } : undefined,
    cssVar: { prefix: input.cssVar?.prefix ?? '--', separator: input.cssVar?.separator ?? '-' },
    governance: {
      protectedBranches: g.protectedBranches ?? DEFAULT_GOVERNANCE.protectedBranches,
      branchPrefix: g.branchPrefix ?? DEFAULT_GOVERNANCE.branchPrefix,
      labels: g.labels ?? DEFAULT_GOVERNANCE.labels,
      guardrails: g.guardrails ?? [...DEFAULT_GOVERNANCE.guardrails, contrastFile],
      owners: { design: g.owners?.design ?? [], tech: g.owners?.tech ?? [] },
      ...(g.override
        ? {
            override: {
              allowed: g.override.allowed ?? DEFAULT_OVERRIDE.allowed,
              requireReason: g.override.requireReason ?? DEFAULT_OVERRIDE.requireReason,
              minReasonLength: g.override.minReasonLength ?? DEFAULT_OVERRIDE.minReasonLength,
            },
          }
        : {}),
      ...(g.rights ? { rights: normalizeRights(g.rights) } : {}),
    },
    ...(input.audit ? { audit: { ...input.audit } } : {}),
    ...(input.visualImpact ? { visualImpact: { mode: input.visualImpact.mode === 'on-demand' ? 'on-demand' : 'auto' } } : {}),
    ...(input.integrations ? { integrations: { ...input.integrations } } : {}),
    ...(input.previews
      ? {
          previews: {
            packages: input.previews.packages ?? [],
            apps: { ...input.previews.apps },
            ...(input.previews.production ? { production: { ...input.previews.production } } : {}),
          },
        }
      : {}),
  };
}

const isStr = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

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
  if (!isObj(data)) throw new ConfigError(['top level must be an object']);
  const problems: string[] = [];
  const d = data;

  const repo = d.repo;
  if (typeof repo === 'string') {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) problems.push('"repo" must be "owner/name" or { "owner", "name" }');
  } else if (repo !== undefined) {
    if (!isObj(repo)) problems.push('"repo" must be "owner/name" or { "owner", "name" }');
    else {
      if (!isStr(repo.owner)) problems.push('"repo.owner" must be a non-empty string');
      if (!isStr(repo.name)) problems.push('"repo.name" must be a non-empty string');
      if (repo.defaultBranch !== undefined && !isStr(repo.defaultBranch)) problems.push('"repo.defaultBranch" must be a non-empty string');
    }
  }
  if (d.branch !== undefined && !isStr(d.branch)) problems.push('"branch" must be a non-empty string');

  const tokens = d.tokens;
  if (tokens !== undefined) {
    if (!isObj(tokens)) problems.push('"tokens" must be an object');
    else
      for (const [k, v] of Object.entries(tokens)) {
        if ((FLAT_TOKEN_KEYS as readonly string[]).includes(k) || k === 'root') {
          if (!isStr(v)) problems.push(`"tokens.${k}" must be a non-empty string`);
        } else if (k === 'include' || k === 'exclude') {
          if (!isStrList(v)) problems.push(`"tokens.${k}" must be a list of globs`);
        } else if (k === 'tiers') {
          if (!isObj(v) || !Object.values(v).every((x) => isStr(x) || isStrList(x))) problems.push('"tokens.tiers" must map tier names to directories');
        } else if (k === 'layers') {
          if (!Array.isArray(v) || !v.length || !v.every((l) => isStr(l) || (isObj(l) && isStr(l.files) && (l.optional === undefined || typeof l.optional === 'boolean'))))
            problems.push('"tokens.layers" must be a non-empty list of { "files", "optional"? }');
        } else if (!CANONICAL_TOKEN_KEYS.includes(k)) problems.push(`"tokens.${k}" is not a known key`);
      }
  }

  const modes = d.modes;
  let axisNames: string[] = [];
  if (modes !== undefined) {
    if (!isObj(modes)) problems.push('"modes" must be an object');
    else if (isFlatModes(modes as never)) {
      for (const k of ['brands', 'themes', 'densities']) {
        if (modes[k] !== undefined && !isStrList(modes[k])) problems.push(`"modes.${k}" must be a list of names`);
      }
      const defs = modes.defaults as Record<string, unknown> | undefined;
      const lists: Record<string, string> = { brand: 'brands', theme: 'themes', density: 'densities' };
      for (const [k, l] of Object.entries(lists)) {
        const v = defs?.[k];
        if (v === undefined) continue;
        if (!isStr(v)) problems.push(`"modes.defaults.${k}" must be a string`);
        else if (isStrList(modes[l]) && !(modes[l] as string[]).includes(v)) problems.push(`"modes.defaults.${k}" ("${v}") is not in "modes.${l}"`);
      }
      axisNames = Object.entries(lists).filter(([, l]) => isStrList(modes[l]) && (modes[l] as string[]).length).map(([k]) => k);
    } else {
      for (const [name, a] of Object.entries(modes)) {
        if (!isObj(a) || !isStrList(a.values) || !a.values.length) {
          problems.push(`"modes.${name}.values" must be a non-empty list of names`);
          continue;
        }
        if (a.default !== undefined && (!isStr(a.default) || !a.values.includes(a.default))) problems.push(`"modes.${name}.default" ("${String(a.default)}") is not in "modes.${name}.values"`);
        if (a.parity !== undefined && typeof a.parity !== 'boolean') problems.push(`"modes.${name}.parity" must be true or false`);
        axisNames.push(name);
      }
    }
  }
  if (isObj(tokens) && Array.isArray(tokens.layers)) {
    for (const l of tokens.layers) {
      const files = typeof l === 'string' ? l : isObj(l) ? String(l.files) : '';
      for (const ph of files.match(/\{([^}]+)\}/g) ?? []) {
        if (!axisNames.includes(ph.slice(1, -1))) problems.push(`layer "${files}" uses ${ph} but "modes.${ph.slice(1, -1)}" is not defined`);
      }
    }
  }

  const contrast = d.contrast;
  if (contrast !== undefined && (!isObj(contrast) || !isStr(contrast.path) || (contrast.modes !== undefined && !isStrList(contrast.modes))))
    problems.push('"contrast" must be { "path", "modes"? }');
  const comps = d.components;
  if (comps !== undefined && (!isObj(comps) || !isStr(comps.dir))) problems.push('"components.dir" must be a non-empty string');
  const cs = d.changeset;
  if (cs !== undefined && (!isObj(cs) || !isStr(cs.package))) problems.push('"changeset.package" must be a non-empty string');
  const css = d.changesets;
  if (css !== undefined && (!isObj(css) || !isStr(css.package))) problems.push('"changesets.package" must be a non-empty string');
  const gov = d.governance;
  if (gov !== undefined) {
    if (!isObj(gov)) problems.push('"governance" must be an object');
    else {
      for (const k of ['protectedBranches', 'labels', 'guardrails']) if (gov[k] !== undefined && !(Array.isArray(gov[k]) && (gov[k] as unknown[]).every((x) => typeof x === 'string'))) problems.push(`"governance.${k}" must be a list of strings`);
      if (gov.branchPrefix !== undefined && !isStr(gov.branchPrefix)) problems.push('"governance.branchPrefix" must be a non-empty string');
      const o = gov.owners;
      if (o !== undefined && (!isObj(o) || ['design', 'tech'].some((k) => o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === 'string')))))
        problems.push('"governance.owners" must be { "design": [logins], "tech": [logins] }');
      const ov = gov.override;
      if (ov !== undefined) {
        if (!isObj(ov)) problems.push('"governance.override" must be an object');
        else {
          if (ov.allowed !== undefined && !isStrList(ov.allowed)) problems.push('"governance.override.allowed" must be a list of GitHub logins');
          if (ov.requireReason !== undefined && typeof ov.requireReason !== 'boolean') problems.push('"governance.override.requireReason" must be true or false');
          if (ov.minReasonLength !== undefined && !(Number.isInteger(ov.minReasonLength) && (ov.minReasonLength as number) >= 0)) problems.push('"governance.override.minReasonLength" must be a whole number, 0 or more');
        }
      }
      problems.push(...rightsProblems(gov.rights));
    }
  }
  problems.push(...visualImpactProblems(d.visualImpact));
  const audit = d.audit;
  if (audit !== undefined) {
    if (!isObj(audit)) problems.push('"audit" must be an object');
    else for (const k of ['packages', 'foreignLibraries', 'nativeElements', 'exclude']) if (audit[k] !== undefined && !isStrList(audit[k])) problems.push(`"audit.${k}" must be a list of strings`);
  }
  const pv = d.previews;
  if (pv !== undefined) {
    if (!isObj(pv)) problems.push('"previews" must be an object');
    else {
      if (pv.packages !== undefined && !isStrList(pv.packages)) problems.push('"previews.packages" must be a list of package names');
      for (const field of ['apps', 'production'] as const) {
        const apps = pv[field];
        if (apps === undefined) continue;
        if (!isObj(apps)) {
          problems.push(`"previews.${field}" must be an object`);
          continue;
        }
        for (const [k, v] of Object.entries(apps)) {
          if (!(k in PREVIEW_APP_LABELS)) problems.push(`"previews.${field}.${k}" is not a known app (${Object.keys(PREVIEW_APP_LABELS).join(', ')})`);
          else if (!isStr(v) || !/^https?:\/\//.test(v)) problems.push(`"previews.${field}.${k}" must be an http(s) URL${field === 'apps' ? ' template' : ''}`);
          else if (field === 'production' && /\{\w+\}/.test(v)) problems.push(`"previews.production.${k}" is a fixed URL: placeholders such as {branch} belong in "previews.apps"`);
        }
      }
    }
  }
  if (problems.length) throw new ConfigError(problems);
  return defineConfig(d as unknown as BridgeConfigInput);
}

/** Path of a file under the tokens root, relative to the repository root. */
export const tokensPath = (config: BridgeConfig, rel = '') => [config.tokens.root === '.' ? '' : config.tokens.root, rel].filter(Boolean).join('/');

/** Branches no write may target: the configured protected list plus the default branch. */
export const protectedBranchesOf = (config: BridgeConfig): string[] => [...new Set([...config.governance.protectedBranches, ...(config.repo ? [config.repo.defaultBranch] : [])])];

/** The base branch proposals target. */
export const baseBranchOf = (config: BridgeConfig): string => config.repo?.defaultBranch ?? 'main';

/** Plain-JSON form of a config, in the canonical shape (what `bridge init` writes). */
export function toConfigJson(config: BridgeConfig, schema = './packages/core/bridge.config.schema.json'): Record<string, unknown> {
  return {
    $schema: schema,
    version: 1,
    ...(config.repo ? { repo: config.repo } : {}),
    tokens: { root: config.tokens.root, include: config.tokens.include, ...(config.tokens.exclude.length ? { exclude: config.tokens.exclude } : {}), tiers: config.tokens.tiers, layers: config.tokens.layers.map((l) => (l.optional ? l : { files: l.files })) },
    modes: Object.fromEntries(Object.entries(config.axes).map(([k, a]) => [k, a.parity ? a : { values: a.values, default: a.default }])),
    ...(config.contrast ? { contrast: config.contrast.modes ? config.contrast : { path: config.contrast.path } } : {}),
    ...(config.components ? { components: Object.fromEntries(Object.entries(config.components).filter(([, v]) => v !== undefined)) } : {}),
    docs: Object.fromEntries(Object.entries(config.docs).filter(([, v]) => v !== undefined)),
    ...(config.changesets ? { changesets: config.changesets } : {}),
    cssVar: config.cssVar,
    governance: config.governance,
    ...(config.audit ? { audit: config.audit } : {}),
    ...(config.previews ? { previews: config.previews } : {}),
    ...(config.visualImpact ? { visualImpact: config.visualImpact } : {}),
  };
}
