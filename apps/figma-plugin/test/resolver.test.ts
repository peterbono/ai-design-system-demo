import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findReferenceProblems, resolve } from '../src/core/resolver';
import { indexByPath } from '../src/core/token-set';
import { realSet, tok } from './helpers';

test('resolves semantic aliases of the real files to primitives, per theme', () => {
  const set = realSet();
  const light = resolve(set.byPath, 'color.action.primary.bg', 'light');
  const dark = resolve(set.byPath, 'color.action.primary.bg', 'dark');
  assert.deepEqual(light.chain, ['color.action.primary.bg', 'color.brand.600']);
  assert.deepEqual(dark.chain, ['color.action.primary.bg', 'color.brand.400']);
  assert.equal(light.error, undefined);
  assert.equal((light.value as { hex: string }).hex.length, 7);
  assert.deepEqual(findReferenceProblems(set.byPath, ['light', 'dark']), []);
});

test('follows multi-step chains', () => {
  const idx = indexByPath([
    tok('a', { light: '{b}' }),
    tok('b', { light: '{c}' }),
    tok('c', { value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' } }),
  ]);
  const r = resolve(idx, 'a', 'light');
  assert.deepEqual(r.chain, ['a', 'b', 'c']);
  assert.equal((r.value as { hex: string }).hex, '#000000');
});

test('detects cycles', () => {
  const idx = indexByPath([tok('a', { light: '{b}' }), tok('b', { light: '{c}' }), tok('c', { light: '{a}' })]);
  const r = resolve(idx, 'a', 'light');
  assert.equal(r.error, 'cycle');
  assert.deepEqual(r.chain, ['a', 'b', 'c', 'a']);
  const problems = findReferenceProblems(idx, ['light']);
  assert.equal(problems.filter((p) => p.kind === 'cycle').length, 3);
});

test('detects self references', () => {
  const idx = indexByPath([tok('a', { light: '{a}' })]);
  assert.equal(resolve(idx, 'a', 'light').error, 'cycle');
});

test('detects broken references, including inside composite values', () => {
  const idx = indexByPath([
    tok('a', { light: '{missing.token}' }),
    tok('shadow.x', { value: { color: '{color.nope}', offsetX: { value: 0, unit: 'px' } } }, { type: 'shadow' }),
  ]);
  const r = resolve(idx, 'a', 'light');
  assert.equal(r.error, 'broken');
  assert.equal(r.at, 'missing.token');
  const problems = findReferenceProblems(idx, ['light']);
  assert.deepEqual(
    problems.map((p) => [p.path, p.kind, p.target]),
    [
      ['a', 'broken', 'missing.token'],
      ['shadow.x', 'broken', 'color.nope'],
    ],
  );
});
