// Flow: Apply to Figma on a first pull builds 62 component sets, which takes minutes on a big design system. The action
// bar shows one bar: the step in words ("Building Accordion, 6 of 62"), the percentage, and the time left once Bridge
// has seen a few sets, next to Stop.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('Update: a bar with the set being built, the percentage and the time left, next to Stop', async () => {
  const p = await openPlugin();
  const win = p.document.defaultView!;
  const post = (message: string, done?: number, total?: number) => win.postMessage({ pluginMessage: { kind: 'progress', message, ...(total ? { done, total } : {}) } }, '*');
  // The clock moves 20 s a set without the test waiting for it.
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const build = p.main['apply-components']!;
  p.main['apply-components'] = async (m) => {
    await gate;
    return build(m);
  };
  const bar = () => p.document.querySelector('.bar [data-progress="busy"]');
  const track = () => bar()?.querySelector('[role="progressbar"]');
  try {
    await p.click('Check for updates');
    await p.click('Apply to Figma');
    await p.until(() => p.calls.includes('apply-components'));

    // Drawing the slots: no count, the words with a bar that moves without a percentage.
    post('Drawing content slots');
    await p.until(() => bar()?.textContent?.includes('Drawing content slots') ?? false);
    assert.equal(track()!.getAttribute('aria-valuenow'), null);
    assert.equal(track()!.getAttribute('aria-valuetext'), 'Drawing content slots');
    assert.ok(track()!.classList.contains('indeterminate'));
    assert.ok(p.document.querySelector('[data-focus-id="stop-build"]'), 'Stop next to the bar');

    const names = ['Accordion', 'AlertDialog', 'Avatar', 'Badge', 'Breadcrumb', 'Button'];
    for (const [i, name] of names.entries()) {
      offset += 20_000;
      post(`Building ${name}, ${i + 1} of 62`, i, 62);
      await p.settle(10);
    }
    await p.until(() => bar()?.textContent?.includes('Building Button, 6 of 62') ?? false);
    assert.equal(track()!.getAttribute('aria-valuenow'), '5');
    assert.equal(track()!.getAttribute('aria-valuemax'), '62');
    assert.equal(bar()!.querySelector('.progress-pct')!.textContent, '8%');
    // 20 s a set, 57 left: about 19 minutes, said as a person says it.
    const eta = bar()!.querySelector('.progress-eta')!.textContent!;
    assert.match(eta, /^About (15|20) min left$/);
    assert.match(track()!.getAttribute('aria-valuetext')!, /^8%, 5 of 62, about (15|20) min left$/);
    assert.doesNotMatch(bar()!.textContent!, /\u2014/);
  } finally {
    Date.now = realNow;
    release();
  }
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);
  assert.equal(bar(), null, 'the bar goes once the work is done');
});
