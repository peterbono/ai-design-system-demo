// bridge specs --measure: what a team's Storybook really draws, measured in Chrome (boxes, auto layout, paint, type,
// and the token behind each value), written in the shape the Figma pull reads. Works on any React library with a
// deployed or local Storybook, whatever its styling. The Figma pull still reads component-specs.json; this is the
// measured side that will replace the guess from the CSS source.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  CONFIG_FILE,
  componentStatus,
  fetchStorybookIndex,
  normalizeStorybookUrl,
  boundedCombos,
  mapPropsToFigma,
  parseMeasuredSpecsFile,
  markUsedTokens,
  planVariantMeasures,
  variantCombosFromMapping,
  StorybookIndexError,
  type ComponentSpecsFile,
  type ComponentStatus,
  type FigmaComponentRef,
  type MeasuredArgType,
  type MeasuredSpec,
  type MeasuredSpecsComponent,
  type MeasuredSpecsFile,
  type MeasuredSpecsStory,
  type MeasuredState,
} from '@bridge-ds/core';
import { harvestTokens, localClassName, measuredToSpec, measureStory, pickStoriesToMeasure, repoSpecOptions, resolveTokenValues, splitInstances, type MeasuredStory, type MeasureOptions } from '@bridge-ds/core/node';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export type { MeasuredSpecsFile } from '@bridge-ds/core';

