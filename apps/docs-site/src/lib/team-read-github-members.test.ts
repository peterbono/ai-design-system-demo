// Library reads through Bridge for people signed in with GitHub (api/_lib/team-read.ts, api/contribute readerOf): a
// lead, an admin or a designer reads the team's own repository with the app's read token and the team's shared cache,
// never their own GitHub limit. Membership is checked on the server with their own token (kept 5 minutes, in Redis by
// a hash of the token); the read allow-list holds; X-Bridge-Fresh revalidates for members only; one reader can only
// spend their share of the app's GitHub calls; no token ever reaches the browser.
import { describe, expect, it } from 'vitest';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory, FRESH_MS, readAllowed } from '../../api/_lib/team-read';
import { clearDesignerCache, type ContribDeps, type FetchLike, handleContribute } from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const SECRET = 's'.repeat(40);
const TEAM = 'acme/design';
const DEMO = 'acme-design-demo/bridge-demo-ds';
const P = `/repos/${TEAM}`;
const D = `/repos/${DEMO}`;
const APP = 'ghs_read_app_token';

/** Who each personal token is, and what GitHub lets them do on the team's repository (null: GitHub's 404). */
const PEOPLE: Record<string, { login: string; perms: Record<string, boolean> | null }> = {
  ghu_lead_token_aaaaaaaaaaaa: { login: 'Lena', perms: { admin: true, push: true, pull: true } },
  ghu_designer_token_bbbbbbbbb: { login: 'Dina', perms: { push: true, pull: true } },
  ghu_stranger_token_ccccccccc: { login: 'Sam', perms: null },
};
const LEAD = 'ghu_lead_token_aaaaaaaaaaaa';
const DINA = 'ghu_designer_token_bbbbbbbbb';

interface Seen {
  path: string;
  auth: string;
  inm: string | null;
}

function github(w: { calls: Seen[]; pulls: number }): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const auth = init.headers.Authorization ?? '';
    const token = auth.replace(/^Bearer\s+/, '');
    w.calls.push({ path: u.pathname + u.search, auth, inm: init.headers['If-None-Match'] ?? null });
    const who = PEOPLE[token];
    if (u.pathname === '/user') return who ? Response.json({ login: who.login, id: 1 }) : Response.json({ message: 'Bad credentials' }, { status: 401 });
    // A personal token on the team's repository: its permissions there (the team is private).
    if (token !== APP && (u.pathname === P || u.pathname === D)) return who?.perms ? Response.json({ private: u.pathname === P, permissions: who.perms }) : Response.json({ message: 'Not Found' }, { status: 404 });
    if (token !== APP) return Response.json({ message: 'Not Found' }, { status: 404 });
    if (u.pathname === P || u.pathname === D) return Response.json({ full_name: u.pathname.slice(7), private: u.pathname === P });
    if (u.pathname.endsWith('/contents/bridge.config.json')) return Response.json({ message: 'Not Found' }, { status: 404 });
    if (u.pathname === `${P}/pulls` || u.pathname === `${D}/pulls`) {
      const etag = `"p${w.pulls}"`;
      if (init.headers['If-None-Match'] === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      return Response.json([{ number: w.pulls }], { headers: { ETag: etag } });
    }
    return Response.json({ ok: u.pathname }, { headers: { ETag: '"x"' } });
  };
}

function setup(env: Record<string, string> = {}) {
  clearReadMemory();
  clearDesignerCache();
  const w = { calls: [] as Seen[], pulls: 1 };
  let now = T0;
  const redis = memoryRedis(() => now);
  const deps: ContribDeps = { fetch: github(w), now: () => now, redis, app: { installationToken: async () => APP } };
  const read = (path: string, token: string | null, extra: Record<string, string> = {}, repo = TEAM) =>
    handleContribute(
      new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(repo)}&gh=${encodeURIComponent(path)}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra } }),
      { LIBRARY_SESSION_SECRET: SECRET, ...env },
      deps,
    );
  return { w, redis, read, tick: (ms: number) => (now += ms) };
}

/** The app's reads of `path` (never the people's own tokens). */
const appReads = (w: { calls: Seen[] }, path: string) => w.calls.filter((c) => c.path === path && c.auth === `Bearer ${APP}`);

