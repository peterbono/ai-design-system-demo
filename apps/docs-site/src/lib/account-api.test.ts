// The /api/account Vercel function (api/account/index.ts) with a mocked GitHub, an in-memory Redis and a fake email:
// codes, tries and expiry, no enumeration, GitHub link and create, sessions and their end, delete with the last-admin
// rule, the daily backup, and the account session on the /api/contribute proxy.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_TTL_MS, getAccount, signAccountSession } from '../../api/_lib/account';
import { memberStore, type EmailMember } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { accountRef, createGrant, getGrant, listGrants } from '../../api/_lib/oauth';
import { sealingKey } from '../../api/_lib/sealed';
import {
  type AccountDeps,
  BACKUPS_KEPT,
  type BlobStore,
  CODE_EXPIRED,
  CODE_LIMITS,
  CODE_TTL_S,
  handleAccount,
  INVITE_GONE,
  lastAdminOf,
  MAX_TRIES,
  WRONG_CODE,
} from '../../api/account/index';
import { handleContribute } from '../../api/contribute/index';
import { type EmailMessage, inviteStoreOn, INVITE_TTL_MS } from '../../api/invites/index';
import { sha256 } from '../../api/_lib/http';
import { anonymiseRequestedBy, FORMER_MEMBER, FORMER_MEMBER_LINE } from '../../api/_lib/former-member';
import { requesterOf } from '@bridge-ds/core';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-10-22T10:00:00Z');
const SECRET = 's'.repeat(40);
const ENV = { LIBRARY_SESSION_SECRET: SECRET };
const GH_TOKEN = 'ghu_' + 'x'.repeat(36);

interface GhWorld {
  user: { id: number; login: string; name: string | null } | null;
  emails: { email: string; verified: boolean; primary: boolean }[] | 'forbidden';
  /** Repositories the app and the user share, with the user's permissions. */
  repos: { full_name: string; permissions: { admin: boolean } }[];
  collaborators: Record<string, { id: number; login: string; permissions: { admin: boolean } }[]>;
  /** Issue and pull request bodies on GitHub, by "owner/repo#n" (read and edited with the Bridge app's token). */
  issues: Record<string, string>;
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(gh: Partial<GhWorld> = {}) {
  let now = T0;
  const w: GhWorld = { user: { id: 77, login: 'mia-gh', name: 'Mia Chen' }, emails: [{ email: 'Mia@Acme.design', verified: true, primary: true }], repos: [], collaborators: {}, issues: {}, ...gh };
  const calls: string[] = [];
  const redis = memoryRedis(() => now);
  const members = memberStore(redis);
  const sent: EmailMessage[] = [];
  let codes = ['123456', '654321', '111111', '222222', '333333', '444444', '555555'];
  const warnings: string[] = [];
  const blobs: { pathname: string; url: string; uploadedAt: Date; body?: string }[] = [];
  const blob: BlobStore = {
    put: async (pathname, body) => void blobs.push({ pathname, url: `https://blob/${pathname}`, uploadedAt: new Date(now), body }),
    list: async (prefix) => blobs.filter((b) => b.pathname.startsWith(prefix)),
    del: async (urls) => {
      for (const u of urls) blobs.splice(blobs.findIndex((b) => b.url === u), 1);
    },
  };
  const deps: AccountDeps = {
    fetch: async (url, init) => {
      const u = new URL(url);
      expect(u.origin).toBe('https://api.github.com');
      calls.push(`${init.method} ${u.pathname}`);
      if (init.headers.Authorization !== `Bearer ${GH_TOKEN}`) return res(401, { message: 'Bad credentials' });
      if (u.pathname === '/user') return w.user ? res(200, w.user) : res(401, {});
      if (u.pathname === '/user/emails') return w.emails === 'forbidden' ? res(403, {}) : res(200, w.emails);
      if (u.pathname === '/user/installations') return res(200, { installations: [{ id: 5 }] });
      if (u.pathname === '/user/installations/5/repositories') return res(200, { repositories: w.repos });
      const issue = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u.pathname);
      if (issue) {
        const k = `${issue[1]}#${issue[2]}`;
        if (!(k in w.issues)) return res(404, {});
        if (init.method === 'PATCH') w.issues[k] = JSON.parse(init.body!).body;
        return res(200, { number: Number(issue[2]), body: w.issues[k] });
      }
      const m = /^\/repos\/([^/]+\/[^/]+)\/collaborators$/.exec(u.pathname);
      if (m) return res(200, w.collaborators[m[1]!] ?? []);
      return res(404, {});
    },
    now: () => now,
    code: () => codes.shift()!,
    redis,
    members,
    email: { send: async (msg) => void sent.push(msg) },
    blob: () => blob,
    warn: (m) => void warnings.push(m),
    // The Bridge app: its installation token stands as the same fake token here.
    app: { installationToken: async () => GH_TOKEN },
  };
  return { w, deps, redis, members, sent, calls, warnings, blobs, tick: (ms: number) => (now += ms), setCodes: (c: string[]) => (codes = c) };
}

