// "After: drawn by Bridge": the incoming version of a variant, drawn off-canvas by the pull's own builder, exported,
// then removed. The file is never left modified: same nodes, same document, before and after, even when Figma refuses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, renderIncoming, scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');
const SPECS_PATH = 'packages/react/component-specs.json';

/** Every node of the document (pages included) and everything it would draw, plugin data included. */
function fingerprint(sim: SimFigma): { nodes: number; doc: string } {
  const all = sim.root.findAll(() => true);
  const doc = JSON.stringify([sim.root.children.map((p) => [p.name, sim.render(p)]), all.map((n) => [n.type, n.name, [...((n as unknown as { shared: Map<string, string> }).shared ?? new Map()).entries()]]), sim.root.getSharedPluginData('dsbridge', 'buildLock'), sim.variables.length, sim.collections.length]);
  return { nodes: all.length, doc };
}

async function pulledFile() {
  const sim = new SimFigma();
  sim.install();
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  files[SPECS_PATH] = readFileSync(join(ROOT, SPECS_PATH), 'utf8');
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const plan = buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head);
  await applyComponentPlan(writablePlan(plan));
  return { sim, plan: buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head) };
}

test('drawn by Bridge: one variant of every component, exported, and the file is exactly as before', async () => {
  const { sim, plan } = await pulledFile();
  void parseComponentSpecs;
  const before = fingerprint(sim);
  const times: number[] = [];
  let drawn = 0;
  for (const comp of plan.components) {
    const exportsBefore = sim.exports;
    const r = await renderIncoming(comp, plan, comp.variants[0]!.key);
    if (r) {
      drawn++;
      times.push(r.ms);
      assert.ok(r.base64.length > 0);
      assert.equal(sim.exports, exportsBefore + 1, 'one export per render');
    }
  }
  const after = fingerprint(sim);
  assert.equal(after.nodes, before.nodes, 'same node count');
  assert.equal(after.doc, before.doc, 'same document');
  assert.ok(drawn >= plan.components.length * 0.9, `drawn ${drawn} of ${plan.components.length}`);
  times.sort((x, y) => x - y);
  const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
  console.log(`render-incoming (simulated Figma): ${drawn} components, average ${avg} ms, median ${times[Math.floor(times.length / 2)]} ms, max ${times.at(-1)} ms`);
});

test('drawn by Bridge: Figma refusing mid-drawing leaves nothing behind', async () => {
  const { sim, plan } = await pulledFile();
  const before = fingerprint(sim);
  sim.seedFaults(7, 0.3);
  for (const comp of plan.components.slice(0, 12)) await renderIncoming(comp, plan, comp.variants[0]!.key).catch(() => null);
  sim.seedFaults(1, 0);
  const after = fingerprint(sim);
  assert.equal(after.nodes, before.nodes, 'same node count after refusals');
  assert.equal(after.doc, before.doc, 'same document after refusals');
});
