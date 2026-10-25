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

import type { SpecField, SpecLayout, SpecValue } from '../component-spec';
import { sharedTokenPrefix, tokenVariablePath, type MeasuredBox, type MeasuredMode, type MeasuredNode, type MeasuredPart, type MeasuredProps, type MeasuredSpec, type MeasuredState, type MeasuredToken, type MeasuredTokenProperty, type MeasuredTokens } from '../measured-spec';
import { storybookIframeUrl, type StorybookIframeOptions, type StorybookIndex } from '../storybook';
import { MEASURE_SCRIPT } from './measure-script';
import { GLOBALS_SCRIPT, TOKENS_SCRIPT } from './tokens-script';

export { MEASURE_SCRIPT, TOKENS_SCRIPT, GLOBALS_SCRIPT };
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
  /** The root is block-level and spans its container (or is width: 100%): it fills in Figma, it does not hug. */
  rootFill?: boolean | undefined;
  /** A filling root was laid out at this width (px) for the measure and its screenshot, not the canvas width. */
  fillWidth?: number | undefined;
  /** With `open`: how the popup came to show (`already`: the story renders it open), or `none`. */
  opened?: 'already' | 'click' | 'hover' | 'focus' | 'none' | undefined;
  error?: string | undefined;
}

export interface MeasuredStory extends MeasureResult {
  /** With `shot`: the PNG written and the root's size in CSS pixels. */
  shot?: { file: string; width: number; height: number } | undefined;
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
   * Forces pseudo classes on every element matching `selector` (Chrome DevTools CSS.forcePseudoState), or clears
   * them with []. Optional: without it, `state` is not measured.
   */
  forcePseudo?(selector: string, states: string[]): Promise<boolean>;
  /** PNG of the first element matching `selector`, written to `file`; its size in CSS pixels. Optional (shots). */
  screenshot?(selector: string, file: string): Promise<{ width: number; height: number } | null>;
}

/**
 * Tags the element a measure with these options reads (`data-bridge-measure-root`): the component after wrappers, the
 * popup, or the `within` part. For a screenshot of exactly what was measured.
 */