export const SPECS_HELP = `bridge specs --measure: measure what a Storybook really draws

Usage:
  bridge specs --measure --storybook <url> [--only Button,Card] [--stories id,id] [--per 3]
               [--open] [--within <selector>] [--variants] [--states rest,hover,disabled]
               [--check] [--specs component-specs.json] [--tokens] [--shots] [--out measured-specs.json] [--json]
      Opens each story in Chrome (installed Chrome, headless), waits for it to render and records the
      rendered tree: boxes, auto layout (direction, gap, padding, alignment), fills, borders, radii, text
      styles and texts, and the CSS variable (token) behind each value, plus the props the story rendered
      with (args over the component defaults). Writes them in the component specs shape (parts and values
      per story) to --out. --per: stories per component (default 3).
      --open        measure the popup a story opens (a menu, a dialog), not its trigger
      --within      measure one part inside the story or its popup ('[role=menuitem]')
      --variants    measure every variant: each component's first story with args for every combination
                    of its enum props, times --states (hover, focus-visible, active forced in Chrome;
                    disabled as an arg)
      --tokens      every CSS custom property the library defines (root, providers, theme classes), resolved
                    per theme, brand or density global, in two tiers (literal: primitive, var(): semantic),
                    marked when a measured story uses it
      --shots       a PNG of each measured root at 2x in measured-shots/ next to --out (one per distinct
                    render), with manifest.json: component -> Figma variant key -> file, width, height
      --check       one status per component: Matches, Differs, or Can't check yet with the reason,
                    against the Figma side in --specs (default: this repo's component-specs.json)
      Stories that render the component several times ("Sizes") are split: spec is the first instance,
      instances lists them all.
      In a Bridge repo (${CONFIG_FILE}) CSS variables map to your token paths; elsewhere a variable
      --space-2 reads as space.2.

Exit codes: 0 ok (stories that fail to render are listed, not fatal), 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);
const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

type MeasurePageLike = Parameters<typeof measureStory>[0];

/** The browser, injectable for tests. Default: @bridge-ds/visual's measure page on an installed Chrome. */
export type OpenPage = (o?: { scale?: number }) => Promise<{ page: MeasurePageLike; close: () => Promise<void>; reset?: () => Promise<void> }>;

const defaultOpen: OpenPage = async (oo = {}) => {
  const { openMeasurePage } = await import('@bridge-ds/visual');
  const opened = await openMeasurePage(oo.scale ? { scale: oo.scale } : {});
  const ctx = opened.page.context();
  let page = opened.page;
  // Stay on the story: a link in a story (href="#", an overflow menu's items) must not navigate the page away and
  // destroy the measure's context. Navigations away from iframe.html are aborted; clicks on links do not follow.
  const guard = async (pg: typeof page) => {
    await pg.route('**/*', (route, req) => (req.isNavigationRequest() && req.frame() === pg.mainFrame() && !/\/iframe\.html/.test(req.url()) ? route.abort() : route.continue()));
    await pg.addInitScript(() => {
      document.addEventListener('click', (e) => { const a = (e.target as Element | null)?.closest?.('a[href]'); if (a) e.preventDefault(); }, true);
    });
  };
  await guard(page);
  // Forced :hover / :focus-visible / :active through Chrome DevTools, the way the Styles pane forces them.
  let cdp: Awaited<ReturnType<typeof ctx.newCDPSession>> | undefined;
  const forcePseudo = async (selector: string, states: string[]) => {
    cdp ??= await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
    if (!nodeIds.length) return false;
    for (const nodeId of nodeIds.slice(0, 400)) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
    return true;
  };
  // A fresh tab: one story that hangs or navigates away never spreads to the next (one tab open at a time).
  const reset = async () => {
    const old = page;
    page = await ctx.newPage();
    cdp = undefined;
    await guard(page);
    await old.close().catch(() => undefined);
  };
  return {
    page: {
      goto: async (url, o) => {
        cdp = undefined; // a new document: node ids and forced states start over
        try {
          return await page.goto(url, o);
        } catch (e) {
          // A failed or interrupted navigation leaves the tab unusable: start a fresh one and try once more.
          await reset();
          return page.goto(url, o);
        }
      },
      evaluate: <T>(expr: string) => page.evaluate(expr) as Promise<T>,
      forcePseudo,
      screenshot: async (selector: string, file: string) => {
        const el = page.locator(selector).first();
        const box = await el.boundingBox();
        if (!box || box.width < 1 || box.height < 1) return null;
        await mkdir(dirname(file), { recursive: true });
        await el.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        return { width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 };
      },
    },
    close: opened.close,
    reset,
  };
};

const STATES = ['rest', 'hover', 'focus-visible', 'active', 'disabled'] as const;

/** The story entry written to the file, from one measure. */
/** Screenshots of the measured roots: where they go, and the renders already shot (same story, props, state, part). */
interface ShotBook {
  dir: string;
  /** Directory of measured-specs.json: shot paths are relative to it. */
  base: string;
  seen: Map<string, { file: string; width: number; height: number }>;
}

/** The file a measure's screenshot goes to: story id, args, state and part, file safe. */
const shotPath = (book: ShotBook, id: string, tag: Record<string, unknown> = {}) => {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rest = Object.entries(tag).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => slug(`${k}-${typeof v === 'object' ? JSON.stringify(v) : String(v)}`));
  return join(book.dir, `${[slug(id), ...rest].join('__').slice(0, 180)}.png`);
};

function storyEntry(p: { id: string; title: string; name: string }, m: MeasuredStory, tokenOf: ((v: string) => string | undefined) | undefined, extra: Partial<MeasuredSpecsStory> = {}, setClasses: string[] = [], book?: ShotBook): MeasuredSpecsStory {
  const o = tokenOf ? { tokenOf } : {};
  // A root that carries a class of the Figma set's root is the component itself, never a gallery of instances.
  const isComponent = (m.root?.classes ?? []).map(localClassName).some((c) => setClasses.includes(c));
  const parts = isComponent ? [] : splitInstances(m.root);
  const instances = parts.length >= 2 ? parts.map((root, i) => measuredToSpec({ id: `${m.id}#${i + 1}`, root }, o)) : undefined;
  const spec = m.root ? (instances?.[0] ?? measuredToSpec(m, o)) : undefined;
  const props = m.props && typeof m.props === 'object' ? m.props : undefined;
  // One PNG per distinct render: the same story with the same props and state is shot once.
  let shot: MeasuredSpecsStory['shot'];
  if (book && m.shot) {
    const key = JSON.stringify([p.id, p.title, Object.entries(props?.props ?? {}).sort(), m.state ?? '', m.root?.classes ?? []]);
    const seen = book.seen.get(key);
    if (seen && seen.file !== relative(book.base, m.shot.file)) {
      try {
        unlinkSync(m.shot.file);
      } catch {
        // already gone
      }
      shot = seen;
    } else {
      shot = { file: relative(book.base, m.shot.file), width: m.shot.width, height: m.shot.height };
      book.seen.set(key, shot);
    }
  }
  return {
    ...p,
    ...(shot ? { shot } : {}),
    url: m.url,
    ms: m.ms,
    ...(m.error || !m.root ? { error: m.error ?? 'nothing rendered' } : {}),
    ...(spec ? { spec } : {}),
    ...(props ? { props: props.props } : {}),
    ...extra,
    ...(m.state ? { state: m.state } : {}),
    ...(instances ? { instances, gallery: true } : {}),
    ...(m.opened ? { opened: m.opened } : {}),
  };
}

/**
 * The classes that name a set's root, its axis values aside: Pagination/Compact ".pagination, .md, .compact" ->
 * pagination, compact (md is a Size value). A story's element with one of them is that set's component.
 */
function setClassesOf(ref: FigmaComponentRef | undefined): string[] {
  const root = ref?.parts.find((x) => !x.parent);
  const values = new Set((ref?.properties ?? []).flatMap((x) => (x.type === 'VARIANT' ? (x.values ?? []) : [])).map((v) => v.toLowerCase()));
  return [...(root?.source ?? '').matchAll(/(?:^|[\s,])\.([A-Za-z][\w-]*)/g)].map((x) => x[1]!).filter((c) => !values.has(c.toLowerCase()));
}

