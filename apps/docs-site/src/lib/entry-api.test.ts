// The /api/entry Vercel function (api/entry/index.ts) with a mocked GitHub, an in-memory Redis and a fake email:
// the routing order, public domains, the admin opt-in, join requests from ask to approve, decline and expiry, invites
// accepted from the account, and the auth checks.
import { describe, expect, it } from 'vitest';
import { type Account, ACCOUNT_COOKIE, putAccount, signAccountSession } from '../../api/_lib/account';
import { isPublicDomain, workDomain } from '../../api/_lib/domains';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { JOIN_REQUEST_TTL_MS } from '../../api/_lib/teams';
import { handleAccount } from '../../api/account/index';
import { ADMIN_ONLY, type EntryDeps, handleEntry, NOT_OPEN, PUBLIC_DOMAIN, REQUEST_LIMITS } from '../../api/entry/index';
import { type EmailMessage, inviteStoreOn, type StoredInvite } from '../../api/invites/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-10-23T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const USER_TOKEN = 'ghu_' + 'u'.repeat(36);
const APP_TOKEN = 'ghs_app';
const REPO = 'acme/ds';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface World {
  /** GitHub collaborators per repository, with ids. */
  collaborators: Record<string, { id: number; login: string; permissions: { admin: boolean; push: boolean } }[]>;
  /** The repositories the user token sees through the app. */
  userRepos: { full_name: string; permissions: { admin: boolean; push: boolean; pull: boolean } }[];
  userId: number;
  installed: Set<string>;
}

function setup() {
  let now = T0;
  const w: World = {
    collaborators: { [REPO]: [{ id: 1, login: 'ada', permissions: { admin: true, push: true } }, { id: 2, login: 'bob', permissions: { admin: false, push: true } }] },
    userRepos: [],
    userId: 1,
    installed: new Set([REPO, 'acme/other']),
  };
  const calls: string[] = [];
  const redis = memoryRedis(() => now);
  const members = memberStore(redis);
  const invites = inviteStoreOn(redis, () => now);
  const sent: EmailMessage[] = [];
  const app = { installationToken: async (o: string, r: string) => (w.installed.has(`${o}/${r}`.toLowerCase()) ? APP_TOKEN : null) };
  const deps: EntryDeps = {
    fetch: async (url, init) => {
      const u = new URL(url);
      calls.push(`${init.method} ${u.pathname}`);
      const auth = init.headers.Authorization;
      if (auth === `Bearer ${USER_TOKEN}`) {
        if (u.pathname === '/user') return res(200, { id: w.userId, login: 'ada' });
        if (u.pathname === '/user/installations') return res(200, { installations: [{ id: 5 }] });
        if (u.pathname === '/user/installations/5/repositories') return res(200, { repositories: w.userRepos });
        return res(404, {});
      }
      if (auth !== `Bearer ${APP_TOKEN}`) return res(401, {});
      let m = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)\/permission$/.exec(u.pathname);
      if (m) {
        const c = (w.collaborators[m[1]!] ?? []).find((x) => x.login === decodeURIComponent(m![2]!));
        return c ? res(200, { permission: c.permissions.admin ? 'admin' : 'write', user: { id: c.id, login: c.login } }) : res(404, {});
      }
      m = /^\/repos\/([^/]+\/[^/]+)\/collaborators$/.exec(u.pathname);
      if (m) return res(200, w.collaborators[m[1]!] ?? []);
      m = /^\/user\/(\d+)$/.exec(u.pathname);
      if (m) return res(200, { id: Number(m[1]), login: Number(m[1]) === 9 ? 'cara-now' : 'someone' });
      m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(u.pathname);
      if (m && init.method === 'GET') return res(200, { owner: { login: m[1], type: 'Organization' }, default_branch: 'main' });
      m = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)$/.exec(u.pathname);
      if (m && init.method === 'PUT') return res(204);
      return res(404, {});
    },
    now: () => now,
    random: (n) => new Uint8Array(n).map((_, i) => (i * 7 + now) % 256),
    redis,
    members,
    invites,
    email: { send: async (msg) => void sent.push(msg) },
    app,
    grantApp: app,
  };
  return { w, deps, redis, members, invites, sent, calls, tick: (ms: number) => (now += ms), now: () => now };
}

