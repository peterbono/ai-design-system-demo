// A tiny in-memory stand-in for Figma variables, used to test pull -> edit -> push round trips
// without Figma. Values go through Math.fround like Figma's float32 storage.

import type { FigmaSnapshot, PlannedValue, PullPlan, SnapshotVariable } from '../src/shared/messages';
import { modeDisplayName, splitCollectionName } from '../src/shared/messages';

export function applyPlanToSnapshot(plan: PullPlan, layout: 'single' | 'split' = 'single', previous?: FigmaSnapshot): FigmaSnapshot {
  const snap: FigmaSnapshot = previous ? structuredClone(previous) : { fileName: 'Test file', collections: [], variables: [] };
  const coll = (name: string, modes: string[]) => {
    let c = snap.collections.find((x) => x.name === name);
    if (!c) {
      c = { id: `c:${name}`, name, modes: modes.map((m) => ({ modeId: `${name}:${m}`, name: modeDisplayName(m) })), defaultModeId: `${name}:${modes[0]}`, remote: false };
      snap.collections.push(c);
    }
    return c;
  };
  const prim = coll('Primitives', ['value']);
  const slots =
    layout === 'single'
      ? [{ c: coll('Semantic', plan.modes), modes: plan.modes }]
      : plan.modes.map((m) => ({ c: coll(splitCollectionName(m), [m]), modes: [m] }));
  const deferred: { v: SnapshotVariable; modeId: string; value: Extract<PlannedValue, { kind: 'alias-token' }> }[] = [];
  let n = snap.variables.length;
  for (const p of plan.variables) {
    const targets = p.tier === 'primitive' ? [{ c: prim, modes: ['value'] }] : slots;
    for (const t of targets) {
      let v = snap.variables.find((x) => x.collectionId === t.c.id && (x.pluginData.id === p.tokenId || x.name === p.name));
      if (!v) {
        v = { id: `v${++n}`, name: p.name, collectionId: t.c.id, resolvedType: p.resolvedType, description: '', scopes: ['ALL_SCOPES'], valuesByMode: {}, pluginData: {} };
        snap.variables.push(v);
      }
      v.name = p.name;
      v.description = p.description;
      v.scopes = [...p.scopes];
      v.pluginData = { ...p.pluginData };
      for (const m of t.modes) {
        const modeId = t.c.modes.find((x) => x.name === modeDisplayName(m))!.modeId;
        const value = p.values[m] ?? Object.values(p.values)[0]!;
        if (value.kind === 'alias-token') deferred.push({ v, modeId, value });
        else if (value.kind === 'color') v.valuesByMode[modeId] = { kind: 'color', r: Math.fround(value.r), g: Math.fround(value.g), b: Math.fround(value.b), a: Math.fround(value.a) };
        else if (value.kind === 'float') v.valuesByMode[modeId] = { kind: 'float', value: Math.fround(value.value) };
        else v.valuesByMode[modeId] = value;
      }
    }
  }
  for (const d of deferred) {
    const target =
      snap.variables.find((x) => x.collectionId === prim.id && x.pluginData.id === d.value.tokenId) ??
      snap.variables.find((x) => x.name === d.value.path.split('.').join('/'));
    if (!target) throw new Error(`alias target ${d.value.path} missing`);
    d.v.valuesByMode[d.modeId] = { kind: 'alias', id: target.id };
  }
  for (const o of plan.orphans) {
    const v = snap.variables.find((x) => x.id === o.variableId)!;
    v.pluginData.orphan = true;
    v.description = `[orphan] ${v.description}`;
  }
  return snap;
}

export function findVar(snap: FigmaSnapshot, name: string): SnapshotVariable {
  const v = snap.variables.find((x) => x.name === name);
  if (!v) throw new Error(`no variable ${name}`);
  return v;
}

export function primId(snap: FigmaSnapshot, name: string): string {
  return findVar(snap, name).id;
}
