// The local admin override (api/_lib/local-admin.ts) can never grant admin outside `npm run dev:full`: the production
// path (no `localAdmins` dependency, the Vercel exports) ignores seeded admins entirely, and an injected one is
// ignored unless the process runs local mode (BRIDGE_LOCAL=1, no VERCEL, NODE_ENV not production).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COOKIE, type Account, putAccount, signAccountSession } from '../../api/_lib/account';
import { activeLocalAdmins, localAdminStore, localAdminsOn } from '../../api/_lib/local-admin';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { putRequest } from '../../api/_lib/teams';
import { handleAccount } from '../../api/account/index';
import { handleContribute } from '../../api/contribute/index';
import { ADMIN_ONLY, handleEntry } from '../../api/entry/index';
import { localDevHost, parseMember } from './contribute';

const ORIGIN = 'https://bridge.example.com';
const SECRET = 's'.repeat(48);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const REPO = 'acme/acme-product';
const NOW = Date.now();

afterEach(() => vi.unstubAllEnvs());

async function world() {
  const redis = memoryRedis(() => NOW);
  const sam: Account = { id: 'sam', email: 'sam@acme.com', name: 'Sam Rivera', github: null, createdAt: new Date(NOW).toISOString(), version: 1 };
  await putAccount(redis, sam);
  await memberStore(redis).put(REPO, { email: sam.email, name: sam.name, role: 'edit', version: 1, addedBy: 'x', at: new Date(NOW).toISOString() });
  await memberStore(redis).put(REPO, { email: 'priya@acme.com', name: 'Priya Shah', role: 'edit', version: 1, addedBy: 'x', at: new Date(NOW).toISOString() });
  await localAdminStore(redis).add(REPO, sam.email);
  await putRequest(redis, { id: 'a'.repeat(16), repo: REPO, email: 'jamie@acme.com', name: 'Jamie Lee', createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 86_400_000).toISOString() }, NOW);
  const cookie = `${ACCOUNT_COOKIE}=${signAccountSession({ email: sam.email, v: 1, exp: NOW + 3_600_000 }, SECRET)}`;
  const fetch = async () => new Response('{}', { status: 404 });
  return { redis, cookie, fetch, localAdmins: localAdminStore(redis) };
}

const local = () => {
  vi.stubEnv('BRIDGE_LOCAL', '1');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('NODE_ENV', 'development');
};

describe('localAdminsOn', () => {
  it('is on only with BRIDGE_LOCAL=1, off Vercel, outside production', () => {
    expect(localAdminsOn({ BRIDGE_LOCAL: '1' })).toBe(true);
    expect(localAdminsOn({ BRIDGE_LOCAL: '1', NODE_ENV: 'development' })).toBe(true);
    expect(localAdminsOn({})).toBe(false);
    expect(localAdminsOn({ BRIDGE_LOCAL: 'true' })).toBe(false);
    expect(localAdminsOn({ BRIDGE_LOCAL: '1', VERCEL: '1' })).toBe(false);
    expect(localAdminsOn({ BRIDGE_LOCAL: '1', NODE_ENV: 'production' })).toBe(false);
  });

  it('drops an injected store outside local mode', () => {
    const store = localAdminStore(memoryRedis());
    expect(activeLocalAdmins(store, { BRIDGE_LOCAL: '1' })).toBe(store);
    expect(activeLocalAdmins(undefined, { BRIDGE_LOCAL: '1' })).toBeNull();
    expect(activeLocalAdmins(store, { BRIDGE_LOCAL: '1', VERCEL: '1' })).toBeNull();
    expect(activeLocalAdmins(store, {})).toBeNull();
  });
});

