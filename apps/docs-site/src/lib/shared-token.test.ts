// One read token per repository for every warm function (api/_lib/shared-token.ts): kept ETags stay valid whichever
// function revalidates them (docs/QUOTA-LOADTEST.md, C3). Sealed in Redis, minted by one function at a time.
import { describe, expect, it } from 'vitest';
import type { AppTokens } from '../../api/_lib/github-app';
import { memoryRedis } from '../../api/_lib/redis';
import { sharedAppTokens, TOKEN_MEMORY_MS, TOKEN_RENEW_MS, TOKEN_SHARE_MS } from '../../api/_lib/shared-token';

const SECRET = 's'.repeat(40);
const T0 = Date.parse('2026-11-02T09:00:00Z');

function setup(secret = SECRET) {
  let now = T0;
  const redis = memoryRedis(() => now);
  let mints = 0;
  const app: AppTokens = {
    installationToken: async (_owner, repo) => {
      if (repo === 'none') return null;
      // GitHub's token endpoint answers after a few turns: concurrent functions all miss first.
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      return `ghs_secret_${mints++}`;
    },
  };
  const fn = () => sharedAppTokens(app, { redis, secret, now: () => now, scope: '1:read', memory: new Map(), wait: () => new Promise((r) => setImmediate(r)) });
  return { redis, fn, mints: () => mints, tick: (ms: number) => (now += ms) };
}

describe('shared read token', () => {
  it('four functions asking at once get one token, minted once', async () => {
    const s = setup();
    const fns = [s.fn(), s.fn(), s.fn(), s.fn()];
    const got = await Promise.all(fns.flatMap((f) => [f.installationToken('acme', 'ds'), f.installationToken('acme', 'ds')]));
    expect(new Set(got)).toEqual(new Set(['ghs_secret_0']));
    expect(s.mints()).toBe(1);
    // Another repository (or another scope) has its own.
    expect(await fns[0]!.installationToken('acme', 'shop')).toBe('ghs_secret_1');
  });

  it('stores the token sealed, under a key that names neither the token nor the repository', async () => {
    const s = setup();
    await s.fn().installationToken('acme', 'ds');
    const all = JSON.stringify(s.redis.snapshot());
    expect(all).not.toContain('ghs_secret');
    expect(all).not.toContain('acme');
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:app:token:'))).toHaveLength(1);
  });

  it('renews near the end of its 50 minutes, and every function moves to the new token within a minute', async () => {
    const s = setup();
    const a = s.fn();
    const b = s.fn();
    expect(await a.installationToken('acme', 'ds')).toBe('ghs_secret_0');
    expect(await b.installationToken('acme', 'ds')).toBe('ghs_secret_0');
    s.tick(TOKEN_SHARE_MS - TOKEN_RENEW_MS + 1000);
    expect(await a.installationToken('acme', 'ds')).toBe('ghs_secret_1');
    s.tick(TOKEN_MEMORY_MS);
    expect(await b.installationToken('acme', 'ds')).toBe('ghs_secret_1');
    expect(s.mints()).toBe(2);
  });

  it('no app on the repository: null, nothing kept; no session secret: each function keeps its own', async () => {
    const s = setup();
    expect(await s.fn().installationToken('acme', 'none')).toBeNull();
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:app:token:') && !k.includes(':lock:'))).toHaveLength(0);
    const t = setup('');
    const f = t.fn();
    expect(await f.installationToken('acme', 'ds')).toBe('ghs_secret_0');
    expect(await f.installationToken('acme', 'ds')).toBe('ghs_secret_0');
    expect(t.redis.keys()).toHaveLength(0);
  });
});
