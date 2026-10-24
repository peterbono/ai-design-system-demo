// Teams made in Bridge before any repository ("Create your team", api/entry create-team) and email admins (D1, D2):
// the team exists at step 1 with its creator as admin, colleagues on the work domain find it and ask to join, the
// creator's next sign-in lands on it, a repository links it later (everything moves, an old key still resolves), and an
// email member made Admin manages people, requests, discovery and invites without GitHub. Then the last-admin rule of
// account deletion, checked before the confirm field. Real functions, an in-memory Redis, a fake email and GitHub.
import { describe, expect, it } from 'vitest';
import { type Account, ACCOUNT_COOKIE, putAccount, signAccountSession } from '../../api/_lib/account';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { getDiscovery, getTeamRecord, teamsForDomain } from '../../api/_lib/teams';
import { handleAccount, lastAdminOf } from '../../api/account/index';
import { handleEntry, LINK_APP_MISSING, REPO_ADMIN_ONLY, TEAM_GONE } from '../../api/entry/index';
import { type EmailMessage, handleInvites, inviteStoreOn, LAST_ADMIN, REVIEWER_NEEDS_REPO } from '../../api/invites/index';
import { isTeamKey, teamHref, teamKeyOf } from './team-path';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const T0 = Date.parse('2026-10-23T10:00:00Z');
const APP = 'ghs_app';
const REPO = 'northwind/ds';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup() {
  let now = T0;
  const redis = memoryRedis(() => now);
  const members = memberStore(redis);
  const invites = inviteStoreOn(redis, () => now);
  const sent: EmailMessage[] = [];
  const email = { send: async (m: EmailMessage) => void sent.push(m) };
  /** Repositories the Bridge app is installed on, and their GitHub admins by login and id. */
  const installed = new Set<string>([REPO]);
  const admins: Record<string, { login: string; id: number }[]> = { [REPO]: [{ login: 'jo-gh', id: 42 }] };
  const app = { installationToken: async (o: string, r: string) => (installed.has(`${o}/${r}`.toLowerCase()) ? APP : null) };
  let n = 0;
  const fetch = async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    const u = new URL(url);
    if (init.headers.Authorization !== `Bearer ${APP}`) return res(401, {});
    const m = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)\/permission$/.exec(u.pathname);
    if (m) {
      const a = (admins[m[1]!] ?? []).find((x) => x.login === decodeURIComponent(m[2]!));
      return a ? res(200, { permission: 'admin', user: { id: a.id, login: a.login } }) : res(404, {});
    }
    if (/\/collaborators$/.test(u.pathname)) return res(200, []);
    if (/\/user\/\d+$/.test(u.pathname)) return res(200, { id: 42, login: 'jo-gh' });
    return res(404, {});
  };
  const entryDeps = { fetch, now: () => now, random: (k: number) => new Uint8Array(k).map(() => (n++ * 37 + 11) % 256), redis, members, invites, email, app, grantApp: app };
  const invitesDeps = { fetch, now: () => now, random: (k: number) => new Uint8Array(k).map(() => (n++ * 53 + 7) % 256), redis, members, store: invites, email };
  const accountDeps = { fetch, now: () => now, redis, members, email };
  const cookie = async (address: string, name: string, github: Account['github'] = null) => {
    const a: Account = { id: `id-${address}`, email: address, name, github, createdAt: new Date(T0).toISOString(), version: 1 };
    await putAccount(redis, a);
    if (github) await redis.cmd('SET', `bridge:account:gh:${github.id}`, address);
    return `${ACCOUNT_COOKIE}=${signAccountSession({ email: address, v: 1, exp: now + 86_400_000 }, SECRET)}`;
  };
  const headers = (c: string) => ({ host: HOST, origin: ORIGIN, cookie: c, 'content-type': 'application/json', 'x-bridge-account': '1' });
  const entry = async (c: string, query = '') => {
    const r = await handleEntry(new Request(`${ORIGIN}/api/entry${query}`, { headers: { host: HOST, cookie: c } }), ENV, entryDeps);
    return { status: r.status, body: (await r.json()) as any };
  };
  const act = async (c: string, body: unknown) => {
    const r = await handleEntry(new Request(`${ORIGIN}/api/entry`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) }), ENV, entryDeps);
    return { status: r.status, body: (await r.json()) as any };
  };
  const inv = async (c: string, body: unknown, method: 'GET' | 'POST' = 'POST', query = '') => {
    const r = await handleInvites(new Request(`${ORIGIN}/api/invites${query}`, method === 'GET' ? { headers: { host: HOST, cookie: c } } : { method, headers: headers(c), body: JSON.stringify(body) }), ENV, invitesDeps);
    return { status: r.status, body: (await r.json()) as any };
  };
  const account = async (c: string, body: unknown) => {
    const r = await handleAccount(new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) }), ENV, accountDeps);
    return { status: r.status, body: (await r.json()) as any };
  };
  return { redis, members, invites, sent, installed, admins, cookie, entry, act, inv, account, tick: (ms: number) => (now += ms) };
}

