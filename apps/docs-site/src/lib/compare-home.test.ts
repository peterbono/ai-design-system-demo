import { describe, expect, it } from 'vitest';
import * as data from './compare-home';
import { AS_OF_LINE, GROUPS, KEY_NO, SHORT, TOOLS } from './compare-home';

const allRows = [...SHORT, ...GROUPS.flatMap((g) => g.rows)];
const marks = (cells: boolean[]) => cells.map((c) => (c ? 'y' : 'n')).join('');

describe('homepage comparison', () => {
  it('keeps seven rows up front and ten more by group', () => {
    expect(SHORT).toHaveLength(7);
    expect(GROUPS.map((g) => [g.name, g.rows.length])).toEqual([
      ['Tokens and Figma', 3],
      ['Review and history', 2],
      ['Code and docs', 4],
      ['AI', 1],
    ]);
  });

  it('gives every row one cell per tool, Bridge first', () => {
    expect(TOOLS).toEqual(['Bridge', 'Tokens Studio', 'Supernova', 'Storybook', 'zeroheight', 'Figma']);
    for (const r of allRows) expect(r.cells.length, r.feature).toBe(TOOLS.length);
  });

  it('ends the short table with the free row: Bridge and Storybook only', () => {
    const last = SHORT[SHORT.length - 1];
    expect([last.feature, last.detail, marks(last.cells)]).toEqual(['Free, with every feature', 'No paid plan', 'ynnynn']);
  });

  it('says what a dash means', () => {
    expect(KEY_NO).toBe('Not offered, only in part, or not documented');
  });

  it('dates the comparison', () => {
    expect(AS_OF_LINE).toBe('From public pages, October 2026');
  });

  it('has no em dash in any word', () => {
    expect(JSON.stringify(data)).not.toContain('—');
  });
});
