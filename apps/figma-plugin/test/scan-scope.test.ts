// A scan reads each component it is given (with an image per variant): after a pull it reads only what can have
// changed, so a big file does not take minutes to settle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { scanComponents } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('scan scope: only some sets, all but the ones just built, or only the ones with no baseline', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  files['packages/react/component-specs.json'] = JSON.stringify({ ...main, coverage: undefined, components: main.components.filter((c) => ['Badge', 'Kbd', 'Divider'].includes(c.name)) });
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const report = await applyComponentPlan(writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head)));
  const id = (name: string) => sim.sets().find((s) => s.name === name)!.id;
  const names = async (scope: Parameters<typeof scanComponents>[1]) => (await scanComponents(() => {}, scope)).components.map((c) => c.name).sort();
  assert.deepEqual(await names({}), ['Badge', 'Divider', 'Kbd']);
  assert.deepEqual(await names({ nodeIds: [id('Kbd')] }), ['Kbd']);
  assert.deepEqual(await names({ skip: report.nodeIds }), []);
  // Every built set has its baseline: none left to read.
  assert.deepEqual(await names({ withoutBaseline: true }), []);
  sim.sets().find((s) => s.name === 'Divider')!.setSharedPluginData('dsbridge', 'signature', '');
  assert.deepEqual(await names({ withoutBaseline: true }), ['Divider']);
});
