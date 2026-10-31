import { describe, expect, it } from 'vitest';
import { adoptionFigureInput, adoptionView, productName, productTrend, qualityPillars, qualityVerdict, unusedLine, type AdoptionRun } from './quality-view';
import { contrastFinding, type Finding } from './quality';
import { healthFigures } from './library-health';

const finding = (severity: Finding['severity'], title: string, action?: string): Finding => ({
  id: title,
  kind: severity === 'fail' ? 'validation' : 'guidance',
  severity,
  title,
  status: { label: 'x', group: 'neutral' },
  ...(action ? { action: { label: action, href: `/fix/${encodeURIComponent(title)}` } } : {}),
});
const pass = contrastFinding({ total: 10, fail: 0, combos: [] });

describe('qualityVerdict', () => {
  it('is clear and asks nothing when nothing is open', () => {
    const v = qualityVerdict({ contrastFail: 0, findings: [pass] });
    expect(v).toEqual({ mood: 'clear', title: 'The library is healthy', sentence: 'Nothing blocks it and nothing needs you. Bridge checks again with every change.', action: null });
  });

  it('turns to haze with one thing to look at, and the action says what it does', () => {
    const v = qualityVerdict({ contrastFail: 0, findings: [finding('warn', 'Button guidance is a draft', 'Review'), pass] });
    expect(v.mood).toBe('haze');
    expect(v.sentence).toBe('Nothing blocks it. Button guidance is a draft.');
    expect(v.action).toEqual({ label: 'Review guidance', href: '/fix/Button%20guidance%20is%20a%20draft' });
  });

  it('starts with the first of several things to look at', () => {
    const v = qualityVerdict({ contrastFail: 0, findings: [finding('warn', 'A', 'Add guidance'), finding('warn', 'B', 'Review')] });
    expect(v.sentence).toBe('Nothing blocks it. 2 things need a look, starting with A.');
    expect(v.action?.label).toBe('Start with the first');
  });

  it('turns to fog when contrast fails, and the one action goes to the failing pairs', () => {
    const v = qualityVerdict({ contrastFail: 3, findings: [contrastFinding({ total: 10, fail: 3, combos: [] })] });
    expect(v).toMatchObject({ mood: 'fog', title: 'Something blocks the library', action: { label: 'See the failing pairs', href: '#ql-contrast' } });
    expect(v.sentence).toBe('3 color pairs fail contrast, so the token build waits until they pass.');
  });

  it('turns to fog for any other blocking finding', () => {
    const v = qualityVerdict({ contrastFail: 0, findings: [finding('fail', 'Card reads --color-x', 'Open'), finding('warn', 'B', 'Review')] });
    expect(v.mood).toBe('fog');
    expect(v.sentence).toBe('Card reads --color-x.');
    expect(v.action?.label).toBe('Fix it');
  });
});

describe('qualityPillars', () => {
  it('gives three cards of the same shape, a meter for every ratio', () => {
    const figures = healthFigures({
      contrast: { total: 304, fail: 0, brands: 2 },
      adoption: [{ now: { dsComponentInstances: 789, uiComponentInstances: 1000 } }],
      guidance: { total: 53, reviewed: 53, drafted: 0, missing: 0 },
    });
    const p = qualityPillars({ figures, contrast: { total: 304, fail: 0 }, adoption: 78.9, guidance: { total: 53, reviewed: 53 } });
    expect(p.map((x) => [x.name, x.value, x.meter])).toEqual([
      ['Accessibility', '304 of 304', 100],
      ['Adoption', '78.9%', 78.9],
      ['Documentation', '53 of 53', 100],
    ]);
    expect(p.map((x) => x.next.href)).toEqual(['#ql-contrast', '#ql-adoption', '#ql-guidance']);
    expect(p[0]!.sentence).toBe('304 checked in 2 brands, light and dark.');
  });

  it('marks a failing contrast pillar and leaves the meter out when there is nothing to count', () => {
    const figures = healthFigures({ contrast: { total: 10, fail: 2, brands: 1 }, adoption: [], guidance: { total: 0, reviewed: 0, drafted: 0, missing: 0 } });
    const p = qualityPillars({ figures, contrast: { total: 10, fail: 2 }, adoption: null, guidance: { total: 0, reviewed: 0 } });
    expect(p[0]).toMatchObject({ value: '8 of 10', tone: 'fail', meter: 80, next: { label: 'See the failing pairs' } });
    expect(p[1]).toMatchObject({ value: 'No audit yet', meter: null });
    expect(p[2]!.meter).toBeNull();
  });
});

