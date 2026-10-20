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
  /**
   * A thumb placed at the component's value (a slider's): out of the auto layout, its center at this share of its
   * parent's width, centered on the parent's height.
   */
  at?: number | undefined;
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
  /** Absolute parts placed differently in this variant (offsets from the parent's edges, like SpecPart.pin). */
  pins?: Record<string, NonNullable<SpecPart['pin']>> | undefined;
}

/** An inline SVG part: markup with literal geometry (strokes painted #000000) and the token bound to each shape's stroke. */
export interface SpecVector {
  svg: string;
  strokes: SpecValue[];
}

/**
 * A prototype trigger, Figma's names. ON_HOVER "While hovering" and ON_PRESS "While pressing" go back when the pointer
 * leaves or lets go; ON_CLICK "On click" stays. A set with a Checked axis uses MOUSE_ENTER / MOUSE_LEAVE for hover, so a
 * click that changes Checked is not undone when the pointer leaves.
 */
export type SpecTrigger = 'ON_HOVER' | 'ON_PRESS' | 'ON_CLICK' | 'MOUSE_ENTER' | 'MOUSE_LEAVE';

/** Designer names of the triggers, as Figma's prototype panel shows them. */
export const TRIGGER_LABELS: Record<SpecTrigger, string> = {
  ON_HOVER: 'While hovering',
  ON_PRESS: 'While pressing',
  ON_CLICK: 'On click',
  MOUSE_ENTER: 'Mouse enter',
  MOUSE_LEAVE: 'Mouse leave',
};

/** An easing Figma can play: linear, or a cubic bezier with the exact points of the code's curve. */
export interface SpecEasing {
  type: 'LINEAR' | 'CUSTOM_CUBIC_BEZIER';
  /** CUSTOM_CUBIC_BEZIER: x1, y1, x2, y2. */
  bezier?: [number, number, number, number] | undefined;
}

/** The code's CSS transition for one change, resolved from the motion tokens. Played with Smart animate. */
export interface SpecTransition {
  /** Milliseconds. */
  duration: number;
  /** Token behind the duration ("motion.duration.instant"), when it is one. */
  durationToken?: string | undefined;
  easing: SpecEasing;
  /** Token behind the easing ("motion.easing.standard"), when it is one. */
  easingToken?: string | undefined;
  /** CSS properties the code animates in this change ("background-color"). */
  properties: string[];
  /** Why Figma plays it slightly differently from the code (one speed for parts that move at several), when it does. */
  approximated?: string | undefined;
}

/**
 * A prototype interaction between variants of the set, read from the CSS: on `trigger`, every variant whose `axis` is
 * `from` changes to the variant with `to` instead (other axes kept). `variants` narrows it to those variant keys
 * (variantKeyOf) when it does not apply to all of them. `transition` null: the code changes it instantly.
 */
export interface SpecInteraction {
  trigger: SpecTrigger;
  axis: string;
  from: string;
  to: string;
  variants?: string[] | undefined;
  transition: SpecTransition | null;
}

/** Motion the code has that a Figma prototype cannot play (a looping spinner, keyboard focus, a popup opening). */
export interface SpecMotionNote {
  /** What moves, in plain words ("Looping animation spin, 700 ms"). */
  what: string;
  /** Why Figma does not play it. */
  reason: string;
  /** A keyframe animation: the token behind its duration ("motion.duration.spin"), when it is one. */
  durationToken?: string | undefined;
  /** Opening and closing: the code's transition when it opens (enter) and when it closes (exit), when it has one. */
  enter?: SpecTransition | undefined;
  exit?: SpecTransition | undefined;
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
  /**
   * Drafted with Claude, not generated: the generator cannot read this component, so its spec was written by hand from
   * the code (packages/react/component-spec-overrides/<Name>.json, `"source": "drafted"`) and validated like a generated
   * one. Shown in the plugin as "Drafted, check it". `stale`: the code it was drafted from changed since.
   */
  drafted?: { reason: string; stale?: boolean | undefined } | undefined;
  /**
   * The code example the set's content comes from (the docs preview or a component sandbox example): the element, its
   * props and children, so the fidelity check renders the same thing. Not in the hash: it does not change the drawing.
   */
  example?: SpecExample | undefined;
  /** FNV-1a of everything else in the spec: unchanged hash, nothing to rebuild. */
  hash: string;
  /** Files it was read from, repo-relative. */
  source: string[];
  axes: SpecAxis[];
  properties: SpecProperty[];
  parts: SpecPart[];
  variants: SpecVariant[];
  unmapped: SpecUnmapped[];
  /** Prototype interactions between the variants (hover, press, click to check), with the code's motion. */
  interactions?: SpecInteraction[] | undefined;
  /** Motion of the code a Figma prototype cannot play. */
  motion?: SpecMotionNote[] | undefined;
}

