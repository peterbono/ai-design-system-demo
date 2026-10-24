// Main thread: builds or updates the component sets of a component pull plan (src/sync/component-pull.ts) on the
// "Components" page, bound to the variables a pull wrote. No network.
//
// Idempotent: a set is found by shared plugin data (dsbridge / componentId), a variant by (dsbridge / variant), a layer
// by (dsbridge / part). Re-pulling updates them in place (same node ids, so instances keep their overrides), adds new
// variants, and flags variants removed in code with "[orphan]". Layers Bridge did not create are never removed.
//
// Swappable parts (icons, content slots) are instances of generated components: one COMPONENT per icon ("Icon/Plus")
// on the Icons page (dsbridge / iconId) and one per content slot ("Slot/Media") on the Slots page (dsbridge / slotId),
// swapped through INSTANCE_SWAP properties whose preferred values list them, like a Figma library.

import { variantKeyOf } from '@bridge-ds/core';
import { familyKey } from '../sync/mapping';
import type { SpecField, SpecLayout, SpecPart } from '@bridge-ds/core';
import { figmaPropName, matchVariants, parsePushedMark, propsOfKey } from '../sync/component-pull';
import { PUSHED_KEY } from '../shared/messages';
import type { ComponentApplyReport, ComponentPullPlan, GeneratedSet, PlannedComponent, PlannedField, PlannedIcon, PlannedSlot, PlannedValue, PlannedVariant } from '../sync/component-pull';
import { buildSignature } from '../sync/components';
import { readComponent } from './components';
import { cleanReactions } from './reactions';
import { breathe, resetTurns } from './turns';

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

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Why a component or variant was not built, in designer words, from what Figma or the plan said. The raw message is
 * kept short at the end, for whoever reports it.
 */
export function reasonOf(err: unknown): string {
  const raw = errorText(err).replace(/\s+/g, ' ').trim();
  const short = raw.length > 120 ? `${raw.slice(0, 119)}…` : raw;
  if (/font/i.test(raw) && /load|available/i.test(raw)) return `a font could not be loaded (${short})`;
  if (/variable/i.test(raw)) return `a variable could not be used (${short})`;
  if (/property/i.test(raw)) return `a component property was refused (${short})`;
  if (/svg/i.test(raw)) return `an icon drawing could not be read (${short})`;
  return `Figma refused a change (${short || 'no details'})`;
}

/** A generated node Bridge keeps on a page: a component set, an icon or a slot component. */
function isGenerated(n: BaseNode): boolean {
  if (n.type === 'COMPONENT_SET') return !!n.getSharedPluginData(NS, 'componentId');
  if (n.type === 'COMPONENT') return !!(n.getSharedPluginData(NS, 'iconId') || n.getSharedPluginData(NS, 'slotId'));
  return false;
}

/**
 * Every node a build creates goes through `make`, so a failure leaves nothing behind: `rollback` removes what was
 * created since a mark (a variant or a set that failed), and `sweep` removes anything left loose on a page (Figma puts
 * new nodes on the current page until they are moved into place).
 */
class Created {
  private list: BaseNode[] = [];
  add<T extends BaseNode>(n: T): T {
    this.list.push(n);
    return n;
  }
  mark(): number {
    return this.list.length;
  }
  rollback(from: number): void {
    for (const n of this.list.splice(from).reverse()) {
      try {
        if (!n.removed) n.remove();
      } catch {
        /* already gone with its parent */
      }
    }
  }
  /** Loose nodes on a page that are not generated sets or parts; the list is cleared (a finished set is kept). */
  sweep(): number {
    let removed = 0;
    for (const n of this.list) {
      try {
        if (n.removed || n.parent?.type !== 'PAGE' || isGenerated(n)) continue;
        n.remove();
        removed++;
      } catch {
        /* gone */
      }
    }
    this.list = [];
    return removed;
  }
}

let created = new Created();
const make = {
  frame: () => created.add(figma.createFrame()),
  text: () => created.add(figma.createText()),
  component: () => created.add(figma.createComponent()),
  instance: (main: ComponentNode) => created.add(main.createInstance()),
  svg: (svg: string) => created.add(figma.createNodeFromSvg(svg)),
};

function pageOf(node: BaseNode): PageNode | undefined {
  let n: BaseNode | null = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return (n as PageNode | null) ?? undefined;
}

async function generatedSets(): Promise<ComponentSetNode[]> {
  await figma.loadAllPagesAsync();
  return figma.root.findAllWithCriteria({ types: ['COMPONENT_SET'] }).filter((s) => !!s.getSharedPluginData(NS, 'componentId'));
}

/** Component sets Bridge generated, for the pull preview (new, updated or unchanged). */
export async function scanGenerated(): Promise<GeneratedSet[]> {
  return (await generatedSets()).map((s) => ({
    componentId: s.getSharedPluginData(NS, 'componentId'),
    nodeId: s.id,
    name: s.name,
    page: pageOf(s)?.name,
    specHash: s.getSharedPluginData(NS, 'specHash'),
    ...(s.getSharedPluginData(NS, 'codeHash') ? { codeHash: s.getSharedPluginData(NS, 'codeHash') } : {}),
    variants: s.children
      .filter((c): c is ComponentNode => c.type === 'COMPONENT' && c.getSharedPluginData(NS, 'orphan') !== 'true')
      .map(keyOfVariant),
    ...(() => {
      const pushed = parsePushedMark(s.getSharedPluginData(NS, PUSHED_KEY));
      return pushed ? { pushed } : {};
    })(),
    ...(inError(s) ? { inError: true } : {}),
  }));
}

