import { describe, expect, it } from 'vitest';
import {
  ALL_PRODUCTS,
  barCopy,
  listSummary,
  productOptions,
  boxDisabled,
  changesFiltersParam,
  designRows,
  emptyTabLine,
  isYours,
  knownNames,
  peopleOptions,
  stateOf,
  visibleTabs,
  withChangesFilters,
  YOU,
  groupByMonth,
  groupByProduct,
  shippedCapLine,
  shippedMonth,
  shippedOn,
  shippedRows,
  productOf,
  selectable,
  ownedBy,
  contributorTurn,
} from './branches-page';
import { jargonIn } from './vocabulary';
import type { ProductConfig } from '@bridge-ds/core';

describe('state tabs and the address', () => {
  it('opens on All, every filter read from the address', () => {
    expect(changesFiltersParam('')).toEqual({ state: 'all', product: null, by: null });
    expect(changesFiltersParam('?state=exploring&product=Admin-App&people=Ann-Leroy')).toEqual({ state: 'exploring', product: 'admin-app', by: 'ann-leroy' });
    // An open exploration's ?product= is its product, not a filter.
    expect(changesFiltersParam('?exploration=4&product=admin-app').product).toBeNull();
    expect(changesFiltersParam('?state=nothing')).toEqual({ state: 'all', product: null, by: null });
    expect(changesFiltersParam('?people=you').by).toBe(YOU);
  });

  it('keeps old links working', () => {
    expect(changesFiltersParam('?who=mine')).toEqual({ state: 'all', product: null, by: YOU });
    expect(changesFiltersParam('?view=mine')).toEqual({ state: 'all', product: null, by: YOU });
    expect(changesFiltersParam('?who=waiting')).toEqual({ state: 'waiting', product: null, by: null });
    expect(changesFiltersParam('?archived=1').state).toBe('archived');
    expect(changesFiltersParam('?status=waiting').state).toBe('code');
    expect(changesFiltersParam('?status=draft').state).toBe('building');
    // The tabs before the one lifecycle: Not started is Exploring, Draft is Being built.
    expect(changesFiltersParam('?state=not-started').state).toBe('exploring');
    expect(changesFiltersParam('?state=draft').state).toBe('building');
    expect(changesFiltersParam('?by=dana&kind=docs')).toEqual({ state: 'all', product: 'library', by: 'dana' });
    // The kind filter before the products: the library and its guidance are the library product, In a product is all.
    expect(changesFiltersParam('?kind=library').product).toBe('library');
    expect(changesFiltersParam('?kind=product').product).toBeNull();
    expect(changesFiltersParam('?kind=docs', [{ key: 'shop', name: 'Shop' }, { key: 'ds', name: 'DS', default: true }]).product).toBe('ds');
    expect(changesFiltersParam('?by=~everyone').by).toBeNull();
  });

  it('writes the filters back, defaults out of the address, old parameters dropped', () => {
    expect(withChangesFilters('?who=mine&pr=3', { state: 'all', product: null, by: YOU })).toBe('?pr=3&people=you');
    expect(withChangesFilters('?archived=1', { state: 'archived', product: null, by: null })).toBe('?state=archived');
    expect(withChangesFilters('?state=code&kind=docs&people=dana', { state: 'all', product: null, by: null })).toBe('');
    expect(withChangesFilters('?kind=docs', { state: 'all', product: 'library', by: null })).toBe('?product=library');
    expect(withChangesFilters('?exploration=4&product=admin-app', { state: 'all', product: null, by: null })).toBe('?exploration=4&product=admin-app');
    expect(withChangesFilters('?status=merged', { state: 'shipped', product: null, by: null })).toBe('?state=shipped');
  });

  it('lists all products, then each configured product with its count, a product at 0 only while picked', () => {
    const products = [{ key: 'admin-app', name: 'Art print shop' }, { key: 'account', name: 'Account app' }, { key: 'library', name: 'Library', default: true }];
    const items = [{ product: 'admin-app' }, { product: 'library' }, { product: 'library' }];
    expect(productOptions(items, products, null)).toEqual([
      { value: ALL_PRODUCTS, label: 'All products', count: 3 },
      { value: 'admin-app', label: 'Art print shop', count: 1 },
      { value: 'library', label: 'Library', count: 2 },
    ]);
    expect(productOptions(items, products, 'account').map((o) => o.label)).toEqual(['All products', 'Art print shop', 'Account app', 'Library']);
    expect(listSummary(3, 3, false)).toBe('3 changes.');
    expect(listSummary(1, 4, true)).toBe('1 of 4 changes.');
  });

  it('puts each row under the tab its tag names', () => {
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Not started' } })).toBe('exploring');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Exploring' } })).toBe('exploring');
    expect(stateOf({ lifecycle: 'exploration', pill: null })).toBe('exploring');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Waiting for code' } })).toBe('code');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Being built' } })).toBe('building');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'In review' } })).toBe('review');
    // The stage, once read, decides over the tag.
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Being built' }, stage: 'in-review' })).toBe('review');
    expect(stateOf({ lifecycle: 'exploration', pill: null, stage: 'archived' })).toBeNull();
    expect(stateOf({ lifecycle: 'draft', pill: { label: 'Being built' } })).toBe('building');
    expect(stateOf({ lifecycle: 'draft', pill: { label: 'Waiting for code' } })).toBe('code');
    expect(stateOf({ lifecycle: 'draft', pill: { label: 'Waiting for a developer' } })).toBe('code');
    expect(stateOf({ lifecycle: 'ready', pill: { label: 'Waiting for Ann' } })).toBe('review');
    expect(stateOf({ lifecycle: 'waiting', pill: null })).toBe('code');
    expect(stateOf({ lifecycle: 'shipped', pill: null })).toBeNull();
  });

  it("shows the designer's tabs, leaving the developers' side to Being built", () => {
    const tabs = (c: Record<string, number>, cur = 'all') => visibleTabs(c, cur as never).map((t) => `${t.label} ${t.count}`);
    expect(tabs({ all: 3, exploring: 2, review: 1 })).toEqual(['All 3', 'Waiting on me 0', 'Exploring 2', 'Shipped 0']);
    expect(tabs({ archived: 2 })).toEqual(['All 0', 'Waiting on me 0', 'Exploring 0', 'Shipped 0', 'Archived 2']);
    // An old link to a developer tab still opens it.
    expect(tabs({ review: 1 }, 'review')).toContain('In review 1');
  });

  it('says what an empty tab is for, in designer words', () => {
    expect(emptyTabLine('waiting', false)).toBe('Sign in to see what waits on you.');
    expect(emptyTabLine('waiting', true)).toMatch(/^Nothing waits on you\./);
    expect(emptyTabLine('all', true)).toBe('No open change.');
    for (const t of ['all', 'waiting', 'exploring', 'code', 'building', 'review', 'shipped', 'archived'] as const) {
      expect(jargonIn(emptyTabLine(t, true))).toEqual([]);
      expect(emptyTabLine(t, true)).not.toContain('\u2014');
    }
  });
});

