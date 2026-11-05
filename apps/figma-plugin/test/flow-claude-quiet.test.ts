import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Steps stopped coming after Claude did something (the chat was closed, or Claude answered only there): "Claude didn't
// finish this one", its reply is in the chat, Open Claude again and Copy for your developer. Never "went quiet": that is
// for an ask nothing came back from.
test("quiet: \"Claude didn't finish this one\" with both ways forward", async () => {
  const p = await reopenWith({ session: { component: 'IconButton', state: 'working', quiet: true, elapsed: 900, startedAt: minutesAgo(40), updatedAt: minutesAgo(25), maxRounds: 3, steps: [{ label: 'Read the differences (12)', status: 'done', at: '' }] } });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'unfinished');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, "Claude didn't finish this one");
  assert.match(p.row()!.textContent ?? '', /Its last reply is in your Claude chat/);
  assert.doesNotMatch(p.text(), /went quiet|Claude stopped/);
  const labels = [...p.row()!.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(labels.some((l) => l?.includes('Open Claude again')) && labels.some((l) => l?.includes('Copy for your developer')));
});
