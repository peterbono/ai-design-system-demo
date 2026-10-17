// Main thread: builds or updates the component sets of a component pull plan (src/sync/component-pull.ts) on the
// "Components" page, bound to the variables a pull wrote. No network.
//
// Idempotent: a set is found by shared plugin data (dsbridge / componentId), a variant by (dsbridge / variant), a layer
// by (dsbridge / part). Re-pulling updates them in place (same node ids, so instances keep their overrides), adds new
// variants, and flags variants removed in code with "[orphan]". Layers DS Bridge did not create are never removed.
//
// Swappable parts (icons, content slots) are instances of generated components: one COMPONENT per icon ("Icon/Plus")
// on the Icons page (dsbridge / iconId) and one per content slot ("Slot/Media") on the Slots page (dsbridge / slotId),
// swapped through INSTANCE_SWAP properties whose preferred values list them, like a Figma library.

import { variantKeyOf } from '@bridge-ds/core';
import type { SpecField, SpecPart } from '@bridge-ds/core';
import type { ComponentApplyReport, ComponentPullPlan, GeneratedSet, PlannedComponent, PlannedField, PlannedIcon, PlannedSlot, PlannedValue, PlannedVariant } from '../sync/component-pull';
import { buildSignature } from '../sync/components';
import { readComponent } from './components';

const NS = 'dsbridge';
const ORPHAN_PREFIX = '[orphan] ';
const PAGE_NAME = 'Components';
const ICONS_PAGE = 'Icons';
const SLOTS_PAGE = 'Slots';
/** Icons page grid: cell pitch and columns (layout of the page, not a design value). */
const ICON_CELL = 72;
const ICON_COLUMNS = 8;
/** Canvas spacing between generated sets and variants (layout of the page, not a design value). */
const GAP = 24;
const SET_GAP = 96;

type Progress = (message: string) => void;
type Box = FrameNode | ComponentNode;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function pageOf(node: BaseNode): PageNode | undefined {
  let n: BaseNode | null = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return (n as PageNode | null) ?? undefined;
}

async function generatedSets(): Promise<ComponentSetNode[]> {
  await figma.loadAllPagesAsync();
  return figma.root.findAllWithCriteria({ types: ['COMPONENT_SET'] }).filter((s) => !!s.getSharedPluginData(NS, 'componentId'));
}

/** Component sets DS Bridge generated, for the pull preview (new, updated or unchanged). */
export async function scanGenerated(): Promise<GeneratedSet[]> {
  return (await generatedSets()).map((s) => ({
    componentId: s.getSharedPluginData(NS, 'componentId'),
    nodeId: s.id,
    name: s.name,
    page: pageOf(s)?.name,
    specHash: s.getSharedPluginData(NS, 'specHash'),
    variants: s.children
      .filter((c): c is ComponentNode => c.type === 'COMPONENT' && c.getSharedPluginData(NS, 'orphan') !== 'true')
      .map((c) => c.getSharedPluginData(NS, 'variant') || variantKeyOf(c.variantProperties ?? {})),
  }));
}

// ---------------------------------------------------------------------------------------------
// Variables and fonts

class Variables {
  private collections = new Map<string, VariableCollection>();
  private all: Variable[] = [];
  private cache = new Map<string, Variable | null>();

  async load(): Promise<void> {
    for (const c of await figma.variables.getLocalVariableCollectionsAsync()) if (!c.remote) this.collections.set(c.id, c);
    this.all = (await figma.variables.getLocalVariablesAsync()).filter((v) => this.collections.has(v.variableCollectionId));
  }

