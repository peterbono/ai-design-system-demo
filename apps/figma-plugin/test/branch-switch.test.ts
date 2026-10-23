// Pointing a pulled file at another branch of the same repository (Settings, Base branch): the commit the file was
// pulled from stays the base, so what the branch changes comes in as changes from the code, not conflicts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPullPlan } from '../src/main/apply';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS, syncResetOnSettings } from '../src/shared/messages';
import { analyze, buildPull } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realConfigText, realFiles } from './helpers';

test('Settings: another branch keeps the base, another repository clears it', () => {
  const s = DEFAULT_SETTINGS;
  assert.deepEqual(syncResetOnSettings(s, { ...s }), {});
  assert.deepEqual(syncResetOnSettings(s, { ...s, branch: 'next' }), { lastPrBranch: '', lastPrUrl: '' });
  assert.deepEqual(syncResetOnSettings(s, { ...s, repo: 'acme/ds' }), { baseSha: '', lastPullAt: '', lastPrBranch: '', lastPrUrl: '' });
  assert.deepEqual(syncResetOnSettings(s, { ...s, repo: ` ${s.repo.toUpperCase()} ` }), {}, 'same repository, other case');
});

test('a branch that adds two brands, after a pull of main: every brand token is a change from the code, none a conflict', async () => {
  const sim = new SimFigma();
  sim.install();
  const p = DEFAULT_SETTINGS.tokensPath;
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${p}/${rel}`] = text;
  files[`${p}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = realConfigText();
  const gh = new FakeGitHub(files);
  const client = gh.client();
  const pulled = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(pulled, new Map()).plan);

  const next = { ...files };
  next[`${p}/brands/forest.tokens.json`] = files[`${p}/brands/bridge.tokens.json`]!;
  next[`${p}/brands/sunset.tokens.json`] = files[`${p}/brands/ocean.tokens.json`]!;
  const config = JSON.parse(files['bridge.config.json']!);
  config.modes.brand.values = [...config.modes.brand.values, 'forest', 'sunset'];
  next['bridge.config.json'] = JSON.stringify(config);
  gh.branches.set('brands', gh.commit(next, [pulled.headSha], 'two more brands'));

  const settings = { ...DEFAULT_SETTINGS, branch: 'brands' };
  const reset = syncResetOnSettings(DEFAULT_SETTINGS, settings);
  const a = await analyze(client, settings, { baseSha: reset.baseSha ?? pulled.headSha }, await takeSnapshot());
  assert.equal(a.diff.conflicts.length, 0);
  assert.ok(a.diff.remote.length >= 100, `${a.diff.remote.length} brand tokens come in`);
  await applyPullPlan(buildPull(a, new Map()).plan);
  const brand = sim.collections.find((c) => c.name === 'Brand');
  assert.deepEqual(brand?.modes.map((m: { name: string }) => m.name), ['Bridge', 'Ocean', 'Forest', 'Sunset']);
});
