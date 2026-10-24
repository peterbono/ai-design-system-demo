// Code images for the Figma fidelity check: one PNG per generated Figma variant, rendered by the hidden Storybook
// story "Internal/Figma reference" with the variant's props, texts, icons, state and width (planReference in
// @bridge-ds/core), at the scale the plugin exports Figma variants at. Same capture rules as Visual impact (frozen
// clock, no animations, fonts loaded, remote network stubbed). Writes manifest.json + images under `out`.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  FIGMA_REFERENCE_STORY,
  parseComponentSpecs,
  planReferences,
  referenceImagePath,
  type FigmaReferenceManifest,
} from '@bridge-ds/core';
import type { Page } from 'playwright-core';
import { launch, newContext, newPage, settle } from './capture.js';
import { serveDir } from './serve.js';
import { storyUrl } from './routes.js';

export interface ReferencesOptions {
  /** Built Storybook folder (storybook-static). */
  storybook: string;
  /** component-specs.json path. */
  specs: string;
  out: string;
  sha: string;
  scale?: number;
  brand?: string;
  theme?: string;
  /** Only these components (names). */
  only?: string[];
  log?: (line: string) => void;
}

export interface ReferencesResult {
  manifest: FigmaReferenceManifest;
  manifestPath: string;
  captured: number;
  skipped: number;
}