describe('the people filter', () => {
  it('You is the person the row shows: who asked for it, else the author, never Claude', () => {
    expect(isYours({ author: 'Ann' }, '@ann')).toBe(true);
    expect(isYours({ author: 'dana' }, 'ann')).toBe(false);
    expect(isYours({ author: 'bridge-app[bot]', requester: { name: null, login: 'peterbono' } }, 'PeterBono')).toBe(true);
    expect(isYours({ author: 'peterbono', requester: { name: 'Ann Leroy', login: null } }, 'peterbono', 'Florian Gouloubi')).toBe(false);
    expect(isYours({ author: 'bridge-app[bot]', requester: { name: 'Florian Gouloubi', login: null } }, 'peterbono', 'Florian Gouloubi')).toBe(true);
    expect(isYours({ author: 'peterbono', agent: true }, 'peterbono')).toBe(false);
    expect(isYours({ author: 'bridge-app[bot]', mine: true }, 'leo@acme.design')).toBe(true);
    expect(isYours({ author: 'dana' }, null)).toBe(false);
  });

  it('lists Everyone, then You, then the others by name', () => {
    const o = [
      { value: '~everyone', label: 'Everyone', count: 3 },
      { value: 'ann', label: 'Ann', count: 1 },
      { value: YOU, label: 'Florian', count: 2 },
    ];
    expect(peopleOptions(o, true).map((x) => `${x.label} ${x.count}`)).toEqual(['Everyone 3', 'You 2', 'Ann 1']);
    expect(peopleOptions(o.slice(0, 2), true).map((x) => `${x.label} ${x.count}`)).toEqual(['Everyone 3', 'You 0', 'Ann 1']);
    expect(peopleOptions(o.slice(0, 2), false).map((x) => x.label)).toEqual(['Everyone', 'Ann']);
  });

  it('knows a name for a login written bare on another row', () => {
    const names = knownNames([{ requester: { name: 'Florian Gouloubi', login: 'peterbono' } }, { requester: { name: null, login: 'peterbono' } }, { requester: null }], { login: 'dana', name: 'Dana Kim' });
    expect(names.get('peterbono')).toBe('Florian Gouloubi');
    expect(names.get('dana')).toBe('Dana Kim');
    expect(names.get('ann')).toBeUndefined();
  });
});

