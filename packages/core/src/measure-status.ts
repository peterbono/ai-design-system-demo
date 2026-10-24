// What the measure can promise, per component: the variants to measure (story args and forced states), how code props
// map to Figma component properties, and one status for the onboarding contract screen (Matches, Differs, Can't check
// yet with a reason from a closed list). Browser safe: the plugin and the docs site read it; the CLI computes it.
// The measure is the referee: a status is only ever computed from measured stories, never declared.

import type { SpecPart, SpecValue, SpecVariant } from './component-spec';
import { compareSpecToMeasured, type FieldDiff, type MeasuredArgType, type MeasuredSpecsStory, type MeasuredState } from './measured-spec';

// ---------------------------------------------------------------------------------------------
// Variant coverage: which args and states to measure

/** Props that never draw a variant (element type, wiring, content). */
const NOT_AN_AXIS = /^(as|asChild|render|component|className|class|style|id|key|ref|role|type|name|form|dir|lang|tabIndex|slot|children|htmlFor|value|defaultValue|placeholder|href|target|rel|src|alt)$/i;
const DISABLED_PROP = /^(is)?disabled$/i;
const INDETERMINATE_PROP = /^(is)?indeterminate$/i;
const MIXED = /^(mixed|indeterminate|partial)$/i;

export interface VariantMeasure {
  /** Args passed to the story (`{ variant: 'danger', size: 'lg', disabled: true }`). */
  overrides: Record<string, string | number | boolean>;
  /** Pseudo state forced on the component; absent at rest and for disabled (an arg). */
  state?: MeasuredState | undefined;
}

export interface PlanVariantOptions {
  /** Props to vary; default every enum prop (2 to 12 options) that is not wiring (`as`, `type`, `className`...). */
  axes?: string[] | undefined;
  /** Exact values per prop (from a Figma mapping: variantValuesFromMapping); replaces `axes`. Booleans vary too. */
  values?: Record<string, (string | boolean)[]> | undefined;
  /** Exact prop combinations (variantCombosFromMapping); replaces `values` and `axes`. */
  combos?: Record<string, string | boolean>[] | undefined;
  /** States to measure on each combination (default rest, hover, disabled). */
  states?: ('rest' | MeasuredState | 'disabled')[] | undefined;
  /** At most this many measures (default 128); the axes are kept, states are dropped first. */
  max?: number | undefined;
}

/**
 * Every variant to measure for a component, from its argTypes: the cartesian product of its enum props, times the
 * states (hover, focus and active forced in Chrome, disabled as an arg when the component has a disabled prop).
 */
export function planVariantMeasures(argTypes: Record<string, MeasuredArgType>, o: PlanVariantOptions = {}): VariantMeasure[] {
  const valuesOf = (k: string): (string | boolean)[] => o.values?.[k] ?? (argTypes[k]?.kind === 'boolean' ? [false, true] : (argTypes[k]?.options ?? []));
  const names = o.values ? Object.keys(o.values) : (o.axes ?? Object.keys(argTypes).filter((k) => argTypes[k]!.kind === 'enum' && !NOT_AN_AXIS.test(k)));
  const axes = names.map((k) => [k, valuesOf(k)] as const).filter(([, opts]) => opts.length >= (o.values ? 1 : 2) && opts.length <= 12);
  let combos: Record<string, string | boolean>[] = [{}];
  for (const [k, opts] of axes) combos = combos.flatMap((c) => opts.map((v) => ({ ...c, [k]: v })));
  if (o.combos?.length) combos = o.combos;
  // `disabled` even when docgen leaves it out of the argTypes (an inherited HTML prop); a prop that is not a boolean is not it.
  const disabled = Object.keys(argTypes).find((k) => DISABLED_PROP.test(k) && argTypes[k]!.kind === 'boolean') ?? (argTypes.disabled ? undefined : 'disabled');
  let states = (o.states ?? ['rest', 'hover', 'disabled']).filter((s) => s !== 'disabled' || disabled);
  const max = o.max ?? 128;
  while (states.length > 1 && combos.length * states.length > max) states = states.slice(0, -1);
  const out: VariantMeasure[] = [];
  for (const c of combos.slice(0, max))
    for (const s of states) {
      if (s === 'disabled') out.push({ overrides: { ...c, [disabled!]: true } });
      else if (s === 'rest') out.push({ overrides: { ...c } });
      else out.push({ overrides: { ...c }, state: s });
    }
  return out.slice(0, max);
}

