// The /api/contribute Vercel function (api/contribute/index.ts) with a mocked GitHub, an in-memory Redis and a fake
// email: joining with an email, sessions and their revocation, sign-in links, and the proxy policy, rule by rule.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import {
  cookieName,
  type ContribDeps,
  EXPIRED,
  type FetchLike,
  GITHUB_REQUIRED,
  handleContribute,
  NOT_ALLOWED,
  SESSION_TTL_MS,
  signSession,
  SIGNIN_TTL_MS,
  WRITE_LIMIT_DEFAULT,
  parseTarget,
  validBranch,
  cleanName,
  clearDesignPathCache,
  DESIGN_ONLY,
  designPathsFrom,
  isDesignPath,
  publicEmail,
} from '../../api/contribute/index';
import { inviteStoreOn, type EmailMessage, type Role, type StoredInvite } from '../../api/invites/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const REPO = 'acme/design';
const T0 = Date.parse('2026-10-22T10:00:00Z');
const SECRET = 's'.repeat(40);
/** A commit whose changes are design files only; SHA_BAD also touches package.json. */
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const SHA_BAD = 'c'.repeat(40);
const CONFIG = JSON.stringify({
  tokens: { root: 'design/tokens' },
  components: { dir: 'src/components', docsSuffix: '.docs.json' },
  changesets: { dir: '.changeset' },
  governance: { guardrails: ['AGENTS.md', '.github/', 'bridge.config.json', 'design/tokens/contrast.checks.json'] },
});
const ENV = { LIBRARY_SESSION_SECRET: SECRET };

interface Call {
  method: string;
  path: string;
  auth: string;
  body?: any;
  headers: Record<string, string>;
}

interface World {
  /** Branches that exist on GitHub. */
  branches: string[];
  private: boolean;
  /** bridge.config.json on the default branch, or null when there is none. */
  config: string | null;
  /** Files each commit changes from main (compare main...sha). */
  compare: Record<string, { filename: string; previous_filename?: string }[]>;
  next: number;
  calls: Call[];
}

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    expect(u.origin).toBe('https://api.github.com');
    const path = u.pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path: path + u.search, auth: init.headers.Authorization ?? '', body, headers: init.headers });
    const m = init.method;
    let x: RegExpExecArray | null;
    if (m === 'GET' && path === '/repos/acme/design') return res(200, { default_branch: 'main', private: w.private });
    if (m === 'GET' && (x = /^\/repos\/acme\/design\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const b = x[1]!.split('/').map(decodeURIComponent).join('/');
      return w.branches.includes(b) ? res(200, { object: { sha: 'abc' } }) : res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && (x = /^\/repos\/acme\/design\/compare\/main\.\.\.([0-9a-f]{40})$/.exec(path))) {
      const files = w.compare[x[1]!];
      return files ? res(200, { files }) : res(404, { message: 'Not Found' });
    }
    if (m === 'GET' && path === '/repos/acme/design/contents/bridge.config.json') {
      expect(u.searchParams.get('ref')).toBe('main');
      expect(init.headers.Accept).toBe('application/vnd.github.raw');
      return w.config === null ? res(404, { message: 'Not Found' }) : new Response(w.config, { status: 200 });
    }
    if (m === 'GET') return res(200, [{ ok: true }], { Link: '<https://api.github.com/repos/acme/design/pulls?page=2>; rel="next"', ETag: '"e1"' });
    if (m === 'POST' && path === '/repos/acme/design/git/refs') {
      w.branches.push(String(body.ref).replace('refs/heads/', ''));
      return res(201, { ref: body.ref });
    }
    if (m === 'POST' && (path === '/repos/acme/design/pulls' || path === '/repos/acme/design/issues')) return res(201, { number: w.next++ });
    if (m === 'DELETE' || (m === 'PUT' && path.endsWith('/update-branch'))) return res(m === 'DELETE' ? 200 : 202, { ok: true });
    return res(m === 'POST' ? 201 : 200, { ok: true });
  };
}

function setup(over: Partial<ContribDeps> = {}, world: Partial<World> = {}) {
  clearDesignPathCache();
  const w: World = { branches: ['main', 'theirs'], private: true, config: CONFIG, compare: { [SHA]: [], [SHA2]: [{ filename: 'design/tokens/color.tokens.json' }], [SHA_BAD]: [{ filename: 'design/tokens/a.tokens.json' }, { filename: 'package.json' }] }, next: 40, calls: [], ...world };
  let now = T0;
  let seed = 0;
  const redis = memoryRedis(() => now);
  const invites = inviteStoreOn(redis, () => now);
  const members = memberStore(redis);
  const sent: EmailMessage[] = [];
  const deps: ContribDeps = {
    fetch: github(w),
    now: () => now,
    random: (n) => Uint8Array.from({ length: n }, () => (seed = (seed + 7) % 256)),
    redis,
    email: { send: async (msg) => void sent.push(msg) },
    app: { installationToken: async () => 'ghs_contrib' },
    ...over,
  };
  let k = 0;
  /** A pending invite as api/invites stores it; returns its link token. */
  const invite = async (email = 'mia@acme.design', role: Role = 'edit', repo = REPO) => {
    const token = (String(++k) + 'x'.repeat(43)).slice(0, 43);
    const inv: StoredInvite = {
      id: `${'a'.repeat(15)}${k}`,
      repo,
      email,
      role,
      ...(role === 'reviewer' ? { reviewAs: 'design' as const } : {}),
      invitedBy: 'dana',
      createdAt: new Date(now).toISOString(),
      sentAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 864e5).toISOString(),
      tokenHash: createHash('sha256').update(token).digest('hex'),
    };
    await invites.put(inv, 7 * 86400);
    return token;
  };
  return { w, deps, redis, invites, members, sent, invite, tick: (ms: number) => (now += ms) };
}

const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-contribute': '1', 'sec-fetch-site': 'same-origin' };

const act = (body: unknown, extra: Record<string, string> = {}) => new Request(`${ORIGIN}/api/contribute`, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify(body) });

const status = (cookie = '', repo = REPO) => new Request(`${ORIGIN}/api/contribute?repo=${repo}`, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } });

function gh(method: string, path: string, cookie: string, body?: unknown, extra: Record<string, string> = {}, repo = REPO): Request {
  const headers: Record<string, string> = method === 'GET' ? { host: HOST, cookie, ...extra } : { ...H, cookie, ...extra };
  return new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(repo)}&gh=${encodeURIComponent(path)}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

