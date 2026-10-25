// Spec source "measured": the values `bridge specs --measure` read in Storybook laid onto the static specs. The
// fixture is the recorded measure of our Button primary story (packages/core/test/fixtures/measure, #475) in the
// measured-specs.json shape, with its props and the resolved value of the border token.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type MeasuredSpecsFile, parseComponentSpecs } from '@bridge-ds/core';
import { type SharedStore, saveSettings, sharedSettings } from '../src/main/shared-state';
import { loadComponentSpecs, specSource } from '../src/sync/component-pull';
import { MEASURED_SPECS_FILE, overlayMeasured, parseMeasuredSpecs } from '../src/sync/measured-specs';
import { FakeGitHub } from './fake-github';
import { realConfigText } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';
const specsText = () => readFileSync(join(ROOT, SPECS_PATH), 'utf8');
const measuredText = () => readFileSync(join(process.cwd(), 'test/fixtures/measured-specs.json'), 'utf8');
const measured = (): MeasuredSpecsFile => parseMeasuredSpecs(measuredText());
const variantOf = (specs: ReturnType<typeof parseComponentSpecs>, props: Record<string, string>) =>
  specs.components.find((c) => c.name === 'Button')!.variants.find((v) => Object.entries(props).every(([k, x]) => v.props[k] === x))!;
const PRIMARY_MD = { Variant: 'primary', Size: 'md', State: 'Default' };

test('a measured story gives its values to the variant its props name; the others stay static and are counted', () => {
  const specs = parseComponentSpecs(specsText());
  const { specs: out, report } = overlayMeasured(specs, measured());
  const buttonVariants = specs.components.find((c) => c.name === 'Button')!.variants.length;
  assert.equal(report.matched, 1, 'primary md at rest: the State axis takes its default');
  assert.equal(report.variants, specs.components.reduce((n, c) => n + c.variants.length, 0));
  assert.equal(report.unmatched, report.variants - 1);
  assert.ok(buttonVariants > 1);
  // Same values as the static spec on our library (the bench agrees on 95.9%): nothing moves here.
  const before = variantOf(specs, PRIMARY_MD);
  const after = variantOf(out, PRIMARY_MD);
  assert.equal(after.values.root!.fill, 'button.primary.bg');
  assert.equal(after.values.text!.textFill, 'button.primary.text', 'the label pairs with the text part by its CSS class');
  // The structure stays static: no width the measure read on a hugging button, same parts.
  assert.equal(after.values.root!.width, undefined);
  assert.deepEqual(Object.keys(after.values), Object.keys(before.values));
  // A border shorthand measures as the literal 1, the value of border-width.default in the page: the static token stays.
  assert.equal(after.values.root!.strokeWeight, before.values.root!.strokeWeight);
  assert.ok(report.keptTokens >= 1);
  assert.equal(report.literals, 0);
  // Unmatched variants are the static ones, untouched.
  assert.deepEqual(variantOf(out, { Variant: 'secondary', Size: 'md', State: 'Default' }), variantOf(specs, { Variant: 'secondary', Size: 'md', State: 'Default' }));
});

test('another token replaces the static one only when both resolve to the same value in the page', () => {
  // In real Figma, token swaps of another value came from parts paired with the wrong element (a menu item read as its
  // trigger button) and lost on fidelity: kept, and counted as conflicts to check.
  const m = measured();
  m.stories[0]!.spec!.values.root!.fill = 'button.secondary.bg';
  const kept = overlayMeasured(parseComponentSpecs(specsText()), m);
  assert.equal(variantOf(kept.specs, PRIMARY_MD).values.root!.fill, 'button.primary.bg');
  assert.equal(kept.report.conflicts, 1);
  // The same value under another name: the measure's name wins.
  m.components![0]!.resolved = { ...m.components![0]!.resolved, 'button.primary.bg': 'rgb(11, 74, 139)', 'button.secondary.bg': 'rgb(11, 74, 139)' };
  const taken = overlayMeasured(parseComponentSpecs(specsText()), m);
  assert.equal(variantOf(taken.specs, PRIMARY_MD).values.root!.fill, 'button.secondary.bg');
  assert.equal(taken.report.conflicts, 0);
});

test('a literal of another value never replaces the static token: kept, and counted to check', () => {
  // In real Figma, literals drawn over tokens lost on fidelity (a line height in px against a unitless token, a size
  // the layout computed, a part paired with the wrong element) and the builder cannot set a literal font weight.
  const m = measured();
  m.stories[0]!.spec!.values.root!.strokeWeight = 2;
  const { specs, report } = overlayMeasured(parseComponentSpecs(specsText()), m);
  assert.equal(variantOf(specs, PRIMARY_MD).values.root!.strokeWeight, 'border-width.default');
  assert.equal(report.literals, 1);
});

