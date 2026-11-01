// /api/contribute in a team's product repositories (api/contribute planProductCall): an email designer explores a
// product in its design team's copy and files the developers' task, and nothing else, rule by rule.
import { EXPLORATION_ARCHIVED_LABEL as CORE_ARCHIVED, EXPLORATION_LABEL as CORE_LABEL, EXPLORATION_PREFIX as CORE_PREFIX, EXPLORATION_READY_LABEL as CORE_READY, FROM_DESIGN_LABEL as CORE_FROM_DESIGN } from '@bridge-ds/core';
import { describe, expect, it } from 'vitest';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory } from '../../api/_lib/team-read';
import {
  clearDesignPathCache,
  clearProductPairCache,
  type ContribDeps,
  EXPLORATION_ARCHIVED_LABEL,
  EXPLORATION_LABEL,
  EXPLORATION_PREFIX,
  EXPLORATION_READY_LABEL,
  type FetchLike,
  FROM_DESIGN_LABEL,
  handleContribute,
  isSandboxPath,
  issueSession,
  productPairsFrom,
  scopeOf,
} from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const TEAM = 'acme/design';
const T0 = Date.parse('2026-11-01T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
/** The new branch's commit: the exploration note only. */
const NOTE = 'a'.repeat(40);
/** A commit that also changes code from main (a new branch may not start there). */
const CODE = 'c'.repeat(40);
/** The head of an exploration that holds code (Claude's work), and a commit after it that removes the note. */
const HEAD = 'd'.repeat(40);
const NEXT = 'e'.repeat(40);
const NEXT_CODE = 'f'.repeat(40);
/** A commit after HEAD that also touches CI, and one that touches the hosting settings. */
const NEXT_CI = '1'.repeat(40);
const NEXT_HOSTING = '2'.repeat(40);
const CONFIG = JSON.stringify({ products: [{ key: 'shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } }, { key: 'blog', repo: 'acme/blog' }] });

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface World {
  branches: Record<string, string>;
  next: number;
  /** Issues of the developers' repository the policy reads. */
  issues: Record<number, { body: string; labels: string[] }>;
  calls: { method: string; path: string; body?: any }[];
}

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path, body });
    const m = init.method;
    let x: RegExpExecArray | null;
    if (m === 'GET' && path === '/repos/acme/design/contents/bridge.config.json') return new Response(CONFIG, { status: 200 });
    if (m === 'GET' && (path === '/repos/acme/shop-design' || path === '/repos/acme/shop')) return res(200, { default_branch: 'main', private: true });
    if (m === 'GET' && path.startsWith('/repos/acme/shop-design/contents/bridge.config.json')) return res(404, { message: 'Not Found' });
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const b = x[1]!.split('/').map(decodeURIComponent).join('/');
      return w.branches[b] ? res(200, { object: { sha: w.branches[b] } }) : res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/compare\/([^.]+)\.\.\.([0-9a-f]{40})$/.exec(path))) {
      const [, from, to] = x;
      if (from === 'main' && to === NOTE) return res(200, { status: 'ahead', files: [{ filename: '.bridge/explorations/orders.md' }] });
      if (from === 'main' && to === CODE) return res(200, { status: 'ahead', files: [{ filename: 'src/App.tsx' }] });
      if (from === HEAD && to === NEXT) return res(200, { status: 'ahead', files: [{ filename: '.bridge/explorations/orders.md' }] });
      if (from === HEAD && to === NEXT_CODE) return res(200, { status: 'ahead', files: [{ filename: 'src/App.tsx' }] });
      if (from === HEAD && to === NEXT_CI) return res(200, { status: 'ahead', files: [{ filename: 'src/App.tsx' }, { filename: '.github/workflows/ci.yml' }] });
      if (from === HEAD && to === NEXT_HOSTING) return res(200, { status: 'ahead', files: [{ filename: 'vercel.json' }] });
      if (from === HEAD) return res(200, { status: 'diverged', files: [] });
      return res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && (x = /^\/repos\/acme\/shop\/issues\/(\d+)$/.exec(path))) {
      const i = w.issues[Number(x[1])];
      return i ? res(200, { number: Number(x[1]), body: i.body, labels: i.labels.map((name) => ({ name })) }) : res(404, { message: 'Not Found' });
    }
    if (m === 'POST' && path === '/repos/acme/shop-design/git/refs') {
      w.branches[String(body.ref).replace('refs/heads/', '')] = body.sha;
      return res(201, { ref: body.ref });
    }
    if (m === 'POST' && (path === '/repos/acme/shop-design/pulls' || path === '/repos/acme/shop/issues')) return res(201, { number: w.next++ });
    return res(m === 'POST' ? 201 : 200, { ok: true });
  };
}

