import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Reopened while Claude works: the head with the elapsed time and the round, the real steps folded below, newest last.
test('working: "Claude is working on IconButton", elapsed time, round of up to 3, steps folded with a check or a pulse', async () => {
  const p = await reopenWith({
    session: {
      component: 'IconButton', state: 'working', startedAt: minutesAgo(4), updatedAt: minutesAgo(1), round: 2, maxRounds: 3,
      steps: [
        { label: 'Read the differences (12)', status: 'done', at: minutesAgo(4) },
        { label: 'Tried a fix, round 1: closer', status: 'done', at: minutesAgo(2) },
        { label: 'Trying a fix, round 2', status: 'current', at: minutesAgo(1) },
      ],
      developer: 'SECRET cause',
    },
  });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'working');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, 'Claude is working on IconButton · 4 min, round 2 of up to 3');
  const fold = p.row()!.querySelector('details')!;
  assert.equal(fold.open, false, 'collapsed by default: only the head');
  assert.equal(fold.querySelector('summary')!.textContent, 'What Claude did (3)');
  const steps = [...fold.querySelectorAll('li')];
  assert.deepEqual(steps.map((s) => s.textContent), ['Read the differences (12)', 'Tried a fix, round 1: closer', 'Trying a fix, round 2']);
  assert.deepEqual(steps.map((s) => s.getAttribute('data-step')), ['done', 'done', 'current']);
  assert.ok(steps[2]!.querySelector('.activity') && steps[0]!.querySelector('svg'), 'the current step pulses, finished ones get a check');
  assert.doesNotMatch(p.text(), /SECRET/);
});