test('a hover story stands for Hover, a disabled one for Disabled, never for Default', () => {
  const specs = parseComponentSpecs(specsText());
  const hover = measured();
  hover.stories[0]!.state = 'hover';
  hover.stories[0]!.spec!.values.root!.fill = 'button.primary.bg-hover';
  const h = overlayMeasured(specs, hover);
  assert.equal(h.report.matched, 1);
  assert.equal(variantOf(h.specs, { ...PRIMARY_MD, State: 'Hover' }).values.root!.fill, 'button.primary.bg-hover');
  assert.equal(variantOf(h.specs, PRIMARY_MD).values.root!.fill, 'button.primary.bg');
  const disabled = measured();
  disabled.stories[0]!.overrides = { disabled: true };
  const d = overlayMeasured(specs, disabled);
  assert.equal(d.report.matched, 1, 'primary md Disabled');
  assert.deepEqual(variantOf(d.specs, PRIMARY_MD), variantOf(specs, PRIMARY_MD), 'Default keeps the static values');
});

test('a story titled by the set wins over the folder title several sets share', () => {
  const specs = parseComponentSpecs(specsText());
  const m = measured();
  const story = m.stories[0]!;
  // A Radio story through its group (Figma variants/Radio): checked comes from the group's value, as a story arg.
  const radio = { ...story, id: 'figma-variants-radio--checked', title: 'Figma variants/Radio', props: { label: 'Label', checked: true, disabled: false } };
  m.stories = [radio];
  const { specs: out, report } = overlayMeasured(specs, m);
  assert.equal(report.matched, 1);
  // The Radio variant was compared with the measure (its values taken, or kept as conflicts to check).
  assert.ok(report.fields + report.conflicts + report.keptTokens + report.literals > 0);
  // The same story under the folder title (Forms/RadioGroup) is not taken for the RadioGroup set: its axes differ.
  assert.equal(out.components.find((c) => c.name === 'RadioGroup')!.variants.every((v, i) => v === specs.components.find((c) => c.name === 'RadioGroup')!.variants[i]), true);
});

test('a mixed checkbox (indeterminate, checked false) stands for Checked=mixed, not false', () => {
  const specs = parseComponentSpecs(specsText());
  const m = measured();
  m.stories = [{ ...m.stories[0]!, id: 'forms-checkbox--mixed', title: 'Forms/Checkbox', props: { label: 'Label', checked: false, indeterminate: true, disabled: false } }];
  const { specs: out } = overlayMeasured(specs, m);
  const before = specs.components.find((c) => c.name === 'Checkbox')!.variants;
  const after = out.components.find((c) => c.name === 'Checkbox')!.variants;
  const changed = after.filter((v, i) => v !== before[i]).map((v) => v.props.Checked);
  assert.deepEqual(changed, ['mixed']);
});

test('a story without props, or with an error, matches nothing', () => {
  const specs = parseComponentSpecs(specsText());
  const noProps = measured();
  delete noProps.stories[0]!.props;
  assert.equal(overlayMeasured(specs, noProps).report.matched, 0);
  const failed = measured();
  failed.stories[0]!.error = 'the story threw';
  assert.equal(overlayMeasured(specs, failed).report.matched, 0);
  assert.throws(() => parseMeasuredSpecs('{"version":2,"stories":[]}'), /measured-specs\.json: version 2 is not supported .* Measure again with bridge specs --measure/);
});

/** A repo with the static specs (and the measure), and the tree of its main. */
async function repo(withMeasure: boolean) {
  const files: Record<string, string> = { 'bridge.config.json': realConfigText(), [SPECS_PATH]: specsText() };
  if (withMeasure) files[MEASURED_SPECS_FILE] = measuredText();
  const client = new FakeGitHub(files).client();
  return { client, treeSha: await client.getCommitTree((await client.getBranchSha('main'))!), config: JSON.parse(realConfigText()) };
}

test('spec source measured: the static specs with the measure laid on, and what it did; static reads as before', async () => {
  const { client, treeSha, config } = await repo(true);
  const loaded = (await specSource('measured').load(client, treeSha, config))!;
  assert.equal(loaded.path, SPECS_PATH);
  assert.equal(loaded.measured?.matched, 1);
  const plain = await specSource().load(client, treeSha, config);
  assert.deepEqual(plain, await loadComponentSpecs(client, treeSha, config));
  assert.equal(plain?.measured, undefined);
});

