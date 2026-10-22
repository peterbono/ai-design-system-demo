// Pull components when Figma says no: random call failures, a font that will not load, a variable missing, a file out
// of room, a pull stopped or cut off half way. Runs the real main-thread code against the in-memory Figma API with
// fault injection (figma-api.ts). Every run must finish, say what it did not build in designer words, leave nothing
// half built, and a pull after it must build the rest in place, never a duplicate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { type ComponentApplyReport, type ComponentPullPlan, buildComponentPlan, componentReportView, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const SPECS = readFileSync(join(ROOT, SPECS_PATH), 'utf8');
const NAMES = parseComponentSpecs(SPECS).components.map((c) => c.name);

function repoFiles(specs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  out[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  out[SPECS_PATH] = specs;
  return out;
}

/** A file with main's variables pulled, and a function that plans the components against what the file holds now. */
async function pulledFile(specs = SPECS, sim = new SimFigma()) {
  sim.install();
  const client = new FakeGitHub(repoFiles(specs)).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  assert.ok(loaded);
  const plan = async (): Promise<ComponentPullPlan> => buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  return { sim, plan };
}

/** What every run guarantees, whatever failed. */
function assertConsistent(sim: SimFigma, report: ComponentApplyReport, plan: ComponentPullPlan) {
  const built = report.created + report.updated + report.unchanged;
  assert.equal(built + (report.failed?.length ?? 0) + (report.cancelled?.length ?? 0), plan.components.length, 'every set is built, reported as not built, or not reached');
  assert.deepEqual(
    sim.loose().map((n) => `${n.type} ${n.name}`),
    [],
    'nothing half built is left loose on a page',
  );
  const ids = sim.sets().map((s) => s.getSharedPluginData('dsbridge', 'componentId')).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'never two sets for one component');
  for (const f of report.failed ?? []) {
    assert.ok(f.reason.length > 0 && !/undefined|\[object/.test(f.reason), `${f.name}: a reason in words`);
  }
}

/** Every planned set is in the file with every planned variant, and a fresh plan has nothing left to build. */
async function assertComplete(sim: SimFigma, plan: () => Promise<ComponentPullPlan>) {
  const next = await plan();
  const byId = new Map(sim.sets().map((s) => [s.getSharedPluginData('dsbridge', 'componentId'), s]));
  for (const c of next.components) {
    const set = byId.get(c.componentId);
    assert.ok(set, `${c.name} is in the file`);
    const variants = set.children.filter((v) => v.type === 'COMPONENT' && v.getSharedPluginData('dsbridge', 'orphan') !== 'true');
    assert.equal(variants.length, c.variants.length, `${c.name}: every variant`);
  }
  assert.deepEqual(next.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), [], 'a pull after it has nothing left to build');
  assert.equal(byId.size, NAMES.length);
}

for (const seed of [7, 42, 1234]) {
  test(`faults (seed ${seed}): 1% of Figma calls fail; the pull finishes, says what it skipped, leaves nothing half built, and Try again builds the rest`, async () => {
    const { sim, plan } = await pulledFile();
    const first = await plan();
    sim.seedFaults(seed, 0.01);
    const report = await applyComponentPlan(writablePlan(first));
    sim.seedFaults(0, 0);
    assert.ok(sim.faults > 0, 'faults were injected');
    assertConsistent(sim, report, first);
    const view = componentReportView(report);
    if (report.failed?.length || report.partial?.length) {
      assert.ok(view.retry, 'Try again is offered');
      assert.ok(!view.headline.includes(String.fromCharCode(0x2014)));
    }
    // Try again: re-plan against the file, build what is left.
    const second = await plan();
    const again = await applyComponentPlan(writablePlan(second));
    assert.deepEqual(again.failed, []);
    assertConsistent(sim, again, writablePlan(second));
    await assertComplete(sim, plan);
  });
}

test('a font Figma refuses to load: text falls back to Inter, said once, each font asked for once', async () => {
  const sim = new SimFigma();
  for (const style of ['Regular', 'Medium', 'Semi Bold', 'Bold']) sim.brokenFonts.add(`Instrument Sans|${style}`);
  const { plan } = await pulledFile(SPECS, sim);
  const report = await applyComponentPlan(writablePlan(await plan()));
  assert.deepEqual(report.failed, []);
  assert.match(report.fontNote ?? '', /Instrument Sans/);
  assert.match(report.fontNote ?? '', /Inter/);
  assert.ok(sim.fontLoads <= 20, `fonts are loaded once each, refused ones not asked again (${sim.fontLoads} loads)`);
  await assertComplete(sim, plan);
});

