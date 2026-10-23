// The /api/invites Vercel function (api/invites/index.ts) with a mocked GitHub, an in-memory store and a fake email.
import { generateKeyPairSync, createVerify, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  appJwt,
  editOwners,
  EXPIRED,
  type EmailMessage,
  type FetchLike,
  githubApp,
  handleInvites,
  INVITE_TTL_MS,
  PEEK_PER_HOUR,
  inviteEmail,
  memoryStore,
  NOT_CONFIGURED,
  ownerChangeFor,
  redisStore,
  ROLE_PERMISSION,
  type InvitesDeps,
  LIMIT_DEFAULTS,
  LIMIT_WORDS,
  limitsFrom,
  maskEmail,
  MAX_RESENDS_PER_INVITE_DAY,
  RESEND_COOLDOWN_MS,
  EMAIL_ACCESS,
} from '../../api/invites/index';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const REPO = 'acme/design';
const T0 = Date.parse('2026-10-22T10:00:00Z');

const CONFIG = `{
  "version": 1,
  "governance": {
    "branchPrefix": "bridge/",
    "owners": { "design": ["dana"], "tech": ["@malik"] },
    "soloOwnerCanApproveBoth": true
  },
  "changes": "direct"
}
`;

interface World {
  users: Record<string, { login: string; name?: string }>;
  /** GET /user/emails per user token; a number answers that status instead. */
  emails: Record<string, { email: string; verified: boolean; primary?: boolean }[] | number>;
  perms: Record<string, string>;
  ownerType: 'User' | 'Organization';
  orgMembers: string[];
  acceptStatus: number;
  /** bridge.config.json on GitHub; defaults to CONFIG. */
  config?: string;
  calls: { method: string; path: string; auth: string; body?: any }[];
}

function world(over: Partial<World> = {}): World {
  return {
    users: { ghu_dana: { login: 'dana', name: 'Dana' }, ghu_leo01: { login: 'leo' }, ghu_sofia: { login: 'sofia', name: 'Sofia Reyes' }, ghu_kim01: { login: 'kim' } },
    emails: { ghu_sofia: [{ email: 'sofia@acme.design', verified: true, primary: true }], ghu_leo01: [{ email: 'leo@acme.design', verified: true, primary: true }] },
    perms: { dana: 'admin', leo: 'write', ann: 'read', malik: 'write', kim: 'admin' },
    ownerType: 'Organization',
    orgMembers: ['ann'],
    acceptStatus: 204,
    calls: [],
    ...over,
  };
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const auth = init.headers.Authorization ?? '';
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path: path + u.search, auth, body });
    const m = init.method;
    if (m === 'GET' && path === '/user') {
      const user = w.users[auth.replace('Bearer ', '')];
      return user ? res(200, user) : res(401, { message: 'Bad credentials' });
    }
    if (m === 'GET' && path === '/user/emails') {
      const e = w.emails[auth.replace('Bearer ', '')] ?? [];
      return typeof e === 'number' ? res(e, { message: 'Resource not accessible by integration' }) : res(200, e);
    }
    let x: RegExpExecArray | null;
    if ((x = /^\/repos\/acme\/design\/collaborators\/([^/]+)\/permission$/.exec(path))) {
      expect(auth).toBe('Bearer ghs_app');
      const p = w.perms[x[1]!];
      return p ? res(200, { permission: p }) : res(404, {});
    }
    if (m === 'GET' && path === '/repos/acme/design') return res(200, { owner: { login: 'acme', type: w.ownerType }, default_branch: 'main' });
    if ((x = /^\/orgs\/acme\/members\/([^/]+)$/.exec(path))) return res(w.orgMembers.includes(x[1]!) ? 204 : 404);
    if (m === 'PUT' && (x = /^\/repos\/acme\/design\/collaborators\/([^/]+)$/.exec(path))) {
      expect(auth).toBe('Bearer ghs_app');
      return w.orgMembers.includes(x[1]!) || w.perms[x[1]!] ? res(204) : res(201, { id: 77 });
    }
    if (m === 'DELETE' && /^\/repos\/acme\/design\/collaborators\//.test(path)) return res(204);
    if (m === 'PATCH' && path === '/user/repository_invitations/77') return res(w.acceptStatus);
    if (m === 'GET' && path === '/repos/acme/design/contents/bridge.config.json') return res(200, { content: Buffer.from(w.config ?? CONFIG).toString('base64'), sha: 'filesha' });
    if (m === 'GET' && path === '/repos/acme/design/git/ref/heads/main') return res(200, { object: { sha: 'headsha' } });
    if (m === 'POST' && path === '/repos/acme/design/git/refs') return res(201, {});
    if (m === 'PUT' && path === '/repos/acme/design/contents/bridge.config.json') return res(200, {});
    if (m === 'POST' && path === '/repos/acme/design/pulls') return res(201, { number: 12, html_url: 'https://github.com/acme/design/pull/12' });
    return res(599, { unexpected: `${m} ${path}` });
  };
}

function setup(over: Partial<World> = {}, extra: Partial<InvitesDeps> = {}) {
  const w = world(over);
  let now = T0;
  let seed = 0;
  const sent: EmailMessage[] = [];
  const store = memoryStore(() => now);
  const deps: InvitesDeps = {
    fetch: github(w),
    now: () => now,
    random: (n) => Uint8Array.from({ length: n }, () => (seed = (seed + 1) % 256)),
    store,
    email: { send: async (msg) => void sent.push(msg) },
    app: { installationToken: async () => 'ghs_app' },
    ...extra,
  };
  const tick = (ms: number) => (now += ms);
  return { w, deps, sent, store, tick };
}

