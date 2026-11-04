// Reads through Bridge (api/_lib/team-read.ts, wired in api/contribute): who may read, the allow-list, the read-only
// token, the cache (fresh, revalidated, stale on GitHub's limit, cleared by a write), the limits and the blob batch.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_COOKIE, putAccount, signAccountSession } from '../../api/_lib/account';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { sha256 } from '../../api/_lib/http';
import { clearReadMemory, countKey, memberBudgetId, FRESH_MS, immutable, KEEP_S, MAX_BATCH, MAX_CHANGES, isPublicTeam, readAllowed, READ_LIMITS, READ_WORDS } from '../../api/_lib/team-read';
import { restoreMissing } from './contribute';
import { type ContribDeps, cookieName, type FetchLike, handleContribute, signSession } from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-10-23T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const TEAM = 'acme/design';
const DEMO = 'peterbono/bridge-demo-ds';
const SHA = (c: string) => c.repeat(40);

interface Seen {
  method: string;
  path: string;
  auth: string;
  headers: Record<string, string>;
}

interface World {
  calls: Seen[];
  /** What GitHub says about each repository's visibility. */
  private: Record<string, boolean>;
  /** Blob bodies by sha. */
  blobs: Record<string, string>;
  /** Pulls list version (its ETag changes with it). */
  pulls: number;
  /** GitHub's hourly limit is used up. */
  limited: boolean;
  /** bridge.config.json text by repository (lower case); none: GitHub's 404. */
  configs?: Record<string, string>;
  /** Repositories the Bridge app is not installed on (lower case). */
  noApp?: string[];
}

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    expect(u.origin).toBe('https://api.github.com');
    w.calls.push({ method: init.method, path: u.pathname + u.search, auth: init.headers.Authorization ?? '', headers: init.headers });
    if (w.limited) return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(T0 / 1000) + 300) } });
    const user = /^\/users\/([^/]+)$/.exec(u.pathname);
    if (user) {
      const login = decodeURIComponent(user[1]!);
      if (login === 'ghost') return Response.json({ message: 'Not Found' }, { status: 404 });
      return Response.json({ login: login === 'dana' ? 'Dana' : login, name: login === 'dana' ? 'Dana Whitfield' : null, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4`, type: 'User', email: 'dana@private.example', company: 'Acme', location: 'Lyon', bio: 'secret' });
    }
    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m) return new Response('{}', { status: 404 });
    const rest = m[2] ?? '';
    if (rest === '') return Response.json({ full_name: m[1], default_branch: 'main', private: w.private[m[1]!.toLowerCase()] ?? true });
    if (rest === '/pulls') {
      const etag = `"p${w.pulls}"`;
      if (init.headers['If-None-Match'] === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      return Response.json([{ number: w.pulls }], { headers: { ETag: etag, Link: '<x>; rel="next"' } });
    }
    if (rest === '/contents/bridge.config.json') {
      const text = w.configs?.[m[1]!.toLowerCase()];
      return text === undefined ? Response.json({ message: 'Not Found' }, { status: 404 }) : new Response(text, { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } });
    }
    if (rest.startsWith('/contents/snapshot.json')) return Response.json({ message: 'Not Found' }, { status: 404 });
    const b = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
    if (b) return w.blobs[b[1]!] !== undefined ? new Response(w.blobs[b[1]!], { status: 200, headers: { 'Content-Type': 'application/vnd.github.raw' } }) : Response.json({ message: 'Not Found' }, { status: 404 });
    return Response.json({ ok: rest }, { headers: { ETag: '"x"' } });
  };
}

function setup(world: Partial<World> = {}, env: Record<string, string> = {}) {
  clearReadMemory();
  const w: World = { calls: [], private: { [DEMO]: false }, blobs: {}, pulls: 1, limited: false, ...world };
  let now = T0;
  const redis = memoryRedis(() => now);
  const tokens: string[] = [];
  const deps: ContribDeps = {
    fetch: github(w),
    now: () => now,
    redis,
    app: {
      installationToken: async (owner, repo) => {
        tokens.push(`${owner}/${repo}`);
        if (w.noApp?.includes(`${owner}/${repo}`.toLowerCase())) return null;
        return 'ghs_read';
      },
    },
  };
  const members = memberStore(redis);
  /** A member's team cookie. */
  const member = async (email = 'mia@acme.design', repo = TEAM) => {
    await members.put(repo, { email, name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at: new Date(now).toISOString() });
    return `${cookieName(repo)}=${signSession({ repo, email, name: 'Mia', v: 1, exp: now + 1e9 }, SECRET)}`;
  };
  /** A Bridge account's cookie, its teams in its set. */
  const account = async (email: string, teams: string[]) => {
    await putAccount(redis, { id: 'a1', email, name: 'Sam', github: null, createdAt: new Date(now).toISOString(), version: 1 });
    if (teams.length) await redis.cmd('SADD', `bridge:account:teams:${email}`, ...teams);
    return `${ACCOUNT_COOKIE}=${signAccountSession({ email, v: 1, exp: now + 1e9 }, SECRET)}`;
  };
  const env2 = { ...ENV, ...env };
  const read = (path: string, cookie = '', repo = TEAM, extra: Record<string, string> = {}) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(repo)}&gh=${encodeURIComponent(path)}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...(cookie ? { cookie } : {}), ...extra } }), env2, deps);
  const blobs = (shas: string[], cookie = '', repo = TEAM) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(repo)}&blobs=${shas.join(',')}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...(cookie ? { cookie } : {}) } }), env2, deps);
  const users = (logins: string[], cookie = '', repo = TEAM) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(repo)}&users=${logins.join(',')}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...(cookie ? { cookie } : {}) } }), env2, deps);
  const changes = (list: string[], cookie = '', repo = TEAM) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(repo)}&changes=${list.join(',')}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...(cookie ? { cookie } : {}) } }), env2, deps);
  return { w, redis, deps, member, account, read, blobs, users, changes, tokens, tick: (ms: number) => (now += ms) };
}

const P = `/repos/${TEAM}`;
const D = `/repos/${DEMO}`;
const gets = (w: World, path: string) => w.calls.filter((c) => c.path === path).length;

describe('team reads: who', () => {
  it('reads for a member (team cookie) with the read token, never passing the cookie or the token back', async () => {
    const s = setup();
    const r = await s.read(`${P}/pulls`, await s.member());
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual([{ number: 1 }]);
    expect(text).not.toContain('ghs_read');
    expect(r.headers.get('etag')).toBe('"p1"');
    expect(r.headers.get('link')).toContain('rel="next"');
    const sent = s.w.calls.find((c) => c.path === `${P}/pulls`)!;
    expect(sent.auth).toBe('Bearer ghs_read');
    expect(JSON.stringify(sent.headers)).not.toMatch(/bridge_contrib|bridge_account|cookie/i);
    expect([...r.headers.keys()].join(' ')).not.toMatch(/authorization|x-ratelimit/i);
  });

  it('reads for a Bridge account that belongs to the team (its team set), not for one that does not', async () => {
    const s = setup();
    expect((await s.read(`${P}/pulls`, await s.account('sam@acme.design', [TEAM]))).status).toBe(200);
    const other = await s.account('eve@evil.example', ['evil/ds']);
    const r = await s.read(`${P}/pulls`, other);
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe('signin');
  });

  it('a member of one team cannot read another team', async () => {
    const s = setup();
    const cookie = await s.member('mia@acme.design', TEAM);
    expect((await s.read('/repos/acme/secret/pulls', cookie, 'acme/secret')).status).toBe(401);
    // The path must be the team's own repository.
    expect((await s.read('/repos/acme/secret/pulls', cookie, TEAM)).status).toBe(403);
    expect(s.w.calls.some((c) => c.path.includes('secret'))).toBe(false);
  });

  it('anyone reads a public demo team, only while GitHub says it is public; any other team needs a member', async () => {
    const s = setup();
    expect((await s.read(`${D}/pulls`, '', DEMO)).status).toBe(200);
    expect((await s.read(`${P}/pulls`)).status).toBe(401);
    const priv = setup({ private: { [DEMO]: true } });
    expect((await priv.read(`${D}/pulls`, '', DEMO)).status).toBe(401);
  });

  it('a visitor of the demo team never lists its collaborators; a member does', async () => {
    const s = setup();
    expect((await s.read(`${D}/collaborators?affiliation=all`, '', DEMO)).status).toBe(403);
    expect((await s.read(`${P}/collaborators?affiliation=all`, await s.member())).status).toBe(200);
  });

  it('says when the app cannot read the repository', async () => {
    const s = setup();
    s.deps.app = { installationToken: async () => null };
    const r = await s.read(`${P}/pulls`, await s.member());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('app_missing');
  });
});

describe('team reads: a missing file', () => {
  it('answers a 404 as a 200 "missing" result when the page asks (no console error), and a 404 otherwise', async () => {
    const s = setup();
    const cookie = await s.member();
    const path = `${P}/contents/snapshot.json?ref=bridge-data`;
    const asked = await s.read(path, cookie, TEAM, { 'x-bridge-missing': '1' });
    expect(asked.status).toBe(200);
    expect(asked.headers.get('x-bridge-missing')).toBe('1');
    expect(await asked.json()).toEqual({ message: 'Not Found' });
    const back = restoreMissing(await s.read(path, cookie, TEAM, { 'x-bridge-missing': '1' }));
    expect(back.status).toBe(404);
    expect(await back.json()).toEqual({ message: 'Not Found' });
    // From the cache too, and as GitHub said it for a caller that did not ask.
    expect(gets(s.w, path)).toBe(1);
    const plain = await s.read(path, cookie);
    expect(plain.status).toBe(404);
    expect(plain.headers.get('x-bridge-missing')).toBeNull();
    // A file that is there is never marked.
    const there = await s.read(`${P}/contents/llms.txt?ref=bridge-data`, cookie, TEAM, { 'x-bridge-missing': '1' });
    expect(there.status).toBe(200);
    expect(there.headers.get('x-bridge-missing')).toBeNull();
    expect(restoreMissing(there)).toBe(there);
  });
});

describe('team reads: the allow-list', () => {
  it("keeps Bridge's own repository public under its old and new name", () => {
    expect(isPublicTeam('the-bridge-company/ai-design-system-demo')).toBe(true);
    expect(isPublicTeam('peterbono/ai-design-system-demo')).toBe(true);
    expect(isPublicTeam('Peterbono/AI-Design-System-Demo')).toBe(true);
    expect(isPublicTeam('peterbono/bridge-demo-ds')).toBe(true);
    expect(isPublicTeam('acme/ds')).toBe(false);
  });

  it('allows what Studio reads and refuses the rest without calling GitHub', async () => {
    const s = setup();
    const cookie = await s.member();
    for (const ok of ['', '/pulls/3/files?per_page=100', '/issues/4/timeline', '/contents/tokens/a.json?ref=main', `/git/trees/${SHA('a')}?recursive=1`, '/git/ref/heads/bridge/x', '/compare/main...bridge/x', '/commits/abc/status', '/branches/bridge/x', '/rulesets', '/actions/jobs/42']) {
      expect((await s.read(`${P}${ok}`, cookie)).status, ok).toBe(200);
    }
    const before = s.w.calls.length;
    for (const bad of ['/hooks', '/keys', '/invitations', '/actions/secrets', '/environments', '/traffic/views', '/collaborators/x/permission', '/pulls/x', '/pulls/3/merge/x', '/git/blobs', '/../other']) {
      const r = await s.read(`${P}${bad}`, cookie);
      expect(r.status, bad).toBe(403);
    }
    expect((await s.read('/user', cookie)).status).toBe(403);
    expect((await s.read('/graphql', cookie)).status).toBe(403);
    expect(s.w.calls.length).toBe(before);
  });

  it('is a pure rule: members-only resources and shapes', () => {
    expect(readAllowed(['collaborators'], { kind: 'guest' })).toBe(false);
    expect(readAllowed(['collaborators'], { kind: 'member' })).toBe(true);
    expect(readAllowed(['pulls', '12', 'reviews'], { kind: 'guest' })).toBe(true);
    expect(readAllowed(['pulls', '12', 'reviews', 'x'], { kind: 'guest' })).toBe(false);
    expect(readAllowed(['settings'], { kind: 'member' })).toBe(false);
    expect(immutable(['git', 'blobs', SHA('a')], '')).toBe(true);
    expect(immutable(['contents', 'a.json'], `ref=${SHA('b')}`)).toBe(true);
    expect(immutable(['contents', 'a.json'], 'ref=main')).toBe(false);
  });

  it('never writes: other verbs without an email session are refused before GitHub, and need the CSRF header', async () => {
    const s = setup();
    const before = s.w.calls.length;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${DEMO}&gh=${encodeURIComponent(`${D}/pulls`)}`, { method, headers: { host: HOST } }), ENV, s.deps);
      expect(r.status, method).toBe(403);
      const r2 = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${DEMO}&gh=${encodeURIComponent(`${D}/pulls`)}`, { method, headers: { host: HOST, origin: ORIGIN, 'x-bridge-contribute': '1', 'content-type': 'application/json' }, body: '{}' }), ENV, s.deps);
      expect(r2.status, method).toBe(401);
    }
    expect(s.w.calls.length).toBe(before);
  });
});

describe('team reads: the cache', () => {
  it('answers from the cache while fresh, then revalidates with the ETag (304), and answers 304 to a matching If-None-Match', async () => {
    const s = setup();
    const cookie = await s.member();
    expect((await s.read(`${P}/pulls`, cookie)).headers.get('x-bridge-cache')).toBe('miss');
    const hit = await s.read(`${P}/pulls`, cookie);
    expect(hit.headers.get('x-bridge-cache')).toBe('hit');
    expect(await hit.json()).toEqual([{ number: 1 }]);
    expect(gets(s.w, `${P}/pulls`)).toBe(1);
    s.tick(FRESH_MS + 1);
    const again = await s.read(`${P}/pulls`, cookie);
    expect(again.headers.get('x-bridge-cache')).toBe('revalidated');
    expect(s.w.calls.filter((c) => c.path === `${P}/pulls`).pop()!.headers['If-None-Match']).toBe('"p1"');
    expect(await again.json()).toEqual([{ number: 1 }]);
    const nm = await s.read(`${P}/pulls`, cookie, TEAM, { 'if-none-match': '"p1"' });
    expect(nm.status).toBe(304);
    // Another member, another address: the same kept answer.
    expect((await s.read(`${P}/pulls`, await s.member('leo@acme.design'), TEAM, { 'x-real-ip': '198.51.100.1' })).headers.get('x-bridge-cache')).toBe('hit');
  });

  it('a write through Bridge makes kept answers be checked again at once', async () => {
    const s = setup();
    const cookie = await s.member();
    await s.read(`${P}/pulls`, cookie);
    s.w.pulls = 2;
    s.tick(1000);
    await s.redis.cmd('SET', `bridge:read:wrote:${TEAM}`, String(T0 + 1000));
    const r = await s.read(`${P}/pulls`, cookie);
    expect(r.headers.get('x-bridge-cache')).toBe('miss');
    expect(await r.json()).toEqual([{ number: 2 }]);
  });

  it('serves what it kept when GitHub says slow down, and says Bridge is busy when it kept nothing', async () => {
    const s = setup();
    const cookie = await s.member();
    await s.read(`${P}/pulls`, cookie);
    s.tick(FRESH_MS + 1);
    s.w.limited = true;
    const stale = await s.read(`${P}/pulls`, cookie);
    expect(stale.status).toBe(200);
    expect(stale.headers.get('x-bridge-cache')).toBe('stale');
    const r = await s.read(`${P}/issues`, cookie);
    expect(r.status).toBe(429);
    // GitHub's reset is 300 s after T0, and 30 s went by.
    expect(r.headers.get('retry-after')).toBe('270');
    const body = await r.json();
    expect(body).toMatchObject({ error: 'busy', message: 'Bridge is busy, try again in 5 min.', retryAfter: 270 });
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it('keeps the ETag a day: an answer read long ago is revalidated (free 304), never answered without GitHub past KEEP_S', async () => {
    const s = setup();
    const cookie = await s.member();
    await s.read(`${P}/pulls`, cookie);
    s.tick(6 * 3600 * 1000);
    const again = await s.read(`${P}/pulls`, cookie);
    expect(again.headers.get('x-bridge-cache')).toBe('revalidated');
    expect(s.w.calls.filter((c) => c.path === `${P}/pulls`).pop()!.headers['If-None-Match']).toBe('"p1"');
    const kept = s.redis.snapshot().find((k) => k.key.startsWith(`bridge:read:get:${TEAM}:`))!;
    expect(kept.until! - (T0 + 6 * 3600 * 1000)).toBeGreaterThan(KEEP_S * 1000);
    // GitHub slows down: confirmed KEEP_S ago or less stands in; older is busy, not a stale answer.
    s.w.limited = true;
    s.tick(FRESH_MS + 1);
    expect((await s.read(`${P}/pulls`, cookie)).headers.get('x-bridge-cache')).toBe('stale');
    s.tick(KEEP_S * 1000);
    expect((await s.read(`${P}/pulls`, cookie)).status).toBe(429);
  });

  it('makes one GitHub call for concurrent misses of the same answer', async () => {
    const s = setup();
    const cookies = await Promise.all(['a', 'b', 'c', 'd'].map((x) => s.member(`${x}@acme.design`)));
    const rs = await Promise.all(cookies.map((c) => s.read(`${P}/pulls`, c)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(gets(s.w, `${P}/pulls`)).toBe(1);
    // Only the call made counts: on the team's GitHub calls once.
    expect(Number(await s.redis.cmd('GET', `bridge:read:count:team:${TEAM}:${Math.floor(T0 / 1000 / 600)}`))).toBe(1);
    const bs = await Promise.all(cookies.map((c) => s.blobs([SHA('e')], c)));
    expect(bs.every((r) => r.status === 200)).toBe(true);
    expect(s.w.calls.filter((c) => c.path.endsWith(`/git/blobs/${SHA('e')}`))).toHaveLength(1);
  });

  it('keeps answers that never change in memory: a tree by its sha costs one GitHub call', async () => {
    const s = setup();
    const cookie = await s.member();
    const path = `${P}/git/trees/${SHA('d')}?recursive=1`;
    await s.read(path, cookie);
    s.tick(24 * 3600 * 1000 - 1000);
    await s.read(path, cookie);
    expect(gets(s.w, path)).toBe(1);
  });
});

describe('team reads: limits', () => {
  it('over the limit per member, 429 busy with Retry-After, in Bridge words', async () => {
    const s = setup({}, { READ_MAX_IP: '3' });
    const cookie = await s.member();
    for (let i = 0; i < 3; i++) expect((await s.read(`${P}/pulls`, cookie)).status).toBe(200);
    const r = await s.read(`${P}/pulls`, cookie);
    expect(r.status).toBe(429);
    const body = await r.json();
    expect(body.error).toBe('busy');
    expect(body.message).toMatch(/^Bridge is busy, try again in \d+ min\.$/);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    // The budget is the member's: another address does not give them more.
    expect((await s.read(`${P}/pulls`, cookie, TEAM, { 'x-real-ip': '198.51.100.7' })).status).toBe(429);
  });

  it('counts per signed-in member, not per address: a busy office on one address keeps reading', async () => {
    const s = setup({}, { READ_MAX_IP: '3' });
    const mia = await s.member('mia@acme.design');
    const leo = await s.member('leo@acme.design');
    const sam = await s.account('sam@acme.design', [TEAM]);
    // Same address (203.0.113.9) for all three.
    for (let i = 0; i < 3; i++) expect((await s.read(`${P}/pulls`, mia)).status).toBe(200);
    expect((await s.read(`${P}/pulls`, mia)).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await s.read(`${P}/pulls`, leo)).status).toBe(200);
    expect((await s.read(`${P}/pulls`, leo)).status).toBe(429);
    // A Bridge account counts as its email, whatever the cookie: the team cookie and the account share one budget.
    for (let i = 0; i < 3; i++) expect((await s.read(`${P}/pulls`, sam)).status).toBe(200);
    expect((await s.read(`${P}/pulls`, sam)).status).toBe(429);
    // A blob batch counts on the same budget.
    expect((await s.blobs([SHA('a')], mia)).status).toBe(429);
    // Keys never hold an email or an address.
    const keys = s.redis.keys().filter((k) => k.startsWith('bridge:read:count:'));
    expect(keys.some((k) => k.startsWith('bridge:read:count:member:'))).toBe(true);
    expect(keys.join(' ')).not.toMatch(/@|203\.0\.113/);
  });

  it('a signed-out visitor of a demo team still counts per address', async () => {
    const s = setup({}, { READ_MAX_GUEST: '1' });
    expect((await s.read(`${D}/pulls`, '', DEMO)).status).toBe(200);
    expect((await s.read(`${D}/pulls`, '', DEMO)).status).toBe(429);
    expect((await s.read(`${D}/pulls`, '', DEMO, { 'x-real-ip': '198.51.100.9' })).status).toBe(200);
  });

  it('visitors of a demo team have a lower limit per address', async () => {
    expect(READ_LIMITS.guest).toBeLessThan(READ_LIMITS.ip);
    const s = setup({}, { READ_MAX_GUEST: '2' });
    expect((await s.read(`${D}/pulls`, '', DEMO)).status).toBe(200);
    expect((await s.read(`${D}/pulls`, '', DEMO)).status).toBe(200);
    expect((await s.read(`${D}/pulls`, '', DEMO)).status).toBe(429);
    expect((await s.read(`${D}/pulls`, '', DEMO, { 'x-real-ip': '198.51.100.2' })).status).toBe(200);
    expect(READ_WORDS.busy(30)).toBe('Bridge is busy, try again in 1 min.');
  });

  it("every team has its own cap of GitHub calls, never of cached answers: many readers of kept answers are never busy", async () => {
    const s = setup({}, { READ_MAX_TEAM: '2' });
    const people = await Promise.all(Array.from({ length: 30 }, (_, i) => s.member(`p${i}@acme.design`)));
    // Two misses spend the team's two GitHub calls.
    expect((await s.read(`${P}/pulls`, people[0])).status).toBe(200);
    expect((await s.read(`${P}/issues`, people[0])).status).toBe(200);
    // Thirty people reading what is kept: hits, never busy.
    for (const c of people) for (let i = 0; i < 5; i++) expect((await s.read(`${P}/pulls`, c)).headers.get('x-bridge-cache')).toBe('hit');
    // A third answer would cost GitHub a call: busy until the window turns.
    const r = await s.read(`${P}/labels`, people[1]);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('busy');
    // Past the fresh window, what is kept stands in.
    s.tick(FRESH_MS + 1);
    expect((await s.read(`${P}/pulls`, people[2])).headers.get('x-bridge-cache')).toBe('stale');
    // Another team is not touched.
    const other = await s.member('zoe@other.design', 'other/ds');
    expect((await s.read('/repos/other/ds/labels', other, 'other/ds')).status).toBe(200);
  });
});

describe('team reads: blobs at once', () => {
  it('returns many blobs in one call, from GitHub once, then from the cache; unknown ones are null', async () => {
    const s = setup({ blobs: { [SHA('a')]: '{"a":1}', [SHA('b')]: 'B' } });
    const cookie = await s.member();
    const r = await s.blobs([SHA('a'), SHA('b'), SHA('c')], cookie);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ blobs: { [SHA('a')]: '{"a":1}', [SHA('b')]: 'B', [SHA('c')]: null }, later: [] });
    const sent = s.w.calls.filter((c) => c.path.includes('/git/blobs/'));
    expect(sent).toHaveLength(3);
    expect(sent.every((c) => c.headers.Accept === 'application/vnd.github.raw' && c.auth === 'Bearer ghs_read')).toBe(true);
    clearReadMemory();
    const again = await (await s.blobs([SHA('a'), SHA('b')], cookie)).json();
    expect(again.blobs[SHA('a')]).toBe('{"a":1}');
    expect(s.w.calls.filter((c) => c.path.includes('/git/blobs/'))).toHaveLength(3);
  });

  it('checks the list and the reader', async () => {
    const s = setup();
    const cookie = await s.member();
    expect((await s.blobs(['nope'], cookie)).status).toBe(400);
    expect((await s.blobs(Array.from({ length: MAX_BATCH + 1 }, (_, i) => i.toString(16).padStart(40, '0')), cookie)).status).toBe(400);
    expect((await s.blobs([SHA('a')])).status).toBe(401);
    expect((await s.blobs([SHA('a')], '', DEMO)).status).toBe(200);
  });

  it('GitHub slows down: busy when nothing could be read, the rest later otherwise', async () => {
    const s = setup({ blobs: { [SHA('a')]: 'A' }, limited: true });
    const cookie = await s.member();
    const r = await s.blobs([SHA('a')], cookie);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('busy');
  });
});

describe('team reads: people by login', () => {
  it('gives a member the public name and avatar only, kept a day, and null for an unknown login', async () => {
    const s = setup();
    const cookie = await s.member();
    const r = await s.users(['dana', 'Malik', 'ghost'], cookie);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.users.dana).toEqual({ login: 'Dana', name: 'Dana Whitfield', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', type: 'User' });
    expect(body.users.malik).toMatchObject({ login: 'malik', name: null });
    expect(body.users.ghost).toBeNull();
    // Nothing but the public fields leaves the server.
    expect(JSON.stringify(body)).not.toMatch(/private\.example|Lyon|secret|company/);
    expect(s.w.calls.filter((c) => c.path.startsWith('/users/')).every((c) => c.auth === 'Bearer ghs_read')).toBe(true);
    // Kept: another member asks again, GitHub is not called.
    const before = s.w.calls.length;
    s.tick(60 * 60 * 1000);
    const again = await (await s.users(['dana', 'ghost'], await s.member('leo@acme.design'))).json();
    expect(again.users).toEqual({ dana: body.users.dana, ghost: null });
    expect(s.w.calls.length).toBe(before);
  });

  it('members only: no visitor, not even on a public demo team; logins are checked', async () => {
    const s = setup();
    expect((await s.users(['dana'])).status).toBe(401);
    expect((await s.users(['dana'], '', DEMO)).status).toBe(403);
    const other = await s.member('eve@evil.example', 'evil/ds');
    expect((await s.users(['dana'], other)).status).toBe(401);
    const cookie = await s.member();
    expect((await s.users(['../user'], cookie)).status).toBe(400);
    expect((await s.users(['a@b.c'], cookie)).status).toBe(400);
    expect((await s.users(Array.from({ length: 31 }, (_, i) => `u${i}`), cookie)).status).toBe(400);
    expect(s.w.calls.filter((c) => c.path.startsWith('/users/'))).toHaveLength(0);
  });

  it('counts on the member budget and says busy when GitHub slows down with nothing kept', async () => {
    const s = setup({ limited: true });
    const cookie = await s.member();
    const r = await s.users(['dana'], cookie);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('busy');
    const t = setup({}, { READ_MAX_IP: '1' });
    const c2 = await t.member();
    expect((await t.users(['dana'], c2)).status).toBe(200);
    expect((await t.users(['dana'], c2)).status).toBe(429);
  });
});

describe('team reads: the status of open changes, once for the team', () => {
  const H = SHA('c');
  const reads = [`${P}/pulls/7`, `${P}/pulls/7/reviews?per_page=100`, `${P}/pulls/7/files?per_page=100`, `${P}/commits/${H}/check-runs?per_page=100`, `${P}/commits/${H}/status`];

  it("reads a change's five status reads once and shares them with another member for 30 s", async () => {
    const s = setup();
    const r = await s.changes([`7:${H}`], await s.member());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Object.keys(body.changes['7']).sort()).toEqual(['/commits/' + H + '/check-runs?per_page=100', '/commits/' + H + '/status', '/pulls/7', '/pulls/7/files?per_page=100', '/pulls/7/reviews?per_page=100'].sort());
    expect(body.changes['7']['/pulls/7']).toEqual({ status: 200, body: JSON.stringify({ ok: '/pulls/7' }) });
    expect(JSON.stringify(body)).not.toContain('ghs_read');
    for (const p of reads) expect(gets(s.w, p)).toBe(1);
    expect(s.w.calls.every((c) => c.auth === 'Bearer ghs_read')).toBe(true);
    // Another member, 20 s later: no GitHub call.
    s.tick(20_000);
    const before = s.w.calls.length;
    expect((await (await s.changes([`7:${H}`], await s.member('leo@acme.design'))).json()).changes['7']).toEqual(body.changes['7']);
    expect(s.w.calls.length).toBe(before);
    // The single reads share the same cache: a read of the pull request is a hit.
    expect((await s.read(`${P}/pulls/7`, await s.member())).headers.get('x-bridge-cache')).toBe('hit');
  });

  it('checks GitHub again once 30 s went by (with the ETag), and at once after a write through Bridge', async () => {
    const s = setup();
    const cookie = await s.member();
    await s.changes([`7:${H}`], cookie);
    s.tick(FRESH_MS + 1);
    await s.changes([`7:${H}`], cookie);
    expect(gets(s.w, `${P}/pulls/7`)).toBe(2);
    expect(s.w.calls.filter((c) => c.path === `${P}/pulls/7`).pop()!.headers['If-None-Match']).toBe('"x"');
    s.tick(1000);
    await s.redis.cmd('SET', `bridge:read:wrote:${TEAM}`, String(T0 + FRESH_MS + 1001));
    s.tick(1);
    await s.changes([`7:${H}`], cookie);
    expect(gets(s.w, `${P}/pulls/7`)).toBe(3);
  });

  it('members only: never a visitor (not even of a public demo team) nor a member of another team; the list is checked', async () => {
    const s = setup();
    expect((await s.changes([`7:${H}`])).status).toBe(401);
    expect((await s.changes([`7:${H}`], '', DEMO)).status).toBe(403);
    expect((await s.changes([`7:${H}`], await s.member('eve@evil.example', 'evil/ds'))).status).toBe(401);
    const cookie = await s.member();
    expect((await s.changes(['7:abc'], cookie)).status).toBe(400);
    expect((await s.changes(['../7:' + H], cookie)).status).toBe(400);
    expect((await s.changes(Array.from({ length: MAX_CHANGES + 1 }, (_, i) => `${i + 1}:${H}`), cookie)).status).toBe(400);
    expect(s.w.calls.filter((c) => c.path.includes('/pulls/'))).toHaveLength(0);
  });

  it('leaves out a change GitHub would not answer, and says busy when it could answer none', async () => {
    const s = setup({ limited: true });
    const r = await s.changes([`7:${H}`], await s.member());
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('busy');
  });

  it('counts one read per change on the member budget', async () => {
    const s = setup({}, { READ_MAX_IP: '2' });
    const cookie = await s.member();
    expect((await s.changes([`7:${H}`, `8:${H}`], cookie)).status).toBe(200);
    expect((await s.changes([`7:${H}`], cookie)).status).toBe(429);
  });
});

describe('team reads: a product repository of the team', () => {
  const SHOP = 'acme/shop';
  const S = `/repos/${SHOP}`;
  const config = (team: string, repos: string[]) => ({ [team]: JSON.stringify({ products: [...repos.map((r, i) => ({ key: `p${i}`, name: `P${i}`, repo: r })), { key: 'library', name: 'Library', default: true }] }) });

  it('reads a product repository the team lists, with its own read token, on the team budget, the list kept', async () => {
    const s = setup({ configs: config(TEAM, [SHOP]) });
    const cookie = await s.member();
    const r = await s.read(`${S}/pulls?state=open&per_page=100`, cookie);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ number: 1 }]);
    expect(s.tokens).toContain(SHOP);
    expect(s.w.calls.find((c) => c.path.startsWith(`${S}/pulls`))!.auth).toBe('Bearer ghs_read');
    expect(Number(await s.redis.cmd('GET', `bridge:read:count:team:${TEAM}:${Math.floor(T0 / 1000 / 600)}`))).toBeGreaterThan(0);
    await s.read(`${S}/pulls?state=all`, cookie);
    expect(gets(s.w, `${P}/contents/bridge.config.json`)).toBe(1);
  });

  it('refuses a repository the team does not list, and the members-only resources of a listed one', async () => {
    const s = setup({ configs: config(TEAM, [SHOP]) });
    const cookie = await s.member();
    const other = await s.read('/repos/acme/secret/pulls', cookie);
    expect(other.status).toBe(403);
    expect((await other.json()).error).toBe('not-allowed');
    expect(s.w.calls.some((c) => c.path.startsWith('/repos/acme/secret'))).toBe(false);
    expect((await s.read(`${S}/collaborators`, cookie)).status).toBe(403);
    // A team without bridge.config.json lists none.
    const bare = setup();
    expect((await bare.read(`${S}/pulls`, await bare.member())).status).toBe(403);
  });

  it("reads the design team's copy of a product the team lists (products[].design.repo)", async () => {
    const copy = 'acme/shop-design';
    const s = setup({ configs: { [TEAM]: JSON.stringify({ products: [{ key: 'shop', name: 'Shop', repo: SHOP, design: { repo: copy } }, { key: 'library', name: 'Library', default: true }] }) } });
    const cookie = await s.member();
    expect((await s.read(`/repos/${copy}/pulls?state=open&per_page=100`, cookie)).status).toBe(200);
    expect(s.tokens).toContain(copy);
  });

  it('needs a reader of the team first: nobody else reads a product repository', async () => {
    const s = setup({ configs: config(TEAM, [SHOP]) });
    expect((await s.read(`${S}/pulls`)).status).toBe(401);
  });

  it('answers product_missing when the app is not on the product repository, without ending the session', async () => {
    const s = setup({ configs: config(TEAM, [SHOP]), noApp: [SHOP] });
    const r = await s.read(`${S}/pulls`, await s.member());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('product_missing');
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('a visitor of a public demo team reads its public product repository, never a private one', async () => {
    const pub = 'peterbono/bridge-demo-shop';
    const priv = 'peterbono/secret-shop';
    const s = setup({ configs: config(DEMO, [pub, priv]), private: { [DEMO]: false, [pub]: false, [priv]: true } });
    expect((await s.read(`/repos/${pub}/pulls`, '', DEMO)).status).toBe(200);
    const r = await s.read(`/repos/${priv}/pulls`, '', DEMO);
    expect(r.status).toBe(403);
    expect(s.w.calls.some((c) => c.path.startsWith(`/repos/${priv}/pulls`))).toBe(false);
  });

  it('never writes to a product repository through Bridge, even for a member', async () => {
    const s = setup({ configs: config(TEAM, [SHOP]) });
    const cookie = await s.member();
    const r = await handleContribute(
      new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(`${S}/issues/1/labels`)}`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, cookie, 'x-bridge-contribute': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ labels: ['archived'] }),
      }),
      ENV,
      s.deps,
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('not-allowed');
    expect(s.w.calls.some((c) => c.method !== 'GET')).toBe(false);
  });
});

