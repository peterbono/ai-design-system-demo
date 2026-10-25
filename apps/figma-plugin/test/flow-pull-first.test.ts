// Flow: the Pull start screen of a file never pulled. Getting the design system is the one job: "How it works" is open,
// there is nothing to compare with code yet, and the footer holds one action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('first time: How it works open, no Compare with code, one footer action', async () => {
  const p = await openPlugin();
  assert.equal(p.headline(), 'Get your design system');
  assert.ok([...p.document.querySelectorAll('main h2')].some((h) => h.textContent === 'How it works'), 'the steps are open');
  assert.ok(!p.document.querySelector('[data-how="updates"]'), 'not folded');
  assert.ok(!p.document.querySelector('[data-block="compare"]'), 'nothing to compare before a first pull');
  assert.doesNotMatch(p.text(), /Compare with code|fidelity/i);
  const bar = [...p.document.querySelectorAll('.bar button')].map((b) => b.textContent?.trim());
  assert.deepEqual(bar, ['Check for updates']);
});
