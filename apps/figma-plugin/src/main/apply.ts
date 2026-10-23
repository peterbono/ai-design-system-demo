// Apply a pull plan to Figma variables: one collection per tier with its modes (Primitives, Brand,
// Base, Semantic, Density, Component), then literal values (pass 1), then aliases (pass 2, once
// every target exists, across collections), then orphan flags. Nothing is ever deleted.

import type { Tier } from '@bridge-ds/core';
import {
  type ApplyReport,
  PRIMITIVE_MODE_NAME,
  type PlannedCollection,
  type PlannedValue,
  type PlannedVariable,
  type PullPlan,
  modeDisplayName,
  splitCollectionName,
} from '../shared/messages';
import { readPluginData, writePluginData } from './snapshot';
import { breathe } from './turns';
import { familyKey, stackFamily } from '../sync/mapping';

const ORPHAN_PREFIX = '[orphan] ';
const BATCH = 25;
const PRIMITIVE_MODE = 'value';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Slot {
  collection: VariableCollection;
  /** mode key -> Figma mode id */
  modes: Map<string, string>;
}

interface Registry {
  byToken: Map<string, Variable>;
  byName: Map<string, Variable>;
}

function registryKey(collectionId: string, key: string) {
  return `${collectionId}|${key}`;
}

async function ensureCollection(name: string, local: VariableCollection[]): Promise<{ collection: VariableCollection; created: boolean }> {
  const existing = local.find((c) => c.name === name && !c.remote);
  if (existing) return { collection: existing, created: false };
  const collection = figma.variables.createVariableCollection(name);
  local.push(collection);
  return { collection, created: true };
}

function findMode(collection: VariableCollection, modeKey: string): string | undefined {
  return collection.modes.find((m) => m.name.trim().toLowerCase() === modeKey)?.modeId;
}

/**
 * Resolve the Figma layout of a multi-mode tier (Brand, Semantic, Density), creating the collection
 * and its modes as needed. Files that cannot add modes (free plans) get one collection per mode.
 */
async function multiModeSlots(
  name: string,
  modes: string[],
  local: VariableCollection[],
  errors: string[],
): Promise<{ slots: Slot[]; layout: ApplyReport['layout'] }> {
  const single = local.find((c) => c.name === name && !c.remote);
  const hasSplit = local.some((c) => !c.remote && c.name.startsWith(`${name}/`));

  const fillModes = (collection: VariableCollection, fresh: boolean): Map<string, string> => {
    const map = new Map<string, string>();
    modes.forEach((mode, idx) => {
      let id = findMode(collection, mode);
      if (!id && idx === 0 && fresh) {
        collection.renameMode(collection.defaultModeId, modeDisplayName(mode));
        id = collection.defaultModeId;
      }
      if (!id) id = collection.addMode(modeDisplayName(mode)); // throws when the plan limits modes
      map.set(mode, id);
    });
    return map;
  };

  if (single || !hasSplit) {
    const { collection, created } = single ? { collection: single, created: false } : await ensureCollection(name, local);
    try {
      return { slots: [{ collection, modes: fillModes(collection, created) }], layout: 'single-collection' };
    } catch (err) {
      if (!created) {
        errors.push(`Could not add modes to "${name}" (${errorText(err)}). Values for missing modes were not written.`);
        const map = new Map<string, string>();
        for (const mode of modes) {
          const id = findMode(collection, mode);
          if (id) map.set(mode, id);
        }
        return { slots: [{ collection, modes: map }], layout: 'single-collection' };
      }
      // This file cannot have several modes per collection (free plan): use one collection per mode.
      collection.remove();
      local.splice(local.indexOf(collection), 1);
    }
  }

  const slots: Slot[] = [];
  for (const mode of modes) {
    const { collection, created } = await ensureCollection(splitCollectionName(name, mode), local);
    if (created) collection.renameMode(collection.defaultModeId, modeDisplayName(mode));
    slots.push({ collection, modes: new Map([[mode, collection.defaultModeId]]) });
  }
  return { slots, layout: 'split-collections' };
}

async function tierSlots(c: PlannedCollection, local: VariableCollection[], errors: string[]): Promise<{ slots: Slot[]; layout: ApplyReport['layout'] }> {
  if (c.modes.length === 1 && c.modes[0] === PRIMITIVE_MODE) {
    const { collection, created } = await ensureCollection(c.name, local);
    if (created) collection.renameMode(collection.defaultModeId, PRIMITIVE_MODE_NAME);
    return { slots: [{ collection, modes: new Map([[PRIMITIVE_MODE, collection.defaultModeId]]) }], layout: 'single-collection' };
  }
  return multiModeSlots(c.name, c.modes, local, errors);
}

function toVariableValue(v: Exclude<PlannedValue, { kind: 'alias-token' }>): VariableValue {
  switch (v.kind) {
    case 'color':
      return { r: v.r, g: v.g, b: v.b, a: v.a };
    case 'float':
    case 'string':
    case 'boolean':
      return v.value;
  }
}

