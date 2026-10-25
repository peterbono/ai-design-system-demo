// The /api/library-access Vercel function (api/library-access/index.ts) with a mocked GitHub, an in-memory store and
// a fake email: the setting (admins only), domain matching, the sign-in link, the session cookie and its revocation,
// the caps, and serving a private Library.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  cookieName,
  emailDomainIn,
  EXPIRED,
  type EmailMessage,
  type FetchLike,
  handleLibraryAccess,
  issueSession,
  LIMIT_DEFAULTS,
  LIMIT_WORDS,
  limitsFrom,
  type LibraryDeps,
  type LibrarySetting,
  memoryStore,
  NOT_CONFIGURED,
  NOT_PUBLISHED,
  normalizeDomain,
  parseDomains,
  readSession,
  SESSION_TTL_MS,
  SIGNIN_TTL_MS,
  signSession,
  verifySignature,
  wrongDomainWords,
} from '../../api/library-access/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const REPO = 'acme/design';
const T0 = Date.parse('2026-10-22T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };

interface World {
  users: Record<string, string>;
  /** Permission of each login on acme/design, and whether it is private. */
  admin: Record<string, boolean>;
  private: boolean;
  snapshot: string | null;
  calls: { method: string; path: string; auth: string }[];
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const auth = init.headers.Authorization ?? '';
    w.calls.push({ method: init.method, path: u.pathname + u.search, auth });
    const who = w.users[auth.replace('Bearer ', '')];
    if (u.pathname === '/user') return who ? res(200, { login: who }) : res(401, {});
    if (u.pathname === '/repos/acme/design') {
      if (!who) return res(401, {});
      if (!(who in w.admin)) return res(404, {});
      return res(200, { private: w.private, permissions: { admin: w.admin[who], push: true, pull: true } });
    }
    if (u.pathname.startsWith('/repos/acme/design/contents/')) {
      expect(auth).toBe('Bearer ghs_read');
      expect(init.headers.Accept).toBe('application/vnd.github.raw');
      expect(u.searchParams.get('ref')).toBe('bridge-data');
      if (u.pathname.endsWith('/snapshot.json') && w.snapshot !== null) return new Response(w.snapshot, { status: 200 });
      return res(404, {});
    }
    return res(404, {});
  };
}

function setup(over: Partial<World> = {}, deps: Partial<LibraryDeps> = {}) {
  const w: World = { users: { ghu_dana: 'dana', ghu_leo01: 'leo' }, admin: { dana: true, leo: false }, private: true, snapshot: '{"version":1}', calls: [], ...over };
  let now = T0;
  const store = memoryStore(() => now);
  const sent: EmailMessage[] = [];
  let n = 0;
  const all: LibraryDeps = {
    fetch: github(w),
    now: () => now,
    random: (k) => new Uint8Array(k).fill(++n),
    store,
    email: { send: async (m) => void sent.push(m) },
    app: { installationToken: async () => 'ghs_read' },
    ...deps,
  };
  return { w, store, sent, deps: all, tick: (ms: number) => (now += ms), at: () => now };
}

const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '203.0.113.7', ...extra });

const post = (body: unknown, extra: Record<string, string> = {}) => new Request(`${ORIGIN}/api/library-access`, { method: 'POST', headers: headers(extra), body: JSON.stringify(body) });
const get = (query: string, cookie?: string) => new Request(`${ORIGIN}/api/library-access${query}`, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } });

const tokenOf = (msg: EmailMessage) => /#signin=([A-Za-z0-9_-]+)/.exec(msg.text)![1]!;
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;

async function setEmail(deps: LibraryDeps, domains = ['acme.design']) {
  const r = await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'email', domains }, { authorization: 'Bearer ghu_dana' }), ENV, deps);
  expect(r.status).toBe(200);
  return r;
}

/** Signs in as `email` and returns the session cookie ("name=value"). */
async function signIn(deps: LibraryDeps, sent: EmailMessage[], email = 'mia@acme.design') {
  const s = await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email }), ENV, deps);
  expect(s.status).toBe(200);
  const v = await handleLibraryAccess(post({ action: 'verify', repo: REPO, token: tokenOf(sent[sent.length - 1]!) }), ENV, deps);
  expect(v.status).toBe(200);
  return cookieOf(v);
}