type S = ReturnType<typeof setup>;

async function account(s: S, email: string, name: string, github: Account['github'] = null): Promise<string> {
  const a: Account = { id: `id-${email}`, email, name, github, createdAt: new Date(T0).toISOString(), version: 1 };
  await putAccount(s.redis, a);
  if (github) await s.redis.cmd('SET', `bridge:account:gh:${github.id}`, email);
  return `${ACCOUNT_COOKIE}=${signAccountSession({ email, v: 1, exp: s.now() + 60 * 86_400_000 }, SECRET)}`;
}

function get(s: S, cookie: string | null, query = '', bearer?: string) {
  const headers: Record<string, string> = { host: HOST };
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return handleEntry(new Request(`${ORIGIN}/api/entry${query}`, { headers }), ENV, s.deps);
}

function post(s: S, cookie: string | null, body: unknown, opts: { header?: boolean; origin?: string; bearer?: string } = {}) {
  const headers: Record<string, string> = { host: HOST, origin: opts.origin ?? ORIGIN, 'content-type': 'application/json' };
  if (opts.header !== false) headers['x-bridge-contribute'] = '1';
  if (cookie) headers.cookie = cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return handleEntry(new Request(`${ORIGIN}/api/entry`, { method: 'POST', headers, body: JSON.stringify(body) }), ENV, s.deps);
}

async function adminOpens(s: S, repo = REPO): Promise<string> {
  const admin = await account(s, 'ada@acme.design', 'Ada Admin', { login: 'ada', id: 1 });
  const r = await post(s, admin, { action: 'discovery', repo, enabled: true });
  expect(r.status).toBe(200);
  return admin;
}

async function invite(s: S, x: Partial<StoredInvite> & { email: string }): Promise<StoredInvite> {
  const inv: StoredInvite = {
    id: 'a1b2c3d4e5f60718',
    repo: REPO,
    role: 'edit',
    invitedBy: 'ada',
    createdAt: new Date(s.now()).toISOString(),
    expiresAt: new Date(s.now() + 7 * 86_400_000).toISOString(),
    sentAt: new Date(s.now()).toISOString(),
    tokenHash: 'h'.repeat(64),
    ...x,
  };
  await s.invites.put(inv, 7 * 86_400);
  return inv;
}

describe('public email domains', () => {
  it('never treats a free mailbox as a work domain', () => {
    for (const d of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.de', 'aol.com', 'yandex.ru', 'mail.ru', 'orange.fr', 'free.fr', 'laposte.net', 'wanadoo.fr', 'sfr.fr']) {
      expect(isPublicDomain(d), d).toBe(true);
    }
  });
  it('catches country variants and subdomains of providers', () => {
    for (const d of ['yahoo.fr', 'hotmail.co.uk', 'outlook.de', 'live.fr', 'yahoo.com.br', 'mail.yahoo.com', 'eu.gmx.net', 'GMAIL.COM']) expect(isPublicDomain(d), d).toBe(true);
  });
  it('keeps company domains', () => {
    expect(workDomain('Mia@Acme.Design')).toBe('acme.design');
    expect(workDomain('x@studio.co.uk')).toBe('studio.co.uk');
    expect(workDomain('x@yahooligans-agency.com')).toBe('yahooligans-agency.com');
    expect(workDomain('x@gmail.com')).toBeNull();
    expect(workDomain('not-an-email')).toBeNull();
  });
});

