import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastLevel, contrastRatio, contrastScope, evaluatePairs, parseContrastChecks, pairKey } from '../src/wcag';
import { TOKENS_DIR, realChecksText, realSet } from './helpers';

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

test('contrast.checks.json parses to pairs with a minimum; kind is derived from it', () => {
  const pairs = parseContrastChecks('{"$description":"x","pairs":[["a","b",4.5],["c","d",3],["bad"],{"fg":"e"},["f","g","7"]]}');
  assert.deepEqual(pairs, [
    { foreground: 'a', background: 'b', min: 4.5, kind: 'text' },
    { foreground: 'c', background: 'd', min: 3, kind: 'ui' },
  ]);
  assert.deepEqual(parseContrastChecks(undefined), []);
  assert.deepEqual(parseContrastChecks('{"$description":"no pairs"}'), []);
  // The pair's own minimum decides pass or fail.
  assert.equal(contrastLevel(4, 'ui', 4.2), 'fail');
});

test('every pair in contrast.checks.json resolves and passes in every brand x theme', () => {
  const pairs = parseContrastChecks(realChecksText());
  assert.ok(pairs.length >= 20);
  const set = realSet();
  const results = evaluatePairs(set.byPath, pairs, contrastScope(set));
  assert.equal(results.length, pairs.length * 4);
  for (const r of results) {
    assert.equal(r.error, undefined, r.error);
    assert.notEqual(r.level, 'fail', `${r.pair.foreground} on ${r.pair.background} (${r.brand} ${r.theme}) = ${r.ratio}`);
  }
});

test('plugin ratios match the token build (dist/resolved.json), brand overrides included', () => {
  const resolved = JSON.parse(readFileSync(join(TOKENS_DIR, '../dist/resolved.json'), 'utf8')) as {
    contrast: { brand: string; theme: string; fg: string; bg: string; ratio: number }[];
  };
  const set = realSet();
  const mine = new Map(evaluatePairs(set.byPath, parseContrastChecks(realChecksText()), contrastScope(set)).map((r) => [pairKey(r), r]));
  assert.equal(mine.size, resolved.contrast.length);
  for (const c of resolved.contrast) {
    const r = mine.get(`${c.brand}/${c.theme}:${c.fg}|${c.bg}`);
    assert.ok(r, `${c.brand}/${c.theme} ${c.fg} on ${c.bg} missing`);
    assert.ok(Math.abs(r.ratio! - c.ratio) <= 0.01, `${c.brand}/${c.theme} ${c.fg} on ${c.bg}: plugin ${r.ratio}, build ${c.ratio}`);
  }
});
