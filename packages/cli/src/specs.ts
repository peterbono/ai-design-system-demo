// bridge specs --measure: what a team's Storybook really draws, measured in Chrome (boxes, auto layout, paint, type,
// and the token behind each value), written in the shape the Figma pull reads. Works on any React library with a
// deployed or local Storybook, whatever its styling. The Figma pull still reads component-specs.json; this is the
// measured side that will replace the guess from the CSS source.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  CONFIG_FILE,
  componentStatus,
  fetchStorybookIndex,
  normalizeStorybookUrl,
  mapPropsToFigma,
  planVariantMeasures,
  variantValuesFromMapping,
  StorybookIndexError,
  type ComponentSpecsFile,
  type ComponentStatus,
  type FigmaComponentRef,
  type MeasuredSpecsComponent,
  type MeasuredSpecsFile,
  type MeasuredSpecsStory,
  type MeasuredState,
} from '@bridge-ds/core';
import { measuredToSpec, measureStory, pickStoriesToMeasure, repoSpecOptions, resolveTokenValues, splitInstances, type MeasuredStory, type MeasureOptions } from '@bridge-ds/core/node';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export type { MeasuredSpecsFile } from '@bridge-ds/core';

export const SPECS_HELP = `bridge specs --measure: measure what a Storybook really draws

Usage:
  bridge specs --measure --storybook <url> [--only Button,Card] [--stories id,id] [--per 3]
               [--open] [--within <selector>] [--variants] [--states rest,hover,disabled]
               [--check] [--specs component-specs.json] [--out measured-specs.json] [--json]
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
export type OpenPage = () => Promise<{ page: MeasurePageLike; close: () => Promise<void> }>;

const defaultOpen: OpenPage = async () => {
  const { openMeasurePage } = await import('@bridge-ds/visual');
  const { page, close } = await openMeasurePage();
  // Forced :hover / :focus-visible / :active through Chrome DevTools, the way the Styles pane forces them.
  let cdp: Awaited<ReturnType<ReturnType<typeof page.context>['newCDPSession']>> | undefined;
  const forcePseudo = async (selector: string, states: string[]) => {
    cdp ??= await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return false;
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
    return true;
  };
  return {
    page: {
      goto: async (url, o) => {
        cdp = undefined; // a new document: node ids and forced states start over
        return page.goto(url, o);
      },
      evaluate: <T>(expr: string) => page.evaluate(expr) as Promise<T>,
      forcePseudo,
    },
    close,
  };
};

const STATES = ['rest', 'hover', 'focus-visible', 'active', 'disabled'] as const;

/** The story entry written to the file, from one measure. */
function storyEntry(p: { id: string; title: string; name: string }, m: MeasuredStory, tokenOf: ((v: string) => string | undefined) | undefined, extra: Partial<MeasuredSpecsStory> = {}): MeasuredSpecsStory {
  const o = tokenOf ? { tokenOf } : {};
  const parts = splitInstances(m.root);
  const instances = parts.length >= 2 ? parts.map((root, i) => measuredToSpec({ id: `${m.id}#${i + 1}`, root }, o)) : undefined;
  const spec = m.root ? (instances?.[0] ?? measuredToSpec(m, o)) : undefined;
  const props = m.props && typeof m.props === 'object' ? m.props : undefined;
  return {
    ...p,
    url: m.url,
    ms: m.ms,
    ...(m.error || !m.root ? { error: m.error ?? 'nothing rendered' } : {}),
    ...(spec ? { spec } : {}),
    ...(props ? { props: props.props } : {}),
    ...extra,
    ...(m.state ? { state: m.state } : {}),
    ...(instances ? { instances } : {}),
    ...(m.opened ? { opened: m.opened } : {}),
  };
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
  if (has(a, 'check')) {
    const specsPath = resolve(root, flag(a, 'specs') ?? 'packages/react/component-specs.json');
    if (existsSync(specsPath)) {
      try {
        refs = figmaRefs(JSON.parse(readFileSync(specsPath, 'utf8')) as ComponentSpecsFile);
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
  const variants = has(a, 'variants');
  const picks = pickStoriesToMeasure(index, { only: list(flag(a, 'only')), ids: list(flag(a, 'stories')), perComponent: variants ? 1 : per });
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
  const file: MeasuredSpecsFile = { version: 1, storybook: base, measuredAt: new Date().toISOString(), stories: [], components: [] };
  const mo: MeasureOptions = { ...(has(a, 'open') ? { open: true } : {}), ...(within ? { within } : {}) };
  const say = (s: MeasuredSpecsStory, label: string) => {
    if (json) return;
    if (!s.spec) io.print(`  ${label}: not measured (${s.error ?? 'nothing rendered'})`);
    else io.print(`  ${label}: ${s.spec.parts.length} layers${s.instances ? ` (${s.instances.length} instances)` : ''}, ${s.spec.coverage.declared} of ${s.spec.coverage.fields} values tied to tokens`);
  };
  const browser = await open();
  try {
    for (const p of picks) {
      try {
        const m = await measureStory(browser.page, base, p.id, mo);
        const entry = storyEntry(p, m, tokenOf);
        file.stories.push(entry);
        say(entry, `${p.title} / ${p.name}`);
        const props = m.props && typeof m.props === 'object' ? m.props : undefined;
        if (m.root && !file.components!.some((c) => c.title === p.title)) {
          const name = p.title.split('/').pop()!.trim();
          const comp: MeasuredSpecsComponent = { title: p.title, name, argTypes: props?.argTypes ?? {}, ...(props?.component ? { component: props.component } : {}) };
          const ref = refs?.get(name.toLowerCase());
          if (ref) comp.resolved = await resolveTokenValues(browser.page, varsFor(ref)).catch(() => ({}));
          file.components!.push(comp);
        }
        if (!variants || !props) continue;
        // Every variant of the component: its first story, with args for each combination and each state.
        // With a Figma side, the variants are its axes mapped to props (booleans like Checked included).
        const ref = refs?.get(p.title.split('/').pop()!.trim().toLowerCase());
        const values = ref ? variantValuesFromMapping(mapPropsToFigma(props.argTypes, ref.properties)) : undefined;
        const plan = planVariantMeasures(props.argTypes, { ...(states ? { states: states as ('rest' | MeasuredState | 'disabled')[] } : {}), ...(values && Object.keys(values).length ? { values } : {}) });
        for (const v of plan) {
          const label = Object.entries(v.overrides).map(([k, x]) => `${k}=${x}`).join(', ') + (v.state ? ` :${v.state}` : '');
          if (!label) continue; // the story as written is already measured
          try {
            const mv = await measureStory(browser.page, base, p.id, { ...mo, args: v.overrides, ...(v.state ? { state: v.state } : {}) });
            if (v.state && !mv.state) {
              file.stories.push({ ...p, url: mv.url, ms: mv.ms, overrides: v.overrides, error: `the browser could not force :${v.state}` });
              continue;
            }
            // An arg the story does not take (not in its argTypes, or overwritten by its render) did not reach the component.
            const took = mv.props?.args;
            const ignored = took ? Object.entries(v.overrides).find(([k, x]) => took[k] !== x) : undefined;
            if (ignored) {
              file.stories.push({ ...p, url: mv.url, ms: mv.ms, overrides: v.overrides, error: `the story does not take the arg ${ignored[0]}=${String(ignored[1])}` });
              if (!json) io.print(`  ${p.title} / ${label}: not measured (the story does not take ${ignored[0]})`);
              continue;
            }
            const ev = storyEntry(p, mv, tokenOf, { overrides: v.overrides });
            file.stories.push(ev);
            say(ev, `${p.title} / ${label}`);
          } catch (e) {
            file.stories.push({ ...p, url: '', ms: 0, overrides: v.overrides, error: (e as Error).message.split('\n')[0] });
          }
        }
      } catch (e) {
        file.stories.push({ ...p, url: '', ms: 0, error: (e as Error).message.split('\n')[0] });
        if (!json) io.print(`  ${p.title} / ${p.name}: not measured (${(e as Error).message.split('\n')[0]})`);
      }
    }
  } finally {
    await browser.close();
  }

  let statuses: ComponentStatus[] | undefined;
  if (has(a, 'check')) {
    const titles = [...new Set(file.stories.map((s) => s.title))];
    statuses = titles.map((title) => {
      const name = title.split('/').pop()!.trim();
      const comp = file.components!.find((c) => c.title === title);
      const resolved = comp?.resolved;
      return componentStatus({
        name,
        stories: file.stories.filter((s) => s.title === title),
        argTypes: comp?.argTypes,
        figma: refs?.get(name.toLowerCase()),
        ...(resolved ? { resolve: (path: string) => resolved[path] } : {}),
      });
    });
    file.statuses = statuses;
  }

  const out = resolve(root, flag(a, 'out') ?? 'measured-specs.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(file, null, 2)}\n`);
  const ok = file.stories.filter((s) => s.spec).length;
  const fields = file.stories.reduce((n, s) => n + (s.spec?.coverage.fields ?? 0), 0);
  const tied = file.stories.reduce((n, s) => n + (s.spec?.coverage.declared ?? 0), 0);
  const counts = statuses ? { matches: statuses.filter((s) => s.status === 'matches').length, differs: statuses.filter((s) => s.status === 'differs').length, cantCheck: statuses.filter((s) => s.status === 'cant-check').length } : undefined;
  if (json) io.print(JSON.stringify({ out, storybook: base, measured: ok, failed: file.stories.length - ok, values: fields, tiedToTokens: tied, ...(counts ? { statuses: counts } : {}) }, null, 2));
  else {
    io.print(`Measured ${ok} of ${file.stories.length} stories, ${tied} of ${fields} values tied to tokens. ${out}`);
    if (statuses && counts) {
      io.print(`${counts.matches} of ${statuses.length} components match Figma. ${counts.differs} differ, ${counts.cantCheck} can't be checked yet.`);
      const word = { matches: 'Matches', differs: 'Differs', 'cant-check': "Can't check yet" } as const;
      for (const s of statuses) io.print(`  ${s.name}: ${word[s.status]}${s.status === 'matches' ? '' : `. ${s.summary}`}`);
    }
  }
  return 0;
}
