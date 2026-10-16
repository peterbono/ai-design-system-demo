// Mapping between logical DTCG tokens and Figma variables.
//
// Layout in Figma:
//   "Primitives"  one mode ("Value"), one variable per primitive token.
//   "Semantic"    one collection with one mode per theme (Light, Dark) when the file allows it,
//                 otherwise "Semantic/Light" and "Semantic/Dark" with identical variable names
//                 (free plans limit collections to one mode). Both layouts read back the same way.
// Variable names use "/" where token paths use ".": color.action.primary.bg <-> color/action/primary/bg.

import {
  COLLECTION_PRIMITIVES,
  COLLECTION_SEMANTIC,
  type FigmaResolvedType,
  type FigmaSnapshot,
  type FigmaValue,
  type PlannedValue,
  type PlannedVariable,
  type PullPlan,
  type SnapshotCollection,
  type SnapshotVariable,
  type VariablePluginData,
} from '../shared/messages';
import { resolve } from './resolver';
import { effectiveScopes } from './scopes';
import { type TokenSet, pathId } from './token-set';
import { type LogicalToken, PRIMITIVE_MODE, type RepoLayout, type Tier } from './types';
import { aliasTarget, isAlias, parseColor, parseDimension, rgbaToDtcg, toAlias } from './values';

export const pathToName = (path: string) => path.split('.').join('/');
export const nameToPath = (name: string) =>
  name
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('.');

export const ORPHAN_PREFIX = '[orphan] ';

const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

// ---------------------------------------------------------------------------------------------
// Git -> Figma

export interface Unmappable {
  path: string;
  reason: string;
}

/** Figma type for a token, or a reason why it stays code-only (shadows, typography composites...). */
export function figmaTypeFor(t: LogicalToken): FigmaResolvedType | Unmappable {
  switch (t.type) {
    case 'color':
      return 'COLOR';
    case 'dimension':
    case 'number':
    case 'fontWeight':
      return 'FLOAT';
    case 'fontFamily':
    case 'string':
      return 'STRING';
    case 'boolean':
      return 'BOOLEAN';
    default:
      return { path: t.path, reason: `type "${t.type}" has no Figma variable equivalent; it stays code-only` };
  }
}

function literalToFigma(type: string, value: unknown, pd: VariablePluginData): PlannedValue | string {
  switch (type) {
    case 'color': {
      const c = parseColor(value);
      return c ? { kind: 'color', ...c } : 'color is not sRGB or is malformed';
    }
    case 'dimension': {
      const d = parseDimension(value);
      if (!d) return 'dimension is malformed';
      if (d.unit !== 'px' && d.unit !== 'rem') return `unit "${d.unit}" is not supported`;
      pd.unit = d.unit;
      return { kind: 'float', value: d.value };
    }
    case 'number':
    case 'fontWeight':
      return typeof value === 'number' ? { kind: 'float', value } : `${type} must be a number to become a Figma variable`;
    case 'fontFamily':
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        pd.shape = 'array';
        return { kind: 'string', value: value.join(', ') };
      }
      return typeof value === 'string' ? { kind: 'string', value } : 'fontFamily is malformed';
    case 'string':
      return typeof value === 'string' ? { kind: 'string', value } : 'string is malformed';
    case 'boolean':
      return typeof value === 'boolean' ? { kind: 'boolean', value } : 'boolean is malformed';
    default:
      return `type "${type}" is not supported`;
  }
}

