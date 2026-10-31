import { describe, expect, it } from 'vitest';
import {
  barCopy,
  boxDisabled,
  changesFiltersParam,
  emptyTabLine,
  isYours,
  knownNames,
  peopleOptions,
  stateOf,
  visibleTabs,
  withChangesFilters,
  YOU,
  finishedParam,
  groupByProduct,
  FINISHED_WORDS,
  mergedLine,
  mergedThisMonth,
  productOf,
  selectable,
  ownedBy,
  contributorTurn,
} from './branches-page';
import { jargonIn } from './vocabulary';
import type { ProductConfig } from '@bridge-ds/core';

describe('state tabs and the address', () => {
  it('opens on All, every filter read from the address', () => {
    expect(changesFiltersParam('')).toEqual({ state: 'all', kind: 'all', by: null });
    expect(changesFiltersParam('?state=exploring&kind=library&people=Ann-Leroy')).toEqual({ state: 'exploring', kind: 'library', by: 'ann-leroy' });
    expect(changesFiltersParam('?state=nothing')).toEqual({ state: 'all', kind: 'all', by: null });
    expect(changesFiltersParam('?people=you').by).toBe(YOU);
  });

  it('keeps old links working', () => {
    expect(changesFiltersParam('?who=mine')).toEqual({ state: 'all', kind: 'all', by: YOU });
    expect(changesFiltersParam('?view=mine')).toEqual({ state: 'all', kind: 'all', by: YOU });
    expect(changesFiltersParam('?who=waiting')).toEqual({ state: 'waiting', kind: 'all', by: null });
    expect(changesFiltersParam('?archived=1').state).toBe('archived');
    expect(changesFiltersParam('?status=waiting').state).toBe('code');
    expect(changesFiltersParam('?status=draft').state).toBe('draft');
    expect(changesFiltersParam('?by=dana&kind=docs')).toEqual({ state: 'all', kind: 'docs', by: 'dana' });
    expect(changesFiltersParam('?by=~everyone').by).toBeNull();
  });

  it('writes the filters back, defaults out of the address, old parameters dropped', () => {
    expect(withChangesFilters('?who=mine&pr=3', { state: 'all', kind: 'all', by: YOU })).toBe('?pr=3&people=you');
    expect(withChangesFilters('?archived=1', { state: 'archived', kind: 'all', by: null })).toBe('?state=archived');
    expect(withChangesFilters('?state=code&kind=docs&people=dana', { state: 'all', kind: 'all', by: null })).toBe('');
    expect(withChangesFilters('?status=merged', { state: 'all', kind: 'all', by: null })).toBe('?status=merged');
  });

  it('puts each row under the tab its tag names', () => {
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Not started' } })).toBe('not-started');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Exploring' } })).toBe('exploring');
    expect(stateOf({ lifecycle: 'exploration', pill: null })).toBe('exploring');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Waiting for code' } })).toBe('code');
    expect(stateOf({ lifecycle: 'exploration', pill: { label: 'Being built' } })).toBeNull();
    expect(stateOf({ lifecycle: 'draft', pill: { label: 'Draft' } })).toBe('draft');
    expect(stateOf({ lifecycle: 'draft', pill: { label: 'Waiting for a developer' } })).toBe('code');
    expect(stateOf({ lifecycle: 'ready', pill: { label: 'Waiting for Ann' } })).toBe('review');
    expect(stateOf({ lifecycle: 'waiting', pill: null })).toBe('code');
    expect(stateOf({ lifecycle: 'shipped', pill: null })).toBeNull();
  });

  it('shows All and Waiting on me always, the other tabs while they hold something or are picked', () => {
    const tabs = (c: Record<string, number>, cur = 'all') => visibleTabs(c, cur as never).map((t) => `${t.label} ${t.count}`);
    expect(tabs({ all: 3, exploring: 2, 'not-started': 1 })).toEqual(['All 3', 'Waiting on me 0', 'Not started 1', 'Exploring 2']);
    expect(tabs({ all: 1, archived: 1, review: 1 })).toEqual(['All 1', 'Waiting on me 0', 'In review 1', 'Archived 1']);
    expect(tabs({ all: 0 }, 'code')).toEqual(['All 0', 'Waiting on me 0', 'Waiting for code 0']);
  });

  it('says what an empty tab is for, in designer words', () => {
    expect(emptyTabLine('waiting', false)).toBe('Sign in to see what waits on you.');
    expect(emptyTabLine('waiting', true)).toMatch(/^Nothing waits on you\./);
    expect(emptyTabLine('all', true)).toBe('No open change.');
    for (const t of ['all', 'waiting', 'not-started', 'exploring', 'draft', 'review', 'code', 'archived'] as const) {
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

describe('finished branches', () => {
  it('old ?status= links still land on their list', () => {
    expect(finishedParam('')).toEqual({ finished: false, only: null });
    expect(finishedParam('?status=merged')).toEqual({ finished: true, only: null });
    expect(finishedParam('?status=shipped')).toEqual({ finished: true, only: null });
    expect(finishedParam('?status=closed')).toEqual({ finished: true, only: null });
    expect(finishedParam('?status=draft')).toEqual({ finished: false, only: 'draft' });
    expect(finishedParam('?status=open')).toEqual({ finished: false, only: null });
  });

  it('counts what merged since the first of the month', () => {
    const now = new Date(2026, 9, 20, 12);
    const rows = [{ merged_at: new Date(2026, 9, 2).toISOString() }, { merged_at: new Date(2026, 8, 30).toISOString() }, { merged_at: null }, {}];
    expect(mergedThisMonth(rows, now)).toBe(1);
  });

  it('says a floor when every recent branch read merged this month', () => {
    expect(mergedLine(12, 30, 30)).toBe('12 added to the library this month.');
    expect(mergedLine(30, 30, 30)).toBe('30+ added to the library this month.');
    expect(mergedLine(0, 4, 30)).toBe('Nothing added to the library this month.');
    // Designer words: never "merged" on the line or its link.
    for (const t of [mergedLine(3, 4, 30), ...Object.values(FINISHED_WORDS)]) expect(t).not.toMatch(/merge|branch/i);
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