type S = ReturnType<typeof setup>;

async function created(s: S, discover = true) {
  const jo = await s.cookie('jo@northwind.io', 'Jo Park');
  const r = await s.act(jo, { action: 'create-team', name: '  Northwind   Design ', discover });
  expect(r.status).toBe(200);
  return { jo, team: r.body.team, created: r.body.created };
}

describe('create-team: a real team at step 1', () => {
  it('makes the team, its creator its admin, and opens it to the work domain', async () => {
    const s = setup();
    const { jo, team, created: isNew } = await created(s);
    expect(isNew).toBe(true);
    expect(isTeamKey(team.key)).toBe(true);
    expect(team).toMatchObject({ name: 'Northwind Design', role: 'admin', repo: null, storybook: null, discovery: { domain: 'northwind.io', enabled: true }, memberCount: 1 });
    expect((await s.members.get(team.key, 'jo@northwind.io'))?.role).toBe('admin');
    // The creator's next sign-in routes to it, as admin.
    expect((await s.entry(jo)).body).toEqual({ kind: 'teams', teams: [{ repo: team.key, id: expect.any(String), name: 'Northwind Design', role: 'admin', via: 'email' }] });
    expect(teamHref('_team', team.id, null)).toBe(`/studio/workspace/?team=${team.id}`);
    // The account lists it, with its home.
    const me = await handleAccount(new Request(`${ORIGIN}/api/account`, { headers: { host: HOST, cookie: jo } }), ENV, { fetch: async () => res(404), redis: s.redis, members: s.members });
    expect((await me.json()).account.teams).toEqual([{ repo: team.key, name: 'Northwind Design', role: 'admin', via: 'email' }]);
  });

  it('runs again as a rename, never a second team; discovery follows the choice', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    const again = await s.act(jo, { action: 'create-team', name: 'Northwind', discover: false });
    expect(again.body).toMatchObject({ created: false, team: { id: team.id, name: 'Northwind', discovery: { enabled: false } } });
    expect(await teamsForDomain(s.redis, 'northwind.io')).toEqual([]);
    expect((await s.entry(jo)).body.teams).toHaveLength(1);
  });

  it('never opens a team to a public email domain, and refuses an empty or long name', async () => {
    const s = setup();
    const alex = await s.cookie('alex@gmail.com', 'Alex');
    expect((await s.act(alex, { action: 'create-team', name: '', discover: true })).status).toBe(400);
    expect((await s.act(alex, { action: 'create-team', name: 'x'.repeat(61), discover: true })).status).toBe(400);
    const r = await s.act(alex, { action: 'create-team', name: 'Side project', discover: true });
    expect(r.body.team.discovery).toBeNull();
    expect(await teamsForDomain(s.redis, 'gmail.com')).toEqual([]);
  });

  it('is read by its members only; anyone else gets the answer of a missing team', async () => {
    const s = setup();
    const { team } = await created(s);
    const kim = await s.cookie('kim@northwind.io', 'Kim');
    expect(await s.entry(kim, `?team=${team.key}`)).toEqual({ status: 404, body: { error: 'not_found', message: TEAM_GONE } });
    expect((await s.entry(kim, '?team=_team/0000000000000000')).status).toBe(404);
  });
});

