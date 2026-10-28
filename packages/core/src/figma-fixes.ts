// Figma fixes: corrections a team keeps in its repo (figma-fixes.json, next to bridge.config.json and
// measured-specs.json) for the components the general measure does not draw right. Claude writes them from a gap case,
// a person reviews them like any change, and the story shot decides: a fix that does not bring the Figma render closer
// to the shot is not a fix. Every pull re-applies them to a fresh measure (applyFixes), so they survive pulls.
//
// Four kinds, each small and explicit:
//   part    a spec patch on one part (values, fixed / hug / fill, align, direction, overlay, hide)
//   axis    how a story arg becomes a Figma property (rename it and its values, ignore it, prune combinations)
//   story   which story a variant is drawn from
//   status  a note, or an honest status (Differs / Can't check) with its reason; never "matches"
//
// Pure and browser safe: the Figma plugin applies them to measured-specs.json before it builds, the CLI checks them.

import { COLOR_FIELDS, SPEC_FIELDS, type SpecField, type SpecLayout, type SpecPart, type SpecValue } from './component-spec';
import type { MeasuredArgType, MeasuredSpec, MeasuredSpecsComponent, MeasuredSpecsFile, MeasuredSpecsStory } from './measured-spec';
import { storyState, type GapState } from './gap-case';
import { boxSized } from './measured-only';

export const FIGMA_FIXES_VERSION = 1;
/** Where the fixes live in the team's repo when nothing else is said. */
export const DEFAULT_FIGMA_FIXES_FILE = 'figma-fixes.json';

export type FixArgValue = string | number | boolean;

/** Which variants a fix applies to: stories whose props (args over defaults, plus overrides) include `args`, in `state`. */
export interface FixWhere {
  args?: Record<string, FixArgValue> | undefined;
  state?: GapState | undefined;
}

interface FixBase {
  /** Stable and unique in the file: lower case, digits and dashes ("toggle-knob-radius"). Provenance names it. */
  id: string;
  /** The Figma set: the last segment of the stories' title ("Toggle"), case ignored. */
  component: string;
  /** Why, in plain words: read in review and shown where the fix applies. */
  reason: string;
  /** Who wrote it: "claude" or a GitHub login. */
  by?: string | undefined;
  /** Only these variants. Absent: every story of the component. */
  where?: FixWhere | undefined;
}

export type FixSize = 'hug' | 'fill' | 'fixed' | number;
export type FixPrimary = SpecLayout['primary'];
export type FixCounter = SpecLayout['counter'];
export type FixPin = { top?: number; right?: number; bottom?: number; left?: number };

/** (a) A spec patch on one part of the measured render. */
export interface PartFix extends FixBase {
  kind: 'part';
  /** Part id ("cds--toggle-switch", "root"), or a CSS class with a dot (".cds--toggle__switch"): every part with it. */
  part: string;
  /** Field values: a token path, a px number, null (no paint, colors only), or "full" for a corner radius (pill). */
  set?: Partial<Record<SpecField, SpecValue | 'full'>> | undefined;
  /** fixed: the measured size (or this number, px), hug: its content, fill: its container. */
  width?: FixSize | undefined;
  height?: FixSize | undefined;
  /** Auto layout of a frame part. */
  direction?: SpecLayout['direction'] | undefined;
  align?: { primary?: FixPrimary | undefined; counter?: FixCounter | undefined } | undefined;
  /** true: over its parent, filling it (out of auto layout). An object: pinned at these offsets (px). false: back in the flow. */
  overlay?: boolean | FixPin | undefined;
  /** Not drawn (with everything inside it). */
  hide?: boolean | undefined;
}

/** (b) How a story arg becomes a Figma property. */
export interface AxisFix extends FixBase {
  kind: 'axis';
  /**
   * map: name the property (`property`) and its values (`values`: code value -> Figma value).
   * ignore: the arg is not a property; only stories at its default value are drawn.
   * prune: drop the variants `where` names (a combination code allows that the library never shows).
   */
  action: 'map' | 'ignore' | 'prune';
  arg?: string | undefined;
  property?: string | undefined;
  values?: Record<string, string> | undefined;
}

/** (c) The story a variant is drawn from. */
export interface StoryFix extends FixBase {
  kind: 'story';
  /** The story to use, as measured: its id, and the args and state of the measured entry when there are several. */
  use: { story: string; args?: Record<string, FixArgValue> | undefined; state?: GapState | undefined };
}