describe('product groups', () => {
  it('a branch touching apps/admin belongs to the Admin demo, the rest to the library', () => {
    expect(productOf(['apps/admin/src/Billing.tsx', 'packages/react/src/Badge.tsx'])).toBe('admin');
    expect(productOf(['packages/tokens/src/semantic/light.tokens.json'])).toBe('library');
    expect(productOf(null)).toBe('library');
    expect(productOf(['apps/administration/x.ts'])).toBe('library');
  });

  it('groups keep the row order, the product first, and drop empty groups', () => {
    const rows = [
      { n: 1, product: 'library' as const },
      { n: 2, product: 'admin' as const },
      { n: 3, product: 'library' as const },
    ];
    expect(groupByProduct(rows).map((g) => [g.label, g.rows.map((r) => r.n)])).toEqual([
      ['Admin demo', [2]],
      ['Library', [1, 3]],
    ]);
    expect(groupByProduct(rows.filter((r) => r.product === 'library')).map((g) => g.key)).toEqual(['library']);
    expect(groupByProduct([])).toEqual([]);
  });

  it('a product: label puts the branch in that product', () => {
    expect(productOf(['packages/react/src/Badge.tsx'], undefined, [{ name: 'product: admin' }])).toBe('admin');
    expect(productOf(['apps/admin/src/App.tsx'], undefined, ['product: library'])).toBe('library');
    expect(productOf(['apps/admin/src/App.tsx'], undefined, [{ name: 'product: unknown' }])).toBe('admin');
  });

  it('a configured product list decides the groups and their order', () => {
    const products: ProductConfig[] = [
      { key: 'library', name: 'Library', path: 'packages', default: true },
      { key: 'shop', name: 'Shop', path: 'apps/shop' },
    ];
    expect(productOf(['apps/shop/src/Cart.tsx'], products)).toBe('shop');
    expect(productOf(['apps/admin/src/App.tsx'], products)).toBe('library');
    const rows = [
      { n: 1, product: 'shop' },
      { n: 2, product: 'library' },
    ];
    expect(groupByProduct(rows, products).map((g) => [g.label, g.rows.map((r) => r.n)])).toEqual([
      ['Library', [2]],
      ['Shop', [1]],
    ]);
  });
});

describe('shipped: the history of the work', () => {
  it('opens Shipped from the old merged line, its ?status= links and History', () => {
    expect(changesFiltersParam('?state=shipped').state).toBe('shipped');
    expect(changesFiltersParam('?status=merged').state).toBe('shipped');
    expect(changesFiltersParam('?status=shipped').state).toBe('shipped');
    expect(changesFiltersParam('?status=closed').state).toBe('shipped');
    expect(changesFiltersParam('?view=history').state).toBe('shipped');
  });

  it('keeps the merged rows only, newest first', () => {
    const rows = [{ n: 1, merged_at: '2026-09-30T10:00:00Z' }, { n: 2, merged_at: null }, { n: 3, merged_at: '2026-10-30T10:00:00Z' }, { n: 4 }, { n: 5, merged_at: '2026-10-02T10:00:00Z' }];
    expect(shippedRows(rows).map((r) => r.n)).toEqual([3, 5, 1]);
  });

  it('groups them by month, newest month first, and dates each row', () => {
    const rows = [{ n: 1, merged_at: '2026-09-30T10:00:00Z' }, { n: 3, merged_at: '2026-10-30T10:00:00Z' }, { n: 5, merged_at: '2026-10-02T10:00:00Z' }];
    expect(groupByMonth(rows, undefined, true).map((g) => [g.label, g.rows.map((r) => r.n)])).toEqual([
      ['October 2026', [3, 5]],
      ['September 2026', [1]],
    ]);
    expect(shippedMonth('2026-10-30T10:00:00Z', true)).toBe('October 2026');
    expect(shippedOn('2026-10-30T10:00:00Z', true)).toBe('Shipped Oct 30');
  });

  it('says when only the most recent ones were read, in designer words', () => {
    expect(shippedCapLine(12, 50)).toBeNull();
    expect(shippedCapLine(50, 50)).toBe('Showing the most recent ones.');
    expect(jargonIn(emptyTabLine('shipped', true))).toEqual([]);
    expect(emptyTabLine('shipped', true)).not.toMatch(/merge|GitHub/i);
  });
});