describe('rename-team: an admin renames a team made in Bridge', () => {
  it('renames it for every admin, keeps discovery, and the account and entry read the new name', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    // A second admin, not the creator, renames it too.
    await s.members.put(team.key, { email: 'kim@northwind.io', name: 'Kim', role: 'admin', version: 1, addedBy: 'Jo Park', at: new Date(T0).toISOString() });
    const kim = await s.cookie('kim@northwind.io', 'Kim');
    const r = await s.act(kim, { action: 'rename-team', team: team.key, name: '  Northwind   Studio ' });
    expect(r.status).toBe(200);
    expect(r.body.team).toMatchObject({ key: team.key, name: 'Northwind Studio', role: 'admin', discovery: { domain: 'northwind.io', enabled: true } });
    expect(await getTeamRecord(s.redis, team.id)).toMatchObject({ name: 'Northwind Studio', repo: null });
    expect((await s.entry(jo)).body.teams).toEqual([expect.objectContaining({ repo: team.key, name: 'Northwind Studio' })]);
    expect(await teamsForDomain(s.redis, 'northwind.io')).toHaveLength(1);
  });

  it('refuses a bad name, a member who is not admin (403) and anyone not on the team (404)', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    expect((await s.act(jo, { action: 'rename-team', team: team.key, name: '' })).status).toBe(400);
    expect((await s.act(jo, { action: 'rename-team', team: team.key, name: 'x'.repeat(61) })).status).toBe(400);
    await s.members.put(team.key, { email: 'dee@northwind.io', name: 'Dee', role: 'edit', version: 1, addedBy: 'Jo Park', at: new Date(T0).toISOString() });
    const dee = await s.cookie('dee@northwind.io', 'Dee');
    expect((await s.act(dee, { action: 'rename-team', team: team.key, name: 'Mine now' })).status).toBe(403);
    const out = await s.cookie('out@acme.com', 'Out');
    expect(await s.act(out, { action: 'rename-team', team: team.key, name: 'Mine now' })).toEqual({ status: 404, body: { error: 'not_found', message: TEAM_GONE } });
    expect((await s.act(jo, { action: 'rename-team', team: '_team/0000000000000000', name: 'X' })).status).toBe(404);
    expect(await getTeamRecord(s.redis, team.id)).toMatchObject({ name: 'Northwind Design' });
  });

  it('refuses once the team has a repository: its name lives in bridge.config.json', async () => {
    const s = setup();
    const { team } = await created(s);
    const jo = await s.cookie('jo@northwind.io', 'Jo Park', { login: 'jo-gh', id: 42 });
    expect((await s.act(jo, { action: 'link-team', team: team.key, repo: REPO })).status).toBe(200);
    expect((await s.act(jo, { action: 'rename-team', team: team.key, name: 'Other' })).status).toBe(409);
  });
});

describe('colleagues find it and ask to join', () => {
  it('lists it on the domain with its admin, and the creator approves without GitHub', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    const kim = await s.cookie('kim@northwind.io', 'Kim Lee');
    const e = await s.entry(kim);
    expect(e.body).toMatchObject({ kind: 'domain', domain: 'northwind.io', teams: [{ name: 'Northwind Design', memberCount: 1, people: ['Jo P.'], adminName: 'Jo Park', requested: false }] });
    // A domain card names the team by an opaque id, never its key.
    expect(JSON.stringify(e.body)).not.toContain(team.key);
    expect((await s.act(kim, { action: 'request', team: e.body.teams[0].id })).body).toMatchObject({ requested: true });
    // The admin is emailed, with a link to the team's home.
    expect(s.sent.find((m) => m.to === 'jo@northwind.io')?.text).toContain(`/studio/workspace/?team=${team.id}`);
    const reqs = (await s.entry(jo, `?requests=${team.key}`)).body.requests;
    expect(reqs).toHaveLength(1);
    expect((await s.act(jo, { action: 'approve', repo: team.key, id: reqs[0].id })).body).toMatchObject({ member: { name: 'Kim Lee', role: 'edit' } });
    expect((await s.entry(kim)).body).toMatchObject({ kind: 'teams', teams: [{ repo: team.key, role: 'edit' }] });
    // A member, not an admin: no requests, no discovery.
    expect((await s.entry(kim, `?requests=${team.key}`)).status).toBe(403);
    expect((await s.act(kim, { action: 'discovery', repo: team.key, enabled: false })).status).toBe(403);
    const seen = (await s.entry(kim, `?team=${team.key}`)).body.team;
    expect(seen).toMatchObject({ role: 'edit', memberCount: 2 });
    // Its Settings name the admin to everyone on the team: names and roles, never an email.
    expect(seen.people).toEqual(expect.arrayContaining([{ name: 'Kim Lee', role: 'edit' }, expect.objectContaining({ role: 'admin' })]));
    expect(JSON.stringify(seen.people)).not.toContain('@');
  });
});

