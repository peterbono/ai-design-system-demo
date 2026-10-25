// Flow: an edit to a shared color breaks a hundred contrast pairs. The panel says it once, in one line, with the pairs
// folded in the same place, and an action: leave the edit out of this send (finding 2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('a contrast blocker is one line in one place, with "Leave it out of this send"', async () => {
  const p = await openPlugin({
    pulled: true,
    edit: (s) => {
      const prim = s.collections.find((c) => c.name === 'Primitives')!;
      const v = s.variables.find((x) => x.collectionId === prim.id && x.name === 'color/white')!;
      const k = Object.keys(v.valuesByMode)[0]!;
      v.valuesByMode[k] = { kind: 'color', r: 0.1, g: 0.3, b: 0.6, a: 1 };
    },
  });
  await p.click('Push');
  await p.click('Scan for changes');
  await p.until(() => /to fix before sending/.test(p.headline()));
  const callout = p.document.querySelector('.callout.error')!;
  const lines = [...callout.querySelectorAll(':scope > ul > li')];
  assert.equal(lines.length, 1, 'one line for every failing pair');
  assert.match(lines[0]!.textContent ?? '', /color pairs are too low in contrast on their backgrounds/);
  // The pairs are in that callout only: no chips under the variable, no second Contrast section.
  const pills = [...p.document.querySelectorAll('.pill.fail')];
  assert.ok(pills.length > 0 && pills.every((x) => callout.contains(x)), 'failing pairs only inside the blocker');
  assert.ok(![...p.document.querySelectorAll('main h2')].some((x) => x.textContent === 'Contrast'), 'no separate Contrast section');
  assert.ok([...callout.querySelectorAll('button')].some((b) => b.textContent === 'Show the edit'));
  await p.click('Leave it out of this send');
  await p.until(() => !p.document.querySelector('.callout.error'));
  assert.doesNotMatch(p.headline(), /to fix before sending/);
});
