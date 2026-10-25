// The /api/claude Vercel function (api/claude/index.ts), key part: a team admin connects the team's Anthropic API key,
// Bridge keeps it encrypted and never sends it back; others read who connected it and when. Fakes only: no real key,
// no network.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_COOKIE, putAccount, signAccountSession } from '../../api/_lib/account';
import { claudeKeyKey, claudeKeyStore, openKey, secretsKey, sealKey } from '../../api/_lib/claude-key';
import type { AppTokens } from '../../api/_lib/github-app';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { CLAUDE_WORDS, handleClaude, type ClaudeEnv, type FetchLike } from '../../api/claude/index';

const HOST = 'bridge.example.com';
const SECRET = Buffer.alloc(32, 7).toString('base64');
const SESSION_SECRET = 's'.repeat(40);
const FAKE_KEY = `sk-ant-fake-${'x'.repeat(24)}`;
const NOW = Date.parse('2026-10-25T10:00:00Z');
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// GitHub people, by token: an admin, someone who can push, a reader, and someone of another team.
const PEOPLE: Record<string, { login: string; name: string | null; perms: Record<string, Record<string, boolean>> }> = {
  ghu_admin_token_0000000000: { login: 'dana', name: 'Dana Kim', perms: { 'acme/design': { admin: true, push: true, pull: true } } },
  ghu_editor_token_000000000: { login: 'malik', name: null, perms: { 'acme/design': { admin: false, push: true, pull: true } } },
  ghu_reader_token_000000000: { login: 'rae', name: 'Rae', perms: { 'acme/design': { admin: false, push: false, pull: true } } },
  ghu_other_team_token_00000: { login: 'otto', name: 'Otto', perms: { 'other/ds': { admin: true, push: true, pull: true } } },
};

