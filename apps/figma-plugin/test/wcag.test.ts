import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrastLevel, contrastRatio, evaluatePairs, parseContrastPairs } from '../src/core/wcag';
import { realPairsText, realSet } from './helpers';

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('known contrast ratios', () => {
  near(contrastRatio('#000000', '#ffffff'), 21);
  near(contrastRatio('#ffffff', '#000000'), 21);
  near(contrastRatio('#ffffff', '#ffffff'), 1);
  near(contrastRatio('#777777', '#ffffff'), 4.48);
  near(contrastRatio('#767676', '#ffffff'), 4.54);
});

test('translucent foreground is composited over the background', () => {
  const half = { r: 0, g: 0, b: 0, a: 0.5 };
  const ratio = contrastRatio(half, '#ffffff');
  near(ratio, contrastRatio('#808080', '#ffffff'), 0.05);
});

test('levels per pair kind', () => {
  assert.equal(contrastLevel(21, 'text'), 'AAA');
  assert.equal(contrastLevel(5, 'text'), 'AA');
  assert.equal(contrastLevel(4.49, 'text'), 'fail');
  assert.equal(contrastLevel(3.1, 'ui'), 'AA');
  assert.equal(contrastLevel(3.1, 'large-text'), 'AA');
});

test('every declared pair resolves and passes AA on the real tokens', () => {
  const pairs = parseContrastPairs(realPairsText());
  assert.ok(pairs.length >= 20);
  const set = realSet();
  const results = evaluatePairs(set.byPath, pairs, ['light', 'dark']);
  assert.equal(results.length, pairs.length * 2);
  for (const r of results) {
    assert.equal(r.error, undefined, r.error);
    assert.notEqual(r.level, 'fail', `${r.pair.foreground} on ${r.pair.background} (${r.mode}) = ${r.ratio}`);
  }
});
