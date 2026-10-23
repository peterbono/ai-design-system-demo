// Two designers pulling components into the same file at once would both build the new sets. A pull holds a lock in
// the file while it builds; another one waits, unless the lock was left by a pull that stopped long ago.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, otherBuild, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('a teammate\'s pull in progress blocks a second one; a stale lock does not; the lock is released at the end', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  files['packages/react/component-specs.json'] = JSON.stringify({ ...main, coverage: undefined, components: main.components.filter((c) => c.name === 'Kbd') });
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const plan = writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head));
  const root = sim.root;
  // A teammate started 3 minutes ago and is still building (last heartbeat now).
  root.setSharedPluginData('dsbridge', 'buildLock', JSON.stringify({ session: 'teammate', started: Date.now() - 180_000, at: Date.now() }));
  assert.ok(otherBuild());
  await assert.rejects(applyComponentPlan(plan), /Someone else is pulling components into this file \(started 3 min ago\)/);
  assert.equal(sim.sets().length, 0, 'nothing built');
  // Their pull stopped 5 minutes ago (Figma closed): the lock no longer holds.
  root.setSharedPluginData('dsbridge', 'buildLock', JSON.stringify({ session: 'teammate', started: Date.now() - 600_000, at: Date.now() - 300_000 }));
  assert.equal(otherBuild(), undefined);
  const report = await applyComponentPlan(plan);
  assert.equal(report.created, 1);
  assert.equal(root.getSharedPluginData('dsbridge', 'buildLock'), '', 'released');
});