describe('auth', () => {
  it('needs the account cookie', async () => {
    const s = setup();
    expect((await get(s, null)).status).toBe(401);
    expect((await get(s, `${ACCOUNT_COOKIE}=v1.forged.sig`)).status).toBe(401);
    expect((await post(s, null, { action: 'request', repo: REPO })).status).toBe(401);
  });
  it('refuses a POST without the CSRF header or from another site', async () => {
    const s = setup();
    const c = await account(s, 'mia@acme.design', 'Mia');
    expect((await post(s, c, { action: 'request', repo: REPO }, { header: false })).status).toBe(403);
    expect((await post(s, c, { action: 'request', repo: REPO }, { origin: 'https://evil.example' })).status).toBe(403);
  });
  it('ends with the account version', async () => {
    const s = setup();
    const c = await account(s, 'mia@acme.design', 'Mia');
    const a = JSON.parse((await s.redis.cmd('GET', 'bridge:account:mia@acme.design')) as string);
    await s.redis.cmd('SET', 'bridge:account:mia@acme.design', JSON.stringify({ ...a, version: 2 }));
    expect((await get(s, c)).status).toBe(401);
  });
  it('is not configured without storage or secret', async () => {
    const r = await handleEntry(new Request(`${ORIGIN}/api/entry`), {}, { fetch: async () => res(500) });
    expect(r.status).toBe(503);
  });
});

describe('routing order', () => {
  it('says create when nothing matches', async () => {
    const s = setup();
    const c = await account(s, 'mia@acme.design', 'Mia');
    expect(await (await get(s, c)).json()).toEqual({ kind: 'create' });
  });

  it('lists teams open to the work domain, without anyone else’s email', async () => {
    const s = setup();
    await adminOpens(s);
    await s.members.put(REPO, { email: 'zed@acme.design', name: 'Zed', role: 'edit', version: 1, addedBy: 'ada', at: '' });
    const c = await account(s, 'mia@acme.design', 'Mia');
    const r = await get(s, c);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ kind: 'domain', domain: 'acme.design', teams: [{ repo: REPO, name: 'Ds', memberCount: 3, adminName: 'Ada Admin', requested: false }] });
    expect(text).not.toContain('@');
  });

  it('never shows a team to another domain or to a public email', async () => {
    const s = setup();
    await adminOpens(s);
    for (const email of ['li@other.design', 'mia@gmail.com']) {
      const c = await account(s, email, 'X');
      expect(await (await get(s, c)).json()).toEqual({ kind: 'create' });
    }
  });

  it('puts invites before domain teams', async () => {
    const s = setup();
    await adminOpens(s);
    await invite(s, { email: 'mia@acme.design', repo: 'acme/other' });
    const c = await account(s, 'mia@acme.design', 'Mia');
    expect(await (await get(s, c)).json()).toEqual({ kind: 'invites', invites: [{ id: 'a1b2c3d4e5f60718', team: 'Other', repo: 'acme/other', role: 'edit', invitedBy: 'ada' }] });
  });

  it('puts teams before invites', async () => {
    const s = setup();
    await invite(s, { email: 'mia@acme.design', repo: 'acme/other' });
    await s.members.put(REPO, { email: 'mia@acme.design', name: 'Mia', role: 'edit', version: 1, addedBy: 'ada', at: '' });
    const c = await account(s, 'mia@acme.design', 'Mia');
    expect(await (await get(s, c)).json()).toEqual({ kind: 'teams', teams: [{ repo: REPO, name: 'Ds', role: 'edit', via: 'email' }] });
  });

  it('counts GitHub teams of the linked account when its own token comes along', async () => {
    const s = setup();
    s.w.userRepos = [
      { full_name: 'acme/ds', permissions: { admin: true, push: true, pull: true } },
      { full_name: 'acme/read-only', permissions: { admin: false, push: false, pull: true } },
    ];
    const c = await account(s, 'ada@acme.design', 'Ada', { login: 'ada', id: 1 });
    expect(await (await get(s, c, '', USER_TOKEN)).json()).toEqual({ kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Ds', role: 'admin', via: 'github' }] });
    // Without the token, or with a token of another GitHub account, GitHub is not asked.
    expect((await (await get(s, c)).json()).kind).toBe('create');
    s.w.userId = 42;
    expect((await (await get(s, c, '', USER_TOKEN)).json()).kind).toBe('create');
  });
});

