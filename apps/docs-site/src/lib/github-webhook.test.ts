// GitHub's webhook (api/_lib/github-webhook.ts, POST /api/github-webhook rewritten to /api/contribute?hook=github):
// the signature, replays, which event drops which cached topic, unknown repositories, and the fresh window of the read
// cache (api/_lib/team-read.ts) that grows while deliveries arrive and falls back to 30 seconds when they stop.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memberStore } from '../../api/_lib/members';
import { memoryRedis } from '../../api/_lib/redis';
import { deliveryKey, effectOf, MAX_HOOK_BYTES, signatureValid } from '../../api/_lib/github-webhook';
import { changedKey, clearReadMemory, FRESH_MS, freshFor, HOOK_FRESH_MS, HOOK_HEALTHY_MS, HOOK_LAST_KEY, knownKey, productsKey, SETTLE_MS, stillFresh, topicOf } from '../../api/_lib/team-read';
import { type ContribDeps, cookieName, type FetchLike, handleContribute, signSession } from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const SECRET = 's'.repeat(40);
const HOOK_SECRET = 'whsec-test-0123456789abcdef';
const TEAM = 'acme/design';
const P = `/repos/${TEAM}`;

const sign = (body: string, secret = HOOK_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

function setup(env: Record<string, string> = { GITHUB_WEBHOOK_SECRET: HOOK_SECRET }) {
  clearReadMemory();
  const calls: { path: string; inm: string | null }[] = [];
  let version = 1;
  const f: FetchLike = async (url, init) => {
    const u = new URL(url);
    const inm = init.headers['If-None-Match'] ?? null;
    calls.push({ path: u.pathname + u.search, inm });
    const etag = `"v${version}"`;
    if (inm === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return Response.json({ version, path: u.pathname }, { headers: { ETag: etag } });
  };
  let now = T0;
  const redis = memoryRedis(() => now);
  const deps: ContribDeps = { fetch: f, now: () => now, redis, app: { installationToken: async () => 'ghs_read' } };
  const allEnv = { LIBRARY_SESSION_SECRET: SECRET, ...env };
  const member = async () => {
    await memberStore(redis).put(TEAM, { email: 'mia@acme.design', name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at: new Date(now).toISOString() });
    return `${cookieName(TEAM)}=${signSession({ repo: TEAM, email: 'mia@acme.design', name: 'Mia', v: 1, exp: now + 1e9 }, SECRET)}`;
  };
  const read = (path: string, cookie: string) =>
    handleContribute(new Request(`${ORIGIN}/api/contribute?repo=${encodeURIComponent(TEAM)}&gh=${encodeURIComponent(path)}`, { headers: { host: HOST, 'x-real-ip': '203.0.113.9', cookie } }), allEnv, deps);
  let n = 0;
  const hook = (event: string, payload: unknown, o: { delivery?: string; signature?: string | null } = {}) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': o.delivery ?? `d-${++n}` };
    const sig = o.signature === undefined ? sign(body) : o.signature;
    if (sig !== null) headers['x-hub-signature-256'] = sig;
    // No Origin and no X-Bridge-Contribute: GitHub sends neither.
    return handleContribute(new Request(`${ORIGIN}/api/contribute?hook=github`, { method: 'POST', headers, body }), allEnv, deps);
  };
  const repo = (full = TEAM) => ({ full_name: full, default_branch: 'main' });
  return { calls, redis, read, hook, member, repo, tick: (ms: number) => (now += ms), bump: () => (version += 1), at: () => now };
}

describe('signature', () => {
  it('holds only for GitHub HMAC SHA-256 of the raw body with the secret', () => {
    const body = Buffer.from('{"zen":"Keep it logically awesome."}');
    expect(signatureValid(HOOK_SECRET, body, sign(body.toString()))).toBe(true);
    expect(signatureValid(HOOK_SECRET, body, sign(body.toString(), 'other-secret'))).toBe(false);
    expect(signatureValid(HOOK_SECRET, Buffer.from('{"zen":"changed"}'), sign(body.toString()))).toBe(false);
    expect(signatureValid(HOOK_SECRET, body, null)).toBe(false);
    expect(signatureValid(HOOK_SECRET, body, 'sha1=abc')).toBe(false);
    expect(signatureValid(HOOK_SECRET, body, 'sha256=xyz')).toBe(false);
    expect(signatureValid('', body, sign(body.toString(), ''))).toBe(false);
  });

  it('refuses unsigned and wrongly signed deliveries without writing anything', async () => {
    const s = setup();
    const before = s.redis.keys().length;
    expect((await s.hook('ping', { zen: 'x' }, { signature: null })).status).toBe(401);
    expect((await s.hook('ping', { zen: 'x' }, { signature: sign('{"zen":"y"}') })).status).toBe(401);
    expect(s.redis.keys().length).toBe(before);
    expect(await s.redis.cmd('GET', HOOK_LAST_KEY)).toBeNull();
  });

  it('answers 503 without a secret, 405 for another verb and 413 for a delivery too large', async () => {
    const off = setup({});
    expect((await off.hook('ping', {})).status).toBe(503);
    const s = setup();
    const get = await handleContribute(new Request(`${ORIGIN}/api/contribute?hook=github`, { headers: { host: HOST } }), { LIBRARY_SESSION_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: HOOK_SECRET }, { fetch: async () => new Response(), redis: memoryRedis() });
    expect(get.status).toBe(405);
    const big = await handleContribute(
      new Request(`${ORIGIN}/api/contribute?hook=github`, { method: 'POST', headers: { host: HOST, 'content-length': String(MAX_HOOK_BYTES + 1), 'x-github-event': 'push', 'x-github-delivery': 'd' }, body: '{}' }),
      { LIBRARY_SESSION_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: HOOK_SECRET },
      { fetch: async () => new Response(), redis: memoryRedis() },
    );
    expect(big.status).toBe(413);
    expect((await s.hook('ping', {})).status).toBe(200);
  });
});

describe('deliveries', () => {
  it('does a delivery once: the same X-GitHub-Delivery again does nothing', async () => {
    const s = setup();
    await s.redis.cmd('SET', knownKey(TEAM), '1');
    const first = await s.hook('pull_request', { action: 'opened', repository: s.repo() }, { delivery: 'abc-1' });
    expect(await first.json()).toMatchObject({ ok: true, repos: 1, topics: ['pulls', 'issues'] });
    expect(await s.redis.cmd('GET', deliveryKey('abc-1'))).toBe('1');
    const at = await s.redis.cmd('GET', changedKey(TEAM, 'pulls'));
    s.tick(1000);
    const again = await s.hook('pull_request', { action: 'opened', repository: s.repo() }, { delivery: 'abc-1' });
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await s.redis.cmd('GET', changedKey(TEAM, 'pulls'))).toBe(at);
  });

  it('ignores a repository Bridge keeps nothing of, but counts the delivery as a sign the webhook works', async () => {
    const s = setup();
    const res = await s.hook('push', { ref: 'refs/heads/main', repository: s.repo('someone/else') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(s.redis.keys().filter((k) => k.startsWith('bridge:read:changed:'))).toEqual([]);
    expect(await s.redis.cmd('GET', HOOK_LAST_KEY)).toBe(String(s.at()));
  });

  it('records the installation of each delivery', async () => {
    const s = setup();
    await s.hook('ping', { installation: { id: 42 } });
    expect(await s.redis.cmd('GET', 'bridge:read:hook:inst:42')).toBe(String(s.at()));
  });

  it('drops the product list of a team on a push to its default branch only', async () => {
    const s = setup();
    await s.redis.cmd('SET', knownKey(TEAM), '1');
    await s.redis.cmd('SET', productsKey(TEAM), '{"repos":[],"origins":[]}');
    await s.hook('push', { ref: 'refs/heads/feature', repository: s.repo() });
    expect(await s.redis.cmd('GET', productsKey(TEAM))).not.toBeNull();
    await s.hook('push', { ref: 'refs/heads/main', repository: s.repo() });
    expect(await s.redis.cmd('GET', productsKey(TEAM))).toBeNull();
  });
});

describe('event to topics', () => {
  it('drops only what an event changed', () => {
    const r = { repository: { full_name: 'Acme/Design', default_branch: 'main' } };
    expect(effectOf('check_run', r)).toEqual({ repos: ['acme/design'], topics: ['checks'], config: false });
    expect(effectOf('push', { ...r, ref: 'refs/heads/main' })).toEqual({ repos: ['acme/design'], topics: ['code', 'pulls'], config: true });
    expect(effectOf('pull_request_review', r).topics).toEqual(['pulls']);
    expect(effectOf('status', r).topics).toEqual(['checks', 'pulls']);
    expect(effectOf('deployment_status', r).topics).toEqual(['deployments']);
    expect(effectOf('issues', r).topics).toEqual(['issues']);
    expect(effectOf('issue_comment', r).topics).toEqual(['issues', 'pulls']);
    expect(effectOf('release', r).topics).toEqual(['releases', 'code']);
    expect(effectOf('repository', r).topics).toEqual(['code', 'pulls', 'issues', 'checks', 'deployments', 'releases']);
    expect(effectOf('installation_repositories', { repositories_added: [{ full_name: 'a/b' }], repositories_removed: [{ full_name: 'c/d' }, { full_name: '../x' }] }).repos).toEqual(['a/b', 'c/d']);
    expect(effectOf('ping', r)).toEqual({ repos: [], topics: [], config: false });
    expect(effectOf('star', r).repos).toEqual([]);
  });

  it('reads each path under its topic, and paths no webhook covers under none', () => {
    expect(topicOf([])).toBe('code');
    expect(topicOf(['contents', 'tokens', 'a.json'])).toBe('code');
    expect(topicOf(['commits'])).toBe('code');
    expect(topicOf(['commits', 'a'.repeat(40), 'check-runs'])).toBe('checks');
    expect(topicOf(['commits', 'a'.repeat(40), 'status'])).toBe('checks');
    expect(topicOf(['pulls', '3', 'files'])).toBe('pulls');
    expect(topicOf(['labels'])).toBe('issues');
    expect(topicOf(['actions', 'runs', '9'])).toBe('checks');
    expect(topicOf(['deployments', '1', 'statuses'])).toBe('deployments');
    expect(topicOf(['releases', 'latest'])).toBe('releases');
    expect(topicOf(['rulesets'])).toBeNull();
    expect(topicOf(['collaborators'])).toBeNull();
  });
});

describe('fresh window', () => {
  it('is long only while deliveries arrive and the topic is covered', () => {
    expect(freshFor('pulls', 0, T0)).toBe(FRESH_MS);
    expect(freshFor('pulls', T0 - 1000, T0)).toBe(HOOK_FRESH_MS);
    expect(freshFor('pulls', T0 - HOOK_HEALTHY_MS, T0)).toBe(FRESH_MS);
    expect(freshFor(null, T0, T0)).toBe(FRESH_MS);
    // Kept before a change, or in the moment after it: asked again.
    expect(stillFresh(T0, T0 + 1000, HOOK_FRESH_MS, 0, T0 + 500)).toBe(false);
    expect(stillFresh(T0 + 1000, T0 + 2000, HOOK_FRESH_MS, 0, T0)).toBe(false);
    expect(stillFresh(T0 + SETTLE_MS, T0 + SETTLE_MS + 1000, HOOK_FRESH_MS, 0, T0)).toBe(true);
  });

  it('keeps answers 10 minutes while the webhook works, drops the topic an event names, and falls back to 30 seconds', async () => {
    const s = setup();
    const cookie = await s.member();
    const pulls = `${P}/pulls`;
    const contents = `${P}/contents/tokens.json`;
    const upstream = (path: string) => s.calls.filter((c) => c.path === path).length;

    // No delivery yet: 30 seconds, as before.
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('miss');
    await s.read(contents, cookie);
    s.tick(FRESH_MS + 1000);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('revalidated');
    expect(await s.redis.cmd('GET', knownKey(TEAM))).toBe('1');

    // A delivery arrives (any event): answers stay fresh for minutes.
    await s.hook('ping', { zen: 'hi' });
    s.tick(SETTLE_MS);
    await s.read(contents, cookie);
    s.tick(5 * 60 * 1000);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('hit');
    expect((await s.read(contents, cookie)).headers.get('X-Bridge-Cache')).toBe('hit');

    // A check run: the files stay, a pull request change drops the pulls only.
    await s.hook('check_run', { action: 'completed', repository: s.repo() });
    expect((await s.read(contents, cookie)).headers.get('X-Bridge-Cache')).toBe('hit');
    const before = upstream(pulls);
    await s.hook('pull_request', { action: 'synchronize', repository: s.repo() });
    s.bump();
    const changed = await s.read(pulls, cookie);
    expect(changed.headers.get('X-Bridge-Cache')).toBe('miss');
    expect(await changed.json()).toMatchObject({ version: 2 });
    expect(upstream(pulls)).toBe(before + 1);
    expect(s.calls.at(-1)!.inm).toBe('"v1"');
    expect((await s.read(contents, cookie)).headers.get('X-Bridge-Cache')).toBe('hit');

    // Within the settle moment GitHub is asked again (a 304 is free); after it, the answer is fresh again.
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('revalidated');
    s.tick(SETTLE_MS);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('revalidated');
    s.tick(1000);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('hit');

    // No delivery for HOOK_HEALTHY_MS: back to 30 seconds.
    s.tick(HOOK_HEALTHY_MS);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('revalidated');
    s.tick(FRESH_MS - 1000);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('hit');
    s.tick(2000);
    expect((await s.read(pulls, cookie)).headers.get('X-Bridge-Cache')).toBe('revalidated');
  });

  it('keeps paths no webhook covers fresh 30 seconds even while deliveries arrive', async () => {
    const s = setup();
    const cookie = await s.member();
    await s.hook('ping', {});
    await s.read(`${P}/rulesets`, cookie);
    s.tick(FRESH_MS + 1000);
    expect((await s.read(`${P}/rulesets`, cookie)).headers.get('X-Bridge-Cache')).toBe('revalidated');
  });
});