function post(body: unknown, token = 'ghu_dana', headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/invites`, {
    method: 'POST',
    headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
}

const get = (query = '', token: string | null = 'ghu_dana') =>
  new Request(`${ORIGIN}/api/invites${query}`, { method: 'GET', headers: { host: HOST, ...(token ? { authorization: `Bearer ${token}` } : {}) } });

const tokenOf = (msg: EmailMessage) => /#t=([A-Za-z0-9_-]+)/.exec(msg.text)![1]!;

describe('role mapping', () => {
  it('maps each role to its GitHub permission, reviewers to an owner group', () => {
    expect(ROLE_PERMISSION).toEqual({ view: 'pull', edit: 'push', reviewer: 'push', admin: 'admin' });
    expect(ownerChangeFor('reviewer', 'design')).toEqual({ design: true, tech: false });
    expect(ownerChangeFor('reviewer', 'tech')).toEqual({ design: false, tech: true });
    expect(ownerChangeFor('edit')).toEqual({ design: false, tech: false });
    expect(ownerChangeFor('view')).toEqual({ design: false, tech: false });
    expect(ownerChangeFor('admin')).toEqual({});
  });
});

describe('not configured', () => {
  const bare: InvitesDeps = { fetch: vi.fn<FetchLike>() };
  it('says unavailable on the status GET, without naming what is missing', async () => {
    const r = await handleInvites(get('', null), {}, bare);
    expect(await r.json()).toEqual({ available: false });
    const half = await handleInvites(get('', null), { RESEND_API_KEY: 'x', INVITE_EMAIL_FROM: 'a@b.co' }, bare);
    expect(await half.json()).toEqual({ available: false });
  });

  it('answers 503 for every action, never a fake success, and calls nobody', async () => {
    for (const action of ['invite', 'resend', 'invite-role', 'cancel', 'set-role', 'remove', 'accept']) {
      const r = await handleInvites(post({ action, repo: REPO }), {}, bare);
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'not_configured', message: NOT_CONFIGURED });
    }
    expect((await handleInvites(get(`?repo=${REPO}`), {}, bare)).status).toBe(503);
    expect(bare.fetch).not.toHaveBeenCalled();
  });

  it('is available once storage, email and the app are all set', async () => {
    const env = { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 't', RESEND_API_KEY: 're_x', INVITE_EMAIL_FROM: 'Bridge <i@b.co>', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'pem' };
    expect(await (await handleInvites(get('', null), env, bare)).json()).toEqual({ available: true });
  });
});

describe('admin checks on the server', () => {
  it('refuses a writer, whatever login the body names', async () => {
    const { deps, sent } = setup();
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'x@acme.design' }], login: 'dana', caller: 'dana' }, 'ghu_leo01'), {}, deps);
    expect(r.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('reads the role with the app token, identity with the caller token', async () => {
    const { deps, w } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'x@acme.design' }] }), {}, deps);
    expect(w.calls.find((c) => c.path === '/user')!.auth).toBe('Bearer ghu_dana');
    expect(w.calls.find((c) => c.path.endsWith('/collaborators/dana/permission'))!.auth).toBe('Bearer ghs_app');
  });

  it('needs a GitHub sign-in and a page of this site', async () => {
    const { deps } = setup();
    expect((await handleInvites(post({ action: 'cancel', repo: REPO, id: 'a'.repeat(16) }, 'ghu_nobody'), {}, deps)).status).toBe(401);
    expect((await handleInvites(post({ action: 'cancel', repo: REPO }, 'ghu_dana', { origin: 'https://evil.example' }), {}, deps)).status).toBe(403);
    const noAuth = new Request(`${ORIGIN}/api/invites`, { method: 'POST', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' }, body: '{"action":"cancel","repo":"acme/design"}' });
    expect((await handleInvites(noAuth, {}, deps)).status).toBe(401);
  });

  it('lists pending invites to people who can push, not to readers', async () => {
    const { deps } = setup({ users: { ghu_dana: { login: 'dana' }, ghu_leo01: { login: 'leo' }, ghu_ann01: { login: 'ann' } } });
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'Sofia@Acme.design' }] }), {}, deps);
    const ok = await handleInvites(get(`?repo=${REPO}`, 'ghu_leo01'), {}, deps);
    const body = await ok.json();
    expect(body.personal).toBe(false);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({ email: 'sofia@acme.design', role: 'edit', invitedBy: 'dana' });
    expect(body.invites[0].tokenHash).toBeUndefined();
    expect((await handleInvites(get(`?repo=${REPO}`, 'ghu_ann01'), {}, deps)).status).toBe(403);
  });

  it('offers contributor roles only: Can view is refused for invites and role changes', async () => {
    const { deps, sent } = setup();
    for (const body of [
      { action: 'invite', repo: REPO, role: 'view', people: [{ email: 'x@acme.design' }] },
      { action: 'set-role', repo: REPO, login: 'leo', role: 'view' },
    ]) {
      const r = await handleInvites(post(body), {}, deps);
      expect(r.status).toBe(400);
      expect((await r.json()).message).toBe('Pick a role: Can edit, Reviewer or Admin.');
    }
    expect(sent).toHaveLength(0);
  });

  it('peek: says the team, role and masked address of a link before anyone signs in; 410 when spent; capped per network', async () => {
    const { deps, store } = setup();
    const token = 'p'.repeat(43);
    const hash = createHash('sha256').update(token).digest('hex');
    await store.put({ id: 'p'.repeat(16), repo: REPO, email: 'sofia@acme.design', role: 'edit', invitedBy: 'dana', createdAt: new Date(T0).toISOString(), sentAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + INVITE_TTL_MS).toISOString(), tokenHash: hash }, 600);
    const anon = (body: unknown) => new Request(`${ORIGIN}/api/invites`, { method: 'POST', headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-real-ip': '1.2.3.4' }, body: JSON.stringify(body) });
    const r = await handleInvites(anon({ action: 'peek', token }), {}, deps);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ team: 'Design', repo: REPO, role: 'edit', sentTo: 's•••@acme.design' });
    expect(JSON.stringify(body)).not.toContain('sofia@');
    expect((await handleInvites(anon({ action: 'peek', token: 'q'.repeat(43) }), {}, deps)).status).toBe(410);
    expect((await handleInvites(anon({ action: 'peek', token: 'bad' }), {}, deps)).status).toBe(410);
    for (let i = 0; i < PEEK_PER_HOUR; i++) await handleInvites(anon({ action: 'peek', token }), {}, deps);
    expect((await handleInvites(anon({ action: 'peek', token }), {}, deps)).status).toBe(429);
  });

  it('still honours a Can view invite sent before readers moved to Library access', async () => {
    const { deps, store, w } = setup();
    const token = 'v'.repeat(43);
    const hash = createHash('sha256').update(token).digest('hex');
    await store.put({ id: 'a'.repeat(16), repo: REPO, email: 'sofia@acme.design', role: 'view', invitedBy: 'dana', createdAt: new Date(T0).toISOString(), sentAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + INVITE_TTL_MS).toISOString(), tokenHash: hash }, 600);
    const a = await handleInvites(post({ action: 'accept', token }, 'ghu_sofia'), {}, deps);
    expect(await a.json()).toMatchObject({ status: 'joined', role: 'view' });
    expect(w.calls.find((c) => c.method === 'PUT' && c.path === '/repos/acme/design/collaborators/sofia')!.body).toEqual({ permission: 'pull' });
  });

  it('says when the app cannot manage people on the repository', async () => {
    const { deps } = setup({}, { app: { installationToken: async () => null } });
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'x@acme.design' }] }), {}, deps);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('app_missing');
  });
});

describe('invite token lifecycle', () => {
  it('stores only the hash, emails a fragment link, and accepts once', async () => {
    const { deps, sent, store, w } = setup();
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    expect(await r.json()).toEqual({ results: [{ email: 'sofia@acme.design', status: 'sent' }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('sofia@acme.design');
    expect(sent[0]!.subject).toBe('Dana invited you to Design on Bridge');
    expect(sent[0]!.text).toContain(`${ORIGIN}/studio/invite/#t=`);
    const token = tokenOf(sent[0]!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [stored] = await store.list(REPO);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored!.expiresAt).toBe(new Date(T0 + INVITE_TTL_MS).toISOString());

    const a = await handleInvites(post({ action: 'accept', token }, 'ghu_sofia'), {}, deps);
    expect(await a.json()).toEqual({ status: 'joined', repo: REPO, role: 'edit' });
    const put = w.calls.find((c) => c.method === 'PUT' && c.path === '/repos/acme/design/collaborators/sofia')!;
    expect(put.body).toEqual({ permission: 'push' });
    expect(await store.list(REPO)).toHaveLength(0);

    const again = await handleInvites(post({ action: 'accept', token }, 'ghu_sofia'), {}, deps);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ error: 'expired', message: EXPIRED });
  });

  it('refuses an expired link and drops the invite', async () => {
    const { deps, sent, store, tick } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    tick(INVITE_TTL_MS + 1);
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect((await handleInvites(get(`?repo=${REPO}`), {}, deps)).status).toBe(200);
    expect(await store.list(REPO)).toHaveLength(0);
  });

  it('refuses a malformed or unknown token without touching GitHub access', async () => {
    const { deps, w } = setup();
    expect((await handleInvites(post({ action: 'accept', token: 'nope' }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect((await handleInvites(post({ action: 'accept', token: 'A'.repeat(43) }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect(w.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('resend invalidates the old link and keeps the invite', async () => {
    const { deps, sent, store, tick } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [inv] = await store.list(REPO);
    tick(RESEND_COOLDOWN_MS);
    const r = await handleInvites(post({ action: 'resend', repo: REPO, id: inv!.id }), {}, deps);
    const body = await r.json();
    expect(body.invite).toMatchObject({ id: inv!.id, email: 'sofia@acme.design', createdAt: inv!.createdAt });
    expect(body.invite.sentAt).toBe(new Date(T0 + RESEND_COOLDOWN_MS).toISOString());
    expect(sent).toHaveLength(2);
    expect(tokenOf(sent[1]!)).not.toBe(tokenOf(sent[0]!));
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[1]!) }, 'ghu_sofia'), {}, deps)).status).toBe(200);
  });

  it('changes the role of a pending invite without a new email, and the same link grants it', async () => {
    const { deps, sent, store, w } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [inv] = await store.list(REPO);
    const r = await handleInvites(post({ action: 'invite-role', repo: REPO, id: inv!.id, role: 'reviewer', reviewAs: 'tech' }), {}, deps);
    expect((await r.json()).invite).toMatchObject({ id: inv!.id, role: 'reviewer', reviewAs: 'tech' });
    expect(sent).toHaveLength(1);
    const [after] = await store.list(REPO);
    expect(after).toMatchObject({ role: 'reviewer', reviewAs: 'tech', tokenHash: inv!.tokenHash });
    expect((await handleInvites(post({ action: 'invite-role', repo: REPO, id: inv!.id, role: 'edit' }, 'ghu_leo01'), {}, deps)).status).toBe(403);
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(200);
    expect(w.calls.find((c) => c.method === 'PUT' && c.path === '/repos/acme/design/collaborators/sofia')!.body).toEqual({ permission: 'push' });
  });

  it('cancel removes the invite and its link', async () => {
    const { deps, sent, store } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [inv] = await store.list(REPO);
    expect(await (await handleInvites(post({ action: 'cancel', repo: REPO, id: inv!.id }), {}, deps)).json()).toEqual({ ok: true });
    expect(await store.list(REPO)).toHaveLength(0);
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect((await handleInvites(post({ action: 'cancel', repo: REPO, id: inv!.id }), {}, deps)).status).toBe(404);
  });

  it('reports a failed email as failed, and keeps no invite nobody received', async () => {
    const { deps, store } = setup({}, { email: { send: async () => Promise.reject(new Error('provider down')) } });
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [result] = (await r.json()).results;
    expect(result).toMatchObject({ email: 'sofia@acme.design', status: 'failed' });
    expect(result.message).toMatch(/could not send/);
    expect(await store.list(REPO)).toHaveLength(0);
  });

  it('says already for a pending email, dedupes, and validates emails', async () => {
    const { deps, sent } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'SOFIA@acme.design' }, { email: 'new@acme.design' }, { email: 'new@acme.design' }, { email: 'not an email' }] }), {}, deps);
    expect((await r.json()).results.map((x: { status: string }) => x.status)).toEqual(['already', 'sent', 'failed']);
    expect(sent).toHaveLength(2);
    const many = Array.from({ length: 11 }, (_, i) => ({ email: `p${i}@acme.design` }));
    expect((await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: many }), {}, deps)).status).toBe(400);
    expect((await handleInvites(post({ action: 'invite', repo: REPO, role: 'reviewer', people: [{ email: 'a@acme.design' }] }), {}, deps)).status).toBe(400);
  });

  it('sends the invitee to GitHub when the app cannot accept for them', async () => {
    const { deps, sent } = setup({ acceptStatus: 403 });
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const a = await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    expect(await a.json()).toEqual({ status: 'accept-on-github', repo: REPO, role: 'edit', acceptUrl: 'https://github.com/acme/design/invitations' });
  });

  it('a reviewer who accepts gets push and a pull request listing them as owner', async () => {
    const { deps, sent, w } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'reviewer', reviewAs: 'design', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    expect(sent[0]!.text).toContain('Your role: Reviewer: design. Also approves changes before they ship.');
    const a = await (await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).json();
    expect(a).toMatchObject({ status: 'joined', role: 'reviewer', reviewAs: 'design', ownersPr: { number: 12 } });
    const file = w.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/contents/bridge.config.json'))!;
    expect(file.body.branch).toMatch(/^bridge\/members-sofia-[a-f0-9]{6}$/);
    expect(Buffer.from(file.body.content, 'base64').toString()).toContain('"design": ["dana", "sofia"]');
    expect(w.calls.find((c) => c.path.endsWith('/pulls'))!.body).toMatchObject({ title: 'Settings: make @sofia a design reviewer', base: 'main' });
  });
});

