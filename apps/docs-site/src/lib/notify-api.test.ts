// Notifications end to end through the functions: a signed GitHub delivery to /api/contribute?hook=github becomes an
// email for the member (once per delivery), Studio's ?mine=1 watches the team, and /api/account keeps the choices
// (action notify), the time zone at sign-in, the one-click unsubscribe and the daily summary cron.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getAccount, putAccount } from '../../api/_lib/account';
import type { EmailMessage } from '../../api/_lib/email';
import { issueKey } from '../../api/_lib/former-member';
import { memberStore } from '../../api/_lib/members';
import { unsubToken } from '../../api/_lib/notify-mail';
import { DUE_KEY, digestKey, itemWrite, NOTIFY_TEAMS_KEY, watchWrites } from '../../api/_lib/notify';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory } from '../../api/_lib/team-read';
import { handleAccount } from '../../api/account/index';
import { cookieName, handleContribute, signSession } from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const SECRET = 's'.repeat(40);
const HOOK_SECRET = 'whsec-test-0123456789abcdef';
const TEAM = 'acme/design';
const CODE = 'acme/shop';
const COPY = 'acme/shop-design';
const MIA = 'mia@acme.design';
const ENV = { LIBRARY_SESSION_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: HOOK_SECRET, CRON_SECRET: 'cron-secret-123' };

function setup() {
  clearReadMemory();
  let now = T0;
  const redis = memoryRedis(() => now);
  const sent: EmailMessage[] = [];
  const notifySender = { send: async (m: EmailMessage) => void sent.push(m) };
  const fetch = async (url: string) => (new URL(url).pathname.endsWith('/bridge.config.json') ? new Response('{}', { status: 404 }) : Response.json({}));
  const deps = { fetch, now: () => now, redis, notifySender, app: { installationToken: async () => 'ghs_x' }, code: () => '123456', email: { send: async () => undefined } };
  let n = 0;
  const hook = (event: string, payload: unknown, o: { delivery?: string; signature?: string } = {}) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      host: HOST,
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': o.delivery ?? `d-${++n}`,
      'x-hub-signature-256': o.signature ?? `sha256=${createHmac('sha256', HOOK_SECRET).update(body).digest('hex')}`,
    };
    return handleContribute(new Request(`${ORIGIN}/api/contribute?hook=github`, { method: 'POST', headers, body }), ENV, deps);
  };
  const member = () => memberStore(redis).put(TEAM, { email: MIA, name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at: new Date(now).toISOString() });
  const watched = () =>
    redis.pipe([
      ...watchWrites([
        { repo: TEAM, meta: { team: TEAM, kind: 'team' } },
        { repo: CODE, meta: { team: TEAM, kind: 'code', product: 'shop' } },
      ]),
      ['SET', issueKey(CODE, 12), MIA],
      itemWrite(CODE, 12, { title: 'Pill buttons', copy: { repo: COPY, number: 7 } }),
    ]);
  return { redis, sent, deps, hook, member, watched, tick: (ms: number) => (now += ms) };
}

const comment = {
  action: 'created',
  repository: { full_name: 'acme/shop' },
  sender: { login: 'ana', id: 42, type: 'User' },
  issue: { number: 12, title: 'Design: Pill buttons', body: '' },
  comment: { user: { login: 'ana', id: 42, type: 'User' }, body: 'Which radius do you want?' },
};

