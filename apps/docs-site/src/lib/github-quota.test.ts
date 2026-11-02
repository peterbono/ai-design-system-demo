import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { githubApp } from '../../api/_lib/github-app';
import {
  clearInstallationTokens,
  installationOfToken,
  isLow,
  isSecondaryLimit,
  meteredFetch,
  noteInstallationToken,
  quotaKey,
  quotaMeter,
  quotaRepoKey,
  rateLimitOf,
  readUsage,
  secondaryAtKey,
  secondaryKey,
  THROTTLE_MS,
} from '../../api/_lib/github-quota';
import type { FetchLike } from '../../api/_lib/http';
import { memoryRedis, type Redis } from '../../api/_lib/redis';

const T0 = Date.parse('2026-11-02T13:10:00Z');
const RESET = Math.floor(Date.parse('2026-11-02T14:00:00Z') / 1000);

const limited = (o: { limit?: number; remaining: number; used?: number; reset?: number; resource?: string; status?: number; body?: string; extra?: Record<string, string> }) =>
  new Response(o.body ?? '{}', {
    status: o.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      'x-ratelimit-limit': String(o.limit ?? 5000),
      'x-ratelimit-remaining': String(o.remaining),
      'x-ratelimit-used': String(o.used ?? (o.limit ?? 5000) - o.remaining),
      'x-ratelimit-reset': String(o.reset ?? RESET),
      'x-ratelimit-resource': o.resource ?? 'core',
      ...(o.extra ?? {}),
    },
  });

/** A Redis that counts the commands it is sent. */
function counted(now: () => number) {
  const r = memoryRedis(now);
  const sent: unknown[][] = [];
  const redis: Redis = {
    cmd: (...a) => (sent.push(a), r.cmd(...a)),
    pipe: (cmds) => (sent.push(...cmds), r.pipe(cmds)),
  };
  return { redis, sent, raw: r };
}

beforeEach(() => clearInstallationTokens());

describe('reading the rate limit headers', () => {
  it('reads limit, remaining, used, reset and resource', () => {
    expect(rateLimitOf(limited({ remaining: 3760, resource: 'graphql' }).headers)).toEqual({ limit: 5000, remaining: 3760, used: 1240, reset: RESET, resource: 'graphql' });
  });

  it('falls back sensibly and refuses what is not a number', () => {
    const h = new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': String(RESET) });
    expect(rateLimitOf(h)).toEqual({ limit: 60, remaining: 50, used: 10, reset: RESET, resource: 'core' });
    expect(rateLimitOf(new Headers({ 'x-ratelimit-limit': 'lots', 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '1' }))).toBeNull();
    expect(rateLimitOf(new Headers())).toBeNull();
    expect(rateLimitOf(new Headers({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '1', 'x-ratelimit-resource': 'Weird Value!' }))?.resource).toBe('core');
  });

  it('is low under 20% of the limit left', () => {
    expect(isLow({ limit: 5000, remaining: 1000 })).toBe(false);
    expect(isLow({ limit: 5000, remaining: 999 })).toBe(true);
    expect(isLow({ limit: 5000, remaining: 0 })).toBe(true);
  });

  it('tells a secondary rate limit from the hourly one running out, and from a plain refusal', async () => {
    expect(await isSecondaryLimit(limited({ remaining: 4000, status: 403, extra: { 'retry-after': '60' } }))).toBe(true);
    expect(await isSecondaryLimit(limited({ remaining: 4000, status: 403, body: '{"message":"You have exceeded a secondary rate limit."}' }))).toBe(true);
    expect(await isSecondaryLimit(limited({ remaining: 4000, status: 429, extra: { 'retry-after': '30' } }))).toBe(true);
    expect(await isSecondaryLimit(limited({ remaining: 0, status: 403, extra: { 'retry-after': '60' } }))).toBe(false);
    expect(await isSecondaryLimit(limited({ remaining: 4000, status: 403, body: '{"message":"Resource not accessible by integration"}' }))).toBe(false);
    expect(await isSecondaryLimit(limited({ remaining: 4000 }))).toBe(false);
  });
});

