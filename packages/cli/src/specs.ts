// bridge specs --measure: what a team's Storybook really draws, measured in Chrome (boxes, auto layout, paint, type,
// and the token behind each value), written in the shape the Figma pull reads. Works on any React library with a
// deployed or local Storybook, whatever its styling. The Figma pull still reads component-specs.json; this is the
// measured side that will replace the guess from the CSS source.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE, fetchStorybookIndex, normalizeStorybookUrl, StorybookIndexError } from '@bridge-ds/core';
import { measuredToSpec, measureStory, pickStoriesToMeasure, repoSpecOptions, type MeasuredSpec } from '@bridge-ds/core/node';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export const SPECS_HELP = `bridge specs --measure: measure what a Storybook really draws

Usage:
  bridge specs --measure --storybook <url> [--only Button,Card] [--stories id,id] [--per 3]
               [--out measured-specs.json] [--json]
      Opens each story in Chrome (installed Chrome, headless), waits for it to render and records the
      rendered tree: boxes, auto layout (direction, gap, padding, alignment), fills, borders, radii, text
      styles and texts, and the CSS variable (token) behind each value. Writes them in the component
      specs shape (parts and values per story) to --out. --per: stories per component (default 3).
      In a Bridge repo (${CONFIG_FILE}) CSS variables map to your token paths; elsewhere a variable
      --space-2 reads as space.2.

Exit codes: 0 ok (stories that fail to render are listed, not fatal), 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);
const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export interface MeasuredSpecsFile {
  version: 1;
  storybook: string;
  measuredAt: string;
  stories: { id: string; title: string; name: string; url: string; ms: number; error?: string | undefined; spec?: MeasuredSpec | undefined }[];
}

/** The browser, injectable for tests. Default: @bridge-ds/visual's measure page on an installed Chrome. */
export type OpenPage = () => Promise<{ page: Parameters<typeof measureStory>[0]; close: () => Promise<void> }>;

const defaultOpen: OpenPage = async () => {
  const { openMeasurePage } = await import('@bridge-ds/visual');
  const { page, close } = await openMeasurePage();
  return { page: { goto: (url, o) => page.goto(url, o), evaluate: <T>(expr: string) => page.evaluate(expr) as Promise<T> }, close };
};

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
  const picks = pickStoriesToMeasure(index, { only: list(flag(a, 'only')), ids: list(flag(a, 'stories')), perComponent: per });
  if (!picks.length) {
    io.error(`bridge: no story to measure in ${base}${flag(a, 'only') ? ` for ${flag(a, 'only')}` : ''}.`);
    return 2;
  }

  // In a Bridge repo, CSS variables map to the token paths the specs use (`--button-font-weight` -> button.font-weight).
  let tokenOf: ((v: string) => string | undefined) | undefined;
  if (existsSync(join(root, CONFIG_FILE))) {
    try {
      const { opts } = repoSpecOptions(root);
      tokenOf = (v) => opts.tokens.get(v)?.path;
    } catch {
      tokenOf = undefined;
    }
  }

  const json = has(a, 'json');
  const file: MeasuredSpecsFile = { version: 1, storybook: base, measuredAt: new Date().toISOString(), stories: [] };
  const browser = await open();
  try {
    for (const p of picks) {
      try {
        const m = await measureStory(browser.page, base, p.id);
        const spec = m.root ? measuredToSpec(m, tokenOf ? { tokenOf } : {}) : undefined;
        file.stories.push({ ...p, url: m.url, ms: m.ms, ...(m.error || !m.root ? { error: m.error ?? 'nothing rendered' } : {}), ...(spec ? { spec } : {}) });
        if (!json) {
          if (!spec) io.print(`  ${p.title} / ${p.name}: not measured (${m.error ?? 'nothing rendered'})`);
          else io.print(`  ${p.title} / ${p.name}: ${spec.parts.length} layers, ${spec.coverage.declared} of ${spec.coverage.fields} values tied to tokens`);
        }
      } catch (e) {
        file.stories.push({ ...p, url: '', ms: 0, error: (e as Error).message.split('\n')[0] });
        if (!json) io.print(`  ${p.title} / ${p.name}: not measured (${(e as Error).message.split('\n')[0]})`);
      }
    }
  } finally {
    await browser.close();
  }
  const out = resolve(root, flag(a, 'out') ?? 'measured-specs.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(file, null, 2)}\n`);
  const ok = file.stories.filter((s) => s.spec).length;
  const fields = file.stories.reduce((n, s) => n + (s.spec?.coverage.fields ?? 0), 0);
  const tied = file.stories.reduce((n, s) => n + (s.spec?.coverage.declared ?? 0), 0);
  if (json) io.print(JSON.stringify({ out, storybook: base, measured: ok, failed: file.stories.length - ok, values: fields, tiedToTokens: tied }, null, 2));
  else io.print(`Measured ${ok} of ${file.stories.length} stories, ${tied} of ${fields} values tied to tokens. ${out}`);
  return 0;
}
