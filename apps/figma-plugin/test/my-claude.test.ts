// "Draft with my Claude": the plugin writes the pending drafts file (and the before and after PNGs) on the requests
// branch, polls it every 5 seconds, fills the fields the designer did not edit, offers the rest, stops after 10
// minutes, and deletes the file once sent or cancelled. GitHub is in memory, timers are fake.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DRAFTS_DIR, type PendingDrafts, REQUESTS_BRANCH, draftSessionPath, mergeDraftResults, parsePendingDrafts, serializePendingDrafts } from '@bridge-ds/core';
import { DRAFT_PHRASE, DraftPoller, MCP_CLONE, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, type MyClaudeTarget, finishMyClaudeDrafts, mcpSnippets, planFill, startMyClaudeDrafts } from '../src/sync/my-claude';
import { FakeGitHub } from './fake-github';

const EM = '—';

const target: MyClaudeTarget = {
  scope: 'request',
  component: 'Badge',
  kind: 'new-variant',
  changes: [{ field: 'Variant Tone', before: 'info, neutral', after: 'danger, info, neutral' }],
  notes: 'For destructive states in tables.',
  draft: { title: 'Add a danger tone', summary: 'Badge gets a new Tone value, danger.' },
  images: { before: 'QkVGT1JF', after: 'data:image/png;base64,QUZURVI=' },
};

/** A clock and a timer queue the test advances by hand. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => timers.size,
    /** Moves the clock, firing due timers one by one and letting their async work settle. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      now = end;
    },
  };
}

const fileOf = (gh: FakeGitHub, sessionId: string) => parsePendingDrafts(gh.contents.get(`${REQUESTS_BRANCH}:${draftSessionPath(sessionId)}`)?.text);

/** What the Bridge MCP server does when the designer says "Draft my Bridge changes". */
function claudeAnswers(gh: FakeGitHub, sessionId: string, title: string, summary: string): PendingDrafts {
  const key = `${REQUESTS_BRANCH}:${draftSessionPath(sessionId)}`;
  const next = mergeDraftResults(fileOf(gh, sessionId)!, [{ id: 'item-1', title, summary }], new Date('2026-10-17T09:01:00Z'));
  gh.contents.set(key, { text: serializePendingDrafts(next), sha: 'claude-1' });
  return next;
}

async function started(gh = new FakeGitHub({ 'a.json': '{}' })) {
  const session = await startMyClaudeDrafts(gh.client(), { targets: [target], baseBranch: 'main', now: new Date('2026-10-17T09:00:00Z') });
  return { gh, session };
}

test('start: creates the requests branch, uploads before and after PNGs, writes a pending session', async () => {
  const { gh, session } = await started();
  assert.ok(gh.branches.has(REQUESTS_BRANCH));
  assert.match(session.sessionId, /^[a-z0-9]{16}$/);
  const file = fileOf(gh, session.sessionId)!;
  assert.equal(file.status, 'pending');
  assert.equal(file.source, 'figma');
  assert.equal(file.createdAt, '2026-10-17T09:00:00.000Z');
  const item = file.items[0]!;
  assert.deepEqual([item.id, item.scope, item.component, item.kind, item.notes], ['item-1', 'request', 'Badge', 'new-variant', 'For destructive states in tables.']);
  assert.deepEqual(item.draft, target.draft);
  assert.deepEqual(item.images!.map((i) => [i.label, i.path]), [
    ['before', `${DRAFTS_DIR}/${session.sessionId}/item-1-before.png`],
    ['after', `${DRAFTS_DIR}/${session.sessionId}/item-1-after.png`],
  ]);
  assert.equal(item.images![1]!.url, `https://github.com/o/r/blob/bridge-requests/${DRAFTS_DIR}/${session.sessionId}/item-1-after.png?raw=true`);
  // The data: prefix is stripped before upload.
  assert.equal(gh.binaries.get(REQUESTS_BRANCH)!.get(`${DRAFTS_DIR}/${session.sessionId}/item-1-after.png`), 'QUZURVI=');
  // Nothing on main.
  assert.ok(gh.contentLog.every((c) => c.includes(DRAFTS_DIR)));
});

