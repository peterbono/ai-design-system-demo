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
  inviteEmail,
  memoryStore,
  NOT_CONFIGURED,
  ownerChangeFor,
  redisStore,
  ROLE_PERMISSION,
  type InvitesDeps,
} from '../../api/invites/index';

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
  perms: Record<string, string>;
  ownerType: 'User' | 'Organization';
  orgMembers: string[];
  acceptStatus: number;
  calls: { method: string; path: string; auth: string; body?: any }[];
}

function world(over: Partial<World> = {}): World {
  return {
    users: { ghu_dana: { login: 'dana', name: 'Dana' }, ghu_leo01: { login: 'leo' }, ghu_sofia: { login: 'sofia', name: 'Sofia Reyes' } },
    perms: { dana: 'admin', leo: 'write', ann: 'read', malik: 'write' },
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
    if (m === 'GET' && path === '/repos/acme/design/contents/bridge.config.json') return res(200, { content: Buffer.from(CONFIG).toString('base64'), sha: 'filesha' });
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
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'x@acme.design' }], login: 'dana', caller: 'dana' }, 'ghu_leo01'), {}, deps);
    expect(r.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('reads the role with the app token, identity with the caller token', async () => {
    const { deps, w } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'x@acme.design' }] }), {}, deps);
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
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'Sofia@Acme.design' }] }), {}, deps);
    const ok = await handleInvites(get(`?repo=${REPO}`, 'ghu_leo01'), {}, deps);
    const body = await ok.json();
    expect(body.personal).toBe(false);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({ email: 'sofia@acme.design', role: 'view', invitedBy: 'dana' });
    expect(body.invites[0].tokenHash).toBeUndefined();
    expect((await handleInvites(get(`?repo=${REPO}`, 'ghu_ann01'), {}, deps)).status).toBe(403);
  });

  it('says when the app cannot manage people on the repository', async () => {
    const { deps } = setup({}, { app: { installationToken: async () => null } });
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'x@acme.design' }] }), {}, deps);
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
    expect(sent[0]!.subject).toBe('Dana invited you to acme/design on Bridge');
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
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
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
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [inv] = await store.list(REPO);
    tick(60_000);
    const r = await handleInvites(post({ action: 'resend', repo: REPO, id: inv!.id }), {}, deps);
    const body = await r.json();
    expect(body.invite).toMatchObject({ id: inv!.id, email: 'sofia@acme.design', createdAt: inv!.createdAt });
    expect(body.invite.sentAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(sent).toHaveLength(2);
    expect(tokenOf(sent[1]!)).not.toBe(tokenOf(sent[0]!));
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[1]!) }, 'ghu_sofia'), {}, deps)).status).toBe(200);
  });

  it('changes the role of a pending invite without a new email, and the same link grants it', async () => {
    const { deps, sent, store, w } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
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
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [inv] = await store.list(REPO);
    expect(await (await handleInvites(post({ action: 'cancel', repo: REPO, id: inv!.id }), {}, deps)).json()).toEqual({ ok: true });
    expect(await store.list(REPO)).toHaveLength(0);
    expect((await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps)).status).toBe(410);
    expect((await handleInvites(post({ action: 'cancel', repo: REPO, id: inv!.id }), {}, deps)).status).toBe(404);
  });

  it('reports a failed email as failed, and keeps no invite nobody received', async () => {
    const { deps, store } = setup({}, { email: { send: async () => Promise.reject(new Error('provider down')) } });
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const [result] = (await r.json()).results;
    expect(result).toMatchObject({ email: 'sofia@acme.design', status: 'failed' });
    expect(result.message).toMatch(/could not send/);
    expect(await store.list(REPO)).toHaveLength(0);
  });

  it('says already for a pending email, dedupes, and validates emails', async () => {
    const { deps, sent } = setup();
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const r = await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'SOFIA@acme.design' }, { email: 'new@acme.design' }, { email: 'new@acme.design' }, { email: 'not an email' }] }), {}, deps);
    expect((await r.json()).results.map((x: { status: string }) => x.status)).toEqual(['already', 'sent', 'failed']);
    expect(sent).toHaveLength(2);
    const many = Array.from({ length: 11 }, (_, i) => ({ email: `p${i}@acme.design` }));
    expect((await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: many }), {}, deps)).status).toBe(400);
    expect((await handleInvites(post({ action: 'invite', repo: REPO, role: 'reviewer', people: [{ email: 'a@acme.design' }] }), {}, deps)).status).toBe(400);
  });

  it('sends the invitee to GitHub when the app cannot accept for them', async () => {
    const { deps, sent } = setup({ acceptStatus: 403 });
    await handleInvites(post({ action: 'invite', repo: REPO, role: 'view', people: [{ email: 'sofia@acme.design' }] }), {}, deps);
    const a = await handleInvites(post({ action: 'accept', token: tokenOf(sent[0]!) }, 'ghu_sofia'), {}, deps);
    expect(await a.json()).toEqual({ status: 'accept-on-github', repo: REPO, role: 'view', acceptUrl: 'https://github.com/acme/design/invitations' });
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
    const r = await handleInvites(post({ action: 'set-role', repo: REPO, login: 'leo', role: 'view' }), {}, deps);
    expect(await r.json()).toEqual({ ok: true });
    expect(w.calls.some((c) => c.path.endsWith('/pulls'))).toBe(false);
  });

  it('never changes your own role or the owner of the repository', async () => {
    const { deps } = setup();
    const self = await handleInvites(post({ action: 'set-role', repo: REPO, login: 'Dana', role: 'view' }), {}, deps);
    expect(self.status).toBe(409);
    expect((await self.json()).message).toBe('Ask another admin to change your role.');
    expect((await handleInvites(post({ action: 'set-role', repo: REPO, login: 'acme', role: 'view' }), {}, deps)).status).toBe(409);
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

  it('talks to Upstash over REST, the token index expiring with the invite', async () => {
    const sentCmds: unknown[] = [];
    const f: FetchLike = async (url, init) => {
      sentCmds.push([url, JSON.parse(init.body!)]);
      return res(200, url.endsWith('/pipeline') ? [{ result: 1 }, { result: 'OK' }] : { result: null });
    };
    const s = redisStore('https://kv.example/', 'tok', f);
    await s.put({ id: 'a'.repeat(16), repo: REPO, email: 'x@y.co', role: 'view', invitedBy: 'dana', createdAt: '', expiresAt: '', sentAt: '', tokenHash: 'h' }, 600);
    expect(sentCmds[0]).toEqual(['https://kv.example/pipeline', [['HSET', 'bridge:invites:acme/design', 'a'.repeat(16), expect.any(String)], ['SET', 'bridge:invite-token:h', `${REPO}|${'a'.repeat(16)}`, 'EX', 600]]]);
    expect(await s.byTokenHash('h')).toBeNull();
  });

  it('escapes everything in the email html', () => {
    const m = inviteEmail({ to: 'a@b.co', inviter: '<b>Eve</b>', repo: 'acme/design', role: 'admin', link: 'https://x/#t="a' });
    expect(m.html).not.toContain('<b>Eve');
    expect(m.html).toContain('&lt;b&gt;Eve');
    expect(m.text).toContain('Admin. Also invites people and changes settings.');
    expect(`${m.subject}${m.text}${m.html}`).not.toContain(String.fromCharCode(0x2014));
  });
});
