// Storybook measure: what a story really draws, read from the browser instead of guessed from the CSS source.
//
// The static generator (component-specs.ts) reads our TSX and CSS modules and predicts the layer tree; it only works on
// libraries written the way ours is. A measure opens a story's iframe in a headless browser and records the rendered
// tree: element boxes, auto layout (flex direction, gap, padding, alignment), paint, radii, borders, typography, text,
// and which CSS custom properties (tokens) each value resolves through. Any React library with a Storybook can be
// measured, whatever its styling (CSS modules, Sass, Tailwind, CSS-in-JS).
//
// The browser is injected (MeasurePage): core has no browser dependency. The CLI drives an installed Chrome through
// playwright-core (bridge specs --measure). measuredToSpec turns a measure into the shape the Figma pull reads from
// component-specs.json (parts + per-part field values with token paths), plus the raw values and token evidence a
// spec does not carry.

import type { SpecField, SpecLayout, SpecPart, SpecValue, SpecVariant } from '../component-spec';
import { storybookIframeUrl, type StorybookIframeOptions, type StorybookIndex } from '../storybook';
import { MEASURE_SCRIPT } from './measure-script';

export { MEASURE_SCRIPT };

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
  children: MeasuredNode[];
}

/** The script's answer for one page. */
export interface MeasureResult {
  root: MeasuredNode | null;
  /** Visible elements outside the story root (popups portaled to the body), up to 3. */
  portals: MeasuredNode[];
  /** Plain wrapper elements skipped above the root (decorators). */
  wrappers: number;
  nodes: number;
  /** Style rules read, and stylesheets that could not be read (cross-origin). */
  rules: number;
  sheets: { read: number; blocked: number };
  /** Custom properties defined at the root, the pool `matched` tokens come from. */
  rootVariables: number;
  viewport: { width: number; height: number };
  error?: string | undefined;
}

export interface MeasuredStory extends MeasureResult {
  id: string;
  url: string;
  /** Milliseconds from navigation to measured. */
  ms: number;
}

/** The browser a measure runs in: a page that can open a URL and evaluate an expression (playwright's Page fits). */
export interface MeasurePage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
}

export interface MeasureOptions {
  iframe?: StorybookIframeOptions | undefined;
  /** Root selector inside the iframe (`#storybook-root, #root`: Storybook 7+ then 6). */
  root?: string | undefined;
  maxNodes?: number | undefined;
  maxDepth?: number | undefined;
  /** Longest wait for the story to render, ms (default 15000). */
  timeout?: number | undefined;
  /**
   * Go down from the root through plain wrappers and viewport-size decorator canvases to the component (default true).
   * false: the root element is the component.
   */
  unwrap?: boolean | undefined;
}

/**
 * Waits until the story has rendered: Storybook's root has content (or its error screen shows), fonts are loaded and
 * the markup stops changing for a few frames. Resolves with `rendered`, `error` or `timeout`.
 */
export const WAIT_SCRIPT = (rootSel: string, timeout: number, self = false) => `(async () => {
  const t0 = performance.now();
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const host = () => document.querySelector(${JSON.stringify(rootSel)});
  let state = 'timeout';
  while (performance.now() - t0 < ${timeout}) {
    if (document.body && document.body.classList.contains('sb-show-errordisplay')) { state = 'error'; break; }
    const h = host();
    if (h && (${self} || h.children.length || (h.textContent || '').trim())) { state = 'rendered'; break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]); } catch (e) {}
  let last = '', same = 0;
  while (state === 'rendered' && same < 3 && performance.now() - t0 < ${timeout} + 3000) {
    await frame();
    await new Promise((r) => setTimeout(r, 60));
    const s = document.body.innerHTML.length + ':' + document.querySelectorAll('*').length;
    same = s === last ? same + 1 : 0;
    last = s;
  }
  return state;
})()`;

/** Opens one story in its iframe and measures what it rendered. */
export async function measureStory(page: MeasurePage, storybook: string, id: string, o: MeasureOptions = {}): Promise<MeasuredStory> {
  const url = storybookIframeUrl(storybook, id, o.iframe ?? {});
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: (o.timeout ?? 15000) + 15000 });
  return { id, url, ...(await measureRendered(page, o)), ms: Date.now() - t0 };
}

