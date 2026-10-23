// A token renamed in code (its id kept) is renamed in Figma by the pull. Component baselines name the variables they
// bind, so they follow the new name: a Push right after reads no component change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { applyComponentPlan, scanGenerated } from '../src/main/build-components';
import { renameInBaselines, scanComponents } from '../src/main/components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, writablePlan } from '../src/sync/component-pull';
import { classifyComponents } from '../src/sync/components';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('a variable the pull renamed is renamed in the component baselines: nothing to push', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const main = parseComponentSpecs(readFileSync(join(process.cwd(), '../../packages/react/component-specs.json'), 'utf8'));
  files['packages/react/component-specs.json'] = JSON.stringify({ ...main, coverage: undefined, components: main.components.filter((c) => c.name === 'Badge') });
  const gh = new FakeGitHub(files);
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(first, new Map()).plan);
  const loaded = await loadComponentSpecs(client, first.headFiles.treeSha, first.headFiles.config);
  await applyComponentPlan(writablePlan(buildComponentPlan(loaded!.specs, loaded!.path, await scanGenerated(), first.head)));
  const coded = ['Badge'];
  const changed = async () => classifyComponents((await scanComponents(() => {})).components, coded).changed.map((c) => c.component);
  assert.deepEqual(await changed(), []);

  // The code renames color.feedback.success.bg to .surface, keeping its id.
  gh.pushToMain((f) => {
    for (const theme of ['light', 'dark']) {
      const d = JSON.parse(f[`${p}/semantic/${theme}.tokens.json`]!);
      const s = d.color.feedback.success;
      d.color.feedback.success = Object.fromEntries(
        Object.entries(s).map(([k, v]) => (k === 'bg' ? ['surface', { ...(v as object), $extensions: { 'com.dsbridge.id': 'path:color.feedback.success.bg' } }] : [k, v])),
      );
      f[`${p}/semantic/${theme}.tokens.json`] = JSON.stringify(d);
    }
    f[`${p}/contrast.checks.json`] = f[`${p}/contrast.checks.json`]!.replaceAll('color.feedback.success.bg', 'color.feedback.success.surface');
  });
  const a = await analyze(client, DEFAULT_SETTINGS, { baseSha: first.headSha }, await takeSnapshot());
  const report = await applyPullPlan(buildPull(a, new Map()).plan);
  assert.deepEqual(report.renamed, [{ from: 'color/feedback/success/bg', to: 'color/feedback/success/surface' }]);
  // Without following the rename, every Badge binding to it reads as a Figma edit.
  assert.deepEqual(await changed(), ['Badge']);
  assert.ok((await renameInBaselines(report.renamed!)) >= 1);
  assert.deepEqual(await changed(), []);
});