const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-account': '1', 'sec-fetch-site': 'same-origin' };
const act = (body: unknown, extra: Record<string, string> = {}) => new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify(body) });
const me = (cookie = '') => new Request(`${ORIGIN}/api/account`, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } });
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]!;
const codeIn = (msg: EmailMessage) => /\b(\d{6})\b/.exec(msg.text)![1]!;
const member = (email: string, at = '2026-10-01T00:00:00Z'): EmailMember => ({ email, name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at });

async function signInWithCode(s: ReturnType<typeof setup>, email = 'mia@acme.design', name?: string) {
  expect((await handleAccount(act({ action: 'code', email }), ENV, s.deps)).status).toBe(200);
  const code = codeIn(s.sent.at(-1)!);
  const r = await handleAccount(act({ action: 'verify', email, code, ...(name ? { name } : {}) }), ENV, s.deps);
  expect(r.status).toBe(200);
  return { r, cookie: cookieOf(r), body: await r.json() };
}

describe('availability', () => {
  it('without storage or the secret: unavailable, and actions answer 503', async () => {
    const bare: AccountDeps = { fetch: async () => res(599) };
    expect(await (await handleAccount(me(), {}, bare)).json()).toEqual({ available: false, account: null });
    expect(await (await handleAccount(me(), { LIBRARY_SESSION_SECRET: 'short' }, setup().deps)).json()).toEqual({ available: false, account: null });
    expect((await handleAccount(act({ action: 'code', email: 'a@b.co' }), {}, bare)).status).toBe(503);
  });

  it('configured, no cookie: available, no account', async () => {
    expect(await (await handleAccount(me(), ENV, setup().deps)).json()).toEqual({ available: true, account: null });
  });

  it('needs X-Bridge-Account, JSON and an Origin of this site on every POST', async () => {
    const s = setup();
    const { 'x-bridge-account': _x, ...noHeader } = H;
    expect((await handleAccount(new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: noHeader, body: '{"action":"sign-out"}' }), ENV, s.deps)).status).toBe(403);
    const { origin: _o, ...noOrigin } = H;
    expect((await handleAccount(new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: noOrigin, body: '{"action":"sign-out"}' }), ENV, s.deps)).status).toBe(403);
    expect((await handleAccount(act({ action: 'sign-out' }, { origin: 'https://evil.example' }), ENV, s.deps)).status).toBe(403);
    expect((await handleAccount(act({ action: 'sign-out' }, { 'sec-fetch-site': 'cross-site' }), ENV, s.deps)).status).toBe(403);
    expect((await handleAccount(act({ action: 'sign-out' }, { 'content-type': 'text/plain' }), ENV, s.deps)).status).toBe(415);
    expect((await handleAccount(act({ action: 'nope' }), ENV, s.deps)).status).toBe(400);
    expect((await handleAccount(new Request(`${ORIGIN}/api/account`, { method: 'PUT', headers: H, body: '{}' }), ENV, s.deps)).status).toBe(405);
  });
});