/** Planned Figma variable for a Git token, or the reason it cannot be represented. */
export function tokenToPlanned(t: LogicalToken, set: TokenSet): Omit<PlannedVariable, 'existingVariableIds'> | Unmappable {
  const resolvedType = figmaTypeFor(t);
  if (typeof resolvedType !== 'string') return resolvedType;
  const pluginData: VariablePluginData = { id: t.id, dtcgType: t.type };
  if (t.tier === 'primitive') pluginData.file = t.files[PRIMITIVE_MODE];
  const modes = t.tier === 'primitive' ? [PRIMITIVE_MODE] : set.layout.themes.map((th) => th.mode);
  const values: Record<string, PlannedValue> = {};
  for (const mode of modes) {
    const v = t.values[mode];
    if (v === undefined) continue;
    if (isAlias(v)) {
      values[mode] = { kind: 'alias-token', path: aliasTarget(v), tokenId: set.byPath.get(aliasTarget(v))?.id };
      if (t.type === 'dimension') {
        const r = resolve(set.byPath, t.path, mode);
        const d = r.value === undefined ? undefined : parseDimension(r.value);
        if (d) pluginData.unit = d.unit;
      }
      if (t.type === 'fontFamily') {
        const r = resolve(set.byPath, t.path, mode);
        if (Array.isArray(r.value)) pluginData.shape = 'array';
      }
      continue;
    }
    const converted = literalToFigma(t.type, v, pluginData);
    if (typeof converted === 'string') return { path: t.path, reason: converted };
    values[mode] = converted;
  }
  if (t.tier === 'semantic') {
    const absent = modes.filter((m) => t.values[m] === undefined);
    if (absent.length) pluginData.absentModes = absent;
  }
  return {
    tokenId: t.id,
    path: t.path,
    name: pathToName(t.path),
    tier: t.tier,
    resolvedType,
    description: t.description ?? '',
    scopes: effectiveScopes(t),
    values,
    pluginData,
  };
}

export const isUnmappable = (x: unknown): x is Unmappable => !!x && typeof x === 'object' && 'reason' in x;

export interface PullPlanInput {
  head: TokenSet;
  headSha: string;
  /** Tokens whose head version should be written to Figma. */
  apply: Iterable<string>;
  /** Tokens removed on main: their variables get flagged as orphans (never deleted). */
  orphans: Iterable<string>;
  /** token id -> existing variable ids, from snapshotToTokens. */
  variableIds: Map<string, string[]>;
  variableNames: Map<string, string>;
}

export function buildPullPlan(input: PullPlanInput): { plan: PullPlan; skipped: Unmappable[] } {
  const variables: PlannedVariable[] = [];
  const skipped: Unmappable[] = [];
  for (const id of input.apply) {
    const t = input.head.tokens.get(id);
    if (!t) continue;
    const planned = tokenToPlanned(t, input.head);
    if (isUnmappable(planned)) {
      skipped.push(planned);
      continue;
    }
    variables.push({ ...planned, existingVariableIds: input.variableIds.get(id) ?? [] });
  }
  // Primitives first so alias targets exist before semantic tokens point at them.
  variables.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'primitive' ? -1 : 1));
  const orphans: PullPlan['orphans'] = [];
  for (const id of input.orphans) {
    for (const variableId of input.variableIds.get(id) ?? []) {
      orphans.push({ variableId, name: input.variableNames.get(variableId) ?? id });
    }
  }
  return {
    plan: { modes: input.head.layout.themes.map((th) => th.mode), variables, orphans, headSha: input.headSha },
    skipped,
  };
}

// ---------------------------------------------------------------------------------------------
// Figma -> Git

export interface FigmaReadResult {
  tokens: LogicalToken[];
  /** token id -> variable ids holding it (one, or one per theme in the split layout). */
  variableIds: Map<string, string[]>;
  variableNames: Map<string, string>;
  /** Variables without a stored id (created in Figma since the last pull). */
  untagged: Set<string>;
  layout: 'single-collection' | 'split-collections' | 'none';
  warnings: string[];
}

interface ManagedCollections {
  primitives?: SnapshotCollection | undefined;
  semantic?: SnapshotCollection | undefined;
  split: Map<string, SnapshotCollection>;
}

