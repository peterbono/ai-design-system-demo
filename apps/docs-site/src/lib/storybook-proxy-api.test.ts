// The /api/storybook Vercel function (api/storybook/index.ts) with a fake DNS and a fake upstream: SSRF guards,
// redirects, size cap, fallbacks and the frame verdict.
import { describe, expect, it } from 'vitest';
import { checkStorybookUrl, frameVerdict, handleStorybookRequest, isPublicAddress, MAX_BYTES, type ProxyDeps, type Upstream } from '../../api/storybook/index';

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

const PUBLIC = { address: '76.76.21.21', family: 4 };
const INDEX = { v: 5, entries: { 'forms-button--primary': { type: 'story', id: 'forms-button--primary', title: 'Forms/Button', name: 'Primary', importPath: './Button.stories.tsx' } } };
const JSON_H = { 'content-type': 'application/json' };

function fake(routes: Record<string, Reply>, dns: Record<string, { address: string; family: number }[]> = {}) {
  const calls: { method: string; url: string; address: string }[] = [];
  const deps: ProxyDeps = {
    lookup: async (host) => dns[host] ?? [PUBLIC],
    request: async (url, addr, method) => {
      calls.push({ method, url: url.toString(), address: addr.address });
      const r = routes[`${method} ${url.toString()}`] ?? routes[url.toString()] ?? { status: 404, body: 'Not found' };
      const body = r.body ?? '';
      const res: Upstream = {
        status: r.status ?? 200,
        headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
        discard: () => undefined,
        body: async (max) => {
          if (Buffer.byteLength(body) > max) throw new Error('too-large');
          return body;
        },
      };
      return res;
    },
  };
  return { deps, calls };
}

const get = (deps: ProxyDeps, url: string) => handleStorybookRequest(new Request(`https://bridge.example.com/api/storybook?url=${encodeURIComponent(url)}`), deps);

describe('addresses', () => {
  it('refuses private, loopback, link-local and mapped forms', () => {
    for (const a of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.15', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::10.0.0.1', 'not-an-ip']) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    for (const a of ['76.76.21.21', '185.199.108.153', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) expect(isPublicAddress(a), a).toBe(true);
  });

  it('accepts https DNS names only and keeps the base path', () => {
    const ok = (u: string) => {
      const c = checkStorybookUrl(u);
      return c.ok ? c.url.toString() : c.reason;
    };
    expect(ok('https://primer.style/react/storybook/?path=/story/x')).toBe('https://primer.style/react/storybook/');
    expect(ok('https://sb.example.com/iframe.html?id=a--b')).toBe('https://sb.example.com/');
    expect(ok('http://sb.example.com')).toBe('invalid-url');
    expect(ok('https://127.0.0.1')).toBe('blocked');
    expect(ok('https://2130706433')).toBe('blocked');
    expect(ok('https://[::1]')).toBe('blocked');
    expect(ok('https://localhost')).toBe('blocked');
    expect(ok('https://storybook.internal')).toBe('blocked');
    expect(ok('https://sb.example.com:8443')).toBe('blocked');
    expect(ok('https://u:p@sb.example.com')).toBe('invalid-url');
    expect(ok('file:///etc/passwd')).toBe('invalid-url');
  });
});

