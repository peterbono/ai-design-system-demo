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
  // Like apply.ts: one collection per tier; multi-mode tiers split into "<Name>/<Mode>" on free plans.
  const slotsByTier = new Map<string, { c: ReturnType<typeof coll>; modes: string[] }[]>();
  for (const pc of plan.collections) {
    if (!plan.variables.some((v) => v.tier === pc.tier)) continue;
    const single = pc.modes.length === 1 && pc.modes[0] === 'value';
    slotsByTier.set(
      pc.tier,
      single || layout === 'single' ? [{ c: coll(pc.name, pc.modes), modes: pc.modes }] : pc.modes.map((m) => ({ c: coll(splitCollectionName(pc.name, m), [m]), modes: [m] })),
    );
  }
  const managed = [...slotsByTier.values()].flatMap((x) => x.map((s) => s.c.id));
  const deferred: { v: SnapshotVariable; modeId: string; value: Extract<PlannedValue, { kind: 'alias-token' }> }[] = [];
  let n = snap.variables.length;
  for (const p of plan.variables) {
    const targets = slotsByTier.get(p.tier)!;
    for (const t of targets) {
      if (targets.length > 1 && t.modes.every((m) => p.values[m] === undefined)) continue;
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
    const preferred = d.value.tier ? slotsByTier.get(d.value.tier)?.[0]?.c.id : undefined;
    const name = d.value.path.split('.').join('/');
    const inColl = (cid: string | undefined) =>
      cid ? snap.variables.find((x) => x.collectionId === cid && (x.pluginData.id === d.value.tokenId || x.name === name)) : undefined;
    const target = inColl(preferred) ?? managed.map(inColl).find(Boolean);
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

/** Mode id of `mode` ("Light", "Ocean"...) in collection `collection`, single or split layout. */
export function modeId(snap: FigmaSnapshot, collection: string, mode: string): string {
  const c = snap.collections.find((x) => x.name === collection) ?? snap.collections.find((x) => x.name === `${collection}/${mode}`);
  const m = c?.modes.find((x) => x.name === mode);
  if (!m) throw new Error(`no mode ${mode} in ${collection}`);
  return m.modeId;
}

/** Variable `name` in collection `collection` (names repeat across collections, e.g. Semantic vs overrides). */
export function findIn(snap: FigmaSnapshot, collection: string, name: string): SnapshotVariable {
  const ids = new Set(snap.collections.filter((c) => c.name === collection || c.name.startsWith(`${collection}/`)).map((c) => c.id));
  const v = snap.variables.find((x) => ids.has(x.collectionId) && x.name === name);
  if (!v) throw new Error(`no variable ${name} in ${collection}`);
  return v;
}

export function findVar(snap: FigmaSnapshot, name: string): SnapshotVariable {
  const v = snap.variables.find((x) => x.name === name);
  if (!v) throw new Error(`no variable ${name}`);
  return v;
}

export function primId(snap: FigmaSnapshot, name: string): string {
  return findVar(snap, name).id;
}

/** Adds mode `name` to the Brand collection with Bridge's values (single layout) or a "Brand/<name>" copy (split). */
export function addBrandMode(snap: FigmaSnapshot, name: string, layout: 'single' | 'split' = 'single') {
  if (layout === 'single') {
    const c = snap.collections.find((x) => x.name === 'Brand')!;
    const id = `Brand:${name.toLowerCase()}`;
    c.modes.push({ modeId: id, name });
    for (const v of snap.variables) if (v.collectionId === c.id) v.valuesByMode[id] = structuredClone(v.valuesByMode['Brand:bridge']!);
    return;
  }
  const src = snap.collections.find((x) => x.name === 'Brand/Bridge')!;
  const c = { ...structuredClone(src), id: `c:Brand/${name}`, name: `Brand/${name}`, modes: [{ modeId: `Brand/${name}:x`, name }], defaultModeId: `Brand/${name}:x` };
  snap.collections.push(c);
  for (const v of snap.variables.filter((x) => x.collectionId === src.id)) {
    snap.variables.push({ ...structuredClone(v), id: `${v.id}-${name}`, collectionId: c.id, valuesByMode: { [c.defaultModeId]: structuredClone(v.valuesByMode[src.defaultModeId]!) } });
  }
}
export const setBrandColor = (snap: FigmaSnapshot, name: string, mode: string, hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  findIn(snap, 'Brand', name).valuesByMode[modeId(snap, 'Brand', mode)] = { kind: 'color', r, g, b, a: 1 };
};
