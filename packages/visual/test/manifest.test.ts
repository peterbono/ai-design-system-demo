import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { boxesFromCells, decodePng, diffPngs, encodePng, padTo } from '../src/diff';
import { COMMENT_MARKER, groupByLabel, hasVisualChange, pickImages, rankShots, renderComment, summarize, summaryLine } from '../src/manifest';
import { routeUrl, shotKey, storyUrl } from '../src/routes';
import type { Manifest, ShotResult } from '../src/types';

const shot = (over: Partial<ShotResult>): ShotResult => ({
  key: 'k',
  kind: 'story',
  label: 'Feedback/Alert: All states',
  storyId: 'feedback-alert--all-states',
  brand: 'bridge',
  theme: 'light',
  status: 'unchanged',
  changedPixels: 0,
  totalPixels: 100,
  percent: 0,
  boxes: [],
  size: { before: { width: 10, height: 10 }, after: { width: 10, height: 10 } },
  images: {},
  ...over,
});

const manifest = (shots: ShotResult[]): Manifest => ({
  version: 1,
  tool: '@bridge-ds/visual',
  createdAt: '2026-10-16T00:00:00.000Z',
  durationMs: 61_000,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  head: { ref: 'bridge/danger', sha: 'b'.repeat(40) },
  options: { only: ['stories', 'app'], threshold: 0.1, viewport: { stories: { width: 1024, height: 768 }, app: { width: 1280, height: 800 } } },
  selection: {
    tokens: [
      { path: 'palette.danger.600', kind: 'direct', modes: ['brand=bridge,theme=light'] },
      { path: 'color.feedback.danger.solid', kind: 'alias', modes: ['brand=bridge,theme=light'] },
    ],
    vars: ['--palette-danger-600', '--color-feedback-danger-solid'],
    files: ['packages/tokens/src/brands/bridge.tokens.json'],
    components: [{ id: 'Alert', reasons: ['uses --color-feedback-danger-solid'], indirect: false }],
    stories: ['feedback-alert--all-states'],
    fallback: null,
    app: { include: true, reason: '2 token values changed' },
  },
  summary: summarize(shots),
  shots,
});

const SHOTS = [
  shot({ key: 'a', status: 'unchanged' }),
  shot({ key: 'b', status: 'changed', percent: 1.5, changedPixels: 150, label: 'Orders | list', kind: 'route', tenant: 'harbor', brand: 'ocean', theme: 'dark', images: { before: 'before/b.png', after: 'after/b.png', diff: 'diff/b.png', composite: 'composite/b.png' } }),
  shot({ key: 'c', status: 'changed', percent: 4.25, changedPixels: 425, images: { composite: 'composite/c.png' } }),
  shot({ key: 'd', status: 'error', error: 'Timeout 15000ms exceeded' }),
];

describe('manifest', () => {
  it('summarizes and ranks shots: largest change first, unchanged last', () => {
    const m = manifest(SHOTS);
    expect(m.summary).toEqual({ shots: 4, changed: 2, unchanged: 1, added: 0, removed: 0, errors: 1, maxPercent: 4.25 });
    expect(rankShots(SHOTS).map((s) => s.key)).toEqual(['c', 'b', 'd', 'a']);
    expect(hasVisualChange(m)).toBe(true);
    expect(hasVisualChange(manifest([shot({})]))).toBe(false);
    expect(summaryLine(m)).toBe('2 of 4 screenshots changed, 1 failed between main (aaaaaaa) and bridge/danger (bbbbbbb). Largest change 4.25%.');
    expect(summaryLine(manifest([]))).toMatch(/^Nothing to capture/);
  });

  it('renders the sticky comment: marker, why, table, collapsed unchanged rows, composites from the image base', () => {
    const md = renderComment(manifest(SHOTS), { imageBase: 'https://raw.githubusercontent.com/o/r/bridge-visual/pr-7/bbb/', artifactUrl: 'https://github.com/o/r/actions/runs/1' });
    expect(md.startsWith(`${COMMENT_MARKER}\n## Visual impact`)).toBe(true);
    expect(md).toContain('Why these screens: 2 token values change (edited: `palette.danger.600`); components in scope: Alert.');
    // One row per story or screen, modes listed, largest change first.
    expect(md).toContain('| Story or screen | Changed in | Largest |');
    expect(md).toContain('| Feedback/Alert: All states | bridge light, bridge light (error) | 4.25% (Timeout 15000ms exceeded) |');
    expect(md).toContain('| Orders \\| list | harbor dark | 1.50% |');
    expect(md.indexOf('Feedback/Alert')).toBeLessThan(md.indexOf('Orders \\| list'));
    expect(md).toContain('<details><summary>1 unchanged (1 story or screen)</summary>');
    expect(md).toContain('![Feedback/Alert: All states, bridge, light](https://raw.githubusercontent.com/o/r/bridge-visual/pr-7/bbb/composite/c.png)');
    // App screens lead the images, then one image per story.
    expect(md.indexOf('composite/b.png')).toBeLessThan(md.indexOf('composite/c.png'));
    expect(md).toContain('[All images (workflow artifact)](https://github.com/o/r/actions/runs/1)');
    expect(md).toContain('Diffs never fail the check');
    expect(md).not.toMatch(/\u2014/);
  });

  it('says so when nothing changed, and shows no image section without an image base', () => {
    const md = renderComment(manifest([shot({}), shot({ key: 'x' })]));
    expect(md).toContain('0 of 2 screenshots changed');
    expect(md).not.toContain('### Before, after, diff');
    expect(md).not.toContain('| Story or screen | Changed in | Largest |');
  });
});

