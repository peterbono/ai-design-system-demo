// Mapping between logical DTCG tokens and Figma variables.
//
// Layout in Figma: one collection per tier (COLLECTIONS in shared/messages.ts).
//   "Primitives"  one mode ("Value")                      primitives/*.tokens.json
//   "Brand"       one mode per brand (Bridge, Ocean)      brands/<brand>.tokens.json
//   "Base"        one mode ("Value")                      semantic/base.tokens.json
//   "Semantic"    one mode per theme (Light, Dark)        semantic/<theme>.tokens.json
//   "Density"     one mode per density                    density/<density>.tokens.json
//   "Component"   one mode ("Value")                      components/*.tokens.json
// Multi-mode collections fall back to one collection per mode ("Semantic/Light", "Brand/Ocean")
// when the file cannot add modes (free plans); both layouts read back the same way.
// Brand x theme overrides (brands/<brand>.<theme>.tokens.json) have no Figma equivalent: they stay
// code-only and are never written by a push.
// Variable names use "/" where token paths use ".": color.action.primary.bg <-> color/action/primary/bg.

import {
  COLLECTIONS,
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
import { resolve } from '@bridge-ds/core';
import { effectiveScopes } from '@bridge-ds/core';
import { type TokenSet, contextFor, defaultFile, modeFile, modesOf, pathId } from '@bridge-ds/core';
import { type LogicalToken, type RepoLayout, SINGLE_MODE, TIER_ORDER, type Tier, isMultiMode } from '@bridge-ds/core';
import { aliasTarget, isAlias, parseColor, parseDimension, rgbaToDtcg, toAlias } from '@bridge-ds/core';

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
  if (!isMultiMode(t.tier)) pluginData.file = t.files[SINGLE_MODE];
  const modes = modesOf(set.layout, t.tier);
  const values: Record<string, PlannedValue> = {};
  for (const mode of modes) {
    const v = t.values[mode];
    if (v === undefined) continue;
    if (isAlias(v)) {
      const target = set.byPath.get(aliasTarget(v));
      values[mode] = { kind: 'alias-token', path: aliasTarget(v), tokenId: target?.id, tier: target?.tier };
      if (t.type === 'dimension' || t.type === 'fontFamily') {
        const r = resolve(set.byPath, t.path, contextFor(set, t.tier, mode));
        const d = t.type === 'dimension' && r.value !== undefined ? parseDimension(r.value) : undefined;
        if (d) pluginData.unit = d.unit;
        if (t.type === 'fontFamily' && Array.isArray(r.value)) pluginData.shape = 'array';
      }
      continue;
    }
    const converted = literalToFigma(t.type, v, pluginData);
    if (typeof converted === 'string') return { path: t.path, reason: converted };
    values[mode] = converted;
  }
  if (isMultiMode(t.tier)) {
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

/** Figma collection and modes of every tier the repo has (single-mode tiers always have "value"). */
export function plannedCollections(layout: RepoLayout): PullPlan['collections'] {
  return TIER_ORDER.filter((tier) => !isMultiMode(tier) || modesOf(layout, tier).length > 0).map((tier) => ({
    tier,
    name: COLLECTIONS[tier],
    modes: modesOf(layout, tier),
  }));
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
  // Lower tiers first so alias targets exist before the tokens that point at them.
  variables.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const orphans: PullPlan['orphans'] = [];
  for (const id of input.orphans) {
    for (const variableId of input.variableIds.get(id) ?? []) {
      orphans.push({ variableId, name: input.variableNames.get(variableId) ?? id });
    }
  }
  return {
    plan: { collections: plannedCollections(input.head.layout), variables, orphans, headSha: input.headSha },
    skipped,
  };
}

// ---------------------------------------------------------------------------------------------
// Figma -> Git

export interface FigmaReadResult {
  tokens: LogicalToken[];
  /** token id -> variable ids holding it (one, or one per mode in the split layout). */
  variableIds: Map<string, string[]>;
  variableNames: Map<string, string>;
  /** Variables without a stored id (created in Figma since the last pull). */
  untagged: Set<string>;
  layout: 'single-collection' | 'split-collections' | 'none';
  warnings: string[];
  /** Modes of the Brand collection with no brand file in Git: candidates for a new brand (see flows.ts). */
  extraBrandModes: ExtraBrandMode[];
}

/** A Brand mode Figma has and Git does not, read back as brand-file token values. */
export interface ExtraBrandMode {
  /** Figma mode name, as typed ("Acme"). */
  name: string;
  /** Lowercase mode key ("acme"). */
  modeKey: string;
  /** Token path -> DTCG value in that mode (aliases to synced variables become "{path}"). */
  values: Record<string, unknown>;
}

/** Managed collections of one tier: a single collection, or one collection per mode (split layout). */
export interface TierCollections {
  single?: SnapshotCollection | undefined;
  /** mode key -> "<Collection>/<Mode>" collection. */
  split: Map<string, SnapshotCollection>;
}

export function findManagedCollections(snapshot: FigmaSnapshot): Map<Tier, TierCollections> {
  const local = snapshot.collections.filter((c) => !c.remote);
  const out = new Map<Tier, TierCollections>();
  for (const tier of TIER_ORDER) {
    const name = COLLECTIONS[tier];
    const split = new Map<string, SnapshotCollection>();
    if (isMultiMode(tier)) {
      for (const c of local) if (c.name.startsWith(`${name}/`)) split.set(c.name.slice(name.length + 1).trim().toLowerCase(), c);
    }
    out.set(tier, { single: local.find((c) => c.name === name), split });
  }
  return out;
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

/** File a new single-mode token (primitive, base, component) created in Figma should be written to. */
export function inferFile(path: string, tier: Tier, context: TokenSet | undefined): string {
  if (tier === 'base') return context?.layout.baseFiles[0] ?? defaultFile(tier, path, context?.options.dirs);
  const neighbour = closestToken(path, context, (t) => t.tier === tier);
  return neighbour?.files[SINGLE_MODE] ?? defaultFile(tier, path, context?.options.dirs);
}

/** File a new primitive created in Figma should be written to. */
export const inferPrimitiveFile = (path: string, context: TokenSet | undefined) => inferFile(path, 'primitive', context);

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
    case 'string': {
      // The family Figma shows for a stack the token holds: the stack, unchanged.
      const stack = type === 'fontFamily' ? pd.stacks?.find((x) => stackFamilies(x).includes(familyKey(v.value))) : undefined;
      if (stack !== undefined) return pd.shape === 'array' ? stack.split(',').map((s) => s.trim()).filter(Boolean) : stack;
      if (type === 'fontFamily' && pd.shape === 'array') {
        return v.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return v.value;
    }
    case 'boolean':
      return v.value;
  }
}

const GENERIC = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|cursive|fantasy|ui-[\w-]+)$/i;

/**
 * The family of a CSS stack a Figma variable shows, so text can be bound to it: the first one installed in Figma
 * (`installed`: familyKey -> Figma's name), else the first that is not a generic family, without " Variable".
 */
export function stackFamily(stack: string, installed: ReadonlyMap<string, string>): string {
  const names = stack.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  for (const n of names) {
    const hit = installed.get(familyKey(n));
    if (hit) return hit;
  }
  const first = names.find((n) => !GENERIC.test(n)) ?? names[0] ?? stack;
  return first.replace(/ Variable$/i, '');
}

/** A family name as Figma and CSS both say it: lowercased, without the " Variable" of variable fonts. */
export const familyKey = (family: string) => family.trim().replace(/^["']|["']$/g, '').replace(/ Variable$/i, '').toLowerCase();
const stackFamilies = (stack: string) => stack.split(',').map(familyKey);

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
  const managedIds = new Set<string>();
  for (const m of managed.values()) {
    if (m.single) managedIds.add(m.single.id);
    for (const c of m.split.values()) managedIds.add(c.id);
  }

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

  const contextIds = new Set(context ? [...context.tokens.values()].map((t) => t.id) : []);
  const take = (v: SnapshotVariable, tier: Tier, mode: string, figmaValue: FigmaValue | undefined) => {
    const path = nameToPath(v.name);
    if (!path) return;
    const pd = v.pluginData;
    // A variable kept as an orphan (its token was deleted in code) is not a Figma edit: a Push never adds the token
    // back. To bring it back, add it in code; the next pull clears the orphan mark.
    if (pd.orphan && context && !context.byPath.has(path) && !(pd.id && contextIds.has(pd.id))) return;
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
        files: isMultiMode(tier) ? {} : { [SINGLE_MODE]: pd.file ?? inferFile(path, tier, context) },
      };
      if (tokens.has(t.id)) {
        warnings.push(`"${v.name}" carries the same Bridge id as "${tokens.get(t.id)!.path}"; it is treated as a new token.`);
        t.id = pathId(path);
      }
      tokens.set(t.id, t);
      tokenByPath.set(path, t);
    } else if (t.tier !== tier) {
      warnings.push(`"${v.name}" exists in both ${COLLECTIONS[t.tier]} and ${COLLECTIONS[tier]}; the ${COLLECTIONS[tier]} copy is ignored.`);
      return;
    }
    const ids = variableIds.get(t.id) ?? [];
    if (!ids.includes(v.id)) ids.push(v.id);
    variableIds.set(t.id, ids);
    if (pd.absentModes?.includes(mode) || pd.unlinkedModes?.includes(mode)) return;
    if (figmaValue === undefined) return;
    const value = figmaToDtcg(t.type, figmaValue, pd, aliasPath);
    if (value === undefined) return;
    t.values[mode] = value;
    if (isMultiMode(tier)) {
      const f = modeFile(repoLayout, tier, mode);
      if (f) t.files[mode] = f;
    }
  };

  // Values of Brand modes with no file in Git, converted once every token (and its type) is known.
  const extra = new Map<string, { name: string; items: { v: SnapshotVariable; value: FigmaValue | undefined }[] }>();
  const collectExtra = (modeKey: string, name: string, v: SnapshotVariable, value: FigmaValue | undefined) => {
    const e = extra.get(modeKey) ?? extra.set(modeKey, { name, items: [] }).get(modeKey)!;
    e.items.push({ v, value });
  };

  let sawSingle = false;
  let sawSplit = false;
  for (const tier of TIER_ORDER) {
    const m = managed.get(tier)!;
    const name = COLLECTIONS[tier];
    if (!isMultiMode(tier)) {
      if (!m.single) continue;
      const modeId = m.single.defaultModeId;
      for (const v of snapshot.variables) if (v.collectionId === m.single.id) take(v, tier, SINGLE_MODE, v.valuesByMode[modeId]);
      continue;
    }
    const modes = modesOf(repoLayout, tier);
    if (m.single) {
      sawSingle = true;
      const modeKeyOf = new Map(m.single.modes.map((x) => [x.modeId, x.name.trim().toLowerCase()]));
      // A new Brand mode is a new brand candidate (flows.ts decides); other tiers ignore unknown modes.
      for (const [, key] of modeKeyOf) if (!modes.includes(key) && tier !== 'brand') warnings.push(`Mode "${key}" in the ${name} collection has no file in Git and is ignored.`);
      for (const v of snapshot.variables) {
        if (v.collectionId !== m.single.id) continue;
        for (const x of m.single.modes) {
          const key = modeKeyOf.get(x.modeId)!;
          if (modes.includes(key)) take(v, tier, key, v.valuesByMode[x.modeId]);
          else if (tier === 'brand') collectExtra(key, x.name.trim(), v, v.valuesByMode[x.modeId]);
        }
      }
    } else if (m.split.size) {
      sawSplit = true;
      for (const [mode, c] of m.split) {
        if (!modes.includes(mode)) {
          if (tier === 'brand') {
            const modeName = c.name.slice(name.length + 1).trim();
            for (const v of snapshot.variables) if (v.collectionId === c.id) collectExtra(mode, modeName, v, v.valuesByMode[c.defaultModeId]);
          } else warnings.push(`Collection "${c.name}" has no file in Git and is ignored.`);
          continue;
        }
        for (const v of snapshot.variables) if (v.collectionId === c.id) take(v, tier, mode, v.valuesByMode[c.defaultModeId]);
      }
    }
  }
  const extraBrandModes: ExtraBrandMode[] = [...extra].map(([modeKey, { name, items }]) => {
    const values: Record<string, unknown> = {};
    for (const { v, value } of items) {
      const path = nameToPath(v.name);
      if (!path || value === undefined) continue;
      const type = tokenByPath.get(path)?.type ?? v.pluginData.dtcgType ?? inferType(path, v.resolvedType, context);
      const dtcg = figmaToDtcg(type, value, v.pluginData, aliasPath);
      if (dtcg !== undefined) values[path] = dtcg;
    }
    return { name, modeKey, values };
  });
  const layout: FigmaReadResult['layout'] = sawSplit ? 'split-collections' : sawSingle ? 'single-collection' : 'none';

  const otherCount = snapshot.variables.filter((v) => !managedIds.has(v.collectionId)).length;
  if (otherCount) warnings.push(`${otherCount} variable(s) in other collections are not synced.`);
  return { tokens: [...tokens.values()], variableIds, variableNames, untagged, layout, warnings: [...new Set(warnings)], extraBrandModes };
}
