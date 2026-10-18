import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadConfig } from '../src/config';
import { type FetchLike, GitHubClient } from '../src/github-client';
import { approverLists, canShip, DEFAULT_RIGHTS, normalizeRights, shipPolicy, unreadableShipTeams, whoCanShipSentence } from '../src/rights';
import {
  entriesFor,
  entryLabel,
  expandEntries,
  expandOwners,
  formatOwnerEntry,
  isTeamEntry,
  ownerEntryProblems,
  parseOwnerEntry,
  TeamDirectory,
  teamsIn,
  teamUnreadableMessage,
  type TeamStates,
} from '../src/teams';

// ---------------------------------------------------------------------------------------------------------------
// Parsing

test('an owner entry is a person or a team, with or without @', () => {
  assert.deepEqual(parseOwnerEntry('peterbono'), { kind: 'person', login: 'peterbono' });
  assert.deepEqual(parseOwnerEntry('@peterbono'), { kind: 'person', login: 'peterbono' });
  assert.deepEqual(parseOwnerEntry(' @acme/design-team '), { kind: 'team', org: 'acme', slug: 'design-team' });
  assert.deepEqual(parseOwnerEntry('acme/web_v2.core'), { kind: 'team', org: 'acme', slug: 'web_v2.core' });
  for (const bad of ['', '@', '-x', 'x-', 'a--b', 'acme/', '/design', '@acme/design/extra', 'a b', 'x'.repeat(40), '@acme/-design']) assert.equal(parseOwnerEntry(bad), null, bad);
  assert.equal(formatOwnerEntry(parseOwnerEntry('acme/design')!), '@acme/design');
  assert.equal(formatOwnerEntry(parseOwnerEntry('@dana')!), 'dana');
  assert.equal(isTeamEntry('@acme/design'), true);
  assert.equal(isTeamEntry('dana'), false);
});