describe('domains', () => {
  it('normalizes what an admin types, and refuses what is not a domain', () => {
    expect(normalizeDomain(' @Acme.Design ')).toBe('acme.design');
    expect(normalizeDomain('mail.acme.co.uk')).toBe('mail.acme.co.uk');
    for (const bad of ['acme', 'acme.', '.acme.design', 'acme..design', 'https://acme.design', 'acme.design/x', 'ac me.design', 'acmé.design', '*.acme.design', 'a@acme.design']) expect(normalizeDomain(bad), bad).toBeNull();
  });

  it('keeps unique domains, refuses consumer providers and empty lists', () => {
    expect(parseDomains(['Acme.design', '@acme.design', 'acme.studio', ''])).toEqual(['acme.design', 'acme.studio']);
    expect(() => parseDomains(['gmail.com'])).toThrow(/Anyone can get an email at gmail.com/);
    expect(() => parseDomains([])).toThrow(/Add your company email domain/);
    expect(() => parseDomains('acme.design')).toThrow();
    expect(() => parseDomains(Array.from({ length: 11 }, (_, i) => `d${i}.design`))).toThrow(/at most 10/);
  });

  it('matches the exact part after the @, case-insensitive, never a subdomain or a lookalike', () => {
    const d = ['acme.design'];
    expect(emailDomainIn('Mia@ACME.design', d)).toBe('acme.design');
    expect(emailDomainIn(' mia@acme.design ', d)).toBe('acme.design');
    for (const bad of ['mia@eng.acme.design', 'mia@acme.design.evil.com', 'mia@evil-acme.design', 'mia@acme.designs', 'acme.design@evil.com', 'mia@acme.design@evil.com', 'mia@evil.com#@acme.design', 'mia@acme.design.', '@acme.design', 'mia', 42, null, `${'a'.repeat(250)}@acme.design`]) {
      expect(emailDomainIn(bad, d), String(bad)).toBeNull();
    }
    // A subdomain matches only when the admin lists it.
    expect(emailDomainIn('mia@eng.acme.design', ['acme.design', 'eng.acme.design'])).toBe('eng.acme.design');
  });

  it('words a wrong domain with the domains the library is open to', () => {
    expect(wrongDomainWords(['acme.design'])).toBe('This library is open to @acme.design emails. Ask your design system team for access.');
    expect(wrongDomainWords(['a.co', 'b.co', 'c.co'])).toBe('This library is open to @a.co, @b.co or @c.co emails. Ask your design system team for access.');
  });
});