/** A set Figma holds in error (variants of different shapes or alike): every read of its properties throws. */
function inError(s: ComponentSetNode): boolean {
  try {
    void s.componentPropertyDefinitions;
    for (const c of s.children) if (c.type === 'COMPONENT') void c.variantProperties;
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Variables and fonts

class Variables {
  private collections: VariableCollection[] = [];
  /** Collection id -> its variables by token id (plugin data "id") and by name: one pass, no search per binding. */
  private index = new Map<string, { byToken: Map<string, Variable>; byName: Map<string, Variable> }>();
  private cache = new Map<string, Variable | null>();

  async load(): Promise<void> {
    this.collections = (await figma.variables.getLocalVariableCollectionsAsync()).filter((c) => !c.remote);
    for (const c of this.collections) this.index.set(c.id, { byToken: new Map(), byName: new Map() });
    for (const v of await figma.variables.getLocalVariablesAsync()) {
      const slot = this.index.get(v.variableCollectionId);
      if (!slot) continue;
      const id = v.getPluginData('id');
      if (id && !slot.byToken.has(id)) slot.byToken.set(id, v);
      if (!slot.byName.has(v.name)) slot.byName.set(v.name, v);
    }
  }

  /** The variable of a token in its tier's collection ("Semantic", or "Semantic/Light" in the split layout), by id then name. */
  find(v: Extract<PlannedValue, { kind: 'variable' }>): Variable | undefined {
    const key = `${v.collection}|${v.tokenId}|${v.name}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? undefined;
    const ids = this.collections
      .filter((c) => c.name === v.collection || c.name.startsWith(`${v.collection}/`))
      .sort((a, b) => Number(b.name === v.collection) - Number(a.name === v.collection))
      .map((c) => c.id);
    let found: Variable | undefined;
    for (const id of ids) {
      const slot = this.index.get(id)!;
      found = slot.byToken.get(v.tokenId) ?? slot.byName.get(v.name);
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
  /** Each font is loaded once; a font Figma refused is not asked for again. */
  private loaded = new Set<string>();
  private refused = new Set<string>();
  missing = new Set<string>();

  async load(): Promise<void> {
    let list: Font[] = [];
    try {
      list = await figma.listAvailableFontsAsync();
    } catch {
      /* Figma could not list fonts: every text uses Inter, said in the font note */
    }
    for (const f of list) {
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

  private async tryLoad(font: FontName): Promise<boolean> {
    const key = `${font.family}|${font.style}`;
    if (this.loaded.has(key)) return true;
    if (this.refused.has(key)) return false;
    try {
      await figma.loadFontAsync(font);
      this.loaded.add(key);
      return true;
    } catch {
      this.refused.add(key);
      return false;
    }
  }

  private styleFor(styles: string[], w: number): string {
    return (
      (WEIGHT_STYLES[w] ?? []).map((s) => styles.find((x) => x.toLowerCase() === s.toLowerCase())).find(Boolean) ??
      styles.find((s) => /^regular$/i.test(s)) ??
      styles[0] ??
      'Regular'
    );
  }

  /** The font for a family stack and weight, loaded. A font Figma will not load falls back to Inter (said once). */
  async font(families: string[] | undefined, weight: number | undefined): Promise<FontName> {
    const { family, styles } = this.pick(families?.length ? families : ['Inter']);
    const w = typeof weight === 'number' && Number.isFinite(weight) ? Math.min(900, Math.max(100, Math.round(weight / 100) * 100)) : 400;
    const fontName = { family, style: this.styleFor(styles, w) };
    if (await this.tryLoad(fontName)) return fontName;
    this.missing.add(`${fontName.family} ${fontName.style}`);
    const inter = this.available.get('inter') ?? { family: 'Inter', styles: ['Regular', 'Medium', 'Semi Bold', 'Bold'] };
    for (const style of [this.styleFor(inter.styles, w), 'Regular']) {
      const fallback = { family: inter.family, style };
      if (await this.tryLoad(fallback)) return fallback;
    }
    throw new Error(`Font ${fontName.family} ${fontName.style} could not be loaded, nor Inter`);
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
  'counterAxisSpacing',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'opacity',
];
const TEXT_FIELDS: SpecField[] = ['textFill', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration', 'opacity'];
const ICON_FIELDS: SpecField[] = ['width', 'height', 'stroke', 'strokeWeight', 'opacity'];

const BLACK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
const TRANSPARENT: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0 };

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

/**
 * A paint bound to a color variable, whose own color is the value the node resolves now. Figma shows a bound paint's
 * own color until something refreshes it (a variable write in the session, a mode change): with a black base, an
 * update that writes no variable left the whole set black, on the canvas and in exports.
 */
function boundPaint(node: SceneNode, variable: Variable): SolidPaint {
  let base: SolidPaint = BLACK;
  try {
    const v = variable.resolveForConsumer(node).value as Partial<RGBA> | undefined;
    if (v && typeof v.r === 'number' && typeof v.g === 'number' && typeof v.b === 'number') base = { type: 'SOLID', color: { r: v.r, g: v.g, b: v.b }, opacity: typeof v.a === 'number' ? v.a : 1 };
  } catch {
    /* unresolvable here: the black base, as before */
  }
  return figma.variables.setBoundVariableForPaint(base, 'color', variable);
}

function bind(node: SceneNode, field: string, variable: Variable | null): void {
  (node as unknown as Bindable).setBoundVariable(field, variable);
}

/** Resets a field Bridge manages to its neutral value (no binding), before the variant's own value is applied. */
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
      case 'opacity':
        bind(node, field, null);
        n.opacity = 1;
        return;
      case 'textDecoration':
        n.textDecoration = 'NONE';
        return;
      default:
        bind(node, field, null);
        n[field] = 0;
    }
  } catch {
    /* a field the node does not have (stroke weights on text): nothing to reset */
  }
}

/** Fixed sizing on one axis, so a set or bound size holds (auto layout would hug or fill over it). */
function fixAxis(node: SceneNode, field: 'width' | 'height'): void {
  if ('layoutSizingHorizontal' in node && node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE') {
    if (field === 'width') node.layoutSizingHorizontal = 'FIXED';
    else node.layoutSizingVertical = 'FIXED';
  } else if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    const horizontal = node.layoutMode === 'HORIZONTAL';
    if ((field === 'width') === horizontal) node.primaryAxisSizingMode = 'FIXED';
    else node.counterAxisSizingMode = 'FIXED';
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
      // A transparent border still takes its width in code (box-sizing): keep an invisible stroke so it counts in layout.
      if (f.field === 'stroke') n.strokes = [TRANSPARENT];
      else n.fills = [];
      return;
    }
    if (v.kind === 'number') {
      // A literal replaces a binding the layer had (an icon instance's stroke width from its master).
      try {
        if (f.field !== 'cornerRadius') bind(node, f.field, null);
      } catch {
        /* nothing bound */
      }
      if (f.field === 'cornerRadius') n.cornerRadius = v.value;
      else if (f.field === 'width' || f.field === 'height') {
        // Read only in Figma: fixed sizing on that axis, then resize.
        fixAxis(node, f.field);
        if ('resize' in node) {
          const r = node as FrameNode;
          r.resize(f.field === 'width' ? Math.max(0.01, v.value) : r.width, f.field === 'height' ? Math.max(0.01, v.value) : r.height);
        }
      } else n[f.field] = v.value;
      return;
    }
    if (v.kind === 'percent') {
      n[f.field] = { unit: 'PERCENT', value: v.value };
      return;
    }
    if (v.kind === 'font') {
      // fontName is set with the text, from the family list. Bound to the token's variable when it shows that family,
      // so the text follows the Brand mode (Ocean's Plex Sans) like its colors; never to a family Figma lacks.
      if (v.variable && node.type === 'TEXT') {
        const variable = ctx.vars.find({ kind: 'variable', path: v.path, ...v.variable, resolvedType: 'STRING' });
        const shown = variable?.resolveForConsumer(node).value;
        const family = node.fontName === figma.mixed ? undefined : node.fontName.family;
        if (variable && typeof shown === 'string' && family && familyKey(shown) === familyKey(family)) bind(node, 'fontFamily', variable);
      }
      return;
    }
    if (v.kind === 'keyword') {
      n[f.field] = v.value;
      return;
    }
    const variable = ctx.vars.find(v);
    if (!variable) return fail(`no variable "${v.name}" in ${v.collection}. Pull the variables, then pull components again.`);
    if (variable.resolvedType !== v.resolvedType) return fail(`"${v.name}" is a ${variable.resolvedType} variable, expected ${v.resolvedType}.`);
    switch (f.field) {
      case 'fill':
      case 'textFill':
        n.fills = [boundPaint(node, variable)];
        return;
      case 'stroke':
        n.strokes = [boundPaint(node, variable)];
        return;
      case 'cornerRadius':
        for (const c of CORNERS) bind(node, c, variable);
        return;
      case 'width':
      case 'height':
        fixAxis(node, f.field);
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

function setupFrame(node: Box, part: SpecPart, layout?: SpecLayout, sized = true): void {
  const l = layout ?? part.layout ?? { direction: 'HORIZONTAL', primary: 'MIN', counter: 'MIN' };
  node.layoutMode = l.direction;
  // space-between keeps the CSS gap as a minimum; Figma's makes the gap Auto, and a frame that hugs its content then
  // packs its children with no gap at all (a Switch with its label first was 72px for 84). Only a frame with a size
  // on its main axis spreads its children.
  node.primaryAxisAlignItems = l.primary === 'SPACE_BETWEEN' && !sized ? 'MIN' : l.primary;
  node.counterAxisAlignItems = l.counter === 'STRETCH' ? 'MIN' : l.counter;
  node.primaryAxisSizingMode = 'AUTO';
  node.counterAxisSizingMode = 'AUTO';
  // overflow: hidden in code (a card): the footer fill stays inside the rounded corners.
  node.clipsContent = !!part.clip;
  // Borders take room like CSS borders (border-box): drawn inside, counted in the auto layout size.
  node.strokeAlign = 'INSIDE';
  node.strokesIncludedInLayout = true;
  if (l.direction === 'HORIZONTAL') node.layoutWrap = l.wrap ? 'WRAP' : 'NO_WRAP';
}

/**
 * A child of a frame whose children stretch (align-items: stretch, a block's children) fills its parent on the cross
 * axis. Set last: the child's own hug sizing (setupFrame) would otherwise undo it, and FILL needs the node to be inside
 * its auto layout parent already. A text that fills the width wraps: fixed width, height grows.
 */
/**
 * An auto layout frame with nothing inside that hugs keeps the 100px a new frame starts with (a vertical Divider was
 * 1x100 for 1x16 in code). With no size of its own on an axis, it takes its minimum there, as CSS draws an empty box.
 */
function emptyAtMinimum(node: SceneNode, fields: readonly PlannedField[]): void {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return;
  const has = (f: SpecField) => fields.some((x) => x.field === f);
  const h = !has('height') && typeof node.minHeight === 'number' && node.minHeight > 0 ? node.minHeight : undefined;
  const w = !has('width') && typeof node.minWidth === 'number' && node.minWidth > 0 ? node.minWidth : undefined;
  if (h === undefined && w === undefined) return;
  node.resize(w ?? node.width, h ?? node.height);
  if (h !== undefined) node.layoutSizingVertical = 'FIXED';
  if (w !== undefined) node.layoutSizingHorizontal = 'FIXED';
}

/**
 * Back in its parent's auto layout. A layer the last pull pinned or laid over its parent is absolute, and Figma refuses
 * to make an absolute layer fill: it is sized in the layout first, then pinned again after placing.
 */
function intoLayout(node: SceneNode): void {
  try {
    if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') node.layoutPositioning = 'AUTO';
  } catch {
    /* its parent is no longer an auto layout: nothing to fill */
  }
}

function sizeInParent(node: SceneNode, parentPart: SpecPart | undefined, definite = true, tall = true, ownHeight = false): void {
  if (!parentPart?.layout || parentPart.layout.counter !== 'STRETCH' || !('layoutSizingHorizontal' in node)) return;
  // A vertical parent that hugs its content has no width to fill: its children hug too (same look for left-aligned
  // content; filling would turn the parent to a fixed width in Figma).
  if (parentPart.layout.direction === 'VERTICAL' && !definite) return;
  // A row with no height of its own, where every child would fill: nothing gives the height, and Figma keeps a new
  // frame's 100px (SegmentedControl 106px tall for 38 in code). They hug their content, as CSS stretch does then.
  if (parentPart.layout.direction === 'HORIZONTAL' && !tall) return;
  // A part with a height of its own keeps it (a table header cell is control.height.md): CSS stretch never shrinks it.
  if (parentPart.layout.direction === 'HORIZONTAL' && ownHeight) return;
  if (parentPart.layout.direction === 'VERTICAL') {
    node.layoutSizingHorizontal = 'FILL';
    if (node.type === 'TEXT') node.textAutoResize = 'HEIGHT';
  } else if (node.type !== 'TEXT') node.layoutSizingVertical = 'FILL';
}

/**
 * Generated parts sit under the parent the spec names, in spec order (a re-pull after code removed a wrapper moves
 * them), reversed where the variant's layout is (`flex-direction: row-reverse`: a label before its switch).
 */
function placeParts(variant: ComponentNode, comp: PlannedComponent, nodes: Map<string, SceneNode>, pv?: PlannedVariant): void {
  for (const parent of comp.parts) {
    const box = nodes.get(parent.id);
    if (!box || !('children' in box)) continue;
    const kids = comp.parts.filter((p) => p.parent === parent.id).map((p) => nodes.get(p.id)).filter((n): n is SceneNode => !!n);
    if ((pv?.layout?.[parent.id] ?? parent.layout)?.reverse) kids.reverse();
    kids.forEach((kid, i) => {
      if ((box as Box).children[i] !== kid) (box as Box).insertChild(i, kid);
    });
  }
  // Layers Bridge generated for parts code no longer has (a wrapper merged into the root): removed once empty.
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
    node = make.text();
  } else {
    const f = make.frame();
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
  // Parts with a width of their own (a fixed width, a root that fills its container in code) or filling such a parent.
  const definite = new Set<string>();
  for (const part of comp.parts) {
    const parentPart = comp.parts.find((p) => p.id === part.parent);
    const hasWidth = (pv.parts[part.id] ?? []).some((f) => f.field === 'width');
    const fills = !!parentPart && definite.has(parentPart.id) && ((parentPart.layout?.direction === 'VERTICAL' && parentPart.layout.counter === 'STRETCH') || (parentPart.layout?.direction === 'HORIZONTAL' && !!part.grow));
    if (hasWidth || fills) definite.add(part.id);
  }
  // Rows whose height is known: a height of their own, filling such a row, or a child that sets it (a text, an icon,
  // a part with a height) for the others to stretch to.
  const tall = new Set<string>();
  for (const part of comp.parts) {
    const parentPart = comp.parts.find((p) => p.id === part.parent);
    const hasHeight = (pv.parts[part.id] ?? []).some((f) => f.field === 'height');
    const fills = !!parentPart && tall.has(parentPart.id) && parentPart.layout?.direction === 'HORIZONTAL' && parentPart.layout.counter === 'STRETCH';
    const anchored = comp.parts.some((c) => c.parent === part.id && (c.kind === 'text' || !!c.icon || !!c.swap || (pv.parts[c.id] ?? []).some((f) => f.field === 'height')));
    if (hasHeight || fills || anchored) tall.add(part.id);
  }
  for (const part of comp.parts) {
    let node = findPart(variant, part.id);
    const parent = ((part.parent ? nodes.get(part.parent) : variant) ?? variant) as Box;
    if (part.swap || part.icon) {
      const target = pv.slots?.[part.id] ?? part.swap?.default ?? part.icon!;
      const main = ctx.parts.get(target);
      ctx.where = `${comp.name} ${pv.name}, ${part.name}`;
      if (main) {
        const inst = await placeInstance(node, main, parent, part.id, target);
        intoLayout(inst);
        nodes.set(part.id, inst);
        if (inst.name !== part.name) inst.name = part.name;
        const swapKey = propKeys.get(`swap:${part.id}`);
        const visibleKey = part.visible ? propKeys.get(part.visible) : undefined;
        inst.componentPropertyReferences = { ...(swapKey ? { mainComponent: swapKey } : {}), ...(visibleKey ? { visible: visibleKey } : {}) };
        // Binding the property must not change what this variant shows (Card padding none shows Media).
        if ((await inst.getMainComponentAsync())?.id !== main.id) inst.swapComponent(main);
        await styleInstance(inst, part.kind, pv.parts[part.id] ?? [], ctx);
        try {
          sizeInParent(inst, comp.parts.find((p) => p.id === part.parent), definite.has(part.parent ?? ''), tall.has(part.parent ?? ''));
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
    if (part.id !== 'root') intoLayout(node);
    if (part.id !== 'root' && node.name !== part.name) node.name = part.name;
    const parentPart = comp.parts.find((p) => p.id === part.parent);
    ctx.where = `${comp.name} ${pv.name}, ${part.name}`;
    const fields = pv.parts[part.id] ?? [];
    // Fields the variant sets are written by apply below: resetting them first wrote each one twice (a third of the
    // time a variant took). Corner radius is the exception: a number does not unbind the four corners.
    const setHere = new Set<SpecField>(fields.map((f) => f.field));
    const resetUnset = (list: readonly SpecField[], n: SceneNode) => {
      for (const f of list) if (f === 'cornerRadius' || !setHere.has(f)) reset(n, f);
    };
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
      // Text written in code (no TEXT property) follows the code; a property's text keeps what the set has.
      if (part.characters !== undefined && !prop) {
        if (node.characters !== part.characters) node.characters = part.characters;
      } else if (!node.characters) node.characters = typeof prop?.default === 'string' ? prop.default : part.name;
      const key = part.text ? propKeys.get(part.text) : undefined;
      const visibleKey = part.visible ? propKeys.get(part.visible) : undefined;
      if (key || visibleKey) node.componentPropertyReferences = { ...(key ? { characters: key } : {}), ...(visibleKey ? { visible: visibleKey } : {}) };
      resetUnset(TEXT_FIELDS, node);
    } else if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      if (part.kind === 'frame') {
        const lay = pv.layout?.[part.id] ?? part.layout;
        setupFrame(node, part, pv.layout?.[part.id], lay?.direction === 'VERTICAL' ? tall.has(part.id) && fields.some((f) => f.field === 'height') : definite.has(part.id));
      }
      else {
        node.layoutMode = 'NONE';
        node.fills = [];
      }
      if (part.kind === 'vector' && node.type === 'FRAME') drawVector(node, pv.vectors?.[part.id], ctx);
      resetUnset(part.kind === 'icon' ? ICON_FIELDS : FRAME_FIELDS, node);
      if (part.visible) {
        const key = propKeys.get(part.visible);
        if (key) node.componentPropertyReferences = { visible: key };
      }
    }
    for (const f of fields) apply(node, f, ctx);
    if (part.kind === 'frame' && !comp.parts.some((c) => c.parent === part.id)) emptyAtMinimum(node, fields);
    try {
      sizeInParent(node, parentPart, definite.has(part.parent ?? ''), tall.has(part.parent ?? ''), fields.some((f) => f.field === 'height'));
    } catch (err) {
      ctx.problems.push(`${ctx.where}, fill container: ${errorText(err)}`);
    }
  }
  placeParts(variant, comp, nodes, pv);
  // After placing: covers take their parent's size, hidden parts are hidden (unless a BOOLEAN property shows them).
  const hidden = new Set(pv.hidden ?? []);
  for (const part of comp.parts) {
    const node = nodes.get(part.id);
    if (!node || part.id === 'root') continue;
    if (pv.pins?.[part.id]) pinToParent(node, pv.pins[part.id]!, ctx);
    else if (part.cover) coverParent(node, ctx);
    else if (comp.pins?.[part.id]) pinToParent(node, comp.pins[part.id]!, ctx);
    else if (part.grow && definite.has(part.parent ?? '')) growInParent(node, comp.parts.find((p) => p.id === part.parent), pv, ctx);
    if (part.stretch || part.fraction !== undefined) stretchInParent(node, part, ctx);
    if (!part.visible) node.visible = !hidden.has(part.id);
  }
  // Thumbs last: their track has its final size once its other layers are placed.
  for (const part of comp.parts) {
    const node = nodes.get(part.id);
    if (node && part.at !== undefined) placeAt(node, part.at, ctx);
  }
}

/**
 * An inline SVG of the code (a spinner arc, a progress ring): its shapes as vectors in the part's frame, scaling with
 * it, redrawn only when the SVG changed, each shape's stroke bound to its token.
 */
function drawVector(frame: FrameNode, vec: { svg: string; hash: string; strokes: PlannedValue[] } | undefined, ctx: Ctx): void {
  if (!vec) return;
  frame.clipsContent = false;
  if (frame.getSharedPluginData(NS, 'svgHash') !== vec.hash || !frame.children.length) {
    for (const c of [...frame.children]) c.remove();
    const drawn = make.svg(vec.svg);
    try {
      frame.resizeWithoutConstraints(drawn.width, drawn.height);
      for (const c of [...drawn.children]) {
        frame.appendChild(c);
        if ('constraints' in c) c.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
      }
    } finally {
      drawn.remove();
    }
    frame.setSharedPluginData(NS, 'svgHash', vec.hash);
  }
  const shapes = frame.findAll((n) => ['VECTOR', 'ELLIPSE', 'LINE', 'RECTANGLE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'].includes(n.type));
  shapes.forEach((shape, i) => {
    const value = vec.strokes[i];
    if (value) apply(shape, { field: 'stroke', value }, ctx);
  });
}

/** `width: 100%` / `height: 100%`: Fill container on that axis; a value indicator: its share of the parent's width. */
function stretchInParent(node: SceneNode, part: SpecPart, ctx: Ctx): void {
  const parent = node.parent as Box | null;
  if (!parent || !('layoutSizingHorizontal' in node)) return;
  try {
    if (part.stretch?.height) node.layoutSizingVertical = 'FILL';
    if (part.fraction !== undefined) {
      node.layoutSizingHorizontal = 'FIXED';
      (node as FrameNode).resize(Math.max(1, Math.round(parent.width * part.fraction)), node.height);
    } else if (part.stretch?.width) node.layoutSizingHorizontal = 'FILL';
  } catch (err) {
    ctx.problems.push(`${ctx.where}, fill: ${errorText(err)}`);
  }
}

/** `flex: 1` in code: the part fills its auto layout parent along the parent's direction. */
function growInParent(node: SceneNode, parentPart: SpecPart | undefined, pv: PlannedVariant, ctx: Ctx): void {
  const layout = (parentPart && pv.layout?.[parentPart.id]) ?? parentPart?.layout;
  if (!layout || !('layoutSizingHorizontal' in node)) return;
  try {
    if (layout.direction === 'HORIZONTAL') node.layoutSizingHorizontal = 'FILL';
    else node.layoutSizingVertical = 'FILL';
  } catch (err) {
    ctx.problems.push(`${ctx.where}, fill: ${errorText(err)}`);
  }
}

/** `position: absolute` with offsets: out of the auto layout, placed from the parent's edges, constrained to them. */
function pinToParent(node: SceneNode, pin: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>, ctx: Ctx): void {
  const parent = node.parent as Box | null;
  if (!parent) return;
  try {
    if ('layoutMode' in parent && parent.layoutMode !== 'NONE') (node as FrameNode).layoutPositioning = 'ABSOLUTE';
    // Pinned to both edges of an axis (a hairline under a tab list, an indicator under its tab): it spans the parent
    // between them and stretches with it.
    const spanX = pin.left !== undefined && pin.right !== undefined;
    const spanY = pin.top !== undefined && pin.bottom !== undefined;
    if ((spanX || spanY) && 'resize' in node)
      (node as FrameNode).resize(spanX ? Math.max(1, parent.width - pin.left! - pin.right!) : node.width, spanY ? Math.max(1, parent.height - pin.top! - pin.bottom!) : node.height);
    node.x = pin.left ?? (pin.right !== undefined ? parent.width - node.width - pin.right : 0);
    node.y = pin.top ?? (pin.bottom !== undefined ? parent.height - node.height - pin.bottom : 0);
    if ('constraints' in node)
      node.constraints = {
        horizontal: spanX ? 'STRETCH' : pin.right !== undefined && pin.left === undefined ? 'MAX' : 'MIN',
        vertical: spanY ? 'STRETCH' : pin.bottom !== undefined && pin.top === undefined ? 'MAX' : 'MIN',
      };
  } catch (err) {
    ctx.problems.push(`${ctx.where}, position: ${errorText(err)}`);
  }
}

/** A thumb at the component's value (a slider's): absolute, its center at that share of the parent's width, centered across. */
function placeAt(node: SceneNode, at: number, ctx: Ctx): void {
  const parent = node.parent as Box | null;
  if (!parent) return;
  try {
    if ('layoutMode' in parent && parent.layoutMode !== 'NONE') (node as FrameNode).layoutPositioning = 'ABSOLUTE';
    node.x = Math.round(parent.width * at - node.width / 2);
    node.y = Math.round((parent.height - node.height) / 2);
    if ('constraints' in node) node.constraints = { horizontal: 'SCALE', vertical: 'CENTER' };
  } catch (err) {
    ctx.problems.push(`${ctx.where}, position: ${errorText(err)}`);
  }
}

/** A layer drawn over its parent (an avatar photo): absolute in the auto layout, as big as the parent, stretching with it. */
function coverParent(node: SceneNode, ctx: Ctx): void {
  const parent = node.parent as Box | null;
  if (!parent) return;
  try {
    if ('layoutMode' in parent && parent.layoutMode !== 'NONE') (node as FrameNode).layoutPositioning = 'ABSOLUTE';
    node.x = 0;
    node.y = 0;
    if ('resize' in node) (node as FrameNode).resize(Math.max(1, parent.width), Math.max(1, parent.height));
    if ('constraints' in node) node.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
  } catch (err) {
    ctx.problems.push(`${ctx.where}, cover: ${errorText(err)}`);
  }
}

/**
 * Ensures the set's TEXT and BOOLEAN properties exist with the spec's defaults, and an INSTANCE_SWAP property per
 * swappable part (default: the spec's component, preferred values: every icon or the slot's options). Returns
 * name -> Figma property key, and `swap:<part id>` -> key for swaps.
 */
/** INSTANCE_SWAP property keys the set's instance layers point to. */
function swapKeysInUse(set: ComponentSetNode): Set<string> {
  const out = new Set<string>();
  for (const n of set.findAllWithCriteria({ types: ['INSTANCE'] })) {
    const key = n.componentPropertyReferences?.mainComponent;
    if (key) out.add(key);
  }
  return out;
}

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
      try {
        set.deleteComponentProperty(k);
      } catch (err) {
        ctx.problems.push(`${comp.name}, property ${base(k)}: ${errorText(err)}`);
      }
    }
  }
  defs = set.componentPropertyDefinitions;
  // One property Figma refuses is reported; the layers it would drive keep their own values.
  for (const p of comp.properties) {
    try {
      // Figma wants a string default for TEXT and a boolean for BOOLEAN.
      const value = p.type === 'BOOLEAN' ? p.default === true || p.default === 'true' : typeof p.default === 'string' ? p.default : String(p.default ?? '');
      const figmaName = figmaPropName(comp, p);
      const existing =
        Object.keys(defs).find((k) => base(k) === figmaName && defs[k]!.type === p.type) ?? Object.keys(defs).find((k) => base(k) === p.name && defs[k]!.type === p.type);
      if (!existing) keys.set(p.name, set.addComponentProperty(figmaName, p.type, value));
      else {
        // A file built before "Show icon": the BOOLEAN is renamed in place (same id, instances keep their overrides).
        const renamed = base(existing) !== figmaName ? set.editComponentProperty(existing, { name: figmaName }) : existing;
        if (defs[existing]!.defaultValue !== value) set.editComponentProperty(renamed, { defaultValue: value });
        keys.set(p.name, renamed);
      }
      defs = set.componentPropertyDefinitions;
    } catch (err) {
      ctx.problems.push(`${comp.name}, property ${p.name}: ${errorText(err)}`);
    }
  }
  for (const part of comp.parts) {
    if (!part.swap) continue;
    const def = ctx.parts.get(part.swap.default);
    if (!def) continue;
    try {
    const preferredValues = (part.swap.options ?? ctx.icons)
      .map((n) => ctx.parts.get(n))
      .filter((c): c is ComponentNode => !!c)
      .map((c) => ({ type: 'COMPONENT' as const, key: c.key }));
    const name = part.swap.property;
    const fallback = `${name} (swap)`;
    // Figma renames a property whose name is taken by another type (the part's BOOLEAN "Icon" makes the swap "Icon2"):
    // the swap is found under that name too, never added again (each update used to add "Icon3", "Icon4"...).
    const others = new Set(comp.parts.filter((x) => x.swap && x.id !== part.id).map((x) => x.swap!.property));
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const same = new RegExp(`^(?:${esc}\\d*|${esc} \\(swap\\))$`);
    const matches = Object.keys(defs).filter((k) => defs[k]!.type === 'INSTANCE_SWAP' && same.test(base(k)) && !others.has(base(k)));
    const used = swapKeysInUse(set);
    const existing = matches.find((k) => used.has(k)) ?? matches[0];
    // Duplicates an earlier update added and no layer uses: removed, so the set shows one Icon property.
    for (const k of matches) {
      if (k === existing || used.has(k)) continue;
      try {
        set.deleteComponentProperty(k);
      } catch (err) {
        ctx.problems.push(`${comp.name}, property ${base(k)}: ${errorText(err)}`);
      }
    }
    let key: string;
    if (existing) {
      // The BOOLEAN is "Show icon" now, so the swap takes the plain name back ("Icon2" -> "Icon").
      key = set.editComponentProperty(existing, { ...(base(existing) !== name ? { name } : {}), defaultValue: def.id, preferredValues });
    } else {
      try {
        key = set.addComponentProperty(name, 'INSTANCE_SWAP', def.id, { preferredValues });
      } catch {
        // A file where the name is taken by the BOOLEAN of the same part: keep both, the swap says what it is.
        key = set.addComponentProperty(fallback, 'INSTANCE_SWAP', def.id, { preferredValues });
      }
    }
    keys.set(`swap:${part.id}`, key);
    } catch (err) {
      ctx.problems.push(`${comp.name}, property ${part.swap.property}: ${errorText(err)}`);
    }
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
    inst = make.instance(main);
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
  const frame = make.svg(icon.svg);
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
    text = make.text();
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
    icon = make.instance(main);
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
    for (let i = 0; i < plan.icons.length; i++) {
      const icon = plan.icons[i]!;
      const mark = created.mark();
      let comp = icons.get(icon.name);
      const isNew = !comp;
      try {
        if (!comp) {
          comp = make.component();
          page.appendChild(comp);
          comp.setSharedPluginData(NS, 'iconId', icon.name);
        }
        comp.name = icon.component;
        if (isNew || comp.getSharedPluginData(NS, 'iconHash') !== icon.hash || !vectorsOf(comp).length) {
          drawIcon(comp, icon, ctx, plan.iconFields ?? []);
          comp.setSharedPluginData(NS, 'iconHash', icon.hash);
          comp.description = `Lucide icon, generated by DS Bridge. Swap it in any component's icon property.`;
          if (isNew) counts.created++;
          else counts.updated++;
        }
        icons.set(icon.name, comp);
      } catch (err) {
        // One icon Figma refuses: not drawn (a new one is removed), the components that use it say so.
        created.rollback(mark);
        ctx.problems.push(`${icon.component} not drawn: ${reasonOf(err)}`);
      }
      await breathe();
    }
    const sorted = plan.icons.map((i) => icons.get(i.name)).filter((c): c is ComponentNode => !!c && !c.removed && c.parent?.id === page.id);
    sorted.forEach((c, i) => {
      c.x = (i % ICON_COLUMNS) * ICON_CELL;
      c.y = Math.floor(i / ICON_COLUMNS) * ICON_CELL;
    });
    await breathe();
  }
  for (const [name, c] of icons) ctx.parts.set(c.name || `Icon/${name}`, c);
  ctx.icons = (plan.icons ?? []).map((i) => i.component).filter((n) => ctx.parts.has(n));
  if (plan.slots?.length) {
    progress('Drawing content slots');
    const page = await pageFor(SLOTS_PAGE, 'slots');
    let x = 0;
    for (const slot of plan.slots) {
      const mark = created.mark();
      let comp = slots.get(slot.name);
      const isNew = !comp;
      try {
        if (!comp) {
          comp = make.component();
          page.appendChild(comp);
          comp.setSharedPluginData(NS, 'slotId', slot.name);
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
        slots.set(slot.name, comp);
        await breathe();
      } catch (err) {
        created.rollback(mark);
        // An existing slot that failed to redraw: its hash is cleared, so the next pull draws it again.
        if (comp && !comp.removed) comp.setSharedPluginData(NS, 'slotHash', '');
        ctx.problems.push(`${slot.name} not drawn: ${reasonOf(err)}`);
        if (!comp || comp.removed) continue;
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

/** A reaction as a comparable string: trigger, destination, navigation, transition (duration in ms, easing rounded). */
export function reactionKey(r: Reaction): string {
  const a = (r.actions?.[0] ?? r.action) as Action | undefined;
  const t = r.trigger as (Trigger & { delay?: number }) | null;
  if (!t || !a || a.type !== 'NODE') return JSON.stringify([t?.type ?? null, a?.type ?? null]);
  const tr = a.transition;
  const easing = tr ? [tr.easing.type, ...Object.values(tr.easing.easingFunctionCubicBezier ?? {}).map((n) => Math.round(n * 1000) / 1000)] : null;
  return JSON.stringify([t.type, t.delay ?? 0, a.destinationId, a.navigation, tr ? [tr.type, Math.round(tr.duration * 1000), easing] : null]);
}

/** A Figma reaction for a planned one: Change to the destination variant, Smart animate with the code's motion. */
function reactionFor(r: NonNullable<PlannedComponent['interactions']>[number], destinationId: string): Reaction {
  const trigger: Trigger =
    // No deprecatedVersion: the typings list it, Figma rejects it ("Unrecognized key").
    r.trigger === 'MOUSE_ENTER' || r.trigger === 'MOUSE_LEAVE' ? ({ type: r.trigger, delay: 0 } as unknown as Trigger) : { type: r.trigger };
  const t = r.transition;
  const transition: Transition | null = t
    ? {
        type: 'SMART_ANIMATE',
        duration: t.duration / 1000,
        easing:
          t.easing.type === 'CUSTOM_CUBIC_BEZIER' && t.easing.bezier
            ? { type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: t.easing.bezier[0], y1: t.easing.bezier[1], x2: t.easing.bezier[2], y2: t.easing.bezier[3] } }
            : { type: 'LINEAR' },
      }
    : null;
  return { trigger, actions: [{ type: 'NODE', destinationId, navigation: 'CHANGE_TO', transition }] };
}

/**
 * Prototype reactions on the variants of a generated set: hover, press and click change to another variant with the
 * code's motion. The reactions Bridge set last time are kept in shared plugin data (dsbridge / reactions) and
 * replaced; reactions designers added are kept, and when one uses the same trigger, Bridge leaves that trigger to
 * it. Nothing is written when the variant already has exactly these reactions (a second pull changes nothing).
 */
async function wireReactions(set: ComponentSetNode, comp: PlannedComponent, ctx: Ctx): Promise<void> {
  const byKey = new Map(
    set.children.filter((c): c is ComponentNode => c.type === 'COMPONENT' && c.getSharedPluginData(NS, 'orphan') !== 'true').map((c) => [c.getSharedPluginData(NS, 'variant'), c]),
  );
  for (const [key, node] of byKey) {
    let previous: string[] = [];
    try {
      // Written by an earlier Bridge: anything but a list of keys means none of the reactions are known as ours.
      const stored: unknown = JSON.parse(node.getSharedPluginData(NS, 'reactions') || '[]');
      previous = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      previous = [];
    }
    const ours = new Set(previous);
    const kept = node.reactions.filter((r) => !ours.has(reactionKey(r)));
    const taken = new Set(kept.map((r) => r.trigger?.type));
    const wanted: Reaction[] = [];
    for (const r of comp.interactions ?? []) {
      if (r.fromKey !== key) continue;
      const dest = byKey.get(r.toKey);
      if (!dest) continue;
      if (taken.has(r.trigger)) {
        ctx.problems.push(`${comp.name} ${node.name}: kept your own "${r.label}" interaction, so Bridge did not add its own`);
        continue;
      }
      wanted.push(reactionFor(r, dest.id));
    }
    const next = [...kept, ...wanted];
    // Same reactions in any order: nothing to write.
    const sorted = (list: readonly Reaction[]) => JSON.stringify(list.map(reactionKey).sort());
    const same = sorted(next) === sorted(node.reactions);
    if (!same) await node.setReactionsAsync(cleanReactions(next));
    const keys = wanted.length ? JSON.stringify(wanted.map(reactionKey)) : '';
    if (node.getSharedPluginData(NS, 'reactions') !== keys) node.setSharedPluginData(NS, 'reactions', keys);
  }
}

/** The summary line when Figma refused the interactions of some sets: they are built, without prototype interactions. */
export function interactionsNote(names: readonly string[]): string {
  const n = names.length;
  return `Interactions could not be added to ${n} ${n === 1 ? 'set' : 'sets'} (${names.join(', ')}). The components are built.`;
}

function bottomOf(page: PageNode): number {
  return page.children.reduce((m, n) => Math.max(m, n.y + n.height), 0);
}

/** A variant's key: the one Bridge stored, else read from its name (its properties throw while the set is in error). */
export function keyOfVariant(c: ComponentNode): string {
  const stored = c.getSharedPluginData(NS, 'variant');
  if (stored) return stored;
  return variantKeyOf(propsOfKey(c.name));
}

/** A set none of whose variants could be built: its message is already the reason in words. */
class NotBuilt extends Error {}

export interface ApplyOptions {
  /** Checked between sets: true stops the build after the set in progress (Cancel in the plugin). */
  cancelled?: (() => boolean) | undefined;
}

/** Where new sets go: the Components page, below what it holds (its bottom read once, then kept). */
interface Placement {
  page?: PageNode | undefined;
  bottom?: number | undefined;
  /** Generated sets already in the file: a new set goes next to the one its name extends, where the designer put it. */
  sets?: readonly ComponentSetNode[] | undefined;
}

type Container = BaseNode & ChildrenMixin;

/**
 * Where a new set goes in a file organised by hand: with the set its name extends ("Select/Popup" with "Select",
 * "AccordionItem" with "Accordion"), in that set's page, section or frame, when the designer moved it off the
 * Components page. None otherwise: new sets go on the Components page, as before.
 */
export function homeOf(name: string, sets: readonly ComponentSetNode[], componentsPage: PageNode | undefined): { container: Container; near: ComponentSetNode } | undefined {
  let near: ComponentSetNode | undefined;
  for (const s of sets) {
    if (s.removed || s.name === name || !name.startsWith(s.name)) continue;
    // A whole word: "Select/Popup" and "AccordionItem" extend their set; "Tables" does not extend "Table".
    const next = name.charAt(s.name.length);
    if (next !== '/' && !/[A-Z ]/.test(next)) continue;
    if (!near || s.name.length > near.name.length) near = s;
  }
  if (!near?.parent || pageOf(near) === componentsPage) return undefined;
  return { container: near.parent as Container, near };
}

/** Puts a new set into its home: below what the home holds (an auto layout frame places it itself). */
function moveHome(set: ComponentSetNode, home: { container: Container; near: ComponentSetNode }): void {
  const { container, near } = home;
  const kids = container.children.filter((c) => c !== set);
  container.appendChild(set);
  if ('layoutMode' in container && container.layoutMode !== 'NONE') return;
  set.x = near.x;
  set.y = kids.reduce((m, n) => Math.max(m, n.y + n.height), 0) + SET_GAP;
  // A section does not grow with what it holds: make room.
  if (container.type === 'SECTION' && (set.x + set.width > container.width || set.y + set.height > container.height)) {
    container.resizeWithoutConstraints(Math.max(container.width, set.x + set.width + SET_GAP), Math.max(container.height, set.y + set.height + SET_GAP));
  }
}

/**
 * Builds or updates one set. Each variant is built on its own: a variant Figma refuses is rolled back (removed when
 * this pull created it) and named in the report, the others are built. When nothing of the set can be built, or a
 * set-level step fails, everything this pull created for it is removed and the set is reported as not built.
 */
async function buildSet(comp: PlannedComponent, existingSet: ComponentSetNode | undefined, ctx: Ctx, report: ComponentApplyReport, place: Placement, interactionsFailed: string[]): Promise<void> {
  const mark = created.mark();
  let set = existingSet;
  const isNew = !set;
  /** Variant nodes made by this pull: removed when they fail. */
  const fresh = new Set<string>();
  const failed: { name: string; reason: string }[] = [];
  /** Variants not even created (a new set): built by the update path of the next pull. */
  const skipped = new Set<string>();
  try {
    if (!set) {
      place.page ??= await componentsPage();
      const page = place.page;
      place.bottom ??= bottomOf(page);
      // Variants first (combineAsVariants needs them), then properties on the set, then wiring. No await until the set
      // carries its componentId: if Figma closes now, the next pull finds the set and goes on, never a duplicate.
      const made: ComponentNode[] = [];
      for (const pv of comp.variants) {
        const vmark = created.mark();
        try {
          const c = make.component();
          c.name = pv.name;
          c.setSharedPluginData(NS, 'variant', pv.key);
          page.appendChild(c);
          fresh.add(c.id);
          made.push(c);
        } catch (err) {
          created.rollback(vmark);
          failed.push({ name: pv.name, reason: reasonOf(err) });
          skipped.add(pv.key);
        }
      }
      if (!made.length) throw new NotBuilt(failed[0]?.reason ?? 'no variant could be created');
      set = created.add(figma.combineAsVariants(made, page));
      set.setSharedPluginData(NS, 'componentId', comp.componentId);
      set.x = 0;
      set.y = place.bottom ? place.bottom + SET_GAP : 0;
    }
    set.name = comp.name;
    set.description = comp.description;
    // Which variant becomes which (a new axis keeps the variants it extends), and the orphans' names. Renamed first,
    // so the set has one shape again before anything reads its properties.
    const members = set.children.filter((c): c is ComponentNode => c.type === 'COMPONENT');
    const byId = new Map(members.map((c) => [c.id, c]));
    const match = matchVariants(members.map((c) => ({ id: c.id, key: keyOfVariant(c) })), comp.variants, comp.axes);
    const variants = new Map<string, ComponentNode>();
    for (const pv of comp.variants) {
      const node = byId.get(match.reuse.get(pv.key) ?? '');
      if (!node) continue;
      variants.set(pv.key, node);
      if (node.name !== pv.name) node.name = pv.name;
    }
    for (const o of match.orphans) {
      const node = byId.get(o.id)!;
      if (node.name !== o.name) node.name = o.name;
      if (node.getSharedPluginData(NS, 'orphan') !== 'true') {
        node.setSharedPluginData(NS, 'orphan', 'true');
        if (!node.description.startsWith(ORPHAN_PREFIX)) node.description = ORPHAN_PREFIX + node.description;
        report.orphaned++;
      }
    }
    const propKeys = ensureProperties(set, comp, ctx);
    for (const pv of comp.variants) {
      if (skipped.has(pv.key)) continue;
      let node = variants.get(pv.key);
      const vmark = created.mark();
      const isFresh = !node || fresh.has(node.id);
      try {
        if (!node) {
          node = make.component();
          // Named before it joins the set: an unnamed variant leaves the set in error.
          node.name = pv.name;
          node.setSharedPluginData(NS, 'variant', pv.key);
          set.appendChild(node);
        }
        await configureVariant(node, comp, pv, propKeys, ctx);
      } catch (err) {
        failed.push({ name: pv.name, reason: reasonOf(err) });
        created.rollback(vmark);
        if (isFresh && node && !node.removed) node.remove();
      }
      // Yield to Figma often enough that the file never freezes, whatever the size of the set.
      await breathe();
    }
    if (set.removed || failed.length === comp.variants.length) throw new NotBuilt(failed[0]?.reason ?? 'Figma removed the set');
    await breathe();
    // Interactions are extra: when Figma refuses them, this set is still built and the pull goes on.
    try {
      await wireReactions(set, comp, ctx);
    } catch (err) {
      interactionsFailed.push(comp.name);
      console.warn(`Bridge: interactions on ${comp.name} not added: ${errorText(err)}`);
    }
    // Always: an update can change variant sizes (a padding, a fixed width), not only add variants.
    try {
      layoutVariants(set, comp);
    } catch (err) {
      ctx.problems.push(`${comp.name}, variant grid: ${errorText(err)}`);
    }
    if (isNew) {
      const home = homeOf(comp.name, place.sets ?? [], place.page);
      if (home) moveHome(set, home);
      else place.bottom = Math.max(place.bottom ?? 0, set.y + set.height);
    }
    if (failed.length) {
      // Built in part: no spec hash, so the next pull plans it again and builds the variants left out.
      set.setSharedPluginData(NS, 'specHash', '');
      report.partial = [...(report.partial ?? []), { name: comp.name, built: comp.variants.length - failed.length, total: comp.variants.length, reason: failed[0]!.reason, variants: failed.map((f) => f.name) }];
    } else {
      set.setSharedPluginData(NS, 'specHash', comp.hash);
      set.setSharedPluginData(NS, 'codeHash', comp.codeHash);
      // Rebuilt from the code: a change pushed from Figma is now the reviewed code (or gone), so its mark goes.
      if (set.getSharedPluginData(NS, PUSHED_KEY)) set.setSharedPluginData(NS, PUSHED_KEY, '');
    }
    await breathe();
    // The generated set is the baseline: a Push right after a pull sends nothing.
    try {
      set.setSharedPluginData(NS, 'signature', JSON.stringify(buildSignature(await readComponent(set))));
    } catch (err) {
      // Said on the Pull screen: without a baseline, a Push cannot tell this set's edits from the pull.
      ctx.problems.push(`${comp.name}: its baseline for Push was not stored (${errorText(err)}). Pull again.`);
    }
    report.nodeIds.push(set.id);
    if (isNew) report.created++;
    else report.updated++;
    if (pageOf(set)?.name !== PAGE_NAME) report.elsewhere = (report.elsewhere ?? 0) + 1;
  } catch (err) {
    // Nothing half-built stays: what this pull created for the set goes, a new set included.
    created.rollback(mark);
    if (isNew && set && !set.removed) set.remove();
    throw err;
  }
}

/** Shared plugin data on the file: the pull building components here, and when it last moved. */
const LOCK_KEY = 'buildLock';
/** A lock that has not moved for this long was left by a pull that stopped (Figma closed): it no longer holds. */
const LOCK_STALE_MS = 120_000;
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type BuildLock = { session: string; started: number; at: number };

/** Another pull building components in this file right now (a teammate in the same file), or none. */
export function otherBuild(now = Date.now()): BuildLock | undefined {
  try {
    const lock = JSON.parse(figma.root.getSharedPluginData(NS, LOCK_KEY) || 'null') as BuildLock | null;
    return lock && lock.session !== session && now - lock.at < LOCK_STALE_MS ? lock : undefined;
  } catch {
    return undefined;
  }
}

const holdBuildLock = (started: number) => figma.root.setSharedPluginData(NS, LOCK_KEY, JSON.stringify({ session, started, at: Date.now() }));

function releaseBuildLock(): void {
  try {
    const lock = JSON.parse(figma.root.getSharedPluginData(NS, LOCK_KEY) || 'null') as BuildLock | null;
    if (lock?.session === session) figma.root.setSharedPluginData(NS, LOCK_KEY, '');
  } catch {
    /* unreadable: left to go stale */
  }
}

export async function applyComponentPlan(plan: ComponentPullPlan, progress: Progress = () => undefined, opts: ApplyOptions = {}): Promise<ComponentApplyReport> {
  // Two pulls at once in one file (two designers) would both build the new components: one at a time.
  const other = otherBuild();
  if (other) {
    const minutes = Math.max(1, Math.round((Date.now() - other.started) / 60_000));
    throw new Error(`Someone else is pulling components into this file (started ${minutes} min ago). Wait until it ends, then check again: two pulls at once would build the same components twice.`);
  }
  const started = Date.now();
  holdBuildLock(started);
  try {
    return await buildAll(plan, progress, opts, started);
  } finally {
    releaseBuildLock();
  }
}

async function buildAll(plan: ComponentPullPlan, progress: Progress, opts: ApplyOptions, started: number): Promise<ComponentApplyReport> {
  created = new Created();
  // Each build measures again whether Figma shows the file.
  resetTurns();
  const ctx: Ctx = { vars: new Variables(), fonts: new Fonts(), problems: [], where: '', parts: new Map(), icons: [] };
  const report: ComponentApplyReport = { created: 0, updated: 0, unchanged: 0, orphaned: 0, page: PAGE_NAME, problems: ctx.problems, nodeIds: [], total: plan.components.length, failed: [] };
  try {
    await ctx.vars.load();
  } catch (err) {
    ctx.problems.push(`Variables could not be read (${errorText(err)}): components are built without bindings. Pull again.`);
  }
  await ctx.fonts.load();
  // Index the generated sets once (by componentId): no search per component. A duplicate (a set copied by hand) is
  // left alone; the first one found is updated.
  const existing = new Map<string, ComponentSetNode>();
  for (const s of await generatedSets()) {
    const id = s.getSharedPluginData(NS, 'componentId');
    if (!existing.has(id)) existing.set(id, s);
  }
  await breathe();
  try {
    await ensureParts(plan, ctx, report, progress);
  } catch (err) {
    ctx.problems.push(`Icons and content slots: ${reasonOf(err)}. Components that use them are built without them.`);
  }
  created.sweep();
  const place: Placement = { sets: [...existing.values()] };
  const interactionsFailed: string[] = [];
  const todo = plan.components.length;
  try {
    for (let i = 0; i < todo; i++) {
      const comp = plan.components[i]!;
      if (opts.cancelled?.()) {
        report.cancelled = plan.components.slice(i).map((c) => c.name);
        break;
      }
      if (comp.status === 'unchanged' && existing.has(comp.componentId)) {
        report.unchanged++;
        continue;
      }
      progress(`Building ${i + 1} of ${todo}: ${comp.name}`);
      try {
        await buildSet(comp, existing.get(comp.componentId), ctx, report, place, interactionsFailed);
      } catch (err) {
        report.failed!.push({ name: comp.name, reason: err instanceof NotBuilt ? err.message : reasonOf(err) });
      }
      created.sweep();
      // Still building: a teammate's pull waits.
      holdBuildLock(started);
      await breathe();
    }
  } finally {
    created.sweep();
  }
  if (interactionsFailed.length) report.interactionsNote = interactionsNote(interactionsFailed);
  if (ctx.fonts.missing.size) {
    report.fontNote = `${[...ctx.fonts.missing].join(', ')} ${ctx.fonts.missing.size === 1 ? 'is' : 'are'} not available in this Figma, so text uses Inter. Install the font and pull again.`;
  }
  return report;
}
