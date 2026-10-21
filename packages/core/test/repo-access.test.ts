import assert from 'node:assert/strict';
import { test } from 'vitest';
import { GitHubClient, GitHubError, memoryEtagStore } from '../src/github-client';
import { accessAtLeast, accessState, resolveRepoAccess } from '../src/repo-access';
import { fakeGitHub, noSleep } from './fake-github';

const TOKEN = 'test-token-not-real';

test('accessState follows the plan table', () => {
  assert.equal(accessState({ signedIn: false, visible: false }), 'anonymous-unknown');
  assert.equal(accessState({ signedIn: false, visible: true, permissions: { pull: true } }), 'anonymous-public');
  assert.equal(accessState({ signedIn: true, visible: false }), 'no-access');
  assert.equal(accessState({ signedIn: true, visible: true, installed: false, permissions: { admin: true } }), 'not-installed');
  assert.equal(accessState({ signedIn: true, visible: true, installed: false, permissions: { triage: true, pull: true } }), 'not-installed');
  assert.equal(accessState({ signedIn: true, visible: true, installed: false, permissions: { pull: true } }), 'outside-contributor');
  assert.equal(accessState({ signedIn: true, visible: true, installed: false, private: true, permissions: { pull: true } }), 'reader');
  assert.equal(accessState({ signedIn: true, visible: true, installed: true, permissions: { pull: true } }), 'reader');
  assert.equal(accessState({ signedIn: true, visible: true, installed: true, permissions: { triage: true, pull: true } }), 'reader');
  assert.equal(accessState({ signedIn: true, visible: true, installed: true, permissions: { push: true, pull: true } }), 'writer');
  assert.equal(accessState({ signedIn: true, visible: true, installed: null, permissions: { maintain: true } }), 'writer');
  assert.equal(accessState({ signedIn: true, visible: true, permissions: { admin: true, push: true } }), 'admin');
  assert.equal(accessState({ signedIn: true, visible: true }), 'reader');
});

test('accessAtLeast ranks the states', () => {
  assert.ok(accessAtLeast('admin', 'writer'));
  assert.ok(accessAtLeast('writer', 'reader'));
  assert.ok(!accessAtLeast('reader', 'writer'));
  assert.ok(!accessAtLeast('not-installed', 'reader'));
  assert.ok(!accessAtLeast('outside-contributor', 'reader'));
  assert.ok(accessAtLeast('outside-contributor', 'anonymous-public'));
  assert.ok(accessAtLeast('not-installed', 'anonymous-public'));
  assert.ok(!accessAtLeast('no-access', 'anonymous-public'));
});

const repo = (over: Record<string, unknown> = {}) => ({ body: { full_name: 'acme/ds', default_branch: 'main', private: false, permissions: { pull: true }, ...over } });
const installations = (list: unknown[]) => ({ body: { total_count: list.length, installations: list } });

function client(routes: NonNullable<Parameters<typeof fakeGitHub>[0]>['routes'], token = TOKEN, budget?: number) {
  const gh = fakeGitHub({ routes, budget });
  return { gh, c: new GitHubClient('acme/ds', token, gh.fetchImpl, noSleep, { etags: memoryEtagStore() }) };
}

test('anonymous: public repo reads, 404 is unknown', async () => {
  const pub = client({ 'GET /repos/acme/ds': repo() }, '');
  const a = await resolveRepoAccess(pub.c, { app: true });
  assert.equal(a.state, 'anonymous-public');
  assert.equal(a.defaultBranch, 'main');
  assert.equal(pub.gh.calls.length, 1, 'no installation check without a token');
  const hidden = client({}, '');
  assert.deepEqual(await resolveRepoAccess(hidden.c), { owner: 'acme', repo: 'ds', state: 'anonymous-unknown', private: undefined, defaultBranch: undefined, permissions: undefined });
});

test('signed in, 404: no-access', async () => {
  const { c } = client({});
  assert.equal((await resolveRepoAccess(c, { app: true })).state, 'no-access');
});

test('signed in with the App, public repo where it is not installed: not-installed', async () => {
  const { c } = client({ 'GET /repos/acme/ds': repo({ permissions: { admin: true } }), 'GET /user/installations?per_page=100&page=1': installations([]) });
  const a = await resolveRepoAccess(c, { app: true });
  assert.equal(a.state, 'not-installed');
  assert.equal(a.permissions?.admin, true, 'the admin sees they can install it');
});

test('public repo, read only, no installation listed: outside-contributor, never "not installed"', async () => {
  const { c } = client({ 'GET /repos/acme/ds': repo({ permissions: { admin: false, push: false, pull: true } }), 'GET /user/installations?per_page=100&page=1': installations([]) });
  const a = await resolveRepoAccess(c, { app: true });
  assert.equal(a.state, 'outside-contributor');
  assert.equal(a.permissions?.admin, false, 'the install link stays hidden: not an admin');
});