describe('email codes', () => {
  it('a new email: code by email, verify creates the account, sets the cookie, goes to onboarding', async () => {
    const s = setup();
    const r1 = await handleAccount(act({ action: 'code', email: '  Mia@Acme.Design ' }), ENV, s.deps);
    expect(await r1.json()).toEqual({ ok: true });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toBe('mia@acme.design');
    expect(codeIn(s.sent[0]!)).toBe('123456');
    // Only hashes in storage, never the code or the email in a code key.
    const keys = s.redis.keys().join(' ');
    expect(keys).not.toContain('123456');
    expect(keys.match(/bridge:account:code:[0-9a-f]{64}/)).not.toBeNull();
    expect(keys).not.toMatch(/count:[^ ]*mia/);

    const r = await handleAccount(act({ action: 'verify', email: 'MIA@acme.design', code: '123 456', name: 'Mia **Chen**' }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ account: { email: 'mia@acme.design', name: 'Mia Chen', nameSet: true, github: null, teams: [] }, created: true, next: '/start/' });
    const set = r.headers.get('set-cookie')!;
    expect(set.startsWith(`${ACCOUNT_COOKIE}=v1.`)).toBe(true);
    for (const part of ['Path=/;', 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${ACCOUNT_SESSION_TTL_MS / 1000}`]) expect(set).toContain(part);
    const a = await getAccount(s.redis, 'mia@acme.design');
    expect(a).toMatchObject({ email: 'mia@acme.design', name: 'Mia Chen', github: null, version: 1 });
    expect(a!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await (await handleAccount(me(cookieOf(r)), ENV, s.deps)).json()).toEqual({ available: true, account: { email: 'mia@acme.design', name: 'Mia Chen', nameSet: true, github: null, teams: [] } });
  });

  it('a new account without a typed name gets a stand-in from the email, and says nameSet false until renamed', async () => {
    const s = setup();
    const { body, cookie } = await signInWithCode(s, 'leo.martin@acme.design');
    expect(body.account).toMatchObject({ name: 'leo.martin', nameSet: false });
    const renamed = await handleAccount(act({ action: 'rename', name: 'Leo Martin' }, { cookie }), ENV, s.deps);
    expect((await renamed.json()).account).toMatchObject({ name: 'Leo Martin', nameSet: true });
    // Accounts made before the flag read as named.
    const old = { ...(await getAccount(s.redis, 'leo.martin@acme.design'))! };
    delete old.nameSet;
    await s.redis.cmd('SET', 'bridge:account:leo.martin@acme.design', JSON.stringify(old));
    expect((await (await handleAccount(me(cookie), ENV, s.deps)).json()).account.nameSet).toBe(true);
  });

  it('sends the code of an invite link to the invited address, never naming it, and verifies with the token', async () => {
    const s = setup();
    const token = 'T'.repeat(43);
    const store = inviteStoreOn(s.redis, () => T0);
    await store.put({ id: 'a'.repeat(16), repo: 'acme/ds', email: 'Mia@Acme.design', role: 'edit', invitedBy: 'sam', createdAt: '', sentAt: '', expiresAt: new Date(T0 + INVITE_TTL_MS).toISOString(), tokenHash: sha256(token) }, INVITE_TTL_MS / 1000);
    const r1 = await handleAccount(act({ action: 'code', invite: token }), ENV, s.deps);
    const text = await r1.text();
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toContain('mia');
    expect(s.sent.at(-1)!.to).toBe('mia@acme.design');
    const r2 = await handleAccount(act({ action: 'verify', invite: token, code: codeIn(s.sent.at(-1)!) }), ENV, s.deps);
    expect(r2.status).toBe(200);
    expect((await r2.json()).account).toMatchObject({ email: 'mia@acme.design', nameSet: false });
    // A link Bridge does not know, or one that looks wrong: gone, and no email sent.
    const sent = s.sent.length;
    for (const bad of ['U'.repeat(43), 'short', 42]) {
      const r = await handleAccount(act({ action: 'code', invite: bad }), ENV, s.deps);
      expect(r.status).toBe(410);
      expect(await r.json()).toEqual({ error: 'invite-gone', message: INVITE_GONE });
    }
    expect(s.sent).toHaveLength(sent);
  });

  it('says how many tries are left on a wrong code', async () => {
    const s = setup();
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    const r = await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '000000' }), ENV, s.deps);
    expect(await r.json()).toMatchObject({ error: 'wrong-code', triesLeft: MAX_TRIES - 1 });
  });

  it('a code works once', async () => {
    const s = setup();
    await signInWithCode(s);
    const again = await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '123456' }), ENV, s.deps);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: 'expired', message: CODE_EXPIRED });
  });

  it('a known email signs in to the same account (created: false)', async () => {
    const s = setup();
    await signInWithCode(s, 'mia@acme.design', 'Mia');
    const { body } = await signInWithCode(s, 'mia@acme.design', 'Someone else');
    expect(body.created).toBe(false);
    expect(body.account.name).toBe('Mia');
  });

  it(`wrong code ${MAX_TRIES} times burns the code: even the right one is refused`, async () => {
    const s = setup();
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    for (let i = 1; i < MAX_TRIES; i++) {
      const r = await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '000000' }), ENV, s.deps);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'wrong-code', message: WRONG_CODE, triesLeft: MAX_TRIES - i });
    }
    const fifth = await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '000000' }), ENV, s.deps);
    expect(fifth.status).toBe(410);
    const right = await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '123456' }), ENV, s.deps);
    expect(right.status).toBe(410);
    expect(right.headers.get('set-cookie')).toBeNull();
    expect(await getAccount(s.redis, 'mia@acme.design')).toBeNull();
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:account:code'))).toEqual([]);
  });

  it('a new code replaces the last one and its tries start again', async () => {
    const s = setup();
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    for (let i = 0; i < MAX_TRIES - 1; i++) await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '000000' }), ENV, s.deps);
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    // The old code is just a wrong one now.
    expect((await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '123456' }), ENV, s.deps)).status).toBe(400);
    expect((await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '000000' }), ENV, s.deps)).status).toBe(400);
    expect((await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '654321' }), ENV, s.deps)).status).toBe(200);
  });

  it('expires after 10 minutes', async () => {
    const s = setup();
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    s.tick(CODE_TTL_S * 1000 + 1);
    expect((await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '123456' }), ENV, s.deps)).status).toBe(410);
  });

  it("a code for one email never opens another's account", async () => {
    const s = setup();
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    expect((await handleAccount(act({ action: 'verify', email: 'boss@acme.design', code: '123456' }), ENV, s.deps)).status).toBe(410);
  });

  it('no enumeration: the same answer with or without an account, and when the email provider fails', async () => {
    const s = setup();
    await signInWithCode(s, 'mia@acme.design');
    const known = await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    const unknown = await handleAccount(act({ action: 'code', email: 'nobody@acme.design' }), ENV, s.deps);
    expect([known.status, await known.json()]).toEqual([200, { ok: true }]);
    expect([unknown.status, await unknown.json()]).toEqual([200, { ok: true }]);
    const failing = setup();
    failing.deps.email = { send: async () => Promise.reject(new Error('down')) };
    const r = await handleAccount(act({ action: 'code', email: 'x@acme.design' }), ENV, failing.deps);
    expect([r.status, await r.json()]).toEqual([200, { ok: true }]);
    expect(failing.redis.keys().filter((k) => k.startsWith('bridge:account:code'))).toEqual([]);
  });

  it('caps codes per email per day, for everyone alike, with 429 and Retry-After', async () => {
    const s = setup();
    s.setCodes(Array.from({ length: 20 }, (_, i) => String(100000 + i)));
    for (let i = 0; i < CODE_LIMITS.email; i++) expect((await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps)).status).toBe(200);
    const over = await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBeTruthy();
    expect(s.sent).toHaveLength(CODE_LIMITS.email);
  });

  it('refuses something that is not an email, and a code that is not 6 digits without spending a try', async () => {
    const s = setup();
    for (const email of ['nope', 'a@b', '', 42]) expect((await handleAccount(act({ action: 'code', email }), ENV, s.deps)).status).toBe(400);
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    for (let i = 0; i < 10; i++) expect((await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: 'abc' }), ENV, s.deps)).status).toBe(400);
    expect((await handleAccount(act({ action: 'verify', email: 'mia@acme.design', code: '123456' }), ENV, s.deps)).status).toBe(200);
  });

  it('an existing email member becomes an account with its teams, and lands on the team joined last', async () => {
    const s = setup();
    // Memberships made before accounts existed (no teams set yet).
    await s.redis.cmd('SET', 'bridge:member:acme/design:mia@acme.design', JSON.stringify(member('mia@acme.design', '2026-09-01T00:00:00Z')));
    await s.redis.cmd('SET', 'bridge:member:acme/brand:mia@acme.design', JSON.stringify(member('mia@acme.design', '2026-10-01T00:00:00Z')));
    await s.redis.cmd('SET', 'bridge:member:acme/brand:mia@acme.design.evil', JSON.stringify(member('mia@acme.design.evil')));
    const { body } = await signInWithCode(s);
    expect(body.created).toBe(true);
    expect(body.account.teams).toEqual([
      { repo: 'acme/brand', name: expect.any(String), role: 'edit', via: 'email' },
      { repo: 'acme/design', name: expect.any(String), role: 'edit', via: 'email' },
    ]);
    const { body: again } = await signInWithCode(s);
    expect(again.next).toBe('/studio/acme/brand/');
  });
});

describe('GitHub', () => {
  it('creates an account with the primary verified email, GitHub linked', async () => {
    const s = setup({ emails: [{ email: 'old@acme.design', verified: false, primary: false }, { email: 'Mia@Acme.design', verified: true, primary: true }] });
    const r = await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ account: { email: 'mia@acme.design', name: 'Mia Chen', nameSet: true, github: { login: 'mia-gh', id: 77 }, teams: [] }, created: true, next: '/start/' });
    expect(r.headers.get('set-cookie')).toContain(`${ACCOUNT_COOKIE}=v1.`);
    expect(await s.redis.cmd('GET', 'bridge:account:gh:77')).toBe('mia@acme.design');
  });

  it('links GitHub to an existing email account matching a verified email (never an unverified one)', async () => {
    const s = setup({ emails: [{ email: 'mia@personal.example', verified: true, primary: true }, { email: 'mia@acme.design', verified: true, primary: false }, { email: 'boss@acme.design', verified: false, primary: false }] });
    await signInWithCode(s, 'boss@acme.design');
    await signInWithCode(s, 'mia@acme.design', 'Mia');
    const r = await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps);
    const body = await r.json();
    expect(body).toMatchObject({ created: false, account: { email: 'mia@acme.design', name: 'Mia', github: { login: 'mia-gh', id: 77 } } });
    expect((await getAccount(s.redis, 'boss@acme.design'))!.github).toBeNull();
    expect(await getAccount(s.redis, 'mia@personal.example')).toBeNull();
    // Next time the link is found by GitHub id, whatever the emails say, and a new login is kept.
    s.w.emails = [];
    s.w.user = { id: 77, login: 'mia-renamed', name: null };
    const again = await (await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps)).json();
    expect(again.account).toMatchObject({ email: 'mia@acme.design', github: { login: 'mia-renamed', id: 77 } });
  });

  it('refuses an account already linked to another GitHub account, a token GitHub refuses, and no verified email', async () => {
    const s = setup();
    await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps);
    s.w.user = { id: 99, login: 'other', name: null };
    const taken = await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe('github-taken');
    expect((await handleAccount(act({ action: 'github', token: 'ghu_' + 'y'.repeat(36) }), ENV, s.deps)).status).toBe(401);
    expect((await handleAccount(act({ action: 'github', token: 'bad token' }), ENV, s.deps)).status).toBe(401);
    const none = setup({ emails: [{ email: 'x@acme.design', verified: false, primary: true }] });
    expect((await (await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, none.deps)).json()).error).toBe('no-verified-email');
    const hidden = setup({ emails: 'forbidden' });
    expect((await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, hidden.deps)).status).toBe(403);
  });
});

describe('sessions', () => {
  it('rename changes the name; a tampered, foreign or expired cookie opens nothing', async () => {
    const s = setup();
    const { cookie } = await signInWithCode(s);
    const r = await handleAccount(act({ action: 'rename', name: '  Mia   Chen ' }, { cookie }), ENV, s.deps);
    expect((await r.json()).account.name).toBe('Mia Chen');
    const forged = `${ACCOUNT_COOKIE}=${signAccountSession({ email: 'mia@acme.design', v: 1, exp: T0 + 1e9 }, 'z'.repeat(40))}`;
    const value = cookie.split('=')[1]!;
    const [v, claims, mac] = value.split('.') as [string, string, string];
    const swapped = Buffer.from(JSON.stringify({ email: 'boss@acme.design', v: 1, exp: T0 + 1e9 })).toString('base64url');
    for (const bad of [forged, `${ACCOUNT_COOKIE}=${v}.${swapped}.${mac}`, `${ACCOUNT_COOKIE}=garbage`]) {
      const g = await handleAccount(me(bad), ENV, s.deps);
      expect((await g.json()).account).toBeNull();
      expect(g.headers.get('set-cookie')).toContain('Max-Age=0');
      expect((await handleAccount(act({ action: 'rename', name: 'X' }, { cookie: bad }), ENV, s.deps)).status).toBe(401);
    }
    void claims;
    s.tick(ACCOUNT_SESSION_TTL_MS + 1);
    expect((await (await handleAccount(me(cookie), ENV, s.deps)).json()).account).toBeNull();
  });

  it('sign-out clears the cookie on this browser only; sign out everywhere bumps the version and ends every session', async () => {
    const s = setup();
    const { cookie: a } = await signInWithCode(s);
    const { cookie: b } = await signInWithCode(s);
    const out = await handleAccount(act({ action: 'sign-out' }), ENV, s.deps);
    expect(out.headers.get('set-cookie')).toBe(`${ACCOUNT_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    expect((await (await handleAccount(me(a), ENV, s.deps)).json()).account).not.toBeNull();
    const all = await handleAccount(act({ action: 'sign-out-everywhere' }, { cookie: b }), ENV, s.deps);
    expect(all.status).toBe(200);
    expect((await getAccount(s.redis, 'mia@acme.design'))!.version).toBe(2);
    for (const c of [a, b]) expect((await (await handleAccount(me(c), ENV, s.deps)).json()).account).toBeNull();
    const { cookie: fresh } = await signInWithCode(s);
    expect((await (await handleAccount(me(fresh), ENV, s.deps)).json()).account).not.toBeNull();
  });
});

describe('delete', () => {
  it('deletes the account, its email memberships, its GitHub link and every session', async () => {
    const s = setup();
    await s.members.put('acme/design', member('mia@acme.design'));
    const r0 = await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps);
    const cookie = cookieOf(r0);
    const r = await handleAccount(act({ action: 'delete' }, { cookie }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await getAccount(s.redis, 'mia@acme.design')).toBeNull();
    expect(await s.members.get('acme/design', 'mia@acme.design')).toBeNull();
    // Only the daily counters stay (anonymous, under an HMAC, two days).
    expect(s.redis.keys().filter((k) => k.includes('mia') || (k.startsWith('bridge:account') && !k.startsWith('bridge:account:count:')))).toEqual([]);
    expect((await (await handleAccount(me(cookie), ENV, s.deps)).json()).account).toBeNull();
    expect((await handleAccount(act({ action: 'delete' }, { cookie }), ENV, s.deps)).status).toBe(401);
  });

  it('ends their connections in Claude, with the GitHub tokens Bridge kept sealed for them, and only theirs', async () => {
    const s = setup();
    await s.members.put('acme/design', member('mia@acme.design'));
    const key = sealingKey(SECRET, 'mcp-connector-github-tokens')!;
    let n = 0;
    const random = (k: number) => new Uint8Array(k).fill(++n);
    const gh = { access: 'ghu_' + 'a'.repeat(36), accessExp: T0 + 3600_000, refresh: 'ghr_' + 'r'.repeat(36), refreshExp: T0 + 86400_000 };
    const client = { clientId: 'https://claude.ai/oauth/mcp', clientName: 'Claude' };
    const made = await createGrant(s.redis, key, { repo: 'acme/design', client, login: 'mia-gh', name: 'Mia Chen', gh, account: accountRef('Mia@Acme.design') }, random, T0);
    const elsewhere = await createGrant(s.redis, key, { repo: 'acme/other', client, login: 'mia-gh', name: 'Mia Chen', gh, account: accountRef('mia@acme.design') }, random, T0);
    const legacy = await createGrant(s.redis, key, { repo: 'acme/design', client, login: 'Mia-GH', name: 'Mia Chen', gh }, random, T0);
    const lee = await createGrant(s.redis, key, { repo: 'acme/design', client, login: 'lee-gh', name: 'Lee Park', gh, account: accountRef('lee@acme.design') }, random, T0);
    const leeLegacy = await createGrant(s.redis, key, { repo: 'acme/design', client, login: 'lee-gh', name: 'Lee Park', gh }, random, T0);
    const cookie = cookieOf(await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps));
    expect((await handleAccount(act({ action: 'delete' }, { cookie }), ENV, s.deps)).status).toBe(200);
    for (const g of [made, elsewhere, legacy]) expect(await getGrant(s.redis, g.id)).toBeNull();
    expect((await listGrants(s.redis, 'acme/design')).map((g) => g.id).sort()).toEqual([lee.id, leeLegacy.id].sort());
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:oauth:account:') && k !== `bridge:oauth:account:${accountRef('lee@acme.design')}`)).toEqual([]);
    // No sealed GitHub token of hers is left anywhere.
    const sealed = [...s.redis.dump()].filter(([k]) => k.startsWith('bridge:oauth:grant:')).map(([, v]) => JSON.parse(String(v)));
    expect(sealed.every((g) => g.login === 'lee-gh')).toBe(true);
  });

  it('keeps the changes they sent in the team history by "A former member", with no record of their email', async () => {
    const s = setup();
    await s.members.put('acme/design', member('mia@acme.design'));
    // What /api/contribute recorded: a branch and a pull request on acme/design, an issue on a team Mia already left.
    const year = 365 * 24 * 60 * 60;
    await s.redis.pipe([
      ['SET', 'bridge:contrib:branch:acme/design:bridge/deeper-blue', 'mia@acme.design', 'EX', year],
      ['SET', 'bridge:contrib:issue:acme/design:12', 'mia@acme.design', 'EX', year],
      ['SADD', 'bridge:contrib:mine:acme/design:mia@acme.design', 'b:bridge/deeper-blue', 'i:12'],
      ['SET', 'bridge:contrib:issue:acme/old:4', 'mia@acme.design', 'EX', year],
      ['SADD', 'bridge:contrib:mine:acme/old:mia@acme.design', 'i:4'],
      ['SET', 'bridge:contrib:count:acme/design:mia@acme.design:2026-10-22', '3', 'EX', 100],
      // Someone else's change on the same team stays theirs.
      ['SET', 'bridge:contrib:issue:acme/design:13', 'lee@acme.design', 'EX', year],
      ['SADD', 'bridge:contrib:mine:acme/design:lee@acme.design', 'i:13'],
    ]);
    s.w.issues['acme/design#12'] = 'Deeper primary blue.\n\nRequested by Mia Chen (mia@acme.design) through Bridge.';
    s.w.issues['acme/old#4'] = 'Requested by Mia Chen through Bridge.';
    s.w.issues['acme/design#13'] = 'Requested by Lee Park (lee@acme.design) through Bridge.';
    const { cookie } = await signInWithCode(s, 'mia@acme.design', 'Mia Chen');
    expect((await handleAccount(act({ action: 'delete' }, { cookie }), ENV, s.deps)).status).toBe(200);
    // On GitHub the change stays, by "A former member", without the email or the name.
    expect(s.w.issues['acme/design#12']).toBe(`Deeper primary blue.\n\n${FORMER_MEMBER_LINE}`);
    expect(s.w.issues['acme/old#4']).toBe(FORMER_MEMBER_LINE);
    expect(s.w.issues['acme/design#13']).toContain('Lee Park');
    expect(requesterOf(s.w.issues['acme/design#12'])).toEqual({ name: FORMER_MEMBER, login: null });
    // No key keeps her email; Lee's record is untouched.
    expect(s.redis.keys().filter((k) => k.includes('mia'))).toEqual([]);
    expect(Object.values(Object.fromEntries(s.redis.dump())).flat()).not.toContain('mia@acme.design');
    expect(await s.redis.cmd('GET', 'bridge:contrib:issue:acme/design:13')).toBe('lee@acme.design');
  });

  it('deletes the account even when GitHub cannot be reached or the app is not set up', async () => {
    for (const app of [null, { installationToken: async () => Promise.reject(new Error('down')) }]) {
      const s = setup();
      s.deps.app = app;
      await s.redis.pipe([
        ['SET', 'bridge:contrib:issue:acme/design:12', 'mia@acme.design'],
        ['SADD', 'bridge:contrib:mine:acme/design:mia@acme.design', 'i:12'],
      ]);
      const { cookie } = await signInWithCode(s);
      expect((await handleAccount(act({ action: 'delete' }, { cookie }), ENV, s.deps)).status).toBe(200);
      expect(s.redis.keys().filter((k) => k.includes('mia'))).toEqual([]);
    }
  });

  it('rewrites only the line Bridge writes for an email member', () => {
    expect(anonymiseRequestedBy('Why.\n\nRequested by Ann Leroy (ann@acme.com) through Bridge.\n')).toBe(`Why.\n\n${FORMER_MEMBER_LINE}\n`);
    expect(anonymiseRequestedBy('Requested by Ann Leroy (@annleroy).')).toBe('Requested by Ann Leroy (@annleroy).');
    expect(anonymiseRequestedBy('We requested by mail through Bridge. Then more.')).toBe('We requested by mail through Bridge. Then more.');
  });

  it('refuses with 409 last-admin when the person is the only admin of a team with other members, on GitHub', async () => {
    const s = setup({
      repos: [
        { full_name: 'acme/design', permissions: { admin: true } },
        { full_name: 'acme/solo', permissions: { admin: true } },
        { full_name: 'acme/shared', permissions: { admin: true } },
        { full_name: 'acme/readonly', permissions: { admin: false } },
      ],
      collaborators: {
        'acme/design': [{ id: 77, login: 'mia-gh', permissions: { admin: true } }],
        'acme/solo': [{ id: 77, login: 'mia-gh', permissions: { admin: true } }],
        'acme/shared': [{ id: 77, login: 'mia-gh', permissions: { admin: true } }, { id: 8, login: 'dana', permissions: { admin: true } }],
      },
    });
    // acme/design has an email member besides Mia: someone else is on the team.
    await s.members.put('acme/design', member('lee@acme.design'));
    const cookie = cookieOf(await handleAccount(act({ action: 'github', token: GH_TOKEN }), ENV, s.deps));
    const r = await handleAccount(act({ action: 'delete' }, { cookie, authorization: `Bearer ${GH_TOKEN}` }), ENV, s.deps);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'last-admin', message: lastAdminOf(['Design']), teams: ['acme/design'], blocked: [{ repo: 'acme/design', name: 'Design', people: [{ name: 'Mia', email: 'lee@acme.design' }] }] });
    expect(await getAccount(s.redis, 'mia@acme.design')).not.toBeNull();
    // Another admin on the team: delete goes through.
    s.w.collaborators['acme/design'] = [{ id: 77, login: 'mia-gh', permissions: { admin: true } }, { id: 9, login: 'lee-gh', permissions: { admin: true } }];
    expect((await handleAccount(act({ action: 'delete' }, { cookie, authorization: `Bearer ${GH_TOKEN}` }), ENV, s.deps)).status).toBe(200);
  });
});

