// Pull, "Review updates" like Figma: for each generated component set that changed in code, what an update would change
// in Figma (variants, props, bound variables), shown next to a thumbnail of the set as it is now. Pure: no DOM, no figma.*.
//
// The comparison needs no stored copy of the old spec: the set as it is in Figma (its signature, read like Push reads it)
// is compared with the signature the plan would produce, with the same diff Push uses.

import type { RequestChange, SpecField } from '@bridge-ds/core';
import type { ComponentPullPlan, PlannedComponent } from './component-pull';
import { type ComponentSignature, type VariantSignature, bindingKind, diffSignatures, propName } from './components';

/** Figma's boundVariables key for a spec field (fills, strokes, topLeftRadius...), to name its kind like a scan does. */
const FIGMA_FIELD: Partial<Record<SpecField, string>> = { fill: 'fills', textFill: 'fills', stroke: 'strokes', cornerRadius: 'topLeftRadius' };

const sortedUnique = (xs: string[]) => [...new Set(xs)].sort();

/** The signature a planned component has once built: axes, properties and the variables bound in each variant. */
export function plannedSignature(c: PlannedComponent): ComponentSignature {
  const variantAxes: Record<string, string[]> = {};
  for (const a of [...c.axes].sort((x, y) => (x.name < y.name ? -1 : 1))) variantAxes[a.name] = sortedUnique(a.values);
  const swaps = c.parts.filter((p) => p.swap).map((p) => ({ name: p.swap!.property, type: 'INSTANCE_SWAP', default: p.swap!.default }));
  const properties = [...c.properties.map((p) => ({ name: p.name, type: p.type as string, default: String(p.default) })), ...swaps].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
  );
  const variants: Record<string, VariantSignature> = {};
  const all: Record<string, string[]> = {};
  for (const v of c.variants) {
    const by: Record<string, string[]> = {};
    for (const fields of [...Object.values(v.parts), v.inner ?? []])
      for (const f of fields) {
        // A text's family is bound to its token's variable (the build skips it only for a font Figma lacks).
        const name = f.value.kind === 'variable' ? f.value.name : f.value.kind === 'font' ? f.value.variable?.name : undefined;
        if (!name) continue;
        (by[bindingKind(FIGMA_FIELD[f.field] ?? f.field)] ??= []).push(name);
      }
    // Vector parts: each shape's stroke.
    for (const vec of Object.values(v.vectors ?? {})) for (const st of vec.strokes) if (st.kind === 'variable') (by[bindingKind('strokes')] ??= []).push(st.name);
    const bindings: Record<string, string[]> = {};
    for (const k of Object.keys(by).sort()) {
      bindings[k] = sortedUnique(by[k]!);
      all[k] = sortedUnique([...(all[k] ?? []), ...by[k]!]);
    }
    variants[v.key] = { bindings, values: '', ...(v.slots ? { slots: { ...v.slots }, slotDefaults: { ...v.slots } } : {}) };
  }
  return { v: 1, name: c.name, variantAxes, properties, bindings: all, variants };
}

/** Variant properties are compared through the axes; their default is not drawn from code, so leave them out. */
function withoutVariantProps(s: ComponentSignature): ComponentSignature {
  return { ...s, properties: s.properties.filter((p) => p.type !== 'VARIANT').map((p) => ({ ...p, name: propName(p.name) })) };
}

export interface ComponentReview {
  componentId: string;
  name: string;
  nodeId: string;
  /** What an update changes in Figma: "Variant Size: sm, md -> sm, md, lg", "Fill: card.bg -> color.bg.subtle". */
  changes: RequestChange[];
  /** Variants code added or removed since the last pull (from the plan). */
  addedVariants: string[];
  removedVariants: string[];
}

/** One review per updated component set; `current` is the scan of the file (nodeId -> signature). */
export function reviewUpdates(plan: ComponentPullPlan, current: Map<string, ComponentSignature>): ComponentReview[] {
  const out: ComponentReview[] = [];
  for (const c of plan.components) {
    if (c.status !== 'updated' || !c.nodeId) continue;
    const now = current.get(c.nodeId);
    const changes = now ? diffSignatures(withoutVariantProps(now), withoutVariantProps(plannedSignature(c))).changes : [];
    // Pushed from Figma: the update replaces the Figma version with the reviewed code, said first.
    if (c.fromFigma) changes.unshift({ field: 'Your change from Figma', before: `In Figma, sent as #${c.fromFigma.number}`, after: c.fromFigma.status.key === 'shipped' ? 'Shipped: rebuilt from the reviewed code' : 'Closed: back to the code' });
    if (!changes.length) {
      changes.push({ field: 'Values set from code', before: 'As in Figma', after: 'Rebuilt from the code (sizes, layout, set values)' });
    }
    out.push({ componentId: c.componentId, name: c.name, nodeId: c.nodeId, changes, addedVariants: c.addedVariants, removedVariants: c.removedVariants });
  }
  return out;
}

/** The plan with only one component, to update it on its own ("Update" on its row). */
export function onlyComponent(plan: ComponentPullPlan, componentId: string): ComponentPullPlan {
  return { ...plan, components: plan.components.filter((c) => c.componentId === componentId) };
}

/** The plan without the components already updated one by one (they are not built twice by "Update all"). */
export function withoutComponents(plan: ComponentPullPlan, done: ReadonlySet<string>): ComponentPullPlan {
  return { ...plan, components: plan.components.filter((c) => !done.has(c.componentId)) };
}
