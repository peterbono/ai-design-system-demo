// Main thread: reads local components (sets and single components) into raw signatures data, stores baselines in
// shared plugin data, and exports PNGs to attach to requests. No network. The diff logic is in src/sync/components.ts.

import { RENDER_VERSION, type ComponentSignature, type RawBinding, type RawComponent, type RawLayer, type RawVariant, buildSignature, fnv1a, bindingKind, newRawValues, parseSignature, propName, rawKey, variantKey } from '../sync/components';
import { EXPERIMENTAL_KEY, PUSHED_KEY, type ScanComponentsRequest, type ScannedComponentsPayload, type SelectionInfo } from '../shared/messages';
import { keyOfVariant } from './build-components';
import { variantKeyOf } from '@bridge-ds/core';
import { LONE_VARIANT, isRemovedValue, propsOfKey } from '../sync/component-pull';

const NS = 'dsbridge';
const SIGNATURE_KEY = 'signature';
/**
 * Private plugin data: a small PNG (base64) of the component when its baseline was taken, the "before" image Claude
 * sees when it drafts a request. Kept under Figma's plugin data size limit; skipped when larger.
 */
const BASELINE_IMAGE_KEY = 'baselineImage';
const BASELINE_IMAGE_WIDTH = 400;
const BASELINE_IMAGE_MAX = 90000;

type Progress = (message: string) => void;

function isAlias(x: unknown): x is VariableAlias {
  return !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'VARIABLE_ALIAS' && typeof (x as { id?: unknown }).id === 'string';
}

/** Every alias inside a boundVariables entry (single alias, list of aliases, or an object of them). */
function aliasesIn(value: unknown, out: VariableAlias[] = []): VariableAlias[] {
  if (isAlias(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) aliasesIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) aliasesIn(v, out);
  return out;
}

function formatResolved(v: unknown): string {
  if (v && typeof v === 'object' && 'r' in (v as RGBA)) {
    const c = v as RGBA;
    return [c.r, c.g, c.b, 'a' in c ? c.a : 1].map((x) => Math.round(x * 255)).join(',');
  }
  return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v);
}

const STYLE_FIELDS: [string, string][] = [
  ['fillStyleId', 'fill'],
  ['strokeStyleId', 'stroke'],
  ['textStyleId', 'typography'],
  ['effectStyleId', 'effect'],
];