describe('discovery opt-in', () => {
  it('is for admins only, matched by GitHub id', async () => {
    const s = setup();
    const bob = await account(s, 'bob@acme.design', 'Bob', { login: 'bob', id: 2 });
    expect(await (await post(s, bob, { action: 'discovery', repo: REPO, enabled: true })).json()).toMatchObject({ error: 'forbidden', message: ADMIN_ONLY });
    const emailOnly = await account(s, 'mia@acme.design', 'Mia');
    expect((await post(s, emailOnly, { action: 'discovery', repo: REPO, enabled: true })).status).toBe(403);
    // A renamed login now held by someone else: the id does not match.
    const imposter = await account(s, 'eve@acme.design', 'Eve', { login: 'ada', id: 99 });
    expect((await post(s, imposter, { action: 'discovery', repo: REPO, enabled: true })).status).toBe(403);
    expect((await get(s, bob, `?discovery=${REPO}`)).status).toBe(403);
  });

  it('uses the admin’s own work domain and refuses a public one', async () => {
    const s = setup();
    const gm = await account(s, 'ada@gmail.com', 'Ada', { login: 'ada', id: 1 });
    expect(await (await post(s, gm, { action: 'discovery', repo: REPO, enabled: true })).json()).toMatchObject({ error: 'public-domain', message: PUBLIC_DOMAIN });
    expect(await (await get(s, gm, `?discovery=${REPO}`)).json()).toEqual({ domain: null, enabled: false, configured: false, eligible: false });
    expect(await s.redis.cmd('SMEMBERS', 'bridge:team:domain:gmail.com')).toEqual([]);
  });

  it('opens and closes the team', async () => {
    const s = setup();
    const admin = await account(s, 'ada@acme.design', 'Ada', { login: 'ada', id: 1 });
    expect(await (await get(s, admin, `?discovery=${REPO}`)).json()).toEqual({ domain: 'acme.design', enabled: false, configured: false, eligible: true });
    expect(await (await post(s, admin, { action: 'discovery', repo: REPO, enabled: true })).json()).toEqual({ domain: 'acme.design', enabled: true });
    expect(await s.redis.cmd('SMEMBERS', 'bridge:team:domain:acme.design')).toEqual([REPO]);
    expect(await (await post(s, admin, { action: 'discovery', repo: REPO, enabled: false })).json()).toEqual({ domain: 'acme.design', enabled: false });
    expect(await s.redis.cmd('SMEMBERS', 'bridge:team:domain:acme.design')).toEqual([]);
    expect(await (await get(s, admin, `?discovery=${REPO}`)).json()).toEqual({ domain: 'acme.design', enabled: false, configured: true, eligible: true });
    expect((await post(s, admin, { action: 'discovery', repo: REPO })).status).toBe(400);
  });
});

