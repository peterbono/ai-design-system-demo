// Gap case: for one component the Figma pull drew, what differs from the code, per variant, in words a designer reads
// and in deltas a fix can be written from. The story shot is the referee (the plugin's Check fidelity says which
// variants differ); the measure (measured-specs.json) and what Figma drew (the spec the builder drew from, plus what the
// plugin reads back from the layers) say why. Claude reads a gap case to propose a fix (figma-fixes.json), Bridge
// re-checks against the shot, a person approves. Pure and browser safe: the plugin UI, the CLI and the docs site run it.

import { variantKeyOf, type ComponentSpec, type SpecField, type SpecPart, type SpecValue, type SpecVariant } from './component-spec';
import type { FidelityComponentResult, FidelityVariantResult, Size } from './fidelity';
import { compareSpecToMeasured, pairParts, withoutAddedWrappers, type MeasuredBox, type MeasuredSpec, type MeasuredSpecsFile, type MeasuredSpecsStory, type MeasuredState } from './measured-spec';

export const GAP_CASE_VERSION = 1;

/** How a story reaches a variant: at rest, a forced pseudo state, or disabled (an arg). */
export type GapState = 'rest' | MeasuredState | 'disabled';

/**
 * What a difference is about. A Figma field (fill, paddingTop, cornerRadius, height...), or: `presence` (a part one side
 * draws and the other does not), `sizing` (fixed in code, hugging in Figma), `direction` (auto layout direction).
 */
export type GapProperty = SpecField | 'presence' | 'sizing' | 'direction';

/** One concrete difference. `expected` is the code (the measure), `actual` is Figma (what was drawn). */
export interface GapDifference {
  /** Plain words: "Height 72 in Figma vs 84 in code: 12 px missing below the label wrapper". */
  text: string;
  /** Part id, as the measure and the built set name it ("root", "cds--toggle-switch"). */
  part: string;
  /** The part in words ("toggle switch"). */
  partName: string;
  property: GapProperty;
  /** Code: token path, px number, null (no paint), `present`, `fixed`, `HORIZONTAL`... */
  expected: SpecValue | boolean;
  /** Figma: the same kinds, `missing`, `hidden`, `hug`... */
  actual: SpecValue | boolean;
  /** Numbers: actual minus expected, px (negative: Figma is smaller). */
  delta?: number | undefined;
}

export interface GapStoryRef {
  /** Storybook story id. */
  id: string;
  name?: string | undefined;
  /** Story URL the measure opened (args in it). */
  url?: string | undefined;
  /** The props it rendered with (args over the component defaults), and the args Bridge passed to reach the variant. */
  props: Record<string, string | number | boolean>;
  overrides?: Record<string, string | number | boolean> | undefined;
  state: GapState;
}

export interface GapVariant {
  /** Figma variant key (variantKeyOf: "Size=md, State=Default"). */
  key: string;
  /** Figma props of the variant. */
  props: Record<string, string>;
  /** The referee's verdict for this variant: the plugin's Check fidelity (`unchecked` without one). */
  verdict: 'differs' | 'unchecked';
  /** Different pixels in percent, and both sizes, when the shot was compared. */
  percent?: number | undefined;
  size?: { figma: Size; code: Size } | undefined;
  story?: GapStoryRef | undefined;
  /** The story's screenshot, relative to measured-specs.json (the referee image). */
  shot?: string | undefined;
  /** What Figma drew for this variant: a node id or an exported PNG, when the plugin passes one. */
  figmaRender?: string | undefined;
  differences: GapDifference[];
  /** Why the list is empty when the shots differ: no story, or the measure agrees and only the images tell. */
  unexplained?: string | undefined;
}

export interface GapCase {
  version: typeof GAP_CASE_VERSION;
  component: string;
  storybook: string;
  /** `shots`: the variants come from the fidelity check. `values`: no check was passed, variants with differences. */
  referee: 'shots' | 'values';
  /** Variants compared, and how many differ. */
  checked: number;
  differing: number;
  /** One sentence for a designer. */
  summary: string;
  /** Lines for a developer (or Claude): story, args, state, shot and every delta per variant. */
  detail: string;
  variants: GapVariant[];
  /** Fixes from figma-fixes.json already applied to this component (the patched measure says so). */
  fixes?: string[] | undefined;
}

