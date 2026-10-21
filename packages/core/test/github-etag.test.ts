import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  GitHubClient,
  GitHubError,
  installationFor,
  memoryEtagStore,
  type StorageLike,
  tokenFingerprint,
  webStorageEtagStore,
} from '../src/github-client';
import { fakeGitHub, noSleep } from './fake-github';

const TOKEN = 'test-token-not-real';

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

test('a second GET sends If-None-Match and a 304 returns the cached body without using the budget', async () => {
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r': { etag: 'W/"v1"', body: { full_name: 'o/r', default_branch: 'main', private: false, permissions: { pull: true } } } } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  const first = await client.getRepo();
  assert.equal(gh.state.remaining, 4999);
  const second = await client.getRepo();
  assert.deepEqual(second, first);
  assert.equal(gh.calls[1]!.headers['If-None-Match'], 'W/"v1"');
  assert.equal(gh.calls[1]!.status, 304);
  assert.equal(gh.state.remaining, 4999, 'a 304 is free');
  assert.deepEqual(client.etagStats, { conditional: 1, notModified: 1, stale: 0 });
});

test('a changed resource returns 200 with the new ETag and replaces the cache', async () => {
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r/tags?per_page=30': { etag: '"a"', body: [{ name: 'v1', commit: { sha: '1' } }] } } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  await client.listTags();
  gh.routes['GET /repos/o/r/tags?per_page=30'] = { etag: '"b"', body: [{ name: 'v2', commit: { sha: '2' } }] };
  assert.deepEqual(await client.listTags(), [{ name: 'v2', sha: '2' }]);
  assert.equal(gh.calls[1]!.headers['If-None-Match'], '"a"');
  await client.listTags();
  assert.equal(gh.calls[2]!.headers['If-None-Match'], '"b"');
  assert.equal(gh.calls[2]!.status, 304);
});

test('cached bodies are copies: editing a result does not edit the cache', async () => {
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: false, permissions: { pull: true } } } } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  const a = await client.getMergeSettings();
  a.permissions!.push = true;
  const b = await client.getMergeSettings();
  assert.equal(b.permissions?.push, undefined);
});

test('entries are per account: another token never gets the first one\'s cache, and keys hold no token', async () => {
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: true, permissions: { admin: true } } } } });
  const storage = memoryStorage();
  const etags = webStorageEtagStore(storage);
  await new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags }).getRepo();
  await new GitHubClient('o/r', 'other-token-not-real', gh.fetchImpl, noSleep, { etags }).getRepo();
  assert.equal(gh.calls[1]!.headers['If-None-Match'], undefined);
  assert.ok([...storage.map.keys()].every((k) => k.startsWith('bridge.gh.etag:') && !k.includes(TOKEN)));
  assert.notEqual(tokenFingerprint(TOKEN), tokenFingerprint('other-token-not-real'));
  assert.equal(tokenFingerprint(''), 'anon');
});

test('web storage survives a new client (page load), and clear() forgets only its own keys', async () => {
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: false } } } });
  const storage = memoryStorage();
  storage.setItem('bridge.workspace', '{}');
  await new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: webStorageEtagStore(storage) }).getRepo();
  await new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: webStorageEtagStore(storage) }).getRepo();
  assert.equal(gh.calls[1]!.status, 304);
  webStorageEtagStore(storage).clear();
  assert.deepEqual([...storage.map.keys()], ['bridge.workspace']);
});

test('broken storage is a cache miss, never a failure', async () => {
  const broken: StorageLike = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
    key: () => null,
    length: 0,
  };
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: false } } } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: webStorageEtagStore(broken) });
  await client.getRepo();
  await client.getRepo();
  assert.equal(gh.calls[1]!.headers['If-None-Match'], undefined);
  webStorageEtagStore(broken).clear();
});