/** A selector for the element a set draws: its root classes (CSS modules hash them: `_item_x1y2z_3`). */
const classSelector = (classes: string[]) => (classes.length ? `${classes.map((c) => `.${c}`).join('')}, ${classes.map((c) => `[class*="_${c}_"]`).join('')}` : '');

/** Menu parts share one class (`.item`); their role tells them apart. */
function roleOf(name: string): string | undefined {
  if (/CheckboxItem$/.test(name)) return '[role="menuitemcheckbox"]';
  if (/RadioItem$/.test(name)) return '[role="menuitemradio"]';
  if (/^Menu.*Submenu$/.test(name)) return '[role="menuitem"][aria-haspopup]';
  if (/^Menu.*Item$/.test(name)) return '[role="menuitem"]:not([aria-haspopup])';
  return undefined;
}

/** The shot manifest, in the figma-references shape: component -> variant key -> file and size. */
export interface MeasuredShotManifest {
  version: 1;
  tool: '@bridge-ds/cli';
  createdAt: string;
  storybook: string;
  /** Device pixels per CSS pixel of the PNGs. */
  scale: number;
  components: Record<string, { variants: Record<string, { file: string; width: number; height: number; story: string; props?: Record<string, string | number | boolean>; state?: string }> }>;
}

/**
 * The Figma variant key a measured story stands for ("Size=md, State=Hover"), from its props and state through the
 * component's prop mapping; undefined when an axis has no counterpart.
 */
function figmaKeyOf(ref: FigmaComponentRef, s: MeasuredSpecsStory, argTypes: Record<string, MeasuredArgType>): string | undefined {
  const mapping = mapPropsToFigma(argTypes, ref.properties);
  const has = { ...(s.props ?? {}), ...(s.overrides ?? {}) } as Record<string, unknown>;
  const parts: string[] = [];
  for (const axis of ref.properties.filter((x) => x.type === 'VARIANT')) {
    const m = mapping.mapped.find((x) => x.figma === axis.name);
    if (!m?.values) return undefined;
    let hit: string | undefined;
    if (m.prop === 'state') {
      const want = has.disabled === true ? 'disabled' : (s.state ?? 'rest');
      hit = Object.entries(m.values).find(([, v]) => v === want)?.[0];
    } else hit = Object.entries(m.values).find(([fv, v]) => String(v).toLowerCase() === String(has[m.prop] ?? '').toLowerCase() && Object.entries(m.also?.[fv] ?? {}).every(([k, x]) => has[k] === x))?.[0];
    if (hit === undefined) return undefined;
    parts.push(`${axis.name}=${hit}`);
  }
  return parts.join(', ');
}

