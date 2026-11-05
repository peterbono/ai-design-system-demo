// Flow: Claude's fixes after "Ask Claude to fix all", reopened after Check for updates. One sentence counts where they
// stand; each row says one status in designer words: the approved fixes are in this file (one calm line, next step
// Compare with code), the closed one was not kept, parts to draw say so, a component Bridge never measured says so
// instead of waiting, Claude not finishing is not "went quiet", and only an ask nothing came back from is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixRow, fixRowsSummary } from '../src/sync/fix-session';
import { openFixList } from './claude-fix-list';

const rowOf = (doc: Document, name: string) => [...doc.querySelectorAll('li.row')].find((li) => li.querySelector('.comp-name')?.textContent === name);
const statusOf = (doc: Document, name: string) => rowOf(doc, name)?.querySelector('[data-claude]');

test("Claude's fixes: one summary, one status per row, finished rows folded", async () => {
  const p = await openFixList();
  const d = p.document;
  const section = [...d.querySelectorAll('section.group')].find((s) => /Claude's fixes/.test(s.querySelector('h2')?.textContent ?? ''))!;
  assert.ok(section, 'the section shows');
  assert.equal(section.querySelector('.lede')!.textContent, "3 fixes in this file, 2 need drawing in Figma, 1 not measured yet, 1 waiting, 2 didn't finish, 1 not kept.");

  // Approved and brought in by Check for updates: one calm line, the next step in it, no steps, no buttons.
  for (const name of ['CheckboxGroup', 'CodeBlock', 'Form']) {
    const s = statusOf(d, name)!;
    assert.equal(s.getAttribute('data-claude'), 'in-file', name);
    assert.equal(s.textContent, "Claude's fix is in this file. Compare with code to check it.");
    assert.ok(!rowOf(d, name)!.querySelector('button, details'), `${name}: nothing to open or press`);
  }
  // Closed without merging: not kept, plainly.
  assert.equal(statusOf(d, 'Avatar')!.textContent, "Claude's fix was not kept. Nothing changes in this file.");
  // Finished rows are folded under one line.
  const done = section.querySelector<HTMLDetailsElement>('[data-block="claude-done"]')!;
  assert.equal(done.querySelector('summary')!.textContent, '4 finished');
  assert.equal(done.open, false);

  // Parts to draw: the reason, no developer to ask, What Claude did folded.
  const spinner = statusOf(d, 'Spinner')!;
  assert.equal(spinner.getAttribute('data-claude'), 'cant-fix');
  assert.equal(spinner.querySelector('[data-head]')!.textContent, "Claude can't fix this one");
  assert.equal(spinner.querySelector('p')!.textContent, 'The indicator is missing in Figma: draw it in the component, then compare with code again.');
  assert.ok(!spinner.querySelector('button'));
  assert.equal(spinner.querySelector<HTMLDetailsElement>('details')!.open, false);

  // Bridge has no measure of it: said, with the request for a developer, never "Waiting for Claude".
  const dialog = statusOf(d, 'AlertDialog')!;
  assert.equal(dialog.getAttribute('data-claude'), 'no-measure');
  assert.equal(dialog.querySelector('[data-head]')!.textContent, "Claude can't fix this one yet");
  assert.match(dialog.textContent ?? '', /Bridge hasn't measured it in code/);
  rowOf(d, 'AlertDialog')!.querySelector<HTMLButtonElement>('button')!.click();
  await p.until(() => p.copied.some((t) => /Could you get AlertDialog measured for Bridge/.test(t)));

  // Claude did something, then nothing more reached Bridge: not "went quiet".
  assert.equal(statusOf(d, 'Tooltip')!.querySelector('[data-head]')!.textContent, "Claude didn't finish this one");
  // Asked two hours ago, nothing ever came back: "Claude went quiet". Asked a minute ago: waiting.
  assert.equal(statusOf(d, 'Menu')!.querySelector('[data-head]')!.textContent, 'Claude went quiet');
  assert.equal(statusOf(d, 'Popover')!.querySelector('[data-head]')!.textContent, 'Waiting for Claude');

  // What the designer acts on comes first; finished rows last.
  const order = [...section.querySelectorAll('li.row .comp-name')].map((n) => n.textContent);
  assert.deepEqual(order.slice(0, 2), ['Spinner', 'Switch']);
  assert.deepEqual(order.slice(-4), ['CheckboxGroup', 'CodeBlock', 'Form', 'Avatar']);
  assert.doesNotMatch(p.text(), /—/);
});

test('fixRow: merged before the last Check for updates is in this file; after it, approved and waiting for it', () => {
  const s = { component: 'X', state: 'ready' as const, startedAt: null, updatedAt: null, elapsed: 0, quiet: false, maxRounds: 3, steps: [], pr: { number: 1, url: 'u' } };
  const now = Date.parse('2026-11-05T13:00:00Z');
  assert.equal(fixRow('X', { session: s, outcome: { state: 'merged', mergedAt: '2026-11-05T12:39:00Z' }, lastPullAt: '2026-11-05T12:40:00Z', now }).kind, 'in-file');
  assert.equal(fixRow('X', { session: s, outcome: { state: 'merged', mergedAt: '2026-11-05T12:39:00Z' }, lastPullAt: '2026-11-05T12:00:00Z', now }).text, "Claude's fix is approved. Check for updates brings it into this file.");
  assert.equal(fixRow('X', { session: s, outcome: { state: 'closed' }, now }).kind, 'not-kept');
  assert.equal(fixRow('X', { session: s, now }).kind, 'ready');
  assert.equal(fixRow('X', { askedAt: '2026-11-05T12:55:00Z', now }).kind, 'waiting');
  assert.equal(fixRow('X', { askedAt: '2026-11-05T12:55:00Z', measured: false, now }).kind, 'no-measure');
  assert.equal(fixRow('X', { askedAt: '2026-11-05T11:00:00Z', now }).text, 'Claude went quiet');
  assert.equal(fixRowsSummary([]), '');
  assert.equal(fixRowsSummary([{ kind: 'in-file', text: '' }, { kind: 'cant-fix', text: '', hint: 'The dot is missing in Figma' }, { kind: 'cant-fix', text: '', hint: 'No closer' }]), '1 fix in this file, 1 needs drawing in Figma, 1 Claude can\'t fix.');
});