/** "#FF00AA", or "#FF00AA80" when not opaque (the paint's opacity counts). */
function hexOf(color: RGB | RGBA, opacity = 1): string {
  const a = opacity * ('a' in color ? color.a : 1);
  const h = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(color.r)}${h(color.g)}${h(color.b)}${a < 1 ? h(a) : ''}`;
}
const numberOf = (x: number) => String(Math.round(x * 100) / 100);

/** A value set by hand on one layer: the field to bind ("fills.0", "topLeftRadius") and how it reads ("#FF00AA", "12"). */
interface RawSpot {
  kind: string;
  value: string;
  node: SceneNode;
  field: string;
}

const RADIUS_FIELDS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] as const;
const PADDING_FIELDS = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] as const;
const STROKE_WEIGHT_FIELDS = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'] as const;

/**
 * Values set by hand where a variable could be bound: solid paints, radii, paddings, gaps and stroke widths. Zero and
 * hidden paints are not values. Layers inside a nested instance belong to that component and are left out.
 */
function rawSpots(root: SceneNode): RawSpot[] {
  const out: RawSpot[] = [];
  const visit = (node: SceneNode) => {
    const n = node as unknown as Record<string, unknown>;
    const bound = (node as { boundVariables?: Record<string, unknown> }).boundVariables ?? {};
    for (const [field, kind] of [['fills', 'fill'], ['strokes', 'stroke']] as const) {
      const paints = n[field];
      if (!Array.isArray(paints)) continue;
      paints.forEach((p: Paint, i) => {
        if (p.type === 'SOLID' && p.visible !== false && !p.boundVariables?.color) out.push({ kind, value: hexOf(p.color, p.opacity), node, field: `${field}.${i}` });
      });
    }
    const numeric: [string, string][] = RADIUS_FIELDS.map((f) => [f, 'radius']);
    if (n.layoutMode && n.layoutMode !== 'NONE') {
      numeric.push(...PADDING_FIELDS.map((f): [string, string] => [f, 'padding']));
      if (n.primaryAxisAlignItems !== 'SPACE_BETWEEN') numeric.push(['itemSpacing', 'gap']);
    }
    if (Array.isArray(n.strokes) && n.strokes.some((p: Paint) => p.visible !== false)) {
      numeric.push(...(STROKE_WEIGHT_FIELDS[0] in n ? STROKE_WEIGHT_FIELDS : ['strokeWeight']).map((f): [string, string] => [f, 'stroke width']));
    }
    for (const [field, kind] of numeric) {
      const v = n[field];
      if (typeof v === 'number' && v > 0 && !bound[field]) out.push({ kind, value: numberOf(v), node, field });
    }
    if (node !== root && node.type === 'INSTANCE') return;
    if ('children' in node) for (const c of node.children) visit(c);
  };
  visit(root);
  return out;
}

/** Variable scopes that may paint each kind of value set by hand (ALL_SCOPES fits every one). */
const RAW_SCOPES: Record<string, VariableScope[]> = {
  fill: ['ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'],
  stroke: ['STROKE_COLOR'],
  radius: ['CORNER_RADIUS'],
  padding: ['GAP'],
  gap: ['GAP'],
  'stroke width': ['STROKE_FLOAT'],
};
const fits = (v: Variable, kind: string) =>
  v.resolvedType === (kind === 'fill' || kind === 'stroke' ? 'COLOR' : 'FLOAT') && v.scopes.some((s) => s === 'ALL_SCOPES' || RAW_SCOPES[kind]?.includes(s));

class Reader {
  private names = new Map<string, Variable | null>();
  private styles = new Map<string, string>();
  private locals: Promise<{ variable: Variable; primitive: boolean; component: boolean }[]> | undefined;
  /** Values set by hand of the component read last, per variant key: what `matches` looks at. */
  spots = new Map<string, RawSpot[]>();

  raw(variant: SceneNode, key: string): RawVariant['raw'] {
    const spots = rawSpots(variant);
    this.spots.set(key, spots);
    return spots.length ? spots.map(({ kind, value }) => ({ kind, value })) : undefined;
  }

  /** Local variables that may hold a value set by hand; primitives last, so a role ("radius/control") is offered first. */
  private variables(): Promise<{ variable: Variable; primitive: boolean; component: boolean }[]> {
    this.locals ??= (async () => {
      const collections = new Map((await figma.variables.getLocalVariableCollectionsAsync()).map((c) => [c.id, c.name]));
      const all = await figma.variables.getLocalVariablesAsync();
      return all
        .map((variable) => {
          const collection = collections.get(variable.variableCollectionId) ?? '';
          return { variable, primitive: /primitive/i.test(collection), component: /component/i.test(collection) };
        })
        .sort((a, b) => Number(a.primitive) - Number(b.primitive));
    })();
    return this.locals;
  }

  /**
   * For values set by hand where a variable went since the baseline: the variables whose value, read on that layer,
   * equals it (at most three each, the one it used before first). Only those, so a big file does not resolve every
   * variable on every layer.
   */
  async matches(baseline: ComponentSignature, now: ComponentSignature): Promise<Record<string, string[]> | undefined> {
    const out: Record<string, string[]> = {};
    // Another component's own tokens (checkbox/radius on a Tag) are not offered: binding one ties this set to it. The
    // variable the property used before always is (IconButton paints with button/*).
    const own = (now.name.split('/')[0] ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    for (const [key, spots] of this.spots) {
      const b = baseline.variants[key];
      const c = now.variants[key];
      if (!b || !c) continue;
      for (const kind of Object.keys(c.raw ?? {})) {
        const gone = (b.bindings[kind] ?? []).filter((v) => !(c.bindings[kind] ?? []).includes(v));
        const fresh = gone.length ? newRawValues(b, c, kind) : [];
        // The variable it used before comes first: binding it back is what most hand edits mean.
        const ranked = (await this.variables())
          .filter((x) => !x.component || x.variable.name.split('/')[0] === own || gone.includes(x.variable.name))
          .map((x) => x.variable)
          .sort((x, y) => Number(gone.includes(y.name)) - Number(gone.includes(x.name)));
        for (const spot of spots.filter((s) => s.kind === kind && fresh.includes(s.value) && !out[rawKey(kind, s.value)])) {
          const names: string[] = [];
          for (const variable of ranked) {
            if (names.length === 3) break;
            if (!fits(variable, kind)) continue;
            let value: unknown;
            try {
              value = variable.resolveForConsumer(spot.node).value;
            } catch {
              continue;
            }
            const read = value && typeof value === 'object' && 'r' in value ? hexOf(value as RGBA) : typeof value === 'number' ? numberOf(value) : undefined;
            if (read === spot.value) names.push(variable.name);
          }
          out[rawKey(kind, spot.value)] = names;
        }
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  private async variable(id: string): Promise<Variable | null> {
    if (!this.names.has(id)) this.names.set(id, await figma.variables.getVariableByIdAsync(id).catch(() => null));
    return this.names.get(id)!;
  }

  private async styleName(id: string): Promise<string> {
    if (!this.styles.has(id)) this.styles.set(id, (await figma.getStyleByIdAsync(id).catch(() => null))?.name ?? id);
    return this.styles.get(id)!;
  }

  async bindings(root: SceneNode): Promise<RawBinding[]> {
    const out: RawBinding[] = [];
    const nodes: SceneNode[] = [root, ...('findAll' in root ? root.findAll() : [])];
    for (const node of nodes) {
      const bound = (node as { boundVariables?: Record<string, unknown> }).boundVariables;
      if (bound) {
        for (const [field, value] of Object.entries(bound)) {
          for (const alias of aliasesIn(value)) {
            const v = await this.variable(alias.id);
            let resolved: string | undefined;
            try {
              resolved = v ? formatResolved(v.resolveForConsumer(node).value) : undefined;
            } catch {
              resolved = undefined;
            }
            out.push({ kind: bindingKind(field), variable: v?.name ?? alias.id, value: resolved });
          }
        }
      }
      for (const [field, kind] of STYLE_FIELDS) {
        const id = (node as unknown as Record<string, unknown>)[field];
        if (typeof id === 'string' && id) out.push({ kind, variable: `style:${await this.styleName(id)}` });
      }
    }
    return out;
  }
}

/** Layer tree shape: types, names and auto layout. Only used to tell "Figma-only changes" apart from no change. */
function structureOf(node: SceneNode): string {
  const parts: string[] = [];
  const walk = (n: SceneNode, depth: number) => {
    parts.push(`${depth}:${n.type}:${n.name}:${'layoutMode' in n ? n.layoutMode : ''}`);
    if ('children' in n) for (const c of n.children) walk(c, depth + 1);
  };
  walk(node, 0);
  return fnv1a(parts.join('\n'));
}

/** The children of a variant for its structure outline: two levels (wrappers are flattened by outlineOf). */
async function layersOf(variant: ComponentNode): Promise<RawLayer[]> {
  const read = async (n: SceneNode, depth: number): Promise<RawLayer> => {
    const refs = (n as { componentPropertyReferences?: Record<string, string> | null }).componentPropertyReferences ?? {};
    const main = n.type === 'INSTANCE' ? (await n.getMainComponentAsync().catch(() => null))?.name : undefined;
    const part = n.getSharedPluginData(NS, 'part');
    const kids = depth < 1 && n.type !== 'INSTANCE' && 'children' in n ? await Promise.all((n as ChildrenMixin).children.map((c) => read(c as SceneNode, depth + 1))) : undefined;
    return {
      name: n.name,
      type: n.type,
      ...(main ? { main } : {}),
      visible: n.visible !== false,
      ...(part ? { part } : {}),
      ...(refs.visible ? { visibleProp: propName(refs.visible) } : {}),
      ...(refs.characters ? { textProp: propName(refs.characters) } : {}),
      ...('layoutMode' in n ? { layout: n.layoutMode } : {}),
      ...(kids ? { children: kids } : {}),
    };
  };
  const out: RawLayer[] = [];
  for (const c of variant.children) out.push(await read(c, 0));
  return out;
}

/** What a painted layer looks like, read when it has it (a value Figma reports as mixed reads as "mixed"). */
const PAINT_FIELDS = [
  'blendMode', 'isMask', 'fills', 'strokes', 'strokeWeight', 'strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight',
  'strokeLeftWeight', 'strokeAlign', 'strokeCap', 'strokeJoin', 'dashPattern', 'cornerRadius', 'topLeftRadius',
  'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'cornerSmoothing', 'effects', 'characters', 'fontName',
  'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'textCase', 'textDecoration', 'textAlignHorizontal',
  'textAlignVertical', 'vectorPaths',
] as const;
const TEXT_SEGMENT_FIELDS = ['fontName', 'fontSize', 'fills', 'lineHeight', 'letterSpacing', 'textCase', 'textDecoration'] as const;

/**
 * Paints and effects with a variable bound to their color, by that variable: the color a bound paint stores is a
 * fallback Figma refreshes when it likes (adding a mode to a collection did), not what it shows. What the variable
 * resolves to is in the bindings' values.
 */
function unbound(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((p) => {
    const bound = (p as { boundVariables?: { color?: { id?: string } } }).boundVariables?.color?.id;
    if (!bound || typeof p !== 'object') return p;
    const { color: _color, ...rest } = p as Record<string, unknown>;
    return { ...rest, color: { variable: bound } };
  });
}

const shows = (list: unknown) => Array.isArray(list) && list.some((p) => (p as { visible?: boolean }).visible !== false);

/**
 * What a variant looks like: the layers that paint something, in drawing order, each with its place in the variant,
 * its size, its opacity (with its parents') and how it paints. Resolved values, so a bound variable's value counts.
 * Frames and groups that paint nothing are left out, so regrouping layers is not a new look, as with an image.
 */
function look(variant: SceneNode): unknown[] {
  const out: unknown[] = [];
  const origin = 'absoluteTransform' in variant ? variant.absoluteTransform : undefined;
  const walk = (node: SceneNode, opacity: number, dx: number, dy: number) => {
    if (node.visible === false) return;
    const n = node as unknown as Record<string, unknown>;
    const alpha = opacity * (typeof n.opacity === 'number' ? (n.opacity as number) : 1);
    const x = dx + (node === variant ? 0 : node.x);
    const y = dy + (node === variant ? 0 : node.y);
    // Clipping changes the look only when something overflows.
    const clips =
      'clipsContent' in node &&
      node.clipsContent &&
      'children' in node &&
      (node as ChildrenMixin).children.some((k) => k.visible !== false && (k.x < 0 || k.y < 0 || k.x + k.width > node.width || k.y + k.height > node.height));
    const paints = shows(n.fills) || shows(n.strokes) || shows(n.effects) || node.type === 'TEXT' || 'vectorPaths' in node || n.isMask === true;
    if (paints || clips) {
      const at = origin && 'absoluteTransform' in node ? node.absoluteTransform : undefined;
      const entry: Record<string, unknown> = {
        at: at && origin ? [at[0][0], at[0][1], at[1][0], at[1][1], at[0][2] - origin[0][2], at[1][2] - origin[1][2]] : [x, y],
        size: [node.width, node.height],
        opacity: alpha,
        ...(clips ? { clips: true } : {}),
      };
      for (const f of PAINT_FIELDS) {
        if (!(f in node)) continue;
        try {
          entry[f] = f === 'fills' || f === 'strokes' || f === 'effects' ? unbound(n[f]) : n[f];
        } catch {
          /* a field this node refuses to read */
        }
      }
      // Text with mixed styles: each run with its own.
      if (node.type === 'TEXT' && Object.values(entry).some((v) => v === figma.mixed)) {
        try {
          entry.segments = node.getStyledTextSegments([...TEXT_SEGMENT_FIELDS]);
        } catch {
          /* fonts not loaded: the mixed marks stay */
        }
      }
      out.push(entry);
    }
    if ('children' in node) for (const c of (node as ChildrenMixin).children) walk(c, alpha, x, y);
  };
  walk(variant, 1, 0, 0);
  return out;
}

/** Numbers to 2 decimals (sub-pixel noise is not a change), mixed values as "mixed". */
const lookJson = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'symbol' ? 'mixed' : typeof v === 'number' ? Math.round(v * 100) / 100 : v));

/**
 * What a variant looks like, as a hash of its layers' visual properties. An exported image did the same at about
 * 0.3 s a variant in a big file (40 minutes to scan 8800 variants); reading properties takes milliseconds.
 */
async function renderHash(node: SceneNode): Promise<string | undefined> {
  try {
    return RENDER_VERSION + fnv1a(lookJson(look(node)));
  } catch {
    return undefined;
  }
}

async function readDefinitions(node: ComponentSetNode | ComponentNode): Promise<RawComponent['definitions']> {
  let defs: ComponentPropertyDefinitions;
  try {
    defs = node.componentPropertyDefinitions;
  } catch {
    return [];
  }
  const out: RawComponent['definitions'] = [];
  const lone = node.type === 'COMPONENT_SET' && node.children.length === 1 && isLoneVariant(node.children[0]!);
  // Figma keeps property names unique across types: the swap of a part whose BOOLEAN is "Icon" becomes "Icon2" (or
  // was named "Icon (swap)"). Read under the code's name, so it compares with the spec and with older baselines.
  const baseOf = (k: string) => k.replace(/#[^#]*$/, '');
  const plain = new Set(Object.entries(defs).filter(([, d]) => d.type !== 'INSTANCE_SWAP').map(([k]) => baseOf(k)));
  const swapName = (k: string) => {
    const b = baseOf(k);
    const m = /^(.*?)(?:\d+| \(swap\))$/.exec(b);
    return m && plain.has(m[1]!) ? `${m[1]}${k.slice(b.length)}` : k;
  };
  for (const [key, d] of Object.entries(defs)) {
    const name = d.type === 'INSTANCE_SWAP' ? swapName(key) : key;
    if (lone && d.type === 'VARIANT') continue;
    let def = String(d.defaultValue);
    if (d.type === 'INSTANCE_SWAP' && typeof d.defaultValue === 'string') {
      const target = await figma.getNodeByIdAsync(d.defaultValue).catch(() => null);
      def = target?.name ?? def;
    }
    // A value only an orphan has ("tone1 (removed)") is not one of the set's values.
    out.push({ name, type: d.type, default: def, ...(d.variantOptions ? { options: d.variantOptions.filter((o) => !isRemovedValue(o)) } : {}) });
  }
  return out;
}

function pageOf(node: BaseNode): string | undefined {
  let n: BaseNode | null = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return n?.name;
}

/** Icon and slot components Bridge generates from code (Icons and Slots pages): parts of sets, never requests. */
export const isGeneratedPart = (n: BaseNode) => !!n.getSharedPluginData(NS, 'iconId') || !!n.getSharedPluginData(NS, 'slotId');

/** Local component sets and single components (variants inside a set are read through their set). */
async function localComponents(): Promise<(ComponentSetNode | ComponentNode)[]> {
  await figma.loadAllPagesAsync();
  const nodes = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
  return nodes.filter((n) => !n.remote && !(n.type === 'COMPONENT' && n.parent?.type === 'COMPONENT_SET') && !isGeneratedPart(n));
}

function insideInstance(n: BaseNode, root: BaseNode): boolean {
  for (let p = n.parent; p && p !== root; p = p.parent) if (p.type === 'INSTANCE') return true;
  return false;
}

/** Swappable parts of a variant: generated instances (shared plugin data `part`), the component they show and the default. */
async function slotsOf(variant: ComponentNode): Promise<Pick<RawVariant, 'slots' | 'slotDefaults'>> {
  const slots: Record<string, string> = {};
  const slotDefaults: Record<string, string> = {};
  for (const n of variant.findAllWithCriteria({ types: ['INSTANCE'] })) {
    const part = n.getSharedPluginData(NS, 'part');
    if (!part || insideInstance(n, variant)) continue;
    const main = await n.getMainComponentAsync().catch(() => null);
    if (main) slots[part] = main.name;
    const def = n.getSharedPluginData(NS, 'slotDefault');
    if (def) slotDefaults[part] = def;
  }
  return { ...(Object.keys(slots).length ? { slots } : {}), ...(Object.keys(slotDefaults).length ? { slotDefaults } : {}) };
}

/** A variant's properties; none for the lone variant Bridge made for a spec with no axes (LONE_VARIANT). */
function variantPropsOf(v: ComponentNode): Record<string, string> {
  if (isLoneVariant(v)) return {};
  try {
    return { ...(v.variantProperties ?? {}) };
  } catch {
    // A set Figma holds in error refuses the read: its name says the same ("Size=md, State=Hover").
    return propsOfKey(v.name);
  }
}

const isLoneVariant = (v: SceneNode) => v.type === 'COMPONENT' && v.name === LONE_VARIANT && v.getSharedPluginData(NS, 'variant') === variantKeyOf({});

export async function readComponent(node: ComponentSetNode | ComponentNode, reader = new Reader()): Promise<RawComponent> {
  const variants: RawVariant[] = [];
  const members = node.type === 'COMPONENT_SET' ? node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT') : [node];
  reader.spots.clear();
  for (const v of members) {
    const props = node.type === 'COMPONENT_SET' ? variantPropsOf(v) : null;
    const raw = reader.raw(v, variantKey(props));
    variants.push({
      props,
      bindings: await reader.bindings(v),
      ...(raw ? { raw } : {}),
      render: await renderHash(v),
      structure: structureOf(v),
      ...(await slotsOf(v)),
      layers: await layersOf(v).catch(() => undefined),
    });
  }
  return { nodeId: node.id, name: node.name, page: pageOf(node), definitions: await readDefinitions(node), variants };
}

/**
 * Variables a pull renamed (a token renamed in code): the stored baselines name the old variables, so a Push would
 * read every binding as changed in Figma. Each name equal to a renamed variable's old name becomes its new one.
 */
export async function renameInBaselines(renames: readonly { from: string; to: string }[]): Promise<number> {
  if (!renames.length) return 0;
  const map = new Map(renames.map((r) => [r.from, r.to]));
  const swap = (v: unknown): unknown => (typeof v === 'string' ? (map.get(v) ?? v) : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  let updated = 0;
  for (const node of await localComponents()) {
    const raw = node.getSharedPluginData(NS, SIGNATURE_KEY);
    if (!raw) continue;
    let next: string;
    try {
      next = JSON.stringify(swap(JSON.parse(raw)));
    } catch {
      continue;
    }
    if (next !== raw) {
      node.setSharedPluginData(NS, SIGNATURE_KEY, next);
      updated++;
    }
  }
  return updated;
}

export async function scanComponents(progress: Progress, scope: ScanComponentsRequest = {}): Promise<ScannedComponentsPayload> {
  const only = scope.nodeIds ? new Set(scope.nodeIds) : undefined;
  const skip = new Set(scope.skip ?? []);
  const nodes = (await localComponents()).filter((n) => (!only || only.has(n.id)) && !skip.has(n.id) && (!scope.withoutBaseline || !n.getSharedPluginData(NS, SIGNATURE_KEY)));
  const reader = new Reader();
  const components: ScannedComponentsPayload['components'] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (i % 5 === 0) progress(`Reading components (${i + 1} of ${nodes.length})`);
    const raw = await readComponent(node, reader);
    const experimental = node.getSharedPluginData(NS, EXPERIMENTAL_KEY) === 'true';
    const signature = buildSignature(raw);
    const baseline = parseSignature(node.getSharedPluginData(NS, SIGNATURE_KEY));
    const matches = baseline ? await reader.matches(baseline, signature) : undefined;
    components.push({ nodeId: node.id, name: node.name, page: raw.page, signature, baseline, ...(experimental ? { experimental } : {}), ...(matches ? { matches } : {}) });
  }
  return { components, fileKey: figma.fileKey };
}

/**
 * The "Experimental" mark (like Figma's "Hide when publishing"), stored on the variable or the component set so it lasts
 * across pushes and is shared with everyone working in the file. A variant marks its set.
 */
export async function setExperimental(targets: { kind: 'variable' | 'component'; id: string }[], value: boolean): Promise<number> {
  let updated = 0;
  for (const t of targets) {
    if (t.kind === 'variable') {
      const v = await figma.variables.getVariableByIdAsync(t.id);
      if (!v) continue;
      v.setSharedPluginData(NS, EXPERIMENTAL_KEY, value ? 'true' : '');
      updated++;
      continue;
    }
    let node = await figma.getNodeByIdAsync(t.id);
    if (node?.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') node = node.parent;
    if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) continue;
    node.setSharedPluginData(NS, EXPERIMENTAL_KEY, value ? 'true' : '');
    updated++;
  }
  return updated;
}

export async function saveSignatures(items: { nodeId: string; signature: string }[]): Promise<number> {
  let saved = 0;
  for (const item of items) {
    const node = await figma.getNodeByIdAsync(item.nodeId);
    if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) continue;
    // Same baseline, image already taken: nothing to write. Exporting the image takes a tenth of a second a set, so a
    // pull that refreshes every baseline of a big file only redraws the ones that changed.
    if (node.getSharedPluginData(NS, SIGNATURE_KEY) === item.signature && node.getPluginData(BASELINE_IMAGE_KEY)) {
      saved++;
      continue;
    }
    node.setSharedPluginData(NS, SIGNATURE_KEY, item.signature);
    await storeBaselineImage(node);
    saved++;
  }
  return saved;
}

/**
 * Where a component's change from Figma went (its library branch, JSON), on the set (a variant marks its set), so a
 * pull can rebuild it from the reviewed code once the branch ships. Shared plugin data: the whole team sees it.
 */
export async function markPushed(nodeId: string, mark: string): Promise<boolean> {
  let node = await figma.getNodeByIdAsync(nodeId);
  if (node?.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') node = node.parent;
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return false;
  node.setSharedPluginData(NS, PUSHED_KEY, mark);
  return true;
}

/**
 * Binds a variable where a value was set by hand: the layers of those variants whose `kind` reads `value` and has no
 * variable. Returns how many fields it bound (0 when the variable or the value is gone).
 */
export async function bindRaw(req: { nodeId: string; variants: string[]; kind: string; value: string; variable: string }): Promise<number> {
  const node = await figma.getNodeByIdAsync(req.nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return 0;
  const variable = (await figma.variables.getLocalVariablesAsync()).find((v) => v.name === req.variable && fits(v, req.kind));
  if (!variable) return 0;
  const members = node.type === 'COMPONENT_SET' ? node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT') : [node];
  let bound = 0;
  for (const v of members) {
    if (!req.variants.includes(variantKey(node.type === 'COMPONENT_SET' ? variantPropsOf(v) : null))) continue;
    for (const spot of rawSpots(v).filter((s) => s.kind === req.kind && s.value === req.value)) {
      const [field, index] = spot.field.split('.');
      if (index !== undefined) {
        const target = spot.node as GeometryMixin & SceneNode;
        const paints = [...(target[field as 'fills' | 'strokes'] as Paint[])];
        paints[Number(index)] = figma.variables.setBoundVariableForPaint(paints[Number(index)] as SolidPaint, 'color', variable);
        target[field as 'fills' | 'strokes'] = paints;
      } else spot.node.setBoundVariable(field as VariableBindableNodeField, variable);
      bound++;
    }
  }
  return bound;
}

/** Re-reads one component and stores its signature as the new baseline (after a request is sent). */
export async function rebaseline(nodeId: string): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return false;
  node.setSharedPluginData(NS, SIGNATURE_KEY, JSON.stringify(buildSignature(await readComponent(node))));
  await storeBaselineImage(node);
  return true;
}

/** Stores the baseline thumbnail next to the signature. A failed export only means no "before" image later. */
async function storeBaselineImage(node: ComponentSetNode | ComponentNode): Promise<void> {
  try {
    const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: BASELINE_IMAGE_WIDTH } });
    const base64 = figma.base64Encode(bytes);
    node.setPluginData(BASELINE_IMAGE_KEY, base64.length <= BASELINE_IMAGE_MAX ? base64 : '');
  } catch {
    /* no thumbnail: drafts go without a before image */
  }
}

/** The thumbnail stored with a component's baseline, or undefined when none was taken. */
export async function baselineImage(nodeId: string): Promise<string | undefined> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return undefined;
  return node.getPluginData(BASELINE_IMAGE_KEY) || undefined;
}

/**
 * PNG (2x, base64) to attach to a request. With `nodeId`: the selected variant when the selection is inside that
 * component, else the component itself. Without: the current selection. Undefined when there is nothing to export.
 */
export async function exportImage(nodeId: string | undefined): Promise<{ base64: string; name: string } | undefined> {
  const selected = figma.currentPage.selection[0];
  let target: SceneNode | undefined;
  if (nodeId) {
    const root = await figma.getNodeByIdAsync(nodeId);
    if (!root || !('exportAsync' in root)) return undefined;
    let n: BaseNode | null = selected ?? null;
    while (n && n.id !== nodeId && !(n.type === 'COMPONENT' && n.parent?.id === nodeId)) n = n.parent;
    target = n && n.id !== nodeId && n.type === 'COMPONENT' ? (n as ComponentNode) : (root as SceneNode);
  } else target = selected;
  if (!target) return undefined;
  const bytes = await target.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
  return { base64: figma.base64Encode(bytes), name: target.name };
}

/** PNG thumbnails (base64) of nodes, `width` CSS pixels wide at 2x, for the Pull "Review updates" before and after. */
export async function exportThumbnails(nodeIds: string[], width: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !('exportAsync' in node)) continue;
    try {
      const bytes = await (node as SceneNode).exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: Math.round(width * 2) } });
      out[id] = figma.base64Encode(bytes);
    } catch {
      /* a node Figma cannot export: no thumbnail, the change list still shows */
    }
  }
  return out;
}

/**
 * The selection, and when it is a variant of a set Bridge built from code, which one: its code image can stand as the
 * "before" of a request (the export of the variant is the "after").
 */
export function selectionInfo(): SelectionInfo | undefined {
  const s = figma.currentPage.selection[0];
  if (!s) return undefined;
  const set = s.type === 'COMPONENT' && s.parent?.type === 'COMPONENT_SET' ? s.parent : undefined;
  const componentId = set?.getSharedPluginData(NS, 'componentId');
  return { nodeId: s.id, name: s.name, ...(componentId ? { generated: { componentId, variant: keyOfVariant(s as ComponentNode) } } : {}) };
}
