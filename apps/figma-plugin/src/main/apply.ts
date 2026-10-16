// Apply a pull plan to Figma variables: collections and modes, then literal values (pass 1), then
// aliases (pass 2, once every target exists), then orphan flags. Nothing is ever deleted.

import {
  type ApplyReport,
  COLLECTION_PRIMITIVES,
  COLLECTION_SEMANTIC,
  PRIMITIVE_MODE_NAME,
  type PlannedValue,
  type PlannedVariable,
  type PullPlan,
  modeDisplayName,
  splitCollectionName,
} from '../shared/messages';
import { readPluginData, writePluginData } from './snapshot';

const ORPHAN_PREFIX = '[orphan] ';
const BATCH = 25;
const PRIMITIVE_MODE = 'value';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
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

/** Resolve the Figma layout for semantic tokens, creating collections and modes as needed. */
async function semanticSlots(modes: string[], local: VariableCollection[], errors: string[]): Promise<{ slots: Slot[]; layout: ApplyReport['layout'] }> {
  const single = local.find((c) => c.name === COLLECTION_SEMANTIC && !c.remote);
  const hasSplit = local.some((c) => !c.remote && c.name.startsWith(`${COLLECTION_SEMANTIC}/`));

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
    const { collection, created } = single ? { collection: single, created: false } : await ensureCollection(COLLECTION_SEMANTIC, local);
    try {
      return { slots: [{ collection, modes: fillModes(collection, created) }], layout: 'single-collection' };
    } catch (err) {
      if (!created) {
        errors.push(`Could not add theme modes to "${COLLECTION_SEMANTIC}" (${errorText(err)}). Values for missing modes were not written.`);
        const map = new Map<string, string>();
        for (const mode of modes) {
          const id = findMode(collection, mode);
          if (id) map.set(mode, id);
        }
        return { slots: [{ collection, modes: map }], layout: 'single-collection' };
      }
      // This file cannot have several modes per collection (free plan): use one collection per theme.
      collection.remove();
      local.splice(local.indexOf(collection), 1);
    }
  }

  const slots: Slot[] = [];
  for (const mode of modes) {
    const { collection, created } = await ensureCollection(splitCollectionName(mode), local);
    if (created) collection.renameMode(collection.defaultModeId, modeDisplayName(mode));
    slots.push({ collection, modes: new Map([[mode, collection.defaultModeId]]) });
  }
  return { slots, layout: 'split-collections' };
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

