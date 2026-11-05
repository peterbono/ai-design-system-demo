// Flow: Send for review with one edit: one item, so nothing to count. The action bar shows the words and a bar that
// moves without a percentage, then the result replaces it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('Send my edits: what is happening in words, with a bar that moves without a percentage', async () => {
  const p = await openPlugin({
    pulled: true,
    edit: (s) => {
      const prim = s.collections.find((c) => c.name === 'Primitives')!;
      const v = s.variables.find((x) => x.collectionId === prim.id && x.resolvedType === 'FLOAT' && /space/.test(x.name) && Object.values(x.valuesByMode)[0]!.kind === 'float')!;
      const k = Object.keys(v.valuesByMode)[0]!;
      v.valuesByMode[k] = { kind: 'float', value: (v.valuesByMode[k] as { value: number }).value + 1 };
    },
  });
  p.routes.push((method, path) => (method === 'POST' && path === '/api/ship' ? { status: 200, body: { armed: false, route: 'waiting-for-developer', code: 'app_missing', reason: 'A developer adds it to the library.' } } : undefined));
  await p.click('Push');
  await p.click('Scan for changes');
  await p.until(() => p.headline().includes('ready to send'));

  // The pull request waits: the bar shows meanwhile.
  const g = globalThis as { fetch: (url: string, init?: { method?: string }) => Promise<unknown> };
  const fetch0 = g.fetch;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  g.fetch = async (url, init) => {
    if (init?.method === 'POST' && new URL(url).pathname.endsWith('/pulls')) await gate;
    return fetch0(url, init);
  };
  try {
    await p.click('Send for review');
    const bar = () => p.document.querySelector('.bar [data-progress="busy"]');
    await p.until(() => !!bar());
    const track = bar()!.querySelector('[role="progressbar"]')!;
    assert.equal(bar()!.querySelector('.progress-label')!.textContent, 'Sending for review');
    assert.ok(track.classList.contains('indeterminate'));
    assert.equal(track.getAttribute('aria-valuenow'), null, 'no percentage it cannot know');
    assert.equal(track.getAttribute('aria-valuetext'), 'Sending for review');
    assert.ok(!bar()!.querySelector('.progress-pct') && !bar()!.querySelector('.progress-eta'));
  } finally {
    release();
    g.fetch = fetch0;
  }
  await p.until(() => p.headline() === 'Sent for review', 10000);
  await p.until(() => !p.document.querySelector('[data-progress]'), 10000);
});
