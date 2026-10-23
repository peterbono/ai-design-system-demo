// A pull writes only the variable values that differ from what Figma holds, and counts as updated only the variables
// it changed: a big file pulled again rewrites nothing, and "602 updated" no longer means "602 read".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPullPlan } from '../src/main/apply';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('variables: a pull of the same values writes none and updates none; one changed token is one update', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const gh = new FakeGitHub(files);
  const client = gh.client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  const first = await applyPullPlan(buildPull(a, new Map()).plan);
  assert.ok(first.created > 500);
  assert.equal(first.updated, 0);

  // The same plan again (as a pull applies it in full).
  const writes = sim.valueWrites;
  const again = await applyPullPlan(buildPull(a, new Map()).plan);
  assert.deepEqual([again.created, again.updated], [0, 0]);
  assert.equal(sim.valueWrites, writes, 'nothing rewritten');

  // main changes space.4 from 16 to 18: that variable only.
  const sha = gh.pushToMain((f) => {
    const space = JSON.parse(f[`${p}/primitives/space.tokens.json`]!);
    space.space['4'].$value.value = 18;
    f[`${p}/primitives/space.tokens.json`] = JSON.stringify(space);
  });
  const b = await analyze(client, DEFAULT_SETTINGS, { baseSha: a.headSha }, await takeSnapshot());
  assert.equal(b.headSha, sha);
  const third = await applyPullPlan(buildPull(b, new Map()).plan);
  assert.deepEqual([third.created, third.updated], [0, 1]);
  assert.equal(sim.valueWrites, writes + 1);
});
