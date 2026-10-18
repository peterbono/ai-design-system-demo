import { describe, expect, it } from 'vitest';
import { componentOfDocsPath, isDocsFile, prDocRows, prDocsEditHref, prDocsMeta } from './pr-docs';

const P = (n: string) => `packages/react/src/components/${n}/${n}.docs.json`;

describe('pull request Docs section', () => {
  it('finds docs files and their component', () => {
    expect(isDocsFile(P('VisuallyHidden'))).toBe(true);
    expect(isDocsFile('docs/AI.md')).toBe(false);
    expect(componentOfDocsPath(P('VisuallyHidden'))).toEqual({ name: 'VisuallyHidden', slug: 'visually-hidden' });
  });

  it('lists Claude drafts that need review first, then the rest', () => {
    const rows = prDocRows([
      { path: P('Button'), text: '{"summary":"x"}' },
      { path: P('Icon'), text: '{"summary":"x","draftedBy":"claude","needsReview":true}' },
      { path: P('Kbd'), text: '{"summary":"x","draftedBy":"claude","needsReview":false}' },
      { path: P('Tag'), text: null },
    ]);
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ['Icon', 'review'],
      ['Tag', 'unreadable'],
      ['Button', 'written'],
      ['Kbd', 'reviewed'],
    ]);
    expect(prDocsMeta(rows)).toBe('1 draft needs review');
    expect(prDocsMeta(rows.slice(2))).toBe('2 files');
  });

  it('Edit opens the docs editor on the pull request branch', () => {
    expect(prDocsEditHref('icon', 21, 'agent/docs drafts')).toBe('/components/icon/?edit=1&pr=21&ref=agent%2Fdocs%20drafts');
  });
});
