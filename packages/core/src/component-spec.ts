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
 * (gap), sizes. Text: textFill (color), font family, size, weight, line height, letter spacing.
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
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'textFill'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing';

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
  'width',
  'height',
  'minWidth',
  'minHeight',
  'textFill',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
];

/** Fields whose token must be a color. */
export const COLOR_FIELDS: ReadonlySet<SpecField> = new Set(['fill', 'stroke', 'textFill']);

/** A token path ("button.primary.bg"), a literal zero (`padding: 0`), or null: no paint (`transparent`). */
export type SpecValue = string | 0 | null;

export interface SpecLayout {
  direction: 'HORIZONTAL' | 'VERTICAL';
  /** justify-content. */
  primary: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  /** align-items. STRETCH: children fill the cross axis. */
  counter: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
}

export interface SpecPart {
  /** Stable id inside the component ("root", "label", "icon-start"). Figma layers keep it in plugin data. */
  id: string;
  /** Layer name in Figma. */
  name: string;
  kind: 'frame' | 'text' | 'icon';
  /** Parent part id; undefined for the root (the variant itself). */
  parent?: string | undefined;
  /** CSS module class the part is styled by ("Button.module.css .label"), for people reading the spec. */
  source?: string | undefined;
  layout?: SpecLayout | undefined;
  /** Text parts: the TEXT component property that holds the characters. */
  text?: string | undefined;
  /** Optional parts (an icon prop): the BOOLEAN component property that shows them. */
  visible?: string | undefined;
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
}

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
