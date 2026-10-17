// Main thread: builds or updates the component sets of a component pull plan (src/sync/component-pull.ts) on the
// "Components" page, bound to the variables a pull wrote. No network.
//
// Idempotent: a set is found by shared plugin data (dsbridge / componentId), a variant by (dsbridge / variant), a layer
// by (dsbridge / part). Re-pulling updates them in place (same node ids, so instances keep their overrides), adds new
// variants, and flags variants removed in code with "[orphan]". Layers DS Bridge did not create are never removed.

import { variantKeyOf } from '@bridge-ds/core';
import type { SpecField, SpecPart } from '@bridge-ds/core';
import type { ComponentApplyReport, ComponentPullPlan, GeneratedSet, PlannedComponent, PlannedField, PlannedValue, PlannedVariant } from '../sync/component-pull';
import { buildSignature } from '../sync/components';
import { readComponent } from './components';

const NS = 'dsbridge';
const ORPHAN_PREFIX = '[orphan] ';
const PAGE_NAME = 'Components';
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

/** Ensures the set's TEXT and BOOLEAN properties exist with the spec's defaults; returns name -> Figma property key. */
function ensureProperties(set: ComponentSetNode, comp: PlannedComponent): Map<string, string> {
  const keys = new Map<string, string>();
  const defs = set.componentPropertyDefinitions;
  for (const p of comp.properties) {
    const existing = Object.keys(defs).find((k) => k.replace(/#[^#]*$/, '') === p.name && defs[k]!.type === p.type);
    if (!existing) keys.set(p.name, set.addComponentProperty(p.name, p.type, p.default));
    else {
      if (defs[existing]!.defaultValue !== p.default) set.editComponentProperty(existing, { defaultValue: p.default });
      keys.set(p.name, existing);
    }
  }
  return keys;
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

async function componentsPage(): Promise<PageNode> {
  const pages = figma.root.children;
  const page = pages.find((p) => p.getSharedPluginData(NS, 'page') === 'components') ?? pages.find((p) => p.name === PAGE_NAME) ?? figma.createPage();
  if (page.name !== PAGE_NAME && !page.getSharedPluginData(NS, 'page')) page.name = PAGE_NAME;
  page.setSharedPluginData(NS, 'page', 'components');
  await page.loadAsync();
  return page;
}

function bottomOf(page: PageNode): number {
  return page.children.reduce((m, n) => Math.max(m, n.y + n.height), 0);
}

export async function applyComponentPlan(plan: ComponentPullPlan, progress: Progress = () => undefined): Promise<ComponentApplyReport> {
  const ctx: Ctx = { vars: new Variables(), fonts: new Fonts(), problems: [], where: '' };
  await ctx.vars.load();
  await ctx.fonts.load();
  const existing = new Map((await generatedSets()).map((s) => [s.getSharedPluginData(NS, 'componentId'), s]));
  const report: ComponentApplyReport = { created: 0, updated: 0, unchanged: 0, orphaned: 0, page: PAGE_NAME, problems: ctx.problems, nodeIds: [] };
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
    const propKeys = ensureProperties(set, comp);
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
