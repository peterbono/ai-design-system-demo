// The product manager and the design lead hear about the developers' build (board R4), end to end through a signed
// GitHub delivery: the build ready to check right away for the PM, and once it shipped, in the PM's and the validating
// lead's daily summaries (api/_lib/github-webhook pmCopies, leadOf).
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../api/_lib/email';
import { issueKey } from '../../api/_lib/former-member';
import { memberStore } from '../../api/_lib/members';
import { digestKey, itemWrite, watchWrites } from '../../api/_lib/notify';
import { setPm } from '../../api/_lib/product-pm';
import { memoryRedis } from '../../api/_lib/redis';
import { clearReadMemory } from '../../api/_lib/team-read';
import { handleContribute } from '../../api/contribute/index';

const HOST = 'bridge.example.com';
const ORIGIN = `https://${HOST}`;
const T0 = Date.parse('2026-11-07T10:00:00Z');
const SECRET = 's'.repeat(40);
const HOOK_SECRET = 'whsec-test-0123456789abcdef';
const TEAM = 'acme/design';
const CODE = 'acme/shop';
const COPY = 'acme/shop-design';
const ENV = { LIBRARY_SESSION_SECRET: SECRET, GITHUB_WEBHOOK_SECRET: HOOK_SECRET };
const MIA = 'mia@acme.design';
const DINO = 'dino@acme.design';
const FLO = 'flo@acme.design';

function setup(o: { pm?: boolean } = {}) {
  clearReadMemory();
  const redis = memoryRedis(() => T0);
  const sent: EmailMessage[] = [];
  const block = { name: 'Pill buttons', startedAt: '2026-11-01T00:00:00Z', doneAt: '2026-11-03T00:00:00Z', decisions: [{ kind: 'looks-right', at: '2026-11-03T00:00:00Z', round: 1, byName: 'Flo' }] };
  const fetch = async (url: string) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/bridge.config.json')) return new Response('{}', { status: 404 });
    if (p === `/repos/${COPY}/pulls/7`) return Response.json({ number: 7, body: `x\n\n<!-- bridge-exploration ${JSON.stringify(block)} -->` });
    return Response.json({});
  };
  const deps = { fetch, now: () => T0, redis, notifySender: { send: async (m: EmailMessage) => void sent.push(m) }, app: { installationToken: async () => 'ghs_x' }, email: { send: async () => undefined } };
  let n = 0;
  const hook = (event: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    const headers = { host: HOST, 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': `d-${++n}`, 'x-hub-signature-256': `sha256=${createHmac('sha256', HOOK_SECRET).update(body).digest('hex')}` };
    return handleContribute(new Request(`${ORIGIN}/api/contribute?hook=github`, { method: 'POST', headers, body }), ENV, deps);
  };
  const ready = async () => {
    const members = memberStore(redis);
    const at = new Date(T0).toISOString();
    await members.put(TEAM, { email: MIA, name: 'Mia', role: 'edit', version: 1, addedBy: 'dana', at });
    await members.put(TEAM, { email: DINO, name: 'Dino', role: 'view', version: 1, addedBy: 'dana', at });
    await members.put(TEAM, { email: FLO, name: 'Flo', role: 'edit', lead: true, version: 1, addedBy: 'dana', at });
    if (o.pm !== false) await setPm(redis, TEAM, 'shop', { email: DINO, name: 'Dino' });
    await redis.pipe([
      ...watchWrites([
        { repo: TEAM, meta: { team: TEAM, kind: 'team' } },
        { repo: CODE, meta: { team: TEAM, kind: 'code', product: 'shop' } },
        { repo: COPY, meta: { team: TEAM, kind: 'copy', product: 'shop' } },
      ]),
      ['SET', issueKey(CODE, 12), MIA],
      itemWrite(CODE, 12, { title: 'Pill buttons', copy: { repo: COPY, number: 7 } }),
    ]);
  };
  return { redis, sent, hook, ready };
}

const pr = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  repository: { full_name: CODE },
  sender: { login: 'lee', id: 7, type: 'User' },
  pull_request: { number: 30, title: 'Pill buttons', body: 'Closes #12', draft: false, user: { login: 'lee', id: 7, type: 'User' }, ...extra },
});

describe('the PM and the lead hear about the build', () => {
  it('the build ready to check: the designer and the PM, right away, the PM linked to the exploration', async () => {
    const s = setup();
    await s.ready();
    await s.hook('pull_request', pr('opened'));
    expect(s.sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      [DINO, 'Pill buttons is built: check it'],
      [MIA, 'Pill buttons is ready for your look'],
    ]);
    expect(s.sent.find((m) => m.to === DINO)!.html).toContain('changes/?exploration=7&amp;product=shop');
    // Once per task: the same build marked ready again tells the PM nothing new.
    await s.hook('pull_request', pr('ready_for_review'));
    expect(s.sent.filter((m) => m.to === DINO)).toHaveLength(1);
  });

  it('shipped: in the daily summary of the PM and of the lead who validated it, never sent right away', async () => {
    const s = setup();
    await s.ready();
    await s.hook('pull_request', pr('closed', { merged: true }));
    expect(s.sent).toEqual([]);
    expect(await s.redis.cmd('ZRANGE', digestKey(DINO), 0, -1)).toHaveLength(1);
    expect(await s.redis.cmd('ZRANGE', digestKey(FLO), 0, -1)).toHaveLength(1);
  });

  it('no PM on the product: the lead still hears it shipped, nobody else is added', async () => {
    const s = setup({ pm: false });
    await s.ready();
    await s.hook('pull_request', pr('opened'));
    expect(s.sent.map((m) => m.to)).toEqual([MIA]);
    await s.hook('pull_request', pr('closed', { merged: true }));
    expect(await s.redis.cmd('ZRANGE', digestKey(FLO), 0, -1)).toHaveLength(1);
    expect(await s.redis.cmd('ZRANGE', digestKey(DINO), 0, -1)).toHaveLength(0);
  });
});
