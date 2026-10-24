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

import type { SpecField, SpecLayout, SpecPart, SpecValue } from '../component-spec';
import type { MeasuredNode, MeasuredProps, MeasuredSpec, MeasuredState, MeasuredToken } from '../measured-spec';
import { storybookIframeUrl, type StorybookIframeOptions, type StorybookIndex } from '../storybook';
import { MEASURE_SCRIPT } from './measure-script';

export { MEASURE_SCRIPT };
// The measured shapes and the comparison are browser safe (the Figma plugin reads them): re-exported for Node callers.
export * from '../measured-spec';

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
  /** Custom properties in scope at the component (root and provider elements), the pool `matched` tokens come from. */
  rootVariables: number;
  /** Of those, the ones a provider element around the story defines, not the page root (Fluent's FluentProvider). */
  scopedVariables?: number | undefined;
  viewport: { width: number; height: number };
  /** With `open`: how the popup came to show (`already`: the story renders it open), or `none`. */
  opened?: 'already' | 'click' | 'hover' | 'focus' | 'none' | undefined;
  error?: string | undefined;
}

export interface MeasuredStory extends MeasureResult {
  /** The props the story rendered with, read from Storybook's story context (args over component defaults). */
  props?: MeasuredProps | undefined;
  /** The pseudo state forced on the component, when asked and the browser could force it. */
  state?: MeasuredState | undefined;
  id: string;
  url: string;
  /** Milliseconds from navigation to measured. */
  ms: number;
}

