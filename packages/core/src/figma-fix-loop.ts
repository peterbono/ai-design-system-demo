// The Claude correction loop for the Figma pull, step 3: the team's own Claude (Claude Code or Claude Desktop through the
// Bridge MCP server, or an API key the team set) reads a gap case, writes fixes (figma-fixes.json), and Bridge is the
// referee. This file is the referee's offline half and the brief: which components differ (figmaGaps), one component's
// gap case (gapCaseFor), and the VALUES check of proposed fixes (tryFigmaFixes): the fixes are validated, laid on the
// measure, the set is rebuilt the way the plugin pulls it (specsFromMeasure), and each differing variant is compared
// again with what the code renders. The PIXEL check (the story shot against the real Figma render) runs later, in the
// plugin's Check fidelity after the next pull: nothing here can say a component matches.
//
// Pure and browser safe: the MCP server, the CLI, the plugin and Studio can all run it. The key is always the
// team's own: the prompt and the reply parser serve the loop runners (figma-fix-run.ts: `bridge fix --with-claude`, and
// Bridge's server with the key a team admin connected), never a key of Bridge's.

import { variantKeyOf, type ComponentSpec, type SpecField, type SpecPart, type SpecValue, type SpecVariant } from './component-spec';
import type { FidelityComponentResult, FidelityReport } from './fidelity';
import { applyFixes, describePartFix, validateFigmaFixes, type AppliedFix, type FigmaHints, type FigmaFix, type FigmaFixesFile, type FixedMeasuredSpecsFile, FIGMA_FIXES_VERSION } from './figma-fixes';
import { buildGapCase, measuredResolver, storiesOfComponent, storyForVariant, variantDifferences, type GapBuiltVariant, type GapCase, type GapDifference } from './gap-case';
import type { MeasuredSpecsFile } from './measured-spec';
import { specsFromMeasure } from './measured-only';

/** Where the plugin's Check fidelity run lives in the team's repo (or on the requests branch), next to measured-specs.json. */
export const DEFAULT_FIDELITY_RUN_FILE = 'figma-fidelity.json';
/** Rounds of try per component before the loop gives up and proposes an honest status instead. */
export const FIX_LOOP_MAX_ROUNDS = 3;
/** The model the CLI loop runner asks when the team's API key is set and no model is named. */
export const FIX_LOOP_MODEL = 'claude-sonnet-5-5';

/**
 * One Check fidelity run, as the plugin saves it: the report (the shot referee), and per set what the layers read back
 * (values, hidden parts, boxes: they let the gap say where space is missing) and a reference to each Figma render.
 */
export interface FigmaFidelityRun {
  version: 1;
  report: FidelityReport;
  /** Set name -> variant key -> what the plugin read back from the layers. */
  built?: Record<string, Record<string, GapBuiltVariant>> | undefined;
  /** Set name -> variant key -> node id or exported PNG. */
  figmaRenders?: Record<string, Record<string, string>> | undefined;
  /** measuredAt of the measured-specs.json the pull drew from. */
  measuredAt?: string | undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Reads a fidelity run: the plugin's run file, a bare FidelityReport ("Copy the report"), or one component's result.
 * Throws a sentence that says what is wrong.
 */
export function parseFidelityRun(input: string | unknown): FigmaFidelityRun {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new Error(`The fidelity report is not JSON: ${(e as Error).message}`);
    }
  }
  if (!isObj(data)) throw new Error('The fidelity report is not an object: copy it from the plugin (Check fidelity, Copy the report).');
  if (isObj(data.report) && Array.isArray(data.report.components)) return data as unknown as FigmaFidelityRun;
  if (Array.isArray(data.components)) return { version: 1, report: data as unknown as FidelityReport };
  if (typeof data.component === 'string' && Array.isArray(data.variants)) {
    const c = data as unknown as FidelityComponentResult;
    return {
      version: 1,
      report: {
        version: 1,
        checkedAt: '',
        reference: { sha: '', createdAt: '' },
        options: { scale: 2, threshold: 0.1, radius: 2, maxPercent: 3, sizeTolerance: 1 },
        components: [c],
        summary: { components: 1, matches: c.status === 'matches' ? 1 : 0, differs: c.status === 'differs' ? 1 : 0, notChecked: c.status === 'not-checked' ? 1 : 0, variantsChecked: c.checked, variantsSkipped: c.skipped },
      },
    };
  }
  throw new Error('This is not a fidelity report: expected the plugin\'s Check fidelity report (components with variants).');
}

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const setNameOf = (title: string) => title.split('/').at(-1)!.trim();
const byName = <T>(map: Record<string, T> | undefined, name: string): T | undefined => (map ? Object.entries(map).find(([k]) => lc(k) === lc(name))?.[1] : undefined);

