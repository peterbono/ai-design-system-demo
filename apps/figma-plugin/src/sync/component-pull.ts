// Pull components: the coded components (component-specs.json on the base branch, generated from the TSX and CSS
// modules) become Figma component sets bound to the variables a pull writes. This file plans it; the main thread
// (src/main/build-components.ts) builds it. Pure: no DOM, no figma.*.
//
// Product rules (plugin README, "Pull components"):
// - Preview first: nothing is written before Apply. Every part that cannot be bound is listed with its reason.
// - Idempotent: a set is found again by shared plugin data (dsbridge / componentId), updated in place, never duplicated.
//   Variants removed in code are flagged "[orphan]", never deleted; layers outside generated sets are never touched.
// - After building, the set's signature is stored as its baseline, so a fresh pull never shows a request in Push.

import {
  type BridgeConfig,
  COLOR_FIELDS,
  type ComponentSpec,
  type ComponentSpecsFile,
  DEFAULT_COMPONENT_SPECS_FILE,
  type GitHubClient,
  type MotionReaction,
  type SpecAxis,
  type SpecCoverage,
  type SpecField,
  type SpecPart,
  type SpecProperty,
  type SpecLayout,
  type SpecSlot,
  type SpecValue,
  type TokenSet,
  type FigmaPushStatus,
  componentMotion,
  defaultContext,
  parseColor,
  parseComponentSpecs,
  iconComponentName,
  parseDimension,
  resolve,
  hashSpec,
  specHash,
  variantKeyOf,
  variantName,
} from '@bridge-ds/core';
import { COLLECTIONS, type FigmaResolvedType } from '../shared/messages';
import { isUnmappable, pathToName, tokenToPlanned } from './mapping';
import { checkComponentSpecs } from './spec-check';

/** A component set Bridge generated, as the main thread finds it (shared plugin data). */
export interface GeneratedSet {
  componentId: string;
  nodeId: string;
  name: string;
  page?: string | undefined;
  specHash: string;
  /** Variant keys (variantKeyOf) of the generated variants, orphans excluded. */
  variants: string[];
  /** The library branch this set was pushed to from Figma (shared plugin data dsbridge / pushed), until a pull rebuilds it. */
  pushed?: PushedMark | undefined;
  /** Figma holds the set in error (left by an older Bridge): the pull rebuilds it even when its spec did not change. */
  inError?: boolean | undefined;
}

/** Where a set's change from Figma went: its library branch (a token change or a branch a developer builds with Claude). */
export interface PushedMark {
  number: number;
  url: string;
  route: 'token-change' | 'claude-draft';
  at?: string | undefined;
}

/** Reads the pushed mark stored on a set; undefined when it is not one. */
export function parsePushedMark(text: string | null | undefined): PushedMark | undefined {
  if (!text) return undefined;
  try {
    const m = JSON.parse(text) as PushedMark;
    return typeof m.number === 'number' && typeof m.url === 'string' ? m : undefined;
  } catch {
    return undefined;
  }
}

/** What a Figma field gets: a variable binding, a literal, a percent (unitless line height, em tracking), no paint, or a font. */
export type PlannedValue =
  | {
      kind: 'variable';
      path: string;
      tokenId: string;
      /** Figma variable name ("button/primary/bg"). */
      name: string;
      /** Collection of the token's tier ("Semantic"); the split layout ("Semantic/Light") is found from it. */
      collection: string;
      resolvedType: FigmaResolvedType;
      /** Value in the default modes, for the font style choice (font weight) and the preview. */
      value?: number | string | undefined;
    }
  | { kind: 'number'; value: number; /** A calc() of tokens, resolved: set, not bound. */ expr?: string | undefined }
  | { kind: 'percent'; value: number; path: string }
  | { kind: 'none' }
  | {
      kind: 'font';
      families: string[];
      path: string;
      /** The token's Figma variable: the text's family is bound to it, so it follows the Brand mode like colors do. */
      variable?: { tokenId: string; name: string; collection: string } | undefined;
    }
  | { kind: 'keyword'; value: string };

export interface PlannedField {
  field: SpecField;
  value: PlannedValue;
}

/**
 * Figma name of the one variant of a spec with no axes. A set needs a variant property on every variant (an unnamed
 * one leaves the set in error and every read of it throws), so it gets this one; reading the set drops it again.
 */
export const LONE_VARIANT = 'Variant=Default';