test('start: a push sends its variable edits; nothing to draft is refused', async () => {
  const gh = new FakeGitHub({ 'a.json': '{}' });
  const s = await startMyClaudeDrafts(gh.client(), {
    targets: [{ scope: 'push', changes: [], variables: [{ path: 'color.text.muted', before: '#555555', after: '#444444' }], components: ['Badge'], draft: { title: 'Darken muted text', summary: 'Changes color.text.muted.' } }],
    baseBranch: 'main',
  });
  const item = fileOf(gh, s.sessionId)!.items[0]!;
  assert.equal(item.scope, 'push');
  assert.deepEqual(item.variables, [{ path: 'color.text.muted', before: '#555555', after: '#444444' }]);
  assert.deepEqual(item.components, ['Badge']);
  assert.equal(item.images, undefined);
  await assert.rejects(startMyClaudeDrafts(gh.client(), { targets: [], baseBranch: 'main' }), /Nothing to draft/);
});

test('poll: reads every 5 seconds until Claude answers, then stops and hands over the results', async () => {
  const { gh, session } = await started();
  const t = fakeTimers();
  const got: string[] = [];
  let reads = 0;
  const c = gh.client();
  const counting = { getFile: (p: string, ref?: string) => { reads++; return c.getFile(p, ref); } };
  const poller = new DraftPoller({ client: counting as never, sessionId: session.sessionId, ...t, onResults: (r) => got.push(`${r[0]!.title} / ${r[0]!.summary}`), onTimeout: () => got.push('timeout') });
  poller.start();
  await t.advance(POLL_INTERVAL_MS * 3);
  assert.equal(reads, 3);
  assert.deepEqual(got, []);
  claudeAnswers(gh, session.sessionId, `Add a danger tone ${EM} for tables.`, 'Destructive rows need a stronger tone.');
  await t.advance(POLL_INTERVAL_MS);
  assert.deepEqual(got, ['Add a danger tone, for tables / Destructive rows need a stronger tone.']);
  assert.equal(poller.active, false);
  assert.equal(t.pending(), 0);
  await t.advance(POLL_INTERVAL_MS * 4);
  assert.equal(reads, 4);
});

test('poll: stops after 10 minutes; "Check again" polls again and still gets the answer', async () => {
  const { gh, session } = await started();
  const t = fakeTimers();
  const got: string[] = [];
  const poller = new DraftPoller({ client: gh.client(), sessionId: session.sessionId, ...t, onResults: (r) => got.push(r[0]!.title), onTimeout: () => got.push('timeout') });
  poller.start();
  await t.advance(POLL_TIMEOUT_MS - 1);
  assert.deepEqual(got, []);
  await t.advance(POLL_INTERVAL_MS);
  assert.deepEqual(got, ['timeout']);
  assert.equal(poller.active, false);
  assert.equal(t.pending(), 0);
  claudeAnswers(gh, session.sessionId, 'Add a danger tone', 'For tables.');
  poller.start();
  assert.equal(await poller.check(), true);
  assert.deepEqual(got, ['timeout', 'Add a danger tone']);
});

test('poll: a file deleted elsewhere stops polling; a failed read keeps polling', async () => {
  const { gh, session } = await started();
  const t = fakeTimers();
  const events: string[] = [];
  const c = gh.client();
  let fail = true;
  const flaky = { getFile: async (p: string, ref?: string) => { if (fail) { fail = false; throw new Error('Could not reach GitHub.'); } return c.getFile(p, ref); } };
  const poller = new DraftPoller({ client: flaky as never, sessionId: session.sessionId, ...t, onResults: () => events.push('results'), onTimeout: () => events.push('timeout'), onGone: () => events.push('gone'), onError: (m) => events.push(`error: ${m}`) });
  poller.start();
  await t.advance(POLL_INTERVAL_MS);
  assert.deepEqual(events, ['error: Could not reach GitHub.']);
  assert.equal(poller.active, true);
  await finishMyClaudeDrafts(c, session.sessionId);
  await t.advance(POLL_INTERVAL_MS);
  assert.deepEqual(events, ['error: Could not reach GitHub.', 'gone']);
  assert.equal(poller.active, false);
});

