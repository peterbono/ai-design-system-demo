// Two designers on the same product (api/contribute planProductCall): whose explore/* branch and pull request is whose
// in the design team's copy. Each designer writes only to their own exploration; another designer's push, pull
// request, Done exploring, rename, delete and force push are refused with the words Studio shows. Email members and
// designers signed in with GitHub, a branch a lead made on GitHub, and a copy made again (its pull requests re-opened
// by the lead, their numbers starting over) are each held here, with an in-memory Redis and a fake GitHub.
import { describe, expect, it } from 'vitest';
import { memberRef } from '../../api/_lib/exploration-member';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory } from '../../api/_lib/team-read';
import { clearDesignerCache, clearDesignPathCache, clearProductPairCache, type ContribDeps, type FetchLike, handleContribute, issueSession, LEADS_DIRECT, NOT_ALLOWED } from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const TEAM = 'acme/design';
const COPY = 'acme/shop-design';
const C = `/repos/${COPY}`;
const D = '/repos/acme/shop';
const T0 = Date.parse('2026-11-02T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const MAIN = 'm'.repeat(40);
/** A new exploration's first commit (its note only), and the next commit on any exploration. */
const NOTE = 'a'.repeat(40);
const NEXT = 'e'.repeat(40);
const CONFIG = JSON.stringify({
  governance: { owners: { design: ['lena'] } },
  products: [{ key: 'shop', repo: 'acme/shop', design: { repo: COPY } }],
});

/** GitHub accounts: a designer (push, not a lead) and the lead. */
const PEOPLE: Record<string, { login: string; id: number; name: string; perms: Record<string, boolean> }> = {
  ghu_dina_designer_token_aaaa: { login: 'Dina', id: 42, name: 'Dina Park', perms: { push: true, pull: true } },
  ghu_lena_lead_token_bbbbbbbb: { login: 'Lena', id: 44, name: 'Lena', perms: { push: true, pull: true } },
};
const DINA = 'ghu_dina_designer_token_aaaa';
const LENA = 'ghu_lena_lead_token_bbbbbbbb';

interface Pull {
  ref: string;
  user: string;
  body: string;
  title: string;
  state: 'open' | 'closed';
}

interface World {
  branches: Record<string, string>;
  pulls: Record<number, Pull>;
  next: number;
  calls: { method: string; path: string; body?: any }[];
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pullJson = (n: number, p: Pull) => ({ number: n, state: p.state, title: p.title, body: p.body, user: { login: p.user }, head: { ref: p.ref, repo: { full_name: COPY } }, base: { ref: 'main' } });

/** GitHub as the proxy sees it: the team's config, the copy (branches, pull requests, compares) and the developers' repository. */
function github(w: World): FetchLike {
  return async (url, init) => {
    const path = new URL(url).pathname;
    const token = (((init.headers ?? {}) as Record<string, string>).Authorization ?? '').replace(/^Bearer\s+/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    const m = init.method;
    w.calls.push({ method: m, path, body });
    let x: RegExpExecArray | null;
    const who = PEOPLE[token];
    if (m === 'GET' && path === '/user') return who ? res(200, { login: who.login, id: who.id, name: who.name }) : res(401, { message: 'Bad credentials' });
    if (m === 'GET' && path === `/repos/${TEAM}` && who) return res(200, { permissions: who.perms, private: true });
    if (m === 'GET' && path === `/repos/${TEAM}/contents/bridge.config.json`) return new Response(CONFIG, { status: 200 });
    if (m === 'GET' && (path === C || path === D)) return res(200, { default_branch: 'main', private: true });
    if (m === 'GET' && path.startsWith(`${C}/contents/bridge.config.json`)) return res(404, { message: 'Not Found' });
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const b = x[1]!.split('/').map(decodeURIComponent).join('/');
      return w.branches[b] ? res(200, { object: { sha: w.branches[b] } }) : res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/compare\/(.+)\.\.\.([0-9a-f]{40})$/.exec(path))) {
      const [, from, to] = x;
      if (from === 'main' && to === NOTE) return res(200, { status: 'ahead', files: [{ filename: '.bridge/explorations/note.md' }] });
      if (to === NEXT && from !== NEXT) return res(200, { status: 'ahead', files: [{ filename: 'src/Orders.tsx' }] });
      return res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && path === `${C}/pulls`) return res(200, Object.entries(w.pulls).filter(([, p]) => p.state === 'open').map(([n, p]) => pullJson(Number(n), p)));
    if (m === 'GET' && (x = /^\/repos\/acme\/shop-design\/pulls\/(\d+)$/.exec(path))) {
      const p = w.pulls[Number(x[1])];
      return p ? res(200, pullJson(Number(x[1]), p)) : res(404, { message: 'Not Found' });
    }
    if (m === 'POST' && path === `${C}/git/refs`) {
      w.branches[String(body.ref).replace('refs/heads/', '')] = body.sha;
      return res(201, { ref: body.ref });
    }
    if (m === 'PATCH' && (x = /^\/repos\/acme\/shop-design\/git\/refs\/heads\/(.+)$/.exec(path))) {
      w.branches[x[1]!.split('/').map(decodeURIComponent).join('/')] = body.sha;
      return res(200, { object: { sha: body.sha } });
    }
    if (m === 'POST' && path === `${C}/pulls`) {
      const n = w.next++;
      w.pulls[n] = { ref: body.head, user: 'bridge-app[bot]', body: body.body ?? '', title: body.title ?? '', state: 'open' };
      return res(201, pullJson(n, w.pulls[n]!));
    }
    if (m === 'PATCH' && (x = /^\/repos\/acme\/shop-design\/pulls\/(\d+)$/.exec(path))) {
      const p = w.pulls[Number(x[1])]!;
      Object.assign(p, body);
      return res(200, pullJson(Number(x[1]), p));
    }
    if (m === 'POST' && path === `${D}/issues`) return res(201, { number: 90 });
    return res(m === 'POST' ? 201 : 200, { ok: true });
  };
}

function setup() {
  clearDesignPathCache();
  clearProductPairCache();
  clearDesignerCache();
  clearReadMemory();
  const w: World = { branches: { main: MAIN }, pulls: {}, next: 1, calls: [] };
  const redis = memoryRedis(() => T0);
  const members = memberStore(redis);
  const deps: ContribDeps = { fetch: github(w), now: () => T0, redis, email: { send: async () => undefined }, app: { installationToken: async () => 'ghs_contrib' } };
  return { w, redis, members, deps };
}

type World0 = ReturnType<typeof setup>;
const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'sec-fetch-site': 'same-origin' };

