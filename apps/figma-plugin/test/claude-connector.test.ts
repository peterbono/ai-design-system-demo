// The team's own Claude, with Bridge as a connector: the request, where Claude opens, how the fix is recognised on
// GitHub, and what a fix session says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_NEW_CHAT, askText, claudeUrl, findFix, fixBranchStem, parseAsked } from '../src/sync/claude-connector';
import { parseSession, sessionHead } from '../src/sync/fix-session';

test('the request and where Claude opens (no prefill confirmed yet: a new chat, the request copied)', () => {
  assert.equal(askText('IconButton'), 'Fix IconButton in Figma with Bridge');
  assert.deepEqual(claudeUrl('IconButton'), { url: CLAUDE_NEW_CHAT, prefilled: false });
});

test('Claude\'s fix: open, labelled figma-fixes, on the component\'s branch or a numbered one; nothing else', () => {
  assert.equal(fixBranchStem('IconButton'), 'bridge/figma-fixes-icon-button');
  const pr = (headRef: string, labels = ['figma-fixes'], state = 'open') => ({ headRef, labels, state, number: 1, url: 'u', draft: true });
  assert.ok(findFix([pr('bridge/figma-fixes-icon-button')], 'IconButton'));
  assert.ok(findFix([pr('bridge/figma-fixes-icon-button-2')], 'IconButton'));
  assert.ok(findFix([pr('ds/figma-fixes-icon-button')], 'IconButton', 'ds/'));
  assert.equal(findFix([pr('bridge/figma-fixes-icon-button-group')], 'IconButton'), undefined, 'another component');
  assert.equal(findFix([pr('bridge/figma-fixes-icon-button', ['other'])], 'IconButton'), undefined, 'not labelled');
  assert.equal(findFix([pr('bridge/figma-fixes-icon-button', ['figma-fixes'], 'closed')], 'IconButton'), undefined, 'closed');
});

test('asks kept with the file parse safely', () => {
  assert.deepEqual(parseAsked('{"IconButton":"2026-10-25T10:00:00Z","x":3}'), { IconButton: '2026-10-25T10:00:00Z' });
  assert.deepEqual(parseAsked('not json'), {});
  assert.deepEqual(parseAsked(undefined), {});
});

test('a fix session: only designer words survive, and the head says the state in one line', () => {
  const now = Date.parse('2026-10-25T10:10:00Z');
  const s = parseSession({ component: 'IconButton', state: 'working', startedAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:09:00Z', steps: [{ label: 'Read the differences (12)', status: 'done', at: '' }, { label: 'x', status: 'weird' }], developer: 'secret', round: 1, maxRounds: 3 })!;
  assert.equal(s.steps.length, 1);
  assert.ok(!('developer' in s));
  assert.deepEqual(sessionHead(s, 'IconButton', now), { kind: 'working', text: 'Claude is working on IconButton · 10 min, round 1 of up to 3' });
  assert.equal(sessionHead(undefined, 'IconButton', now).text, 'Waiting for Claude');
  assert.equal(sessionHead({ ...s, steps: [] }, 'IconButton', now).kind, 'waiting');
  assert.equal(sessionHead({ ...s, updatedAt: '2026-10-25T09:50:00Z' }, 'IconButton', now).text, 'Claude went quiet');
  assert.equal(sessionHead({ ...s, state: 'stopped', reason: 'no closer fix' }, 'IconButton', now).text, 'Claude stopped: no closer fix');
  assert.equal(sessionHead({ ...s, state: 'ready' }, 'IconButton', now).text, "Claude's fix is ready");
  assert.equal(parseSession({ component: 'X', state: 'nope' }), undefined);
});
