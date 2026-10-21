import { describe, expect, it } from 'vitest';
import type { RepoModel } from '@bridge-ds/core';
import { safeCustomPropertyName, safeSpecimenValue, tokenSpecimens } from './token-specimens';

const row = (path: string, type: string, css: string) => ({
  path,
  segments: path.split('.'),
  type,
  modes: { light: { alias: null, chain: [], css } },
  brands: { acme: { light: { alias: null, chain: [], css } } },
});
const prim = (path: string, type: string, css: string) => ({ path, segments: path.split('.'), type, css });

const model = (semantic: unknown[], primitives: unknown[] = []) =>
  ({ tokens: { rows: { defaultBrand: 'acme', themes: ['light', 'dark'], semantic, brand: [], density: [], component: [], primitives } } }) as unknown as Pick<RepoModel, 'tokens'>;

describe('token specimens', () => {
  it('drops values that could load a resource or leave the declaration', () => {
    expect(safeSpecimenValue('#fff')).toBe('#fff');
    expect(safeSpecimenValue('0 1px 2px rgba(0,0,0,.2)')).toBe('0 1px 2px rgba(0,0,0,.2)');
    for (const bad of ['url(https://x)', 'red;background:red', 'image-set("a" 1x)', 'expression(alert(1))', 'a\\62', '@import', 'red}', '</style>', 'src(x)', ''])
      expect(safeSpecimenValue(bad)).toBeNull();
    expect(safeSpecimenValue(42)).toBeNull();
  });

  it('custom property names stay [a-z0-9-]', () => {
    expect(safeCustomPropertyName('color.bg.Canvas')).toBe('--color-bg-canvas');
    expect(safeCustomPropertyName('color.bg;x')).toBeNull();
    expect(safeCustomPropertyName('a b')).toBeNull();
  });

  it('picks roles first at the default brand and first theme, skipping unsafe values', () => {
    const s = tokenSpecimens(
      model([
        row('color.bg.canvas', 'color', '#ffffff'),
        row('color.bg.evil', 'color', 'url(https://evil)'),
        row('radius.control', 'dimension', '6px'),
        row('space.4', 'dimension', '16px'),
        row('font.size.body', 'dimension', '16px'),
        row('font.family.body', 'fontFamily', '"Inter", sans-serif'),
        row('shadow.raised', 'shadow', '0 1px 2px #0003'),
      ]),
    );
    expect(s).toMatchObject({ brand: 'acme', theme: 'light', family: '"Inter", sans-serif', total: 5 });
    expect(s.color).toEqual([{ path: 'color.bg.canvas', value: '#ffffff' }]);
    expect(s.radius[0]!.path).toBe('radius.control');
    expect(s.space[0]!.path).toBe('space.4');
    expect(s.type[0]!.path).toBe('font.size.body');
    expect(s.shadow[0]!.path).toBe('shadow.raised');
  });

  it('falls back to primitives for a kind the roles do not cover', () => {
    const s = tokenSpecimens(model([], [prim('palette.blue.500', 'color', '#0057ff')]));
    expect(s.color).toEqual([{ path: 'palette.blue.500', value: '#0057ff' }]);
    expect(tokenSpecimens(model([])).total).toBe(0);
  });
});
