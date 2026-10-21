// Build-time data of the Library foundation pages: one row per token with the same usage the token explorer shows.
// Components come from the explorer's own flow (the token and every token that aliases it, @bridge-ds/core token set),
// "in use" from the shared tokenUsage() definition (lib/stats.ts), so a row never contradicts the detail panel.
import { buildTokenSet, layoutOptions, type TokenSet } from '@bridge-ds/core';
import { explorerTokens, tokenFiles } from './explorer';
import { componentsUsing, transitiveDependents } from './explorer/flow';
import type { ComponentLink, UsageMap } from './explorer/model';
import { aliasSummary, copyValue, COPY_FORMATS, roleOf, usageChip, type CopyFormat, type UsageChip } from './library-rows';
import { repoModel } from './model';
import { globalStyleVars, libraryTokenUsage } from './stats';
import { loadTokens, MODES, type Mode, type Tier } from './tokens';

export interface FoundationRow {
  path: string;
  cssVar: string;
  tier: Tier;
  type: string;
  /** One-line role: $description, else a known or derived role. */
  role: string;
  /** Muted alias line, "neutral 50 · 950". Empty for literal primitives. */
  alias: string;
  /** Resolved CSS value per theme (default brand and density). */
  values: Record<Mode, string>;
  components: ComponentLink[];
  /** Global stylesheets (file names) that read the token or a token aliasing it. */
  base: string[];
  used: boolean;
  chip: UsageChip;
  copy: Record<CopyFormat, string>;
}

let setCache: TokenSet | null = null;
function headSet(): TokenSet {
  if (setCache) return setCache;
  return (setCache = buildTokenSet(tokenFiles(), layoutOptions(repoModel.config)));
}

let usageCache: UsageMap | null = null;
const usageMap = (): UsageMap => (usageCache ??= Object.fromEntries(explorerTokens().map((t) => [t.path, { used: t.used, usedBy: t.usedBy }])));

const cssVarOf = (path: string) => `--${path.replace(/\./g, '-')}`;

export function foundationRow(path: string): FoundationRow {
  const { primitives, all } = loadTokens();
  const sem = all.find((t) => t.path === path);
  const prim = sem ? undefined : primitives.find((t) => t.path === path);
  if (!sem && !prim) throw new Error(`docs-site: foundation row for unknown token "${path}"`);
  const set = headSet();
  const dependents = transitiveDependents(set, path);
  const components = componentsUsing(path, dependents, usageMap());
  const vars = new Set([path, ...dependents].map(cssVarOf));
  const base = Object.entries(globalStyleVars())
    .filter(([, read]) => read.some((v) => vars.has(v)))
    .map(([file]) => file.split('/').pop()!);
  const used = libraryTokenUsage().used.has(path);
  const tier: Tier = sem ? sem.tier : 'primitive';
  const values = Object.fromEntries(MODES.map((m) => [m, sem ? sem.modes[m].css : prim!.css])) as Record<Mode, string>;
  return {
    path,
    cssVar: cssVarOf(path),
    tier,
    type: (sem ?? prim)!.type,
    role: roleOf(path, (sem ?? prim)!.description),
    alias: sem ? aliasSummary(sem.modes.light.alias, sem.modes.dark.alias) : '',
    values,
    components,
    base,
    used,
    chip: usageChip({ components, base, used }),
    copy: Object.fromEntries(COPY_FORMATS.map((f) => [f, copyValue(path, tier, f)])) as Record<CopyFormat, string>,
  };
}

/** Rows of every non-primitive token in a group ("color.bg"), in file order. Semantic and brand tiers by default. */
export function groupRows(group: string, tiers: readonly Tier[] = ['semantic', 'brand']): FoundationRow[] {
  return loadTokens()
    .all.filter((t) => t.group === group || t.path.startsWith(`${group}.`))
    .filter((t) => tiers.includes(t.tier))
    .map((t) => foundationRow(t.path));
}

/** Rows of every primitive under a prefix ("space", "font.size"), in file order. */
export const primitiveRows = (prefix: string): FoundationRow[] =>
  loadTokens()
    .primitives.filter((p) => p.path.startsWith(`${prefix}.`))
    .map((p) => foundationRow(p.path));