/** Accepts a fresh "Can edit" invite and returns the session cookie. */
async function join(s: ReturnType<typeof setup>, email = 'mia@acme.design', name = 'Mia Chen') {
  const r = await handleContribute(act({ action: 'accept', token: await s.invite(email), name }), ENV, s.deps);
  expect(r.status).toBe(200);
  return cookieOf(r);
}

const P = '/repos/acme/design';

describe('availability', () => {
  it('is unavailable without storage, the secret or the app, and says no member', async () => {
    const bare: ContribDeps = { fetch: async () => res(599) };
    expect(await (await handleContribute(status(), {}, bare)).json()).toEqual({ available: false, member: null });
    expect(await (await handleContribute(status(), { ...ENV, KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't' }, bare)).json()).toEqual({ available: false, member: null });
    const short = await handleContribute(status(), { LIBRARY_SESSION_SECRET: 'short' }, setup().deps);
    expect((await short.json()).available).toBe(false);
    const r = await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'a@b.co' }), {}, bare);
    expect(r.status).toBe(503);
  });

  it('is available once configured; no cookie, no member', async () => {
    const s = setup();
    expect(await (await handleContribute(status(), ENV, s.deps)).json()).toEqual({ available: true, member: null });
  });

  it('refuses a malformed repository', async () => {
    const s = setup();
    expect((await handleContribute(status('', 'acme/..'), ENV, s.deps)).status).toBe(400);
    expect((await handleContribute(gh('GET', '/repos/acme/design', '', undefined, {}, 'acme'), ENV, s.deps)).status).toBe(400);
  });
});