/** (d) A note, or the status to show with its reason, when a variant will not converge. Never "matches". */
export interface StatusFix extends FixBase {
  kind: 'status';
  /** Absent: a note only. */
  status?: 'differs' | 'cant-check' | undefined;
}

export type FigmaFix = PartFix | AxisFix | StoryFix | StatusFix;

export interface FigmaFixesFile {
  $schema?: string | undefined;
  version: typeof FIGMA_FIXES_VERSION;
  fixes: FigmaFix[];
}

// ---------------------------------------------------------------------------------------------
// Validation

export class FigmaFixesError extends Error {
  constructor(public readonly problems: string[]) {
    super(`figma-fixes.json: ${problems.join('; ')}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const STATES: readonly GapState[] = ['rest', 'hover', 'active', 'focus-visible', 'disabled'];
const KINDS = ['part', 'axis', 'story', 'status'] as const;
const BASE_KEYS = ['id', 'component', 'reason', 'by', 'where', 'kind'];
const KEYS: Record<(typeof KINDS)[number], string[]> = {
  part: ['part', 'set', 'width', 'height', 'direction', 'align', 'overlay', 'hide'],
  axis: ['action', 'arg', 'property', 'values'],
  story: ['use'],
  status: ['status'],
};
const PRIMARY = ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'];
const COUNTER = ['MIN', 'CENTER', 'MAX', 'STRETCH'];
const plain = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function whereProblems(w: unknown, at: (why: string) => void) {
  if (!isObj(w)) return at('where must be an object with args and/or state');
  for (const k of Object.keys(w)) if (k !== 'args' && k !== 'state') at(`where.${k} is not known (args, state)`);
  if (w.args !== undefined && (!isObj(w.args) || !Object.values(w.args).every(plain))) at('where.args maps arg names to a text, number or true/false');
  if (w.state !== undefined && !STATES.includes(w.state as GapState)) at(`where.state is one of ${STATES.join(', ')}`);
}

/**
 * Every problem in a fixes file, in plain words (empty when it is valid): version, unique ids, a component and a reason
 * on every fix, known kinds and keys, and each kind's fields.
 */
export function validateFigmaFixes(data: unknown): string[] {
  const out: string[] = [];
  if (!isObj(data)) return ['expected an object with version and fixes'];
  if (data.version !== FIGMA_FIXES_VERSION) out.push(`version ${String(data.version)} is not supported (expected ${FIGMA_FIXES_VERSION})`);
  for (const k of Object.keys(data)) if (!['$schema', 'version', 'fixes'].includes(k)) out.push(`${k} is not known (version, fixes)`);
  if (!Array.isArray(data.fixes)) return [...out, 'fixes must be a list'];
  const ids = new Set<string>();
  data.fixes.forEach((f, i) => {
    const label = isObj(f) && typeof f.id === 'string' ? `fix ${f.id}` : `fix ${i + 1}`;
    const at = (why: string) => out.push(`${label}: ${why}`);
    if (!isObj(f)) return at('must be an object');
    if (typeof f.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(f.id)) at('id must be lower case letters, digits and dashes');
    else if (ids.has(f.id)) at('id is repeated');
    else ids.add(f.id);
    if (typeof f.component !== 'string' || !f.component.trim()) at('component is missing (the Figma set name, like "Toggle")');
    if (typeof f.reason !== 'string' || f.reason.trim().length < 8) at('reason is missing: say why, in a sentence');
    else if (/\u2014/.test(f.reason)) at('reason uses an em dash: use a colon or a comma');
    if (f.by !== undefined && typeof f.by !== 'string') at('by must be a text');
    if (f.where !== undefined) whereProblems(f.where, at);
    if (!KINDS.includes(f.kind as (typeof KINDS)[number])) return at(`kind must be one of ${KINDS.join(', ')}`);
    const kind = f.kind as (typeof KINDS)[number];
    for (const k of Object.keys(f)) if (!BASE_KEYS.includes(k) && !KEYS[kind].includes(k)) at(`${k} is not a key of a ${kind} fix`);
    if (kind === 'part') partProblems(f, at);
    if (kind === 'axis') axisProblems(f, at);
    if (kind === 'story') {
      const u = f.use;
      if (!isObj(u) || typeof u.story !== 'string' || !u.story) at('use.story is the story id to draw the variant from');
      else {
        for (const k of Object.keys(u)) if (!['story', 'args', 'state'].includes(k)) at(`use.${k} is not known (story, args, state)`);
        if (u.args !== undefined && (!isObj(u.args) || !Object.values(u.args).every(plain))) at('use.args maps arg names to a text, number or true/false');
        if (u.state !== undefined && !STATES.includes(u.state as GapState)) at(`use.state is one of ${STATES.join(', ')}`);
      }
      if (!isObj(f.where) || (!f.where.args && !f.where.state)) at('where names the variant (args and/or state) the story is for');
    }
    if (kind === 'status') {
      if (f.status === 'matches') at('status cannot be "matches": only the shot comparison says a component matches');
      else if (f.status !== undefined && f.status !== 'differs' && f.status !== 'cant-check') at('status is differs or cant-check (absent: a note)');
    }
  });
  return out;
}

function partProblems(f: Record<string, unknown>, at: (why: string) => void) {
  if (typeof f.part !== 'string' || !f.part.trim()) at('part is a part id or a .class');
  const changes = ['set', 'width', 'height', 'direction', 'align', 'overlay', 'hide'].filter((k) => f[k] !== undefined);
  if (!changes.length) at('changes nothing: give set, width, height, direction, align, overlay or hide');
  if (f.hide !== undefined && typeof f.hide !== 'boolean') at('hide is true or false');
  if (f.hide === true && changes.length > 1) at('hide goes alone: a hidden part has nothing else to change');
  if (f.set !== undefined) {
    if (!isObj(f.set) || !Object.keys(f.set).length) at('set maps fields to values');
    else
      for (const [field, value] of Object.entries(f.set)) {
        if (!SPEC_FIELDS.includes(field as SpecField)) {
          at(`set.${field} is not a field (${SPEC_FIELDS.join(', ')})`);
          continue;
        }
        const color = COLOR_FIELDS.has(field as SpecField);
        if (value === 'full') {
          if (field !== 'cornerRadius') at(`set.${field}: "full" is for cornerRadius only`);
        } else if (value === null) {
          if (!color) at(`set.${field} cannot be none (only colors can)`);
        } else if (typeof value === 'number') {
          if (color) at(`set.${field} is a color: a token path or null, not a number`);
          else if (!Number.isFinite(value)) at(`set.${field} must be a finite number`);
        } else if (typeof value !== 'string' || !value.trim()) at(`set.${field} must be a token path, a number or null`);
        else if (field === 'textDecoration' && !/^(UNDERLINE|STRIKETHROUGH|NONE)$/.test(value)) at(`set.textDecoration is UNDERLINE, STRIKETHROUGH or NONE`);
      }
  }
  for (const side of ['width', 'height'] as const) {
    const v = f[side];
    if (v !== undefined && !['hug', 'fill', 'fixed'].includes(v as string) && !(typeof v === 'number' && v > 0)) at(`${side} is hug, fill, fixed or a size in px`);
  }
  if (f.direction !== undefined && f.direction !== 'HORIZONTAL' && f.direction !== 'VERTICAL') at('direction is HORIZONTAL or VERTICAL');
  if (f.align !== undefined) {
    const a = f.align;
    if (!isObj(a) || (a.primary === undefined && a.counter === undefined)) at('align gives primary and/or counter');
    else {
      if (a.primary !== undefined && !PRIMARY.includes(a.primary as string)) at(`align.primary is ${PRIMARY.join(', ')}`);
      if (a.counter !== undefined && !COUNTER.includes(a.counter as string)) at(`align.counter is ${COUNTER.join(', ')}`);
    }
  }
  if (f.overlay !== undefined && typeof f.overlay !== 'boolean') {
    const o = f.overlay;
    if (!isObj(o) || !Object.keys(o).length || !Object.entries(o).every(([k, v]) => ['top', 'right', 'bottom', 'left'].includes(k) && typeof v === 'number')) at('overlay is true, false, or offsets in px ({ "top": 3, "left": 3 })');
  }
  if (f.part === 'root' && (f.hide === true || f.overlay !== undefined)) at('the root cannot be hidden or overlaid');
}

function axisProblems(f: Record<string, unknown>, at: (why: string) => void) {
  const action = f.action;
  if (action !== 'map' && action !== 'ignore' && action !== 'prune') return at('action is map, ignore or prune');
  if (action !== 'prune' && (typeof f.arg !== 'string' || !f.arg)) at(`${action} needs arg (the story arg, like "kind")`);
  if (action === 'map') {
    if (f.property === undefined && f.values === undefined) at('map gives property (the Figma name) and/or values');
    if (f.property !== undefined && (typeof f.property !== 'string' || !f.property.trim())) at('property is the Figma property name');
    if (f.values !== undefined && (!isObj(f.values) || !Object.values(f.values).every((v) => typeof v === 'string' && v.trim()))) at('values maps code values to Figma values (texts)');
    else if (isObj(f.values)) {
      const figma = Object.values(f.values) as string[];
      if (new Set(figma).size !== figma.length) at('values gives two code values the same Figma value: use prune for the one to drop');
    }
  }
  if (action === 'ignore' && (f.property !== undefined || f.values !== undefined)) at('ignore takes no property or values');
  if (action === 'prune') {
    if (!isObj(f.where) || (!f.where.args && !f.where.state)) at('prune needs where (the args and/or state of the variants to drop)');
    if (f.property !== undefined || f.values !== undefined) at('prune takes no property or values');
  }
}

/** Reads figma-fixes.json (text or parsed JSON); throws FigmaFixesError with every problem. */
export function parseFigmaFixes(input: string | unknown): FigmaFixesFile {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new FigmaFixesError([`not JSON: ${(e as Error).message}`]);
    }
  }
  const problems = validateFigmaFixes(data);
  if (problems.length) throw new FigmaFixesError(problems);
  return data as FigmaFixesFile;
}

// ---------------------------------------------------------------------------------------------
// Applying

/** What applyFixes writes on a component entry for the pull: Figma names, dropped args and combinations, status. */
export interface FigmaHints {
  /** Arg -> Figma property name. */
  properties?: Record<string, string> | undefined;
  /** Arg -> code value -> Figma value. */
  values?: Record<string, Record<string, string>> | undefined;
  /** Args that are not Figma properties. */
  ignored?: string[] | undefined;
  /** Variant combinations dropped. */
  pruned?: FixWhere[] | undefined;
  /** Status to show for the component, or for some variants (`where`), with the reason. */
  status?: { status: 'differs' | 'cant-check'; reason: string; fix: string; where?: FixWhere | undefined }[] | undefined;
  notes?: { text: string; fix: string; where?: FixWhere | undefined }[] | undefined;
  /** Ids of the fixes applied to this component, in file order. */
  fixes?: string[] | undefined;
}

export type FixedComponent = MeasuredSpecsComponent & { figma?: FigmaHints | undefined };
/** A measured story a fix changed: the ids of those fixes. */
export type FixedStory = MeasuredSpecsStory & { fixes?: string[] | undefined };

export interface AppliedFix {
  id: string;
  kind: FigmaFix['kind'];
  component: string;
  /**
   * applied: it changed what the pull draws. not-found: nothing matched (the code or the measure moved: re-check it).
   * skipped: it matched, but the measure has no size of the part's own to pin there (the detail says why). already:
   * the input had it.
   */
  result: 'applied' | 'not-found' | 'skipped' | 'already';
  /** Story entries it changed. */
  stories: number;
  /** Plain words: what it did, or what it did not find. */
  detail: string;
}

/** The pull's input with the fixes laid on, and where they came from. */
export type FixedMeasuredSpecsFile = Omit<MeasuredSpecsFile, 'stories' | 'components'> & {
  stories: FixedStory[];
  components?: FixedComponent[] | undefined;
  /** The fixes run that made this file. */
  figmaFixes?: { applied: AppliedFix[] } | undefined;
};

const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const setNameOf = (title: string) => title.split('/').at(-1)!.trim();
const propsOf = (s: MeasuredSpecsStory) => ({ ...(s.props ?? {}), ...(s.overrides ?? {}) }) as Record<string, FixArgValue>;
const sameArg = (a: unknown, b: unknown) => a === b || (a !== undefined && b !== undefined && String(a).toLowerCase() === String(b).toLowerCase());

/** A story is one of `where`'s variants: every arg it names, at that value, and the state. */
export function storyMatchesWhere(s: MeasuredSpecsStory, where: FixWhere | undefined): boolean {
  if (!where) return true;
  const p = propsOf(s);
  if (where.args && !Object.entries(where.args).every(([k, v]) => sameArg(p[k], v))) return false;
  if (where.state && storyState(s) !== where.state) return false;
  return true;
}

/** Parts a part fix names: an id, or every part with a class. */
function partsNamed(spec: MeasuredSpec, sel: string): SpecPart[] {
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return spec.parts.filter((p) => (p.source ?? '').split(/[\s,]+/).map((x) => x.replace(/^\./, '')).includes(cls));
  }
  return spec.parts.filter((p) => p.id === sel);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Why a `fixed` size was not laid on one part of one story: the measure has no size of the part's own there. */
export interface SkippedSize {
  part: string;
  side: 'width' | 'height';
  why: 'words' | 'fills' | 'unmeasured';
  /** The measured px it did not pin (words, fills). */
  measured?: number | undefined;
}

/** The part has text, at any depth: what a hugging width is made of. */
function wordsIn(spec: MeasuredSpec, id: string): boolean {
  const kids = spec.parts.filter((p) => p.parent === id);
  return kids.some((k) => (k.kind === 'text' && !!k.characters?.trim()) || wordsIn(spec, k.id));
}

/**
 * The size `fixed` pins a part to in one story, read from that story's own render, or why there is none. Skipped:
 * a root that fills its container's width (the measured px are the container's), and a width that only hugs its text
 * (no CSS width, the box no wider than its content plus padding): that width is the story's words, and the Figma
 * variant draws its own label, so every variant would get the story's width (a small "Publish tokens" button is
 * 120.84 px; the set's small button is 72). Skipped sizes are reported, never borrowed from another story.
 */
function ownSize(spec: MeasuredSpec, part: SpecPart, side: 'width' | 'height'): number | SkippedSize {
  const id = part.id;
  const box = spec.boxes[id];
  const value = spec.values[id]?.[side];
  const measured = typeof value === 'number' ? value : box?.[side];
  const skip = (why: SkippedSize['why']): SkippedSize => ({ part: id, side, why, ...(measured !== undefined && why !== 'unmeasured' ? { measured } : {}) });
  if (!part.parent && side === 'width' && part.fill) return skip('fills');
  const css = spec.sized?.[id]?.[side];
  if (typeof css === 'number') return css;
  if (side === 'width' && box && wordsIn(spec, id) && boxSized(spec, id, { width: true, height: true }).width === undefined) return skip('words');
  return measured ?? skip('unmeasured');
}

/** One part fix on one measured spec: whether a part matched, and the sizes it could not pin. */
function patchSpec(spec: MeasuredSpec, fix: PartFix): { hit: boolean; skipped: SkippedSize[] } {
  const skipped: SkippedSize[] = [];
  const targets = partsNamed(spec, fix.part);
  if (!targets.length) return { hit: false, skipped };
  let laid = false;
  for (const part of targets) {
    const id = part.id;
    const box = spec.boxes[id];
    const parent = part.parent ? spec.parts.find((p) => p.id === part.parent) : undefined;
    if (fix.hide) {
      const gone = new Set([id]);
      for (const p of spec.parts) if (p.parent && gone.has(p.parent)) gone.add(p.id);
      spec.parts = spec.parts.filter((p) => !gone.has(p.id));
      for (const map of [spec.values, spec.raw, spec.tokens, spec.boxes, spec.sized ?? {}, spec.spacers ?? {}, spec.vectors ?? {}] as Record<string, unknown>[]) for (const g of gone) delete map[g];
      laid = true;
      continue;
    }
    const values = (spec.values[id] ??= {});
    for (const [field, value] of Object.entries(fix.set ?? {}) as [SpecField, SpecValue | 'full'][]) {
      values[field] = value === 'full' ? (box ? Math.min(box.width, box.height) / 2 : 9999) : value;
      laid = true;
    }
    for (const side of ['width', 'height'] as const) {
      const how = fix[side];
      if (how === undefined) continue;
      const flowsAlong = parent?.layout?.direction === (side === 'width' ? 'HORIZONTAL' : 'VERTICAL');
      // fixed: the size this story's own render gives the part, or why it has none.
      const px = how === 'fixed' ? ownSize(spec, part, side) : how;
      if (typeof px === 'object') {
        skipped.push(px);
        continue;
      }
      laid = true;
      if (px === 'hug') {
        delete values[side];
        if (spec.sized?.[id]) delete spec.sized[id]![side];
        if (part.stretch) delete part.stretch[side];
        if (flowsAlong) delete part.grow;
        if (!part.parent && side === 'width') delete part.fill;
      } else if (px === 'fill') {
        if (spec.sized?.[id]) delete spec.sized[id]![side];
        if (!part.parent) {
          if (side === 'width') part.fill = true;
        } else if (flowsAlong) part.grow = true;
        else part.stretch = { ...(part.stretch ?? {}), [side]: true };
      } else {
        values[side] = px;
        spec.sized = { ...(spec.sized ?? {}), [id]: { ...(spec.sized?.[id] ?? {}), [side]: px } };
        if (part.stretch) delete part.stretch[side];
        if (flowsAlong) delete part.grow;
        if (!part.parent && side === 'width') delete part.fill;
      }
    }
    if (fix.direction || fix.align) {
      laid = true;
      part.layout = { direction: 'HORIZONTAL', primary: 'MIN', counter: 'MIN', ...(part.layout ?? {}) };
      if (fix.direction) part.layout.direction = fix.direction;
      if (fix.align?.primary) part.layout.primary = fix.align.primary;
      if (fix.align?.counter) part.layout.counter = fix.align.counter;
    }
    if (fix.overlay !== undefined) {
      laid = true;
      delete part.cover;
      delete part.pin;
      if (fix.overlay === true) part.cover = true;
      else if (fix.overlay !== false) part.pin = { ...fix.overlay };
    }
  }
  return { hit: laid, skipped };
}

/**
 * The measured specs the pull reads, with the fixes laid on, and one provenance record per fix. Pure: the input is not
 * changed. Fixes run in file order; a fix whose component, part or story is not in this measure is reported
 * `not-found` (the code or the measure moved: re-check it) and changes nothing. A file that already carries a fix run
 * (`figmaFixes`) keeps those fixes and only runs the new ones.
 */
export function applyFixes(measured: MeasuredSpecsFile | FixedMeasuredSpecsFile, fixes: FigmaFixesFile | FigmaFix[]): { file: FixedMeasuredSpecsFile; applied: AppliedFix[] } {
  const list = Array.isArray(fixes) ? fixes : fixes.fixes;
  const file = clone(measured) as FixedMeasuredSpecsFile;
  const before = new Set((file.figmaFixes?.applied ?? []).filter((a) => a.result === 'applied').map((a) => a.id));
  const applied: AppliedFix[] = [];
  const entryOf = (component: string): FixedComponent | undefined => (file.components ?? []).find((c) => lc(setNameOf(c.title)) === lc(component));
  const hints = (component: string): FigmaHints | undefined => {
    const c = entryOf(component);
    return c ? (c.figma ??= {}) : undefined;
  };
  const mark = (s: FixedStory, id: string) => {
    s.fixes = [...new Set([...(s.fixes ?? []), id])];
  };

  for (const fix of list) {
    const record = (result: AppliedFix['result'], stories: number, detail: string) => applied.push({ id: fix.id, kind: fix.kind, component: fix.component, result, stories, detail });
    if (before.has(fix.id)) {
      record('already', 0, 'already applied to this file');
      continue;
    }
    const mine = () => file.stories.filter((s) => lc(setNameOf(s.title)) === lc(fix.component));
    if (!mine().length) {
      record('not-found', 0, `no measured story of ${fix.component}`);
      continue;
    }
    const scoped = () => mine().filter((s) => storyMatchesWhere(s, fix.where));

    if (fix.kind === 'part') {
      let n = 0;
      let matched = false;
      const unpinned: { story: FixedStory; skip: SkippedSize }[] = [];
      for (const s of scoped()) {
        let hit = false;
        for (const spec of [s.spec, ...(s.instances ?? [])]) {
          if (!spec) continue;
          const r = patchSpec(spec, fix);
          if (r.hit) hit = true;
          if (r.hit || r.skipped.length) matched = true;
          for (const skip of r.skipped) unpinned.push({ story: s, skip });
        }
        if (hit) {
          n++;
          mark(s, fix.id);
        }
      }
      const skippedWords = unpinned.length ? skippedSizeWords(unpinned) : '';
      if (n) record('applied', n, `${describePartFix(fix)} on ${n} stor${n === 1 ? 'y' : 'ies'}${skippedWords ? `; ${skippedWords}` : ''}`);
      else if (matched) record('skipped', 0, `nothing laid on: ${skippedWords}`);
      else record('not-found', 0, `no part ${fix.part} in the ${scoped().length ? 'stories it names' : 'variants where names'}`);
    } else if (fix.kind === 'axis') {
      const h = hints(fix.component);
      if (fix.action === 'prune') {
        const drop = new Set(scoped());
        if (!drop.size) {
          record('not-found', 0, 'no measured variant matches where');
          continue;
        }
        file.stories = file.stories.filter((s) => !drop.has(s));
        if (h) h.pruned = [...(h.pruned ?? []), fix.where!];
        record('applied', drop.size, `dropped ${drop.size} variant stor${drop.size === 1 ? 'y' : 'ies'}`);
      } else {
        const arg = fix.arg!;
        const entry = entryOf(fix.component);
        const known = !!entry?.argTypes[arg] || mine().some((s) => arg in propsOf(s));
        if (!known) {
          record('not-found', 0, `${fix.component} has no arg ${arg}`);
          continue;
        }
        if (fix.action === 'map') {
          if (h) {
            if (fix.property) h.properties = { ...(h.properties ?? {}), [arg]: fix.property };
            if (fix.values) h.values = { ...(h.values ?? {}), [arg]: { ...(h.values?.[arg] ?? {}), ...fix.values } };
          }
          record('applied', 0, `${arg} drawn as ${fix.property ?? arg}${fix.values ? ` (${Object.entries(fix.values).map(([c, f]) => `${c} as ${f}`).join(', ')})` : ''}`);
        } else {
          // Not a property: only stories at its default (the argType's, else the first story's, else false) are drawn.
          const at: MeasuredArgType | undefined = entry?.argTypes[arg];
          const lead = mine().find((s) => !s.overrides || !(arg in s.overrides));
          const baseline = at?.default ?? (lead ? propsOf(lead)[arg] : undefined) ?? (at?.kind === 'boolean' ? false : undefined);
          const drop = new Set(scoped().filter((s) => baseline !== undefined && propsOf(s)[arg] !== undefined && !sameArg(propsOf(s)[arg], baseline)));
          file.stories = file.stories.filter((s) => !drop.has(s));
          if (entry) {
            delete entry.argTypes[arg];
            entry.figma ??= {};
            entry.figma.ignored = [...new Set([...(entry.figma.ignored ?? []), arg])];
          }
          record('applied', drop.size, `${arg} is not a Figma property${drop.size ? `: ${drop.size} stor${drop.size === 1 ? 'y' : 'ies'} at another value left out` : ''}`);
        }
      }
    } else if (fix.kind === 'story') {
      const src = file.stories.find(
        (s) => s.id === fix.use.story && s.spec && !s.error && (!fix.use.args || Object.entries(fix.use.args).every(([k, v]) => sameArg(propsOf(s)[k], v))) && (!fix.use.state || storyState(s) === fix.use.state),
      );
      if (!src) {
        record('not-found', 0, `no measured render of story ${fix.use.story}${fix.use.args ? ` with ${JSON.stringify(fix.use.args)}` : ''}`);
        continue;
      }
      const target = fix.where ?? {};
      const others = new Set(scoped().filter((s) => s !== src));
      // The chosen render stands for the variant: its args and state are the variant's, its picture the story's.
      const copy = clone(src) as FixedStory;
      const overrides: Record<string, FixArgValue> = { ...(copy.overrides ?? {}), ...(target.args ?? {}) };
      if (target.state === 'disabled') overrides.disabled = true;
      copy.overrides = overrides;
      if (target.state && target.state !== 'rest' && target.state !== 'disabled') copy.state = target.state;
      else if (target.state) delete copy.state;
      // A story of another component (a richer demo) is drawn in this set.
      if (lc(setNameOf(copy.title)) !== lc(fix.component)) copy.title = copy.title.split('/').slice(0, -1).concat(fix.component).join('/');
      mark(copy, fix.id);
      // In place of the first story it replaces, so the pull meets it where it met them.
      let placed = false;
      file.stories = file.stories.flatMap((s) => (others.has(s) ? (placed ? [] : ((placed = true), [copy])) : [s]));
      if (!placed) file.stories.push(copy);
      record('applied', others.size + 1, `variant ${whereWords(target)} drawn from ${src.id}${others.size ? `, in place of ${others.size} other stor${others.size === 1 ? 'y' : 'ies'}` : ''}`);
    } else {
      const h = hints(fix.component);
      if (!h) {
        record('not-found', 0, `no component entry for ${fix.component} in the measure`);
        continue;
      }
      if (fix.status) {
        h.status = [...(h.status ?? []), { status: fix.status, reason: fix.reason, fix: fix.id, ...(fix.where ? { where: fix.where } : {}) }];
        if (!fix.where) {
          const st = (file.statuses ?? []).find((x) => lc(x.name) === lc(fix.component));
          if (st && st.status !== fix.status) {
            st.status = fix.status;
            delete st.reason;
            st.summary = fix.reason;
          }
        }
      } else h.notes = [...(h.notes ?? []), { text: fix.reason, fix: fix.id, ...(fix.where ? { where: fix.where } : {}) }];
      record('applied', 0, fix.status ? `${fix.status === 'differs' ? 'Differs' : "Can't check"}: ${fix.reason}` : `note: ${fix.reason}`);
    }
    const h = hints(fix.component);
    if (h && applied.at(-1)!.result === 'applied') h.fixes = [...new Set([...(h.fixes ?? []), fix.id])];
  }
  file.figmaFixes = { applied: [...(file.figmaFixes?.applied ?? []).filter((a) => a.result === 'applied'), ...applied.filter((a) => a.result !== 'already')] };
  return { file, applied };
}

const variantWords = (s: MeasuredSpecsStory) => {
  const p = propsOf(s);
  const args = Object.keys(s.overrides ?? {}).filter((k) => k !== 'disabled').map((k) => `${k}=${String(p[k])}`);
  const state = storyState(s);
  return `${s.id}${args.length || state !== 'rest' ? ` (${[...args, ...(state !== 'rest' ? [state] : [])].join(', ')})` : ''}`;
};

/** The sizes a `fixed` did not pin, grouped by reason, with the stories: "width not fixed on 4 stories, ...". */
function skippedSizeWords(list: { story: MeasuredSpecsStory; skip: SkippedSize }[]): string {
  const why: Record<SkippedSize['why'], string> = {
    words: 'it hugs its text in code, so the measured px is that story\'s words, not a width of its own',
    fills: 'it fills its container in code, so the measured px is the container\'s',
    unmeasured: 'the measure has no size for it in that story',
  };
  const groups = new Map<string, { story: MeasuredSpecsStory; skip: SkippedSize }[]>();
  for (const x of list) {
    const k = `${x.skip.part}|${x.skip.side}|${x.skip.why}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  return [...groups.values()]
    .map((g) => {
      const { part, side, why: w } = g[0]!.skip;
      const stories = [...new Set(g.map((x) => `${variantWords(x.story)}${x.skip.measured !== undefined ? ` ${Math.round(x.skip.measured * 100) / 100} px` : ''}`))];
      return `${part} ${side} not fixed on ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} (${why[w]}):${stories.join(', ')}`;
    })
    .join('; ');
}

function whereWords(w: FixWhere): string {
  const args = Object.entries(w.args ?? {}).map(([k, v]) => `${k}=${String(v)}`);
  if (w.state) args.push(`state=${w.state}`);
  return args.join(', ') || 'every variant';
}

/** A part fix in a few words, for provenance and review: "toggle switch: cornerRadius full, width fixed". */
export function describePartFix(f: PartFix): string {
  if (f.hide) return `${f.part} hidden`;
  const bits = [
    ...Object.entries(f.set ?? {}).map(([k, v]) => `${k} ${v === null ? 'none' : String(v)}`),
    ...(f.width !== undefined ? [`width ${String(f.width)}`] : []),
    ...(f.height !== undefined ? [`height ${String(f.height)}`] : []),
    ...(f.direction ? [`direction ${f.direction}`] : []),
    ...(f.align ? [`align ${[f.align.primary, f.align.counter].filter(Boolean).join(' ')}`] : []),
    ...(f.overlay !== undefined ? [`overlay ${typeof f.overlay === 'boolean' ? String(f.overlay) : JSON.stringify(f.overlay)}`] : []),
  ];
  return `${f.part}: ${bits.join(', ')}`;
}

/** One line per fix result, for the CLI and the plugin's pull report. */
export function appliedFixLines(applied: AppliedFix[]): string[] {
  return applied.map((a) => `${a.result === 'applied' ? 'applied' : a.result === 'already' ? 'already applied' : a.result === 'skipped' ? 'skipped' : 'not found'}  ${a.id} (${a.component}, ${a.kind}): ${a.detail}`);
}
