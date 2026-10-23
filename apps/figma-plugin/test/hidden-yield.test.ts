// Behind a locked screen or in a hidden window, Figma throttles timers (a turn takes up to a minute). The build then
// gives Figma its turns through the UI (messages are not throttled); shown again, it uses 30 ms timer turns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { enableUiTurns, isTurnReply, turnReply } from '../src/main/turns';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

/** The plugin window: answers each turn on the next task, saying whether its page is hidden. */
function installUi(pageHidden: () => boolean): { turns: number } {
  const ui = { turns: 0 };
  const figma = (globalThis as unknown as { figma: { ui: { postMessage: (m: unknown) => void } } }).figma;
  figma.ui = {
    postMessage: (m: unknown) => {
      if (!m || typeof m !== 'object' || (m as { kind?: string }).kind !== 'turn') return;
      ui.turns++;
      const reply = { kind: 'turn', id: (m as { id: number }).id, hidden: pageHidden() };
      setImmediate(() => isTurnReply(reply) && turnReply(reply));
    },
  };
  enableUiTurns();
  return ui;
}

async function build(turnMs: number, ui?: () => boolean): Promise<{ turns: number; waited: number; uiTurns: number }> {
  const sim = new SimFigma();
  sim.install();
  const window = ui ? installUi(ui) : { turns: 0 };
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
  return { turns, waited, uiTurns: window.turns };
}

test('hidden window: turns go through the UI, not throttled timers; shown again, 30 ms timer turns', async () => {
  const shown = await build(16, () => false);
  assert.equal(shown.uiTurns, 0, 'shown: timer turns only');
  // Locked screen: a timer turn takes a minute and the UI says the page is hidden.
  const hidden = await build(60_000, () => true);
  assert.equal(hidden.turns, 1, `one slow timer turn, then turns through the UI: ${hidden.turns} timer turns, ${hidden.uiTurns} UI turns`);
  assert.ok(hidden.uiTurns >= shown.turns - 2, `${hidden.uiTurns} UI turns`);
  assert.equal(hidden.waited, 60_000);
  // A UI that cannot tell (it says shown): a timer turn is tried again only after nine slow turns' time.
  const unknown = await build(60_000, () => false);
  assert.ok(unknown.turns <= 2, `${unknown.turns} timer turns`);
  // Shown again: the next build yields with timers, as before.
  const again = await build(16, () => false);
  assert.equal(again.turns, shown.turns);
  assert.equal(again.uiTurns, 0);
});

test('a busy file that is shown (turns of 250 ms): longer slices, far fewer turns, never read as hidden', async () => {
  const quiet = await build(16, () => false);
  const busy = await build(250, () => false);
  assert.equal(busy.uiTurns, 0, 'not hidden: timer turns');
  assert.ok(busy.turns * 4 < quiet.turns, `busy ${busy.turns} turns, quiet ${quiet.turns}`);
  // Waiting stays a small share: about a fifth of the work at most.
  assert.ok(busy.waited <= quiet.turns * 5 * 30 * 0.3 + 250, `waited ${busy.waited} ms`);
});