describe('accept with the email', () => {
  it('joins a Can edit invite, stores the member, spends the invite and sets a scoped cookie', async () => {
    const s = setup();
    const token = await s.invite('Mia@Acme.design');
    const r = await handleContribute(act({ action: 'accept', token, name: 'Mia Chen' }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ member: { email: 'mia@acme.design', name: 'Mia Chen', role: 'edit' }, repo: REPO });
    const set = r.headers.get('set-cookie')!;
    expect(set.startsWith(`${cookieName(REPO)}=v1.`)).toBe(true);
    expect(cookieName(REPO)).toBe(`bridge_contrib_${createHash('sha256').update(REPO).digest('hex').slice(0, 16)}`);
    for (const part of ['Path=/api/contribute', 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${SESSION_TTL_MS / 1000}`]) expect(set).toContain(part);
    expect(await s.members.get(REPO, 'mia@acme.design')).toMatchObject({ email: 'mia@acme.design', role: 'edit', version: 1, addedBy: 'dana' });
    expect(await s.redis.cmd('SMEMBERS', `bridge:members:${REPO}`)).toEqual(['mia@acme.design']);
    expect(await s.invites.list(REPO)).toEqual([]);
    const st = await handleContribute(status(cookieOf(r)), ENV, s.deps);
    expect(await st.json()).toEqual({ available: true, member: { email: 'mia@acme.design', name: 'Mia Chen', role: 'edit' } });
    // No GitHub call at all: the inbox is the proof.
    expect(s.w.calls).toEqual([]);
  });

  it('accept twice: 410', async () => {
    const s = setup();
    const token = await s.invite();
    expect((await handleContribute(act({ action: 'accept', token, name: 'Mia' }), ENV, s.deps)).status).toBe(200);
    const again = await handleContribute(act({ action: 'accept', token, name: 'Mia' }), ENV, s.deps);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: 'expired', message: EXPIRED });
  });

  it('refuses a reviewer or admin invite with 409 github-required, and keeps it for the GitHub way', async () => {
    const s = setup();
    for (const role of ['reviewer', 'admin'] as const) {
      const token = await s.invite(`${role}@acme.design`, role);
      const r = await handleContribute(act({ action: 'accept', token, name: 'X' }), ENV, s.deps);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: 'github-required', message: GITHUB_REQUIRED });
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    expect(await s.invites.list(REPO)).toHaveLength(2);
    expect(await s.members.list(REPO)).toEqual([]);
  });

  it('refuses an expired, unknown or malformed token with 410', async () => {
    const s = setup();
    const token = await s.invite();
    s.tick(8 * 864e5);
    expect((await handleContribute(act({ action: 'accept', token, name: 'Mia' }), ENV, s.deps)).status).toBe(410);
    for (const bad of ['y'.repeat(43), 'short', 42, undefined]) expect((await handleContribute(act({ action: 'accept', token: bad }), ENV, s.deps)).status).toBe(410);
  });

  it('keeps a name plain: no markdown, no links, never empty', () => {
    expect(cleanName('  Mia   Chen ', 'mia@acme.design')).toBe('Mia Chen');
    expect(cleanName('**Boss** [x](https://evil.example) <b>', 'mia@acme.design')).toBe('Boss x https evil.example b');
    expect(cleanName('Zoë O\'Neil-Ávila', 'z@acme.design')).toBe("Zoë O'Neil-Ávila");
    expect(cleanName('', 'mia.chen@acme.design')).toBe('mia.chen');
    expect(cleanName(undefined, '_@acme.design')).toBe('Contributor');
    expect(cleanName('x'.repeat(200), 'a@b.co')).toHaveLength(80);
  });

  it('needs the X-Bridge-Contribute header, JSON, and a page of this site when there is an Origin', async () => {
    const s = setup();
    const token = await s.invite();
    const noHeader = new Request(`${ORIGIN}/api/contribute`, { method: 'POST', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'accept', token }) });
    expect((await handleContribute(noHeader, ENV, s.deps)).status).toBe(403);
    expect((await handleContribute(act({ action: 'accept', token }, { origin: 'https://evil.example' }), ENV, s.deps)).status).toBe(403);
    expect((await handleContribute(act({ action: 'accept', token }, { 'sec-fetch-site': 'cross-site' }), ENV, s.deps)).status).toBe(403);
    expect((await handleContribute(act({ action: 'accept', token }, { 'content-type': 'text/plain' }), ENV, s.deps)).status).toBe(415);
    const { origin: _o, ...noOrigin } = H;
    const ok = new Request(`${ORIGIN}/api/contribute`, { method: 'POST', headers: noOrigin, body: JSON.stringify({ action: 'accept', token, name: 'Mia' }) });
    expect((await handleContribute(ok, ENV, s.deps)).status).toBe(200);
  });
});

describe('sessions', () => {
  it('a removed member gets 401 at once, and the cookie is cleared', async () => {
    const s = setup();
    const cookie = await join(s);
    expect((await handleContribute(gh('GET', `${P}/pulls`, cookie), ENV, s.deps)).status).toBe(200);
    await s.members.remove(REPO, 'mia@acme.design');
    const r = await handleContribute(gh('GET', `${P}/pulls`, cookie), ENV, s.deps);
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await (await handleContribute(status(cookie), ENV, s.deps)).json()).toEqual({ available: true, member: null });
  });

  it('joining again bumps the version: the old session gets 401, the new one works', async () => {
    const s = setup();
    const old = await join(s);
    const fresh = await join(s);
    expect((await s.members.get(REPO, 'mia@acme.design'))!.version).toBe(2);
    expect((await handleContribute(gh('GET', `${P}/pulls`, old), ENV, s.deps)).status).toBe(401);
    expect((await handleContribute(gh('GET', `${P}/pulls`, fresh), ENV, s.deps)).status).toBe(200);
  });

  it('refuses a tampered, foreign-secret or expired cookie', async () => {
    const s = setup();
    const cookie = await join(s);
    const [name, value] = cookie.split('=') as [string, string];
    const [v, claims, mac] = value.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(claims, 'base64url').toString()), email: 'boss@acme.design' })).toString('base64url');
    for (const bad of [`${name}=${v}.${forged}.${mac}`, `${name}=${v}.${claims}.${mac.slice(0, -2)}AA`, `${name}=garbage`]) {
      expect((await handleContribute(gh('GET', `${P}/pulls`, bad), ENV, s.deps)).status).toBe(401);
    }
    const other = signSession({ repo: REPO, email: 'mia@acme.design', name: 'Mia', v: 1, exp: T0 + 1e9 }, 'z'.repeat(40));
    expect((await handleContribute(gh('GET', `${P}/pulls`, `${name}=${other}`), ENV, s.deps)).status).toBe(401);
    s.tick(SESSION_TTL_MS + 1);
    expect((await handleContribute(gh('GET', `${P}/pulls`, cookie), ENV, s.deps)).status).toBe(401);
  });

  it('a cookie works only for its own repository', async () => {
    const s = setup();
    const cookie = await join(s);
    const value = cookie.split('=')[1]!;
    // Under the other team's cookie name, the claims still name acme/design.
    await s.members.put('acme/other', { email: 'mia@acme.design', name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at: '' });
    const r = await handleContribute(gh('GET', '/repos/acme/other/pulls', `${cookieName('acme/other')}=${value}`, undefined, {}, 'acme/other'), ENV, s.deps);
    expect(r.status).toBe(401);
    // And with the right cookie, the path must stay in the session's repository.
    expect((await handleContribute(gh('GET', '/repos/acme/other/pulls', cookie), ENV, s.deps)).status).toBe(403);
  });

  it('sign-out clears the cookie', async () => {
    const s = setup();
    const r = await handleContribute(act({ action: 'sign-out', repo: REPO }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toBe(`${cookieName(REPO)}=; Max-Age=0; Path=/api/contribute; HttpOnly; Secure; SameSite=Lax`);
  });
});

describe('sign-in links', () => {
  it('answers ok for a non-member and sends nothing', async () => {
    const s = setup();
    const r = await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'stranger@acme.design' }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(s.sent).toEqual([]);
  });

  it('emails a member a one-time link to Studio; verify sets the session, once, within 15 minutes', async () => {
    const s = setup();
    await join(s);
    const r = await handleContribute(act({ action: 'sign-in', repo: 'Acme/design', email: ' MIA@acme.design ' }), ENV, s.deps);
    expect(await r.json()).toEqual({ ok: true });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe('mia@acme.design');
    const token = /\/studio\/Acme\/design\/#contribute=([A-Za-z0-9_-]{43})/.exec(s.sent[0]!.text)![1]!;
    expect(s.sent[0]!.text).toContain(`${ORIGIN}/studio/Acme/design/#contribute=`);
    // Only the hash is stored.
    expect(s.redis.keys().some((k) => k.includes(token))).toBe(false);
    const v = await handleContribute(act({ action: 'verify', repo: REPO, token }), ENV, s.deps);
    expect(v.status).toBe(200);
    expect(await v.json()).toEqual({ member: { email: 'mia@acme.design', name: 'Mia Chen', role: 'edit' } });
    expect((await handleContribute(gh('GET', `${P}/pulls`, cookieOf(v)), ENV, s.deps)).status).toBe(200);
    expect((await handleContribute(act({ action: 'verify', repo: REPO, token }), ENV, s.deps)).status).toBe(410);

    await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, s.deps);
    const late = /#contribute=([A-Za-z0-9_-]+)/.exec(s.sent[1]!.text)![1]!;
    s.tick(SIGNIN_TTL_MS + 1000);
    expect((await handleContribute(act({ action: 'verify', repo: REPO, token: late }), ENV, s.deps)).status).toBe(410);
  });

  it('a link for one team does not open another, and a removed member cannot verify', async () => {
    const s = setup();
    await join(s);
    await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, s.deps);
    const token = /#contribute=([A-Za-z0-9_-]+)/.exec(s.sent[0]!.text)![1]!;
    expect((await handleContribute(act({ action: 'verify', repo: 'acme/other', token }), ENV, s.deps)).status).toBe(410);
    await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, s.deps);
    const t2 = /#contribute=([A-Za-z0-9_-]+)/.exec(s.sent[1]!.text)![1]!;
    await s.members.remove(REPO, 'mia@acme.design');
    expect((await handleContribute(act({ action: 'verify', repo: REPO, token: t2 }), ENV, s.deps)).status).toBe(410);
  });

  it('caps links per email, member or not, with 429 and Retry-After; emails never stored in clear', async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) expect((await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'who@acme.design' }), ENV, s.deps)).status).toBe(200);
    const r = await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'who@acme.design' }), ENV, s.deps);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('limit');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(s.redis.keys().some((k) => k.includes('who@'))).toBe(false);
  });

  it('refuses something that is not an email', async () => {
    const s = setup();
    expect((await handleContribute(act({ action: 'sign-in', repo: REPO, email: 'nope' }), ENV, s.deps)).status).toBe(400);
  });
});

