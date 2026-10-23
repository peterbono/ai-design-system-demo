// Updating a set whose layers code pins (position: absolute): the layer is absolute from the last pull, and Figma
// refuses to make an absolute layer fill its parent, so the update must take it back into the layout first.
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

const PINNED = ['Dialog/Popup', 'SidebarNav', 'SidebarNavSection', 'Tabs'];

test('sets with pinned layers update with no problem, and their pinned layers stay pinned', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  // The pinned sets and what they show (slots, icons): every spec of main, built once.
  files['packages/react/component-specs.json'] = JSON.stringify(main);
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const first = await applyComponentPlan(writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head)));
  assert.deepEqual(first.failed, []);
  const pinnedProblems = (list: string[]) => list.filter((x) => PINNED.some((n) => x.startsWith(`${n} `)));
  assert.deepEqual(pinnedProblems(first.problems), []);
  const absolute = () => sim.sets().filter((s) => PINNED.includes(s.name)).flatMap((s) => s.findAll((n) => n.layoutPositioning === 'ABSOLUTE')).length;
  const pinned = absolute();
  assert.ok(pinned > 0);
  // The code changed (here: the stored hash no longer matches), so the next pull updates them.
  for (const s of sim.sets()) if (PINNED.includes(s.name)) s.setSharedPluginData('dsbridge', 'specHash', '');
  const plan = buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head);
  assert.deepEqual(plan.components.filter((c) => c.status === 'updated').map((c) => c.name).sort(), [...PINNED].sort());
  const second = await applyComponentPlan(writablePlan(plan));
  assert.deepEqual(second.failed, []);
  assert.deepEqual(pinnedProblems(second.problems), []);
  assert.equal(absolute(), pinned, 'pinned layers are pinned again');
});
