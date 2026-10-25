// "Sign in with Bridge", the plugin side: start a code, open only this site's Studio page, poll until approved, once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BridgeSignInPoller, type LinkPoll, SIGN_IN_WORDS, pollBridgeSignIn, startBridgeSignIn } from '../src/sync/bridge-sign-in';

const ORIGIN = 'https://bridge.example.com';
const START = { code: 'ABCDEFGH23', secret: 's'.repeat(43), url: `${ORIGIN}/studio/connect-figma/?code=ABCDEFGH23`, expiresIn: 300, interval: 3 };
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

test('start: a code, its secret and the Studio page of this site only', async () => {
  const calls: { url: string; body: string }[] = [];
  const f = async (url: string, init: { body: string }) => (calls.push({ url, body: init.body }), answer(200, START));
  assert.deepEqual(await startBridgeSignIn(f, ORIGIN), START);
  assert.equal(calls[0]!.url, `${ORIGIN}/api/plugin-link`);
  assert.deepEqual(JSON.parse(calls[0]!.body), { action: 'start' });
  await assert.rejects(startBridgeSignIn(async () => answer(200, { ...START, url: 'https://evil.example/x' }), ORIGIN), { message: SIGN_IN_WORDS.unreachable });
  await assert.rejects(startBridgeSignIn(async () => answer(503, {}), ORIGIN), { message: SIGN_IN_WORDS.notSetUp });
  await assert.rejects(startBridgeSignIn(async () => { throw new TypeError('Failed to fetch'); }, ORIGIN), { message: SIGN_IN_WORDS.unreachable });
});

test('poll: pending, approved with the repository and default branch, or gone', async () => {
  assert.deepEqual(await pollBridgeSignIn(async () => answer(200, { status: 'pending' }), ORIGIN, START), { status: 'pending' });
  const ok = await pollBridgeSignIn(async () => answer(200, { status: 'approved', repo: 'acme/ds', name: 'Acme DS', token: 'ghu_x', expiresAt: 1, login: 'ana', defaultBranch: 'trunk' }), ORIGIN, START);
  assert.deepEqual(ok, { status: 'approved', repo: 'acme/ds', name: 'Acme DS', token: 'ghu_x', expiresAt: 1, login: 'ana', defaultBranch: 'trunk' });
  assert.deepEqual(await pollBridgeSignIn(async () => answer(410, {}), ORIGIN, START), { status: 'expired', message: SIGN_IN_WORDS.expired });
});

test('the poller waits through pending and a network blip, stops once approved, and gives up when the code expires', async () => {
  let t = 0;
  const queue: (() => Promise<ReturnType<typeof answer>>)[] = [async () => answer(200, { status: 'pending' }), async () => { throw new TypeError('offline'); }, async () => answer(200, { status: 'approved', repo: 'acme/ds', token: 'ghu_x' })];
  let polls = 0;
  const f = async () => (polls++, queue.shift()!());
  const ticks: (() => void)[] = [];
  const results: LinkPoll[] = [];
  new BridgeSignInPoller(f, ORIGIN, START, (p) => results.push(p), () => t, (fn) => (ticks.push(fn), 0 as unknown as ReturnType<typeof setTimeout>)).start();
  for (let i = 0; i < 3; i++) {
    t += 3000;
    ticks.shift()!();
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(polls, 3);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.status, 'approved');
  assert.equal(ticks.length, 0, 'no poll after the answer');

  const late: LinkPoll[] = [];
  const t2 = { v: 0 };
  const ticks2: (() => void)[] = [];
  new BridgeSignInPoller(async () => answer(200, { status: 'pending' }), ORIGIN, START, (p) => late.push(p), () => t2.v, (fn) => (ticks2.push(fn), 0 as unknown as ReturnType<typeof setTimeout>)).start();
  t2.v = 301_000;
  ticks2.shift()!();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(late, [{ status: 'expired', message: SIGN_IN_WORDS.expired }]);
});
