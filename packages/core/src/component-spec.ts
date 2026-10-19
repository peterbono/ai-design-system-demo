// Component specs: a declarative description of a coded component, derived from its TSX props and CSS module, that a
// design tool can rebuild (the DS Bridge Figma plugin pulls them as component sets bound to variables).
//
// Generated, never hand-maintained: `npm run specs` reads packages/react/src/components and writes
// packages/react/component-specs.json (generator in @bridge-ds/core/node, component-specs.ts). A test fails when the
// committed file is out of date. Only token paths are recorded: component CSS has no literal values.
//
// Pure types and helpers: safe in the plugin sandbox and the browser.

/** Format version of component-specs.json. */
export const COMPONENT_SPECS_VERSION = 1;

/** Where the specs live when bridge.config.json does not say (`components.specs`). */
export const DEFAULT_COMPONENT_SPECS_FILE = 'packages/react/component-specs.json';

/**
 * A Figma-side property a CSS declaration maps to.
 * Frames: fill (background-color), stroke and stroke weights (border), cornerRadius (border-radius), paddings, itemSpacing
 * (gap), sizes. Text: textFill (color), font family, size, weight, line height, letter spacing, and textDecoration (a
 * keyword, "UNDERLINE" or "STRIKETHROUGH", not a token).
 */
export type SpecField =
  | 'fill'
  | 'stroke'
  | 'strokeWeight'
  | 'strokeTopWeight'
  | 'strokeRightWeight'
  | 'strokeBottomWeight'
  | 'strokeLeftWeight'
  | 'cornerRadius'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'itemSpacing'
  | 'counterAxisSpacing'
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'opacity'
  | 'textFill'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textDecoration';

export const SPEC_FIELDS: readonly SpecField[] = [
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
  'textFill',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
];

/** Fields whose token must be a color. */
export const COLOR_FIELDS: ReadonlySet<SpecField> = new Set(['fill', 'stroke', 'textFill']);

/**
 * A token path ("button.primary.bg"), a literal number (`padding: 0`, a unitless `stroke-width: 3` or `opacity: 0.5`),
 * null: no paint (`transparent`), or a calc() of token paths ("calc(space.2 + space.0-5)", operators + - * / and px
 * numbers): resolved to a number, set but not bound.
 */
export type SpecValue = string | number | null;

export interface SpecLayout {
  direction: 'HORIZONTAL' | 'VERTICAL';
  /** justify-content. */
  primary: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  /** align-items. STRETCH: children fill the cross axis. */
  counter: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  /** `flex-direction: row-reverse | column-reverse`: children are drawn in reverse order. */
  reverse?: boolean | undefined;
  /** `flex-wrap: wrap` on a row: items wrap to new lines (Figma auto layout wrap). */
  wrap?: boolean | undefined;
}

export interface SpecPart {
  /** Stable id inside the component ("root", "label", "icon-start"). Figma layers keep it in plugin data. */
  id: string;
  /** Layer name in Figma. */
  name: string;
  /** vector: an inline SVG drawn from the variant's `vectors` markup (a spinner arc, a progress ring). */
  kind: 'frame' | 'text' | 'icon' | 'vector';
  /** Parent part id; undefined for the root (the variant itself). */
  parent?: string | undefined;
  /** CSS module class the part is styled by ("Button.module.css .label"), for people reading the spec. */
  source?: string | undefined;
  layout?: SpecLayout | undefined;
  /** Text parts: the TEXT component property that holds the characters. */
  text?: string | undefined;
  /** Optional parts (an icon prop): the BOOLEAN component property that shows them. */
  visible?: string | undefined;
  /** Frames with `overflow: hidden` or `clip`: clip their content in Figma. */
  clip?: boolean | undefined;
  /** Root only: block-level in code (display block, flex or grid, or width 100%), so it fills its container. Figma draws it at a fixed width. */
  fill?: boolean | undefined;
  /** Text parts with no TEXT property (content written in code, like a group's option labels): the characters drawn. */
  characters?: string | undefined;
  /**
   * Positioned over its parent instead of flowing in its auto layout (an avatar photo over its initials): `position:
   * absolute` with `inset: 0`, or `width` and `height` 100%. Drawn as an absolute child that fills its parent.
   */
  cover?: boolean | undefined;
  /**
   * `position: absolute` with token offsets (a dialog's close button): out of the auto layout, pinned to the parent's
   * edges by these offsets (top, right, bottom, left).
   */
  pin?: { top?: SpecValue; right?: SpecValue; bottom?: SpecValue; left?: SpecValue } | undefined;
  /** `width: 100%` or `height: 100%` in a parent of that size: Fill container on that axis. */
  stretch?: { width?: boolean; height?: boolean } | undefined;
  /** A value indicator (a progress fill): this share of its parent's width, from the component's value. */
  fraction?: number | undefined;
  /** `flex: 1` in code: takes the free space along its parent's auto layout direction (Figma "Fill container"). */
  grow?: boolean | undefined;
  /**
   * A swappable part: drawn as an instance of a generated component ("Icon/Plus", "Slot/Media") and swapped through an
   * INSTANCE_SWAP property. Icon parts swap between every icon of `icons`; content slots between `options`.
   */
  swap?: SpecSwap | undefined;
  /** Icon parts whose icon is written in code (a checkbox's check mark): an instance of this icon, with no property. */
  icon?: string | undefined;
}

