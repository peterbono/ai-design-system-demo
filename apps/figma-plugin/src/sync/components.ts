// Component signatures: what a coded component's API and look are, as Figma shows them, so a Push can tell a real
// component change (a request for code) from a Figma-only restructure (nothing to send). Pure: the main thread
// gathers raw data from figma.* (src/main/components.ts); everything here is testable without Figma.
//
// Product rules (docs in the plugin README):
// - Variable edits never become requests: they are the Push pull request. A render that changed because a bound
//   variable's value changed is explained by that variable and is not a request.
// - Components need code: new component, new or removed variant, prop changes, another variable bound to a part
//   (token-binding) and a visual change no variable explains become requests (a GitHub issue), never a code PR.
// - Layers renamed, regrouped or re-laid out with the same API, the same bound variables and the same render
//   trigger nothing.
// - Swaps (icons, content slots) are part of the API: the INSTANCE_SWAP property, its default and preferred values
//   are compared like any property. Swapping the instance inside a variant is a visual change only when the variant
//   then shows another component than the one code gives it (stored at pull as `slotDefaults`); swapping back to it
//   is no change. A swap explains the bindings and render that move with it in that variant.

import { type ComponentChangeRequest, type RequestChange, type RequestKind, draftChangeLine, draftRequestText } from '@bridge-ds/core';

/** One variable (or style) bound somewhere in a variant, wherever the layer sits. */
export interface RawBinding {
  /** Property family: fill, stroke, radius, padding, gap, size, typography, effect... */
  kind: string;
  /** Variable name ("color/action/primary/bg") or "style:<name>" for a shared style. */
  variable: string;
  /** Resolved value for this layer, as text; lets a value edit explain a new render. */
  value?: string | undefined;
}

/** One variant (a COMPONENT), as the main thread reads it. */
export interface RawVariant {
  /** variantProperties of the variant ({ Size: "md", Tone: "primary" }), null for a single component. */
  props: Record<string, string> | null;
  bindings: RawBinding[];
  /** FNV-1a of a small PNG export. Undefined when the export failed. */
  render?: string | undefined;
  /** FNV-1a of the layer tree (types, names, auto layout): only used to say "Figma-only changes". */
  structure?: string | undefined;
  /** Swappable part ("icon", "body-text") -> main component name of its instance ("Icon/Plus"). */
  slots?: Record<string, string> | undefined;
  /** Swappable part -> the component code gives this variant, as the pull stored it. */
  slotDefaults?: Record<string, string> | undefined;
}

export interface RawDefinition {
  /** Property name as Figma stores it ("Label#12:0" for text, boolean and instance swap props). */
  name: string;
  /** VARIANT, TEXT, BOOLEAN, INSTANCE_SWAP. */
  type: string;
  default: string;
  /** Values of a VARIANT property. */
  options?: string[] | undefined;
}

/** A component set (or a single component) as the main thread reads it. */
export interface RawComponent {
  nodeId: string;
  name: string;
  page?: string | undefined;
  definitions: RawDefinition[];
  variants: RawVariant[];
}

export interface VariantSignature {
  /** Bound variable names per property kind, sorted and unique: a regroup or a renamed layer does not change it. */
  bindings: Record<string, string[]>;
  /** Hash of the resolved values of those bindings. */
  values: string;
  render?: string | undefined;
  structure?: string | undefined;
  /** Swappable part -> component its instance shows, and the one code gives the variant. */
  slots?: Record<string, string> | undefined;
  slotDefaults?: Record<string, string> | undefined;
}

export interface ComponentSignature {
  v: 1;
  name: string;
  /** Variant axes and their values, sorted (a reorder in Figma is not a change). */
  variantAxes: Record<string, string[]>;
  /** Component properties, sorted by name, without Figma's "#id" suffix. */
  properties: { name: string; type: string; default: string }[];
  /** Bindings of every variant together, per kind. */
  bindings: Record<string, string[]>;
  /** Per variant ("Size=md, Tone=primary", or "Default"): its bindings and render hash. */
  variants: Record<string, VariantSignature>;
}