export function findManagedCollections(snapshot: FigmaSnapshot): ManagedCollections {
  const local = snapshot.collections.filter((c) => !c.remote);
  const split = new Map<string, SnapshotCollection>();
  for (const c of local) {
    if (c.name.startsWith(`${COLLECTION_SEMANTIC}/`)) split.set(c.name.slice(COLLECTION_SEMANTIC.length + 1).trim().toLowerCase(), c);
  }
  return {
    primitives: local.find((c) => c.name === COLLECTION_PRIMITIVES),
    semantic: local.find((c) => c.name === COLLECTION_SEMANTIC),
    split,
  };
}

/** Guess the DTCG type of a variable created in Figma, from its closest neighbour in Git. */
export function inferType(path: string, resolvedType: FigmaResolvedType, context: TokenSet | undefined): string {
  const family: Record<FigmaResolvedType, string[]> = {
    COLOR: ['color'],
    FLOAT: ['dimension', 'number', 'fontWeight'],
    STRING: ['fontFamily', 'string'],
    BOOLEAN: ['boolean'],
  };
  const neighbour = closestToken(path, context, (t) => family[resolvedType].includes(t.type));
  if (neighbour) return neighbour.type;
  return { COLOR: 'color', FLOAT: 'number', STRING: path.includes('family') ? 'fontFamily' : 'string', BOOLEAN: 'boolean' }[resolvedType];
}

