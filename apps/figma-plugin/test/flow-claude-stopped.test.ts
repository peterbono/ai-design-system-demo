import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Claude gave up: the honest reason in the head, and Copy for your developer.
test('stopped: "Claude stopped: …" and Copy for your developer', async () => {
  const p = await reopenWith({ session: { component: 'IconButton', state: 'stopped', reason: 'no fix brought it closer to the code in 3 rounds', startedAt: minutesAgo(9), updatedAt: minutesAgo(2), steps: [{ label: 'Tried a fix, round 3: further', status: 'failed', at: '' }] } });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'stopped');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, 'Claude stopped: no fix brought it closer to the code in 3 rounds');
  await p.click('Copy for your developer');
  assert.ok(p.copied.some((t) => /IconButton/.test(t)));
});