describe('organization members and personal repositories', () => {
  it('adds a known org member directly, without an email', async () => {
    const { deps, sent, w } = setup();
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'ann@acme.design', login: 'ann' }] }), {}, deps);
    expect((await r.json()).results).toEqual([{ email: 'ann@acme.design', status: 'added' }]);
    expect(sent).toHaveLength(0);
    expect(w.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/collaborators/ann'))!.body).toEqual({ permission: 'push' });
  });

  it('falls back to an email when the login is not a member', async () => {
    const { deps, sent } = setup();
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'zoe@acme.design', login: 'zoe' }] }), {}, deps);
    expect((await r.json()).results).toEqual([{ email: 'zoe@acme.design', status: 'sent' }]);
    expect(sent).toHaveLength(1);
  });

  it('says personal for a repository of a personal account', async () => {
    const { deps } = setup({ ownerType: 'User' });
    expect((await (await handleInvites(get(`?repo=${REPO}`), {}, deps)).json()).personal).toBe(true);
  });
});

describe('roles and removal', () => {
  it('changes a role and the owner lists in one pull request', async () => {
    const { deps, w } = setup();
    const r = await handleInvites(post({ action: 'set-role', repo: REPO, login: 'malik', role: 'reviewer', reviewAs: 'design' }), {}, deps);
    expect(await r.json()).toMatchObject({ ok: true, ownersPr: { number: 12, url: 'https://github.com/acme/design/pull/12' } });
    const text = Buffer.from(w.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/contents/bridge.config.json'))!.body.content, 'base64').toString();
    expect(text).toContain('"owners": { "design": ["dana", "malik"], "tech": [] }');
  });

  it('opens no pull request when the owner lists already say it', async () => {
    const { deps, w } = setup();
    const r = await handleInvites(post({ action: 'set-role', repo: REPO, login: 'leo', role: 'edit' }), {}, deps);
    expect(await r.json()).toEqual({ ok: true });
    expect(w.calls.some((c) => c.path.endsWith('/pulls'))).toBe(false);
  });

  it('never changes your own role or the owner of the repository', async () => {
    const { deps } = setup();
    const self = await handleInvites(post({ action: 'set-role', repo: REPO, login: 'Dana', role: 'edit' }), {}, deps);
    expect(self.status).toBe(409);
    expect((await self.json()).message).toBe('Ask another admin to change your role.');
    expect((await handleInvites(post({ action: 'set-role', repo: REPO, login: 'acme', role: 'edit' }), {}, deps)).status).toBe(409);
    expect((await handleInvites(post({ action: 'remove', repo: REPO, login: 'dana' }), {}, deps)).status).toBe(409);
  });

  it('removes someone and their owner entry', async () => {
    const { deps, w } = setup();
    const r = await handleInvites(post({ action: 'remove', repo: REPO, login: 'malik' }), {}, deps);
    expect(await r.json()).toMatchObject({ ok: true, ownersPr: { number: 12 } });
    expect(w.calls.some((c) => c.method === 'DELETE' && c.path === '/repos/acme/design/collaborators/malik')).toBe(true);
    expect(w.calls.find((c) => c.path.endsWith('/pulls'))!.body.title).toBe('Settings: @malik no longer reviews');
  });

  it('refuses a writer changing roles', async () => {
    const { deps } = setup();
    expect((await handleInvites(post({ action: 'remove', repo: REPO, login: 'malik' }, 'ghu_leo01'), {}, deps)).status).toBe(403);
  });
});

describe('editOwners', () => {
  it('rewrites only the changed one-line arrays', () => {
    const out = editOwners(CONFIG, 'sofia', { tech: true });
    expect(out).toBe(CONFIG.replace('"tech": ["@malik"]', '"tech": ["@malik", "sofia"]'));
    expect(editOwners(CONFIG, 'MALIK', { tech: false })).toBe(CONFIG.replace('"tech": ["@malik"]', '"tech": []'));
    expect(editOwners(CONFIG, 'dana', { design: true })).toBe(CONFIG);
  });

  it('keeps one item per line arrays in their style', () => {
    const multi = '{\n  "governance": {\n    "owners": {\n      "design": [\n        "dana"\n      ],\n      "tech": []\n    }\n  }\n}\n';
    expect(editOwners(multi, 'ann', { design: true })).toBe('{\n  "governance": {\n    "owners": {\n      "design": [\n        "dana",\n        "ann"\n      ],\n      "tech": []\n    }\n  }\n}\n');
  });

  it('ignores a look-alike key in a string and falls back to JSON when owners are missing', () => {
    const tricky = '{\n  "note": "\\"owners\\": {}",\n  "governance": { "owners": { "design": [], "tech": [] } }\n}\n';
    expect(editOwners(tricky, 'ann', { design: true })).toContain('"owners": { "design": ["ann"], "tech": [] }');
    const none = '{ "version": 1 }';
    expect(JSON.parse(editOwners(none, 'ann', { tech: true })).governance.owners.tech).toEqual(['ann']);
  });
});

describe('services', () => {
  it('signs an app JWT with the private key, literal \\n accepted', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
    const jwt = appJwt('123', pem, T0);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({ iat: T0 / 1000 - 60, exp: T0 / 1000 + 540, iss: '123' });
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
  });

  it('mints an installation token for the one repository, null without administration', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    let perms: Record<string, string> = { administration: 'write' };
    const f = vi.fn<FetchLike>(async (url) => (url.endsWith('/installation') ? res(200, { id: 9 }) : res(201, { token: 'ghs_x', permissions: perms })));
    const app = githubApp('123', pem, f, () => T0);
    expect(await app.installationToken('acme', 'design')).toBe('ghs_x');
    expect(JSON.parse(f.mock.calls[1]![1].body!)).toEqual({ repositories: ['design'] });
    perms = { contents: 'write' };
    expect(await app.installationToken('acme', 'design')).toBeNull();
  });

  it('talks to Upstash over REST, the invite and its token index expiring with the invite', async () => {
    const sentCmds: [string, any][] = [];
    const f: FetchLike = async (url, init) => {
      const body = JSON.parse(init.body!);
      sentCmds.push([url, body]);
      if (url.endsWith('/pipeline')) return res(200, body.map((c: unknown[]) => ({ result: c[0] === 'INCRBY' ? 3 : c[0] === 'ZRANGE' ? ['a'.repeat(16), 'b'.repeat(16)] : 1 })));
      if (body[0] === 'MGET') return res(200, { result: [JSON.stringify({ id: 'a'.repeat(16), tokenHash: 'h', repo: REPO }), null] });
      return res(200, { result: null });
    };
    const s = redisStore('https://kv.example/', 'tok', f, () => T0);
    const id = 'a'.repeat(16);
    await s.put({ id, repo: REPO, email: 'x@y.co', role: 'view', invitedBy: 'dana', createdAt: '', expiresAt: '', sentAt: '', tokenHash: 'h' }, 600);
    expect(sentCmds[0]).toEqual([
      'https://kv.example/pipeline',
      [
        ['SET', `bridge:invite:acme/design:${id}`, expect.any(String), 'EX', 600],
        ['SET', 'bridge:invite-token:h', `${REPO}|${id}`, 'EX', 600],
        ['ZADD', 'bridge:invites:acme/design', T0 + 600_000, id],
        ['EXPIRE', 'bridge:invites:acme/design', INVITE_TTL_MS / 1000],
        ['SADD', 'bridge:invites:email:x@y.co', `${REPO}|${id}`],
        ['EXPIRE', 'bridge:invites:email:x@y.co', INVITE_TTL_MS / 1000],
      ],
    ]);
    // The stored record holds only what the flow needs.
    expect(Object.keys(JSON.parse(sentCmds[0]![1][0][2])).sort()).toEqual(['createdAt', 'email', 'expiresAt', 'id', 'invitedBy', 'repo', 'role', 'sentAt', 'tokenHash']);
    expect(await s.byTokenHash('h')).toBeNull();

    await s.remove({ id, repo: REPO, tokenHash: 'h' } as never);
    expect(sentCmds.at(-1)![1]).toEqual([['DEL', `bridge:invite:acme/design:${id}`], ['DEL', 'bridge:invite-token:h'], ['ZREM', 'bridge:invites:acme/design', id]]);
    await s.remove({ id, repo: REPO, email: 'X@y.co', tokenHash: 'h' } as never);
    expect(sentCmds.at(-1)![1].at(-1)).toEqual(['SREM', 'bridge:invites:email:x@y.co', `${REPO}|${id}`]);

    // Listing drops ids whose record already expired.
    const listed = await s.list(REPO);
    expect(listed.map((x) => x.id)).toEqual([id]);
    expect(sentCmds.find(([, b]) => Array.isArray(b) && b[0] === 'ZREM' && b.includes('b'.repeat(16)))).toBeTruthy();
    expect(sentCmds.some(([, b]) => Array.isArray(b[0]) && b[0][0] === 'ZREMRANGEBYSCORE' && b[0][3] === T0)).toBe(true);

    expect(await s.bump(['k1'], 2, 60)).toEqual([3]);
    expect(sentCmds.at(-1)![1]).toEqual([['INCRBY', 'k1', 2], ['EXPIRE', 'k1', 60]]);
  });

  it('escapes everything in the email html', () => {
    const m = inviteEmail({ to: 'a@b.co', inviter: '<b>Eve</b>', repo: 'acme/design', role: 'admin', link: 'https://x/#t="a' });
    expect(m.html).not.toContain('<b>Eve');
    expect(m.html).toContain('&lt;b&gt;Eve');
    expect(m.text).toContain('Admin. Also invites people and changes settings.');
    expect(`${m.subject}${m.text}${m.html}`).not.toContain(String.fromCharCode(0x2014));
  });
});

