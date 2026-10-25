import { describe, expect, it } from 'vitest';
import { GitHubClient, resolveRepoAccess, type FetchLike } from '@bridge-ds/core';
import { accessFromCheck, accessLabel, accessStorageKey, accessView, ACCESS_MAX_AGE_MS, contributorAccess, freshAccess, pillState } from './access';

const TOKEN = 'test-token-not-real';
const noSleep = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };

/** A fake api.github.com: "GET /path" -> JSON body (404 for anything else). */
function fakeFetch(routes: Record<string, unknown>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('https://api.github.com', '')}`;
    calls.push(key);
    const hit = key in routes;
    const body = hit ? routes[key] : { message: 'Not Found' };
    return {
      ok: hit,
      status: hit ? 200 : 404,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}

const repo = (permissions: Record<string, boolean>, priv = false) => ({ full_name: 'acme/ds', default_branch: 'main', private: priv, permissions });
const installs = (list: unknown[]) => ({ total_count: list.length, installations: list });
const ALL = { id: 7, account: { login: 'acme', type: 'Organization' }, repository_selection: 'all' };

async function view(routes: Record<string, unknown>, opts: { token?: string; app?: boolean } = {}) {
  const fetchImpl = fakeFetch(routes);
  const client = new GitHubClient('acme/ds', opts.token ?? TOKEN, fetchImpl, noSleep);
  const app = opts.app ?? true;
  return { a: accessView(await resolveRepoAccess(client, { app: app && Boolean(opts.token ?? TOKEN) }), app), calls: fetchImpl.calls };
}

const INSTALLED = { 'GET /user/installations?per_page=100&page=1': installs([ALL]) };
const NOT_INSTALLED = { 'GET /user/installations?per_page=100&page=1': installs([]) };

describe('resolveAccess states (plan 3.3) as the Studio sees them', () => {
  it('anonymous: public repo reads, a 404 is unknown', async () => {
    const pub = await view({ 'GET /repos/acme/ds': repo({ pull: true }) }, { token: '', app: false });
    expect(pub.a).toEqual({ state: 'anonymous-public', write: false, admin: false, private: false });
    expect(pub.calls).toEqual(['GET /repos/acme/ds']);
    expect((await view({}, { token: '', app: false })).a).toEqual({ state: 'anonymous-unknown', write: false, admin: false });
  });

  it('signed in, 404: no access, the app does not reach the repository', async () => {
    expect((await view({})).a).toEqual({ state: 'no-access', write: false, admin: false, reach: false });
  });

  it('not installed (explicit permission on a public repo): no reach, no write', async () => {
    expect((await view({ 'GET /repos/acme/ds': repo({ push: true, pull: true }), ...NOT_INSTALLED })).a).toEqual({ state: 'not-installed', write: false, admin: false, reach: false, private: false });
  });

  it('not installed, for an admin of the repository: may install Bridge', async () => {
    expect((await view({ 'GET /repos/acme/ds': repo({ admin: true, push: true, pull: true }), ...NOT_INSTALLED })).a).toMatchObject({ state: 'not-installed', admin: false, repoAdmin: true });
  });

  it('outside contributor: read only, never "not installed" (reach unknown)', async () => {
    const { a } = await view({ 'GET /repos/acme/ds': repo({ pull: true }), ...NOT_INSTALLED });
    expect(a).toEqual({ state: 'outside-contributor', write: false, admin: false, private: false });
    expect(accessLabel(true, a)).toBe('Read only');
  });

  it('reader, writer and admin where the app is installed', async () => {
    expect((await view({ 'GET /repos/acme/ds': repo({ pull: true }), ...INSTALLED })).a).toEqual({ state: 'reader', write: false, admin: false, reach: true, private: false });
    expect((await view({ 'GET /repos/acme/ds': repo({ push: true, pull: true }), ...INSTALLED })).a).toEqual({ state: 'writer', write: true, admin: false, reach: true, private: false });
    expect((await view({ 'GET /repos/acme/ds': repo({ admin: true, push: true }), ...INSTALLED })).a).toEqual({ state: 'admin', write: true, admin: true, reach: true, private: false });
  });

  it('a private repository the app token sees is reached', async () => {
    expect((await view({ 'GET /repos/acme/ds': repo({ push: true }, true), ...NOT_INSTALLED })).a).toEqual({ state: 'writer', write: true, admin: false, reach: true, private: true });
  });

  it('a pasted token: permissions only, no installation call, reach unknown', async () => {
    const { a, calls } = await view({ 'GET /repos/acme/ds': repo({ push: true }) }, { app: false });
    expect(a).toEqual({ state: 'writer', write: true, admin: false, private: false });
    expect(calls).toEqual(['GET /repos/acme/ds']);
  });
});

describe('access remembered by the token check', () => {
  it('uses the state saved for the same repository', () => {
    expect(accessFromCheck({ access: { repo: 'acme/ds', state: 'admin' }, reach: true }, 'Acme/DS', true)).toEqual({ state: 'admin', write: true, admin: true, reach: true });
    expect(accessFromCheck({ access: { repo: 'acme/other', state: 'admin' } }, 'acme/ds', true)).toBeNull();
  });

  it('reads the flags saved before states existed on the self-hosted site only', () => {
    expect(accessFromCheck({ write: true, reach: true }, 'acme/ds', false)).toEqual({ state: 'writer', write: true, admin: false, reach: true });
    expect(accessFromCheck({ write: false }, 'acme/ds', false)).toEqual({ state: 'reader', write: false, admin: false });
    expect(accessFromCheck({ write: false, reach: false }, 'acme/ds', false)).toEqual({ state: 'not-installed', write: false, admin: false, reach: false });
    expect(accessFromCheck({ write: true }, 'acme/ds', true)).toBeNull();
    expect(accessFromCheck({}, 'acme/ds', false)).toBeNull();
    expect(accessFromCheck(null, 'acme/ds', false)).toBeNull();
  });
});

describe('access cache', () => {
  it('keys per app slot, account and repository, case-insensitive', () => {
    expect(accessStorageKey('suggest', 'Octo', 'Acme/DS')).toBe('bridge.github.access:suggest:octo:acme/ds');
  });

  it('reuses an access for ten minutes', () => {
    const raw = JSON.stringify({ at: 1000, access: { state: 'writer', write: true, admin: false } });
    expect(freshAccess(raw, 1000 + ACCESS_MAX_AGE_MS - 1)).toEqual({ state: 'writer', write: true, admin: false });
    expect(freshAccess(raw, 1000 + ACCESS_MAX_AGE_MS)).toBeNull();
    expect(freshAccess('not json', 0)).toBeNull();
    expect(freshAccess(null, 0)).toBeNull();
  });

  it('labels the badge as before', () => {
    expect(accessLabel(false, null)).toBe('');
    expect(accessLabel(true, null)).toBe('Unknown');
    expect(accessLabel(true, { state: 'not-installed', write: false, admin: false, reach: false })).toBe('No access');
    expect(accessLabel(true, { state: 'writer', write: true, admin: false })).toBe('Read and write');
  });
});

describe('pillState', () => {
  it("shows an email member's role from /api/contribute, GitHub's state for everyone else", () => {
    expect(pillState(null)).toBeNull();
    expect(pillState(contributorAccess(false))).toBe('writer');
    expect(pillState(contributorAccess(true))).toBe('admin');
    expect(pillState(contributorAccess(false), 'admin')).toBe('admin');
    expect(pillState(contributorAccess(true), 'edit')).toBe('writer');
    expect(pillState({ state: 'reader', admin: false }, 'admin')).toBe('reader');
  });
});
