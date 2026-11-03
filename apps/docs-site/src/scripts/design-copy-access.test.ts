// "Make my copy" signed in with the Bridge app (scripts/design-copy.ts makeCopy): on an account where Bridge sees only
// the ticked products, GitHub does not tick the new copy, so Bridge could not open it. makeCopy answers the one more
// step (CopyAccess) instead of waiting a minute and a half for a copy it cannot see. Every product of the account, a
// token of the viewer's own, or a copy GitHub ticked on its own: on as before, nothing extra.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, type FetchLike, type ProductConfig } from '@bridge-ds/core';

const s = vi.hoisted(() => ({
  mode: 'app' as 'app' | 'token',
  routes: {} as Record<string, unknown>,
  gets: [] as string[],
  calls: [] as string[],
}));

const fetchImpl = (async (url: string, init?: { method?: string }) => {
  const path = new URL(url).pathname;
  const key = `${init?.method ?? 'GET'} ${path}`;
  s.calls.push(key);
  const body = s.routes[key];
  const status = body === undefined ? 404 : key.startsWith('POST') ? 202 : 200;
  return { ok: status < 300, status, headers: { get: () => null }, json: async () => body ?? { message: 'Not Found' }, text: async () => JSON.stringify(body ?? {}) };
}) as unknown as FetchLike;

vi.mock('./github-session', () => {
  class RateLimitError extends Error {
    constructor(public resetAt: Date | null) {
      super('GitHub rate limit reached');
    }
  }
  return {
    studioClient: (repo: string) => new GitHubClient(repo, 't', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }, { etags: false }),
    getToken: () => 't',
    ghWrite: async () => undefined,
    GitHubError: Error,
    RateLimitError,
    sessionMode: () => s.mode,
    ghGet: async (path: string) => {
      s.gets.push(path);
      const body = s.routes[`GET ${path}`];
      if (body === undefined) throw new Error(`no route ${path}`);
      return { data: body, stale: false };
    },
  };
});
vi.mock('./exploration-start', () => ({ explorationsConfig: () => ({ owner: 'acme', repo: 'ds' }) }));

import { copyVisible, makeCopy } from './design-copy';

const SHOP: ProductConfig = { key: 'shop', name: 'Shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } };
const nap = async () => {};
const INSTALLS = (selection: 'all' | 'selected') => ({ installations: [{ id: 42, account: { login: 'acme', type: 'Organization' }, repository_selection: selection }] });

beforeEach(() => {
  s.mode = 'app';
  s.gets = [];
  s.calls = [];
  s.routes = {
    'GET /users/acme': { type: 'Organization' },
    'POST /repos/acme/shop/forks': { full_name: 'acme/shop-design' },
    'GET /repos/acme/shop-design': { full_name: 'acme/shop-design', default_branch: 'main', private: true },
    'GET /repos/acme/shop-design/git/ref/heads/main': { object: { sha: 'abc' } },
  };
});

describe('Make my copy and what Bridge may open', () => {
  it('Bridge sees only the ticked products and GitHub did not tick the copy: the one more step, named after the copy', async () => {
    s.routes['GET /user/installations?per_page=100'] = INSTALLS('selected');
    s.routes['GET /user/installations/42/repositories?per_page=100&page=1'] = { total_count: 1, repositories: [{ full_name: 'acme/shop' }] };
    const r = await makeCopy(SHOP, { sleep: nap });
    expect(r).toEqual({ kind: 'needs-access', copy: 'acme/shop-design', name: 'shop-design', installation: INSTALLS('selected').installations[0] });
    // Three looks before asking, and no wait for a copy Bridge cannot open.
    expect(s.gets.filter((g) => g.includes('/repositories')).length).toBe(3);
    expect(s.calls).not.toContain('GET /repos/acme/shop-design');
  });

  it('GitHub ticked the copy on its own: ready, nothing extra', async () => {
    s.routes['GET /user/installations?per_page=100'] = INSTALLS('selected');
    s.routes['GET /user/installations/42/repositories?per_page=100&page=1'] = { total_count: 2, repositories: [{ full_name: 'acme/shop' }, { full_name: 'Acme/Shop-Design' }] };
    expect(await makeCopy(SHOP, { sleep: nap })).toBe('ready');
  });

  it('Bridge sees every product of the account: ready, no list read', async () => {
    s.routes['GET /user/installations?per_page=100'] = INSTALLS('all');
    expect(await makeCopy(SHOP, { sleep: nap })).toBe('ready');
    expect(s.gets.some((g) => g.includes('/repositories'))).toBe(false);
  });

  it('signed in with a token of their own: no installation read, on as before', async () => {
    s.mode = 'token';
    expect(await makeCopy(SHOP, { sleep: nap })).toBe('ready');
    expect(s.gets).toEqual([]);
  });

  it('GitHub could not say what Bridge sees: on as before, never a step for nothing', async () => {
    expect(await makeCopy(SHOP, { sleep: nap })).toBe('ready');
  });

  it('copyVisible reads every page of the list', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ full_name: `acme/p${from + i}` }));
    s.routes['GET /user/installations/42/repositories?per_page=100&page=1'] = { total_count: 150, repositories: page(100, 0) };
    s.routes['GET /user/installations/42/repositories?per_page=100&page=2'] = { total_count: 150, repositories: [...page(49, 100), { full_name: 'acme/shop-design' }] };
    const access = { copy: 'acme/shop-design', installation: { id: 42 } };
    expect(await copyVisible(access)).toBe(true);
    s.routes['GET /user/installations/42/repositories?per_page=100&page=2'] = { total_count: 150, repositories: page(50, 100) };
    expect(await copyVisible(access)).toBe(false);
  });
});