/** Measures what the page shows now (a story already open, or re-rendered with new args): waits for it, then reads it. */
export async function measureRendered(page: MeasurePage, o: MeasureOptions = {}): Promise<MeasureResult & { ms: number }> {
  const t0 = Date.now();
  const root = o.root ?? '#storybook-root, #root';
  const timeout = o.timeout ?? 15000;
  const state = await page.evaluate<string>(WAIT_SCRIPT(root, timeout, o.unwrap === false));
  const arg = { root, maxNodes: o.maxNodes, maxDepth: o.maxDepth, unwrap: o.unwrap };
  const r = await page.evaluate<MeasureResult | { error: string }>(`(${MEASURE_SCRIPT})(${JSON.stringify(arg)})`);
  const base: MeasureResult = 'root' in r ? r : { root: null, portals: [], wrappers: 0, nodes: 0, rules: 0, sheets: { read: 0, blocked: 0 }, rootVariables: 0, viewport: { width: 0, height: 0 }, error: r.error };
  if (state === 'timeout' && !base.error && !base.root) base.error = `the story did not render within ${timeout} ms`;
  if (state === 'error' && !base.error) base.error = 'the story threw';
  return { ...base, ms: Date.now() - t0 };
}

export interface StoryPick {
  id: string;
  title: string;
  name: string;
}

export interface PickStoriesOptions {
  /** Components by name or title, case-insensitive ("Button", "Forms/Input"). */
  only?: string[] | undefined;
  /** Exact story ids; replaces `only` and `perComponent`. */
  ids?: string[] | undefined;
  /** Stories per component, in index order (default 3). */
  perComponent?: number | undefined;
}

/** The stories a measure opens: given ids, else the first stories of each (selected) component. */
export function pickStoriesToMeasure(index: StorybookIndex, o: PickStoriesOptions = {}): StoryPick[] {
  if (o.ids?.length) {
    const byId = new Map(index.entries.map((e) => [e.id, e]));
    return o.ids.map((id) => {
      const e = byId.get(id);
      return { id, title: e?.title ?? '', name: e?.name ?? id };
    });
  }
  const want = (o.only ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const per = o.perComponent ?? 3;
  return index.components
    .filter((c) => c.stories.length && (!want.length || want.includes(c.name.toLowerCase()) || want.includes(c.title.toLowerCase())))
    .flatMap((c) => c.stories.slice(0, per).map((e) => ({ id: e.id, title: c.title, name: e.name })));
}

// ---------------------------------------------------------------------------------------------
// Measure -> spec shape

/** A measure in the Figma pull's shape: the parts of one variant and their field values, plus what a spec leaves out. */
export interface MeasuredSpec {
  story: string;
  parts: SpecPart[];
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
}

export interface MeasuredToSpecOptions {
  /** CSS custom property -> token path. Default: the name without `--`, dashes as dots (`--space-2` -> `space.2`); private names (`--_bg`) are not tokens. */
  tokenOf?: ((cssVar: string) => string | undefined) | undefined;
}

/**
 * CSS module local name from a built class: Vite (`_label_aukrr_131`, `_label_1x2y3`), webpack and Next
 * (`Button_label__a1b2c`, `Button-module__label__a1b2c`), a prefixed scheme (`prc-Button-Label-pTQ3x`). Other classes come
 * back as they are.
 */
export function localClassName(cls: string): string {
  const m =
    /^_([A-Za-z][\w-]*?)_[A-Za-z0-9]{5,8}_\d+$/.exec(cls) ??
    /^[A-Za-z][\w-]*?(?:-module)?_{1,2}([A-Za-z][\w-]*?)__[\w-]{5,8}$/.exec(cls) ??
    /^(?:[a-z]+-)?[A-Z][A-Za-z0-9]*-([A-Za-z]\w*)-[A-Za-z0-9_]{5}$/.exec(cls) ??
    /^_?([A-Za-z][\w-]*?)_[A-Za-z0-9-]{5,8}$/.exec(cls);
  return m ? m[1]! : cls;
}

const defaultTokenOf = (v: string) => (/^--_/.test(v) ? undefined : v.replace(/^--/, '').split('-').filter(Boolean).join('.'));
const px = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)px$/.exec(v.trim());
  return m ? Math.round(Number(m[1]) * 100) / 100 : undefined;
};
const transparent = (v: string | undefined) => !v || v === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(v);

