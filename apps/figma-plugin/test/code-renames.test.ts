// The code renames a token after the file was pulled: the pull renames the Figma variable in place, so everything
// bound to it (generated components, designs that use the library) keeps its binding.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPullPlan } from '../src/main/apply';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('a token the code renamed is the same Figma variable, renamed; nothing orphaned', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const gh = new FakeGitHub(files);
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(first, new Map()).plan);
  const before = sim.variables.find((v) => v.name === 'color/feedback/info/bg')!;
  assert.ok(before);

  gh.pushToMain((f) => {
    for (const theme of ['light', 'dark']) {
      const d = JSON.parse(f[`${p}/semantic/${theme}.tokens.json`]!);
      const info = d.color.feedback.info;
      d.color.feedback.info = Object.fromEntries(Object.entries(info).map(([k, v]) => [k === 'bg' ? 'surface' : k, v]));
      f[`${p}/semantic/${theme}.tokens.json`] = JSON.stringify(d);
    }
    f[`${p}/contrast.checks.json`] = f[`${p}/contrast.checks.json`]!.replaceAll('color.feedback.info.bg', 'color.feedback.info.surface');
  });
  const a = await analyze(client, DEFAULT_SETTINGS, { baseSha: first.headSha }, await takeSnapshot());
  assert.deepEqual(a.diff.conflicts, []);
  const kinds = a.diff.remote.map((e) => `${e.remote!.kind} ${e.path}`);
  assert.deepEqual(kinds, ['renamed color.feedback.info.surface']);
  const report = await applyPullPlan(buildPull(a, new Map()).plan);
  assert.equal(report.created, 0);
  assert.equal(report.orphaned, 0);
  const after = sim.variables.find((v) => v.id === before.id)!;
  assert.equal(after.name, 'color/feedback/info/surface', 'the same variable, renamed');
  assert.equal(sim.variables.filter((v) => v.name.startsWith('color/feedback/info/')).length, 5);
  // Read back: nothing left to pull or push.
  const again = await analyze(client, DEFAULT_SETTINGS, { baseSha: a.headSha }, await takeSnapshot());
  assert.deepEqual([again.diff.remote.length, again.diff.local.length, again.diff.conflicts.length], [0, 0, 0]);
});
