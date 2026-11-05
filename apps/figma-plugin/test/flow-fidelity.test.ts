// Flow: a first pull, then Check fidelity from its result screen. While it runs, its progress leads the screen and
// nothing competes with it; once done, the headline is its result (never "Up to date"), with one action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('Check fidelity from the end of a pull: progress first, then the result as the headline, with an action', async () => {
  const p = await openPlugin();
  await p.click('Check for updates');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);
  assert.equal(p.primary()?.textContent?.trim(), 'Compare with code', 'the next step after building components');
  // Reading the sets takes a moment in Figma: hold the answer to look at the running screen.
  const read = p.main['scan-generated']!;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  // The pull's re-read passes; the comparison's own read waits.
  let n = 0;
  p.main['scan-generated'] = async (x) => {
    if (++n === 2) await gate;
    return read(x);
  };
  await p.click('Compare with code');
  await p.until(() => p.headline() === 'Comparing with the code');
  const buttons = () => [...p.document.querySelectorAll('button')].map((b) => b.textContent?.trim());
  assert.ok(!buttons().includes('Check again'), 'no Check again while it runs');
  // Nothing counted yet (the code images are being read): a bar without a percentage, and the words.
  const bar = p.document.querySelector('.group [data-progress="compare"] [role="progressbar"]');
  assert.ok(bar, 'a progress bar under the headline');
  assert.equal(bar!.getAttribute('aria-valuenow'), null);
  assert.equal(bar!.getAttribute('aria-valuetext'), 'Reading the images of the code');
  release();
  await p.until(() => p.headline() === "Can't compare yet");
  assert.doesNotMatch(p.headline(), /up to date/i);
  assert.ok(buttons().includes('Copy for your developer'), 'one action for the designer');
  assert.ok(buttons().includes('Check again'), 'the bar is back once it is done');
  // The comparison sits right under the headline, above the components.
  const sections = [...p.document.querySelectorAll('main > section, main > .group')].map((s) => s.textContent ?? '');
  assert.match(sections[1] ?? '', /Compare with code/);
});
