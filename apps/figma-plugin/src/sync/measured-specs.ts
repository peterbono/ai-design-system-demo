// Measured specs (`bridge specs --measure`): what a Storybook really draws, measured in Chrome, laid onto the static
// specs. The structure stays static (axes, props, parts, slots); for each variant a measured story matches by its
// props, its forced state and its overrides, the values of the parts both sides share come from the measure. Variants
// no story matches stay static and are counted. Pure: no DOM, no figma.*. Types, parsing and part pairing are
// @bridge-ds/core's (measured-spec.ts), the same the bench compares with.

import {
  type ComponentSpec,
  type ComponentSpecsFile,
  type MeasuredSpecsFile,
  type MeasuredSpecsStory,
  type SpecField,
  type SpecValue,
  MeasuredSpecsError,
  pairParts,
  parseMeasuredSpecsFile,
} from '@bridge-ds/core';

/** Where `bridge specs --measure` writes by default, from the repo root. */
export const MEASURED_SPECS_FILE = 'measured-specs.json';

/** What the overlay did, for the pull to say. */
export interface MeasuredOverlayReport {
  /** Variants of every set, and those a measured story gave values to. */
  variants: number;
  matched: number;
  /** Variants no story matches: they keep the static values. */
  unmatched: number;
  /** Fields whose value the measure changed. */
  fields: number;
  /** Static tokens kept where the measure read a literal of the same value (a border shorthand). */
  keptTokens: number;
  /** Static tokens replaced by a measured literal of another value: code draws something no token says. */
  literals: number;
}

export function parseMeasuredSpecs(text: string): MeasuredSpecsFile {
  try {
    return parseMeasuredSpecsFile(text);
  } catch (err) {
    if (err instanceof MeasuredSpecsError) throw new Error(`${MEASURED_SPECS_FILE}: ${err.message.replace(/^measured specs:?\s*/, '')}. Measure again with bridge specs --measure.`);
    throw err;
  }
}

const norm = (v: unknown) => String(v).trim().toLowerCase();
const componentOf = (title: string) => norm(title.split('/').at(-1) ?? title);

/** The values a state axis may use for a story: its forced pseudo state, else disabled, else at rest. */
function stateWords(story: MeasuredSpecsStory, props: Record<string, string>): string[] {
  if (story.state === 'hover') return ['hover', 'hovered'];
  if (story.state === 'active') return ['pressed', 'active'];
  if (story.state === 'focus-visible') return ['focus', 'focused', 'focus-visible'];
  if (props.disabled === 'true') return ['disabled'];
  return ['default', 'rest', 'enabled'];
}

/**
 * The variant a story stands for: an axis with a prop takes it (defaults applied by the measure), an axis without one
 * (State, Checked) takes the story's state, then a prop of its name, then its default. A hover or disabled story never
 * stands for Default. Undefined when a value is not one of the axis's.
 */
function storyVariant(spec: ComponentSpec, story: MeasuredSpecsStory): Record<string, string> | undefined {
  if (!story.props) return undefined;
  const props = Object.fromEntries(Object.entries({ ...story.props, ...(story.overrides ?? {}) }).map(([k, v]) => [norm(k), norm(v)]));
  const out: Record<string, string> = {};
  for (const axis of spec.axes ?? []) {
    const values = (axis.values ?? []).map(norm);
    let value = axis.prop ? props[norm(axis.prop)] : undefined;
    if (value === undefined && !axis.prop && norm(axis.name) === 'state') value = stateWords(story, props).find((w) => values.includes(w));
    value ??= props[norm(axis.name)] ?? (axis.default !== undefined ? norm(axis.default) : undefined);
    if (value === undefined || (values.length && !values.includes(value))) return undefined;
    out[axis.name] = value;
  }
  // Disabled or a forced state the set has no axis for: not this set's variants.
  if (!(spec.axes ?? []).some((a) => !a.prop && norm(a.name) === 'state') && (story.state || props.disabled === 'true')) return undefined;
  return out;
}

const px = (v: string) => {
  const m = /^(-?[\d.]+)(px)?$/.exec(v.trim());
  return m ? Number(m[1]) : undefined;
};
/** A token's value in the measured page ("1px", "rgb(31, 41, 55)") and a measured literal, compared as values. */
function sameValue(resolved: string | undefined, measured: SpecValue): boolean {
  if (resolved === undefined || measured === null) return false;
  if (typeof measured === 'number') {
    const r = px(resolved);
    return r !== undefined && Math.abs(r - measured) <= 0.5;
  }
  return resolved.replace(/\s+/g, '').toLowerCase() === String(measured).replace(/\s+/g, '').toLowerCase();
}

/**
 * The static specs with measured values laid on: for each variant a story matches (same component, same props, state
 * and overrides), each field the static spec has on a part the measure also drew (core pairParts) takes the measured
 * value. Fields only the measure has (a hugging width it read in px) are left out: the structure stays static. A static
 * token is kept where the measure read a literal of the same value (components[].resolved); a literal of another
 * value replaces it and is counted.
 */
export function overlayMeasured(specs: ComponentSpecsFile, measured: MeasuredSpecsFile): { specs: ComponentSpecsFile; report: MeasuredOverlayReport } {
  const report: MeasuredOverlayReport = { variants: 0, matched: 0, unmatched: 0, fields: 0, keptTokens: 0, literals: 0 };
  const stories = measured.stories.filter((s) => s.spec && !s.error);
  const resolvedOf = new Map((measured.components ?? []).map((c) => [norm(c.title), c.resolved ?? {}]));
  const components = specs.components.map((spec) => {
    // Stories titled by the set ("Figma variants/Radio") first; else the component's own ("Forms/RadioGroup"), which
    // every set of a folder shares (Menu parts), so it only stands in when no story names the set.
    const bySet = stories.filter((s) => componentOf(s.title) === norm(spec.name));
    const byFolder = spec.component ? stories.filter((s) => componentOf(s.title) === norm(spec.component!)) : [];
    const mine = (bySet.length ? bySet : byFolder).map((s) => ({ s, variant: storyVariant(spec, s) }));
    const variants = spec.variants.map((v) => {
      report.variants++;
      const hit = mine.find((m) => m.variant && Object.entries(v.props).every(([axis, value]) => m.variant![axis] === norm(value)));
      if (!hit) {
        report.unmatched++;
        return v;
      }
      report.matched++;
      const m = hit.s.spec!;
      const resolved = resolvedOf.get(norm(hit.s.title)) ?? {};
      const pairs = pairParts(spec.parts, m, { properties: spec.properties });
      const values = { ...v.values };
      for (const [sid, fields] of Object.entries(v.values)) {
        const mid = pairs.get(sid);
        const mv = mid ? m.values[mid] : undefined;
        if (!mv) continue;
        const next = { ...fields };
        for (const field of Object.keys(fields) as SpecField[]) {
          if (!(field in mv)) continue;
          const before = fields[field] as SpecValue;
          const value = mv[field] as SpecValue;
          if (value === before) continue;
          if (typeof before === 'string' && value !== null && typeof value !== 'string') {
            if (sameValue(resolved[before], value)) {
              report.keptTokens++;
              continue;
            }
            report.literals++;
          }
          next[field] = value;
          report.fields++;
        }
        values[sid] = next;
      }
      return { ...v, values };
    });
    return { ...spec, variants };
  });
  return { specs: { ...specs, components }, report };
}