function setup(over: Partial<ContribDeps> = {}) {
  clearDesignPathCache();
  clearProductPairCache();
  clearReadMemory();
  const w: World = { branches: { main: 'm'.repeat(40), 'explore/theirs': HEAD, 'explore/other': HEAD }, next: 7, issues: {}, calls: [] };
  const now = T0;
  const redis = memoryRedis(() => now);
  const members = memberStore(redis);
  const deps: ContribDeps = { fetch: github(w), now: () => now, redis, email: { send: async () => undefined }, app: { installationToken: async () => 'ghs_contrib' }, ...over };
  return { w, deps, redis, members };
}

const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'sec-fetch-site': 'same-origin' };

function gh(method: string, path: string, cookie: string, body?: unknown): Request {
  return new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(path)}`, { method, headers: { ...H, cookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function join(s: ReturnType<typeof setup>, email = 'dino@yopmail.com', name = 'Dino') {
  const member = { email, name, role: 'edit' as const, version: 1, addedBy: 'florian', at: new Date(T0).toISOString() };
  await s.members.put(TEAM, member);
  return issueSession(member, TEAM, SECRET, T0).split(';')[0]!;
}

const C = '/repos/acme/shop-design';
const D = '/repos/acme/shop';

/** A member signed in, with explore/theirs and pull request #3 in the copy recorded as theirs. */
async function signedIn() {
  const s = setup();
  const cookie = await join(s);
  await s.redis.cmd('SET', `bridge:contrib:branch:acme/shop-design:explore/theirs`, 'dino@yopmail.com');
  await s.redis.cmd('SET', `bridge:contrib:issue:acme/shop-design:3`, 'dino@yopmail.com');
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await handleContribute(gh(method, path, cookie, body), ENV, s.deps);
    return { r, sent: s.w.calls.filter((c) => c.method === method && c.path === path).at(-1) };
  };
  return { ...s, cookie, call };
}

describe('which product repositories', () => {
  it('reads the pairs of products with a design copy from the team config, nothing malformed, never the team', () => {
    expect(productPairsFrom(JSON.parse(CONFIG), TEAM)).toEqual([{ code: 'acme/shop', copy: 'acme/shop-design' }]);
    expect(productPairsFrom({ products: [{ repo: 'acme/design', design: { repo: 'acme/x' } }, { repo: 'bad', design: { repo: 'acme/y' } }, { repo: 'acme/z', design: { repo: 'acme/z' } }] }, TEAM)).toEqual([]);
    expect(productPairsFrom(null, TEAM)).toEqual([]);
    const pairs = productPairsFrom(JSON.parse(CONFIG), TEAM);
    expect(scopeOf(pairs, 'Acme/Shop-Design')?.kind).toBe('copy');
    expect(scopeOf(pairs, 'acme/shop')?.kind).toBe('code');
    expect(scopeOf(pairs, 'acme/blog')).toBeNull();
  });

  it('keeps the same names as core', () => {
    expect([EXPLORATION_PREFIX, EXPLORATION_LABEL, EXPLORATION_READY_LABEL, EXPLORATION_ARCHIVED_LABEL, FROM_DESIGN_LABEL]).toEqual([CORE_PREFIX, CORE_LABEL, CORE_READY, CORE_ARCHIVED, CORE_FROM_DESIGN]);
  });

  it('refuses a product with no design copy and any repository the team does not list', async () => {
    const { call } = await signedIn();
    expect((await call('POST', '/repos/acme/blog/issues', { title: 'x' })).r.status).toBe(403);
    expect((await call('POST', '/repos/other/repo/issues', { title: 'x' })).r.status).toBe(403);
  });

  it('needs a signed-in member', async () => {
    const s = setup();
    const r = await handleContribute(gh('POST', `${C}/git/refs`, '', { ref: 'refs/heads/explore/x', sha: NOTE }), ENV, s.deps);
    expect(r.status).toBe(401);
  });
});

describe('the design copy', () => {
  it('starts an exploration: a new explore/* branch with design files only, which becomes theirs', async () => {
    const { call, redis } = await signedIn();
    expect((await call('POST', `${C}/git/refs`, { ref: 'refs/heads/explore/orders', sha: NOTE })).r.status).toBe(201);
    expect(await redis.cmd('GET', 'bridge:contrib:branch:acme/shop-design:explore/orders')).toBe('dino@yopmail.com');
    // Not an exploration branch, the default branch, an existing one, or a start that carries code.
    expect((await call('POST', `${C}/git/refs`, { ref: 'refs/heads/feature/x', sha: NOTE })).r.status).toBe(403);
    expect((await call('POST', `${C}/git/refs`, { ref: 'refs/heads/main', sha: NOTE })).r.status).toBe(403);
    expect((await call('POST', `${C}/git/refs`, { ref: 'refs/heads/explore/theirs', sha: NOTE })).r.status).toBe(403);
    expect((await call('POST', `${C}/git/refs`, { ref: 'refs/heads/explore/code', sha: CODE })).r.status).toBe(403);
  });

  it('opens their draft pull request to the default branch only, always a draft, with the attribution line', async () => {
    const { call, redis } = await signedIn();
    const ok = await call('POST', `${C}/pulls`, { title: 'Exploration: Orders', head: 'explore/theirs', base: 'main', body: 'Hi', draft: false });
    expect(ok.r.status).toBe(201);
    expect(ok.sent!.body).toEqual({ title: 'Exploration: Orders', head: 'explore/theirs', base: 'main', draft: true, body: 'Hi\n\nRequested by Dino (dino@yopmail.com) through Bridge.' });
    expect(await redis.cmd('GET', 'bridge:contrib:issue:acme/shop-design:7')).toBe('dino@yopmail.com');
    expect((await call('POST', `${C}/pulls`, { title: 'x', head: 'explore/other', base: 'main' })).r.status).toBe(403);
    expect((await call('POST', `${C}/pulls`, { title: 'x', head: 'explore/theirs', base: 'explore/other' })).r.status).toBe(403);
  });

  it('moves their branch forward with prototype code, never CI or hosting settings; never force, never another', async () => {
    const { call } = await signedIn();
    expect((await call('PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT })).r.status).toBe(200);
    expect((await call('PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT_CODE })).r.status).toBe(200);
    expect((await call('PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT_CI })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT_HOSTING })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: 'b'.repeat(40) })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/git/refs/heads/explore/theirs`, { sha: NEXT, force: true })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/git/refs/heads/explore/other`, { sha: NEXT })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/git/refs/heads/main`, { sha: NEXT })).r.status).toBe(403);
  });

  it('writes trees of prototype code and design files, never CI, hosting settings, node_modules, submodules or symlinks', async () => {
    const { call } = await signedIn();
    expect((await call('POST', `${C}/git/trees`, { base_tree: 't', tree: [{ path: '.bridge/explorations/orders.md', sha: null }] })).r.status).toBe(201);
    expect((await call('POST', `${C}/git/trees`, { base_tree: 't', tree: [{ path: 'src/App.tsx', content: 'x' }, { path: 'package.json', content: '{}' }] })).r.status).toBe(201);
    expect((await call('POST', `${C}/git/trees`, { base_tree: 't', tree: [{ path: 'scripts/seed.sh', mode: '100755', content: 'x' }] })).r.status).toBe(201);
    for (const entry of [
      { path: '.github/workflows/x.yml', content: 'x' },
      { path: 'vercel.json', content: '{}' },
      { path: '.vercel/project.json', content: '{}' },
      { path: 'node_modules/x/index.js', content: 'x' },
      { path: 'src/link', mode: '120000', content: '/etc/passwd' },
      { path: 'vendor', mode: '160000', type: 'commit', sha: 'a'.repeat(40) },
      { path: 'src/../.github/x.yml', content: 'x' },
    ])
      expect((await call('POST', `${C}/git/trees`, { base_tree: 't', tree: [entry] })).r.status, entry.path).toBe(403);
  });

  it('saves files on their own exploration: code yes, CI and hosting settings no, never another branch', async () => {
    const { call } = await signedIn();
    const put = (path: string, branch = 'explore/theirs') => call('PUT', `${C}/contents/${path}`, { message: 'x', content: 'eA==', branch });
    expect((await put('src/App.tsx')).r.status).toBe(200);
    expect((await put('.github/workflows/x.yml')).r.status).toBe(403);
    expect((await put('vercel.json')).r.status).toBe(403);
    expect((await put('src/App.tsx', 'explore/other')).r.status).toBe(403);
    expect((await put('src/App.tsx', 'main')).r.status).toBe(403);
    expect((await call('DELETE', `${C}/contents/src/Old.tsx`, { message: 'x', sha: 's', branch: 'explore/theirs' })).r.status).toBe(200);
  });

  it('isSandboxPath: any file but CI, hosting settings and node_modules, with sane segments', () => {
    for (const ok of ['src/App.tsx', 'package.json', 'public/logo.svg', '.bridge/explorations/x.md', 'README.md', '.env.example']) expect(isSandboxPath(ok), ok).toBe(true);
    for (const no of ['', '/src/App.tsx', '.github', '.github/workflows/ci.yml', '.GitHub/x', 'vercel.json', '.vercel/project.json', 'node_modules/x', 'a/node_modules/b', 'apps/web/vercel.json', 'apps/web/.vercel/x.json', 'src/../x', 'src//x', 'src/./x', 'a\\b'])
      expect(isSandboxPath(no), no).toBe(false);
  });

  it('labels, unlabels, comments on and edits their own pull request only, with exploration labels only', async () => {
    const { call } = await signedIn();
    expect((await call('POST', `${C}/issues/3/labels`, { labels: ['exploration', 'product:shop'] })).r.status).toBe(201);
    expect((await call('POST', `${C}/issues/3/labels`, { labels: ['ready-for-devs'] })).r.status).toBe(201);
    expect((await call('POST', `${C}/issues/3/labels`, { labels: ['bug'] })).r.status).toBe(403);
    expect((await call('POST', `${C}/issues/4/labels`, { labels: ['archived'] })).r.status).toBe(403);
    expect((await call('DELETE', `${C}/issues/3/labels/exploration`)).r.status).toBe(200);
    expect((await call('DELETE', `${C}/issues/3/labels/bug`)).r.status).toBe(403);
    expect((await call('POST', `${C}/issues/3/comments`, { body: 'Done' })).sent!.body).toEqual({ body: '**Dino** (via Bridge):\n\nDone' });
    expect((await call('POST', `${C}/issues/4/comments`, { body: 'x' })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/pulls/3`, { body: 'New body' })).r.status).toBe(200);
    expect((await call('PATCH', `${C}/pulls/3`, { draft: false })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/pulls/3`, { state: 'merged' })).r.status).toBe(403);
    expect((await call('PATCH', `${C}/pulls/4`, { title: 'x' })).r.status).toBe(403);
  });

  it('gets the latest (Sync fork of the default branch) and brings it into their exploration, never the other way', async () => {
    const { call } = await signedIn();
    expect((await call('POST', `${C}/merge-upstream`, { branch: 'main' })).r.status).toBe(201);
    expect((await call('POST', `${C}/merge-upstream`, { branch: 'explore/theirs' })).r.status).toBe(403);
    expect((await call('POST', `${C}/merges`, { base: 'explore/theirs', head: 'main', commit_message: 'Bring in' })).r.status).toBe(201);
    expect((await call('POST', `${C}/merges`, { base: 'main', head: 'explore/theirs' })).r.status).toBe(403);
    expect((await call('POST', `${C}/merges`, { base: 'explore/other', head: 'main' })).r.status).toBe(403);
  });

  it('never merges a pull request, reviews, forks, or writes the default branch', async () => {
    const { call } = await signedIn();
    for (const [m, p, b] of [
      ['PUT', `${C}/pulls/3/merge`, {}],
      ['POST', `${C}/pulls/3/reviews`, { event: 'APPROVE' }],
      ['POST', `${C}/forks`, {}],
      ['PUT', `${C}/contents/.bridge/x.md`, { message: 'x', content: 'eA==', branch: 'main' }],
      ['POST', `${C}/issues`, { title: 'x' }],
      ['DELETE', `${C}/git/refs/heads/explore/theirs`, {}],
    ] as const)
      expect((await call(m, p, b)).r.status, `${m} ${p}`).toBe(403);
  });
});