const run = (id: string, product: string, at: string, component: number, label = `${product}, ${id}`, extra: Partial<AdoptionRun> = {}): AdoptionRun => ({
  id,
  label,
  product,
  generatedAt: at,
  token: 100,
  component,
  ds: component,
  ui: 100,
  href: `/r/${id}`,
  ...extra,
});

describe('adoptionView', () => {
  it('leads with the latest run of each product and keeps every other run under earlier runs, newest first', () => {
    const v = adoptionView([run('a1', 'web', '2026-01-01', 50), run('a2', 'web', '2026-03-01', 70), run('b1', 'admin', '2026-02-01', 90)]);
    expect(v.products.map((p) => [p.name, p.latest.id, p.previous?.id ?? null, p.first?.id ?? null, p.runs])).toEqual([
      ['admin', 'b1', null, null, 1],
      ['web', 'a2', 'a1', 'a1', 2],
    ]);
    expect(v.earlier.map((r) => r.id)).toEqual(['a1']);
  });

  it('with a snapshot date, a product it no longer audits moves to earlier runs', () => {
    const v = adoptionView([run('old', 'original', '2026-10-16T10:00:00Z', 0), run('main', 'web', '2026-10-31T14:08:00Z', 90), run('then', 'web', '2026-10-16T10:00:05Z', 80)], { liveSince: '2026-10-31T14:08:10Z' });
    expect(v.products.map((p) => p.latest.id)).toEqual(['main']);
    expect(v.earlier.map((r) => r.id)).toEqual(['then', 'old']);
  });

  it('without a run from the snapshot, each product keeps its latest run', () => {
    const v = adoptionView([run('a', 'web', '2026-01-01', 50), run('b', 'admin', '2026-01-02', 60)], { liveSince: '2026-10-31T00:00:00Z' });
    expect(v.products).toHaveLength(2);
    expect(v.earlier).toEqual([]);
  });

  it('feeds the combined figure with the current products only', () => {
    const v = adoptionView([run('a1', 'web', '2026-01-01', 50), run('a2', 'web', '2026-03-01', 70)]);
    expect(adoptionFigureInput(v)).toEqual([{ now: { dsComponentInstances: 70, uiComponentInstances: 100 }, before: { dsComponentInstances: 50, uiComponentInstances: 100 } }]);
  });
});

describe('product words', () => {
  it('names a product from its run label', () => {
    expect(productName('Bridge admin, after migration')).toBe('Bridge admin');
    expect(productName('Bridge docs site, main')).toBe('Bridge docs site');
    expect(productName('Web app')).toBe('Web app');
  });

  it('says the trend since the run before, or since the move to Bridge', () => {
    const [p] = adoptionView([run('a1', 'web', '2026-10-16T10:00:00Z', 90.2), run('a2', 'web', '2026-10-31T10:00:00Z', 91.2)]).products;
    expect(productTrend(p!)).toBe('Up 1 point since Oct 16, 2026.');
    const [b] = adoptionView([run('a1', 'web', '2026-10-16T10:00:00Z', 0, 'x', { baseline: true }), run('a2', 'web', '2026-10-31T10:00:00Z', 90)]).products;
    expect(productTrend(b!)).toBe('Up 90 points since before the move to Bridge.');
    expect(productTrend(adoptionView([run('a', 'web', '2026-01-01', 5)]).products[0]!)).toBeNull();
  });

  it('says unused tokens calmly', () => {
    expect(unusedLine(99)).toBe('99 tokens are not in use yet');
    expect(unusedLine(1)).toBe('1 token is not in use yet');
    expect(unusedLine(0)).toBe('Every token is in use');
  });
});