describe('team reads: from another origin (the Bridge toolbar in a product)', () => {
  const SHOP = 'peterbono/bridge-demo-shop';
  const PROD = 'https://shop.example.com';
  const PREVIEW = 'https://shop-git-{branch}-acme-projects.vercel.app';
  const demoConfig = {
    [DEMO]: JSON.stringify({
      previews: { apps: { admin: 'https://admin-git-{branch}-acme-projects.vercel.app' }, production: { docs: ORIGIN, admin: 'https://demo.example.com' } },
      products: [{ key: 'shop', name: 'Shop', repo: SHOP, preview: PREVIEW, production: `${PROD}/` }],
    }),
  };
  const from = (origin: string, extra: Record<string, string> = {}) => ({ origin, 'sec-fetch-site': 'cross-site', ...extra });

  it('a page the config names reads a public demo team and its public product, with CORS for that origin only, no credentials', async () => {
    const s = setup({ configs: demoConfig, private: { [DEMO]: false, [SHOP]: false } });
    for (const origin of ['https://demo.example.com', PROD, 'https://shop-git-explore-das-355771-acme-projects.vercel.app', 'https://admin-git-main-acme-projects.vercel.app', 'http://localhost:5180']) {
      const r = await s.read(`${D}/pulls/1`, '', DEMO, from(origin));
      expect(r.status, origin).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
      expect(r.headers.get('access-control-allow-credentials')).toBeNull();
      expect(r.headers.get('vary')).toBe('Origin');
    }
    const p = await s.read(`/repos/${SHOP}/pulls/1/files?per_page=100`, '', DEMO, from(PROD));
    expect(p.status).toBe(200);
    expect(p.headers.get('access-control-allow-origin')).toBe(PROD);
    // The config is read once for every origin.
    expect(gets(s.w, `${D}/contents/bridge.config.json`)).toBe(1);
  });

  it('refuses an origin the config does not name without reading GitHub, a refusal the page can read (no data, no credentials)', async () => {
    const s = setup({ configs: demoConfig });
    for (const origin of ['https://evil.example', 'https://shop-git-x.evil-acme-projects.vercel.app', 'https://shop-git-a.b-acme-projects.vercel.app', 'http://shop.example.com', 'https://shop.example.com.evil.example']) {
      const r = await s.read(`${D}/pulls/1`, '', DEMO, from(origin));
      expect(r.status, origin).toBe(403);
      expect((await r.json()).error).toBe('origin');
      expect(r.headers.get('access-control-allow-origin')).toBe(origin);
      expect(r.headers.get('access-control-allow-credentials')).toBeNull();
    }
    expect(s.w.calls.some((c) => c.path.startsWith(`${D}/pulls`))).toBe(false);
  });

  it('reads as a visitor whatever cookie the browser sends: a private team or a members-only resource stays closed', async () => {
    const s = setup({ configs: { ...demoConfig, [TEAM]: demoConfig[DEMO]! } });
    const cookie = await s.member();
    const team = await s.read(`${P}/pulls`, cookie, TEAM, from(PROD));
    expect(team.status).toBe(401);
    expect(await team.json()).toEqual({ error: 'signin', message: expect.any(String) });
    expect(team.headers.get('access-control-allow-credentials')).toBeNull();
    const collab = await s.read(`${D}/collaborators`, cookie, DEMO, from(PROD));
    expect(collab.status).toBe(403);
  });

  it('serves gh= and blobs= only: no member facts, people or change status, and writes keep the CSRF rule', async () => {
    const s = setup({ configs: demoConfig, blobs: { [SHA('a')]: 'x' } });
    const blob = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${DEMO}&blobs=${SHA('a')}`, { headers: { host: HOST, ...from(PROD) } }), ENV, s.deps);
    expect(blob.status).toBe(200);
    expect(blob.headers.get('access-control-allow-origin')).toBe(PROD);
    for (const q of ['', '&mine=1', '&members=1', '&users=dana', `&changes=1:${SHA('a')}`]) {
      const r = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${DEMO}${q}`, { headers: { host: HOST, ...from(PROD) } }), ENV, s.deps);
      expect(r.status, q).toBe(403);
      expect((await r.json()).error, q).toBe('origin');
    }
    const write = await handleContribute(
      new Request(`${ORIGIN}/api/contribute?repo=${DEMO}&gh=${encodeURIComponent(`${D}/issues`)}`, { method: 'POST', headers: { host: HOST, 'x-bridge-contribute': '1', 'content-type': 'application/json', ...from(PROD) }, body: '{}' }),
      ENV,
      s.deps,
    );
    expect(write.status).toBe(403);
    expect(write.headers.get('access-control-allow-origin')).toBeNull();
    expect(s.w.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('a same-origin read (Studio) gets no CORS headers', async () => {
    const s = setup({ configs: demoConfig });
    const r = await s.read(`${D}/pulls/1`, '', DEMO, { origin: ORIGIN, 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('team reads under an old name (a toolbar or link from before a rename)', () => {
  const NEW = 'the-bridge-company/ai-design-system-demo';
  const OLD = 'peterbono/ai-design-system-demo';
  const PROD = 'https://shop.example.com';
  const config = { [NEW]: JSON.stringify({ previews: { production: { docs: ORIGIN } }, products: [{ key: 'shop', repo: 'the-bridge-company/art-print-shop', production: `${PROD}/` }] }) };
  const from = (origin: string) => ({ origin, 'sec-fetch-site': 'cross-site' });

  it('reads the team under its new name: the app is looked up, and GitHub called, by the new name only', async () => {
    // The app is installed on the repository's current name; the old one is unknown to it (what answered 409).
    const s = setup({ configs: config, private: { [NEW]: false }, noApp: [OLD] });
    const r = await s.read(`/repos/${OLD}/pulls/1`, '', OLD, from(PROD));
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(PROD);
    expect(s.tokens.every((t) => t.toLowerCase() === NEW)).toBe(true);
    expect(s.w.calls.some((c) => c.path.toLowerCase().includes(OLD))).toBe(false);
    expect(s.w.calls.some((c) => c.path === `/repos/${NEW}/pulls/1`)).toBe(true);
  });

  it('reads a product under its old owner as the same repository, by its new name', async () => {
    const s = setup({ configs: config, private: { [NEW]: false, 'the-bridge-company/art-print-shop': false } });
    const r = await s.read('/repos/art-print-shop-co/art-print-shop/pulls/1', '', NEW, from(PROD));
    expect(r.status).toBe(200);
    expect(s.w.calls.some((c) => c.path.includes('art-print-shop-co'))).toBe(false);
  });

  it('a refusal from another origin carries CORS, so the toolbar reads why and falls back (here: the app is missing)', async () => {
    const s = setup({ configs: config, private: { [NEW]: false }, noApp: [NEW] });
    const r = await s.read(`/repos/${OLD}/pulls/1`, '', OLD, from(PROD));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.headers.get('access-control-allow-origin')).toBe(PROD);
    expect(r.headers.get('vary')).toBe('Origin');
    expect(r.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('team reads with a read pass (the toolbar in a private product preview)', () => {
  const COPY = 'shop-co/shop-design';
  const CODE = 'shop-co/shop';
  const OTHER = 'shop-co/other';
  const PREVIEW_HOST = 'https://explore-toast.shop-design.pages.dev';
  const config = (team: string) =>
    JSON.stringify({
      previews: { production: { docs: ORIGIN } },
      products: [{ key: 'admin-app', repo: CODE, design: { repo: COPY, preview: 'https://{branch}.shop-design.pages.dev' }, preview: 'https://{branch}.shop.pages.dev', production: 'https://shop.pages.dev' }],
      repo: { owner: team.split('/')[0], name: team.split('/')[1] },
    });
  const from = (origin: string) => ({ origin, 'sec-fetch-site': 'cross-site' });
  const world = (team: string) => ({ configs: { [team.toLowerCase()]: config(team), [OTHER]: config(OTHER) }, private: { [DEMO]: false, [COPY]: true, [CODE]: true } });
  const mint = (s: ReturnType<typeof setup>, cookie: string, team = TEAM, extra: Record<string, string> = {}) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(team)}&mint=read-pass`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...(cookie ? { cookie } : {}), ...extra } }), ENV, s.deps);
  const readWith = (s: ReturnType<typeof setup>, path: string, pass: string, team = TEAM, origin = PREVIEW_HOST) =>
    handleContribute(
      new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(team)}&gh=${encodeURIComponent(path)}&pass=${encodeURIComponent(pass)}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...from(origin) } }),
      ENV,
      s.deps,
    );

  it('a member gets a pass for the products the team lists, and the origins it may go to; nobody else does', async () => {
    const s = setup(world(TEAM));
    const r = await mint(s, await s.member());
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    const body = (await r.json()) as { pass: string; exp: number; origins: string[] };
    expect(body.pass).toMatch(/^v1\./);
    expect(body.exp - T0).toBe(8 * 60 * 60 * 1000);
    expect(body.origins).toContain('https://{branch}.shop-design.pages.dev');
    // The pass carries no email: it travels in a URL.
    expect(Buffer.from(body.pass.split('.')[1]!, 'base64url').toString()).not.toContain('mia');
    expect((await mint(s, '')).status).toBe(401);
    // A visitor of a public demo team is not a member.
    const d = setup(world(DEMO));
    expect((await mint(d, '', DEMO)).status).toBe(401);
    // Never from another origin.
    const cross = await mint(s, await s.member(), TEAM, from(PREVIEW_HOST));
    expect(cross.status).toBe(403);
  });

  it('opens the private product repositories it names, read only, from a page the config names, on the member budget', async () => {
    const s = setup(world(TEAM));
    const { pass } = (await (await mint(s, await s.member())).json()) as { pass: string };
    for (const repo of [COPY, CODE]) {
      const r = await readWith(s, `/repos/${repo}/pulls/4`, pass);
      expect(r.status, repo).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBe(PREVIEW_HOST);
      expect(r.headers.get('access-control-allow-credentials')).toBeNull();
    }
    // The member's budget, not the address's.
    expect(Number(await s.redis.cmd('GET', countKey('member', memberBudgetId('mia@acme.design'), T0)))).toBeGreaterThan(0);
    expect(await s.redis.cmd('GET', countKey('ip', sha256('read-ip:203.0.113.9').slice(0, 24), T0))).toBeNull();
  });

  it('never opens more: the team repository, members-only resources, blobs, another origin, writes', async () => {
    const s = setup(world(TEAM));
    const { pass } = (await (await mint(s, await s.member())).json()) as { pass: string };
    expect((await readWith(s, `${P}/pulls`, pass)).status).toBe(401);
    expect((await readWith(s, `/repos/${COPY}/collaborators`, pass)).status).toBe(403);
    // A repository the pass does not name reads as a visitor: closed on a private team.
    expect((await readWith(s, `/repos/${OTHER}/pulls/1`, pass)).status).toBe(401);
    const evil = await readWith(s, `/repos/${COPY}/pulls/4`, pass, TEAM, 'https://evil.example');
    expect(evil.status).toBe(403);
    // The refusal is readable (no data in it); the answer it refused never is.
    expect((await evil.json()).error).toBe('origin');
    const blob = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${TEAM}&blobs=${SHA('a')}&pass=${encodeURIComponent(pass)}`, { headers: { host: HOST, ...from(PREVIEW_HOST) } }), ENV, s.deps);
    expect(blob.status).toBe(401);
    const write = await handleContribute(
      new Request(`${ORIGIN}/api/contribute?repo=${TEAM}&gh=${encodeURIComponent(`/repos/${COPY}/issues`)}&pass=${encodeURIComponent(pass)}`, { method: 'POST', headers: { host: HOST, 'x-bridge-contribute': '1', 'content-type': 'application/json', ...from(PREVIEW_HOST) }, body: '{}' }),
      ENV,
      s.deps,
    );
    expect(write.status).toBe(403);
    expect(s.w.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('an expired, tampered or other team pass reads as a visitor (as before)', async () => {
    const s = setup(world(TEAM));
    const { pass } = (await (await mint(s, await s.member())).json()) as { pass: string };
    const [v, body, mac] = pass.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as { r: string[] };
    claims.r.push(OTHER);
    const tampered = `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;
    expect((await readWith(s, `/repos/${OTHER}/pulls/1`, tampered)).status).toBe(401);
    expect((await readWith(s, `/repos/${COPY}/pulls/4`, 'v1.junk.junk')).status).toBe(401);
    // Minted for another team that lists the same product: does not open it through this team.
    const other = (await (await mint(s, await s.member('mia@acme.design', OTHER), OTHER)).json()) as { pass: string };
    expect(other.pass).toMatch(/^v1\./);
    expect((await readWith(s, `/repos/${COPY}/pulls/4`, other.pass)).status).toBe(401);
    expect((await readWith(s, `/repos/${COPY}/pulls/4`, other.pass, OTHER)).status).toBe(200);
    s.tick(8 * 60 * 60 * 1000 + 1);
    expect((await readWith(s, `/repos/${COPY}/pulls/4`, pass)).status).toBe(401);
  });

  it('on a public demo team, the pass opens its private product; without it, the visitor stays out', async () => {
    const s = setup(world(DEMO));
    const cookie = await s.member('mia@acme.design', DEMO);
    const { pass } = (await (await mint(s, cookie, DEMO)).json()) as { pass: string };
    expect((await s.read(`/repos/${COPY}/pulls/4`, '', DEMO, from(PREVIEW_HOST))).status).toBe(403);
    const r = await readWith(s, `/repos/${COPY}/pulls/4`, pass, DEMO);
    expect(r.status).toBe(200);
    // The team's own public repository still reads as a visitor, pass or not.
    expect((await readWith(s, `${D}/pulls/1`, pass, DEMO)).status).toBe(200);
  });
});
