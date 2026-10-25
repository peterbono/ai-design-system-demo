// Oversized tool results come in pages with a summary (bridge_plan_revert, bridge_draft_docs), and the docs draft
// lists only the contrast pairs the component takes part in.
import { describe, expect, it } from 'vitest';
import { BridgeContext, history, ops } from '../src/lib.js';
import { REPO } from './helpers.js';

describe('bridge_plan_revert paging', () => {
  const report = {
    status: 'ready',
    edits: Array.from({ length: 120 }, (_, i) => `edit ${i}`),
    conflicts: [{ key: 'a' }],
    skipped: [],
    changes: Array.from({ length: 120 }, (_, i) => ({ path: `t.${i}` })),
  };

  it('lists 50 of each by default, with the totals and the next offset', () => {
    const p = history.pagePlanReport(report);
    expect(p.edits).toHaveLength(50);
    expect(p.changes[49]).toEqual({ path: 't.49' });
    expect(p.conflicts).toEqual([{ key: 'a' }]);
    expect(p.counts).toEqual({ edits: 120, conflicts: 1, skipped: 0, changes: 120 });
    expect(p.truncated).toMatch(/items 1 to 50 of up to 120.*offset 50/);
  });

  it('reads the next page with offset, and says nothing when everything fits', () => {
    const last = history.pagePlanReport(report, 50, 100);
    expect(last.edits).toEqual(report.edits.slice(100));
    expect(last.truncated).toMatch(/items 101 to 120 of up to 120/);
    expect(last.truncated).not.toMatch(/offset/);
    const small = history.pagePlanReport({ ...report, edits: ['one'], changes: [{ path: 'x' }] });
    expect(small).not.toHaveProperty('truncated');
    expect(small.counts.edits).toBe(1);
  });
});

describe('bridge_draft_docs paging and contrast pairs', () => {
  it('pages the prompt on line breaks, every page within the size, nothing lost', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const pages = ops.textPages(text, 1000);
    expect(pages.length).toBeGreaterThan(10);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(1000);
    expect(pages.join('\n')).toBe(text);
    expect(ops.textPages('short', 1000)).toEqual(['short']);
  });

  it('returns page 1 with a summary and the way to the next page, then the last page without one', async () => {
    const ctx = await BridgeContext.create({ root: REPO });
    const d = await ops.draftDocsOp(ctx, { name: 'Button' });
    expect(d.prompt.length).toBeGreaterThan(ops.DOCS_PROMPT_PAGE);
    const first = ops.pagedDraftDocs(d);
    expect(first.summary).toMatch(/^Button: \d+ token\(s\), \d+ contrast pair\(s\)/);
    expect(first.prompt.length).toBeLessThanOrEqual(ops.DOCS_PROMPT_PAGE);
    expect(first.promptPage.page).toBe(1);
    expect(first.promptPage.next).toMatch(/page 2 \(of \d+\)/);
    const n = first.promptPage.pages;
    const all = Array.from({ length: n }, (_, i) => ops.pagedDraftDocs(d, i + 1).prompt).join('\n');
    expect(all).toBe(d.prompt);
    expect(ops.pagedDraftDocs(d, n).promptPage).not.toHaveProperty('next');
    expect(() => ops.pagedDraftDocs(d, n + 1)).toThrow(/page is between 1 and/);
  });

  it('lists only the pairs whose foreground and background the component reaches', async () => {
    const ctx = await BridgeContext.create({ root: REPO });
    const card = await ops.draftDocsOp(ctx, { name: 'Card' });
    const set = await ctx.tokens();
    const known = new Map(set.allPaths().map((p) => [set.cssVarName(p), p] as const));
    const reached = ops.reachedTokens(set, card.prefill.tokens.map((v) => known.get(v)!).filter(Boolean));
    expect(card.prefill.contrastNotes.length).toBeGreaterThan(0);
    for (const note of card.prefill.contrastNotes) {
      const [, fg, bg] = /^(\S+) on (\S+):/.exec(note)!;
      expect(reached.has(fg!) && reached.has(bg!), note).toBe(true);
    }
    // A pair that only shares a surface with the card (selected rows) is not the card's.
    expect(card.prefill.contrastNotes.join('\n')).not.toMatch(/selection\.bg|surface\.selected/);
  });

  it('falls back to the foregrounds a component uses when it sets no surface of its own', () => {
    const pairs = [
      { foreground: 'text', background: 'page' },
      { foreground: 'other', background: 'page' },
    ];
    expect(ops.relevantPairs(pairs, new Set(['text']))).toEqual([pairs[0]]);
    expect(ops.relevantPairs(pairs, new Set(['text', 'page']))).toEqual([pairs[0]]);
    expect(ops.relevantPairs(pairs, new Set(['page']))).toEqual([]);
  });
});
