import { describe, expect, it } from 'vitest';
import * as data from './compare';
import { ALL_ROWS, AS_OF_LINE, GROUPS, KEY, SHORT, SOURCES, TOOLS, cellText } from './compare';

const marks = (row: { cells: { state: string }[] }) => row.cells.map((c) => c.state[0]).join('');

describe('comparison (homepage and /compare/)', () => {
  it('keeps seven rows up front and fifteen more by group', () => {
    expect(SHORT).toHaveLength(7);
    expect(GROUPS.map((g) => [g.name, g.rows.length])).toEqual([
      ['Tokens and Figma', 6],
      ['Review and history', 3],
      ['Code and docs', 4],
      ['AI', 1],
    ]);
  });

  it('gives every row one cell per tool, Bridge first', () => {
    expect(TOOLS).toEqual(['Bridge', 'Tokens Studio', 'Supernova', 'Storybook', 'zeroheight', 'Figma', 'story.to.design']);
    for (const r of ALL_ROWS) expect(r.cells.length, r.feature).toBe(TOOLS.length);
  });

  it('says why on every partial cell, and never on a dash', () => {
    for (const r of ALL_ROWS)
      for (const c of r.cells) {
        if (c.state === 'partial') expect(c.note, r.feature).toBeTruthy();
        if (c.state === 'no') expect([c.note, c.short], r.feature).toEqual([undefined, undefined]);
      }
  });

  it('gives every partial cell a short label of 2 to 4 words, and keeps qualifiers on checks as short', () => {
    for (const r of ALL_ROWS)
      for (const c of r.cells) {
        if (c.state === 'partial') expect(c.short, `${r.feature}: ${c.note}`).toBeTruthy();
        if (!c.short) continue;
        const words = c.short.split(/\s+/).length;
        expect(words, c.short).toBeGreaterThanOrEqual(c.state === 'partial' ? 2 : 1);
        expect(words, c.short).toBeLessThanOrEqual(4);
        expect(c.short.length, c.short).toBeLessThanOrEqual(28);
        expect(c.short, c.short).not.toMatch(/\.$/);
        expect(c.note, c.short).toBeTruthy();
      }
  });

  it('labels the partial cells of the review rows in words', () => {
    const row = (f: string) => ALL_ROWS.find((r) => r.feature === f)!;
    expect(row('One review for tokens, code and docs').cells.map((c) => c.short)).toEqual([
      undefined,
      'Tokens only',
      'Docs only',
      'Code only',
      'Docs and tokens',
      'Two separate reviews',
      'Figma updates only',
    ]);
    expect(row('Start an AI exploration with your design system').cells[5].short).toBe('Paid plans');
  });

  it('opens on the exploration row, worded with the design system', () => {
    expect([SHORT[0].feature, SHORT[0].detail]).toEqual(['Start an AI exploration with your design system', 'In its own branch, with its own preview']);
  });

  it('credits Figma and Tokens Studio where they do the job', () => {
    const row = (f: string) => ALL_ROWS.find((r) => r.feature === f)!;
    expect(marks(row('Start an AI exploration with your design system'))).toBe('ynpppyn');
    expect(marks(row('Your DS lead approves just the change'))).toBe('yypppyp');
    expect(marks(row('Visual before and after of a change'))).toBe('ypppnyy');
    expect(marks(row('UI kit linked to code'))).toBe('ypyypyy');
  });

  it('credits story.to.design for building the Figma kit from stories, and shows it goes one way', () => {
    const row = (f: string) => ALL_ROWS.find((r) => r.feature === f)!;
    const last = (f: string) => row(f).cells[TOOLS.length - 1];
    expect(last('Figma kit built from code, with a fidelity check').short).toBe('No fidelity check');
    expect(last('Two-way sync between Figma variables and code').short).toBe('Code to Figma only');
    expect(last('Free, with every feature').state).toBe('no');
  });

  it('compares variants from code, two-tier variables and fixing drift in the full table only, crediting each tool', () => {
    const row = (f: string) => ALL_ROWS.find((r) => r.feature === f)!;
    const rows = ['Variants and properties set up from code', 'Primitive and semantic tokens as Figma variables, with modes', 'Fix differences between Figma and code'];
    for (const f of rows) {
      expect(SHORT.some((r) => r.feature === f), f).toBe(false);
      expect(GROUPS[0].rows.some((r) => r.feature === f), f).toBe(true);
    }
    expect(marks(row(rows[0]))).toBe('ynnnnpp');
    expect(marks(row(rows[1]))).toBe('yypnpyp');
    expect(marks(row(rows[2]))).toBe('ypnnppp');
    expect(row(rows[1]).cells[1].short).toBe('Pro licence');
    expect(row(rows[2]).cells.map((c) => c.short)).toEqual([
      'Claude, in your account',
      'Tokens only',
      undefined,
      undefined,
      'Guideline audit only',
      'Agent skill, in beta',
      'Vendor support',
    ]);
  });

  it('has a legend for each mark, none for the worded partial cells, and a date', () => {
    expect(Object.keys(KEY)).toEqual(['yes', 'no']);
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
    expect(cellText({ state: 'yes', note: 'MIT.' })).toBe('Yes: MIT.');
    expect(cellText({ state: 'partial', short: 'Tokens only', note: 'Tokens only.' })).toBe('In part: Tokens only.');
    expect(cellText({ state: 'partial', short: 'Plugin only', note: 'The Figma plugin is MIT; the platform is not.' })).toBe(
      'In part: Plugin only. The Figma plugin is MIT; the platform is not.',
    );
    expect(cellText({ state: 'yes', short: 'Paid plans', note: 'Git sync on paid plans.' })).toBe('Yes: Paid plans. Git sync on paid plans.');
    expect(cellText({ state: 'no' })).toBe('No');
  });

  it('has no em dash in any word', () => {
    expect(JSON.stringify(data)).not.toMatch(/—/);
  });
});
