// Explorer data built in the browser from the JSON blocks ExplorerData.astro embeds (token files, config, contrast
// checks, build-time usage). Shared by the token explorer and the token detail drawer of the Library foundation pages,
// so both read the same token set, contrast results and usage.
import { buildTokenSet, contrastScope, evaluatePairs, layoutOptions, loadConfig, parseContrastChecks, tokenUsage, type RepoModel } from '@bridge-ds/core';
import { readsByComponent } from '../../lib/explorer/detail-summary';
import { buildTokens, modesOf, type UsageMap } from '../../lib/explorer/model';
import type { ExplorerData } from './types';

export function readJson<T>(id: string, fallback: T): T {
  const el = document.getElementById(id);
  if (!el?.textContent) return fallback;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return fallback;
  }
}

export function loadExplorerData(): ExplorerData {
  const files = readJson<Record<string, string>>('xp-files', {});
  const config = loadConfig(document.getElementById('xp-config')?.textContent || '{}');
  const head = buildTokenSet(files, layoutOptions(config));
  const pairs = parseContrastChecks(document.getElementById('xp-checks')?.textContent || undefined);
  const usage = readJson<UsageMap>('xp-usage', {});
  const results = evaluatePairs(head.byPath, pairs, contrastScope(head));
  const modes = modesOf(head);
  const tokens = buildTokens(head, usage);
  const reads = readsByComponent(readJson<Record<string, { name: string; paths: string[] }>>('xp-components', {}));
  return { set: head, head, tokens, byPath: new Map(tokens.map((t) => [t.path, t])), usage, pairs, results, before: [], modes, tokensRoot: config.tokens.root, repo: config.repo ?? undefined, reads };
}

// ---------------------------------------------------------------------------------------------------------------
// Team shells (multi-team PR 3b): the same five JSON blocks, built in the browser from the team's repo model
// instead of embedded at build time, so the explorer and the token editor start exactly as on the build repo.

/** The inputs ExplorerData.astro embeds, computed from a repo model. Pure. */
export interface ExplorerInput {
  files: Record<string, string>;
  /** bridge.config.json as the explorer reads it: the team's file, its token root and repository filled in. */
  config: Record<string, unknown>;
  checks: { pairs: { fg: string; bg: string; min: number }[] };
  usage: UsageMap;
  components: Record<string, { name: string; paths: string[] }>;
}

/**
 * bridge.config.json of a team as the explorer, the token editor and history read it: the team's file with its token
 * root (the model's, defaults included) and its repository filled in. Falls back to the token root alone when the
 * file does not pass loadConfig.
 */
export function explorerConfig(model: RepoModel, team: { owner: string; repo: string; defaultBranch: string }): Record<string, unknown> {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(model.configText ?? '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    /* an invalid file: the model's defaults below */
  }
  const tokens = raw.tokens && typeof raw.tokens === 'object' ? (raw.tokens as Record<string, unknown>) : {};
  const config = { ...raw, tokens: { ...tokens, root: model.tokens.root }, repo: { owner: team.owner, name: team.repo, defaultBranch: team.defaultBranch } };
  try {
    loadConfig(config);
    return config;
  } catch {
    return { tokens: { root: model.tokens.root }, repo: config.repo };
  }
}

/** The inputs of the explorer for a team's repo model (links to components go to `componentHref` of their folder). */
export function explorerInputFromModel(model: RepoModel, team: { owner: string; repo: string; defaultBranch: string; componentHref: (dir: string) => string }): ExplorerInput {
  const comps = model.components?.list ?? [];
  const rows = model.tokens.rows;
  const byVar: Record<string, string[]> = {};
  for (const c of comps) for (const t of c.tokensUsed) (byVar[t.name] ??= []).push(c.name);
  // The team's global stylesheets (components.styles) read tokens too: base.css alone keeps color.bg.default in use.
  // A model cached before they were read has none.
  const globalVars = model.styles?.vars ?? {};
  const stylesOf = (cssVar: string) =>
    Object.entries(globalVars)
      .filter(([, vars]) => vars.includes(cssVar))
      .map(([file]) => file.slice(file.lastIndexOf('/') + 1))
      .sort();
  const refs = (t: (typeof rows.all)[number]) =>
    Object.values(t.brands)
      .flatMap((themes) => Object.values(themes).flatMap((m) => m.chain))
      .concat(t.densities ? Object.values(t.densities).flatMap((d) => d.chain) : []);
  const { used } = tokenUsage([...rows.primitives.map((p) => ({ path: p.path, cssVar: p.cssVar, refs: [] })), ...rows.all.map((t) => ({ path: t.path, cssVar: t.cssVar, refs: refs(t) }))], { byVar, globalVars });
  const usersOf = (cssVar: string) => comps.filter((c) => c.tokensUsed.some((t) => t.name === cssVar)).map((c) => ({ name: c.name, href: team.componentHref(c.dir) }));
  const usage: UsageMap = {};
  for (const t of [...rows.primitives, ...rows.all]) usage[t.path] = { used: used.has(t.path), usedBy: usersOf(t.cssVar), styles: stylesOf(t.cssVar) };

  return {
    files: model.tokens.files,
    config: explorerConfig(model, team),
    checks: { pairs: model.contrast.specs.map((s) => ({ fg: s.fg, bg: s.bg, min: s.min })) },
    usage,
    components: Object.fromEntries(comps.map((c) => [c.slug, { name: c.name, paths: c.allTokenPaths }])),
  };
}

/** Writes the five blocks into the page (text nodes only), where loadExplorerData and the token editor read them. */
export function writeExplorerData(input: ExplorerInput, parent: HTMLElement = document.body) {
  const blocks: [string, unknown][] = [
    ['xp-files', input.files],
    ['xp-config', input.config],
    ['xp-checks', input.checks],
    ['xp-usage', input.usage],
    ['xp-components', input.components],
  ];
  for (const [id, value] of blocks) {
    document.getElementById(id)?.remove();
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = id;
    el.textContent = JSON.stringify(value);
    parent.append(el);
  }
}