export interface SpecSwap {
  /** INSTANCE_SWAP property name ("Icon", "Icon start", "Body"). */
  property: string;
  /** Component the property defaults to (the default variant's): "Icon/Pencil", "Slot/Card body text". */
  default: string;
  /** Preferred values. Undefined for icon parts: every icon of the file. */
  options?: string[] | undefined;
  /** Code prop it stands for ("icon", "iconStart"); undefined for a compound part's content. */
  prop?: string | undefined;
}

/** A Lucide icon the specs use, drawn as a component "Icon/<name>" on the Icons page. */
export interface SpecIcon {
  /** Name as code imports it from lucide-react ("Trash2"), the first one referenced. */
  name: string;
  /** Lucide icon id (file name in lucide-react): "trash". */
  lucide: string;
  /** Other names of the same icon referenced by the components or the common set ("AlertTriangle"). */
  aliases?: string[] | undefined;
  /** Normalized SVG markup, 24x24 viewBox, stroke="currentColor". */
  svg: string;
}

/** Tokens of the icon components (Icon/<name>) themselves; instances in components use their variant's tokens. */
export interface SpecIconStyle {
  /** Size token of the master frame. */
  size: string;
  /** Stroke color token. */
  color: string;
  /** Stroke width token. */
  stroke: string;
}

/** A generated content component a slot swaps to ("Slot/Card body text", "Slot/Media"), on the Slots page. */
export interface SpecSlot {
  name: string;
  kind: 'text' | 'media';
  /** Fields of the slot's own layer: text fields for a text slot, fill and width for media. */
  values: Partial<Record<SpecField, SpecValue>>;
  /** Text slots: the TEXT property and its default. */
  text?: { property: string; default: string } | undefined;
  /** Media: width / height ratio, and the centered icon with its fields. */
  aspect?: [number, number] | undefined;
  icon?: string | undefined;
  iconValues?: Partial<Record<SpecField, SpecValue>> | undefined;
}

/** A variant axis from a string-literal union prop (variant, size, tone) or the State axis. */
export interface SpecAxis {
  /** Figma property name ("Variant", "Size", "State"). */
  name: string;
  /** Code prop it comes from; undefined for State. */
  prop?: string | undefined;
  values: string[];
  default: string;
}

export interface SpecProperty {
  name: string;
  type: 'TEXT' | 'BOOLEAN';
  default: string | boolean;
  /** Code prop it stands for ("children", "iconStart"). */
  prop?: string | undefined;
}

export interface SpecVariant {
  /** Axis name -> value, in axis order. */
  props: Record<string, string>;
  /** Part id -> Figma field -> value. */
  values: Record<string, Partial<Record<SpecField, SpecValue>>>;
  /** Swappable part id -> the component this variant shows by default ("Icon/Plus", "Slot/Media"). */
  slots?: Record<string, string> | undefined;
  /** Parts this variant does not show (`display: none`, `opacity: 0` or `scale(0)` in this state): hidden layers. */
  hidden?: string[] | undefined;
  /** Parts whose auto layout differs from the part's own in this variant (a switch thumb at the end when on). */
  layout?: Record<string, SpecLayout> | undefined;
  /** Vector parts: the SVG this variant draws and the stroke token of each shape, in order. */
  vectors?: Record<string, SpecVector> | undefined;
}

/** An inline SVG part: markup with literal geometry (strokes painted #000000) and the token bound to each shape's stroke. */
export interface SpecVector {
  svg: string;
  strokes: SpecValue[];
}

/** A declaration, prop or part that has no Figma equivalent in this version, with the reason. */
export interface SpecUnmapped {
  part: string;
  property: string;
  value: string;
  reason: string;
}

