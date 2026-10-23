// The code adds or removes an axis, or drops a value, on sets already in Figma. Figma refuses a set whose variants do
// not all have the same properties (every read of it then throws), so the update must leave one shape: the variants a
// new axis extends are the same nodes (instances and overrides follow), removed ones stay as orphans with a fitting name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ComponentSpecsFile, type SpecAxis, parseComponentSpecs, variantKeyOf } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { readComponent } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { LONE_VARIANT, buildComponentPlan, loadComponentSpecs, matchVariants, pendingComponents, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma, type SimNode } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const NAMES = ['Badge', 'Checklist', 'Kbd'];

function someSpecs(): ComponentSpecsFile {
  const main = parseComponentSpecs(readFileSync(join(ROOT, SPECS_PATH), 'utf8'));
  const { coverage: _c, ...rest } = main;
  return { ...rest, components: main.components.filter((c) => NAMES.includes(c.name)) };
}

/** Density (regular by default) in front of every set's axes, each variant once per density. */
function withDensity(specs: ComponentSpecsFile): ComponentSpecsFile {
  const out = structuredClone(specs);
  for (const c of out.components) {
    c.axes = [{ name: 'Density', values: ['regular', 'dense'], default: 'regular' }, ...c.axes];
    c.variants = ['regular', 'dense'].flatMap((d) => c.variants.map((v) => ({ ...structuredClone(v), props: { Density: d, ...v.props } })));
  }
  return out;
}

async function pull(gh: FakeGitHub, baseSha?: string) {
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, baseSha ? { baseSha } : {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const plan = buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head);
  const report = await applyComponentPlan(writablePlan(plan));
  const again = buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head);
  return { a, plan, report, again };
}

/** Throws like Figma when a set is in error. */
const propsOf = (set: SimNode) => set.children.map((c) => c.variantProperties!);
const isOrphan = (n: SimNode) => n.getSharedPluginData('dsbridge', 'orphan') === 'true';

test('matchVariants: same key, then a new axis at its default, a removed axis dropped; orphans fit the axes', () => {
  const axes = (names: string[]): SpecAxis[] => names.map((n) => ({ name: n, values: n === 'Size' ? ['sm', 'md'] : ['Default', 'Hover'], default: n === 'Size' ? 'md' : 'Default' }));
  const pv = (props: Record<string, string>) => ({ key: variantKeyOf(props), props });
  // Size added (default md): State=Hover becomes Size=md, State=Hover; Size=sm ones are new.
  const added = matchVariants([{ id: 'a', key: 'State=Default' }, { id: 'b', key: 'State=Hover' }], [pv({ Size: 'sm', State: 'Default' }), pv({ Size: 'md', State: 'Default' }), pv({ Size: 'md', State: 'Hover' })], axes(['Size', 'State']));
  assert.deepEqual([...added.reuse], [['Size=md, State=Default', 'a'], ['Size=md, State=Hover', 'b']]);
  assert.deepEqual(added.orphans, []);
  // Size removed: the md ones become the variants, the sm ones are orphans named without Size, marked as removed.
  const removed = matchVariants(
    [{ id: 'a', key: 'Size=sm, State=Default' }, { id: 'b', key: 'Size=md, State=Default' }],
    [pv({ State: 'Default' })],
    axes(['State']),
  );
  assert.equal(removed.reuse.get('State=Default'), 'a', 'the first that fits');
  assert.deepEqual(removed.orphans, [{ id: 'b', name: 'State=Default (removed)' }]);
  // A value removed with the axes unchanged: the orphan keeps its name.
  const value = matchVariants([{ id: 'a', key: 'State=Default' }, { id: 'b', key: 'State=Hover' }], [pv({ State: 'Default' })], axes(['State']));
  assert.deepEqual(value.orphans, [{ id: 'b', name: 'State=Hover' }]);
  // No axes left: the lone variant, the others orphans with numbered names.
  const lone = matchVariants([{ id: 'a', key: 'State=Default' }, { id: 'b', key: 'State=Hover' }, { id: 'c', key: 'Size=sm' }], [pv({})], []);
  assert.equal(lone.reuse.get('Default'), 'a');
  assert.deepEqual(lone.orphans.map((o) => o.name), [`${LONE_VARIANT} (removed)`, `${LONE_VARIANT} (removed 2)`]);
});

