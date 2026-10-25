// Wide-gamut and perceptual CSS colors (what a page keeps in computed values) to the sRGB Figma paints.
import { describe, expect, it } from 'vitest';
import { cssColorsToRgb, withSrgbColors } from '../src';

const rgb = (s: string) => s.match(/\d+(\.\d+)?/g)!.map(Number);
const near = (a: string, b: number[]) => rgb(a).slice(0, 3).forEach((x, i) => expect(Math.abs(x - b[i]!)).toBeLessThanOrEqual(1));

describe('cssColorsToRgb', () => {
  it('converts oklch, oklab, lab, lch and color() to sRGB', () => {
    expect(cssColorsToRgb('oklch(0.205 0 0)')).toBe('rgb(23, 23, 23)');
    expect(cssColorsToRgb('oklch(97% 0 0)')).toBe('rgb(245, 245, 245)');
    near(cssColorsToRgb('oklab(0.628 0.2249 0.1258)'), [255, 0, 0]);
    near(cssColorsToRgb('lab(54.29 80.82 69.91)'), [255, 0, 0]);
    near(cssColorsToRgb('lch(54.29 106.84 40.85)'), [255, 0, 0]);
    expect(cssColorsToRgb('color(srgb 1 0 0 / 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
    // Outside sRGB: clipped.
    expect(cssColorsToRgb('color(display-p3 1 0 0)')).toBe('rgb(255, 0, 0)');
  });

  it('leaves other values alone and converts every color inside a longer value', () => {
    expect(cssColorsToRgb('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(cssColorsToRgb('8px')).toBe('8px');
    expect(cssColorsToRgb('color(a98-rgb 1 0 0)')).toBe('color(a98-rgb 1 0 0)');
    expect(cssColorsToRgb('oklch(0.205 0 0) 0px 1px 2px 0px, oklch(97% 0 0 / 0.1) 0px 0px 1px 0px')).toBe('rgb(23, 23, 23) 0px 1px 2px 0px, rgba(245, 245, 245, 0.1) 0px 0px 1px 0px');
    expect(withSrgbColors({ style: { color: 'oklch(0.205 0 0)', width: '4px' }, svg: '<path fill="oklch(0.205 0 0)"/>', n: 2 })).toEqual({ style: { color: 'rgb(23, 23, 23)', width: '4px' }, svg: '<path fill="rgb(23, 23, 23)"/>', n: 2 });
  });
});
