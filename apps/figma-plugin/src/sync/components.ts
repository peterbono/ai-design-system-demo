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
// - Structure: each variant keeps a normalized layer outline (the root's children, wrappers one level deep flattened,
//   so a regroup is not a change). A layer added, removed or moved is a "structure" request when the variant's render
//   moved with it or the layer is part of the API (its visibility or text is bound to a property). Renames, and hidden
//   layers bound to nothing, are not. Parts Bridge generated are known by their part id (a swap or rename of one is
//   not a structure change: swaps are compared above). An added part that an optional part of the component already
//   draws in that place (an icon after the label while "Icon end" exists) gets a hint, and starts unchecked.

import { type ComponentChangeRequest, type RequestChange, type RequestKind, draftChangeLine, draftRequestText } from '@bridge-ds/core';

/** One layer of a variant as the main thread reads it, for the structure outline. */
export interface RawLayer {
  name: string;
  /** Figma node type: INSTANCE, TEXT, FRAME, GROUP, VECTOR... */
  type: string;
  /** Main component name of an instance ("Icon/Pencil"). */
  main?: string | undefined;
  visible: boolean;
  /** Part id when Bridge generated the layer (shared plugin data dsbridge / part). */
  part?: string | undefined;
  /** BOOLEAN property its visibility is bound to ("Icon end"), without Figma's "#id". */
  visibleProp?: string | undefined;
  /** TEXT property its characters are bound to. */
  textProp?: string | undefined;
  /** Auto layout of a frame (HORIZONTAL, VERTICAL, NONE). */
  layout?: string | undefined;
  /** Children of a frame or group (not of an instance). */
  children?: RawLayer[] | undefined;
}

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
  /** Children of the variant: the structure outline is built from them. */
  layers?: RawLayer[] | undefined;
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
  /** Normalized layer outline, in order (see outlineOf). Missing in baselines taken by older plugins. */
  outline?: string[] | undefined;
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
/**
 * Prefix of the render hash read from layer properties. Renders without it are image hashes from an older Bridge:
 * the two never compare (an old baseline reads as one without a render until the next pull or send stores a new one).
 */
export const RENDER_VERSION = 'v2:';
const comparable = (a: string | undefined, b: string | undefined) => !!a && !!b && a.startsWith(RENDER_VERSION) === b.startsWith(RENDER_VERSION);

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

// ---------------------------------------------------------------------------------------------
// Structure outline

/** One outline entry, read back from its compact form. */
export interface OutlineItem {
  /** What the layer is, renames aside: "part:<id>" for a generated part, else "<type>:<main component>". */
  id: string;
  type: string;
  main?: string | undefined;
  visible: boolean;
  /** BOOLEAN property that shows it: an optional part. */
  visibleProp?: string | undefined;
  /** TEXT property its characters come from. */
  textProp?: string | undefined;
  name: string;
}

const CONTAINERS = new Set(['FRAME', 'GROUP', 'SECTION']);
const enc = (s: string | undefined) => (s ?? '').replace(/[|\n]/g, ' ');

export function encodeOutlineItem(i: OutlineItem): string {
  return [i.id, i.type, i.main, i.visible ? '1' : '0', i.visibleProp, i.textProp, i.name].map(enc).join('|');
}

export function decodeOutlineItem(s: string): OutlineItem {
  const [id = '', type = '', main = '', vis = '1', visibleProp = '', textProp = '', ...name] = s.split('|');
  return { id, type, ...(main ? { main } : {}), visible: vis === '1', ...(visibleProp ? { visibleProp } : {}), ...(textProp ? { textProp } : {}), name: name.join('|') };
}

/**
 * The structure outline of a variant: its children in order, with the children of a wrapper (a frame or group with
 * children, auto layout or not) listed in its place one level deep, so wrapping or unwrapping layers is not a change.
 * Hidden layers bound to no property are left out: they neither render nor belong to the API.
 */
