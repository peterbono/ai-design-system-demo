// The audit scenarios of `npm run dev:scenario` (dev/scenarios.ts) on the real functions: each one is written to an
// in-memory Redis, then every person it names signs in and /api/entry answers the kind the scenario promises, with
// the roles it promises. The edge cases each scenario is for (a closed team, a GitHub-only invite, admin requests,
// the last admin, sign-in codes) are checked through the functions too. Plus the fixture GitHub (dev/local-github.ts)
// and the team and Library address rewrites of local mode (dev/local-api.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COOKIE, getAccount, putAccount, signAccountSession } from '../../api/_lib/account';
import type { EmailMessage } from '../../api/_lib/email';
import type { FetchLike } from '../../api/_lib/http';
import { localAdminStore } from '../../api/_lib/local-admin';
import { memoryRedis } from '../../api/_lib/redis';
import { handleAccount, LAST_ADMIN } from '../../api/account/index';
import { handleContribute } from '../../api/contribute/index';
import { handleEntry } from '../../api/entry/index';
import { studioReserved, teamRewrite } from '../../dev/local-api';
import { FIXTURE_TOKEN, fixtureApp, fixtureGithub, type FixtureFiles, putFixture, READ_ONLY } from '../../dev/local-github';
import { findScenario, SCENARIOS, type Scenario } from '../../dev/scenarios';

const ORIGIN = 'http://localhost:4321';
const SECRET = 's'.repeat(48);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };

/** A tiny source repository for the fixture GitHub: a config and one token file. */
function files(): FixtureFiles {
  const body: Record<string, Buffer> = {
    ['c'.repeat(40)]: Buffer.from(JSON.stringify({ name: 'Source DS', repo: { owner: 'peterbono', name: 'src' }, tokens: { root: 'tokens' } })),
    ['d'.repeat(40)]: Buffer.from('{"color":{}}'),
  };
  return {
    commit: 'a'.repeat(40),
    files: [
      { path: 'bridge.config.json', sha: 'c'.repeat(40), size: body['c'.repeat(40)]!.length },
      { path: 'tokens/color.tokens.json', sha: 'd'.repeat(40), size: body['d'.repeat(40)]!.length },
    ],
    read: (sha) => body[sha] ?? null,
  };
}

const offline: FetchLike = async () => {
  throw new Error('no network in tests');
};

function world(s: Scenario) {
  let now = Date.parse('2026-10-23T10:00:00Z');
  const redis = memoryRedis(() => now);
  const sent: EmailMessage[] = [];
  const outbox = { send: async (m: EmailMessage) => void sent.push(m) };
  const localAdmins = localAdminStore(redis);
  const fetch = fixtureGithub(redis, files, offline, () => now);
  const app = fixtureApp(redis);
  const deps = () => ({ fetch, redis, localAdmins, app, email: outbox, now: () => now });
  const cookieFor = async (email: string, name: string) => {
    let a = await getAccount(redis, email);
    if (!a) {
      a = { id: `id-${email}`, email, name, github: null, createdAt: new Date(now).toISOString(), version: 1 };
      await putAccount(redis, a);
    }
    return `${ACCOUNT_COOKIE}=${signAccountSession({ email: a.email, v: a.version, exp: now + 3_600_000 }, SECRET)}`;
  };
  const headers = (cookie: string) => ({ Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Bridge-Contribute': '1', 'X-Bridge-Account': '1' });
  const entry = async (cookie: string, query = '') => {
    const r = await handleEntry(new Request(`${ORIGIN}/api/entry${query}`, { headers: { Cookie: cookie } }), ENV, deps());
    return { status: r.status, body: (await r.json()) as any };
  };
  const post = async (cookie: string, body: unknown) => {
    const r = await handleEntry(new Request(`${ORIGIN}/api/entry`, { method: 'POST', headers: headers(cookie), body: JSON.stringify(body) }), ENV, deps());
    return { status: r.status, body: (await r.json()) as any };
  };
  const account = async (body: unknown, cookie = '') => {
    const r = await handleAccount(new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { ...headers(cookie), 'X-Forwarded-For': '198.51.100.1' }, body: JSON.stringify(body) }), ENV, { ...deps(), code: () => '999999' });
    return { status: r.status, body: (await r.json()) as any };
  };
  const seed = () => s.run({ redis, now, outbox, origin: ORIGIN, secret: SECRET });
  return { redis, sent, seed, cookieFor, entry, post, account, deps, advance: (ms: number) => (now += ms) };
}

