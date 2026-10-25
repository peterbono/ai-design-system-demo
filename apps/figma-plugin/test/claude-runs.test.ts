// The plugin side of Bridge's Claude runs (docs/FIGMA-FIXES.md, API contract).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeRunPoller, RunRefused, type RunView, listClaudeRuns, readClaudeRun, startClaudeFix } from '../src/sync/claude-runs';

const ORIGIN = 'https://bridge.example.com';
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const run = (status: RunView['status'], extra: Record<string, unknown> = {}) => ({ id: 'a1b2c3d4e5f60718', component: 'TextInput', status, label: 'x', sentence: 's', maxRounds: 3, startedBy: 'Ana', createdAt: '', updatedAt: '', ...extra });

test('start: POST fix with the Bridge sign-in token; a refusal carries the server sentence', async () => {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  const ok = await startClaudeFix(async (url, init) => (calls.push({ url, init }), answer(200, { run: run('queued'), existing: false })), ORIGIN, 'ghu_t', 'acme/ds', 'TextInput');
  assert.equal(ok.run.status, 'queued');
  assert.equal(calls[0]!.url, `${ORIGIN}/api/claude`);
  assert.equal(calls[0]!.init.headers.Authorization, 'Bearer ghu_t');
  assert.deepEqual(JSON.parse(calls[0]!.init.body!), { action: 'fix', repo: 'acme/ds', component: 'TextInput' });
  for (const [status, error, message] of [[409, 'not_connected', 'Claude is not connected for your team. An admin connects it in Settings.'], [429, 'limit', 'Your team asked Claude for 5 fixes this hour. Ask again in an hour.']] as const) {
    await assert.rejects(startClaudeFix(async () => answer(status, { error, message }), ORIGIN, 't', 'acme/ds', 'X'), (e: unknown) => e instanceof RunRefused && e.code === error && e.message === message);
  }
});

test('read and list: never the developer cause; a run that is gone is undefined', async () => {
  const r = await readClaudeRun(async () => answer(200, { run: run('failed', { developer: 'secret', reason: 'r' }) }), ORIGIN, 't', 'acme/ds', 'a1');
  assert.equal(r?.status, 'failed');
  assert.ok(!('developer' in (r as object)) && !('reason' in (r as object)));
  assert.equal(await readClaudeRun(async () => answer(404, { error: 'not_found' }), ORIGIN, 't', 'acme/ds', 'a1'), undefined);
  const list = await listClaudeRuns(async (url) => (assert.match(url, /runs=1/), answer(200, { runs: [run('running', { developer: 'x' })] })), ORIGIN, 't', 'acme/ds');
  assert.equal(list.length, 1);
  assert.ok(!('developer' in list[0]!));
});

test('the poller asks one request at a time, after retryAfter, until the run is final', async () => {
  const waits: number[] = [];
  const ticks: (() => void)[] = [];
  let inFlight = 0;
  let max = 0;
  const answers = [run('running', { retryAfter: 7 }), run('running', { retryAfter: 3 }), run('ready')];
  const seen: string[] = [];
  new ClaudeRunPoller(
    async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return answers.shift() as RunView;
    },
    (r) => seen.push(r!.status),
    (fn, ms) => (waits.push(ms), ticks.push(fn), 0 as unknown as ReturnType<typeof setTimeout>),
  ).start(run('queued', { retryAfter: 2 }) as RunView);
  while (ticks.length) {
    ticks.shift()!();
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.deepEqual(seen, ['running', 'running', 'ready']);
  assert.deepEqual(waits, [2000, 7000, 3000]);
  assert.equal(max, 1);
});
