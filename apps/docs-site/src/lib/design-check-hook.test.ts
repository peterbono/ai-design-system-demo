// The "Design check" from the GitHub webhook (api/contribute designCheckFor): every pull request of a product's
// developers gets it at once, so a required check never holds a change without design, and a linked one shows who is
// still waiting.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { saveBuild } from '../../api/_lib/build-check';
import { memberStore } from '../../api/_lib/members';
import { watchWrites } from '../../api/_lib/notify';
import { setPm } from '../../api/_lib/product-pm';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory } from '../../api/_lib/team-read';
import { handleContribute } from '../../api/contribute/index';
import { mentionedIssues } from '../../api/_lib/build-check';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-11-07T10:00:00Z');
const HOOK_SECRET = 'whsec-test-0123456789abcdef';
const ENV = { LIBRARY_SESSION_SECRET: 's'.repeat(40), GITHUB_WEBHOOK_SECRET: HOOK_SECRET };
const TEAM = 'acme/design';
const CODE = 'acme/shop';
const COPY = 'acme/shop-design';
const HEAD = 'c'.repeat(40);

function setup(o: { done?: boolean; watched?: boolean } = {}) {
  clearReadMemory();
  const redis = memoryRedis(() => T0);
  const statuses: { sha: string; state: string; description: string; context: string }[] = [];
  const block = { name: 'Late tag', memberName: 'Mia', ...(o.done === false ? {} : { doneAt: '2026-11-05T00:00:00Z' }) };
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const p = new URL(url).pathname;
    const m = init?.method ?? 'GET';
    if (p.endsWith('/bridge.config.json')) return new Response('{}', { status: 404 });
    if (m === 'GET' && p === `/repos/${CODE}/issues/7`) return Response.json({ number: 7, body: `Built from https://github.com/${COPY}/pull/5` });
    if (m === 'GET' && p === `/repos/${CODE}/issues/8`) return Response.json({ number: 8, body: 'A bug, no design.' });
    if (m === 'GET' && p === `/repos/${COPY}/pulls/5`) return Response.json({ number: 5, body: `x\n\n<!-- bridge-exploration ${JSON.stringify(block)} -->` });
    if (m === 'POST' && p.startsWith(`/repos/${CODE}/statuses/`)) {
      statuses.push({ sha: p.split('/').pop()!, ...JSON.parse(init!.body!) });
      return Response.json({}, { status: 201 });
    }
    return Response.json({});
  };
  const deps = { fetch, now: () => T0, redis, notifySender: null, app: { installationToken: async () => 'ghs_x' }, email: { send: async () => undefined } };
  let n = 0;
  const hook = (action: string, body: string, number = 30) => {
    const payload = JSON.stringify({ action, repository: { full_name: CODE }, sender: { login: 'lee', id: 7, type: 'User' }, pull_request: { number, title: 'x', body, state: 'open', draft: false, head: { sha: HEAD }, user: { login: 'lee', id: 7, type: 'User' } } });
    const headers = { host: HOST, 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-github-delivery': `d-${++n}`, 'x-hub-signature-256': `sha256=${createHmac('sha256', HOOK_SECRET).update(payload).digest('hex')}` };
    return handleContribute(new Request(`${ORIGIN}/api/contribute?hook=github`, { method: 'POST', headers, body: payload }), ENV, deps);
  };
  const ready = async () => {
    if (o.watched !== false) await redis.pipe(watchWrites([{ repo: TEAM, meta: { team: TEAM, kind: 'team' } }, { repo: CODE, meta: { team: TEAM, kind: 'code', product: 'shop' } }]));
    await memberStore(redis).put(TEAM, { email: 'dino@acme.design', name: 'Dino', role: 'view', version: 1, addedBy: 'dana', at: new Date(T0).toISOString() });
    await setPm(redis, TEAM, 'shop', { email: 'dino@acme.design', name: 'Dino' });
  };
  return { redis, statuses, hook, ready };
}

describe('the Design check from the webhook', () => {
  it('a change that names no explored design passes at once', async () => {
    const s = setup();
    await s.ready();
    await s.hook('opened', 'Fixes #8');
    expect(s.statuses).toEqual([{ sha: HEAD, state: 'success', description: 'No design to check', context: 'Design check' }]);
  });

  it('a change of a handed-off exploration waits for the people named, on each push', async () => {
    const s = setup();
    await s.ready();
    await s.hook('opened', 'Closes #7');
    expect(s.statuses.at(-1)).toMatchObject({ state: 'pending', description: 'Waiting for Mia and Dino' });
    // The designer said yes on this head: only the PM is left; a push asks again.
    await saveBuild(s.redis, CODE, 30, { pm: true, lead: false, names: { designer: 'Mia', pm: 'Dino' } }, { role: 'designer', kind: 'looks-right', sha: HEAD, byName: 'Mia', at: 'x' });
    await s.hook('synchronize', 'Closes #7');
    expect(s.statuses.at(-1)).toMatchObject({ state: 'pending', description: 'Waiting for Dino' });
    await s.hook('ready_for_review', 'Closes #7');
    expect(s.statuses).toHaveLength(3);
  });

  it('while the design changes, it holds', async () => {
    const s = setup({ done: false });
    await s.ready();
    await s.hook('reopened', 'Closes #7');
    expect(s.statuses.at(-1)).toMatchObject({ state: 'failure', description: 'The design is changing: wait for the new version' });
  });

  it('a repository Bridge does not watch, or another action: nothing written', async () => {
    const s = setup({ watched: false });
    await s.ready();
    await s.hook('opened', 'Closes #7');
    expect(s.statuses).toEqual([]);
    const t = setup();
    await t.ready();
    await t.hook('labeled', 'Closes #7');
    expect(t.statuses).toEqual([]);
  });

  it('reads the issues a description names', () => {
    expect(mentionedIssues('Closes #7, see #8 and https://github.com/acme/shop/issues/9 (not acme/other#3 nor &#39;)', CODE)).toEqual([7, 8, 9]);
  });
});
