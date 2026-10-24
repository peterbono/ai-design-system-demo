import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRoutes, libraryHeadline, routedItems, ShipPoller, shipSettled, shipStateLabel, shippedNumbers, waitingLede, type RoutedItem, type ShipStatus } from '../src/sync/library-routes';

const token = (label: string, number: number): RoutedItem => ({ label, kind: 'token', route: 'shipped', number, url: `https://github.com/o/r/pull/${number}` });
const rename: RoutedItem = { label: 'color.bg.subtle', kind: 'token', route: 'waiting-for-developer', number: 12, url: 'https://github.com/o/r/pull/12', waitingFor: 'rename' };
const build: RoutedItem = { label: 'Avatar', kind: 'component', route: 'build-request', number: 40, url: 'https://github.com/o/r/issues/40' };
const onItsWay: ShipStatus = { key: 'on-its-way', label: 'On its way to the library', final: false };
const inLibrary: ShipStatus = { key: 'in-the-library', label: 'In the library', final: true };
const held: ShipStatus = { key: 'held', label: 'Held for a developer', final: true };

test('routedItems: core outcomes as screen rows, with why they wait', () => {
  assert.deepEqual(
    routedItems([
      { subject: { type: 'token', name: 'button.primary.bg' }, route: 'waiting-for-developer', ref: { kind: 'pull', number: 7, url: 'u7' }, waitingFor: 'not-armed' },
      { subject: { type: 'component', name: 'Avatar' }, route: 'build-request', ref: { kind: 'issue', number: 40, url: 'u40' } },
    ]),
    [
      { label: 'button.primary.bg', kind: 'token', route: 'waiting-for-developer', number: 7, url: 'u7', waitingFor: 'not-armed' },
      { label: 'Avatar', kind: 'component', route: 'build-request', number: 40, url: 'u40' },
    ],
  );
});

test('token values only: sent to the library, then in the library once merged', () => {
  const g = groupRoutes([token('button.primary.bg', 7), token('button.primary.fg', 7)]);
  assert.deepEqual(shippedNumbers(g), [7], 'two tokens in one pull request are polled once');
  assert.deepEqual(libraryHeadline(g, new Map()), { title: 'Sent to the library', text: '2 token changes on their way: they ship by themselves once the automatic checks pass.' });
  const merged = new Map([[7, inLibrary]]);
  assert.deepEqual(libraryHeadline(g, merged), { title: 'In the library', text: '2 token changes are in the library. Storybook shows them after the next deploy.' });
  assert.equal(shipSettled(g, merged), true);
  assert.equal(shipSettled(g, new Map([[7, onItsWay]])), false);
});

test('held: never the technical reason, nothing to do for the designer', () => {
  const g = groupRoutes([token('badge.radius', 9)]);
  const h = libraryHeadline(g, new Map([[9, held]]));
  assert.equal(h.title, 'Held for a developer');
  assert.equal(h.text, '1 token change: held for a developer, nothing to do on your side.');
  assert.equal(shipStateLabel(held), 'Held for a developer');
  assert.equal(shipStateLabel(undefined), 'On its way to the library');
});

test('structure only: build request sent to developers', () => {
  assert.deepEqual(libraryHeadline(groupRoutes([build]), new Map()), {
    title: 'Build request sent to developers',
    text: '1 build request sent: developers build it from what you sent, follow it in Being built.',
  });
});

test('waiting: a rename says why, a merge Bridge could not arm says so, mixed sends say each route', () => {
  assert.deepEqual(libraryHeadline(groupRoutes([rename]), new Map()), { title: 'Waiting for a developer', text: '1 change waits for a developer.' });
  assert.match(waitingLede([rename]), /renamed or removed token can break product code/);
  const notArmed: RoutedItem = { ...token('avatar.bg', 3), route: 'waiting-for-developer', waitingFor: 'not-armed' };
  assert.equal(waitingLede([notArmed]), 'Bridge could not ship it by itself, so a developer adds it to the library. The row says why.');
  assert.match(waitingLede([rename, notArmed]), /break product code.*Bridge could not ship the others by itself; each row says why\.$/);
  const mixed = libraryHeadline(groupRoutes([token('avatar.bg', 3), rename, build]), new Map());
  assert.equal(mixed.title, 'Sent');
  assert.match(mixed.text, /^1 token change on its way: it ships by itself once the automatic checks pass\. 1 change waits for a developer\. 1 build request sent/);
});

