// A specs file edited by hand or by another tool keeps a stale "hash": the plan reads changes from the specs
// themselves, so the sets they change are updated all the same.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('a spec changed with its old hash left in the file is still an update; an unchanged file plans nothing', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  const specs = { ...main, coverage: undefined, components: main.components.filter((c) => ['Badge', 'Kbd'].includes(c.name)) };
  files['packages/react/component-specs.json'] = JSON.stringify(specs);
  const gh = new FakeGitHub(files);
  const client = gh.client();
  const plan = async () => {
    const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
    const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
    return { a, plan: buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head) };
  };
  const first = await plan();
  await applyPullPlan(buildPull(first.a, new Map()).plan);
  await applyComponentPlan(writablePlan(first.plan));
  assert.deepEqual((await plan()).plan.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), []);
  // Kbd's description changes, its "hash" field does not.
  gh.pushToMain((f) => {
    const s = JSON.parse(f['packages/react/component-specs.json']!);
    const kbd = s.components.find((c: { name: string }) => c.name === 'Kbd');
    kbd.description = `${kbd.description ?? ''} Edited by hand.`;
    f['packages/react/component-specs.json'] = JSON.stringify(s);
  });
  assert.deepEqual((await plan()).plan.components.filter((c) => c.status !== 'unchanged').map((c) => c.name), ['Kbd']);
});
