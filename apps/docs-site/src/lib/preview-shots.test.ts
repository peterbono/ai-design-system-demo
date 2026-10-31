import { describe, expect, it } from 'vitest';
import { capturedLine, parseShotsIndex, shotFor, shotKey, shotsIndexUrl, shotThumb } from './preview-shots';
import { plateDrawing, PLATE_DRAWINGS } from './branch-thumb';
import { previewOf } from './home-explorations';

const DS = { owner: 'peterbono', repo: 'ai-design-system-demo' };
const entry = { sha: '5584f9417761d3a95f8c55f4cae19d82e59cfc5d', capturedAt: '2026-10-31T02:35:29.833Z', image: 'peterbono/bridge-product-admin/2.webp', url: 'https://x.vercel.app/', route: '/', screen: 'Orders waiting to ship alert' };

describe('preview shots: the index', () => {
  it('reads index.json from the bridge-shots branch, raw (no API quota)', () => {
    expect(shotsIndexUrl('peterbono', 'ai-design-system-demo')).toBe('https://raw.githubusercontent.com/peterbono/ai-design-system-demo/bridge-shots/index.json');
    expect(shotKey('peterbono/Bridge-Product-Admin', 2)).toBe('peterbono/bridge-product-admin#2');
  });

  it('keeps well formed entries only: an image path that matches its key, a sha and a date', () => {
    const idx = parseShotsIndex({
      shots: {
        'peterbono/bridge-product-admin#2': entry,
        'peterbono/bridge-product-admin#3': { ...entry, image: 'peterbono/bridge-product-admin/2.webp' },
        'peterbono/other#4': { ...entry, image: '../../evil/4.webp' },
        'peterbono/other#5': { ...entry, image: 'peterbono/other/5.webp', sha: 'not a sha' },
        'peterbono/other#6': { ...entry, image: 'peterbono/other/6.webp', capturedAt: 'yesterday' },
      },
    });
    expect(Object.keys(idx!.shots)).toEqual(['peterbono/bridge-product-admin#2']);
    expect(parseShotsIndex(null)).toBeNull();
    expect(parseShotsIndex({ nope: true })).toBeNull();
    expect(parseShotsIndex('<html>404</html>')).toBeNull();
  });

  it('finds the capture of a product repository exploration, its URL pinned to the commit', () => {
    const idx = parseShotsIndex({ shots: { 'peterbono/bridge-product-admin#2': entry } });
    const shot = shotFor(idx, DS, 'peterbono/bridge-product-admin', 2);
    expect(shot).toEqual({
      src: 'https://raw.githubusercontent.com/peterbono/ai-design-system-demo/bridge-shots/peterbono/bridge-product-admin/2.webp?v=5584f94',
      capturedAt: entry.capturedAt,
      sha: entry.sha,
      screen: 'Orders waiting to ship alert',
    });
    expect(shotFor(idx, DS, 'peterbono/ai-design-system-demo', 2)).toBeNull();
    expect(shotFor(null, DS, 'peterbono/bridge-product-admin', 2)).toBeNull();
  });

  it('says when it was captured', () => {
    expect(capturedLine('2026-10-31T00:00:00Z', Date.parse('2026-10-31T02:00:00Z'))).toBe('Captured 2 h ago');
    expect(capturedLine('2026-10-31T00:00:00Z', Date.parse('2026-10-31T00:00:20Z'))).toBe('Captured just now');
  });
});

describe('preview shots: what a card shows', () => {
  const shot = shotFor(parseShotsIndex({ shots: { 'peterbono/bridge-product-admin#2': entry } }), DS, 'peterbono/bridge-product-admin', 2)!;

  it('shows the capture, keeping what the plate would say if the image fails', () => {
    const spec = previewOf(shotThumb(shot), { product: 'Product admin', screen: null, seed: 'admin-app#2' });
    expect(spec).toMatchObject({ kind: 'screen', src: shot.src, capturedAt: entry.capturedAt, product: 'Product admin', screen: 'Orders waiting to ship alert', seed: 'admin-app#2' });
  });

  it('shows the plate without a capture, and keeps a non-screen thumbnail as it is', () => {
    expect(previewOf(null, { product: 'Library', screen: 'Button', seed: '12' })).toEqual({ kind: 'screen', src: null, product: 'Library', screen: 'Button', seed: '12' });
    expect(previewOf({ kind: 'icon', icon: 'branch' }, { product: 'Library', screen: null, seed: '12' })).toEqual({ kind: 'icon', icon: 'branch' });
  });

  it('draws one exploration the same everywhere, and varies the drawing across explorations', () => {
    expect(plateDrawing({ seed: 'admin-app#2' })).toBe(plateDrawing({ seed: 'admin-app#2', screen: 'Other' }));
    const drawn = new Set(['600', '601', '611', '612', 'admin-app#2', 'admin-app#3'].map((seed) => plateDrawing({ seed })));
    expect(drawn.size).toBeGreaterThan(2);
    for (const d of drawn) expect(PLATE_DRAWINGS).toContain(d);
    expect(plateDrawing({})).toBe('paint');
  });
});
