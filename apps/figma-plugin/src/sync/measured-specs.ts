// Measured specs (`bridge specs --measure`, #475): what a Storybook really draws, measured in Chrome, laid onto the
// static specs. The structure stays static (axes, props, parts, slots); for each variant a measured story matches by
// its props, the values of the parts both sides share come from the measure. Variants no story matches stay static and
// are counted. Pure: no DOM, no figma.*.
//
// The file types are local until the browser-safe ones land in @bridge-ds/core (they match packages/cli/src/specs.ts
// MeasuredSpecsFile and core/node MeasuredSpec, with the story props the measure will record).

import type { ComponentSpec, ComponentSpecsFile, SpecField, SpecValue } from '@bridge-ds/core';

/** Where `bridge specs --measure` writes by default, from the repo root. */
export const MEASURED_SPECS_FILE = 'measured-specs.json';

/** One measured story in the pull's shape: its parts (local CSS classes in `source`) and their values. */
export interface MeasuredStorySpec {
  story: string;
  parts: { id: string; kind: string; parent?: string | undefined; source?: string | undefined }[];
  values: Record<string, Partial<Record<SpecField, SpecValue>>>;
}

export interface MeasuredStory {
  id: string;
  /** Storybook title ("Actions/Button"): its last segment names the component. */
  title: string;
  name: string;
  /** The story's props, defaults applied ({ variant: 'primary', size: 'md' }). Without them the story matches nothing. */
  props?: Record<string, string | number | boolean> | undefined;
  error?: string | undefined;
  spec?: MeasuredStorySpec | undefined;
}

export interface MeasuredSpecsFile {
  version: 1;
  storybook: string;
  measuredAt: string;
  stories: MeasuredStory[];
}

/** What the overlay did, for the pull to say. */
export interface MeasuredOverlayReport {
  /** Variants of every set, and those a measured story gave values to. */
  variants: number;
  matched: number;
  /** Variants no story matches: they keep the static values. */
  unmatched: number;
  /** Fields the measure set, and static tokens kept where the measure only read a literal. */
  fields: number;
  keptTokens: number;
}

export function parseMeasuredSpecs(text: string): MeasuredSpecsFile {
  let file: MeasuredSpecsFile;
  try {
    file = JSON.parse(text) as MeasuredSpecsFile;
  } catch {
    throw new Error(`${MEASURED_SPECS_FILE} is not valid JSON. Measure again with bridge specs --measure.`);
  }
  if (!file || file.version !== 1 || !Array.isArray(file.stories)) throw new Error(`${MEASURED_SPECS_FILE} is not a measured specs file (version 1). Measure again with bridge specs --measure.`);
  return file;
}

const norm = (v: unknown) => String(v).trim().toLowerCase();
const componentOf = (title: string) => norm(title.split('/').at(-1) ?? title);
/** Local class of a static part ("Button.module.css .label" -> label): the last class it is drawn from. */
const classOf = (source: string | undefined) => /\.([\w-]+)\s*$/.exec(source ?? '')?.[1];
const isToken = (v: SpecValue | undefined) => typeof v === 'string';

/** The variant props a story stands for: each axis from its prop (or its name), else the axis default. */
function storyVariant(spec: ComponentSpec, story: MeasuredStory): Record<string, string> | undefined {
  if (!story.props) return undefined;
  const props = Object.fromEntries(Object.entries(story.props).map(([k, v]) => [norm(k), norm(v)]));
  const out: Record<string, string> = {};
  for (const axis of spec.axes ?? []) {
    const value = props[norm(axis.prop ?? '')] ?? props[norm(axis.name)] ?? (axis.default !== undefined ? norm(axis.default) : undefined);
    if (value === undefined) return undefined;
    out[axis.name] = value;
  }
  return out;
}

/** Static part id -> measured part id: the root, then by local CSS class (as compareSpecToMeasured pairs them). */
function pairParts(statics: ComponentSpec['parts'], measured: MeasuredStorySpec): Map<string, string> {
  const byClass = new Map<string, string>();
  for (const p of measured.parts) for (const c of (p.source ?? '').split(' ')) if (c && !byClass.has(c)) byClass.set(c, p.id);
  const root = measured.parts.find((p) => !p.parent)?.id;
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of statics) {
    const hit = !p.parent ? root : byClass.get(classOf(p.source) ?? '');
    if (hit && !taken.has(hit)) {
      pairs.set(p.id, hit);
      taken.add(hit);
    }
  }
  return pairs;
}

/**
 * The static specs with measured values laid on: for each variant a story matches (same component, same props), each
 * field the static spec has on a part the measure also drew takes the measured value. Fields only the measure has
 * (a hugging width it read in px) are left out: the structure stays static. A static token is kept where the measure
 * only read a literal (a border shorthand), so a binding never turns into a number.
 */
export function overlayMeasured(specs: ComponentSpecsFile, measured: MeasuredSpecsFile): { specs: ComponentSpecsFile; report: MeasuredOverlayReport } {
  const report: MeasuredOverlayReport = { variants: 0, matched: 0, unmatched: 0, fields: 0, keptTokens: 0 };
  const stories = measured.stories.filter((s) => s.spec && !s.error);
  const components = specs.components.map((spec) => {
    const name = norm(spec.component ?? spec.name);
    const mine = stories.filter((s) => componentOf(s.title) === name).map((s) => ({ s, variant: storyVariant(spec, s) }));
    const variants = spec.variants.map((v) => {
      report.variants++;
      const hit = mine.find((m) => m.variant && Object.entries(v.props).every(([axis, value]) => m.variant![axis] === norm(value)));
      if (!hit) {
        report.unmatched++;
        return v;
      }
      report.matched++;
      const pairs = pairParts(spec.parts, hit.s.spec!);
      const values = { ...v.values };
      for (const [sid, fields] of Object.entries(v.values)) {
        const mid = pairs.get(sid);
        const m = mid ? hit.s.spec!.values[mid] : undefined;
        if (!m) continue;
        const next = { ...fields };
        for (const field of Object.keys(fields) as SpecField[]) {
          if (!(field in m)) continue;
          const value = m[field] as SpecValue;
          if (isToken(fields[field]) && !isToken(value) && value !== null) {
            report.keptTokens++;
            continue;
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
