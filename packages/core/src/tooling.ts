// Tooling: the code in the design system repository that is not the design system. A team's DS repository holds only
// the design system, so nothing is tooling there (the default). Bridge's own repository also holds Bridge (Studio, the
// core, the CLI, the MCP server, the toolbar): bridge.config.json `tooling` names those folders, and Studio leaves the
// pull requests that only change them out of Changes and the home counts, the way the release card says "Bridge tool
// updates" apart from the design system. Pure: no Node API, it runs in the browser too.

export interface ToolingConfig {
  /**
   * Repo-relative folders ("apps/docs-site/") or files ("CLAUDE.md") that are tooling; "!docs/DESIGN-LANGUAGE.md"
   * keeps one inside a listed folder as design system.
   */
  paths: string[];
  /**
   * Pull request title scopes that are tooling ("studio" for "fix(studio): ...", "toolbar" for "Toolbar: ..."): the
   * guess until the changed files are read. The files always decide once known.
   */
  scopes?: string[];
}

/** What a config without `tooling` means: nothing is tooling. */
export const NO_TOOLING: ToolingConfig = { paths: [], scopes: [] };

/** Files that come with any change and say nothing about what it changes (a changeset's notes). */
const NEUTRAL = /^\.changeset\//;

const clean = (p: string) => p.trim().replace(/^\.?\/+/, '');

/** Whether `file` is under (or is) the folder or file `entry`. */
function under(file: string, entry: string): boolean {
  const e = clean(entry).replace(/\/+$/, '');
  return Boolean(e) && (file === e || file.startsWith(`${e}/`));
}

/** Whether one changed file is tooling: a listed path holds it, and no "!" entry keeps it as design system. */
export function isToolingFile(file: string, tooling: Pick<ToolingConfig, 'paths'> | null | undefined): boolean {
  const paths = tooling?.paths ?? [];
  const f = clean(file);
  if (paths.some((p) => p.trim().startsWith('!') && under(f, p.trim().slice(1)))) return false;
  return paths.some((p) => !p.trim().startsWith('!') && under(f, p));
}

/**
 * Whether a set of changed files only changes tooling: at least one tooling file, and every other file is a
 * changeset. Empty or not read (null): false, so nothing is hidden on a guess from the files.
 */
export function onlyTooling(files: readonly string[] | null | undefined, tooling: Pick<ToolingConfig, 'paths'> | null | undefined): boolean {
  if (!files?.length || !tooling?.paths?.length) return false;
  const real = files.map(clean).filter((f) => !NEUTRAL.test(f));
  return real.length > 0 && real.every((f) => isToolingFile(f, tooling));
}

const TYPES = new Set(['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'style', 'revert']);

/**
 * The scopes a pull request title names: "fix(studio): x" gives ["studio"], "feat(mcp, docs-site): x" gives both,
 * "Toolbar: x" gives ["toolbar"]. A bare type ("fix: x") names none. Lower case.
 */
export function titleScopes(title: string | null | undefined): string[] {
  const t = (title ?? '').trim();
  const cc = t.match(/^[a-z]+\(([^)]+)\)!?:/i);
  if (cc) return cc[1]!.split(/[,/]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const word = t.match(/^([A-Za-z][\w-]*):\s/);
  if (word && !TYPES.has(word[1]!.toLowerCase())) return [word[1]!.toLowerCase()];
  return [];
}

export interface ToolingPull {
  title?: string | null;
  /** The branch name ("explore/new-card", "bridge/tokens-ocean"). */
  headRef?: string | null;
  /** The changed files when read, null or undefined otherwise. */
  files?: readonly string[] | null;
  /** An exploration (core isExplorationPull): never tooling. */
  exploration?: boolean;
  /** Pull request labels: a "source: ..." label (Bridge opened it for someone: MCP, Studio) is never tooling. */
  labels?: readonly (string | { name?: string | null })[] | null;
}

/** Branches Bridge opens for designers (explorations, and Bridge's default governance prefix): never tooling. */
const DESIGNER_BRANCHES = ['explore/', 'bridge/'];

/**
 * Whether a pull request only changes the tool around the design system, so Studio leaves it out of Changes. Never an
 * exploration, a branch Bridge opened for a designer (explore/, bridge/, the team's governance prefix in
 * `neverPrefixes`) or one labeled "source: ..." by Bridge. The changed files decide once read; before that, the
 * title's scopes, every one of them listed in `tooling.scopes`.
 */
export function isToolingPull(pull: ToolingPull, tooling: ToolingConfig | null | undefined, neverPrefixes: readonly string[] = []): boolean {
  if (!tooling || (!tooling.paths.length && !tooling.scopes?.length)) return false;
  const ref = pull.headRef ?? '';
  if (pull.exploration || [...DESIGNER_BRANCHES, ...neverPrefixes].some((p) => p && ref.startsWith(p))) return false;
  if ((pull.labels ?? []).some((l) => /^source:/i.test((typeof l === 'string' ? l : l?.name) ?? ''))) return false;
  if (pull.files?.length) return onlyTooling(pull.files, tooling);
  const known = new Set((tooling.scopes ?? []).map((s) => s.trim().toLowerCase()));
  const scopes = titleScopes(pull.title);
  return scopes.length > 0 && scopes.every((s) => known.has(s));
}

/** The config's tooling, or NO_TOOLING. */
export const toolingOf = (config: { tooling?: ToolingConfig | null | undefined } | null | undefined): ToolingConfig => config?.tooling ?? NO_TOOLING;

/** What is wrong with a `tooling` value, each problem saying how to fix it. Empty: valid (or absent). */
export function toolingProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['"tooling" must be an object such as { "paths": ["apps/docs-site/"] }'];
  const o = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(o)) if (k !== 'paths' && k !== 'scopes') problems.push(`"tooling.${k}" is not a known key (paths, scopes)`);
  const list = (k: string) => o[k] === undefined || (Array.isArray(o[k]) && (o[k] as unknown[]).every((x) => typeof x === 'string' && x.trim().length > 0));
  if (!Array.isArray(o.paths) || !list('paths')) problems.push('"tooling.paths" must be a list of repository folders or files, such as "apps/docs-site/"');
  else if ((o.paths as string[]).some((p) => p.replace(/^!/, '').trim().startsWith('/') || p.split('/').includes('..'))) problems.push('"tooling.paths" entries are relative to the repository root, without a leading "/" or ".."');
  if (!list('scopes')) problems.push('"tooling.scopes" must be a list of pull request title scopes, such as "studio"');
  return problems;
}
