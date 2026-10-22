// Pull a big design system: 300 component sets, up to 30 variants each (about 5000 variants), 2000 extra variables and
// hundreds of fonts in the file. Runs the real main-thread build against the in-memory Figma API and holds it to a
// budget: time, Figma calls per variant, one load per font, progress for every set, never a long stretch without
// yielding to Figma (a frozen file), and a second pull that writes nothing new.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ComponentSpecsFile, parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';

/** Main's specs grown to `count` sets: each component of main again under a new name, at most `maxVariants` variants. */
function bigSpecs(count = 300, maxVariants = 30): ComponentSpecsFile {
  const main = parseComponentSpecs(readFileSync(join(ROOT, SPECS_PATH), 'utf8'));
  const components = Array.from({ length: count }, (_, i) => {
    const src = main.components[i % main.components.length]!;
    const round = Math.floor(i / main.components.length);
    const c = { ...structuredClone(src), name: round ? `${src.name} ${round + 1}` : src.name };
    // Grown to about `maxVariants` variants with a Tone axis (one copy of every variant per tone), like a bigger system.
    const tones = Math.max(1, Math.floor(maxVariants / Math.max(1, c.variants.length)));
    if (tones > 1) {
      const values = Array.from({ length: tones }, (_, t) => `tone${t + 1}`);
      c.axes = [{ name: 'Fixture tone', values, default: values[0]! }, ...c.axes];
      c.variants = values.flatMap((tone) => c.variants.map((v) => ({ ...structuredClone(v), props: { 'Fixture tone': tone, ...v.props } })));
    }
    c.variants = c.variants.slice(0, maxVariants);
    return c;
  });
  const { coverage: _coverage, ...rest } = main;
  return { ...rest, components };
}

test('big DS: 300 sets and ~5000 variants build within budget, with progress, yielding, fonts loaded once, no duplicate on re-pull', async () => {
  const specs = bigSpecs();
  const variants = specs.components.reduce((n, c) => n + c.variants.length, 0);
  assert.ok(variants >= 4000, `${variants} variants`);
  const sim = new SimFigma({
    fonts: [
      ...['Regular', 'Medium', 'Semi Bold', 'Bold'].flatMap((style) => ['Inter', 'Instrument Sans', 'Fraunces', 'IBM Plex Mono'].map((family) => ({ family, style }))),
      ...Array.from({ length: 400 }, (_, i) => ({ family: `Brand Font ${i}`, style: 'Regular' })),
    ],
  });
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  files[SPECS_PATH] = JSON.stringify(specs);
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  // A big file: 2000 more variables the components do not use, in the same collections.
  const figmaApi = (globalThis as unknown as { figma: { variables: { createVariable: (n: string, c: unknown, t: string) => unknown } } }).figma;
  for (let i = 0; i < 2000; i++) figmaApi.variables.createVariable(`extra/${i}`, sim.collections[i % sim.collections.length], 'FLOAT');
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  assert.ok(loaded);

  const t0 = performance.now();
  const plan = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  const planMs = performance.now() - t0;

  const messages: string[] = [];
  // The longest stretch without giving Figma a turn (a timer), in ms: what freezes the file.
  let longest = 0;
  let where = '';
  let last = performance.now();
  let stop = false;
  const watch = () => {
    const now = performance.now();
    if (now - last > longest) where = messages[messages.length - 1] ?? 'start';
    longest = Math.max(longest, now - last);
    last = now;
    if (!stop) setTimeout(watch, 0);
  };
  setTimeout(watch, 0);
  const ops0 = sim.ops;
  const t1 = performance.now();
  const report = await applyComponentPlan(writablePlan(plan), (m) => messages.push(m));
  const buildMs = performance.now() - t1;
  stop = true;
  const ops = sim.ops - ops0;

  assert.deepEqual(report.failed, []);
  assert.equal(report.created, 300);
  assert.equal(sim.sets().length, 300);
  assert.deepEqual(sim.loose(), []);
  assert.ok(messages.filter((m) => /^Building \d+ of 300: /.test(m)).length === 300, 'progress for every set');
  assert.ok(sim.fontLoads <= 16, `each font loaded once (${sim.fontLoads})`);
  // Budget. The fake is faster than Figma: these catch work that grows faster than the file (searches inside loops).
  const perVariant = ops / variants;
  console.log(`big DS: ${variants} variants, plan ${Math.round(planMs)} ms, build ${Math.round(buildMs)} ms, ${ops} writes (${perVariant.toFixed(1)} per variant), longest stretch without yielding ${Math.round(longest)} ms (at ${where})`);
  assert.ok(planMs < 10_000, `plan in ${Math.round(planMs)} ms`);
  assert.ok(buildMs < 180_000, `build in ${Math.round(buildMs)} ms`);
  assert.ok(perVariant < 60, `${perVariant.toFixed(1)} writes per variant`);
  assert.ok(longest < 2000, `the file never freezes: longest stretch ${Math.round(longest)} ms`);

  // Re-pull: nothing to build, nothing duplicated.
  const again = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  assert.deepEqual(again.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), []);
  const second = await applyComponentPlan(again);
  assert.equal(second.unchanged, 300);
  assert.equal(sim.sets().length, 300);
});

test('big DS with 1% of Figma calls failing: the pull finishes, nothing is left loose, Try again completes it with no duplicate', async () => {
  const specs = bigSpecs();
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  files[SPECS_PATH] = JSON.stringify(specs);
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = (await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config))!;
  const plan = async () => buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  sim.seedFaults(99, 0.01);
  const first = await applyComponentPlan(writablePlan(await plan()));
  sim.seedFaults(0, 0);
  console.log(`big DS with faults: ${sim.faults} injected failures, ${first.created} built, ${first.failed?.length ?? 0} not built, ${first.partial?.length ?? 0} partial`);
  assert.ok(sim.faults > 100);
  assert.equal(first.created + (first.failed?.length ?? 0), 300);
  assert.deepEqual(sim.loose(), []);
  for (let i = 0; i < 3; i++) {
    const p = writablePlan(await plan());
    if (!p.components.length) break;
    await applyComponentPlan(p);
  }
  const done = await plan();
  assert.deepEqual(done.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), []);
  const ids = sim.sets().map((x) => x.getSharedPluginData('dsbridge', 'componentId'));
  assert.equal(ids.length, 300);
  assert.equal(new Set(ids).size, 300);
  for (const c of done.components) {
    const set = sim.sets().find((x) => x.getSharedPluginData('dsbridge', 'componentId') === c.componentId)!;
    assert.equal(set.children.filter((v) => v.getSharedPluginData('dsbridge', 'orphan') !== 'true').length, c.variants.length, c.name);
  }
});
