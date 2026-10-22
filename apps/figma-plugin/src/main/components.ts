// Main thread: reads local components (sets and single components) into raw signatures data, stores baselines in
// shared plugin data, and exports PNGs to attach to requests. No network. The diff logic is in src/sync/components.ts.

import { type RawBinding, type RawComponent, type RawLayer, type RawVariant, buildSignature, fnv1a, bindingKind, parseSignature, propName } from '../sync/components';
import { EXPERIMENTAL_KEY, PUSHED_KEY, type ScannedComponentsPayload } from '../shared/messages';
import { variantKeyOf } from '@bridge-ds/core';
import { LONE_VARIANT } from '../sync/component-pull';

const NS = 'dsbridge';
const SIGNATURE_KEY = 'signature';
/**
 * Private plugin data: a small PNG (base64) of the component when its baseline was taken, the "before" image Claude
 * sees when it drafts a request. Kept under Figma's plugin data size limit; skipped when larger.
 */
const BASELINE_IMAGE_KEY = 'baselineImage';
const BASELINE_IMAGE_WIDTH = 400;
const BASELINE_IMAGE_MAX = 90000;
/** Scale of the render hash export: small enough to stay fast, large enough to see a 1px change. */
const HASH_SCALE = 1;

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

class Reader {
  private names = new Map<string, Variable | null>();
  private styles = new Map<string, string>();

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

async function renderHash(node: SceneNode): Promise<string | undefined> {
  try {
    return fnv1a(await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: HASH_SCALE } }));
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
  for (const [name, d] of Object.entries(defs)) {
    if (lone && d.type === 'VARIANT') continue;
    let def = String(d.defaultValue);
    if (d.type === 'INSTANCE_SWAP' && typeof d.defaultValue === 'string') {
      const target = await figma.getNodeByIdAsync(d.defaultValue).catch(() => null);
      def = target?.name ?? def;
    }
    out.push({ name, type: d.type, default: def, ...(d.variantOptions ? { options: [...d.variantOptions] } : {}) });
  }
  return out;
}

function pageOf(node: BaseNode): string | undefined {
  let n: BaseNode | null = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return n?.name;
}

/** Icon and slot components DS Bridge generates from code (Icons and Slots pages): parts of sets, never requests. */
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

/** A variant's properties; none for the lone variant DS Bridge made for a spec with no axes (LONE_VARIANT). */
function variantPropsOf(v: ComponentNode): Record<string, string> {
  return isLoneVariant(v) ? {} : { ...(v.variantProperties ?? {}) };
}

const isLoneVariant = (v: SceneNode) => v.type === 'COMPONENT' && v.name === LONE_VARIANT && v.getSharedPluginData(NS, 'variant') === variantKeyOf({});

export async function readComponent(node: ComponentSetNode | ComponentNode, reader = new Reader()): Promise<RawComponent> {
  const variants: RawVariant[] = [];
  const members = node.type === 'COMPONENT_SET' ? node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT') : [node];
  for (const v of members) {
    variants.push({
      props: node.type === 'COMPONENT_SET' ? variantPropsOf(v) : null,
      bindings: await reader.bindings(v),
      render: await renderHash(v),
      structure: structureOf(v),
      ...(await slotsOf(v)),
      layers: await layersOf(v).catch(() => undefined),
    });
  }
  return { nodeId: node.id, name: node.name, page: pageOf(node), definitions: await readDefinitions(node), variants };
}

export async function scanComponents(progress: Progress): Promise<ScannedComponentsPayload> {
  const nodes = await localComponents();
  const reader = new Reader();
  const components: ScannedComponentsPayload['components'] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (i % 5 === 0) progress(`Reading components (${i + 1} of ${nodes.length})`);
    const raw = await readComponent(node, reader);
    const experimental = node.getSharedPluginData(NS, EXPERIMENTAL_KEY) === 'true';
    components.push({ nodeId: node.id, name: node.name, page: raw.page, signature: buildSignature(raw), baseline: parseSignature(node.getSharedPluginData(NS, SIGNATURE_KEY)), ...(experimental ? { experimental } : {}) });
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

export function selectionInfo(): { nodeId: string; name: string } | undefined {
  const s = figma.currentPage.selection[0];
  return s ? { nodeId: s.id, name: s.name } : undefined;
}
