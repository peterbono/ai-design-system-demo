// The plugin's Field Guide drawings (moments included) are copies of the brand's, never redrawn: same geometry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ILLUSTRATIONS as BRAND } from '../../docs-site/src/brand/illustrations';
import { ILLUSTRATIONS } from '../src/ui/illustrations';

test('every plugin drawing is the brand drawing of the same name', () => {
  for (const [name, art] of Object.entries(ILLUSTRATIONS)) {
    const brand = (BRAND as Record<string, { viewBox: string; svg: string }>)[name];
    assert.ok(brand, `${name} exists in apps/docs-site/src/brand/illustrations.ts`);
    assert.equal(art.viewBox, brand.viewBox, `${name} viewBox`);
    assert.equal(art.svg, brand.svg, `${name} geometry`);
  }
});

test('drawings carry no color: strokes follow the theme, fills are named roles', () => {
  for (const [name, art] of Object.entries(ILLUSTRATIONS)) assert.doesNotMatch(art.svg, /#[0-9a-f]{3,8}\b|rgb\(/i, name);
});