describe("the team's library through Bridge for a GitHub sign-in", () => {
  it("reads with the app's token, and neither token goes back to the browser", async () => {
    const s = setup();
    const r = await s.read(`${P}/pulls`, LEAD);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual([{ number: 1 }]);
    expect(text).not.toContain(APP);
    expect(text).not.toContain(LEAD);
    expect([...r.headers.entries()].join(' ')).not.toMatch(new RegExp(`${APP}|${LEAD}|authorization|x-ratelimit`, 'i'));
    expect(appReads(s.w, `${P}/pulls`)).toHaveLength(1);
    // Their own token only says who they are (GET /user, their permissions on the team), never reads the team's data.
    expect(s.w.calls.filter((c) => c.auth === `Bearer ${LEAD}`).map((c) => c.path)).toEqual(['/user', P]);
  });

  it('shares one GitHub read between members of the team (a lead and a designer)', async () => {
    const s = setup();
    expect((await s.read(`${P}/pulls`, LEAD)).headers.get('x-bridge-cache')).toBe('miss');
    const second = await s.read(`${P}/pulls`, DINA);
    expect(second.headers.get('x-bridge-cache')).toBe('hit');
    expect(await second.json()).toEqual([{ number: 1 }]);
    expect(appReads(s.w, `${P}/pulls`)).toHaveLength(1);
  });

  it('checks who they are once per 5 minutes, kept in Redis by a hash of the token for every function', async () => {
    const s = setup();
    await s.read(`${P}/pulls`, LEAD);
    // Another function answers the next read (its memory is empty): Redis says who they are.
    clearDesignerCache();
    await s.read(`${P}/issues`, LEAD);
    expect(s.w.calls.filter((c) => c.path === '/user')).toHaveLength(1);
    expect(JSON.stringify(s.redis.snapshot())).not.toContain(LEAD);
    // After 5 minutes GitHub is asked again.
    s.tick(5 * 60 * 1000 + 1);
    clearDesignerCache();
    await s.read(`${P}/issues`, LEAD);
    expect(s.w.calls.filter((c) => c.path === '/user')).toHaveLength(2);
  });

  it('reads nothing for a GitHub account that is not on the team, an unknown token or none', async () => {
    const s = setup();
    for (const token of ['ghu_stranger_token_ccccccccc', 'ghu_unknown_token_dddddddddd', null]) {
      const r = await s.read(`${P}/pulls`, token, { 'X-Bridge-Fresh': '1' });
      expect(r.status, String(token)).toBe(401);
    }
    expect(appReads(s.w, `${P}/pulls`)).toHaveLength(0);
  });

  it('keeps the read allow-list: never hooks, keys, secrets, invitations or another repository', async () => {
    const s = setup();
    for (const path of [`${P}/hooks`, `${P}/keys`, `${P}/actions/secrets`, `${P}/invitations`, `${P}/actions/runs`, '/repos/acme/other/pulls']) {
      expect((await s.read(path, LEAD)).status, path).toBe(403);
    }
    expect(s.w.calls.some((c) => c.auth === `Bearer ${APP}` && /hooks|keys|secrets|invitations|actions|other/.test(c.path))).toBe(false);
    expect(readAllowed(['releases'], { kind: 'member' })).toBe(true);
    expect(readAllowed(['releases', 'tags', 'v1.0.0'], { kind: 'guest' })).toBe(true);
  });
});

describe('the shared cache: ETags, a fresh read after a write', () => {
  it('revalidates with the kept ETag once fresh time is over (a 304 for GitHub), and answers 304 to a matching ETag', async () => {
    const s = setup();
    await s.read(`${P}/pulls`, LEAD);
    s.tick(FRESH_MS + 1);
    const r = await s.read(`${P}/pulls`, DINA);
    expect(r.headers.get('x-bridge-cache')).toBe('revalidated');
    expect(appReads(s.w, `${P}/pulls`).map((c) => c.inm)).toEqual([null, '"p1"']);
    const same = await s.read(`${P}/pulls`, DINA, { 'If-None-Match': '"p1"' });
    expect(same.status).toBe(304);
    expect(same.headers.get('x-bridge-cache')).toBe('hit');
  });

  it("asks GitHub again for a member's fresh read while the answer is still fresh, and keeps it for the team", async () => {
    const s = setup();
    await s.read(`${P}/pulls`, LEAD);
    // The lead merged a pull request on GitHub from the page: the list changed.
    s.w.pulls = 2;
    expect(await (await s.read(`${P}/pulls`, DINA)).json()).toEqual([{ number: 1 }]);
    const fresh = await s.read(`${P}/pulls`, LEAD, { 'X-Bridge-Fresh': '1' });
    expect(fresh.headers.get('x-bridge-cache')).toBe('miss');
    expect(await fresh.json()).toEqual([{ number: 2 }]);
    expect(appReads(s.w, `${P}/pulls`).map((c) => c.inm)).toEqual([null, '"p1"']);
    // The designer now reads the new list from the cache.
    const after = await s.read(`${P}/pulls`, DINA);
    expect(after.headers.get('x-bridge-cache')).toBe('hit');
    expect(await after.json()).toEqual([{ number: 2 }]);
  });

  it("ignores a visitor's fresh read of a public demo team", async () => {
    const s = setup();
    await s.read(`${D}/pulls`, null, {}, DEMO);
    const again = await s.read(`${D}/pulls`, null, { 'X-Bridge-Fresh': '1' }, DEMO);
    expect(again.headers.get('x-bridge-cache')).toBe('hit');
    expect(appReads(s.w, `${D}/pulls`)).toHaveLength(1);
  });
});

describe("one reader cannot spend the app's GitHub calls for the team", () => {
  it('stops at their own share of GitHub calls (cache misses), while a teammate still reads', async () => {
    const s = setup({ READ_MAX_UPSTREAM: '2' });
    expect((await s.read(`${P}/pulls`, LEAD)).status).toBe(200);
    expect((await s.read(`${P}/issues`, LEAD)).status).toBe(200);
    const over = await s.read(`${P}/labels`, LEAD);
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toBe('busy');
    expect(over.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(appReads(s.w, `${P}/labels`)).toHaveLength(0);
    // What is cached still answers them, and a teammate has their own share.
    expect((await s.read(`${P}/pulls`, LEAD)).status).toBe(200);
    expect((await s.read(`${P}/labels`, DINA)).status).toBe(200);
  });

  it('does not count a 304, and answers what is kept, however old, once their share is spent', async () => {
    const s = setup({ READ_MAX_UPSTREAM: '2' });
    await s.read(`${P}/pulls`, LEAD);
    s.tick(FRESH_MS + 1);
    expect((await s.read(`${P}/pulls`, LEAD)).headers.get('x-bridge-cache')).toBe('revalidated');
    expect((await s.read(`${P}/issues`, LEAD)).headers.get('x-bridge-cache')).toBe('miss');
    s.tick(FRESH_MS + 1);
    const old = await s.read(`${P}/pulls`, LEAD);
    expect(old.status).toBe(200);
    expect(old.headers.get('x-bridge-cache')).toBe('stale');
    expect(appReads(s.w, `${P}/pulls`)).toHaveLength(2);
  });
});