// ---------------------------------------------------------------------------------------------
// Which components differ

export interface FigmaGapRow {
  component: string;
  /** Differs: the shots (or the measure) say so. Can't check: nothing to compare, or a status fix says so. */
  status: 'differs' | 'cant-check';
  /** One sentence for a designer. */
  summary: string;
  /** What said it: the plugin's Check fidelity (shots), the measure's --check (values), or a status fix. */
  source: 'fidelity' | 'measure' | 'figma-fixes';
  checked?: number | undefined;
  differing?: number | undefined;
  /** Fix ids figma-fixes.json already applies to it. */
  fixes?: string[] | undefined;
}

/**
 * The components whose Figma build differs from their story, or that cannot be checked: from the fidelity run when
 * there is one (the shots are the referee), else from the measure's statuses (`bridge specs --measure --check`). A
 * status fix in figma-fixes.json shows with its reason. Matching components are left out.
 */
export function figmaGaps(measured: FixedMeasuredSpecsFile | MeasuredSpecsFile, run?: FigmaFidelityRun): FigmaGapRow[] {
  const rows = new Map<string, FigmaGapRow>();
  const fixed = measured as FixedMeasuredSpecsFile;
  const fixesOf = (name: string) => (fixed.components ?? []).filter((c) => lc(setNameOf(c.title)) === lc(name)).flatMap((c) => c.figma?.fixes ?? []);
  const put = (row: FigmaGapRow) => {
    const f = fixesOf(row.component);
    rows.set(lc(row.component), { ...row, ...(f.length ? { fixes: f } : {}) });
  };
  if (run) {
    for (const c of run.report.components) {
      if (c.status === 'matches') continue;
      const status = c.status === 'differs' ? 'differs' : 'cant-check';
      const summary =
        status === 'differs'
          ? `${c.component} differs from its story on ${c.differing} of ${c.checked} variant${c.checked === 1 ? '' : 's'}${c.worst ? `: ${Math.round(c.worst.percent * 10) / 10}% of pixels on ${c.worst.key}` : ''}.`
          : `${c.component} was not compared with its story${c.reason ? `: ${c.reason}` : ''}.`;
      put({ component: c.component, status, summary, source: 'fidelity', checked: c.checked, differing: c.differing });
    }
  } else {
    for (const s of measured.statuses ?? []) {
      if (s.status === 'matches') continue;
      put({ component: s.name, status: s.status, summary: s.summary, source: 'measure' });
    }
  }
  // A status fix speaks for the component as a whole (no `where`): its reason is the sentence a designer sees.
  for (const c of fixed.components ?? []) {
    for (const st of c.figma?.status ?? []) {
      if (st.where) continue;
      const name = setNameOf(c.title);
      const had = rows.get(lc(name));
      if (run && !had) continue;
      put({ component: had?.component ?? name, status: st.status, summary: st.reason, source: 'figma-fixes', ...(had?.checked !== undefined ? { checked: had.checked, differing: had.differing } : {}) });
    }
  }
  return [...rows.values()].sort((a, b) => (a.status === b.status ? a.component.localeCompare(b.component) : a.status === 'differs' ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// One component's gap case

export interface GapCaseForInput {
  component: string;
  /** measured-specs.json as measured (the team's fixes are applied here). */
  measured: MeasuredSpecsFile;
  /** figma-fixes.json, when the repo has one. */
  fixes?: FigmaFixesFile | undefined;
  run?: FigmaFidelityRun | undefined;
}

export interface GapCaseFor {
  gap: GapCase;
  /** The measure with the team's fixes on (what the pull reads). */
  measured: FixedMeasuredSpecsFile;
  /** The set the pull draws from it (specsFromMeasure), when the measure gives one. */
  spec?: ComponentSpec | undefined;
  fidelity?: FidelityComponentResult | undefined;
  shots: Record<string, { file: string }>;
}

/** The gap case of one component, built the way the plugin pulls it: fixes applied, set rebuilt, the run's verdicts. */
export function gapCaseFor(input: GapCaseForInput): GapCaseFor {
  const fixed = input.fixes ? applyFixes(input.measured, input.fixes).file : (input.measured as FixedMeasuredSpecsFile);
  // Only this component's set: building every set of a large measure is seconds of work the case never reads.
  const { specs, shots } = specsFromMeasure(fixed as MeasuredSpecsFile, { only: input.component });
  const spec = specs.components.find((c) => lc(c.name) === lc(input.component));
  const fidelity = input.run?.report.components.find((c) => lc(c.component) === lc(input.component));
  const setShots = byName(shots, input.component) ?? {};
  const gap = buildGapCase({
    component: spec?.name ?? input.component,
    measured: fixed as MeasuredSpecsFile,
    spec,
    fidelity,
    built: byName(input.run?.built, input.component),
    figmaRenders: byName(input.run?.figmaRenders, input.component),
    shots: setShots,
  });
  return { gap, measured: fixed, spec, fidelity, shots: setShots };
}

// ---------------------------------------------------------------------------------------------
// The fix schema, in a page Claude reads (docs/FIGMA-FIXES.md says the same, longer)

export const FIX_SCHEMA_SUMMARY = `figma-fixes.json fixes (version ${FIGMA_FIXES_VERSION}). Each fix is one JSON object:
- Every fix: "id" (lower case, digits, dashes, unique), "kind", "component" (the Figma set, e.g. "TextInput"), "reason" (one plain sentence, no em dash), optional "by": "claude", optional "where": { "args": { "<arg>": value }, "state": "rest" | "hover" | "active" | "focus-visible" | "disabled" } (absent: every variant).
- kind "part": "part" is a part id from the gap case ("root", "cds--text-input-label-wrapper") or ".class". At least one of: "set" { field: token path | px number | null (colors only) | "full" (cornerRadius only) }, "width" / "height": "fixed" (the measured size) | px number | "hug" | "fill", "direction": "HORIZONTAL" | "VERTICAL", "align": { "primary": MIN|CENTER|MAX|SPACE_BETWEEN, "counter": MIN|CENTER|MAX|STRETCH }, "overlay": true | false | { "top": 3, "left": 3 }, "hide": true (alone; never the root). Fields: fill, stroke, strokeWeight, strokeTopWeight, strokeRightWeight, strokeBottomWeight, strokeLeftWeight, cornerRadius, paddingTop, paddingRight, paddingBottom, paddingLeft, itemSpacing, counterAxisSpacing, width, height, minWidth, minHeight, opacity, textFill, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textDecoration.
- kind "axis": "action" "map" ("arg", "property" and/or "values" { code value: Figma value }), "ignore" ("arg"), or "prune" ("where" names the variants to drop).
- kind "story": "where" names the variant, "use": { "story": "<story id>", "args"?, "state"? } is the measured render to draw it from.
- kind "status": "status": "differs" | "cant-check" with the reason; never "matches" (only the shots say a component matches). Without "status": a note.
Rules: fix only the component you were given; prefer the smallest fix that explains the differences (a part's size "fixed" when Figma hugs what code fixes, a missing padding, a hidden part); never invent a part id or a token: use the ones in the gap case.`;

// ---------------------------------------------------------------------------------------------
// Try: the values referee

export type FixDiffResult = 'resolved' | 'closer' | 'same' | 'worse' | 'unknown';
export type FixVerdict = 'closer' | 'same' | 'worse';

export interface TriedDifference {
  text: string;
  part: string;
  property: GapDifference['property'];
  /** Code (the measure). */
  expected: SpecValue | boolean;
  /** Figma now (the gap case), and what the rebuilt set draws with the fixes. */
  before: SpecValue | boolean;
  after: SpecValue | boolean | undefined;
  deltaBefore?: number | undefined;
  deltaAfter?: number | undefined;
  result: FixDiffResult;
  /** The size after is worked out from the layer boxes and the changed paddings, gaps and fixed sizes. */
  estimated?: boolean | undefined;
}

export interface TriedVariant {
  key: string;
  story?: string | undefined;
  /** gone: the fixes drop this variant (prune, ignore). */
  verdict: FixVerdict | 'gone';
  differences: TriedDifference[];
  /** Differences the fixes add: the rebuilt set now disagrees with the code where it agreed. */
  regressions: GapDifference[];
}

export interface TryFixesResult {
  status: 'invalid' | 'checked';
  component: string;
  /** Validation problems (status invalid): fix them and try again. */
  problems: string[];
  /** One record per proposed fix: applied, not-found (its part or story is not in this measure), already. */
  applied: AppliedFix[];
  /** The values referee's verdict on the whole: closer, same or worse. */
  verdict: FixVerdict;
  referee: 'values';
  variants: TriedVariant[];
  /** One sentence. */
  summary: string;
  /** Lines for Claude: per variant, each difference before and after. */
  detail: string;
  /** The figma-fixes.json the fixes make (the repo's fixes, with these added or replacing the same ids). */
  file?: FigmaFixesFile | undefined;
}

export interface TryFixesInput extends GapCaseForInput {
  /** The fixes to try, added to the repo's (a fix with the id of one already there replaces it). */
  proposed: unknown[];
}

/** The repo's fixes with the proposed ones: a proposed fix replaces one with the same id, the others are appended. */
export function mergeFigmaFixes(existing: FigmaFixesFile | undefined, proposed: FigmaFix[]): FigmaFixesFile {
  const ids = new Set(proposed.map((f) => f.id));
  return { ...(existing?.$schema ? { $schema: existing.$schema } : {}), version: FIGMA_FIXES_VERSION, fixes: [...(existing?.fixes ?? []).filter((f) => !ids.has(f.id)), ...proposed] };
}

/** Problems a proposed list has before the file is even built: not a list, or a fix for another component. */
function proposedProblems(component: string, proposed: unknown[], existing: FigmaFix[] = []): string[] {
  if (!Array.isArray(proposed) || !proposed.length) return ['fixes must be a non-empty list of fix objects'];
  const out: string[] = [];
  proposed.forEach((f, i) => {
    if (!isObj(f)) return;
    const label = typeof f.id === 'string' ? `fix ${f.id}` : `fix ${i + 1}`;
    if (typeof f.component === 'string' && lc(f.component) !== lc(component)) out.push(`${label}: component is ${f.component}, but this loop fixes ${component} only (one component at a time)`);
    const taken = existing.find((x) => x.id === f.id && lc(x.component) !== lc(component));
    if (taken) out.push(`${label}: the id is taken by a fix for ${taken.component}: pick another id`);
  });
  return out;
}

/**
 * The values referee: validates the proposed fixes, lays them on the measure, rebuilds the set the way the plugin pulls
 * it, and compares each variant the gap case lists with what the code renders, before and after. A difference is
 * resolved, closer, the same or worse; a difference the fixes add elsewhere is a regression. The verdict is closer when
 * more moved closer than got worse. Offline: no Figma, no shots. The pixel check runs in the plugin after the pull.
 */
export function tryFigmaFixes(input: TryFixesInput): TryFixesResult {
  const component = input.component;
  const empty = (problems: string[]): TryFixesResult => ({
    status: 'invalid',
    component,
    problems,
    applied: [],
    verdict: 'same',
    referee: 'values',
    variants: [],
    summary: `Not tried: ${problems.length} problem${problems.length === 1 ? '' : 's'} in the fixes. Fix them and try again.`,
    detail: problems.map((p) => `- ${p}`).join('\n'),
  });
  const pre = proposedProblems(component, input.proposed, input.fixes?.fixes);
  if (pre.length) return empty(pre);
  const proposedIds = new Set((input.proposed as { id?: unknown }[]).map((f) => f.id).filter((x): x is string => typeof x === 'string'));
  const draft = { version: FIGMA_FIXES_VERSION, fixes: [...(input.fixes?.fixes ?? []).filter((f) => !proposedIds.has(f.id)), ...input.proposed] };
  const problems = validateFigmaFixes(draft);
  if (problems.length) return empty(problems);
  const file = draft as FigmaFixesFile;
  const proposed = file.fixes.filter((f) => proposedIds.has(f.id));

  const before = gapCaseFor({ component, measured: input.measured, fixes: input.fixes, run: input.run });
  const afterRun = applyFixes(input.measured, file);
  const applied = afterRun.applied.filter((a) => proposedIds.has(a.id));
  const afterBuilt = specsFromMeasure(afterRun.file as MeasuredSpecsFile, { only: component });
  const afterSpec = afterBuilt.specs.components.find((c) => lc(c.name) === lc(component));
  const hintsA = afterSpec ? afterBuilt.hints[afterSpec.name] : undefined;
  const hintsB = before.spec ? specsFromMeasure(before.measured as MeasuredSpecsFile, { only: before.spec.name }).hints[before.spec.name] : undefined;
  const resolve = measuredResolver(before.measured);
  const built = byName(input.run?.built, component);
  const stories = storiesOfComponent(before.measured, component);

  const variants: TriedVariant[] = [];
  for (const gv of before.gap.variants) {
    const vb = before.spec?.variants.find((v) => variantKeyOf(v.props) === gv.key);
    // An axis fix renames a property or its values: the same variant under its new name.
    const want = before.spec ? renamedProps(gv.props, before.spec, afterSpec, hintsB, hintsA) : gv.props;
    const va = afterSpec?.variants.find((v) => variantKeyOf(v.props) === gv.key) ?? afterSpec?.variants.find((v) => sameProps(v.props, want));
    if (!va || !afterSpec) {
      variants.push({ key: gv.key, ...(gv.story ? { story: gv.story.id } : {}), verdict: 'gone', differences: [], regressions: [] });
      continue;
    }
    const differences = gv.differences.map((d) => tryDifference(d, before.spec, vb, afterSpec, va, built?.[gv.key], resolve));
    let regressions: GapDifference[] = [];
    const story = before.spec ? storyForVariant(before.spec, gv.props, stories, before.shots[gv.key]) : undefined;
    const m = story ? (story.instances?.[0] ?? story.spec) : undefined;
    if (m && before.spec && vb) {
      const key = (d: GapDifference) => `${d.part}|${d.property}`;
      const had = new Set(variantDifferences({ parts: before.spec.parts, variant: vb, properties: before.spec.properties, measured: m, resolve }).map(key));
      const seen = new Set(gv.differences.map(key));
      regressions = variantDifferences({ parts: afterSpec.parts, variant: va, properties: afterSpec.properties, measured: m, resolve }).filter((d) => !had.has(key(d)) && !seen.has(key(d)));
    }
    variants.push({ key: gv.key, ...(gv.story ? { story: gv.story.id } : {}), verdict: verdictOf(differences, regressions), differences, regressions });
  }
  const all = variants.flatMap((v) => v.differences);
  const regressions = variants.reduce((n, v) => n + v.regressions.length, 0);
  const verdict = verdictOf(all, variants.flatMap((v) => v.regressions));
  const notFound = applied.filter((a) => a.result === 'not-found');
  return {
    status: 'checked',
    component,
    problems: [],
    applied,
    verdict,
    referee: 'values',
    variants,
    summary: trySummary(component, before.gap, all, regressions, verdict, notFound, proposed),
    detail: tryDetail(variants, applied),
    file,
  };
}

const sameProps = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/** A variant's props as the set names them after the fixes: axes renamed and values mapped (figma-fixes.json axis fixes). */
function renamedProps(props: Record<string, string>, specB: ComponentSpec, specA: ComponentSpec | undefined, hintsB: FigmaHints | undefined, hintsA: FigmaHints | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(props)) {
    const prop = specB.axes.find((a) => a.name === name)?.prop;
    if (!prop) {
      out[name] = value;
      continue;
    }
    const axis = specA?.axes.find((a) => a.prop === prop);
    if (!axis) continue;
    const code = Object.entries(hintsB?.values?.[prop] ?? {}).find(([, f]) => f === value)?.[0] ?? value;
    out[axis.name] = hintsA?.values?.[prop]?.[code] ?? code;
  }
  return out;
}

function verdictOf(diffs: TriedDifference[], regressions: GapDifference[]): FixVerdict {
  const better = diffs.filter((d) => d.result === 'resolved' || d.result === 'closer').length;
  const worse = diffs.filter((d) => d.result === 'worse').length + regressions.length;
  return better > worse ? 'closer' : worse > better ? 'worse' : 'same';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number) => Math.round(n * 10) / 10;

/** A value as a number of px when it is one (a number, "12px", a token whose value in the page is px). */
function numberOf(v: unknown, resolve: (p: string) => string | number | undefined): number | undefined {
  if (isNum(v)) return v;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (/^-?[\d.]+(px)?$/.test(t)) return parseFloat(t);
  const r = resolve(t);
  if (isNum(r)) return r;
  if (typeof r === 'string' && /^-?[\d.]+(px)?$/.test(r.trim())) return parseFloat(r);
  return undefined;
}

function sameValue(a: unknown, b: unknown, resolve: (p: string) => string | number | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const na = numberOf(a, resolve);
  const nb = numberOf(b, resolve);
  if (na !== undefined && nb !== undefined) return Math.abs(na - nb) <= 0.5;
  const s = (v: unknown) => {
    const r = typeof v === 'string' ? (resolve(v) ?? v) : v;
    return String(r).replace(/\s+/g, '').toLowerCase();
  };
  return s(a) === s(b);
}

const valueIn = (v: SpecVariant | undefined, part: string, field: SpecField) => v?.values[part]?.[field];

/** How a difference stands once the fixes are on: the rebuilt set's value for it, against the code's. */
function tryDifference(
  d: GapDifference,
  specB: ComponentSpec | undefined,
  vb: SpecVariant | undefined,
  specA: ComponentSpec,
  va: SpecVariant,
  built: GapBuiltVariant | undefined,
  resolve: (p: string) => string | number | undefined,
): TriedDifference {
  const base: TriedDifference = { text: d.text, part: d.part, property: d.property, expected: d.expected, before: d.actual, after: d.actual, ...(d.delta !== undefined ? { deltaBefore: d.delta } : {}), result: 'same' };
  const done = (after: SpecValue | boolean | undefined, extra: Partial<TriedDifference> = {}): TriedDifference => {
    const out = { ...base, after, ...extra };
    if (out.result !== 'unknown') {
      if (sameValue(after, d.expected, resolve)) out.result = 'resolved';
      else if (d.delta !== undefined && isNum(out.deltaAfter)) out.result = Math.abs(out.deltaAfter) < Math.abs(d.delta) - 0.25 ? 'closer' : Math.abs(out.deltaAfter) > Math.abs(d.delta) + 0.25 ? 'worse' : 'same';
      else out.result = 'same';
    }
    return out;
  };
  const partOf = (spec: ComponentSpec | undefined, id: string) => spec?.parts.find((p) => p.id === id);
  const hiddenIn = (spec: ComponentSpec, v: SpecVariant, id: string): boolean => {
    if (!partOf(spec, id)) return true;
    if (v.hidden?.includes(id)) return true;
    const p = partOf(spec, id)!;
    return p.parent ? hiddenIn(spec, v, p.parent) : false;
  };

  if (d.property === 'presence') {
    if (d.actual === 'hidden' || d.actual === 'missing') return done(partOf(specA, d.part) && !hiddenIn(specA, va, d.part) ? 'present' : d.actual);
    if (d.expected === 'absent') return done(hiddenIn(specA, va, d.part) ? 'absent' : 'present');
    return done(d.actual);
  }
  if (d.property === 'direction') {
    const dir = va.layout?.[d.part]?.direction ?? partOf(specA, d.part)?.layout?.direction;
    return done(dir ?? d.actual);
  }
  if (d.property === 'sizing') {
    const field: SpecField = /^height/i.test(d.text) ? 'height' : 'width';
    return done(isNum(valueIn(va, d.part, field)) ? 'fixed' : d.actual);
  }
  if ((d.property === 'height' || d.property === 'width') && d.part === 'root' && isNum(d.actual) && isNum(d.expected)) {
    // The size of the whole variant: exact when the root is now fixed, else worked out from what the fixes change.
    const field = d.property;
    const root = specA.parts.find((p) => !p.parent);
    const fixedNow = root ? valueIn(va, root.id, field) : undefined;
    const fixedBefore = root ? valueIn(vb, root.id, field) : undefined;
    if (isNum(fixedNow) && !sameValue(fixedNow, fixedBefore, resolve)) return done(round(fixedNow), { deltaAfter: round(fixedNow - d.expected) });
    if (!specB || !vb || !root) return { ...base, result: 'unknown' };
    const shift = sizeShift(field, specB, vb, specA, va, built, resolve);
    if (shift === undefined) return { ...base, result: 'unknown' };
    const after = round(d.actual + shift);
    return done(after, { deltaAfter: round(after - d.expected), ...(shift ? { estimated: true } : {}) });
  }
  // A field value on a part: the rebuilt set's value when the fixes changed it, else what Figma has now.
  const field = d.property as SpecField;
  const now = valueIn(va, d.part, field);
  const was = valueIn(vb, d.part, field);
  if (JSON.stringify(now) === JSON.stringify(was)) return done(d.actual, d.delta !== undefined ? { deltaAfter: d.delta } : {});
  const after = now === undefined ? null : now;
  const na = numberOf(after, resolve);
  const ne = numberOf(d.expected, resolve);
  return done(after, na !== undefined && ne !== undefined ? { deltaAfter: round(na - ne) } : {});
}

/**
 * How much a variant's height (or width) moves with the fixes, from the parts stacked along that axis: changed paddings,
 * gaps times the gaps between visible children, and parts that now have a fixed size (from their box in the layers).
 * Undefined when a part becomes fixed and its size in Figma is not known (no layer boxes).
 */
function sizeShift(field: 'height' | 'width', specB: ComponentSpec, vb: SpecVariant, specA: ComponentSpec, va: SpecVariant, built: GapBuiltVariant | undefined, resolve: (p: string) => string | number | undefined): number | undefined {
  const along = field === 'height' ? 'VERTICAL' : 'HORIZONTAL';
  const pads: SpecField[] = field === 'height' ? ['paddingTop', 'paddingBottom'] : ['paddingLeft', 'paddingRight'];
  const n = (v: unknown) => numberOf(v, resolve) ?? 0;
  const hidden = new Set([...(va.hidden ?? [])]);
  const kids = (id: string) => specA.parts.filter((p) => p.parent === id && !p.pin && !p.cover && !hidden.has(p.id));
  let shift = 0;
  let unknown = false;
  const walk = (p: SpecPart) => {
    const own = valueIn(va, p.id, field);
    const was = valueIn(vb, p.id, field);
    if (p.parent && isNum(own) && !sameValue(own, was, resolve)) {
      const current = built?.boxes?.[p.id]?.[field] ?? (isNum(was) ? was : undefined);
      if (current === undefined) unknown = true;
      else shift += own - current;
      return; // A fixed part: what is inside no longer moves the variant.
    }
    for (const f of pads) shift += n(valueIn(va, p.id, f)) - n(valueIn(vb, p.id, f));
    const dirA = va.layout?.[p.id]?.direction ?? p.layout?.direction;
    const children = kids(p.id);
    if (dirA === along) {
      const gaps = Math.max(0, children.length - 1);
      shift += gaps * (n(valueIn(va, p.id, 'itemSpacing')) - n(valueIn(vb, p.id, 'itemSpacing')));
      for (const c of children) walk(c);
    }
  };
  const root = specA.parts.find((p) => !p.parent);
  if (!root || !specB.parts.length) return undefined;
  walk(root);
  return unknown ? undefined : round(shift);
}

function trySummary(component: string, gap: GapCase, diffs: TriedDifference[], regressions: number, verdict: FixVerdict, notFound: AppliedFix[], proposed: FigmaFix[]): string {
  if (!gap.variants.length) return `${component} has no differing variant in the gap case: nothing for these fixes to move (the values referee needs a Check fidelity report or a difference in the measure).`;
  const resolved = diffs.filter((d) => d.result === 'resolved').length;
  const closer = diffs.filter((d) => d.result === 'closer').length;
  const worse = diffs.filter((d) => d.result === 'worse').length;
  const bits = [`${resolved} of ${diffs.length} difference${diffs.length === 1 ? '' : 's'} resolved`, ...(closer ? [`${closer} closer`] : []), ...(worse ? [`${worse} worse`] : []), ...(regressions ? [`${regressions} new`] : [])];
  const word = verdict === 'closer' ? 'Closer to the code' : verdict === 'worse' ? 'Further from the code' : 'No closer to the code';
  const statusOnly = proposed.length > 0 && proposed.every((f) => f.kind === 'status' || (f.kind === 'axis' && f.action === 'map'));
  const missing = notFound.length ? ` ${notFound.map((a) => a.id).join(', ')} found nothing in the measure.` : '';
  const note = statusOnly && verdict === 'same' ? ' These fixes change how the set is named or labelled, not what it draws.' : '';
  return `${word} on the measured values: ${bits.join(', ')}.${missing}${note} The pixel check runs in the plugin after the next pull.`;
}

function tryDetail(variants: TriedVariant[], applied: AppliedFix[]): string {
  const fmt = (v: unknown) => (v === null ? 'none' : v === undefined ? 'unknown' : typeof v === 'string' ? v : JSON.stringify(v));
  const lines: string[] = [];
  for (const a of applied) lines.push(`${a.id}: ${a.result}${a.detail ? `, ${a.detail}` : ''}`);
  for (const v of variants) {
    lines.push(`- ${v.key}${v.story ? ` (story ${v.story})` : ''}: ${v.verdict}`);
    for (const d of v.differences) {
      const delta = d.deltaBefore !== undefined ? ` (${d.deltaBefore > 0 ? '+' : ''}${d.deltaBefore} px -> ${d.deltaAfter === undefined ? '?' : `${d.deltaAfter > 0 ? '+' : ''}${d.deltaAfter}`} px)` : '';
      lines.push(`  - ${d.part} ${d.property}: expected ${fmt(d.expected)}, was ${fmt(d.before)}, now ${fmt(d.after)}${delta}: ${d.result}${d.estimated ? ' (estimated from the layer boxes)' : ''}`);
    }
    for (const r of v.regressions) lines.push(`  - new: ${r.text}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// The change for review

/** Plain words for one fix, for the pull request body. */
export function fixWords(f: FigmaFix): string {
  if (f.kind === 'part') return describePartFix(f);
  if (f.kind === 'axis') return f.action === 'prune' ? 'drop variants' : f.action === 'ignore' ? `${f.arg} is not a Figma property` : `${f.arg} drawn as ${f.property ?? f.arg}`;
  if (f.kind === 'story') return `draw the variant from story ${f.use.story}`;
  return f.status ? `status ${f.status === 'differs' ? 'Differs' : "Can't check"}` : 'note';
}

/** A part fix that sizes, places or lays out a part: the values referee can't judge it, Check fidelity does. */
export function touchesLayout(f: FigmaFix): boolean {
  return f.kind === 'part' && (f.width !== undefined || f.height !== undefined || f.direction !== undefined || f.align !== undefined || f.overlay !== undefined);
}

/** The pull request body of a figma-fixes.json change: the gap, each fix with its reason, before and after. */
export function figmaFixesPrBody(input: { component: string; summary: string; gap: GapCase; tried: TryFixesResult; fixes: FigmaFix[]; tool: string }): string {
  const { tried } = input;
  const where = (f: FigmaFix) => {
    const w = f.where;
    if (!w) return '';
    const args = Object.entries(w.args ?? {}).map(([k, v]) => `${k}=${String(v)}`);
    if (w.state) args.push(`state ${w.state}`);
    return args.length ? ` (only ${args.join(', ')})` : '';
  };
  const lines = [
    `## ${input.component} in Figma, fixed with Claude`,
    '',
    input.summary.trim(),
    '',
    '### The gap',
    '',
    input.gap.summary,
    '',
    '### Fixes',
    '',
    ...input.fixes.map((f) => `- \`${f.id}\` (${f.kind}): ${fixWords(f)}${where(f)}. ${f.reason}`),
    '',
    '### Before and after (values referee)',
    '',
    tried.summary,
    '',
    ...tried.variants.flatMap((v) => [
      `- ${v.key}: ${v.verdict}`,
      ...v.differences.map((d) => `  - ${d.text}: ${d.result}${d.deltaBefore !== undefined ? ` (${d.deltaBefore} px, now ${d.deltaAfter ?? '?'} px${d.estimated ? ', estimated' : ''})` : ''}`),
      ...v.regressions.map((r) => `  - new difference: ${r.text}`),
    ]),
    '',
    ...(tried.verdict === 'same' && input.fixes.some(touchesLayout)
      ? ["These fixes size, place or lay out parts. The values referee can't judge layout, so it says same: Check fidelity decides.", '']
      : []),
    'The values referee compares the rebuilt set with what the code renders. The story shot is the final referee: pull this branch in the DS Bridge Figma plugin and run Check fidelity before approving. A fix stays only when the variant moved closer to its shot.',
    '',
    `Drafted by Claude through ${input.tool}. figma-fixes.json only: no component, token or plugin change.`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// The loop runner's prompt and reply (for a team API key; Claude Code uses the MCP tools instead)

export interface FixAttempt {
  fixes: unknown[];
  /** Validation problems, or the try's detail. */
  feedback: string;
  verdict?: FixVerdict | undefined;
}

/** The prompt for one round: the gap case, the schema, and what the earlier rounds gave. Asks for fix objects only. */
export function fixPrompt(gap: GapCase, attempts: FixAttempt[] = []): string {
  const parts = [
    `You fix how Bridge draws the ${gap.component} component in Figma so it matches its Storybook story. Bridge measured the story in a browser and drew the Figma set from that measure; some variants differ. Write corrections for figma-fixes.json.`,
    '',
    FIX_SCHEMA_SUMMARY,
    '',
    'The gap case (expected is the code, actual is Figma):',
    '',
    JSON.stringify({ component: gap.component, summary: gap.summary, detail: gap.detail, variants: gap.variants.map((v) => ({ key: v.key, story: v.story, differences: v.differences, unexplained: v.unexplained })), fixes: gap.fixes }, null, 1),
  ];
  for (const [i, a] of attempts.entries()) {
    parts.push('', `Round ${i + 1}: you proposed`, JSON.stringify(a.fixes), `Bridge said${a.verdict ? ` (${a.verdict})` : ''}:`, a.feedback);
  }
  parts.push(
    '',
    attempts.length
      ? 'Revise: keep what moved closer, change what did not. Use the same ids for fixes you revise.'
      : 'Propose the smallest set of fixes that explains the differences.',
    'Answer with a JSON array of fix objects only, no prose, "by": "claude" on each. If no fix can move it closer, answer one fix of kind "status" with "status": "differs" (or "cant-check") and the reason in a sentence.',
  );
  return parts.join('\n');
}

/** The fix objects in a reply: a JSON array (or { "fixes": [...] }), in a code fence or not. Throws a sentence otherwise. */
export function parseFixReply(text: string): unknown[] {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fence ? fence[1]! : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('The reply has no JSON: expected an array of fix objects.');
  const open = body[start]!;
  const end = body.lastIndexOf(open === '[' ? ']' : '}');
  let data: unknown;
  try {
    data = JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    throw new Error(`The reply is not valid JSON: ${(e as Error).message}`);
  }
  if (Array.isArray(data)) return data;
  if (isObj(data) && Array.isArray(data.fixes)) return data.fixes;
  if (isObj(data) && typeof data.kind === 'string') return [data];
  throw new Error('The reply is JSON but not a list of fix objects.');
}

/** A status fix for a component that did not converge: what the loop proposes after its last round. */
export function statusFixFor(gap: GapCase, existingIds: string[] = []): FigmaFix {
  let id = `${lc(gap.component) || 'component'}-differs`;
  for (let i = 2; existingIds.includes(id); i++) id = `${lc(gap.component)}-differs-${i}`;
  const reason = `${gap.summary.replace(/\u2014/g, ',').replace(/\.$/, '')}. Claude found no fix that brings it closer in ${FIX_LOOP_MAX_ROUNDS} rounds.`;
  return { id, kind: 'status', component: gap.component, status: 'differs', reason, by: 'claude' };
}
