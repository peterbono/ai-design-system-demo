import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// Reopened after Claude finished, by a contributor (Bridge says this sign-in does not approve): "Claude's fix is ready",
// "Waiting for approval", See Claude's fix (the review in Studio), and no Approve button anywhere.
test('ready: See Claude\'s fix and Waiting for approval, no Approve for a contributor', async () => {
  const p = await reopenWith({
    session: { component: 'IconButton', state: 'ready', startedAt: minutesAgo(9), updatedAt: minutesAgo(1), steps: [{ label: 'Read the differences (12)', status: 'done', at: '' }, { label: 'Opened its fix for review', status: 'done', at: '' }], pr: { number: 91, url: 'https://github.com/acme/acme-design-system/pull/91' } },
  });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'ready');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, "Claude's fix is ready");
  assert.equal(p.row()!.querySelector('p')!.textContent, 'Waiting for approval. Once a lead approves it, Check for updates brings it into this file.');
  await p.until(() => p.calls.includes('POST /api/ship'));
  await p.settle(100);
  assert.ok(![...p.document.querySelectorAll('button')].some((b) => /^Approve/.test(b.textContent ?? '')), 'no Approve for a contributor');
  assert.match(p.text(), /1 waiting for approval\./);
  await p.click("See Claude's fix");
  assert.ok(p.calls.includes('open-url'));
});