const invite = (deps: InvitesDeps, emails: string[], env: Record<string, string> = {}, token = 'ghu_dana') =>
  handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: emails.map((email) => ({ email })) }, token), env, deps);

describe('only the invited email can accept', () => {
  it('accepts when the invited email is a verified email of the account, case and spaces aside', async () => {
    const { deps, sent, w } = setup({ emails: { ghu_sofia: [{ email: 'other@home.example', verified: true, primary: true }, { email: ' Sofia@ACME.design ', verified: true }] } });
    await invite(deps, ['sofia@acme.design']);
    const a = await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    expect(a.status).toBe(200);
    // Read with the invitee's own sign-in, never the app.
    expect(w.calls.find((c) => c.path.startsWith('/user/emails'))!.auth).toBe('Bearer ghu_sofia');
  });

  it('grants nothing to another account, keeps the invite valid and says where it was sent, masked', async () => {
    const { deps, sent, store, w } = setup();
    await invite(deps, ['sofia@acme.design']);
    const token = tokenOf(sent[0]!);
    const r = await handleInvites(post({ action: 'accept', token }, 'ghu_leo01'), {}, deps);
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body).toMatchObject({ error: 'email_mismatch', sentTo: 's•••@acme.design', login: 'leo' });
    expect(body.message).toContain('s•••@acme.design');
    expect(body.message).toMatch(/Add and verify it on GitHub.*ask your admin to invite/);
    expect(JSON.stringify(body)).not.toContain('sofia@acme.design');
    expect(w.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(await store.list(REPO)).toHaveLength(1);
    // The right person still gets in with the same link.
    expect((await handleInvites(post({ action: 'accept', token }, 'ghu_sofia'), {}, deps)).status).toBe(200);
  });

  it('refuses an unverified email and says to verify it', async () => {
    const { deps, sent, store, w } = setup({ emails: { ghu_sofia: [{ email: 'sofia@acme.design', verified: false }] } });
    await invite(deps, ['sofia@acme.design']);
    const r = await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe('email_unverified');
    expect(body.message).toMatch(/not verified yet\. Verify it on GitHub/);
    expect(w.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(await store.list(REPO)).toHaveLength(1);
  });

  it('asks to sign in again when the sign-in cannot read emails, and keeps the invite', async () => {
    for (const status of [403, 404]) {
      const { deps, sent, store, w } = setup({ emails: { ghu_sofia: status } });
      await invite(deps, ['sofia@acme.design']);
      const r = await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: 'email_access', message: EMAIL_ACCESS });
      expect(w.calls.some((c) => c.method === 'PUT')).toBe(false);
      expect(await store.list(REPO)).toHaveLength(1);
    }
  });

  it('masks an email to its first letter and domain', () => {
    expect(maskEmail('maria@acme.design')).toBe('m•••@acme.design');
    expect(maskEmail('a@b.co')).toBe('a•••@b.co');
  });
});