/** Font families installed in Figma: familyKey -> Figma's name. */
async function installedFamilies(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (const f of await figma.listAvailableFontsAsync()) out.set(familyKey(f.fontName.family), f.fontName.family);
  } catch {
    /* Figma could not list fonts: each stack shows its first family */
  }
  return out;
}

/** The same value as Figma already holds for that mode (colors to 4 decimals, numbers to float precision): nothing to write. */
function sameValue(current: VariableValue | undefined, next: VariableValue): boolean {
  if (current === undefined) return false;
  // Figma keeps numbers as 32-bit floats: 0.1 reads back as 0.10000000149.
  if (typeof next === 'number') return typeof current === 'number' && Math.abs(current - next) <= 1e-6 * Math.max(1, Math.abs(next));
  if (typeof next !== 'object' || next === null) return current === next;
  if (typeof current !== 'object' || current === null) return false;
  if ('type' in next && next.type === 'VARIABLE_ALIAS') return 'type' in current && current.type === 'VARIABLE_ALIAS' && current.id === next.id;
  if ('r' in next && 'r' in current) {
    const q = (n: number | undefined) => Math.round((n ?? 1) * 10000);
    return q(current.r) === q(next.r) && q(current.g) === q(next.g) && q(current.b) === q(next.b) && q((current as RGBA).a) === q((next as RGBA).a);
  }
  return false;
}

export async function applyPullPlan(plan: PullPlan, progress: (message: string) => void = () => undefined): Promise<ApplyReport> {
  const errors: string[] = [];
  const local = (await figma.variables.getLocalVariableCollectionsAsync()).filter((c) => !c.remote);
  const all = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(all.map((v) => [v.id, v]));

  // Only tiers that have variables in the plan get a collection.
  const slotsByTier = new Map<Tier, Slot[]>();
  let layout: ApplyReport['layout'] = 'single-collection';
  for (const c of plan.collections) {
    if (!plan.variables.some((v) => v.tier === c.tier)) continue;
    const r = await tierSlots(c, local, errors);
    slotsByTier.set(c.tier, r.slots);
    if (r.layout === 'split-collections') layout = 'split-collections';
  }
  const managedIds = [...slotsByTier.values()].flatMap((slots) => slots.map((x) => x.collection.id));

  // Index existing variables per collection by token id and by name.
  const registry: Registry = { byToken: new Map(), byName: new Map() };
  for (const v of all) {
    const pd = readPluginData(v);
    if (pd.id) registry.byToken.set(registryKey(v.variableCollectionId, pd.id), v);
    registry.byName.set(registryKey(v.variableCollectionId, v.name), v);
  }

  let created = 0;
  /** Existing variables a value, name, description or scope of which this pull changed: the "updated" count. */
  const changed = new Set<string>();
  const createdIds = new Set<string>();
  let ops = 0;
  const deferred: { variable: Variable; modeId: string; mode: string; ref: { path: string; tokenId?: string | undefined; tier?: Tier | undefined }; owner: string; collectionId: string }[] = [];

  // Font stacks: the variable shows the family Figma has, the stack stays in plugin data (read back unchanged).
  let installed: Map<string, string> | undefined;
  for (const planned of plan.variables) {
    if (planned.pluginData.dtcgType !== 'fontFamily') continue;
    const literals = Object.values(planned.values).filter((v): v is Extract<PlannedValue, { kind: 'string' }> => v.kind === 'string');
    if (!literals.length) continue;
    installed ??= await installedFamilies();
    planned.pluginData = { ...planned.pluginData, stacks: [...new Set(literals.map((v) => v.value))] };
    for (const [mode, v] of Object.entries(planned.values)) if (v.kind === 'string') planned.values[mode] = { kind: 'string', value: stackFamily(v.value, installed) };
  }

  for (const planned of plan.variables) {
    const slots = slotsByTier.get(planned.tier) ?? [];
    let touched = false;
    let isNew = false;
    for (const slot of slots) {
      const modeKeys = [...slot.modes.keys()].filter((m) => planned.values[m] !== undefined);
      if (slots.length > 1 && modeKeys.length === 0) continue; // split layout: token absent in this mode
      const fallbackValue = Object.values(planned.values)[0];
      try {
        const variable = await upsertVariable(planned, slot, registry, byId, errors);
        if (!variable) continue;
        if (variable.isNew) {
          isNew = true;
          createdIds.add(variable.variable.id);
        } else if (variable.changed) changed.add(variable.variable.id);
        touched = true;
        for (const [mode, modeId] of slot.modes) {
          const value = planned.values[mode] ?? fallbackValue; // absent theme: keep a value so the mode is not empty
          if (!value) continue;
          if (value.kind === 'alias-token') deferred.push({ variable: variable.variable, modeId, mode, ref: value, owner: planned.path, collectionId: slot.collection.id });
          else {
            // Only what differs is written: a big file re-pulled rewrites nothing it already has.
            const next = toVariableValue(value);
            if (variable.isNew || !sameValue(variable.variable.valuesByMode[modeId], next)) {
              variable.variable.setValueForMode(modeId, next);
              if (!variable.isNew) changed.add(variable.variable.id);
            }
          }
        }
      } catch (err) {
        errors.push(`${planned.path}: ${errorText(err)}`);
      }
      if (++ops % BATCH === 0) {
        progress(`Writing variables: ${created + changed.size} of ${plan.variables.length}`);
        await breathe();
      }
    }
    if (touched && isNew) created++;
  }

  // Pass 2: aliases, now that every target exists.
  progress(`Linking ${deferred.length} aliases`);
  // Modes left without their alias, per variable: recorded so the next pull does not read them as Figma edits.
  const unlinked = new Map<Variable, Set<string>>();
  for (const d of deferred) if (!unlinked.has(d.variable)) unlinked.set(d.variable, new Set());
  for (const d of deferred) {
    // Look in the target's tier first (its first slot in the split layout), then in every synced collection.
    const name = d.ref.path.split('.').join('/');
    const preferred = d.ref.tier ? slotsByTier.get(d.ref.tier)?.[0]?.collection.id : undefined;
    const order = [...new Set([preferred, d.collectionId, ...managedIds].filter((x): x is string => !!x))];
    let target: Variable | undefined;
    for (const cid of order) {
      target = (d.ref.tokenId ? registry.byToken.get(registryKey(cid, d.ref.tokenId)) : undefined) ?? registry.byName.get(registryKey(cid, name));
      if (target && target.id !== d.variable.id) break;
      target = undefined;
    }
    if (!target) {
      errors.push(`${d.owner} points to ${d.ref.path}, which has no variable in Figma (it may be a code-only token). The alias was not set.`);
      unlinked.get(d.variable)!.add(d.mode);
      continue;
    }
    if (target.resolvedType !== d.variable.resolvedType) {
      errors.push(`${d.owner} (${d.variable.resolvedType}) cannot point to ${d.ref.path} (${target.resolvedType}).`);
      continue;
    }
    try {
      const alias = figma.variables.createVariableAlias(target);
      if (!sameValue(d.variable.valuesByMode[d.modeId], alias)) {
        d.variable.setValueForMode(d.modeId, alias);
        changed.add(d.variable.id);
      }
    } catch (err) {
      errors.push(`${d.owner}: ${errorText(err)}`);
    }
    if (++ops % BATCH === 0) await breathe();
  }

  for (const [variable, modes] of unlinked) writePluginData(variable, { unlinkedModes: [...modes] });

  // Orphans: removed on main, kept in Figma with a visible flag.
  let orphaned = 0;
  for (const o of plan.orphans) {
    const v = byId.get(o.variableId) ?? (await figma.variables.getVariableByIdAsync(o.variableId));
    if (!v) continue;
    v.setPluginData('orphan', 'true');
    if (!v.description.startsWith(ORPHAN_PREFIX)) v.description = ORPHAN_PREFIX + v.description;
    orphaned++;
    if (++ops % BATCH === 0) await breathe();
  }

  for (const id of createdIds) changed.delete(id);
  return { created, updated: changed.size, orphaned, layout, errors };
}