beforeEach(() => {
  vi.stubEnv('BRIDGE_LOCAL', '1');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => vi.unstubAllEnvs());

describe('every scenario', () => {
  it('lists S0 to S16, each found by id, number or slug', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(Array.from({ length: 17 }, (_, i) => `S${i}`));
    for (const s of SCENARIOS) {
      expect(findScenario(s.id)).toBe(s);
      expect(findScenario(s.id.toLowerCase())).toBe(s);
      expect(findScenario(s.id.slice(1))).toBe(s);
      expect(findScenario(s.slug)).toBe(s);
    }
    expect(findScenario('nope')).toBeNull();
  });

  for (const s of SCENARIOS) {
    it(`${s.id} ${s.slug}: each sign-in gets the promised /api/entry kind and roles`, async () => {
      const w = world(s);
      const r = await w.seed();
      expect(r.signIns.length).toBeGreaterThan(0);
      for (const p of r.signIns) {
        const { status, body } = await w.entry(await w.cookieFor(p.email, p.name));
        expect(status, p.email).toBe(200);
        expect(body.kind, p.email).toBe(p.kind);
        if (p.teams) expect(Object.fromEntries(body.teams.map((t: any) => [t.repo, t.role])), p.email).toEqual(p.teams);
      }
      // No em dash in anything the auditor reads.
      expect(JSON.stringify(r)).not.toContain(String.fromCharCode(0x2014));
    });
  }
});

