// The team's own Claude, with Bridge as a connector: the request, where Claude opens, how the fix is recognised on
// GitHub, and what a fix session says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_NEW_CHAT, askText, claudeUrl, findFix, fixBranchStem, parseAsked } from '../src/sync/claude-connector';
import { parseSession, sessionHead } from '../src/sync/fix-session';

test('the request and where Claude opens: a new chat with it written (not sent)', () => {
  assert.equal(askText('IconButton'), 'Fix IconButton in Figma with Bridge');
  assert.deepEqual(claudeUrl('IconButton'), { url: 'https://claude.ai/new?q=Fix%20IconButton%20in%20Figma%20with%20Bridge', prefilled: true });
  void CLAUDE_NEW_CHAT;
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

test('a fix session matches the contract: only designer words survive, the head says the state in one line', () => {
  const view = {
    component: 'IconButton', state: 'working', startedAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:09:00Z', elapsed: 600, quiet: false, round: 1, maxRounds: 3,
    steps: [
      { label: 'Claude read the differences (12)', status: 'done', text: 'Claude read the differences (12)', kind: 'read', at: '2026-10-25T10:00:00Z', by: 'Ana', differences: 12 },
      { label: 'x', status: 'weird' },
    ],
    developer: 'secret',
  };
  const s = parseSession(view)!;
  assert.deepEqual(s.steps, [{ label: 'Claude read the differences (12)', status: 'done', kind: 'read', at: '2026-10-25T10:00:00Z', by: 'Ana' }]);
  assert.ok(!('developer' in s));
  assert.deepEqual(sessionHead(s, 'IconButton'), { kind: 'working', text: 'Claude is working on IconButton · 10 min, round 1 of up to 3' });
  assert.equal(sessionHead(undefined, 'IconButton').text, 'Waiting for Claude');
  assert.equal(sessionHead(parseSession({ ...view, state: 'waiting', startedAt: null, updatedAt: null, elapsed: 0, steps: [] }), 'IconButton').text, 'Waiting for Claude');
  // Quiet is the server's flag on a working session: never a stop, never "Claude stopped: Claude went quiet".
  const quiet = parseSession({ ...view, quiet: true })!;
  assert.deepEqual(sessionHead(quiet, 'IconButton'), { kind: 'quiet', text: 'Claude went quiet' });
  assert.equal(sessionHead(parseSession({ ...view, state: 'stopped', reason: 'no closer fix' }), 'IconButton').text, 'Claude stopped: no closer fix');
  assert.equal(sessionHead(parseSession({ ...view, state: 'stopped', reason: 'Claude stopped: no closer fix' }), 'IconButton').text, 'Claude stopped: no closer fix');
  assert.equal(sessionHead(parseSession({ ...view, state: 'ready' }), 'IconButton').text, "Claude's fix is ready");
  assert.equal(sessionHead(parseSession({ ...view, elapsed: 3900 }), 'IconButton').text, 'Claude is working on IconButton · 1 h 5 min, round 1 of up to 3');
  assert.equal(parseSession({ component: 'X', state: 'nope' }), undefined);
});
