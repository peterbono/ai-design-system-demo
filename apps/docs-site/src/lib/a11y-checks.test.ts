import { describe, expect, it } from 'vitest';
import {
  buildGroups,
  combos,
  groupOf,
  groupStatus,
  rowTitle,
  shortName,
  statusLabel,
  statusOf,
  statusSentence,
  summarize,
  type CheckPair,
  type CheckResult,
} from './a11y-checks';

const COMBOS = combos(['bridge', 'ocean'], ['light', 'dark'], { bridge: 'Bridge', ocean: 'Ocean' });

const res = (ratio: number, min: number, usage: 'text' | 'ui'): CheckResult => ({
  ratio,
  fgHex: '#111111',
  bgHex: '#FFFFFF',
  aa: ratio >= min,
  aaa: usage === 'text' ? ratio >= 7 : null,
});

/** A pair with one ratio everywhere, or per combo key. */
function pair(fg: string, bg: string, min: number, ratio: number | Record<string, number>): CheckPair {
  const usage = min >= 4.5 ? 'text' : 'ui';
  const at = (key: string) => (typeof ratio === 'number' ? ratio : (ratio[key] ?? 21));
  return {
    fg,
    bg,
    min,
    usage,
    brands: Object.fromEntries(
      ['bridge', 'ocean'].map((b) => [b, Object.fromEntries(['light', 'dark'].map((m) => [m, res(at(`${b}-${m}`), min, usage)]))]),
    ),
  };
}

describe('groupOf', () => {
  it('sorts pairs by what they are used for', () => {
    expect(groupOf(pair('color.text.default', 'color.bg.default', 4.5, 16))).toBe('text');
    expect(groupOf(pair('color.text.on-solid', 'color.feedback.info.solid', 4.5, 5))).toBe('feedback');
    expect(groupOf(pair('color.feedback.danger.icon', 'color.surface.default', 3, 5))).toBe('feedback');
    expect(groupOf(pair('color.action.primary.text', 'color.action.primary.bg', 4.5, 8))).toBe('controls');
    expect(groupOf(pair('color.control.thumb', 'color.control.track', 3, 4))).toBe('controls');
    expect(groupOf(pair('color.border.strong', 'color.surface.default', 3, 4))).toBe('ui');
    expect(groupOf(pair('focus.ring.color', 'color.bg.default', 3, 5))).toBe('focus');
    expect(groupOf(pair('color.chart.series.1', 'color.bg.default', 3, 4))).toBe('charts');
  });

  it('falls back on the usage for a token family it does not know', () => {
    expect(groupOf(pair('color.brand.mark', 'color.bg.default', 4.5, 9))).toBe('text');
    expect(groupOf(pair('color.brand.mark', 'color.bg.default', 3, 9))).toBe('ui');
  });
});

describe('statusOf and statusLabel', () => {
  it('gives one status per result', () => {
    expect(statusOf(res(7.2, 4.5, 'text'))).toBe('aaa');
    expect(statusOf(res(5, 4.5, 'text'))).toBe('aa');
    expect(statusOf(res(4.49, 4.5, 'text'))).toBe('fail');
    expect(statusOf(res(9, 3, 'ui'))).toBe('aa');
  });

  it('shows the minimum only on a failure', () => {
    expect(statusLabel('aaa', 4.5)).toBe('AAA');
    expect(statusLabel('aa', 3)).toBe('AA');
    expect(statusLabel('fail', 4.5)).toBe('Fails, needs 4.5');
  });
});

describe('buildGroups', () => {
  const pairs = [
    pair('color.text.default', 'color.bg.default', 4.5, 16),
    pair('color.text.muted', 'color.bg.default', 4.5, 6),
    pair('color.border.strong', 'color.surface.default', 3, 4),
    pair('focus.ring.color', 'color.bg.default', 3, { 'ocean-dark': 2.4 }),
    pair('color.feedback.info.text', 'color.feedback.info.bg', 4.5, 6),
  ];
  const groups = buildGroups(pairs, COMBOS);

  it('keeps page order and drops empty groups', () => {
    expect(groups.map((g) => g.id)).toEqual(['text', 'ui', 'focus', 'feedback']);
    expect(groups[0]!.pairs).toHaveLength(2);
  });

  it('counts failures per combo and across every combo', () => {
    const focus = groups.find((g) => g.id === 'focus')!;
    expect(focus.failing['ocean-dark']).toBe(1);
    expect(focus.failing['bridge-light']).toBe(0);
    expect(focus.failing.all).toBe(1);
  });

  it('opens the first group and every group with a failure', () => {
    expect(groups.filter((g) => g.open).map((g) => g.id)).toEqual(['text', 'focus']);
  });
});

describe('groupStatus', () => {
  it('reads as a short count', () => {
    expect(groupStatus(12, 0)).toBe('12 pairs, all pass');
    expect(groupStatus(1, 0)).toBe('1 pair, passes');
    expect(groupStatus(12, 1)).toBe('12 pairs, 1 fails');
    expect(groupStatus(12, 3)).toBe('12 pairs, 3 fail');
  });
});

describe('summarize and statusSentence', () => {
  it('counts every pair in every combo', () => {
    const s = summarize([pair('color.text.default', 'color.bg.default', 4.5, 16), pair('color.chart.axis', 'color.bg.default', 4.5, 5)], COMBOS);
    expect(s).toMatchObject({ checks: 8, failing: 0, brands: 2, themes: 2, first: null });
    expect(statusSentence(s)).toBe('All 8 contrast checks pass across 2 brands and 2 themes.');
  });

  it('names the first failing pair in page order', () => {
    const s = summarize(
      [
        pair('color.chart.axis', 'color.bg.default', 4.5, 3.9),
        pair('color.text.muted', 'color.bg.subtle', 4.5, { 'ocean-dark': 4.12 }),
      ],
      COMBOS,
    );
    expect(s.failing).toBe(5);
    expect(statusSentence(s)).toBe(
      '5 of 8 contrast checks fail across 2 brands and 2 themes. First: text.muted on bg.subtle in Ocean dark, 4.12:1 where 4.5:1 is needed.',
    );
  });

  it('says so when nothing is gated', () => {
    expect(statusSentence(summarize([], COMBOS))).toBe('No contrast pairs are gated yet.');
  });
});

describe('row helpers', () => {
  it('drops the color prefix and keeps hex values for the tooltip', () => {
    expect(shortName('color.text.default')).toBe('text.default');
    expect(shortName('focus.ring.color')).toBe('focus.ring.color');
    const p = pair('color.text.default', 'color.bg.default', 4.5, 16);
    expect(rowTitle(p, p.brands.bridge!.light!)).toBe('#111111 on #FFFFFF. Needs 4.5:1, 7:1 for AAA.');
  });
});