/** The browser a measure runs in: a page that can open a URL and evaluate an expression (playwright's Page fits). */
export interface MeasurePage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
  /**
   * Forces pseudo classes on the first element matching `selector` (Chrome DevTools CSS.forcePseudoState), or clears
   * them with []. Optional: without it, `state` is not measured.
   */
  forcePseudo?(selector: string, states: string[]): Promise<boolean>;
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
   * Measure the open popup (a menu, a dialog, a select's list, a tooltip) instead of its trigger: when none shows yet,
   * the first closed trigger in the story is clicked, then hovered and focused, and the popup portaled to the body is
   * the measured root. Stories that render open (`defaultOpen` / `open` args) are measured as they are.
   */
  open?: boolean | undefined;
  /**
   * A part measured alone inside what rendered (the component, then its popups): `[role=menuitem]`, `[role=tab]`, a
   * class. For parts that only render inside a parent or a portal (a menu item, an accordion item, a toast).
   */
  within?: string | undefined;
  /** Story args to render with (`{ size: 'lg', disabled: true }`), passed in the iframe URL. */
  args?: Record<string, string | number | boolean> | undefined;
  /** A pseudo state forced on the component before it is measured (needs `MeasurePage.forcePseudo`). */
  state?: MeasuredState | undefined;
  /** Read the story's props from Storybook (default true in measureStory). */
  props?: boolean | undefined;
  /** `portal`: the newest popup outside the story root is the component (set by `open`). */
  target?: 'root' | 'portal' | undefined;
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

/**
 * Opens the story's popup when none shows: clicks the first closed trigger (pointer and mouse events in order), then
 * hovers and focuses it (tooltips), and waits for the portal to settle. Resolves with how it opened, or `none`.
 */
export const OPEN_SCRIPT = (rootSel: string) => `(async () => {
  const root = document.querySelector(${JSON.stringify(rootSel)});
  if (!root) return 'none';
  const shown = () => Array.prototype.filter.call(document.body.children, (b) => {
    if (b.contains(root) || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(b.tagName) || /sb-/.test(String(b.className || ''))) return false;
    const cs = getComputedStyle(b), r = b.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return r.width > 0 && r.height > 0 || Array.prototype.some.call(b.querySelectorAll('*'), (c) => { const x = c.getBoundingClientRect(); return x.width > 0 && x.height > 0; });
  }).length;
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const running = (document.getAnimations ? document.getAnimations() : []).filter((a) => a.playState === 'running');
      if (!running.length) break;
      await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1500))]);
    }
  };
  if (shown()) { await settle(); return 'already'; }
  const trigger = root.querySelector('[aria-haspopup]:not([aria-expanded="true"]), [aria-expanded="false"]') || root.querySelector('button, [role="button"], [role="combobox"], a[href], [tabindex="0"]');
  if (!trigger) return 'none';
  const wait = async (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (shown()) { await settle(); return true; } await new Promise((r) => setTimeout(r, 50)); } return false; };
  const r = trigger.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  const fire = (type, Ctor) => trigger.dispatchEvent(new Ctor(type, type === 'pointerdown' || type === 'mousedown' ? { ...at, buttons: 1 } : at));
  fire('pointerdown', PointerEvent); fire('mousedown', MouseEvent); fire('pointerup', PointerEvent); fire('mouseup', MouseEvent); fire('click', MouseEvent);
  if (await wait(800)) return 'click';
  fire('pointerover', PointerEvent); fire('pointerenter', PointerEvent); fire('mouseover', MouseEvent); fire('mouseenter', MouseEvent); fire('pointermove', PointerEvent); fire('mousemove', MouseEvent);
  if (await wait(1200)) return 'hover';
  try { trigger.focus(); } catch (e) {}
  if (await wait(800)) return 'focus';
  return 'none';
})()`;

/**
 * Reads the rendered story's props from Storybook's preview (7, 8, 9): its args (with URL overrides) over the component
 * defaults docgen found, and the argTypes (enum options, booleans, texts). Plain values only; null when the preview
 * exposes nothing.
 */
export const PROPS_SCRIPT = (id?: string) => `(async () => {
  const p = window.__STORYBOOK_PREVIEW__;
  if (!p) return null;
  const want = ${JSON.stringify(id ?? null)};
  let story = p.currentRender && p.currentRender.story;
  if (want && (!story || story.id !== want)) { try { story = await p.storyStoreValue.loadStory({ storyId: want }); } catch (e) { story = story || null; } }
  if (!story) return null;
  const plain = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const clean = (o) => { const out = {}; for (const k in o || {}) if (plain(o[k])) out[k] = o[k]; return out; };
  let live;
  try { live = p.storyStoreValue && p.storyStoreValue.args && p.storyStoreValue.args.get(story.id); } catch (e) {}
  const args = clean(live || story.initialArgs);
  const lit = (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') return plain(v) ? v : undefined;
    const t = v.trim();
    if (t === 'true' || t === 'false') return t === 'true';
    if (/^-?\\d+(\\.\\d+)?$/.test(t)) return Number(t);
    const q = /^(['"\`])(.*)\\1$/.exec(t);
    return q ? q[2] : undefined;
  };
  const argTypes = {}, defaults = {};
  for (const name in story.argTypes || {}) {
    const a = story.argTypes[name] || {};
    if (a.table && a.table.disable) continue;
    const t = a.type || {};
    const tn = typeof t === 'string' ? t : t.name;
    let options = Array.isArray(a.options) ? a.options : tn === 'enum' && Array.isArray(t.value) ? t.value : undefined;
    if (!options && tn === 'union' && Array.isArray(t.value) && t.value.every((x) => x && x.name === 'literal')) options = t.value.map((x) => x.value);
    if (options) options = options.filter(plain).map((x) => String(x).replace(/^(['"])(.*)\\1$/, '$2'));
    const control = a.control && typeof a.control === 'object' ? a.control.type : typeof a.control === 'string' ? a.control : undefined;
    const kind = options && options.length ? 'enum' : tn === 'boolean' || control === 'boolean' ? 'boolean' : tn === 'string' || control === 'text' ? 'text' : tn === 'number' || control === 'number' || control === 'range' ? 'number' : 'other';
    const d = lit(a.defaultValue !== undefined ? a.defaultValue : a.table && a.table.defaultValue && a.table.defaultValue.summary);
    argTypes[name] = { kind };
    if (options && options.length) argTypes[name].options = options;
    if (d !== undefined) { argTypes[name].default = d; defaults[name] = d; }
    if (control) argTypes[name].control = control;
  }
  const c = story.component;
  const component = c && (c.displayName || c.name) || undefined;
  return { props: Object.assign({}, defaults, args), args, argTypes, component };
})()`;

/**
 * Token values as the open story resolves them (on the component, so provider-scoped variables count): token path ->
 * computed value, colors as `rgb()` and lengths in px, for value-level comparison (compareSpecToMeasured's `resolve`).
 */
export async function resolveTokenValues(page: MeasurePage, vars: Record<string, string>): Promise<Record<string, string>> {
  const expr = `(() => {
    const vars = ${JSON.stringify(vars)};
    const el = document.querySelector('[data-bridge-measure-root]') || document.querySelector('#storybook-root > *, #root > *') || document.documentElement;
    const cs = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    (el.parentElement || document.body).appendChild(probe);
    const out = {};
    for (const path in vars) {
      const raw = cs.getPropertyValue(vars[path]).trim();
      if (!raw) continue;
      probe.style.color = ''; probe.style.width = '';
      probe.style.color = raw;
      if (probe.style.color) { out[path] = getComputedStyle(probe).color; continue; }
      probe.style.width = raw;
      out[path] = probe.style.width ? getComputedStyle(probe).width : raw;
    }
    probe.remove();
    return out;
  })()`;
  return (await page.evaluate<Record<string, string>>(expr)) ?? {};
}

/** Opens one story in its iframe and measures what it rendered. */
export async function measureStory(page: MeasurePage, storybook: string, id: string, o: MeasureOptions = {}): Promise<MeasuredStory> {
  const iframe = { ...(o.iframe ?? {}) };
  if (o.args && Object.keys(o.args).length) iframe.args = { ...(iframe.args ?? {}), ...Object.fromEntries(Object.entries(o.args).map(([k, v]) => [k, typeof v === 'boolean' ? `!${v}` : String(v)])) };
  const url = storybookIframeUrl(storybook, id, iframe);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: (o.timeout ?? 15000) + 15000 });
  const m = await measureRendered(page, o);
  let props: MeasuredProps | null = null;
  if (o.props !== false && m.root) props = await page.evaluate<MeasuredProps | null>(PROPS_SCRIPT(id)).catch(() => null);
  return { id, url, ...m, ...(props && typeof props === 'object' ? { props } : {}), ms: Date.now() - t0 };
}

