import assert from 'node:assert/strict';
import { test } from 'vitest';
import { formatValue } from '../src/values';
import { cssOf } from '../src/css-overrides';

test('a duration reads as a number with its unit, never the DTCG object', () => {
  assert.equal(formatValue('duration', { value: 300, unit: 'ms' }), '300ms');
  assert.equal(formatValue('', { value: 0.4, unit: 's' }), '0.4s');
  assert.equal(cssOf('duration', { value: 150, unit: 'ms' }), '150ms');
});

test('a color read without its type shows its hex', () => {
  assert.equal(formatValue('', { colorSpace: 'srgb', components: [1, 0, 0], hex: '#FF0000' }), '#ff0000');
});

test('other composite values keep their JSON', () => {
  assert.equal(formatValue('shadow', { x: 1 }), '{"x":1}');
});