/** Props of a variant key ("Size=md, State=Hover", "Default" for none). */
export function propsOfKey(key: string): Record<string, string> {
  if (!key || key === variantKeyOf({})) return {};
  const out: Record<string, string> = {};
  for (const pair of key.split(', ')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

/** Marks an orphan's value when its name would be taken ("md (removed)", "md (removed 2)"). */
const REMOVED_MARK = '(removed)';
/** A value only an orphan has because of its "(removed)" mark: not one of the set's values for a review or a Push. */
export const isRemovedValue = (value: string) => / \(removed( \d+)?\)$/.test(value);

export interface VariantMatch {
  /** Planned variant key -> id of the Figma variant that becomes it (same node: its instances and overrides follow). */
  reuse: Map<string, string>;
  /** Variants the code no longer has, with a name that fits the set's axes now (a set refuses mixed shapes). */
  orphans: { id: string; name: string }[];
}

/**
 * Which Figma variant becomes which planned one when a set is updated. The same key first. Then, when the code adds or
 * removes an axis, a variant whose values match once the new axis takes its default (and the removed one is dropped)
 * becomes that variant: "State=Hover" is "Size=md, State=Hover" after Size is added with md as default. What is left is
 * removed in code: kept as an orphan, renamed to the set's axes (a new axis at its default, a removed one dropped),
 * with "(removed)" on its first value when that name is taken. Figma refuses a set whose variants do not all have
 * the same properties, or two variants with the same values.
 */
export function matchVariants(existing: readonly { id: string; key: string }[], planned: readonly { key: string; props: Record<string, string> }[], axes: readonly SpecAxis[]): VariantMatch {
  const reuse = new Map<string, string>();
  const claimed = new Set<string>();
  const byKey = new Map<string, string>();
  for (const e of existing) if (!byKey.has(e.key)) byKey.set(e.key, e.id);
  for (const pv of planned) {
    const id = byKey.get(pv.key);
    if (id && !claimed.has(id)) {
      reuse.set(pv.key, id);
      claimed.add(id);
    }
  }
  const project = (props: Record<string, string>) => Object.fromEntries(axes.map((a) => [a.name, props[a.name] ?? a.default ?? a.values[0] ?? '']));
  for (const pv of planned) {
    if (reuse.has(pv.key)) continue;
    const from = existing.find((e) => !claimed.has(e.id) && variantKeyOf(project(propsOfKey(e.key))) === pv.key);
    if (from) {
      reuse.set(pv.key, from.id);
      claimed.add(from.id);
    }
  }
  const lone = !axes.length;
  const nameOf = (props: Record<string, string>) => (lone ? LONE_VARIANT : axes.map((a) => `${a.name}=${props[a.name]}`).join(', '));
  const taken = new Set(planned.map((pv) => nameOf(pv.props)));
  const orphans: VariantMatch['orphans'] = [];
  for (const e of existing) {
    if (claimed.has(e.id)) continue;
    const props = project(propsOfKey(e.key));
    let name = nameOf(props);
    for (let n = 1; taken.has(name); n++) {
      const mark = n === 1 ? ` ${REMOVED_MARK}` : ` (removed ${n})`;
      name = lone ? `${LONE_VARIANT}${mark}` : nameOf({ ...props, [axes[0]!.name]: `${props[axes[0]!.name]}${mark}` });
    }
    taken.add(name);
    orphans.push({ id: e.id, name });
  }
  return { reuse, orphans };
}

export interface PlannedVariant {
  /** variantKeyOf(props): stored on the variant (dsbridge / variant). */
  key: string;
  /** Figma variant name, axis order: "Variant=primary, Size=md, State=Default". */
  name: string;
  props: Record<string, string>;
  /** Part id -> fields. Swappable parts: the fields set on the instance (its own size, its vector or text overrides). */
  parts: Record<string, PlannedField[]>;
  /** Swappable part id -> component the variant shows ("Icon/Plus", "Slot/Media"). */
  slots?: Record<string, string> | undefined;
  /** Variables bound inside a swapped-in instance that the variant does not override (a media slot's fill and icon). */
  inner?: PlannedField[] | undefined;
  /** Parts this variant hides (a check glyph while unchecked). */
  hidden?: string[] | undefined;
  /** Parts laid out differently in this variant (a switch thumb at the end when on). */
  layout?: Record<string, SpecLayout> | undefined;
  /** Vector parts: the SVG drawn and the stroke of each shape (a spinner arc, a progress ring). */
  vectors?: Record<string, { svg: string; hash: string; strokes: PlannedValue[] }> | undefined;
  /** Absolute parts placed differently in this variant, in pixels (an indicator under a vertical tab). */
  pins?: Record<string, Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>> | undefined;
}

/** An icon component to build on the Icons page ("Icon/Plus"). */
export interface PlannedIcon {
  name: string;
  /** "Icon/Plus". */
  component: string;
  svg: string;
  /** FNV-1a of the SVG: unchanged, nothing to rebuild. */
  hash: string;
}

/** A content component to build on the Slots page ("Slot/Media"). */
export interface PlannedSlot {
  name: string;
  kind: SpecSlot['kind'];
  fields: PlannedField[];
  text?: { property: string; default: string } | undefined;
  /** Media: icon component and its fields, height from the aspect ratio. */
  icon?: string | undefined;
  iconFields?: PlannedField[] | undefined;
  hash: string;
}

export type ComponentStatus = 'new' | 'updated' | 'unchanged';

export interface PlannedComponent {
  componentId: string;
  name: string;
  /** Component folder it comes from, when not its own name (the Radio set comes from RadioGroup). */
  component?: string | undefined;
  hash: string;
  status: ComponentStatus;
  nodeId?: string | undefined;
  description: string;
  axes: SpecAxis[];
  properties: SpecProperty[];
  parts: SpecPart[];
  variants: PlannedVariant[];
  /** Variant keys in Figma that code no longer has: flagged "[orphan]". */
  removedVariants: string[];
  /** Variant keys code added since the last pull. */
  addedVariants: string[];
  /** Absolute parts (a dialog's close button): their offsets from the parent's edges, in pixels. */
  pins?: Record<string, Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>> | undefined;
  /** Drafted with Claude, not generated (the generator cannot read it): shown as "Drafted, check it". */
  drafted?: { reason: string; stale?: boolean | undefined } | undefined;
  /** Prototype reactions between the variants (hover, press, click), Smart animate with the code's motion. */
  interactions?: MotionReaction[] | undefined;
  /** What Figma plays differently from the code, or cannot play, in plain words ("Keyboard focus: ..."). */
  motionNotes?: string[] | undefined;
  /**
   * The set was changed in Figma and pushed to a library branch that has now shipped (or closed): the update rebuilds it
   * from the reviewed code, so Figma never diverges from it.
   */
  fromFigma?: { number: number; url: string; status: FigmaPushStatus } | undefined;
}

export interface ComponentProblem {
  component: string;
  part: string;
  property: string;
  reason: string;
}

export interface ComponentPullPlan {
  /** Repo path the specs came from. */
  source: string;
  components: PlannedComponent[];
  /** Parts or properties that will not be bound, with the reason. Shown before anything is written. */
  problems: ComponentProblem[];
  /** Icon components (Icons page) and the fields of the masters (size, stroke color and width). */
  icons?: PlannedIcon[] | undefined;
  iconFields?: PlannedField[] | undefined;
  /** Content slot components (Slots page). */
  slots?: PlannedSlot[] | undefined;
  /** Every component of the design system and whether it is in Figma (component-specs.json coverage). */
  coverage?: SpecCoverage[] | undefined;
  /** Entries of component-specs.json left out because Bridge cannot read them, with the reason. Never built. */
  skipped?: { name: string; reason: string }[] | undefined;
}

export interface ComponentApplyReport {
  created: number;
  updated: number;
  unchanged: number;
  /** Variants flagged "[orphan]". */
  orphaned: number;
  page: string;
  /** Of the sets created or updated, those on another page than `page` (where the designer keeps them). */
  elsewhere?: number | undefined;
  /** Bindings or fonts that failed in Figma. */
  problems: string[];
  /** Set once when a brand font is missing in this Figma and Inter replaced it. */
  fontNote?: string | undefined;
  /** Set when Figma refused the prototype interactions of some sets: those sets are built without them. */
  interactionsNote?: string | undefined;
  /** Component set ids, created or updated. */
  nodeIds: string[];
  /** Icon and slot components created or redrawn (Icons and Slots pages). */
  parts?: { created: number; updated: number } | undefined;
  /** Sets this pull was asked to build or update (unchanged ones included). */
  total?: number | undefined;
  /** Sets not built, each with the reason in plain words. Nothing of them was left in the file. */
  failed?: { name: string; reason: string }[] | undefined;
  /** Sets built without some variants (the next pull builds them): how many were built, the first reason. */
  partial?: { name: string; built: number; total: number; reason: string; variants: string[] }[] | undefined;
  /** The pull was stopped: the sets it did not reach. The next pull goes on from there. */
  cancelled?: string[] | undefined;
}

/** What the end of a component pull says, in designer words. */
export interface ComponentReportView {
  /** "Built 54 of 56 components." or "All 56 components are built." */
  headline: string;
  /** "Not built: Select (a font could not be loaded), Tabs (...)." */
  notBuilt?: string | undefined;
  /** "Button: 70 of 72 variants (...)". */
  partial: string[];
  /** "Stopped after 120 of 300. Pull again to build the other 180." */
  stopped?: string | undefined;
  /** A pull again would build more: offer "Try again". */
  retry: boolean;
}

const listNames = (names: string[], max = 5) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));