describe('recording per installation', () => {
  const who = { installation: 42, repo: 'acme/design' };

  it('writes the numbers and the repository once, then not again within the throttle window', async () => {
    let t = T0;
    const { redis, sent, raw } = counted(() => t);
    const m = quotaMeter(redis, { now: () => t, log: { warn: () => {} } });
    await m.observe(who, limited({ remaining: 4000 }));
    expect(sent.map((c) => c[0])).toEqual(['SET', 'SET']);
    expect(JSON.parse(String(await raw.cmd('GET', quotaKey(42, 'core'))))).toMatchObject({ limit: 5000, remaining: 4000, used: 1000, reset: RESET });
    expect(await raw.cmd('GET', quotaRepoKey('Acme/Design'))).toBe('42');
    sent.length = 0;
    // Unchanged values: nothing. Changed within the window: nothing either.
    await m.observe(who, limited({ remaining: 4000 }));
    t += 1000;
    await m.observe(who, limited({ remaining: 3990 }));
    expect(sent).toEqual([]);
    // Past the window and changed: one write.
    t += THROTTLE_MS;
    await m.observe(who, limited({ remaining: 3980 }));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(await raw.cmd('GET', quotaKey(42, 'core')))).remaining).toBe(3980);
    sent.length = 0;
    // Past the window but unchanged: nothing.
    t += THROTTLE_MS;
    await m.observe(who, limited({ remaining: 3980 }));
    expect(sent).toEqual([]);
  });

  it('writes at once when the window resets or the installation turns low, and keeps resources apart', async () => {
    let t = T0;
    const { redis, sent } = counted(() => t);
    const m = quotaMeter(redis, { now: () => t, log: { warn: () => {} } });
    await m.observe(who, limited({ remaining: 4000 }));
    sent.length = 0;
    t += 1000;
    await m.observe(who, limited({ remaining: 4999, reset: RESET + 3600 }));
    expect(sent).toHaveLength(1);
    sent.length = 0;
    await m.observe(who, limited({ remaining: 900, reset: RESET + 3600 }));
    expect(sent.some((c) => c[0] === 'SET' && c[1] === quotaKey(42, 'core'))).toBe(true);
    sent.length = 0;
    await m.observe(who, limited({ remaining: 4900, resource: 'graphql' }));
    expect(sent.map((c) => c[1])).toEqual([quotaKey(42, 'graphql')]);
  });

  it('logs one structured warning per installation and reset window, with no token in it', async () => {
    let t = T0;
    const r = memoryRedis(() => t);
    const lines: string[] = [];
    const log = { warn: (l: string) => lines.push(l) };
    const a = quotaMeter(r, { now: () => t, log });
    const b = quotaMeter(r, { now: () => t, log }); // another warm function
    await a.observe(who, limited({ remaining: 999 }));
    t += THROTTLE_MS;
    await a.observe(who, limited({ remaining: 500 }));
    await b.observe(who, limited({ remaining: 400 }));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ event: 'github_quota_low', installation: 42, repo: 'acme/design', resource: 'core', limit: 5000, remaining: 999, used: 4001, resetAt: '2026-11-02T14:00:00.000Z' });
    // The next window warns again.
    t += 3600 * 1000;
    await a.observe(who, limited({ remaining: 100, reset: RESET + 3600 }));
    expect(lines).toHaveLength(2);
    // Above the threshold: never.
    await a.observe({ installation: 7, repo: 'other/ds' }, limited({ remaining: 1000 }));
    expect(lines).toHaveLength(2);
  });

  it('counts secondary rate limit hits with their time', async () => {
    let t = T0;
    const r = memoryRedis(() => t);
    const lines: string[] = [];
    const m = quotaMeter(r, { now: () => t, log: { warn: (l) => lines.push(l) } });
    await m.observe(who, limited({ remaining: 4000, status: 403, extra: { 'retry-after': '60' } }));
    t += 5000;
    await m.observe(who, limited({ remaining: 3999, status: 429, extra: { 'retry-after': '60' } }));
    expect(await r.cmd('GET', secondaryKey(42))).toBe('2');
    expect(await r.cmd('GET', secondaryAtKey(42))).toBe(String(t));
    expect(lines.filter((l) => l.includes('github_secondary_limit'))).toHaveLength(1);
  });

  it('never throws, even when storage is down', async () => {
    const broken: Redis = { cmd: async () => Promise.reject(new Error('down')), pipe: async () => Promise.reject(new Error('down')) };
    await expect(quotaMeter(broken).observe(who, limited({ remaining: 10 }))).resolves.toBeUndefined();
  });
});