test('etags: false sends plain requests; writes are never conditional', async () => {
  const gh = fakeGitHub({
    routes: {
      'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: false } },
      'POST /repos/o/r/issues/1/comments': { status: 201, etag: '"c"', body: { id: 1, html_url: 'u' } },
    },
  });
  const off = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: false });
  await off.getRepo();
  await off.getRepo();
  assert.equal(gh.calls[1]!.headers['If-None-Match'], undefined);
  const on = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  await on.createIssueComment(1, 'a');
  await on.createIssueComment(1, 'b');
  assert.equal(gh.calls.at(-1)!.headers['If-None-Match'], undefined);
});

test('rate limit: the error says when it resets, rateLimit exposes the headers, nothing is retried', async () => {
  const gh = fakeGitHub({ budget: 1, routes: { 'GET /repos/o/r': { body: { full_name: 'o/r', default_branch: 'main', private: false } } } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  await client.getRepo();
  assert.equal(client.rateLimit?.remaining, 0);
  assert.equal(client.rateLimit?.limit, 1);
  assert.equal(client.rateLimit?.resource, 'core');
  await assert.rejects(client.getRepo(), (e: unknown) => e instanceof GitHubError && e.status === 429 && /hourly request limit for this token/.test(e.message));
  assert.equal(gh.calls.length, 2, 'a used-up limit is not transient');
});

test('rate limit: a 304 still answers when the budget is used up, and serveStaleOnRateLimit returns the cached body', async () => {
  const gh = fakeGitHub({ budget: 1, routes: { 'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: false } } } });
  const etags = memoryEtagStore();
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags });
  await client.getRepo();
  assert.equal((await client.getRepo()).fullName, 'o/r', 'not modified: free even at 0 remaining');

  // The resource changed meanwhile: GitHub must send it, and the budget is gone.
  gh.routes['GET /repos/o/r'] = { etag: '"y"', body: { full_name: 'o/r', default_branch: 'trunk', private: false } };
  await assert.rejects(client.getRepo(), (e: unknown) => e instanceof GitHubError && e.status === 429);
  const stale = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags, serveStaleOnRateLimit: true });
  assert.equal((await stale.getRepo()).defaultBranch, 'main');
  assert.equal(stale.etagStats.stale, 1);
});

test('anonymous: no If-None-Match (a 304 is free only with a token), but the kept body serves a used-up limit', async () => {
  const gh = fakeGitHub({ budget: 1, routes: { 'GET /repos/o/r': { etag: '"x"', body: { full_name: 'o/r', default_branch: 'main', private: false } } } });
  const client = new GitHubClient('o/r', '', gh.fetchImpl, noSleep, { etags: memoryEtagStore(), serveStaleOnRateLimit: true });
  await client.getRepo();
  assert.equal((await client.getRepo()).defaultBranch, 'main');
  assert.equal(gh.calls[1]!.headers['If-None-Match'], undefined);
  assert.equal(gh.calls[1]!.status, 403);
  assert.deepEqual(client.etagStats, { conditional: 0, notModified: 0, stale: 1 });
});

test('anonymous rate limit names the token hint', async () => {
  const gh = fakeGitHub({ budget: 0 });
  const client = new GitHubClient('o/r', '', gh.fetchImpl, noSleep, { etags: memoryEtagStore(), tokenHint: 'sign in with GitHub' });
  await assert.rejects(client.getRepo(), /60 an hour.*sign in with GitHub/);
});

test('memoryEtagStore keeps the most recently used entries', () => {
  const s = memoryEtagStore(2);
  s.set('a', { etag: '1', body: 1, at: 0 });
  s.set('b', { etag: '2', body: 2, at: 0 });
  s.get('a');
  s.set('c', { etag: '3', body: 3, at: 0 });
  assert.equal(s.get('b'), undefined);
  assert.equal(s.get('a')?.body, 1);
  assert.equal(s.get('c')?.body, 3);
});

test('getRawText reads the contents API with the raw media type, conditionally', async () => {
  const gh = fakeGitHub({ routes: { 'GET /repos/o/r/contents/a/b.json?ref=main': { etag: '"f"', body: null, text: '{"x":1}' } } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  assert.equal(await client.getRawText('a/b.json', 'main'), '{"x":1}');
  assert.equal(await client.getRawText('a/b.json', 'main'), '{"x":1}');
  assert.equal(gh.calls[0]!.headers.Accept, 'application/vnd.github.raw');
  assert.equal(gh.calls[1]!.status, 304);
  assert.equal(await client.getRawText('missing.json', 'main'), undefined);
});

test('readRawFile goes to the raw host with no headers', async () => {
  const gh = fakeGitHub({ raw: { 'o/r/main/a%20b.json': 'hi' } });
  const client = new GitHubClient('o/r', TOKEN, gh.fetchImpl, noSleep);
  assert.equal(await client.readRawFile('a b.json', 'main'), 'hi');
  assert.deepEqual(gh.calls[0]!.headers, {});
  assert.equal(await client.readRawFile('nope', 'main'), undefined);
});

// --- Installations -------------------------------------------------------------------------------

const inst = (id: number, login: string, selection: string) => ({ id, account: { login, type: 'Organization' }, repository_selection: selection, app_slug: 'bridge' });

test('listUserInstallations reads every page and maps the fields', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => inst(i + 1, `org${i}`, 'all'));
  const gh = fakeGitHub({
    routes: {
      'GET /user/installations?per_page=100&page=1': { body: { total_count: 101, installations: page1 } },
      'GET /user/installations?per_page=100&page=2': { body: { total_count: 101, installations: [inst(500, 'Acme', 'selected')] } },
    },
  });
  const client = new GitHubClient('acme/ds', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  const list = await client.listUserInstallations();
  assert.equal(list.length, 101);
  assert.deepEqual(list[100], { id: 500, account: { login: 'Acme', type: 'Organization' }, repositorySelection: 'selected', appSlug: 'bridge' });
});

test('listUserInstallations needs a token', async () => {
  const client = new GitHubClient('acme/ds', '', fakeGitHub().fetchImpl, noSleep);
  await assert.rejects(client.listUserInstallations(), (e: unknown) => e instanceof GitHubError && e.status === 401);
});

test('installationFor matches the owner case-insensitively and tells all from selected', () => {
  const list = [inst(1, 'Acme', 'all'), inst(2, 'other', 'selected')];
  assert.deepEqual(installationFor(list, 'acme'), { reach: 'yes', id: 1 });
  assert.deepEqual(installationFor(list, 'OTHER'), { reach: 'check', id: 2 });
  assert.deepEqual(installationFor(list, 'nobody'), { reach: 'no' });
  assert.deepEqual(installationFor([{ id: 3, account: { login: 'x' }, repositorySelection: 'all' }], 'x'), { reach: 'yes', id: 3 });
});

test('findInstallation: all repositories in one call, selected ones checked in the repo list', async () => {
  const gh = fakeGitHub({
    routes: {
      'GET /user/installations?per_page=100&page=1': { body: { total_count: 2, installations: [inst(1, 'acme', 'selected'), inst(2, 'solo', 'all')] } },
      'GET /user/installations/1/repositories?per_page=100&page=1': {
        body: { total_count: 1, repositories: [{ name: 'DS', full_name: 'acme/DS', private: true, owner: { login: 'acme' } }] },
      },
    },
  });
  const client = new GitHubClient('acme/ds', TOKEN, gh.fetchImpl, noSleep, { etags: memoryEtagStore() });
  assert.deepEqual(await client.findInstallation(), { id: 1, selection: 'selected' });
  assert.equal(await client.findInstallation('acme', 'web'), null);
  assert.deepEqual(await client.findInstallation('solo', 'anything'), { id: 2, selection: 'all' });
  assert.equal(await client.findInstallation('nobody', 'x'), null);
  assert.deepEqual(await client.listInstallationRepos(1), [{ owner: 'acme', name: 'DS', fullName: 'acme/DS', private: true }]);
});
