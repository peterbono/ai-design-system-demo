// A team whose repository was renamed or transferred (src/lib/team-path.ts RENAMED_REPOS, RENAMED_OWNERS) is one team
// everywhere a person's teams are listed: GET /api/account ("Your teams"), the "Use Bridge in Claude" consent card
// (api/mcp ?oauth=request), the grants it makes, and the browser's own lists (recent teams, names, roles, the
// switcher and pickers in lib/pickable-teams.ts). Regression: the owner saw "Bridge DS" twice, both Admin.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_COOKIE, githubTeamsOf, putAccount, signAccountSession } from '../../api/_lib/account';
import { dropTeamFromSet, memberStore, teamInSet, teamsInSet, type EmailMember } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { createGrant, getGrant, listGrants, revokeGrant } from '../../api/_lib/oauth';
import { sealingKey } from '../../api/_lib/sealed';
import { handleAccount } from '../../api/account/index';
import { handleConnector, type ConnectorEnv, type FetchLike } from '../../api/mcp/index';
import { parseRecentTeams, parseTeamNames, pushRecentTeam, removeRecentTeam } from './access-view';
import { pickableTeams } from './pickable-teams';
import { forgetTeamEverywhere, knownTeamName, loadRecentTeams, loadTeamRoles, type RecentStore } from './recent-teams';

const NOW = 'the-bridge-company/ai-design-system-demo';
const OLD_REPO = 'peterbono/ai-design-system-demo';
const OLD_OWNER = 'art-print-shop-co/ai-design-system-demo';
const EMAIL = 'flo@acme.design';
const HOST = 'bridge.example.com';
const SITE = `https://${HOST}`;
const SECRET = 's'.repeat(40);
const T0 = Date.parse('2026-11-05T10:00:00Z');
const member = (role: EmailMember['role'], at = '2026-10-01T00:00:00Z'): EmailMember => ({ email: EMAIL, name: 'Flo', role, version: 1, addedBy: 'dana', at });
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const random = (n: number) => new Uint8Array(n).map(() => Math.floor(Math.random() * 256));

/** Memberships kept under the old names (before the rename) and the current one, as Redis may still hold them. */
async function seedRenamed(redis: ReturnType<typeof memoryRedis>) {
  await redis.cmd('SET', `bridge:member:${OLD_REPO}:${EMAIL}`, JSON.stringify(member('admin')));
  await redis.cmd('SET', `bridge:member:${NOW}:${EMAIL}`, JSON.stringify(member('edit')));
  await redis.cmd('SADD', `bridge:account:teams:${EMAIL}`, OLD_REPO, NOW, OLD_OWNER);
}

describe('server: one team per repository, by its current name', () => {
  it('the account set and the member store read through the old names, the higher role kept', async () => {
    const redis = memoryRedis(() => T0);
    await seedRenamed(redis);
    expect(await teamsInSet(redis, EMAIL)).toEqual([NOW]);
    expect((await memberStore(redis).get(NOW, EMAIL))?.role).toBe('admin');
    expect((await memberStore(redis).get(OLD_REPO, EMAIL))?.role).toBe('admin');
    expect(await teamInSet(redis, EMAIL, NOW)).toBe(true);
    // A team that is gone leaves the set under every name it had.
    await dropTeamFromSet(redis, EMAIL, NOW);
    expect(await redis.cmd('SMEMBERS', `bridge:account:teams:${EMAIL}`)).toEqual([]);
  });

  it('removing a member removes it under the old names too: it never comes back through the old key', async () => {
    const redis = memoryRedis(() => T0);
    await seedRenamed(redis);
    expect(await memberStore(redis).remove(NOW, EMAIL)).toBe(true);
    expect(await memberStore(redis).get(NOW, EMAIL)).toBeNull();
    expect(await teamsInSet(redis, EMAIL)).toEqual([]);
  });

  it('the GitHub teams list each repository once, by its current name, with the higher role', async () => {
    const redis = memoryRedis(() => T0);
    await redis.cmd('SET', `bridge:account:ghteams:${EMAIL}`, JSON.stringify({ [OLD_REPO]: { role: 'admin', at: T0 }, [NOW]: { role: 'edit', at: T0 }, [OLD_OWNER]: { role: 'edit', at: T0 } }));
    expect(await githubTeamsOf(redis, EMAIL, T0)).toEqual([{ repo: NOW, role: 'admin' }]);
  });

  it('GET /api/account: memberships under the old and new names and a GitHub team under an old owner are one team, Admin, current name', async () => {
    const redis = memoryRedis(() => T0);
    await seedRenamed(redis);
    await redis.cmd('SET', `bridge:account:ghteams:${EMAIL}`, JSON.stringify({ [OLD_OWNER]: { role: 'admin', at: T0 } }));
    await putAccount(redis, { id: 'a1', email: EMAIL, name: 'Flo', nameSet: true, github: { login: 'flo', id: 9 }, createdAt: '2026-10-01T00:00:00Z', version: 1 } as never);
    const cookie = `${ACCOUNT_COOKIE}=${signAccountSession({ email: EMAIL, v: 1, exp: T0 + 60_000 }, SECRET)}`;
    const r = await handleAccount(new Request(`${SITE}/api/account`, { headers: { host: HOST, cookie } }), { LIBRARY_SESSION_SECRET: SECRET }, { fetch: async () => res(404), now: () => T0, redis, members: memberStore(redis) });
    expect(r.status).toBe(200);
    const teams = (await r.json()).account.teams as { repo: string; role: string; via: string }[];
    expect(teams).toEqual([{ repo: NOW, name: expect.any(String), role: 'admin', via: 'email' }]);
  });
});