describe('link-team: the design system comes later', () => {
  it('keeps a Storybook with the team (admins only, https only)', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    expect((await s.act(jo, { action: 'link-team', team: team.key, storybook: 'javascript:alert(1)' })).status).toBe(400);
    const r = await s.act(jo, { action: 'link-team', team: team.key, storybook: 'https://storybook.northwind.io' });
    expect(r.body.team.storybook).toBe('https://storybook.northwind.io');
    const kim = await s.cookie('kim@northwind.io', 'Kim');
    await s.members.put(team.key, { email: 'kim@northwind.io', name: 'Kim', role: 'edit', version: 1, addedBy: 'Jo Park', at: new Date(T0).toISOString() });
    expect((await s.act(kim, { action: 'link-team', team: team.key, storybook: 'https://x.io' })).status).toBe(403);
  });

  it('needs an admin of the repository; Bridge not installed says how to go on', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    // Email only: GitHub must say they administer the repository.
    expect(await s.act(jo, { action: 'link-team', team: team.key, repo: REPO })).toEqual({ status: 403, body: { error: 'forbidden', message: REPO_ADMIN_ONLY } });
    const linked = await s.cookie('jo@northwind.io', 'Jo Park', { login: 'jo-gh', id: 42 });
    expect((await s.act(linked, { action: 'link-team', team: team.key, repo: 'northwind/other' })).body).toEqual({ error: 'app_missing', message: LINK_APP_MISSING });
  });

  it('moves members, admins, discovery, requests, invites and the name to the repository; the old key resolves to it', async () => {
    const s = setup();
    const { team } = await created(s);
    const kim = await s.cookie('kim@northwind.io', 'Kim Lee');
    await s.act(kim, { action: 'request', repo: team.key });
    const jo = await s.cookie('jo@northwind.io', 'Jo Park', { login: 'jo-gh', id: 42 });
    expect((await s.inv(jo, { action: 'invite', repo: team.key, role: 'edit', people: [{ email: 'ana@northwind.io' }] })).body.results).toEqual([{ email: 'ana@northwind.io', status: 'sent' }]);
    const r = await s.act(jo, { action: 'link-team', team: team.key, repo: 'Northwind/DS' });
    expect(r.body).toEqual({ repo: REPO, next: '/studio/northwind/ds/' });
    expect((await s.members.get(REPO, 'jo@northwind.io'))?.role).toBe('admin');
    expect(await s.members.list(team.key)).toEqual([]);
    expect(await getDiscovery(s.redis, REPO)).toMatchObject({ domain: 'northwind.io', enabled: true });
    expect(await teamsForDomain(s.redis, 'northwind.io')).toEqual([expect.objectContaining({ repo: REPO })]);
    expect((await s.entry(jo, `?requests=${REPO}`)).body.requests).toHaveLength(1);
    expect((await s.invites.list(REPO)).map((i) => i.email)).toEqual(['ana@northwind.io']);
    expect(await getTeamRecord(s.redis, team.id)).toMatchObject({ repo: REPO });
    // The creator lands on the repository's team now; the old key answers with it.
    expect((await s.entry(jo)).body.teams).toEqual([expect.objectContaining({ repo: REPO, name: 'Northwind Design', role: 'admin' })]);
    expect((await s.entry(jo, `?team=${team.key}`)).body.team).toMatchObject({ repo: REPO, key: REPO });
    expect((await s.act(jo, { action: 'discovery', repo: team.key, enabled: false })).body).toEqual({ domain: 'northwind.io', enabled: false });
    // Linking again to the same repository is fine; to another one is refused.
    expect((await s.act(jo, { action: 'link-team', team: team.key, repo: REPO })).status).toBe(200);
    expect((await s.act(jo, { action: 'link-team', team: team.key, repo: 'northwind/web' })).status).toBe(409);
  });
});