describe('proxy: what is allowed', () => {
  async function ready(world: Partial<World> = {}) {
    const s = setup({}, world);
    const cookie = await join(s);
    const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
      const before = s.w.calls.length;
      const r = await handleContribute(gh(method, path, cookie, body, extra), ENV, s.deps);
      const sent = s.w.calls.slice(before).filter((c) => c.method === method && c.path === path);
      return { r, sent: sent[sent.length - 1] };
    };
    /** Creates a branch through the proxy: it becomes Mia's. */
    const branch = async (b: string) => expect((await call('POST', `${P}/git/refs`, { ref: `refs/heads/${b}`, sha: SHA })).r.status).toBe(201);
    return { s, cookie, call, branch };
  }

  it('GET reads anything in the repository, with the app token, passing status, body, Link and ETag', async () => {
    const { s, call } = await ready();
    const { r, sent } = await call('GET', `${P}/pulls?state=open&per_page=100`, undefined, { accept: 'application/vnd.github.raw', 'if-none-match': '"e0"' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ ok: true }]);
    expect(r.headers.get('link')).toContain('rel="next"');
    expect(r.headers.get('etag')).toBe('"e1"');
    expect(sent!.auth).toBe('Bearer ghs_contrib');
    expect(sent!.headers.Accept).toBe('application/vnd.github.raw');
    expect(sent!.headers['If-None-Match']).toBe('"e0"');
    expect(JSON.stringify(sent!.headers)).not.toContain('bridge_contrib');
    expect((await call('GET', P)).r.status).toBe(200);
    expect((await call('GET', `${P}/contents/tokens/a%20b.json?ref=main`)).r.status).toBe(200);
    expect((await call('GET', `${P}/compare/main...bridge/x`)).r.status).toBe(200);
    // A GET needs no CSRF header, and is not counted.
    expect(await s.redis.cmd('GET', `bridge:contrib:count:${REPO}:mia@acme.design:2026-10-22`)).toBeNull();
  });

  it('POST git/blobs and git/trees pass as they are', async () => {
    const { call } = await ready();
    const blob = await call('POST', `${P}/git/blobs`, { content: 'aGk=', encoding: 'base64' });
    expect(blob.r.status).toBe(201);
    expect(blob.sent!.body).toEqual({ content: 'aGk=', encoding: 'base64' });
    const tree = await call('POST', `${P}/git/trees`, { base_tree: 'abc', tree: [{ path: 'design/tokens/color.tokens.json', mode: '100644', type: 'blob', sha: 'b1' }] });
    expect(tree.r.status).toBe(201);
    expect(tree.sent!.body).toEqual({ base_tree: 'abc', tree: [{ path: 'design/tokens/color.tokens.json', mode: '100644', type: 'blob', sha: 'b1' }] });
  });

  it('POST git/commits: the member is the author (date kept), any committer dropped', async () => {
    const { call } = await ready();
    const { r, sent } = await call('POST', `${P}/git/commits`, { message: 'm', tree: 't', parents: ['p'], author: { name: 'Boss', email: 'boss@acme.design', date: '2026-10-22T09:00:00Z' }, committer: { name: 'Boss', email: 'boss@acme.design' } });
    expect(r.status).toBe(201);
    expect(sent!.body).toEqual({ message: 'm', tree: 't', parents: ['p'], author: { name: 'Mia Chen', email: 'mia@acme.design', date: '2026-10-22T09:00:00Z' } });
  });

  it('POST git/refs: a new branch, not the default, not existing; it becomes theirs', async () => {
    const { s, call, branch } = await ready();
    await branch('bridge/mia-1');
    expect(await s.redis.cmd('GET', `bridge:contrib:branch:${REPO}:bridge/mia-1`)).toBe('mia@acme.design');
    for (const ref of ['refs/heads/main', 'refs/heads/MAIN', 'refs/heads/theirs', 'refs/heads/bridge/mia-1', 'refs/tags/v1', 'refs/heads/a..b', 'refs/heads/x.lock', 'main']) {
      expect((await call('POST', `${P}/git/refs`, { ref, sha: SHA })).r.status, ref).toBe(403);
    }
  });

  it('PATCH git/refs/heads/<b>: their branch only, never force', async () => {
    const { call, branch } = await ready();
    await branch('bridge/mia-1');
    const ok = await call('PATCH', `${P}/git/refs/heads/bridge/mia-1`, { sha: SHA2, force: false });
    expect(ok.r.status).toBe(200);
    expect(ok.sent!.body).toEqual({ sha: SHA2, force: false });
    expect((await call('PATCH', `${P}/git/refs/heads/bridge/mia-1`, { sha: SHA2, force: true })).r.status).toBe(403);
    expect((await call('PATCH', `${P}/git/refs/heads/theirs`, { sha: SHA2 })).r.status).toBe(403);
    expect((await call('PATCH', `${P}/git/refs/heads/main`, { sha: SHA2 })).r.status).toBe(403);
  });

  it('PUT and DELETE contents: on their branch only, with the member as author', async () => {
    const { call, branch } = await ready();
    await branch('bridge/mia-1');
    const put = await call('PUT', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', content: 'e30=', sha: 'old', branch: 'bridge/mia-1', committer: { name: 'Boss', email: 'boss@acme.design' } });
    expect(put.r.status).toBe(200);
    expect(put.sent!.body).toEqual({ message: 'm', content: 'e30=', sha: 'old', branch: 'bridge/mia-1', author: { name: 'Mia Chen', email: 'mia@acme.design' } });
    const del = await call('DELETE', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', sha: 'old', branch: 'bridge/mia-1' });
    expect(del.r.status).toBe(200);
    expect(del.sent!.body.author).toEqual({ name: 'Mia Chen', email: 'mia@acme.design' });
    for (const b of [undefined, 'main', 'theirs']) {
      expect((await call('PUT', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', content: 'e30=', ...(b ? { branch: b } : {}) })).r.status, String(b)).toBe(403);
      expect((await call('DELETE', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', sha: 'old', ...(b ? { branch: b } : {}) })).r.status, String(b)).toBe(403);
    }
  });

  it('POST pulls: from their branch to the default or their branch; says who asked; the pull request becomes theirs', async () => {
    const { s, call, branch } = await ready();
    await branch('bridge/mia-1');
    await branch('bridge/mia-2');
    const { r, sent } = await call('POST', `${P}/pulls`, { title: 'Ocean brand', head: 'acme:bridge/mia-1', base: 'main', body: 'Why', maintainer_can_modify: true, issue: 3 });
    expect(r.status).toBe(201);
    expect(sent!.body).toEqual({ title: 'Ocean brand', head: 'bridge/mia-1', base: 'main', body: 'Why\n\nRequested by Mia Chen (mia@acme.design) through Bridge.' });
    expect(await s.redis.cmd('GET', `bridge:contrib:issue:${REPO}:40`)).toBe('mia@acme.design');
    expect((await call('POST', `${P}/pulls`, { title: 't', head: 'bridge/mia-2', base: 'bridge/mia-1' })).r.status).toBe(201);
    for (const b of [
      { head: 'evil:bridge/mia-1', base: 'main' },
      { head: 'theirs', base: 'main' },
      { head: 'bridge/mia-1', base: 'theirs' },
      { head: 'main', base: 'bridge/mia-1' },
      { base: 'main' },
    ]) {
      expect((await call('POST', `${P}/pulls`, { title: 't', ...b })).r.status, JSON.stringify(b)).toBe(403);
    }
  });

  it('GET ?mine=1: the branches and pull requests the member made and still owns; signed out, 401', async () => {
    const { s, cookie, call, branch } = await ready();
    await branch('bridge/mia-1');
    expect((await call('POST', `${P}/pulls`, { title: 'Ocean brand', head: 'bridge/mia-1', base: 'main' })).r.status).toBe(201);
    const mine = (c: string) => handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${REPO}&mine=1`, { headers: { host: HOST, ...(c ? { cookie: c } : {}) } }), ENV, s.deps);
    const r = await mine(cookie);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ branches: ['bridge/mia-1'], issues: [40] });
    expect(await s.redis.cmd('SMEMBERS', `bridge:contrib:mine:${REPO}:mia@acme.design`)).toEqual(expect.arrayContaining(['b:bridge/mia-1', 'i:40']));
    // A branch that changed hands is no longer theirs.
    await s.redis.cmd('SET', `bridge:contrib:branch:${REPO}:bridge/mia-1`, 'leo@acme.design');
    expect(await (await mine(cookie)).json()).toEqual({ branches: [], issues: [40] });
    expect((await mine('')).status).toBe(401);
  });

  it('PATCH pulls/<n>: their pull request only, only title, body, state, draft (never base)', async () => {
    const { call, branch } = await ready();
    await branch('bridge/mia-1');
    await call('POST', `${P}/pulls`, { title: 't', head: 'bridge/mia-1', base: 'main' });
    expect((await call('PATCH', `${P}/pulls/40`, { title: 'New', state: 'closed' })).r.status).toBe(200);
    expect((await call('PATCH', `${P}/pulls/40`, { title: 'New', base: 'theirs' })).r.status).toBe(403);
    expect((await call('PATCH', `${P}/pulls/40`, { maintainer_can_modify: false })).r.status).toBe(403);
    expect((await call('PATCH', `${P}/pulls/7`, { title: 'Not mine' })).r.status).toBe(403);
  });

  it('PUT pulls/<n>/update-branch: their pull request only', async () => {
    const { call, branch } = await ready();
    await branch('bridge/mia-1');
    await call('POST', `${P}/pulls`, { title: 't', head: 'bridge/mia-1', base: 'main' });
    expect((await call('PUT', `${P}/pulls/40/update-branch`, { expected_head_sha: 'abc' })).r.status).toBe(202);
    expect((await call('PUT', `${P}/pulls/7/update-branch`, {})).r.status).toBe(403);
  });

  it('POST issues says who asked and becomes theirs; PATCH issues/<n> theirs only, a few keys', async () => {
    const { s, call } = await ready();
    const { r, sent } = await call('POST', `${P}/issues`, { title: 'Add a chip', labels: ['request'], assignees: ['dana'] });
    expect(r.status).toBe(201);
    expect(sent!.body).toEqual({ title: 'Add a chip', labels: ['request'], body: 'Requested by Mia Chen (mia@acme.design) through Bridge.' });
    expect(await s.redis.cmd('GET', `bridge:contrib:issue:${REPO}:40`)).toBe('mia@acme.design');
    expect((await call('PATCH', `${P}/issues/40`, { state: 'closed', labels: [] })).r.status).toBe(200);
    expect((await call('PATCH', `${P}/issues/40`, { assignees: ['dana'] })).r.status).toBe(403);
    expect((await call('PATCH', `${P}/issues/12`, { title: 'x' })).r.status).toBe(403);
  });

  it('POST issues/<n>/comments on any issue or pull request, with their name first; labels on theirs only', async () => {
    const { call } = await ready();
    const c = await call('POST', `${P}/issues/12/comments`, { body: 'Looks good' });
    expect(c.r.status).toBe(201);
    expect(c.sent!.body).toEqual({ body: '**Mia Chen** (via Bridge):\n\nLooks good' });
    expect((await call('POST', `${P}/issues/12/comments`, {})).r.status).toBe(403);
    expect((await call('POST', `${P}/issues/12/labels`, { labels: ['x'] })).r.status).toBe(403);
    await call('POST', `${P}/issues`, { title: 'Mine' });
    expect((await call('POST', `${P}/issues/40/labels`, { labels: ['x'] })).r.status).toBe(201);
  });
});

describe('proxy: what is denied', () => {
  it('refuses merges, reviews, settings, other repositories, traversal and GraphQL, and never calls GitHub for them', async () => {
    const s = setup();
    const cookie = await join(s);
    const before = s.w.calls.length;
    const denied: [string, string, unknown?][] = [
      ['PUT', `${P}/pulls/40/merge`, {}],
      ['POST', `${P}/pulls/40/reviews`, { event: 'APPROVE' }],
      ['POST', `${P}/pulls/40/requested_reviewers`, { reviewers: ['dana'] }],
      ['DELETE', `${P}/pulls/40/requested_reviewers`, { reviewers: ['dana'] }],
      ['POST', `${P}/rulesets`, {}],
      ['PUT', `${P}/branches/main/protection`, {}],
      ['DELETE', `${P}/branches/main/protection`],
      ['PUT', `${P}/collaborators/mallory`, { permission: 'admin' }],
      ['DELETE', `${P}/git/refs/heads/theirs`],
      ['POST', `${P}/hooks`, { config: { url: 'https://evil.example' } }],
      ['PATCH', P, { default_branch: 'evil' }],
      ['DELETE', P],
      ['POST', `${P}/merges`, { base: 'main', head: 'x' }],
      ['POST', `${P}/dispatches`, {}],
      ['POST', `${P}/actions/workflows/ci.yml/dispatches`, {}],
      ['PUT', `${P}/contents`, { branch: 'x' }],
      ['POST', '/graphql', { query: '{ viewer { login } }' }],
      ['POST', '/repos/acme/other/issues', { title: 'x' }],
      ['GET', '/repos/acme/other/contents/secret.json'],
      ['GET', '/user'],
      ['GET', '/repos/acme/design/../other/contents/x'],
      ['GET', '/repos/acme/design/%2e%2e/%2e%2e/acme/other'],
      ['GET', '/repos/acme/design/contents/..%2F..%2Fother'],
      ['GET', '/repos/acme/design/contents/a%5Cb'],
      ['GET', '/repos/acme/design//pulls'],
      ['GET', '/repos/acme/design/pulls#x'],
      ['GET', 'https://evil.example/repos/acme/design'],
      ['GET', '//evil.example/repos/acme/design'],
      ['GET', '/repos/acme/design/pulls\n'],
    ];
    for (const [method, path, body] of denied) {
      const r = await handleContribute(gh(method, path, cookie, body), ENV, s.deps);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(await r.json(), `${method} ${path}`).toEqual({ error: 'not-allowed', message: NOT_ALLOWED });
    }
    // Only reads of the default branch name may have happened, never a denied call.
    expect(s.w.calls.slice(before).every((c) => c.method === 'GET')).toBe(true);
  });

  it('parses paths strictly', () => {
    expect(parseTarget('/repos/Acme/Design/contents/a%20b.json?ref=main', 'acme', 'design')).toEqual({ rest: ['contents', 'a b.json'], rawRest: ['contents', 'a%20b.json'], query: 'ref=main' });
    for (const bad of ['repos/acme/design', '/repos/acme/design/a/./b', '/repos/acme/design/%', '/repos/acme', '/repos/acme/designer/x']) expect(() => parseTarget(bad, 'acme', 'design'), bad).toThrow();
    expect(validBranch('bridge/mia-1')).toBe(true);
    for (const bad of ['', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', '/a', 'a/', 'a.', 'a.lock', 'a//b', '@', 'a@{1}', 'a/.b', 'a\\b']) expect(validBranch(bad), bad).toBe(false);
  });

  it('needs a session (401) and the CSRF header on writes (403)', async () => {
    const s = setup();
    expect((await handleContribute(gh('GET', `${P}/pulls`, ''), ENV, s.deps)).status).toBe(401);
    const cookie = await join(s);
    const noHeader = new Request(`${ORIGIN}/api/contribute?repo=${REPO}&gh=${encodeURIComponent(`${P}/issues`)}`, { method: 'POST', headers: { host: HOST, cookie, 'content-type': 'application/json' }, body: '{"title":"x"}' });
    expect((await handleContribute(noHeader, ENV, s.deps)).status).toBe(403);
    expect((await handleContribute(gh('POST', `${P}/issues`, cookie, { title: 'x' }, { origin: 'https://evil.example' }), ENV, s.deps)).status).toBe(403);
  });

  it('refuses a body over 5 MB with 413', async () => {
    const s = setup();
    const cookie = await join(s);
    const r = await handleContribute(gh('POST', `${P}/git/blobs`, cookie, { content: 'a'.repeat(5 * 1024 * 1024 + 10), encoding: 'utf-8' }), ENV, s.deps);
    expect(r.status).toBe(413);
    expect(s.w.calls.filter((c) => c.path.endsWith('/git/blobs'))).toEqual([]);
  });

  it('says when the app cannot write to the repository', async () => {
    const s = setup({ app: { installationToken: async () => null } });
    const cookie = await join(s);
    const r = await handleContribute(gh('GET', `${P}/pulls`, cookie), ENV, s.deps);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('app_missing');
  });
});

describe('daily write cap', () => {
  it(`defaults to ${WRITE_LIMIT_DEFAULT}, counts writes only, and answers 429 limit over CONTRIB_MAX_WRITES`, async () => {
    const s = setup();
    const cookie = await join(s);
    const env = { ...ENV, CONTRIB_MAX_WRITES: '2' };
    for (let i = 0; i < 2; i++) expect((await handleContribute(gh('POST', `${P}/issues/1/comments`, cookie, { body: 'x' }), env, s.deps)).status).toBe(201);
    expect((await handleContribute(gh('GET', `${P}/pulls`, cookie), env, s.deps)).status).toBe(200);
    const r = await handleContribute(gh('POST', `${P}/issues/1/comments`, cookie, { body: 'x' }), env, s.deps);
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('limit');
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(s.w.calls.filter((c) => c.path.endsWith('/comments'))).toHaveLength(2);
    // A new day starts at zero.
    s.tick(864e5);
    expect((await handleContribute(gh('POST', `${P}/issues/1/comments`, cookie, { body: 'x' }), env, s.deps)).status).toBe(201);
  });
});

async function readyAt(world: Partial<World> = {}) {
  const s = setup({}, world);
  const cookie = await join(s);
  const call = async (method: string, path: string, body?: unknown) => {
    const before = s.w.calls.length;
    const r = await handleContribute(gh(method, path, cookie, body), ENV, s.deps);
    const sent = s.w.calls.slice(before).filter((c) => c.method === method && c.path === path);
    return { r, sent: sent[sent.length - 1] };
  };
  const branch = async (b: string) => expect((await call('POST', `${P}/git/refs`, { ref: `refs/heads/${b}`, sha: SHA })).r.status).toBe(201);
  return { s, call, branch };
}

describe('privacy on a public repository', () => {
  it('never publishes the work email: a stable .invalid address as author, the name alone in Requested by', async () => {
    const { call, branch } = await readyAt({ private: false });
    const stand = publicEmail(SECRET, REPO, 'mia@acme.design');
    expect(stand).toMatch(/^[0-9a-f]{12}@contributors\.bridge\.invalid$/);
    expect(publicEmail(SECRET, REPO, 'MIA@acme.design')).toBe(stand);
    expect(publicEmail(SECRET, 'acme/other', 'mia@acme.design')).not.toBe(stand);
    const commit = await call('POST', `${P}/git/commits`, { message: 'm', tree: 't', parents: ['p'] });
    expect(commit.sent!.body.author).toEqual({ name: 'Mia Chen', email: stand });
    await branch('bridge/mia-1');
    const put = await call('PUT', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' });
    expect(put.sent!.body.author).toEqual({ name: 'Mia Chen', email: stand });
    const pr = await call('POST', `${P}/pulls`, { title: 't', head: 'bridge/mia-1', base: 'main', body: 'Why' });
    expect(pr.sent!.body.body).toBe('Why\n\nRequested by Mia Chen through Bridge.');
    const issue = await call('POST', `${P}/issues`, { title: 't' });
    expect(issue.sent!.body.body).toBe('Requested by Mia Chen through Bridge.');
    const all = JSON.stringify([commit, put, pr, issue].map((x) => x.sent!.body));
    expect(all).not.toContain('mia@acme.design');
  });

  it('keeps the real email on a private repository', async () => {
    const { call } = await readyAt({ private: true });
    expect((await call('POST', `${P}/git/commits`, { message: 'm', tree: 't', parents: [] })).sent!.body.author.email).toBe('mia@acme.design');
    expect((await call('POST', `${P}/issues`, { title: 't' })).sent!.body.body).toBe('Requested by Mia Chen (mia@acme.design) through Bridge.');
  });
});

describe('attribution stays', () => {
  it('a new body of their pull request or issue gets the Requested by line back, once', async () => {
    const { call, branch } = await readyAt();
    const line = 'Requested by Mia Chen (mia@acme.design) through Bridge.';
    await branch('bridge/mia-1');
    await call('POST', `${P}/pulls`, { title: 't', head: 'bridge/mia-1', base: 'main' });
    expect((await call('PATCH', `${P}/pulls/40`, { body: 'Edited, no line' })).sent!.body).toEqual({ body: `Edited, no line\n\n${line}` });
    expect((await call('PATCH', `${P}/pulls/40`, { body: `Kept\n\n${line}` })).sent!.body).toEqual({ body: `Kept\n\n${line}` });
    expect((await call('PATCH', `${P}/pulls/40`, { body: null })).sent!.body).toEqual({ body: line });
    expect((await call('PATCH', `${P}/pulls/40`, { title: 'Only the title' })).sent!.body).toEqual({ title: 'Only the title' });
    await call('POST', `${P}/issues`, { title: 'i' });
    expect((await call('PATCH', `${P}/issues/41`, { body: '' , state: 'open' })).sent!.body).toEqual({ body: line, state: 'open' });
  });
});

describe('design files only', () => {
  const cfg = designPathsFrom(JSON.parse(CONFIG));
  const fallback = designPathsFrom(null);

  it('allows the folders bridge.config.json declares for tokens, docs, changesets and Bridge files', () => {
    for (const p of [
      'design/tokens/color.tokens.json',
      'design/tokens/brands/ocean.tokens.json',
      'src/components/Button/Button.docs.json',
      '.changeset/bridge-ocean.md',
      '.bridge/figma/button.json',
      '.bridge/requests/chip-20261022T100000.png',
      '.bridge/drafts/s1/i1-before.png',
      '.bridge/explorations/ocean.md',
      'design/tokens/sub',
    ]) expect(isDesignPath(p, cfg), p).toBe(true);
  });

  it('refuses code, CI, scripts, package files, tool config, guardrails and anything outside', () => {
    for (const p of [
      'package.json',
      'design/tokens/package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      '.github/workflows/ci.yml',
      'scripts/release.mjs',
      'vite.config.ts',
      'vitest.config.mjs',
      'eslint.config.cjs',
      'src/components/Button/Button.tsx',
      'src/components/Button/Button.module.css',
      'src/components/Button/Button.test.tsx',
      'design/tokens/build.js',
      'design/tokens/tsconfig.json',
      'design/tokens/.npmrc',
      'design/tokens/contrast.checks.json',
      'bridge.config.json',
      'AGENTS.md',
      '.changeset/config.json',
      '.bridge/hook.sh',
      'design/tokens/node_modules/x/index.json',
      'docs/GOVERNANCE.md',
      'README.md',
      'design/tokens/../../package.json',
      '/design/tokens/a.json',
      'design//tokens/a.json',
      '',
    ]) expect(isDesignPath(p, cfg), p).toBe(false);
  });

  it('falls back to the built-in folders without bridge.config.json', () => {
    expect(isDesignPath('tokens/color.tokens.json', fallback)).toBe(true);
    expect(isDesignPath('.changeset/x.md', fallback)).toBe(true);
    expect(isDesignPath('.bridge/figma/x.json', fallback)).toBe(true);
    expect(isDesignPath('src/components/Button/Button.docs.json', fallback)).toBe(false);
    expect(isDesignPath('package.json', fallback)).toBe(false);
  });

  it('enforces it on PUT and DELETE contents, reading bridge.config.json once per 5 minutes', async () => {
    const { s, call, branch } = await readyAt();
    await branch('bridge/mia-1');
    expect((await call('PUT', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' })).r.status).toBe(200);
    expect((await call('PUT', `${P}/contents/src/components/Button/Button.docs.json`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' })).r.status).toBe(200);
    for (const path of ['package.json', '.github/workflows/ci.yml', 'scripts/x.mjs', 'src/components/Button/Button.tsx']) {
      const put = await call('PUT', `${P}/contents/${path}`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' });
      expect(put.r.status, path).toBe(403);
      expect(await put.r.json()).toEqual({ error: 'not-allowed', message: DESIGN_ONLY });
      expect(put.sent).toBeUndefined();
      expect((await call('DELETE', `${P}/contents/${path}`, { message: 'm', sha: 'x', branch: 'bridge/mia-1' })).r.status, path).toBe(403);
    }
    expect(s.w.calls.filter((c) => c.path.startsWith(`${P}/contents/bridge.config.json`))).toHaveLength(1);
    s.tick(5 * 60 * 1000 + 1);
    await call('PUT', `${P}/contents/design/tokens/color.tokens.json`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' });
    expect(s.w.calls.filter((c) => c.path.startsWith(`${P}/contents/bridge.config.json`))).toHaveLength(2);
  });

  it('enforces it on POST git/trees: one bad entry among good ones refuses the whole tree; no submodule or symlink', async () => {
    const { s, call } = await readyAt();
    const good = { path: 'design/tokens/color.tokens.json', mode: '100644', type: 'blob', sha: 'b1' };
    const before = s.w.calls.filter((c) => c.path.endsWith('/git/trees')).length;
    for (const bad of [
      { path: 'package.json', mode: '100644', type: 'blob', sha: 'b2' },
      { path: '.github/workflows/ci.yml', mode: '100644', type: 'blob', sha: 'b2' },
      { path: 'design/tokens/link.json', mode: '120000', type: 'blob', sha: 'b2' },
      { path: 'design/tokens/sub', mode: '160000', type: 'commit', sha: 'b2' },
      { path: 'design/tokens/run.json', mode: '100755', type: 'blob', sha: 'b2' },
      { path: 'scripts', mode: '040000', type: 'tree', sha: 't2' },
    ]) {
      const r = await call('POST', `${P}/git/trees`, { base_tree: 'abc', tree: [good, bad] });
      expect(r.r.status, bad.path).toBe(403);
      expect((await r.r.json()).message).toBe(DESIGN_ONLY);
    }
    expect((await call('POST', `${P}/git/trees`, { base_tree: 'abc', tree: [] })).r.status).toBe(403);
    expect(s.w.calls.filter((c) => c.path.endsWith('/git/trees')).length).toBe(before);
    expect((await call('POST', `${P}/git/trees`, { base_tree: 'abc', tree: [good, { path: '.changeset/x.md', mode: '100644', type: 'blob', content: '---' }] })).r.status).toBe(201);
  });

  it('a branch only points at a commit whose changes are design files, wherever that commit came from', async () => {
    const { call, branch } = await readyAt();
    expect((await call('POST', `${P}/git/refs`, { ref: 'refs/heads/bridge/bad', sha: SHA_BAD })).r.status).toBe(403);
    expect((await call('POST', `${P}/git/refs`, { ref: 'refs/heads/bridge/unknown', sha: 'd'.repeat(40) })).r.status).toBe(403);
    expect((await call('POST', `${P}/git/refs`, { ref: 'refs/heads/bridge/short', sha: 'abc' })).r.status).toBe(403);
    await branch('bridge/mia-1');
    expect((await call('PATCH', `${P}/git/refs/heads/bridge/mia-1`, { sha: SHA2 })).r.status).toBe(200);
    expect((await call('PATCH', `${P}/git/refs/heads/bridge/mia-1`, { sha: SHA_BAD })).r.status).toBe(403);
  });

  it('reads the folders of the repository: a renamed tokens root moves what is allowed', async () => {
    const { call, branch } = await readyAt({ config: JSON.stringify({ tokens: { root: 'packages/ds/tokens' } }) });
    await branch('bridge/mia-1');
    const put = (path: string) => call('PUT', `${P}/contents/${path}`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' });
    expect((await put('packages/ds/tokens/color.tokens.json')).r.status).toBe(200);
    expect((await put('design/tokens/color.tokens.json')).r.status).toBe(403);
  });

  it('uses the built-in folders when the repository has no bridge.config.json', async () => {
    const { call, branch } = await readyAt({ config: null });
    await branch('bridge/mia-1');
    const put = (path: string) => call('PUT', `${P}/contents/${path}`, { message: 'm', content: 'e30=', branch: 'bridge/mia-1' });
    expect((await put('tokens/color.tokens.json')).r.status).toBe(200);
    expect((await put('package.json')).r.status).toBe(403);
  });
});

describe('GET ?members=1: the team for anyone on it', () => {
  const list = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/contribute?repo=${REPO}&members=1`, { headers: { host: HOST, ...headers } });
  /** GitHub with a collaborator list for the app, and a reader token that may read the repository. */
  const withPeople = (s: ReturnType<typeof setup>): ContribDeps => {
    const base = s.deps.fetch;
    return {
      ...s.deps,
      fetch: async (url, init) => {
        const u = new URL(url);
        if (u.pathname === '/repos/acme/design/collaborators') {
          expect(init.headers.Authorization).toBe('Bearer ghs_contrib');
          return res(200, [
            { login: 'peterbono', avatar_url: 'https://avatars.githubusercontent.com/u/1', role_name: 'admin', permissions: { admin: true, push: true, pull: true }, email: 'leak@acme.design', site_admin: false },
          ]);
        }
        if (u.pathname === '/repos/acme/design' && init.headers.Authorization === 'Bearer gho_readerreaderreader01') return res(200, { permissions: { pull: true, push: false, admin: false } });
        if (u.pathname === '/repos/acme/design' && init.headers.Authorization === 'Bearer gho_strangerstranger001') return res(404, { message: 'Not Found' });
        return base(url, init);
      },
    };
  };

  it('lists GitHub people and email members by name to an email contributor, never another email', async () => {
    const s = setup();
    const cookie = await join(s);
    await join(s, 'leo@acme.design', 'Leo Park');
    const r = await handleContribute(list({ cookie }), ENV, withPeople(s));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.collaborators).toEqual([{ login: 'peterbono', avatar_url: 'https://avatars.githubusercontent.com/u/1', role_name: 'admin', permissions: { admin: true, push: true, pull: true } }]);
    expect(body.members).toEqual(expect.arrayContaining([{ name: 'Mia Chen', role: 'edit', you: true }, { name: 'Leo Park', role: 'edit' }]));
    expect(JSON.stringify(body)).not.toContain('@acme.design');
  });

  it('lists them to a GitHub account that can read the repository, and refuses anyone else', async () => {
    const s = setup();
    await join(s);
    const reader = await handleContribute(list({ authorization: 'Bearer gho_readerreaderreader01' }), ENV, withPeople(s));
    expect(reader.status).toBe(200);
    expect((await reader.json()).members).toEqual([{ name: 'Mia Chen', role: 'edit' }]);
    expect((await handleContribute(list({ authorization: 'Bearer gho_strangerstranger001' }), ENV, withPeople(s))).status).toBe(401);
    expect((await handleContribute(list({}), ENV, withPeople(s))).status).toBe(401);
  });
});
