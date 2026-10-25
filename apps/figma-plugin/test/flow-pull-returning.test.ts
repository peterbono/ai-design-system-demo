// Flow: the Pull start screen of a file pulled before. Getting updates keeps the one footer action and folds its steps
// into "How updates work"; Compare with code is its own block below, with its last result and its own button, and runs
// with the progress row. "Check fidelity" is gone from the designer's words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('returning: How updates work folded, Compare with code its own block with the last result', async () => {
  const at = new Date();
  at.setHours(14, 50, 0, 0);
  const p = await openPlugin({ pulled: true, sync: { lastCompare: JSON.stringify({ components: 32, differs: 8, matches: 24, notChecked: 0, variantsChecked: 0, variantsSkipped: 0, at: at.toISOString() }) } });
  assert.equal(p.headline(), 'Get the latest design system');
  const how = p.document.querySelector<HTMLDetailsElement>('[data-how="updates"]');
  assert.ok(how && !how.open, 'How updates work: one folded line');
  assert.equal(how!.querySelector('summary')?.textContent, 'How updates work');

  const block = p.document.querySelector('[data-block="compare"]')!;
  assert.ok(block, 'Compare with code is its own block');
  assert.equal(block.querySelector('h2')?.textContent, 'Compare with code');
  assert.match(block.textContent ?? '', /Do the components in this file still look like the code\? Bridge compares each one with how it renders in code\./);
  assert.match(block.textContent ?? '', /8 differ, 24 match · compared today at/);
  assert.equal(block.querySelector('button')?.textContent, 'See the differences');
  // The footer: the one action of getting updates, never two competing "Check" buttons.
  assert.deepEqual([...p.document.querySelectorAll('.bar button')].map((b) => b.textContent?.trim()), ['Check for updates']);
  assert.doesNotMatch(p.text(), /Check fidelity|Claude/);

  // Running it: the progress row leads, then its result is the headline.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  p.main['scan-generated'] = async () => {
    if (++n === 2) await gate;
    return [];
  };
  await p.click('See the differences');
  await p.until(() => !!p.document.querySelector('[role="status"].loading'));
  release();
  await p.until(() => /No component set from code in this file yet/.test(p.text()));
});