describe("the developers' repository", () => {
  const TASK = 'The design team explored this.\n\nIt lives in the design team\'s copy (https://github.com/acme/shop-design/pull/3).';

  it('files one task that links their exploration, labeled from-design and titled Design:, and records it', async () => {
    const { call, redis } = await signedIn();
    const ok = await call('POST', `${D}/issues`, { title: 'Design: Orders', body: TASK, labels: ['from-design'] });
    expect(ok.r.status).toBe(201);
    expect(ok.sent!.body.body).toBe(`${TASK}\n\nRequested by Dino (dino@yopmail.com) through Bridge.`);
    expect(await redis.cmd('GET', 'bridge:contrib:issue:acme/shop:7')).toBe('dino@yopmail.com');
    expect((await call('POST', `${D}/issues`, { title: 'Design: Orders', body: TASK.replace('/pull/3', '/pull/4'), labels: ['from-design'] })).r.status).toBe(403);
    expect((await call('POST', `${D}/issues`, { title: 'Orders', body: TASK, labels: ['from-design'] })).r.status).toBe(403);
    expect((await call('POST', `${D}/issues`, { title: 'Design: Orders', body: TASK, labels: ['from-design', 'urgent'] })).r.status).toBe(403);
    expect((await call('POST', `${D}/labels`, { name: 'from-design', color: '1d76db', description: 'x' })).r.status).toBe(201);
    expect((await call('POST', `${D}/labels`, { name: 'urgent' })).r.status).toBe(403);
  });

  it('comments on, closes as not planned and reopens their task only; never closes it as done', async () => {
    const { call, w, redis } = await signedIn();
    await redis.cmd('SET', 'bridge:contrib:issue:acme/shop:7', 'dino@yopmail.com');
    // A task Florian filed from GitHub for Dino's exploration, and someone else's.
    w.issues[9] = { body: TASK, labels: ['from-design'] };
    w.issues[10] = { body: 'Unrelated', labels: ['from-design'] };
    w.issues[11] = { body: TASK, labels: ['bug'] };
    expect((await call('POST', `${D}/issues/7/comments`, { body: 'Back' })).r.status).toBe(201);
    expect((await call('PATCH', `${D}/issues/7`, { state: 'closed', state_reason: 'not_planned' })).r.status).toBe(200);
    expect((await call('PATCH', `${D}/issues/9`, { state: 'open', state_reason: 'reopened', body: TASK })).r.status).toBe(200);
    expect((await call('PATCH', `${D}/issues/7`, { state: 'closed', state_reason: 'completed' })).r.status).toBe(403);
    expect((await call('PATCH', `${D}/issues/7`, { state: 'closed' })).r.status).toBe(403);
    expect((await call('PATCH', `${D}/issues/7`, { title: 'x' })).r.status).toBe(403);
    expect((await call('PATCH', `${D}/issues/7`, { body: 'no link' })).r.status).toBe(403);
    expect((await call('PATCH', `${D}/issues/10`, { state: 'closed', state_reason: 'not_planned' })).r.status).toBe(403);
    expect((await call('PATCH', `${D}/issues/11`, { state: 'closed', state_reason: 'not_planned' })).r.status).toBe(403);
    expect((await call('POST', `${D}/issues/10/comments`, { body: 'x' })).r.status).toBe(403);
  });

  it('never writes code, branches or pull requests there', async () => {
    const { call } = await signedIn();
    for (const [m, p, b] of [
      ['POST', `${D}/git/refs`, { ref: 'refs/heads/explore/x', sha: NOTE }],
      ['POST', `${D}/pulls`, { title: 'x', head: 'explore/x', base: 'main' }],
      ['PUT', `${D}/contents/.bridge/x.md`, { message: 'x', content: 'eA==', branch: 'explore/x' }],
      ['POST', `${D}/merges`, { base: 'main', head: 'x' }],
      ['POST', `${D}/merge-upstream`, { branch: 'main' }],
    ] as const)
      expect((await call(m, p, b)).r.status, `${m} ${p}`).toBe(403);
  });
});

