import assert from 'node:assert/strict';
import { test } from 'vitest';
import { GitHubClient, GitHubError, memoryEtagStore } from '../src/github-client';
import { gitHubSource } from '../src/repo-source-github';
import { fakeGitHub, noSleep } from './fake-github';

const TOKEN = 'test-token-not-real';
const SHA = 'a'.repeat(40);

const FILES = [
  { path: 'bridge.config.json', sha: 'c1', text: '{"config":1}' },
  { path: 'packages/tokens/src', type: 'tree', sha: 't1' },
  { path: 'packages/tokens/src/semantic/light.tokens.json', sha: 'b1', text: '{"light":1}' },
  { path: 'packages/tokens/src/semantic/dark.tokens.json', sha: 'b2', text: '{"dark":1}' },
  { path: 'packages/tokens-extra/x.json', sha: 'b3', text: '{}' },
  { path: 'big.json', sha: 'b4', size: 2_000_000 },
  { path: 'copy-of-light.tokens.json', sha: 'b1', text: '{"light":1}' },
];

const treeRoute = (truncated = false) => ({
  body: {
    truncated,
    tree: FILES.map((e) => ({ path: e.path, type: e.type ?? 'blob', sha: e.sha, mode: '100644', ...(e.size !== undefined ? { size: e.size } : {}) })),
  },
});