/** A designer as the proxy sees them: an email member (their cookie) or a designer signed in with GitHub (their token). */
interface Designer {
  /** What Bridge keeps as the owner of their branches. */
  id: string;
  call: (method: string, path: string, body?: unknown) => Promise<Response>;
}

async function emailDesigner(s: World0, email: string, name: string): Promise<Designer> {
  const member = { email, name, role: 'edit' as const, version: 1, addedBy: 'florian', at: new Date(T0).toISOString() };
  await s.members.put(TEAM, member);
  const cookie = issueSession(member, TEAM, SECRET, T0).split(';')[0]!;
  return { id: email, call: (method, path, body) => handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(path)}`, { method, headers: { ...H, cookie }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), ENV, s.deps) };
}

function githubDesigner(s: World0, token: string): Designer {
  return {
    id: `gh:${PEOPLE[token]!.login.toLowerCase()}`,
    call: (method, path, body) => handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(path)}`, { method, headers: { ...H, authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), ENV, s.deps),
  };
}

const block = (e: Record<string, unknown>) => `<!-- bridge-exploration ${JSON.stringify(e)} -->`;
const blockOf = (body: string) => JSON.parse(/<!-- bridge-exploration (\{[\s\S]*?\}) -->/.exec(body)![1]!) as Record<string, unknown>;
const task = (n: number) => `From the design team: https://github.com/${COPY}/pull/${n}`;

