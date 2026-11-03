// Designers signed in with GitHub write in the team's products through Bridge (api/contribute githubDesignerOf), under
// the same policy as an email designer; leads and admins keep GitHub; nobody else gets in. Routing on the client
// (lib/write-route productRouteFor) and in the connector (api/mcp designerFetchFor) follow the same rule.
import { describe, expect, it } from 'vitest';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory } from '../../api/_lib/team-read';
import {
  clearDesignerCache,
  clearDesignPathCache,
  clearProductPairCache,
  type ContribDeps,
  type FetchLike,
  githubReadsTeam,
  githubRoleOf,
  handleContribute,
  issueSession,
  LEADS_DIRECT,
  teamLeadsFrom,
} from '../../api/contribute/index';
import { productReadRoute, productRouteFor, startedByDesigner } from './write-route';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const TEAM = 'acme/design';
const T0 = Date.parse('2026-11-02T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const NOTE = 'a'.repeat(40);
const HEAD = 'd'.repeat(40);
const NEXT = 'e'.repeat(40);
const CONFIG = JSON.stringify({
  governance: { owners: { design: ['lena'], tech: ['@Tom'] }, override: { allowed: ['ovi'] } },
  products: [{ key: 'shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } }],
});

/** Who each token is on GitHub, and what GitHub lets them do on the team's repository. */
const PEOPLE: Record<string, { login: string; id: number; name?: string; perms: Record<string, boolean> | null; teamPrivate?: boolean }> = {
  'ghu_designer_token_aaaaaaaa': { login: 'Dina', id: 42, name: 'Dina Park', perms: { push: true, pull: true } },
  'ghu_colleague_token_bbbbbbb': { login: 'Cole', id: 43, perms: { push: true, pull: true } },
  'ghu_lead_owner_token_ccccccc': { login: 'Lena', id: 44, perms: { push: true, pull: true } },
  'ghu_admin_token_dddddddddddd': { login: 'Ada', id: 45, perms: { admin: true, push: true, pull: true } },
  'ghu_reader_token_eeeeeeeeeee': { login: 'Rita', id: 46, perms: { pull: true } },
  // Read on a private team's repository: GitHub only says so to people it gave access to.
  'ghu_private_reader_token_ggg': { login: 'Pia', id: 47, perms: { pull: true }, teamPrivate: true },
};

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface World {
  branches: Record<string, string>;
  pulls: { number: number; ref: string; login: string }[];
  calls: { method: string; path: string; body?: any; auth?: string }[];
  next: number;
}

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const auth = ((init.headers ?? {}) as Record<string, string>).Authorization ?? '';
    const token = auth.replace(/^Bearer\s+/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path, body, auth });
    const m = init.method;
    let x: RegExpExecArray | null;
    // The person's own token: who they are, and their permissions on the team's repository.
    const who = PEOPLE[token];
    if (m === 'GET' && path === '/user') return who ? res(200, { login: who.login, id: who.id, name: who.name ?? null }) : res(401, { message: 'Bad credentials' });
    if (m === 'GET' && path === '/repos/acme/design' && token !== 'ghs_contrib') return who?.perms ? res(200, { permissions: who.perms, private: who.teamPrivate === true }) : res(404, { message: 'Not Found' });
    if (m === 'GET' && path === '/repos/acme/design/contents/bridge.config.json') return new Response(CONFIG, { status: 200 });
    if (m === 'GET' && (path === '/repos/acme/shop-design' || path === '/repos/acme/shop')) return res(200, { default_branch: 'main', private: true });
    if (m === 'GET' && path.startsWith('/repos/acme/shop-design/contents/bridge.config.json')) return res(404, { message: 'Not Found' });
    if (m === 'GET' && path === '/repos/acme/shop-design/pulls') return res(200, w.pulls.map((p) => ({ number: p.number, state: 'open', head: { ref: p.ref, repo: { full_name: 'acme/shop-design' } }, user: { login: p.login } })));
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/compare\/([^.]+)\.\.\.([0-9a-f]{40})$/.exec(path))) {
      const [, from, to] = x;
      if (from === 'main' && to === NOTE) return res(200, { status: 'ahead', files: [{ filename: '.bridge/explorations/orders.md' }] });
      if (from === HEAD && to === NEXT) return res(200, { status: 'ahead', files: [{ filename: 'src/App.tsx' }] });
      return res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const b = x[1]!.split('/').map(decodeURIComponent).join('/');
      return w.branches[b] ? res(200, { object: { sha: w.branches[b] } }) : res(404, { message: 'Not Found' });
    }
    if (m === 'POST' && path === '/repos/acme/shop-design/git/refs') {
      w.branches[String(body.ref).replace('refs/heads/', '')] = body.sha;
      return res(201, { ref: body.ref });
    }
    if (m === 'POST' && path === '/repos/acme/shop-design/pulls') return res(201, { number: w.next++ });
    return res(m === 'POST' ? 201 : 200, { ok: true });
  };
}