export function componentReportView(r: ComponentApplyReport): ComponentReportView {
  const built = r.created + r.updated + r.unchanged;
  const failed = r.failed ?? [];
  const cancelled = r.cancelled ?? [];
  const total = r.total ?? built + failed.length + cancelled.length;
  const noun = (n: number) => (n === 1 ? 'component' : 'components');
  const headline = built === total ? (total === 1 ? 'The component is built.' : `All ${total} components are built.`) : `Built ${built} of ${total} ${noun(total)}.`;
  const shown = failed.slice(0, 5).map((f) => `${f.name} (${f.reason})`);
  const notBuilt = failed.length ? `Not built: ${shown.join(', ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}. Nothing of them was left in the file.` : undefined;
  const partial = (r.partial ?? []).map((p) => `${p.name}: ${p.built} of ${p.total} variants (${listNames(p.variants, 3)} not built: ${p.reason})`);
  const stopped = cancelled.length ? `Stopped after ${built + failed.length} of ${total}. Pull again to build the other ${cancelled.length}: ${listNames(cancelled)}.` : undefined;
  return { headline, ...(notBuilt ? { notBuilt } : {}), partial, ...(stopped ? { stopped } : {}), retry: failed.length + cancelled.length + (r.partial?.length ?? 0) > 0 };
}

