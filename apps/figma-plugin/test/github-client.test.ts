import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FetchLike, GitHubClient, GitHubError, loadRepoFiles, parseRepo } from '../src/core/github-client';
import { branchName, slugify } from '../src/core/pr-composer';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${url.replace('https://api.github.com', '')}`];
    const status = route ? (route.status ?? 200) : 404;
    const body = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

test('parseRepo validates owner/name', () => {
  assert.deepEqual(parseRepo('peterbono/ai-design-system-demo'), { owner: 'peterbono', name: 'ai-design-system-demo' });
  assert.throws(() => parseRepo('https://github.com/x'), /owner\/name/);
});

test('sends auth and API version headers, reads files through trees and blobs', async () => {
  const { calls, fetchImpl } = stub({
    'GET /repos/o/r/git/ref/heads/main': { body: { object: { sha: 'head1' } } },
    'GET /repos/o/r/git/commits/head1': { body: { tree: { sha: 'tree1' } } },
    'GET /repos/o/r/git/trees/tree1?recursive=1': {
      body: {
        truncated: false,
        tree: [
          { path: 'packages/tokens/src/semantic/light.tokens.json', type: 'blob', sha: 'b1', mode: '100644' },
          { path: 'packages/tokens/src/contrast-pairs.json', type: 'blob', sha: 'b2', mode: '100644' },
          { path: 'packages/tokens/build.mjs', type: 'blob', sha: 'b3', mode: '100644' },
        ],
      },
    },
    'GET /repos/o/r/git/blobs/b1': { body: { encoding: 'base64', content: b64('{ "é": 1 }\n') } },
    'GET /repos/o/r/git/blobs/b2': { body: { encoding: 'base64', content: b64('{"pairs":[]}') } },
  });
  const client = new GitHubClient('o/r', 'tok123', fetchImpl);
  const sha = await client.getBranchSha('main');
  const files = await loadRepoFiles(client, sha!, 'packages/tokens/src');
  assert.deepEqual(files.files, { 'semantic/light.tokens.json': '{ "é": 1 }\n' });
  assert.equal(files.contrastPairs, '{"pairs":[]}');
  assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer tok123' && c.headers['X-GitHub-Api-Version'] === '2022-11-28'));
  assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/')), 'never raw.githubusercontent.com');
  assert.equal(calls.some((c) => c.url.includes('build.mjs')), false);
});

test('missing branch returns undefined; auth errors become plain-language messages', async () => {
  const { fetchImpl } = stub({ 'GET /repos/o/r': { status: 401, body: { message: 'Bad credentials' } } });
  const client = new GitHubClient('o/r', 'bad', fetchImpl);
  assert.equal(await client.getBranchSha('nope'), undefined);
  await assert.rejects(client.getRepo(), (err: unknown) => err instanceof GitHubError && err.status === 401 && /expired or mistyped/.test(err.message));
});

test('write calls: blob, tree, commit, ref, PR', async () => {
  const { calls, fetchImpl } = stub({
    'POST /repos/o/r/git/blobs': { status: 201, body: { sha: 'blob1' } },
    'POST /repos/o/r/git/trees': { status: 201, body: { sha: 'tree2' } },
    'POST /repos/o/r/git/commits': { status: 201, body: { sha: 'commit2' } },
    'POST /repos/o/r/git/refs': { status: 201, body: {} },
    'PATCH /repos/o/r/git/refs/heads/tokens/x-1': { body: {} },
    'POST /repos/o/r/pulls': { status: 201, body: { number: 7, html_url: 'https://github.com/o/r/pull/7', title: 'T', draft: true, head: { ref: 'tokens/x-1' } } },
    'GET /repos/o/r/pulls?state=open&head=o%3Atokens%2Fx-1': { body: [] },
  });
  const c = new GitHubClient('o/r', 't', fetchImpl);
  assert.equal(await c.createBlob('hello'), 'blob1');
  assert.equal(await c.createTree('tree1', [{ path: 'a.json', sha: 'blob1' }]), 'tree2');
  assert.equal(await c.createCommit('msg', 'tree2', ['head1']), 'commit2');
  await c.createBranch('tokens/x-1', 'commit2');
  await c.updateBranch('tokens/x-1', 'commit2');
  const pr = await c.createPullRequest({ title: 'T', head: 'tokens/x-1', base: 'main', body: 'b', draft: true });
  assert.equal(pr.number, 7);
  assert.equal(await c.findOpenPullRequest('tokens/x-1'), undefined);
  assert.deepEqual(calls[1]!.body, { base_tree: 'tree1', tree: [{ path: 'a.json', mode: '100644', type: 'blob', sha: 'blob1' }] });
  assert.deepEqual(calls[3]!.body, { ref: 'refs/heads/tokens/x-1', sha: 'commit2' });
  assert.deepEqual(calls[4]!.body, { sha: 'commit2', force: false });
});

test('transient failures are retried for reads, never for PR creation', async () => {
  let n = 0;
  const flaky: FetchLike = async (url) => {
    n++;
    if (n < 3) throw new Error('socket hang up');
    const body = url.endsWith('/pulls') ? { message: 'boom' } : { object: { sha: 'ok' } };
    return { ok: !url.endsWith('/pulls'), status: url.endsWith('/pulls') ? 502 : 200, json: async () => body, text: async () => '' };
  };
  const sleeps: number[] = [];
  const c = new GitHubClient('o/r', 't', flaky, { attempts: 3, baseDelayMs: 10, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal(await c.getBranchSha('main'), 'ok');
  assert.deepEqual(sleeps, [10, 20]);
  n = 10;
  await assert.rejects(c.createPullRequest({ title: 't', head: 'h', base: 'main', body: '', draft: true }), (e: unknown) => e instanceof GitHubError && e.status === 502);
  assert.equal(n, 11, 'POST /pulls is not retried');
});

test('exhausted rate limit explains when it resets', async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 403,
    headers: { get: (k: string) => ({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' })[k] ?? null },
    json: async () => ({ message: 'API rate limit exceeded' }),
    text: async () => '',
  });
  const c = new GitHubClient('o/r', 't', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => undefined });
  await assert.rejects(c.getRepo(), /hourly request limit .* resets at/);
});

test('branch names follow tokens/<slug>-<yyyymmdd-hhmm>', () => {
  assert.equal(branchName('Update primary button color!', new Date(Date.UTC(2026, 0, 2, 3, 4))), 'tokens/update-primary-button-color-20260102-0304');
  assert.equal(slugify('   '), 'update');
  assert.equal(slugify('Update 4 tokens (color.neutral.50 and more)'), 'update-4-tokens-color-neutral-50-and');
  assert.equal(slugify('Couleur défaut'), 'couleur-defaut');
});
