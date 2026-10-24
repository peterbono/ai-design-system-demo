// component-specs.json of any shape: wrong types, missing fields, duplicates, loops, very long and unicode names,
// unknown fields. Every entry DS Bridge cannot read is left out with its reason; every other one is pulled and built.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ComponentSpecsFile, parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, specSource, writablePlan } from '../src/sync/component-pull';
import { checkComponentSpecs } from '../src/sync/spec-check';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const MAIN = parseComponentSpecs(readFileSync(join(ROOT, SPECS_PATH), 'utf8'));

function repo(specs: unknown, config = realConfigText()) {
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = config;
  files[SPECS_PATH] = JSON.stringify(specs);
  return new FakeGitHub(files).client();
}

test("main's specs go through the check unchanged, with no issue", () => {
  const { specs, issues } = checkComponentSpecs(structuredClone(MAIN));
  assert.deepEqual(issues, []);
  assert.equal(JSON.stringify(specs), JSON.stringify(MAIN));
});

/** Main's file with broken entries mixed in: each of them is left out or trimmed, every other one builds. */
function mangled(): { file: ComponentSpecsFile; good: string[]; bad: string[] } {
  const file = structuredClone(MAIN) as ComponentSpecsFile & { components: unknown[] };
  const button = () => structuredClone(MAIN.components.find((c) => c.name === 'Button')!);
  const long = `Very long ${'name '.repeat(100)}`;
  const unicode = button();
  unicode.name = 'Bouton 日本語 ✨ «primaire»';
  const lengthy = button();
  lengthy.name = long;
  const extra = { ...button(), name: 'Button with unknown fields', futureField: { anything: [1, 2, 3] }, version: 99 };
  // A variant listed twice, a variant with an object as its axis value, a property with a number default.
  const dup = button();
  dup.name = 'Button with duplicates';
  dup.variants = [dup.variants[0]!, structuredClone(dup.variants[0]!), { ...structuredClone(dup.variants[1]!), props: { Variant: { x: 1 } } as never }, ...dup.variants.slice(1)];
  dup.properties = [...dup.properties, { name: 'Count', type: 'TEXT', default: 3 as never }];
  // Field values of shapes no version writes: a problem for that field, never a throw.
  const odd = button();
  odd.name = 'Button with odd values';
  const v0 = odd.variants[0]!;
  v0.values.root = { ...v0.values.root, fill: { $ref: 'x' } as never, paddingTop: true as never, cornerRadius: [1, 2] as never, itemSpacing: 'calc(' as never };
  // A layer whose parent is missing, a parent loop, a part listed twice.
  const loops = button();
  loops.name = 'Button with a parent loop';
  loops.parts = [...loops.parts, { id: 'a', name: 'A', kind: 'frame', parent: 'b' }, { id: 'b', name: 'B', kind: 'frame', parent: 'a' }, { id: 'c', name: 'C', kind: 'frame', parent: 'nowhere' }, { ...loops.parts[1]! }];
  file.components.push(
    unicode,
    lengthy,
    extra,
    dup,
    odd,
    loops,
    // Left out whole:
    42,
    null,
    { name: 12, axes: [], parts: [], variants: [] },
    { ...button(), name: 'No variants', variants: [] },
    { ...button(), name: 'Axes as text', axes: 'Variant' },
    { ...button(), name: 'No root', parts: button().parts.filter((p) => p.id !== 'root') },
    { ...button(), name: 'Bad axis', axes: [{ name: 'Size', values: [{}] }] },
    { ...button() }, // a second "Button"
  );
  return {
    file,
    good: [...MAIN.components.map((c) => c.name), unicode.name, `${long.slice(0, 199)}…`, 'Button with unknown fields', 'Button with duplicates', 'Button with odd values', 'Button with a parent loop'],
    bad: ['Entry', 'Entry', 'Entry', 'No variants', 'Axes as text', 'No root', 'Bad axis', 'Button'],
  };
}

