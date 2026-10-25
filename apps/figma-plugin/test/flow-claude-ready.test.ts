import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Reopened after Claude finished: "Claude's fix is ready", See Claude's fix (the review in Studio), and what comes next.
test('ready: See Claude\'s fix and the Check for updates line', async () => {
  const p = await reopenWith({
    session: { component: 'IconButton', state: 'ready', startedAt: minutesAgo(9), updatedAt: minutesAgo(1), steps: [{ label: 'Read the differences (12)', status: 'done', at: '' }, { label: 'Opened its fix for review', status: 'done', at: '' }], pr: { number: 91, url: 'https://github.com/acme/acme-design-system/pull/91' } },
  });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'ready');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, "Claude's fix is ready");
  assert.match(p.row()!.textContent ?? '', /Once the fix is approved, Check for updates brings it into this file/);
  await p.click("See Claude's fix");
  assert.ok(p.calls.includes('open-url'));
});
