import { describe, expect, it } from 'vitest';
import * as data from './compare';
import { ALL_ROWS, AS_OF_LINE, GROUPS, KEY, SHORT, SOURCES, TOOLS, cellText } from './compare';

const marks = (row: { cells: { state: string }[] }) => row.cells.map((c) => c.state[0]).join('');

describe('comparison (homepage and /compare/)', () => {
  it('keeps seven rows up front and twelve more by group', () => {
    expect(SHORT).toHaveLength(7);
    expect(GROUPS.map((g) => [g.name, g.rows.length])).toEqual([
      ['Tokens and Figma', 3],
      ['Review and history', 3],
      ['Code and docs', 4],
      ['AI', 1],
    ]);
  });

  it('gives every row one cell per tool, Bridge first', () => {
    expect(TOOLS).toEqual(['Bridge', 'Tokens Studio', 'Supernova', 'Storybook', 'zeroheight', 'Figma']);
    for (const r of ALL_ROWS) expect(r.cells.length, r.feature).toBe(TOOLS.length);
  });

  it('says why on every half mark, and never on a dash', () => {
    for (const r of ALL_ROWS)
      for (const c of r.cells) {
        if (c.state === 'partial') expect(c.note, r.feature).toBeTruthy();
        if (c.state === 'no') expect(c.note, r.feature).toBeUndefined();
      }
  });

  it('opens on the exploration row, worded with the design system', () => {
    expect([SHORT[0].feature, SHORT[0].detail]).toEqual(['Start an AI exploration with your design system', 'In its own branch, with its own preview']);
  });

  it('credits Figma and Tokens Studio where they do the job', () => {
    const row = (f: string) => ALL_ROWS.find((r) => r.feature === f)!;
    expect(marks(row('Start an AI exploration with your design system'))).toBe('ynpppy');
    expect(marks(row('Your DS lead approves just the change'))).toBe('yypppy');
    expect(marks(row('Visual before and after of a change'))).toBe('ypppny');
    expect(marks(row('UI kit linked to code'))).toBe('ypyypy');
  });

  it('has a legend for each mark and a date', () => {
    expect(Object.keys(KEY)).toEqual(['yes', 'partial', 'no']);
    expect(AS_OF_LINE).toBe('From public pages, October 2026');
  });

  it('links public sources for every tool', () => {
    for (const t of TOOLS) {
      expect(SOURCES[t].length, t).toBeGreaterThan(0);
      for (const s of SOURCES[t]) expect(s.href).toMatch(/^https:\/\//);
    }
  });

  it('reads cells as words', () => {
    expect(cellText({ state: 'yes' })).toBe('Yes');
    expect(cellText({ state: 'partial', note: 'Tokens only.' })).toBe('In part: Tokens only.');
    expect(cellText({ state: 'no' })).toBe('No');
  });

  it('has no em dash in any word', () => {
    expect(JSON.stringify(data)).not.toMatch(/—/);
  });
});