export function outlineOf(layers: RawLayer[] | undefined): string[] | undefined {
  if (!layers) return undefined;
  const out: OutlineItem[] = [];
  const add = (l: RawLayer) => {
    if (!l.visible && !l.visibleProp) return;
    const id = l.part ? `part:${l.part}` : `${l.type}:${l.type === 'INSTANCE' ? (l.main ?? '') : ''}`;
    out.push({ id, type: l.type, ...(l.main ? { main: l.main } : {}), visible: l.visible, ...(l.visibleProp ? { visibleProp: l.visibleProp } : {}), ...(l.textProp ? { textProp: l.textProp } : {}), name: l.name });
  };
  for (const l of layers) {
    if (CONTAINERS.has(l.type) && l.children?.length && !l.part && !l.visibleProp) {
      if (!l.visible) continue;
      for (const c of l.children) add(c);
    } else add(l);
  }
  return out.map(encodeOutlineItem);
}

export interface StructureChange {
  op: 'added' | 'removed' | 'moved';
  item: OutlineItem;
  /** Where it sits (added, moved) or sat (removed): `after "Label"`, `before "Label"`, `alone`. */
  at: string;
  /** Moved: where it sat before. */
  from?: string | undefined;
  /** An optional part already draws this (added only): the hint for the designer. */
  equivalent?: { name: string; property: string } | undefined;
}

/** Longest common subsequence of two id lists: index pairs, in order. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** `after "Label"`: the nearest neighbour that renders, else any neighbour, else `alone`. */
function placeIn(list: OutlineItem[], index: number): string {
  const shown = (x: OutlineItem | undefined) => !!x && x.visible;
  for (let i = index - 1; i >= 0; i--) if (shown(list[i])) return `after "${list[i]!.name}"`;
  for (let i = index + 1; i < list.length; i++) if (shown(list[i])) return `before "${list[i]!.name}"`;
  if (index > 0) return `after "${list[index - 1]!.name}"`;
  if (index + 1 < list.length) return `before "${list[index + 1]!.name}"`;
  return 'alone';
}

/** Same kind of slot: an instance for an instance part, a text for a text part. */
const sameSlot = (a: OutlineItem, b: OutlineItem) => (a.type === 'INSTANCE' ? b.type === 'INSTANCE' : a.type === 'TEXT' ? b.type === 'TEXT' : a.type === b.type);

/**
 * An optional part of the baseline (shown by a BOOLEAN property) that already draws an added layer: same kind of
 * slot, in the same place between the layers both sides keep (an icon after the label vs "Icon end").
 */
function equivalentPart(base: OutlineItem[], cur: OutlineItem[], kept: [number, number][], added: number): { name: string; property: string } | undefined {
  const item = cur[added]!;
  if (item.visibleProp) return undefined;
  const keptCur = new Map(kept.map(([b, c]) => [c, b]));
  const anchor = (from: number, step: number) => {
    for (let j = from; j >= 0 && j < cur.length; j += step) {
      const b = keptCur.get(j);
      if (b !== undefined && !cur[j]!.visibleProp) return b;
    }
    return undefined;
  };
  const prev = anchor(added - 1, -1);
  const next = anchor(added + 1, 1);
  const lo = prev ?? -1;
  const hi = next ?? base.length;
  const optional = (x: OutlineItem) => !!x.visibleProp && sameSlot(item, x);
  const between = base.slice(lo + 1, hi).find(optional);
  // A text can also go where the component already has an optional text, wherever it sits.
  const hit = between ?? (item.type === 'TEXT' ? base.find(optional) : undefined);
  return hit ? { name: hit.name, property: hit.visibleProp! } : undefined;
}