test('ShipPoller: polls until every pull request is final, then stops', async () => {
  const answers: Record<number, ShipStatus[]> = { 3: [onItsWay, inLibrary], 4: [held] };
  const asked: number[] = [];
  const updates: Map<number, ShipStatus>[] = [];
  const p = new ShipPoller({ poll: async (n) => (asked.push(n), answers[n]!.shift()!), numbers: [3, 4], onUpdate: (s) => updates.push(s), onTimeout: () => assert.fail('no timeout'), setTimer: () => 1, clearTimer: () => {} });
  p.start();
  assert.equal(await p.check(), false, 'one still on its way');
  assert.equal(await p.check(), true);
  assert.deepEqual(asked, [3, 4, 3], 'a final pull request is not read again');
  assert.equal(updates.at(-1)!.get(3)!.key, 'in-the-library');
  assert.equal(p.active, false);
});

test('ShipPoller: 15 minutes on its way stops polling and says so', async () => {
  let now = 0;
  let timedOut = false;
  let fire: (() => void) | undefined;
  const p = new ShipPoller({ poll: async () => onItsWay, numbers: [5], onUpdate: () => {}, onTimeout: () => (timedOut = true), now: () => now, setTimer: (fn) => ((fire = fn), 1), clearTimer: () => {} });
  p.start();
  now = 15 * 60_000;
  fire!();
  await new Promise((r) => setImmediate(r));
  assert.equal(timedOut, true);
  assert.equal(p.active, false);
});

test('arming: checks running retry later, armed then read until in the library, a refusal waits with its reason', async () => {
  const { armStatus, effectiveItems, toArm } = await import('../src/sync/library-routes');
  const notArmed = (label: string, number: number): RoutedItem => ({ label, kind: 'token', route: 'waiting-for-developer', number, url: `u${number}`, waitingFor: 'not-armed' });
  const items = [notArmed('color.bg.subtle', 7), notArmed('color.bg.muted', 7), notArmed('radius.md', 8), rename];
  assert.deepEqual(toArm(items), [7, 8], 'one ask per pull request, never a rename');
  assert.deepEqual(armStatus({ armed: false, route: 'waiting-for-developer', code: 'checks_pending', reason: 'r', retryAfter: 60 }), { status: { key: 'arming', label: 'Getting ready to ship: the checks are running', final: false }, retryInMs: 60_000 });
  assert.equal(armStatus({ armed: true, route: 'shipped', merged: true }).status.key, 'in-the-library');

  let now = 0;
  const answers: Record<number, unknown[]> = {
    7: [{ armed: false, route: 'waiting-for-developer', code: 'checks_pending', reason: 'Checks are running.', retryAfter: 60 }, { armed: true, route: 'shipped' }],
    8: [{ armed: false, route: 'waiting-for-developer', code: 'auto_merge_off', reason: 'This repository does not merge by itself yet: a developer adds it to the library.' }],
  };
  const armed: number[] = [];
  const read: number[] = [];
  const p = new ShipPoller({ poll: async (n) => (read.push(n), inLibrary), numbers: [], arming: [7, 8], arm: async (n) => (armed.push(n), answers[n]!.shift() as never), onUpdate: () => {}, onTimeout: () => {}, now: () => now, setTimer: () => 1, clearTimer: () => {} });
  assert.equal(await p.check(), false);
  assert.deepEqual(armed, [7, 8]);
  assert.equal(p.statuses.get(8)!.key, 'waiting');
  // The waiting one moves to the waiting group with Bridge's reason; the one still arming stays with the token values.
  const shown = effectiveItems(items, p.statuses);
  assert.deepEqual(shown.map((i) => i.route), ['shipped', 'shipped', 'waiting-for-developer', 'waiting-for-developer']);
  now = 30_000;
  await p.check();
  assert.deepEqual(armed, [7, 8], 'not asked again before retryAfter');
  now = 61_000;
  await p.check();
  assert.equal(p.statuses.get(7)!.key, 'on-its-way');
  assert.equal(await p.check(), true);
  assert.deepEqual(read, [7], 'only an armed pull request is read');
});

test('arming: Bridge unreachable waits for a developer with the message, not 15 minutes of spinner', async () => {
  const p = new ShipPoller({ poll: async () => inLibrary, numbers: [], arming: [3], arm: async () => { throw new Error('Bridge could not ship it (502).'); }, onUpdate: () => {}, onTimeout: () => {}, setTimer: () => 1, clearTimer: () => {} });
  assert.equal(await p.check(), true);
  assert.deepEqual(p.statuses.get(3), { key: 'waiting', label: 'Waiting for a developer', final: true, reason: 'Bridge could not ship it (502).' });
});