test('malformed owner entries get a clear error naming both forms', () => {
  assert.deepEqual(ownerEntryProblems(undefined), []);
  assert.deepEqual(ownerEntryProblems({ design: ['dana', '@acme/design'], tech: [] }), []);
  const p = ownerEntryProblems({ design: ['dana', 'acme/'], tech: [42], pm: [] });
  assert.equal(p.length, 3);
  assert.match(p[0]!, /governance\.owners\.design\[1\].*"acme\/".*"@org\/team-slug"/);
  assert.match(p[1]!, /governance\.owners\.tech\[0\]/);
  assert.match(p[2]!, /governance\.owners\.pm" is not an owner group/);
  assert.match(ownerEntryProblems(['dana'])[0]!, /must be \{ "design"/);
  assert.throws(() => loadConfig({ governance: { owners: { design: ['@acme/'], tech: [] } } } as never), /governance\.owners\.design\[0\]/);
  assert.deepEqual(loadConfig({ governance: { owners: { design: ['@acme/design'], tech: ['theo'] } } }).governance.owners, { design: ['@acme/design'], tech: ['theo'] });
});

// ---------------------------------------------------------------------------------------------------------------
// Pure expansion

const ok = (org: string, slug: string, members: string[]) => ({ key: `@${org}/${slug}`, org, slug, status: 'ok' as const, members });
const cannot = (org: string, slug: string) => ({ key: `@${org}/${slug}`, org, slug, status: 'unreadable' as const, reason: 'missing-permission' as const, message: teamUnreadableMessage({ org, slug }, 'missing-permission') });

test('teams expand to members; unread or unreadable teams keep their place and match nobody', () => {
  const owners = { design: ['@Acme/Design', 'dana'], tech: ['@acme/web', '@theo'] };
  assert.deepEqual(teamsIn(owners).map((t) => t.key), ['@acme/design', '@acme/web']);
  const teams: TeamStates = { '@acme/design': ok('acme', 'design', ['ana', 'Dana', 'bo']), '@acme/web': cannot('acme', 'web') };
  assert.deepEqual(expandEntries(owners.design, teams), ['ana', 'Dana', 'bo']);
  assert.deepEqual(expandOwners(owners, teams), { design: ['ana', 'Dana', 'bo'], tech: ['@acme/web', 'theo'] });
  assert.deepEqual(expandEntries(owners.design), ['@acme/design', 'dana']);
  assert.equal(entryLabel('@acme/design', teams), '@acme/design (3 people)');
  assert.equal(entryLabel('@acme/design', { '@acme/design': ok('acme', 'design', ['x']) }), '@acme/design (1 person)');
  assert.equal(entryLabel('@acme/web', teams), '@acme/web');
  assert.equal(entryLabel('dana'), '@dana');
  // Who can still act: a team is named when a member can, or when its members are unknown.
  assert.deepEqual(entriesFor(['@acme/design', 'zed'], ['bo'], teams), ['@acme/design (3 people)']);
  assert.deepEqual(entriesFor(['@acme/design', 'zed'], ['zed'], teams), ['@zed']);
  assert.deepEqual(entriesFor(['@acme/web'], [], teams), ['@acme/web']);
});

test('gate with teams: a member ships, an outsider does not, an unreadable team never opens the gate', () => {
  const owners = { design: ['@acme/design'], tech: ['@acme/web'] };
  const teams: TeamStates = { '@acme/design': ok('acme', 'design', ['ana', 'bo']), '@acme/web': ok('acme', 'web', ['theo', 'tara', 'ty', 'tom']) };
  const p = shipPolicy(owners, DEFAULT_RIGHTS, teams)!;
  assert.equal(canShip('tara', p), true);
  assert.equal(canShip('ana', p), false);
  assert.equal(whoCanShipSentence(p), 'Only the tech owner can ship this (@acme/web (4 people)).');
  assert.deepEqual(approverLists(owners, DEFAULT_RIGHTS, teams), { design: ['ana', 'bo'], tech: ['theo', 'tara', 'ty', 'tom'] });

  const blind = shipPolicy(owners, DEFAULT_RIGHTS, { '@acme/web': cannot('acme', 'web') })!;
  assert.notEqual(blind, null, 'an unreadable team still holds the right');
  assert.equal(canShip('theo', blind), false);
  assert.equal(canShip('acme/web', blind), false, 'nobody matches the place a team holds');
  assert.equal(whoCanShipSentence(blind), 'Only the tech owner can ship this (@acme/web).');
  assert.deepEqual(unreadableShipTeams(blind).map((t) => t.key), ['@acme/web']);
  // Without team states (not read yet), the same: the team holds its place.
  assert.deepEqual(shipPolicy(owners, normalizeRights({ ship: ['design', 'tech'] }))!.logins, ['@acme/design', '@acme/web']);
});

// ---------------------------------------------------------------------------------------------------------------
// GitHub reads, mocked

function github(routes: Record<string, { status?: number; body: unknown } | ((url: string) => { status?: number; body: unknown })>) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    calls.push(`${method} ${path}`);
    const key = `${method} ${path.replace(/[?&]per_page=100&page=\d+$/, '')}`;
    const r = routes[key];
    const route = typeof r === 'function' ? r(path) : r;
    const status = route ? (route.status ?? 200) : 404;
    const body = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}
const noRetry = { attempts: 1, baseDelayMs: 0, sleep: async () => undefined };

test('members are read across pages and cached', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ login: `m${i}` }));
  const { calls, fetchImpl } = github({
    'GET /orgs/acme/teams/design/members': (url) => ({ body: /page=1$/.test(url) ? page1 : [{ login: 'last' }] }),
  });
  let now = 0;
  const dir = new TeamDirectory(new GitHubClient('acme/ds', 't', fetchImpl, noRetry), { ttlMs: 1000, now: () => now });
  const [a, b] = await Promise.all([dir.team('acme', 'design'), dir.team('ACME', 'Design')]);
  assert.equal(a.status, 'ok');
  assert.equal(a.status === 'ok' && a.members.length, 101);
  assert.equal(b, a);
  assert.deepEqual(calls, ['GET /orgs/acme/teams/design/members?per_page=100&page=1', 'GET /orgs/acme/teams/design/members?per_page=100&page=2']);
  await dir.team('acme', 'design');
  assert.equal(calls.length, 2, 'cached');
  now = 2000;
  await dir.team('acme', 'design');
  assert.equal(calls.length, 4, 'read again after the ttl');
  // A membership check uses the cached list: no request.
  assert.equal(await dir.isMember('acme', 'design', 'M5'), true);
  assert.equal(calls.length, 4);
});