/** The designer starts an exploration through Bridge: its branch, then its draft pull request. Its number. */
async function start(s: World0, d: Designer, slug: string): Promise<number> {
  const b = `explore/${slug}`;
  expect((await d.call('POST', `${C}/git/refs`, { ref: `refs/heads/${b}`, sha: NOTE })).status).toBe(201);
  expect(await s.redis.cmd('GET', `bridge:contrib:branch:${COPY}:${b}`)).toBe(d.id);
  const pr = await d.call('POST', `${C}/pulls`, { title: `Exploration: ${slug}`, head: b, base: 'main', body: `${block({ v: 1, name: slug, slug })}\n\n## Exploration: ${slug}` });
  expect(pr.status).toBe(201);
  return ((await pr.json()) as { number: number }).number;
}

/** Every write another designer could try on an exploration that is not theirs: each must be refused. */
function intrusions(b: string, n: number): [string, string, string, unknown?][] {
  return [
    ['push a commit', 'PATCH', `${C}/git/refs/heads/${b}`, { sha: NEXT }],
    ['save a file on it', 'PUT', `${C}/contents/src/Orders.tsx`, { message: 'x', content: 'eA==', branch: b }],
    ['remove a file from it', 'DELETE', `${C}/contents/src/Orders.tsx`, { message: 'x', sha: 'f'.repeat(40), branch: b }],
    ['bring main into it', 'POST', `${C}/merges`, { base: b, head: 'main' }],
    ['open a pull request from it', 'POST', `${C}/pulls`, { title: 'Mine now', head: b, base: 'main', body: 'x' }],
    ['mark it done (body)', 'PATCH', `${C}/pulls/${n}`, { body: `${block({ v: 1, name: 'x', doneAt: '2026-11-02T10:00:00Z' })}` }],
    ['mark it done (label)', 'POST', `${C}/issues/${n}/labels`, { labels: ['ready-for-devs'] }],
    ['rename it', 'PATCH', `${C}/pulls/${n}`, { title: 'Exploration: renamed', body: block({ v: 1, name: 'renamed' }) }],
    ['archive it', 'POST', `${C}/issues/${n}/labels`, { labels: ['archived'] }],
    ['take a label off it', 'DELETE', `${C}/issues/${n}/labels/exploration`],
    ['comment as Bridge on it', 'POST', `${C}/issues/${n}/comments`, { body: 'hi' }],
    ['delete it (close)', 'PATCH', `${C}/pulls/${n}`, { state: 'closed' }],
    ['delete its branch', 'DELETE', `${C}/git/refs/heads/${b}`],
    ['force-push it', 'PATCH', `${C}/git/refs/heads/${b}`, { sha: NEXT, force: true }],
    ['file the developers\' task for it', 'POST', `${D}/issues`, { title: 'Design: x', body: task(n), labels: ['from-design'] }],
  ];
}

async function expectRefused(d: Designer, s: World0, b: string, n: number, words = NOT_ALLOWED) {
  const sha = s.w.branches[b];
  const pull = JSON.stringify(s.w.pulls[n]);
  for (const [what, method, path, body] of intrusions(b, n)) {
    const r = await d.call(method, path, body);
    expect({ what, status: r.status }).toEqual({ what, status: 403 });
    expect({ what, message: ((await r.json()) as { message: string }).message }).toEqual({ what, message: words });
  }
  // Nothing of theirs moved.
  expect(s.w.branches[b]).toBe(sha);
  expect(JSON.stringify(s.w.pulls[n])).toBe(pull);
}