// ---------------------------------------------------------------------------------------------
// Loading

/** component-specs.json at a tree (read through the git API like the token files), or undefined when the repo has none. */
export async function loadComponentSpecs(
  client: Pick<GitHubClient, 'getTree' | 'getBlobText'>,
  treeSha: string,
  config: BridgeConfig | undefined,
): Promise<{ path: string; specs: ComponentSpecsFile } | undefined> {
  const configured = config?.components?.specs;
  if (configured !== undefined && (typeof configured !== 'string' || !configured.trim()))
    throw new Error(`bridge.config.json: components.specs is ${configured === null ? 'empty' : `a ${Array.isArray(configured) ? 'list' : typeof configured}`}, it should be the path of component-specs.json. Fix it in the repo.`);
  const path = (configured ?? DEFAULT_COMPONENT_SPECS_FILE).trim().replace(/^\/+/, '');
  const { entries } = await client.getTree(treeSha, true);
  const entry = entries.find((e) => e.type === 'blob' && e.path === path);
  if (!entry) return undefined;
  return { path, specs: parseComponentSpecs(await client.getBlobText(entry.sha)) };
}

// ---------------------------------------------------------------------------------------------
// Planning

/**
 * Width of a root that fills its container in code (Card, Input): a component in Figma needs a width of its own. A size
 * token, so it follows the scale; designers resize instances freely.
 */
export const FILL_WIDTH_TOKEN = 'size.80';

