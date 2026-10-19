import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildFidelityReport,
  compareImages,
  fidelityComponentLine,
  fidelityVerdict,
  parseComponentSpecs,
  planReference,
  planReferences,
  referenceImagePath,
  summarizeComponent,
  type RgbaImage,
} from '../src';

// Synthetic images: a white canvas with filled rectangles and one-pixel lines.
type Rgb = [number, number, number];
function canvas(width: number, height: number, bg: Rgb | null = [255, 255, 255]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (bg) for (let i = 0; i < width * height; i++) data.set([...bg, 255], i * 4);
  return { width, height, data };
}
function rect(img: RgbaImage, x: number, y: number, w: number, h: number, c: Rgb, alpha = 255): RgbaImage {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) img.data.set([...c, alpha], (yy * img.width + xx) * 4);
  return img;
}
const button = (w = 80, h = 40, fill: Rgb = [11, 74, 139]) => {
  const img = rect(canvas(w, h), 0, 0, w, h, fill);
  // A "label": two short bars of white.
  rect(img, 20, 16, 30, 4, [255, 255, 255]);
  rect(img, 20, 22, 20, 3, [255, 255, 255]);
  return img;
};

describe('compareImages', () => {
  it('matches identical images', () => {
    const r = compareImages(button(), button());
    expect(r).toMatchObject({ matches: true, percent: 0, differentPixels: 0, sizeMatches: true, size: { figma: { width: 40, height: 20 }, code: { width: 40, height: 20 } } });
    expect(r.diff).toMatchObject({ width: 80, height: 40 });
  });

  it('tolerates text drawn one device pixel away (font rasterization)', () => {
    const a = button();
    const b = rect(canvas(80, 40), 0, 0, 80, 40, [11, 74, 139]);
    rect(b, 21, 17, 30, 4, [255, 255, 255]);
    rect(b, 21, 23, 20, 3, [255, 255, 255]);
    const r = compareImages(a, b);
    expect(r.matches).toBe(true);
    expect(r.differentPixels).toBe(0);
  });

  it('tolerates antialiasing: half-covered edge pixels', () => {
    const a = button();
    const b = button();
    // Antialiased column on the label's right edge in one image only.
    rect(b, 50, 16, 1, 4, [133, 165, 197]);
    expect(compareImages(a, b).matches).toBe(true);
  });

  it('treats transparency as white, like a page', () => {
    const transparent = canvas(10, 10, null);
    const white = canvas(10, 10);
    expect(compareImages(transparent, white).percent).toBe(0);
  });

  it('flags another fill color (a token swap)', () => {
    const r = compareImages(button(80, 40, [11, 74, 139]), button(80, 40, [180, 40, 40]));
    expect(r.matches).toBe(false);
    expect(r.percent).toBeGreaterThan(80);
  });

  it('flags a missing one-pixel border, even though white is nearby', () => {
    const code = rect(canvas(80, 40), 0, 0, 80, 1, [200, 200, 200]);
    rect(code, 0, 39, 80, 1, [200, 200, 200]);
    rect(code, 0, 0, 1, 40, [200, 200, 200]);
    rect(code, 79, 0, 1, 40, [200, 200, 200]);
    const figma = canvas(80, 40);
    const r = compareImages(figma, code, { maxPercent: 1 });
    expect(r.differentPixels).toBe(236);
    expect(r.matches).toBe(false);
  });

  it('reports a size difference in CSS pixels and counts the missing area', () => {
    const r = compareImages(button(84, 40), button(80, 40));
    expect(r.sizeMatches).toBe(false);
    expect(r.size).toEqual({ figma: { width: 42, height: 20 }, code: { width: 40, height: 20 } });
    expect(r.matches).toBe(false);
    expect(r.diff).toMatchObject({ width: 84, height: 40 });
  });

  it('accepts one CSS pixel of size difference by default', () => {
    const r = compareImages(button(82, 40), button(80, 40), { maxPercent: 5 });
    expect(r.sizeMatches).toBe(true);
  });

  it('flags other padding: content shifted by more than the radius', () => {
    const code = button();
    const figma = rect(canvas(80, 40), 0, 0, 80, 40, [11, 74, 139]);
    rect(figma, 28, 16, 30, 4, [255, 255, 255]);
    rect(figma, 28, 22, 20, 3, [255, 255, 255]);
    const r = compareImages(figma, code, { maxPercent: 1 });
    expect(r.matches).toBe(false);
  });

  it('paints differences red on a faded copy of the code image', () => {
    const r = compareImages(rect(canvas(4, 4), 0, 0, 1, 1, [0, 0, 0]), canvas(4, 4), { radius: 0 });
    expect(Array.from(r.diff!.data.slice(0, 4))).toEqual([220, 38, 38, 255]);
    expect(Array.from(r.diff!.data.slice(4, 8))).toEqual([255, 255, 255, 255]);
  });

  it('can skip the diff image', () => {
    expect(compareImages(button(), button(), { diffImage: false }).diff).toBeUndefined();
  });
});

