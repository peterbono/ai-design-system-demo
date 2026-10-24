// Product decisions D10, D8 and D4 in the plugin, and the copy fixes of the audit:
// - D10: no default repository; the open change a push adds to is per Figma user; after a send, Studio comes first.
// - D8: one verb for sending. D4: a component that needs code says a developer builds it with Claude.
// - Draft with Claude (your plan): the setup is rendered and copied with the saved token; the token's permission is
//   checked before anything is written or waited for.
// - Errors in designer words, menus with arrow keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubError, figmaPushStatus } from '@bridge-ds/core';
import { DEFAULT_SETTINGS, LEGACY_DEFAULT_REPO, STUDIO_ORIGIN } from '../src/shared/messages';
import { type SharedStore, saveSettings, sharedSettings, sharedSync, userKey, writeSync } from '../src/main/shared-state';
import { developerMessage, sentLinks, studioChangeUrl } from '../src/sync/studio';
import { MY_CLAUDE_NEEDS_WRITE, TOKEN_PLACEHOLDER, mcpSnippets, myClaudeAccess } from '../src/sync/my-claude';
import { UNEXPECTED_ERROR, errorText, friendlyError } from '../src/sync/token-health';
import { ROUTE_TAG } from '../src/sync/component-push';
import { sendLabel, sentTitle, suggestionLines } from '../src/sync/publish';
import { menuStep } from '../src/ui/menu';

const EM_DASH = new RegExp(String.fromCharCode(0x2014));

/** figma.root's shared plugin data, in memory. */
function fakeRoot(initial: Record<string, string> = {}): SharedStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, get: (k) => data.get(k) ?? '', set: (k, v) => void data.set(k, v), keys: () => [...data.keys()] };
}

// ---------------------------------------------------------------------------------------------------------------
// D10: no default repository

test('a new file points at no design system: the first run asks which one', () => {
  assert.equal(DEFAULT_SETTINGS.repo, '');
  const settings = sharedSettings(fakeRoot());
  assert.equal(settings.repo, '');
  assert.equal(settings.branch, 'main');
  assert.notEqual(LEGACY_DEFAULT_REPO, '', 'the repository older versions defaulted to is still known, for files that pulled from it');
});

test('a file an older version pulled from the bundled default keeps pointing there; a stored repository always wins', () => {
  assert.equal(sharedSettings(fakeRoot({ baseSha: 'abc' })).repo, LEGACY_DEFAULT_REPO);
  assert.equal(sharedSettings(fakeRoot({ lastPullAt: '2026-10-01T00:00:00Z' })).repo, LEGACY_DEFAULT_REPO);
  assert.equal(sharedSettings(fakeRoot({ baseSha: 'abc', repo: 'acme/ds' })).repo, 'acme/ds');
});

// ---------------------------------------------------------------------------------------------------------------
// D10: one open change per person

test('the open change is per Figma user: designer B never adds to designer A\'s branch', () => {
  const root = fakeRoot({ repo: 'acme/ds' });
  writeSync(root, { baseSha: 'base1', lastPrBranch: 'bridge/ana-edits', lastPrUrl: 'https://github.com/acme/ds/pull/1' }, 'ana');
  assert.equal(root.get(userKey('lastPrBranch', 'ana')), 'bridge/ana-edits');
  assert.equal(root.get('lastPrBranch'), '', 'nothing file-wide');

  // The file's pull state is shared; the branch is not.
  assert.deepEqual(sharedSync(root, 'ana'), { baseSha: 'base1', lastPullAt: undefined, lastPrBranch: 'bridge/ana-edits', lastPrUrl: 'https://github.com/acme/ds/pull/1' });
  assert.deepEqual(sharedSync(root, 'ben'), { baseSha: 'base1', lastPullAt: undefined, lastPrBranch: undefined, lastPrUrl: undefined });

  writeSync(root, { lastPrBranch: 'bridge/ben-edits', lastPrUrl: 'https://github.com/acme/ds/pull/2' }, 'ben');
  assert.equal(sharedSync(root, 'ana').lastPrBranch, 'bridge/ana-edits');
  assert.equal(sharedSync(root, 'ben').lastPrBranch, 'bridge/ben-edits');
});