describe('daily export', () => {
  const exp = (auth?: string) => new Request(`${ORIGIN}/api/account?export=1`, { headers: { host: HOST, ...(auth ? { authorization: auth } : {}) } });
  const CRON = { ...ENV, CRON_SECRET: 'c'.repeat(32), BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' };

  it('needs Bearer $CRON_SECRET', async () => {
    const s = setup();
    for (const auth of [undefined, 'Bearer nope', `Bearer ${'c'.repeat(31)}`, `Basic ${'c'.repeat(32)}`]) expect((await handleAccount(exp(auth), CRON, s.deps)).status).toBe(401);
    expect((await handleAccount(exp(`Bearer ${'c'.repeat(32)}`), { ...CRON, CRON_SECRET: '' }, s.deps)).status).toBe(401);
    expect(s.blobs).toEqual([]);
  });

  it('writes accounts, members and invites to the blob store, never codes or counters, and keeps the last 30', async () => {
    const s = setup();
    await s.members.put('acme/design', member('lee@acme.design'));
    await signInWithCode(s);
    await handleAccount(act({ action: 'code', email: 'mia@acme.design' }), ENV, s.deps);
    await s.redis.cmd('SET', 'bridge:invite:acme/design:abc', JSON.stringify({ email: 'new@acme.design', role: 'edit' }));
    await s.redis.cmd('ZADD', 'bridge:invites:acme/design', 1, 'abc');
    await s.redis.cmd('SET', 'bridge:contrib:branch:acme/design:x', 'lee@acme.design');
    for (let i = 0; i < BACKUPS_KEPT + 2; i++) {
      const r = await handleAccount(exp(`Bearer ${'c'.repeat(32)}`), CRON, s.deps);
      expect(r.status).toBe(200);
      s.tick(864e5);
    }
    expect(s.blobs).toHaveLength(BACKUPS_KEPT);
    const latest = JSON.parse(s.blobs.at(-1)!.body!);
    expect(Object.keys(latest.keys).sort()).toEqual([
      'bridge:account:mia@acme.design',
      'bridge:account:teams:lee@acme.design',
      'bridge:invite:acme/design:abc',
      'bridge:member:acme/design:lee@acme.design',
      'bridge:members:acme/design',
    ]);
    expect(latest.keys['bridge:account:mia@acme.design']).toMatchObject({ email: 'mia@acme.design', version: 1 });
    expect(latest.keys['bridge:members:acme/design']).toEqual(['lee@acme.design']);
    expect(s.blobs[0]!.pathname).toMatch(/^bridge-backups\/accounts-2026-10-2\dT/);
  });

  it('without BLOB_READ_WRITE_TOKEN: a no-op with a warning that names no one', async () => {
    const s = setup();
    await signInWithCode(s);
    const r = await handleAccount(exp(`Bearer ${'c'.repeat(32)}`), { ...CRON, BLOB_READ_WRITE_TOKEN: undefined }, s.deps);
    expect(await r.json()).toEqual({ ok: true, skipped: 'no-blob-token' });
    expect(s.blobs).toEqual([]);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).not.toContain('@');
  });
});