test('fill: untouched fields get Claude\'s text; fields edited after the request are offered, never overwritten', () => {
  const result = { title: 'Add a danger tone', summary: 'Destructive rows need a stronger tone.' };
  assert.deepEqual(planFill(result, {}), { fill: result, offer: {} });
  assert.deepEqual(planFill(result, { summary: true }), { fill: { title: 'Add a danger tone' }, offer: { summary: 'Destructive rows need a stronger tone.' } });
  assert.deepEqual(planFill(result, { title: true, summary: true }), { fill: {}, offer: result });
  assert.deepEqual(planFill({ title: '', summary: '  ' }, {}), { fill: {}, offer: {} });
});

test('the whole flow: request, designer types, Claude answers, the typed field is kept, then cleanup on send', async () => {
  const { gh, session } = await started();
  const t = fakeTimers();
  const fields = { title: target.draft.title, summary: target.draft.summary };
  const edited: { title?: boolean; summary?: boolean } = {};
  let offer: { title?: string; summary?: string } = {};
  const poller = new DraftPoller({
    client: gh.client(),
    sessionId: session.sessionId,
    ...t,
    onResults: (r) => {
      const plan = planFill(r[0]!, edited);
      Object.assign(fields, plan.fill);
      offer = plan.offer;
    },
    onTimeout: () => assert.fail('no timeout expected'),
  });
  poller.start();
  await t.advance(POLL_INTERVAL_MS);
  // The designer types a summary while waiting.
  fields.summary = 'My own words about why.';
  edited.summary = true;
  claudeAnswers(gh, session.sessionId, 'Add a danger tone for tables', 'Destructive rows need a stronger tone.');
  await t.advance(POLL_INTERVAL_MS);
  assert.deepEqual(fields, { title: 'Add a danger tone for tables', summary: 'My own words about why.' });
  assert.deepEqual(offer, { summary: 'Destructive rows need a stronger tone.' });
  // Sent: the session file and its images are deleted.
  assert.equal(await finishMyClaudeDrafts(gh.client(), session.sessionId), true);
  assert.equal(fileOf(gh, session.sessionId), undefined);
  assert.equal([...gh.contents.keys()].filter((k) => k.includes(session.sessionId)).length, 0);
  assert.equal(await finishMyClaudeDrafts(gh.client(), session.sessionId), false);
});

test('settings: MCP setup for Claude Desktop and Claude Code, with the repo and a placeholder token', () => {
  const s = mcpSnippets('acme/ds');
  const desktop = JSON.parse(s.desktop);
  assert.deepEqual(desktop.mcpServers.bridge.args, ['/path/to/bridge/packages/mcp/dist/index.js', '--repo', 'acme/ds']);
  assert.equal(desktop.mcpServers.bridge.command, 'node');
  assert.deepEqual(Object.keys(desktop.mcpServers.bridge.env), ['GITHUB_TOKEN']);
  assert.equal(s.code, 'claude mcp add bridge -s user -e GITHUB_TOKEN=your-github-token -- node /path/to/bridge/packages/mcp/dist/index.js --repo acme/ds');
  assert.match(MCP_CLONE, /npm run mcp:build$/);
  assert.equal(DRAFT_PHRASE, 'Draft my Bridge changes');
  assert.ok(!`${s.desktop}${s.code}${MCP_CLONE}`.includes(EM));
});