test('cannot read a team: typed reasons, never an empty list', async () => {
  const { fetchImpl } = github({
    'GET /orgs/acme/teams/design/members': { status: 403, body: { message: 'Resource not accessible by personal access token' } },
    'GET /orgs/acme/teams/ghost/members': { status: 404, body: { message: 'Not Found' } },
    'GET /users/acme': { body: { type: 'Organization' } },
    'GET /orgs/peterbono/teams/design/members': { status: 404, body: { message: 'Not Found' } },
    'GET /users/peterbono': { body: { type: 'User' } },
    'GET /orgs/acme/teams/flaky/members': { status: 502, body: { message: 'Bad gateway' } },
  });
  const dir = new TeamDirectory(new GitHubClient('acme/ds', 't', fetchImpl, noRetry));
  const states = await dir.resolve({ design: ['@acme/design', '@acme/ghost', '@peterbono/design', '@acme/flaky'], tech: ['dana'] });
  const reason = (k: string) => (states[k]?.status === 'unreadable' ? states[k].reason : states[k]?.status);
  assert.equal(reason('@acme/design'), 'missing-permission');
  assert.equal(reason('@acme/ghost'), 'not-found');
  assert.equal(reason('@peterbono/design'), 'personal-account');
  assert.equal(reason('@acme/flaky'), 'unreachable');
  const msg = (k: string) => (states[k]?.status === 'unreadable' ? states[k].message : '');
  assert.match(msg('@acme/design'), /read:org/);
  assert.match(msg('@peterbono/design'), /personal GitHub account/);
  assert.deepEqual(expandEntries(['@acme/design'], states), ['@acme/design']);

  // No token: no team request at all, and the reason says to connect.
  const anon = github({ 'GET /users/acme': { body: { type: 'Organization' } }, 'GET /users/peterbono': { body: { type: 'User' } } });
  const anonDir = new TeamDirectory(new GitHubClient('acme/ds', '', anon.fetchImpl, noRetry));
  const s = await anonDir.resolve(['@acme/design', '@peterbono/x']);
  assert.equal(s['@acme/design']!.status === 'unreadable' && s['@acme/design']!.reason, 'no-token');
  assert.equal(s['@peterbono/x']!.status === 'unreadable' && s['@peterbono/x']!.reason, 'personal-account');
  assert.ok(!anon.calls.some((c) => c.includes('/teams/')));
  // No team named: no request.
  assert.deepEqual(await anonDir.resolve({ design: ['dana'], tech: [] }), {});
});

test('membership check for the gate: one read per person, people match without a request', async () => {
  const { calls, fetchImpl } = github({
    'GET /orgs/acme/teams/web/memberships/tara': { body: { state: 'active' } },
    'GET /orgs/acme/teams/web/memberships/pat': { body: { state: 'pending' } },
    'GET /orgs/acme/teams/design/memberships/tara': { status: 403, body: { message: 'Resource not accessible by personal access token' } },
  });
  const dir = new TeamDirectory(new GitHubClient('acme/ds', 't', fetchImpl, noRetry));
  assert.deepEqual(await dir.memberOfAny(['dana', '@acme/web'], 'Dana'), { member: true, unreadable: [] });
  assert.equal(calls.length, 0);
  assert.equal((await dir.memberOfAny(['@acme/web'], 'tara')).member, true);
  assert.equal((await dir.memberOfAny(['@acme/web'], 'pat')).member, false, 'a pending invitation does not count');
  assert.equal((await dir.memberOfAny(['@acme/web'], 'zed')).member, false, '404: not a member');
  const r = await dir.memberOfAny(['@acme/design'], 'tara');
  assert.equal(r.member, false);
  assert.equal(r.unreadable[0]?.status === 'unreadable' && r.unreadable[0].reason, 'missing-permission');
  const before = calls.length;
  await dir.memberOfAny(['@acme/web'], 'tara');
  assert.equal(calls.length, before, 'cached');
});

test('org teams for the picker, or why not', async () => {
  const { fetchImpl } = github({
    'GET /users/acme': { body: { type: 'Organization' } },
    'GET /orgs/acme/teams': { body: [{ slug: 'design', name: 'Design' }] },
    'GET /users/peterbono': { body: { type: 'User' } },
  });
  const dir = new TeamDirectory(new GitHubClient('acme/ds', 't', fetchImpl, noRetry));
  assert.deepEqual(await dir.orgTeams('acme'), { status: 'ok', teams: [{ slug: 'design', name: 'Design' }] });
  assert.deepEqual(await dir.orgTeams('peterbono'), { status: 'unreadable', reason: 'personal-account' });
});
