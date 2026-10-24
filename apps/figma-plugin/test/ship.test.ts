import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armShip } from '../src/sync/ship';

const fake = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
  return { calls, f };
};

test('armShip: POST /api/ship with the GitHub token, the repo and the pull request', async () => {
  const { calls, f } = fake(200, { armed: true, route: 'shipped' });
  assert.deepEqual(await armShip('tok', 'o/r', 42, f, 'https://bridge.test'), { armed: true, route: 'shipped' });
  assert.equal(calls[0]!.url, 'https://bridge.test/api/ship');
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { repo: 'o/r', pr: 42 });
});

test('armShip: not armed keeps the code, the reason and when to ask again; an error says it', async () => {
  const pending = fake(200, { armed: false, route: 'waiting-for-developer', code: 'checks_pending', reason: 'Checks are running.', retryAfter: 60 });
  assert.deepEqual(await armShip('tok', 'o/r', 1, pending.f), { armed: false, route: 'waiting-for-developer', code: 'checks_pending', reason: 'Checks are running.', retryAfter: 60 });
  const denied = fake(403, { error: 'origin', message: 'This token cannot read o/r.' });
  await assert.rejects(armShip('tok', 'o/r', 1, denied.f), /This token cannot read o\/r\./);
});