async function writeShotManifest(book: ShotBook, file: MeasuredSpecsFile, refs: Map<string, FigmaComponentRef> | undefined): Promise<void> {
  const manifest: MeasuredShotManifest = { version: 1, tool: '@bridge-ds/cli', createdAt: new Date().toISOString(), storybook: file.storybook, scale: 2, components: {} };
  for (const s of file.stories) {
    if (!s.shot || !s.spec) continue;
    const name = s.title.split('/').pop()!.trim();
    const ref = refs?.get(name.toLowerCase());
    const argTypes = Object.assign({}, ...(file.components ?? []).filter((c) => c.title === s.title).map((c) => c.argTypes));
    const key = (ref && figmaKeyOf(ref, s, argTypes)) || `story=${s.id}${s.overrides ? `, ${Object.entries(s.overrides).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}${s.state ? `, state=${s.state}` : ''}`;
    const comp = (manifest.components[name] ??= { variants: {} });
    // The first story measured for a variant is its reference (the closest render comes first in the file).
    if (comp.variants[key]) continue;
    comp.variants[key] = { file: relative(book.dir, join(book.base, s.shot.file)), width: s.shot.width, height: s.shot.height, story: s.id, ...(s.props ? { props: s.props } : {}), ...(s.state ? { state: s.state } : {}) };
  }
  await mkdir(book.dir, { recursive: true });
  await writeFile(join(book.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The Figma side of each component, from component-specs.json (what the Figma library was drawn from). */
function figmaRefs(file: ComponentSpecsFile): Map<string, FigmaComponentRef> {
  const out = new Map<string, FigmaComponentRef>();
  for (const c of file.components) {
    out.set(c.name.toLowerCase(), {
      properties: [...c.axes.map((x) => ({ name: x.name, type: 'VARIANT', values: x.values })), ...c.properties.map((x) => ({ name: x.name, type: x.type, default: x.default }))],
      parts: c.parts,
      variants: c.variants,
    });
  }
  return out;
}

export async function runSpecs(a: RequestArgs, root: string, io: RequestIO = defaultIO(), open: OpenPage = defaultOpen): Promise<number> {
  if (has(a, 'help') || a._[1] === 'help') {
    io.print(SPECS_HELP);
    return 0;
  }
  if (!has(a, 'measure')) throw new RequestUsageError(`bridge specs needs --measure (the component specs of this repo are generated with npm run specs).\n\n${SPECS_HELP}`);
  const raw = flag(a, 'storybook');
  if (!raw || raw === 'true') throw new RequestUsageError('bridge specs --measure needs --storybook <url> (a deployed Storybook, or http://localhost:6006).');
  let base: string;
  try {
    base = normalizeStorybookUrl(raw);
  } catch (e) {
    throw new RequestUsageError((e as Error).message);
  }
  const per = flag(a, 'per') !== undefined ? Number(flag(a, 'per')) : undefined;
  if (per !== undefined && !(Number.isInteger(per) && per > 0)) throw new RequestUsageError('--per is a whole number of stories per component, 1 or more.');
  const states = flag(a, 'states') !== undefined ? list(flag(a, 'states')) : undefined;
  const badState = states?.find((s) => !(STATES as readonly string[]).includes(s));
  if (badState) throw new RequestUsageError(`--states takes ${STATES.join(', ')} (not ${badState}).`);
  const within = flag(a, 'within');
  if (within === 'true') throw new RequestUsageError('--within needs a CSS selector, like [role=menuitem].');

  // The Figma side for --check: component-specs.json, read before the browser opens so a bad path fails fast.
  let refs: Map<string, FigmaComponentRef> | undefined;
  let specsFile: ComponentSpecsFile | undefined;
  if (has(a, 'check')) {
    const specsPath = resolve(root, flag(a, 'specs') ?? 'packages/react/component-specs.json');
    if (existsSync(specsPath)) {
      try {
        specsFile = JSON.parse(readFileSync(specsPath, 'utf8')) as ComponentSpecsFile;
        refs = figmaRefs(specsFile);
      } catch (e) {
        throw new RequestUsageError(`--specs ${specsPath} is not a component specs file: ${(e as Error).message}`);
      }
    } else if (flag(a, 'specs')) throw new RequestUsageError(`--specs: no file at ${specsPath}.`);
  }

  let index;
  try {
    index = await fetchStorybookIndex(base, io.fetch ? { fetch: io.fetch as never } : {});
  } catch (e) {
    if (e instanceof StorybookIndexError) {
      io.error(`bridge: ${e.message}`);
      return 2;
    }
    throw e;
  }
  // The default specs belong to this repo: compare only a Storybook that is its library (most components have a set).
  if (refs && !flag(a, 'specs')) {
    const names = index.components.map((c) => c.name.toLowerCase());
    const hits = names.filter((n) => refs!.has(n) || [...refs!.keys()].some((k) => k.startsWith(`${n}/`))).length;
    if (!names.length || hits / names.length < 0.3) {
      refs = undefined;
      specsFile = undefined;
      if (!has(a, 'json')) io.print(`No Figma side for ${base} here (this repo's component specs are another library's): pass --specs to compare.`);
    }
  }
  const variants = has(a, 'variants');
  // --variants: every story as written (each can be a variant's closest render), and the variant args on the first.
  const picks = pickStoriesToMeasure(index, { only: list(flag(a, 'only')), ids: list(flag(a, 'stories')), perComponent: variants ? (per ?? 1000) : per });
  const firstOf = new Set(picks.reduce((m, x) => (m.has(x.title) ? m : m.set(x.title, x.id)), new Map<string, string>()).values());
  if (!picks.length) {
    io.error(`bridge: no story to measure in ${base}${flag(a, 'only') ? ` for ${flag(a, 'only')}` : ''}.`);
    return 2;
  }

  // In a Bridge repo, CSS variables map to the token paths the specs use (`--button-font-weight` -> button.font-weight).
  let tokenOf: ((v: string) => string | undefined) | undefined;
  const varOf = new Map<string, string>();
  if (existsSync(join(root, CONFIG_FILE))) {
    try {
      const { opts } = repoSpecOptions(root);
      tokenOf = (v) => opts.tokens.get(v)?.path;
      for (const [v, t] of opts.tokens) if (!varOf.has(t.path)) varOf.set(t.path, v);
    } catch {
      tokenOf = undefined;
    }
  }
  /** The CSS variables behind the token paths a Figma component names, to resolve in the page. */
  const varsFor = (ref: FigmaComponentRef) => {
    const vars: Record<string, string> = {};
    for (const v of ref.variants)
      for (const part of Object.values(v.values))
        for (const x of Object.values(part ?? {}))
          if (typeof x === 'string') for (const path of x.startsWith('calc(') ? (x.match(/[A-Za-z_][\w-]*(?:\.[\w-]+)+/g) ?? []) : [x]) vars[path] = varOf.get(path) ?? `--${path.replace(/\./g, '-')}`;
    return vars;
  };

  const json = has(a, 'json');
  let file: MeasuredSpecsFile = { version: 1, storybook: base, measuredAt: new Date().toISOString(), stories: [], components: [], done: [] };
  // --resume: keep what an earlier run of the same Storybook measured to the end, measure the rest.
  const outEarly = resolve(root, flag(a, 'out') ?? 'measured-specs.json');
  if (has(a, 'resume') && existsSync(outEarly)) {
    try {
      const prev = parseMeasuredSpecsFile(readFileSync(outEarly, 'utf8'));
      if (prev.storybook === base) {
        const done = new Set(prev.done ?? []);
        file = { ...prev, stories: prev.stories.filter((s) => done.has(s.title) || [...done].some((t) => s.title.startsWith(`${t}/`))), components: (prev.components ?? []).filter((c) => done.has(c.title) || [...done].some((t) => c.title.startsWith(`${t}/`))), done: [...done], statuses: undefined };
      }
    } catch {
      // not a measured specs file: start over
    }
  }
  const skip = new Set(file.done ?? []);
  const mo: MeasureOptions = { ...(has(a, 'open') ? { open: true } : {}), ...(within ? { within } : {}) };
  const say = (s: MeasuredSpecsStory, label: string) => {
    if (json) return;
    if (!s.spec) io.print(`  ${label}: not measured (${s.error ?? 'nothing rendered'})`);
    else io.print(`  ${label}: ${s.spec.parts.length} layers${s.instances ? ` (${s.instances.length} instances)` : ''}, ${s.spec.coverage.declared} of ${s.spec.coverage.fields} values tied to tokens`);
  };
  // --shots: a PNG of each measured root at 2x, next to the file, for the fidelity check of any library.
  const outPath = resolve(root, flag(a, 'out') ?? 'measured-specs.json');
  const book: ShotBook | undefined = has(a, 'shots') ? { dir: join(dirname(outPath), 'measured-shots'), base: dirname(outPath), seen: new Map() } : undefined;
  const shotOpt = (id: string, tag: Record<string, unknown> = {}) => (book ? { shot: shotPath(book, id, tag) } : {});
  const browser = await open(book ? { scale: 2 } : {});
  /**
   * Sets that are parts of this component (MenuItem, MenuSubmenu in Menu; AccordionItem in Accordion) and have no
   * story of their own: measured inside the component's stories, the first element with the part's root classes (and
   * role, for menu items), popups opened. Written as `<title>/<Set>` entries, with the element's own checked and
   * disabled state as props.
   */
  const measureParts = async (p: (typeof picks)[number]) => {
    const name = p.title.split('/').pop()!.trim().toLowerCase();
    const own = new Set(index.components.map((c) => c.name.toLowerCase()));
    const parts = (specsFile?.components ?? []).filter((c) => c.component?.toLowerCase() === name && c.name.toLowerCase() !== name && !c.name.includes('/') && !own.has(c.name.toLowerCase()));
    for (const set of parts) {
      const ref = refs!.get(set.name.toLowerCase())!;
      const classes = classSelector(setClassesOf(ref));
      const role = roleOf(set.name);
      const sel = role ? classes.split(', ').map((x) => `${x}${role}`).join(', ') : classes;
      if (!sel) continue;
      const title = `${p.title}/${set.name}`;
      // The part reads the tokens its component's page resolved (the overlay confirms a token swap by value).
      const parentComp = file.components!.find((c) => c.title === p.title);
      if (!file.components!.some((c) => c.title === title)) file.components!.push({ title, name: set.name, argTypes: {}, ...(parentComp?.resolved ? { resolved: parentComp.resolved } : {}) });
      let found = false;
      for (const s of picks.filter((x) => x.title === p.title)) {
        try {
          const m = await measureStory(browser.page, base, s.id, { within: sel, open: true, ...shotOpt(s.id, { part: set.name }) });
          if (!m.root) continue;
          const attrs = m.root.attrs ?? {};
          const own = { ...(attrs['aria-checked'] ? { checked: attrs['aria-checked'] === 'true' } : {}), ...(attrs['aria-disabled'] === 'true' || attrs['data-disabled'] !== undefined ? { disabled: true } : {}) };
          const props = { ...(m.props?.props ?? {}), ...own };
          const entry = storyEntry({ ...s, title }, m, tokenOf, {}, setClassesOf(ref), book);
          file.stories.push({ ...entry, props });
          say(entry, `${title} / ${s.name}`);
          for (const st of (states ?? []).filter((x): x is MeasuredState => x === 'hover' || x === 'active' || x === 'focus-visible')) {
            const ms = await measureStory(browser.page, base, s.id, { within: sel, open: true, state: st, ...shotOpt(s.id, { part: set.name, state: st }) });
            if (ms.root && ms.state) file.stories.push({ ...storyEntry({ ...s, title }, ms, tokenOf, {}, setClassesOf(ref), book), props });
          }
          found = true;
          break;
        } catch {
          // the next story may show it
        }
      }
      if (!found) file.stories.push({ id: p.id, title, name: p.name, url: '', ms: 0, error: `no story of ${p.title} shows a ${set.name}` });
    }
  };
  // Written after each component, so a stop loses nothing (--resume picks up from there).
  const flush = async () => {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`);
    if (book) await writeShotManifest(book, file, refs);
  };
  const finish = async (title: string | undefined) => {
    if (!title || file.done!.includes(title)) return;
    file.done!.push(title);
    await flush();
  };
  let current: string | undefined;
  try {
    // The library's variables first, in a fresh tab: a story that fails later cannot lose them.
    if (has(a, 'tokens') && !file.tokens && picks[0]) {
      try {
        file.tokens = await harvestTokens(browser.page, base, picks[0].id);
        await flush();
      } catch (e) {
        io.error(`bridge: could not read the variables: ${(e as Error).message.split('\n')[0]}`);
      }
      await browser.reset?.();
    }
    for (const p of picks) {
      if (skip.has(p.title)) continue;
      if (current !== p.title) {
        await finish(current);
        current = p.title;
        await browser.reset?.();
      }
      try {
        const ref = refs?.get(p.title.split('/').pop()!.trim().toLowerCase());
        let m = await measureStory(browser.page, base, p.id, { ...mo, ...shotOpt(p.id) });
        // A story that renders the item inside its group (a radio in its fieldset, a menu item in its open menu):
        // measure the element with the Figma set's root class, not the group around it.
        let cmo = mo;
        // The set's root classes: its own set, else the sets drawn from it under its folder (Pagination/Full, /Compact).
        const lname = p.title.split('/').pop()!.trim().toLowerCase();
        const sets = ref ? [ref] : [...(refs ?? new Map<string, FigmaComponentRef>()).entries()].filter(([k]) => k.startsWith(`${lname}/`)).map(([, v]) => v);
        const cls = [...new Set(sets.flatMap(setClassesOf))];
        if (!within && cls.length && m.root && !(m.root.classes ?? []).map(localClassName).some((c) => cls.includes(c))) {
          const sel = sets.map((x) => classSelector(setClassesOf(x).slice(0, 1))).filter(Boolean).join(', ');
          let mw = await measureStory(browser.page, base, p.id, { ...mo, within: sel, ...shotOpt(p.id) });
          if (!mw.root && !mo.open) mw = await measureStory(browser.page, base, p.id, { ...mo, within: sel, open: true, ...shotOpt(p.id) });
          if (mw.root) {
            m = mw;
            cmo = { ...mo, within: sel, ...(mw.opened && mw.opened !== 'none' ? { open: true } : {}) };
          }
        }
        const entry = storyEntry(p, m, tokenOf, {}, cls, book);
        file.stories.push(entry);
        say(entry, `${p.title} / ${p.name}`);
        const props = m.props && typeof m.props === 'object' ? m.props : undefined;
        if (m.root && !file.components!.some((c) => c.title === p.title)) {
          const name = p.title.split('/').pop()!.trim();
          const comp: MeasuredSpecsComponent = { title: p.title, name, argTypes: props?.argTypes ?? {}, ...(props?.component ? { component: props.component } : {}) };
          // The tokens its Figma sets name: its own set, the sets drawn from it under its folder (Progress/Linear), and
          // its parts' sets (MenuItem in Menu).
          const partRefs = (specsFile?.components ?? []).filter((c) => c.component?.toLowerCase() === lname && c.name.toLowerCase() !== lname).map((c) => refs!.get(c.name.toLowerCase())!).filter(Boolean);
          if (sets.length || partRefs.length) comp.resolved = await resolveTokenValues(browser.page, Object.assign({}, ...[...sets, ...partRefs].map(varsFor))).catch(() => ({}));
          file.components!.push(comp);
        }
        if (firstOf.has(p.id) && specsFile) await measureParts(p);
        if (!variants || !props || !firstOf.has(p.id)) continue;
        // Every variant of the component: its first story, with args for each combination and each state.
        // With a Figma side, the variants are its axes mapped to props (booleans like Checked included).
        const stateList = (states ?? ['rest', 'hover', 'disabled']) as ('rest' | MeasuredState | 'disabled')[];
        const comp = file.components!.find((c) => c.title === p.title);
        let combos: Record<string, string | boolean>[] | undefined;
        if (ref) combos = variantCombosFromMapping(mapPropsToFigma(props.argTypes, ref.properties));
        else {
          // No Figma set: vary only the args the story declares, and only those that change what renders. Each is
          // probed once (one value away from its default); one that changes nothing the measure reads is left out.
          const declaredArgs = new Set(Object.keys(props.args));
          const candidates = Object.entries(props.argTypes).filter(([k, at]) => (declaredArgs.size ? declaredArgs.has(k) : true) && !/^(is)?disabled$/i.test(k) && ((at.kind === 'enum' && (at.options?.length ?? 0) >= 2 && (at.options?.length ?? 0) <= 12) || at.kind === 'boolean'));
          const sig = (sp: MeasuredSpec | undefined) => JSON.stringify(sp ? { p: sp.parts.map((x) => [x.id, x.kind, x.characters ?? '']), b: Object.entries(sp.boxes).map(([k, b]) => [k, Math.round(b.width), Math.round(b.height), Math.round(b.x), Math.round(b.y)]), r: sp.raw } : null);
          const baseSig = sig(entry.spec);
          const ignored: Record<string, string> = {};
          const axes: [string, (string | boolean)[]][] = [];
          for (const [k, at] of candidates) {
            const cur = props.props[k];
            const values: (string | boolean)[] = at.kind === 'boolean' ? [cur === true, cur !== true] : [String(cur ?? at.default ?? at.options![0]), ...at.options!.filter((x) => x !== String(cur ?? at.default ?? at.options![0]))];
            try {
              const mp = await measureStory(browser.page, base, p.id, { ...cmo, args: { [k]: values[1]! } });
              if (mp.props && mp.props.args[k] !== values[1]) ignored[k] = 'not taken';
              else if (!mp.root || sig(storyEntry(p, mp, tokenOf, {}, cls).spec) === baseSig) ignored[k] = 'no visual effect';
              else axes.push([k, values]);
            } catch {
              ignored[k] = 'not taken';
            }
          }
          const bounded = boundedCombos(axes, Math.max(1, Math.floor(48 / Math.max(1, stateList.length))));
          combos = bounded.combos;
          if (comp) comp.variantPlan = { axes: axes.map(([k]) => k), ...(Object.keys(ignored).length ? { ignored } : {}), combos: combos.length, ...(bounded.capped ? { capped: true } : {}) };
        }
        const plan = planVariantMeasures(props.argTypes, { states: stateList, max: 1000, ...(combos && combos.some((c) => Object.keys(c).length) ? { combos } : {}) });
        for (const v of plan) {
          const label = Object.entries(v.overrides).map(([k, x]) => `${k}=${x}`).join(', ') + (v.state ? ` :${v.state}` : '');
          if (!label) continue; // the story as written is already measured
          try {
            const mv = await measureStory(browser.page, base, p.id, { ...cmo, args: v.overrides, ...(v.state ? { state: v.state } : {}), ...shotOpt(p.id, { ...v.overrides, state: v.state }) });
            const dropShot = () => {
              try {
                if (mv.shot) unlinkSync(mv.shot.file);
              } catch {
                // nothing written
              }
            };
            if (v.state && !mv.state) {
              dropShot();
              file.stories.push({ ...p, url: mv.url, ms: mv.ms, overrides: v.overrides, error: `the browser could not force :${v.state}` });
              continue;
            }
            // An arg the story does not take (not in its argTypes, or overwritten by its render) did not reach the component.
            const took = mv.props?.args;
            const ignored = took ? Object.entries(v.overrides).find(([k, x]) => took[k] !== x) : undefined;
            if (ignored) {
              dropShot();
              file.stories.push({ ...p, url: mv.url, ms: mv.ms, overrides: v.overrides, error: `the story does not take the arg ${ignored[0]}=${String(ignored[1])}` });
              if (!json) io.print(`  ${p.title} / ${label}: not measured (the story does not take ${ignored[0]})`);
              continue;
            }
            const ev = storyEntry(p, mv, tokenOf, { overrides: v.overrides }, cls, book);
            file.stories.push(ev);
            say(ev, `${p.title} / ${label}`);
          } catch (e) {
            file.stories.push({ ...p, url: '', ms: 0, overrides: v.overrides, error: (e as Error).message.split('\n')[0] });
          }
        }
      } catch (e) {
        file.stories.push({ ...p, url: '', ms: 0, error: (e as Error).message.split('\n')[0] });
        if (!json) io.print(`  ${p.title} / ${p.name}: not measured (${(e as Error).message.split('\n')[0]})`);
        await browser.reset?.();
      }
    }
    await finish(current);
  } finally {
    await browser.close();
  }

  let statuses: ComponentStatus[] | undefined;
  if (has(a, 'check') && !refs && !json) io.print('--check skipped: no Figma side to compare with.');
  if (has(a, 'check') && refs) {
    // One status per component name: its own stories ("Forms/ChoiceCard") and its Figma variant stories
    // ("Figma variants/ChoiceCard") together, their props merged.
    const nameOf = (title: string) => title.split('/').pop()!.trim();
    const names = [...new Set(file.stories.map((s) => nameOf(s.title)))];
    statuses = names.flatMap((name) => {
      // A part's entries ("Overlays/Menu/MenuItem") read the tokens and props of the component they were measured in.
      const parentTitle = (t: string) => t.split('/').slice(0, -1).join('/');
      const partOf = file.stories.find((s) => nameOf(s.title) === name && file.components!.some((c) => c.title === parentTitle(s.title)));
      const comps = file.components!.filter((c) => nameOf(c.title) === name || (partOf && c.title === parentTitle(partOf.title)));
      const resolved = comps.reduce<Record<string, string> | undefined>((acc, c) => (c.resolved ? { ...(acc ?? {}), ...c.resolved } : acc), undefined);
      const stories = file.stories.filter((s) => nameOf(s.title) === name);
      // Props a part entry read from its element (checked, disabled) are its props too.
      const readProps = Object.fromEntries(stories.flatMap((s) => Object.entries(s.props ?? {})).filter(([, v]) => typeof v === 'boolean').map(([k]) => [k, { kind: 'boolean' as const }]));
      const base = { argTypes: comps.length || Object.keys(readProps).length ? Object.assign({}, readProps, ...comps.map((c) => c.argTypes)) : undefined, ...(resolved ? { resolve: (path: string) => resolved[path] } : {}) };
      const own = refs?.get(name.toLowerCase());
      // Sets drawn from this component under its folder: one per fixed prop (Progress/Linear is variant=linear), and
      // popups drawn open (Dialog/Popup), compared only when measured open.
      const folder = own ? [] : (specsFile?.components ?? []).filter((c) => c.name.toLowerCase().startsWith(`${name.toLowerCase()}/`));
      const fixedSets = folder.filter((c) => c.fixed && Object.keys(c.fixed).length && c.view !== 'popup');
      if (fixedSets.length)
        return fixedSets.map((set) =>
          componentStatus({
            ...base,
            name: set.name,
            stories: stories.filter((s) => Object.entries(set.fixed!).every(([k, v]) => String({ ...(s.props ?? {}), ...(s.overrides ?? {}) }[k] ?? '') === v)),
            figma: refs?.get(set.name.toLowerCase()),
          }),
        );
      return [componentStatus({ ...base, name, stories, figma: own, ...(folder.length ? { figmaSets: folder.map((c) => c.name) } : {}) })];
    });
    file.statuses = statuses;
  }

  if (file.tokens) markUsedTokens(file.tokens, file.stories);
  // Single-instance stories before galleries: a reader taking the first story with the right props gets the closest.
  file.stories.sort((x, y) => (x.gallery ? 1 : 0) - (y.gallery ? 1 : 0));
  const out = outPath;
  await flush();
  const ok = file.stories.filter((s) => s.spec).length;
  const fields = file.stories.reduce((n, s) => n + (s.spec?.coverage.fields ?? 0), 0);
  const tied = file.stories.reduce((n, s) => n + (s.spec?.coverage.declared ?? 0), 0);
  const counts = statuses ? { matches: statuses.filter((s) => s.status === 'matches').length, differs: statuses.filter((s) => s.status === 'differs').length, cantCheck: statuses.filter((s) => s.status === 'cant-check').length } : undefined;
  if (json) io.print(JSON.stringify({ out, storybook: base, measured: ok, failed: file.stories.length - ok, values: fields, tiedToTokens: tied, ...(counts ? { statuses: counts } : {}), ...(file.tokens ? { variables: file.tokens.counts, modes: file.tokens.modes } : {}) }, null, 2));
  else {
    io.print(`Measured ${ok} of ${file.stories.length} stories, ${tied} of ${fields} values tied to tokens. ${out}`);
    if (file.tokens) {
      const c = file.tokens.counts;
      io.print(`Variables: ${c.properties} (${c.primitives} primitive, ${c.semantic} semantic), ${c.used} used by the measured stories, modes: ${file.tokens.modes.map((m) => `${m.global} (${m.values.join(', ')})`).join('; ') || 'none'}.`);
    }
    if (statuses && counts) {
      io.print(`${counts.matches} of ${statuses.length} components match Figma. ${counts.differs} differ, ${counts.cantCheck} can't be checked yet.`);
      const word = { matches: 'Matches', differs: 'Differs', 'cant-check': "Can't check yet" } as const;
      for (const s of statuses) io.print(`  ${s.name}: ${word[s.status]}${s.status === 'matches' ? '' : `. ${s.summary}`}`);
    }
  }
  return 0;
}
