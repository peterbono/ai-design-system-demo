// Pull against the files main holds today (git show origin/main:<path>), not fixtures: the component specs and
// bridge.config.json shapes main ships must read into a component plan. Regression for "t.startsWith is not a
// function": a build that only read 0 as a number threw on main's numeric spec values (strokeWeight 3).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_COMPONENT_SPECS_FILE, type SpecField, parseComponentSpecs } from '@bridge-ds/core';
import { applyPullPlan } from '../src/main/apply';
import { scanGenerated } from '../src/main/build-components';
import { takeSnapshot } from '../src/main/snapshot';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { buildComponentPlan, loadComponentSpecs, planValue } from '../src/sync/component-pull';
import { analyze, buildPull, commitsBehind, pullHeadline } from '../src/sync/flows';
import { FakeGitHub } from './fake-github';
import { SimFigma } from './figma-api';
import { realChecksText, realFiles } from './helpers';

const ROOT = join(process.cwd(), '../..');

/** The file as main has it; the checkout when origin/main is not fetched (CI checks out the merge with main). */
function mainFile(path: string): string {
  try {
    return execFileSync('git', ['show', `origin/main:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return readFileSync(join(ROOT, path), 'utf8');
  }
}

const configText = mainFile('bridge.config.json');
const specsPath = (JSON.parse(configText) as { components?: { specs?: string } }).components?.specs ?? DEFAULT_COMPONENT_SPECS_FILE;
const specsText = mainFile(specsPath);

test("main's component specs read into a plan: every component, no throw, no 'update DS Bridge'", async () => {
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) files[`${DEFAULT_SETTINGS.tokensPath}/${rel}`] = text;
  files[`${DEFAULT_SETTINGS.tokensPath}/contrast.checks.json`] = realChecksText();
  files['bridge.config.json'] = configText;
  files[specsPath] = specsText;
  const sim = new SimFigma();
  sim.install();
  const client = new FakeGitHub(files).client();
  const a = await analyze(client, DEFAULT_SETTINGS, {}, await takeSnapshot());
  await applyPullPlan(buildPull(a, new Map()).plan);

  const loaded = await loadComponentSpecs(client, a.headFiles.treeSha, a.headFiles.config);
  assert.ok(loaded, 'component-specs.json is found at the path bridge.config.json names');
  assert.equal(loaded.path, specsPath);
  const expected = (JSON.parse(specsText) as { components: unknown[] }).components.length;
  assert.ok(expected >= 60, `main ships the full library (${expected} components)`);
  assert.equal(loaded.specs.components.length, expected);

  // The shape that broke the 2026-10-18 build: spec values that are numbers other than 0.
  const numeric: string[] = [];
  for (const c of loaded.specs.components)
    for (const v of c.variants)
      for (const [part, fields] of Object.entries(v.values))
        for (const [field, value] of Object.entries(fields ?? {})) {
          if (typeof value === 'number' && value !== 0) numeric.push(`${c.name} ${part}.${field}=${value}`);
          const r = planValue(field as SpecField, value, a.head);
          assert.ok(!('problem' in r && /update DS Bridge/.test(r.problem)), `${c.name} ${part}.${field}: ${'problem' in r ? r.problem : ''}`);
        }
  assert.ok(numeric.length > 0, 'main still holds non-zero numeric values, so this test covers them');

  const plan = buildComponentPlan(loaded.specs, loaded.path, await scanGenerated(), a.head);
  assert.equal(plan.components.length, expected, 'every component of main is planned for Figma');
  assert.ok(plan.components.every((c) => c.status === 'new'), 'an empty file builds them all');
  assert.deepEqual(parseComponentSpecs(specsText).components.map((c) => c.name), plan.components.map((c) => c.name));
});

test('Pull headline: commits on main since the last pull never read "Already up to date"', () => {
  const base = { baseSha: 'a'.repeat(40), branch: 'main', variablesUpToDate: true, status: [] as string[] };
  assert.equal(pullHeadline({ ...base, behind: 0 }), 'Already up to date');
  assert.equal(pullHeadline({ ...base, behind: 2 }), '2 new changes on main');
  assert.equal(pullHeadline({ ...base, behind: 1, status: ['3 components to build'] }), '1 new change on main, 3 components to build');
  assert.equal(pullHeadline({ ...base, behind: 0, status: ['3 components to build'] }), 'Up to date with main. 3 components to build.');
  assert.equal(pullHeadline({ ...base, variablesUpToDate: false, behind: 2, status: ['4 edited on main'] }), '4 edited on main');
  assert.equal(pullHeadline({ ...base, baseSha: undefined, variablesUpToDate: false, behind: 0 }), 'First pull');
  for (const behind of [0, 1, 2]) assert.ok(!pullHeadline({ ...base, behind }).includes(String.fromCharCode(0x2014)));

  const head = 'b'.repeat(40);
  assert.equal(commitsBehind({ baseSha: head, headSha: head, compare: undefined }), 0);
  assert.equal(commitsBehind({ baseSha: undefined, headSha: head, compare: undefined }), 0);
  assert.equal(commitsBehind({ baseSha: 'a'.repeat(40), headSha: head, compare: { aheadBy: 2 } as never }), 2);
  assert.equal(commitsBehind({ baseSha: 'a'.repeat(40), headSha: head, compare: undefined }), 1, 'the head moved even when GitHub cannot compare');
});
