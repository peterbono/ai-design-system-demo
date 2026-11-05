// The spec source defaults to the measure (Automatic): a file pulled from component-specs.json moves onto the measure on
// its next Check for updates. Same sets, updated in place: the layers named the same carry over (instances keep their
// label overrides), what only the static spec drew goes, the designer's own layers stay, and no set is added twice.
// Fixtures: the real Button, Checkbox and Switch from packages/react/component-specs.json (main) and from the measure
// on bridge-requests (2026-11-05).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs, specsFromMeasure } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { sharedSettings, saveSettings, type SharedStore } from '../src/main/shared-state';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, specSource, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { MEASURED_SPECS_FILE, parseMeasuredSpecs } from '../src/sync/measured-specs';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const fx = (f: string) => readFileSync(join(process.cwd(), 'test/fixtures', f), 'utf8');
const SPECS_PATH = 'packages/react/component-specs.json';
const staticText = () => fx('static-switch-source.json');
const measureText = () => fx('measured-switch-source.json');

test('Automatic: the measure when the team has one (repo or measure branch), else the static spec; a choice is kept', async () => {
  const config = JSON.parse(realConfigText());
  const at = async (files: Record<string, string>, branchMeasure = false) => {
    const gh = new FakeGitHub({ 'bridge.config.json': realConfigText(), ...files });
    const client = gh.client();
    const main = (await client.getBranchSha('main'))!;
    if (branchMeasure) gh.branches.set('bridge-requests', gh.commit({ ...gh.filesAt('main'), [MEASURED_SPECS_FILE]: measureText() }, [main], 'measure'));
    return { client, treeSha: await client.getCommitTree(main) };
  };
  const noMeasure = await at({ [SPECS_PATH]: staticText() });
  const auto = (await specSource('auto').load(noMeasure.client, noMeasure.treeSha, config))!;
  assert.equal(auto.source, 'static');
  assert.equal(auto.path, SPECS_PATH);

  const onBranch = await at({ [SPECS_PATH]: staticText() }, true);
  const measured = (await specSource('auto').load(onBranch.client, onBranch.treeSha, config))!;
  assert.equal(measured.source, 'measured-only');
  assert.equal(measured.path, MEASURED_SPECS_FILE);
  assert.deepEqual(measured.specs.components.map((c) => c.name).sort(), ['Button', 'Checkbox', 'Switch']);
  // A developer who chose Static keeps it, measure or not.
  assert.equal((await specSource('static').load(onBranch.client, onBranch.treeSha, config))!.source, 'static');

  // A measure Bridge cannot read: the file stays on the static spec, the pull goes on.
  const broken = await at({ [SPECS_PATH]: staticText(), [MEASURED_SPECS_FILE]: '{"version":99}' });
  assert.equal((await specSource('auto').load(broken.client, broken.treeSha, config))!.source, 'static');
});

test('the setting: nothing saved is Automatic, and an explicit Static is kept', () => {
  const data = new Map<string, string>();
  const root: SharedStore = { get: (k) => data.get(k) ?? '', set: (k, v) => void data.set(k, v), keys: () => [...data.keys()] };
  const base = { repo: 'acme/ds', branch: 'main', tokensPath: 'tokens' };
  saveSettings(root, base);
  assert.equal(sharedSettings(root).specSource, undefined);
  saveSettings(root, { ...base, specSource: 'static' });
  assert.equal(sharedSettings(root).specSource, 'static');
  saveSettings(root, { ...base });
  assert.equal(sharedSettings(root).specSource, undefined, 'back to Automatic');
});

