// The one progress bar's arithmetic: the time left from the observed rate (smoothed, shown only after enough steps,
// never jumping around), said as a person says it, the percentage, and Claude's list estimated from finished fixes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Estimator, batchRemainingMs, percentOf, remainingText } from '../src/ui/progress';

const S = 1000;

test('time left: nothing until enough steps, then the observed rate times what is left', () => {
  const e = new Estimator();
  e.observe(0, 62, 0);
  assert.equal(e.remainingMs(0), undefined, 'no estimate from the start alone');
  e.observe(1, 62, 10 * S);
  e.observe(2, 62, 20 * S);
  assert.equal(e.remainingMs(20 * S), undefined, 'two steps are not enough');
  e.observe(3, 62, 30 * S);
  // 10 s per set, 59 left: 590 s.
  assert.equal(Math.round(e.remainingMs(30 * S)! / S), 590);
  // Between steps it counts down, never below zero.
  assert.equal(Math.round(e.remainingMs(35 * S)! / S), 585);
  assert.equal(e.remainingMs(10_000 * S), 0);
});

test('time left: one slow item does not make the figure jump, a steady rate brings it back', () => {
  const e = new Estimator();
  for (let i = 0; i <= 10; i++) e.observe(i, 100, i * 10 * S);
  const before = e.remainingMs(100 * S)!;
  assert.equal(Math.round(before / S), 900);
  // One set takes 2 minutes instead of 10 s: the raw estimate triples, the shown one rises a quarter at most.
  e.observe(11, 100, 220 * S);
  const after = e.remainingMs(220 * S)!;
  const expected = before - 120 * S;
  assert.ok(after <= expected * 1.25 + 5 * S + 1, `rose at most a quarter: ${after / S} s from ${expected / S} s`);
  // Back to 10 s a set: the figure settles near the steady estimate, step by step, never by a cliff.
  let shown = after;
  for (let i = 12; i <= 40; i++) {
    const t = 220 * S + (i - 11) * 10 * S;
    e.observe(i, 100, t);
    const now = e.remainingMs(t)!;
    assert.ok(now <= shown * 1.25 + 5 * S + 1, `no jump up at ${i}: ${now / S} s after ${shown / S} s`);
    shown = now;
  }
  assert.ok(shown / S < 60 * 25, `settled: ${Math.round(shown / S)} s for 60 sets at about 10 to 20 s`);
});

test('time left: a new phase (another total) or a step back starts over', () => {
  const e = new Estimator();
  for (let i = 0; i <= 4; i++) e.observe(i, 10, i * 5 * S);
  assert.ok(e.remainingMs(20 * S) !== undefined);
  e.observe(0, 300, 21 * S);
  assert.equal(e.remainingMs(21 * S), undefined, 'the sets phase after the icons phase');
  for (let i = 1; i <= 4; i++) e.observe(i, 300, 21 * S + i * S);
  assert.ok(e.remainingMs(25 * S) !== undefined);
  e.observe(0, 300, 26 * S);
  assert.equal(e.remainingMs(26 * S), undefined);
  e.observe(undefined, undefined, 27 * S);
  assert.equal(e.remainingMs(27 * S), undefined, 'no total: no time left');
});

test('time left in words, rounded the way a person says it', () => {
  assert.equal(remainingText(undefined), undefined);
  assert.equal(remainingText(0), 'less than a minute left');
  assert.equal(remainingText(59 * S), 'less than a minute left');
  assert.equal(remainingText(61 * S), 'about 1 min left');
  assert.equal(remainingText(170 * S), 'about 3 min left');
  assert.equal(remainingText(9 * 60 * S), 'about 9 min left');
  assert.equal(remainingText(12 * 60 * S), 'about 10 min left');
  assert.equal(remainingText(23 * 60 * S), 'about 25 min left');
  assert.equal(remainingText(60 * 60 * S), 'about 1 h left');
  assert.equal(remainingText(78 * 60 * S), 'about 1 h 20 min left');
  for (const ms of [0, 30 * S, 90 * S, 600 * S, 4000 * S, 9000 * S]) assert.doesNotMatch(remainingText(ms)!, /\u2014/);
});

test('percentage: whole numbers, never 100 before the last item', () => {
  assert.equal(percentOf(0, 62), 0);
  assert.equal(percentOf(12, 62), 19);
  assert.equal(percentOf(61, 62), 98);
  assert.equal(percentOf(999, 1000), 99);
  assert.equal(percentOf(62, 62), 100);
  assert.equal(percentOf(3, 0), 0);
});

test("Claude's list: the average of the fixes it finished, times the ones left, less the one in progress", () => {
  assert.equal(batchRemainingMs([], 5), undefined, 'nothing finished yet: no estimate');
  // 4 min a fix, 3 left, the current one 1 min in: 11 min.
  assert.equal(batchRemainingMs([200, 280], 3, 60), 660 * S);
  // The current one already took longer than the average: the others still take theirs.
  assert.equal(batchRemainingMs([240], 3, 600), 480 * S);
  assert.equal(batchRemainingMs([240], 0), 0);
});