export function closestToken(path: string, context: TokenSet | undefined, filter: (t: LogicalToken) => boolean): LogicalToken | undefined {
  if (!context) return undefined;
  const segs = path.split('.');
  let best: LogicalToken | undefined;
  let bestScore = 0;
  for (const t of context.tokens.values()) {
    if (!filter(t)) continue;
    const ts = t.path.split('.');
    let score = 0;
    while (score < segs.length - 1 && score < ts.length && ts[score] === segs[score]) score++;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** File a new primitive created in Figma should be written to. */
export function inferPrimitiveFile(path: string, context: TokenSet | undefined): string {
  const neighbour = closestToken(path, context, (t) => t.tier === 'primitive');
  return neighbour?.files[PRIMITIVE_MODE] ?? `primitives/${path.split('.')[0]}.tokens.json`;
}

function figmaToDtcg(type: string, v: FigmaValue, pd: VariablePluginData, aliasPath: (id: string, name?: string) => string | undefined): unknown {
  switch (v.kind) {
    case 'alias': {
      const p = aliasPath(v.id, v.name);
      return p ? toAlias(p) : undefined;
    }
    case 'color':
      return rgbaToDtcg(v);
    case 'float':
      if (type === 'dimension') return { value: round(v.value), unit: pd.unit ?? 'px' };
      return round(v.value);
    case 'string':
      if (type === 'fontFamily' && pd.shape === 'array') {
        return v.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return v.value;
    case 'boolean':
      return v.value;
  }
}

/**
 * Read the managed collections of a Figma snapshot back into logical tokens.
 * `context` (main head, or base) is used to infer types and files of variables created in Figma.
 */
export function snapshotToTokens(snapshot: FigmaSnapshot, repoLayout: RepoLayout, context: TokenSet | undefined): FigmaReadResult {
  const warnings: string[] = [];
  const managed = findManagedCollections(snapshot);
  const byId = new Map(snapshot.variables.map((v) => [v.id, v]));
  const tokens = new Map<string, LogicalToken>();
  const tokenByPath = new Map<string, LogicalToken>();
  const variableIds = new Map<string, string[]>();
  const variableNames = new Map(snapshot.variables.map((v) => [v.id, v.name]));
  const untagged = new Set<string>();
  const themeModes = repoLayout.themes.map((t) => t.mode);
  const themeFile = new Map(repoLayout.themes.map((t) => [t.mode, t.file]));
  const managedIds = new Set([managed.primitives?.id, managed.semantic?.id, ...[...managed.split.values()].map((c) => c.id)].filter(Boolean));

  const aliasPath = (id: string, name?: string) => {
    const target = byId.get(id);
    if (target && managedIds.has(target.collectionId)) return nameToPath(target.name);
    if (target || name) {
      warnings.push(`An alias points to "${target?.name ?? name}", which is outside the synced collections; it cannot be exported.`);
      return nameToPath(target?.name ?? name ?? id);
    }
    warnings.push(`An alias points to a variable that no longer exists (${id}).`);
    return undefined;
  };

  const take = (v: SnapshotVariable, tier: Tier, mode: string, figmaValue: FigmaValue | undefined) => {
    const path = nameToPath(v.name);
    if (!path) return;
    const pd = v.pluginData;
    let t = tokenByPath.get(path);
    if (!t) {
      if (!pd.id) untagged.add(v.id);
      const type = pd.dtcgType ?? inferType(path, v.resolvedType, context);
      let description = v.description || undefined;
      if (pd.orphan && description?.startsWith(ORPHAN_PREFIX)) description = description.slice(ORPHAN_PREFIX.length) || undefined;
      t = {
        id: pd.id ?? pathId(path),
        path,
        type,
        tier,
        values: {},
        description,
        scopes: v.scopes,
        files: tier === 'primitive' ? { [PRIMITIVE_MODE]: pd.file ?? inferPrimitiveFile(path, context) } : {},
      };
      if (tokens.has(t.id)) {
        warnings.push(`"${v.name}" carries the same DS Bridge id as "${tokens.get(t.id)!.path}"; it is treated as a new token.`);
        t.id = pathId(path);
      }
      tokens.set(t.id, t);
      tokenByPath.set(path, t);
    } else if (t.tier !== tier) {
      warnings.push(`"${v.name}" exists in both Primitives and Semantic; the Semantic copy is ignored.`);
      return;
    }
    const ids = variableIds.get(t.id) ?? [];
    if (!ids.includes(v.id)) ids.push(v.id);
    variableIds.set(t.id, ids);
    if (pd.absentModes?.includes(mode)) return;
    if (figmaValue === undefined) return;
    const value = figmaToDtcg(t.type, figmaValue, pd, aliasPath);
    if (value === undefined) return;
    t.values[mode] = value;
    if (tier === 'semantic') {
      const f = themeFile.get(mode);
      if (f) t.files[mode] = f;
    }
  };

  if (managed.primitives) {
    const modeId = managed.primitives.defaultModeId;
    for (const v of snapshot.variables) if (v.collectionId === managed.primitives.id) take(v, 'primitive', PRIMITIVE_MODE, v.valuesByMode[modeId]);
  }

  let layout: FigmaReadResult['layout'] = 'none';
  if (managed.semantic) {
    layout = 'single-collection';
    const modeKeyOf = new Map(managed.semantic.modes.map((m) => [m.modeId, m.name.trim().toLowerCase()]));
    for (const [, key] of modeKeyOf) if (!themeModes.includes(key)) warnings.push(`Mode "${key}" in the Semantic collection has no theme file in Git and is ignored.`);
    for (const v of snapshot.variables) {
      if (v.collectionId !== managed.semantic.id) continue;
      for (const m of managed.semantic.modes) {
        const key = modeKeyOf.get(m.modeId)!;
        if (themeModes.includes(key)) take(v, 'semantic', key, v.valuesByMode[m.modeId]);
      }
    }
  } else if (managed.split.size) {
    layout = 'split-collections';
    for (const [mode, c] of managed.split) {
      if (!themeModes.includes(mode)) {
        warnings.push(`Collection "${c.name}" has no theme file in Git and is ignored.`);
        continue;
      }
      for (const v of snapshot.variables) if (v.collectionId === c.id) take(v, 'semantic', mode, v.valuesByMode[c.defaultModeId]);
    }
  }

  const otherCount = snapshot.variables.filter((v) => !managedIds.has(v.collectionId)).length;
  if (otherCount) warnings.push(`${otherCount} variable(s) in other collections are not synced.`);
  return { tokens: [...tokens.values()], variableIds, variableNames, untagged, layout, warnings: [...new Set(warnings)] };
}