test('spec source measured without a measure in the repo: says how to make one or turn it off', async () => {
  const { client, treeSha, config } = await repo(false);
  await assert.rejects(specSource('measured').load(client, treeSha, config), /no measured-specs\.json\. Run bridge specs --measure .* or set Spec source back to Static/);
});

test('the setting: static stores nothing, measured round-trips, and turning it off clears it', () => {
  const data = new Map<string, string>();
  const root: SharedStore = { get: (k) => data.get(k) ?? '', set: (k, v) => void data.set(k, v), keys: () => [...data.keys()] };
  const base = { repo: 'acme/ds', branch: 'main', tokensPath: 'tokens' };
  saveSettings(root, base);
  assert.equal(data.has('specSource'), false);
  assert.equal(sharedSettings(root).specSource, undefined);
  saveSettings(root, { ...base, specSource: 'measured' });
  assert.equal(sharedSettings(root).specSource, 'measured');
  saveSettings(root, { ...base, specSource: 'static' });
  assert.equal(sharedSettings(root).specSource, undefined);
});

// Replay of the real-Figma comparison of 2026-10-24 (code images 16a59f27, test/measured-compare): Check fidelity on
// two files pulled with static and measured specs. The measured file got worse on 7 sets, through parts paired with
// the wrong element (a menu item read as its trigger button, hover on every tab). The fixture holds the measure of the
// components behind those sets, with the token values of the measured page.
const fixture = (name: string) => readFileSync(join(process.cwd(), 'test/fixtures', name), 'utf8');
type FidelityRow = { component: string; status: string; checked: number; differing: number };
const fidelity = (name: string) => (JSON.parse(fixture(`fidelity-${name}.json`)) as { components: FidelityRow[] }).components;

test('replay of the real-Figma comparison: on the sets measured made worse, no token becomes another value', () => {
  const stat = new Map(fidelity('static').map((c) => [c.component, c]));
  const worse = (rows: FidelityRow[]) => rows.filter((c) => c.differing > stat.get(c.component)!.differing).map((c) => c.component).sort();
  assert.deepEqual(worse(fidelity('measured-v2')), ['Breadcrumb', 'Card', 'MenuCheckboxItem', 'MenuItem', 'MenuSubmenu', 'NumberField', 'Tabs']);
  assert.equal(worse(fidelity('measured')).length, 11, 'with literals over tokens (the first run) it was 11');
  assert.equal(fidelity('measured-v2').filter((c) => c.differing < stat.get(c.component)!.differing).length, 0, 'better on none');

  const m = parseMeasuredSpecs(fixture('measured-worse-sets.json'));
  const specs = parseComponentSpecs(specsText());
  const { specs: out, report } = overlayMeasured(specs, m);
  const resolved: Record<string, string> = Object.assign({}, ...(m.components ?? []).map((c) => c.resolved ?? {}));
  const value = (v: unknown) => (typeof v === 'string' ? resolved[v] : undefined);
  let swaps = 0;
  for (const name of worse(fidelity('measured-v2'))) {
    const before = specs.components.find((c) => c.name === name)!;
    const after = out.components.find((c) => c.name === name)!;
    before.variants.forEach((v, i) => {
      for (const [part, fields] of Object.entries(v.values))
        for (const [field, was] of Object.entries(fields)) {
          const now = (after.variants[i]!.values[part] as Record<string, unknown>)[field];
          if (typeof was !== 'string' || now === was) continue;
          const where = `${name} ${JSON.stringify(v.props)} ${part}.${field}: ${was} -> ${JSON.stringify(now)}`;
          assert.equal(typeof now, 'string', `a token never becomes a literal: ${where}`);
          assert.ok(value(was) !== undefined && value(was) === value(now), `only a token of the same value: ${where}`);
          swaps++;
        }
    });
  }
  // The menu items' trigger-button tokens (button.radius, control.padding-x.md...) are conflicts, kept static.
  const item = out.components.find((c) => c.name === 'MenuItem')!.variants[0]!;
  assert.equal(item.values.root!.cornerRadius, specs.components.find((c) => c.name === 'MenuItem')!.variants[0]!.values.root!.cornerRadius);
  assert.ok(report.conflicts > 0, 'the wrong pairings are counted to check');
  assert.ok(swaps < report.conflicts, 'most measured swaps on these sets were wrong pairings');
});