export async function applyPullPlan(plan: PullPlan, progress: (message: string) => void = () => undefined): Promise<ApplyReport> {
  const errors: string[] = [];
  const local = (await figma.variables.getLocalVariableCollectionsAsync()).filter((c) => !c.remote);
  const all = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(all.map((v) => [v.id, v]));

  const prim = await ensureCollection(COLLECTION_PRIMITIVES, local);
  if (prim.created) prim.collection.renameMode(prim.collection.defaultModeId, PRIMITIVE_MODE_NAME);
  const primSlot: Slot = { collection: prim.collection, modes: new Map([[PRIMITIVE_MODE, prim.collection.defaultModeId]]) };

  const needsSemantic = plan.variables.some((v) => v.tier === 'semantic');
  const semantic = needsSemantic ? await semanticSlots(plan.modes, local, errors) : { slots: [] as Slot[], layout: 'single-collection' as const };

  // Index existing variables per collection by token id and by name.
  const registry: Registry = { byToken: new Map(), byName: new Map() };
  for (const v of all) {
    const pd = readPluginData(v);
    if (pd.id) registry.byToken.set(registryKey(v.variableCollectionId, pd.id), v);
    registry.byName.set(registryKey(v.variableCollectionId, v.name), v);
  }

  let created = 0;
  let updated = 0;
  let ops = 0;
  const deferred: { variable: Variable; modeId: string; ref: { path: string; tokenId?: string | undefined }; owner: string; collectionId: string }[] = [];

  for (const planned of plan.variables) {
    const slots = planned.tier === 'primitive' ? [primSlot] : semantic.slots;
    let touched = false;
    let isNew = false;
    for (const slot of slots) {
      const modeKeys = [...slot.modes.keys()].filter((m) => planned.values[m] !== undefined);
      if (semantic.layout === 'split-collections' && planned.tier === 'semantic' && modeKeys.length === 0) continue;
      const fallbackValue = Object.values(planned.values)[0];
      try {
        const variable = await upsertVariable(planned, slot, registry, byId, errors);
        if (!variable) continue;
        if (variable.isNew) isNew = true;
        touched = true;
        for (const [mode, modeId] of slot.modes) {
          const value = planned.values[mode] ?? fallbackValue; // absent theme: keep a value so the mode is not empty
          if (!value) continue;
          if (value.kind === 'alias-token') deferred.push({ variable: variable.variable, modeId, ref: value, owner: planned.path, collectionId: slot.collection.id });
          else variable.variable.setValueForMode(modeId, toVariableValue(value));
        }
      } catch (err) {
        errors.push(`${planned.path}: ${errorText(err)}`);
      }
      if (++ops % BATCH === 0) {
        progress(`Writing variables: ${created + updated} of ${plan.variables.length}`);
        await tick();
      }
    }
    if (touched) {
      if (isNew) created++;
      else updated++;
    }
  }

  // Pass 2: aliases, now that every target exists.
  progress(`Linking ${deferred.length} aliases`);
  for (const d of deferred) {
    const target =
      (d.ref.tokenId && registry.byToken.get(registryKey(prim.collection.id, d.ref.tokenId))) ||
      registry.byName.get(registryKey(prim.collection.id, d.ref.path.split('.').join('/'))) ||
      (d.ref.tokenId && registry.byToken.get(registryKey(d.collectionId, d.ref.tokenId))) ||
      registry.byName.get(registryKey(d.collectionId, d.ref.path.split('.').join('/')));
    if (!target) {
      errors.push(`${d.owner} points to ${d.ref.path}, which has no variable in Figma (it may be a code-only token). The alias was not set.`);
      continue;
    }
    if (target.resolvedType !== d.variable.resolvedType) {
      errors.push(`${d.owner} (${d.variable.resolvedType}) cannot point to ${d.ref.path} (${target.resolvedType}).`);
      continue;
    }
    try {
      d.variable.setValueForMode(d.modeId, figma.variables.createVariableAlias(target));
    } catch (err) {
      errors.push(`${d.owner}: ${errorText(err)}`);
    }
    if (++ops % BATCH === 0) await tick();
  }

  // Orphans: removed on main, kept in Figma with a visible flag.
  let orphaned = 0;
  for (const o of plan.orphans) {
    const v = byId.get(o.variableId) ?? (await figma.variables.getVariableByIdAsync(o.variableId));
    if (!v) continue;
    v.setPluginData('orphan', 'true');
    if (!v.description.startsWith(ORPHAN_PREFIX)) v.description = ORPHAN_PREFIX + v.description;
    orphaned++;
    if (++ops % BATCH === 0) await tick();
  }

  return { created, updated, orphaned, layout: semantic.layout, errors };
}

async function upsertVariable(
  planned: PlannedVariable,
  slot: Slot,
  registry: Registry,
  byId: Map<string, Variable>,
  errors: string[],
): Promise<{ variable: Variable; isNew: boolean } | undefined> {
  const cid = slot.collection.id;
  let variable =
    planned.existingVariableIds.map((id) => byId.get(id)).find((v) => v && v.variableCollectionId === cid) ??
    registry.byToken.get(registryKey(cid, planned.tokenId)) ??
    registry.byName.get(registryKey(cid, planned.name));
  let isNew = false;

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
    }
  }
  registry.byName.set(registryKey(cid, variable.name), variable);
  registry.byToken.set(registryKey(cid, planned.tokenId), variable);

  if (variable.description !== planned.description) variable.description = planned.description;
  try {
    const current = [...variable.scopes].sort().join(',');
    if (current !== [...planned.scopes].sort().join(',')) variable.scopes = planned.scopes as VariableScope[];
  } catch (err) {
    errors.push(`${planned.path}: scopes ${planned.scopes.join(', ')} were refused by Figma (${errorText(err)}).`);
  }
  writePluginData(variable, { ...planned.pluginData, orphan: false, absentModes: planned.pluginData.absentModes ?? [] });
  return { variable, isNew };
}
