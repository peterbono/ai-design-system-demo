// @vitest-environment jsdom
// Someone signed in with GitHub reads the team through Bridge (lib/write-route teamReadRoute): the library, its
// products and people go to the team's proxy with their token as proof of who they are, so the Studio never spends
// their own GitHub limit; writes, other repositories and the account itself still go to GitHub. A read right after a
// write asks Bridge for a fresh answer. When Bridge cannot read the team for them, their reads go to GitHub as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { teamReadRoute } from '../lib/write-route';

type Session = typeof import('./github-session');

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let calls: Call[];
let bridge: (url: string, c: Call) => Response;

const API = 'https://api.github.com';
const TOKEN = 'ghu_lead_token_aaaaaaaaaaaa';
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

/** A team page for acme/ds with one product (code repository and design copy), and a GitHub sign-in. */
function page() {
  document.body.innerHTML = `<script type="application/json" id="bridge-repo">${JSON.stringify({ owner: 'acme', repo: 'ds', products: [{ repo: 'acme/shop', design: { repo: 'acme/shop-design' } }] })}</script>`;
  localStorage.setItem('bridge.github.token', TOKEN);
}

async function load(): Promise<Session> {
  vi.resetModules();
  return import('./github-session');
}

const toGitHub = () => calls.filter((c) => c.url.startsWith(API));
const toBridge = () => calls.filter((c) => c.url.startsWith('/api/contribute'));
const ghOf = (c: Call) => new URL(c.url, 'https://bridge.example.com').searchParams.get('gh');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  bridge = () => json([{ number: 1 }]);
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const c: Call = { url, method: (init?.method ?? 'GET').toUpperCase(), headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) } };
    calls.push(c);
    if (url.startsWith('/api/contribute')) return bridge(url, c);
    return json({ from: 'github' });
  });
  page();
});

afterEach(() => vi.unstubAllGlobals());

describe('which reads of a GitHub sign-in go through Bridge (lib/write-route teamReadRoute)', () => {
  const products = ['acme/shop', 'acme/shop-design'];
  const r = (url: string, o: Partial<Parameters<typeof teamReadRoute>[0]> = {}) => teamReadRoute({ method: 'GET', url, team: 'acme/ds', products, session: 'github', ...o });
  it('the library, its products and people: through Bridge', () => {
    expect(r(`${API}/repos/acme/ds/pulls?state=open`)).toEqual({ via: 'bridge', scope: 'library' });
    expect(r(`${API}/repos/Acme/DS/contents/bridge.config.json`)).toEqual({ via: 'bridge', scope: 'library' });
    expect(r(`${API}/repos/acme/ds/commits/${'a'.repeat(40)}/check-runs`)).toEqual({ via: 'bridge', scope: 'library' });
    expect(r(`${API}/repos/acme/ds`)).toEqual({ via: 'bridge', scope: 'library' });
    expect(r(`${API}/repos/acme/shop/deployments?sha=abc`)).toEqual({ via: 'bridge', scope: 'product' });
    expect(r(`${API}/repos/acme/shop-design/pulls`)).toEqual({ via: 'bridge', scope: 'product' });
    expect(r(`${API}/users/dana`)).toEqual({ via: 'bridge', scope: 'user' });
    expect(r(`${API}/users/renovate%5Bbot%5D`)).toEqual({ via: 'bridge', scope: 'user' });
  });
  it('writes, other repositories, the account, other hosts, guests and pages without a team: GitHub', () => {
    expect(r(`${API}/repos/acme/ds/pulls`, { method: 'POST' })).toEqual({ via: 'github' });
    expect(r(`${API}/repos/acme/ds/git/refs`, { method: 'PATCH' })).toEqual({ via: 'github' });
    expect(r(`${API}/repos/acme/ds-other/pulls`)).toEqual({ via: 'github' });
    expect(r(`${API}/repos/evil/ds/pulls`)).toEqual({ via: 'github' });
    expect(r(`${API}/user`)).toEqual({ via: 'github' });
    expect(r(`${API}/user/installations`)).toEqual({ via: 'github' });
    expect(r(`${API}/users/dana/repos`)).toEqual({ via: 'github' });
    expect(r(`${API}/search/issues?q=x`)).toEqual({ via: 'github' });
    expect(r('https://raw.githubusercontent.com/acme/ds/main/a.json')).toEqual({ via: 'github' });
    expect(r(`${API}/repos/acme/ds/pulls`, { session: null })).toEqual({ via: 'github' });
    expect(r(`${API}/repos/acme/ds/pulls`, { team: null })).toEqual({ via: 'github' });
  });
});