function world(anthropic: (key: string) => number = (k) => (k === FAKE_KEY ? 200 : 401)) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    if (u.host === 'api.anthropic.com') return res(anthropic(init.headers['x-api-key'] ?? ''), { data: [] });
    const token = (init.headers.Authorization ?? '').replace(/^Bearer /, '');
    const p = PEOPLE[token];
    if (!p) return res(401, {});
    if (u.pathname === '/user') return res(200, { login: p.login, name: p.name });
    const m = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname);
    if (m && p.perms[m[1]!]) return res(200, { permissions: p.perms[m[1]!] });
    return res(404, {});
  };
  const redis = memoryRedis(() => NOW);
  const app: AppTokens = { installationToken: async () => 'ghs_app' };
  const env: ClaudeEnv = { BRIDGE_SECRETS_KEY: SECRET, LIBRARY_SESSION_SECRET: SESSION_SECRET, GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: 'pem' };
  const call = (method: 'GET' | 'POST', body: unknown, headers: Record<string, string> = {}, query = '?repo=acme/design', e: ClaudeEnv = env) =>
    handleClaude(
      new Request(`https://${HOST}/api/claude${method === 'GET' ? query : ''}`, {
        method,
        headers: { host: HOST, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }),
      e,
      { fetch: f, now: () => NOW, redis, app },
    );
  return { calls, redis, call, env };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const ADMIN = bearer('ghu_admin_token_0000000000');
const EDITOR = bearer('ghu_editor_token_000000000');

describe('claude key storage (api/_lib/claude-key.ts)', () => {
  it('encrypts with AES-GCM, bound to the team: another team or another secret never opens it', () => {
    const key = secretsKey(SECRET)!;
    const sealed = sealKey(FAKE_KEY, 'acme/design', key);
    expect(sealed.ct).not.toContain('sk-ant');
    expect(Buffer.from(sealed.ct, 'base64').toString('utf8')).not.toContain('fake');
    expect(openKey(sealed, 'acme/design', key)).toBe(FAKE_KEY);
    expect(openKey(sealed, 'Acme/Design', key)).toBe(FAKE_KEY);
    expect(openKey(sealed, 'other/ds', key)).toBeNull();
    expect(openKey(sealed, 'acme/design', secretsKey(Buffer.alloc(32, 8).toString('base64'))!)).toBeNull();
    expect(openKey({ ...sealed, ct: Buffer.from('tampered').toString('base64') }, 'acme/design', key)).toBeNull();
  });

  it('needs a secret of 32 bytes or more', () => {
    expect(secretsKey(undefined)).toBeNull();
    expect(secretsKey('')).toBeNull();
    expect(secretsKey(Buffer.alloc(16, 1).toString('base64'))).toBeNull();
    expect(secretsKey(SECRET)).toHaveLength(32);
  });

  it('keeps who and when in clear, the key only sealed', async () => {
    const redis = memoryRedis(() => NOW);
    const store = claudeKeyStore(redis, secretsKey(SECRET)!);
    expect(await store.connect('acme/design', FAKE_KEY, 'Dana Kim', NOW)).toEqual({ connected: true, addedBy: 'Dana Kim', at: '2026-10-25T10:00:00.000Z' });
    const raw = (await redis.cmd('GET', claudeKeyKey('acme/design'))) as string;
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain('sk-ant');
    expect(await store.reveal('acme/design')).toBe(FAKE_KEY);
    expect(await store.connection('acme/design')).toEqual({ connected: true, addedBy: 'Dana Kim', at: '2026-10-25T10:00:00.000Z' });
    await store.disconnect('acme/design');
    expect(await store.reveal('acme/design')).toBeNull();
    expect(await store.connection('acme/design')).toEqual({ connected: false });
  });
});

describe('/api/claude connect, read, disconnect', () => {
  it('an admin connects: Anthropic checks the key, Bridge stores it, the answer never carries it', async () => {
    const w = world();
    const r = await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(FAKE_KEY);
    expect(JSON.parse(text)).toEqual({ connected: true, addedBy: 'Dana Kim', at: '2026-10-25T10:00:00.000Z' });
    const check = w.calls.find((c) => c.url.startsWith('https://api.anthropic.com/'))!;
    expect(check.url).toBe('https://api.anthropic.com/v1/models?limit=1');
    // The key went to Anthropic only, never to GitHub.
    expect(w.calls.filter((c) => JSON.stringify(c.headers).includes(FAKE_KEY)).map((c) => new URL(c.url).host)).toEqual(['api.anthropic.com']);
    // Any member reads who and when; never the key.
    const g = await w.call('GET', null, EDITOR);
    const gt = await g.text();
    expect(gt).not.toContain('sk-ant');
    expect(JSON.parse(gt)).toEqual({ available: true, connected: true, addedBy: 'Dana Kim', at: '2026-10-25T10:00:00.000Z', canManage: false });
    expect((await (await w.call('GET', null, ADMIN)).json()).canManage).toBe(true);
  });

  it('is admin only: a member who can edit reads who can connect it, and cannot connect nor disconnect', async () => {
    const w = world();
    const r = await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, EDITOR);
    expect(r.status).toBe(403);
    expect((await r.json()).message).toBe(CLAUDE_WORDS.adminOnly);
    expect(w.calls.some((c) => c.url.includes('anthropic'))).toBe(false);
    await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN);
    expect((await w.call('POST', { action: 'disconnect', repo: 'acme/design' }, EDITOR)).status).toBe(403);
    expect((await (await w.call('GET', null, EDITOR)).json()).connected).toBe(true);
    expect((await (await w.call('POST', { action: 'disconnect', repo: 'acme/design' }, ADMIN)).json())).toEqual({ connected: false });
    expect((await (await w.call('GET', null, EDITOR)).json()).connected).toBe(false);
  });

  it('refuses a key Claude does not accept, and anything that is not a key, before storing', async () => {
    const w = world(() => 401);
    const r = await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN);
    expect(r.status).toBe(400);
    expect((await r.json()).message).toBe(CLAUDE_WORDS.keyRejected);
    const bad = await w.call('POST', { action: 'connect', repo: 'acme/design', key: 'hunter2' }, ADMIN);
    expect((await bad.json()).message).toBe(CLAUDE_WORDS.badKey);
    expect(w.redis.keys().filter((k) => k.startsWith('bridge:claude:key:'))).toEqual([]);
  });

  it('wrong team: a person of another team, a reader, or nobody signed in never reads nor writes', async () => {
    const w = world();
    await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN);
    // Admin of other/ds, nothing on acme/design.
    const other = bearer('ghu_other_team_token_00000');
    expect((await w.call('GET', null, other)).status).toBe(403);
    expect((await w.call('POST', { action: 'disconnect', repo: 'acme/design' }, other)).status).toBe(403);
    expect((await w.call('GET', null, bearer('ghu_reader_token_000000000'))).status).toBe(403);
    expect((await w.call('GET', null, {})).status).toBe(401);
    // A cookie call without the Studio header, or from another site, is refused before any session read.
    expect((await w.call('POST', { action: 'disconnect', repo: 'acme/design' }, { origin: 'https://evil.example', 'x-bridge-contribute': '1' })).status).toBe(403);
    expect((await (await w.call('GET', null, ADMIN)).json()).connected).toBe(true);
  });

  it('an email admin of the team connects from Studio; an email member who can edit cannot', async () => {
    const w = world();
    const members = memberStore(w.redis);
    for (const [email, role, name] of [['ann@acme.design', 'admin', 'Ann Leroy'], ['bo@acme.design', 'edit', 'Bo']] as const) {
      await putAccount(w.redis, { id: email, email, name, github: null, createdAt: '2026-10-01T00:00:00Z', version: 1 });
      await members.put('acme/design', { email, name, role, version: 1, addedBy: 'dana', at: '2026-10-01T00:00:00Z' });
    }
    const cookie = (email: string) => ({ cookie: `${ACCOUNT_COOKIE}=${signAccountSession({ email, v: 1, exp: NOW + 60_000 }, SESSION_SECRET)}`, 'x-bridge-contribute': '1', origin: `https://${HOST}` });
    const ok = await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, cookie('ann@acme.design'));
    expect(await ok.json()).toEqual({ connected: true, addedBy: 'Ann Leroy', at: '2026-10-25T10:00:00.000Z' });
    expect((await w.call('POST', { action: 'disconnect', repo: 'acme/design' }, cookie('bo@acme.design'))).status).toBe(403);
    // Ann is not on other/ds.
    expect((await w.call('GET', null, cookie('ann@acme.design'), '?repo=other/ds')).status).toBe(401);
  });

  it('says it is not set up when the site has no encryption secret, and stores nothing', async () => {
    const w = world();
    const r = await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN, '', { ...w.env, BRIDGE_SECRETS_KEY: undefined });
    expect(r.status).toBe(503);
    expect((await r.json()).message).toBe(CLAUDE_WORDS.notConfigured);
    const g = await w.call('GET', null, ADMIN, '?repo=acme/design', { ...w.env, BRIDGE_SECRETS_KEY: undefined });
    expect(await g.json()).toEqual({ available: false, connected: false, canManage: true });
    expect(w.redis.keys()).toEqual([]);
  });

  it('caps connect tries per team and hour', async () => {
    const w = world(() => 401);
    for (let i = 0; i < 10; i++) expect((await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN)).status).toBe(400);
    const r = await w.call('POST', { action: 'connect', repo: 'acme/design', key: FAKE_KEY }, ADMIN);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('3600');
  });

  it('opens CORS for GitHub token calls (the Figma plugin), never for cookie calls', async () => {
    const w = world();
    expect((await w.call('GET', null, EDITOR)).headers.get('access-control-allow-origin')).toBe('*');
    expect((await w.call('GET', null, {})).headers.get('access-control-allow-origin')).toBeNull();
  });
});