/** What the plugin reads back from one drawn variant, laid over the spec it drew from. All optional. */
export interface GapBuiltVariant {
  /** Field values the layers hold (part id -> field -> value), when they differ from the spec's. */
  values?: SpecVariant['values'] | undefined;
  /** Parts hidden in this variant. */
  hidden?: string[] | undefined;
  /** Part id -> its box relative to the variant's top-left, px: lets the gap say where space is missing. */
  boxes?: Record<string, MeasuredBox> | undefined;
}

export interface GapCaseInput {
  /** Set name ("Toggle"): the last segment of the stories' title. */
  component: string;
  measured: MeasuredSpecsFile;
  /** What the pull drew the set from (specsFromMeasure's spec, or the overlaid static spec). */
  spec?: ComponentSpec | undefined;
  /** The plugin's Check fidelity result for this set: the referee. */
  fidelity?: FidelityComponentResult | undefined;
  /** Variant key -> what the layers read back. */
  built?: Record<string, GapBuiltVariant> | undefined;
  /** Variant key -> the story shot the set was compared with (MeasuredShots[set]). */
  shots?: Record<string, { file: string }> | undefined;
  /** Variant key -> a reference to what Figma drew (node id, PNG path). */
  figmaRenders?: Record<string, string> | undefined;
  /** Token path -> its value in the measured page. Default: the measure's resolved values and token harvest. */
  resolve?: ((tokenPath: string) => string | number | undefined) | undefined;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const setNameOf = (title: string) => title.split('/').at(-1)!.trim();

/** The stories of a set: the last title segment, case and punctuation ignored. */
export function storiesOfComponent(file: Pick<MeasuredSpecsFile, 'stories'>, component: string): MeasuredSpecsStory[] {
  return file.stories.filter((s) => lc(setNameOf(s.title)) === lc(component));
}

/** A story's state: its forced pseudo state, else disabled when the arg says so, else at rest. */
export function storyState(s: Pick<MeasuredSpecsStory, 'state' | 'props' | 'overrides'>): GapState {
  if (s.state) return s.state;
  const p = { ...(s.props ?? {}), ...(s.overrides ?? {}) };
  return p.disabled === true || p.isDisabled === true ? 'disabled' : 'rest';
}

const STATE_WORDS: Record<string, GapState> = { default: 'rest', rest: 'rest', enabled: 'rest', hover: 'hover', hovered: 'hover', pressed: 'active', active: 'active', focus: 'focus-visible', focused: 'focus-visible', focusvisible: 'focus-visible', disabled: 'disabled' };

/**
 * The story a Figma variant was drawn from: the one whose shot it was compared with, else the first (single instance
 * before galleries) whose props, overrides and state give the variant's axis values.
 */
export function storyForVariant(spec: Pick<ComponentSpec, 'axes'>, props: Record<string, string>, stories: MeasuredSpecsStory[], shot?: { file: string }): MeasuredSpecsStory | undefined {
  const ok = stories.filter((s) => s.spec && !s.error);
  const fits = (s: MeasuredSpecsStory) => {
    const p = { ...(s.props ?? {}), ...(s.overrides ?? {}) } as Record<string, unknown>;
    return spec.axes.every((axis) => {
      const want = props[axis.name];
      if (want === undefined) return true;
      if (axis.prop) return p[axis.prop] !== undefined ? lc(String(p[axis.prop])) === lc(want) : lc(want) === lc(axis.default);
      if (lc(axis.name) === 'state') return (STATE_WORDS[lc(want)] ?? lc(want)) === storyState(s);
      if (lc(axis.name) === 'checked') return lc(want) === (p.indeterminate === true ? 'mixed' : String(p.checked === true));
      return p[axis.name] === undefined ? lc(want) === lc(axis.default) : lc(String(p[axis.name])) === lc(want);
    });
  };
  const order = (list: MeasuredSpecsStory[]) => [...list].sort((a, b) => Number(!!a.gallery) - Number(!!b.gallery));
  if (shot) {
    const same = ok.filter((s) => s.shot?.file === shot.file);
    if (same.length) return order(same).find(fits) ?? same[0];
  }
  return order(ok).find(fits);
}

/** A part in words: the measure's ids are class names ("cds--toggle__switch" -> "toggle switch"). */
/** Icon libraries a part id may be named after ("lucide", "lucide-check"): a designer reads "icon". */
const ICON_LIBRARY = /^(lucide|heroicons?|phosphor|tabler|feather|material-?icons?|fa|fontawesome|svg)(?:$|[-_])/i;

export function partWords(part: Pick<SpecPart, 'id' | 'name'> | undefined, id = part?.id ?? ''): string {
  if (id === 'root') return 'component';
  if (ICON_LIBRARY.test(part?.id ?? id)) return 'icon';
  const base = (part?.id ?? id).replace(/^[a-z]{1,6}--/i, '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return base || (part?.name ?? id).toLowerCase();
}

const round = (n: number) => (Math.abs(n - Math.round(n)) < 0.1 ? Math.round(n) : Math.round(n * 10) / 10);

const FIELD_WORDS: Partial<Record<SpecField, string>> = {
  fill: 'Fill',
  stroke: 'Border color',
  strokeWeight: 'Border width',
  strokeTopWeight: 'Top border',
  strokeRightWeight: 'Right border',
  strokeBottomWeight: 'Bottom border',
  strokeLeftWeight: 'Left border',
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
  textDecoration: 'Text decoration',
};

/** A value for people: none, a px number (a radius at half the box or more reads "full"), or the token path. */
function showValue(v: SpecValue | boolean | undefined, field: GapProperty, box?: MeasuredBox): string {
  if (v === undefined || v === null) return field === 'presence' ? 'missing' : 'none';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (field === 'cornerRadius' && box && v > 0 && v >= Math.min(box.width, box.height) / 2 - 0.5) return 'full';
    return String(round(v));
  }
  return v;
}

/** Token path -> value, from the measure: components[].resolved, then the token harvest (by CSS name). */
export function measuredResolver(file: Pick<MeasuredSpecsFile, 'components' | 'tokens'>): (path: string) => string | number | undefined {
  const byKey = new Map<string, string | number>();
  for (const p of file.tokens?.properties ?? []) {
    byKey.set(lc(p.name), p.value);
    byKey.set(lc(p.path), p.value);
  }
  for (const c of file.components ?? []) for (const [path, value] of Object.entries(c.resolved ?? {})) byKey.set(lc(path), value);
  return (path) => byKey.get(lc(path));
}

// ---------------------------------------------------------------------------------------------
// Where a size difference comes from

interface Contribution {
  amount: number;
  text: string;
}

/**
 * Splits a size difference between a frame's children along one axis: the space before each child, each child's own
 * size, and the space after the last. A child whose own size accounts for it is explained one level down.
 */
function locate(parentBuilt: string, parentMeasured: string, axis: 'y' | 'x', built: Record<string, MeasuredBox>, measured: MeasuredSpec, builtParts: SpecPart[], pairs: Map<string, string>, depth = 0): Contribution[] {
  const len = axis === 'y' ? 'height' : 'width';
  const before = axis === 'y' ? 'above' : 'before';
  const after = axis === 'y' ? 'below' : 'after';
  const pb = built[parentBuilt];
  const pm = measured.boxes[parentMeasured];
  if (!pb || !pm) return [];
  const kids = builtParts
    .filter((p) => p.parent === parentBuilt && !p.pin && !p.cover && pairs.has(p.id) && built[p.id] && measured.boxes[pairs.get(p.id)!])
    .map((p) => ({ p, b: built[p.id]!, m: measured.boxes[pairs.get(p.id)!]! }))
    .sort((a, b) => a.m[axis] - b.m[axis]);
  if (!kids.length) return [];
  const out: Contribution[] = [];
  const say = (amount: number, where: string) => {
    if (Math.abs(amount) < 1) return;
    out.push({ amount, text: `${round(Math.abs(amount))} px ${amount < 0 ? 'missing' : 'extra'} ${where}` });
  };
  // Children side by side on this axis (a row's height): only the tallest child and the paddings explain it.
  const stacked = kids.every((k, i) => i === 0 || k.m[axis] >= kids[i - 1]!.m[axis] + kids[i - 1]!.m[len] - 0.5);
  if (!stacked) {
    const tallest = [...kids].sort((a, b) => b.m[len] - a.m[len])[0]!;
    const change = tallest.b[len] - tallest.m[len];
    if (Math.abs(change) >= 1) out.push(...ownSize(tallest, change));
    return out;
  }
  let prevB = pb[axis];
  let prevM = pm[axis];
  kids.forEach((k, i) => {
    const gap = k.b[axis] - prevB - (k.m[axis] - prevM);
    say(gap, i === 0 ? `${before} the ${partWords(k.p)}` : `${after} the ${partWords(kids[i - 1]!.p)}`);
    const change = k.b[len] - k.m[len];
    if (Math.abs(change) >= 1) out.push(...ownSize(k, change));
    prevB = k.b[axis] + k.b[len];
    prevM = k.m[axis] + k.m[len];
  });
  say(pb[axis] + pb[len] - prevB - (pm[axis] + pm[len] - prevM), `${after} the ${partWords(kids.at(-1)!.p)}`);
  return out;

  function ownSize(k: { p: SpecPart; b: MeasuredBox; m: MeasuredBox }, change: number): Contribution[] {
    const inner = depth < 3 ? locate(k.p.id, pairs.get(k.p.id)!, axis, built, measured, builtParts, pairs, depth + 1) : [];
    if (inner.length) return inner;
    return [{ amount: change, text: `the ${partWords(k.p)} is ${round(Math.abs(change))} px ${change < 0 ? (axis === 'y' ? 'shorter' : 'narrower') : axis === 'y' ? 'taller' : 'wider'} in Figma` }];
  }
}

// ---------------------------------------------------------------------------------------------
// One variant

export interface VariantGapInput {
  /** The parts the set was drawn with, and this variant's values and hidden parts. */
  parts: SpecPart[];
  variant: Pick<SpecVariant, 'values' | 'hidden' | 'layout'>;
  properties?: ComponentSpec['properties'] | undefined;
  built?: GapBuiltVariant | undefined;
  measured: MeasuredSpec;
  /** The fidelity check's sizes (CSS px), when the shot was compared. */
  size?: { figma: Size; code: Size } | undefined;
  resolve?: ((tokenPath: string) => string | number | undefined) | undefined;
}

/**
 * The differences between what Figma drew for one variant and what the code renders (its measured story): the size and
 * where it comes from, parts one side lacks, fixed sizes Figma hugs, auto layout direction, then field values.
 */
export function variantDifferences(input: VariantGapInput): GapDifference[] {
  const { measured } = input;
  const parts = withoutAddedWrappers(input.parts, measured);
  const builtValues: SpecVariant['values'] = {};
  for (const [id, f] of Object.entries(input.variant.values ?? {})) builtValues[id] = { ...f };
  for (const [id, f] of Object.entries(input.built?.values ?? {})) builtValues[id] = { ...(builtValues[id] ?? {}), ...f };
  const hiddenSet = new Set([...(input.variant.hidden ?? []), ...(input.built?.hidden ?? [])]);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const isHidden = (p: SpecPart): boolean => hiddenSet.has(p.id) || (!!p.parent && !!byId.get(p.parent) && isHidden(byId.get(p.parent)!));
  const visible = parts.filter((p) => !isHidden(p));
  const pairOpts = { properties: input.properties };
  const pairs = pairParts(visible, measured, pairOpts);
  const pairedMeasured = new Set(pairs.values());
  const mById = new Map(measured.parts.map((p) => [p.id, p]));
  const out: GapDifference[] = [];
  const name = (id: string) => partWords(byId.get(id) ?? mById.get(id), id);

  // 1. Size of the whole variant: the shot sizes, else the layers' root box.
  const rootB = visible.find((p) => !p.parent);
  const codeBox = measured.boxes.root;
  const figmaSize = input.size?.figma ?? (rootB && input.built?.boxes?.[rootB.id]) ?? undefined;
  const codeSize = input.size?.code ?? codeBox;
  let sized = false;
  if (figmaSize && codeSize) {
    for (const [field, axis] of [['height', 'y'], ['width', 'x']] as const) {
      const delta = figmaSize[field] - codeSize[field];
      if (Math.abs(delta) < 1) continue;
      sized = true;
      const where = rootB && input.built?.boxes ? locate(rootB.id, 'root', axis, input.built.boxes, measured, visible, pairs) : [];
      where.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      const why = where.length ? `: ${where.slice(0, 2).map((w) => w.text).join(', ')}` : '';
      out.push({ text: `${FIELD_WORDS[field]} ${round(figmaSize[field])} in Figma vs ${round(codeSize[field])} in code${why}`, part: 'root', partName: 'component', property: field, expected: round(codeSize[field]), actual: round(figmaSize[field]), delta: round(delta) });
    }
  }

  // 2. Parts one side draws and the other does not (the top-most only: a missing knob, not its every layer).
  const pairsAll = pairParts(parts, measured, pairOpts);
  const hiddenFor = new Map<string, string>();
  for (const [b, m] of pairsAll) if (isHidden(byId.get(b)!)) hiddenFor.set(m, b);
  for (const m of measured.parts) {
    if (m.id === 'root' || pairedMeasured.has(m.id)) continue;
    if (m.parent && m.parent !== 'root' && !pairedMeasured.has(m.parent)) continue;
    const hiddenPart = hiddenFor.get(m.id);
    out.push({
      text: hiddenPart ? `The ${name(m.id)} is hidden in Figma, shown in code` : `The ${name(m.id)} is missing in Figma`,
      part: hiddenPart ?? m.id,
      partName: name(m.id),
      property: 'presence',
      expected: 'present',
      actual: hiddenPart ? 'hidden' : 'missing',
    });
  }
  for (const p of visible) {
    if (!p.parent || pairs.has(p.id)) continue;
    if (!pairs.has(p.parent)) continue;
    out.push({ text: `The ${name(p.id)} is in Figma, not in the code render`, part: p.id, partName: name(p.id), property: 'presence', expected: 'absent', actual: 'present' });
  }

  // 3. Sizes the CSS fixes that Figma hugs (an icon button around its icon).
  for (const [b, m] of pairs) {
    const fixed = measured.sized?.[m];
    if (!fixed) continue;
    for (const field of ['width', 'height'] as const) {
      if (fixed[field] === undefined || builtValues[b]?.[field] !== undefined) continue;
      if (b === rootB?.id && sized) continue;
      out.push({ text: `${FIELD_WORDS[field]} fixed at ${round(fixed[field]!)} in code, hugs its content in Figma (${name(b)})`, part: b, partName: name(b), property: 'sizing', expected: 'fixed', actual: 'hug' });
    }
  }

  // 4. Auto layout direction.
  for (const [b, m] of pairs) {
    const bl = input.variant.layout?.[b] ?? byId.get(b)?.layout;
    const ml = mById.get(m)?.layout;
    if (!bl || !ml || bl.direction === ml.direction) continue;
    const words = (d: string) => (d === 'VERTICAL' ? 'stacked' : 'side by side');
    out.push({ text: `Children ${words(bl.direction)} in Figma, ${words(ml.direction)} in code (${name(b)})`, part: b, partName: name(b), property: 'direction', expected: ml.direction, actual: bl.direction });
  }

  // 5. Field values, same rules as the bench (same token, or same value in the page).
  const c = compareSpecToMeasured(visible, builtValues, measured, input.resolve, pairOpts);
  for (const d of c.diffs) {
    if (d.measured === undefined) continue;
    if (d.part === rootB?.id && sized && (d.field === 'width' || d.field === 'height')) continue;
    const box = measured.boxes[pairs.get(d.part) ?? ''];
    const actual = d.static ?? null;
    const expected = d.measured;
    const where = d.part === rootB?.id ? '' : ` (${name(d.part)})`;
    const numeric = typeof actual === 'number' && typeof expected === 'number';
    out.push({
      text: `${FIELD_WORDS[d.field] ?? d.field} ${showValue(actual, d.field, box)} in Figma vs ${showValue(expected, d.field, box)} in code${where}`,
      part: d.part,
      partName: name(d.part),
      property: d.field,
      expected,
      actual,
      ...(numeric ? { delta: round((actual as number) - (expected as number)) } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The case

const stateWords: Record<GapState, string> = { rest: 'at rest', hover: 'hover', active: 'pressed', 'focus-visible': 'focus', disabled: 'disabled' };

/**
 * The gap case of one component: the variants the referee says differ (the fidelity check; without one, every variant
 * with a difference), each with its story, args, state, shot, Figma render and the differences in words and deltas.
 */
export function buildGapCase(input: GapCaseInput): GapCase {
  const stories = storiesOfComponent(input.measured, input.component);
  const resolve = input.resolve ?? measuredResolver(input.measured);
  const spec = input.spec;
  const fixes = fixesOf(input.measured, input.component);
  const checkedVariants: { key: string; props: Record<string, string>; result?: FidelityVariantResult | undefined; variant?: SpecVariant | undefined }[] = [];
  const specVariant = new Map((spec?.variants ?? []).map((v) => [variantKeyOf(v.props), v]));
  if (input.fidelity) {
    for (const r of input.fidelity.variants) if (r.status !== 'skipped') checkedVariants.push({ key: r.key, props: specVariant.get(r.key)?.props ?? propsOfKey(r.key), result: r, variant: specVariant.get(r.key) });
  } else for (const [key, v] of specVariant) checkedVariants.push({ key, props: v.props, variant: v });

  const variants: GapVariant[] = [];
  for (const cv of checkedVariants) {
    if (cv.result && cv.result.status !== 'differs') continue;
    const shot = input.shots?.[cv.key];
    const story = spec ? storyForVariant(spec, cv.props, stories, shot) : shot ? stories.find((s) => s.shot?.file === shot.file) : undefined;
    const gv: GapVariant = {
      key: cv.key,
      props: cv.props,
      verdict: cv.result ? 'differs' : 'unchecked',
      ...(cv.result?.percent !== undefined ? { percent: cv.result.percent } : {}),
      ...(cv.result?.size ? { size: cv.result.size } : {}),
      ...(story ? { story: storyRef(story) } : {}),
      ...(shot?.file ?? story?.shot?.file ? { shot: shot?.file ?? story?.shot?.file } : {}),
      ...(input.figmaRenders?.[cv.key] ? { figmaRender: input.figmaRenders[cv.key] } : {}),
      differences: [],
    };
    const measured = story ? (story.instances?.[0] ?? story.spec) : undefined;
    if (!story || !measured) gv.unexplained = 'No measured story renders this variant: measure it, or point it to a story (figma-fixes.json, kind "story")';
    else if (!spec || !cv.variant) {
      if (cv.result?.size) gv.differences = variantDifferences({ parts: [], variant: { values: {} }, measured, size: cv.result.size, resolve }).filter((d) => d.part === 'root');
      if (!gv.differences.length) gv.unexplained = 'The pull did not pass the set it drew: only the shots tell this variant apart';
    } else {
      gv.differences = variantDifferences({ parts: spec.parts, variant: cv.variant, properties: spec.properties, built: input.built?.[cv.key], measured, size: cv.result?.size, resolve });
      if (!gv.differences.length) gv.unexplained = agreeWords(cv.result?.percent);
    }
    if (!cv.result && !gv.differences.length) continue;
    variants.push(gv);
  }
  const checked = checkedVariants.length;
  const differing = variants.length;
  const referee = input.fidelity ? 'shots' : 'values';
  return {
    version: GAP_CASE_VERSION,
    component: input.component,
    storybook: input.measured.storybook,
    referee,
    checked,
    differing,
    summary: gapSummary(input.component, variants, checked, input.fidelity),
    detail: gapDetail(input.component, variants, checked, referee),
    variants,
    ...(fixes.length ? { fixes } : {}),
  };
}

function propsOfKey(key: string): Record<string, string> {
  if (key === 'Default') return {};
  return Object.fromEntries(key.split(', ').map((kv) => kv.split('=') as [string, string]));
}

function storyRef(s: MeasuredSpecsStory): GapStoryRef {
  return {
    id: s.id,
    ...(s.name ? { name: s.name } : {}),
    ...(s.url ? { url: s.url } : {}),
    props: { ...(s.props ?? {}) },
    ...(s.overrides && Object.keys(s.overrides).length ? { overrides: { ...s.overrides } } : {}),
    state: storyState(s),
  };
}

/** Past this share of different pixels, values that agree mean the measure misses what differs, not a near match. */
const UNMEASURED_PERCENT = 5;

/** Why a differing variant has no measured difference: a near match to compare by eye, or what Bridge does not measure. */
function agreeWords(percent: number | undefined): string {
  if (percent !== undefined && percent > UNMEASURED_PERCENT)
    return `Bridge doesn't measure what differs here yet: the measured values agree, but ${percent}% of the pixels differ. Not a match: the images decide`;
  return 'The measured values agree with what Figma drew: compare the shot with the Figma render (text rendering, an icon, an image)';
}

/** Fix ids figma-fixes.json applied to this component (applyFixes writes them on the component entry). */
function fixesOf(file: MeasuredSpecsFile, component: string): string[] {
  const entries = (file.components ?? []).filter((c) => lc(setNameOf(c.title)) === lc(component)) as { figma?: { fixes?: string[] } }[];
  return [...new Set(entries.flatMap((c) => c.figma?.fixes ?? []))];
}

function gapSummary(component: string, variants: GapVariant[], checked: number, fidelity?: FidelityComponentResult): string {
  if (fidelity && fidelity.status === 'not-checked') return `${component} was not compared with the code${fidelity.reason ? `: ${fidelity.reason}` : ''}.`;
  if (!variants.length) return checked ? `${component} matches the code on ${checked} variant${checked === 1 ? '' : 's'}.` : `${component} has no variant to compare.`;
  const first = variants.flatMap((v) => v.differences)[0];
  const head = `${component} differs from the code on ${variants.length} of ${checked} variant${checked === 1 ? '' : 's'}`;
  if (!first) return variants.some((v) => (v.percent ?? 0) > UNMEASURED_PERCENT) ? `${head}: Bridge doesn't measure what differs here yet (the measured values agree, the images do not).` : `${head}: the measure agrees, compare the images.`;
  const more = variants.reduce((n, v) => n + v.differences.length, 0) - 1;
  return `${head}. ${first.text}${more > 0 ? `, and ${more} more` : ''}.`;
}

function gapDetail(component: string, variants: GapVariant[], checked: number, referee: GapCase['referee']): string {
  const lines = [`${component}: ${variants.length} of ${checked} variants differ (${referee === 'shots' ? 'story shots are the referee' : 'no fidelity check passed: measured values only'}).`];
  const fmt = (v: unknown) => (v === null ? 'none' : typeof v === 'string' ? v : JSON.stringify(v));
  for (const v of variants) {
    const where = v.story ? `story ${v.story.id}${v.story.overrides ? ` args ${JSON.stringify(v.story.overrides)}` : ''}, ${stateWords[v.story.state]}` : 'no story';
    const pixels = v.percent !== undefined ? `, ${v.percent}% of pixels` : '';
    const size = v.size ? `, Figma ${round(v.size.figma.width)}x${round(v.size.figma.height)} vs code ${round(v.size.code.width)}x${round(v.size.code.height)}` : '';
    lines.push(`- ${v.key}: ${where}${v.shot ? `, shot ${v.shot}` : ''}${v.figmaRender ? `, Figma ${v.figmaRender}` : ''}${pixels}${size}`);
    for (const d of v.differences) lines.push(`  - ${d.part} ${d.property}: expected ${fmt(d.expected)}, actual ${fmt(d.actual)}${d.delta !== undefined ? ` (${d.delta > 0 ? '+' : ''}${d.delta} px)` : ''}`);
    if (v.unexplained) lines.push(`  - ${v.unexplained}`);
  }
  return lines.join('\n');
}
