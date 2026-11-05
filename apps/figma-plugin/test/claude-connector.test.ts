// The team's own Claude, with Bridge as a connector: the request, where Claude opens, how the fix is recognised on
// GitHub, and what a fix session says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_NEW_CHAT, CONNECTOR_WORDS, PREFILL_MAX_URL, askAllText, askText, canAskClaude, claudeUrl, claudeUrlForAll, findFix, fixAllEligible, fixBranchStem, parseAsked } from '../src/sync/claude-connector';
import { FIX_EVERY_PHRASE, fixRequestForDeveloper } from '../src/sync/fix-with-claude';
import { parseSession, sessionHead } from '../src/sync/fix-session';

test('the request and where Claude opens: a new chat with it written (not sent)', () => {
  assert.equal(askText('IconButton'), 'Fix IconButton in Figma with Bridge');
  assert.deepEqual(claudeUrl('IconButton'), { url: 'https://claude.ai/new?q=Fix%20IconButton%20in%20Figma%20with%20Bridge', prefilled: true });
  void CLAUDE_NEW_CHAT;
});

test('Ask Claude to fix all N: one request naming every component, in the order of the list', () => {
  const names = ['AccordionItem', 'AlertDialog/Popup', 'Button'];
  assert.equal(askAllText(names), 'Fix these 3 components in Figma with Bridge: AccordionItem, AlertDialog/Popup, Button');
  assert.equal(askAllText(['Button']), 'Fix Button in Figma with Bridge', 'one is the single request');
  assert.deepEqual(claudeUrlForAll(names), { url: `https://claude.ai/new?q=${encodeURIComponent(askAllText(names))}`, prefilled: true });
  assert.equal(CONNECTOR_WORDS.fixAll(31), 'Ask Claude to fix all 31');
  for (const t of [askAllText(names), FIX_EVERY_PHRASE, CONNECTOR_WORDS.fixAll(31), CONNECTOR_WORDS.prefilledAll]) assert.doesNotMatch(t, /\u2014|MCP|API|npx|branch/);
});

test('Ask Claude to fix all N: a list too long for Claude\'s address opens on "Fix every component that differs"', () => {
  const many = Array.from({ length: 200 }, (_, i) => `Component${i}/Part`);
  const open = claudeUrlForAll(many);
  assert.equal(open.url, `https://claude.ai/new?q=${encodeURIComponent(FIX_EVERY_PHRASE)}`);
  assert.equal(open.prefilled, true);
  assert.ok(`https://claude.ai/new?q=${encodeURIComponent(askAllText(many))}`.length > PREFILL_MAX_URL);
  // The copied request still names them all.
  assert.match(askAllText(many), /^Fix these 200 components in Figma with Bridge: Component0\/Part, .*Component199\/Part$/);
  // 31 components of a real library fit.
  const real = Array.from({ length: 31 }, (_, i) => `AlertDialog/Popup${i}`);
  assert.ok(claudeUrlForAll(real).url.includes('AlertDialog'));
});

test('Ask Claude to fix all N: the rows that would show their own button, shown from two', () => {
  const rows = [
    { name: 'A', differs: true, asked: false },
    { name: 'B', differs: true, asked: true },
    { name: 'C', differs: false, asked: false },
    { name: 'D', differs: true, asked: false },
  ];
  assert.deepEqual(fixAllEligible(rows, true), ['A', 'D']);
  assert.deepEqual(fixAllEligible(rows, false), [], 'no measure: Claude cannot help, each row hands off instead');
  assert.deepEqual(fixAllEligible(rows.slice(0, 3), true), [], 'one left: its own button is the one action');
  for (const r of rows) assert.equal(canAskClaude(r, true), fixAllEligible([r, { ...r, name: 'twin' }], true).length === 2);
});

test('Copy for your developer after Ask Claude to fix all N: the request and one command per component', () => {
  const req = fixRequestForDeveloper(['Button', 'TextInput'], 'acme/ds');
  assert.match(req, /^Could you ask Claude to fix these 2 components in Figma\?/);
  assert.match(req, /say: "Fix these 2 components in Figma with Bridge: Button, TextInput"/);
  assert.match(req, /npx @bridge-ds\/cli fix Button --with-claude\n {2}npx @bridge-ds\/cli fix TextInput --with-claude/);
  assert.equal(fixRequestForDeveloper(['Button'], 'acme/ds'), fixRequestForDeveloper('Button', 'acme/ds'));
  assert.doesNotMatch(req, /\u2014/);
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
