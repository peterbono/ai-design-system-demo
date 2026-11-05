// Parts only some variants render (a check mark only when checked, a description only in one placement) are parts of
// the set: a set drawn before the measure gave them gets them on the next Check for updates, built from the measure like
// the rest, and the designer's own layers stay. Fixture: the real measure of Checkbox and Switch (bridge-requests,
// 2026-11-05), each story's own tree, values and SVG.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashSpec, specsFromMeasure, type ComponentSpec } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { parseMeasuredSpecs } from '../src/sync/measured-specs';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const measure = () => parseMeasuredSpecs(readFileSync(join(process.cwd(), 'test/fixtures/measured-parts.json'), 'utf8'));
const setOf = (name: string) => specsFromMeasure(measure()).specs.components.find((c) => c.name === name)!;

/** The set as Bridge drew it before: the default story's parts only. */
function without(spec: ComponentSpec, ids: string[]): ComponentSpec {
  const gone = new Set(ids);
  const keep = <T>(o: Record<string, T> | undefined) => (o ? Object.fromEntries(Object.entries(o).filter(([k]) => !gone.has(k))) : o);
  const c: ComponentSpec = {
    ...spec,
    hash: '',
    parts: spec.parts.filter((p) => !gone.has(p.id)),
    variants: spec.variants.map((v) => {
      const hidden = v.hidden?.filter((h) => !gone.has(h));
      const vectors = keep(v.vectors);
      const { hidden: _h, vectors: _v, ...rest } = v;
      return { ...rest, values: keep(v.values)!, ...(hidden?.length ? { hidden } : {}), ...(vectors && Object.keys(vectors).length ? { vectors } : {}) };
    }),
  };
  return { ...c, hash: hashSpec(c) };
}

test('the measure: a part only some variants render is a part of the set, hidden where its story does not render it', () => {
  const checkbox = setOf('Checkbox');
  assert.deepEqual(
    checkbox.parts.map((p) => `${p.id}<${p.parent ?? ''}`),
    ['root<', 'box<root', 'indicator<box', 'lucide<indicator', 'text<root', 'label<text'],
    'the check mark sits in the box, as in code',
  );
  assert.equal(checkbox.parts.find((p) => p.id === 'lucide')!.kind, 'vector');
  const variant = (checked: string) => checkbox.variants.find((v) => v.props.Checked === checked && v.props.State === 'Default' && v.props['Default checked'] === 'false')!;
  assert.deepEqual(variant('false').hidden, ['indicator', 'lucide']);
  assert.equal(variant('true').hidden, undefined);
  // Each checked state draws its own mark: the check, and the dash when mixed.
  assert.match(variant('true').vectors!.lucide!.svg, /<svg/);
  assert.notEqual(variant('true').vectors!.lucide!.svg, variant('mixed').vectors!.lucide!.svg);
  // The mark keeps the size its CSS sets; the indicator around it hugs it.
  assert.deepEqual([variant('true').values.lucide!.width, variant('true').values.lucide!.height], [12, 12]);

  const sw = setOf('Switch');
  assert.ok(sw.parts.some((p) => p.id === 'description' && p.parent === 'text' && p.kind === 'text'), 'the description the start placement shows');
  const placed = (placement: string) => sw.variants.find((v) => v.props['Label placement'] === placement && v.props.Size === 'md' && v.props.Checked === 'false' && v.props.State === 'Default' && v.props['Default checked'] === 'false')!;
  assert.deepEqual(placed('end').hidden, ['description']);
  assert.equal(placed('start').hidden, undefined);
});

test('Check for updates: a set drawn without the check mark gets it from the measure, and the designer\'s layers stay', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const a = await analyze(new FakeGitHub(files).client(), DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const now = setOf('Checkbox');
  const before = without(now, ['indicator', 'lucide']);
  const first = await applyComponentPlan(writablePlan(buildComponentPlan({ version: 1, generated: '', components: [before] }, 'measured-specs.json', await scanGenerated(), a.head)));
  assert.deepEqual(first.failed, []);
  const set = sim.sets().find((s) => s.name === 'Checkbox')!;
  const variant = (checked: string) => set.children.find((v) => v.name.includes(`Checked=${checked}`) && v.name.includes('State=Default') && v.name.includes('Default checked=false'))!;
  assert.equal(variant('true').findOne((n) => n.name === 'Indicator'), null, 'drawn before the measure knew the mark');

  // The designer's own work in the set: a layer of theirs.
  const note = figma.createFrame();
  note.name = 'Designer note';
  variant('true').appendChild(note as never);

  // Check for updates: the measure now gives the mark, so the set is an update, built in place.
  const plan = buildComponentPlan({ version: 1, generated: '', components: [now] }, 'measured-specs.json', await scanGenerated(), a.head);
  assert.equal(plan.components[0]!.status, 'updated');
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.failed, []);
  assert.equal(report.updated, 1);
  assert.equal(sim.sets().find((s) => s.name === 'Checkbox'), set, 'the same set, not a new one');

  const indicator = (checked: string) => variant(checked).findOne((n) => n.name === 'Indicator')!;
  for (const checked of ['true', 'mixed']) {
    const ind = indicator(checked);
    assert.ok(ind, `Checked=${checked} has the indicator`);
    assert.equal(ind.parent!.name, 'Box', 'inside the box, as in code');
    assert.equal(ind.visible, true);
    assert.equal(ind.layoutSizingHorizontal, 'HUG');
    const mark = ind.findOne((n) => n.name === 'Lucide')!;
    assert.deepEqual([mark.width, mark.height], [12, 12]);
    assert.ok(mark.findAll((n) => n.type === 'VECTOR').length > 0, `Checked=${checked}: the mark draws its shape`);
  }
  assert.equal(indicator('false').visible, false, 'unchecked: there, hidden');
  assert.ok(variant('true').findOne((n) => n.name === 'Designer note'), 'the designer\'s layer stays');

  // Next Check for updates: nothing left to do.
  const again = buildComponentPlan({ version: 1, generated: '', components: [now] }, 'measured-specs.json', await scanGenerated(), a.head);
  assert.equal(again.components[0]!.status, 'unchanged');
});