describe('grants: always made for the current name; older ones read as the current name', () => {
  const key = sealingKey(SECRET, 'mcp-connector-github-tokens')!;
  const client = { clientId: 'c1', clientName: 'Claude' };

  it('a grant picked by an old name is stored under the current one', async () => {
    const redis = memoryRedis(() => T0);
    const g = await createGrant(redis, key, { repo: OLD_REPO, client, login: '', name: 'Flo', email: EMAIL }, random, T0);
    expect(g.repo).toBe(NOW);
    expect(JSON.parse(String(await redis.cmd('GET', `bridge:oauth:grant:${g.id}`))).repo).toBe(NOW);
    expect(await redis.cmd('SMEMBERS', `bridge:oauth:grants:${NOW}`)).toEqual([g.id]);
    expect(await redis.cmd('SMEMBERS', `bridge:oauth:grants:${OLD_REPO}`)).toEqual([]);
  });

  it('a grant made before the rename is found, named and ended under the current name (no migration)', async () => {
    const redis = memoryRedis(() => T0);
    const g = await createGrant(redis, key, { repo: NOW, client, login: '', name: 'Flo', email: EMAIL }, random, T0);
    // As a grant written before the rename sits in Redis: its record and its set under the old name.
    await redis.cmd('SET', `bridge:oauth:grant:${g.id}`, JSON.stringify({ ...g, repo: OLD_REPO }));
    await redis.cmd('SREM', `bridge:oauth:grants:${NOW}`, g.id);
    await redis.cmd('SADD', `bridge:oauth:grants:${OLD_REPO}`, g.id);
    expect((await getGrant(redis, g.id))?.repo).toBe(NOW);
    expect((await listGrants(redis, NOW)).map((x) => [x.id, x.repo])).toEqual([[g.id, NOW]]);
    await revokeGrant(redis, (await getGrant(redis, g.id))!);
    expect(await redis.cmd('SMEMBERS', `bridge:oauth:grants:${OLD_REPO}`)).toEqual([]);
    expect(await getGrant(redis, g.id)).toBeNull();
  });
});