test('no font loads at all: the components with text are not built, the reason says fonts, nothing is left behind', async () => {
  const sim = new SimFigma();
  const { plan } = await pulledFile(SPECS, sim);
  for (const f of sim.fonts) sim.brokenFonts.add(`${f.family}|${f.style}`);
  const p = writablePlan(await plan());
  const report = await applyComponentPlan(p);
  assertConsistent(sim, report, p);
  assert.ok((report.failed?.length ?? 0) > 0);
  assert.ok(report.failed!.every((f) => /font/.test(f.reason)), report.failed!.map((f) => f.reason).join('\n'));
  const view = componentReportView(report);
  assert.match(view.headline, /^Built \d+ of \d+ components\.$/);
  assert.match(view.notBuilt ?? '', /^Not built: .+\(a font could not be loaded/);
  sim.brokenFonts.clear();
  await applyComponentPlan(writablePlan(await plan()));
  await assertComplete(sim, plan);
});

test('a variable missing in Figma: the bindings are reported, every set is still built', async () => {
  const { sim, plan } = await pulledFile();
  const gone = sim.variables.find((v) => v.name === 'button/primary/bg')!;
  sim.variables = sim.variables.filter((v) => v !== gone);
  const p = writablePlan(await plan());
  const report = await applyComponentPlan(p);
  assert.deepEqual(report.failed, []);
  assert.ok(report.problems.some((x) => x.includes('button/primary/bg')));
  assertConsistent(sim, report, p);
});

test('the file runs out of room half way: the sets that fit are built, the others are said, then a pull builds the rest', async () => {
  const { sim, plan } = await pulledFile();
  const p = writablePlan(await plan());
  sim.nodeLimit = sim.nodes.size + 1500;
  const report = await applyComponentPlan(p);
  assertConsistent(sim, report, p);
  assert.ok((report.failed?.length ?? 0) > 0, 'some sets did not fit');
  assert.ok(report.created > 0, 'the ones that fit are built');
  sim.nodeLimit = 0;
  const again = await applyComponentPlan(writablePlan(await plan()));
  assert.deepEqual(again.failed, []);
  await assertComplete(sim, plan);
});

test('Cancel: the pull stops after the set in progress, says what it did not reach, and the next pull goes on from there', async () => {
  const { sim, plan } = await pulledFile();
  const p = writablePlan(await plan());
  let n = 0;
  const report = await applyComponentPlan(p, (m) => (n += m.startsWith('Building') ? 1 : 0), { cancelled: () => n >= 10 });
  assert.equal(report.created, 10);
  assert.equal(report.cancelled?.length, p.components.length - 10);
  assertConsistent(sim, report, p);
  assert.match(componentReportView(report).stopped ?? '', /^Stopped after 10 of \d+\. Pull again to build the other \d+/);
  const rest = writablePlan(await plan());
  assert.equal(rest.components.length, p.components.length - 10, 'only what was not reached');
  await applyComponentPlan(rest);
  await assertComplete(sim, plan);
});

test('Figma closes in the middle of a set: the next pull finds the set, finishes it in place, no duplicate', async () => {
  const { sim, plan } = await pulledFile();
  const p = writablePlan(await plan());
  // From this op on, every async Figma call never answers: the run stops where it is, as when the file closes.
  sim.hangAfter = sim.ops + 4000;
  void applyComponentPlan(p);
  for (let i = 0; i < 400 && !sim.hung; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(sim.hung, 'the first pull was cut off');
  const cut = sim.sets().length;
  assert.ok(cut > 0 && cut < NAMES.length, `cut off half way (${cut} sets)`);
  sim.hangAfter = 0;
  const report = await applyComponentPlan(writablePlan(await plan()));
  assert.deepEqual(report.failed, []);
  assert.deepEqual(sim.loose().map((n) => n.name), []);
  await assertComplete(sim, plan);
});

test('report in designer words: counts, not built with reasons, partial sets, never an em dash', () => {
  const base = { created: 50, updated: 2, unchanged: 2, orphaned: 0, page: 'Components', problems: [], nodeIds: [] };
  assert.deepEqual(componentReportView({ ...base, total: 54, failed: [] }), { headline: 'All 54 components are built.', partial: [], retry: false });
  const v = componentReportView({
    ...base,
    total: 56,
    failed: [
      { name: 'Select', reason: 'a font could not be loaded (Font X)' },
      { name: 'Tabs', reason: 'Figma refused a change (boom)' },
    ],
    partial: [{ name: 'Button', built: 70, total: 72, reason: 'Figma refused a change (x)', variants: ['Variant=primary, Size=sm, State=Hover', 'Variant=primary, Size=sm, State=Pressed'] }],
  });
  assert.equal(v.headline, 'Built 54 of 56 components.');
  assert.equal(v.notBuilt, 'Not built: Select (a font could not be loaded (Font X)), Tabs (Figma refused a change (boom)). Nothing of them was left in the file.');
  assert.deepEqual(v.partial, ['Button: 70 of 72 variants (Variant=primary, Size=sm, State=Hover, Variant=primary, Size=sm, State=Pressed not built: Figma refused a change (x))']);
  assert.ok(v.retry);
  for (const s of [v.headline, v.notBuilt!, ...v.partial]) assert.ok(!s.includes(String.fromCharCode(0x2014)));
});