describe('the webhook turns a signed delivery into a notification', () => {
  it('a developer question on a watched task: one email to the member, once per delivery id', async () => {
    const s = setup();
    await s.member();
    await s.watched();
    const r = await s.hook('issue_comment', comment, { delivery: 'abc-1' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, notices: 1 });
    expect(s.sent.map((m) => [m.to, m.subject])).toEqual([[MIA, 'ana has a question about Pill buttons']]);
    // The comment itself is never kept or sent: the email links to Bridge.
    expect(JSON.stringify(s.sent) + s.redis.keys().join(' ')).not.toContain('Which radius');
    expect(await (await s.hook('issue_comment', comment, { delivery: 'abc-1' })).json()).toEqual({ ok: true, duplicate: true });
    expect(s.sent).toHaveLength(1);
  });
  it('unsigned or unwatched: nothing', async () => {
    const s = setup();
    await s.member();
    expect((await s.hook('issue_comment', comment, { signature: 'sha256=' + '0'.repeat(64) })).status).toBe(401);
    expect(await (await s.hook('issue_comment', comment)).json()).toEqual({ ok: true, ignored: true });
    expect(s.sent).toEqual([]);
  });
  it('news is kept, and a later delivery sends the summary once it is due', async () => {
    const s = setup();
    await s.member();
    await s.watched();
    await s.hook('issues', { action: 'closed', repository: { full_name: CODE }, sender: { login: 'ana', id: 42, type: 'User' }, issue: { number: 12, title: 'Design: Pill buttons', state_reason: 'completed' } });
    expect(s.sent).toEqual([]);
    expect(await s.redis.cmd('ZRANGE', digestKey(MIA), 0, -1)).toHaveLength(1);
    s.tick(24 * 60 * 60 * 1000);
    await s.hook('ping', { zen: 'Keep it logically awesome.' });
    expect(s.sent.map((m) => m.subject)).toEqual(['1 thing moved on Design']);
  });
  it('Studio ?mine=1 of a member who joined by email watches the team (no read-cache expiry)', async () => {
    const s = setup();
    await s.member();
    const cookie = `${cookieName(TEAM)}=${signSession({ repo: TEAM, email: MIA, name: 'Mia', v: 1, exp: T0 + 1e9 }, SECRET)}`;
    const r = await handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&mine=1`, { headers: { host: HOST, cookie } }), ENV, s.deps);
    expect(r.status).toBe(200);
    expect(await s.redis.cmd('SMEMBERS', NOTIFY_TEAMS_KEY)).toEqual([TEAM]);
    expect(JSON.parse((await s.redis.cmd('GET', `bridge:notify:repo:${TEAM}`)) as string)).toEqual({ team: TEAM, kind: 'team' });
  });
});

const H = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-bridge-account': '1', 'sec-fetch-site': 'same-origin' };
const act = (body: unknown, cookie = '') => new Request(`${ORIGIN}/api/account`, { method: 'POST', headers: { ...H, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

async function signIn(s: ReturnType<typeof setup>, tz?: string) {
  await handleAccount(act({ action: 'code', email: MIA }), ENV, s.deps);
  const r = await handleAccount(act({ action: 'verify', email: MIA, code: '123456', name: 'Mia', ...(tz ? { tz } : {}) }), ENV, s.deps);
  expect(r.status).toBe(200);
  return (r.headers.get('set-cookie') ?? '').split(';')[0]!;
}

describe('/api/account: choices, time zone, unsubscribe, the daily cron', () => {
  it('keeps the time zone once at sign-in, and the email choices (only the ones offered)', async () => {
    const s = setup();
    const cookie = await signIn(s, 'America/New_York');
    expect((await getAccount(s.redis, MIA))!.tz).toBe('America/New_York');
    await signIn(s, 'Asia/Tokyo');
    expect((await getAccount(s.redis, MIA))!.tz).toBe('America/New_York');
    const r = await handleAccount(act({ action: 'notify', needs: 'daily' }, cookie), ENV, s.deps);
    expect((await r.json()).account.notify).toEqual({ needs: 'daily', news: 'daily' });
    expect((await handleAccount(act({ action: 'notify', news: 'soon' }, cookie), ENV, s.deps)).status).toBe(400);
    expect((await handleAccount(act({ action: 'notify', needs: 'off' }), ENV, s.deps)).status).toBe(401);
  });
  it('one-click unsubscribe: GET asks with one button, POST stops it, no sign-in, never the address on the page', async () => {
    const s = setup();
    await signIn(s);
    const token = unsubToken(SECRET, MIA, 'needs')!;
    const url = `${ORIGIN}/api/account?unsub=${encodeURIComponent(token)}`;
    const page = await handleAccount(new Request(url, { headers: { host: HOST } }), ENV, s.deps);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('<form method="post"');
    expect(html).not.toContain(MIA);
    expect((await getAccount(s.redis, MIA))!.notify).toBeUndefined();
    const post = await handleAccount(new Request(url, { method: 'POST', headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }), ENV, s.deps);
    expect(post.status).toBe(200);
    expect((await getAccount(s.redis, MIA))!.notify).toEqual({ needs: 'off', news: 'daily' });
    expect((await handleAccount(new Request(`${ORIGIN}/api/account?unsub=bad.token.x`, { method: 'POST', headers: { host: HOST } }), ENV, s.deps)).status).toBe(400);
  });
  it('unsubscribe with no Bridge account is kept too', async () => {
    const s = setup();
    const url = `${ORIGIN}/api/account?unsub=${encodeURIComponent(unsubToken(SECRET, MIA, 'all')!)}`;
    await handleAccount(new Request(url, { method: 'POST', headers: { host: HOST } }), ENV, s.deps);
    expect(JSON.parse((await s.redis.cmd('GET', `bridge:notify:off:${MIA}`)) as string)).toEqual({ needs: 'off', news: 'off' });
  });
  it('the daily cron: Bearer CRON_SECRET only, sends what is due', async () => {
    const s = setup();
    await s.member();
    await s.watched();
    await putAccount(s.redis, { id: 'a', email: MIA, name: 'Mia', github: null, createdAt: '', version: 1, tz: 'Europe/Paris' });
    await s.hook('issues', { action: 'closed', repository: { full_name: CODE }, sender: { login: 'ana', id: 42, type: 'User' }, issue: { number: 12, title: 'Design: Pill buttons', state_reason: 'not_planned' } });
    const cron = (auth?: string) => handleAccount(new Request(`${ORIGIN}/api/account?digest=1`, { headers: { host: HOST, ...(auth ? { authorization: auth } : {}) } }), ENV, s.deps);
    expect((await cron()).status).toBe(401);
    expect(await (await cron('Bearer cron-secret-123')).json()).toEqual({ ok: true, sent: 0, empty: 0, later: 0 });
    s.tick(23 * 60 * 60 * 1000);
    expect(await (await cron('Bearer cron-secret-123')).json()).toEqual({ ok: true, sent: 1, empty: 0, later: 0 });
    expect(s.sent.map((m) => m.subject)).toEqual(['1 thing moved on Design']);
    expect(s.sent[0]!.text).toContain('Pill buttons will not be built for now');
    expect(await s.redis.cmd('ZRANGE', DUE_KEY, 0, -1)).toEqual([]);
  });
  it('deleting the account forgets the kept notifications', async () => {
    const s = setup();
    const cookie = await signIn(s);
    await s.redis.pipe([
      ['ZADD', digestKey(MIA), 1, '{"id":"x"}'],
      ['ZADD', DUE_KEY, 1, MIA],
    ]);
    expect((await handleAccount(act({ action: 'delete' }, cookie), ENV, s.deps)).status).toBe(200);
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:notify:digest:'))).toEqual([]);
    expect(await s.redis.cmd('ZRANGE', DUE_KEY, 0, -1)).toEqual([]);
  });
});
