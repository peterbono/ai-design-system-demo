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
import { handleAccount, lastAdminOf } from '../../api/account/index';
import { handleContribute } from '../../api/contribute/index';
import { handleEntry } from '../../api/entry/index';
import { devGithub, studioReserved, teamRewrite, withoutPersona } from '../../dev/local-api';
import { FIXTURE_TOKEN, fixtureApp, fixtureGithub, type FixtureFiles, putFixture, READ_ONLY } from '../../dev/local-github';
import { APP_LOGIN, clearLocalRepoMemory, personaToken } from '../../dev/local-repo';
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
  it('lists S0 to S21, each found by id, number or slug', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(Array.from({ length: 22 }, (_, i) => `S${i}`));
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

  it('S9: a reviewer invite needs GitHub; an admin invite joins with the email', async () => {
    const w = world(findScenario('S9')!);
    await w.seed();
    const noah = await w.cookieFor('noah@acme.com', 'Noah Kim');
    const inv = (await w.entry(noah)).body.invites[0];
    expect(inv.role).toBe('reviewer');
    const r = await w.post(noah, { action: 'accept-invite', repo: inv.repo, id: inv.id });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('github-required');
    const ava = await w.cookieFor('ava@acme.com', 'Ava Patel');
    const adm = (await w.entry(ava)).body.invites[0];
    expect((await w.post(ava, { action: 'accept-invite', repo: adm.repo, id: adm.id })).body).toMatchObject({ joined: true, role: 'admin' });
    expect((await w.entry(ava)).body).toMatchObject({ kind: 'teams', teams: [{ repo: 'acme/acme-product', role: 'admin' }] });
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
    expect(blocked.body).toMatchObject({ error: 'last-admin', message: lastAdminOf(['Acme Product']), teams: ['acme/acme-product'] });
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

describe('writable fixture GitHub (dev/local-repo.ts)', () => {
  const R = 'https://api.github.com/repos/acme/acme-flow';
  const setup = async () => {
    clearLocalRepoMemory();
    let now = Date.parse('2026-10-24T09:00:00Z');
    const redis = memoryRedis(() => now);
    await putFixture(redis, { repo: 'acme/acme-flow', name: 'Acme Flow', writable: true });
    const passed: string[] = [];
    const f = fixtureGithub(redis, files, async (url) => {
      passed.push(url);
      return new Response('{}', { status: 200 });
    }, () => (now += 1000));
    const call = async (who: string, method: string, path: string, body?: unknown, accept = 'application/vnd.github+json') => {
      const res = await f(path.startsWith('http') ? path : `${R}${path}`, { method, headers: { Accept: accept, Authorization: `Bearer ${who === 'app' ? FIXTURE_TOKEN : personaToken(who)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await res.text();
      let data: any = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* raw */
      }
      return { status: res.status, data };
    };
    /** What Studio does for Send for review: a blob, a tree on main, a commit, a branch, a pull request. */
    const send = async (who: string, branch: string, path: string, content: string, title = 'Change') => {
      const main = (await call(who, 'GET', '/git/ref/heads/main')).data.object.sha as string;
      const tree = (await call(who, 'GET', `/git/commits/${main}`)).data.tree.sha as string;
      const blob = (await call(who, 'POST', '/git/blobs', { content, encoding: 'utf-8' })).data.sha as string;
      const t = (await call(who, 'POST', '/git/trees', { base_tree: tree, tree: [{ path, mode: '100644', type: 'blob', sha: blob }] })).data.sha as string;
      const c = (await call(who, 'POST', '/git/commits', { message: title, tree: t, parents: [main] })).data.sha as string;
      expect((await call(who, 'POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: c })).status).toBe(201);
      const pr = await call(who, 'POST', '/pulls', { title, head: branch, base: 'main', body: 'Sent from Studio', draft: false });
      expect(pr.status).toBe(201);
      return { pr: pr.data, commit: c };
    };
    return { redis, f, call, send, passed };
  };

  it('keeps a branch and a pull request, with the governance owners as the local personas', async () => {
    const { call, send } = await setup();
    const tree = (await call('dana', 'GET', '/git/trees/main?recursive=1')).data;
    const conf = tree.tree.find((t: any) => t.path === 'bridge.config.json');
    const config = (await call('dana', 'GET', `/git/blobs/${conf.sha}`, undefined, 'application/vnd.github.raw')).data;
    expect(config.governance.owners).toEqual({ design: ['dana'], tech: ['malik'] });
    const { pr, commit } = await send('app', 'bridge/priya-color', 'tokens/color.tokens.json', '{"color":{"x":{}}}');
    expect(pr).toMatchObject({ number: 1, state: 'open', draft: false, user: { login: APP_LOGIN }, head: { ref: 'bridge/priya-color', sha: commit }, mergeable: true });
    const list = (await call('dana', 'GET', `/pulls?state=open&head=${encodeURIComponent('acme:bridge/priya-color')}`)).data;
    expect(list.map((p: any) => p.number)).toEqual([1]);
    const files = (await call('dana', 'GET', '/pulls/1/files?per_page=100')).data;
    expect(files).toMatchObject([{ filename: 'tokens/color.tokens.json', status: 'modified' }]);
    const onBranch = await call('dana', 'GET', '/contents/tokens/color.tokens.json?ref=bridge/priya-color', undefined, 'application/vnd.github.raw');
    expect(onBranch.data).toEqual({ color: { x: {} } });
    // main has not moved
    expect((await call('dana', 'GET', '/contents/tokens/color.tokens.json?ref=main', undefined, 'application/vnd.github.raw')).data).toEqual({ color: {} });
    expect((await call('dana', 'GET', '/compare/main...bridge/priya-color')).data).toMatchObject({ status: 'ahead', ahead_by: 1, behind_by: 0 });
  });

  it('request changes, then approve: the reviews GitHub keeps, never by the author', async () => {
    const { call, send } = await setup();
    await send('app', 'bridge/a', 'tokens/color.tokens.json', '{"a":1}');
    expect((await call('app', 'POST', '/pulls/1/reviews', { event: 'APPROVE', body: '' })).status).toBe(422);
    expect((await call('dana', 'POST', '/pulls/1/requested_reviewers', { reviewers: ['dana', 'malik'] })).status).toBe(201);
    expect((await call('dana', 'POST', '/pulls/1/reviews', { event: 'REQUEST_CHANGES', body: 'Use the brand blue.' })).data).toMatchObject({ state: 'CHANGES_REQUESTED', user: { login: 'dana' } });
    expect((await call('dana', 'GET', '/pulls/1')).data.requested_reviewers.map((u: any) => u.login)).toEqual(['malik']);
    // The member fixes it on the same branch (contents API), then Dana and Malik approve.
    const old = (await call('app', 'GET', '/contents/tokens/color.tokens.json?ref=bridge/a')).data.sha;
    expect((await call('app', 'PUT', '/contents/tokens/color.tokens.json', { message: 'Fix', content: Buffer.from('{"a":2}').toString('base64'), branch: 'bridge/a', sha: old })).status).toBe(200);
    await call('dana', 'POST', '/pulls/1/reviews', { event: 'APPROVE', body: '' });
    await call('malik', 'POST', '/pulls/1/reviews', { event: 'APPROVE', body: 'Ships.' });
    const reviews = (await call('dana', 'GET', '/pulls/1/reviews')).data;
    expect(reviews.map((r: any) => `${r.user.login}:${r.state}`)).toEqual(['dana:CHANGES_REQUESTED', 'dana:APPROVED', 'malik:APPROVED']);
    expect(reviews[2].commit_id).toBe((await call('dana', 'GET', '/pulls/1')).data.head.sha);
  });

  it('merge moves main, History lists it, and the pull request reads merged', async () => {
    const { call, send } = await setup();
    const { commit } = await send('app', 'bridge/m', 'tokens/color.tokens.json', '{"m":1}', 'Brand blue');
    const before = (await call('malik', 'GET', '/git/ref/heads/main')).data.object.sha;
    const merged = await call('malik', 'PUT', '/pulls/1/merge', { merge_method: 'merge', sha: commit });
    expect(merged.data).toMatchObject({ merged: true });
    const main = (await call('malik', 'GET', '/branches/main')).data.commit;
    expect(main.sha).toBe(merged.data.sha);
    expect(main.parents.map((p: any) => p.sha)).toEqual([before, commit]);
    expect((await call('malik', 'GET', '/contents/tokens/color.tokens.json?ref=main', undefined, 'application/vnd.github.raw')).data).toEqual({ m: 1 });
    expect((await call('malik', 'GET', '/pulls/1')).data).toMatchObject({ state: 'closed', merged: true, merged_by: { login: 'malik' }, merge_commit_sha: merged.data.sha });
    const history = (await call('malik', 'GET', '/commits?sha=main&path=tokens/color.tokens.json')).data;
    expect(history[0].sha).toBe(merged.data.sha);
    expect((await call('malik', 'GET', `/commits/${merged.data.sha}/pulls`)).data.map((p: any) => p.number)).toEqual([1]);
    expect((await call('malik', 'PUT', '/pulls/1/merge', {})).status).toBe(405);
  });

  it('draft and ready for review through GraphQL, issues with labels and comments', async () => {
    const { call, send } = await setup();
    await send('app', 'bridge/d', 'tokens/color.tokens.json', '{"d":1}');
    const node = (await call('app', 'GET', '/pulls/1')).data.node_id;
    const gql = (draft: boolean) => call('app', 'POST', 'https://api.github.com/graphql', { query: `mutation($id: ID!) { ${draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'}(input: { pullRequestId: $id }) { pullRequest { number isDraft } } }`, variables: { id: node } });
    await gql(true);
    expect((await call('app', 'GET', '/pulls/1')).data.draft).toBe(true);
    await gql(false);
    expect((await call('app', 'GET', '/pulls/1')).data.draft).toBe(false);
    const issue = await call('app', 'POST', '/issues', { title: 'Suggestion: brand blue', body: 'x', labels: ['bridge-suggestion'] });
    expect(issue.data).toMatchObject({ number: 2, labels: [{ name: 'bridge-suggestion' }] });
    await call('dana', 'POST', '/issues/2/comments', { body: 'Looks right.' });
    expect((await call('dana', 'GET', '/issues/2/comments')).data.map((c: any) => c.user.login)).toEqual(['dana']);
    const open = (await call('dana', 'GET', '/issues?state=open&labels=bridge-suggestion')).data;
    expect(open.map((i: any) => i.number)).toEqual([2]);
    expect((await call('dana', 'GET', 'https://api.github.com/user')).data).toMatchObject({ login: 'dana', name: 'Dana Whitfield' });
  });

  it('stays read-only for the other fixtures, passes real repositories on, and refuses writes outside local mode', async () => {
    const { f, call, passed, redis } = await setup();
    await putFixture(redis, { repo: 'acme/acme-product', name: 'Acme Product' });
    const ro = await f('https://api.github.com/repos/acme/acme-product/git/refs', { method: 'POST', headers: { Authorization: `Bearer ${personaToken('dana')}` }, body: '{}' });
    expect(ro.status).toBe(403);
    await f('https://api.github.com/repos/peterbono/bridge-demo-ds', { method: 'GET', headers: {} });
    expect(passed).toEqual(['https://api.github.com/repos/peterbono/bridge-demo-ds']);
    expect(withoutPersona({ Authorization: `Bearer ${personaToken('dana')}`, Accept: 'x' })).toEqual({ Accept: 'x' });
    vi.stubEnv('BRIDGE_LOCAL', '');
    expect((await call('dana', 'POST', '/git/blobs', { content: 'x' })).status).toBe(403);
    expect((await devGithub(new Request('http://localhost:4321/api/dev/github/user'), f)).status).toBe(403);
  });

  it('serves the browser through /api/dev/github with CORS, for a persona', async () => {
    const { f } = await setup();
    const res = await devGithub(new Request('http://localhost:4321/api/dev/github/repos/acme/acme-flow', { headers: { Authorization: `Bearer ${personaToken('dana')}` } }), f);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({ full_name: 'acme/acme-flow', permissions: { admin: true, push: true } });
  });
});

describe('team and Library addresses in local mode (dev/local-api.ts)', () => {
  const reserved = new Set(['auth', 'settings', 'changes', 'components', 'brands', 'invite', 'workspace']);

  it('serves a team address from its shell, like the vercel.json rewrites', () => {
    expect(teamRewrite('/studio/acme/acme-product/', reserved)).toBe('/team-shell/');
    expect(teamRewrite('/studio/acme/acme-product/products/admin-app/', reserved)).toBe('/team-shell/products/item/');
    expect(teamRewrite('/studio/~/acme/acme-product/products/library?x=1', reserved)).toBe('/team-shell/products/item/?x=1');
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
