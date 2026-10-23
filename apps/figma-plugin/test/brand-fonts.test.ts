// Fonts follow the brand in Figma as in code: a font stack variable shows the family Figma has, generated text is
// bound to it, and Push reads the stack back unchanged.
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
import { analyze, buildPull, buildPush } from '../src/sync/flows';
import { stackFamily } from '../src/sync/mapping';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('stackFamily: the first family installed in Figma, else the first that is not generic, without " Variable"', () => {
  const installed = new Map([['ibm plex sans', 'IBM Plex Sans'], ['inter', 'Inter']]);
  assert.equal(stackFamily('IBM Plex Sans Variable, IBM Plex Sans, system-ui, sans-serif', installed), 'IBM Plex Sans');
  assert.equal(stackFamily('"Brand Grotesk", Inter, sans-serif', installed), 'Inter');
  assert.equal(stackFamily('Instrument Sans Variable, Instrument Sans, system-ui', new Map()), 'Instrument Sans');
  assert.equal(stackFamily('system-ui, sans-serif', new Map()), 'system-ui');
});

test('brand fonts: text is bound to the family variable, Ocean shows Plex Sans, and a Push right after the pull sends nothing', async () => {
  const styles = ['Regular', 'Medium', 'Semi Bold', 'Bold'];
  const sim = new SimFigma({ fonts: styles.flatMap((style) => ['Inter', 'Instrument Sans', 'Fraunces', 'IBM Plex Mono', 'IBM Plex Sans'].map((family) => ({ family, style }))) });
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  files['packages/react/component-specs.json'] = JSON.stringify({ ...main, coverage: undefined, components: main.components.filter((c) => c.name === 'Badge') });
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);
  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  const report = await applyComponentPlan(writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), a.head)));
  assert.deepEqual(report.failed, []);

  // The primitive shows the family Figma has; the stack stays in plugin data.
  const plex = sim.variables.find((v) => v.name === 'font/family/plex-sans')!;
  assert.deepEqual(Object.values(plex.valuesByMode), ['IBM Plex Sans']);
  assert.match(plex.getPluginData('stacks'), /IBM Plex Sans Variable/);

  // Badge's text is bound to a family variable; in the Ocean mode it resolves to Plex Sans, in Bridge to Instrument Sans.
  const text = sim.sets()[0]!.findAll((n) => n.type === 'TEXT')[0]!;
  const alias = text.boundVariables.fontFamily as { id: string } | undefined;
  assert.ok(alias, 'fontFamily is bound');
  const resolveIn = (id: string, mode: string): unknown => {
    const v = sim.variables.find((x) => x.id === id)!;
    const col = sim.collections.find((c) => c.id === v.variableCollectionId)!;
    const m = col.modes.find((x: { name: string }) => x.name === mode) ?? col.modes[0]!;
    const raw = v.valuesByMode[(m as { modeId: string }).modeId];
    return raw && typeof raw === 'object' && (raw as { type?: string }).type === 'VARIABLE_ALIAS' ? resolveIn((raw as { id: string }).id, mode) : raw;
  };
  assert.equal(resolveIn(alias.id, 'Ocean'), 'IBM Plex Sans');
  assert.equal(resolveIn(alias.id, 'Bridge'), 'Instrument Sans');

  // Read back: the stacks, unchanged. Nothing to push.
  const after = await analyze(client, DEFAULT_SETTINGS, { baseSha: a.headSha }, await takeSnapshot());
  assert.deepEqual(after.diff.local.map((d) => d.path), []);
  assert.equal(buildPush(after, new Map()).changes.length, 0);
});