describe('what each scenario is for', () => {
  it('S3: one team on the domain, named with its admin and its size; asking to join notifies the admin', async () => {
    const w = world(findScenario('S3')!);
    await w.seed();
    const taylor = await w.cookieFor('taylor@acme.com', 'Taylor Brooks');
    const { body } = await w.entry(taylor);
    expect(body.teams).toEqual([expect.objectContaining({ name: expect.stringMatching(/^Acme product$/i), adminName: 'Sam Rivera', memberCount: 3, requested: false })]);
    expect(body.teams[0].repo).toBeUndefined();
    expect((await w.post(taylor, { action: 'request', team: body.teams[0].id })).status).toBe(200);
    expect(w.sent.some((m) => m.to === 'sam@acme.com' && m.subject.includes('asked to join'))).toBe(true);
  });

  it('S4: five teams, largest first; another domain sees none of them', async () => {
    const w = world(findScenario('S4')!);
    await w.seed();
    const { body } = await w.entry(await w.cookieFor('nora@lumen.studio', 'Nora Lind'));
    expect(body.teams.map((t: any) => t.memberCount)).toEqual([6, 4, 3, 2, 1]);
    expect(body.teams.every((t: any) => t.repo === undefined && /^t[a-f0-9]{20}$/.test(t.id))).toBe(true);
  });

  it('S5: a closed team answers like one that does not exist', async () => {
    const w = world(findScenario('S5')!);
    await w.seed();
    const r = await w.post(await w.cookieFor('taylor@acme.com', 'Taylor Brooks'), { action: 'request', repo: 'acme/acme-product' });
    expect(r.status).toBe(404);
  });

  it('S6 and S7: the invite email is in the outbox; the expired one is never offered', async () => {
    const w6 = world(findScenario('S6')!);
    const r6 = await w6.seed();
    expect(w6.sent.find((m) => m.to === 'mia@acme.com')?.text).toContain(r6.links[0]!.url);
    const w7 = world(findScenario('S7')!);
    await w7.seed();
    expect((await w7.entry(await w7.cookieFor('mia@acme.com', 'Mia Rossi'))).body.kind).toBe('create');
  });

  it('S9: reviewer and admin invites need GitHub', async () => {
    const w = world(findScenario('S9')!);
    await w.seed();
    const noah = await w.cookieFor('noah@acme.com', 'Noah Kim');
    const inv = (await w.entry(noah)).body.invites[0];
    expect(inv.role).toBe('reviewer');
    const r = await w.post(noah, { action: 'accept-invite', repo: inv.repo, id: inv.id });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('github-required');
  });

  it('S12: each seeded admin sees their own requests (4, 1, 0) and decides them without GitHub; a member cannot', async () => {
    const w = world(findScenario('S12')!);
    await w.seed();
    const sam = await w.cookieFor('sam@acme.com', 'Sam Rivera');
    const olivia = await w.cookieFor('olivia@acme.com', 'Olivia Grant');
    const marcus = await w.cookieFor('marcus@acme.com', 'Marcus Hale');
    expect((await w.entry(sam, '?requests=acme/acme-product')).body.requests).toHaveLength(4);
    const one = (await w.entry(olivia, '?requests=acme/acme-mobile')).body.requests;
    expect(one).toHaveLength(1);
    expect((await w.entry(marcus, '?requests=acme/acme-web')).body.requests).toHaveLength(0);
    expect((await w.entry(marcus, '?discovery=acme/acme-web')).body).toMatchObject({ domain: 'acme.com', enabled: true });
    // An admin of one team is not admin of another.
    expect((await w.entry(sam, '?requests=acme/acme-mobile')).status).toBe(403);
    const ok = await w.post(olivia, { action: 'approve', repo: 'acme/acme-mobile', id: one[0].id });
    expect(ok.body).toEqual({ member: { name: 'Hugo Laurent', role: 'edit' }, repo: 'acme/acme-mobile' });
    expect(w.sent.some((m) => m.to === 'hugo@acme.com' && m.text.includes('Olivia Grant approved'))).toBe(true);
    const off = await w.post(marcus, { action: 'discovery', repo: 'acme/acme-web', enabled: false });
    expect(off.body).toEqual({ domain: 'acme.com', enabled: false });
    expect((await w.entry(await w.cookieFor('priya@acme.com', 'Priya Shah'), '?requests=acme/acme-product')).status).toBe(403);
  });

  it('S12: the team proxy reads the fixture files and says the seeded admin is admin', async () => {
    const w = world(findScenario('S12')!);
    await w.seed();
    const sam = await w.cookieFor('sam@acme.com', 'Sam Rivera');
    const get = async (q: string) => (await handleContribute(new Request(`${ORIGIN}/api/contribute${q}`, { headers: { Cookie: sam } }), ENV, w.deps())).json() as Promise<any>;
    expect((await get('?repo=acme/acme-product')).member).toEqual({ email: 'sam@acme.com', name: 'Sam Rivera', role: 'admin' });
    const conf = await get(`?repo=acme/acme-product&gh=${encodeURIComponent('/repos/acme/acme-product/contents/bridge.config.json')}`);
    expect(JSON.parse(Buffer.from(conf.content, 'base64').toString('utf8'))).toMatchObject({ name: 'Acme Product', repo: { owner: 'acme', name: 'acme-product' } });
    const people = await get('?repo=acme/acme-product&members=1');
    expect(people.members).toEqual(expect.arrayContaining([{ name: 'Sam Rivera', role: 'admin', you: true }, { name: 'Priya Shah', role: 'edit' }]));
  });

  it('S13: the own request can be cancelled, and the short one lapses after 3 minutes', async () => {
    const w = world(findScenario('S13')!);
    await w.seed();
    const taylor = await w.cookieFor('taylor@acme.com', 'Taylor Brooks');
    const requested = async () => Object.fromEntries((await w.entry(taylor)).body.teams.map((t: any) => [t.name.toLowerCase(), t.requested ? 'pending' : t.expired ? 'expired' : 'none']));
    expect(await requested()).toEqual({ 'acme product': 'pending', 'acme mobile': 'pending' });
    expect((await w.post(taylor, { action: 'cancel-request', repo: 'acme/acme-product' })).body).toEqual({ cancelled: true });
    w.advance(3 * 60_000 + 1000);
    // Cancelled: as if never asked. Lapsed: "Your request expired, ask again".
    expect(await requested()).toEqual({ 'acme product': 'none', 'acme mobile': 'expired' });
  });

  it('S14: joining with the invite removes the pending request', async () => {
    const w = world(findScenario('S14')!);
    await w.seed();
    const taylor = await w.cookieFor('taylor@acme.com', 'Taylor Brooks');
    const inv = (await w.entry(taylor)).body.invites[0];
    expect((await w.post(taylor, { action: 'accept-invite', repo: inv.repo, id: inv.id })).body).toMatchObject({ joined: true, role: 'edit' });
    expect((await w.entry(await w.cookieFor('sam@acme.com', 'Sam Rivera'), '?requests=acme/acme-product')).body.requests).toEqual([]);
  });

  it('S15: the last admin of a team with members cannot delete; an admin alone can', async () => {
    const w = world(findScenario('S15')!);
    await w.seed();
    const blocked = await w.account({ action: 'delete' }, await w.cookieFor('sam@acme.com', 'Sam Rivera'));
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: 'last-admin', message: LAST_ADMIN, teams: ['acme/acme-product'] });
    const done = await w.account({ action: 'delete' }, await w.cookieFor('riley@acme.com', 'Riley Chen'));
    expect(done.status).toBe(200);
    expect(await localAdminStore(w.redis).teamsOf('riley@acme.com')).toEqual([]);
    expect((await w.entry(await w.cookieFor('riley@acme.com', 'Riley Chen'))).body.kind).toBe('create');
  });

  it('S16: live code, burned after 5 wrong tries, expired after 60 s, and the daily limit', async () => {
    const w = world(findScenario('S16')!);
    await w.seed();
    expect((await w.account({ action: 'code', email: 'limit@lumen.studio' })).status).toBe(429);
    for (let i = 0; i < 4; i++) expect((await w.account({ action: 'verify', email: 'casey@lumen.studio', code: '000000' })).status).toBe(400);
    expect((await w.account({ action: 'verify', email: 'casey@lumen.studio', code: '000000' })).status).toBe(410);
    expect((await w.account({ action: 'verify', email: 'casey@lumen.studio', code: '111111' })).status).toBe(410);
    w.advance(61_000);
    expect((await w.account({ action: 'verify', email: 'late@lumen.studio', code: '222222' })).status).toBe(410);
  });

  it('S16: the seeded code signs in when typed right', async () => {
    const w = world(findScenario('S16')!);
    await w.seed();
    const r = await w.account({ action: 'verify', email: 'casey@lumen.studio', code: '111111' });
    expect(r.status).toBe(200);
    expect(r.body.next).toBe('/studio/lumen/mobile-kit/');
  });
});

