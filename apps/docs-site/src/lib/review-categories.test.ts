import { describe, expect, it } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import {
  categoryOf,
  designerKey,
  designerOptions,
  EVERYONE,
  groupByCategory,
  guidanceExtra,
  kindOptions,
  passes,
  queueFiltersParam,
  queueSummary,
  reachLine,
  suggestionExtra,
  withQueueFilters,
  type QueueItem,
} from './review-categories';
import { jargonIn } from './vocabulary';
import type { NeedRow } from './home-model';

// The demo team's products (bridge.config.json of peterbono/bridge-demo-ds): the library is the default.
const DEMO: ProductConfig[] = [
  { key: 'library', name: 'Library', path: 'packages', default: true },
  { key: 'account', name: 'Account app', path: 'apps/account' },
];

const kind = (x: Parameters<typeof categoryOf>[0], products = DEMO) => categoryOf(x, products).category;

describe('the kind of a change', () => {
  it('a product label or a product folder is a change in that product', () => {
    expect(categoryOf({ labels: ['product: account', 'exploration'] }, DEMO)).toMatchObject({ category: 'product', product: { name: 'Account app' } });
    expect(kind({ files: ['apps/account/src/pages/Profile.tsx', '.changeset/x.md'] })).toBe('product');
    // A product screen that also edits its docs stays product work.
    expect(kind({ files: ['apps/account/README.md'], labels: ['docs'] })).toBe('product');
  });

  it('usage guidance only is documentation, from the label, the branch, the files or the status read', () => {
    expect(kind({ labels: [{ name: 'docs' }, { name: 'tier-1' }] })).toBe('docs');
    expect(kind({ headRef: 'docs/slider-20261021-fu6k' })).toBe('docs');
    expect(kind({ files: ['.changeset/docs-tabs.md', 'packages/react/src/components/Tabs/Tabs.docs.json'] })).toBe('docs');
    expect(kind({ guidanceOnly: true })).toBe('docs');
    expect(kind({ signals: { guidance: true, tokens: false, visual: false } })).toBe('docs');
  });

  it('a component or a token in the library is a library change, docs included', () => {
    expect(kind({ files: ['packages/tokens/src/primitives/color.tokens.json'], labels: ['tier: 3', 'tokens'] })).toBe('library');
    expect(kind({ files: ['packages/react/src/components/ProfileHeader/ProfileHeader.tsx', 'packages/react/src/components/ProfileHeader/ProfileHeader.docs.json'] })).toBe('library');
    expect(kind({ signals: { guidance: true, tokens: false, visual: true } })).toBe('library');
    // Nothing read yet: the library, where every branch starts.
    expect(kind({})).toBe('library');
  });

  it('a suggestion goes by its kind, a product label first', () => {
    expect(kind({ suggestionKind: 'docs' })).toBe('docs');
    expect(kind({ suggestionKind: 'token-change', labels: ['docs'] })).toBe('library');
    expect(kind({ suggestionKind: 'token-change', labels: ['product: account'] })).toBe('product');
  });

  it('works with the default products (Admin demo folder)', () => {
    expect(categoryOf({ files: ['apps/admin/src/Billing.tsx'] }, [{ key: 'admin', name: 'Admin demo', path: 'apps/admin' }, { key: 'library', name: 'Library', default: true }])).toMatchObject({ category: 'product', product: { key: 'admin' } });
  });

  it('the library heading names the products it can reach, none when the team lists none', () => {
    expect(reachLine(DEMO)).toBe('Can reach Account app.');
    expect(reachLine([...DEMO, { key: 'admin', name: 'Admin demo', path: 'apps/admin' }, { key: 'web', name: 'Website', path: 'apps/web' }])).toBe('Can reach Account app, Admin demo and Website.');
    expect(reachLine([{ key: 'library', name: 'Library', default: true }])).toBeNull();
  });
});