/** Measures what the page shows now (a story already open, or re-rendered with new args): waits for it, then reads it. */
export async function measureRendered(page: MeasurePage, o: MeasureOptions = {}): Promise<MeasureResult & { ms: number; state?: MeasuredState | undefined }> {
  const t0 = Date.now();
  const root = o.root ?? '#storybook-root, #root';
  const timeout = o.timeout ?? 15000;
  const rendered = await page.evaluate<string>(WAIT_SCRIPT(root, timeout, o.unwrap === false));
  let opened: MeasureResult['opened'];
  if (o.open && rendered === 'rendered') opened = await page.evaluate<NonNullable<MeasureResult['opened']>>(OPEN_SCRIPT(root));
  const target = o.target ?? (o.open && !o.within ? 'portal' : undefined);
  const arg = { root, maxNodes: o.maxNodes, maxDepth: o.maxDepth, unwrap: o.unwrap, target, within: o.within };
  let state: MeasuredState | undefined;
  if (o.state && page.forcePseudo && rendered === 'rendered') {
    // Tag the component element, then force the state on it the way DevTools does (no pointer, no layout shift).
    const marked = await page.evaluate<{ marked?: boolean }>(`(${MEASURE_SCRIPT})(${JSON.stringify({ ...arg, mark: true })})`);
    if (marked?.marked && (await page.forcePseudo('[data-bridge-measure-root]', [o.state === 'focus-visible' ? 'focus-visible' : o.state, ...(o.state === 'focus-visible' ? ['focus'] : [])]).catch(() => false))) {
      state = o.state;
      await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))');
    }
  }
  const r = await page.evaluate<MeasureResult | { error: string }>(`(${MEASURE_SCRIPT})(${JSON.stringify(arg)})`);
  const base: MeasureResult = 'root' in r ? r : { root: null, portals: [], wrappers: 0, nodes: 0, rules: 0, sheets: { read: 0, blocked: 0 }, rootVariables: 0, viewport: { width: 0, height: 0 }, error: r.error };
  if (opened) base.opened = opened;
  if (opened === 'none' && !base.root) base.error = 'the popup did not open: no trigger in the story opened it';
  if (rendered === 'timeout' && !base.error && !base.root) base.error = `the story did not render within ${timeout} ms`;
  if (rendered === 'error' && !base.error) base.error = 'the story threw';
  if (state) await page.forcePseudo?.('[data-bridge-measure-root]', []).catch(() => false);
  return { ...base, ...(state ? { state } : {}), ms: Date.now() - t0 };
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
// Stories that show many instances at once ("Sizes", "Variants", a gallery of tags)