/** Layers added, removed or moved between two outlines (renames are not changes: ids leave names out). */
export function diffOutlines(base: string[], cur: string[]): StructureChange[] {
  const b = base.map(decodeOutlineItem);
  const c = cur.map(decodeOutlineItem);
  const kept = lcs(b.map((x) => x.id), c.map((x) => x.id));
  const keptB = new Set(kept.map(([i]) => i));
  const keptC = new Set(kept.map(([, j]) => j));
  const removed = b.map((x, i) => ({ x, i })).filter(({ i }) => !keptB.has(i));
  const added = c.map((x, j) => ({ x, j })).filter(({ j }) => !keptC.has(j));
  const out: StructureChange[] = [];
  const movedB = new Set<number>();
  for (const a of added) {
    const r = removed.find((x) => x.x.id === a.x.id && !movedB.has(x.i));
    if (r) {
      movedB.add(r.i);
      out.push({ op: 'moved', item: a.x, at: placeIn(c, a.j), from: placeIn(b, r.i) });
      continue;
    }
    const eq = equivalentPart(b, c, kept, a.j);
    out.push({ op: 'added', item: a.x, at: placeIn(c, a.j), ...(eq ? { equivalent: eq } : {}) });
  }
  for (const r of removed) if (!movedB.has(r.i)) out.push({ op: 'removed', item: r.x, at: placeIn(b, r.i) });
  return out;
}

/** True when a structure change touches the API: the layer's visibility or text is bound to a property. */
const touchesApi = (s: StructureChange) => !!(s.item.visibleProp || s.item.textProp);

/** "instance Icon/Pencil": the kind of layer in words, for a change row. */
const layerShape = (i: OutlineItem) => `${i.type.toLowerCase().replace(/_/g, ' ')}${i.type === 'INSTANCE' && i.main ? ` ${i.main}` : ''}`;

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
      ...(v.layers ? { outline: outlineOf(v.layers) } : {}),
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
  /**
   * Added layers an optional part of the component already draws, one sentence each ("Icon end already does this:
   * show it with the Icon end property"). Empty when there are none.
   */
  equivalents: string[];
  /** Every change is an added layer an optional part already draws: the item starts unchecked. */
  onlyEquivalents: boolean;
}

