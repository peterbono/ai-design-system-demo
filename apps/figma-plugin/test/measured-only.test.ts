// Spec source "measured only": every set built from measured-specs.json alone, as for a design system with a Storybook
// and no component-specs.json. Fixture: the real measure of Breadcrumb, Card, Menu, NumberField and Tabs (main,
// 2026-10-24) with the forced states and props the measure recorded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs, variantKeyOf } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { type SharedStore, saveSettings, sharedSettings } from '../src/main/shared-state';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { specsFromMeasure } from '../src/sync/measured-only';
import { parseMeasuredSpecs } from '../src/sync/measured-specs';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const fixture = () => parseMeasuredSpecs(readFileSync(join(process.cwd(), 'test/fixtures/measured-worse-sets.json'), 'utf8'));
const staticSpecs = () => parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
const axesOf = (c: { axes: { name: string; values: string[] }[] }) => c.axes.map((a) => `${a.name}=${a.values.join('|')}`);

test('measured only: Tabs gets the axes of code from its stories alone, the states its CSS styles', () => {
  const { specs, report } = specsFromMeasure(fixture());
  assert.ok(report.sets >= 4, `${report.sets} sets`);
  const tabs = specs.components.find((c) => c.name === 'Tabs')!;
  const code = staticSpecs().components.find((c) => c.name === 'Tabs')!;
  for (const axis of ['Variant', 'Size', 'Orientation']) assert.deepEqual(axesOf(tabs).find((a) => a.startsWith(`${axis}=`)), axesOf(code).find((a) => a.startsWith(`${axis}=`)), axis);
  // Every variant draws the parts of the default one, by the same ids.
  for (const v of tabs.variants) for (const id of Object.keys(v.values)) assert.ok(tabs.parts.some((p) => p.id === id), id);
  // A frame with content hugs it: no measured px width on the root.
  assert.ok(tabs.variants.every((v) => typeof v.values.root?.width !== 'number'));
});

test('measured only: a pressed state that draws like hover is not a state of its own', () => {
  const m = fixture();
  const card = m.stories.filter((s) => s.title.endsWith('/Card'));
  // Pressed copies of the hover stories, drawing the same: the CSS does not style :active.
  const hover = card.filter((s) => s.state === 'hover');
  m.stories.push(...hover.map((s) => ({ ...s, id: `${s.id}-active`, state: 'active' as const })));
  const states = specsFromMeasure(m).specs.components.find((c) => c.name === 'Card')!.axes.find((a) => a.name === 'State')?.values ?? [];
  assert.ok(!states.includes('Pressed'), states.join(', '));
});

test('measured only: the sets build in Figma with the variables of the repo, no part failing', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const { specs } = specsFromMeasure(fixture());
  const report = await applyComponentPlan(writablePlan(buildComponentPlan(specs, 'measured-specs.json', await scanGenerated(), a.head)));
  assert.deepEqual(report.failed, []);
  assert.equal(sim.sets().length, specs.components.length);
});

test('the setting: measured only round-trips', () => {
  const data = new Map<string, string>();
  const root: SharedStore = { get: (k) => data.get(k) ?? '', set: (k, v) => void data.set(k, v), keys: () => [...data.keys()] };
  saveSettings(root, { repo: 'acme/ds', branch: 'main', tokensPath: 'tokens', specSource: 'measured-only' });
  assert.equal(sharedSettings(root).specSource, 'measured-only');
});

test('measured only: a token the library does not have, or a color with none, takes the measured literal', () => {
  const m = fixture();
  const story = m.stories.find((s) => s.title.endsWith('/Card') && s.spec)!;
  m.stories = [story];
  story.spec!.values.root = { ...story.spec!.values.root, fill: 'acme.surface' };
  story.spec!.raw.root = { ...story.spec!.raw.root, fill: 'rgb(255, 0, 170)' };
  const { specs } = specsFromMeasure(m, { known: (p) => p !== 'acme.surface' });
  assert.equal(specs.components[0]!.variants[0]!.values.root!.fill, 'rgb(255, 0, 170)');
});

test('literals build in Figma: a font weight, a line height in px, a letter spacing and an rgb() color', async () => {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const spec = {
    name: 'Acme Chip',
    hash: 'x',
    source: ['https://storybook.acme.dev'],
    axes: [],
    properties: [],
    parts: [
      { id: 'root', name: 'Root', kind: 'frame' as const, layout: { direction: 'HORIZONTAL' as const, primary: 'CENTER' as const, counter: 'CENTER' as const } },
      { id: 'label', name: 'Label', kind: 'text' as const, parent: 'root', characters: 'Chip' },
    ],
    variants: [{ props: {}, values: { root: { fill: 'rgb(255, 0, 170)', paddingLeft: 12 }, label: { textFill: '#1f2937', fontFamily: '"Inter", sans-serif', fontSize: 14, fontWeight: 600, lineHeight: 18.9, letterSpacing: 0.5 } } }],
    unmapped: [],
  };
  const plan = buildComponentPlan({ version: 1, generated: '', components: [spec] }, 'measured-specs.json', await scanGenerated(), a.head);
  assert.deepEqual(plan.problems, []);
  const report = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.problems ?? [], []);
  const set = sim.sets().find((s) => s.name === 'Acme Chip')!;
  const label = set.children[0]!.findOne((n) => n.type === 'TEXT')!;
  assert.deepEqual(label.lineHeight, { unit: 'PIXELS', value: 18.9 });
  assert.deepEqual(label.letterSpacing, { unit: 'PIXELS', value: 0.5 });
  assert.equal((label.fontName as { style: string }).style.toLowerCase().includes('semi') || (label.fontName as { style: string }).style.toLowerCase().includes('bold'), true, JSON.stringify(label.fontName));
  const fill = (set.children[0]!.fills as { color: { r: number; b: number } }[])[0]!;
  assert.ok(fill.color.r > 0.99 && fill.color.b > 0.6, JSON.stringify(fill));
});

test('measured only with screenshots: each variant keeps the render of the story it was built from', () => {
  const m = fixture();
  m.stories = m.stories.filter((s) => s.title.endsWith('/Tabs'));
  m.stories.forEach((s, i) => (s.shot = { file: `measured-shots/tabs-${i}.png`, width: 320, height: 40 }));
  const { specs, shots } = specsFromMeasure(m);
  const tabs = specs.components.find((c) => c.name === 'Tabs')!;
  const keys = Object.keys(shots.Tabs ?? {});
  assert.equal(keys.length, tabs.variants.length, 'one render per variant');
  for (const v of tabs.variants) assert.ok(shots.Tabs![variantKeyOf(v.props)]?.file.startsWith('measured-shots/'));
});
