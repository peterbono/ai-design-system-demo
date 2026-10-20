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
  componentMotion,
  defaultContext,
  parseColor,
  parseComponentSpecs,
  iconComponentName,
  parseDimension,
  resolve,
  specHash,
  variantKeyOf,
  variantName,
} from '@bridge-ds/core';
import { COLLECTIONS, type FigmaResolvedType } from '../shared/messages';
import { isUnmappable, pathToName, tokenToPlanned } from './mapping';

/** A component set DS Bridge generated, as the main thread finds it (shared plugin data). */
export interface GeneratedSet {
  componentId: string;
  nodeId: string;
  name: string;
  page?: string | undefined;
  specHash: string;
  /** Variant keys (variantKeyOf) of the generated variants, orphans excluded. */
  variants: string[];
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
  | { kind: 'font'; families: string[]; path: string }
  | { kind: 'keyword'; value: string };

export interface PlannedField {
  field: SpecField;
  value: PlannedValue;
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
}

export interface ComponentApplyReport {
  created: number;
  updated: number;
  unchanged: number;
  /** Variants flagged "[orphan]". */
  orphaned: number;
  page: string;
  /** Bindings or fonts that failed in Figma. */
  problems: string[];
  /** Set once when a brand font is missing in this Figma and Inter replaced it. */
  fontNote?: string | undefined;
  /** Component set ids, created or updated. */
  nodeIds: string[];
  /** Icon and slot components created or redrawn (Icons and Slots pages). */
  parts?: { created: number; updated: number } | undefined;
}

// ---------------------------------------------------------------------------------------------
// Loading

/** component-specs.json at a tree (read through the git API like the token files), or undefined when the repo has none. */
export async function loadComponentSpecs(
  client: Pick<GitHubClient, 'getTree' | 'getBlobText'>,
  treeSha: string,
  config: BridgeConfig | undefined,
): Promise<{ path: string; specs: ComponentSpecsFile } | undefined> {
  const path = config?.components?.specs ?? DEFAULT_COMPONENT_SPECS_FILE;
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
    if (!head.byPath.has(t)) return fail(`${t} is not a token on this branch`);
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

/** How one spec value is written in Figma, or the reason it cannot be. */
export function planValue(field: SpecField, value: SpecValue, head: TokenSet): PlannedValue | { problem: string } {
  if (value === null) return COLOR_FIELDS.has(field) ? { kind: 'none' } : { problem: 'no value' };
  if (field === 'textDecoration') return typeof value === 'string' && /^(UNDERLINE|STRIKETHROUGH|NONE)$/.test(value) ? { kind: 'keyword', value } : { problem: `${String(value)} is not a text decoration` };
  if (typeof value === 'number') return COLOR_FIELDS.has(field) ? { problem: `${value}: a color cannot be a number` } : { kind: 'number', value };
  if (value.startsWith('calc(')) {
    if (COLOR_FIELDS.has(field)) return { problem: `${value}: a color cannot be a calc()` };
    const n = evaluateCalc(value, head);
    return typeof n === 'number' ? { kind: 'number', value: n, expr: value } : n;
  }
  const t = head.byPath.get(value);
  if (!t) return { problem: `${value} is not a token on this branch` };
  if (field === 'fontFamily') {
    const families = familiesOf(head, value);
    return families?.length ? { kind: 'font', families, path: value } : { problem: `${value} does not resolve to a font family` };
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
export function buildComponentPlan(specs: ComponentSpecsFile, source: string, generated: GeneratedSet[], head: TokenSet): ComponentPullPlan {
  const problems: ComponentProblem[] = [];
  const seen = new Set<string>();
  const problem = (p: ComponentProblem) => {
    const k = `${p.component}|${p.part}|${p.property}|${p.reason}`;
    if (seen.has(k)) return;
    seen.add(k);
    problems.push(p);
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
  const components: PlannedComponent[] = [];
  for (const spec of specs.components) {
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
        name: variantName(v.props),
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
    const existing = generated.find((g) => g.componentId === spec.name);
    const keys = new Set(variants.map((v) => v.key));
    const have = new Set(existing?.variants ?? []);
    const addedVariants = existing ? variants.map((v) => v.key).filter((k) => !have.has(k)) : [];
    const removedVariants = existing ? existing.variants.filter((k) => !keys.has(k)) : [];
    const status: ComponentStatus = !existing ? 'new' : existing.specHash === spec.hash && !addedVariants.length && !removedVariants.length ? 'unchanged' : 'updated';
    const pins: NonNullable<PlannedComponent['pins']> = {};
    for (const part of spec.parts) if (part.pin) pins[part.id] = pinPixels(part.id, part.pin);
    components.push({
      ...(Object.keys(pins).length ? { pins } : {}),
      componentId: spec.name,
      name: spec.name,
      ...(spec.component ? { component: spec.component } : {}),
      ...(spec.drafted ? { drafted: spec.drafted } : {}),
      hash: spec.hash,
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
    ...(icons.length ? { icons } : {}),
    ...(iconFields ? { iconFields } : {}),
    ...(slots.length ? { slots } : {}),
    ...(specs.coverage ? { coverage: specs.coverage } : {}),
  };
}

/** What the Pull screen says about coverage: the count, then the components not in Figma with a plain reason each. */
export interface CoverageView {
  /** "26 of 47 components are in Figma", or "6 components are in Figma" when the file does not list the others. */
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
    return { headline: `${n} ${n === 1 ? 'component is' : 'components are'} in Figma. The code does not list the others yet.`, missing: [], drafted: [], layout: [], complete: false };
  }
  const visual = list.filter((c) => c.status !== 'layout');
  // Drafted with Claude: in Figma, never counted as generated, named so designers check them.
  const drafted = visual.filter((c) => c.status === 'drafted').map((c) => ({ name: c.name, reason: c.reason ? `Drafted with Claude, the generator cannot read it: it ${c.reason}` : 'Drafted with Claude' }));
  const inFigma = visual.filter((c) => c.status === 'generated').length + drafted.length;
  const missing = visual.filter((c) => c.status !== 'generated' && c.status !== 'drafted').map((c) => ({ name: c.name, reason: c.reason ? `Not supported yet: ${c.reason}` : 'Not added yet' }));
  const layout = list.filter((c) => c.status === 'layout').map((c) => c.name);
  const headline = `${inFigma} of ${visual.length} components are in Figma${drafted.length ? `, ${drafted.length} drafted with Claude` : ''}`;
  return { headline, missing, drafted, layout, complete: missing.length === 0 };
}

/** Components a pull would write (new or updated). */
export const pendingComponents = (plan: ComponentPullPlan | undefined) => plan?.components.filter((c) => c.status !== 'unchanged') ?? [];

/** The plan with only the components to write: unchanged ones are not sent to the main thread. */
export function writablePlan(plan: ComponentPullPlan): ComponentPullPlan {
  return { ...plan, components: pendingComponents(plan) };
}