describe('email admins (no GitHub)', () => {
  it('manage invites and email members of a team made in Bridge; Reviewer waits for a repository', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    expect((await s.inv(jo, { action: 'invite', repo: team.key, role: 'reviewer', reviewAs: 'design', people: [{ email: 'rae@northwind.io' }] })).body).toEqual({ error: 'github-required', message: REVIEWER_NEEDS_REPO });
    const sent = await s.inv(jo, { action: 'invite', repo: team.key, role: 'admin', people: [{ email: 'kim@northwind.io' }] });
    expect(sent.body.results).toEqual([{ email: 'kim@northwind.io', status: 'sent' }]);
    expect(s.sent.at(-1)).toMatchObject({ to: 'kim@northwind.io' });
    expect(s.sent.at(-1)!.text).toContain('no GitHub account needed');
    // Accepted from the account: an email admin.
    const kim = await s.cookie('kim@northwind.io', 'Kim Lee');
    const pending = (await s.entry(kim)).body.invites[0];
    expect((await s.act(kim, { action: 'accept-invite', repo: pending.repo, id: pending.id })).body).toMatchObject({ joined: true, role: 'admin', next: `/studio/workspace/?team=${team.id}` });
    const list = await s.inv(jo, undefined, 'GET', `?repo=${team.key}`);
    expect(list.body.members.map((m: any) => [m.email, m.role])).toEqual([
      ['jo@northwind.io', 'admin'],
      ['kim@northwind.io', 'admin'],
    ]);
    // Never on themselves; demote another admin; the last admin stays.
    expect((await s.inv(jo, { action: 'set-role', repo: team.key, email: 'jo@northwind.io', role: 'edit' })).status).toBe(409);
    expect((await s.inv(jo, { action: 'set-role', repo: team.key, email: 'kim@northwind.io', role: 'edit' })).body).toEqual({ ok: true, role: 'edit' });
    expect((await s.inv(kim, { action: 'set-role', repo: team.key, email: 'jo@northwind.io', role: 'edit' })).status).toBe(403);
    await s.members.put(team.key, { ...(await s.members.get(team.key, 'kim@northwind.io'))!, role: 'admin' });
    await s.members.put(team.key, { ...(await s.members.get(team.key, 'jo@northwind.io'))!, role: 'edit' });
    expect((await s.inv(jo, { action: 'remove', repo: team.key, email: 'kim@northwind.io' })).status).toBe(403);
    // Kim, the only admin left, cannot be demoted or removed by anyone else (nobody else is admin).
    expect((await s.inv(kim, { action: 'set-role', repo: team.key, email: 'kim@northwind.io', role: 'edit' })).status).toBe(409);
    expect(LAST_ADMIN).toContain('keeps an admin');
  });

  it('on a repository team: invites by email, makes a member admin, decides requests and discovery, never touches GitHub people', async () => {
    const s = setup();
    const priya = await s.cookie('priya@northwind.io', 'Priya Shah');
    const leo = await s.cookie('leo@northwind.io', 'Leo Martin');
    await s.members.put(REPO, { email: 'priya@northwind.io', name: 'Priya Shah', role: 'admin', version: 1, addedBy: 'jo-gh', at: new Date(T0).toISOString() });
    await s.members.put(REPO, { email: 'leo@northwind.io', name: 'Leo Martin', role: 'edit', version: 1, addedBy: 'jo-gh', at: new Date(T0).toISOString() });
    expect((await s.act(priya, { action: 'discovery', repo: REPO, enabled: true })).body).toEqual({ domain: 'northwind.io', enabled: true });
    expect((await s.entry(priya)).body.teams).toEqual([expect.objectContaining({ repo: REPO, role: 'admin' })]);
    expect((await s.inv(priya, { action: 'set-role', repo: REPO, email: 'leo@northwind.io', role: 'admin' })).body).toEqual({ ok: true, role: 'admin' });
    expect((await s.inv(priya, { action: 'set-role', repo: REPO, login: 'jo-gh', role: 'edit' })).body.error).toBe('github-required');
    expect((await s.inv(priya, { action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'ana@northwind.io' }] })).body.results[0].status).toBe('sent');
    // A Can edit member is no admin here.
    await s.members.put(REPO, { ...(await s.members.get(REPO, 'leo@northwind.io'))!, role: 'edit' });
    expect((await s.inv(leo, undefined, 'GET', `?repo=${REPO}`)).status).toBe(403);
    // A POST without the account header is refused (CSRF).
    const r = await handleInvites(new Request(`${ORIGIN}/api/invites`, { method: 'POST', headers: { host: HOST, origin: ORIGIN, cookie: priya, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel', repo: REPO, id: 'a'.repeat(16) }) }), ENV, { fetch: async () => res(404), redis: s.redis, members: s.members, store: s.invites, email: { send: async () => undefined } });
    expect(r.status).toBe(403);
  });
});

describe('deleting the account: the last admin, said before the confirm field', () => {
  it('names the team and who could take over, then goes through once someone else is admin', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    expect((await s.account(jo, { action: 'delete-check' })).body).toEqual({ blocked: [] });
    await s.members.put(team.key, { email: 'kim@northwind.io', name: 'Kim Lee', role: 'edit', version: 1, addedBy: 'Jo Park', at: new Date(T0).toISOString() });
    const check = await s.account(jo, { action: 'delete-check' });
    expect(check.body).toEqual({ blocked: [{ repo: team.key, name: 'Northwind Design', people: [{ name: 'Kim Lee', email: 'kim@northwind.io' }] }] });
    const refused = await s.account(jo, { action: 'delete' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'last-admin', message: lastAdminOf(['Northwind Design']) });
    expect(refused.body.message).toBe('You are the only admin of Northwind Design. Make someone else admin first, then delete your account.');
    // "Make Kim Lee admin", inline: then delete works and the team stays with Kim.
    expect((await s.inv(jo, { action: 'set-role', repo: team.key, email: 'kim@northwind.io', role: 'admin' })).status).toBe(200);
    expect((await s.account(jo, { action: 'delete' })).status).toBe(200);
    expect(await getTeamRecord(s.redis, team.id)).not.toBeNull();
    expect((await s.members.get(team.key, 'kim@northwind.io'))?.role).toBe('admin');
  });

  it('an email admin of a repository team is never the last one (its GitHub admins stay)', async () => {
    const s = setup();
    const priya = await s.cookie('priya@northwind.io', 'Priya Shah');
    await s.members.put(REPO, { email: 'priya@northwind.io', name: 'Priya Shah', role: 'admin', version: 1, addedBy: 'jo-gh', at: new Date(T0).toISOString() });
    await s.members.put(REPO, { email: 'leo@northwind.io', name: 'Leo Martin', role: 'edit', version: 1, addedBy: 'jo-gh', at: new Date(T0).toISOString() });
    expect((await s.account(priya, { action: 'delete-check' })).body).toEqual({ blocked: [] });
  });

  it('a team made in Bridge its creator was alone on goes with the account', async () => {
    const s = setup();
    const { jo, team } = await created(s);
    expect((await s.account(jo, { action: 'delete' })).status).toBe(200);
    expect(await getTeamRecord(s.redis, team.id)).toBeNull();
    expect(await teamsForDomain(s.redis, 'northwind.io')).toEqual([]);
    expect(teamKeyOf(team.id)).toBe(team.key);
  });
});
