// Measured specs, browser safe: the shapes `bridge specs --measure` writes (a story's rendered tree and its spec-shaped
// reading), how a static spec's parts pair with measured ones, and the comparison of the two. No Node or DOM API: the
// Figma plugin's UI reads measured-specs.json and pairs layers with these. The measure itself (a browser driving
// Storybook) lives in '@bridge-ds/core/node' (measure.ts).

import type { SpecField, SpecLayout, SpecPart, SpecValue, SpecVariant, SpecVector } from './component-spec';
import type { ComponentStatus } from './measure-status';

/** How a value was tied to a custom property. */
export interface MeasuredToken {
  /**
   * `declared`: the winning CSS declaration uses the variable (strong). `matched`: no declaration does, but the value
   * equals a variable defined on the root (weak: several tokens can share a value).
   */
  via: 'declared' | 'matched';
  /** declared: the variable the declaration names, then what it aliases (`--button-bg`, `--color-action-primary-bg`). matched: up to 3 candidates. */
  chain: string[];
  /** declared: the declaration is the variable alone (`var(--x)`), not a calc() or a function of it. */
  exact: boolean;
  /** declared: the declaration text (`var(--space-2) var(--space-3)` piece for this side). */
  declared?: string | undefined;
}

export interface MeasuredBox {
  /** Relative to the measured root's top-left corner, CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasuredNode {
  /** Tag name, `#text` for a text run inside an element that also holds elements. */
  tag: string;
  kind: 'frame' | 'text' | 'icon' | 'vector';
  /** Width or height set by the CSS (not auto, a percentage or content-sized). */
  sized?: { width?: boolean | undefined; height?: boolean | undefined } | undefined;
  /** Inline SVG: each shape's stroke in order (rgb), as drawn. */
  svgStrokes?: string[] | undefined;
  /** A ::before or ::after drawn as a box (a switch knob, a checkbox's box): its tag is `::before` / `::after`. */
  pseudo?: 'before' | 'after' | undefined;
  classes?: string[] | undefined;
  role?: string | undefined;
  /** State attributes (data-state, data-variant, aria-checked...). */
  attrs?: Record<string, string> | undefined;
  box: MeasuredBox;
  /** Computed values of the properties the measure reads (display, flex, padding, colors, fonts...). */
  style: Record<string, string>;
  /** CSS property -> the token behind its value. */
  tokens: Record<string, MeasuredToken>;
  /** Text layers: the characters. */
  text?: string | undefined;
  /** Icons and vectors: their markup when short. */
  svg?: string | undefined;
  media?: boolean | undefined;
  input?: { type: string; value: string; placeholder: string; checked: boolean } | undefined;
  /** Node or depth limit reached under this node. */
  truncated?: boolean | undefined;
  /** A gallery's instance (splitInstances): where its box sat in the story's root before it was re-based. */
  at?: { x: number; y: number } | undefined;
  children: MeasuredNode[];
}

/** A measure in the Figma pull's shape: the parts of one variant and their field values, plus what a spec leaves out. */
/** Figma alignment of one child in its parent's auto layout, relative to the parent's direction. */
export interface MeasuredChildAlign {
  primary?: 'MIN' | 'CENTER' | 'MAX' | undefined;
  counter?: 'MIN' | 'CENTER' | 'MAX' | undefined;
}

/** A measured auto layout: the spec layout, plus per child alignment for out-of-flow decorations rebuilt in it. */
export interface MeasuredLayout extends SpecLayout {
  /** Child part id -> its alignment; the parent's padding (in `values`) carries the offset. */
  align?: Record<string, MeasuredChildAlign> | undefined;
}

/** A measured part: a spec part, plus what auto layout needs to rebuild margins, overlays and decorations. */
export interface MeasuredPart extends SpecPart {
  layout?: MeasuredLayout | undefined;
  /** Out of flow and over its siblings or outside its parent (a popover, a badge, a focus ring): absolute in Figma, never in the size. */
  overlay?: boolean | undefined;
  /** Margins the part has (px, non-zero sides). */
  margins?: { top?: number | undefined; right?: number | undefined; bottom?: number | undefined; left?: number | undefined } | undefined;
  /** Uneven margins between siblings: wrap the part in a frame with this padding. */
  wrap?: { padding: { top?: number | undefined; right?: number | undefined; bottom?: number | undefined; left?: number | undefined } } | undefined;
  /** The radius is half the shorter side or more: a pill or a circle (its value is 999 px, or the token it is bound to). */
  fullRadius?: boolean | undefined;
}