describe('GET /api/storybook', () => {
  it('reads index.json, reports the frame verdict, caches 5 minutes, connects to the vetted address', async () => {
    const { deps, calls } = fake({
      'https://sb.example.com/index.json': { headers: JSON_H, body: JSON.stringify(INDEX) },
      'HEAD https://sb.example.com/iframe.html': { headers: { 'content-security-policy': 'frame-ancestors *' } },
    });
    const res = await get(deps, 'https://sb.example.com/');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=300');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const body = await res.json();
    expect(body).toMatchObject({ base: 'https://sb.example.com', source: 'index.json', frame: 'allowed' });
    expect(body.index.entries['forms-button--primary'].title).toBe('Forms/Button');
    expect(calls.every((c) => c.address === PUBLIC.address)).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['https://sb.example.com/index.json', 'https://sb.example.com/iframe.html']);
  });

  it('falls back to stories.json past a 404 or an HTML fallback page', async () => {
    const v3 = { v: 3, stories: { 'a--b': { id: 'a--b', kind: 'A', story: 'B' } } };
    const { deps } = fake({
      'https://sb.example.com/index.json': { headers: { 'content-type': 'text/html' }, body: '<!doctype html>' },
      'https://sb.example.com/stories.json': { headers: JSON_H, body: JSON.stringify(v3) },
    });
    const body = await (await get(deps, 'https://sb.example.com')).json();
    expect(body.source).toBe('stories.json');
    expect(body.frame).toBe('unknown');
  });

  it('refuses names that resolve to a private address, before any request', async () => {
    const { deps, calls } = fake({}, { 'evil.example.com': [PUBLIC, { address: '10.0.0.5', family: 4 }] });
    const res = await get(deps, 'https://evil.example.com');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('blocked');
    expect(calls).toEqual([]);
  });

  it('follows a redirect to another public host and previews from there', async () => {
    const { deps } = fake({
      'https://old.example.com/index.json': { status: 301, headers: { location: 'https://new.example.com/react/index.json' } },
      'https://new.example.com/react/index.json': { headers: JSON_H, body: JSON.stringify(INDEX) },
    });
    const body = await (await get(deps, 'https://old.example.com')).json();
    expect(body.base).toBe('https://new.example.com/react');
  });

  it('refuses redirects to private hosts, to http, to other files, and past three hops', async () => {
    const toPrivate = fake({ 'https://sb.example.com/index.json': { status: 302, headers: { location: 'https://metadata.example.com/index.json' } } }, { 'metadata.example.com': [{ address: '169.254.169.254', family: 4 }] });
    expect((await (await get(toPrivate.deps, 'https://sb.example.com')).json()).error).toBe('blocked');
    const toHttp = fake({ 'https://sb.example.com/index.json': { status: 302, headers: { location: 'http://sb.example.com/index.json' } } });
    expect((await get(toHttp.deps, 'https://sb.example.com')).status).toBe(400);
    const toLogin = fake({ 'https://sb.example.com/index.json': { status: 302, headers: { location: 'https://sso.example.com/login' } } });
    expect((await get(toLogin.deps, 'https://sb.example.com')).status).toBe(404);
    const loop = fake({ 'https://sb.example.com/index.json': { status: 302, headers: { location: 'https://sb.example.com/index.json' } } });
    const res = await get(loop.deps, 'https://sb.example.com');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('redirects');
    expect(loop.calls.length).toBe(4);
  });

  it('caps the body at 5 MB', async () => {
    const big = fake({ 'https://sb.example.com/index.json': { headers: { ...JSON_H, 'content-length': String(MAX_BYTES + 1) } } });
    expect((await get(big.deps, 'https://sb.example.com')).status).toBe(413);
    const chunked = fake({ 'https://sb.example.com/index.json': { headers: JSON_H, body: `{"v":5,"entries":{},"pad":"${'x'.repeat(MAX_BYTES)}"}` } });
    expect((await get(chunked.deps, 'https://sb.example.com')).status).toBe(413);
  });

  it('says private for a sign-in wall and not found when nothing is there', async () => {
    const login = JSON.stringify({ loginUrl: 'https://www.chromatic.com/custom-domain-verify' });
    const priv = fake({ 'https://sb.example.com/index.json': { headers: JSON_H, body: login }, 'https://sb.example.com/stories.json': { headers: JSON_H, body: login } });
    const res = await get(priv.deps, 'https://sb.example.com');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('private');
    const none = fake({});
    expect((await (await get(none.deps, 'https://sb.example.com')).json()).error).toBe('not-found');
  });

  it('answers 400 without a url and 405 for other methods', async () => {
    const { deps } = fake({});
    expect((await handleStorybookRequest(new Request('https://bridge.example.com/api/storybook'), deps)).status).toBe(400);
    expect((await handleStorybookRequest(new Request('https://bridge.example.com/api/storybook?url=x', { method: 'POST' }), deps)).status).toBe(405);
  });
});

describe('frame probe', () => {
  it('follows a pretty-URL redirect of iframe.html and reads its headers', async () => {
    const { deps } = fake({
      'https://sb.example.com/index.json': { headers: JSON_H, body: JSON.stringify(INDEX) },
      'HEAD https://sb.example.com/iframe.html': { status: 308, headers: { location: '/iframe', 'content-security-policy': "frame-ancestors 'self'" } },
      'HEAD https://sb.example.com/iframe': { headers: { 'content-security-policy': "frame-ancestors 'self' https://docs.example.com" } },
    });
    expect((await (await get(deps, 'https://sb.example.com')).json()).frame).toBe('blocked');
  });
});

describe('frameVerdict', () => {
  it('reads X-Frame-Options and CSP frame-ancestors', () => {
    expect(frameVerdict({})).toBe('allowed');
    expect(frameVerdict({ 'content-security-policy': 'frame-ancestors *' })).toBe('allowed');
    expect(frameVerdict({ 'x-frame-options': 'SAMEORIGIN' })).toBe('blocked');
    expect(frameVerdict({ 'x-frame-options': 'DENY' })).toBe('blocked');
    expect(frameVerdict({ 'content-security-policy': "frame-ancestors 'self' https://docs.twenty.com; object-src 'none'" })).toBe('blocked');
    expect(frameVerdict({ 'content-security-policy': "default-src 'self'" })).toBe('allowed');
  });
});