/** The owner's own actions on their exploration, each allowed (a force push and a deleted branch stay refused for everyone). */
async function expectOwnerWorks(d: Designer, s: World0, b: string, n: number) {
  expect((await d.call('PATCH', `${C}/git/refs/heads/${b}`, { sha: NEXT })).status).toBe(200);
  expect(s.w.branches[b]).toBe(NEXT);
  expect((await d.call('PUT', `${C}/contents/src/Orders.tsx`, { message: 'x', content: 'eA==', branch: b })).status).toBe(200);
  expect((await d.call('POST', `${C}/merges`, { base: b, head: 'main' })).status).toBe(201);
  // This team has a design lead: Done exploring asks them, the hand-off is the lead's yes (api/_lib/lead-gate.ts).
  const done = s.w.pulls[n]!.body.replace(/"name":/, '"leadAskedAt":"2026-11-02T10:00:00Z","name":');
  expect((await d.call('PATCH', `${C}/pulls/${n}`, { body: done })).status).toBe(200);
  expect((await d.call('POST', `${C}/issues/${n}/labels`, { labels: ['archived'] })).status).toBe(201);
  expect((await d.call('POST', `${C}/issues/${n}/comments`, { body: 'Ready' })).status).toBe(201);
  expect((await d.call('PATCH', `${C}/pulls/${n}`, { title: 'Exploration: renamed', body: s.w.pulls[n]!.body })).status).toBe(200);
  expect(s.w.pulls[n]!.title).toBe('Exploration: renamed');
  expect((await d.call('POST', `${D}/issues`, { title: 'Design: renamed', body: task(n), labels: ['from-design'] })).status).toBe(403);
  expect((await d.call('PATCH', `${C}/git/refs/heads/${b}`, { sha: NEXT, force: true })).status).toBe(403);
  expect((await d.call('DELETE', `${C}/git/refs/heads/${b}`)).status).toBe(403);
  expect((await d.call('PATCH', `${C}/pulls/${n}`, { state: 'closed' })).status).toBe(200);
  expect(s.w.pulls[n]!.state).toBe('closed');
}

describe('two email designers on the same product', () => {
  it("B cannot write to A's exploration in any way; A's own actions go through", async () => {
    const s = setup();
    const a = await emailDesigner(s, 'ana@studio.test', 'Ana');
    const b = await emailDesigner(s, 'ben@studio.test', 'Ben');
    const n = await start(s, a, 'orders');
    expect(blockOf(s.w.pulls[n]!.body)).toMatchObject({ member: memberRef('ana@studio.test'), memberName: 'Ana' });
    await expectRefused(b, s, 'explore/orders', n);
    await expectOwnerWorks(a, s, 'explore/orders', n);
  });

  it("B cannot name A in the block of B's own pull request: the proxy names who opened it", async () => {
    const s = setup();
    await emailDesigner(s, 'ana@studio.test', 'Ana');
    const b = await emailDesigner(s, 'ben@studio.test', 'Ben');
    expect((await b.call('POST', `${C}/git/refs`, { ref: 'refs/heads/explore/bens', sha: NOTE })).status).toBe(201);
    const r = await b.call('POST', `${C}/pulls`, { title: 'Exploration: bens', head: 'explore/bens', base: 'main', body: block({ v: 1, name: 'bens', member: memberRef('ana@studio.test'), memberName: 'Ana' }) });
    expect(r.status).toBe(201);
    const n = ((await r.json()) as { number: number }).number;
    expect(blockOf(s.w.pulls[n]!.body)).toMatchObject({ member: memberRef('ben@studio.test'), memberName: 'Ben' });
    // Nor rename it as someone else later: the block keeps naming who started it.
    expect((await b.call('PATCH', `${C}/pulls/${n}`, { body: block({ v: 1, name: 'bens', member: memberRef('ana@studio.test'), memberName: 'Ana' }) })).status).toBe(200);
    expect(blockOf(s.w.pulls[n]!.body)).toMatchObject({ member: memberRef('ben@studio.test'), memberName: 'Ben' });
  });
});

describe('a GitHub designer and an email designer on the same product', () => {
  it("the GitHub designer cannot write to the email designer's exploration", async () => {
    const s = setup();
    const a = await emailDesigner(s, 'ana@studio.test', 'Ana');
    const dina = githubDesigner(s, DINA);
    const n = await start(s, a, 'orders');
    await expectRefused(dina, s, 'explore/orders', n);
    await expectOwnerWorks(a, s, 'explore/orders', n);
  });

  it("the email designer cannot write to the GitHub designer's exploration", async () => {
    const s = setup();
    const a = await emailDesigner(s, 'ana@studio.test', 'Ana');
    const dina = githubDesigner(s, DINA);
    const n = await start(s, dina, 'invoices');
    await expectRefused(a, s, 'explore/invoices', n);
    await expectOwnerWorks(dina, s, 'explore/invoices', n);
  });
});

