// Studio's read pass in the toolbar: taken out of the address once, kept for the tab, sent with the reads as a query
// parameter (no header, no credentials), carried to the other deployment on Live product and This change.
import { beforeEach, describe, expect, it } from 'vitest';
import { PASS_KEY, readPass, resetPass, splitPass, takePass, withPass } from './pass';
import { githubReads, resetReads } from './reads';
import { branchOfHost, branchTitle, canFlipSides } from './session';

const PASS = 'v1.eyJ0IjoiYWNtZS9kcyJ9.c2lnbmF0dXJlLWJ5dGVz';

function store() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

beforeEach(() => {
  resetPass();
  resetReads();
});

describe('read pass', () => {
  it('leaves the address at once, keeps the hash route, and is kept for the tab', () => {
    const s = store();
    const replaced: string[] = [];
    const href = `https://explore-x.shop-design.pages.dev/?bridge=4#bridge-pass=${PASS}&/orders?tab=1`;
    expect(takePass({ href, hash: new URL(href).hash }, s, (u) => replaced.push(u))).toBe(PASS);
    expect(replaced).toEqual(['https://explore-x.shop-design.pages.dev/?bridge=4#/orders?tab=1']);
    expect(s.m.get(PASS_KEY)).toBe(PASS);
    // A reload or another screen: no pass in the address, the tab's one.
    expect(takePass({ href: 'https://explore-x.shop-design.pages.dev/?bridge=4#/orders', hash: '#/orders' }, s, (u) => replaced.push(u))).toBe(PASS);
    expect(replaced).toHaveLength(1);
  });

  it('takes nothing from a fragment without one, and drops a malformed one from the address', () => {
    const s = store();
    const replaced: string[] = [];
    expect(takePass({ href: 'https://a.example/#/x', hash: '#/x' }, s, (u) => replaced.push(u))).toBeNull();
    expect(takePass({ href: 'https://a.example/#bridge-pass=<x>', hash: '#bridge-pass=<x>' }, s, (u) => replaced.push(u))).toBeNull();
    expect(replaced).toEqual(['https://a.example/']);
    expect(splitPass(`#/orders&bridge-pass=${PASS}`)).toEqual({ pass: PASS, rest: '/orders' });
  });

  it('works with storage blocked, for this page', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
    expect(takePass({ href: `https://a.example/#bridge-pass=${PASS}`, hash: `#bridge-pass=${PASS}` }, blocked, () => undefined)).toBe(PASS);
    expect(readPass(blocked)).toBe(PASS);
  });

  it('goes with the proxy reads as &pass=, still a simple request, never to GitHub', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json({ number: 4, title: 'Exploration: add a toast alert' });
    }) as typeof fetch;
    const reads = githubReads({ team: 'peterbono/ai-design-system-demo', proxy: 'https://bridge.example.com', pass: PASS, fetch: f });
    await reads.api('/repos/art-print-shop-co/art-print-shop-design/pulls/4');
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('pass')).toBe(PASS);
    expect(calls[0]!.init).toEqual({ headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit' });
    // Bridge refuses: GitHub directly, without the pass.
    resetReads();
    const g: string[] = [];
    const reads2 = githubReads({ team: 'acme/ds', proxy: 'https://bridge.example.com', pass: PASS, fetch: (async (input: RequestInfo | URL) => (g.push(String(input)), String(input).includes('bridge.example') ? new Response('{}', { status: 401 }) : Response.json({}))) as typeof fetch });
    await reads2.api('/repos/acme/shop/pulls/4');
    expect(g[1]).toBe('https://api.github.com/repos/acme/shop/pulls/4');
  });

  it('is carried to the other deployment in its fragment', () => {
    expect(withPass('https://shop.pages.dev/?bridge=4#/orders', PASS)).toBe(`https://shop.pages.dev/?bridge=4#bridge-pass=${PASS}&/orders`);
    expect(withPass('https://shop.pages.dev/?bridge=4', null)).toBe('https://shop.pages.dev/?bridge=4');
  });
});

describe('when the change cannot be read', () => {
  it('names it by its branch, from the preview template', () => {
    expect(branchTitle(branchOfHost('explore-add-a-toast-alert.art-print-shop-design.pages.dev', 'https://{branch}.art-print-shop-design.pages.dev'))).toBe('Add a toast alert');
    expect(branchOfHost('bridge-admin-git-agent-x-peterbonos-projects.vercel.app', 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app')).toBe('agent-x');
    expect(branchOfHost('art-print-shop.pages.dev', 'https://{branch}.art-print-shop-design.pages.dev')).toBeNull();
    expect(branchTitle(null)).toBeNull();
    expect(branchTitle('explore-1a2b3c4d')).toBeNull();
  });

  it('still flips a code change with a known production or way back', () => {
    const base = { mode: null, failed: true, production: 'https://shop.pages.dev', returnTo: null } as const;
    expect(canFlipSides({ ...base, side: 'after' })).toBe(true);
    expect(canFlipSides({ ...base, side: 'before' })).toBe(false);
    expect(canFlipSides({ ...base, side: 'before', returnTo: 'https://x.shop-design.pages.dev' })).toBe(true);
    expect(canFlipSides({ ...base, failed: false, side: 'after' })).toBe(false);
    expect(canFlipSides({ ...base, production: null, side: 'after' })).toBe(false);
    expect(canFlipSides({ mode: 'tokens', failed: false, side: 'after', production: null, returnTo: null })).toBe(true);
  });
});