describe('session cookie', () => {
  const setting: LibrarySetting = { mode: 'email', domains: ['acme.design'], version: 3, private: true, updatedBy: 'dana', updatedAt: '' };
  const req = (cookie: string) => new Request(`${ORIGIN}/api/library-access?repo=${REPO}`, { headers: { cookie } });

  it('is httpOnly, Secure, SameSite=Lax, scoped to this function, 30 days, one per team', () => {
    const c = issueSession(REPO, 'acme.design', 3, SECRET, T0);
    expect(c).toMatch(new RegExp(`^${cookieName(REPO)}=v1\\.`));
    expect(c).toContain('; Max-Age=2592000; Path=/api/library-access; HttpOnly; Secure; SameSite=Lax');
    expect(cookieName('acme/design')).toBe(cookieName('ACME/Design'));
    expect(cookieName('acme/design')).not.toBe(cookieName('acme/other'));
    expect(cookieName(REPO)).not.toContain('acme');
    expect(c).not.toContain('@');
    expect(clearSession(REPO)).toContain('Max-Age=0');
  });

  it('verifies the signature and refuses any tampering', () => {
    const v = signSession({ r: REPO, d: 'acme.design', v: 3, x: T0 + 1000 }, SECRET);
    expect(verifySignature(v, SECRET)).toEqual({ r: REPO, d: 'acme.design', v: 3, x: T0 + 1000 });
    expect(verifySignature(v, 'x'.repeat(40))).toBeNull();
    const [p, body, sig] = v.split('.');
    const forged = Buffer.from(JSON.stringify({ r: REPO, d: 'evil.com', v: 3, x: T0 + 1000 })).toString('base64url');
    expect(verifySignature(`${p}.${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifySignature(`${p}.${body}.${sig!.slice(0, -2)}`, SECRET)).toBeNull();
    expect(verifySignature(`v2.${body}.${sig}`, SECRET)).toBeNull();
    expect(verifySignature('garbage', SECRET)).toBeNull();
  });

  it('reads a live session for the current version only, and ends it on expiry, a change, another team', () => {
    const cookie = (o: Partial<{ r: string; d: string; v: number; x: number }>) => `${cookieName(o.r ?? REPO)}=${signSession({ r: REPO, d: 'acme.design', v: 3, x: T0 + 1000, ...o }, SECRET)}`;
    expect(readSession(req(cookie({})), REPO, setting, SECRET, T0)).toEqual({ domain: 'acme.design' });
    expect(readSession(req(cookie({})), REPO, setting, SECRET, T0 + 1000)).toBeNull();
    expect(readSession(req(cookie({ v: 2 })), REPO, setting, SECRET, T0)).toBeNull();
    expect(readSession(req(cookie({})), REPO, { ...setting, domains: ['acme.studio'] }, SECRET, T0)).toBeNull();
    expect(readSession(req(cookie({})), REPO, { ...setting, mode: 'anyone' }, SECRET, T0)).toBeNull();
    expect(readSession(req(cookie({})), REPO, null, SECRET, T0)).toBeNull();
    // Another team's cookie, even renamed to this team's name.
    const other = signSession({ r: 'acme/other', d: 'acme.design', v: 3, x: T0 + 1000 }, SECRET);
    expect(readSession(req(`${cookieName(REPO)}=${other}`), REPO, setting, SECRET, T0)).toBeNull();
  });
});

describe('not configured', () => {
  const bare: LibraryDeps = { fetch: vi.fn<FetchLike>() };
  it('says unavailable, keeps the Library as before, and calls nobody', async () => {
    expect(await (await handleLibraryAccess(get(''), {}, bare)).json()).toEqual({ available: false });
    expect(await (await handleLibraryAccess(get(`?repo=${REPO}`), {}, bare)).json()).toEqual({ available: false, setting: null, session: null });
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), {}, bare)).status).toBe(503);
    for (const action of ['set', 'sign-in', 'verify', 'sign-out']) {
      const r = await handleLibraryAccess(post({ action, repo: REPO }), {}, bare);
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'not_configured', message: NOT_CONFIGURED });
    }
    expect(bare.fetch).not.toHaveBeenCalled();
  });

  it('needs storage, email, the app and a long enough secret', async () => {
    const env = { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't', RESEND_API_KEY: 're_x', INVITE_EMAIL_FROM: 'Bridge <i@b.co>', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'pem' };
    expect(await (await handleLibraryAccess(get(''), { ...env, LIBRARY_SESSION_SECRET: 'short' }, bare)).json()).toEqual({ available: false });
    expect(await (await handleLibraryAccess(get(''), { ...env, LIBRARY_SESSION_SECRET: SECRET }, bare)).json()).toEqual({ available: true });
  });
});

describe('the setting', () => {
  it('starts unset (the default: GitHub decides), with no GitHub call', async () => {
    const { deps, w } = setup();
    const r = await handleLibraryAccess(get(`?repo=${REPO}`), ENV, deps);
    expect(await r.json()).toEqual({ available: true, setting: null, session: null });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(w.calls).toHaveLength(0);
  });

  it('is changed by an admin only, checked on GitHub with their own sign-in', async () => {
    const { deps, w, store } = setup();
    const leo = await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_leo01' }), ENV, deps);
    expect(leo.status).toBe(403);
    expect((await leo.json()).message).toBe('Only admins can change who reads the library.');
    expect((await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }), ENV, deps)).status).toBe(401);
    expect((await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_nobody' }), ENV, deps)).status).toBe(401);
    // Someone GitHub does not show the repository to.
    const kim = setup({ users: { ghu_kim01: 'kim' } });
    expect((await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_kim01' }), ENV, kim.deps)).status).toBe(403);
    expect(await store.getSetting(REPO)).toBeNull();

    const ok = await setEmail(deps, ['@Acme.design']);
    expect(await ok.json()).toEqual({ setting: { mode: 'email', domains: ['acme.design'], source: 'bridge' } });
    expect(await store.getSetting(REPO)).toMatchObject({ mode: 'email', domains: ['acme.design'], version: 1, private: true, updatedBy: 'dana' });
    expect(w.calls.filter((c) => c.path === '/repos/acme/design').every((c) => c.auth === 'Bearer ghu_dana' || c.auth === 'Bearer ghu_leo01')).toBe(true);
  });

  it('refuses a write from another site', async () => {
    const { deps } = setup();
    const r = await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_dana', origin: 'https://evil.example' }), ENV, deps);
    expect(r.status).toBe(403);
  });

  it('validates the mode and the domains', async () => {
    const { deps } = setup();
    const auth = { authorization: 'Bearer ghu_dana' };
    expect((await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'everyone' }, auth), ENV, deps)).status).toBe(400);
    const gmail = await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'email', domains: ['gmail.com'] }, auth), ENV, deps);
    expect(gmail.status).toBe(400);
    expect((await gmail.json()).error).toBe('public_domain');
    expect((await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'email', domains: [] }, auth), ENV, deps)).status).toBe(400);
    // Domains are dropped for the other modes.
    const team = await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'team', domains: ['acme.design'] }, auth), ENV, deps);
    expect(await team.json()).toEqual({ setting: { mode: 'team', domains: [], source: 'bridge' } });
  });

  it('records a public repository as read from GitHub', async () => {
    const { deps } = setup({ private: false });
    const r = await setEmail(deps);
    expect((await r.json()).setting.source).toBe('github');
  });

  it('never tells the browser who changed it or its version', async () => {
    const { deps } = setup();
    await setEmail(deps);
    const body = await (await handleLibraryAccess(get(`?repo=${REPO}`), ENV, deps)).json();
    expect(body.setting).toEqual({ mode: 'email', domains: ['acme.design'], source: 'bridge' });
    expect(JSON.stringify(body)).not.toContain('dana');
  });
});

describe('sign-in link', () => {
  it('emails a one-time fragment link, stores only its hash and domain, and opens a session once', async () => {
    const { deps, sent, store, at } = setup();
    await setEmail(deps);
    const r = await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: ' Mia@Acme.design ' }), ENV, deps);
    expect(await r.json()).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('mia@acme.design');
    expect(sent[0]!.subject).toBe('Your link to the acme/design library');
    expect(sent[0]!.text).toContain(`${ORIGIN}/library/acme/design/#signin=`);
    expect(sent[0]!.text).toContain('expires in 15 minutes');
    const token = tokenOf(sent[0]!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = [...store.raw().entries()];
    const link = raw.find(([k]) => k.startsWith('bridge:library:signin:'))!;
    expect(link[0]).toBe(`bridge:library:signin:${createHash('sha256').update(token).digest('hex')}`);
    expect(JSON.parse(link[1])).toEqual({ repo: REPO, domain: 'acme.design', version: 1 });
    // Neither the email nor the IP is kept in clear anywhere.
    expect(JSON.stringify(raw)).not.toContain('mia');
    expect(JSON.stringify(raw)).not.toContain('203.0.113.7');
    expect(JSON.stringify(raw)).not.toContain(token);

    const v = await handleLibraryAccess(post({ action: 'verify', repo: REPO, token }), ENV, deps);
    expect(await v.json()).toEqual({ ok: true, session: { domain: 'acme.design' } });
    const cookie = cookieOf(v);
    expect(verifySignature(cookie.split('=')[1]!, SECRET)).toEqual({ r: REPO, d: 'acme.design', v: 1, x: at() + SESSION_TTL_MS });
    // Single use.
    const again = await handleLibraryAccess(post({ action: 'verify', repo: REPO, token }), ENV, deps);
    expect(again.status).toBe(410);
    expect((await again.json()).message).toBe(EXPIRED);
    // The session reads back.
    expect((await (await handleLibraryAccess(get(`?repo=${REPO}`, cookie), ENV, deps)).json()).session).toEqual({ domain: 'acme.design' });
  });

  it('says which domains the library is open to, and sends nothing', async () => {
    const { deps, sent } = setup();
    await setEmail(deps);
    const r = await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@gmail.com' }), ENV, deps);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'domain', message: 'This library is open to @acme.design emails. Ask your design system team for access.', domains: ['acme.design'] });
    expect((await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'not an email' }), ENV, deps)).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('only works when the library opens with an email', async () => {
    const { deps, sent } = setup();
    expect((await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps)).status).toBe(409);
    await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'team' }, { authorization: 'Bearer ghu_dana' }), ENV, deps);
    expect((await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps)).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it('expires after 15 minutes', async () => {
    const { deps, sent, tick } = setup();
    await setEmail(deps);
    await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps);
    tick(SIGNIN_TTL_MS);
    expect((await handleLibraryAccess(post({ action: 'verify', repo: REPO, token: tokenOf(sent[0]!) }), ENV, deps)).status).toBe(410);
  });

  it('opens only the team it was sent for, and no longer once the setting changed', async () => {
    const { deps, sent } = setup();
    await setEmail(deps);
    await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps);
    expect((await handleLibraryAccess(post({ action: 'verify', repo: 'acme/other', token: tokenOf(sent[0]!) }), ENV, deps)).status).toBe(410);
    // Spent by the wrong team: gone.
    expect((await handleLibraryAccess(post({ action: 'verify', repo: REPO, token: tokenOf(sent[0]!) }), ENV, deps)).status).toBe(410);

    await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps);
    await setEmail(deps, ['acme.studio']);
    expect((await handleLibraryAccess(post({ action: 'verify', repo: REPO, token: tokenOf(sent[1]!) }), ENV, deps)).status).toBe(410);
    expect((await handleLibraryAccess(post({ action: 'verify', repo: REPO, token: 'short' }), ENV, deps)).status).toBe(410);
  });

  it('keeps nothing when the email cannot be sent, and counts nothing', async () => {
    const { deps, store } = setup({}, { email: { send: async () => Promise.reject(new Error('down')) } });
    await setEmail(deps);
    const r = await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps);
    expect(r.status).toBe(502);
    expect(store.keys().some((k) => k.startsWith('bridge:library:signin:'))).toBe(false);
    const counts = [...store.raw().entries()].filter(([k]) => k.startsWith('bridge:library:count:'));
    expect(counts.every(([, v]) => v === '0')).toBe(true);
  });

  it('signs out by clearing the cookie', async () => {
    const { deps } = setup();
    const r = await handleLibraryAccess(post({ action: 'sign-out', repo: REPO }), ENV, deps);
    expect(r.headers.get('set-cookie')).toBe(clearSession(REPO));
  });
});