const solid = (w: number, h: number, rgb: [number, number, number]) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) p.data.set([...rgb, 255], i);
  return p;
};
const paint = (p: PNG, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p.data.set([...rgb, 255], (y * p.width + x) * 4);
  return p;
};

describe('comment images', () => {
  it('picks app screens first, then one image per story before repeating a story in another mode', () => {
    const s = (key: string, label: string, kind: 'story' | 'route' = 'story') => shot({ key, label, kind, status: 'changed', images: { composite: `composite/${key}.png` } });
    const picked = pickImages([s('b1', 'Button'), s('b2', 'Button'), s('a1', 'Alert'), s('r1', 'Reviews', 'route'), s('r2', 'Reviews', 'route'), s('o1', 'Orders', 'route'), s('x1', 'Badge')], 5);
    expect(picked.map((x) => x.key)).toEqual(['r1', 'o1', 'b1', 'a1', 'x1']);
    expect(groupByLabel([s('b1', 'Button'), s('a1', 'Alert'), s('b2', 'Button')]).map((g) => [g.label, g.shots.length])).toEqual([
      ['Button', 2],
      ['Alert', 1],
    ]);
  });
});

describe('pixel diff', () => {
  it('finds no change between identical images', () => {
    const r = diffPngs(solid(64, 48, [255, 255, 255]), solid(64, 48, [255, 255, 255]));
    expect(r).toMatchObject({ changedPixels: 0, percent: 0, boxes: [], diff: null });
  });

  it('measures a changed region and boxes it on the cell grid', () => {
    const before = paint(solid(200, 100, [255, 255, 255]), 40, 20, 30, 10, [200, 30, 40]);
    const after = paint(solid(200, 100, [255, 255, 255]), 40, 20, 30, 10, [120, 10, 20]);
    const r = diffPngs(before, after, 0.1, 16);
    expect(r.changedPixels).toBe(300);
    expect(r.percent).toBe(1.5);
    expect(r.boxes).toEqual([{ x: 32, y: 16, width: 48, height: 16 }]);
    // The diff image round-trips as PNG.
    expect(decodePng(encodePng(r.diff!)).width).toBe(200);
  });

  it('ignores sub-threshold noise and counts area that only one image has', () => {
    const near = diffPngs(solid(20, 20, [255, 255, 255]), solid(20, 20, [254, 254, 254]));
    expect(near.changedPixels).toBe(0);
    const taller = diffPngs(solid(20, 20, [255, 255, 255]), solid(20, 30, [255, 255, 255]));
    expect(taller.changedPixels).toBe(200);
    expect(taller.height).toBe(30);
    expect(padTo(solid(2, 2, [0, 0, 0]), 3, 3).data.subarray(8, 12)).toEqual(Buffer.from([255, 0, 255, 255]));
  });

  it('keeps distant regions apart and caps the number of boxes', () => {
    const cols = 20;
    const rows = 10;
    const hot = new Uint8Array(cols * rows);
    hot[0] = 1;
    hot[1] = 1;
    hot[9 * cols + 19] = 1;
    expect(boxesFromCells(hot, cols, rows, 10, 200, 100)).toEqual([
      { x: 0, y: 0, width: 20, height: 10 },
      { x: 190, y: 90, width: 10, height: 10 },
    ]);
    const many = new Uint8Array(cols * rows);
    for (let i = 0; i < cols; i += 4) many[i] = 1;
    for (let i = 0; i < cols; i += 4) many[9 * cols + i] = 1;
    expect(boxesFromCells(many, cols, rows, 10, 200, 100, 3)).toHaveLength(3);
  });
});

describe('urls and keys', () => {
  it('pins tenant, theme and language for app routes and globals for stories', () => {
    expect(routeUrl('http://127.0.0.1:1/', { id: 'o', label: 'O', path: '/orders' }, 'harbor', 'dark')).toBe('http://127.0.0.1:1/?tenant=harbor&theme=dark&density=comfortable&lang=en#/orders');
    expect(storyUrl('http://127.0.0.1:1', 'feedback-alert--all-states', 'ocean', 'light')).toBe('http://127.0.0.1:1/iframe.html?id=feedback-alert--all-states&viewMode=story&globals=brand:ocean;theme:light;density:comfortable');
    expect(shotKey('story', 'Feedback/Alert', 'bridge-light')).toBe('story__feedback-alert__bridge-light');
  });
});
