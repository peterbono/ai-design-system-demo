// @vitest-environment jsdom
// GitHub answers reads with max-age=60: right after Done exploring or Archive, the browser could serve the pull request
// as it was, and the page repainted the state it just left. After a write, reads ask GitHub again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ghGet, studioFetch } from './github-session';

let modes: { url: string; method: string; cache: RequestCache | undefined }[];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('bridge.github.token', 'ghp_test');
  modes = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    modes.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), cache: init?.cache });
    return new Response(JSON.stringify({ number: 2, labels: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => vi.unstubAllGlobals());

const PULL = 'https://api.github.com/repos/acme/shop/pulls/2';

describe('reads after a write', () => {
  it('use the browser cache until this tab writes, then ask GitHub again', async () => {
    await ghGet(`${PULL}?before`);
    await studioFetch(PULL, { method: 'GET', headers: { Authorization: 'Bearer ghp_test' } });
    expect(modes.map((m) => m.cache)).toEqual(['default', 'default']);
    await studioFetch('https://api.github.com/repos/acme/shop/issues/2/labels', { method: 'POST', headers: { Authorization: 'Bearer ghp_test' }, body: '{"labels":["ready-for-devs"]}' });
    modes = [];
    await ghGet(`${PULL}?after`);
    await studioFetch(PULL, { method: 'GET', headers: { Authorization: 'Bearer ghp_test' } });
    expect(modes.map((m) => [m.method, m.cache])).toEqual([
      ['GET', 'no-cache'],
      ['GET', 'no-cache'],
    ]);
  });
});