describe('join requests', () => {
  it('asks once, emails the admins, then the admin approves', async () => {
    const s = setup();
    const admin = await adminOpens(s);
    const mia = await account(s, 'mia@acme.design', 'Mia Chen');
    const r = await post(s, mia, { action: 'request', repo: REPO });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ requested: true, expiresAt: new Date(T0 + JOIN_REQUEST_TTL_MS).toISOString() });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe('ada@acme.design');
    expect(s.sent[0]!.subject).toBe('Mia Chen asked to join Ds on Bridge');
    expect(s.sent[0]!.text).toContain(`${ORIGIN}/studio/acme/ds/settings/`);
    for (const m of s.sent) expect(m.text + m.html + m.subject).not.toContain('\u2014');

    // One pending request per email and team: asking again sends nothing.
    expect(await (await post(s, mia, { action: 'request', repo: REPO })).json()).toMatchObject({ requested: true, already: true });
    expect(s.sent).toHaveLength(1);
    expect((await (await get(s, mia)).json()).teams[0].requested).toBe(true);

    // Only admins list and answer.
    const bob = await account(s, 'bob@acme.design', 'Bob', { login: 'bob', id: 2 });
    expect((await get(s, bob, `?requests=${REPO}`)).status).toBe(403);
    expect((await get(s, mia, `?requests=${REPO}`)).status).toBe(403);
    const list = (await (await get(s, admin, `?requests=${REPO}`)).json()).requests;
    expect(list).toEqual([{ id: expect.stringMatching(/^[a-f0-9]{16}$/), name: 'Mia Chen', email: 'mia@acme.design', createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + JOIN_REQUEST_TTL_MS).toISOString() }]);
    expect((await post(s, bob, { action: 'approve', repo: REPO, id: list[0].id })).status).toBe(403);

    const ok = await post(s, admin, { action: 'approve', repo: REPO, id: list[0].id });
    expect(await ok.json()).toEqual({ member: { name: 'Mia Chen', role: 'edit' }, repo: REPO });
    expect(await s.members.get(REPO, 'mia@acme.design')).toMatchObject({ role: 'edit', addedBy: 'ada', version: 1 });
    expect(s.sent[1]).toMatchObject({ to: 'mia@acme.design', subject: 'You joined Ds on Bridge' });
    expect(s.sent[1]!.text).toContain('Ada Admin approved your request');
    expect((await (await get(s, admin, `?requests=${REPO}`)).json()).requests).toEqual([]);
    expect(await (await get(s, mia)).json()).toEqual({ kind: 'teams', teams: [{ repo: REPO, name: 'Ds', role: 'edit', via: 'email' }] });
    // A spent request answers like a missing one.
    expect((await post(s, admin, { action: 'approve', repo: REPO, id: list[0].id })).status).toBe(404);
  });

  it('declines without an email, and expires after 14 days', async () => {
    const s = setup();
    const admin = await adminOpens(s);
    const mia = await account(s, 'mia@acme.design', 'Mia');
    await post(s, mia, { action: 'request', repo: REPO });
    const [req] = (await (await get(s, admin, `?requests=${REPO}`)).json()).requests;
    expect(await (await post(s, admin, { action: 'decline', repo: REPO, id: req.id })).json()).toEqual({ ok: true });
    expect(s.sent).toHaveLength(1);
    expect(await s.members.get(REPO, 'mia@acme.design')).toBeNull();

    await post(s, mia, { action: 'request', repo: REPO });
    s.tick(JOIN_REQUEST_TTL_MS + 1000);
    expect((await (await get(s, admin, `?requests=${REPO}`)).json()).requests).toEqual([]);
    expect((await (await get(s, mia)).json()).teams[0].requested).toBe(false);
  });

  it('answers the same 404 for a closed team, a missing team and another domain', async () => {
    const s = setup();
    const mia = await account(s, 'mia@acme.design', 'Mia');
    const a = await post(s, mia, { action: 'request', repo: REPO });
    const b = await post(s, mia, { action: 'request', repo: 'nobody/nothing' });
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
    await adminOpens(s);
    const li = await account(s, 'li@other.design', 'Li');
    expect(await (await post(s, li, { action: 'request', repo: REPO })).json()).toMatchObject({ error: 'not_found', message: NOT_OPEN });
    const gm = await account(s, 'mia@gmail.com', 'Mia');
    expect((await post(s, gm, { action: 'request', repo: REPO })).status).toBe(404);
    expect(s.sent).toHaveLength(0);
  });

  it('says already on the team, and accepts an invite instead of asking', async () => {
    const s = setup();
    await adminOpens(s);
    const mia = await account(s, 'mia@acme.design', 'Mia');
    await invite(s, { email: 'mia@acme.design' });
    const r = await post(s, mia, { action: 'request', repo: REPO });
    expect(await r.json()).toMatchObject({ joined: true, repo: REPO, role: 'edit', next: '/studio/acme/ds/' });
    expect(s.sent).toHaveLength(0);
    expect(await s.invites.byEmail('mia@acme.design')).toEqual([]);
    expect((await post(s, mia, { action: 'request', repo: REPO })).status).toBe(409);
  });

  it('is capped per person per day', async () => {
    const s = setup();
    const mia = await account(s, 'mia@acme.design', 'Mia');
    const admin = await account(s, 'ada@acme.design', 'Ada', { login: 'ada', id: 1 });
    for (let i = 0; i <= REQUEST_LIMITS.email; i++) {
      const repo = `acme/t${i}`;
      s.w.installed.add(repo);
      s.w.collaborators[repo] = s.w.collaborators[REPO]!;
      await post(s, admin, { action: 'discovery', repo, enabled: true });
    }
    for (let i = 0; i < REQUEST_LIMITS.email; i++) expect((await post(s, mia, { action: 'request', repo: `acme/t${i}` })).status).toBe(200);
    const over = await post(s, mia, { action: 'request', repo: `acme/t${REQUEST_LIMITS.email}` });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: 'limit', limit: 'email' });
  });

  it('goes with the account when it is deleted', async () => {
    const s = setup();
    const admin = await adminOpens(s);
    const mia = await account(s, 'mia@acme.design', 'Mia');
    await post(s, mia, { action: 'request', repo: REPO });
    const del = await handleAccount(
      new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-account': '1', cookie: mia }, body: JSON.stringify({ action: 'delete' }) }),
      ENV,
      { fetch: s.deps.fetch, now: s.now, redis: s.redis, members: s.members },
    );
    expect(del.status).toBe(200);
    expect((await (await get(s, admin, `?requests=${REPO}`)).json()).requests).toEqual([]);
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:joinreq:') && !k.startsWith('bridge:joinreq:count:'))).toEqual([]);
  });
});