export async function captureFigmaReferences(o: ReferencesOptions): Promise<ReferencesResult> {
  const log = o.log ?? (() => undefined);
  const scale = o.scale ?? 2;
  const brand = o.brand ?? 'bridge';
  const theme = o.theme ?? 'light';
  if (!existsSync(join(o.storybook, 'index.json'))) throw new Error(`No built Storybook in ${o.storybook}: run npm run build-storybook first.`);
  const index = JSON.parse(await readFile(join(o.storybook, 'index.json'), 'utf8')) as { entries: Record<string, unknown> };
  if (!index.entries[FIGMA_REFERENCE_STORY]) throw new Error(`The Storybook build has no ${FIGMA_REFERENCE_STORY} story (packages/react/src/stories/FigmaReference.stories.tsx).`);
  const specs = parseComponentSpecs(await readFile(o.specs, 'utf8'));
  const jobs = planReferences(specs).filter((j) => !o.only?.length || o.only.includes(j.component));

  const manifest: FigmaReferenceManifest = {
    version: 1,
    tool: '@bridge-ds/visual',
    createdAt: new Date().toISOString(),
    sha: o.sha,
    scale,
    mode: { brand, theme, density: 'comfortable' },
    storyId: FIGMA_REFERENCE_STORY,
    components: {},
  };
  for (const j of jobs) manifest.components[j.component] ??= { specHash: j.specHash, variants: {} };

  let captured = 0;
  let skipped = 0;
  const served = await serveDir(o.storybook);
  const browser = await launch();
  try {
    const ctx = await newContext(browser, { width: 1200, height: 800 }, scale);
    const page = await newPage(ctx);
    const openStory = async () => {
      await page.goto(storyUrl(served.url, FIGMA_REFERENCE_STORY, brand, theme), { waitUntil: 'load', timeout: 30000 });
      await page.waitForSelector('[data-fidelity-root], [data-fidelity-error]', { state: 'attached', timeout: 20000 });
      await settle(page, { busy: false });
    };
    await openStory();
    log(`Capturing ${jobs.length} variants at ${scale}x (${brand} ${theme})`);
    for (const j of jobs) {
      const variants = manifest.components[j.component]!.variants;
      if (!j.plan.ok) {
        variants[j.key] = { skipped: j.plan.reason };
        skipped++;
        continue;
      }
      const shown = await renderPlan(page, JSON.stringify(j.plan.render));
      // An error that escaped the story leaves Storybook on its error screen, where later args never render: reload,
      // so one failing variant does not skip every variant after it.
      if (shown.broken) {
        variants[j.key] = { skipped: `the code example threw: ${shown.error ?? 'the story did not finish rendering'}` };
        skipped++;
        await openStory();
        continue;
      }
      await settle(page, { network: false, quiet: 2, interval: 40, busy: false });
      const error = await page.locator('[data-fidelity-error]').first().textContent({ timeout: 200 }).catch(() => null);
      // A part of a compound component renders inside its parent, and a component shown from a hook (a toast) or a popup
      // rendered open renders outside the root, where Base UI portals it: the story marks it as `data-fidelity-target`.
      let target = page.locator('[data-fidelity-root] > *').first();
      if (!error && (j.plan.render.within || j.plan.render.popup || !(await target.count()))) {
        const marked = page.locator('[data-fidelity-target]').first();
        await marked.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
        await settle(page, { network: false, quiet: 2, interval: 40, busy: false });
        target = marked;
      }
      if (error || !(await target.count())) {
        variants[j.key] = { skipped: error ?? 'the code example did not render' };
        skipped++;
        continue;
      }
      // Rendered but see-through (a popup not placed yet): a blank image would read as a mismatch, not a skip.
      const transparent = await target.evaluate((el) => {
        for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).opacity === '0') return true;
        return false;
      });
      if (transparent) {
        variants[j.key] = { skipped: 'the code example rendered invisible (opacity 0)' };
        skipped++;
        continue;
      }
      const file = referenceImagePath(j.component, j.key);
      const path = join(o.out, file);
      await mkdir(dirname(path), { recursive: true });
      await target.screenshot({ path, omitBackground: true, animations: 'disabled', caret: 'hide', scale: 'device' });
      const box = await target.boundingBox();
      variants[j.key] = { file, width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
      captured++;
    }
    await ctx.close();
  } finally {
    await browser.close().catch(() => undefined);
    await served.close();
  }
  await mkdir(o.out, { recursive: true });
  const manifestPath = join(o.out, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${captured} images, ${skipped} variants skipped. ${manifestPath}`);
  return { manifest, manifestPath, captured, skipped };
}

/**
 * Renders one plan in the reference story over the Storybook channel. `broken`: the story threw past its error
 * boundary or never finished, so Storybook shows its error screen instead of the story.
 */
async function renderPlan(page: Page, plan: string): Promise<{ broken: boolean; error?: string }> {
  const r = await page.evaluate(
    ({ id, plan }) =>
      new Promise<{ rendered: boolean; error?: string }>((resolve) => {
        type Channel = { on: (e: string, f: (p: unknown) => void) => void; off: (e: string, f: (p: unknown) => void) => void; emit: (e: string, p: unknown) => void };
        const ch = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: Channel }).__STORYBOOK_ADDONS_CHANNEL__;
        let error: string | undefined;
        const failed = (p: unknown) => {
          const e = p as { message?: string; title?: string; description?: string } | undefined;
          error ??= e?.message ?? e?.title ?? e?.description;
        };
        const finish = (rendered: boolean) => {
          clearTimeout(timer);
          ch.off('storyRendered', done);
          ch.off('storyThrewException', failed);
          ch.off('storyErrored', failed);
          resolve({ rendered, ...(error ? { error } : {}) });
        };
        const done = () => finish(true);
        // The previous variant's marked target may outlive it for a frame (a portal): only this variant's counts.
        document.querySelectorAll('[data-fidelity-target]').forEach((el) => el.removeAttribute('data-fidelity-target'));
        const timer = setTimeout(() => finish(false), 10000);
        ch.on('storyThrewException', failed);
        ch.on('storyErrored', failed);
        ch.on('storyRendered', done);
        ch.emit('updateStoryArgs', { storyId: id, updatedArgs: { plan } });
      }),
    { id: FIGMA_REFERENCE_STORY, plan },
  );
  const errorScreen = await page.evaluate(() => document.body.classList.contains('sb-show-errordisplay'));
  return { broken: !r.rendered || !!r.error || errorScreen, ...(r.error ? { error: r.error } : {}) };
}