async function upsertVariable(
  planned: PlannedVariable,
  slot: Slot,
  registry: Registry,
  byId: Map<string, Variable>,
  errors: string[],
): Promise<{ variable: Variable; isNew: boolean; changed: boolean } | undefined> {
  const cid = slot.collection.id;
  let variable =
    planned.existingVariableIds.map((id) => byId.get(id)).find((v) => v && v.variableCollectionId === cid) ??
    registry.byToken.get(registryKey(cid, planned.tokenId)) ??
    registry.byName.get(registryKey(cid, planned.name));
  let isNew = false;
  let changed = false;

  if (variable && variable.resolvedType !== planned.resolvedType) {
    errors.push(`${planned.path} is a ${variable.resolvedType} variable in Figma but a ${planned.resolvedType} token in Git. Type changes are not allowed; the variable was left as is.`);
    return undefined;
  }
  if (!variable) {
    variable = figma.variables.createVariable(planned.name, slot.collection, planned.resolvedType);
    byId.set(variable.id, variable);
    isNew = true;
  } else if (variable.name !== planned.name) {
    const clash = registry.byName.get(registryKey(cid, planned.name));
    if (clash && clash.id !== variable.id) {
      errors.push(`Cannot rename "${variable.name}" to "${planned.name}": another variable already has that name.`);
    } else {
      registry.byName.delete(registryKey(cid, variable.name));
      variable.name = planned.name;
      changed = true;
    }
  }
  registry.byName.set(registryKey(cid, variable.name), variable);
  registry.byToken.set(registryKey(cid, planned.tokenId), variable);

  if (variable.description !== planned.description) {
    variable.description = planned.description;
    changed = true;
  }
  try {
    const current = [...variable.scopes].sort().join(',');
    if (current !== [...planned.scopes].sort().join(',')) {
      variable.scopes = planned.scopes as VariableScope[];
      changed = true;
    }
  } catch (err) {
    errors.push(`${planned.path}: scopes ${planned.scopes.join(', ')} were refused by Figma (${errorText(err)}).`);
  }
  writePluginData(variable, { ...planned.pluginData, orphan: false, absentModes: planned.pluginData.absentModes ?? [] });
  return { variable, isNew, changed };
}
