// The side nav's Products group and the All products page (lib/nav-products.ts): the viewer's own first, five at most,
// the product on screen always listed, the filter, and what this browser keeps per team.
import { describe, expect, it } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import {
  allProductsLine,
  filterProducts,
  libraryOf,
  mineFromCards,
  mineKey,
  moreLabel,
  navProductRows,
  navProducts,
  noMatchLine,
  noteMine,
  noteOpened,
  orderProducts,
  readSignals,
  type ProductSignals,
} from './nav-products';

const NAMES = ['Checkout', 'Mobile app', 'Art print shop', 'Poster studio', 'Billing', 'Onboarding', 'Admin console', 'Help center', 'Search', 'Reports', 'Settings app', 'Marketing site', 'Partner portal', 'Email kit', 'Kiosk'];
const config: ProductConfig[] = [...NAMES.map((name) => ({ key: name.toLowerCase().replace(/\s+/g, '-'), name })), { key: 'library', name: 'Library', default: true }];
const products = navProducts(config);
const keys = (list: { key: string }[]) => list.map((p) => p.key);

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('orderProducts', () => {
  it('leaves the library out: it is Explorations, under Design system', () => {
    expect(keys(orderProducts(products))).not.toContain('library');
    expect(libraryOf(products)?.key).toBe('library');
  });

  it('lists the rest by name when this browser knows nothing of the viewer', () => {
    expect(keys(orderProducts(products)).slice(0, 4)).toEqual(['admin-console', 'art-print-shop', 'billing', 'checkout']);
  });

  it('puts the products the viewer explores in first, latest first, then the ones opened lately, then the rest', () => {
    const signals: ProductSignals = { mine: { kiosk: 100, checkout: 300 }, opened: { 'help-center': 50, billing: 80, checkout: 999 } };
    expect(keys(orderProducts(products, signals)).slice(0, 5)).toEqual(['checkout', 'kiosk', 'billing', 'help-center', 'admin-console']);
  });
});

describe('navProductRows', () => {
  it('lists every product and no "All products" with five or fewer', () => {
    const two = navProducts([config[2]!, config[3]!, config[15]!]);
    expect(navProductRows(two)).toEqual({ shown: [two[0], two[1]], total: 2, all: false });
    const five = navProducts(config.slice(0, 5));
    expect(navProductRows(five).all).toBe(false);
    expect(navProductRows(five).shown).toHaveLength(5);
  });

  it('caps the list at five, the viewer\'s own first, and counts every product on "All products"', () => {
    const rows = navProductRows(products, { mine: { 'partner-portal': 10 }, opened: { kiosk: 5 } });
    expect(rows.shown).toHaveLength(5);
    expect(keys(rows.shown).slice(0, 2)).toEqual(['partner-portal', 'kiosk']);
    expect(rows.total).toBe(15);
    expect(rows.all).toBe(true);
  });

  it('always shows the product on screen, in the last row when it is beyond the first five', () => {
    const rows = navProductRows(products, { mine: {}, opened: {} }, 'reports');
    expect(rows.shown).toHaveLength(5);
    expect(rows.shown[4]!.key).toBe('reports');
    expect(keys(rows.shown).slice(0, 4)).toEqual(['admin-console', 'art-print-shop', 'billing', 'checkout']);
    // Already among the first five: nothing moves.
    expect(keys(navProductRows(products, undefined, 'billing').shown)).toEqual(keys(navProductRows(products).shown));
    // The library is not a Products row, even when it is the page on screen.
    expect(keys(navProductRows(products, undefined, 'library').shown)).not.toContain('library');
  });
});

describe('All products', () => {
  it('finds a product by any part of its name, whatever the case or accents', () => {
    const list = [{ name: 'Checkout' }, { name: 'Mobile app' }, { name: 'Café menu' }];
    expect(filterProducts(list, 'app')).toEqual([{ name: 'Mobile app' }]);
    expect(filterProducts(list, '  CHECK ')).toEqual([{ name: 'Checkout' }]);
    expect(filterProducts(list, 'cafe')).toEqual([{ name: 'Café menu' }]);
    expect(filterProducts(list, '')).toEqual(list);
    expect(filterProducts(list, 'zzz')).toEqual([]);
  });

  it('says how many and who comes first, in the Bridge voice', () => {
    expect(allProductsLine(15)).toBe('15 products. Yours come first.');
    expect(allProductsLine(1)).toBe('1 product.');
    expect(allProductsLine(0)).toBe('No products yet.');
    expect(moreLabel(7)).toBe('Show 7 more');
    expect(moreLabel(20)).toBe('Show 8 more');
    expect(noMatchLine(' zzz ')).toBe('No product called "zzz". Check the name or clear the filter.');
    for (const s of [allProductsLine(15), noMatchLine('x')]) expect(s).not.toMatch(/—/);
  });
});

describe('what this browser keeps', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const card = (over: Partial<{ own: boolean; lifecycle: string; updated: string; productKey: string }>) =>
    ({ own: true, lifecycle: 'exploring', updated: new Date(now - day).toISOString(), productKey: 'checkout', ...over }) as Parameters<typeof mineFromCards>[0][number];

  it('counts the viewer\'s own explorations in progress, or recent, never someone else\'s', () => {
    const mine = mineFromCards(
      [
        card({}),
        card({ productKey: 'billing', lifecycle: 'shipped', updated: new Date(now - 60 * day).toISOString() }),
        card({ productKey: 'kiosk', lifecycle: 'shipped', updated: new Date(now - 3 * day).toISOString() }),
        card({ productKey: 'search', own: false }),
        card({ productKey: 'reports', lifecycle: 'waiting-for-code', updated: new Date(now - 90 * day).toISOString() }),
      ],
      config,
      now,
    );
    expect(Object.keys(mine).sort()).toEqual(['checkout', 'kiosk', 'reports']);
  });

  it('keeps the signals per team, and reads nothing broken', () => {
    const s = memory();
    noteOpened('Acme/Flow', 'Kiosk', 5, s);
    noteOpened('acme/flow', 'billing', 9, s);
    noteMine('acme/flow', { checkout: 7 }, s);
    expect(readSignals('acme/flow', s)).toEqual({ mine: { checkout: 7 }, opened: { kiosk: 5, billing: 9 } });
    expect(readSignals('acme/other', s)).toEqual({ mine: {}, opened: {} });
    s.setItem(mineKey('acme/flow'), '{not json');
    expect(readSignals('acme/flow', s).mine).toEqual({});
    expect(readSignals(null, s)).toEqual({ mine: {}, opened: {} });
    expect(readSignals('acme/flow', null)).toEqual({ mine: {}, opened: {} });
  });
});
