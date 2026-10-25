// component-specs.json comes from the repo: written by a generator that may be newer or older than this plugin, by a
// hand edit, or by another team's tooling. Before planning, every entry is checked for the shape the build reads. An
// entry of the wrong shape is left out with its reason in words, the rest is pulled: one bad entry never hides the
// others, and nothing downstream calls a string method on a number. Unknown fields are kept and ignored. Pure.

import type { ComponentSpec, ComponentSpecsFile, SpecAxis, SpecIcon, SpecPart, SpecProperty, SpecSlot, SpecVariant } from '@bridge-ds/core';
import { variantKeyOf } from '@bridge-ds/core';

/** An entry left out (or trimmed) with the reason, for the Pull preview. */
export interface SpecIssue {
  /** Component name, "Icons", "Slots" or "component-specs.json". */
  component: string;
  reason: string;
  /** True when the whole component is left out; false when only a part of it (a variant, a property). */
  skipped: boolean;
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const PART_KINDS = new Set(['frame', 'text', 'icon', 'vector']);
const DIRECTIONS = new Set(['HORIZONTAL', 'VERTICAL']);
const PRIMARY = new Set(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']);
const COUNTER = new Set(['MIN', 'CENTER', 'MAX', 'STRETCH']);
const TRIGGERS = new Set(['ON_HOVER', 'ON_PRESS', 'ON_CLICK', 'MOUSE_ENTER', 'MOUSE_LEAVE']);
/** Longest layer or component name kept: Figma takes more, nobody reads more. */
const MAX_NAME = 200;

/** A short, readable version of a value for a reason ("a number", "an empty name"). */
function shape(v: unknown): string {
  if (v === undefined) return 'missing';
  if (v === null) return 'empty';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'string') return v.trim() ? `"${v.length > 30 ? `${v.slice(0, 29)}…` : v}"` : 'an empty text';
  return `a ${typeof v}`;
}

const clip = (s: string) => (s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s);

function checkLayout(v: unknown): SpecPart['layout'] | undefined {
  if (!isDict(v) || !DIRECTIONS.has(v.direction as string)) return undefined;
  return {
    ...(v as unknown as NonNullable<SpecPart['layout']>),
    primary: PRIMARY.has(v.primary as string) ? (v.primary as NonNullable<SpecPart['layout']>['primary']) : 'MIN',
    counter: COUNTER.has(v.counter as string) ? (v.counter as NonNullable<SpecPart['layout']>['counter']) : 'MIN',
  };
}

/** The field values of a part: only plain values (token path, number, null); anything else is planned as a problem. */
function checkValues(v: unknown): Record<string, unknown> {
  return isDict(v) ? v : {};
}

function checkComponent(raw: unknown, index: number, issue: (component: string, reason: string, skipped: boolean) => void): ComponentSpec | undefined {
  if (!isDict(raw)) {
    issue(`Entry ${index + 1}`, `is ${shape(raw)}, not a component`, true);
    return undefined;
  }
  if (!isText(raw.name)) {
    issue(`Entry ${index + 1}`, `has ${shape(raw.name)} as its name`, true);
    return undefined;
  }
  const name = clip(raw.name.trim());
  const fail = (reason: string) => {
    issue(name, reason, true);
    return undefined;
  };
  const trim = (reason: string) => issue(name, reason, false);

  if (!Array.isArray(raw.axes)) return fail(`has no list of variant axes (${shape(raw.axes)})`);
  const axes: SpecAxis[] = [];
  for (const a of raw.axes) {
    if (!isDict(a) || !isText(a.name) || !Array.isArray(a.values) || !a.values.length) return fail(`has a variant axis Figma cannot use (${isDict(a) ? shape(a.name) : shape(a)})`);
    const values = a.values.map((x) => (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' ? String(x) : '')).filter(Boolean);
    if (values.length !== a.values.length) return fail(`axis ${a.name} has a value that is not a text`);
    axes.push({ ...(a as unknown as SpecAxis), name: a.name, values, default: typeof a.default === 'string' && values.includes(a.default) ? a.default : values[0]! });
  }

  if (!Array.isArray(raw.parts) || !raw.parts.length) return fail(`has no layers (${shape(raw.parts)})`);
  const parts: SpecPart[] = [];
  const ids = new Set<string>();
  for (const p of raw.parts) {
    if (!isDict(p) || !isText(p.id) || !PART_KINDS.has(p.kind as string)) {
      trim(`a layer was left out: ${isDict(p) ? `id ${shape(p.id)}, kind ${shape(p.kind)}` : shape(p)}`);
      continue;
    }
    if (ids.has(p.id)) {
      trim(`layer ${p.id} is listed twice: the second is left out`);
      continue;
    }
    const part = { ...(p as unknown as SpecPart), name: clip(isText(p.name) ? p.name : p.id) };
    if (p.layout !== undefined && !(part.layout = checkLayout(p.layout))) {
      delete part.layout;
      trim(`layer ${p.id} has a layout Figma cannot use: drawn with the default layout`);
    }
    for (const k of ['text', 'visible', 'icon', 'characters', 'parent'] as const) {
      if (p[k] !== undefined && typeof p[k] !== 'string') {
        delete part[k];
        trim(`layer ${p.id}: ${k} is ${shape(p[k])}, not a text, so it is ignored`);
      }
    }
    if (p.swap !== undefined && !(isDict(p.swap) && isText(p.swap.property) && isText(p.swap.default))) {
      delete part.swap;
      trim(`layer ${p.id} has a swap Figma cannot use: drawn without it`);
    } else if (isDict(p.swap) && p.swap.options !== undefined && !(Array.isArray(p.swap.options) && p.swap.options.every((o) => typeof o === 'string'))) {
      part.swap = { ...(p.swap as unknown as NonNullable<SpecPart['swap']>), options: undefined };
    }
    for (const k of ['fraction', 'at'] as const) if (p[k] !== undefined && !(typeof p[k] === 'number' && Number.isFinite(p[k]))) delete part[k];
    if (p.pin !== undefined && !isDict(p.pin)) delete part.pin;
    if (p.stretch !== undefined && !isDict(p.stretch)) delete part.stretch;
    ids.add(p.id);
    parts.push(part);
  }
  if (!parts.some((p) => p.id === 'root' && !p.parent)) return fail('has no root layer');
  // A parent that is not a layer of the set (or itself): the layer goes under the root.
  for (const p of parts) {
    if (p.id === 'root') {
      delete p.parent;
      continue;
    }
    if (!p.parent || !ids.has(p.parent) || p.parent === p.id) {
      if (p.parent) trim(`layer ${p.id} names a parent ${p.parent} the set does not have: placed in the root`);
      p.parent = 'root';
    }
  }
  // A parent loop (a in b, b in a) never ends: those layers go under the root.
  for (const p of parts) {
    const seen = new Set<string>([p.id]);
    let at = p.parent;
    while (at && at !== 'root') {
      if (seen.has(at)) {
        trim(`layer ${p.id} is inside itself through its parents: placed in the root`);
        p.parent = 'root';
        break;
      }
      seen.add(at);
      at = parts.find((x) => x.id === at)?.parent;
    }
  }
  // Parents before children: the build places each layer in a parent already built.
  const ordered: SpecPart[] = [];
  const placed = new Set<string>();
  const place = (p: SpecPart) => {
    if (placed.has(p.id)) return;
    const parent = p.parent ? parts.find((x) => x.id === p.parent) : undefined;
    if (parent) place(parent);
    placed.add(p.id);
    ordered.push(p);
  };
  for (const p of parts) place(p);

  const properties: SpecProperty[] = [];
  for (const p of Array.isArray(raw.properties) ? raw.properties : []) {
    if (!isDict(p) || !isText(p.name) || (p.type !== 'TEXT' && p.type !== 'BOOLEAN')) {
      trim(`a component property was left out (${isDict(p) ? `${shape(p.name)}, type ${shape(p.type)}` : shape(p)})`);
      continue;
    }
    if (properties.some((x) => x.name === p.name && x.type === p.type)) {
      trim(`property ${p.name} is listed twice: the second is left out`);
      continue;
    }
    const value = p.type === 'BOOLEAN' ? p.default === true || p.default === 'true' : typeof p.default === 'string' ? p.default : p.default === undefined || p.default === null ? '' : String(p.default);
    properties.push({ ...(p as unknown as SpecProperty), name: clip(p.name), default: value });
  }

  if (!Array.isArray(raw.variants) || !raw.variants.length) return fail(`has no variants (${shape(raw.variants)})`);
  const variants: SpecVariant[] = [];
  const keys = new Set<string>();
  let dropped = 0;
  let twice = 0;
  for (const v of raw.variants) {
    if (!isDict(v) || !isDict(v.props) || !Object.values(v.props).every((x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')) {
      dropped++;
      continue;
    }
    const props = Object.fromEntries(Object.entries(v.props).map(([k, x]) => [k, String(x)]));
    const key = variantKeyOf(props);
    if (keys.has(key)) {
      twice++;
      continue;
    }
    keys.add(key);
    const values = Object.fromEntries(Object.entries(isDict(v.values) ? v.values : {}).map(([part, fields]) => [part, checkValues(fields)])) as SpecVariant['values'];
    const variant: SpecVariant = { ...(v as unknown as SpecVariant), props, values };
    if (v.slots !== undefined && !(isDict(v.slots) && Object.values(v.slots).every((x) => typeof x === 'string'))) delete variant.slots;
    if (v.hidden !== undefined && !(Array.isArray(v.hidden) && v.hidden.every((x) => typeof x === 'string'))) delete variant.hidden;
    if (v.layout !== undefined) {
      const layout = isDict(v.layout) ? Object.fromEntries(Object.entries(v.layout).flatMap(([k, l]) => (checkLayout(l) ? [[k, checkLayout(l)!]] : []))) : {};
      if (Object.keys(layout).length) variant.layout = layout;
      else delete variant.layout;
    }
    if (v.vectors !== undefined) {
      const vectors = isDict(v.vectors)
        ? Object.fromEntries(Object.entries(v.vectors).flatMap(([k, x]) => (isDict(x) && typeof x.svg === 'string' && Array.isArray(x.strokes) ? [[k, { svg: x.svg, strokes: x.strokes }]] : [])))
        : {};
      if (Object.keys(vectors).length) variant.vectors = vectors as SpecVariant['vectors'];
      else delete variant.vectors;
    }
    if (v.pins !== undefined && !(isDict(v.pins) && Object.values(v.pins).every(isDict))) delete variant.pins;
    variants.push(variant);
  }
  if (dropped) trim(`${dropped} ${dropped === 1 ? 'variant was' : 'variants were'} left out: their axis values are not texts`);
  if (twice) trim(`${twice} ${twice === 1 ? 'variant is' : 'variants are'} listed twice with the same axis values: the first is kept`);
  if (!variants.length) return fail('has no variant Figma can use');

  const unmapped = (Array.isArray(raw.unmapped) ? raw.unmapped : [])
    .filter(isDict)
    .map((u) => ({ part: String(u.part ?? ''), property: String(u.property ?? ''), value: String(u.value ?? ''), reason: String(u.reason ?? '') }));
  const interactions = Array.isArray(raw.interactions)
    ? raw.interactions.filter(
        (x): x is NonNullable<ComponentSpec['interactions']>[number] & Dict =>
          isDict(x) &&
          TRIGGERS.has(x.trigger as string) &&
          typeof x.axis === 'string' &&
          typeof x.from === 'string' &&
          typeof x.to === 'string' &&
          (x.variants === undefined || (Array.isArray(x.variants) && x.variants.every((k) => typeof k === 'string'))) &&
          (x.transition === null ||
            (isDict(x.transition) &&
              typeof x.transition.duration === 'number' &&
              Number.isFinite(x.transition.duration) &&
              x.transition.duration >= 0 &&
              isDict(x.transition.easing) &&
              (x.transition.easing.type === 'LINEAR' || (x.transition.easing.type === 'CUSTOM_CUBIC_BEZIER' && Array.isArray(x.transition.easing.bezier) && x.transition.easing.bezier.length === 4 && x.transition.easing.bezier.every((n) => typeof n === 'number'))) &&
              (x.transition.properties === undefined || Array.isArray(x.transition.properties)))),
      )
    : undefined;
  if (Array.isArray(raw.interactions) && interactions && interactions.length < raw.interactions.length) trim(`${raw.interactions.length - interactions.length} prototype interactions were left out: their shape is not one Bridge reads`);
  const motion = Array.isArray(raw.motion) ? raw.motion.filter((m): m is NonNullable<ComponentSpec['motion']>[number] & Dict => isDict(m) && typeof m.what === 'string' && typeof m.reason === 'string') : undefined;
  return {
    ...(raw as unknown as ComponentSpec),
    name,
    ...(typeof raw.component === 'string' ? {} : { component: undefined }),
    ...(isDict(raw.drafted) && typeof raw.drafted.reason === 'string' ? {} : { drafted: undefined }),
    hash: typeof raw.hash === 'string' ? raw.hash : String(raw.hash ?? ''),
    source: Array.isArray(raw.source) ? raw.source.filter((x): x is string => typeof x === 'string') : [],
    axes,
    properties,
    parts: ordered,
    variants,
    unmapped,
    ...(interactions ? { interactions: interactions.map((x) => ({ ...x, transition: x.transition ? { ...x.transition, properties: x.transition.properties ?? [] } : null })) } : { interactions: undefined }),
    ...(motion ? { motion } : { motion: undefined }),
  };
}

/**
 * The specs file with every entry checked: components, icons, slots and coverage of the wrong shape are left out (or
 * trimmed) with a reason; a component name used twice keeps the first. Never throws on content.
 */
export function checkComponentSpecs(file: ComponentSpecsFile): { specs: ComponentSpecsFile; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const issue = (component: string, reason: string, skipped: boolean) => issues.push({ component, reason, skipped });
  const components: ComponentSpec[] = [];
  const names = new Set<string>();
  (file.components as unknown[]).forEach((raw, i) => {
    const c = checkComponent(raw, i, issue);
    if (!c) return;
    if (names.has(c.name)) {
      issue(c.name, 'another component has the same name: the first one is pulled', true);
      return;
    }
    names.add(c.name);
    components.push(c);
  });
  let icons: SpecIcon[] | undefined;
  if (file.icons !== undefined) {
    const list = Array.isArray(file.icons) ? (file.icons as unknown[]) : [];
    icons = list.filter((x): x is SpecIcon => isDict(x) && isText(x.name) && typeof x.svg === 'string' && x.svg.includes('<svg'));
    if (icons.length < list.length || !Array.isArray(file.icons)) issue('Icons', `${list.length - icons.length || 'the list of'} icons could not be read: not drawn`, false);
  }
  let slots: SpecSlot[] | undefined;
  if (file.slots !== undefined) {
    const list = Array.isArray(file.slots) ? (file.slots as unknown[]) : [];
    slots = list
      .filter((x): x is SpecSlot & Dict => isDict(x) && isText(x.name) && (x.kind === 'text' || x.kind === 'media'))
      .map((x) => ({
        ...x,
        values: (isDict(x.values) ? x.values : {}) as SpecSlot['values'],
        ...(isDict(x.text) && typeof x.text.property === 'string' ? { text: { property: x.text.property, default: typeof x.text.default === 'string' ? x.text.default : '' } } : { text: undefined }),
        ...(Array.isArray(x.aspect) && x.aspect.length === 2 && x.aspect.every((n) => typeof n === 'number' && n > 0) ? {} : { aspect: undefined }),
        ...(typeof x.icon === 'string' ? {} : { icon: undefined }),
        ...(isDict(x.iconValues) ? {} : { iconValues: undefined }),
      }));
    if (slots.length < list.length || !Array.isArray(file.slots)) issue('Slots', `${list.length - slots.length || 'the list of'} content slots could not be read: not drawn`, false);
  }
  const iconStyle = isDict(file.iconStyle) && typeof file.iconStyle.size === 'string' && typeof file.iconStyle.color === 'string' && typeof file.iconStyle.stroke === 'string' ? file.iconStyle : undefined;
  if (file.iconStyle !== undefined && !iconStyle) issue('Icons', 'the icon style could not be read: icons keep their drawn size and stroke', false);
  const coverage = Array.isArray(file.coverage)
    ? (file.coverage as unknown[]).filter((x): x is NonNullable<ComponentSpecsFile['coverage']>[number] => isDict(x) && isText(x.name) && ['generated', 'drafted', 'unsupported', 'layout'].includes(x.status as string))
    : undefined;
  return {
    specs: {
      ...file,
      components,
      ...(icons ? { icons } : { icons: undefined }),
      ...(slots ? { slots } : { slots: undefined }),
      iconStyle,
      ...(coverage ? { coverage } : { coverage: undefined }),
    },
    issues,
  };
}
