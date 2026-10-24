// Spec source "measured only": component specs built from measured-specs.json alone, with no static spec to lay them
// on. What any design system can give: a Storybook. The measure (`bridge specs --measure --variants`) records each
// story's props, its forced state and its rendered tree in the spec shape; this file groups the stories into Figma sets.
// Pure: no DOM, no figma.*.
//
// - Axes: the component's enum props (2 to 12 options, as Storybook knows them) with the values the stories show, the
//   booleans the stories show both ways, a Checked axis from a `checked` prop (mixed from `indeterminate`), and a State
//   axis from the forced states and `disabled`.
// - A story stands for a variant only when its other booleans are at their defaults (a Loading story is not a variant).
// - Parts: the default variant's rendered tree. The other variants pair their tree with it (core pairParts, as the bench
//   does); a part a variant does not render is hidden there.
// - Sizes: a frame with content hugs it (its measured px are not kept); a leaf (an icon, a dot) keeps them, and so
//   does the width of a root that fills its container (the measure lays it out at a set width).
// - Variables are not built here: they come from the measure's token harvest (to come), or the repo's tokens.

import {
  type ComponentSpec,
  type ComponentSpecsFile,
  type MeasuredArgType,
  type MeasuredSpec,
  type MeasuredSpecsFile,
  type MeasuredSpecsStory,
  type SpecAxis,
  type SpecField,
  type SpecPart,
  type SpecValue,
  type SpecVariant,
  hashSpec,
  pairParts,
  variantKeyOf,
} from '@bridge-ds/core';

/** What building from the measure gave: sets, variants, and the stories it used. */
export interface MeasuredOnlyReport {
  sets: number;
  variants: number;
  stories: number;
  /** Components with stories that gave no set (every story failed, or none at rest). */
  skipped: string[];
}

/** The screenshot of the story a variant was built from (`--shots`), path relative to measured-specs.json. */
export interface VariantShot {
  file: string;
  width: number;
  height: number;
}

/** Set name -> variant key (variantKeyOf) -> its story's screenshot: the reference Check fidelity compares with. */
export type MeasuredShots = Record<string, Record<string, VariantShot>>;

/** Props that never draw a variant (wiring, element type, content), as in core's measure-status. */
const NOT_AN_AXIS = /^(as|asChild|render|component|className|class|style|id|key|ref|role|type|name|form|dir|lang|tabIndex|slot|children|htmlFor|value|defaultValue|placeholder|href|target|rel|src|alt)$/i;
const STATE_PROPS = new Set(['disabled', 'checked', 'indeterminate']);
const STATES: { value: string; of: (s: MeasuredSpecsStory) => boolean }[] = [
  { value: 'Default', of: (s) => !s.state && s.props?.disabled !== true },
  { value: 'Hover', of: (s) => s.state === 'hover' && s.props?.disabled !== true },
  { value: 'Pressed', of: (s) => s.state === 'active' && s.props?.disabled !== true },
  { value: 'Focus', of: (s) => s.state === 'focus-visible' && s.props?.disabled !== true },
  { value: 'Disabled', of: (s) => s.props?.disabled === true },
];

const setNameOf = (title: string) => title.split('/').at(-1)!.trim();
const axisName = (prop: string) => prop.charAt(0).toUpperCase() + prop.slice(1).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
const propsOf = (s: MeasuredSpecsStory) => ({ ...(s.props ?? {}), ...(s.overrides ?? {}) });

/** The story's value on a Checked axis: "mixed" when indeterminate, else its `checked`. */
function checkedOf(s: MeasuredSpecsStory): string {
  const p = propsOf(s);
  return p.indeterminate === true ? 'mixed' : String(p.checked === true);
}

/** Fields a literal can stand in for when no token is known: the look a design system without tokens still has. */
const LITERAL_FIELDS: SpecField[] = ['fill', 'textFill', 'stroke', 'fontFamily'];

/**
 * A part's values in the pull's shape. Frames with content hug it: their measured px are what the content made, not a
 * size of their own. A token the library does not have (`known` says no), or a color or font family with no token at
 * all, takes the measured literal (`rgb(...)`, px, a family list): the set draws what code draws, unbound.
 */