describe('the contributor proxy accepts the account session', () => {
  const REPO = 'acme/design';
  const gh = (cookie: string) => new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(REPO)}&gh=${encodeURIComponent('/repos/acme/design/pulls')}`, { headers: { host: HOST, cookie } });
  const status = (cookie: string) => new Request(`${ORIGIN}/api/contribute?repo=${REPO}`, { headers: { host: HOST, cookie } });

  function contrib(s: ReturnType<typeof setup>) {
    return { fetch: async () => res(200, []), now: s.deps.now!, redis: s.redis, members: s.members, app: { installationToken: async () => 'ghs_x' } };
  }

  it('an account whose email is a member of the team is that member; others are not', async () => {
    const s = setup();
    await s.members.put(REPO, member('mia@acme.design'));
    const { cookie } = await signInWithCode(s);
    expect((await handleContribute(gh(cookie), ENV, contrib(s))).status).toBe(200);
    expect(await (await handleContribute(status(cookie), ENV, contrib(s))).json()).toEqual({ available: true, member: { email: 'mia@acme.design', name: 'Mia', role: 'edit' } });
    const { cookie: other } = await signInWithCode(s, 'boss@acme.design');
    expect((await handleContribute(gh(other), ENV, contrib(s))).status).toBe(401);
  });

  it('signing out everywhere or deleting the account ends proxy access; removing the membership too', async () => {
    const s = setup();
    await s.members.put(REPO, member('mia@acme.design'));
    const { cookie } = await signInWithCode(s);
    await handleAccount(act({ action: 'sign-out-everywhere' }, { cookie }), ENV, s.deps);
    expect((await handleContribute(gh(cookie), ENV, contrib(s))).status).toBe(401);
    const { cookie: c2 } = await signInWithCode(s);
    await s.members.remove(REPO, 'mia@acme.design');
    expect((await handleContribute(gh(c2), ENV, contrib(s))).status).toBe(401);
    await s.members.put(REPO, member('mia@acme.design'));
    expect((await handleContribute(gh(c2), ENV, contrib(s))).status).toBe(200);
    await handleAccount(act({ action: 'delete' }, { cookie: c2 }), ENV, s.deps);
    expect((await handleContribute(gh(c2), ENV, contrib(s))).status).toBe(401);
  });

  it('an account cookie signed for another purpose (a team cookie value) is refused', async () => {
    const s = setup();
    await s.members.put(REPO, member('mia@acme.design'));
    await signInWithCode(s);
    const { signSession } = await import('../../api/contribute/index');
    const teamValue = signSession({ repo: REPO, email: 'mia@acme.design', name: 'Mia', v: 1, exp: T0 + 1e9 }, SECRET);
    expect((await handleContribute(gh(`${ACCOUNT_COOKIE}=${teamValue}`), ENV, contrib(s))).status).toBe(401);
  });
});
