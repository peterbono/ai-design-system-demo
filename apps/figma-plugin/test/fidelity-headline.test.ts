// The comparison's headline says what the designer learns, and a differing set gets one plain sentence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { differsSentence, fidelityHeadline } from '../src/sync/fidelity';

const done = (differs: number, matches: number, notChecked = 0) =>
  ({ kind: 'done', items: [], report: { summary: { components: differs + matches + notChecked, differs, matches, notChecked, variantsChecked: 0, variantsSkipped: 0 } } }) as never;

test('the headline follows the comparison, never "Up to date"', () => {
  assert.equal(fidelityHeadline({ running: 'Reading the images of the code' }), 'Comparing with the code');
  assert.equal(fidelityHeadline({ error: 'x' }), 'Could not compare with the code');
  assert.equal(fidelityHeadline({ outcome: { kind: 'no-references' } }), "Can't compare yet");
  assert.equal(fidelityHeadline({ outcome: done(1, 2) }), '1 component differs from the code');
  assert.equal(fidelityHeadline({ outcome: done(3, 0) }), '3 components differ from the code');
  assert.equal(fidelityHeadline({ outcome: done(0, 4) }), 'Figma matches the code');
  assert.equal(fidelityHeadline({ outcome: done(0, 0, 2) }), 'Nothing could be compared');
});

test('a set that differs gets a sentence, not pixel figures', () => {
  assert.equal(differsSentence({ differing: 1, checked: 1 }), 'Looks different from the code.');
  assert.equal(differsSentence({ differing: 2, checked: 6 }), 'Looks different from the code in 2 of 6 variants.');
});

test('a set drawn at another size says the size, not a small pixel score', () => {
  const size = (figma: [number, number], code: [number, number]) => ({ figma: { width: figma[0], height: figma[1] }, code: { width: code[0], height: code[1] } });
  assert.equal(
    differsSentence({ differing: 2, checked: 2, worst: { size: size([375, 89], [375, 48]) } }),
    'Looks different from the code in 2 of 2 variants: height 89 in Figma vs 48 in code.',
  );
  // Within the size tolerance: nothing to add.
  assert.equal(differsSentence({ differing: 1, checked: 1, worst: { size: size([90, 40], [89, 40]) } }), 'Looks different from the code.');
});