describe('selection', () => {
  it('only token branches get a checkbox', () => {
    expect(selectable({ tokenOnly: true })).toBe(true);
    expect(selectable({ tokenOnly: false })).toBe(false);
    expect(selectable({ tokenOnly: null })).toBe(false);
  });

  it('after 4, the other boxes disable and the checked ones stay free', () => {
    expect(boxDisabled([1, 2, 3], 9)).toBe(false);
    expect(boxDisabled([1, 2, 3, 4], 9)).toBe(true);
    expect(boxDisabled([1, 2, 3, 4], 2)).toBe(false);
  });

  it('the bar: nothing, one (try it alone), two to four (preview together)', () => {
    expect(barCopy(0)).toBeNull();
    expect(barCopy(1)).toEqual({ title: '1 change selected', hint: 'Select up to 3 more to preview them together', action: 'alone', label: 'Try it alone' });
    expect(barCopy(3)).toEqual({ title: '3 changes selected', hint: null, action: 'together', label: 'Preview together' });
  });

  it('speaks designer words only', () => {
    for (const n of [1, 2, 4]) {
      const c = barCopy(n)!;
      expect(jargonIn(`${c.title} ${c.hint ?? ''} ${c.label}`)).toEqual([]);
    }
  });
});

describe('email contributors on Branches', () => {
  const mine = { branches: ['bridge/leo-spacing'], issues: [42] };
  it('knows their own branches from the server list, not the author', () => {
    expect(ownedBy({ author: 'bridge-app[bot]', number: 42, headRef: 'x' }, 'leo@acme.design', mine)).toBe(true);
    expect(ownedBy({ author: 'bridge-app[bot]', number: 7, headRef: 'bridge/leo-spacing' }, 'leo@acme.design', mine)).toBe(true);
    expect(ownedBy({ author: 'leo@acme.design', number: 8, headRef: 'y' }, 'leo@acme.design', null)).toBe(true);
    expect(ownedBy({ author: 'bridge-app[bot]', number: 9, headRef: 'bridge/ann' }, 'leo@acme.design', mine)).toBe(false);
    expect(ownedBy({ author: 'bridge-app[bot]', number: 42, headRef: 'x' }, 'leo@acme.design', null)).toBe(false);
  });

  it('shows You from that list', () => {
    expect(isYours({ author: 'bridge-app[bot]', mine: true }, 'leo@acme.design')).toBe(true);
    expect(isYours({ author: 'leo@acme.design', mine: false }, 'leo@acme.design')).toBe(false);
  });

  it('waits on them only for their branches sent back with changes', () => {
    expect(contributorTurn({ own: true, changesRequested: ['dana'], open: true })).toBe(true);
    expect(contributorTurn({ own: true, changesRequested: [], open: true })).toBe(false);
    expect(contributorTurn({ own: false, changesRequested: ['dana'], open: true })).toBe(false);
    expect(contributorTurn({ own: true, changesRequested: ['dana'], open: false })).toBe(false);
  });
});

describe("designRows: Bridge's own pull requests stay out of Changes", () => {
  const tooling = { paths: ['apps/docs-site/', 'packages/core/'], scopes: ['studio'] };
  const r = (n: number, rawTitle: string, ref: string, opens: 'pr' | 'exploration' = 'pr', product: string | null = null) => ({ number: n, title: rawTitle, rawTitle, head: { ref }, opens, labels: null, product });
  const rows = [
    r(1, 'fix(studio): Being built filters as underline Tabs', 'fix/being-built-tabs'),
    r(2, 'Library: Copy for Confluence', 'feat/library-confluence-export'),
    r(3, 'Button: new size', 'feat/button-size'),
    r(4, 'Exploration: new card', 'explore/new-card', 'exploration'),
    r(5, 'fix(studio): x', 'feat/x', 'exploration', 'admin-app'),
    r(6, 'feat(studio): Studio touches a component', 'feat/studio-button'),
  ];
  const files: Record<number, string[]> = { 2: ['apps/docs-site/src/a.ts', '.changeset/a.md'], 4: ['apps/docs-site/x.ts'], 6: ['apps/docs-site/a.ts', 'packages/react/src/components/Button/Button.tsx'] };

  it('hides by title scope until the files are read, then by the files', () => {
    expect(designRows(rows, () => null, tooling).map((x) => x.number)).toEqual([2, 3, 4, 5]);
    expect(designRows(rows, (x) => files[x.number], tooling).map((x) => x.number)).toEqual([3, 4, 5, 6]);
  });

  it('keeps every row without tooling (a team repository)', () => {
    expect(designRows(rows, (x) => files[x.number], null)).toHaveLength(rows.length);
    expect(designRows(rows, (x) => files[x.number], { paths: [] })).toHaveLength(rows.length);
  });
});
