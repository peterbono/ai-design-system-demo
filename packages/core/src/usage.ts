// Usage index: which CSS custom properties each component module reads, and which other components it renders.
// Pure text scanning (no CSS or TypeScript parser), so it runs in Node, the browser and the Figma sandbox alike.
// Used by visual impact analysis to go from changed tokens and files to the components (and stories) to look at.

export interface UsageFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  text: string;
}

export interface UsageModule {
  /** Component folder name, e.g. "Button". */
  id: string;
  dir: string;
  files: string[];
  /** CSS custom properties read with var(), sorted. Includes locally defined ones. */
  vars: string[];
  /** Other components this one imports from its source (stories and tests excluded), sorted. */
  imports: string[];
  /** Components that only its stories import (e.g. a Button inside an Alert story), sorted. */
  storyImports: string[];
}

export interface UsageIndex {
  componentsDir: string;
  modules: Record<string, UsageModule>;
  /** CSS custom property -> modules that read it. */
  byVar: Record<string, string[]>;
  /** CSS custom properties read by files outside the component folders (global styles, theme). */
  globalVars: Record<string, string[]>;
}

const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** CSS custom properties read with `var(--x)` in a stylesheet or a style string, in order of first use. */
export function cssVarsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) out.add(m[1]!);
  return [...out];
}

