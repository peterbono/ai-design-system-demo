// The toolbar's GitHub reads: Bridge's read proxy first (simple CORS GETs, no credentials), GitHub directly when Bridge
// refuses or cannot be reached, and the change and config loaders on top of them.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadBuild } from './config';
import { loadChange, loadTogetherChange, readsOf } from './github';
import { DEFAULT_PROXY, githubReads, resetReads } from './reads';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

const PROXY = 'https://bridge.example.com';
const TEAM = 'acme/ds';
const SHA = (c: string) => c.repeat(40);

/** A fake network: `answer` gets each URL; the calls are kept. */
function net(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(new URL(url));
  }) as typeof fetch;
  return { calls, f };
}

const gh = (u: URL) => u.searchParams.get('gh');

beforeEach(() => resetReads());

describe('githubReads', () => {
  it('reads through the proxy with the design system as repo, Accept only and no credentials', async () => {
    const n = net((u) => (gh(u) === '/repos/acme/shop/pulls/7' ? Response.json({ number: 7 }) : new Response('tokens', { status: 200 })));
    const reads = githubReads({ team: TEAM, proxy: `${PROXY}/`, fetch: n.f });
    expect(await reads.api('/repos/acme/shop/pulls/7')).toEqual({ number: 7 });
    expect(await reads.file('acme', 'shop', SHA('a'), 'packages/tokens/src/a b.tokens.json')).toBe('tokens');
    const [api, file] = n.calls.map((c) => new URL(c.url));
    expect(api!.origin + api!.pathname).toBe(`${PROXY}/api/contribute`);
    expect(api!.searchParams.get('repo')).toBe(TEAM);
    expect(gh(file!)).toBe(`/repos/acme/shop/contents/packages/tokens/src/a%20b.tokens.json?ref=${SHA('a')}`);
    expect(n.calls[0]!.init).toEqual({ headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit' });
    expect(n.calls[1]!.init).toEqual({ headers: { Accept: 'application/vnd.github.raw' }, credentials: 'omit' });
  });

  it("passes GitHub's own answer on (a 404 read by Bridge is not a refusal)", async () => {
    const n = net(() => Response.json({ message: 'Not Found' }, { status: 404 }));
    const reads = githubReads({ team: TEAM, proxy: PROXY, fetch: n.f });
    await expect(reads.api('/repos/acme/ds/pulls/9')).rejects.toThrow('GitHub answered 404.');
    expect(n.calls).toHaveLength(1);
  });

  for (const [what, answer] of [
    ['refuses (origin not named)', () => Response.json({ error: 'origin' }, { status: 403 })],
    ['is busy', () => Response.json({ error: 'busy' }, { status: 429 })],
    ['is down', () => new Response('', { status: 502 })],
    ['is unreachable or blocked by CORS', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const) {
    it(`reads GitHub directly when Bridge ${what}, then for the rest of the page`, async () => {
      const n = net((u) => (u.origin === PROXY ? answer() : u.origin === 'https://raw.githubusercontent.com' ? new Response('{"a":1}') : Response.json({ number: 3 })));
      const reads = githubReads({ team: TEAM, proxy: PROXY, fetch: n.f });
      expect(await reads.api('/repos/acme/ds/pulls/3')).toEqual({ number: 3 });
      expect(await reads.file('acme', 'ds', null, 'bridge.config.json')).toBe('{"a":1}');
      expect(n.calls.map((c) => new URL(c.url).origin)).toEqual([PROXY, 'https://api.github.com', 'https://raw.githubusercontent.com']);
      expect(n.calls[1]!.url).toBe('https://api.github.com/repos/acme/ds/pulls/3');
      expect(n.calls[2]!.url).toBe('https://raw.githubusercontent.com/acme/ds/HEAD/bridge.config.json');
    });
  }

  it('reads GitHub directly when no proxy is set', async () => {
    const n = net(() => Response.json({ number: 1 }));
    await githubReads({ team: TEAM, proxy: null, fetch: n.f }).api('/repos/acme/ds/pulls/1');
    expect(n.calls[0]!.url).toBe('https://api.github.com/repos/acme/ds/pulls/1');
  });

  it("says GitHub's limit in words when GitHub itself refuses", async () => {
    const n = net(() => new Response('', { status: 403 }));
    await expect(githubReads({ team: TEAM, proxy: null, fetch: n.f }).api('/repos/acme/ds/pulls/1')).rejects.toThrow('60 an hour');
  });

  it('defaults to production Bridge, the design system as team (the build repository without one)', () => {
    expect(DEFAULT_PROXY).toBe('https://bridge.floriangouloubi.com');
    expect(readsOf({ owner: 'acme', repo: 'shop', ds: TEAM })).toBeTruthy();
  });
});

describe('loaders through the proxy', () => {
  const head = SHA('b');
  const base = SHA('c');
  function bridge(extra: (gh: string) => Response | null = () => null) {
    return net((u) => {
      expect(u.origin).toBe(PROXY);
      expect(u.searchParams.get('repo')).toBe(TEAM);
      const p = gh(u)!;
      const own = extra(p);
      if (own) return own;
      if (p === '/repos/acme/shop/pulls/5') return Response.json({ number: 5, title: 'Softer buttons', html_url: 'https://github.com/acme/shop/pull/5', head: { sha: head }, base: { ref: 'main', sha: base } });
      if (p === '/repos/acme/shop/pulls/5/files?per_page=100') return Response.json([{ filename: 'src/App.tsx', status: 'modified' }]);
      if (p.startsWith('/repos/acme/shop/compare/')) return Response.json({ behind_by: 2, merge_base_commit: { sha: base }, files: [{ filename: 'src/App.tsx', status: 'modified' }] });
      if (p === '/repos/acme/shop/git/trees/bridge-visual') return Response.json({ tree: [] });
      return Response.json({ message: 'Not Found' }, { status: 404 });
    });
  }

  it('loadChange reads a product change through Bridge only', async () => {
    const n = bridge();
    const facts = await loadChange({ owner: 'acme', repo: 'shop', ds: TEAM }, 5, githubReads({ team: TEAM, proxy: PROXY, fetch: n.f }));
    expect(facts).toMatchObject({ number: 5, sha: head, mode: 'code', behind: 2, screens: null });
    expect(n.calls.every((c) => c.url.startsWith(`${PROXY}/api/contribute?`))).toBe(true);
  });

  it('loadTogetherChange reads token files at their commits through Bridge', async () => {
    const n = bridge((p) => {
      if (p.startsWith('/repos/acme/shop/compare/')) return Response.json({ merge_base_commit: { sha: base }, files: [{ filename: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' }] });
      if (p.startsWith('/repos/acme/shop/contents/packages/tokens/src/semantic/light.tokens.json?ref=')) return new Response(`{"at":"${p.slice(-40)}"}`);
      return null;
    });
    const facts = await loadTogetherChange({ owner: 'acme', repo: 'shop', ds: TEAM, defaultBranch: 'main' }, 5, githubReads({ team: TEAM, proxy: PROXY, fetch: n.f }));
    expect(facts.mode).toBe('tokens');
    expect(facts.source?.base['semantic/light.tokens.json']).toBe(`{"at":"${base}"}`);
    expect(facts.source?.head['semantic/light.tokens.json']).toBe(`{"at":"${head}"}`);
  });

  it('loadBuild reads the design system config through Bridge (its default branch)', async () => {
    const n = bridge((p) => (p === '/repos/acme/ds/contents/bridge.config.json' ? new Response(JSON.stringify({ products: [{ key: 'shop', repo: 'acme/shop', production: 'https://shop.example.com' }] })) : null));
    const build = await loadBuild(TEAM, 'shop', { proxy: PROXY }, githubReads({ team: TEAM, proxy: PROXY, fetch: n.f }));
    expect(build).toMatchObject({ owner: 'acme', repo: 'shop', ds: TEAM, production: 'https://shop.example.com', proxy: PROXY });
    expect(n.calls).toHaveLength(1);
  });
});
