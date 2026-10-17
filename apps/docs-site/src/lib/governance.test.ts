import { describe, expect, it } from 'vitest';
import { pluginListing, shortExample, tierSummaries } from './governance';

describe('settings approvals', () => {
  it('reads one row per tier from docs/GOVERNANCE.md', () => {
    const rows = tierSummaries();
    expect(rows.map((r) => r.tier)).toEqual([1, 2, 3]);
    for (const r of rows) {
      expect(r.approvals.length).toBeGreaterThan(0);
      expect(r.example.length).toBeGreaterThan(0);
      expect(r.example).not.toContain(';');
    }
  });

  it('keeps an example short without cutting a phrase', () => {
    expect(shortExample('Docs, story fixes, a11y fixes with no visual change')).toBe('Docs, story fixes');
    expect(shortExample('Token added, changed, renamed or removed; breaking prop change')).toBe('Token added, changed, renamed or removed');
    expect(shortExample('New component')).toBe('New component');
  });

  it('parses a governance table with its own columns', () => {
    const md = ['## Risk tiers', '', '| Tier | Examples | Required approvals |', '| - | - | - |', '| 2, medium | New variant, new prop | Design owner + tech owner |'].join('\n');
    expect(tierSummaries(md)).toEqual([{ tier: 2, level: 'medium', approvals: 'Design owner + tech owner', example: 'New variant, new prop' }]);
  });
});

describe('figma plugin listing', () => {
  it('says when the Community listing is still in review', () => {
    const line = 'Published on Figma Community: https://www.figma.com/community/plugin/1693034743850648023 (in review since 2026-10-16).';
    expect(pluginListing(line)).toEqual({ url: 'https://www.figma.com/community/plugin/1693034743850648023', inReview: true });
    expect(pluginListing(line.replace(/ \(in review[^)]*\)/, '')).inReview).toBe(false);
    expect(pluginListing('No listing yet.')).toEqual({ url: null, inReview: false });
  });
});
