import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Reopened, nothing from Claude yet (and the Bridge site cannot say): "Waiting for Claude", with Open Claude again.
test('waiting: the head says so, with Open Claude again, no steps', async () => {
  const p = await reopenWith({});
  assert.equal(p.row()!.getAttribute('data-claude'), 'waiting');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, 'Waiting for Claude');
  assert.ok([...p.row()!.querySelectorAll('button')].some((b) => b.textContent?.includes('Open Claude again')));
  assert.ok(!p.row()!.querySelector('.claude-steps'));
  assert.ok(p.row()!.querySelector('.activity'), 'an indeterminate activity indicator, no percentage');
  assert.doesNotMatch(p.text(), /%/);
});
