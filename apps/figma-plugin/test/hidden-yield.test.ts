// Behind a locked screen or in a hidden window, Figma throttles timers (a turn takes about a second). The build then
// works longer between turns instead of spending most of its time waiting; shown again, it yields every 30 ms.
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

async function build(turnMs: number): Promise<{ turns: number; waited: number }> {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  files['packages/react/component-specs.json'] = JSON.stringify({ ...main, coverage: undefined, components: main.components.filter((c) => ['Button', 'Badge', 'Alert'].includes(c.name)) });
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const plan = writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head));
  // Each zero-delay timer is a turn: it costs `turnMs` on the clock (no real wait) and every millisecond of work
  // costs 5, so slices fill up as in Figma.
  const realTimeout = globalThis.setTimeout;
  const realNow = Date.now;
  let clock = realNow();
  let turns = 0;
  let waited = 0;
  Date.now = () => (clock += 5);
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    if (!ms) {
      turns++;
      clock += turnMs;
      waited += turnMs;
    }
    return realTimeout(fn, 0);
  }) as typeof setTimeout;
  try {
    const report = await applyComponentPlan(plan);
    assert.deepEqual(report.failed, []);
  } finally {
    globalThis.setTimeout = realTimeout;
    Date.now = realNow;
  }
  return { turns, waited };
}

test('hidden window: far fewer turns when each costs 400 ms, and 30 ms slices again once turns are fast', async () => {
  const shown = await build(16);
  const hidden = await build(400);
  const shownAgain = await build(16);
  assert.ok(hidden.turns * 5 < shown.turns, `hidden ${hidden.turns} turns, shown ${shown.turns}`);
  // Waiting stays a small share of the time: at most about a tenth of it, plus the first turn that measured it.
  assert.ok(hidden.waited < shown.waited * 2 + 400 * 2, `waited ${hidden.waited} ms hidden, ${shown.waited} ms shown`);
  assert.equal(shownAgain.turns, shown.turns, 'back to 30 ms slices');
});