describe('the "Use Bridge in Claude" consent card', () => {
  it('lists the team once by its current name, with the higher role, and Allow stores the grant for it', async () => {
    const t = T0;
    const f: FetchLike = async () => res(404, {});
    const redis = memoryRedis(() => t);
    const env: ConnectorEnv = { LIBRARY_SESSION_SECRET: SECRET, GITHUB_APP_CLIENT_ID: 'Iv1.bridge', GITHUB_APP_CLIENT_SECRET: 'app-secret', PUBLIC_SITE_URL: SITE };
    const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
      handleConnector(new Request(`${SITE}${path}`, { method: init.method ?? 'GET', headers: { host: HOST, ...(init.headers ?? {}) }, ...(init.body !== undefined ? { body: init.body } : {}) }), env, { fetch: f, now: () => t, redis });
    const reg = await call('/api/mcp?oauth=register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) });
    const id = (await reg.json()).client_id as string;
    const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', state: 's', resource: `${SITE}/mcp`, scope: 'bridge' });
    const auth = await call(`/api/mcp?oauth=authorize&${q}`);
    const request = new URL(auth.headers.get('location')!, SITE).searchParams.get('request')!;
    const oauthCookie = /bridge_oauth=([^;]+)/.exec(auth.headers.get('set-cookie') ?? '')![1]!;
    await seedRenamed(redis);
    await putAccount(redis, { id: 'a1', email: EMAIL, name: 'Flo', createdAt: '2026-10-01T00:00:00Z', version: 1 } as never);
    const cookie = `bridge_oauth=${oauthCookie}; ${ACCOUNT_COOKIE}=${signAccountSession({ email: EMAIL, v: 1, exp: t + 60_000 }, SECRET)}`;
    const info = await (await call(`/api/mcp?oauth=request&id=${request}`, { headers: { cookie } })).json();
    expect(info.teams).toEqual([{ repo: NOW, name: expect.any(String), email: true, role: 'admin' }]);
    // Picked by an old name (a card rendered before the fix): the grant is still for the current one.
    const approve = await call('/api/mcp?oauth=approve', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, cookie }, body: JSON.stringify({ request, repo: OLD_REPO, allow: true, via: 'email' }) });
    expect(approve.status).toBe(200);
    const grants = await listGrants(redis, NOW);
    expect(grants.map((g) => g.repo)).toEqual([NOW]);
    expect(await redis.cmd('SMEMBERS', `bridge:oauth:grants:${OLD_REPO}`)).toEqual([]);
  });
});

describe('browser: recent teams, names, roles and the switcher', () => {
  const memStore = (init: Record<string, string>): RecentStore & { data: Record<string, string> } => {
    const data = { ...init };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
  };

  it('recent teams kept under an old name read as the current one, once', () => {
    expect(parseRecentTeams(JSON.stringify([OLD_REPO, NOW, OLD_OWNER, 'acme/design']))).toEqual([NOW, 'acme/design']);
    expect(pushRecentTeam([OLD_REPO, 'acme/design'], NOW)).toEqual([NOW, 'acme/design']);
    expect(removeRecentTeam([OLD_REPO, 'acme/design'], NOW)).toEqual(['acme/design']);
  });

  it('names and roles by the current name, the one noted under it winning', () => {
    expect(parseTeamNames(JSON.stringify({ [OLD_REPO]: 'Old name', [NOW]: 'Bridge DS' }))).toEqual({ [NOW]: 'Bridge DS' });
    expect(parseTeamNames(JSON.stringify({ [OLD_REPO]: 'Bridge DS' }))).toEqual({ [NOW]: 'Bridge DS' });
    const store = memStore({ 'bridge.recentTeams': JSON.stringify([OLD_REPO]), 'bridge.teamRoles': JSON.stringify({ [OLD_REPO]: 'Admin' }), 'bridge.teamNames': JSON.stringify({ [OLD_REPO]: 'Bridge DS' }) });
    expect(loadRecentTeams(store)).toEqual([NOW]);
    expect(loadTeamRoles(store)).toEqual({ [NOW]: 'Admin' });
    expect(knownTeamName(NOW, store)).toBe('Bridge DS');
    forgetTeamEverywhere(NOW, store);
    expect(store.data['bridge.teamRoles']).toBeUndefined();
    expect(store.data['bridge.teamNames']).toBeUndefined();
  });

  it('"Your teams" and the pickers: a team opened under its old name and the account\'s team under the new one are one row, current name, higher role', () => {
    const recent = parseRecentTeams(JSON.stringify([OLD_REPO]));
    const teams = pickableTeams({
      account: [{ repo: NOW, name: 'Bridge DS', role: 'edit' }],
      recent: [...recent, OLD_OWNER],
      roles: { [NOW]: 'Admin', [OLD_OWNER]: 'Admin' },
      names: { [NOW]: 'Bridge DS' },
      site: { repo: OLD_REPO, role: 'Admin', name: 'Bridge DS' },
    });
    expect(teams).toEqual([{ repo: NOW, name: 'Bridge DS', role: 'Admin' }]);
    // Raw sources still holding the old names (a list not read through parseRecentTeams) dedupe the same way.
    expect(pickableTeams({ account: [{ repo: NOW, name: 'Bridge DS', role: 'edit' }], recent: [OLD_REPO], roles: { [OLD_REPO]: 'Can edit' }, names: {}, needsRepository: true })).toEqual([{ repo: NOW, name: 'Bridge DS', role: 'Can edit' }]);
  });
});