describe('the demo: the 15 changes that wait on Dana', () => {
  // The open branches of the demo's activity snapshot that are in review (drafts left out), as the home counts them.
  const branches: { files: string[]; labels: string[]; headRef: string }[] = [
    { headRef: 'bridge/brand-forest', labels: ['source: mcp', 'tier: 3', 'tokens'], files: ['bridge.config.json', 'packages/tokens/src/brands/forest.tokens.json'] },
    { headRef: 'docs/slider-20261021-fu6k', labels: ['source: mcp', 'docs', 'tier-1'], files: ['packages/react/src/components/Slider/Slider.docs.json'] },
    { headRef: 'docs/tabs-20261021-fphc', labels: ['source: mcp', 'docs', 'tier-1'], files: ['packages/react/src/components/Tabs/Tabs.docs.json'] },
    { headRef: 'agent/request-avatar-xl', labels: ['tier: 2'], files: ['packages/react/src/components/Avatar/Avatar.tsx'] },
    { headRef: 'agent/request-button-loading-label', labels: ['tier: 2'], files: ['packages/react/src/components/Button/Button.tsx'] },
    { headRef: 'agent/request-profile-header', labels: ['tier: 2'], files: ['packages/react/src/components/ProfileHeader/ProfileHeader.tsx'] },
    { headRef: 'bridge/deprecate-color-bg-zone', labels: ['tier: 3', 'tokens'], files: ['packages/tokens/src/semantic/light.tokens.json'] },
    { headRef: 'bridge/add-a-highlight-surface-for-new-items', labels: ['source: mcp', 'tier: 3', 'tokens'], files: ['packages/tokens/src/semantic/light.tokens.json'] },
    { headRef: 'bridge/fix-muted-text-contrast-on-dark-raised-surfaces', labels: ['source: mcp', 'tier: 3', 'tokens'], files: ['packages/tokens/src/semantic/dark.tokens.json'] },
    { headRef: 'bridge/add-a-56px-spacing-step-for-page-sections', labels: ['source: mcp', 'tier: 3', 'tokens'], files: ['packages/tokens/src/primitives/space.tokens.json'] },
    { headRef: 'bridge/deepen-the-primary-blue-for-stronger-buttons', labels: ['source: mcp', 'tier: 3', 'tokens'], files: ['packages/tokens/src/primitives/color.tokens.json'] },
  ];
  const need = (key: string): NeedRow => ({ key, kind: 'review', title: key, href: '#', person: null, line: '', since: null, waitsOnYou: true, pill: null, thumb: { kind: 'text' } });
  const suggestions = [
    suggestionExtra(need('s43'), 43, ['source: mcp', 'tier: 1', 'docs', 'bridge-suggestion', 'suggestion: needs review', 'suggestion: docs'], DEMO),
    suggestionExtra(need('s31'), 31, ['source: mcp', 'tier: 3', 'tokens', 'bridge-suggestion', 'suggestion: token-change', 'suggestion: needs review'], DEMO),
    suggestionExtra(need('s30'), 30, ['source: mcp', 'tier: 3', 'tokens', 'bridge-suggestion', 'suggestion: token-change', 'suggestion: needs review'], DEMO),
  ];
  const guidance = [guidanceExtra(need('guidance-EmptyState'))];

  it('sorts into 0 in a product, 11 library, 4 documentation', () => {
    const all = [...branches.map((b) => ({ category: kind(b) })), ...suggestions, ...guidance];
    expect(all).toHaveLength(15);
    const groups = groupByCategory(all);
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
      ['product', 0],
      ['library', 11],
      ['docs', 4],
    ]);
    expect(suggestions.map((s) => s.suggestion)).toEqual([43, 31, 30]);
  });
});