export interface MeasuredSpec {
  story: string;
  parts: MeasuredPart[];
  /** Part id -> field -> token path (declared token), number (px or unitless literal) or null (no paint). */
  values: SpecVariant['values'];
  /** Part id -> field -> the computed value (`rgb(31, 41, 55)`, 16). Colors without a token only live here. */
  raw: Record<string, Partial<Record<SpecField, string | number>>>;
  /** Part id -> field -> the token evidence (declared chain or value match). */
  tokens: Record<string, Partial<Record<SpecField, MeasuredToken>>>;
  /** Part id -> its measured box. */
  boxes: Record<string, MeasuredBox>;
  /** Fields read, and how many are tied to a declared token, to a value match, or to none. */
  coverage: { fields: number; declared: number; matched: number; literal: number };
  /**
   * Part id -> the SVG an icon or vector part draws, `currentColor` resolved to the part's color, and the value of each
   * shape's stroke in order. The pull draws it in place of an empty icon frame.
   */
  vectors?: Record<string, SpecVector> | undefined;
  /** Part id -> the width and height its CSS sets (px): keep them fixed, do not hug (a 40x40 icon button around a 16 px icon). */
  sized?: Record<string, { width?: number | undefined; height?: number | undefined }> | undefined;
  /**
   * Part id -> extra space before it in its parent's auto layout (px), when the gaps between children are not uniform
   * (margins): the parent's itemSpacing is the smallest gap, this is what a child adds on top.
   */
  spacers?: Record<string, number> | undefined;
}

const px = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)px$/.exec(v.trim());
  return m ? Math.round(Number(m[1]) * 100) / 100 : undefined;
};

// ---------------------------------------------------------------------------------------------
// Static guess vs measured truth

export interface FieldDiff {
  part: string;
  field: SpecField;
  /** The static spec's value (token path, number, null), undefined when the static spec has no value there. */
  static?: SpecValue | undefined;
  /** The measured value: token path when declared, else the raw value. Undefined when the field was not measured. */
  measured?: SpecValue | undefined;
  /** Same token, or same resolved value. */
  same: boolean;
}

export interface SpecComparison {
  /** Static parts matched to a measured part (by CSS class, then by kind and order). */
  partsMatched: number;
  staticParts: number;
  measuredParts: number;
  /** Fields both sides have. */
  compared: number;
  same: number;
  /** Fields where both name a token and it is the same token. */
  sameToken: number;
  diffs: FieldDiff[];
  /** Static parts no measured part matches (hidden optional parts, or parts the static guess invented). */
  unmatchedParts: string[];
  /** Static fields with no measured counterpart, measured fields the static spec misses. */
  staticOnly: number;
  measuredOnly: number;
  /** Width and height, root part: static (when a number) vs measured, px. */
  rootSize?: { static: { width?: number | undefined; height?: number | undefined }; measured: { width: number; height: number } } | undefined;
}