describe('daily caps', () => {
  it('has documented defaults below the site cap, overridable by the env', () => {
    expect(limitsFrom({})).toEqual(LIMIT_DEFAULTS);
    expect(LIMIT_DEFAULTS).toEqual({ admin: 20, team: 40, site: 80 });
    expect(limitsFrom({ INVITES_MAX_PER_ADMIN_DAY: '5', INVITES_MAX_PER_TEAM_DAY: ' 7 ', INVITES_MAX_SITE_DAY: '0' })).toEqual({ admin: 5, team: 7, site: 0 });
    expect(limitsFrom({ INVITES_MAX_PER_ADMIN_DAY: 'lots', INVITES_MAX_PER_TEAM_DAY: '-1', INVITES_MAX_SITE_DAY: '2.5' })).toEqual(LIMIT_DEFAULTS);
  });

  it('stops an admin at their cap with 429, the reason and Retry-After, then resets the next day', async () => {
    const { deps, sent, tick } = setup();
    const env = { INVITES_MAX_PER_ADMIN_DAY: '2' };
    expect((await invite(deps, ['a@acme.design', 'b@acme.design'], env)).status).toBe(200);
    const r = await invite(deps, ['c@acme.design'], env);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'limit', message: LIMIT_WORDS.admin, limit: 'admin' });
    expect(LIMIT_WORDS.admin).toBe("You reached today's invite limit. Try again tomorrow.");
    expect(Number(r.headers.get('retry-after'))).toBe(14 * 3600);
    expect(sent).toHaveLength(2);
    tick(14 * 3600 * 1000);
    expect((await invite(deps, ['c@acme.design'], env)).status).toBe(200);
  });

  it('refuses a batch larger than what is left, all or nothing, and says how many are left', async () => {
    const { deps, sent } = setup();
    const env = { INVITES_MAX_PER_ADMIN_DAY: '3' };
    const r = await invite(deps, ['a@acme.design', 'b@acme.design', 'c@acme.design', 'd@acme.design', 'e@acme.design'], env);
    expect(r.status).toBe(429);
    expect((await r.json()).message).toBe('You can send 3 more invites today. Remove some people, or try again tomorrow.');
    expect(sent).toHaveLength(0);
    // Nothing was kept from the refused batch.
    expect((await invite(deps, ['a@acme.design', 'b@acme.design', 'c@acme.design'], env)).status).toBe(200);
  });

  it('caps a team across its admins', async () => {
    const { deps } = setup();
    const env = { INVITES_MAX_PER_TEAM_DAY: '2' };
    expect((await invite(deps, ['a@acme.design'], env)).status).toBe(200);
    expect((await invite(deps, ['b@acme.design'], env, 'ghu_kim01')).status).toBe(200);
    const r = await invite(deps, ['c@acme.design'], env, 'ghu_kim01');
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ limit: 'team', message: "This team reached today's invite limit. Try again tomorrow." });
  });

  it('caps the whole site, whatever the team', async () => {
    const { deps } = setup();
    const env = { INVITES_MAX_SITE_DAY: '1' };
    expect((await invite(deps, ['a@acme.design'], env)).status).toBe(200);
    const r = await invite(deps, ['b@acme.design'], env, 'ghu_kim01');
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ limit: 'site', message: "Bridge reached today's invite limit for everyone. Try again tomorrow." });
  });

  it('counts only emails that went out: org members added, pending ones and failed sends are given back', async () => {
    const env = { INVITES_MAX_PER_ADMIN_DAY: '1' };
    const { deps } = setup();
    expect((await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'ann@acme.design', login: 'ann' }] }), env, deps)).status).toBe(200);
    expect((await invite(deps, ['a@acme.design'], env)).status).toBe(200);
    // Already pending: nothing to send, no cap hit.
    expect((await invite(deps, ['a@acme.design'], env)).status).toBe(200);

    let fail = true;
    const flaky = setup({}, { email: { send: async () => (fail ? Promise.reject(new Error('down')) : undefined) } });
    expect((await invite(flaky.deps, ['a@acme.design'], env)).status).toBe(200);
    fail = false;
    expect((await (await invite(flaky.deps, ['a@acme.design'], env)).json()).results[0].status).toBe('sent');
  });

  it('still validates every email and caps recipients per request', async () => {
    const { deps, sent } = setup();
    const r = await invite(deps, ['ok@acme.design', 'no spaces@acme.design', '<x>@acme.design', 'a@b', `${'x'.repeat(250)}@acme.design`]);
    expect((await r.json()).results.map((x: { status: string }) => x.status)).toEqual(['sent', 'failed', 'failed', 'failed', 'failed']);
    expect(sent).toHaveLength(1);
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@acme.design`);
    expect((await invite(deps, many)).status).toBe(400);
  });
});

describe('resend frequency', () => {
  it('waits between two sends of the same invite', async () => {
    const { deps, sent, store, tick } = setup();
    await invite(deps, ['sofia@acme.design']);
    const [inv] = await store.list(REPO);
    tick(RESEND_COOLDOWN_MS - 60_000);
    const r = await handleInvites(post({ action: 'resend', repo: REPO, id: inv!.id }), {}, deps);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'limit', message: LIMIT_WORDS.resend_soon, limit: 'resend_soon' });
    expect(r.headers.get('retry-after')).toBe('60');
    expect(sent).toHaveLength(1);
    // The first link still works.
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(200);
  });

  it(`allows ${MAX_RESENDS_PER_INVITE_DAY} resends per invite per day; a failed email does not count`, async () => {
    let fail = false;
    const { deps, sent, store, tick } = setup({}, {});
    deps.email = { send: async (msg) => (fail ? Promise.reject(new Error('down')) : void sent.push(msg)) };
    await invite(deps, ['sofia@acme.design']);
    const [inv] = await store.list(REPO);
    const resend = () => handleInvites(post({ action: 'resend', repo: REPO, id: inv!.id }), {}, deps);
    tick(RESEND_COOLDOWN_MS);
    fail = true;
    expect((await resend()).status).toBe(502);
    fail = false;
    for (let i = 0; i < MAX_RESENDS_PER_INVITE_DAY; i++) {
      expect((await resend()).status).toBe(200);
      tick(RESEND_COOLDOWN_MS);
    }
    const r = await resend();
    expect(r.status).toBe(429);
    expect((await r.json()).limit).toBe('resend');
    expect(sent).toHaveLength(1 + MAX_RESENDS_PER_INVITE_DAY);
  });

  it('counts resends toward the admin cap', async () => {
    const { deps, store, tick } = setup();
    const env = { INVITES_MAX_PER_ADMIN_DAY: '1' };
    await invite(deps, ['sofia@acme.design'], env);
    const [inv] = await store.list(REPO);
    tick(RESEND_COOLDOWN_MS);
    const r = await handleInvites(post({ action: 'resend', repo: REPO, id: inv!.id }), env, deps);
    expect(r.status).toBe(429);
    expect((await r.json()).limit).toBe('admin');
  });
});

describe('what is kept, and for how long', () => {
  const inviteKeys = (keys: string[]) => keys.filter((k) => !k.startsWith('bridge:invites:count:'));

  it('keeps only the fields the flow needs', async () => {
    const { deps, store } = setup();
    await invite(deps, ['sofia@acme.design']);
    const [inv] = await store.list(REPO);
    expect(Object.keys(inv!).sort()).toEqual(['createdAt', 'email', 'expiresAt', 'id', 'invitedBy', 'repo', 'role', 'sentAt', 'tokenHash']);
  });

  it('deletes the record and its link on accept', async () => {
    const { deps, sent, store } = setup();
    await invite(deps, ['sofia@acme.design']);
    expect(inviteKeys(store.keys())).toHaveLength(2);
    await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    expect(inviteKeys(store.keys())).toEqual([]);
  });

  it('deletes the record and its link on cancel', async () => {
    const { deps, store } = setup();
    await invite(deps, ['sofia@acme.design']);
    const [inv] = await store.list(REPO);
    await handleInvites(post({ action: 'cancel', repo: REPO, id: inv!.id }), {}, deps);
    expect(inviteKeys(store.keys())).toEqual([]);
  });

  it('lets the record and its link expire with the invite, and the counters a day later', async () => {
    const { deps, store, tick } = setup();
    await invite(deps, ['sofia@acme.design']);
    tick(INVITE_TTL_MS - 1000);
    expect(inviteKeys(store.keys())).toHaveLength(2);
    tick(1000);
    expect(store.keys()).toEqual([]);
  });

  it('never logs an email or a token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const { deps, sent } = setup({}, { email: { send: async (m) => void sent.push(m) } });
    await invite(deps, ['sofia@acme.design', 'bad email']);
    await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_leo01'), {}, deps);
    await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe('email contributors in Members', () => {
  async function withMember() {
    const members = memberStore(memoryRedis());
    await members.put(REPO, { email: 'mia@acme.design', name: 'Mia Chen', role: 'edit', version: 1, addedBy: 'dana', at: '2026-10-22T10:00:00.000Z' });
    return { members, ...setup({}, { members }) };
  }

  it('lists them next to the invites, flagged via email', async () => {
    const { deps } = await withMember();
    const r = await handleInvites(get(`?repo=${REPO}`, 'ghu_leo01'), {}, deps);
    expect(r.status).toBe(200);
    expect((await r.json()).members).toEqual([{ via: 'email', name: 'Mia Chen', email: 'mia@acme.design', role: 'edit', addedBy: 'dana', at: '2026-10-22T10:00:00.000Z' }]);
  });

  it('an admin removes one by email, which ends their sessions; a writer cannot', async () => {
    const { deps, members, w } = await withMember();
    expect((await handleInvites(post({ action: 'remove', repo: REPO, email: 'mia@acme.design' }, 'ghu_leo01'), {}, deps)).status).toBe(403);
    expect(await members.get(REPO, 'mia@acme.design')).not.toBeNull();
    const r = await handleInvites(post({ action: 'remove', repo: REPO, email: 'MIA@acme.design' }), {}, deps);
    expect(r.status).toBe(200);
    expect(await members.get(REPO, 'mia@acme.design')).toBeNull();
    expect(await members.list(REPO)).toEqual([]);
    expect(w.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect((await handleInvites(post({ action: 'remove', repo: REPO, email: 'mia@acme.design' }), {}, deps)).status).toBe(404);
  });

  it('refuses reviewer or admin for an email contributor with 409 github-required', async () => {
    const { deps, w } = await withMember();
    for (const role of [{ role: 'reviewer', reviewAs: 'design' }, { role: 'admin' }]) {
      const r = await handleInvites(post({ action: 'set-role', repo: REPO, email: 'mia@acme.design', ...role }), {}, deps);
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe('github-required');
    }
    expect((await handleInvites(post({ action: 'set-role', repo: REPO, email: 'mia@acme.design', role: 'edit' }), {}, deps)).status).toBe(200);
    expect((await handleInvites(post({ action: 'set-role', repo: REPO, email: 'nobody@acme.design', role: 'edit' }), {}, deps)).status).toBe(404);
    expect(w.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('a Can edit invite says no GitHub account is needed; reviewers still sign in with GitHub', async () => {
    const edit = inviteEmail({ to: 'a@b.co', inviter: 'Dana', repo: REPO, role: 'edit', link: 'https://x/#t=1' });
    expect(edit.text).toContain('You join with this email, no GitHub account needed.');
    const reviewer = inviteEmail({ to: 'a@b.co', inviter: 'Dana', repo: REPO, role: 'reviewer', reviewAs: 'design', link: 'https://x/#t=1' });
    expect(reviewer.text).toContain('You sign in with GitHub.');
  });

  it('peek and the email use bridge.config.json name when the team set one', async () => {
    const { deps, sent } = setup({ config: CONFIG.replace('"version": 1,', '"version": 1,\n  "name": "Acme Studio",') });
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    expect(sent[0]!.subject).toBe('Dana invited you to Acme Studio on Bridge');
    const r = await handleInvites(post({ action: 'peek', token: tokenOf(sent[0]!) }), {}, deps);
    expect((await r.json()).team).toBe('Acme Studio');
  });

  it("the email names the team, not its repository: Bridge's own design system reads Bridge DS", () => {
    const own = inviteEmail({ to: 'a@b.co', inviter: 'Dana', repo: 'peterbono/ai-design-system-demo', role: 'edit', link: 'https://x/#t=1' });
    expect(own.subject).toBe('Dana invited you to Bridge DS on Bridge');
    expect(`${own.text}${own.html}`).not.toContain('peterbono/');
    // Never "Bridge on Bridge": the suffix drops when a team is named Bridge itself.
    const bridge = inviteEmail({ to: 'a@b.co', inviter: 'Dana', repo: REPO, team: 'Bridge', role: 'edit', link: 'https://x/#t=1' });
    expect(bridge.subject).toBe('Dana invited you to Bridge');
    expect(bridge.text).toContain('Dana invited you to the Bridge design system.');
    expect(bridge.html).toContain('<strong>Bridge</strong> design system.</p>');
    expect(`${bridge.text}${bridge.html}`).not.toMatch(/Bridge on Bridge|system on Bridge/);
    const other = inviteEmail({ to: 'a@b.co', inviter: 'Dana', repo: REPO, role: 'edit', link: 'https://x/#t=1' });
    expect(other.subject).toBe('Dana invited you to Design on Bridge');
    expect(other.text).toContain('the Design design system on Bridge.');
  });

  it('joining with GitHub drops an email membership of the same address', async () => {
    const members = memberStore(memoryRedis());
    await members.put(REPO, { email: 'sofia@acme.design', name: 'Sofia', role: 'edit', version: 1, addedBy: 'dana', at: '' });
    const { deps, sent } = setup({}, { members });
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'edit', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const r = await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    expect(r.status).toBe(200);
    expect(await members.get(REPO, 'sofia@acme.design')).toBeNull();
  });
});