describe('verdicts and report', () => {
  const size = (w: number, h: number) => ({ width: w, height: h });
  it('words a variant like a designer reads it', () => {
    expect(fidelityVerdict({ status: 'matches', percent: 0.4, size: { figma: size(40, 20), code: size(40, 20) } })).toBe('Matches the code');
    expect(fidelityVerdict({ status: 'differs', percent: 12.3, size: { figma: size(120, 40), code: size(118, 40) } })).toBe(
      'Differs from the code: 12% of pixels, size 120x40 vs 118x40',
    );
    expect(fidelityVerdict({ status: 'differs', percent: 4.26, size: { figma: size(40, 20), code: size(40, 20) } })).toBe('Differs from the code: 4.3% of pixels');
    expect(fidelityVerdict({ status: 'skipped', reason: 'the Loading state has no code equivalent to render' })).toBe(
      'Not compared: the Loading state has no code equivalent to render',
    );
  });

  it('rolls variants up into a component with its worst variant', () => {
    const c = summarizeComponent('Card', [
      { key: 'Padding=none', status: 'skipped', reason: 'Figma shows a placeholder' },
      { key: 'Padding=compact', status: 'matches', percent: 0.5, size: { figma: size(320, 120), code: size(320, 120) } },
      { key: 'Padding=default', status: 'differs', percent: 14, size: { figma: size(320, 139), code: size(320, 150) } },
    ]);
    expect(c).toMatchObject({ status: 'differs', checked: 2, differing: 1, skipped: 1, worst: { key: 'Padding=default', percent: 14 } });
    expect(fidelityComponentLine(c)).toBe('Differs from the code: 14% of pixels, size 320x139 vs 320x150 (1 of 2 variants)');
    const ok = summarizeComponent('Tag', [{ key: 'Size=sm', status: 'matches', percent: 0, size: { figma: size(40, 20), code: size(40, 20) } }]);
    expect(fidelityComponentLine(ok)).toBe('Matches the code');
    const none = summarizeComponent('X', [{ key: 'a', status: 'skipped', reason: 'no image of the code yet' }]);
    expect(none.status).toBe('not-checked');
    expect(fidelityComponentLine(none)).toBe('Not compared: no image of the code yet');
  });

  it('builds a storable JSON report', () => {
    const r = buildFidelityReport({
      components: [summarizeComponent('Tag', [{ key: 'Size=sm', status: 'matches', percent: 0, size: { figma: size(40, 20), code: size(40, 20) } }])],
      reference: { sha: 'abc', createdAt: '2026-10-19T00:00:00.000Z' },
      file: 'UI kit',
      now: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(r).toMatchObject({ version: 1, checkedAt: '2026-10-20T00:00:00.000Z', options: { scale: 2, threshold: 0.1, radius: 2, maxPercent: 3, sizeTolerance: 1 }, summary: { components: 1, matches: 1, variantsChecked: 1 } });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe('planReference: the code render of each generated variant', () => {
  const file = parseComponentSpecs(readFileSync(new URL('../../react/component-specs.json', import.meta.url), 'utf8'));
  const spec = (name: string) => file.components.find((c) => c.name === name)!;
  const variant = (name: string, props: Record<string, string>) => spec(name).variants.find((v) => Object.entries(props).every(([k, x]) => v.props[k] === x))!;

  it('Button: axes to props, State to a pseudo state or disabled, label to children', () => {
    expect(planReference(spec('Button'), variant('Button', { Variant: 'secondary', Size: 'sm', State: 'Hover' }), file)).toEqual({
      ok: true,
      render: { component: 'Button', props: { variant: 'secondary', size: 'sm' }, text: 'Button', pseudo: 'hover' },
    });
    const p = planReference(spec('Button'), variant('Button', { Variant: 'primary', Size: 'md', State: 'Disabled' }), file);
    expect(p).toMatchObject({ ok: true, render: { props: { disabled: true } } });
    expect(planReference(spec('Button'), variant('Button', { State: 'Pressed' }), file)).toMatchObject({ ok: true, render: { pseudo: 'active' } });
  });

  it('IconButton: the always-shown icon becomes the icon prop', () => {
    expect(planReference(spec('IconButton'), variant('IconButton', { Variant: 'ghost', Size: 'md', State: 'Default' }), file)).toMatchObject({
      ok: true,
      render: { component: 'IconButton', icons: { icon: 'Pencil' } },
    });
  });

  it('Input: placeholder text and fill width', () => {
    expect(planReference(spec('Input'), variant('Input', { Size: 'md', State: 'Default' }), file)).toEqual({
      ok: true,
      render: { component: 'Input', props: { size: 'md', placeholder: 'Placeholder' }, width: 'size.80' },
    });
  });

  it('Card: compound parts with the Figma texts; the media placeholder variant is skipped', () => {
    expect(planReference(spec('Card'), variant('Card', { Padding: 'compact' }), file)).toEqual({
      ok: true,
      render: {
        component: 'Card',
        props: { padding: 'compact' },
        parts: [
          { component: 'CardHeader', text: 'Header' },
          { component: 'CardBody', text: 'Body' },
          { component: 'CardFooter', text: 'Footer' },
        ],
        width: 'size.80',
      },
    });
    expect(planReference(spec('Card'), variant('Card', { Padding: 'none' }), file)).toEqual({
      ok: false,
      reason: 'Figma shows a placeholder (Slot/Media) that code has no example of',
    });
  });

  it('Checkbox: the Checked axis to checked and indeterminate; hidden optional texts are not passed', () => {
    expect(planReference(spec('Checkbox'), variant('Checkbox', { Checked: 'mixed', State: 'Default' }), file)).toEqual({
      ok: true,
      render: { component: 'Checkbox', props: { checked: false, indeterminate: true, label: 'Label' } },
    });
    expect(planReference(spec('Checkbox'), variant('Checkbox', { Checked: 'true', State: 'Hover' }), file)).toMatchObject({ ok: true, render: { props: { checked: true }, pseudo: 'hover' } });
  });

  it('skips states and axes code cannot render', () => {
    const s = spec('Tag');
    const v = { ...s.variants[0]!, props: { State: 'Loading' } };
    expect(planReference({ ...s, axes: [{ name: 'State', values: ['Loading'], default: 'Loading' }] }, v, file)).toEqual({ ok: false, reason: 'the Loading state has no code equivalent to render' });
    expect(planReference({ ...s, axes: [{ name: 'Shape', values: ['round'], default: 'round' }] }, { ...v, props: { Shape: 'round' } }, file)).toEqual({
      ok: false,
      reason: 'Shape has no matching option in code',
    });
  });

  it('plans every variant of the current specs, with stable image paths', () => {
    const all = planReferences(file);
    expect(all.length).toBe(file.components.reduce((n, c) => n + c.variants.length, 0));
    const skipped = all.filter((x) => !x.plan.ok).map((x) => `${x.component} ${x.key}`);
    // Popups drawn open have no closed-state code image to match; the Card media placeholder has no code example.
    expect(skipped.filter((x) => !/\/Popup /.test(x))).toEqual(['Card Padding=none']);
    expect(all.filter((x) => /\/Popup$/.test(x.component)).every((x) => !x.plan.ok && /drawn open/.test(x.plan.reason))).toBe(true);
    expect(referenceImagePath('Button', 'Size=md, State=Default, Variant=primary')).toBe('button/size-md__state-default__variant-primary.png');
  });
});