/** Auto layout of a measured element, as the pull reads it. */
export function measuredLayout(style: Record<string, string>): SpecLayout | undefined {
  const d = style.display ?? '';
  if (!/flex|grid|block|inline-block|list-item/.test(d)) return undefined;
  const flex = /flex/.test(d);
  const dir = style['flex-direction'] ?? 'row';
  const direction = flex && dir.startsWith('row') ? 'HORIZONTAL' : 'VERTICAL';
  const j = style['justify-content'] ?? 'normal';
  const a = style['align-items'] ?? 'normal';
  const primary: SpecLayout['primary'] = !flex ? 'MIN' : /space-between/.test(j) ? 'SPACE_BETWEEN' : /center/.test(j) ? 'CENTER' : /end|right/.test(j) ? 'MAX' : 'MIN';
  const counter: SpecLayout['counter'] = /center/.test(a) ? 'CENTER' : /end/.test(a) ? 'MAX' : /^(flex-)?start|baseline/.test(a) ? 'MIN' : 'STRETCH';
  const out: SpecLayout = { direction, primary, counter };
  if (flex && /reverse/.test(dir)) out.reverse = true;
  if (flex && direction === 'HORIZONTAL' && style['flex-wrap'] === 'wrap') out.wrap = true;
  return out;
}

const FIELD_MAP: [SpecField, string][] = [
  ['fill', 'background-color'],
  ['cornerRadius', 'border-top-left-radius'],
  ['paddingTop', 'padding-top'],
  ['paddingRight', 'padding-right'],
  ['paddingBottom', 'padding-bottom'],
  ['paddingLeft', 'padding-left'],
  ['minWidth', 'min-width'],
  ['minHeight', 'min-height'],
  ['opacity', 'opacity'],
];
const TEXT_MAP: [SpecField, string][] = [
  ['textFill', 'color'],
  ['fontFamily', 'font-family'],
  ['fontSize', 'font-size'],
  ['fontWeight', 'font-weight'],
  ['lineHeight', 'line-height'],
  ['letterSpacing', 'letter-spacing'],
];

/**
 * Turns a measured story into the spec shape: one part per drawn element (wrappers that draw nothing are kept as
 * frames, text runs become text parts), values bound to the declared token when there is one.
 */