/** The fake repository: tree + blobs on the API, the same files on the raw host when `publicRaw`. */
function setup(opts: { token?: string; publicRaw?: boolean; budget?: number; truncated?: boolean } = {}) {
  const routes: Record<string, { body: unknown; text?: string; etag?: string }> = { [`GET /repos/acme/ds/git/trees/${SHA}?recursive=1`]: treeRoute(opts.truncated) };
  const raw: Record<string, string> = {};
  for (const f of FILES) {
    if (!f.text) continue;
    routes[`GET /repos/acme/ds/git/blobs/${f.sha}`] = { body: null, text: f.text, etag: `"${f.sha}"` };
    if (opts.publicRaw) raw[`acme/ds/${SHA}/${f.path}`] = f.text;
  }
  const gh = fakeGitHub({ budget: opts.budget, routes, raw });
  const client = new GitHubClient('acme/ds', opts.token ?? TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  return { gh, client };
}

const rawCalls = (gh: ReturnType<typeof fakeGitHub>) => gh.calls.filter((c) => c.url.startsWith('https://raw.githubusercontent.com/'));

test('lists every blob with one tree call, filtered by folder prefix', async () => {
  const { gh, client } = setup();
  const src = gitHubSource(client, SHA);
  assert.deepEqual(src.ref, { owner: 'acme', repo: 'ds', sha: SHA });
  assert.equal((await src.list()).length, 6, 'folders are not files');
  const tokens = ['packages/tokens/src/semantic/light.tokens.json', 'packages/tokens/src/semantic/dark.tokens.json'];
  assert.deepEqual(await src.list('packages/tokens'), tokens, 'a folder prefix, not a string prefix');
  assert.deepEqual(await src.list('packages/tokens/src/'), tokens);
  assert.deepEqual(await src.list('/packages/tokens-extra'), ['packages/tokens-extra/x.json']);
  assert.deepEqual(await src.list('bridge.config.json'), ['bridge.config.json']);
  assert.equal(gh.apiCalls().length, 1);
});

test('signed in: bodies come from the blobs API by blob sha, raw media type, never the raw host', async () => {
  const { gh, client } = setup({ publicRaw: true });
  const src = gitHubSource(client, SHA);
  assert.equal(src.mode, 'api');
  assert.equal(await src.text('bridge.config.json'), '{"config":1}');
  assert.equal(await src.text('./packages/tokens/src/semantic/dark.tokens.json'), '{"dark":1}');
  assert.equal(rawCalls(gh).length, 0, 'the raw host refuses a token');
  const blobs = gh.apiCalls().filter((c) => c.url.includes('/git/blobs/'));
  assert.deepEqual(blobs.map((c) => c.url.split('/').pop()), ['c1', 'b2']);
  assert.ok(blobs.every((c) => c.headers.Accept === 'application/vnd.github.raw' && c.headers.Authorization === `Bearer ${TOKEN}`));
});

test('blobs are never revalidated: a new source on the same client reads none again, and no If-None-Match is sent', async () => {
  const { gh, client } = setup();
  await gitHubSource(client, SHA).text('bridge.config.json');
  const before = gh.apiCalls().filter((c) => c.url.includes('/git/blobs/')).length;
  await gitHubSource(client, SHA).text('bridge.config.json');
  const blobs = gh.apiCalls().filter((c) => c.url.includes('/git/blobs/'));
  assert.equal(blobs.length, before);
  assert.ok(blobs.every((c) => !('If-None-Match' in c.headers)));
});

test('anonymous: bodies of a public repo come from the raw host at the commit sha, with no headers', async () => {
  const { gh, client } = setup({ token: '', publicRaw: true });
  const src = gitHubSource(client, SHA);
  assert.equal(src.mode, 'raw');
  assert.equal(await src.text('bridge.config.json'), '{"config":1}');
  const raw = rawCalls(gh);
  assert.equal(raw.length, 1);
  assert.equal(raw[0]!.url, `https://raw.githubusercontent.com/acme/ds/${SHA}/bridge.config.json`);
  assert.deepEqual(raw[0]!.headers, {});
  assert.equal(gh.apiCalls().length, 1, 'only the tree');
});

test('anonymous: a listed file the raw host does not serve says to sign in', async () => {
  const { client } = setup({ token: '', publicRaw: false });
  await assert.rejects(gitHubSource(client, SHA).text('bridge.config.json'), /Sign in with GitHub to read a private repository/);
});

test('a path the tree does not list is null without any request; bodies are shared by blob sha', async () => {
  const { gh, client } = setup();
  const src = gitHubSource(client, SHA);
  assert.equal(await src.text('nope.json'), null);
  assert.equal(await src.text('packages/tokens/src'), null, 'a folder is not a file');
  const before = gh.calls.length;
  assert.equal(await src.text('packages/tokens/src/semantic/light.tokens.json'), '{"light":1}');
  assert.equal(await src.text('copy-of-light.tokens.json'), '{"light":1}', 'same blob, no second read');
  assert.equal(gh.calls.length, before + 1);
});

test('an outside blob cache is read first and filled after a read', async () => {
  const { gh, client } = setup({ token: '', publicRaw: true });
  const store = new Map<string, string>([['c1', '{"cached":1}']]);
  const src = gitHubSource(client, SHA, { blobCache: { get: async (s) => store.get(s), set: (s, t) => void store.set(s, t) } });
  assert.equal(await src.text('bridge.config.json'), '{"cached":1}');
  assert.equal(rawCalls(gh).length, 0);
  await src.text('packages/tokens/src/semantic/dark.tokens.json');
  assert.equal(store.get('b2'), '{"dark":1}');
});

test('a failing cache write does not fail the read', async () => {
  const { client } = setup();
  const src = gitHubSource(client, SHA, {
    blobCache: {
      get: () => undefined,
      set: () => {
        throw new Error('QuotaExceededError');
      },
    },
  });
  assert.equal(await src.text('bridge.config.json'), '{"config":1}');
});

test('files over the size cap are refused before any read', async () => {
  const { gh, client } = setup();
  const src = gitHubSource(client, SHA);
  await assert.rejects(src.text('big.json'), (e: unknown) => e instanceof GitHubError && e.status === 413 && /2000 KB/.test(e.message));
  assert.equal(gh.calls.length, 1);
});

test('a truncated tree is a 413', async () => {
  const { client } = setup({ truncated: true });
  await assert.rejects(gitHubSource(client, SHA).list(), (e: unknown) => e instanceof GitHubError && e.status === 413);
});

test('rate limit: a used-up tree read throws 429 and the next call retries it', async () => {
  const { gh, client } = setup({ budget: 0 });
  const src = gitHubSource(client, SHA);
  await assert.rejects(src.list(), (e: unknown) => e instanceof GitHubError && e.status === 429);
  gh.state.remaining = 10;
  assert.equal((await src.list()).length, 6);
});

test('rate limit: a blob read that hits the limit throws 429 and is not cached as a failure', async () => {
  const { gh, client } = setup({ budget: 1 });
  const src = gitHubSource(client, SHA);
  await assert.rejects(src.text('bridge.config.json'), (e: unknown) => e instanceof GitHubError && e.status === 429);
  gh.state.remaining = 10;
  assert.equal(await src.text('bridge.config.json'), '{"config":1}');
});

test('signed in, a second source re-reads the tree conditionally: 304, free', async () => {
  const { gh, client } = setup();
  gh.routes[`GET /repos/acme/ds/git/trees/${SHA}?recursive=1`] = { ...treeRoute(), etag: '"tree"' };
  await gitHubSource(client, SHA).list();
  const left = gh.state.remaining;
  assert.equal((await gitHubSource(client, SHA).list()).length, 6);
  assert.equal(gh.calls.at(-1)!.status, 304);
  assert.equal(gh.state.remaining, left);
});

test('reads at most `concurrency` bodies at once', async () => {
  const { gh } = setup();
  let active = 0;
  let peak = 0;
  const slow = new GitHubClient(
    'acme/ds',
    TOKEN,
    async (url, init) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await gh.fetchImpl(url, init);
      } finally {
        active--;
      }
    },
    noSleep,
    { etags: false },
  );
  const src = gitHubSource(slow, SHA, { concurrency: 2 });
  await src.list();
  peak = 0;
  await Promise.all(['bridge.config.json', 'packages/tokens/src/semantic/light.tokens.json', 'packages/tokens/src/semantic/dark.tokens.json'].map((p) => src.text(p)));
  assert.equal(peak, 2);
});

test('refuses a branch name: bodies are pinned to a commit sha', () => {
  const { client } = setup();
  assert.throws(() => gitHubSource(client, 'main'), /full commit sha/);
});