describe('filters', () => {
  const items: QueueItem[] = [
    { category: 'library', designer: { key: 'ann-leroy', name: 'Ann' } },
    { category: 'library', designer: { key: 'leo-martin', name: 'Leo' } },
    { category: 'docs', designer: { key: 'leo-martin', name: 'Leo' } },
    { category: 'docs', designer: { key: 'claude', name: 'Claude AI' } },
  ];

  it('reads and writes the address, other parameters kept', () => {
    expect(queueFiltersParam('?who=waiting')).toEqual({ kind: 'all', by: null });
    expect(queueFiltersParam('?who=waiting&kind=docs&by=Leo-Martin')).toEqual({ kind: 'docs', by: 'leo-martin' });
    expect(queueFiltersParam('?kind=everything&by=')).toEqual({ kind: 'all', by: null });
    expect(queueFiltersParam(`?by=${EVERYONE}`)).toEqual({ kind: 'all', by: null });
    expect(withQueueFilters('?who=waiting', { kind: 'library', by: 'ann-leroy' })).toBe('?who=waiting&kind=library&by=ann-leroy');
    expect(withQueueFilters('?who=waiting&kind=library&by=ann-leroy', { kind: 'all', by: null })).toBe('?who=waiting');
    expect(withQueueFilters('?kind=docs', { kind: 'all', by: null })).toBe('');
  });

  it('a designer key comes from the login (a persona one too), else the name', () => {
    expect(designerKey({ login: 'AnnLeroy', name: 'Ann' })).toBe('annleroy');
    expect(designerKey({ login: '~ann-leroy', name: 'Ann' })).toBe('ann-leroy');
    expect(designerKey({ login: null, name: 'Léo Martin' })).toBe('leo-martin');
    expect(designerKey({ login: 'claude', name: 'Claude AI' })).toBe('claude');
  });

  it('keeps what both filters keep', () => {
    expect(items.filter((x) => passes(x, { kind: 'all', by: null }))).toHaveLength(4);
    expect(items.filter((x) => passes(x, { kind: 'docs', by: null }))).toHaveLength(2);
    expect(items.filter((x) => passes(x, { kind: 'docs', by: 'leo-martin' }))).toHaveLength(1);
    expect(items.filter((x) => passes(x, { kind: 'product', by: null }))).toHaveLength(0);
  });

  it('counts each option over what the other filter keeps, every kind listed', () => {
    expect(kindOptions(items, null).map((o) => [o.value, o.count])).toEqual([
      ['all', 4],
      ['product', 0],
      ['library', 2],
      ['docs', 2],
    ]);
    expect(kindOptions(items, 'leo-martin').map((o) => o.count)).toEqual([2, 0, 1, 1]);
    expect(designerOptions(items, 'all')).toEqual([
      { value: EVERYONE, label: 'Everyone', count: 4 },
      { value: 'ann-leroy', label: 'Ann', count: 1 },
      { value: 'claude', label: 'Claude AI', count: 1 },
      { value: 'leo-martin', label: 'Leo', count: 2 },
    ]);
    // A designer with nothing of the kind stays listed, at 0.
    expect(designerOptions(items, 'docs').find((o) => o.value === 'ann-leroy')?.count).toBe(0);
  });

  it('says how many wait first, then how many show once filtered', () => {
    expect(queueSummary(15, 15, false)).toBe('15 changes wait on you.');
    expect(queueSummary(1, 1, false)).toBe('1 change waits on you.');
    expect(queueSummary(0, 0, false)).toBe('Nothing waits on you.');
    expect(queueSummary(4, 15, true)).toBe('4 of 15 changes.');
  });
});

describe('words', () => {
  it('designer words, no developer jargon, no em dash', () => {
    const words = [...kindOptions([], null).map((o) => o.label), queueSummary(4, 15, true), queueSummary(15, 15, false), reachLine(DEMO)!, 'Nothing of this kind waits on you.', 'Clear filters'];
    for (const w of words) {
      expect(jargonIn(w)).toEqual([]);
      expect(w).not.toContain('\u2014');
    }
  });
});
