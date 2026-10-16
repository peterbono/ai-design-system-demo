import { describe, expect, it } from 'vitest';
import { changeLabel, facet, filterShots, modeLabel, touchesVisuals, visualBase, visualState, type VisualManifest, type VisualShot } from './visual-impact';

const shot = (over: Partial<VisualShot>): VisualShot => ({
  key: 'k',
  kind: 'story',
  label: 'Feedback/Alert: All States',
  brand: 'bridge',
  theme: 'light',
  status: 'unchanged',
  percent: 0,
  boxes: [],
  size: { before: { width: 10, height: 10 }, after: { width: 10, height: 10 } },
  images: {},
  ...over,
});
const manifest = (shots: VisualShot[]): VisualManifest => ({
  version: 1,
  createdAt: '2026-10-16T00:00:00Z',
  base: { ref: 'main', sha: 'a'.repeat(40) },
  head: { ref: 'pr', sha: 'b'.repeat(40) },
  options: { threshold: 0.03 },
  selection: { tokens: [], components: [], fallback: null },
  summary: { shots: shots.length, changed: 0, unchanged: 0, added: 0, removed: 0, errors: 0, maxPercent: 0 },
  shots,
});

describe('visual impact in Reviews', () => {
  it('reads the manifest from the bridge-visual branch folder of the PR head', () => {
    expect(visualBase('peterbono', 'ai-design-system-demo', 12, 'abc')).toBe('https://raw.githubusercontent.com/peterbono/ai-design-system-demo/bridge-visual/pr-12/abc');
  });

  it('shows the section only for PRs the workflow covers', () => {
    expect(touchesVisuals(['packages/tokens/src/brands/bridge.tokens.json'])).toBe(true);
    expect(touchesVisuals(['apps/admin/src/App.tsx', 'README.md'])).toBe(true);
    expect(touchesVisuals(['docs/AI.md', 'apps/docs-site/src/pages/index.astro'])).toBe(false);
  });

  it('derives not computed, no change and changes states, largest change first', () => {
    expect(visualState(null).kind).toBe('not-computed');
    expect(visualState(manifest([shot({}), shot({ key: 'b' })])).kind).toBe('no-change');
    const s = visualState(manifest([shot({}), shot({ key: 'small', status: 'changed', percent: 0.2 }), shot({ key: 'err', status: 'error' }), shot({ key: 'big', status: 'changed', percent: 3 })]));
    expect(s.kind).toBe('changes');
    if (s.kind === 'changes') expect(s.shots.map((x) => x.key)).toEqual(['big', 'small', 'err']);
  });

  it('filters by brand, theme and kind', () => {
    const shots = [shot({ key: 'a' }), shot({ key: 'b', brand: 'ocean', theme: 'dark' }), shot({ key: 'c', kind: 'route', tenant: 'harbor', brand: 'ocean' })];
    expect(filterShots(shots, { brand: 'ocean', theme: 'all', kind: 'all' }).map((s) => s.key)).toEqual(['b', 'c']);
    expect(filterShots(shots, { brand: 'all', theme: 'light', kind: 'route' }).map((s) => s.key)).toEqual(['c']);
    expect(facet(shots, 'brand')).toEqual(['bridge', 'ocean']);
    expect(modeLabel(shots[2]!)).toBe('Harbor, ocean, light');
    expect(changeLabel(shot({ status: 'changed', percent: 0.004 }))).toBe('<0.01% changed');
    expect(changeLabel(shot({ status: 'changed', percent: 1.234 }))).toBe('1.23% changed');
  });
});