describe('an exploration a lead made on GitHub (no owner kept by Bridge)', () => {
  it('is nobody\'s through Bridge: designers are refused, the lead keeps GitHub', async () => {
    const s = setup();
    const a = await emailDesigner(s, 'ana@studio.test', 'Ana');
    const dina = githubDesigner(s, DINA);
    s.w.branches['explore/lead-idea'] = NOTE;
    s.w.pulls[5] = { ref: 'explore/lead-idea', user: 'lena', title: 'Exploration: lead idea', body: block({ v: 1, name: 'lead idea', author: 'lena' }), state: 'open' };
    await expectRefused(a, s, 'explore/lead-idea', 5);
    await expectRefused(dina, s, 'explore/lead-idea', 5);
    const lead = await githubDesigner(s, LENA).call('PATCH', `${C}/git/refs/heads/explore/lead-idea`, { sha: NEXT });
    expect(lead.status).toBe(403);
    expect(((await lead.json()) as { message: string }).message).toBe(LEADS_DIRECT);
    expect(await s.redis.cmd('GET', `bridge:contrib:branch:${COPY}:explore/lead-idea`)).toBeNull();
  });
});

describe('a copy made again (its pull requests re-opened by the lead, numbers starting over)', () => {
  /**
   * The copy as on 2026-11-02: #1 and #4 re-opened by the lead (peterbono); #4 is Dino's exploration, its block naming
   * him by member reference; #3 was Dina's on GitHub, its block naming her login. Bridge kept owners by number from the
   * old copy: old #1 was Ana's, old #4 was Ben's. No branch owner survived.
   */
  async function remade() {
    const s = setup();
    const ana = await emailDesigner(s, 'ana@studio.test', 'Ana');
    const ben = await emailDesigner(s, 'ben@studio.test', 'Ben');
    const dino = await emailDesigner(s, 'dino@studio.test', 'Dino');
    const dina = githubDesigner(s, DINA);
    for (const b of ['explore/dashboard', 'explore/invoices-header', 'explore/add-a-toast-alert']) s.w.branches[b] = NOTE;
    s.w.pulls[1] = { ref: 'explore/dashboard', user: 'peterbono', title: 'Exploration: Dashboard', body: block({ v: 1, name: 'Dashboard', doneBy: 'peterbono' }), state: 'open' };
    s.w.pulls[3] = { ref: 'explore/invoices-header', user: 'peterbono', title: 'Exploration: Invoices header', body: block({ v: 1, name: 'Invoices header', author: 'dina' }), state: 'open' };
    s.w.pulls[4] = { ref: 'explore/add-a-toast-alert', user: 'peterbono', title: 'Exploration: add a toast alert', body: `${block({ v: 1, name: 'add a toast alert', member: memberRef('dino@studio.test'), memberName: 'Dino' })}\n\nRequested by Dino through Bridge.`, state: 'open' };
    s.w.next = 5;
    await s.redis.cmd('SET', `bridge:contrib:issue:${COPY}:1`, 'ana@studio.test');
    await s.redis.cmd('SET', `bridge:contrib:issue:${COPY}:4`, 'ben@studio.test');
    return { s, ana, ben, dino, dina };
  }

  it("an owner kept by number from the old copy gives no hold on the new pull request with that number", async () => {
    const { s, ana, ben } = await remade();
    await expectRefused(ana, s, 'explore/dashboard', 1);
    await expectRefused(ben, s, 'explore/add-a-toast-alert', 4);
    // The stale numbers are forgotten.
    expect(await s.redis.cmd('GET', `bridge:contrib:issue:${COPY}:1`)).toBeNull();
    expect(await s.redis.cmd('GET', `bridge:contrib:issue:${COPY}:4`)).toBeNull();
  });

  it('Dino keeps his exploration: its block names him, whoever re-opened it', async () => {
    const { s, dino } = await remade();
    await expectOwnerWorks(dino, s, 'explore/add-a-toast-alert', 4);
    expect(await s.redis.cmd('GET', `bridge:contrib:branch:${COPY}:explore/add-a-toast-alert`)).toBe('dino@studio.test');
    expect(await s.redis.cmd('GET', `bridge:contrib:issue:${COPY}:4`)).toBe('dino@studio.test');
    expect(blockOf(s.w.pulls[4]!.body)).toMatchObject({ member: memberRef('dino@studio.test'), memberName: 'Dino' });
  });

  it('a GitHub designer keeps hers when its block names her login, though the lead re-opened it', async () => {
    const { s, dina } = await remade();
    await expectOwnerWorks(dina, s, 'explore/invoices-header', 3);
    expect(await s.redis.cmd('GET', `bridge:contrib:branch:${COPY}:explore/invoices-header`)).toBe('gh:dina');
  });

  it("nobody claims another's: Dino is refused on Dina's and the lead's, Dina on Dino's", async () => {
    const { s, dino, dina } = await remade();
    await expectRefused(dino, s, 'explore/invoices-header', 3);
    await expectRefused(dino, s, 'explore/dashboard', 1);
    await expectRefused(dina, s, 'explore/add-a-toast-alert', 4);
  });

  it('a branch Bridge keeps for someone wins over what a pull request says', async () => {
    const { s, dino } = await remade();
    await s.redis.cmd('SET', `bridge:contrib:branch:${COPY}:explore/add-a-toast-alert`, 'ana@studio.test');
    await expectRefused(dino, s, 'explore/add-a-toast-alert', 4);
  });
});