describe('the fetch layer: installation tokens only', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

  it('meters the answers to calls made with a token the app minted, not a person token nor the app JWT', async () => {
    let t = T0;
    const r = memoryRedis(() => t);
    const github: FetchLike = async (url) => {
      const p = new URL(url).pathname;
      if (p === '/repos/acme/design/installation') return limited({ remaining: 4999, limit: 5000 });
      if (p === '/app/installations/77/access_tokens') return new Response(JSON.stringify({ token: 'ghs_installation_token_000', permissions: { contents: 'read' } }), { status: 201, headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4998', 'x-ratelimit-reset': String(RESET) } });
      return limited({ remaining: 3760 });
    };
    // The installation call answers its id.
    const withId: FetchLike = async (url, init) => {
      if (new URL(url).pathname === '/repos/acme/design/installation') return new Response(JSON.stringify({ id: 77 }), { status: 200 });
      return github(url, init);
    };
    const f = meteredFetch(withId, quotaMeter(r, { now: () => t, log: { warn: () => {} } }), () => t);
    const token = await githubApp('1', privateKey, f, () => t).installationToken('acme', 'design');
    expect(token).toBe('ghs_installation_token_000');
    expect(installationOfToken(token!, t)).toEqual({ installation: 77, repo: 'acme/design' });
    // Minting itself (the app JWT) is not counted against the installation.
    expect(await r.cmd('GET', quotaKey(77, 'core'))).toBeNull();
    await f('https://api.github.com/repos/acme/design/contents/x', { method: 'GET', headers: { Authorization: `Bearer ghu_a_person_token_0000` } });
    expect(await r.cmd('GET', quotaKey(77, 'core'))).toBeNull();
    await f('https://api.github.com/repos/acme/design/contents/x', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(JSON.parse(String(await r.cmd('GET', quotaKey(77, 'core')))).remaining).toBe(3760);
    // Not GitHub: never looked at.
    t += THROTTLE_MS;
    await f('https://example.com/x', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(JSON.parse(String(await r.cmd('GET', quotaKey(77, 'core')))).remaining).toBe(3760);
    // An hour later the token is gone from memory.
    t += 61 * 60 * 1000;
    expect(installationOfToken(token!, t)).toBeNull();
  });

  it('keeps no token: only a hash maps to the installation', () => {
    noteInstallationToken('ghs_secret_value_123', 5, 'acme/design', T0);
    expect(installationOfToken('ghs_secret_value_123', T0)).toEqual({ installation: 5, repo: 'acme/design' });
    expect(installationOfToken('ghs_other', T0)).toBeNull();
  });
});

describe('reading it back for Settings', () => {
  it('answers the core numbers, or the lowest budget when one is low, and nothing for an unknown team', async () => {
    const t = T0;
    const r = memoryRedis(() => t);
    expect(await readUsage(r, 'acme/design', t)).toEqual({ usage: null, slowedAt: null });
    const m = quotaMeter(r, { now: () => t, log: { warn: () => {} } });
    await m.observe({ installation: 42, repo: 'acme/design' }, limited({ remaining: 3760 }));
    expect(await readUsage(r, 'Acme/Design', t)).toEqual({ usage: { resource: 'core', limit: 5000, used: 1240, remaining: 3760, resetAt: RESET * 1000, low: false }, slowedAt: null });
    await m.observe({ installation: 42, repo: 'acme/design' }, limited({ remaining: 100, resource: 'graphql' }));
    expect((await readUsage(r, 'acme/design', t)).usage).toMatchObject({ resource: 'graphql', low: true, remaining: 100 });
    // Once the window reset, it is a fresh hour.
    expect((await readUsage(r, 'acme/design', RESET * 1000 + 1)).usage).toBeNull();
  });
});