const SEMANTIC_CONTAINER = /^(fieldset|ul|ol|nav|form|menu|dl|select|header|footer|button|a|label|input|textarea)$/;

/**
 * A frame that only lays children out: no paint, border, shadow, radius, role or semantic tag (a Stack, a flex row, a
 * story's layout table).
 */
function plainLayout(n: MeasuredNode): boolean {
  if (n.kind !== 'frame' || n.role || n.input || n.media || SEMANTIC_CONTAINER.test(n.tag)) return false;
  const st = n.style;
  const painted = !transparent(st['background-color']) || (st['background-image'] && st['background-image'] !== 'none') || (st['box-shadow'] && st['box-shadow'] !== 'none');
  const bordered = (['top', 'right', 'bottom', 'left'] as const).some((x) => st[`border-${x}-style`] !== 'none' && (px(st[`border-${x}-width`]) ?? 0) > 0);
  return !painted && !bordered && !((px(st['border-top-left-radius']) ?? 0) > 0);
}

/** Two nodes are instances of one component: same tag and role, and a class in common (or both unclassed). */
function sameComponent(a: MeasuredNode, b: MeasuredNode): boolean {
  if (a.tag !== b.tag || a.kind !== b.kind || a.role !== b.role) return false;
  const ca = new Set((a.classes ?? []).map(localClassName));
  const cb = (b.classes ?? []).map(localClassName);
  if (!ca.size && !cb.length) return true;
  return cb.some((c) => ca.has(c));
}

/** Re-bases a subtree's boxes on its own top-left corner. */
function rebase(n: MeasuredNode, dx = n.box.x, dy = n.box.y): MeasuredNode {
  return { ...n, box: { ...n.box, x: Math.round((n.box.x - dx) * 100) / 100, y: Math.round((n.box.y - dy) * 100) / 100 }, children: n.children.map((c) => rebase(c, dx, dy)) };
}

/**
 * The instances of a story that renders a component several times (a "Sizes" story, a row of tags, a matrix table of
 * colors by sizes): under layout-only frames, captions aside, the components found, when most are the same component.
 * Returns [] for a story that renders one component: a radio group's radios are its own parts (the group has a role,
 * so it is the component, not a layout).
 */
export function splitInstances(root: MeasuredNode | null): MeasuredNode[] {
  if (!root || !plainLayout(root)) return [];
  const found: MeasuredNode[] = [];
  const collect = (n: MeasuredNode, depth: number) => {
    for (const c of n.children) {
      if (c.kind === 'text') continue; // captions ("sm", "Solid") beside the instances
      if (plainLayout(c) && depth < 8 && c.children.length) collect(c, depth + 1);
      else if (!plainLayout(c)) found.push(c);
    }
  };
  collect(root, 0);
  if (found.length < 2) return [];
  let best: MeasuredNode[] = [];
  for (const k of found) {
    if (best.includes(k)) continue;
    const run = found.filter((c) => sameComponent(k, c));
    if (run.length > best.length) best = run;
  }
  if (best.length < 2 || best.length * 2 < found.length) return [];
  return best.map((n) => rebase(n));
}

// ---------------------------------------------------------------------------------------------
// Measure -> spec shape

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