function setup() {
  clearDesignPathCache();
  clearProductPairCache();
  clearDesignerCache();
  clearReadMemory();
  const w: World = { branches: { main: 'm'.repeat(40), 'explore/theirs': HEAD, 'explore/colleague': HEAD, 'explore/old': HEAD, 'explore/someone': HEAD }, pulls: [], calls: [], next: 7 };
  const redis = memoryRedis(() => T0);
  const members = memberStore(redis);
  const deps: ContribDeps = { fetch: github(w), now: () => T0, redis, email: { send: async () => undefined }, app: { installationToken: async () => 'ghs_contrib' } };
  return { w, deps, redis, members };
}

const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'sec-fetch-site': 'same-origin' };
const C = '/repos/acme/shop-design';

function call(s: ReturnType<typeof setup>, token: string | null, method: string, path: string, body?: unknown, cookie?: string) {
  const req = new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(path)}`, {
    method,
    headers: { ...H, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return handleContribute(req, ENV, s.deps);
}

const DINA = 'ghu_designer_token_aaaaaaaa';

describe('who is a designer on GitHub', () => {
  it('push without admin and not a lead is a designer; admins and leads keep GitHub; read only is nobody', () => {
    const leads = ['lena', 'tom'];
    expect(githubRoleOf({ push: true }, 'Dina', leads)).toBe('designer');
    expect(githubRoleOf({ maintain: true }, 'dina', leads)).toBe('designer');
    expect(githubRoleOf({ push: true }, 'Lena', leads)).toBe('lead');
    expect(githubRoleOf({ admin: true, push: true }, 'dina', leads)).toBe('lead');
    expect(githubRoleOf({ pull: true }, 'dina', leads)).toBe('none');
    expect(githubRoleOf(null, 'dina', leads)).toBe('none');
  });

  it('reads the leads from governance: owners and the override, lower case, nothing malformed', () => {
    expect(teamLeadsFrom(JSON.parse(CONFIG)).sort()).toEqual(['lena', 'ovi', 'tom']);
    expect(teamLeadsFrom({ governance: { owners: { design: ['bad name', 7] } } })).toEqual([]);
    expect(teamLeadsFrom(null)).toEqual([]);
  });
});

describe('a designer signed in with GitHub, through the proxy', () => {
  it('starts an exploration in the copy: the branch becomes theirs, Bridge writes with its app, the line names their login', async () => {
    const s = setup();
    expect((await call(s, DINA, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/orders', sha: NOTE })).status).toBe(201);
    expect(await s.redis.cmd('GET', 'bridge:contrib:branch:acme/shop-design:explore/orders')).toBe('gh:dina');
    // The write itself goes out with the Bridge app's token, never theirs.
    expect(s.w.calls.find((c) => c.method === 'POST' && c.path === `${C}/git/refs`)!.auth).toBe('Bearer ghs_contrib');
    const pr = await call(s, DINA, 'POST', `${C}/pulls`, { title: 'Exploration: Orders', head: 'explore/orders', base: 'main', body: 'Hi' });
    expect(pr.status).toBe(201);
    expect(s.w.calls.find((c) => c.method === 'POST' && c.path === `${C}/pulls`)!.body.body).toBe('Hi\n\nRequested by Dina Park (@Dina) through Bridge.');
    expect(startedByDesigner('Hi\n\nRequested by Dina Park (@Dina) through Bridge.', 'dina')).toBe(true);
    expect(startedByDesigner('Hi\n\nRequested by Dina Park (@Dina) through Bridge.', 'cole')).toBe(false);
  });

  it("their commits carry GitHub's no-reply address for their account", async () => {
    const s = setup();
    await s.redis.cmd('SET', 'bridge:contrib:branch:acme/shop-design:explore/theirs', 'gh:dina');
    expect((await call(s, DINA, 'POST', `${C}/git/commits`, { message: 'x', tree: 't'.repeat(40), parents: [HEAD] })).status).toBe(201);
    expect(s.w.calls.find((c) => c.path === `${C}/git/commits`)!.body.author).toMatchObject({ name: 'Dina Park', email: '42+Dina@users.noreply.github.com' });
  });

  it("never touches a colleague's exploration, the default branch, or the library", async () => {
    const s = setup();
    await s.redis.cmd('SET', 'bridge:contrib:branch:acme/shop-design:explore/theirs', 'gh:dina');
    await s.redis.cmd('SET', 'bridge:contrib:branch:acme/shop-design:explore/colleague', 'gh:cole');
    expect((await call(s, DINA, 'PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT })).status).toBe(200);
    expect((await call(s, DINA, 'PATCH', `${C}/git/refs/heads/explore/colleague`, { sha: NEXT })).status).toBe(403);
    expect((await call(s, 'ghu_colleague_token_bbbbbbb', 'PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT })).status).toBe(403);
    expect((await call(s, DINA, 'PATCH', `${C}/git/refs/heads/main`, { sha: NEXT })).status).toBe(403);
    // In the library they keep their own GitHub path: Bridge does not write there for them.
    expect((await call(s, DINA, 'POST', '/repos/acme/design/git/refs', { ref: 'refs/heads/x', sha: NOTE })).status).toBe(403);
  });

  it('keeps an exploration they opened on GitHub before (their own pull request), never someone else\'s', async () => {
    const s = setup();
    s.w.pulls = [
      { number: 2, ref: 'explore/old', login: 'dina' },
      { number: 3, ref: 'explore/someone', login: 'cole' },
    ];
    expect((await call(s, DINA, 'PATCH', `${C}/git/refs/heads/explore/old`, { sha: NEXT })).status).toBe(200);
    expect(await s.redis.cmd('GET', 'bridge:contrib:branch:acme/shop-design:explore/old')).toBe('gh:dina');
    expect((await call(s, DINA, 'PATCH', `${C}/git/refs/heads/explore/someone`, { sha: NEXT })).status).toBe(403);
  });

  it('a lead or an admin keeps GitHub; a reader, an unknown or expired token gets nothing', async () => {
    const s = setup();
    const lead = await call(s, 'ghu_lead_owner_token_ccccccc', 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE });
    expect(lead.status).toBe(403);
    expect(((await lead.json()) as { message: string }).message).toBe(LEADS_DIRECT);
    expect((await call(s, 'ghu_admin_token_dddddddddddd', 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE })).status).toBe(403);
    expect((await call(s, 'ghu_reader_token_eeeeeeeeeee', 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE })).status).toBe(401);
    expect((await call(s, 'ghu_unknown_token_ffffffffff', 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE })).status).toBe(401);
    expect((await call(s, null, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE })).status).toBe(401);
  });

  it('is known by their token for "mine" (no email session needed); a reader is not', async () => {
    const s = setup();
    const mine = (token: string) => handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&mine=1`, { headers: { ...H, authorization: `Bearer ${token}` } }), ENV, s.deps);
    const r = await mine(DINA);
    expect(r.status).toBe(200);
    expect(Array.isArray(((await r.json()) as { branches: string[] }).branches)).toBe(true);
    expect((await mine('ghu_reader_token_eeeeeeeeeee')).status).toBe(401);
  });

  it('an email member keeps working the same way', async () => {
    const s = setup();
    const member = { email: 'dino@yopmail.com', name: 'Dino', role: 'edit' as const, version: 1, addedBy: 'florian', at: new Date(T0).toISOString() };
    await s.members.put(TEAM, member);
    const cookie = issueSession(member, TEAM, SECRET, T0).split(';')[0]!;
    expect((await call(s, null, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/mail', sha: NOTE }, cookie)).status).toBe(201);
    expect(await s.redis.cmd('GET', 'bridge:contrib:branch:acme/shop-design:explore/mail')).toBe('dino@yopmail.com');
  });

  it('"mine" lists their explorations in each product, apart from the library ones', async () => {
    const s = setup();
    const member = { email: 'dino@yopmail.com', name: 'Dino', role: 'edit' as const, version: 1, addedBy: 'florian', at: new Date(T0).toISOString() };
    await s.members.put(TEAM, member);
    const cookie = issueSession(member, TEAM, SECRET, T0).split(';')[0]!;
    expect((await call(s, null, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/toast', sha: NOTE }, cookie)).status).toBe(201);
    const r = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&mine=1`, { headers: { ...H, cookie } }), ENV, s.deps);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { branches: string[]; products: Record<string, { branches: string[] }> };
    expect(body.branches).not.toContain('explore/toast');
    expect(body.products['acme/shop-design']?.branches).toEqual(['explore/toast']);
    // A designer signed in with GitHub: theirs too, by their token.
    expect((await call(s, DINA, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/dina', sha: NOTE })).status).toBe(201);
    const d = (await (await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&mine=1`, { headers: { ...H, authorization: `Bearer ${DINA}` } }), ENV, s.deps)).json()) as { products: Record<string, { branches: string[] }> };
    expect(d.products['acme/shop-design']?.branches).toEqual(['explore/dina']);
  });

  it('the connector knows what Bridge made for them (ownedWorkFor), by email or by GitHub token', async () => {
    const s = setup();
    const { ownedWorkFor } = await import('../../api/contribute/index');
    expect((await call(s, DINA, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/dina', sha: NOTE })).status).toBe(201);
    expect(await ownedWorkFor({ token: DINA }, TEAM, ENV, s.deps)).toEqual([{ repo: 'acme/shop-design', branch: 'explore/dina' }]);
    expect(await ownedWorkFor({ email: 'nobody@acme.design' }, TEAM, ENV, s.deps)).toEqual([]);
    expect(await ownedWorkFor({ token: 'ghu_reader_token_eeeeeeeeeee' }, TEAM, ENV, s.deps)).toBeNull();
  });
});

describe('the connector for a designer signed in with GitHub (api/mcp designerFetchFor)', () => {
  it("sends their calls in the team's products through the proxy, the rest with their own token", async () => {
    const s = setup();
    const { designerFetchFor } = await import('../../api/mcp/index');
    const f = designerFetchFor(DINA, TEAM, ['acme/shop-design', 'acme/shop'], ENV, s.deps as never, { redis: s.redis, key: Buffer.alloc(32), secret: SECRET } as never);
    const r = await f(`https://api.github.com${C}/git/refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'refs/heads/explore/claude', sha: NOTE }) });
    expect(r.status).toBe(201);
    expect(await s.redis.cmd('GET', 'bridge:contrib:branch:acme/shop-design:explore/claude')).toBe('gh:dina');
    // A colleague's branch: the policy's words, as a 422 Claude can read.
    await s.redis.cmd('SET', 'bridge:contrib:branch:acme/shop-design:explore/colleague', 'gh:cole');
    const no = await f(`https://api.github.com${C}/git/refs/heads/explore/colleague`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: NEXT }) });
    expect(no.status).toBe(422);
    // The library: their own token, straight to GitHub.
    await f('https://api.github.com/repos/acme/design/contents/x.json', { method: 'GET', headers: { Authorization: `Bearer ${DINA}` } });
    expect(s.w.calls.at(-1)).toMatchObject({ path: '/repos/acme/design/contents/x.json', auth: `Bearer ${DINA}` });
  });
});

describe('which way a product write goes (lib/write-route productRouteFor)', () => {
  const site = { owners: { design: ['lena'], tech: ['tom'] }, override: { allowed: ['ovi'] } };
  const table: [string, Parameters<typeof productRouteFor>[0], 'github' | 'bridge'][] = [
    ['email member', { session: 'email', access: null, login: 'dino@yopmail.com', site }, 'bridge'],
    ['GitHub designer', { session: 'github', access: { write: true, admin: false }, login: 'dina', site }, 'bridge'],
    ['GitHub admin', { session: 'github', access: { write: true, admin: true }, login: 'ada', site }, 'github'],
    ['design owner', { session: 'github', access: { write: true, admin: false }, login: '@Lena', site }, 'github'],
    ['override allowed', { session: 'github', access: { write: true, admin: false }, login: 'ovi', site }, 'github'],
    ['GitHub reader', { session: 'github', access: { write: false, admin: false }, login: 'rita', site }, 'github'],
    ['access not known yet', { session: 'github', access: null, login: 'dina', site }, 'github'],
    ['signed out', { session: null, access: null, login: null, site }, 'github'],
  ];
  for (const [name, x, want] of table) it(name, () => expect(productRouteFor(x)).toBe(want));
});

describe("everyone on the team reads the products through Bridge's app (private products and design copies)", () => {
  it('an explicit role on the team, or read on a private team, is on the team; read on a public team is everyone', () => {
    expect(githubReadsTeam({ admin: true }, false)).toBe(true);
    expect(githubReadsTeam({ maintain: true }, false)).toBe(true);
    expect(githubReadsTeam({ push: true, pull: true }, false)).toBe(true);
    expect(githubReadsTeam({ triage: true, pull: true }, false)).toBe(true);
    expect(githubReadsTeam({ pull: true }, true)).toBe(true);
    expect(githubReadsTeam({ pull: true }, false)).toBe(false);
    expect(githubReadsTeam(null, true)).toBe(false);
  });

  it('a lead, an admin, a designer and a reader of a private team read the copy and the code repository with the app', async () => {
    for (const token of ['ghu_lead_owner_token_ccccccc', 'ghu_admin_token_dddddddddddd', DINA, 'ghu_private_reader_token_ggg']) {
      const s = setup();
      for (const path of [`${C}/pulls?state=open&per_page=100`, '/repos/acme/shop/issues?labels=from-design', C]) {
        const r = await call(s, token, 'GET', path);
        expect(r.status, `${token} ${path}`).toBe(200);
        // The app's read token reads the product, never the person's own.
        expect(s.w.calls.at(-1)?.auth).toBe('Bearer ghs_contrib');
      }
    }
  });

  it('a GitHub account that only reads a public team, an unknown or no token, reads nothing', async () => {
    const s = setup();
    for (const token of ['ghu_reader_token_eeeeeeeeeee', 'ghu_unknown_token_ffffffffff', null]) expect((await call(s, token, 'GET', `${C}/pulls`)).status).toBe(401);
    expect(s.w.calls.some((c) => c.path.startsWith(C) && c.auth === 'Bearer ghs_contrib')).toBe(false);
  });

  it('a lead reads only the products the team lists, under the read allow-list, and still writes on GitHub', async () => {
    const s = setup();
    const LEAD = 'ghu_lead_owner_token_ccccccc';
    expect((await call(s, LEAD, 'GET', '/repos/acme/secret/contents/a.json')).status).toBe(403);
    expect((await call(s, LEAD, 'GET', `${C}/collaborators`)).status).toBe(403);
    expect((await call(s, LEAD, 'GET', `${C}/hooks`)).status).toBe(403);
    const w = await call(s, LEAD, 'POST', `${C}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE });
    expect(w.status).toBe(403);
    expect(((await w.json()) as { message: string }).message).toBe(LEADS_DIRECT);
  });
});

describe('which way a product read goes (lib/write-route productReadRoute)', () => {
  const products = ['the-bridge-company/art-print-shop', 'the-bridge-company/art-print-shop-design'];
  const api = 'https://api.github.com';
  const table: [string, Parameters<typeof productReadRoute>[0], 'github' | 'bridge'][] = [
    ['a GitHub sign-in reads the design copy', { session: 'github', method: 'GET', url: `${api}/repos/the-bridge-company/art-print-shop-design`, products }, 'bridge'],
    ['its explorations', { session: 'github', method: undefined, url: `${api}/repos/The-Bridge-Company/Art-Print-Shop-Design/pulls?state=open`, products }, 'bridge'],
    ['the tasks in the code repository', { session: 'github', method: 'get', url: `${api}/repos/the-bridge-company/art-print-shop/issues?labels=from-design`, products }, 'bridge'],
    ['check runs for a preview', { session: 'github', method: 'GET', url: `${api}/repos/the-bridge-company/art-print-shop/commits/${'a'.repeat(40)}/check-runs`, products }, 'bridge'],
    ['an email member', { session: 'email', method: 'GET', url: `${api}/repos/the-bridge-company/art-print-shop/pulls`, products }, 'bridge'],
    ['a write keeps its own route', { session: 'github', method: 'POST', url: `${api}/repos/the-bridge-company/art-print-shop-design/git/refs`, products }, 'github'],
    ['the library stays on GitHub', { session: 'github', method: 'GET', url: `${api}/repos/the-bridge-company/ai-design-system-demo/pulls`, products }, 'github'],
    ['a repository with the same prefix is not a product', { session: 'github', method: 'GET', url: `${api}/repos/the-bridge-company/art-print-shop-designs`, products }, 'github'],
    ['another host', { session: 'github', method: 'GET', url: 'https://raw.githubusercontent.com/the-bridge-company/art-print-shop/main/a.json', products }, 'github'],
    ['the account itself', { session: 'github', method: 'GET', url: `${api}/user`, products }, 'github'],
    ['a guest has its own path', { session: null, method: 'GET', url: `${api}/repos/the-bridge-company/art-print-shop/pulls`, products }, 'github'],
  ];
  for (const [name, x, want] of table) it(name, () => expect(productReadRoute(x)).toBe(want));
});
