import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRoutes, libraryHeadline, ShipPoller, shipSettled, shipStateLabel, shippedNumbers, type RoutedItem, type ShipStatus } from '../src/sync/library-routes';

const token = (label: string, number: number): RoutedItem => ({ label, kind: 'token', route: 'shipped', number, url: `https://github.com/o/r/pull/${number}` });
const rename: RoutedItem = { label: 'color.bg.subtle', kind: 'token', route: 'waiting-for-developer', number: 12, url: 'https://github.com/o/r/pull/12' };
const build: RoutedItem = { label: 'Avatar', kind: 'component', route: 'build-request', number: 40, url: 'https://github.com/o/r/issues/40' };

test('token values only: sent to the library, then in the library once merged', () => {
  const g = groupRoutes([token('button.primary.bg', 7), token('button.primary.fg', 7)]);
  assert.deepEqual(shippedNumbers(g), [7], 'two tokens in one pull request are polled once');
  assert.deepEqual(libraryHeadline(g, new Map()), { title: 'Sent to the library', text: '2 token changes on their way: they reach the library once the checks pass.' });
  const merged = new Map<number, ShipStatus>([[7, { state: 'in-the-library' }]]);
  assert.deepEqual(libraryHeadline(g, merged), { title: 'In the library', text: '2 token changes are in the library.' });
  assert.equal(shipSettled(g, merged), true);
});

test('a failed check: not in the library, and the row names the check', () => {
  const g = groupRoutes([token('badge.radius', 9)]);
  const failed = new Map<number, ShipStatus>([[9, { state: 'checks-failed', why: 'Contrast' }]]);
  assert.equal(libraryHeadline(g, failed).title, 'Not in the library');
  assert.equal(shipStateLabel(failed.get(9)), 'Did not pass the checks: Contrast');
  assert.equal(shipStateLabel(undefined), 'On its way to the library');
});

test('structure only: build request sent to developers', () => {
  assert.deepEqual(libraryHeadline(groupRoutes([build]), new Map()), {
    title: 'Build request sent to developers',
    text: '1 build request sent to developers: they pick it up, and Studio shows it under Being built.',
  });
});

test('a rename waits for a developer, mixed sends say each route', () => {
  assert.deepEqual(libraryHeadline(groupRoutes([rename]), new Map()), { title: 'Waiting for a developer', text: "1 rename or removal waits for a developer's OK." });
  const mixed = libraryHeadline(groupRoutes([token('avatar.bg', 3), rename, build]), new Map());
  assert.equal(mixed.title, 'Sent');
  assert.match(mixed.text, /^1 token change on its way: it reaches the library once the checks pass\. 1 rename or removal waits for a developer's OK\. 1 build request sent to developers/);
});

test('ShipPoller: polls until every pull request is merged or failed, then stops', async () => {
  const answers: Record<number, ShipStatus[]> = { 3: [{ state: 'on-its-way' }, { state: 'in-the-library' }], 4: [{ state: 'checks-failed', why: 'Tests' }] };
  const asked: number[] = [];
  const updates: Map<number, ShipStatus>[] = [];
  const p = new ShipPoller({ poll: async (n) => (asked.push(n), answers[n]!.shift()!), numbers: [3, 4], onUpdate: (s) => updates.push(s), onTimeout: () => assert.fail('no timeout'), setTimer: () => 1, clearTimer: () => {} });
  p.start();
  assert.equal(await p.check(), false, 'one still on its way');
  assert.equal(await p.check(), true);
  assert.deepEqual(asked, [3, 4, 3], 'a settled pull request is not read again');
  assert.equal(updates.at(-1)!.get(3)!.state, 'in-the-library');
  assert.equal(p.active, false);
});

test('ShipPoller: 10 minutes on its way stops polling and says so', async () => {
  let now = 0;
  let timedOut = false;
  let fire: (() => void) | undefined;
  const p = new ShipPoller({ poll: async () => ({ state: 'on-its-way' }), numbers: [5], onUpdate: () => {}, onTimeout: () => (timedOut = true), now: () => now, setTimer: (fn) => ((fire = fn), 1), clearTimer: () => {} });
  p.start();
  now = 10 * 60_000;
  fire!();
  await new Promise((r) => setImmediate(r));
  assert.equal(timedOut, true);
  assert.equal(p.active, false);
});