/** FNV-1a, 32 bits, as 8 hex digits. Fast enough for small PNGs in the main thread. */
export function fnv1a(data: Uint8Array | string): string {
  let h = 0x811c9dc5;
  if (typeof data === 'string') {
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      h ^= data[i]!;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Figma suffixes text, boolean and instance swap property names with "#<id>". */
export const propName = (name: string) => name.replace(/#[^#]*$/, '');

/** Kind of a boundVariables key ("fills" -> fill, "topLeftRadius" -> radius, "paddingLeft" -> padding...). */
export function bindingKind(field: string): string {
  if (field === 'fills' || field === 'textRangeFills') return 'fill';
  if (field === 'strokes') return 'stroke';
  if (/^stroke.*Weight$/.test(field)) return 'stroke width';
  if (/Radius$/i.test(field)) return 'radius';
  if (/^padding/.test(field)) return 'padding';
  if (field === 'itemSpacing' || field === 'counterAxisSpacing') return 'gap';
  if (/^(min|max)?(width|height)$/i.test(field)) return 'size';
  if (/^(font|lineHeight|letterSpacing|paragraph)/.test(field)) return 'typography';
  if (field === 'effects') return 'effect';
  if (field === 'characters') return 'text';
  if (field === 'visible') return 'visibility';
  if (field === 'opacity') return 'opacity';
  if (field === 'componentProperties') return 'property';
  return field;
}

export function variantKey(props: Record<string, string> | null): string {
  if (!props || !Object.keys(props).length) return 'Default';
  return Object.keys(props)
    .sort()
    .map((k) => `${k}=${props[k]}`)
    .join(', ');
}

const sortedUnique = (xs: string[]) => [...new Set(xs)].sort();
const sortedRecord = (r: Record<string, string>) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]!]));

function groupBindings(bindings: RawBinding[]): Record<string, string[]> {
  const by: Record<string, string[]> = {};
  for (const b of bindings) (by[b.kind] ??= []).push(b.variable);
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(by).sort()) out[k] = sortedUnique(by[k]!);
  return out;
}

export function buildSignature(raw: RawComponent): ComponentSignature {
  const variantAxes: Record<string, string[]> = {};
  const properties: ComponentSignature['properties'] = [];
  for (const d of raw.definitions) {
    const name = propName(d.name);
    if (d.type === 'VARIANT') variantAxes[name] = sortedUnique(d.options ?? []);
    properties.push({ name, type: d.type, default: d.default });
  }
  // A set without definitions (older files): derive the axes from the variants.
  if (!raw.definitions.some((d) => d.type === 'VARIANT')) {
    for (const v of raw.variants) for (const [k, val] of Object.entries(v.props ?? {})) (variantAxes[k] ??= []).push(val);
    for (const k of Object.keys(variantAxes)) variantAxes[k] = sortedUnique(variantAxes[k]!);
  }
  const axes: Record<string, string[]> = {};
  for (const k of Object.keys(variantAxes).sort()) axes[k] = variantAxes[k]!;
  properties.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  const variants: Record<string, VariantSignature> = {};
  for (const v of raw.variants) {
    const values = v.bindings
      .map((b) => `${b.kind}|${b.variable}|${b.value ?? ''}`)
      .sort()
      .join('\n');
    variants[variantKey(v.props)] = {
      bindings: groupBindings(v.bindings),
      values: fnv1a(sortedUnique(values.split('\n')).join('\n')),
      ...(v.render ? { render: v.render } : {}),
      ...(v.structure ? { structure: v.structure } : {}),
      ...(v.slots && Object.keys(v.slots).length ? { slots: sortedRecord(v.slots) } : {}),
      ...(v.slotDefaults && Object.keys(v.slotDefaults).length ? { slotDefaults: sortedRecord(v.slotDefaults) } : {}),
    };
  }
  return { v: 1, name: raw.name, variantAxes: axes, properties, bindings: groupBindings(raw.variants.flatMap((v) => v.bindings)), variants };
}