/** An element of a code example: component export name, literal props, children (texts or elements). */
export interface SpecExample {
  c: string;
  p?: Record<string, unknown> | undefined;
  children?: (string | SpecExample)[] | undefined;
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

export type CoverageStatus = 'generated' | 'drafted' | 'unsupported' | 'layout';

export interface SpecCoverage {
  /** Component folder name ("RadioGroup"). */
  name: string;
  status: CoverageStatus;
  /** Plain reason, for unsupported, drafted and layout components ("opens a popup", "uses CSS grid"). */
  reason?: string | undefined;
  /** Sets generated from it, when they are not just its own name ("RadioGroup", "Radio"). */
  sets?: string[] | undefined;
}

/**
 * Coverage counts from a specs file: visual components (generated, drafted with Claude, unsupported), in Figma
 * (generated + drafted), and layout helpers.
 */
export function coverageSummary(file: Pick<ComponentSpecsFile, 'coverage' | 'components'>): { generated: number; drafted: number; inFigma: number; visual: number; layout: number; total: number; missing: SpecCoverage[] } {
  const list = file.coverage ?? file.components.map((c) => ({ name: c.name, status: 'generated' as const }));
  const generated = list.filter((c) => c.status === 'generated').length;
  const drafted = list.filter((c) => c.status === 'drafted').length;
  const layout = list.filter((c) => c.status === 'layout').length;
  return { generated, drafted, inFigma: generated + drafted, visual: list.length - layout, layout, total: list.length, missing: list.filter((c) => c.status === 'unsupported') };
}

const LAYOUT_DIRECTIONS = new Set(['HORIZONTAL', 'VERTICAL']);
const PRIMARY = new Set(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']);
const COUNTER = new Set(['MIN', 'CENTER', 'MAX', 'STRETCH']);
const PART_KINDS = new Set(['frame', 'text', 'icon', 'vector']);

/**
 * Checks a component spec against the format (the schema every set follows, generated or drafted): axes and their
 * variants (one per combination, no extra), properties, parts (one root, known parents in order, text and visibility
 * properties that exist), each value's field and type, and, given `tokenTypes` (token path -> $type), that every token
 * path exists and has a type the field takes. Returns the problems in plain language, none when the spec is valid.
 */
export function validateComponentSpec(spec: Omit<ComponentSpec, 'hash'> & { hash?: string }, tokenTypes?: Map<string, string>): string[] {
  const out: string[] = [];
  const at = (where: string, why: string) => out.push(`${spec.name ?? 'spec'}: ${where}: ${why}`);
  if (typeof spec.name !== 'string' || !spec.name) return ['the spec has no name'];
  if (!Array.isArray(spec.axes) || !Array.isArray(spec.properties) || !Array.isArray(spec.parts) || !Array.isArray(spec.variants) || !Array.isArray(spec.unmapped)) return [`${spec.name}: axes, properties, parts, variants and unmapped must be lists`];
  const axisNames = new Set<string>();
  for (const a of spec.axes) {
    if (!a.name || axisNames.has(a.name)) at('axes', `"${a.name}" is missing or repeated`);
    axisNames.add(a.name);
    if (!Array.isArray(a.values) || !a.values.length) at(`axis ${a.name}`, 'has no values');
    else if (!a.values.includes(a.default)) at(`axis ${a.name}`, `default "${a.default}" is not one of its values`);
  }
  const props = new Map<string, SpecProperty>();
  for (const p of spec.properties) {
    if (props.has(p.name)) at('properties', `"${p.name}" is repeated`);
    props.set(p.name, p);
    if (p.type !== 'TEXT' && p.type !== 'BOOLEAN') at(`property ${p.name}`, `type ${String(p.type)} is not TEXT or BOOLEAN`);
    else if (typeof p.default !== (p.type === 'TEXT' ? 'string' : 'boolean')) at(`property ${p.name}`, `default must be a ${p.type === 'TEXT' ? 'text' : 'true or false'}`);
  }
  const parts = new Map<string, SpecPart>();
  for (const part of spec.parts) {
    if (!part.id || parts.has(part.id)) at('parts', `id "${part.id}" is missing or repeated`);
    if (!PART_KINDS.has(part.kind)) at(`part ${part.id}`, `kind ${String(part.kind)} is not frame, text, icon or vector`);
    if (part.parent === undefined) {
      if ([...parts.values()].some((x) => x.parent === undefined)) at(`part ${part.id}`, 'a second root (every other part needs a parent)');
    } else if (!parts.has(part.parent)) at(`part ${part.id}`, `parent "${part.parent}" is not a part listed before it`);
    else if (parts.get(part.parent)!.kind !== 'frame') at(`part ${part.id}`, `parent "${part.parent}" is not a frame`);
    if (part.layout && (!LAYOUT_DIRECTIONS.has(part.layout.direction) || !PRIMARY.has(part.layout.primary) || !COUNTER.has(part.layout.counter))) at(`part ${part.id}`, 'layout is not a valid auto layout');
    if (part.text !== undefined && props.get(part.text)?.type !== 'TEXT') at(`part ${part.id}`, `text property "${part.text}" does not exist`);
    if (part.visible !== undefined && props.get(part.visible)?.type !== 'BOOLEAN') at(`part ${part.id}`, `visibility property "${part.visible}" does not exist`);
    if (part.kind === 'text' && part.text === undefined && part.characters === undefined && !part.swap) at(`part ${part.id}`, 'a text part needs a TEXT property or its characters');
    parts.set(part.id, part);
  }
  if (!spec.parts.length || spec.parts[0]!.parent !== undefined) at('parts', 'the first part must be the root');
  const expected = spec.axes.reduce((n, a) => n * (a.values?.length || 1), 1);
  if (spec.variants.length !== expected) at('variants', `${spec.variants.length} variants for ${expected} combinations of the axes`);
  const seen = new Set<string>();
  for (const v of spec.variants) {
    const key = variantKeyOf(v.props ?? {});
    const where = `variant ${key}`;
    if (seen.has(key)) at(where, 'is repeated');
    seen.add(key);
    for (const a of spec.axes) if (!a.values?.includes(v.props?.[a.name] ?? '')) at(where, `${a.name} is not one of its values`);
    for (const k of Object.keys(v.props ?? {})) if (!axisNames.has(k)) at(where, `${k} is not an axis`);
    for (const [id, fields] of Object.entries(v.values ?? {})) {
      const part = parts.get(id);
      if (!part) {
        at(where, `values for "${id}", which is not a part`);
        continue;
      }
      for (const [field, value] of Object.entries(fields ?? {}) as [SpecField, SpecValue][]) {
        if (!SPEC_FIELDS.includes(field)) at(`${where}, ${id}`, `${field} is not a field`);
        else if (value === null) {
          if (!COLOR_FIELDS.has(field)) at(`${where}, ${id}`, `${field} cannot be empty (only colors can be none)`);
        } else if (typeof value === 'number') {
          if (COLOR_FIELDS.has(field)) at(`${where}, ${id}`, `${field} cannot be a number`);
        } else if (typeof value !== 'string') at(`${where}, ${id}`, `${field} must be a token path, a number or none`);
        else if (field === 'textDecoration') {
          if (!/^(UNDERLINE|STRIKETHROUGH|NONE)$/.test(value)) at(`${where}, ${id}`, `${value} is not a text decoration`);
        } else if (tokenTypes) {
          for (const path of value.startsWith('calc(') ? (value.match(/[A-Za-z][\w.-]*/g) ?? []).filter((x) => x !== 'calc' && !/^\d|^px$/.test(x)) : [value]) {
            const type = tokenTypes.get(path);
            if (!type) at(`${where}, ${id}`, `${path} is not a token`);
            else if (!value.startsWith('calc(') && !FIELD_TOKEN_TYPES(field).includes(type)) at(`${where}, ${id}`, `${path} is a ${type} token, ${field} needs ${FIELD_TOKEN_TYPES(field).join(' or ')}`);
          }
        }
      }
    }
    for (const id of v.hidden ?? []) if (!parts.has(id)) at(where, `hides "${id}", which is not a part`);
    for (const id of Object.keys(v.layout ?? {})) if (!parts.has(id)) at(where, `lays out "${id}", which is not a part`);
    for (const [id, vec] of Object.entries(v.vectors ?? {})) if (parts.get(id)?.kind !== 'vector' || !/^<svg[\s>]/.test(vec.svg)) at(where, `vector "${id}" is not a vector part with an SVG`);
    for (const id of Object.keys(v.slots ?? {})) if (!parts.has(id)) at(where, `shows a component in "${id}", which is not a part`);
  }
  for (const [i, x] of (spec.interactions ?? []).entries()) {
    const where = `interaction ${i + 1}`;
    const axis = spec.axes.find((a) => a.name === x.axis);
    if (!(x.trigger in TRIGGER_LABELS)) at(where, `trigger ${String(x.trigger)} is not one Figma has`);
    if (!axis) at(where, `${x.axis} is not an axis`);
    else if (!axis.values.includes(x.from) || !axis.values.includes(x.to) || x.from === x.to) at(where, `${x.from} to ${x.to} are not two values of ${x.axis}`);
    for (const k of x.variants ?? []) if (!seen.has(k)) at(where, `variant ${k} does not exist`);
    const t = x.transition;
    if (t && (!(t.duration > 0) || (t.easing.type === 'CUSTOM_CUBIC_BEZIER' && (t.easing.bezier?.length !== 4 || t.easing.bezier.some((n) => typeof n !== 'number'))))) at(where, 'the transition needs a duration and a valid easing');
  }
  return out;
}

/** Token types a field takes (a color for fills, a dimension or number for sizes). */
function FIELD_TOKEN_TYPES(field: SpecField): string[] {
  if (COLOR_FIELDS.has(field)) return ['color'];
  if (field === 'fontFamily') return ['fontFamily'];
  if (field === 'fontWeight') return ['fontWeight', 'number'];
  if (field === 'opacity') return ['number'];
  return ['dimension', 'number'];
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

/** Hash of a spec without its own hash field (and without its code example, which does not change the drawing). */
export function hashSpec(spec: Omit<ComponentSpec, 'hash'> | ComponentSpec): string {
  const { hash: _ignored, example: _example, ...rest } = spec as ComponentSpec;
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

/** What a set's description says about reduced motion: tokens set every duration to 0 under prefers-reduced-motion. */
export const REDUCED_MOTION_NOTE = 'In code, reduced motion turns this off.';

/** One prototype reaction: on `trigger`, the variant `fromKey` changes to `toKey`, with the code's transition. */
export interface MotionReaction {
  trigger: SpecTrigger;
  /** Figma's name for the trigger ("While hovering"). */
  label: string;
  from: Record<string, string>;
  to: Record<string, string>;
  /** variantKeyOf(from) and variantKeyOf(to). */
  fromKey: string;
  toKey: string;
  transition: SpecTransition | null;
}

/** A component set's motion and interactions, read from its spec: for Figma prototypes, docs and reviews. */
export interface ComponentMotion {
  name: string;
  /** Every reaction between variants, one per variant it starts from. */
  reactions: MotionReaction[];
  /** The interactions as the spec lists them (one per trigger and change), with the number of variants each covers. */
  triggers: (SpecInteraction & { label: string; count: number })[];
  /** Motion tokens the transitions use ("motion.duration.instant", "motion.easing.standard"), sorted. */
  tokens: string[];
  /** CSS properties that animate ("background-color"), sorted. */
  properties: string[];
  /** Where Figma plays the motion differently from the code. */
  approximations: string[];
  /** Motion of the code a Figma prototype cannot play. */
  cannotPlay: SpecMotionNote[];
  /** Opening and closing (a popup, a panel): the code's enter and exit transitions, when it has them. */
  opening: { enter: SpecTransition | null; exit: SpecTransition | null } | undefined;
  /** REDUCED_MOTION_NOTE when the component animates in code, else undefined. */
  reducedMotion: string | undefined;
}

/**
 * The motion of a component set from its spec: every reaction between its variants (trigger, from and to variants, the
 * transition with duration and easing resolved from the motion tokens), the tokens and properties involved, what Figma
 * approximates or cannot play, and the reduced motion note. Pure: works in the plugin, the browser and Node.
 */
export function componentMotion(spec: Pick<ComponentSpec, 'name' | 'variants' | 'interactions' | 'motion'>): ComponentMotion {
  const keys = new Set(spec.variants.map((v) => variantKeyOf(v.props)));
  const reactions: MotionReaction[] = [];
  const triggers: ComponentMotion['triggers'] = [];
  for (const x of spec.interactions ?? []) {
    const only = x.variants ? new Set(x.variants) : undefined;
    let count = 0;
    for (const v of spec.variants) {
      if (v.props[x.axis] !== x.from) continue;
      const fromKey = variantKeyOf(v.props);
      if (only && !only.has(fromKey)) continue;
      const to = { ...v.props, [x.axis]: x.to };
      const toKey = variantKeyOf(to);
      if (!keys.has(toKey)) continue;
      reactions.push({ trigger: x.trigger, label: TRIGGER_LABELS[x.trigger], from: { ...v.props }, to, fromKey, toKey, transition: x.transition });
      count++;
    }
    triggers.push({ ...x, label: TRIGGER_LABELS[x.trigger], count });
  }
  const transitions = (spec.interactions ?? []).map((x) => x.transition).filter((t): t is SpecTransition => !!t);
  const cannotPlay = [...(spec.motion ?? [])];
  // Opening and closing is not a prototype interaction, but its transitions use motion tokens too (a dialog's enter).
  const openNote = cannotPlay.find((n) => n.enter || n.exit);
  const opening = openNote ? { enter: openNote.enter ?? null, exit: openNote.exit ?? null } : undefined;
  const openTransitions = opening ? [opening.enter, opening.exit].filter((t): t is SpecTransition => !!t) : [];
  const tokens = [
    ...new Set([...transitions, ...openTransitions].flatMap((t) => [t.durationToken, t.easingToken]).concat(cannotPlay.map((n) => n.durationToken)).filter((t): t is string => !!t)),
  ].sort();
  const properties = [...new Set(transitions.flatMap((t) => t.properties))].sort();
  const approximations = [...new Set(transitions.map((t) => t.approximated).filter((t): t is string => !!t))];
  const animates = transitions.length > 0 || openTransitions.length > 0 || cannotPlay.some((n) => /animation/i.test(n.what));
  return { name: spec.name, reactions, triggers, tokens, properties, approximations, cannotPlay, opening, reducedMotion: animates ? REDUCED_MOTION_NOTE : undefined };
}

/**
 * Sets whose interactions use a motion token, directly or through an alias: `chainOf(path)` gives the tokens a path
 * resolves through (resolve(...).chain), so a change to a primitive ("duration.75") finds the sets using
 * "motion.duration.instant". Without it, only direct uses count. Sorted set names.
 */
export function componentsUsingMotionToken(specs: Pick<ComponentSpecsFile, 'components'>, tokenPath: string, chainOf?: (path: string) => string[]): string[] {
  const out = new Set<string>();
  for (const c of specs.components) {
    for (const t of componentMotion(c).tokens) {
      if (t === tokenPath || (chainOf?.(t) ?? []).includes(tokenPath)) out.add(c.name);
    }
  }
  return [...out].sort();
}

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

/** How a component stands in Figma, in Studio's words (the "In Figma" column): a short word and, for the ones not in Figma, the reason as a tooltip. Undefined: no data. */
export function figmaCell(entry: SpecCoverage | undefined): { label: string; title?: string } | undefined {
  if (!entry) return undefined;
  if (entry.status === 'generated') return { label: 'Yes' };
  if (entry.status === 'drafted') return { label: 'Drafted', title: 'Drafted with Claude where the code cannot be read on its own: in Figma, check it against the code.' };
  if (entry.status === 'layout') return { label: 'Auto layout', title: 'A layout helper: nothing to draw, use auto layout in Figma.' };
  return { label: 'Not yet', ...(entry.reason ? { title: `Not supported yet: ${entry.reason}` } : {}) };
}