  /** The variable of a token in its tier's collection ("Semantic", or "Semantic/Light" in the split layout), by id then name. */
  find(v: Extract<PlannedValue, { kind: 'variable' }>): Variable | undefined {
    const key = `${v.collection}|${v.tokenId}|${v.name}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? undefined;
    const ids = [...this.collections.values()]
      .filter((c) => c.name === v.collection || c.name.startsWith(`${v.collection}/`))
      .sort((a, b) => Number(b.name === v.collection) - Number(a.name === v.collection))
      .map((c) => c.id);
    let found: Variable | undefined;
    for (const id of ids) {
      const inColl = this.all.filter((x) => x.variableCollectionId === id);
      found = inColl.find((x) => x.getPluginData('id') === v.tokenId) ?? inColl.find((x) => x.name === v.name);
      if (found) break;
    }
    this.cache.set(key, found ?? null);
    return found;
  }
}

const WEIGHT_STYLES: Record<number, string[]> = {
  100: ['Thin', 'Hairline'],
  200: ['ExtraLight', 'Extra Light', 'UltraLight'],
  300: ['Light'],
  400: ['Regular', 'Normal', 'Book'],
  500: ['Medium'],
  600: ['SemiBold', 'Semi Bold', 'Semibold', 'DemiBold'],
  700: ['Bold'],
  800: ['ExtraBold', 'Extra Bold', 'UltraBold'],
  900: ['Black', 'Heavy'],
};

class Fonts {
  /** Lowercased family -> its real name and styles. */
  private available = new Map<string, { family: string; styles: string[] }>();
  private loaded = new Set<string>();
  missing = new Set<string>();

  async load(): Promise<void> {
    for (const f of await figma.listAvailableFontsAsync()) {
      const k = f.fontName.family.toLowerCase();
      const entry = this.available.get(k) ?? { family: f.fontName.family, styles: [] };
      entry.styles.push(f.fontName.style);
      this.available.set(k, entry);
    }
  }

  /** First family of the CSS stack installed in Figma, else Inter (noted once in the report). */
  private pick(families: string[]): { family: string; styles: string[] } {
    for (const f of families) {
      const hit = this.available.get(f.toLowerCase());
      if (hit) return hit;
    }
    // CSS generic families (system-ui, sans-serif) are not installable fonts: name the brand font that was missing.
    const brand = families.find((f) => !/^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-[\w-]+|segoe ui|roboto|helvetica|arial)$/i.test(f));
    if (brand) this.missing.add(brand.replace(/ Variable$/, ''));
    return this.available.get('inter') ?? { family: 'Inter', styles: ['Regular', 'Medium', 'Semi Bold', 'Bold'] };
  }

  async font(families: string[] | undefined, weight: number | undefined): Promise<FontName> {
    const { family, styles } = this.pick(families?.length ? families : ['Inter']);
    const w = weight ? Math.min(900, Math.max(100, Math.round(weight / 100) * 100)) : 400;
    const style =
      (WEIGHT_STYLES[w] ?? []).map((s) => styles.find((x) => x.toLowerCase() === s.toLowerCase())).find(Boolean) ??
      styles.find((s) => /^regular$/i.test(s)) ??
      styles[0] ??
      'Regular';
    const fontName = { family, style };
    const key = `${family}|${style}`;
    if (!this.loaded.has(key)) {
      await figma.loadFontAsync(fontName);
      this.loaded.add(key);
    }
    return fontName;
  }
}

// ---------------------------------------------------------------------------------------------
// Fields

const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] as const;
const FRAME_FIELDS: SpecField[] = [
  'fill',
  'stroke',
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'cornerRadius',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'width',
  'height',
  'minWidth',
  'minHeight',
];
const TEXT_FIELDS: SpecField[] = ['textFill', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const ICON_FIELDS: SpecField[] = ['width', 'height', 'stroke', 'strokeWeight'];

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };

interface Ctx {
  vars: Variables;
  fonts: Fonts;
  problems: string[];
  where: string;
  /** Generated icon and slot components by name ("Icon/Plus", "Slot/Media"). */
  parts: Map<string, ComponentNode>;
  /** Icon component names, in order: the preferred values of every icon swap. */
  icons: string[];
}

type Bindable = { setBoundVariable(field: string, variable: Variable | null): void };

function bind(node: SceneNode, field: string, variable: Variable | null): void {
  (node as unknown as Bindable).setBoundVariable(field, variable);
}

/** Resets a field DS Bridge manages to its neutral value (no binding), before the variant's own value is applied. */
function reset(node: SceneNode, field: SpecField): void {
  const n = node as unknown as Record<string, unknown>;
  try {
    switch (field) {
      case 'fill':
      case 'textFill':
        if (field === 'fill' && node.type === 'TEXT') return;
        n.fills = field === 'textFill' ? [BLACK] : [];
        return;
      case 'stroke':
        n.strokes = [];
        return;
      case 'cornerRadius':
        for (const c of CORNERS) bind(node, c, null);
        n.cornerRadius = 0;
        return;
      case 'width':
      case 'height':
        bind(node, field, null);
        return;
      case 'minWidth':
      case 'minHeight':
        bind(node, field, null);
        n[field] = null;
        return;
      case 'lineHeight':
        bind(node, field, null);
        n.lineHeight = { unit: 'AUTO' };
        return;
      case 'letterSpacing':
        bind(node, field, null);
        n.letterSpacing = { unit: 'PERCENT', value: 0 };
        return;
      case 'fontSize':
      case 'fontWeight':
        bind(node, field, null);
        return;
      default:
        bind(node, field, null);
        n[field] = 0;
    }
  } catch {
    /* a field the node does not have (stroke weights on text): nothing to reset */
  }
}

function apply(node: SceneNode, f: PlannedField, ctx: Ctx): void {
  const n = node as unknown as Record<string, unknown>;
  const v = f.value;
  const fail = (why: string): void => {
    ctx.problems.push(`${ctx.where}, ${f.field}: ${why}`);
  };
  try {
    if (v.kind === 'none') {
      if (f.field === 'stroke') n.strokes = [];
      else n.fills = [];
      return;
    }
    if (v.kind === 'number') {
      if (f.field === 'cornerRadius') n.cornerRadius = v.value;
      else n[f.field] = v.value;
      return;
    }
    if (v.kind === 'percent') {
      n[f.field] = { unit: 'PERCENT', value: v.value };
      return;
    }
    if (v.kind === 'font') return; // fontName is set with the text, from the family list
    const variable = ctx.vars.find(v);
    if (!variable) return fail(`no variable "${v.name}" in ${v.collection}. Pull the variables, then pull components again.`);
    if (variable.resolvedType !== v.resolvedType) return fail(`"${v.name}" is a ${variable.resolvedType} variable, expected ${v.resolvedType}.`);
    switch (f.field) {
      case 'fill':
      case 'textFill':
        n.fills = [figma.variables.setBoundVariableForPaint(BLACK, 'color', variable)];
        return;
      case 'stroke':
        n.strokes = [figma.variables.setBoundVariableForPaint(BLACK, 'color', variable)];
        return;
      case 'cornerRadius':
        for (const c of CORNERS) bind(node, c, variable);
        return;
      case 'width':
      case 'height':
        if ('layoutSizingHorizontal' in node && node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE') {
          if (f.field === 'width') node.layoutSizingHorizontal = 'FIXED';
          else node.layoutSizingVertical = 'FIXED';
        } else if ('layoutMode' in node && node.layoutMode !== 'NONE') {
          const horizontal = node.layoutMode === 'HORIZONTAL';
          if ((f.field === 'width') === horizontal) node.primaryAxisSizingMode = 'FIXED';
          else node.counterAxisSizingMode = 'FIXED';
        }
        bind(node, f.field, variable);
        return;
      default:
        bind(node, f.field, variable);
    }
  } catch (err) {
    fail(errorText(err));
  }
}

// ---------------------------------------------------------------------------------------------
// Nodes

function findPart(variant: ComponentNode, id: string): SceneNode | undefined {
  if (id === 'root') return variant;
  return variant.findOne((n) => n.getSharedPluginData(NS, 'part') === id) ?? undefined;
}

function setupFrame(node: Box, part: SpecPart): void {
  const l = part.layout ?? { direction: 'HORIZONTAL', primary: 'MIN', counter: 'MIN' };
  node.layoutMode = l.direction;
  node.primaryAxisAlignItems = l.primary;
  node.counterAxisAlignItems = l.counter === 'STRETCH' ? 'MIN' : l.counter;
  node.primaryAxisSizingMode = 'AUTO';
  node.counterAxisSizingMode = 'AUTO';
  // overflow: hidden in code (a card): the footer fill stays inside the rounded corners.
  node.clipsContent = !!part.clip;
}

/**
 * A child of a frame whose children stretch (align-items: stretch, a block's children) fills its parent on the cross
 * axis. Set last: the child's own hug sizing (setupFrame) would otherwise undo it, and FILL needs the node to be inside
 * its auto layout parent already. A text that fills the width wraps: fixed width, height grows.
 */
function sizeInParent(node: SceneNode, parentPart: SpecPart | undefined): void {
  if (!parentPart?.layout || parentPart.layout.counter !== 'STRETCH' || !('layoutSizingHorizontal' in node)) return;
  if (parentPart.layout.direction === 'VERTICAL') {
    node.layoutSizingHorizontal = 'FILL';
    if (node.type === 'TEXT') node.textAutoResize = 'HEIGHT';
  } else if (node.type !== 'TEXT') node.layoutSizingVertical = 'FILL';
}

/** Generated parts sit under the parent the spec names, in spec order (a re-pull after code removed a wrapper moves them). */
function placeParts(variant: ComponentNode, comp: PlannedComponent, nodes: Map<string, SceneNode>): void {
  for (const parent of comp.parts) {
    const box = nodes.get(parent.id);
    if (!box || !('children' in box)) continue;
    const kids = comp.parts.filter((p) => p.parent === parent.id).map((p) => nodes.get(p.id)).filter((n): n is SceneNode => !!n);
    kids.forEach((kid, i) => {
      if ((box as Box).children[i] !== kid) (box as Box).insertChild(i, kid);
    });
  }
  // Layers DS Bridge generated for parts code no longer has (a wrapper merged into the root): removed once empty.
  const ids = new Set(comp.parts.map((p) => p.id));
  const stale = variant.findAll((n) => {
    const id = n.getSharedPluginData(NS, 'part');
    return !!id && !ids.has(id);
  });
  for (const n of stale.reverse()) if (!('children' in n) || !(n as FrameNode).children.length) n.remove();
}

function createPart(part: SpecPart): SceneNode {
  let node: SceneNode;
  if (part.kind === 'text') {
    node = figma.createText();
  } else {
    const f = figma.createFrame();
    f.fills = [];
    if (part.kind === 'icon') f.resize(16, 16);
    node = f;
  }
  node.name = part.name;
  node.setSharedPluginData(NS, 'part', part.id);
  return node;
}

async function configureVariant(variant: ComponentNode, comp: PlannedComponent, pv: PlannedVariant, propKeys: Map<string, string>, ctx: Ctx): Promise<void> {
  variant.name = pv.name;
  variant.setSharedPluginData(NS, 'variant', pv.key);
  variant.setSharedPluginData(NS, 'part', 'root');
  if (variant.getSharedPluginData(NS, 'orphan') === 'true') {
    variant.setSharedPluginData(NS, 'orphan', '');
    if (variant.description.startsWith(ORPHAN_PREFIX)) variant.description = variant.description.slice(ORPHAN_PREFIX.length);
  }
  const nodes = new Map<string, SceneNode>();
  for (const part of comp.parts) {
    let node = findPart(variant, part.id);
    const parent = ((part.parent ? nodes.get(part.parent) : variant) ?? variant) as Box;
    if (part.swap) {
      const target = pv.slots?.[part.id] ?? part.swap.default;
      const main = ctx.parts.get(target);
      ctx.where = `${comp.name} ${pv.name}, ${part.name}`;
      if (main) {
        const inst = await placeInstance(node, main, parent, part.id, target);
        nodes.set(part.id, inst);
        if (inst.name !== part.name) inst.name = part.name;
        const swapKey = propKeys.get(`swap:${part.id}`);
        const visibleKey = part.visible ? propKeys.get(part.visible) : undefined;
        inst.componentPropertyReferences = { ...(swapKey ? { mainComponent: swapKey } : {}), ...(visibleKey ? { visible: visibleKey } : {}) };
        // Binding the property must not change what this variant shows (Card padding none shows Media).
        if ((await inst.getMainComponentAsync())?.id !== main.id) inst.swapComponent(main);
        await styleInstance(inst, part.kind, pv.parts[part.id] ?? [], ctx);
        try {
          sizeInParent(inst, comp.parts.find((p) => p.id === part.parent));
        } catch (err) {
          ctx.problems.push(`${ctx.where}, fill container: ${errorText(err)}`);
        }
        continue;
      }
      ctx.problems.push(`${ctx.where}: no component "${target}". Pull components again to create it.`);
    }
    if (!node) {
      node = createPart(part);
      parent.appendChild(node);
    } else if (part.id !== 'root' && node.parent !== parent) parent.appendChild(node);
    nodes.set(part.id, node);
    if (part.id !== 'root' && node.name !== part.name) node.name = part.name;
    const parentPart = comp.parts.find((p) => p.id === part.parent);
    ctx.where = `${comp.name} ${pv.name}, ${part.name}`;
    const fields = pv.parts[part.id] ?? [];
    if (part.kind === 'text' && node.type === 'TEXT') {
      const fam = fields.find((f) => f.value.kind === 'font')?.value as Extract<PlannedValue, { kind: 'font' }> | undefined;
      const weight = fields.find((f) => f.field === 'fontWeight')?.value;
      const w = weight?.kind === 'variable' && typeof weight.value === 'number' ? weight.value : undefined;
      // Unbind the weight first: Figma checks a bound weight against the font being set.
      try {
        bind(node, 'fontWeight', null);
      } catch {
        /* nothing bound yet */
      }
      node.fontName = await ctx.fonts.font(fam?.families, w);
      node.textAutoResize = 'WIDTH_AND_HEIGHT';
      const prop = part.text ? comp.properties.find((p) => p.name === part.text) : undefined;
      if (!node.characters) node.characters = typeof prop?.default === 'string' ? prop.default : part.name;
      const key = part.text ? propKeys.get(part.text) : undefined;
      if (key) node.componentPropertyReferences = { characters: key };
      for (const f of TEXT_FIELDS) reset(node, f);
    } else if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      if (part.kind === 'frame') setupFrame(node, part);
      else {
        node.layoutMode = 'NONE';
        node.fills = [];
      }
      for (const f of part.kind === 'icon' ? ICON_FIELDS : FRAME_FIELDS) reset(node, f);
      if (part.visible) {
        const key = propKeys.get(part.visible);
        if (key) node.componentPropertyReferences = { visible: key };
      }
    }
    for (const f of fields) apply(node, f, ctx);
    try {
      sizeInParent(node, parentPart);
    } catch (err) {
      ctx.problems.push(`${ctx.where}, fill container: ${errorText(err)}`);
    }
  }
  placeParts(variant, comp, nodes);
}

/**
 * Ensures the set's TEXT and BOOLEAN properties exist with the spec's defaults, and an INSTANCE_SWAP property per
 * swappable part (default: the spec's component, preferred values: every icon or the slot's options). Returns
 * name -> Figma property key, and `swap:<part id>` -> key for swaps.
 */
function ensureProperties(set: ComponentSetNode, comp: PlannedComponent, ctx: Ctx): Map<string, string> {
  const keys = new Map<string, string>();
  const base = (k: string) => k.replace(/#[^#]*$/, '');
  let defs = set.componentPropertyDefinitions;
  // A property code turned into a swap (Card's Body text): the old one goes, the swap takes its name.
  for (const part of comp.parts) {
    if (!part.swap) continue;
    for (const k of Object.keys(defs)) {
      const d = defs[k]!;
      if (base(k) !== part.swap.property || d.type === 'INSTANCE_SWAP' || d.type === 'VARIANT') continue;
      if (comp.properties.some((p) => p.name === part.swap!.property && p.type === d.type)) continue;
      set.deleteComponentProperty(k);
    }
  }
  defs = set.componentPropertyDefinitions;
  for (const p of comp.properties) {
    const existing = Object.keys(defs).find((k) => base(k) === p.name && defs[k]!.type === p.type);
    if (!existing) keys.set(p.name, set.addComponentProperty(p.name, p.type, p.default));
    else {
      if (defs[existing]!.defaultValue !== p.default) set.editComponentProperty(existing, { defaultValue: p.default });
      keys.set(p.name, existing);
    }
  }
  for (const part of comp.parts) {
    if (!part.swap) continue;
    const def = ctx.parts.get(part.swap.default);
    if (!def) continue;
    const preferredValues = (part.swap.options ?? ctx.icons)
      .map((n) => ctx.parts.get(n))
      .filter((c): c is ComponentNode => !!c)
      .map((c) => ({ type: 'COMPONENT' as const, key: c.key }));
    const name = part.swap.property;
    const fallback = `${name} (swap)`;
    const existing = Object.keys(defs).find((k) => (base(k) === name || base(k) === fallback) && defs[k]!.type === 'INSTANCE_SWAP');
    let key: string;
    if (existing) {
      set.editComponentProperty(existing, { defaultValue: def.id, preferredValues });
      key = existing;
    } else {
      try {
        key = set.addComponentProperty(name, 'INSTANCE_SWAP', def.id, { preferredValues });
      } catch {
        // A file where the name is taken by the BOOLEAN of the same part: keep both, the swap says what it is.
        key = set.addComponentProperty(fallback, 'INSTANCE_SWAP', def.id, { preferredValues });
      }
    }
    keys.set(`swap:${part.id}`, key);
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------
// Swappable parts: icon and slot components, and their instances in variants

/** An instance of `main` for a part: the existing generated layer, swapped if needed, or a new one in its place. */
async function placeInstance(node: SceneNode | undefined, main: ComponentNode, parent: Box, partId: string, target: string): Promise<InstanceNode> {
  let inst: InstanceNode;
  if (node && node.type === 'INSTANCE') {
    inst = node;
    if ((await inst.getMainComponentAsync())?.id !== main.id) inst.swapComponent(main);
    if (inst.parent !== parent) parent.appendChild(inst);
  } else {
    inst = main.createInstance();
    // A placeholder or text layer from an earlier pull: the instance takes its place.
    const holder = node?.parent as Box | null | undefined;
    if (node && holder && 'children' in holder) {
      holder.insertChild(holder.children.indexOf(node), inst);
      node.remove();
    } else parent.appendChild(inst);
  }
  inst.setSharedPluginData(NS, 'part', partId);
  inst.setSharedPluginData(NS, 'slotDefault', target);
  return inst;
}

/** Vectors of an icon (component or instance): the one flattened "Icon" vector, or every vector of an older build. */
const vectorsOf = (n: SceneNode): SceneNode[] => ('findAll' in n ? (n as FrameNode).findAll((x) => x.type === 'VECTOR') : []);

/** Icon fields: size on the frame (or instance), stroke color and width on its vectors. */
function applyIconFields(node: SceneNode, fields: PlannedField[], ctx: Ctx): void {
  for (const f of fields) {
    if (f.field === 'stroke' || f.field === 'strokeWeight') for (const v of vectorsOf(node)) apply(v, f, ctx);
    else if (f.field === 'width' || f.field === 'height') apply(node, f, ctx);
  }
}

/** A variant's values on a swapped-in instance: icon size and colors, a text slot's typography, or nothing for media. */
async function styleInstance(inst: InstanceNode, kind: string, fields: PlannedField[], ctx: Ctx): Promise<void> {
  for (const f of ['width', 'height'] as const) {
    try {
      bind(inst, f, null);
    } catch {
      /* nothing bound */
    }
  }
  if (kind === 'icon') {
    applyIconFields(inst, fields, ctx);
    return;
  }
  const text = inst.findOne((n) => n.type === 'TEXT') as TextNode | null;
  if (!text || !fields.length) return;
  await styleText(text, fields, ctx);
}

async function styleText(text: TextNode, fields: PlannedField[], ctx: Ctx): Promise<void> {
  const fam = fields.find((f) => f.value.kind === 'font')?.value as Extract<PlannedValue, { kind: 'font' }> | undefined;
  const weight = fields.find((f) => f.field === 'fontWeight')?.value;
  const w = weight?.kind === 'variable' && typeof weight.value === 'number' ? weight.value : undefined;
  try {
    bind(text, 'fontWeight', null);
  } catch {
    /* nothing bound yet */
  }
  text.fontName = await ctx.fonts.font(fam?.families, w);
  for (const f of TEXT_FIELDS) reset(text, f);
  for (const f of fields) apply(text, f, ctx);
}

async function pageFor(name: string, key: string): Promise<PageNode> {
  const pages = figma.root.children;
  const page = pages.find((p) => p.getSharedPluginData(NS, 'page') === key) ?? pages.find((p) => p.name === name) ?? figma.createPage();
  if (page.name !== name && !page.getSharedPluginData(NS, 'page')) page.name = name;
  page.setSharedPluginData(NS, 'page', key);
  await page.loadAsync();
  return page;
}

/** Draws an icon component from its SVG: one flattened vector named "Icon", so overrides survive a swap. */
function drawIcon(comp: ComponentNode, icon: PlannedIcon, ctx: Ctx, fields: PlannedField[]): void {
  for (const c of [...comp.children]) c.remove();
  comp.resizeWithoutConstraints(24, 24); // Lucide's grid: the SVG viewBox
  const frame = figma.createNodeFromSvg(icon.svg);
  try {
    const kids = [...frame.children];
    if (!kids.length) throw new Error('the SVG has no shapes');
    const vector = figma.flatten(kids, frame);
    const x = vector.x;
    const y = vector.y;
    comp.appendChild(vector);
    vector.x = x;
    vector.y = y;
    vector.name = 'Icon';
    vector.fills = [];
    vector.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
  } catch (err) {
    ctx.problems.push(`${icon.component}: ${errorText(err)}`);
  } finally {
    frame.remove();
  }
  comp.fills = [];
  comp.clipsContent = false;
  ctx.where = icon.component;
  applyIconFields(comp, fields, ctx);
}

/** Text slot: a vertical frame with the text (TEXT property "Text"), as wide as the card, the text wrapping. */
async function drawTextSlot(comp: ComponentNode, slot: PlannedSlot, ctx: Ctx): Promise<void> {
  comp.layoutMode = 'VERTICAL';
  comp.primaryAxisSizingMode = 'AUTO';
  comp.counterAxisSizingMode = 'FIXED';
  comp.fills = [];
  let text = comp.findOne((n) => n.getSharedPluginData(NS, 'slotPart') === 'text') as TextNode | null;
  if (!text) {
    text = figma.createText();
    text.setSharedPluginData(NS, 'slotPart', 'text');
    comp.appendChild(text);
  }
  text.name = slot.text?.property ?? 'Text';
  await styleText(text, slot.fields.filter((f) => f.field !== 'width'), ctx);
  if (!text.characters) text.characters = slot.text?.default ?? '';
  const width = slot.fields.find((f) => f.field === 'width');
  if (width) apply(comp, width, ctx);
  text.layoutSizingHorizontal = 'FILL';
  text.textAutoResize = 'HEIGHT';
  if (slot.text) {
    const defs = comp.componentPropertyDefinitions;
    const key = Object.keys(defs).find((k) => k.replace(/#[^#]*$/, '') === slot.text!.property && defs[k]!.type === 'TEXT') ?? comp.addComponentProperty(slot.text.property, 'TEXT', slot.text.default);
    text.componentPropertyReferences = { characters: key };
  }
}

/** Media slot: a neutral plate at the slot's ratio with the image icon centered. */
function drawMediaSlot(comp: ComponentNode, slot: PlannedSlot, ctx: Ctx): void {
  comp.layoutMode = 'VERTICAL';
  comp.primaryAxisAlignItems = 'CENTER';
  comp.counterAxisAlignItems = 'CENTER';
  comp.primaryAxisSizingMode = 'FIXED';
  comp.counterAxisSizingMode = 'FIXED';
  comp.clipsContent = true;
  for (const f of slot.fields) {
    if (f.field === 'height' && f.value.kind === 'number') comp.resizeWithoutConstraints(comp.width, f.value.value);
    else apply(comp, f, ctx);
  }
  const lock = (comp as unknown as { lockAspectRatio?: () => void }).lockAspectRatio;
  if (typeof lock === 'function') {
    try {
      lock.call(comp);
    } catch {
      /* older Figma: the ratio is only the starting size */
    }
  }
  const main = slot.icon ? ctx.parts.get(slot.icon) : undefined;
  let icon = comp.findOne((n) => n.getSharedPluginData(NS, 'slotPart') === 'icon') as InstanceNode | null;
  if (!main) {
    if (slot.icon) ctx.problems.push(`${slot.name}: no component "${slot.icon}".`);
    return;
  }
  if (!icon || icon.type !== 'INSTANCE') {
    icon?.remove();
    icon = main.createInstance();
    icon.setSharedPluginData(NS, 'slotPart', 'icon');
    comp.appendChild(icon);
  }
  icon.name = 'Icon';
  applyIconFields(icon, slot.iconFields ?? [], ctx);
}

/**
 * Icons and slots of the plan: created once, redrawn when their SVG or spec changed (same node, so instances keep
 * their overrides), laid out on their pages. Returns every generated part by name, built now or before.
 */
async function ensureParts(plan: ComponentPullPlan, ctx: Ctx, report: ComponentApplyReport, progress: Progress): Promise<void> {
  await figma.loadAllPagesAsync();
  const icons = new Map<string, ComponentNode>();
  const slots = new Map<string, ComponentNode>();
  for (const c of figma.root.findAllWithCriteria({ types: ['COMPONENT'] })) {
    const iconId = c.getSharedPluginData(NS, 'iconId');
    const slotId = c.getSharedPluginData(NS, 'slotId');
    if (iconId && !icons.has(iconId)) icons.set(iconId, c);
    if (slotId && !slots.has(slotId)) slots.set(slotId, c);
  }
  const counts = { created: 0, updated: 0 };
  if (plan.icons?.length) {
    progress(`Drawing ${plan.icons.length} icons`);
    const page = await pageFor(ICONS_PAGE, 'icons');
    for (const icon of plan.icons) {
      let comp = icons.get(icon.name);
      const isNew = !comp;
      if (!comp) {
        comp = figma.createComponent();
        page.appendChild(comp);
        comp.setSharedPluginData(NS, 'iconId', icon.name);
        icons.set(icon.name, comp);
      }
      comp.name = icon.component;
      if (isNew || comp.getSharedPluginData(NS, 'iconHash') !== icon.hash || !vectorsOf(comp).length) {
        drawIcon(comp, icon, ctx, plan.iconFields ?? []);
        comp.setSharedPluginData(NS, 'iconHash', icon.hash);
        comp.description = `Lucide icon, generated by DS Bridge. Swap it in any component's icon property.`;
        if (isNew) counts.created++;
        else counts.updated++;
      }
    }
    const sorted = plan.icons.map((i) => icons.get(i.name)!).filter((c) => c.parent?.id === page.id);
    sorted.forEach((c, i) => {
      c.x = (i % ICON_COLUMNS) * ICON_CELL;
      c.y = Math.floor(i / ICON_COLUMNS) * ICON_CELL;
    });
    await tick();
  }
  for (const [name, c] of icons) ctx.parts.set(c.name || `Icon/${name}`, c);
  ctx.icons = (plan.icons ?? []).map((i) => i.component).filter((n) => ctx.parts.has(n));
  if (plan.slots?.length) {
    progress('Drawing content slots');
    const page = await pageFor(SLOTS_PAGE, 'slots');
    let x = 0;
    for (const slot of plan.slots) {
      let comp = slots.get(slot.name);
      const isNew = !comp;
      if (!comp) {
        comp = figma.createComponent();
        page.appendChild(comp);
        comp.setSharedPluginData(NS, 'slotId', slot.name);
        slots.set(slot.name, comp);
      }
      comp.name = slot.name;
      if (isNew || comp.getSharedPluginData(NS, 'slotHash') !== slot.hash) {
        ctx.where = slot.name;
        if (slot.kind === 'text') await drawTextSlot(comp, slot, ctx);
        else drawMediaSlot(comp, slot, ctx);
        comp.setSharedPluginData(NS, 'slotHash', slot.hash);
        comp.description = 'Content slot, generated by DS Bridge. Swap it in a component\'s slot property.';
        if (isNew) counts.created++;
        else counts.updated++;
      }
      if (comp.parent?.id === page.id) {
        comp.x = x;
        comp.y = 0;
        x += comp.width + SET_GAP;
      }
    }
  }
  for (const c of slots.values()) ctx.parts.set(c.name, c);
  if (counts.created || counts.updated) report.parts = counts;
}