export function parseSignature(json: string | undefined | null): ComponentSignature | undefined {
  if (!json) return undefined;
  try {
    const s = JSON.parse(json) as ComponentSignature;
    return s && s.v === 1 && typeof s.name === 'string' && s.variants ? s : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Diff

export interface SignatureDiff {
  changes: RequestChange[];
  /** The request kind to suggest; undefined when nothing needs code. */
  kind: RequestKind | undefined;
  /** Only the layer tree moved (renamed, regrouped, auto layout): Figma-only, nothing to send. */
  figmaOnly: boolean;
  /** Renders moved only because bound variable values changed: that is the variables pull request. */
  explainedByVariables: boolean;
}

const list = (xs: string[] | undefined) => (xs?.length ? xs.join(', ') : '');
/** Figma variable name to token path: "color/action/primary/bg" -> "color.action.primary.bg". */
export const tokenName = (variable: string) => (variable.startsWith('style:') ? `${variable.slice(6)} (style)` : variable.replace(/\//g, '.'));

const KIND_ORDER: RequestKind[] = ['new-variant', 'prop-change', 'token-binding', 'visual'];

/** Changes between a baseline and the current signature, and the request kind to suggest. Equal => no request. */
export function diffSignatures(base: ComponentSignature, cur: ComponentSignature): SignatureDiff {
  const changes: RequestChange[] = [];
  const kinds = new Set<RequestKind>();

  // Variant axes and values.
  for (const axis of sortedUnique([...Object.keys(base.variantAxes), ...Object.keys(cur.variantAxes)])) {
    const b = base.variantAxes[axis];
    const c = cur.variantAxes[axis];
    if (list(b) === list(c)) continue;
    kinds.add('new-variant');
    changes.push({ field: `Variant ${axis}`, before: b ? list(b) : undefined, after: c ? list(c) : undefined });
  }

  // Component properties (variant axes are reported above, their default here).
  // An instance swap may share its name with the BOOLEAN that shows the same part ("Icon start"): keyed apart.
  const propKey = (p: { name: string; type: string }) => (p.type === 'INSTANCE_SWAP' ? `${p.name}\u0000swap` : p.name);
  const bp = new Map(base.properties.map((p) => [propKey(p), p]));
  const cp = new Map(cur.properties.map((p) => [propKey(p), p]));
  for (const name of sortedUnique([...bp.keys(), ...cp.keys()])) {
    const b = bp.get(name);
    const c = cp.get(name);
    if (b && c && b.type === c.type && b.default === c.default) continue;
    if ((b?.type ?? c?.type) === 'VARIANT' && (!b || !c)) continue;
    kinds.add('prop-change');
    const show = (p: typeof b) => (p ? `${p.type.toLowerCase().replace('_', ' ')}, default ${p.default || '(empty)'}` : undefined);
    changes.push({ field: `Prop ${name.replace(/\u0000swap$/, '')}`, before: show(b), after: show(c) });
  }

  // Bindings and renders of the variants both sides have.
  const common = Object.keys(cur.variants).filter((k) => base.variants[k]).sort();
  const bindingRows = new Map<string, { kind: string; before: string; after: string; variants: string[] }>();
  const visual: string[] = [];
  const swapRows = new Map<string, { before: string; after: string; variants: string[] }>();
  let explained = false;
  let structure = false;
  for (const key of common) {
    const b = base.variants[key]!;
    const c = cur.variants[key]!;
    // Swaps: a part both sides draw as an instance, now showing another component.
    const swapped = Object.keys(c.slots ?? {}).filter((part) => b.slots?.[part] !== undefined && b.slots[part] !== c.slots![part]);
    if (swapped.length) {
      for (const part of swapped) {
        const def = c.slotDefaults?.[part] ?? b.slotDefaults?.[part];
        if (def !== undefined && c.slots![part] === def) continue; // back to the component code gives it
        const id = `${part}\u0000${b.slots![part]}\u0000${c.slots![part]}`;
        const row = swapRows.get(id) ?? { before: b.slots![part]!, after: c.slots![part]!, variants: [] };
        row.variants.push(key);
        swapRows.set(id, row);
      }
      if (b.structure && c.structure && b.structure !== c.structure) structure = true;
      continue;
    }
    let rebound = false;
    for (const kind of sortedUnique([...Object.keys(b.bindings), ...Object.keys(c.bindings)])) {
      const before = list(b.bindings[kind]?.map(tokenName));
      const after = list(c.bindings[kind]?.map(tokenName));
      if (before === after) continue;
      rebound = true;
      const id = `${kind}\u0000${before}\u0000${after}`;
      const row = bindingRows.get(id) ?? { kind, before, after, variants: [] };
      row.variants.push(key);
      bindingRows.set(id, row);
    }
    if (rebound) continue;
    if (b.render && c.render && b.render !== c.render) {
      if (b.values !== c.values) explained = true;
      else visual.push(key);
    }
    if (b.structure && c.structure && b.structure !== c.structure) structure = true;
  }
  for (const row of bindingRows.values()) {
    kinds.add('token-binding');
    const all = row.variants.length === common.length;
    changes.push({ field: all ? capital(row.kind) : `${capital(row.kind)} (${row.variants.join('; ')})`, before: row.before || 'none', after: row.after || 'none' });
  }
  for (const row of swapRows.values()) {
    kinds.add('visual');
    const all = row.variants.length === common.length && common.length > 1;
    changes.push({ field: all ? 'Swapped instance' : `Swapped instance (${row.variants.join('; ')})`, before: row.before, after: row.after });
  }
  if (visual.length) {
    kinds.add('visual');
    const all = visual.length === common.length && common.length > 1;
    changes.push({ field: all ? 'Look of every variant' : `Look of ${visual.join('; ')}`, before: 'As in the baseline', after: 'Changed in Figma, no variable explains it' });
  }
  const kind = KIND_ORDER.find((k) => kinds.has(k));
  return { changes, kind, figmaOnly: !kind && structure, explainedByVariables: !kind && explained };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// Classification of the components a scan finds

/** A component the main thread found, with its stored baseline (shared plugin data), if any. */
export interface ScannedComponent {
  nodeId: string;
  name: string;
  page?: string | undefined;
  signature: ComponentSignature;
  baseline?: ComponentSignature | undefined;
  /** Marked "Experimental" on the set (shared plugin data dsbridge / experimental). */
  experimental?: boolean | undefined;
}

export interface ComponentChangeItem {
  nodeId: string;
  /** Coded component name ("Button"), or the proposed name for a new one. */
  component: string;
  figmaName: string;
  page?: string | undefined;
  kind: RequestKind;
  changes: RequestChange[];
  signature: ComponentSignature;
  experimental?: boolean | undefined;
}

export interface ComponentScan {
  /** Coded components that changed in a way that needs code. */
  changed: ComponentChangeItem[];
  /** Not in the design system yet: offered as new component requests, never sent on their own. */
  candidates: ComponentChangeItem[];
  /** Coded components seen for the first time: their baseline is taken silently. */
  adopt: { nodeId: string; signature: ComponentSignature }[];
  /** Only Figma-side changes (layers, auto layout): nothing to send. */
  figmaOnly: string[];
  /** Renders moved because variable values changed: those go through the variables pull request. */
  explained: string[];
  /** Coded component names, for the manual request picker. */
  coded: string[];
}

/** "Forms / Date picker" -> "datepicker": compares a Figma name with a code folder name. */
export const normalizeName = (name: string) => (name.split('/').pop() ?? name).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Proposed code name for a new component: "Forms / Date picker" -> "DatePicker". */
export function pascalName(name: string): string {
  const last = (name.split('/').pop() ?? name).trim();
  const words = last.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Component';
}

/** Component folder names under `dir` ("packages/react/src/components/Button/Button.tsx" -> "Button"). */
export function codedComponentNames(paths: string[], dir: string): string[] {
  const prefix = dir.replace(/^\/+|\/+$/g, '') + '/';
  const out = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const parts = p.slice(prefix.length).split('/');
    if (parts.length >= 2 && /^[A-Z]/.test(parts[0]!)) out.add(parts[0]!);
  }
  return [...out].sort();
}

/** What a scan found: changes to request, new component candidates, and baselines to take silently. */
export function classifyComponents(found: ScannedComponent[], coded: string[]): ComponentScan {
  const byName = new Map(coded.map((c) => [normalizeName(c), c]));
  const scan: ComponentScan = { changed: [], candidates: [], adopt: [], figmaOnly: [], explained: [], coded: [...coded].sort() };
  for (const f of found) {
    const codeName = byName.get(normalizeName(f.name));
    if (!f.baseline) {
      if (codeName) scan.adopt.push({ nodeId: f.nodeId, signature: f.signature });
      else scan.candidates.push({ nodeId: f.nodeId, component: pascalName(f.name), figmaName: f.name, page: f.page, kind: 'new-component', changes: newComponentChanges(f.signature), signature: f.signature });
      continue;
    }
    const d = diffSignatures(f.baseline, f.signature);
    if (d.kind) scan.changed.push({ nodeId: f.nodeId, component: codeName ?? pascalName(f.name), figmaName: f.name, page: f.page, kind: d.kind, changes: d.changes, signature: f.signature, ...(f.experimental ? { experimental: true } : {}) });
    else if (d.figmaOnly) scan.figmaOnly.push(f.name);
    else if (d.explainedByVariables) scan.explained.push(f.name);
  }
  return scan;
}

/** What a new component brings, as rows: its variant axes and props. */
export function newComponentChanges(s: ComponentSignature): RequestChange[] {
  const rows: RequestChange[] = Object.entries(s.variantAxes).map(([axis, values]) => ({ field: `Variant ${axis}`, after: values.join(', ') }));
  for (const p of s.properties) if (p.type !== 'VARIANT') rows.push({ field: `Prop ${p.name}`, after: `${p.type.toLowerCase().replace('_', ' ')}, default ${p.default || '(empty)'}` });
  return rows;
}

/** Prefilled one-line title for a detected change, in sentence case (draftRequestText in @bridge-ds/core). */
export function suggestTitle(item: Pick<ComponentChangeItem, 'kind' | 'changes' | 'component'>): string {
  return draftRequestText(item.component, item.kind, item.changes).title || 'Change requested from Figma';
}

/** Prefilled summary for a detected change: what changes, from the diff only (never a reason). */
export function suggestSummary(item: Pick<ComponentChangeItem, 'kind' | 'changes' | 'component'>): string {
  return draftRequestText(item.component, item.kind, item.changes).summary;
}

/** The change line of a detected change: one sentence of what changed (draftChangeLine in @bridge-ds/core). */
export function suggestLine(item: Pick<ComponentChangeItem, 'kind' | 'changes'>): string {
  return draftChangeLine(item.kind, item.changes);
}

export interface RequestDraft {
  component: string;
  kind: RequestKind;
  title: string;
  summary: string;
  /** What changed in one sentence: Claude's line, or the drafted one. */
  line?: string | undefined;
  changes: RequestChange[];
  nodeId?: string | undefined;
  nodeName?: string | undefined;
}

/** The core request for a draft. Figma URL only when the file key is known (often undefined in published plugins). */
export function toRequest(d: RequestDraft, ctx: { fileKey?: string | undefined; images?: string[]; requestedBy?: string | undefined }): ComponentChangeRequest {
  const url = ctx.fileKey && d.nodeId ? `https://www.figma.com/design/${ctx.fileKey}/?node-id=${encodeURIComponent(d.nodeId.replace(/:/g, '-'))}` : undefined;
  const figma = d.nodeId || d.nodeName ? { ...(ctx.fileKey ? { fileKey: ctx.fileKey } : {}), ...(d.nodeId ? { nodeId: d.nodeId } : {}), ...(d.nodeName ? { nodeName: d.nodeName } : {}), ...(url ? { url } : {}) } : undefined;
  return {
    component: d.component.trim(),
    kind: d.kind,
    title: d.title.trim(),
    summary: d.summary.trim(),
    ...(d.line?.trim() ? { line: d.line.trim() } : {}),
    changes: d.changes.filter((c) => c.field.trim()),
    ...(figma ? { figma } : {}),
    ...(ctx.images?.length ? { images: ctx.images } : {}),
    source: 'figma',
    ...(ctx.requestedBy ? { requestedBy: ctx.requestedBy } : {}),
  };
}

/**
 * Baselines to store after a pull: coded components seen for the first time, and components whose only differences
 * come from variables (the pull just changed their values). Pending component changes keep their old baseline, so a
 * pull never swallows a change that still needs a request. Components not in code stay candidates.
 */
export function pullBaselines(found: ScannedComponent[], coded: string[]): { nodeId: string; signature: ComponentSignature }[] {
  const names = new Set(coded.map(normalizeName));
  const out: { nodeId: string; signature: ComponentSignature }[] = [];
  for (const f of found) {
    if (!f.baseline) {
      if (names.has(normalizeName(f.name))) out.push({ nodeId: f.nodeId, signature: f.signature });
    } else if (!diffSignatures(f.baseline, f.signature).kind) out.push({ nodeId: f.nodeId, signature: f.signature });
  }
  return out;
}