export async function markMeasuredRoot(page: MeasurePage, o: Pick<MeasureOptions, 'root' | 'unwrap' | 'within' | 'target' | 'open'> = {}): Promise<boolean> {
  const arg = { root: o.root ?? '#storybook-root, #root', unwrap: o.unwrap, within: o.within, target: o.target ?? (o.open && !o.within ? 'portal' : undefined), mark: true };
  const r = await page.evaluate<{ marked?: boolean } | null>(`(${MEASURE_SCRIPT})(${JSON.stringify(arg)})`).catch(() => null);
  return !!r?.marked;
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
  /** Width a filling root is laid out at when it spans the canvas (default 400 px; 0 keeps the canvas width). */
  fillWidth?: number | undefined;
  /** Write a PNG of the measured root to this file (needs `MeasurePage.screenshot`), forced state included. */
  shot?: string | undefined;
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
  // Settle briefly: the markup stops changing for a few frames, or 1.5 s passes (a spinner never stops).
  let last = '', same = 0;
  const settle0 = performance.now();
  while (state === 'rendered' && same < 3 && performance.now() - settle0 < 1500) {
    await frame();
    await new Promise((r) => setTimeout(r, 60));
    const s = document.body.innerHTML.length + ':' + document.querySelectorAll('*').length;
    same = s === last ? same + 1 : 0;
    last = s;
  }
  // Animations: finished ones jump to their end, endless ones (a loading spinner) are paused where they are.
  try { (document.getAnimations ? document.getAnimations() : []).forEach((a) => { try { a.finish(); } catch (e) { a.pause(); } }); } catch (e) {}
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
  const plain = (v) => ['string', 'number', 'boolean'].includes(typeof v);
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

/**
 * Where a forced state goes: the component and every element in it, as Figma's state variant shows it (a group's
 * Hover shows each option's hover, a field's Hover its control's hover), not only the outer element.
 */
const STATE_TARGETS = '[data-bridge-measure-root], [data-bridge-measure-root] *';

/** The pseudo classes a real interaction sets: a press is also a hover, focus-visible is also focus. */
const PSEUDO_CLASSES: Record<MeasuredState, string[]> = { hover: ['hover'], 'focus-visible': ['focus-visible', 'focus'], active: ['active', 'hover'] };

// ---------------------------------------------------------------------------------------------
// Token harvest

/** Storybook globals that are modes in Figma: a theme or color scheme, a brand, a density. */
const MODE_GLOBAL = /theme|scheme|mode|brand|density|appearance/i;
const ALIAS = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/;

interface RawTokenProperty {
  name: string;
  raw: string;
  applies: boolean;
  type: MeasuredTokenProperty['type'];
  value: string | number;
  scopes: string[];
}

export interface HarvestOptions {
  iframe?: StorybookIframeOptions | undefined;
  /** Read every mode the Storybook's globals expose (default true). */
  modes?: boolean | undefined;
  timeout?: number | undefined;
}

/**
 * Every CSS custom property a Storybook's stylesheets define, read in one story: its declared value where the story
 * sits (providers included), resolved there, in two tiers (a literal is a primitive, `var(--x)` is semantic), and again
 * under each theme, brand or density global the Storybook exposes (one Figma mode per value).
 */
export async function harvestTokens(page: MeasurePage, storybook: string, story: string, o: HarvestOptions = {}): Promise<MeasuredTokens> {
  const timeout = o.timeout ?? 15000;
  const read = async (globals: Record<string, string>) => {
    const iframe = { ...(o.iframe ?? {}), globals: { ...(o.iframe?.globals ?? {}), ...globals } };
    await page.goto(storybookIframeUrl(storybook, story, iframe), { waitUntil: 'domcontentloaded', timeout: timeout + 15000 });
    await page.evaluate<string>(WAIT_SCRIPT('#storybook-root, #root', timeout));
    const r = await page.evaluate<{ properties: RawTokenProperty[] } | null>(`(${TOKENS_SCRIPT})({})`);
    return r?.properties ?? [];
  };
  const base = await read({});
  // A theme on a page attribute: set it where it lives (the root when nowhere), let styles apply, read again.
  let moved = false;
  const readWithAttribute = async (attr: string, value: string) => {
    // Back to the default globals first if a global mode moved the page.
    if (moved) {
      await read({});
      moved = false;
    }
    await page.evaluate(`(async () => { const els = document.querySelectorAll('[${attr}]'); (els.length ? Array.from(els) : [document.documentElement]).forEach((e) => e.setAttribute('${attr}', ${JSON.stringify(value)})); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
    const r = await page.evaluate<{ properties: RawTokenProperty[] } | null>(`(${TOKENS_SCRIPT})({})`);
    return r?.properties ?? [];
  };
  const found = o.modes === false ? [] : ((await page.evaluate<MeasuredMode[] | null>(GLOBALS_SCRIPT).catch(() => null)) ?? []);
  // Views that are not a theme (Primer's "all" shows every scheme side by side).
  const modes: MeasuredMode[] = found
    .filter((m) => MODE_GLOBAL.test(m.global))
    .map((m) => ({ ...m, values: [m.default, ...m.values.filter((v) => v !== m.default)].filter((v) => !/^(all|side-?by-?side|stacked|both|none)$/i.test(v)) }))
    .filter((m) => m.values.length >= 2);
  // No theme global: a theme the stylesheets hang on a page attribute ([data-carbon-theme="g100"]), read by setting it.
  if (o.modes !== false && !modes.some((m) => /theme|scheme|mode/i.test(m.global))) {
    const attrs = new Map<string, Map<string, number>>();
    for (const p of base)
      for (const sel of p.scopes)
        for (const part of sel.split(','))
          for (const m of part.trim().matchAll(/^(?::root|html|body)?\[([\w-]+)=["']?([\w-]+)["']?\]$/g)) {
            const vals = attrs.get(m[1]!) ?? new Map<string, number>();
            vals.set(m[2]!, (vals.get(m[2]!) ?? 0) + 1);
            attrs.set(m[1]!, vals);
          }
    for (const [attr, vals] of attrs) {
      const values = [...vals.entries()].filter(([, n]) => n >= 10).map(([v]) => v);
      if (values.length < 2 || values.length > 12 || !MODE_GLOBAL.test(attr)) continue;
      const current = await page.evaluate<string | null>(`(() => { const e = document.querySelector('[${attr}]'); return e && e.getAttribute('${attr}'); })()`).catch(() => null);
      // The value the page shows now is the default mode (Carbon's white lives in :root, not under its attribute).
      const def = current ?? values[0]!;
      modes.push({ global: attr, attribute: true, values: [def, ...values.filter((v) => v !== def)], default: def });
    }
  }
  const prefix = sharedTokenPrefix(base.map((p) => p.name));
  const props: MeasuredTokenProperty[] = base.map((p) => {
    const alias = ALIAS.exec(p.raw)?.[1];
    const kind: MeasuredTokenProperty['kind'] = alias ? 'alias' : /var\(/.test(p.raw) ? 'expression' : 'literal';
    return {
      name: p.name,
      path: tokenVariablePath(p.name, prefix),
      tier: alias ? 'semantic' : 'primitive',
      kind,
      type: p.type,
      raw: p.raw,
      ...(alias ? { aliasOf: alias } : {}),
      value: p.value,
      ...(p.scopes.length ? { scopes: p.scopes } : {}),
    };
  });
  const byName = new Map(props.map((p) => [p.name, p]));
  for (const m of modes) {
    for (const value of m.values) {
      const key = `${m.global}:${value}`;
      const rows = value === m.default ? base : m.attribute ? await readWithAttribute(m.global, value) : ((moved = true), await read({ [m.global]: value }));
      for (const r of rows) {
        const p = byName.get(r.name);
        if (!p) continue;
        (p.values ??= {})[key] = r.value;
        const alias = ALIAS.exec(r.raw)?.[1];
        if (p.tier === 'semantic' && alias && alias !== p.aliasOf) (p.aliasOfByMode ??= {})[key] = alias;
      }
    }
  }
  // Per property, keep a mode's values only where they change it (`value` holds for the others): Primer has thousands.
  for (const p of props) {
    for (const m of modes) {
      const keys = m.values.map((v) => `${m.global}:${v}`);
      if (new Set(keys.map((k) => JSON.stringify(p.values?.[k]))).size <= 1) for (const k of keys) delete p.values?.[k];
    }
    if (p.values && !Object.keys(p.values).length) delete p.values;
  }
  // A mode that changes nothing is not a mode of these variables.
  const live = modes.filter((m) => props.some((p) => p.values && `${m.global}:${m.default}` in p.values));
  if (live.length !== modes.length) {
    const dead = new Set(modes.filter((m) => !live.includes(m)).map((m) => m.global));
    for (const p of props) {
      for (const k of Object.keys(p.values ?? {})) if (dead.has(k.split(':')[0]!)) delete p.values![k];
      for (const k of Object.keys(p.aliasOfByMode ?? {})) if (dead.has(k.split(':')[0]!)) delete p.aliasOfByMode![k];
      if (p.values && !Object.keys(p.values).length) delete p.values;
      if (p.aliasOfByMode && !Object.keys(p.aliasOfByMode).length) delete p.aliasOfByMode;
    }
  }
  // Compiled themes write each semantic token as a literal per theme. When a primitive (the same in every mode) holds
  // the value in every mode, the property is a semantic alias of it: Primitives + Semantic, as Figma needs.
  const keyOf = (p: MeasuredTokenProperty, v: string | number) => `${p.type}:${v}`;
  const primitiveFor = new Map<string, string>();
  for (const p of [...props].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)))
    if (p.kind === 'literal' && !p.values && (p.type === 'color' || p.type === 'length') && !primitiveFor.has(keyOf(p, p.value))) primitiveFor.set(keyOf(p, p.value), p.name);
  let inferred = 0;
  for (const p of props) {
    if (p.kind !== 'literal' || !p.values) continue;
    const def = primitiveFor.get(keyOf(p, p.value));
    const byMode = Object.entries(p.values).map(([k, v]) => [k, primitiveFor.get(keyOf(p, v))] as const);
    if (!def || def === p.name || byMode.some(([, n]) => !n)) continue;
    p.tier = 'semantic';
    p.kind = 'alias';
    p.aliasOf = def;
    p.inferred = true;
    const changes = byMode.filter(([, n]) => n !== def);
    if (changes.length) p.aliasOfByMode = Object.fromEntries(byMode) as Record<string, string>;
    inferred++;
  }
  return {
    story,
    ...(prefix ? { prefix } : {}),
    modes: live,
    properties: props,
    counts: {
      properties: props.length,
      primitives: props.filter((p) => p.tier === 'primitive').length,
      semantic: props.filter((p) => p.tier === 'semantic').length,
      used: 0,
      scoped: props.filter((p) => p.scopes?.length).length,
      inferred,
    },
  };
}

/**
 * Makes sure the story renders with these args. Storybook drops URL args it cannot validate against a story's initial
 * args (Carbon's Button story declares none), so when the store does not hold them after the first render they are
 * sent the way the Controls panel sends them (`updateStoryArgs`), and the re-render is awaited. Resolves `url` (the URL
 * args held), `channel`, or `failed`.
 */
export const APPLY_ARGS_SCRIPT = (id: string, args: Record<string, string | number | boolean>, timeout: number) => `(async () => {
  const want = ${JSON.stringify(args)};
  const t0 = performance.now();
  let p = window.__STORYBOOK_PREVIEW__;
  while ((!p || !p.currentRender || !p.storyStoreValue) && performance.now() - t0 < ${timeout}) { await new Promise((r) => setTimeout(r, 50)); p = window.__STORYBOOK_PREVIEW__; }
  if (!p || !p.storyStoreValue) return 'failed';
  const id = ${JSON.stringify(id)};
  const held = () => { let a = {}; try { a = p.storyStoreValue.args.get(id) || {}; } catch (e) {} return Object.keys(want).every((k) => a[k] === want[k]); };
  // Let the first render finish (an update sent during it is lost), then check again.
  const root = () => document.querySelector('#storybook-root, #root');
  while (performance.now() - t0 < ${timeout} && !(root() && (root().children.length || (root().textContent || '').trim()))) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 100));
  if (held()) return 'url';
  const ch = window.__STORYBOOK_ADDONS_CHANNEL__;
  if (!ch) return 'failed';
  const done = await new Promise((resolve) => {
    const t = setTimeout(() => finish(false), 5000);
    const ok = () => finish(true);
    const bad = () => finish(false);
    function finish(v) { clearTimeout(t); ch.off('storyRendered', ok); ch.off('storyErrored', bad); ch.off('storyThrewException', bad); resolve(v); }
    ch.on('storyRendered', ok); ch.on('storyErrored', bad); ch.on('storyThrewException', bad);
    ch.emit('updateStoryArgs', { storyId: id, updatedArgs: want });
  });
  return done && held() ? 'channel' : 'failed';
})()`;

/** Opens one story in its iframe and measures what it rendered. */
export async function measureStory(page: MeasurePage, storybook: string, id: string, o: MeasureOptions = {}): Promise<MeasuredStory> {
  const iframe = { ...(o.iframe ?? {}) };
  if (o.args && Object.keys(o.args).length) iframe.args = { ...(iframe.args ?? {}), ...Object.fromEntries(Object.entries(o.args).map(([k, v]) => [k, typeof v === 'boolean' ? `!${v}` : String(v)])) };
  const url = storybookIframeUrl(storybook, id, iframe);
  const t0 = Date.now();
  // DOM ready, then the story's own wait (rendered, fonts, a short settle): an animated story never reaches network idle.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: (o.timeout ?? 15000) + 15000 });
  if (o.args && Object.keys(o.args).length) await page.evaluate<string>(APPLY_ARGS_SCRIPT(id, o.args, o.timeout ?? 15000)).catch(() => 'failed');
  const m = await measureRendered(page, o);
  let props: MeasuredProps | null = null;
  if (o.props !== false && m.root) props = await page.evaluate<MeasuredProps | null>(PROPS_SCRIPT(id)).catch(() => null);
  return { id, url, ...m, ...(props && typeof props === 'object' ? { props } : {}), ms: Date.now() - t0 };
}

/** Measures what the page shows now (a story already open, or re-rendered with new args): waits for it, then reads it. */
export async function measureRendered(page: MeasurePage, o: MeasureOptions = {}): Promise<MeasureResult & { ms: number; state?: MeasuredState | undefined; shot?: { file: string; width: number; height: number } | undefined }> {
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
    if (marked?.marked && (await page.forcePseudo(STATE_TARGETS, PSEUDO_CLASSES[o.state]).catch(() => false))) {
      state = o.state;
      await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))))');
    }
  }
  const r = await page.evaluate<MeasureResult | { error: string }>(`(${MEASURE_SCRIPT})(${JSON.stringify(arg)})`);
  let base: MeasureResult = 'root' in r ? r : { root: null, portals: [], wrappers: 0, nodes: 0, rules: 0, sheets: { read: 0, blocked: 0 }, rootVariables: 0, viewport: { width: 0, height: 0 }, error: r.error };
  // A root that fills its container spans the whole canvas in a story: lay it out at a component's width instead, so
  // the measured width, the plan and the screenshot agree (a text field at 400 px, not 1,116).
  const fillWidth = o.fillWidth ?? 400;
  if (fillWidth && base.root && base.rootFill && base.root.box.width > fillWidth + 1 && (state || (await markMeasuredRoot(page, { ...o, root })))) {
    await page.evaluate(`(async () => { const e = document.querySelector('[data-bridge-measure-root]'); if (e) { e.style.width = '${fillWidth}px'; e.style.maxWidth = 'none'; e.style.minWidth = '0'; } await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
    const again = await page.evaluate<MeasureResult | { error: string }>(`(${MEASURE_SCRIPT})(${JSON.stringify(arg)})`);
    if ('root' in again && again.root) base = { ...again, rootFill: true, fillWidth };
  }
  if (opened) base.opened = opened;
  if (opened === 'none' && !base.root) base.error = 'the popup did not open: no trigger in the story opened it';
  if (rendered === 'timeout' && !base.error && !base.root) base.error = `the story did not render within ${timeout} ms`;
  if (rendered === 'error' && !base.error) base.error = 'the story threw';
  let shot: { file: string; width: number; height: number } | undefined;
  if (o.shot && page.screenshot && base.root) {
    // The element the measure read, in the state it was read in (the forced state is still on).
    if (state || (await markMeasuredRoot(page, { ...o, root }))) {
      const size = await page.screenshot('[data-bridge-measure-root]', o.shot).catch(() => null);
      if (size) shot = { file: o.shot, ...size };
    }
  }
  if (state) await page.forcePseudo?.(STATE_TARGETS, []).catch(() => false);
  return { ...base, ...(state ? { state } : {}), ...(shot ? { shot } : {}), ms: Date.now() - t0 };
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
function plainLayout(n: MeasuredNode, anyRole = false): boolean {
  if (n.kind !== 'frame' || n.input || n.media || (!anyRole && (n.role || SEMANTIC_CONTAINER.test(n.tag)))) return false;
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
      // Captions ("sm", "Solid") beside the instances; a sentence is content (an empty state's description), not a caption.
      if (c.kind === 'text' && (c.text ?? '').length <= 24) continue;
      if (c.kind === 'text') {
        found.push(c);
        continue;
      }
      // Inside the story, a group that draws nothing (a tag group with role="group") is still just layout.
      if (plainLayout(c, true) && depth < 8 && c.children.length) collect(c, depth + 1);
      else if (!plainLayout(c, true)) found.push(c);
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
  // Most of what the story shows must be the same component (a strict majority): two buttons in an empty state are its actions.
  if (best.length < 2 || best.length * 2 <= found.length) return [];
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
  // A BEM element (`cds--toggle__switch`, `block_element`) is a class, not a hash: a hash has a digit or a capital.
  const hashed = (h: string | undefined) => !!h && /[0-9A-Z]/.test(h);
  const m =
    /^_([A-Za-z][\w-]*?)_[A-Za-z0-9]{5,8}_\d+$/.exec(cls) ??
    [/^[A-Za-z][\w-]*?(?:-module)?_{1,2}([A-Za-z][\w-]*?)__([\w-]{5,8})$/.exec(cls)].find((x) => x && hashed(x[2])) ??
    /^(?:[a-z]+-)?[A-Z][A-Za-z0-9]*-([A-Za-z]\w*)-[A-Za-z0-9_]{5}$/.exec(cls) ??
    [/^_?([A-Za-z][\w-]*?)_([A-Za-z0-9-]{5,8})$/.exec(cls)].find((x) => x && hashed(x[2]));
  return m ? m[1]! : cls;
}

/** Tailwind-style utility keywords that are a class on their own (`flex`, `relative`, `truncate`). */
const UTILITY_KEYWORDS = new Set(
  'flex inline-flex grid inline-grid block inline-block inline hidden contents table relative absolute fixed sticky static truncate uppercase lowercase capitalize normal-case italic not-italic underline overline line-through no-underline grow shrink border rounded shadow outline ring transition transform visible invisible collapse isolate container antialiased subpixel-antialiased group peer sr-only not-sr-only resize filter blur'.split(' '),
);
/** Utility shapes: a property prefix and a value (`px-4`, `text-sm`, `rounded-lg`, `gap-x-1`, `w-full`). */
const UTILITY_SHAPE =
  /^(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|w|h|min-w|min-h|max-w|max-h|size|gap|gap-x|gap-y|space-x|space-y|text|bg|from|via|to|border|border-[trblxyse]|rounded|rounded-[trblse]{1,2}|font|leading|tracking|z|top|right|bottom|left|start|end|inset|inset-x|inset-y|opacity|shadow|ring|ring-offset|outline|outline-offset|items|justify|justify-items|justify-self|content|self|place-items|place-content|place-self|flex|basis|grow|shrink|order|col|col-span|col-start|col-end|row|row-span|row-start|row-end|grid-cols|grid-rows|grid-flow|auto-cols|auto-rows|overflow|overflow-x|overflow-y|cursor|select|pointer-events|transition|duration|ease|delay|animate|scale|scale-x|scale-y|rotate|translate-x|translate-y|skew-x|skew-y|origin|fill|stroke|object|aspect|line-clamp|whitespace|break|decoration|underline-offset|list|align|appearance|backdrop|brightness|contrast|drop-shadow|grayscale|invert|saturate|sepia|hue-rotate|tabular|caret|accent|scroll|snap|touch|will-change|columns|divide|divide-x|divide-y|indent|box|float|clear|mix-blend|bg-blend)-[\w.-]+$/;

/**
 * A class that says how an element looks, not what it is: a utility (`flex`, `px-4`, `hover:bg-blue`, `w-[12px]`,
 * `-mt-1`) or a class a CSS-in-JS library generated from the styles (`css-1g7m1fs`, `sc-bdVaJa`). It changes with the
 * look from one variant to the next, so it never names or pairs a part: tag and position do. A BEM or semantic
 * class (`cds--btn__label`, `chakra-alert__title`, a CSS module's `label`) still does.
 */
export function isUtilityClass(cls: string): boolean {
  if (/[:[\]/!]/.test(cls) || /^-[a-z]/.test(cls) || /\.\d/.test(cls)) return true;
  if (/^css-[a-z0-9]{5,8}$/.test(cls) || (/^(?:emotion|sc|jsx|svelte|astro)-[A-Za-z0-9_-]{4,}$/.test(cls) && /\d|[A-Z]/.test(cls))) return true;
  return UTILITY_KEYWORDS.has(cls) || UTILITY_SHAPE.test(cls);
}

const defaultTokenOf = (v: string) => (/^--_/.test(v) ? undefined : v.replace(/^--/, '').split('-').filter(Boolean).join('.'));
const px = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)px$/.exec(v.trim());
  return m ? Math.round(Number(m[1]) * 100) / 100 : undefined;
};
const transparent = (v: string | undefined) => !v || v === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(v);

/** Auto layout of a measured element, as the pull reads it. */
/** How in-flow children are laid out by their boxes: each below the previous, all on one row, or neither. */
function arrangement(children: MeasuredBox[]): 'stacked' | 'row' | undefined {
  const kids = children.filter((c) => c.width > 0 || c.height > 0);
  if (kids.length < 2) return undefined;
  const stacked = kids.every((c, i) => i === 0 || c.y >= kids[i - 1]!.y + kids[i - 1]!.height - 1);
  const row = kids.every((c, i) => i === 0 || c.x >= kids[i - 1]!.x + kids[i - 1]!.width - 1);
  return stacked && !row ? 'stacked' : row && !stacked ? 'row' : undefined;
}

/** align-items as the counter axis alignment. */
function alignOf(style: Record<string, string>): SpecLayout['counter'] {
  const a = style['align-items'] ?? 'normal';
  return /center/.test(a) ? 'CENTER' : /end/.test(a) ? 'MAX' : /^(flex-)?start|baseline/.test(a) ? 'MIN' : 'STRETCH';
}

export function measuredLayout(style: Record<string, string>, children: MeasuredBox[] = []): SpecLayout | undefined {
  const d = style.display ?? '';
  const arranged = arrangement(children);
  // An inline element holding blocks (a <label> around a text and a switch) lays them out by their boxes.
  if (!/flex|grid|block|inline-block|list-item/.test(d)) return arranged ? { direction: arranged === 'stacked' ? 'VERTICAL' : 'HORIZONTAL', primary: 'MIN', counter: 'MIN' } : undefined;
  const flex = /flex/.test(d);
  const grid = /grid/.test(d);
  const dir = style['flex-direction'] ?? 'row';
  let direction: SpecLayout['direction'] = flex && dir.startsWith('row') ? 'HORIZONTAL' : 'VERTICAL';
  if (grid) {
    // A grid has no direction: its flow, its tracks, else where its children sit.
    const tracks = (v: string | undefined) => (v && v !== 'none' ? v.trim().split(/\s+(?![^(]*\))/).length : 0);
    const cols = tracks(style['grid-template-columns']);
    const rows = tracks(style['grid-template-rows']);
    const sideBySide = children.length >= 2 && children.every((c) => Math.abs(c.y + c.height / 2 - (children[0]!.y + children[0]!.height / 2)) <= Math.max(2, children[0]!.height / 2)) && new Set(children.map((c) => Math.round(c.x))).size === children.length;
    direction = /column/.test(style['grid-auto-flow'] ?? '') || (cols >= 2 && rows <= 1) || (cols < 2 && rows < 2 && sideBySide) ? 'HORIZONTAL' : 'VERTICAL';
    if (cols >= 2 && rows >= 2) direction = sideBySide ? 'HORIZONTAL' : 'VERTICAL';
    // Tracks across and down, filled row by row (a radio group of radio and label columns): a row that wraps at its width.
    if (cols >= 2 && rows >= 2 && !sideBySide && !/column/.test(style['grid-auto-flow'] ?? '')) return { direction: 'HORIZONTAL', primary: 'MIN', counter: alignOf(style), wrap: true };
  }
  const j = style['justify-content'] ?? 'normal';
  const primary: SpecLayout['primary'] = !flex && !grid ? 'MIN' : /space-between/.test(j) ? 'SPACE_BETWEEN' : /center/.test(j) ? 'CENTER' : /end|right/.test(j) ? 'MAX' : 'MIN';
  const counter = alignOf(style);
  // The boxes are the referee: a row that wrapped into a column at its width, or blocks that sit side by side.
  // (A wrapping row stays a row: Figma wraps it the same way at the same width.)
  if (arranged === 'stacked' && direction === 'HORIZONTAL' && !(flex && style['flex-wrap'] === 'wrap')) direction = 'VERTICAL';
  else if (arranged === 'row' && direction === 'VERTICAL' && !flex) direction = 'HORIZONTAL';
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
export function measuredToSpec(m: Pick<MeasuredStory, 'id' | 'root'> & { rootFill?: boolean | undefined }, o: MeasuredToSpecOptions = {}): MeasuredSpec {
  const tokenOf = o.tokenOf ?? defaultTokenOf;
  const out: MeasuredSpec = { story: m.id, parts: [], values: {}, raw: {}, tokens: {}, boxes: {}, coverage: { fields: 0, declared: 0, matched: 0, literal: 0 } };
  if (!m.root) return out;
  const used = new Set<string>();
  const idFor = (n: MeasuredNode, isRoot: boolean, inherited?: string) => {
    if (isRoot) return 'root';
    const cls = (n.classes ?? []).map(localClassName).find((c) => /^[A-Za-z]/.test(c) && c.length < 40 && !isUtilityClass(c));
    // Without a class that names it: its tag, numbered in order (the same structure gives the same ids in every variant).
    let base = cls ?? (n.pseudo ? `${inherited ?? 'root'}-${n.pseudo}` : n.kind === 'text' ? (inherited ? `${inherited}-text` : 'text') : n.kind === 'icon' ? 'icon' : n.tag);
    base = base.replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase() || 'part';
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return id;
  };
  const visit = (n: MeasuredNode, parent: string | undefined, parentStyle: Record<string, string> | undefined, parentBox?: MeasuredBox): string => {
    const id = idFor(n, !parent, parent);
    const style = n.kind === 'text' && n.tag === '#text' ? (parentStyle ?? {}) : n.style;
    const tokens = n.kind === 'text' && n.tag === '#text' ? {} : n.tokens;
    const part: MeasuredPart = { id, name: id === 'root' ? 'Root' : id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), kind: n.kind };
    if (parent) part.parent = parent;
    const named = (n.classes ?? []).map(localClassName).filter((c) => !isUtilityClass(c));
    if (named.length) part.source = named.join(' ');
    if (n.kind === 'frame') {
      const l = measuredLayout(n.style, n.children.filter((c) => c.style.position !== 'absolute' && c.style.position !== 'fixed').map((c) => c.box));
      if (l) part.layout = l;
      if (/^(hidden|clip)/.test(n.style.overflow ?? '')) part.clip = true;
      if ((n.style.position === 'absolute' || n.style.position === 'fixed') && parent) {
        // Out of the auto layout: inset 0 covers the parent, else pinned at its offset from the parent's corner (px).
        const zero = (v: string | undefined) => v !== undefined && /^0(px)?$/.test(v.trim());
        if (['top', 'right', 'bottom', 'left'].every((k) => zero(n.style[k]))) part.cover = true;
        else {
          const pb = parentBox ?? { x: 0, y: 0 };
          part.pin = { top: Math.round((n.box.y - pb.y) * 100) / 100, left: Math.round((n.box.x - pb.x) * 100) / 100 };
        }
      }
      if (Number(n.style['flex-grow']) > 0) part.grow = true;
    }
    if (n.kind === 'text') part.characters = n.text ?? '';
    if (!parent && m.rootFill) part.fill = true;
    const margins = Object.fromEntries((['top', 'right', 'bottom', 'left'] as const).map((k) => [k, px(n.style[`margin-${k}`]) ?? 0]).filter(([, v]) => Math.abs(v as number) > 0.5));
    if (Object.keys(margins).length) part.margins = margins;
    out.parts.push(part);
    partById.set(id, part);
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
        else if (field === 'cornerRadius' && v && /%$/.test(v.trim())) {
          // 50% is half the smaller side (a round knob or dot): px from the box.
          const half = Math.min(n.box.width, n.box.height) / 2;
          const r = Math.min(half, Math.round((Math.min(n.box.width, n.box.height) * Number.parseFloat(v)) / 100 * 100) / 100);
          if (r >= half - 0.5) part.fullRadius = true;
          if (r > 0) {
            out.coverage.fields++;
            out.coverage.literal++;
            raw[field] = r;
            values[field] = part.fullRadius ? 999 : r;
          }
        } else {
          // A radius of half the shorter side or more (9999px pills) is a full radius: half the side in Figma.
          const half = Math.min(n.box.width, n.box.height) / 2;
          if (field === 'cornerRadius' && (px(v) ?? 0) >= half - 0.5 && half > 0) part.fullRadius = true;
          put(field, prop, px(v) || undefined); // zero paddings and radii are Figma's default: not a field
          // A pill is 999 px in Figma, unless the radius is bound to a token.
          if (part.fullRadius && field === 'cornerRadius' && typeof values.cornerRadius === 'number') values.cornerRadius = 999;
        }
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
    if ((n.kind === 'icon' || n.kind === 'vector') && n.svg) (out.vectors ??= {})[id] = { svg: n.svg, strokes: n.svgStrokes ?? [] };
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
    if (n.sized && (n.sized.width || n.sized.height)) (out.sized ??= {})[id] = { ...(n.sized.width ? { width: n.box.width } : {}), ...(n.sized.height ? { height: n.box.height } : {}) };
    const kids = n.children.map((c) => [c, visit(c, id, n.style, n.box)] as const);
    // A grid that wraps does so at its measured width, each item at its track's: Figma wraps fixed widths only.
    if (part.layout?.wrap && /grid/.test(n.style.display ?? '')) {
      for (const [c, cid] of [[n, id] as const, ...kids]) if (c === n || !/absolute|fixed/.test(c.style.position ?? '')) (out.sized ??= {})[cid] = { ...out.sized?.[cid], width: c.box.width };
    }
    if (part.layout) spacing(id, n, part.layout, kids);
    if (n.kind === 'frame') positioned(id, part, n, kids);
    return id;
  };
  const partById = new Map<string, MeasuredPart>();
  const byId = (id: string) => partById.get(id) ?? out.parts.find((p) => p.id === id);
  /**
   * Out of flow children. A lone decoration (a switch knob, a radio dot) is rebuilt in auto layout: the parent aligns
   * it start, center or end on each axis and its padding carries the offset, when that reproduces the measured
   * position within 1 px. Anything else out of flow that overlaps its siblings or leaves its parent is an overlay.
   */
  const positioned = (id: string, parentPart: MeasuredPart, n: MeasuredNode, kids: (readonly [MeasuredNode, string])[]) => {
    const abs = kids.filter(([c]) => c.style.position === 'absolute' || c.style.position === 'fixed');
    if (!abs.length) return;
    const flow = kids.filter(([c]) => !(c.style.position === 'absolute' || c.style.position === 'fixed') && (c.box.width > 0 || c.box.height > 0));
    const st = n.style;
    const b = (k: string) => (st[`border-${k}-style`] === 'none' ? 0 : (px(st[`border-${k}-width`]) ?? 0));
    const inner = { x: n.box.x + b('left'), y: n.box.y + b('top'), r: n.box.x + n.box.width - b('right'), bottom: n.box.y + n.box.height - b('bottom') };
    const r2 = (x: number) => Math.round(x * 100) / 100;
    if (abs.length === 1 && !flow.length) {
      const [c, cid] = abs[0]!;
      const p = byId(cid);
      if (p && !p.cover) {
        const left = r2(c.box.x - inner.x), right = r2(inner.r - (c.box.x + c.box.width));
        const top = r2(c.box.y - inner.y), bottom = r2(inner.bottom - (c.box.y + c.box.height));
        const ax = (a: number, z: number) => (Math.abs(a - z) <= 1 ? 'center' : a <= z ? 'start' : 'end') as 'start' | 'center' | 'end';
        const x = ax(left, right), y = ax(top, bottom);
        if (left >= -0.5 && right >= -0.5 && top >= -0.5 && bottom >= -0.5) {
          delete p.pin;
          const map = { start: 'MIN', center: 'CENTER', end: 'MAX' } as const;
          parentPart.layout = { direction: 'HORIZONTAL', primary: map[x], counter: map[y], align: { [cid]: { primary: map[x], counter: map[y] } } };
          const vals = (out.values[id] ??= {});
          const raws = (out.raw[id] ??= {});
          const set = (k: 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom', v: number) => {
            if (v > 0.5) {
              vals[k] = v;
              raws[k] = v;
            } else {
              delete vals[k];
              delete raws[k];
            }
          };
          set('paddingLeft', x === 'start' ? left : 0);
          set('paddingRight', x === 'end' ? right : 0);
          set('paddingTop', y === 'start' ? top : 0);
          set('paddingBottom', y === 'end' ? bottom : 0);
          return;
        }
      }
    }
    const overlaps = (a: MeasuredBox, z: MeasuredBox) => a.x < z.x + z.width - 0.5 && z.x < a.x + a.width - 0.5 && a.y < z.y + z.height - 0.5 && z.y < a.y + a.height - 0.5;
    for (const [c, cid] of abs) {
      const p = byId(cid);
      if (!p || p.cover) continue;
      const outside = c.box.x < inner.x - 0.5 || c.box.y < inner.y - 0.5 || c.box.x + c.box.width > inner.r + 0.5 || c.box.y + c.box.height > inner.bottom + 0.5;
      if (outside || flow.some(([f]) => overlaps(c.box, f.box))) p.overlay = true;
    }
  };
  /**
   * Margins become auto layout: the space the boxes show before the first child and after the last becomes padding,
   * the space between children becomes the gap when it is the same everywhere, else the smallest gap plus a spacer
   * per child (a label 8 px above its field, a helper 4 px below it).
   */
  const spacing = (id: string, n: MeasuredNode, layout: SpecLayout, kids: (readonly [MeasuredNode, string])[]) => {
    if (layout.primary !== 'MIN' || layout.wrap || layout.reverse) return;
    const flow = kids.filter(([c]) => c.style.position !== 'absolute' && c.style.position !== 'fixed' && (c.box.width > 0 || c.box.height > 0));
    if (!flow.length) return;
    const v = layout.direction === 'VERTICAL';
    const st = n.style;
    const side = v ? (['top', 'bottom'] as const) : (['left', 'right'] as const);
    const num = (x: string | undefined) => px(x) ?? 0;
    const startEdge = (v ? n.box.y : n.box.x) + (st[`border-${side[0]}-style`] === 'none' ? 0 : num(st[`border-${side[0]}-width`])) + num(st[`padding-${side[0]}`]);
    const endEdge = (v ? n.box.y + n.box.height : n.box.x + n.box.width) - (st[`border-${side[1]}-style`] === 'none' ? 0 : num(st[`border-${side[1]}-width`])) - num(st[`padding-${side[1]}`]);
    const lo = (b: MeasuredBox) => (v ? b.y : b.x);
    const hi = (b: MeasuredBox) => (v ? b.y + b.height : b.x + b.width);
    const gaps = flow.slice(1).map(([c], i) => Math.round((lo(c.box) - hi(flow[i]![0].box)) * 100) / 100);
    if (gaps.some((g) => g < -0.5)) return; // overlapping (inline runs, negative margins): leave the declared layout
    const vals = (out.values[id] ??= {});
    const raws = (out.raw[id] ??= {});
    const padKey = (k: 'top' | 'bottom' | 'left' | 'right') => (({ top: 'paddingTop', bottom: 'paddingBottom', left: 'paddingLeft', right: 'paddingRight' }) as const)[k];
    const first = flow[0]![0];
    const last = flow[flow.length - 1]![0];
    // Only space a margin makes (text centred in a taller line is not padding): a child's own margin, at most what the boxes show.
    const before = Math.min(num(first.style[`margin-${side[0]}`]), Math.round((lo(first.box) - startEdge) * 100) / 100);
    // After the last child: only its own margin (free space in a fixed or stretched box is not padding).
    const after = Math.min(num(last.style[`margin-${side[1]}`]), Math.round((endEdge - hi(last.box)) * 100) / 100);
    for (const [k, extra] of [[side[0], before], [side[1], after]] as const) {
      if (!(extra > 0.5)) continue;
      const total = Math.round((num(st[`padding-${k}`]) + extra) * 100) / 100;
      vals[padKey(k)] = total;
      raws[padKey(k)] = total;
    }
    if (!gaps.length) return;
    const marginBetween = flow.slice(1).some(([c], i) => num(flow[i]![0].style[`margin-${side[1]}`]) > 0.5 || num(c.style[`margin-${side[0]}`]) > 0.5);
    if (!marginBetween) return;
    const declaredGap = num(v ? st['row-gap'] : st['column-gap']);
    const min = Math.min(...gaps);
    const uniform = gaps.every((g) => Math.abs(g - gaps[0]!) <= 0.5);
    if (uniform && Math.abs(gaps[0]! - declaredGap) <= 0.5) return;
    vals.itemSpacing = uniform ? gaps[0]! : min;
    raws.itemSpacing = vals.itemSpacing as number;
    if (!uniform)
      flow.slice(1).forEach(([c, cid], i) => {
        const extra = Math.round((gaps[i]! - min) * 100) / 100;
        if (!(extra > 0.5)) return;
        (out.spacers ??= {})[cid] = extra;
        // The margin's owner gets a wrapper with that padding: the previous child's end margin, else this child's start.
        const [prev, pid] = flow[i]!;
        const onPrev = num(prev.style[`margin-${side[1]}`]) > 0.5 && !(num(c.style[`margin-${side[0]}`]) > num(prev.style[`margin-${side[1]}`]));
        const owner = byId(onPrev ? pid : cid);
        if (owner) owner.wrap = { padding: { ...(owner.wrap?.padding ?? {}), [onPrev ? side[1] : side[0]]: extra } };
      });
  };
  visit(m.root, undefined, undefined);
  for (const k of Object.keys(out.values)) if (!Object.keys(out.values[k]!).length) delete out.values[k];
  for (const k of Object.keys(out.raw)) if (!Object.keys(out.raw[k]!).length) delete out.raw[k];
  return out;
}