test('without a known Figma user, no open change is read or written, and the old file-wide one is never used', () => {
  const root = fakeRoot({ repo: 'acme/ds', lastPrBranch: 'bridge/someone-else', lastPrUrl: 'u' });
  assert.equal(sharedSync(root, undefined).lastPrBranch, undefined);
  assert.equal(sharedSync(root, 'ana').lastPrBranch, undefined, 'a branch older versions stored for the whole file belongs to nobody in particular');
  writeSync(root, { baseSha: 'b', lastPrBranch: 'bridge/x' }, undefined);
  assert.equal(root.get('baseSha'), 'b');
  assert.deepEqual(root.keys().filter((k) => k.startsWith('lastPrBranch')), ['lastPrBranch']);
});

test('another repository clears every person\'s open change and the pull; another branch only the open changes', () => {
  const root = fakeRoot({ repo: 'acme/ds', branch: 'main', tokensPath: 'tokens', baseSha: 'base1', lastPrBranch: 'old' });
  writeSync(root, { lastPrBranch: 'bridge/a', lastPrUrl: 'ua' }, 'ana');
  writeSync(root, { lastPrBranch: 'bridge/b', lastPrUrl: 'ub' }, 'ben');

  saveSettings(root, { repo: 'acme/ds', branch: 'next', tokensPath: 'tokens' });
  assert.equal(sharedSync(root, 'ana').lastPrBranch, undefined);
  assert.equal(sharedSync(root, 'ben').lastPrUrl, undefined);
  assert.equal(root.get('lastPrBranch'), '');
  assert.equal(root.get('baseSha'), 'base1', 'same repository: the pull base still holds');

  writeSync(root, { lastPrBranch: 'bridge/a2' }, 'ana');
  const saved = saveSettings(root, { repo: ' other/ds ', branch: 'main', tokensPath: '/tokens/' });
  assert.deepEqual(saved, { repo: 'other/ds', branch: 'main', tokensPath: 'tokens' });
  assert.equal(sharedSync(root, 'ana').lastPrBranch, undefined);
  assert.equal(root.get('baseSha'), '');
});

// ---------------------------------------------------------------------------------------------------------------
// D10: after a send, "See it in Studio" first

test('Studio links open the change in the team of the connected repository', () => {
  assert.equal(studioChangeUrl('acme/design-system', 'pr', 12), `${STUDIO_ORIGIN}/studio/~/acme/design-system/changes/?pr=12`);
  assert.equal(studioChangeUrl('https://github.com/acme/ds.git', 'suggestion', 3), `${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?suggestion=3`);
  assert.equal(studioChangeUrl('', 'pr', 1), undefined);
});

test('the primary link after a send is the main thing sent, in Studio, with GitHub behind it', () => {
  const none = { pr: undefined, suggestions: [], branches: [], requests: [] };
  const pr = { pr: { number: 7, url: 'https://github.com/acme/ds/pull/7', title: 't', draft: true, headRef: 'b' }, branch: 'bridge/x', commitSha: 's', appended: false, tags: [] };
  assert.deepEqual(sentLinks('acme/ds', { ...none, pr, requests: [{ component: 'Button', nodeId: '1', number: 9, url: 'gh/9' }] }), {
    studio: `${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?pr=7`,
    github: 'https://github.com/acme/ds/pull/7',
  });
  assert.equal(sentLinks('acme/ds', { ...none, suggestions: [{ kind: 'variables', number: 4, url: 'gh/4' }] }).studio, `${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?suggestion=4`);
  assert.equal(
    sentLinks('acme/ds', { ...none, branches: [{ component: 'Card', nodeId: '2', route: 'claude-draft', number: 5, url: 'gh/5', branch: 'bridge/figma-card' }] }).studio,
    `${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?pr=5`,
  );
  assert.equal(sentLinks('acme/ds', { ...none, requests: [{ component: 'Button', nodeId: '1', number: 9, url: 'gh/9' }] }).studio, `${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?request=9`);
  assert.equal(sentLinks('acme/ds', none, { number: 11, url: 'gh/11' }).studio, `${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?exploration=11`);
  assert.deepEqual(sentLinks('acme/ds', none), {});
});

