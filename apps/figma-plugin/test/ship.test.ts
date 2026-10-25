import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armShip, figmaShipper, markFigmaPush } from '../src/sync/ship';

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

test('markFigmaPush: asks Bridge to record the push with the GitHub token; a refusal keeps its code', async () => {
  const { calls, f } = fake(200, { marked: true });
  assert.deepEqual(await markFigmaPush('tok', 'o/r', 42, f, 'https://bridge.test'), { marked: true });
  assert.equal(calls[0]!.url, 'https://bridge.test/api/ship');
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { repo: 'o/r', pr: 42, mark: 'figma' });
  const refused = fake(200, { marked: false, code: 'no_write', reason: 'x' });
  assert.deepEqual(await markFigmaPush('tok', 'o/r', 42, refused.f), { marked: false, code: 'no_write' });
  const down = fake(502, { error: 'unreachable', message: 'GitHub did not answer.' });
  await assert.rejects(markFigmaPush('tok', 'o/r', 42, down.f), /GitHub did not answer/);
});

test('figmaShipper: records each push once before arming it, and asks again only when Bridge could not be reached', async () => {
  const calls: { pr: number; mark: boolean }[] = [];
  let down = true;
  const f = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    calls.push({ pr: b.pr, mark: b.mark === 'figma' });
    if (b.mark && b.pr === 1 && down) return new Response('{}', { status: 502 });
    return new Response(JSON.stringify(b.mark ? { marked: b.pr !== 2, code: 'not_author' } : { armed: true, route: 'shipped' }), { status: 200 });
  }) as unknown as typeof fetch;
  const arm = figmaShipper('tok', 'o/r', f, 'https://bridge.test');
  assert.deepEqual(await arm(1), { armed: true, route: 'shipped' });
  down = false;
  await arm(1);
  await arm(1);
  await arm(2);
  await arm(2);
  // pr 1: mark failed (502), marked on the next try, then only armed; pr 2: refused once, never asked again.
  assert.deepEqual(calls, [
    { pr: 1, mark: true }, { pr: 1, mark: false },
    { pr: 1, mark: true }, { pr: 1, mark: false },
    { pr: 1, mark: false },
    { pr: 2, mark: true }, { pr: 2, mark: false },
    { pr: 2, mark: false },
  ]);
});

test('armShip: the network failing reads as a sentence, not "Failed to fetch"', async () => {
  const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  await assert.rejects(armShip('tok', 'o/r', 1, offline), /^Error: Bridge could not be reached, so a developer adds it to the library\.$/);
});