test('signed in with the App: reader, writer, admin, with the installation id', async () => {
  const all = installations([{ id: 7, account: { login: 'acme' }, repository_selection: 'all' }]);
  for (const [permissions, state] of [
    [{ pull: true }, 'reader'],
    [{ push: true, pull: true }, 'writer'],
    [{ admin: true, push: true }, 'admin'],
  ] as const) {
    const { c } = client({ 'GET /repos/acme/ds': repo({ permissions }), 'GET /user/installations?per_page=100&page=1': all });
    const a = await resolveRepoAccess(c, { app: true });
    assert.equal(a.state, state);
    assert.equal(a.installationId, 7);
  }
});

test('selected repositories: installed only when the repo is in the list', async () => {
  const sel = installations([{ id: 9, account: { login: 'acme' }, repository_selection: 'selected' }]);
  const listed = client({
    'GET /repos/acme/ds': repo({ permissions: { push: true } }),
    'GET /user/installations?per_page=100&page=1': sel,
    'GET /user/installations/9/repositories?per_page=100&page=1': { body: { total_count: 1, repositories: [{ name: 'ds', full_name: 'acme/ds', owner: { login: 'acme' } }] } },
  });
  assert.equal((await resolveRepoAccess(listed.c, { app: true })).state, 'writer');
  const other = client({
    'GET /repos/acme/ds': repo({ permissions: { push: true } }),
    'GET /user/installations?per_page=100&page=1': sel,
    'GET /user/installations/9/repositories?per_page=100&page=1': { body: { total_count: 1, repositories: [{ name: 'web', full_name: 'acme/web', owner: { login: 'acme' } }] } },
  });
  assert.equal((await resolveRepoAccess(other.c, { app: true })).state, 'not-installed');
});

test('a personal token skips the installation check; a refused installation listing is unknown, not a lock', async () => {
  const pat = client({ 'GET /repos/acme/ds': repo({ permissions: { push: true } }) });
  assert.equal((await resolveRepoAccess(pat.c)).state, 'writer');
  assert.equal(pat.gh.calls.length, 1);
  const refused = client({ 'GET /repos/acme/ds': repo({ permissions: { push: true } }), 'GET /user/installations?per_page=100&page=1': { status: 403, body: { message: 'Forbidden' } } });
  const a = await resolveRepoAccess(refused.c, { app: true });
  assert.equal(a.state, 'writer');
  assert.equal(a.installationId, undefined);
});

test('a private repo the App token can see counts as installed even if the listing misses it', async () => {
  const { c } = client({ 'GET /repos/acme/ds': repo({ private: true, permissions: { pull: true } }), 'GET /user/installations?per_page=100&page=1': installations([]) });
  const a = await resolveRepoAccess(c, { app: true });
  assert.equal(a.state, 'reader');
  assert.equal(a.private, true);
});

test('Direct App: directInstalled from its own installations', async () => {
  const main = client({
    'GET /repos/acme/ds': repo({ permissions: { push: true } }),
    'GET /user/installations?per_page=100&page=1': installations([{ id: 1, account: { login: 'acme' }, repository_selection: 'all' }]),
  });
  const yes = fakeGitHub({ routes: { 'GET /user/installations?per_page=100&page=1': installations([{ id: 2, account: { login: 'acme' }, repository_selection: 'all' }]) } });
  const a = await resolveRepoAccess(main.c, { app: true, direct: new GitHubClient('acme/ds', 'direct-token-not-real', yes.fetchImpl, noSleep, { etags: false }) });
  assert.equal(a.directInstalled, true);
  const no = fakeGitHub({ routes: { 'GET /user/installations?per_page=100&page=1': installations([]) } });
  const b = await resolveRepoAccess(main.c, { app: true, direct: new GitHubClient('acme/ds', 'direct-token-not-real', no.fetchImpl, noSleep, { etags: false }) });
  assert.equal(b.directInstalled, false);
});

test('a rejected token and a used-up limit are thrown, not turned into a state', async () => {
  const rejected = client({ 'GET /repos/acme/ds': { status: 401, body: { message: 'Bad credentials' } } });
  await assert.rejects(resolveRepoAccess(rejected.c), (e: unknown) => e instanceof GitHubError && e.auth === 'rejected');
  const limited = client({ 'GET /repos/acme/ds': repo() }, TOKEN, 0);
  await assert.rejects(resolveRepoAccess(limited.c), (e: unknown) => e instanceof GitHubError && e.status === 429);
  const midway = client({ 'GET /repos/acme/ds': repo() }, TOKEN, 1);
  await assert.rejects(resolveRepoAccess(midway.c, { app: true }), (e: unknown) => e instanceof GitHubError && e.status === 429);
});