describe("a GitHub sign-in's reads in the Studio", () => {
  it('reads the library and a product through the team proxy with their token as proof, never on GitHub', async () => {
    const s = await load();
    await s.ghGet('/repos/acme/ds/pulls?state=open&per_page=100');
    await s.studioFetch(`${API}/repos/acme/ds/contents/bridge.config.json`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw' } });
    await s.studioFetch(`${API}/repos/acme/shop/deployments?sha=abc`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(toGitHub()).toEqual([]);
    expect(toBridge().map(ghOf)).toEqual(['/repos/acme/ds/pulls?state=open&per_page=100', '/repos/acme/ds/contents/bridge.config.json', '/repos/acme/shop/deployments?sha=abc']);
    for (const c of toBridge()) {
      expect(new URL(c.url, 'https://x').searchParams.get('repo')).toBe('acme/ds');
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.headers['X-Bridge-Fresh']).toBeUndefined();
    }
  });

  it("asks for people's public profiles in one batch through Bridge", async () => {
    bridge = (url) => (url.includes('users=') ? json({ users: { dana: { login: 'Dana', name: 'Dana W', avatar_url: null, type: 'User' }, ghost: null } }) : json([]));
    const s = await load();
    const [dana, ghost] = await Promise.allSettled([s.ghGet<{ name: string }>('/users/dana'), s.ghGet('/users/ghost')]);
    expect(dana.status === 'fulfilled' && dana.value.data.name).toBe('Dana W');
    expect(ghost.status).toBe('rejected');
    expect(toGitHub()).toEqual([]);
    expect(toBridge()).toHaveLength(1);
    expect(toBridge()[0]!.url).toContain('users=dana,ghost');
    expect(toBridge()[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('keeps writes, other repositories and the account itself on GitHub with their token', async () => {
    const s = await load();
    await s.studioFetch(`${API}/repos/acme/ds/pulls`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{}' });
    await s.studioFetch(`${API}/repos/other/lib/pulls`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    await s.studioFetch(`${API}/user`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(toBridge()).toEqual([]);
    expect(toGitHub().map((c) => [c.method, c.url.slice(API.length), c.headers.Authorization])).toEqual([
      ['POST', '/repos/acme/ds/pulls', `Bearer ${TOKEN}`],
      ['GET', '/repos/other/lib/pulls', `Bearer ${TOKEN}`],
      ['GET', '/user', `Bearer ${TOKEN}`],
    ]);
  });

  it('asks Bridge for a fresh answer right after a write, skipping what this tab kept', async () => {
    const s = await load();
    const read = () => s.studioFetch(`${API}/repos/acme/ds/pulls?state=open`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    await read();
    await read();
    // The second read is this tab's copy (RECENT_MS).
    expect(toBridge()).toHaveLength(1);
    s.noteWrite();
    await read();
    expect(toBridge()).toHaveLength(2);
    expect(toBridge()[1]!.headers['X-Bridge-Fresh']).toBe('1');
  });

  it('reads on GitHub with their own token when Bridge says they are not on the team, and stops asking Bridge', async () => {
    bridge = () => json({ error: 'signin', message: 'Sign in to read this team.' }, { status: 401 });
    const s = await load();
    const r = await s.studioFetch(`${API}/repos/acme/ds/pulls`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(await r.json()).toEqual({ from: 'github' });
    await s.studioFetch(`${API}/repos/acme/ds/issues`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(toBridge()).toHaveLength(1);
    expect(toGitHub().map((c) => c.headers.Authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(await s.bridgeReadAuth('acme/ds')).toBeNull();
  });

  it('reads the library on GitHub with their own token while Bridge is busy for them', async () => {
    bridge = () => json({ error: 'busy', message: 'Bridge is busy, try again in 5 min.', retryAfter: 300 }, { status: 429 });
    const s = await load();
    const r = await s.studioFetch(`${API}/repos/acme/ds/pulls`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(await r.json()).toEqual({ from: 'github' });
    await s.studioFetch(`${API}/repos/acme/ds/issues`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(toBridge()).toHaveLength(1);
    expect(toGitHub()).toHaveLength(2);
  });

  it('Bridge busy on a library read, then GitHub busy for their own token: a wait with GitHub’s reset (lib/github-busy)', async () => {
    const { githubBusy } = await import('../lib/github-busy');
    bridge = () => json({ error: 'busy', message: 'Bridge is busy, try again in 5 min.', retryAfter: 300 }, { status: 429 });
    const reset = Math.floor(Date.now() / 1000) + 1200;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) } });
      if (url.startsWith('/api/contribute')) return bridge(url, calls.at(-1)!);
      return json({ message: 'API rate limit exceeded for user ID 1.' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } });
    });
    const s = await load();
    // The core client (team loads, the copy state) and the cached reads (lists) both say GitHub's wait, never a 403.
    const viaClient = await s.studioClient('acme/ds', TOKEN).getRepo().catch((e: unknown) => e);
    expect(githubBusy(viaClient)).toEqual({ resetsAt: new Date(reset * 1000), source: 'github' });
    const viaGet = await s.ghGet('/repos/acme/ds/pulls?state=open').catch((e: unknown) => e);
    expect(githubBusy(viaGet)).toEqual({ resetsAt: new Date(reset * 1000), source: 'github' });
    expect(toBridge().length).toBeGreaterThan(0);
  });

  it('Bridge busy on a product read: a wait, Bridge’s own (never "not found")', async () => {
    const { githubBusy } = await import('../lib/github-busy');
    bridge = () => json({ error: 'busy', message: 'Bridge is busy, try again in 5 min.', retryAfter: 300 }, { status: 429 });
    const s = await load();
    const err = await s.studioClient('acme/shop', TOKEN).getRepo().catch((e: unknown) => e);
    expect(githubBusy(err)?.source).toBe('bridge');
    expect(githubBusy(err)?.resetsAt).toBeInstanceOf(Date);
  });

  it('reads a path Bridge does not read on GitHub, and keeps asking Bridge for the rest', async () => {
    bridge = (url) => (url.includes('hooks') ? json({ error: 'not-allowed', message: 'Bridge does not read this from GitHub.' }, { status: 403 }) : json([]));
    const s = await load();
    await s.studioFetch(`${API}/repos/acme/ds/hooks`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    await s.studioFetch(`${API}/repos/acme/ds/pulls`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(toGitHub().map((c) => c.url.slice(API.length))).toEqual(['/repos/acme/ds/hooks']);
    expect(toBridge().map(ghOf)).toEqual(['/repos/acme/ds/hooks', '/repos/acme/ds/pulls']);
  });

  it("proves who reads for the change statuses batch, for the page's team only", async () => {
    const s = await load();
    expect(await s.bridgeReadAuth('acme/ds')).toBe(`Bearer ${TOKEN}`);
    expect(await s.bridgeReadAuth('other/lib')).toBeNull();
    const { prefetchChangeStatuses } = await import('./contribute-session');
    bridge = () => json({ changes: {} });
    await prefetchChangeStatuses('acme/ds', [{ number: 4, head: { sha: 'a'.repeat(40) } }], await s.bridgeReadAuth('acme/ds'));
    expect(toBridge()[0]!.url).toContain(`changes=4:${'a'.repeat(40)}`);
    expect(toBridge()[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('a signed-out visitor keeps their own path (no Authorization sent to Bridge for them)', async () => {
    localStorage.removeItem('bridge.github.token');
    const s = await load();
    await s.studioFetch(`${API}/repos/acme/ds/pulls`, { headers: {} }).catch(() => undefined);
    expect(calls.every((c) => !c.headers.Authorization)).toBe(true);
  });
});
