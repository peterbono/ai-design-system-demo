// /api/plugin-link (api/plugin-link/index.ts): "Sign in with Bridge" for the Figma plugin, with an in-memory Redis
// and a mocked GitHub. The code exchange: expiry, single use, wrong team.
import { describe, expect, it, vi } from 'vitest';
import { type FetchLike, CONNECT_PATH, LINK_TTL_S, LINK_WORDS, handleLink, linkKey } from '../../api/plugin-link/index';
import { memoryRedis } from '../../api/_lib/redis';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const TOKEN = 'ghu_' + 'a'.repeat(36);
const ENV = { LIBRARY_SESSION_SECRET: 'k'.repeat(48) };

function req(body: unknown, from: 'plugin' | 'studio' | 'other' = 'plugin'): Request {
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' };
  if (from === 'plugin') headers.origin = 'null';
  if (from === 'studio') Object.assign(headers, { origin: ORIGIN, 'sec-fetch-site': 'same-origin' });
  if (from === 'other') Object.assign(headers, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  return new Request(`${ORIGIN}/api/plugin-link`, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** GitHub: the token is "octo"; it can read acme/ds and nothing else. */
const github = vi.fn<FetchLike>(async (url) => {
  const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/user')) return ok({ login: 'octo' });
  if (url.endsWith('/repos/acme/ds')) return ok({ full_name: 'acme/ds', default_branch: 'main', permissions: { pull: true, push: true } });
  return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
});

function setup() {
  let t = 1_700_000_000_000;
  const redis = memoryRedis(() => t);
  let seed = 0;
  const random = (n: number) => Buffer.from(Array.from({ length: n }, () => (seed = (seed * 31 + 7) % 251)));
  const deps = { fetch: github, redis, now: () => t, random };
  const call = async (body: unknown, from?: 'plugin' | 'studio' | 'other') => {
    const res = await handleLink(req(body, from), ENV, deps);
    return { status: res.status, body: (await res.json()) as any, headers: res.headers };
  };
  return { redis, call, advance: (ms: number) => (t += ms) };
}

const approve = (code: string, repo = 'acme/ds') => ({ action: 'approve', code, repo, token: TOKEN, expires_in: 28800, name: 'Acme DS' });

describe('POST /api/plugin-link', () => {
  it('start, approve, poll: the plugin gets the repo and the token once, never the refresh token', async () => {
    const { call, redis } = setup();
    const start = await call({ action: 'start' });
    expect(start.status).toBe(200);
    expect(start.headers.get('access-control-allow-origin')).toBe('*');
    const { code, secret, url, expiresIn } = start.body;
    expect(code).toMatch(/^[A-Z2-7]{10}$/);
    expect(url).toBe(`${ORIGIN}${CONNECT_PATH}?code=${code}`);
    expect(url).not.toContain(secret);
    expect(expiresIn).toBe(LINK_TTL_S);
    // The code itself is never a key; the secret is never stored.
    expect(redis.keys()).toEqual([linkKey(code)]);
    expect(JSON.stringify([...redis.dump()])).not.toContain(secret);

    expect((await call({ action: 'poll', code, secret })).body).toEqual({ status: 'pending' });
    const ok = await call(approve(code), 'studio');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ approved: true, repo: 'acme/ds', login: 'octo' });

    const got = await call({ action: 'poll', code, secret });
    expect(got.body).toMatchObject({ status: 'approved', repo: 'acme/ds', name: 'Acme DS', token: TOKEN, login: 'octo', defaultBranch: 'main' });
    expect(got.body.expiresAt).toBeGreaterThan(0);
    expect(got.body).not.toHaveProperty('refresh_token');
    expect(redis.keys()).toEqual([]);
  });

  it('single use: a second poll and a second approve find nothing to take', async () => {
    const { call } = setup();
    const { code, secret } = (await call({ action: 'start' })).body;
    await call(approve(code), 'studio');
    expect((await call(approve(code), 'studio')).status).toBe(409);
    expect((await call({ action: 'poll', code, secret })).status).toBe(200);
    const again = await call({ action: 'poll', code, secret });
    expect(again.status).toBe(410);
    expect((await call(approve(code), 'studio')).status).toBe(410);
  });

  it('expiry: after 5 minutes the code is gone, for the Studio page and for the plugin', async () => {
    const { call, advance } = setup();
    const { code, secret } = (await call({ action: 'start' })).body;
    advance(LINK_TTL_S * 1000 + 1);
    const late = await call(approve(code), 'studio');
    expect(late.status).toBe(410);
    expect(late.body.message).toBe(LINK_WORDS.expired);
    expect((await call({ action: 'poll', code, secret })).status).toBe(410);
  });

  it('an approved token does not outlive the code', async () => {
    const { call, advance } = setup();
    const { code, secret } = (await call({ action: 'start' })).body;
    advance(60_000);
    await call(approve(code), 'studio');
    advance((LINK_TTL_S - 60) * 1000 + 1);
    expect((await call({ action: 'poll', code, secret })).status).toBe(410);
  });

  it('wrong team: a repository the GitHub sign-in cannot open is refused, and the code stays usable', async () => {
    const { call } = setup();
    const { code, secret } = (await call({ action: 'start' })).body;
    const wrong = await call(approve(code, 'other/ds'), 'studio');
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ error: 'wrong_team', message: LINK_WORDS.wrongTeam });
    expect((await call({ action: 'poll', code, secret })).body).toEqual({ status: 'pending' });
    expect((await call(approve(code), 'studio')).status).toBe(200);
  });

  it('only the Studio page approves, and only the plugin that started it can take the answer', async () => {
    const { call } = setup();
    const { code, secret } = (await call({ action: 'start' })).body;
    expect((await call(approve(code), 'plugin')).status).toBe(403);
    expect((await call(approve(code), 'other')).status).toBe(403);
    await call(approve(code), 'studio');
    const thief = await call({ action: 'poll', code, secret: 'x'.repeat(43) });
    expect(thief.status).toBe(403);
    expect((await call({ action: 'poll', code, secret })).body.status).toBe('approved');
  });

  it('keeps the token sealed while it waits, bound to its own link', async () => {
    const { call, redis } = setup();
    const a = (await call({ action: 'start' })).body;
    const b = (await call({ action: 'start' })).body;
    await call(approve(a.code), 'studio');
    // Nothing in storage holds the token in clear, nor any part of it.
    const stored = JSON.stringify([...redis.dump()]);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('a'.repeat(12));
    // Moved to another link (approved on paper), the sealed token does not open.
    const sealed = JSON.parse(String(await redis.cmd('GET', linkKey(a.code))));
    const other = JSON.parse(String(await redis.cmd('GET', linkKey(b.code))));
    await redis.cmd('SET', linkKey(b.code), JSON.stringify({ ...sealed, poll: other.poll }), 'EX', 60);
    expect((await call({ action: 'poll', code: b.code, secret: b.secret })).status).toBe(410);
    // The real one opens, once.
    expect((await call({ action: 'poll', code: a.code, secret: a.secret })).body.token).toBe(TOKEN);
  });

  it('without the session secret nothing is kept: it says Bridge is not set up', async () => {
    const res = await handleLink(req({ action: 'start' }), {}, { fetch: github, redis: memoryRedis(() => 0) });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).message).toBe(LINK_WORDS.notConfigured);
  });

  it('without storage it says so, in designer words', async () => {
    const res = await handleLink(req({ action: 'start' }), ENV, { fetch: github });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).message).toBe(LINK_WORDS.notConfigured);
  });
});
