// "Fix with Claude": the Check fidelity run goes to figma-fidelity.json on the requests branch, where the Bridge MCP
// server and the CLI read it; written again on the next check, never on the library branch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FIDELITY_RUN_FILE, type FigmaFidelityRun, REQUESTS_BRANCH, parseFidelityRun } from '@bridge-ds/core';
import { FIX_ASKED_TEXT, FIX_NEXT_TEXT, fixCommand, fixPhrase, fixRequestForDeveloper, writeFidelityRun } from '../src/sync/fix-with-claude';
import { FakeGitHub } from './fake-github';

const run = (percent: number): FigmaFidelityRun => ({
  version: 1,
  report: {
    version: 1,
    checkedAt: '2026-10-25T00:00:00.000Z',
    file: 'Carbon',
    reference: { sha: 'abc', createdAt: '2026-10-25T00:00:00.000Z' },
    options: { scale: 2, threshold: 0.1, maxDiffPercent: 1, sizeTolerance: 2 },
    components: [{ component: 'TextInput', status: 'differs', checked: 1, differing: 1, skipped: 0, worst: 'Size=md', variants: [{ key: 'Size=md', status: 'differs', percent }] }],
    summary: { components: 1, matches: 0, differs: 1, notChecked: 0, variantsChecked: 1, variantsSkipped: 0 },
  } as unknown as FigmaFidelityRun['report'],
  built: { TextInput: { 'Size=md': { boxes: { root: { x: 0, y: 0, width: 300, height: 76 } }, hidden: [] } } },
});

test('Fix with Claude: the run is written to figma-fidelity.json on the requests branch, replaced by the next check', async () => {
  const gh = new FakeGitHub({ 'bridge.config.json': '{}' });
  const client = gh.client();
  await writeFidelityRun(client, run(5), 'main');
  await writeFidelityRun(client, run(3), 'main');
  const file = await client.getFile(DEFAULT_FIDELITY_RUN_FILE, REQUESTS_BRANCH);
  const read = parseFidelityRun(JSON.parse(file!.text));
  assert.equal(read.report.components[0]!.variants[0]!.percent, 3);
  assert.deepEqual(read.built?.TextInput?.['Size=md']?.boxes?.root, { x: 0, y: 0, width: 300, height: 76 });
  assert.equal(await client.getFile(DEFAULT_FIDELITY_RUN_FILE, 'main'), undefined, 'never on the library branch');
  assert.equal(fixPhrase('TextInput'), 'Fix TextInput in Figma with Bridge');
  assert.equal(fixCommand('TextInput'), 'npx @bridge-ds/cli fix TextInput --with-claude');
});

test('Ask Claude to fix it: the designer sees no command, the copied request for the developer holds both ways', () => {
  for (const text of [FIX_ASKED_TEXT, FIX_NEXT_TEXT]) assert.doesNotMatch(text, /npx|MCP|API key|branch|CLI|—/);
  const req = fixRequestForDeveloper('TextInput', 'acme/ds');
  assert.match(req, /Fix TextInput in Figma with Bridge/);
  assert.match(req, /npx @bridge-ds\/cli fix TextInput --with-claude/);
  assert.match(req, /figma-fidelity\.json on the bridge-requests branch of acme\/ds/);
  assert.doesNotMatch(req, /—/);
});
