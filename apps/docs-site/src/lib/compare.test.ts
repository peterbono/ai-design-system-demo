import { describe, expect, it } from 'vitest';
import { AS_OF, FIGMA_NOTE, ROWS, TOOLS, cellText } from './compare';

describe('comparison table', () => {
  it('gives every row one cell per tool', () => {
    for (const r of ROWS) expect(r.cells.length, r.feature).toBe(TOOLS.length);
  });

  it('links a public source for every tool, and Code Connect pages for Figma', () => {
    for (const t of TOOLS) expect(t.source.href).toMatch(/^https:\/\//);
    const figma = TOOLS.find((t) => t.id === 'figma')!;
    expect(figma.more?.map((m) => m.href)).toEqual([
      'https://developers.figma.com/docs/code-connect/code-connect-ui-setup/',
      'https://developers.figma.com/docs/code-connect/comparing-cc/',
    ]);
  });

  it('keeps partials and unknowns as they are', () => {
    const states = new Set(ROWS.flatMap((r) => r.cells.map((c) => c.state)));
    expect([...states].sort()).toEqual(['no', 'partial', 'unknown', 'yes']);
  });

  it('says what Code Connect does and does not do, with the plans', () => {
    expect(FIGMA_NOTE).toMatch(/Organization and Enterprise/);
    expect(FIGMA_NOTE).toMatch(/does not sync either way/);
    expect(AS_OF).toBe('October 2026');
  });

  it('reads cells as words', () => {
    expect(cellText({ state: 'yes' })).toBe('Yes');
    expect(cellText({ state: 'partial', note: 'token-only Git branches' })).toBe('Partial: token-only Git branches');
    expect(cellText({ state: 'unknown' })).toBe('Unknown');
  });

  it('writes no em dash', () => {
    expect(JSON.stringify({ ROWS, TOOLS, FIGMA_NOTE })).not.toMatch(/\u2014/);
  });
});
