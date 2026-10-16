// Impact selection: from what a change touches (token values, component files) to the stories and screens to
// capture. Pure: the inputs come from git, the token sets and the usage index, so it is unit tested.
import { componentForPath, impactedModules, type UsageIndex } from '@bridge/core';
import type { Selection, StoryEntry } from './types.js';

export interface SelectInput {
  /** Files changed between base and head (repo-relative). */
  files: string[];
  /** Token paths whose resolved value changed. */
  tokens: Selection['tokens'];
  cssVar: (path: string) => string;
  usage: UsageIndex;
  stories: StoryEntry[];
  /** Root of the component library source, e.g. packages/react/src. Shared code here affects everything. */
  librarySrc: string;
  /** Files that change every story when edited (Storybook config, token build). Prefixes. */
  globalPaths?: string[];
  /** App source folder whose edits put the app screens in scope. */
  appDir?: string;
  maxStoriesPerComponent?: number;
}

const NO_VISUAL = /(\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|\.docs\.json|\.mdx?|README[^/]*)$/i;
const norm = (p: string) => p.replace(/^\.\//, '').replace(/\\/g, '/');
const isAllStates = (s: StoryEntry) => /--all-states$/.test(s.id) || /^all ?states$/i.test(s.name);

/** Story entries grouped by component folder, or null for stories outside it (foundations). */
export function storyComponent(s: StoryEntry, componentsDir: string): string | null {
  return componentForPath(norm(s.importPath), componentsDir);
}

export function selectImpact(input: SelectInput): Selection {
  const { usage, stories } = input;
  const dir = usage.componentsDir;
  const lib = input.librarySrc.replace(/\/$/, '');
  const cap = input.maxStoriesPerComponent ?? 4;
  const visualFiles = input.files.map(norm).filter((f) => !NO_VISUAL.test(f));
  const vars = [...new Set(input.tokens.map((t) => input.cssVar(t.path)))].sort();
  const impact = impactedModules(usage, { vars, files: visualFiles });

  // Fallback: shared code or global styles changed, so no targeted list can be trusted.
  let fallback: string | null = null;
  const shared = visualFiles.find((f) => f.startsWith(`${lib}/`) && !f.startsWith(`${dir}/`));
  const global = visualFiles.find((f) => (input.globalPaths ?? []).some((g) => f === g || f.startsWith(g.endsWith('/') ? g : `${g}/`)));
  if (shared) fallback = `Shared library code changed (${shared}): every AllStates story is captured.`;
  else if (global) fallback = `${global} changed: every AllStates story is captured.`;
  else if (impact.globalHits.length) {
    const g = impact.globalHits[0]!;
    fallback = `${g.file} reads changed tokens (${g.vars.slice(0, 3).join(', ')}${g.vars.length > 3 ? ', ...' : ''}): every AllStates story is captured.`;
  }

  const hit = new Set(impact.modules.map((m) => m.id));
  const byComponent = new Map<string, StoryEntry[]>();
  const foundations: StoryEntry[] = [];
  for (const s of stories) {
    const c = storyComponent(s, dir);
    if (!c) foundations.push(s);
    else (byComponent.get(c) ?? byComponent.set(c, []).get(c)!).push(s);
  }
  const picked: string[] = [];
  const components = [...impact.modules];
  // A story that renders an impacted component (an Alert story with a Button) changes with it.
  for (const [c, list] of byComponent) {
    if (hit.has(c)) continue;
    const via = (usage.modules[c]?.storyImports ?? []).filter((d) => hit.has(d));
    if (via.length && list.length) components.push({ id: c, reasons: via.map((d) => `story renders ${d}`), indirect: true });
  }
  components.sort((a, b) => Number(a.indirect) - Number(b.indirect) || a.id.localeCompare(b.id));
  const order = (list: StoryEntry[]) => [...list.filter(isAllStates), ...list.filter((s) => !isAllStates(s))];
  // Components reached only through what they render get their AllStates story; direct hits get up to `cap`.
  for (const c of components) picked.push(...order(byComponent.get(c.id) ?? []).slice(0, c.indirect ? 1 : cap).map((s) => s.id));
  if (input.tokens.length) picked.push(...foundations.map((s) => s.id));
  if (fallback) for (const s of stories) if (isAllStates(s)) picked.push(s.id);

  const appDir = input.appDir?.replace(/\/$/, '');
  const appFile = appDir ? visualFiles.find((f) => f.startsWith(`${appDir}/`)) : undefined;
  const app = input.tokens.length
    ? { include: true, reason: `${input.tokens.length} token value${input.tokens.length > 1 ? 's' : ''} changed` }
    : components.length || fallback
      ? { include: true, reason: 'Component code changed' }
      : appFile
        ? { include: true, reason: `App code changed (${appFile})` }
        : { include: false, reason: 'No token, component or app change' };

  return {
    tokens: input.tokens,
    vars,
    files: input.files.map(norm),
    components: components.map((c) => ({ id: c.id, reasons: c.reasons, indirect: c.indirect })),
    stories: [...new Set(picked)],
    fallback,
    app,
  };
}

/** Storybook's id rules (CSF): "Feedback/Alert" + export "AllStates" -> "feedback-alert--all-states". */
export function storyId(title: string, exportName: string): string {
  const sanitize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  const startCase = exportName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return `${sanitize(title)}--${sanitize(startCase)}`;
}

/**
 * Stories read from CSF source without building Storybook (plan mode). Story ids follow Storybook's rules, so
 * they match storybook-static/index.json for the usual `title` + named exports.
 */
export function storiesFromSource(files: { path: string; text: string }[]): StoryEntry[] {
  const out: StoryEntry[] = [];
  for (const f of files) {
    const title = /title:\s*['"]([^'"]+)['"]/.exec(f.text)?.[1];
    if (!title) continue;
    for (const m of f.text.matchAll(/export\s+const\s+([A-Z]\w*)\s*[:=]/g)) {
      const name = m[1]!;
      out.push({ id: storyId(title, name), title, name: name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'), importPath: `./${norm(f.path)}` });
    }
  }
  return out;
}