/**
 * The prop combinations a Figma component's variants mean in code (State aside): the product of its VARIANT axes,
 * each value with the props it sets (Checked=mixed sets `checked: false, indeterminate: true`). Unmapped values are left out.
 */
export function variantCombosFromMapping(mapping: PropsToFigma): Record<string, string | boolean>[] {
  let combos: Record<string, string | boolean>[] = [{}];
  for (const m of mapping.mapped) {
    if (m.type !== 'VARIANT' || m.prop === 'state' || !m.values) continue;
    const opts = Object.entries(m.values).map(([fv, code]) => ({ [m.prop]: code, ...(m.also?.[fv] ?? {}) }));
    const seen = new Set<string>();
    const uniq = opts.filter((o) => !seen.has(JSON.stringify(o)) && seen.add(JSON.stringify(o)));
    combos = combos.flatMap((c) => uniq.map((o) => ({ ...c, ...o })));
  }
  return combos;
}

/** The values to measure per prop for a Figma component: its VARIANT axes mapped to props (State aside). */
export function variantValuesFromMapping(mapping: PropsToFigma): Record<string, (string | boolean)[]> {
  const out: Record<string, (string | boolean)[]> = {};
  for (const m of mapping.mapped) if (m.type === 'VARIANT' && m.prop !== 'state' && m.values) out[m.prop] = [...new Set(Object.values(m.values))];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Code props <-> Figma component properties

/** A Figma component property as the plugin reads it (componentPropertyDefinitions) or the specs write it. */
export interface FigmaPropertyRef {
  name: string;
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | string;
  /** VARIANT values. */
  values?: string[] | undefined;
  default?: unknown;
}

export interface PropMapping {
  figma: string;
  type: FigmaPropertyRef['type'];
  /** The code prop, or `state` for a Figma State axis (pseudo states and disabled). */
  prop: string;
  /** VARIANT: Figma value -> code value. Missing values are listed in `unmatchedValues`. */
  values?: Record<string, string | boolean> | undefined;
  /** VARIANT values that also set other props (Checked=mixed: `{ indeterminate: true }`). */
  also?: Record<string, Record<string, string | boolean>> | undefined;
  unmatchedValues?: string[] | undefined;
}

export interface PropsToFigma {
  mapped: PropMapping[];
  /** Figma properties with no code prop ("tone has no prop in code"). */
  figmaOnly: string[];
  /** Enum and boolean props with no Figma property. */
  codeOnly: string[];
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const TEXT_PROPS = ['children', 'label', 'text', 'title'];
/** Figma State values -> what reproduces them in code. */
const STATE_VALUES: Record<string, MeasuredState | 'rest' | 'disabled'> = { default: 'rest', rest: 'rest', enabled: 'rest', hover: 'hover', hovered: 'hover', focus: 'focus-visible', focused: 'focus-visible', focusvisible: 'focus-visible', pressed: 'active', active: 'active', disabled: 'disabled' };

/**
 * Maps Figma component properties to code props by name (case, spaces and dashes ignored; `is` prefixes and `Show x`
 * booleans folded), VARIANT values to enum options the same way, and a Figma `State` axis to pseudo states and the
 * disabled prop.
 */
export function mapPropsToFigma(argTypes: Record<string, MeasuredArgType>, figma: FigmaPropertyRef[]): PropsToFigma {
  const props = Object.keys(argTypes);
  const used = new Set<string>();
  const find = (name: string, kinds: MeasuredArgType['kind'][]) => {
    const k = key(name).replace(/^show/, '');
    return props.find((p) => !used.has(p) && kinds.includes(argTypes[p]!.kind) && (key(p) === k || key(p) === `is${k}` || key(p) === `has${k}` || key(p) === `show${k}`));
  };
  const out: PropsToFigma = { mapped: [], figmaOnly: [], codeOnly: [] };
  for (const f of figma) {
    if (f.type === 'VARIANT' && key(f.name) === 'state') {
      const values: Record<string, string | boolean> = {};
      const unmatched: string[] = [];
      // React components take `disabled` even when docgen leaves it out of the argTypes (an inherited HTML prop).
      const disabled = props.find((p) => DISABLED_PROP.test(p) && argTypes[p]!.kind === 'boolean');
      for (const v of f.values ?? []) {
        const s = STATE_VALUES[key(v)];
        if (!s) unmatched.push(v);
        else values[v] = s;
      }
      if (disabled) used.add(disabled);
      out.mapped.push({ figma: f.name, type: f.type, prop: 'state', values, ...(unmatched.length ? { unmatchedValues: unmatched } : {}) });
      continue;
    }
    const prop =
      f.type === 'VARIANT' ? find(f.name, ['enum', 'boolean']) : f.type === 'BOOLEAN' ? find(f.name, ['boolean']) : f.type === 'TEXT' ? (find(f.name, ['text']) ?? (key(f.name) === 'label' || key(f.name) === 'text' ? props.find((p) => !used.has(p) && TEXT_PROPS.includes(p)) : undefined)) : find(f.name, ['other', 'enum']);
    if (!prop) {
      out.figmaOnly.push(f.name);
      continue;
    }
    used.add(prop);
    const m: PropMapping = { figma: f.name, type: f.type, prop };
    if (f.type === 'VARIANT') {
      const a = argTypes[prop]!;
      const values: Record<string, string | boolean> = {};
      const unmatched: string[] = [];
      for (const v of f.values ?? []) {
        if (a.kind === 'boolean') {
          if (/^(true|yes|on)$/i.test(v)) values[v] = true;
          else if (/^(false|no|off)$/i.test(v)) values[v] = false;
          else if (MIXED.test(v)) {
            // A checkbox's third state: not checked, indeterminate (Base UI and React's `indeterminate`), even when docgen
            // leaves the prop out; a story that does not take it is reported when measured.
            values[v] = false;
            m.also = { ...(m.also ?? {}), [v]: { [props.find((p) => INDETERMINATE_PROP.test(p) && argTypes[p]!.kind === 'boolean') ?? 'indeterminate']: true } };
          } else unmatched.push(v);
          continue;
        }
        const hit = (a.options ?? []).find((x) => key(x) === key(v));
        if (hit !== undefined) values[v] = hit;
        else unmatched.push(v);
      }
      m.values = values;
      if (unmatched.length) m.unmatchedValues = unmatched;
    }
    out.mapped.push(m);
  }
  out.codeOnly = props.filter((p) => !used.has(p) && (argTypes[p]!.kind === 'enum' || argTypes[p]!.kind === 'boolean') && !NOT_AN_AXIS.test(p) && !DISABLED_PROP.test(p));
  return out;
}

// ---------------------------------------------------------------------------------------------
// One status per component for the contract screen

export type ComponentCheck = 'matches' | 'differs' | 'cant-check';

/** Why a component can't be checked yet: a closed list, so the copy stays honest. */
export type CantCheckReason =
  | 'no-story' // no story shows the component
  | 'did-not-render' // every story failed (the error is in `detail`)
  | 'no-token-variables' // literal values, no CSS variables: nothing to bind Figma variables to
  | 'popup-closed' // a popup the measure could not open
  | 'no-figma' // no Figma component to compare with yet
  | 'prop-unmapped' // a Figma variant property has no prop in code
  | 'no-story-for-variant'; // some Figma variants have no story (or args) that renders them

export const CANT_CHECK_COPY: Record<CantCheckReason, string> = {
  'no-story': 'No story shows this component',
  'did-not-render': 'The story did not render',
  'no-token-variables': 'Values are not tokens: the styles use literal values, no CSS variables',
  'popup-closed': 'Opens in a popup that Bridge could not open',
  'no-figma': 'No Figma component to compare with yet',
  'prop-unmapped': 'A Figma property has no prop in code',
  'no-story-for-variant': 'No story shows some variants',
};

export interface VariantCheck {
  /** Figma variant key ("Size=md, State=Hover"). */
  key: string;
  status: ComponentCheck;
  /** Story measured for it. */
  story?: string | undefined;
  reason?: CantCheckReason | undefined;
  diffs?: FieldDiff[] | undefined;
  compared?: number | undefined;
}

export interface ComponentStatus {
  name: string;
  status: ComponentCheck;
  /** Can't check yet: why (closed list) and the sentence to show. */
  reason?: CantCheckReason | undefined;
  /** One sentence in designer words: the first difference, or the reason with its detail. */
  summary: string;
  detail?: string | undefined;
  variants: VariantCheck[];
  mapping?: PropsToFigma | undefined;
  /** Share of measured values tied to a declared CSS variable. */
  tokenShare?: number | undefined;
}

/** The Figma side of a component, in the spec shape: what the plugin reads from the Figma set (or the specs it was drawn from). */
export interface FigmaComponentRef {
  properties: FigmaPropertyRef[];
  parts: SpecPart[];
  variants: Pick<SpecVariant, 'props' | 'values'>[];
}

export interface ComponentStatusInput {
  name: string;
  /** The component's measured stories (any args and states). */
  stories: MeasuredSpecsStory[];
  argTypes?: Record<string, MeasuredArgType> | undefined;
  figma?: FigmaComponentRef | undefined;
  /** Token path -> resolved value in the measured page, for value-level agreement. */
  resolve?: ((tokenPath: string) => string | number | undefined) | undefined;
  /** Below this share of values tied to CSS variables, the library has no tokens to check (default 0.1). */
  minTokenShare?: number | undefined;
}

const FIELD_WORDS: Record<string, string> = {
  fill: 'Fill',
  stroke: 'Border color',
  strokeWeight: 'Border width',
  cornerRadius: 'Corner radius',
  paddingTop: 'Top padding',
  paddingRight: 'Right padding',
  paddingBottom: 'Bottom padding',
  paddingLeft: 'Left padding',
  itemSpacing: 'Gap',
  counterAxisSpacing: 'Row gap',
  width: 'Width',
  height: 'Height',
  minWidth: 'Min width',
  minHeight: 'Min height',
  opacity: 'Opacity',
  textFill: 'Text color',
  fontFamily: 'Font',
  fontSize: 'Font size',
  fontWeight: 'Font weight',
  lineHeight: 'Line height',
  letterSpacing: 'Letter spacing',
};
const show = (v: SpecValue | undefined) => (v === undefined || v === null ? 'none' : typeof v === 'number' ? `${v} px` : v);

/** A difference in designer words: "Left padding is 6 px in code, 8 px in Figma (label)". */
export function describeDiff(d: FieldDiff): string {
  const what = FIELD_WORDS[d.field] ?? d.field;
  const where = d.part === 'root' ? '' : ` (${d.part.replace(/-/g, ' ')})`;
  const unitless = d.field === 'fontWeight' || d.field === 'opacity';
  const v = (x: SpecValue | undefined) => (unitless && typeof x === 'number' ? String(x) : show(x));
  return `${what} is ${v(d.measured)} in code, ${v(d.static)} in Figma${where}`;
}

const sameValue = (a: unknown, b: unknown) => a === b || (a !== undefined && b !== undefined && key(String(a)) === key(String(b)));

/**
 * One component's status from its measured stories and its Figma side. The order of the checks is the order a team
 * fixes them in: something to measure, tokens to bind, a Figma component, props that name its variants, a story per
 * variant, then the values.
 */
export function componentStatus(input: ComponentStatusInput): ComponentStatus {
  const base = { name: input.name, variants: [] as VariantCheck[] };
  const cant = (reason: CantCheckReason, detail?: string, extra: Partial<ComponentStatus> = {}): ComponentStatus => ({
    ...base,
    ...extra,
    status: 'cant-check',
    reason,
    summary: detail ? `${CANT_CHECK_COPY[reason]}: ${detail}` : CANT_CHECK_COPY[reason],
    ...(detail ? { detail } : {}),
  });
  if (!input.stories.length) return cant('no-story');
  const ok = input.stories.filter((s) => s.spec && !s.error);
  if (!ok.length) {
    const popup = input.stories.find((s) => s.opened === 'none');
    if (popup) return cant('popup-closed', popup.error);
    return cant('did-not-render', input.stories.find((s) => s.error)?.error);
  }
  const fields = ok.reduce((n, s) => n + s.spec!.coverage.fields, 0);
  const declared = ok.reduce((n, s) => n + s.spec!.coverage.declared, 0);
  const tokenShare = fields ? declared / fields : 0;
  if (tokenShare < (input.minTokenShare ?? 0.1)) return cant('no-token-variables', `${Math.round(tokenShare * 100)}% of values come from CSS variables`, { tokenShare });
  if (!input.figma) return cant('no-figma', undefined, { tokenShare });

  const argTypes = input.argTypes ?? {};
  const mapping = mapPropsToFigma(argTypes, input.figma.properties);
  const variantAxes = input.figma.properties.filter((p) => p.type === 'VARIANT');
  const unmappedAxis = variantAxes.find((p) => mapping.figmaOnly.includes(p.name));
  if (unmappedAxis) return cant('prop-unmapped', `${unmappedAxis.name} has no prop in code`, { mapping, tokenShare });

  const variants: VariantCheck[] = [];
  for (const v of input.figma.variants) {
    const vkey = Object.entries(v.props).map(([k, x]) => `${k}=${x}`).join(', ');
    // The props and state this Figma variant means in code.
    const want: Record<string, unknown> = {};
    let state: MeasuredState | undefined;
    let unreachable = false;
    for (const [axis, value] of Object.entries(v.props)) {
      const m = mapping.mapped.find((x) => x.figma === axis);
      if (!m) continue;
      const code = m.values?.[value];
      if (code === undefined) {
        unreachable = true;
        continue;
      }
      if (m.prop === 'state') {
        if (code === 'disabled') want[Object.keys(argTypes).find((k) => DISABLED_PROP.test(k)) ?? 'disabled'] = true; else if (code !== 'rest') state = code as MeasuredState;
      } else {
        want[m.prop] = code;
        Object.assign(want, m.also?.[value] ?? {});
      }
    }
    // Flags a variant sets only for some values (indeterminate for Checked=mixed): off for the other values.
    const flags = new Set(mapping.mapped.flatMap((m) => Object.values(m.also ?? {}).flatMap((x) => Object.keys(x))));
    const story = unreachable
      ? undefined
      : ok.find((s) => {
          const has = { ...(s.props ?? {}), ...(s.overrides ?? {}) } as Record<string, unknown>;
          if ((s.state ?? undefined) !== state) return false;
          if (!Object.entries(want).every(([k, x]) => sameValue(has[k], x))) return false;
          // A rest variant is not the disabled story.
          return Object.keys(has).every((k) => !(DISABLED_PROP.test(k) || flags.has(k)) || want[k] !== undefined || has[k] !== true);
        });
    if (!story) {
      variants.push({ key: vkey, status: 'cant-check', reason: 'no-story-for-variant' });
      continue;
    }
    const spec = story.instances?.[0] ?? story.spec!;
    const c = compareSpecToMeasured(input.figma.parts, v.values, spec, input.resolve);
    const diffs = c.diffs.filter((d) => d.measured !== undefined);
    variants.push({ key: vkey, story: story.id, status: diffs.length ? 'differs' : 'matches', compared: c.compared, ...(diffs.length ? { diffs } : {}) });
  }
  const differs = variants.filter((v) => v.status === 'differs');
  const missing = variants.filter((v) => v.status === 'cant-check');
  if (differs.length) {
    const all = differs.flatMap((v) => v.diffs ?? []);
    const more = all.length - 1;
    return { ...base, variants, mapping, tokenShare, status: 'differs', summary: `${describeDiff(all[0]!)}${more > 0 ? `, +${more} more` : ''}` };
  }
  if (missing.length) {
    const first = missing.slice(0, 2).map((v) => v.key).join('; ');
    return { ...cant('no-story-for-variant', `${first}${missing.length > 2 ? ` (+${missing.length - 2} more)` : ''}`, { mapping, tokenShare }), variants };
  }
  if (!variants.length) return cant('no-story-for-variant', 'the Figma component has no variants to compare', { mapping, tokenShare });
  return { ...base, variants, mapping, tokenShare, status: 'matches', summary: `Matches Figma on ${variants.length} variant${variants.length === 1 ? '' : 's'}` };
}