describe('fixture GitHub (dev/local-github.ts)', () => {
  const setup = async () => {
    const redis = memoryRedis();
    await putFixture(redis, { repo: 'acme/acme-product', name: 'Acme Product' });
    const passed: string[] = [];
    const f = fixtureGithub(redis, files, async (url) => {
      passed.push(url);
      return new Response('{}', { status: 200 });
    });
    const get = async (path: string, accept = 'application/vnd.github+json') => f(`https://api.github.com${path}`, { method: 'GET', headers: { Accept: accept } });
    return { redis, f, get, passed };
  };

  it('answers a fixture repository read-only, with its own name in bridge.config.json', async () => {
    const { get, f } = await setup();
    expect(await (await get('/repos/acme/acme-product')).json()).toMatchObject({ full_name: 'acme/acme-product', private: true, default_branch: 'main' });
    const tree = (await (await get('/repos/acme/acme-product/git/trees/main?recursive=1')).json()) as any;
    const conf = tree.tree.find((t: any) => t.path === 'bridge.config.json');
    expect(conf.sha).not.toBe('c'.repeat(40));
    const blob = await get(`/repos/acme/acme-product/git/blobs/${conf.sha}`, 'application/vnd.github.raw');
    expect(JSON.parse(await blob.text())).toMatchObject({ name: 'Acme Product', repo: { owner: 'acme', name: 'acme-product', defaultBranch: 'main' }, tokens: { root: 'tokens' } });
    const dir = (await (await get('/repos/acme/acme-product/contents/tokens?ref=main')).json()) as any[];
    expect(dir.map((d) => d.path)).toEqual(['tokens/color.tokens.json']);
    expect(await (await get('/repos/acme/acme-product/pulls?state=open&per_page=100')).json()).toEqual([]);
    expect((await get('/repos/acme/acme-product/contents/missing.json')).status).toBe(404);
    const write = await f('https://api.github.com/repos/acme/acme-product/git/refs', { method: 'POST', headers: {}, body: '{}' });
    expect(write.status).toBe(403);
    expect(((await write.json()) as any).message).toBe(READ_ONLY);
  });

  it('passes every other call to the real fetch, and gives the app token for fixtures only', async () => {
    const { get, passed, redis } = await setup();
    await get('/repos/peterbono/bridge-demo-ds');
    await get('/user');
    expect(passed).toEqual(['https://api.github.com/repos/peterbono/bridge-demo-ds', 'https://api.github.com/user']);
    const app = fixtureApp(redis);
    expect(await app.installationToken('acme', 'acme-product')).toBe(FIXTURE_TOKEN);
    expect(await app.installationToken('peterbono', 'bridge-demo-ds')).toBeNull();
  });
});

describe('team and Library addresses in local mode (dev/local-api.ts)', () => {
  const reserved = new Set(['auth', 'settings', 'changes', 'components', 'brands', 'invite', 'workspace']);

  it('serves a team address from its shell, like the vercel.json rewrites', () => {
    expect(teamRewrite('/studio/acme/acme-product/', reserved)).toBe('/team-shell/');
    expect(teamRewrite('/studio/acme/acme-product/settings/?tab=members', reserved)).toBe('/team-shell/settings/?tab=members');
    expect(teamRewrite('/studio/~/settings/ds/changes/', reserved)).toBe('/team-shell/changes/');
    expect(teamRewrite('/library/acme/acme-product/', reserved)).toBe('/library-shell/');
    expect(teamRewrite('/library/acme/acme-product/components/button/', reserved)).toBe('/library-shell/components/item/');
    expect(teamRewrite('/library/acme/acme-product/tokens/', reserved)).toBe('/library-shell/tokens/');
  });

  it('leaves real Studio pages and every other path alone', () => {
    for (const p of ['/studio/', '/studio/settings/', '/studio/auth/callback/', '/studio/components/storybook/', '/library/', '/start/', '/api/entry', '/studio/acme/'])
      expect(teamRewrite(p, reserved), p).toBeNull();
  });

  it('reads the reserved names from the Studio pages folder', () => {
    const names = studioReserved(new URL('../pages/studio', import.meta.url).pathname);
    for (const n of ['auth', 'settings', 'components', 'invite', 'workspace']) expect(names.has(n), n).toBe(true);
  });
});
