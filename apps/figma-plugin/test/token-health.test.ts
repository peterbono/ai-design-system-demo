// A GitHub token that stopped working (401) or lacks a permission (403): what the plugin stores and says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHubError } from '@bridge-ds/core';
import { clearGitHubToken, readGitHubToken, saveGitHubToken, setGitHubTokenState, TOKEN_KEY, TOKEN_STATE_KEY } from '../src/main/github-token';
import { analyze, buildPull, buildPush } from '../src/sync/flows';
import { defaultUnchecked, heldTokenIds, publish, publishItems, setGroup } from '../src/sync/publish';
import { buildSignature, classifyComponents, fnv1a, type RawComponent } from '../src/sync/components';
import { TestBuildPoller } from '../src/sync/explorations';
import { checkToken, componentsReadProblem, errorText, TOKEN_REJECTED_CALLOUT, TOKEN_SETTINGS_URL, tokenProblem } from '../src/sync/token-health';
import { DEFAULT_SETTINGS } from '../src/shared/messages';
import { FakeGitHub } from './fake-github';
import { applyPlanToSnapshot, findIn } from './figma-sim';
import { realChecksText, realConfigText, realFiles } from './helpers';

const PREFIX = DEFAULT_SETTINGS.tokensPath;
const EM = String.fromCharCode(0x2014);
const rejected = () => FakeGitHub.httpError(401, 'Bad credentials', '/repos/o/r');
const noIssues = () => FakeGitHub.httpError(403, 'Resource not accessible by personal access token', '/repos/o/r/issues');

function repoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, text] of Object.entries(realFiles())) out[`${PREFIX}/${rel}`] = text;
  out[`${PREFIX}/contrast.checks.json`] = realChecksText();
  out['bridge.config.json'] = realConfigText();
  out['packages/react/src/components/Button/Button.tsx'] = '';
  return out;
}

function useStorage(): Map<string, unknown> {
  const store = new Map<string, unknown>();
  (globalThis as unknown as { figma: unknown }).figma = {
    clientStorage: {
      getAsync: async (k: string) => store.get(k),
      setAsync: async (k: string, v: unknown) => void store.set(k, v),
      deleteAsync: async (k: string) => void store.delete(k),
    },
  };
  return store;
}

test('a 401 is recorded with the token, survives a restart, and saving a new token clears it', async () => {
  const store = useStorage();
  assert.deepEqual(await readGitHubToken(), { token: undefined, tokenState: undefined });
  assert.deepEqual(await setGitHubTokenState('rejected'), { tokenState: undefined }, 'nothing to record without a token');
  await saveGitHubToken('  test-token-a  ');
  assert.deepEqual(await readGitHubToken(), { token: 'test-token-a', tokenState: 'ok' });
  await setGitHubTokenState('rejected');
  assert.equal(store.get(TOKEN_STATE_KEY), 'rejected');
  assert.deepEqual(await readGitHubToken(), { token: 'test-token-a', tokenState: 'rejected' }, 'the old token is kept, marked, not deleted');
  await saveGitHubToken('test-token-b');
  assert.deepEqual(await readGitHubToken(), { token: 'test-token-b', tokenState: 'ok' }, 'a new token starts clean');
  await setGitHubTokenState('rejected');
  await setGitHubTokenState('ok');
  assert.equal(store.has(TOKEN_STATE_KEY), false, 'a later check that succeeds clears it');
  await setGitHubTokenState('rejected');
  await clearGitHubToken();
  assert.equal(store.has(TOKEN_KEY) || store.has(TOKEN_STATE_KEY), false);
  // Sign in with Bridge marks its token, so "Sign in again" renews it; a pasted token, or signing out, drops the mark.
  await saveGitHubToken('test-token-c', 'bridge');
  assert.deepEqual(await readGitHubToken(), { token: 'test-token-c', tokenState: 'ok', tokenSource: 'bridge' });
  await saveGitHubToken('test-token-d');
  assert.deepEqual(await readGitHubToken(), { token: 'test-token-d', tokenState: 'ok' });
  await saveGitHubToken('test-token-e', 'bridge');
  await clearGitHubToken();
  assert.equal(store.size, 0, 'signing out leaves nothing');
});

test('Pull with a rejected token: one callout pointing to Settings, never the raw error', async () => {
  const gh = new FakeGitHub(repoFiles());
  gh.failAll = rejected();
  const err = await analyze(gh.client(), DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] }).then(
    () => assert.fail('the pull must fail'),
    (e: unknown) => e,
  );
  const problem = tokenProblem(err);
  assert.deepEqual(problem, { kind: 'rejected', text: TOKEN_REJECTED_CALLOUT });
  assert.equal(TOKEN_REJECTED_CALLOUT, 'Your GitHub token stopped working. Replace it in Settings.');
  assert.ok(!problem.text.includes(EM));
});