export interface ComponentSpec {
  name: string;
  /** Component folder the set comes from, when it is not the set's name (Radio comes from RadioGroup). */
  component?: string | undefined;
  /** Props pinned for this set (`{ variant: 'circular' }` for Progress/Circular, a set per layer tree). */
  fixed?: Record<string, string> | undefined;
  /** A popup drawn open (`popup`), or the component without its popup (`without-popup`). */
  view?: 'popup' | 'without-popup' | undefined;
  /** FNV-1a of everything else in the spec: unchanged hash, nothing to rebuild. */
  hash: string;
  /** Files it was read from, repo-relative. */
  source: string[];
  axes: SpecAxis[];
  properties: SpecProperty[];
  parts: SpecPart[];
  variants: SpecVariant[];
  unmapped: SpecUnmapped[];
}

export interface ComponentSpecsFile {
  version: number;
  /** Human note at the top of the file. */
  generated: string;
  components: ComponentSpec[];
  /** Icons the components use (slot defaults, docs and stories) plus a common set, sorted by name. */
  icons?: SpecIcon[] | undefined;
  iconStyle?: SpecIconStyle | undefined;
  /** Content components slots swap to. */
  slots?: SpecSlot[] | undefined;
  /**
   * Every component of the design system and whether it is in Figma: generated (its sets are in `components`),
   * unsupported (with the generator's reason) or layout (no visual of its own: a layout helper, use auto layout).
   * Undefined in files written before coverage was recorded.
   */
  coverage?: SpecCoverage[] | undefined;
}

export type CoverageStatus = 'generated' | 'unsupported' | 'layout';

export interface SpecCoverage {
  /** Component folder name ("RadioGroup"). */
  name: string;
  status: CoverageStatus;
  /** Plain reason, for unsupported and layout components ("opens a popup", "uses CSS grid"). */
  reason?: string | undefined;
  /** Sets generated from it, when they are not just its own name ("RadioGroup", "Radio"). */
  sets?: string[] | undefined;
}

/** Coverage counts: visual components (generated + unsupported) and layout helpers, from a specs file. */
export function coverageSummary(file: Pick<ComponentSpecsFile, 'coverage' | 'components'>): { generated: number; visual: number; layout: number; total: number; missing: SpecCoverage[] } {
  const list = file.coverage ?? file.components.map((c) => ({ name: c.name, status: 'generated' as const }));
  const generated = list.filter((c) => c.status === 'generated').length;
  const layout = list.filter((c) => c.status === 'layout').length;
  return { generated, visual: list.length - layout, layout, total: list.length, missing: list.filter((c) => c.status === 'unsupported') };
}

/** Figma component name of an icon: "Icon/Plus". */
export const iconComponentName = (name: string) => `Icon/${name}`;

/** FNV-1a, 32 bits, 8 hex digits. */
export function specHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Hash of a spec without its own hash field. */
export function hashSpec(spec: Omit<ComponentSpec, 'hash'> | ComponentSpec): string {
  const { hash: _ignored, ...rest } = spec as ComponentSpec;
  return specHash(JSON.stringify(rest));
}

/** Figma variant name for a variant's props: "Variant=primary, Size=md, State=Default" (axis order). */
export const variantName = (props: Record<string, string>) =>
  Object.entries(props)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

/** Variant key independent of axis order (same as the plugin's signature keys): sorted "Size=md, Variant=primary". */
export const variantKeyOf = (props: Record<string, string>) =>
  Object.keys(props)
    .sort()
    .map((k) => `${k}=${props[k]}`)
    .join(', ') || 'Default';

/** Parses component-specs.json; throws with a readable message when it is not a specs file of a known version. */
export function parseComponentSpecs(text: string): ComponentSpecsFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('component-specs.json is not valid JSON.');
  }
  const f = data as ComponentSpecsFile;
  if (!f || typeof f !== 'object' || !Array.isArray(f.components)) throw new Error('component-specs.json has no "components" list.');
  if (f.version !== COMPONENT_SPECS_VERSION) throw new Error(`component-specs.json is version ${String(f.version)}; this tool reads version ${COMPONENT_SPECS_VERSION}.`);
  return f;
}

/** CSS custom property of a token path, with the repo convention (`cssVar` in bridge.config.json): "--" + path joined by "-". */
export const tokenCssVar = (path: string, prefix = '--', separator = '-') => `${prefix}${path.split('.').join(separator)}`;