const list = (xs: string[] | undefined) => (xs?.length ? xs.join(', ') : '');
/** Figma variable name to token path: "color/action/primary/bg" -> "color.action.primary.bg". */
export const tokenName = (variable: string) => (variable.startsWith('style:') ? `${variable.slice(6)} (style)` : variable.replace(/\//g, '.'));

const KIND_ORDER: RequestKind[] = ['new-variant', 'prop-change', 'structure', 'token-binding', 'visual'];

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
  // A variant added or removed whose values all stay on their axes (Tone=info, Size=md removed while info and md stay
  // for the others): the axes above cannot see it. Combinations an axis change explains are left to that row.
  const onAxes = (key: string, s: ComponentSignature) => key.split(', ').every((pair) => {
    const at = pair.indexOf('=');
    return at > 0 && (s.variantAxes[pair.slice(0, at)] ?? []).includes(pair.slice(at + 1));
  });
  const gone = Object.keys(base.variants).filter((k) => k && !cur.variants[k] && onAxes(k, cur)).sort();
  const born = Object.keys(cur.variants).filter((k) => k && !base.variants[k] && onAxes(k, base)).sort();
  if (gone.length || born.length) {
    kinds.add('new-variant');
    changes.push({ field: 'Variants', before: gone.length ? gone.join('; ') : undefined, after: born.length ? born.join('; ') : undefined });
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
  const layerRows = new Map<string, { change: StructureChange; variants: string[] }>();
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
    // Layers added, removed or moved: a change when the render moved with them or they belong to the API.
    const renderMoved = !comparable(b.render, c.render) || b.render !== c.render;
    const layers = b.outline && c.outline ? diffOutlines(b.outline, c.outline).filter((x) => renderMoved || touchesApi(x)) : [];
    for (const x of layers) {
      const id = [x.op, x.item.id, x.item.name, x.at, x.from ?? ''].join('\u0000');
      const row = layerRows.get(id) ?? { change: x, variants: [] };
      row.variants.push(key);
      layerRows.set(id, row);
    }
    let rebound = false;
    for (const kind of sortedUnique([...Object.keys(b.bindings), ...Object.keys(c.bindings)])) {
      if (list(b.bindings[kind]?.map(tokenName)) === list(c.bindings[kind]?.map(tokenName))) continue;
      // Only what moved: a variable kept on another layer of the same kind (the text color of a fill) is not part of it.
      const was = (b.bindings[kind] ?? []).map(tokenName);
      const now = (c.bindings[kind] ?? []).map(tokenName);
      const before = list(was.filter((v) => !now.includes(v)));
      const after = list(now.filter((v) => !was.includes(v)));
      // Variables an added layer brings (or a removed one takes away) move with that layer: not a rebinding.
      const bs = b.bindings[kind] ?? [];
      const cs = c.bindings[kind] ?? [];
      if (layers.some((x) => x.op === 'added') && bs.every((v) => cs.includes(v))) continue;
      if (layers.some((x) => x.op === 'removed') && cs.every((v) => bs.includes(v))) continue;
      rebound = true;
      const id = `${kind}\u0000${before}\u0000${after}`;
      const row = bindingRows.get(id) ?? { kind, before, after, variants: [] };
      row.variants.push(key);
      bindingRows.set(id, row);
    }
    // A layer change explains the new render of its variant, like a rebinding does.
    if (rebound || layers.length) continue;
    if (comparable(b.render, c.render) && b.render !== c.render) {
      if (b.values !== c.values) explained = true;
      else visual.push(key);
    }
    if (b.structure && c.structure && b.structure !== c.structure) structure = true;
  }
  const equivalents: string[] = [];
  let layerChanges = 0;
  let equivalentChanges = 0;
  for (const { change: x, variants } of layerRows.values()) {
    kinds.add('structure');
    layerChanges++;
    const all = variants.length === common.length && common.length > 1;
    const where = all ? '' : ` (${variants.join('; ')})`;
    const field = `${x.op === 'added' ? 'New' : x.op === 'removed' ? 'Removed' : 'Moved'} layer "${x.item.name}"${where}`;
    if (x.op === 'moved') changes.push({ field, before: x.from, after: x.at });
    else if (x.op === 'added') changes.push({ field, after: `${layerShape(x.item)}, ${x.at}` });
    else changes.push({ field, before: `${layerShape(x.item)}, ${x.at}` });
    if (x.equivalent) {
      equivalentChanges++;
      // The property as Figma names it: "Show icon end" reads as an instruction, "the Icon end property" did not.
      const text = /^Show /.test(x.equivalent.property)
        ? `${x.equivalent.name} already does this: turn on ${x.equivalent.property}`
        : `${x.equivalent.name} already does this: show it with the ${x.equivalent.property} property`;
      if (!equivalents.includes(text)) equivalents.push(text);
    }
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
  return {
    changes,
    kind,
    figmaOnly: !kind && structure,
    explainedByVariables: !kind && explained,
    equivalents,
    onlyEquivalents: equivalentChanges > 0 && equivalentChanges === layerChanges && changes.length === layerChanges,
  };
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
  /** What code gave Figma at the last pull (or the last push): the "before" of a push from Figma. */
  baseline?: ComponentSignature | undefined;
  experimental?: boolean | undefined;
  /** An optional part already draws what was added: shown on the row as a hint (never applied to the file). */
  equivalent?: string | undefined;
  /** Every change is such an addition: the item starts unchecked, checking it sends the request anyway. */
  suggestSkip?: boolean | undefined;
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
    if (d.kind)
      scan.changed.push({
        nodeId: f.nodeId,
        component: codeName ?? pascalName(f.name),
        figmaName: f.name,
        page: f.page,
        kind: d.kind,
        changes: d.changes,
        signature: f.signature,
        baseline: f.baseline,
        ...(f.experimental ? { experimental: true } : {}),
        ...(d.equivalents.length ? { equivalent: d.equivalents.join('. ') } : {}),
        ...(d.onlyEquivalents ? { suggestSkip: true } : {}),
      });
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