const TEXT_ONLY: ReadonlySet<SpecField> = new Set(['textFill', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textDecoration']);
/** Fields any layer takes, text or not. */
const ANY_LAYER: ReadonlySet<SpecField> = new Set(['opacity']);
/** Whether a field applies to a text layer (text fields) or to a frame or icon (the others); opacity to both. */
const fieldFits = (field: SpecField, text: boolean) => ANY_LAYER.has(field) || TEXT_ONLY.has(field) === text;

function numberValue(set: TokenSet, path: string): number | undefined {
  const r = resolve(set.byPath, path, defaultContext(set));
  if (typeof r.value === 'number') return r.value;
  const d = parseDimension(r.value);
  return d ? d.value : undefined;
}

function familiesOf(set: TokenSet, path: string): string[] | undefined {
  const r = resolve(set.byPath, path, defaultContext(set));
  const v = r.value;
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : undefined;
  return list?.map((x) => String(x).trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/**
 * Evaluates a calc() of token paths from the specs ("calc(space.2 + space.0-5)") with the tokens' resolved values in the
 * default brand, theme and density. Operators + - * /, parentheses, numbers and px numbers.
 */
export function evaluateCalc(expr: string, head: TokenSet): number | { problem: string } {
  const inner = expr.replace(/^calc\(/, '').replace(/\)$/, '');
  const tokens = inner.match(/[()*/]|[^\s()*/]+/g) ?? [];
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(why);
  };
  const atom = (): number => {
    const t = tokens[i++];
    if (t === undefined) return fail(`${expr} ends too early`);
    if (t === '(') {
      const v = sum();
      if (tokens[i++] !== ')') fail(`${expr} has an unclosed parenthesis`);
      return v;
    }
    const num = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(t);
    if (num) return Number(num[1]);
    if (!head.byPath.has(t)) return fail(`${t} is not a token in the library`);
    const n = numberValue(head, t);
    return n === undefined ? fail(`${t} does not resolve to a number`) : n;
  };
  const product = (): number => {
    let v = atom();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++];
      const r = atom();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      const r = product();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = sum();
    if (i !== tokens.length) return { problem: `${expr} could not be read` };
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : { problem: `${expr} is not a finite number` };
  } catch (err) {
    return { problem: (err as Error).message };
  }
}

/** A spec value of an unexpected shape, short enough for a problem row. */
function unknownShape(value: unknown): string {
  if (value === undefined) return 'An empty value';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * How one spec value is written in Figma, or the reason it cannot be. `value` comes from component-specs.json on the
 * branch, parsed but not validated, and written by a generator that may be newer than this plugin: any shape other than
 * a token path, a calc(), a number or null is a problem for that field, never a throw that hides every component.
 */
export function planValue(field: SpecField, value: unknown, head: TokenSet): PlannedValue | { problem: string } {
  return planValueOf(field, value, head);
}

function planValueOf(field: SpecField, value: unknown, head: TokenSet): PlannedValue | { problem: string } {
  if (value === null) return COLOR_FIELDS.has(field) ? { kind: 'none' } : { problem: 'no value' };
  if (field === 'textDecoration') return typeof value === 'string' && /^(UNDERLINE|STRIKETHROUGH|NONE)$/.test(value) ? { kind: 'keyword', value } : { problem: `${String(value)} is not a text decoration` };
  if (typeof value === 'number') {
    if (COLOR_FIELDS.has(field)) return { problem: `${value}: a color cannot be a number` };
    return Number.isFinite(value) ? { kind: 'number', value } : { problem: `${value} is not a finite number` };
  }
  if (typeof value !== 'string') return { problem: `${unknownShape(value)} is not a value this version of Bridge reads: update Bridge` };
  if (value.startsWith('calc(')) {
    if (COLOR_FIELDS.has(field)) return { problem: `${value}: a color cannot be a calc()` };
    const n = evaluateCalc(value, head);
    return typeof n === 'number' ? { kind: 'number', value: n, expr: value } : n;
  }
  const t = head.byPath.get(value);
  if (!t) return { problem: `${value} is not a token in the library` };
  if (field === 'fontFamily') {
    const families = familiesOf(head, value);
    if (!families?.length) return { problem: `${value} does not resolve to a font family` };
    const planned = tokenToPlanned(t, head);
    const variable = !isUnmappable(planned) && planned.resolvedType === 'STRING' ? { tokenId: t.id, name: pathToName(value), collection: COLLECTIONS[t.tier] } : undefined;
    return { kind: 'font', families, path: value, ...(variable ? { variable } : {}) };
  }
  // Unitless line heights and em letter spacing: Figma variables for these are pixels, so set a percent, unbound.
  if ((field === 'lineHeight' || field === 'letterSpacing') && t.type === 'number') {
    const n = numberValue(head, value);
    return n === undefined ? { problem: `${value} does not resolve to a number` } : { kind: 'percent', value: Math.round(n * 10000) / 100, path: value };
  }
  const planned = tokenToPlanned(t, head);
  if (isUnmappable(planned)) return { problem: `${value}: ${planned.reason}` };
  const wants: FigmaResolvedType = COLOR_FIELDS.has(field) ? 'COLOR' : 'FLOAT';
  if (planned.resolvedType !== wants) return { problem: `${value} is a ${planned.resolvedType} variable, ${field} needs ${wants}` };
  let resolved: number | string | undefined;
  if (wants === 'FLOAT') resolved = numberValue(head, value);
  else {
    const r = resolve(head.byPath, value, defaultContext(head));
    const c = parseColor(r.value);
    resolved = c ? `${[c.r, c.g, c.b].map((x) => Math.round(x * 255)).join(',')},${Math.round(c.a * 255)}` : undefined;
  }
  return {
    kind: 'variable',
    path: value,
    tokenId: t.id,
    name: pathToName(value),
    collection: COLLECTIONS[t.tier],
    resolvedType: planned.resolvedType,
    ...(resolved !== undefined ? { value: resolved } : {}),
  };
}

export function describeSpec(spec: ComponentSpec): string {
  const dir = spec.source[0]?.replace(/\/[^/]+$/, '') ?? spec.name;
  if (spec.drafted)
    return `Drafted with Claude from ${dir}: DS Bridge cannot read this component on its own (it ${spec.drafted.reason}). Check it against the code with Check fidelity. Code is the source of truth: change it in code, or send a request from Push.`;
  // prefers-reduced-motion has no Figma equivalent: said where designers read the set.
  const motion = componentMotion(spec);
  const prototype = motion.reactions.length ? ` In prototypes, its interactions play the code's motion.${motion.reducedMotion ? ` ${motion.reducedMotion}` : ''}` : motion.reducedMotion ? ` It animates in code. ${motion.reducedMotion}` : '';
  return `Generated by DS Bridge from ${dir}.${prototype} Code is the source of truth: change it in code, or send a request from Push.`;
}

/** The motion notes a set carries in the Pull preview: approximations, then what Figma cannot play. */
export function motionNotesOf(spec: ComponentSpec): string[] {
  const m = componentMotion(spec);
  return [...m.approximations.map((a) => `Approximated: ${a}`), ...m.cannotPlay.map((n) => `${n.what}: ${n.reason}`)];
}

/** The note a drafted set carries in the Pull preview. */
export const draftedSetNote = (d: NonNullable<PlannedComponent['drafted']>) => (d.stale ? 'Drafted, the code changed since: check it' : 'Drafted, check it');

/** The pull plan for components: status per spec, every field resolved to a variable (or a reason it is not). */
export function buildComponentPlan(
  rawSpecs: ComponentSpecsFile,
  source: string,
  generated: GeneratedSet[],
  head: TokenSet,
  opts: { pushed?: ReadonlyMap<number, FigmaPushStatus> | undefined } = {},
): ComponentPullPlan {
  const problems: ComponentProblem[] = [];
  // Entries of the wrong shape are left out (or trimmed) with their reason before anything is planned.
  const { specs, issues } = checkComponentSpecs(rawSpecs);
  const skipped: { name: string; reason: string }[] = issues.filter((i) => i.skipped).map((i) => ({ name: i.component, reason: i.reason }));
  for (const i of issues) if (!i.skipped) problems.push({ component: i.component, part: 'spec', property: 'shape', reason: i.reason });
  const seen = new Set<string>();
  const problem = (p: ComponentProblem) => {
    const k = `${p.component}|${p.part}|${p.property}|${p.reason}`;
    if (seen.has(k)) return;
    seen.add(k);
    problems.push(p);
  };
  // The same token in the same field resolves the same way everywhere: planned once (a big system repeats them a lot).
  const memo = new Map<string, PlannedValue | { problem: string }>();
  const planValue = (field: SpecField, value: unknown, set: TokenSet): PlannedValue | { problem: string } => {
    const key = `${field}\u0000${typeof value}\u0000${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
    let hit = memo.get(key);
    if (!hit) {
      hit = planValueOf(field, value, set);
      memo.set(key, hit);
    }
    return hit;
  };
  const plannedFields = (owner: string, part: string, values: Partial<Record<SpecField, SpecValue>>, text: boolean): PlannedField[] => {
    const fields: PlannedField[] = [];
    for (const [field, value] of Object.entries(values) as [SpecField, SpecValue][]) {
      if (!fieldFits(field, text)) continue;
      const pv = planValue(field, value, head);
      if ('problem' in pv) problem({ component: owner, part, property: field, reason: pv.problem });
      else fields.push({ field, value: pv });
    }
    return fields;
  };
  const icons: PlannedIcon[] = (specs.icons ?? []).map((i) => ({ name: i.name, component: iconComponentName(i.name), svg: i.svg, hash: specHash(i.svg) }));
  const style = specs.iconStyle;
  const iconFields = style ? plannedFields('Icons', 'icon', { width: style.size, height: style.size, stroke: style.color, strokeWeight: style.stroke }, false) : undefined;
  const slots: PlannedSlot[] = (specs.slots ?? []).map((sl) => {
    const fields = plannedFields(sl.name, 'root', sl.values, sl.kind === 'text');
    // A text slot is as wide as a card in Figma (it fills its card in use): the size scale, like a block-level root.
    if (sl.kind === 'text') {
      const w = planValue('width', FILL_WIDTH_TOKEN, head);
      if (!('problem' in w)) fields.push({ field: 'width', value: w });
    }
    if (sl.kind === 'media' && sl.aspect) {
      const w = fields.find((f) => f.field === 'width')?.value;
      const width = w?.kind === 'variable' && typeof w.value === 'number' ? w.value : undefined;
      if (width !== undefined) fields.push({ field: 'height', value: { kind: 'number', value: Math.round((width * sl.aspect[1]) / sl.aspect[0]) } });
    }
    const iconFieldsOf = sl.iconValues ? plannedFields(sl.name, 'icon', sl.iconValues, false) : undefined;
    return {
      name: sl.name,
      kind: sl.kind,
      fields,
      ...(sl.text ? { text: sl.text } : {}),
      ...(sl.icon ? { icon: iconComponentName(sl.icon) } : {}),
      ...(iconFieldsOf ? { iconFields: iconFieldsOf } : {}),
      hash: specHash(JSON.stringify(sl)),
    };
  });
  const slotByName = new Map(slots.map((sl) => [sl.name, sl]));
  const generatedById = new Map<string, GeneratedSet>();
  for (const g of generated) if (!generatedById.has(g.componentId)) generatedById.set(g.componentId, g);
  const components: PlannedComponent[] = [];
  for (const spec of specs.components) {
    // Last net: a spec this version cannot plan for a reason the check did not foresee is left out, never the others.
    const mark = problems.length;
    try {
      planOne(spec);
    } catch (err) {
      problems.splice(mark);
      skipped.push({ name: spec.name, reason: `could not be read (${err instanceof Error ? err.message : String(err)}): update Bridge` });
    }
  }
  function planOne(spec: ComponentSpec): void {
    // From the spec as read, not its "hash" field: a file edited by hand or by another tool keeps a stale one, and
    // the sets it changed would never be updated. The generator writes this same hash, so a current file reads equal.
    const hash = hashSpec(spec);
    for (const u of spec.unmapped) problem({ component: spec.name, part: u.part, property: u.property, reason: u.reason });
    const kinds = new Map(spec.parts.map((p) => [p.id, p.kind]));
    // Offsets of an absolute part from its parent's edges, in pixels.
    const pinPixels = (part: string, pin: NonNullable<SpecPart['pin']>) => {
      const out: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>> = {};
      for (const [side, value] of Object.entries(pin) as ['top' | 'right' | 'bottom' | 'left', SpecValue][]) {
        const pv = planValue('paddingTop', value, head);
        const n = 'problem' in pv ? undefined : pv.kind === 'number' ? pv.value : pv.kind === 'variable' && typeof pv.value === 'number' ? pv.value : undefined;
        if (n === undefined) problem({ component: spec.name, part, property: side, reason: 'problem' in pv ? pv.problem : `${String(value)} is not a size` });
        else out[side] = n;
      }
      return out;
    };
    let rootFill: PlannedValue | undefined;
    if (spec.parts.find((p) => !p.parent)?.fill) {
      const w = planValue('width', FILL_WIDTH_TOKEN, head);
      if ('problem' in w) problem({ component: spec.name, part: 'root', property: 'width', reason: `fills its container in code, and ${w.problem}: the Figma set hugs its content` });
      else rootFill = w;
    }
    const variants: PlannedVariant[] = spec.variants.map((v) => {
      const parts: Record<string, PlannedField[]> = {};
      for (const [part, values] of Object.entries(v.values)) {
        const fields: PlannedField[] = [];
        for (const [field, value] of Object.entries(values) as [SpecField, SpecValue][]) {
          if (!fieldFits(field, kinds.get(part) === 'text')) continue;
          const pv = planValue(field, value, head);
          if ('problem' in pv) problem({ component: spec.name, part, property: field, reason: pv.problem });
          else {
            fields.push({ field, value: pv });
            if (pv.kind === 'number' && pv.expr) problem({ component: spec.name, part, property: field, reason: `${pv.expr} = ${pv.value}, set, not bound` });
          }
        }
        parts[part] = fields;
      }
      // A block-level root fills its container in code: drawn at a fixed width from the size scale.
      if (rootFill && !(parts.root ?? []).some((f) => f.field === 'width')) (parts.root ??= []).push({ field: 'width', value: rootFill });
      // A content slot showing media: the text fields do not apply; the media's own bindings stay inside the instance.
      let inner: PlannedField[] | undefined;
      for (const [part, comp] of Object.entries(v.slots ?? {})) {
        const sl = slotByName.get(comp);
        if (!sl || sl.kind === 'text') continue;
        parts[part] = [];
        inner = [...(inner ?? []), ...sl.fields.filter((f) => f.field !== 'width' && f.field !== 'height'), ...(sl.iconFields ?? [])];
      }
      return {
        key: variantKeyOf(v.props),
        name: variantName(v.props) || LONE_VARIANT,
        props: v.props,
        parts,
        ...(v.pins ? { pins: Object.fromEntries(Object.entries(v.pins).map(([part, pin]) => [part, pinPixels(part, pin)])) } : {}),
        ...(v.slots ? { slots: { ...v.slots } } : {}),
        ...(inner ? { inner } : {}),
        ...(v.hidden?.length ? { hidden: [...v.hidden] } : {}),
        ...(v.layout ? { layout: { ...v.layout } } : {}),
        ...(v.vectors
          ? {
              vectors: Object.fromEntries(
                Object.entries(v.vectors).map(([part, vec]) => [
                  part,
                  {
                    svg: vec.svg,
                    hash: specHash(vec.svg),
                    strokes: vec.strokes.map((value) => {
                      const pv = planValue('stroke', value, head);
                      if ('problem' in pv) {
                        problem({ component: spec.name, part, property: 'stroke', reason: pv.problem });
                        return { kind: 'none' } as PlannedValue;
                      }
                      return pv;
                    }),
                  },
                ]),
              ),
            }
          : {}),
      };
    });
    const existing = generatedById.get(spec.name);
    const keys = new Set(variants.map((v) => v.key));
    const have = new Set(existing?.variants ?? []);
    const addedVariants = existing ? variants.map((v) => v.key).filter((k) => !have.has(k)) : [];
    const removedVariants = existing ? existing.variants.filter((k) => !keys.has(k)) : [];
    // Pushed from Figma and shipped (or closed): rebuilt from the reviewed code even when the spec did not change.
    const shipped = existing?.pushed ? opts.pushed?.get(existing.pushed.number) : undefined;
    const fromFigma = existing?.pushed && shipped?.rebuild ? { number: existing.pushed.number, url: existing.pushed.url, status: shipped } : undefined;
    const status: ComponentStatus = !existing ? 'new' : existing.specHash === hash && !addedVariants.length && !removedVariants.length && !fromFigma && !existing.inError ? 'unchanged' : 'updated';
    const pins: NonNullable<PlannedComponent['pins']> = {};
    for (const part of spec.parts) if (part.pin) pins[part.id] = pinPixels(part.id, part.pin);
    components.push({
      ...(Object.keys(pins).length ? { pins } : {}),
      componentId: spec.name,
      name: spec.name,
      ...(spec.component ? { component: spec.component } : {}),
      ...(spec.drafted ? { drafted: spec.drafted } : {}),
      ...(fromFigma ? { fromFigma } : {}),
      hash,
      status,
      ...(existing ? { nodeId: existing.nodeId } : {}),
      description: describeSpec(spec),
      ...(() => {
        const reactions = componentMotion(spec).reactions;
        const notes = motionNotesOf(spec);
        return { ...(reactions.length ? { interactions: reactions } : {}), ...(notes.length ? { motionNotes: notes } : {}) };
      })(),
      axes: spec.axes,
      properties: spec.properties,
      parts: spec.parts,
      variants,
      removedVariants,
      addedVariants,
    });
  }
  return {
    source,
    components,
    problems,
    ...(skipped.length ? { skipped } : {}),
    ...(icons.length ? { icons } : {}),
    ...(iconFields ? { iconFields } : {}),
    ...(slots.length ? { slots } : {}),
    ...(specs.coverage ? { coverage: specs.coverage } : {}),
  };
}

/** What the Pull screen says about coverage: the count, then the components not in Figma with a plain reason each. */
export interface CoverageView {
  /**
   * What the code brings to Figma (not what this file holds yet): "26 of 47 components can be pulled into Figma", or
   * "6 components can be pulled into Figma. The code does not list the others yet" without a coverage list. No final
   * period: the Pull screen goes on after it.
   */
  headline: string;
  /** Components in Figma that Claude drafted (the generator cannot read them): check them against the code. */
  drafted: { name: string; reason: string }[];
  /** Visual components not in Figma yet, each with its reason ("Not supported yet: opens a popup"). */
  missing: { name: string; reason: string }[];
  /** Layout helpers (Stack, Grid...): nothing to draw, auto layout does their job. */
  layout: string[];
  /** Every visual component is in Figma. */
  complete: boolean;
}

export function coverageView(plan: Pick<ComponentPullPlan, 'coverage' | 'components'>): CoverageView {
  const list = plan.coverage;
  if (!list) {
    // An older specs file: it names the sets it has, not the components it leaves out. Never claim it is complete.
    const n = new Set(plan.components.map((c) => c.name)).size;
    return { headline: `${n} ${n === 1 ? 'component' : 'components'} can be pulled into Figma. The code does not list the others yet`, missing: [], drafted: [], layout: [], complete: false };
  }
  const visual = list.filter((c) => c.status !== 'layout');
  // Drafted with Claude: in Figma, never counted as generated, named so designers check them.
  const drafted = visual.filter((c) => c.status === 'drafted').map((c) => ({ name: c.name, reason: c.reason ? `Drafted with Claude, the generator cannot read it: it ${c.reason}` : 'Drafted with Claude' }));
  const inFigma = visual.filter((c) => c.status === 'generated').length + drafted.length;
  const missing = visual.filter((c) => c.status !== 'generated' && c.status !== 'drafted').map((c) => ({ name: c.name, reason: c.reason ? `Not supported yet: ${c.reason}` : 'Not added yet' }));
  const layout = list.filter((c) => c.status === 'layout').map((c) => c.name);
  // The count next to "Components" is the sets built, parts and popups included (AccordionItem, Dialog/Popup): say it.
  const sets = plan.components.length;
  const asSets = sets > inFigma ? ` (${sets} sets with their parts)` : '';
  const headline = `${inFigma} of ${visual.length} components can be pulled into Figma${asSets}${drafted.length ? `, ${drafted.length} drafted with Claude` : ''}`;
  return { headline, missing, drafted, layout, complete: missing.length === 0 };
}

/** Components a pull would write (new or updated). */
export const pendingComponents = (plan: ComponentPullPlan | undefined) => plan?.components.filter((c) => c.status !== 'unchanged') ?? [];

/** The plan with only the components to write: unchanged ones are not sent to the main thread. */
export function writablePlan(plan: ComponentPullPlan): ComponentPullPlan {
  return { ...plan, components: pendingComponents(plan) };
}

/** Library branch numbers of the generated sets pushed from Figma, to read where each stands before planning a pull. */
export const pushedNumbers = (generated: readonly GeneratedSet[]) => [...new Set(generated.flatMap((g) => (g.pushed ? [g.pushed.number] : [])))];

/** Sets pushed from Figma whose library branch is still open: "Button (Waiting for a developer)". */
export function pushedInReview(generated: readonly GeneratedSet[], statuses: ReadonlyMap<number, FigmaPushStatus>): { name: string; number: number; url: string; status: FigmaPushStatus }[] {
  return generated.flatMap((g) => {
    const st = g.pushed ? statuses.get(g.pushed.number) : undefined;
    return g.pushed && st && !st.rebuild ? [{ name: g.name, number: g.pushed.number, url: g.pushed.url, status: st }] : [];
  });
}

/**
 * The name a spec property gets in Figma. A BOOLEAN that shows a swappable part is "Show <part>" ("Show icon",
 * "Show icon start"), as Figma's own kits name them, so the swap keeps the plain name ("Icon") instead of the
 * "Icon2" Figma gives a name another type took.
 */
export function figmaPropName(comp: { parts: readonly { swap?: { property: string } | undefined }[] }, p: { name: string; type: string }): string {
  if (p.type !== 'BOOLEAN' || !comp.parts.some((x) => x.swap?.property === p.name)) return p.name;
  return `Show ${p.name.charAt(0).toLowerCase()}${p.name.slice(1)}`;
}