/**
 * Grid: one column per value of the last axis (usually State), one row per combination of the others. Each row is as tall
 * as its tallest variant and each column as wide as its widest, with the same gap between all of them, so rows of
 * different sizes (sm, md, lg) are evenly spaced.
 */
export function layoutVariants(set: ComponentSetNode, comp: PlannedComponent): void {
  const byKey = new Map(set.children.filter((c): c is ComponentNode => c.type === 'COMPONENT').map((c) => [c.getSharedPluginData(NS, 'variant'), c]));
  const last = comp.axes[comp.axes.length - 1];
  const cols = last ? last.values : ['Default'];
  const rows: string[] = [];
  const cells: { node: ComponentNode; row: number; col: number }[] = [];
  for (const v of comp.variants) {
    const node = byKey.get(v.key);
    if (!node) continue;
    const rowKey = comp.axes.slice(0, -1).map((a) => v.props[a.name]).join('|');
    if (!rows.includes(rowKey)) rows.push(rowKey);
    cells.push({ node, row: rows.indexOf(rowKey), col: last ? Math.max(0, cols.indexOf(v.props[last.name]!)) : 0 });
  }
  const orphans = set.children.filter((c) => c.type === 'COMPONENT' && c.getSharedPluginData(NS, 'orphan') === 'true');
  const colW = cols.map((_, i) => Math.max(1, ...cells.filter((c) => c.col === i).map((c) => c.node.width)));
  const rowH = rows.map((_, i) => Math.max(1, ...cells.filter((c) => c.row === i).map((c) => c.node.height)));
  const offsets = (sizes: number[]) => sizes.reduce<number[]>((acc, _, i) => [...acc, i ? acc[i - 1]! + sizes[i - 1]! + GAP : GAP], []);
  const xs = offsets(colW);
  const ys = offsets(rowH);
  for (const c of cells) {
    c.node.x = xs[c.col]!;
    c.node.y = ys[c.row]!;
  }
  // Orphans go after the grid, in one row.
  const gridH = rows.length ? ys[rows.length - 1]! + rowH[rows.length - 1]! + GAP : GAP;
  let x = GAP;
  for (const o of orphans) {
    o.x = x;
    o.y = gridH;
    x += o.width + GAP;
  }
  const orphanH = orphans.length ? Math.max(...orphans.map((o) => o.height)) + GAP : 0;
  const width = Math.max(cols.length ? xs[cols.length - 1]! + colW[cols.length - 1]! + GAP : GAP, x);
  set.resizeWithoutConstraints(Math.max(1, width), Math.max(1, gridH + orphanH));
}

