// Main thread: reads local components (sets and single components) into raw signatures data, stores baselines in
// shared plugin data, and exports PNGs to attach to requests. No network. The diff logic is in src/sync/components.ts.

import { type RawBinding, type RawComponent, type RawVariant, buildSignature, fnv1a, bindingKind, parseSignature } from '../sync/components';
import { EXPERIMENTAL_KEY, type ScannedComponentsPayload } from '../shared/messages';

const NS = 'dsbridge';
const SIGNATURE_KEY = 'signature';
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
  for (const [name, d] of Object.entries(defs)) {
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

/** Local component sets and single components (variants inside a set are read through their set). */
async function localComponents(): Promise<(ComponentSetNode | ComponentNode)[]> {
  await figma.loadAllPagesAsync();
  const nodes = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
  return nodes.filter((n) => !n.remote && !(n.type === 'COMPONENT' && n.parent?.type === 'COMPONENT_SET'));
}

export async function readComponent(node: ComponentSetNode | ComponentNode, reader = new Reader()): Promise<RawComponent> {
  const variants: RawVariant[] = [];
  const members = node.type === 'COMPONENT_SET' ? node.children.filter((c): c is ComponentNode => c.type === 'COMPONENT') : [node];
  for (const v of members) {
    variants.push({
      props: node.type === 'COMPONENT_SET' ? { ...(v.variantProperties ?? {}) } : null,
      bindings: await reader.bindings(v),
      render: await renderHash(v),
      structure: structureOf(v),
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
    saved++;
  }
  return saved;
}

/** Re-reads one component and stores its signature as the new baseline (after a request is sent). */
export async function rebaseline(nodeId: string): Promise<boolean> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return false;
  node.setSharedPluginData(NS, SIGNATURE_KEY, JSON.stringify(buildSignature(await readComponent(node))));
  return true;
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

export function selectionInfo(): { nodeId: string; name: string } | undefined {
  const s = figma.currentPage.selection[0];
  return s ? { nodeId: s.id, name: s.name } : undefined;
}