function valuesOf(spec: MeasuredSpec, partId: string, hasChildren: boolean, known: (path: string) => boolean, fills = false): Partial<Record<SpecField, SpecValue>> {
  const sized = spec.sized?.[partId];
  const v = { ...(spec.values[partId] ?? {}) };
  const raw = spec.raw[partId] ?? {};
  for (const field of Object.keys(v) as SpecField[]) {
    const value = v[field];
    if (typeof value !== 'string' || value.startsWith('calc(') || known(value)) continue;
    const literal = raw[field];
    if (literal === undefined) delete v[field];
    else v[field] = literal;
  }
  for (const field of LITERAL_FIELDS) if (v[field] === undefined && typeof raw[field] === 'string') v[field] = raw[field];
  if (hasChildren) {
    // A root that fills its container keeps the width the measure laid it out at (its story's render has it).
    if (typeof v.width === 'number' && !fills) delete v.width;
    if (typeof v.height === 'number') delete v.height;
  }
  // A size the CSS sets stays fixed, content or not (a 40x40 button around a 16 px icon).
  if (sized?.width !== undefined) v.width = sized.width;
  if (sized?.height !== undefined) v.height = sized.height;
  return v;
}

/** One Figma set from the stories of one component, or undefined when none stands for a variant. */
function setOf(name: string, stories: MeasuredSpecsStory[], argTypes: Record<string, MeasuredArgType>, source: string, known: (path: string) => boolean): { spec: ComponentSpec; shots: Record<string, VariantShot> } | undefined {
  // Only stories as written or measured for a variant: their other booleans at the component's defaults.
  // Other booleans compare with the component's Default story, not Storybook's defaults: a design system's stories can
  // all set one (Carbon IconButton: defaultOpen, highContrast), and that is then how the component is shown.
  const lead = stories.find((s) => s.name === 'Default' && !s.state) ?? stories[0];
  const baseline = (k: string, a: MeasuredArgType) => (lead ? propsOf(lead)[k] : undefined) ?? a.default ?? false;
  // A skeleton (the loading placeholder) is not a variant. A gallery (its first instance) only stands for a variant no
  // single-instance story renders: it comes last, and the first story of a variant wins.
  const shown = stories.filter((s) => !/skeleton/i.test(s.name));
  const ordered = [...(shown.length ? shown : stories)].sort((a, b) => Number(!!a.gallery) - Number(!!b.gallery));
  // A boolean the stories show both ways is an axis (Carbon Toggle `toggled`); drawnAxes drops it if it draws nothing.
  const valueOf = (s: MeasuredSpecsStory, k: string, a: MeasuredArgType) => (propsOf(s)[k] ?? a.default ?? false) === true;
  const flags = Object.entries(argTypes).filter(
    ([k, a]) => a.kind === 'boolean' && !STATE_PROPS.has(k) && !NOT_AN_AXIS.test(k) && ordered.some((s) => valueOf(s, k, a)) && ordered.some((s) => !valueOf(s, k, a)),
  );
  const plain = ordered.filter((s) =>
    Object.entries(argTypes).every(
      ([k, a]) => a.kind !== 'boolean' || STATE_PROPS.has(k) || NOT_AN_AXIS.test(k) || flags.some(([f]) => f === k) || (propsOf(s)[k] ?? a.default ?? false) === baseline(k, a),
    ),
  );
  if (!plain.length) return undefined;
  const axes: SpecAxis[] = [];
  for (const [prop, a] of flags) {
    const def = String(baseline(prop, a) === true);
    axes.push({ name: axisName(prop), prop, values: [def, def === 'true' ? 'false' : 'true'], default: def });
  }
  for (const [prop, a] of Object.entries(argTypes)) {
    if (a.kind !== 'enum' || NOT_AN_AXIS.test(prop) || !a.options || a.options.length < 2 || a.options.length > 12) continue;
    const seen = new Set(plain.map((s) => String(propsOf(s)[prop] ?? a.default ?? a.options![0])));
    const values = a.options.filter((o) => seen.has(o));
    if (values.length < 2) continue;
    const def = a.default !== undefined && values.includes(String(a.default)) ? String(a.default) : values[0]!;
    axes.push({ name: axisName(prop), prop, values, default: def });
  }
  if ('checked' in argTypes || plain.some((s) => 'checked' in propsOf(s))) {
    const values = ['false', 'true', 'mixed'].filter((v) => plain.some((s) => checkedOf(s) === v));
    if (values.length > 1) axes.push({ name: 'Checked', values, default: values[0]! });
  }
  const states = STATES.filter((st) => plain.some(st.of)).map((st) => st.value);
  if (states.length > 1) axes.push({ name: 'State', values: states, default: states[0]! });

  // One story per variant: the first one that stands for it.
  const keyOf = (s: MeasuredSpecsStory): Record<string, string> | undefined => {
    const props: Record<string, string> = {};
    for (const axis of axes) {
      const flag = flags.find(([k]) => k === axis.prop);
      const value =
        axis.name === 'State' ? STATES.find((st) => st.of(s))?.value : axis.name === 'Checked' ? checkedOf(s) : flag ? String(valueOf(s, flag[0], flag[1])) : String(propsOf(s)[axis.prop!] ?? axis.default);
      if (value === undefined || !axis.values.includes(value)) return undefined;
      props[axis.name] = value;
    }
    return props;
  };
  const byVariant = new Map<string, { props: Record<string, string>; story: MeasuredSpecsStory }>();
  for (const s of plain) {
    const props = keyOf(s);
    if (!props) continue;
    const k = JSON.stringify(props);
    if (!byVariant.has(k)) byVariant.set(k, { props, story: s });
  }
  if (!byVariant.size) return undefined;
  const isDefault = (p: Record<string, string>) => axes.every((a) => p[a.name] === a.default);
  const base = [...byVariant.values()].find((v) => isDefault(v.props)) ?? [...byVariant.values()][0]!;
  const baseSpec = base.story.spec!;
  // A part the measure drew as an SVG (an icon, a check mark) is a vector part: the builder draws its markup.
  const parts = baseSpec.parts.map((p) => (baseSpec.vectors?.[p.id] ? { ...p, kind: 'vector' as const } : { ...p }));
  // Only children in the flow size a frame: one holding only positioned parts (a switch and its knob) keeps its size.
  const parents = new Set(parts.filter((p) => !p.pin && !p.cover).map((p) => p.parent).filter(Boolean));
  const variants: SpecVariant[] = [];
  const shotOf = new Map<SpecVariant, VariantShot>();
  const spacersOf = new Map<SpecVariant, Record<string, number>>();
  for (const { props, story } of byVariant.values()) {
    const m = story.spec!;
    // Paired on the measure's own parts: an icon made a vector here is still an icon there.
    const pairs = story === base.story ? new Map(parts.map((p) => [p.id, p.id])) : pairParts(baseSpec.parts, m);
    const values: SpecVariant['values'] = {};
    const vectors: NonNullable<SpecVariant['vectors']> = {};
    const pins: NonNullable<SpecVariant['pins']> = {};
    const hidden: string[] = [];
    const spacers: Record<string, number> = {};
    for (const p of parts) {
      const mid = pairs.get(p.id);
      if (mid === undefined) {
        hidden.push(p.id);
        continue;
      }
      values[p.id] = valuesOf(m, mid, parents.has(p.id), known, !p.parent && !!p.fill);
      if (m.spacers?.[mid]) spacers[p.id] = m.spacers[mid]!;
      // An icon's fill is the color it draws with (CSS `fill`), not a background: the frame would paint a square.
      if (p.kind === 'icon' || p.kind === 'vector') delete values[p.id]!.fill;
      // A positioned part (a pseudo-element knob) placed elsewhere in this variant: checked moves it to the right.
      const pin = m.parts.find((x) => x.id === mid)?.pin;
      if (p.pin && pin && JSON.stringify(pin) !== JSON.stringify(p.pin)) pins[p.id] = pin;
      const vec = p.kind === 'vector' ? m.vectors?.[mid] : undefined;
      // Strokes bind by shape order: with a token the library does not have, the SVG keeps its own (resolved) colors.
      if (vec) vectors[p.id] = { svg: vec.svg, strokes: vec.strokes.every((v) => typeof v !== 'string' || known(v)) ? [...vec.strokes] : [] };
    }
    const variant: SpecVariant = { props, values, ...(hidden.length ? { hidden } : {}), ...(Object.keys(vectors).length ? { vectors } : {}), ...(Object.keys(pins).length ? { pins } : {}) };
    variants.push(variant);
    spacersOf.set(variant, spacers);
    if (story.shot) shotOf.set(variant, story.shot);
  }
  textRootInFrame(parts, variants);
  spacerWrappers(parts, variants, spacersOf);
  const properties = textProperties(parts, base.story, argTypes, new Set(axes.map((a) => a.name)));
  const kept = drawnAxes(axes, variants);
  // The story it was measured from: the set's doc section links to it.
  const story = `${source.replace(/\/+$/, '')}/?path=/story/${base.story.id}`;
  const spec: ComponentSpec = { name, hash: '', source: [story], axes: kept.axes, properties, parts, variants: withoutIdleStates(kept.variants), unmapped: [] };
  // Pruning an axis rewrites a variant's props (a new object): its shot follows by position in the kept list.
  const shots: Record<string, VariantShot> = {};
  kept.variants.forEach((v) => {
    const from = variants.find((x) => JSON.stringify(x.values) === JSON.stringify(v.values) && Object.entries(v.props).every(([k, val]) => x.props[k] === val));
    const shot = from && shotOf.get(from);
    if (shot) shots[variantKeyOf(v.props)] = shot;
  });
  return { spec: { ...spec, hash: hashSpec(spec) }, shots };
}

