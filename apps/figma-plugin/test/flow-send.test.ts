// Flow: edit a variable, Send for review, read the result while Bridge tries to ship it. The send succeeded: the panel
// ends on "Sent for review" with "See it in Studio", whatever the ship answers afterwards (B2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('Send for review ends on "Sent for review", even when Bridge cannot ship the token change by itself', async () => {
  const p = await openPlugin({
    pulled: true,
    edit: (s) => {
      const prim = s.collections.find((c) => c.name === 'Primitives')!;
      const v = s.variables.find((x) => x.collectionId === prim.id && x.resolvedType === 'FLOAT' && /space/.test(x.name) && Object.values(x.valuesByMode)[0]!.kind === 'float')!;
      const k = Object.keys(v.valuesByMode)[0]!;
      v.valuesByMode[k] = { kind: 'float', value: (v.valuesByMode[k] as { value: number }).value + 1 };
    },
  });
  // Bridge's ship answers what it answered in Figma: it could not arm it, a developer adds it.
  p.routes.push((method, path) =>
    method === 'POST' && path === '/api/ship' ? { status: 200, body: { armed: false, route: 'waiting-for-developer', code: 'app_missing', reason: 'Bridge answered something unexpected: a developer adds it to the library.' } } : undefined,
  );
  await p.click('Push');
  await p.click('Scan for changes');
  await p.until(() => p.headline().includes('ready to send'));
  await p.click('Send for review');
  await p.until(() => p.calls.includes('POST /api/ship'), 10000);
  await p.settle(400);
  assert.equal(p.headline(), 'Sent for review');
  assert.equal(p.primary()?.textContent?.trim(), 'See it in Studio');
  assert.doesNotMatch(p.text(), /Waiting for a developer/);
  // What happened to the ship is said once, on the token's row, in calm words.
  assert.match(p.text(), /a developer adds it to the library/);
});