/** A spec calc() of token paths (`calc(control.height.sm - border-width.default * 2)`) in px, from resolved tokens. */
export function evalCalc(expr: string, resolve: (tokenPath: string) => string | number | undefined): number | undefined {
  const body = /^calc\((.*)\)$/s.exec(expr.trim())?.[1];
  if (!body) return undefined;
  let missing = false;
  const text = body.replace(/[A-Za-z_][\w-]*(?:\.[\w-]+)*/g, (path) => {
    const v = resolve(path);
    const n = typeof v === 'number' ? v : v === undefined ? undefined : Number.parseFloat(v);
    if (n === undefined || Number.isNaN(n)) missing = true;
    return String(n);
  });
  if (missing || !/^[\d.\s+\-*/()]+$/.test(text)) return undefined;
  // Only numbers, + - * / and parentheses are left: a tiny recursive descent, no eval.
  const tokens = text.match(/\d*\.?\d+|[+\-*/()]/g) ?? [];
  let i = 0;
  const factor = (): number => {
    const t = tokens[i++];
    if (t === '(') {
      const v = sum();
      i++;
      return v;
    }
    if (t === '-') return -factor();
    return Number(t);
  };
  const product = (): number => {
    let v = factor();
    while (tokens[i] === '*' || tokens[i] === '/') v = tokens[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + product() : v - product();
    return v;
  };
  const v = sum();
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
}

/**
 * Compares a static variant (component-specs.json) with a measure of the same render. `resolve` turns a token path
 * into the measured page's value (normalised the way MeasuredSpec.raw is) for the value comparison; without it, token
 * paths are compared by name only.
 */
/** A CSS variable and a token path name the same token (`--border-width-default`, `border-width.default`). */
const sameName = (cssVar: string, path: string) => cssVar.replace(/^--/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase() === path.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** `#rrggbb[aa]` and `rgb()`/`rgba()` to one spelling, spaces removed; other strings unchanged. */
function normColor(v: string): string {
  const t = v.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? hex.split('').map((c) => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    const a = full.length === 8 ? Math.round((parseInt(full.slice(6, 8), 16) / 255) * 100) / 100 : 1;
    return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  }
  const m = /^rgba?\(([^)]*)\)$/.exec(t);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts[3] ?? 1;
    return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Math.round(a * 100) / 100})`;
  }
  return t.replace(/\s+/g, '');
}

export interface PairOptions {
  /** The component's properties: a text part bound to a TEXT property is paired by that property's default text. */
  properties?: { name: string; type: string; default?: unknown }[] | undefined;
}

const normText = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** An icon whose SVG the measure captured is drawn as a vector: the same element on both sides. */
const graphic = (k: SpecPart['kind']) => (k === 'icon' || k === 'vector' ? 'graphic' : k);

/**
 * The parts without the wrappers the pull adds around one part (`<part>-wrapper`: a margin Figma's one gap per frame
 * cannot give). The render has no such element: the part inside stands for it, under the wrapper's parent.
 */
export function withoutAddedWrappers(parts: SpecPart[], measured: Pick<MeasuredSpec, 'parts'>): SpecPart[] {
  const real = new Set(measured.parts.map((m) => m.id));
  const added = new Map<string, string | undefined>();
  for (const p of parts) {
    if (p.kind !== 'frame' || !p.parent || real.has(p.id)) continue;
    const kids = parts.filter((c) => c.parent === p.id);
    if (kids.length === 1 && `${kids[0]!.id}-wrapper` === p.id) added.set(p.id, p.parent);
  }
  if (!added.size) return parts;
  const up = (id: string | undefined): string | undefined => (id && added.has(id) ? up(added.get(id)) : id);
  return parts.filter((p) => !added.has(p.id)).map((p) => (p.parent && added.has(p.parent) ? { ...p, parent: up(p.parent) } : p));
}

/**
 * Pairs static parts with measured parts: root to root, text layers by their characters (a TEXT property's default, or
 * fixed characters), then CSS class under the paired parent, then kind and order under the paired parent. A part whose
 * parent the render does not show is not shown either (an error row's icon is not the checkbox's check).
 */
export function pairParts(staticParts: SpecPart[], measured: Pick<MeasuredSpec, 'parts'>, o: PairOptions = {}): Map<string, string> {
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  const mParts = new Map(measured.parts.map((p) => [p.id, p]));
  const sParts = new Map(staticParts.map((p) => [p.id, p]));
  const take = (s: string, m: string) => {
    pairs.set(s, m);
    taken.add(m);
  };
  /** Measured ancestors of a measured part, nearest first. */
  const ancestors = (id: string) => {
    const out: string[] = [];
    for (let p = mParts.get(id)?.parent; p; p = mParts.get(p)?.parent) out.push(p);
    return out;
  };
  /** The measured counterpart of the nearest paired static ancestor. */
  const pairedAncestor = (p: SpecPart) => {
    for (let a = p.parent; a; a = sParts.get(a)?.parent) if (pairs.has(a)) return pairs.get(a);
    return undefined;
  };
  /** Prefer the candidate under the paired parent, then under the nearest paired ancestor, then the first. */
  const best = (p: SpecPart, cands: SpecPart[]) => {
    if (!cands.length) return undefined;
    const parent = p.parent ? pairs.get(p.parent) : undefined;
    if (parent) {
      const direct = cands.find((c) => c.parent === parent);
      if (direct) return direct;
    }
    const anc = pairedAncestor(p);
    if (anc) {
      const under = cands.find((c) => ancestors(c.id).includes(anc));
      if (under) return under;
    }
    return cands[0];
  };
  const root = staticParts.find((p) => !p.parent);
  if (root) take(root.id, 'root');

  // 1. Text layers by their characters: compound sets repeat the same classes, the words tell them apart.
  const textOf = (p: SpecPart) => {
    if (p.characters) return normText(p.characters);
    const prop = p.text ? o.properties?.find((x) => x.name === p.text && x.type === 'TEXT') : undefined;
    return typeof prop?.default === 'string' ? normText(prop.default) : '';
  };
  /** Every class a static part is drawn from ("Input.module.css .control, Input.module.css .md" -> control, md). */
  const classesOf = (p: SpecPart | undefined) => [...(p?.source ?? '').matchAll(/(?:^|[\s,])\.([\w-]+)/g)].map((x) => x[1]!);
  const mClasses = (m: SpecPart) => [...new Set((m.source ?? '').split(' ').filter(Boolean))];
  const shared = (p: SpecPart, m: SpecPart) => {
    const mine = new Set(classesOf(p));
    return mClasses(m).filter((c) => mine.has(c)).length;
  };
  /** Classes the static spec gives its parts: a measured part with one of them is that part's, not a classless one's. */
  const staticClasses = new Set(staticParts.flatMap((p) => classesOf(p)));
  // Both classed with no class in common, or the measured class names another static part: different elements.
  const claimedByOther = (p: SpecPart, m: SpecPart) => !shared(p, m) && mClasses(m).length > 0 && (classesOf(p).length > 0 || mClasses(m).some((c) => staticClasses.has(c)));
  for (const p of staticParts) {
    if (p.kind !== 'text' || pairs.has(p.id)) continue;
    const t = textOf(p);
    if (!t) continue;
    // Same words but another role (the current crumb `.current` against a crumb link `.link`): not the same layer.
    const hit = best(p, measured.parts.filter((m) => m.kind === 'text' && !taken.has(m.id) && normText(m.characters) === t && !(classesOf(p).length && mClasses(m).length && !shared(p, m))));
    if (hit) take(p.id, hit.id);
  }
  // The frame around a paired text (a legend, a checkbox's item) is the text's measured ancestor with the frame's
  // class, or its direct parent when the static frame has no class.
  const classOf = (p: SpecPart | undefined) => /\.([\w-]+)\s*$/.exec(p?.source ?? '')?.[1];
  for (const p of staticParts) {
    if (p.kind !== 'text' || !pairs.has(p.id) || !p.parent || pairs.has(p.parent)) continue;
    const sp = sParts.get(p.parent);
    if (!sp || sp.kind !== 'frame' || !sp.parent) continue;
    const cls = classOf(sp);
    const mp = cls ? ancestors(pairs.get(p.id)!).find((a) => (mParts.get(a)?.source ?? '').split(' ').includes(cls)) : mParts.get(pairs.get(p.id)!)?.parent;
    if (mp && mp !== 'root' && !taken.has(mp) && mParts.get(mp)?.kind === 'frame') take(sp.id, mp);
  }

  // 2. CSS class, preferring the instance under the paired parent (three checkboxes share `.box`).
  // Every class of the static part counts (a modifier like `.md` last must not hide `.control`); most shared first.
  for (const p of staticParts) {
    if (pairs.has(p.id) || !classesOf(p).length) continue;
    // Under a classed parent the render does not show (an error row), the part is not shown either.
    if (p.parent && !pairs.has(p.parent) && classesOf(sParts.get(p.parent)).length) continue;
    const all = measured.parts.filter((m) => !taken.has(m.id) && shared(p, m) > 0);
    // Under the paired parent first (the ellipsis's icon is in the ellipsis), then the most classes in common.
    const parent = p.parent ? pairs.get(p.parent) : undefined;
    const under = parent ? all.filter((m) => m.parent === parent) : [];
    const cands = under.length ? under : all;
    const most = Math.max(0, ...cands.map((m) => shared(p, m)));
    const hit = best(p, cands.filter((m) => shared(p, m) === most));
    if (hit) take(p.id, hit.id);
  }

  // 3. Kind and order under the paired parent. Static parts whose parent was not paired stay unpaired (not rendered).
  for (const p of staticParts) {
    if (pairs.has(p.id)) continue;
    if (p.parent && !pairs.has(p.parent)) continue;
    const parent = p.parent ? pairs.get(p.parent) : undefined;
    const known = p.kind === 'text' && !!textOf(p);
    const free = measured.parts.filter((m) => !taken.has(m.id) && graphic(m.kind) === graphic(p.kind) && !claimedByOther(p, m));
    // Text runs can sit deeper than the static parent (a span inside a label): any free text under the parent.
    const hit = free.find((m) => !parent || m.parent === parent) ?? (p.kind === 'text' && parent && !known ? free.find((m) => ancestors(m.id).includes(parent)) : undefined);
    if (hit) take(p.id, hit.id);
  }

  // 4. A frame holding only its text (a label, a description) renders as one text element: the static text inside
  // reads that element too (the frame keeps the box, the text the type).
  for (const p of staticParts) {
    if (pairs.has(p.id) || p.kind !== 'text' || !p.parent) continue;
    const mp = pairs.get(p.parent);
    // Only for the same words when the spec knows them (a placeholder is not the value).
    const t = textOf(p);
    if (mp && mParts.get(mp)?.kind === 'text' && staticParts.filter((x) => x.parent === p.parent).length === 1 && (!t || normText(mParts.get(mp)!.characters) === t)) pairs.set(p.id, mp);
  }
  return pairs;
}

export function compareSpecToMeasured(
  staticParts: SpecPart[],
  staticValues: SpecVariant['values'],
  measured: MeasuredSpec,
  resolve?: (tokenPath: string) => string | number | undefined,
  o: PairOptions = {},
): SpecComparison {
  const pairs = pairParts(staticParts, measured, o);
  const out: SpecComparison = { partsMatched: pairs.size, staticParts: staticParts.length, measuredParts: measured.parts.length, compared: 0, same: 0, sameToken: 0, diffs: [], unmatchedParts: [], staticOnly: 0, measuredOnly: 0 };
  const num = (v: string | number | undefined) => (typeof v === 'number' ? v : v === undefined ? undefined : /^-?[\d.]+$/.test(v.trim()) ? Number(v) : px(v));
  const near = (a: string | number | undefined, b: string | number | undefined) => {
    if (a === undefined || b === undefined) return false;
    const na0 = num(a);
    const nb0 = num(b);
    if (na0 !== undefined && nb0 !== undefined) return Math.abs(na0 - nb0) <= 0.5;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.5;
    const na = typeof a === 'string' ? (px(a) ?? normColor(a)) : a;
    const nb = typeof b === 'string' ? (px(b) ?? normColor(b)) : b;
    return typeof na === 'number' && typeof nb === 'number' ? Math.abs(na - nb) <= 0.5 : na === nb;
  };
  for (const sp of staticParts) {
    const mid = pairs.get(sp.id);
    // A part the render does not show (an optional icon, a hidden layer) is a part count difference, not field ones.
    if (!mid) {
      out.unmatchedParts.push(sp.id);
      continue;
    }
    const sv = staticValues[sp.id] ?? {};
    const mv = mid ? (measured.values[mid] ?? {}) : {};
    const mr = mid ? (measured.raw[mid] ?? {}) : {};
    const fields = new Set<SpecField>([...(Object.keys(sv) as SpecField[]), ...(Object.keys(mv) as SpecField[])]);
    for (const f of fields) {
      // Sizes the static spec leaves to auto layout (hug) are not a disagreement.
      if ((f === 'width' || f === 'height') && sv[f] === undefined) continue;
      const s = sv[f];
      const m = mv[f] !== undefined ? mv[f] : mr[f];
      if (s === undefined) {
        if (m !== undefined && m !== 0) out.measuredOnly++;
        continue;
      }
      if (m === undefined && !(f in mr)) {
        // A zero or transparent value is not measured as a field: equal to a static 0 / null.
        if (s === 0 || s === null) continue;
        const r = typeof s === 'string' && resolve ? resolve(s) : s;
        if (r === 0 || r === '0px' || r === null) continue;
        out.staticOnly++;
        out.diffs.push({ part: sp.id, field: f, static: s, same: false });
        continue;
      }
      out.compared++;
      let same = s === m;
      // The measured declaration goes through the same token (a shorthand `border: var(--border-width-default) solid`
      // keeps a number, but its chain names the token): same token.
      if (!same && typeof s === 'string' && !/^calc\(/.test(s)) same = (measured.tokens[mid]?.[f]?.chain ?? []).some((v) => sameName(v, s));
      if (same && typeof s === 'string') out.sameToken++;
      if (!same && resolve) {
        let rs = typeof s === 'string' ? (/^calc\(/.test(s) ? evalCalc(s, resolve) : resolve(s)) : typeof s === 'number' ? s : undefined;
        // A unitless line height is a multiple of the font size.
        const size = typeof mr.fontSize === 'number' ? mr.fontSize : undefined;
        if (f === 'lineHeight' && size && rs !== undefined && /^[\d.]+$/.test(String(rs).trim()) && Number(rs) < 4) rs = Number(rs) * size;
        same = near(rs, mr[f]);
      }
      if (same) out.same++;
      else out.diffs.push({ part: sp.id, field: f, static: s, measured: m ?? null, same });
    }
  }
  const root = staticValues[staticParts.find((p) => !p.parent)?.id ?? 'root'] ?? {};
  const box = measured.boxes.root;
  if (box) out.rootSize = { static: { width: typeof root.width === 'number' ? root.width : undefined, height: typeof root.height === 'number' ? root.height : undefined }, measured: { width: box.width, height: box.height } };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Story props: what a measured story was rendered with

/** One component prop as Storybook knows it (argTypes, docgen), read in the preview page. */
export interface MeasuredArgType {
  /** `enum`: a closed list of options (a Figma VARIANT axis); `boolean` (a BOOLEAN property or a Disabled state); `text`; `number`; `other` (functions, nodes). */
  kind: 'enum' | 'boolean' | 'text' | 'number' | 'other';
  options?: string[] | undefined;
  /** The component's default (docgen `defaultValue`, or the argType's `table.defaultValue`). */
  default?: string | number | boolean | undefined;
  /** Control type (`select`, `radio`, `boolean`, `text`...). */
  control?: string | undefined;
}

/** The props a story rendered with: its args over the component defaults, and the component's prop list. */
export interface MeasuredProps {
  /** Args with the component defaults applied (`{ variant: 'primary', size: 'md', disabled: false }`). Plain values only (no null). */
  props: Record<string, string | number | boolean>;
  /** The story's own args (initial args plus URL overrides), plain values only. */
  args: Record<string, string | number | boolean>;
  argTypes: Record<string, MeasuredArgType>;
  /** Component display name, when the story names one. */
  component?: string | undefined;
}

// ---------------------------------------------------------------------------------------------
// measured-specs.json

export type MeasuredState = 'hover' | 'focus-visible' | 'active';

export interface MeasuredSpecsStory {
  id: string;
  title: string;
  name: string;
  url: string;
  ms: number;
  error?: string | undefined;
  spec?: MeasuredSpec | undefined;
  /** The props the story rendered with (args over component defaults). */
  props?: MeasuredProps['props'] | undefined;
  /** Arg overrides Bridge passed to reach a variant (`{ size: 'lg', disabled: true }`); absent for the story as written. */
  overrides?: Record<string, string | number | boolean> | undefined;
  /** Pseudo state forced on the component (Chrome DevTools forced :hover / :focus-visible / :active). */
  state?: MeasuredState | undefined;
  /** The story is a gallery (several instances): `spec` is its first instance, a fallback when no single-instance story renders the variant. */
  gallery?: boolean | undefined;
  /** A story that renders the component several times: one spec per instance (`spec` is the first). */
  instances?: MeasuredSpec[] | undefined;
  /** Screenshot of the measured root (PNG, the device scale of the run), relative to measured-specs.json. */
  shot?: { file: string; width: number; height: number } | undefined;
  /** Popup stories: how the popup came to show. */
  opened?: 'already' | 'click' | 'hover' | 'focus' | 'none' | undefined;
}

/** Per Storybook component (title): its prop list, from the first story measured. */
export interface MeasuredSpecsComponent {
  title: string;
  name: string;
  argTypes: Record<string, MeasuredArgType>;
  component?: string | undefined;
  /**
   * With --variants: the args crossed, the args left out and why (`no visual effect`: changing it from its default
   * changed nothing the measure reads; `not taken`: the story does not pass it on), and whether the cap cut the product.
   */
  variantPlan?: { axes: string[]; ignored?: Record<string, string> | undefined; combos: number; capped?: boolean | undefined } | undefined;
  /** Token path -> its value in the measured page (colors `rgb()`, lengths px): the tokens the Figma side names. */
  resolved?: Record<string, string> | undefined;
}

export interface MeasuredSpecsFile {
  version: 1;
  storybook: string;
  measuredAt: string;
  stories: MeasuredSpecsStory[];
  components?: MeasuredSpecsComponent[] | undefined;
  /** With --check: one status per component for the contract screen. */
  statuses?: ComponentStatus[] | undefined;
  /** Storybook titles measured to the end, for --resume. */
  done?: string[] | undefined;
  /** With --tokens: every CSS custom property the library defines, resolved per mode, in two tiers. */
  tokens?: MeasuredTokens | undefined;
}

// ---------------------------------------------------------------------------------------------
// Token harvest: the library's variables, for a pull with no token files (any design system)

/** A Storybook global that switches a theme (light / dark), a brand or a density: one Figma mode per value. */
export interface MeasuredMode {
  /** Storybook global ("theme", "colorScheme"), or the page attribute a theme hangs on (`data-carbon-theme`). */
  global: string;
  /** Set when the mode is an attribute on the page root, not a Storybook global. */
  attribute?: boolean | undefined;
  /** Its values, the default first. */
  values: string[];
  default: string;
}

export interface MeasuredTokenProperty {
  /** The CSS custom property (`--cds-background`). */
  name: string;
  /** Variable name for Figma: the property split on dashes and camel case, library prefix dropped (`background`, `color/fg/default`). */
  path: string;
  /** Two tiers: a literal value is a primitive; a property that is another property (`var(--x)`) is semantic. */
  tier: 'primitive' | 'semantic';
  /** `expression`: a calc() or a function of variables; a primitive holding its resolved value. */
  kind: 'literal' | 'alias' | 'expression';
  type: 'color' | 'length' | 'number' | 'string';
  /** Declared value in the default mode (`var(--color-blue-500)`, `#0969da`, `calc(var(--a) * 2)`). */
  raw: string;
  /** Semantic: the property it aliases in the default mode (`--color-blue-500`). */
  aliasOf?: string | undefined;
  /** Resolved value in the default mode: colors `rgb()`/`rgba()`, lengths in px (number), others as written. */
  value: string | number;
  /** Per mode (`theme:dark`), for the globals that change this property only (every value of that global listed); `value` holds in the others. */
  values?: Record<string, string | number> | undefined;
  /** Per mode: what a semantic property aliases there, when it changes with the mode. */
  aliasOfByMode?: Record<string, string> | undefined;
  /** Selectors besides the root that declare it (a provider, a theme class): `.cds--g100`, `[data-color-mode=dark]`. */
  scopes?: string[] | undefined;
  /**
   * Semantic by value: the CSS writes a literal per theme (compiled themes: Primer, Carbon), and in every mode a
   * primitive holds that same value, so the property is an alias of those primitives.
   */
  inferred?: boolean | undefined;
  /** A measured story's value is tied to it, directly or as the target of an alias it goes through. */
  used?: boolean | undefined;
}

