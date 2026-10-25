// Flow: reopening the plugin with a Claude run in progress for the team. The run moves again (the plugin asks for it,
// one request at a time, after retryAfter), says "Claude is on it" and its round, then "Claude's fix is ready" with See
// Claude's fix and what comes next. The developer cause is never shown.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

const base = { id: 'a1b2c3d4e5f60718', component: 'TextInput', maxRounds: 3, startedBy: 'Ana', createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:01:00Z' };
const running = { ...base, status: 'running', label: 'Claude is on it', sentence: 'Claude is trying a fix for TextInput.', round: 1, retryAfter: 1 };
const ready = {
  ...base,
  status: 'ready',
  label: "Claude's fix is ready",
  sentence: 'Claude found a fix for TextInput. Review it in Studio.',
  pr: { number: 91, url: 'https://github.com/acme/acme-design-system/pull/91', draft: true },
  reviewUrl: 'https://bridge.floriangouloubi.com/studio/acme/acme-design-system/changes/?pr=91',
  applied: ['The label row keeps its height.'],
  developer: 'SECRET developer cause: never shown',
};

test('a run in progress resumes on open, then ends on "Claude\'s fix is ready" with See Claude\'s fix', async () => {
  let polls = 0;
  const p = await openPlugin({ pulled: true, bridge: true, register: (routes) =>
    routes.push((method, path, _body, url) => {
      if (path !== '/api/claude' || method !== 'GET') return undefined;
      if (url.searchParams.get('runs') === '1') return { status: 200, body: { runs: [running] } };
      polls++;
      return { status: 200, body: { run: ready } };
    }),
  });
  await p.until(() => p.text().includes('Claude is on it'));
  assert.match(p.text(), /Round 1 of 3/);
  await p.until(() => p.text().includes("Claude's fix is ready"), 6000);
  assert.ok([...p.document.querySelectorAll('button')].some((b) => b.textContent?.includes("See Claude's fix")));
  assert.match(p.text(), /Once the fix is approved, Check for updates brings it into this file/);
  assert.match(p.text(), /The label row keeps its height/);
  assert.doesNotMatch(p.text(), /SECRET/);
  assert.equal(polls, 1, 'asked once, after retryAfter, and not again once ready');
  await p.click("See Claude's fix");
  assert.ok(p.calls.includes('open-url'));
});