describe('the admin check of /api/entry', () => {
  const requests = (w: Awaited<ReturnType<typeof world>>, withLocal: boolean) =>
    handleEntry(new Request(`${ORIGIN}/api/entry?requests=${REPO}`, { headers: { Cookie: w.cookie } }), ENV, { fetch: w.fetch, redis: w.redis, ...(withLocal ? { localAdmins: w.localAdmins } : {}) });

  it('production path unchanged: a seeded admin without GitHub is refused, even with BRIDGE_LOCAL=1 in the process', async () => {
    local();
    const w = await world();
    const r = await requests(w, false);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'forbidden', message: ADMIN_ONLY });
    const e = await (await handleEntry(new Request(`${ORIGIN}/api/entry`, { headers: { Cookie: w.cookie } }), ENV, { fetch: w.fetch, redis: w.redis })).json();
    expect(e).toMatchObject({ kind: 'teams', teams: [{ repo: REPO, role: 'edit' }] });
  });

  for (const [what, env] of [
    ['on Vercel', { BRIDGE_LOCAL: '1', VERCEL: '1', NODE_ENV: 'development' }],
    ['with NODE_ENV=production', { BRIDGE_LOCAL: '1', VERCEL: '', NODE_ENV: 'production' }],
    ['without BRIDGE_LOCAL', { BRIDGE_LOCAL: '', VERCEL: '', NODE_ENV: 'development' }],
  ] as const) {
    it(`ignores an injected local admin ${what}`, async () => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const w = await world();
      expect((await requests(w, true)).status).toBe(403);
    });
  }

  it('accepts the seeded admin in local mode, for their own team only', async () => {
    local();
    const w = await world();
    const r = await requests(w, true);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).requests).toHaveLength(1);
    const other = await handleEntry(new Request(`${ORIGIN}/api/entry?requests=acme/other`, { headers: { Cookie: w.cookie } }), ENV, { fetch: w.fetch, redis: w.redis, localAdmins: w.localAdmins });
    expect(other.status).toBe(403);
  });
});

describe('/api/account and /api/contribute without the local dependency', () => {
  it('a seeded admin is a plain member: no admin team, no last-admin block, role edit', async () => {
    local();
    const w = await world();
    const acc = (await (await handleAccount(new Request(`${ORIGIN}/api/account`, { headers: { Cookie: w.cookie } }), ENV, { fetch: w.fetch, redis: w.redis })).json()) as any;
    expect(acc.account.teams).toEqual([{ repo: REPO, name: 'Acme product', role: 'edit', via: 'email' }]);
    const info = (await (await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${REPO}`, { headers: { Cookie: w.cookie } }), ENV, { fetch: w.fetch, redis: w.redis, app: { installationToken: async () => 't' } })).json()) as any;
    expect(info.member.role).toBe('edit');
    const del = await handleAccount(
      new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { Cookie: w.cookie, Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Bridge-Account': '1' }, body: JSON.stringify({ action: 'delete' }) }),
      ENV,
      { fetch: w.fetch, redis: w.redis },
    );
    expect(del.status).toBe(200);
  });

  it('with it, in local mode, the same account is admin and the last-admin guard applies', async () => {
    local();
    const w = await world();
    const acc = (await (await handleAccount(new Request(`${ORIGIN}/api/account`, { headers: { Cookie: w.cookie } }), ENV, { fetch: w.fetch, redis: w.redis, localAdmins: w.localAdmins })).json()) as any;
    expect(acc.account.teams[0].role).toBe('admin');
    const del = await handleAccount(
      new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { Cookie: w.cookie, Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Bridge-Account': '1' }, body: JSON.stringify({ action: 'delete' }) }),
      ENV,
      { fetch: w.fetch, redis: w.redis, localAdmins: w.localAdmins },
    );
    expect(del.status).toBe(409);
  });
});

describe('the browser side', () => {
  it('reads a member as admin only on a local dev host, Can edit everywhere else', () => {
    const m = { email: 'sam@acme.com', name: 'Sam Rivera', role: 'admin' };
    expect(parseMember(m)).toMatchObject({ role: 'edit' });
    expect(parseMember(m, false)).toMatchObject({ role: 'edit' });
    expect(parseMember(m, true)).toMatchObject({ role: 'admin' });
    expect(localDevHost('localhost')).toBe(true);
    expect(localDevHost('127.0.0.1')).toBe(true);
    for (const h of ['bridge.example.com', 'localhost.evil.com', '', null]) expect(localDevHost(h), String(h)).toBe(false);
  });
});

describe('only local mode wires it', () => {
  const apiDir = new URL('../../api', import.meta.url).pathname;
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

  it('no Vercel function passes localAdmins or builds the store; only dev/local-api.ts does', () => {
    const entries: string[] = [];
    for (const file of walk(apiDir).filter((f) => f.endsWith('.ts') && !f.endsWith('local-admin.ts'))) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/localAdminStore/);
      // The Vercel entry points build their deps from fetch alone.
      for (const m of src.matchAll(/const handle = \(request: Request\) => (\w+)\(request, envFromProcess\(\), (\{[^}]*\})\)/g)) {
        expect(m[2], file).toBe('{ fetch: realFetch }');
        entries.push(m[1]!);
      }
    }
    expect(entries).toEqual(expect.arrayContaining(['handleAccount', 'handleContribute', 'handleEntry']));
    expect(readFileSync(new URL('../../dev/local-api.ts', import.meta.url), 'utf8')).toMatch(/localAdmins: localAdminStore\(redis\)/);
  });
});