test('Check for updates on a file pulled from the static spec: the same sets move onto the measure, cleanly', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const a = await analyze(new FakeGitHub(files).client(), DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);

  // The file as the owner has it: pulled from component-specs.json, before the source was stored on sets.
  const first = await applyComponentPlan(writablePlan(buildComponentPlan(parseComponentSpecs(staticText()), SPECS_PATH, await scanGenerated(), a.head)));
  assert.deepEqual(first.failed, []);
  assert.equal(first.created, 3);
  type Set = ReturnType<typeof sim.sets>[number];
  type Node = Set['children'][number];
  const sets = new Map(sim.sets().map((s) => [s.name, s]));
  const live = (s: Set) => s.children.filter((v) => v.getSharedPluginData('dsbridge', 'orphan') !== 'true');
  const variant = (s: Set, name: string) => s.children.find((v) => v.name === name)!;
  const textOf = (v: Node, name: string) => v.findOne((n) => n.type === 'TEXT' && n.name === name);
  const button = sets.get('Button')!;
  const buttonDefault = variant(button, 'Variant=primary, Size=md, State=Default');
  const buttonLabel = textOf(buttonDefault, 'Label')!.id;
  const checkbox = sets.get('Checkbox')!;
  const checked = variant(checkbox, 'Checked=true, State=Default');
  const note = figma.createFrame();
  note.name = 'Designer note';
  checked.appendChild(note as never);
  const switchLabel = textOf(variant(sets.get('Switch')!, 'Label placement=end, Size=md, Checked=false, State=Default'), 'Label')!.id;

  // Automatic found the measure: every set is rebuilt from it, even when its hash alone would not say so.
  const measured = specsFromMeasure(parseMeasuredSpecs(measureText())).specs;
  const plan = buildComponentPlan(measured, MEASURED_SPECS_FILE, await scanGenerated(), a.head, { specSource: 'measured-only' });
  assert.deepEqual(plan.components.map((c) => [c.name, c.status, c.sourceChanged?.from, c.sourceChanged?.to]), [
    ['Button', 'updated', 'static', 'measured-only'],
    ['Checkbox', 'updated', 'static', 'measured-only'],
    ['Switch', 'updated', 'static', 'measured-only'],
  ]);
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.failed, []);
  assert.equal(report.updated, 3);
  assert.equal(report.created, 0);

  // Same three sets, none added.
  assert.equal(sim.sets().length, 3);
  for (const s of sim.sets()) assert.equal(s, sets.get(s.name), `${s.name}: the same set`);

  // Button: the label layer carries over (instances keep their text), the icon slots only the static spec drew go,
  // with their properties.
  const bDefault = variant(button, 'Loading=false, Full width=false, Variant=primary, Size=md, State=Default');
  assert.equal(bDefault, buttonDefault, 'the same variant, renamed with the measure\'s axes');
  assert.equal(bDefault.children.find((n) => n.type === 'TEXT' && n.name === 'Label')!.id, buttonLabel, 'the same label layer');
  for (const v of live(button)) assert.equal(v.findOne((n) => n.name === 'Icon start' || n.name === 'Icon end'), null, `${v.name}: no static icon slot left`);
  assert.deepEqual(Object.keys(button.componentPropertyDefinitions).map((k) => k.replace(/#.*$/, '')), ['Loading', 'Full width', 'Variant', 'Size', 'State', 'Label']);

  // Checkbox: the mark the measure draws replaces the static icons; the designer's layer stays.
  const cChecked = variant(checkbox, 'Default checked=false, Checked=true, State=Default');
  assert.equal(cChecked, checked);
  const indicator = cChecked.findOne((n) => n.name === 'Indicator')!;
  assert.deepEqual(indicator.children.map((n) => n.name), ['Lucide']);
  for (const v of live(checkbox)) assert.equal(v.findAll((n) => n.type === 'INSTANCE').length, 0, `${v.name}: no static icon instance left`);
  assert.ok(cChecked.findOne((n) => n.name === 'Designer note'), 'the designer\'s layer stays');
  // The two variants the measure does not have (disabled, not checked by default) are flagged, as code removals are.
  assert.deepEqual(
    checkbox.children.filter((v) => v.getSharedPluginData('dsbridge', 'orphan') === 'true').map((v) => v.name),
    ['Default checked=false, Checked=false, State=Disabled', 'Default checked=false, Checked=true, State=Disabled'],
  );

  // Switch: the lone label of the text column carries over under the measure's name.
  const sDefault = variant(sets.get('Switch')!, 'Default checked=false, Label placement=end, Size=md, Checked=false, State=Default');
  assert.equal(textOf(sDefault, 'Text text')!.id, switchLabel);

  // The sets now say where they come from: the next check has nothing to do.
  assert.deepEqual((await scanGenerated()).map((g) => g.specSource), ['measured-only', 'measured-only', 'measured-only']);
  const again = buildComponentPlan(measured, MEASURED_SPECS_FILE, await scanGenerated(), a.head, { specSource: 'measured-only' });
  assert.deepEqual(again.components.map((c) => c.status), ['unchanged', 'unchanged', 'unchanged']);
});