// ---------------------------------------------------------------------------------------------------------------
// D8: one verb. D4: a developer builds it with Claude.

test('one verb for sending: "Send to the library", or "Send suggestion"; results without issue numbers', () => {
  assert.equal(sendLabel('direct'), 'Send to the library');
  assert.equal(sendLabel('suggest'), 'Send suggestion');
  assert.equal(sentTitle({ suggestions: [{ kind: 'variables', number: 12, url: 'u' }] }, 'suggest'), 'Suggestion sent to your DS lead');
  const lines = suggestionLines({ suggestions: [{ kind: 'variables', number: 12, url: 'u' }, { kind: 'component-spec', number: 13, url: 'u', component: 'Card' }] });
  for (const l of lines) assert.doesNotMatch(l, /#\d/);
  assert.match(lines[1]!, /a developer builds it with Claude/);
});

test('a component that needs code says who builds it: a developer, with Claude. No "Claude AI" waits on nothing', () => {
  assert.equal(ROUTE_TAG['claude-draft'], 'A developer builds it');
  const waiting = figmaPushStatus({ state: 'open', labels: ['from-figma', 'waiting-for-claude'] });
  assert.equal(waiting.key, 'waiting-for-claude', 'the label stays, for later automation');
  assert.equal(waiting.label, 'Waiting for a developer');
  assert.match(waiting.sentence, /A developer builds it there with Claude/);
  for (const s of [ROUTE_TAG['claude-draft'], waiting.label, waiting.sentence]) assert.doesNotMatch(s, /Claude AI/);
});

test('the message for a developer has the Studio link, the GitHub link and how to build it with Claude', () => {
  const one = developerMessage('acme/ds', [{ component: 'Card', number: 5, url: 'https://github.com/acme/ds/pull/5' }]);
  assert.match(one, /^Hi! I changed Card in Figma and sent it with Bridge\. It needs code: could you build it with Claude\?/);
  assert.ok(one.includes(`${STUDIO_ORIGIN}/studio/~/acme/ds/changes/?pr=5`));
  assert.ok(one.includes('GitHub: https://github.com/acme/ds/pull/5'));
  assert.match(one, /bridge_get_figma_change/);
  assert.match(one, /bridge figma show 5/);
  assert.doesNotMatch(one, EM_DASH);
  const many = developerMessage('acme/ds', [
    { component: 'Card', number: 5, url: 'u5' },
    { component: 'Tabs', number: 6, url: 'u6', suggested: true },
    { component: 'Chip', number: 7, url: 'u7' },
  ]);
  assert.match(many, /I changed Card, Tabs and Chip in Figma and sent them/);
  assert.ok(many.includes('?suggestion=6'));
  const suggested = developerMessage('acme/ds', [{ component: 'Tabs', number: 6, url: 'u6', suggested: true }]);
  assert.match(suggested, /bridge_apply_suggestion/);
  assert.equal(developerMessage('acme/ds', []), '');
});

// ---------------------------------------------------------------------------------------------------------------
// Draft with Claude, on the designer's own plan

test('the setup is shown with a placeholder and copied with the saved token, for Claude Code and the Claude app', () => {
  const shown = mcpSnippets('acme/ds');
  assert.ok(shown.code.includes(`GITHUB_TOKEN=${TOKEN_PLACEHOLDER}`));
  assert.equal(JSON.parse(shown.desktop).mcpServers.bridge.env.GITHUB_TOKEN, TOKEN_PLACEHOLDER);
  const copied = mcpSnippets('acme/ds', 'github_pat_123');
  assert.ok(copied.code.includes('GITHUB_TOKEN=github_pat_123'));
  assert.ok(copied.code.endsWith('--repo acme/ds'));
  assert.deepEqual(JSON.parse(copied.desktop).mcpServers.bridge, { command: 'npx', args: ['-y', '@bridge-ds/mcp', '--repo', 'acme/ds'], env: { GITHUB_TOKEN: 'github_pat_123' } });
  assert.ok(!shown.code.includes('github_pat_'));
});

test('a token that cannot write contents is named before anything is written or waited for', async () => {
  const repo = (push: boolean | undefined) => ({ getRepo: async () => ({ fullName: 'acme/ds', defaultBranch: 'main', private: false, permissions: push === undefined ? undefined : { push } }) });
  assert.equal(await myClaudeAccess(repo(false)), MY_CLAUDE_NEEDS_WRITE);
  assert.equal(await myClaudeAccess(repo(true)), undefined);
  assert.equal(await myClaudeAccess(repo(undefined)), undefined, 'GitHub does not say: the write reports its own error at once');
  assert.equal(await myClaudeAccess({ getRepo: async () => Promise.reject(new Error('offline')) }), undefined);
  assert.match(MY_CLAUDE_NEEDS_WRITE, /"Contents" set to "Read and write"/);
});

// ---------------------------------------------------------------------------------------------------------------
// Errors in designer words

test('errors: Bridge and GitHub sentences pass, anything else becomes one sentence with the raw error as detail', () => {
  assert.deepEqual(friendlyError(new Error('Pick an exploration, or start a new one.')), { text: 'Pick an exploration, or start a new one.' });
  const crash = friendlyError(new TypeError("Cannot read properties of undefined (reading 'id')"));
  assert.equal(crash.text, UNEXPECTED_ERROR);
  assert.equal(crash.detail, "TypeError: Cannot read properties of undefined (reading 'id')");
  assert.equal(friendlyError(new SyntaxError('Unexpected token < in JSON')).text, UNEXPECTED_ERROR);
  assert.equal(friendlyError('boom').text, UNEXPECTED_ERROR);
  const gh = friendlyError(new GitHubError(0, 'Could not reach GitHub. Check your connection, then try again.', 'Failed to fetch'));
  assert.equal(gh.text, 'Could not reach GitHub. Check your connection, then try again.');
  assert.equal(gh.detail, 'Failed to fetch', 'the raw error stays available, folded');
  assert.equal(friendlyError(new GitHubError(401, 'Saving needs a GitHub token.', 'no-token')).detail, undefined, 'a code word adds nothing');
  assert.equal(errorText(new TypeError('x')), UNEXPECTED_ERROR);
  assert.doesNotMatch(UNEXPECTED_ERROR, EM_DASH);
});

// ---------------------------------------------------------------------------------------------------------------
// Menus: arrow keys

test('menus move with the arrow keys, wrap, and jump with Home and End', () => {
  assert.equal(menuStep(-1, 3, 'ArrowDown'), 0);
  assert.equal(menuStep(0, 3, 'ArrowDown'), 1);
  assert.equal(menuStep(2, 3, 'ArrowDown'), 0);
  assert.equal(menuStep(0, 3, 'ArrowUp'), 2);
  assert.equal(menuStep(-1, 3, 'ArrowUp'), 2);
  assert.equal(menuStep(1, 3, 'Home'), 0);
  assert.equal(menuStep(1, 3, 'End'), 2);
  assert.equal(menuStep(1, 3, 'Tab'), undefined);
  assert.equal(menuStep(0, 0, 'ArrowDown'), undefined);
});
