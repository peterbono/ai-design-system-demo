import assert from 'node:assert/strict';
import { test } from 'vitest';
import { findReferenceProblems, resolve } from '../src/resolver';
import { defaultContext, indexByPath } from '../src/token-set';
import { realSet, tok } from './helpers';

const LIGHT = { theme: 'light' };

test('resolves semantic -> palette -> primitive per brand x theme, with brand overrides', () => {
  const set = realSet();
  const ctx = (brand: string, theme: string) => ({ ...defaultContext(set), brand, theme });
  const bridgeLight = resolve(set.byPath, 'color.action.primary.bg', ctx('bridge', 'light'));
  assert.equal(bridgeLight.error, undefined);
  assert.equal(bridgeLight.chain[0], 'color.action.primary.bg');
  assert.match(bridgeLight.chain[1]!, /^palette\./, 'semantic points to a palette role');
  assert.match(bridgeLight.chain.at(-1)!, /^color\./, 'palette points to a primitive');
  assert.deepEqual(bridgeLight.via, bridgeLight.chain.map(() => 'token'));
  assert.equal((bridgeLight.value as { hex: string }).hex.length, 7);
  // Ocean overrides the primary action per theme: the first step comes from brands/ocean.light.
  const oceanLight = resolve(set.byPath, 'color.action.primary.bg', ctx('ocean', 'light'));
  assert.equal(oceanLight.via[0], 'override');
  assert.match(oceanLight.chain[1]!, /^palette\./, 'the override points to a palette role');
  // Same semantic alias, different brand: the palette role re-points to another ramp.
  const bridgeBg = resolve(set.byPath, 'color.bg.subtle', ctx('bridge', 'light'));
  const oceanBg = resolve(set.byPath, 'color.bg.subtle', ctx('ocean', 'light'));
  assert.equal(bridgeBg.chain[1], oceanBg.chain[1]);
  assert.notEqual(bridgeBg.chain[2], oceanBg.chain[2]);
  assert.deepEqual(findReferenceProblems(set.byPath, { brand: ['bridge', 'ocean'], theme: ['light', 'dark'], density: ['comfortable', 'compact'] }), []);
});

test('density tokens resolve per density', () => {
  const set = realSet();
  const comfy = resolve(set.byPath, 'control.height.md', { ...defaultContext(set), density: 'comfortable' });
  const compact = resolve(set.byPath, 'control.height.md', { ...defaultContext(set), density: 'compact' });
  assert.notDeepEqual(comfy.value, compact.value);
});

test('follows multi-step chains', () => {
  const idx = indexByPath([
    tok('a', { light: '{b}' }),
    tok('b', { light: '{c}' }),
    tok('c', { value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' } }),
  ]);
  const r = resolve(idx, 'a', LIGHT);
  assert.deepEqual(r.chain, ['a', 'b', 'c']);
  assert.equal((r.value as { hex: string }).hex, '#000000');
});

test('detects cycles', () => {
  const idx = indexByPath([tok('a', { light: '{b}' }), tok('b', { light: '{c}' }), tok('c', { light: '{a}' })]);
  const r = resolve(idx, 'a', LIGHT);
  assert.equal(r.error, 'cycle');
  assert.deepEqual(r.chain, ['a', 'b', 'c', 'a']);
  const problems = findReferenceProblems(idx, { theme: ['light'] });
  assert.equal(problems.filter((p) => p.kind === 'cycle').length, 3);
});

test('detects self references', () => {
  const idx = indexByPath([tok('a', { light: '{a}' })]);
  assert.equal(resolve(idx, 'a', LIGHT).error, 'cycle');
});

test('detects broken references, including inside composite values', () => {
  const idx = indexByPath([
    tok('a', { light: '{missing.token}' }),
    tok('shadow.x', { value: { color: '{color.nope}', offsetX: { value: 0, unit: 'px' } } }, { type: 'shadow' }),
  ]);
  const r = resolve(idx, 'a', LIGHT);
  assert.equal(r.error, 'broken');
  assert.equal(r.at, 'missing.token');
  const problems = findReferenceProblems(idx, { theme: ['light'] });
  assert.deepEqual(
    problems.map((p) => [p.path, p.kind, p.target]),
    [
      ['a', 'broken', 'missing.token'],
      ['shadow.x', 'broken', 'color.nope'],
    ],
  );
});
