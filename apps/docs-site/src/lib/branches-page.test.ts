import { describe, expect, it } from 'vitest';
import {
  barCopy,
  boxDisabled,
  emptyWhoLine,
  finishedParam,
  groupByProduct,
  mergedLine,
  mergedThisMonth,
  onlyLine,
  productOf,
  selectable,
  showsForWho,
  ownedBy,
  showsDesignerFilter,
  tabFilters,
  contributorTurn,
  whoFilterParam,
} from './branches-page';
import { jargonIn } from './vocabulary';
import type { ProductConfig } from '@bridge-ds/core';

describe('whose work', () => {
  it('opens on All unless the address says otherwise', () => {
    expect(whoFilterParam('')).toBe('all');
    expect(whoFilterParam('?who=mine')).toBe('mine');
    expect(whoFilterParam('?who=waiting')).toBe('waiting');
    expect(whoFilterParam('?who=nobody')).toBe('all');
  });

  it('Mine keeps the viewer branches, whatever the case or @', () => {
    expect(showsForWho('mine', { author: 'Ann', yourTurn: false }, '@ann')).toBe(true);
    expect(showsForWho('mine', { author: 'dana', yourTurn: true }, 'ann')).toBe(false);
  });

  it('Waiting on me keeps the rows whose next step is the viewer', () => {
    expect(showsForWho('waiting', { author: 'dana', yourTurn: true }, 'ann')).toBe(true);
    expect(showsForWho('waiting', { author: 'dana', yourTurn: false }, 'ann')).toBe(false);
  });

  it('signed out, only All shows rows', () => {
    expect(showsForWho('all', { author: 'dana', yourTurn: false }, null)).toBe(true);
    expect(showsForWho('mine', { author: 'dana', yourTurn: false }, null)).toBe(false);
    expect(emptyWhoLine('mine', false)).toBe('Sign in to see your branches.');
    expect(emptyWhoLine('waiting', true)).toBe('No branch waits on you.');
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

describe('finished branches', () => {
  it('old ?status= links still land on their list', () => {
    expect(finishedParam('')).toEqual({ finished: false, only: null });
    expect(finishedParam('?status=merged')).toEqual({ finished: true, only: null });
    expect(finishedParam('?status=shipped')).toEqual({ finished: true, only: null });
    expect(finishedParam('?status=closed')).toEqual({ finished: true, only: null });
    expect(finishedParam('?status=draft')).toEqual({ finished: false, only: 'draft' });
    expect(finishedParam('?status=open')).toEqual({ finished: false, only: null });
    expect(onlyLine('waiting')).toBe('Showing branches waiting for code only.');
    expect(onlyLine(null)).toBeNull();
  });

  it('counts what merged since the first of the month', () => {
    const now = new Date(2026, 9, 20, 12);
    const rows = [{ merged_at: new Date(2026, 9, 2).toISOString() }, { merged_at: new Date(2026, 8, 30).toISOString() }, { merged_at: null }, {}];
    expect(mergedThisMonth(rows, now)).toBe(1);
  });

  it('says a floor when every recent branch read merged this month', () => {
    expect(mergedLine(12, 30, 30)).toBe('12 merged this month.');
    expect(mergedLine(30, 30, 30)).toBe('30+ merged this month.');
    expect(mergedLine(0, 4, 30)).toBe('Nothing merged this month.');
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
    expect(barCopy(1)).toEqual({ title: '1 branch selected', hint: 'Select up to 3 more to preview them together', action: 'alone', label: 'Try it alone' });
    expect(barCopy(3)).toEqual({ title: '3 branches selected', hint: null, action: 'together', label: 'Preview together' });
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

  it('shows Mine from that list', () => {
    expect(showsForWho('mine', { author: 'bridge-app[bot]', yourTurn: false, mine: true }, 'leo@acme.design')).toBe(true);
    expect(showsForWho('mine', { author: 'leo@acme.design', yourTurn: false, mine: false }, 'leo@acme.design')).toBe(false);
  });

  it('waits on them only for their branches sent back with changes', () => {
    expect(contributorTurn({ own: true, changesRequested: ['dana'], open: true })).toBe(true);
    expect(contributorTurn({ own: true, changesRequested: [], open: true })).toBe(false);
    expect(contributorTurn({ own: false, changesRequested: ['dana'], open: true })).toBe(false);
    expect(contributorTurn({ own: true, changesRequested: ['dana'], open: false })).toBe(false);
  });
});

describe('the filter bar on every tab', () => {
  it('shows the designer filter on Waiting on me and All, not on Mine', () => {
    expect(showsDesignerFilter('waiting')).toBe(true);
    expect(showsDesignerFilter('all')).toBe(true);
    expect(showsDesignerFilter('mine')).toBe(false);
  });

  it('keeps the picks across tabs and applies what each tab can', () => {
    const picked = { kind: 'library', by: 'ann' };
    expect(tabFilters('all', picked, ['ann', 'dana'])).toEqual({ kind: 'library', by: 'ann' });
    expect(tabFilters('mine', picked, ['ann'])).toEqual({ kind: 'library', by: null });
    expect(tabFilters('waiting', picked, ['dana'])).toEqual({ kind: 'library', by: null });
  });
});