/** Module specifiers a TS/JS file imports or re-exports. */
export function importsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(IMPORT_RE)) out.add((m[1] ?? m[2])!);
  return [...out];
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const isStory = (p: string) => /\.stories\.[cm]?[jt]sx?$/.test(p);
const isTest = (p: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const isCss = (p: string) => /\.(css|scss|less)$/.test(p);
const isScript = (p: string) => /\.[cm]?[jt]sx?$/.test(p);

/** Resolves a relative specifier from a file to the component folder it lands in, if any. */
function componentOf(from: string, spec: string, componentsDir: string): string | null {
  if (!spec.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const abs = parts.join('/');
  if (!abs.startsWith(`${componentsDir}/`)) return null;
  return abs.slice(componentsDir.length + 1).split('/')[0] || null;
}

/** The component folder a repo path belongs to, or null when it is outside `componentsDir`. */
export function componentForPath(path: string, componentsDir: string): string | null {
  const dir = norm(componentsDir);
  const p = norm(path);
  if (!p.startsWith(`${dir}/`)) return null;
  const rest = p.slice(dir.length + 1).split('/');
  return rest.length >= 2 ? rest[0]! : null;
}

/**
 * Builds the index from the files of a component library. `componentsDir` holds one folder per component
 * (`<dir>/<Name>/...`); every other file is "global" (styles, theme, story helpers) and only its CSS
 * variables are recorded.
 */
export function buildUsageIndex(files: UsageFile[], componentsDir: string): UsageIndex {
  const dir = norm(componentsDir);
  const modules: Record<string, UsageModule> = {};
  const vars = new Map<string, Set<string>>();
  const imports = new Map<string, Set<string>>();
  const storyImports = new Map<string, Set<string>>();
  const globalVars: Record<string, string[]> = {};
  const get = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!;

  for (const f of files) {
    const path = norm(f.path);
    const id = componentForPath(path, dir);
    if (!id) {
      if (isCss(path)) {
        const v = cssVarsIn(f.text);
        if (v.length) globalVars[path] = v.sort();
      }
      continue;
    }
    const mod = (modules[id] ??= { id, dir: `${dir}/${id}`, files: [], vars: [], imports: [], storyImports: [] });
    mod.files.push(path);
    if (isTest(path)) continue;
    // Inline styles in TSX can read variables too (style={{ color: 'var(--x)' }}).
    for (const v of cssVarsIn(f.text)) get(vars, id).add(v);
    if (!isScript(path)) continue;
    for (const spec of importsIn(f.text)) {
      const dep = componentOf(path, spec, dir);
      if (!dep || dep === id) continue;
      get(isStory(path) ? storyImports : imports, id).add(dep);
    }
  }

  const byVar: Record<string, string[]> = {};
  for (const mod of Object.values(modules)) {
    mod.files.sort();
    mod.vars = [...(vars.get(mod.id) ?? [])].sort();
    mod.imports = [...(imports.get(mod.id) ?? [])].sort();
    mod.storyImports = [...(storyImports.get(mod.id) ?? [])].filter((d) => !mod.imports.includes(d)).sort();
    for (const v of mod.vars) (byVar[v] ??= []).push(mod.id);
  }
  for (const k of Object.keys(byVar)) byVar[k]!.sort();
  return { componentsDir: dir, modules, byVar, globalVars };
}

export interface ImpactedModule {
  id: string;
  /** Why: "uses --color-feedback-danger-solid", "file changed: ...", "renders Button". */
  reasons: string[];
  /** True when reached only through another component it renders. */
  indirect: boolean;
}

export interface ModuleImpact {
  modules: ImpactedModule[];
  /** Global stylesheets that read a changed variable. */
  globalHits: { file: string; vars: string[] }[];
}

/**
 * Components affected by changed CSS variables and changed files, closed over "renders": when Button changes,
 * every component that imports Button changes too.
 */
export function impactedModules(index: UsageIndex, input: { vars?: string[]; files?: string[] }): ModuleImpact {
  const reasons = new Map<string, { reasons: string[]; indirect: boolean }>();
  const add = (id: string, reason: string, indirect: boolean) => {
    const r = reasons.get(id);
    if (r) {
      if (!r.reasons.includes(reason)) r.reasons.push(reason);
      r.indirect &&= indirect;
    } else reasons.set(id, { reasons: [reason], indirect });
  };
  const changedVars = new Set(input.vars ?? []);
  for (const v of changedVars) for (const id of index.byVar[v] ?? []) add(id, `uses ${v}`, false);
  for (const f of input.files ?? []) {
    const id = componentForPath(f, index.componentsDir);
    if (id && index.modules[id]) add(id, `file changed: ${norm(f)}`, false);
  }
  // Reverse "renders" edges, breadth first so the closest reason is listed first.
  const renderedBy = new Map<string, string[]>();
  for (const m of Object.values(index.modules)) for (const d of m.imports) (renderedBy.get(d) ?? renderedBy.set(d, []).get(d)!).push(m.id);
  const queue = [...reasons.keys()];
  while (queue.length) {
    const id = queue.shift()!;
    for (const parent of renderedBy.get(id) ?? []) {
      const known = reasons.has(parent);
      add(parent, `renders ${id}`, true);
      if (!known) queue.push(parent);
    }
  }
  const globalHits = Object.entries(index.globalVars)
    .map(([file, vs]) => ({ file, vars: vs.filter((v) => changedVars.has(v)) }))
    .filter((g) => g.vars.length > 0);
  const modules = [...reasons.entries()].map(([id, r]) => ({ id, reasons: r.reasons, indirect: r.indirect })).sort((a, b) => Number(a.indirect) - Number(b.indirect) || a.id.localeCompare(b.id));
  return { modules, globalHits };
}

// ---------------------------------------------------------------------------------------------------------------
// Token usage: which tokens are in use. One definition for every surface (Overview, Checks, the token explorer).

export interface UsageToken {
  path: string;
  /** CSS custom property the token builds to, e.g. "--color-bg-default". */
  cssVar: string;
  /** Token paths this token resolves through, in any mode (its alias chains). May include the token itself. */
  refs: readonly string[];
}

export interface TokenReads {
  /** CSS custom property -> components that read it (UsageIndex.byVar). */
  byVar?: Record<string, readonly string[]>;
  /** Global stylesheet -> CSS custom properties it reads (UsageIndex.globalVars): base styles, app shell, theme. */
  globalVars?: Record<string, readonly string[]>;
}

export interface TokenUsage {
  /** Paths of every token in use. */
  used: Set<string>;
  /** Paths read directly with var(), by a component or a global stylesheet. */
  direct: Set<string>;
}

/**
 * A token is in use when a component stylesheet or a global stylesheet (base styles, the app shell) reads its
 * variable, or when a token in use aliases it, at any depth and in any mode. Everything else is unused.
 */
export function tokenUsage(tokens: readonly UsageToken[], reads: TokenReads): TokenUsage {
  const readVars = new Set<string>();
  for (const [v, mods] of Object.entries(reads.byVar ?? {})) if (mods.length) readVars.add(v);
  for (const vars of Object.values(reads.globalVars ?? {})) for (const v of vars) readVars.add(v);
  const byPath = new Map(tokens.map((t) => [t.path, t]));
  const direct = new Set(tokens.filter((t) => readVars.has(t.cssVar)).map((t) => t.path));
  const used = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const p = queue.pop()!;
    if (used.has(p)) continue;
    used.add(p);
    for (const r of byPath.get(p)?.refs ?? []) if (!used.has(r) && byPath.has(r)) queue.push(r);
  }
  return { used, direct };
}