export function measuredToSpec(m: Pick<MeasuredStory, 'id' | 'root'>, o: MeasuredToSpecOptions = {}): MeasuredSpec {
  const tokenOf = o.tokenOf ?? defaultTokenOf;
  const out: MeasuredSpec = { story: m.id, parts: [], values: {}, raw: {}, tokens: {}, boxes: {}, coverage: { fields: 0, declared: 0, matched: 0, literal: 0 } };
  if (!m.root) return out;
  const used = new Set<string>();
  const idFor = (n: MeasuredNode, isRoot: boolean, inherited?: string) => {
    if (isRoot) return 'root';
    const cls = (n.classes ?? []).map(localClassName).find((c) => /^[A-Za-z]/.test(c) && c.length < 40);
    let base = cls ?? (n.kind === 'text' ? (inherited ? `${inherited}-text` : 'text') : n.kind === 'icon' ? 'icon' : n.tag);
    base = base.replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase() || 'part';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return id;
  };
  const visit = (n: MeasuredNode, parent: string | undefined, parentStyle: Record<string, string> | undefined) => {
    const id = idFor(n, !parent, parent);
    const style = n.kind === 'text' && n.tag === '#text' ? (parentStyle ?? {}) : n.style;
    const tokens = n.kind === 'text' && n.tag === '#text' ? {} : n.tokens;
    const part: SpecPart = { id, name: id === 'root' ? 'Root' : id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), kind: n.kind };
    if (parent) part.parent = parent;
    if (n.classes?.length) part.source = n.classes.map(localClassName).join(' ');
    if (n.kind === 'frame') {
      const l = measuredLayout(n.style);
      if (l) part.layout = l;
      if (/^(hidden|clip)/.test(n.style.overflow ?? '')) part.clip = true;
      if (n.style.position === 'absolute' && parent) part.pin = {};
      if (Number(n.style['flex-grow']) > 0) part.grow = true;
    }
    if (n.kind === 'text') part.characters = n.text ?? '';
    out.parts.push(part);
    out.boxes[id] = n.box;
    const values: Partial<Record<SpecField, SpecValue>> = {};
    const raw: Partial<Record<SpecField, string | number>> = {};
    const ev: Partial<Record<SpecField, MeasuredToken>> = {};
    const put = (field: SpecField, prop: string, literal: string | number | null | undefined) => {
      if (literal === undefined) return;
      out.coverage.fields++;
      if (literal !== null) raw[field] = literal;
      const t = tokens[prop];
      if (t) ev[field] = t;
      // Bound only when the declaration is the variable itself; a calc() or a shorthand mixing it keeps the number.
      if (t?.via === 'declared' && t.exact) {
        out.coverage.declared++;
        // The first link that is a token: private variables (`--_bg`) hand over to what they alias.
        const path = t.chain.map(tokenOf).find((x): x is string => !!x);
        if (path) return void (values[field] = path);
      } else if (t?.via === 'declared') out.coverage.declared++;
      else if (t?.via === 'matched') out.coverage.matched++;
      else out.coverage.literal++;
      if (literal === null) values[field] = null;
      else if (typeof literal === 'number') values[field] = literal;
    };
    if (n.kind === 'frame') {
      for (const [field, prop] of FIELD_MAP) {
        const v = n.style[prop];
        if (field === 'fill') put(field, prop, transparent(v) ? (n.style['background-image'] && n.style['background-image'] !== 'none' ? n.style['background-image'] : undefined) : v);
        else if (field === 'opacity') put(field, prop, v && Number(v) < 1 ? Number(v) : undefined);
        else if (field === 'minWidth' || field === 'minHeight') {
          // Figma minimums include padding and border; CSS ones do only under border-box.
          const sides = field === 'minWidth' ? (['left', 'right'] as const) : (['top', 'bottom'] as const);
          const extra = n.style['box-sizing'] === 'content-box' ? sides.reduce((a, x) => a + (px(n.style[`padding-${x}`]) ?? 0) + (n.style[`border-${x}-style`] === 'none' ? 0 : (px(n.style[`border-${x}-width`]) ?? 0)), 0) : 0;
          const min = px(v);
          if (!min) continue;
          if (extra) {
            out.coverage.fields++;
            out.coverage.literal++;
            raw[field] = min + extra;
            values[field] = min + extra;
          } else put(field, prop, min);
        }
        else put(field, prop, px(v) || undefined); // zero paddings and radii are Figma's default: not a field
      }
      const widths = (['top', 'right', 'bottom', 'left'] as const).map((s) => (n.style[`border-${s}-style`] === 'none' ? 0 : (px(n.style[`border-${s}-width`]) ?? 0)));
      if (widths.some((w) => w > 0)) {
        const side = widths.findIndex((w) => w > 0);
        const s = (['top', 'right', 'bottom', 'left'] as const)[side]!;
        const color = n.style[`border-${s}-color`];
        put('stroke', `border-${s}-color`, transparent(color) ? null : color);
        if (widths.every((w) => w === widths[0])) put('strokeWeight', 'border-top-width', widths[0]);
        else (['top', 'right', 'bottom', 'left'] as const).forEach((x, i) => put(({ top: 'strokeTopWeight', right: 'strokeRightWeight', bottom: 'strokeBottomWeight', left: 'strokeLeftWeight' } as const)[x], `border-${x}-width`, widths[i]));
      }
      const l = part.layout;
      if (l && /flex|grid/.test(n.style.display ?? '')) {
        const gap = l.direction === 'HORIZONTAL' ? n.style['column-gap'] : n.style['row-gap'];
        put('itemSpacing', l.direction === 'HORIZONTAL' ? 'column-gap' : 'row-gap', px(gap) || undefined);
        if (l.wrap) put('counterAxisSpacing', 'row-gap', px(n.style['row-gap']) || undefined);
      }
      put('width', 'width', n.box.width);
      put('height', 'height', n.box.height);
    }
    if (n.kind === 'text') {
      for (const [field, prop] of TEXT_MAP) {
        const v = style[prop];
        if (!v || v === 'normal') continue;
        put(field, prop, field === 'textFill' || field === 'fontFamily' ? v : field === 'fontWeight' ? Number(v) : px(v));
      }
      const deco = style['text-decoration-line'];
      if (deco && /underline|line-through/.test(deco)) raw.textDecoration = /underline/.test(deco) ? 'UNDERLINE' : 'STRIKETHROUGH';
    }
    if (n.kind === 'icon' || n.kind === 'vector') {
      put('width', 'width', n.box.width);
      put('height', 'height', n.box.height);
      // Outline icons (Lucide, Carbon) paint with stroke, solid ones (Primer octicons) with fill; currentColor reads as color.
      const stroked = !!n.style.stroke && n.style.stroke !== 'none';
      const prop = stroked ? 'stroke' : 'fill';
      const paint = n.style[prop];
      if (paint && paint !== 'none') put(stroked ? 'stroke' : 'fill', n.tokens[prop] ? prop : 'color', /currentcolor/i.test(paint) ? n.style.color : paint);
      if (stroked) put('strokeWeight', 'stroke-width', px(n.style['stroke-width']) ?? (Number(n.style['stroke-width']) || undefined));
    }
    if (Object.keys(values).length) out.values[id] = values;
    if (Object.keys(raw).length) out.raw[id] = raw;
    if (Object.keys(ev).length) out.tokens[id] = ev;
    for (const c of n.children) visit(c, id, n.style);
  };
  visit(m.root, undefined, undefined);
  return out;
}

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
export function compareSpecToMeasured(
  staticParts: SpecPart[],
  staticValues: SpecVariant['values'],
  measured: MeasuredSpec,
  resolve?: (tokenPath: string) => string | number | undefined,
): SpecComparison {
  const byClass = new Map<string, string>();
  for (const p of measured.parts) for (const c of (p.source ?? '').split(' ')) if (c && !byClass.has(c)) byClass.set(c, p.id);
  const pairs = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of staticParts) {
    if (!p.parent) {
      pairs.set(p.id, 'root');
      taken.add('root');
      continue;
    }
    const cls = /\.([\w-]+)\s*$/.exec(p.source ?? '')?.[1];
    const hit = cls ? byClass.get(cls) : undefined;
    if (hit && !taken.has(hit)) {
      pairs.set(p.id, hit);
      taken.add(hit);
    }
  }
  for (const p of staticParts) {
    if (pairs.has(p.id)) continue;
    const parent = p.parent ? pairs.get(p.parent) : undefined;
    const hit = measured.parts.find((m) => !taken.has(m.id) && m.kind === p.kind && (!parent || m.parent === parent || p.kind === 'text'));
    if (hit) {
      pairs.set(p.id, hit.id);
      taken.add(hit.id);
    }
  }
  const out: SpecComparison = { partsMatched: pairs.size, staticParts: staticParts.length, measuredParts: measured.parts.length, compared: 0, same: 0, sameToken: 0, diffs: [], unmatchedParts: [], staticOnly: 0, measuredOnly: 0 };
  const num = (v: string | number | undefined) => (typeof v === 'number' ? v : v === undefined ? undefined : /^-?[\d.]+$/.test(v.trim()) ? Number(v) : px(v));
  const near = (a: string | number | undefined, b: string | number | undefined) => {
    if (a === undefined || b === undefined) return false;
    const na0 = num(a);
    const nb0 = num(b);
    if (na0 !== undefined && nb0 !== undefined) return Math.abs(na0 - nb0) <= 0.5;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.5;
    const na = typeof a === 'string' ? (px(a) ?? a.replace(/\s+/g, '')) : a;
    const nb = typeof b === 'string' ? (px(b) ?? b.replace(/\s+/g, '')) : b;
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