describe("Claude for an email member (api/mcp proxyFetchFor): the connector's GitHub calls through this same policy", () => {
  async function viaClaude() {
    const s = setup();
    await join(s);
    await s.redis.cmd('SET', `bridge:contrib:branch:acme/shop-design:explore/theirs`, 'dino@yopmail.com');
    const { proxyFetchFor } = await import('../../api/mcp/index');
    const member = (await s.members.get(TEAM, 'dino@yopmail.com'))!;
    const f = proxyFetchFor(member, TEAM, ENV, s.deps as never, { redis: s.redis, key: Buffer.alloc(32), secret: SECRET });
    const put = (path: string, branch = 'explore/theirs') =>
      f(`https://api.github.com${C}/contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' }, body: JSON.stringify({ message: 'x', content: 'eA==', branch }) });
    return { ...s, f, put };
  }

  it('saves prototype code on their own exploration in the copy, as them', async () => {
    const { put, w } = await viaClaude();
    expect((await put('src/App.tsx')).status).toBe(200);
    const sent = w.calls.filter((c) => c.method === 'PUT' && c.path === `${C}/contents/src/App.tsx`).at(-1)!;
    expect(sent.body.author).toEqual({ name: 'Dino', email: 'dino@yopmail.com' });
  });

  it('answers a refusal of the policy as a 422 with the policy words, never a token message', async () => {
    const { put, f } = await viaClaude();
    const ci = await put('.github/workflows/x.yml');
    expect(ci.status).toBe(422);
    expect((await ci.json()).message).toMatch(/build and hosting settings/);
    const main = await put('src/App.tsx', 'main');
    expect(main.status).toBe(422);
    expect((await main.json()).message).toMatch(/joined with their email/);
    // In the developers' repository: never code.
    const dev = await f(`https://api.github.com${D}/contents/src/App.tsx`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x', content: 'eA==', branch: 'explore/theirs' }) });
    expect(dev.status).toBe(422);
  });

  it('refuses anything that is not a repository of the team: GraphQL, /user, the raw host', async () => {
    const { f } = await viaClaude();
    expect((await f('https://api.github.com/graphql', { method: 'POST', headers: {}, body: '{"query":"mutation{x}"}' })).status).toBe(403);
    expect((await f('https://api.github.com/user', { method: 'GET', headers: {} })).status).toBe(403);
    expect((await f('https://raw.githubusercontent.com/acme/shop-design/main/src/App.tsx', { method: 'GET', headers: {} })).status).toBe(403);
  });

  it('ends with the membership: a removed member gets nothing through', async () => {
    const { put, members } = await viaClaude();
    await members.remove(TEAM, 'dino@yopmail.com');
    expect((await put('src/App.tsx')).status).toBe(422);
  });
});