const componentsPage = () => pageFor(PAGE_NAME, 'components');

function bottomOf(page: PageNode): number {
  return page.children.reduce((m, n) => Math.max(m, n.y + n.height), 0);
}

export async function applyComponentPlan(plan: ComponentPullPlan, progress: Progress = () => undefined): Promise<ComponentApplyReport> {
  const ctx: Ctx = { vars: new Variables(), fonts: new Fonts(), problems: [], where: '', parts: new Map(), icons: [] };
  await ctx.vars.load();
  await ctx.fonts.load();
  const existing = new Map((await generatedSets()).map((s) => [s.getSharedPluginData(NS, 'componentId'), s]));
  const report: ComponentApplyReport = { created: 0, updated: 0, unchanged: 0, orphaned: 0, page: PAGE_NAME, problems: ctx.problems, nodeIds: [] };
  await ensureParts(plan, ctx, report, progress);
  let page: PageNode | undefined;

  for (let i = 0; i < plan.components.length; i++) {
    const comp = plan.components[i]!;
    if (comp.status === 'unchanged' && existing.has(comp.componentId)) {
      report.unchanged++;
      continue;
    }
    progress(`Building ${comp.name} (${i + 1} of ${plan.components.length})`);
    let set = existing.get(comp.componentId);
    const isNew = !set;
    if (!set) {
      page ??= await componentsPage();
      // Variants first (combineAsVariants needs them), then properties on the set, then wiring.
      const made: ComponentNode[] = [];
      for (const pv of comp.variants) {
        const c = figma.createComponent();
        c.name = pv.name;
        c.setSharedPluginData(NS, 'variant', pv.key);
        page.appendChild(c);
        made.push(c);
      }
      const y = bottomOf(page);
      set = figma.combineAsVariants(made, page);
      set.x = 0;
      set.y = y ? y + SET_GAP : 0;
      set.setSharedPluginData(NS, 'componentId', comp.componentId);
    }
    set.name = comp.name;
    set.description = comp.description;
    const propKeys = ensureProperties(set, comp, ctx);
    const variants = new Map(
      set.children.filter((c): c is ComponentNode => c.type === 'COMPONENT').map((c) => [c.getSharedPluginData(NS, 'variant') || variantKeyOf(c.variantProperties ?? {}), c]),
    );
    for (const pv of comp.variants) {
      let node = variants.get(pv.key);
      if (!node) {
        node = figma.createComponent();
        set.appendChild(node);
      }
      await configureVariant(node, comp, pv, propKeys, ctx);
      if (pv === comp.variants[comp.variants.length - 1] || comp.variants.indexOf(pv) % 12 === 0) await tick();
    }
    // Variants removed in code: kept, flagged.
    const keys = new Set(comp.variants.map((v) => v.key));
    for (const [key, node] of variants) {
      if (keys.has(key)) continue;
      if (node.getSharedPluginData(NS, 'orphan') !== 'true') {
        node.setSharedPluginData(NS, 'orphan', 'true');
        if (!node.description.startsWith(ORPHAN_PREFIX)) node.description = ORPHAN_PREFIX + node.description;
        report.orphaned++;
      }
    }
    // Always: an update can change variant sizes (a padding, a fixed width), not only add variants.
    layoutVariants(set, comp);
    set.setSharedPluginData(NS, 'specHash', comp.hash);
    // The generated set is the baseline: a Push right after a pull sends nothing.
    set.setSharedPluginData(NS, 'signature', JSON.stringify(buildSignature(await readComponent(set))));
    report.nodeIds.push(set.id);
    if (isNew) report.created++;
    else report.updated++;
  }
  if (ctx.fonts.missing.size) {
    report.fontNote = `${[...ctx.fonts.missing].join(', ')} ${ctx.fonts.missing.size === 1 ? 'is' : 'are'} not available in this Figma, so text uses Inter. Install the font and pull again.`;
  }
  return report;
}
