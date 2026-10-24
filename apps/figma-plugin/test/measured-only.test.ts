// Spec source "measured only": every set built from measured-specs.json alone, as for a design system with a Storybook
// and no component-specs.json. Fixture: the real measure of Breadcrumb, Card, Menu, NumberField and Tabs (main,
// 2026-10-24) with the forced states and props the measure recorded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
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