test('a file with broken entries: each one is left out or trimmed with a reason in words, the others are planned', () => {
  const { file, good, bad } = mangled();
  const { specs, issues } = checkComponentSpecs(file);
  assert.deepEqual(specs.components.map((c) => c.name), good);
  const skipped = issues.filter((i) => i.skipped);
  assert.deepEqual(skipped.map((i) => i.component.replace(/ \d+$/, '')), bad);
  for (const i of issues) assert.ok(i.reason.length > 5 && !/undefined|\[object|NaN/.test(i.reason) && !i.reason.includes(String.fromCharCode(0x2014)), `${i.component}: ${i.reason}`);
  const dup = specs.components.find((c) => c.name === 'Button with duplicates')!;
  assert.equal(dup.variants.length, MAIN.components.find((c) => c.name === 'Button')!.variants.length, 'the duplicate and the broken variant are left out');
  assert.equal(dup.properties.find((p) => p.name === 'Count')!.default, '3', 'a TEXT default is a text');
  assert.ok(issues.some((i) => i.component === 'Button with duplicates' && /listed twice/.test(i.reason)));
  const loops = specs.components.find((c) => c.name === 'Button with a parent loop')!;
  assert.ok(loops.parts.filter((p) => ['a', 'b', 'c'].includes(p.id)).some((p) => p.parent === 'root'));
  assert.equal(loops.parts.filter((p) => p.id === loops.parts[1]!.id).length, 1);
  // Parents before their children.
  const seen = new Set<string>();
  for (const p of loops.parts) {
    if (p.parent) assert.ok(seen.has(p.parent), `${p.id} after its parent`);
    seen.add(p.id);
  }
});

test('pull with broken entries: every readable component builds in Figma, the plan names the others, a re-pull changes nothing', async () => {
  const { file, good } = mangled();
  const sim = new SimFigma();
  sim.install();
  const client = repo(file);
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = (await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config))!;
  const plan = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  assert.deepEqual(plan.components.map((c) => c.name), good);
  assert.equal(plan.skipped?.length, 8);
  assert.ok(plan.problems.some((p) => p.component === 'Button with odd values' && p.property === 'fill'));
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.failed, []);
  assert.equal(report.created, good.length);
  assert.deepEqual(sim.loose(), []);
  const names = sim.sets().map((s) => s.name);
  assert.ok(names.includes('Bouton 日本語 ✨ «primaire»'));
  const again = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  assert.deepEqual(again.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), []);
});

test('the spec source is static by default and reads what loadComponentSpecs reads', async () => {
  const client = repo(MAIN);
  new SimFigma().install();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  const source = specSource();
  assert.equal(source.kind, 'static');
  assert.deepEqual(await source.load(client, a.headFiles.treeSha, a.headFiles.config), await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config));
});

test('bridge.config.json with components.specs of the wrong type: a readable error, not a crash', async () => {
  const config = JSON.parse(realConfigText());
  config.components = { ...(config.components ?? {}), specs: 42 };
  const client = repo(MAIN, JSON.stringify(config));
  new SimFigma().install();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await assert.rejects(loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config), /bridge\.config\.json: components\.specs is a number, it should be the path of component-specs\.json/);
});

test('a specs file that is not a list at all: one readable error from the reader', async () => {
  for (const text of ['{"version":1,"components":"Button"}', 'not json', '{"version":7,"components":[]}']) {
    assert.throws(() => parseComponentSpecs(text), /component-specs\.json/);
  }
  // Components fine, icons and slots of the wrong shape: the components still plan.
  const { specs, issues } = checkComponentSpecs({ ...structuredClone(MAIN), icons: 'x' as never, slots: [{ name: 3 }] as never, iconStyle: { size: 1 } as never });
  assert.equal(specs.components.length, MAIN.components.length);
  assert.ok(issues.some((i) => i.component === 'Icons'));
  assert.ok(issues.some((i) => i.component === 'Slots'));
});