describe('a design lead signed in by email (the member record says so, never the browser)', () => {
  async function lead(s: World0): Promise<Designer> {
    const d = await emailDesigner(s, 'lea@acme.com', 'Lea');
    await s.members.put(TEAM, { ...(await s.members.get(TEAM, 'lea@acme.com'))!, lead: true });
    return d;
  }
  const words = (e: Record<string, unknown>) => block({ v: 1, name: 'orders', slug: 'orders', ...e });
  const yes = { kind: 'changes', at: '2026-11-02T11:00:00Z', round: 1, byName: 'Lea', text: 'Tighter' };

  it("answers on someone else's exploration, and it stays theirs", async () => {
    const s = setup();
    const ann = await emailDesigner(s, 'ann@acme.com', 'Ann');
    const n = await start(s, ann, 'orders');
    const l = await lead(s);
    const body = `${s.w.pulls[n]!.body}\n\n${''}`.replace(/"slug":"orders"/, `"slug":"orders","decisions":${JSON.stringify([yes])}`);
    expect((await l.call('PATCH', `${C}/pulls/${n}`, { body })).status).toBe(200);
    expect(blockOf(s.w.pulls[n]!.body)).toMatchObject({ memberName: 'Ann', decisions: [{ kind: 'changes', byName: 'Lea' }] });
    expect(await s.redis.cmd('GET', `bridge:contrib:branch:${COPY}:explore/orders`)).toBe('ann@acme.com');
    expect((await l.call('POST', `${C}/issues/${n}/labels`, { labels: ['ready-for-devs'] })).status).toBe(201);
  });
  it('never pushes to it', async () => {
    const s = setup();
    const n = await start(s, await emailDesigner(s, 'ann@acme.com', 'Ann'), 'orders');
    const l = await lead(s);
    expect((await l.call('PATCH', `${C}/git/refs/heads/explore/orders`, { sha: NEXT })).status).toBe(403);
    expect(n).toBeGreaterThan(0);
  });
  it('the designer cannot write a lead\'s word in their own exploration', async () => {
    const s = setup();
    const ann = await emailDesigner(s, 'ann@acme.com', 'Ann');
    const n = await start(s, ann, 'orders');
    for (const body of [words({ decisions: [{ ...yes, kind: 'looks-right' }] }), words({ leadOkBy: 'lena' }), words({ doneAt: '2026-11-02T11:00:00Z' })]) {
      const r = await ann.call('PATCH', `${C}/pulls/${n}`, { body });
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: string }).error).toBe('lead-only');
    }
    expect((await ann.call('POST', `${C}/issues/${n}/labels`, { labels: ['ready-for-devs'] })).status).toBe(403);
  });
  it('the designer still asks and answers', async () => {
    const s = setup();
    const ann = await emailDesigner(s, 'ann@acme.com', 'Ann');
    const n = await start(s, ann, 'orders');
    expect((await ann.call('PATCH', `${C}/pulls/${n}`, { body: words({ leadAskedAt: '2026-11-02T11:00:00Z', leadAskedTo: ['lena'] }) })).status).toBe(200);
  });
  it('the keeper action refuses anyone but a lead, whatever they send', async () => {
    const s = setup();
    await emailDesigner(s, 'ann@acme.com', 'Ann');
    const m = (await s.members.get(TEAM, 'ann@acme.com'))!;
    const cookie = issueSession(m, TEAM, SECRET, T0).split(';')[0]!;
    const post = (over: Record<string, unknown>) => handleContribute(new Request(`${ORIGIN}/api/contribute`, { method: 'POST', headers: { ...H, cookie }, body: JSON.stringify({ action: 'exploration-keeper', repo: TEAM, branch: 'explore/orders', number: 1, login: 'x', ...over }) }), ENV, s.deps);
    expect((await post({ lead: true })).status).toBe(403);
    await s.members.put(TEAM, { ...m, lead: true });
    expect((await post({})).status).toBe(200);
  });
  it("a lead never decides on their own exploration", async () => {
    const s = setup();
    const l = await lead(s);
    const n = await start(s, l, 'orders');
    const body = s.w.pulls[n]!.body.replace(/"slug":"orders"/, `"slug":"orders","decisions":${JSON.stringify([{ ...yes, kind: 'looks-right' }])}`);
    const r = await l.call('PATCH', `${C}/pulls/${n}`, { body });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('lead-only');
  });
  it('with review shared, any designer answers on another\'s exploration, never on their own', async () => {
    const s = setup();
    await s.redis.cmd('SET', `bridge:review-mode:${TEAM.toLowerCase()}`, 'shared');
    const ann = await emailDesigner(s, 'ann@acme.com', 'Ann');
    const ben = await emailDesigner(s, 'ben@acme.com', 'Ben');
    const n = await start(s, ann, 'orders');
    const said = (who: string) => s.w.pulls[n]!.body.replace(/"slug":"orders"/, `"slug":"orders","decisions":${JSON.stringify([{ ...yes, byName: who }])}`);
    expect((await ann.call('PATCH', `${C}/pulls/${n}`, { body: said('Ann') })).status).toBe(403);
    expect((await ben.call('PATCH', `${C}/pulls/${n}`, { body: said('Ben') })).status).toBe(200);
    expect(blockOf(s.w.pulls[n]!.body)).toMatchObject({ memberName: 'Ann', decisions: [{ kind: 'changes', byName: 'Ben' }] });
  });
  it('"Shared, no review": Done exploring waits for the PM\'s Looks good, on the server too', async () => {
    const s = setup();
    await s.redis.cmd('SET', `bridge:review-mode:${TEAM}`, 'shared-none');
    await s.redis.cmd('SET', `bridge:pm:${TEAM}`, JSON.stringify({ shop: { login: 'dino', name: 'Dino' } }));
    const ann = await emailDesigner(s, 'ann@acme.com', 'Ann');
    const n = await start(s, ann, 'orders');
    const done = () => s.w.pulls[n]!.body.replace(/"slug":"orders"/, '"slug":"orders","doneAt":"2026-11-07T12:00:00Z"');
    const r = await ann.call('PATCH', `${C}/pulls/${n}`, { body: done() });
    expect(r.status).toBe(403);
    expect((await r.json()) as { error: string; message: string }).toMatchObject({ error: 'pm-first', message: expect.stringContaining('Dino says it looks good') });
    expect((await ann.call('POST', `${C}/issues/${n}/labels`, { labels: ['ready-for-devs'] })).status).toBe(403);
    // The PM said Looks good: it goes.
    s.w.pulls[n]!.body = s.w.pulls[n]!.body.replace(/"slug":"orders"/, `"slug":"orders","decisions":${JSON.stringify([{ kind: 'pm-ok', at: 't', round: 1, by: 'dino' }])}`);
    expect((await ann.call('PATCH', `${C}/pulls/${n}`, { body: done() })).status).toBe(200);
  });
  it('what is left of a lead is gone with the record', async () => {
    const s = setup();
    const n = await start(s, await emailDesigner(s, 'ann@acme.com', 'Ann'), 'orders');
    const l = await lead(s);
    await s.members.put(TEAM, { ...(await s.members.get(TEAM, 'lea@acme.com'))!, lead: false });
    expect((await l.call('PATCH', `${C}/pulls/${n}`, { body: words({}) })).status).toBe(403);
  });
});