describe('accept-invite', () => {
  it('joins a Can edit invite with the account email', async () => {
    const s = setup();
    const inv = await invite(s, { email: 'mia@acme.design' });
    const mia = await account(s, 'mia@acme.design', 'Mia Chen');
    const r = await post(s, mia, { action: 'accept-invite', repo: REPO, id: inv.id });
    expect(await r.json()).toEqual({ joined: true, status: 'joined', repo: REPO, role: 'edit', next: '/studio/acme/ds/' });
    expect(await s.members.get(REPO, 'mia@acme.design')).toMatchObject({ name: 'Mia Chen', addedBy: 'ada' });
    expect((await post(s, mia, { action: 'accept-invite', repo: REPO, id: inv.id })).status).toBe(410);
  });

  it('never accepts someone else’s invite', async () => {
    const s = setup();
    const inv = await invite(s, { email: 'zed@acme.design' });
    const mia = await account(s, 'mia@acme.design', 'Mia');
    expect((await post(s, mia, { action: 'accept-invite', repo: REPO, id: inv.id })).status).toBe(410);
    expect((await post(s, mia, { action: 'accept-invite', repo: REPO, id: 'nope' })).status).toBe(410);
    expect(await s.members.get(REPO, 'mia@acme.design')).toBeNull();
  });

  it('needs GitHub for a reviewer or admin invite, then grants the login read from the GitHub id', async () => {
    const s = setup();
    const inv = await invite(s, { email: 'cara@acme.design', role: 'admin' });
    const emailOnly = await account(s, 'cara@acme.design', 'Cara');
    expect(await (await post(s, emailOnly, { action: 'accept-invite', repo: REPO, id: inv.id })).json()).toMatchObject({ error: 'github-required' });
    const linked = await account(s, 'cara@acme.design', 'Cara', { login: 'cara-old', id: 9 });
    const r = await post(s, linked, { action: 'accept-invite', repo: REPO, id: inv.id });
    expect(await r.json()).toMatchObject({ joined: true, status: 'joined', repo: REPO, role: 'admin' });
    expect(s.calls).toContain('PUT /repos/acme/ds/collaborators/cara-now');
    expect(await s.invites.byEmail('cara@acme.design')).toEqual([]);
  });
});