test('check at start: one call; rejected on 401, ok when GitHub answers, nothing on a network failure', async () => {
  const gh = new FakeGitHub(repoFiles());
  let calls = 0;
  const counting = { getRepo: async () => (calls++, gh.client().getRepo()) };
  assert.equal(await checkToken(counting), 'ok');
  assert.equal(calls, 1);
  gh.failAll = rejected();
  assert.equal(await checkToken(gh.client()), 'rejected');
  gh.failAll = new GitHubError(0, 'Could not reach GitHub. Check your connection, then try again.');
  assert.equal(await checkToken(gh.client()), undefined);
  gh.failAll = FakeGitHub.httpError(404, 'Not Found', '/repos/o/r');
  assert.equal(await checkToken(gh.client()), 'ok', 'a 404 is about the repository, not the token');
});

test('a token without Issues permission: the request says which permission to add, with the GitHub link', async () => {
  const gh = new FakeGitHub(repoFiles());
  const client = gh.client();
  const first = await analyze(client, DEFAULT_SETTINGS, {}, { fileName: 'Test', collections: [], variables: [] });
  const pull = buildPull(first, new Map());
  const snapshot = applyPlanToSnapshot(pull.plan, 'single');
  findIn(snapshot, 'Primitives', 'radius/sm').valuesByMode['Primitives:value'] = { kind: 'float', value: 5 };
  const a = await analyze(client, DEFAULT_SETTINGS, { baseSha: pull.plan.headSha }, snapshot);
  const comp = (fill: string): RawComponent => ({
    nodeId: '1:1',
    name: 'Button',
    definitions: [{ name: 'Size', type: 'VARIANT', default: 'md', options: ['md'] }],
    variants: [{ props: { Size: 'md' }, bindings: [{ kind: 'fill', variable: fill, value: '1,1,1,255' }], render: fnv1a(`Button ${fill}`), structure: fnv1a('Button') }],
  });
  const scan = classifyComponents([{ nodeId: '1:1', name: 'Button', signature: buildSignature(comp('button/primary/bg-hover')), baseline: buildSignature(comp('button/primary/bg')) }], ['Button']);
  const items = publishItems(a, new Set(), scan.changed);
  const unchecked = defaultUnchecked(items);
  setGroup(items, unchecked, 'variable', false);
  const proposal = buildPush(a, new Map(), new Set(), heldTokenIds(items, unchecked));
  gh.failures.set('createIssue', noIssues());
  gh.failures.set('putBase64File', noIssues());
  const res = await publish(client, { analysis: a, proposal, components: scan.changed, unchecked, description: 'Hover', title: '', fileName: 'Library.fig', coded: ['Button'] });
  assert.deepEqual(res.failed, [{ component: 'Button', error: 'This token cannot create requests. Add Issues: Read and write on GitHub.', problem: 'missing-permission' }]);
  const problem = tokenProblem(noIssues());
  assert.equal(problem?.kind === 'missing-permission' && problem.url, TOKEN_SETTINGS_URL);
  assert.equal(TOKEN_SETTINGS_URL, 'https://github.com/settings/personal-access-tokens');
  assert.equal(errorText(FakeGitHub.httpError(403, 'Resource not accessible by personal access token', '/repos/o/r/pulls')), 'This token cannot open pull requests. Add Pull requests: Read and write on GitHub.');
});

test('try it polling hands the error to the screen, so a rejected token shows as the token callout', async () => {
  const seen: { message: string; err: unknown }[] = [];
  const poller = new TestBuildPoller({
    read: async () => Promise.reject(rejected()),
    onUpdate: () => undefined,
    onError: (message, err) => seen.push({ message, err }),
    onTimeout: () => undefined,
  });
  assert.equal(await poller.check(), false);
  assert.equal(seen.length, 1);
  assert.equal(tokenProblem(seen[0]!.err)?.kind, 'rejected');
});

test('components that cannot be read: what happened and what to do, the raw error only as a detail', () => {
  const crash = componentsReadProblem(new TypeError('t.startsWith is not a function'), 'pull');
  assert.equal(crash.title, 'Components could not be read');
  assert.equal(
    crash.text,
    'Bridge could not compare your Figma components with the design system. Variables still update as usual. Check again, and if it keeps failing, update Bridge and report it with the details below.',
  );
  assert.equal(crash.detail, 't.startsWith is not a function');
  assert.doesNotMatch(crash.text, /startsWith|—/);
  assert.match(componentsReadProblem('boom', 'push').text, /^Bridge could not read your Figma components\. Variables still send as usual\. Scan again/);
  // A token problem keeps its own sentence, with nothing to report.
  const rejected = componentsReadProblem(new GitHubError(401, 'Bad credentials', undefined, { auth: 'rejected' }), 'pull');
  assert.deepEqual(rejected, { title: 'Components could not be read', text: TOKEN_REJECTED_CALLOUT });
});