const TEXT_FIELDS = new Set<SpecField>(['textFill', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration']);

/**
 * A component whose root is a text (a link: `<a>` with only text in it) is drawn as a frame that hugs a text, since a
 * Figma component is a frame. The text fields move to the text, the box fields (fill, padding, stroke) stay on the frame,
 * which hugs the text as any frame with content does.
 */
function textRootInFrame(parts: SpecPart[], variants: SpecVariant[]): void {
  const root = parts.find((p) => !p.parent);
  if (!root || root.kind !== 'text') return;
  const id = `${root.id}-text`;
  const text: SpecPart = { ...root, id, name: `${root.name} text`, parent: root.id };
  parts.splice(parts.indexOf(root), 1, { id: root.id, name: root.name, kind: 'frame', ...(root.source ? { source: root.source } : {}), layout: { direction: 'HORIZONTAL', primary: 'MIN', counter: 'MIN' } }, text);
  for (const v of variants) {
    const all = v.values[root.id] ?? {};
    v.values[root.id] = Object.fromEntries(Object.entries(all).filter(([f, value]) => !TEXT_FIELDS.has(f as SpecField) && !((f === 'width' || f === 'height') && typeof value === 'number')));
    v.values[id] = Object.fromEntries(Object.entries(all).filter(([f]) => TEXT_FIELDS.has(f as SpecField)));
    if (v.hidden?.includes(root.id)) v.hidden.push(id);
  }
}

/**
 * A margin the parent's gap does not cover (`spacers`: the extra space before a part) becomes a wrapper named after the
 * part ("Label wrapper"), its padding on the side the margin is: Figma's auto layout has one gap per frame.
 */
function spacerWrappers(parts: SpecPart[], variants: SpecVariant[], spacersOf: Map<SpecVariant, Record<string, number>>): void {
  const wrapped = parts.filter((p) => p.parent && !p.pin && !p.cover && variants.some((v) => spacersOf.get(v)?.[p.id]));
  for (const p of wrapped) {
    const parent = parts.find((x) => x.id === p.parent);
    const row = parent?.layout?.direction === 'HORIZONTAL';
    const id = `${p.id}-wrapper`;
    const wrapper: SpecPart = { id, name: `${p.name} wrapper`, kind: 'frame', parent: p.parent, layout: { direction: row ? 'HORIZONTAL' : 'VERTICAL', primary: 'MIN', counter: 'STRETCH' }, ...(p.grow ? { grow: p.grow } : {}) };
    parts.splice(parts.indexOf(p), 0, wrapper);
    p.parent = id;
    for (const v of variants) {
      const space = spacersOf.get(v)?.[p.id] ?? 0;
      v.values[id] = space ? { [row ? 'paddingLeft' : 'paddingTop']: space } : {};
      if (v.hidden?.includes(p.id)) v.hidden.push(id);
    }
  }
}

/**
 * A string arg whose value is a text the default story draws is a TEXT property on that text ("Label", "Helper text"):
 * a designer changes the words of an instance without detaching it.
 */
function textProperties(parts: SpecPart[], story: MeasuredSpecsStory, argTypes: Record<string, MeasuredArgType>, axes: Set<string>): ComponentSpec['properties'] {
  const properties: ComponentSpec['properties'] = [];
  const props = propsOf(story);
  for (const [k, a] of Object.entries(argTypes)) {
    const value = props[k];
    if (a.kind !== 'text' || NOT_AN_AXIS.test(k) || typeof value !== 'string' || !value.trim()) continue;
    const part = parts.find((p) => p.kind === 'text' && !p.text && p.characters?.trim() === value.trim());
    const name = axisName(k);
    if (!part || axes.has(name) || properties.some((x) => x.name === name)) continue;
    part.text = name;
    properties.push({ name, type: 'TEXT', default: value, prop: k });
  }
  return properties;
}

/**
 * A pointer state a variant draws exactly like its resting one (hover on a read-only or disabled field) is not a
 * variant: the set only has the combinations that look different, as the code renders them.
 */
function withoutIdleStates(variants: SpecVariant[]): SpecVariant[] {
  const look = (v: SpecVariant) => JSON.stringify([v.values, v.hidden ?? [], v.vectors ?? {}, v.pins ?? {}]);
  const rest = (v: SpecVariant) => JSON.stringify(Object.entries(v.props).filter(([k]) => k !== 'State'));
  const resting = new Map(variants.filter((v) => v.props.State === 'Default').map((v) => [rest(v), look(v)]));
  return variants.filter((v) => !['Hover', 'Pressed', 'Focus'].includes(v.props.State ?? '') || resting.get(rest(v)) !== look(v));
}

/**
 * Only what changes the drawing is a Figma property, as the static generator keeps only props that change the styles:
 * a state the CSS does not style (the measure forces hover on everything) and an axis whose values all draw the same
 * (validationMode) are left out, with the variants they made.
 */
function drawnAxes(axes: SpecAxis[], variants: SpecVariant[]): { axes: SpecAxis[]; variants: SpecVariant[] } {
  const look = (v: SpecVariant) => JSON.stringify([v.values, v.hidden ?? [], v.vectors ?? {}, v.pins ?? {}]);
  let current = { axes, variants };
  for (const axis of axes) {
    const others = (v: SpecVariant) => JSON.stringify(current.axes.filter((a) => a !== axis).map((a) => v.props[a.name]));
    const twin = new Map<string, SpecVariant>();
    for (const v of current.variants) if (v.props[axis.name] === axis.default) twin.set(others(v), v);
    // A value draws something of its own when one of its variants differs from its default twin.
    // The measure forces hover while it presses or focuses: Pressed (or Focus) that draws like Hover is not styled.
    const hoverTwin = new Map<string, SpecVariant>();
    if (axis.name === 'State') for (const v of current.variants) if (v.props.State === 'Hover') hoverTwin.set(others(v), v);
    // Without a default twin (the stories skip that combination), any other value of the axis there stands in.
    const stand = (v: SpecVariant) => current.variants.filter((x) => x.props[axis.name] !== v.props[axis.name] && others(x) === others(v));
    const differs = (v: SpecVariant, from: Map<string, SpecVariant>) =>
      from.has(others(v)) ? look(from.get(others(v))!) !== look(v) : from !== twin || stand(v).every((x) => look(x) !== look(v));
    const drawn = axis.values.filter(
      (value) =>
        value === axis.default ||
        current.variants.some((v) => v.props[axis.name] === value && differs(v, twin) && (!['Pressed', 'Focus'].includes(value) || !hoverTwin.size || differs(v, hoverTwin))),
    );
    const values = axis.values.filter((value) => drawn.includes(value));
    // A value that draws like the default stands for it where the default has no story (only `tel` was hovered).
    const variants = current.variants.filter((v) => values.includes(v.props[axis.name]!));
    const covered = new Set(variants.filter((v) => v.props[axis.name] === axis.default).map(others));
    for (const v of current.variants) {
      if (values.includes(v.props[axis.name]!) || covered.has(others(v))) continue;
      covered.add(others(v));
      variants.push({ ...v, props: { ...v.props, [axis.name]: axis.default } });
    }
    if (values.length > 1) current = { axes: current.axes.map((a) => (a === axis ? { ...a, values } : a)), variants };
    else
      current = {
        axes: current.axes.filter((a) => a !== axis),
        variants: variants.map((v) => ({ ...v, props: Object.fromEntries(Object.entries(v.props).filter(([k]) => k !== axis.name)) })),
      };
  }
  return current;
}

/** Every set the measure can give, by component (the last segment of a story's title: "Figma variants/Radio" is Radio). */
export function specsFromMeasure(file: MeasuredSpecsFile, opts: { known?: ((path: string) => boolean) | undefined } = {}): { specs: ComponentSpecsFile; report: MeasuredOnlyReport; shots: MeasuredShots } {
  const known = opts.known ?? (() => true);
  const groups = new Map<string, MeasuredSpecsStory[]>();
  for (const s of file.stories) {
    if (s.error || !s.spec) continue;
    const name = setNameOf(s.title);
    groups.set(name, [...(groups.get(name) ?? []), s]);
  }
  const argTypesOf = (name: string) => Object.assign({}, ...(file.components ?? []).filter((c) => setNameOf(c.title) === name).map((c) => c.argTypes));
  const components: ComponentSpec[] = [];
  const shots: MeasuredShots = {};
  const report: MeasuredOnlyReport = { sets: 0, variants: 0, stories: 0, skipped: [] };
  for (const [name, stories] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const built = setOf(name, stories, argTypesOf(name), file.storybook, known);
    if (!built) {
      report.skipped.push(name);
      continue;
    }
    const spec = built.spec;
    components.push(spec);
    if (Object.keys(built.shots).length) shots[name] = built.shots;
    report.sets++;
    report.variants += spec.variants.length;
    report.stories += stories.length;
  }
  return { specs: { version: 1, generated: `Measured from ${file.storybook} on ${file.measuredAt} (bridge specs --measure).`, components }, report, shots };
}