describe('revocation', () => {
  it('ends every session when the setting changes, and keeps them when it is saved unchanged', async () => {
    const { deps, sent } = setup();
    await setEmail(deps);
    const cookie = await signIn(deps, sent);
    const session = async () => (await (await handleLibraryAccess(get(`?repo=${REPO}`, cookie), ENV, deps)).json()).session;
    expect(await session()).toEqual({ domain: 'acme.design' });
    await setEmail(deps);
    expect(await session()).toEqual({ domain: 'acme.design' });
    await setEmail(deps, ['acme.design', 'acme.studio']);
    expect(await session()).toBeNull();
  });

  it('ends after 30 days', async () => {
    const { deps, sent, tick } = setup();
    await setEmail(deps);
    const cookie = await signIn(deps, sent);
    tick(SESSION_TTL_MS);
    expect((await (await handleLibraryAccess(get(`?repo=${REPO}`, cookie), ENV, deps)).json()).session).toBeNull();
  });
});

describe('caps', () => {
  it('defaults, and reads whole numbers from the env', () => {
    expect(limitsFrom({})).toEqual(LIMIT_DEFAULTS);
    expect(limitsFrom({ LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY: '1', LIBRARY_SIGNIN_MAX_SITE_DAY: 'x', LIBRARY_SIGNIN_MAX_PER_IP_DAY: '-1', LIBRARY_SIGNIN_MAX_PER_TEAM_DAY: '0' })).toEqual({ ...LIMIT_DEFAULTS, email: 1, team: 0 });
  });

  it('caps links per email per day, with Retry-After, and starts again the next day', async () => {
    const { deps, sent, tick } = setup();
    await setEmail(deps);
    for (let i = 0; i < LIMIT_DEFAULTS.email; i++) expect((await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'MIA@acme.design' }), ENV, deps)).status).toBe(200);
    const over = await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: 'limit', limit: 'email', message: LIMIT_WORDS.email });
    expect(Number(over.headers.get('retry-after'))).toBe(14 * 3600);
    // Another person from the same network still gets theirs.
    expect((await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'leo@acme.design' }), ENV, deps)).status).toBe(200);
    expect(sent).toHaveLength(LIMIT_DEFAULTS.email + 1);
    tick(24 * 3600 * 1000);
    expect((await handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email: 'mia@acme.design' }), ENV, deps)).status).toBe(200);
  });

  it('caps links per network, per team and for the site', async () => {
    const env = { ...ENV, LIBRARY_SIGNIN_MAX_PER_IP_DAY: '2', LIBRARY_SIGNIN_MAX_PER_TEAM_DAY: '3', LIBRARY_SIGNIN_MAX_SITE_DAY: '4' };
    const { deps } = setup();
    await setEmail(deps);
    const ask = (email: string, ip: string) => handleLibraryAccess(post({ action: 'sign-in', repo: REPO, email }, { 'x-real-ip': ip }), env, deps);
    expect((await ask('a@acme.design', '1.1.1.1')).status).toBe(200);
    expect((await ask('b@acme.design', '1.1.1.1')).status).toBe(200);
    const ip = await ask('c@acme.design', '1.1.1.1');
    expect(await ip.json()).toMatchObject({ limit: 'ip', message: LIMIT_WORDS.ip });
    expect((await ask('c@acme.design', '2.2.2.2')).status).toBe(200);
    const team = await ask('d@acme.design', '3.3.3.3');
    expect(await team.json()).toMatchObject({ limit: 'team', message: LIMIT_WORDS.team });
  });
});