export interface MeasuredTokens {
  /** Story the variables were read in. */
  story: string;
  /** Library prefix stripped from paths (`cds`, `chakra`), when one is shared by most properties. */
  prefix?: string | undefined;
  modes: MeasuredMode[];
  properties: MeasuredTokenProperty[];
  counts: { properties: number; primitives: number; semantic: number; used: number; scoped: number; inferred?: number | undefined };
}

/**
 * Figma variable path of a custom property: dashes and camel case split into groups, a shared library prefix dropped
 * (`--color-fg-default` -> color/fg/default, `--cds-layer-01` with prefix cds -> layer/01, `--fgColor-muted` -> fg/color/muted).
 */
export function tokenVariablePath(name: string, prefix?: string): string {
  let parts = name
    .replace(/^--/, '')
    .split(/-+/)
    .flatMap((x) => x.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' '))
    .map((x) => x.toLowerCase())
    .filter(Boolean);
  if (prefix && parts[0] === prefix.toLowerCase() && parts.length > 1) parts = parts.slice(1);
  return parts.join('/');
}

/** The prefix most properties share (`cds`, `chakra`, `bridge`), when at least 60% of 20 or more carry it. */
export function sharedTokenPrefix(names: string[]): string | undefined {
  if (names.length < 20) return undefined;
  const counts = new Map<string, number>();
  for (const n of names) {
    const first = n.replace(/^--/, '').split('-')[0]!;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return top && n / names.length >= 0.6 ? top : undefined;
}

/**
 * Marks the properties measured stories use: every variable a value's declaration chain names, then every alias
 * target of a used property, transitively (a semantic token needs its primitive). Returns how many are used.
 */
export function markUsedTokens(tokens: MeasuredTokens, stories: Pick<MeasuredSpecsStory, 'spec' | 'instances'>[]): number {
  const byName = new Map(tokens.properties.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const use = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const p = byName.get(name);
    if (!p) return;
    p.used = true;
    for (const target of [p.aliasOf, ...Object.values(p.aliasOfByMode ?? {})]) if (target) use(target);
    // An expression's variables are its inputs.
    if (p.kind === 'expression') for (const m of p.raw.matchAll(/var\(\s*(--[\w-]+)/g)) use(m[1]!);
  };
  for (const s of stories)
    for (const spec of [s.spec, ...(s.instances ?? [])])
      for (const part of Object.values(spec?.tokens ?? {}))
        for (const t of Object.values(part ?? {})) for (const name of t?.chain ?? []) use(name);
  const used = tokens.properties.filter((p) => p.used).length;
  tokens.counts.used = used;
  return used;
}

export class MeasuredSpecsError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Reads measured-specs.json (text or parsed JSON) and checks its shape: version 1, a storybook URL, stories with ids,
 * and specs with parts and values. Throws MeasuredSpecsError with what is wrong.
 */
export function parseMeasuredSpecsFile(input: string | unknown): MeasuredSpecsFile {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new MeasuredSpecsError(`measured specs are not JSON: ${(e as Error).message}`);
    }
  }
  if (!isObj(data)) throw new MeasuredSpecsError('measured specs: expected an object');
  if (data.version !== 1) throw new MeasuredSpecsError(`measured specs: version ${String(data.version)} is not supported (expected 1)`);
  if (typeof data.storybook !== 'string') throw new MeasuredSpecsError('measured specs: storybook URL missing');
  if (!Array.isArray(data.stories)) throw new MeasuredSpecsError('measured specs: stories missing');
  data.stories.forEach((s, i) => {
    if (!isObj(s) || typeof s.id !== 'string') throw new MeasuredSpecsError(`measured specs: story ${i} has no id`);
    const specs = [s.spec, ...(Array.isArray(s.instances) ? s.instances : [])].filter((x) => x !== undefined);
    for (const sp of specs) {
      if (!isObj(sp) || !Array.isArray(sp.parts) || !isObj(sp.values)) throw new MeasuredSpecsError(`measured specs: story ${s.id} has a spec without parts and values`);
      for (const p of sp.parts as unknown[]) if (!isObj(p) || typeof p.id !== 'string' || typeof p.kind !== 'string') throw new MeasuredSpecsError(`measured specs: story ${s.id} has a part without id or kind`);
    }
    if (s.props !== undefined && !isObj(s.props)) throw new MeasuredSpecsError(`measured specs: story ${s.id} props is not an object`);
  });
  if (data.components !== undefined && !Array.isArray(data.components)) throw new MeasuredSpecsError('measured specs: components is not a list');
  if (data.tokens !== undefined) {
    const t = data.tokens;
    if (!isObj(t) || !Array.isArray(t.properties) || !Array.isArray(t.modes)) throw new MeasuredSpecsError('measured specs: tokens needs properties and modes');
    for (const p of t.properties as unknown[]) if (!isObj(p) || typeof p.name !== 'string' || typeof p.path !== 'string' || (p.tier !== 'primitive' && p.tier !== 'semantic')) throw new MeasuredSpecsError('measured specs: a token has no name, path or tier');
  }
  return data as unknown as MeasuredSpecsFile;
}
