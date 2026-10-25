import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Steps stopped coming (the chat was closed): "Claude went quiet", Open Claude again and Copy for your developer.
test('quiet: "Claude went quiet" with both ways forward', async () => {
  const p = await reopenWith({ session: { component: 'IconButton', state: 'working', quiet: true, elapsed: 900, startedAt: minutesAgo(40), updatedAt: minutesAgo(25), maxRounds: 3, steps: [{ label: 'Read the differences (12)', status: 'done', at: '' }] } });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'quiet');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, 'Claude went quiet');
  assert.doesNotMatch(p.row()!.textContent ?? '', /Claude stopped/);
  const labels = [...p.row()!.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(labels.some((l) => l?.includes('Open Claude again')) && labels.some((l) => l?.includes('Copy for your developer')));
});