test('the code adds an axis, then drops a value, then removes the axis: every set stays valid, the same nodes carry on, instances keep their main', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const specs = someSpecs();
  files[SPECS_PATH] = JSON.stringify(specs);
  const gh = new FakeGitHub(files);
  const first = await pull(gh);
  assert.equal(first.report.created, 3);
  const set = (name: string) => sim.sets().find((s) => s.name === name)!;
  const ids = (name: string) => Object.fromEntries(set(name).children.map((c) => [c.getSharedPluginData('dsbridge', 'variant'), c.id]));
  const before = Object.fromEntries(NAMES.map((n) => [n, ids(n)]));
  // A designer's instance of Badge Tone=danger, Appearance=solid, Size=sm.
  const used = set('Badge').children.find((c) => c.getSharedPluginData('dsbridge', 'variant') === 'Appearance=solid, Size=sm, Tone=danger')!;
  const instance = used.createInstance();

  // 1. Density added in front of every set.
  const dense = withDensity(specs);
  const sha1 = gh.pushToMain((f) => (f[SPECS_PATH] = JSON.stringify(dense)));
  const second = await pull(gh, first.a.headSha);
  assert.deepEqual(second.report.failed, []);
  assert.equal(second.report.orphaned, 0);
  for (const name of NAMES) {
    const props = propsOf(set(name));
    assert.ok(props.every((x) => Object.keys(x)[0] === 'Density' || 'Density' in x), `${name}: one shape`);
    // Each old variant is now its Density=regular variant: same node.
    for (const [key, id] of Object.entries(before[name]!)) {
      const now = set(name).children.find((c) => c.id === id)!;
      const was = key === 'Default' ? {} : Object.fromEntries(key.split(', ').map((x) => x.split('=') as [string, string]));
      assert.equal(now.getSharedPluginData('dsbridge', 'variant'), variantKeyOf({ Density: 'regular', ...was }), `${name} ${key}`);
    }
    assert.ok(set(name).getSharedPluginData('dsbridge', 'signature'), `${name}: baseline stored`);
  }
  assert.equal(set('Checklist').children.length, 2);
  assert.equal(instance.mainId, used.id, 'the instance still shows the same variant');
  assert.deepEqual(pendingComponents(second.again), [], 'a re-pull has nothing to do');

  // 2. Badge drops the info tone: those variants stay, flagged, with names that fit.
  const noInfo = structuredClone(dense);
  const badge = noInfo.components.find((c) => c.name === 'Badge')!;
  badge.axes = badge.axes.map((a) => (a.name === 'Tone' ? { ...a, values: a.values.filter((v) => v !== 'info') } : a));
  badge.variants = badge.variants.filter((v) => v.props.Tone !== 'info');
  const sha2 = gh.pushToMain((f) => (f[SPECS_PATH] = JSON.stringify(noInfo)));
  const third = await pull(gh, sha1);
  assert.deepEqual(third.report.failed, []);
  const orphans = set('Badge').children.filter(isOrphan);
  assert.equal(orphans.length, 8);
  assert.ok(orphans.every((o) => o.variantProperties!.Tone === 'info'));
  assert.deepEqual(pendingComponents(third.again), []);

  // 3. Density removed again: the regular variants carry on, the dense ones become orphans, still one shape.
  const sha3 = gh.pushToMain((f) => (f[SPECS_PATH] = JSON.stringify({ ...noInfo, components: noInfo.components.map((c) => specs.components.find((s) => s.name === c.name && c.name !== 'Badge') ?? { ...c, axes: c.axes.filter((a) => a.name !== 'Density'), variants: c.variants.filter((v) => v.props.Density === 'regular').map((v) => { const { Density: _d, ...props } = v.props; return { ...v, props }; }) }) })));
  const fourth = await pull(gh, sha2);
  assert.deepEqual(fourth.report.failed, []);
  for (const name of NAMES) {
    const props = propsOf(set(name));
    assert.ok(props.every((x) => !('Density' in x)), `${name}: Density gone from every variant`);
    assert.equal(new Set(set(name).children.map((c) => c.name)).size, set(name).children.length, `${name}: no two variants alike`);
  }
  assert.equal(set('Checklist').children.filter((c) => !isOrphan(c))[0]!.name, LONE_VARIANT);
  // A review or a Push lists the set's values, not the orphans' "(removed)" ones.
  const defs = (await readComponent(set('Kbd') as unknown as ComponentSetNode)).definitions;
  assert.ok(defs.every((d) => !(d.options ?? []).some((o) => o.includes('(removed'))), JSON.stringify(defs));
  assert.equal(instance.mainId, used.id);
  assert.deepEqual(pendingComponents(fourth.again), []);
  assert.deepEqual(sim.loose(), []);
  void sha3;
});

test('a set an older DS Bridge left in error is rebuilt by the next pull, even when its spec did not change', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  files[SPECS_PATH] = JSON.stringify(someSpecs());
  const gh = new FakeGitHub(files);
  const first = await pull(gh);
  const kbd = sim.sets().find((s) => s.name === 'Kbd')!;
  // What the old update left: an orphan still named with an axis the set no longer has.
  const old = kbd.children[0]!.copy();
  old.name = 'Tone=neutral, Size=md';
  old.setSharedPluginData('dsbridge', 'variant', 'Size=md, Tone=neutral');
  old.setSharedPluginData('dsbridge', 'orphan', 'true');
  kbd.appendChild(old);
  assert.throws(() => propsOf(kbd), /existing errors/);
  // The update review reads it from its variant names meanwhile.
  const raw = await readComponent(kbd as unknown as ComponentSetNode);
  assert.deepEqual(raw.variants.map((v) => v.props).slice(-1), [{ Tone: 'neutral', Size: 'md' }]);
  const next = await pull(gh, first.a.headSha);
  assert.deepEqual(next.plan.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), ['Kbd']);
  assert.deepEqual(next.report.failed, []);
  assert.doesNotThrow(() => propsOf(kbd));
  assert.equal(old.name, 'Size=md (removed)');
  assert.deepEqual(pendingComponents(next.again), []);
});