describe('serving a private Library', () => {
  it('serves the snapshot to a signed-in reader, with the app token, never to anyone else', async () => {
    const { deps, sent, w } = setup();
    await setEmail(deps);
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, deps)).status).toBe(401);
    const cookie = await signIn(deps, sent);
    const r = await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`, cookie), ENV, deps);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"version":1}');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    // The browser never sees a GitHub token.
    expect([...r.headers.values()].join(' ')).not.toContain('ghs_');
    expect(w.calls.filter((c) => c.path.includes('/contents/')).map((c) => c.auth)).toEqual(['Bearer ghs_read']);
    // A forged cookie gets nothing.
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`, `${cookieName(REPO)}=v1.e30.AAAA`), ENV, deps)).status).toBe(401);
  });

  it('serves anyone when an admin opened the private library to anyone with the link', async () => {
    const { deps } = setup();
    await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_dana' }), ENV, deps);
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, deps)).status).toBe(200);
  });

  it('serves nothing for the team only, an unset setting or a public repository (read from GitHub)', async () => {
    const team = setup();
    await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'team' }, { authorization: 'Bearer ghu_dana' }), ENV, team.deps);
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, team.deps)).status).toBe(403);
    const unset = setup();
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, unset.deps)).status).toBe(404);
    const pub = setup({ private: false });
    await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_dana' }), ENV, pub.deps);
    const r = await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, pub.deps);
    expect(r.status).toBe(404);
    expect(pub.w.calls.some((c) => c.path.includes('/contents/'))).toBe(false);
  });

  it('says when the library is not published, the app cannot read it, or the file is unknown', async () => {
    const none = setup({ snapshot: null });
    await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_dana' }), ENV, none.deps);
    const r = await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, none.deps);
    expect(await r.json()).toEqual({ error: 'not_published', message: NOT_PUBLISHED });
    expect((await handleLibraryAccess(get(`?repo=${REPO}&file=secrets`), ENV, none.deps)).status).toBe(400);
    const noApp = setup({}, { app: { installationToken: async () => null } });
    await handleLibraryAccess(post({ action: 'set', repo: REPO, mode: 'anyone' }, { authorization: 'Bearer ghu_dana' }), ENV, noApp.deps);
    expect((await (await handleLibraryAccess(get(`?repo=${REPO}&file=snapshot`), ENV, noApp.deps)).json()).error).toBe('app_missing');
  });
});
