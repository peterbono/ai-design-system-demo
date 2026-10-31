// @vitest-environment jsdom
// The maintainer tools (Edit in Studio, View source) never blink: a renewed GitHub token keeps the last known state
// until its own check answers, and a GitHub refusal that says nothing about the person (rate limit) keeps it too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let token = 'gho_aaaaaaaaaaaaOLD123';
vi.mock('./github-session', () => ({
  API: 'https://api.github.com',
  getToken: () => token,
  markTokenRejected: vi.fn(),
  readRepo: () => ({ owner: 'acme', repo: 'ds' }),
  tokenRejected: () => false,
}));
vi.mock('./avatar', () => ({ paintAvatar: vi.fn() }));

const KEY = 'bridge.gh.maintainer';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('maintainer tools', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute('data-maintainer');
    localStorage.setItem(KEY, JSON.stringify({ key: 'OLD123', login: 'ann', avatar: '', write: true, at: Date.now() - 60 * 60 * 1000 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('keeps showing them while a renewed token is checked', async () => {
    token = 'gho_bbbbbbbbbbbbNEW456';
    const seen: boolean[] = [];
    new MutationObserver(() => seen.push(document.documentElement.hasAttribute('data-maintainer'))).observe(document.documentElement, { attributes: true });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/user') ? json(200, { login: 'ann', avatar_url: '' }) : json(200, { permissions: { push: true } }))));
    const { initMaintainer } = await import('./maintainer');
    initMaintainer();
    expect(document.documentElement.hasAttribute('data-maintainer')).toBe(true);
    await flush();
    await flush();
    expect(document.documentElement.hasAttribute('data-maintainer')).toBe(true);
    expect(seen).not.toContain(false);
    expect(JSON.parse(localStorage.getItem(KEY)!).key).toBe('NEW456');
  });

  it('keeps them when GitHub is rate limited', async () => {
    token = 'gho_aaaaaaaaaaaaOLD123';
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { message: 'API rate limit exceeded' })));
    const { initMaintainer } = await import('./maintainer');
    initMaintainer();
    await flush();
    await flush();
    expect(document.documentElement.hasAttribute('data-maintainer')).toBe(true);
  });
});
