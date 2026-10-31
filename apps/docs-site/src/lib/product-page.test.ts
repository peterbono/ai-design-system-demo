import { describe, expect, it } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import { emptyProductLine, folderLine, productFacts, productFolders, productGroups, productHref, productKeyFromPath, productSummary, stateOfCard } from './product-page';
import { explorationProductKey, homeExplorations, type ExplorationCard } from './home-explorations';
import { person } from './home-model';

const products: ProductConfig[] = [
  { key: 'admin-app', name: 'Product admin', repo: 'acme/product-admin', production: 'https://admin.acme.app' },
  { key: 'library', name: 'Library', default: true },
];

const card = (n: number, over: Partial<ExplorationCard> = {}): ExplorationCard => ({
  number: n,
  key: String(n),
  title: `Screen ${n}`,
  href: `/studio/changes/?exploration=${n}`,
  product: 'Product admin',
  productKey: 'admin-app',
  author: person('ann', 'Ann', null),
  stage: 'exploring',
  state: 'Exploring',
  updated: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
  preview: { kind: 'screen', src: null },
  own: false,
  ...over,
});

describe('product page address', () => {
  it('builds and reads /studio/products/<key>/, self-hosted and on a team', () => {
    expect(productHref('Admin-App')).toBe('/studio/products/admin-app/');
    expect(productKeyFromPath('/studio/products/admin-app/')).toBe('admin-app');
    expect(productKeyFromPath('/studio/acme/ds/products/library/')).toBe('library');
    expect(productKeyFromPath('/studio/~/acme/ds/products/library')).toBe('library');
    expect(productKeyFromPath('/studio/changes/')).toBeNull();
    expect(productKeyFromPath('/studio/products/bad%20key/')).toBeNull();
  });
});

describe('grouping by where explorations stand', () => {
  it('groups Exploring, Waiting for code, Being built, In review and Shipped (the lifecycle order), empty groups left out', () => {
    const cards = [
      card(1, { stage: 'kept', state: 'Shipped' }),
      card(2),
      card(3, { stage: 'with-devs', state: 'Being built' }),
      card(4, { stage: 'found', state: '2 new pieces found' }),
      card(5, { stage: 'with-devs', state: 'Waiting for code' }),
    ];
    const groups = productGroups(cards);
    expect(groups.map((g) => [g.label, g.cards.map((c) => c.number)])).toEqual([
      ['Exploring', [2, 4]],
      ['Waiting for code', [5]],
      ['Being built', [3]],
      ['Shipped', [1]],
    ]);
    expect(stateOfCard({ stage: 'in-review', state: 'In review' })).toBe('review');
  });

  it('says what is in progress, in one sentence and on a folder line', () => {
    const cards = [card(1), card(2), card(3, { stage: 'with-devs', state: 'Waiting for code' }), card(4, { stage: 'kept', state: 'Shipped' })];
    expect(productSummary(cards)).toBe('2 exploring, 1 waiting for code.');
    expect(folderLine(cards)).toBe('2 exploring · 1 waiting for code');
    expect(productSummary([card(4, { stage: 'kept', state: 'Shipped' })])).toBe('1 shipped, nothing in progress.');
    expect(folderLine([])).toBe('Nothing in progress');
    expect(productSummary([])).toBe('Nothing explored here yet.');
  });
});

describe('product folders', () => {
  it('gives every configured product a folder, its latest screens first, its counts and its page', () => {
    const cards = [
      card(1, { preview: { kind: 'screen', src: '/a.png' } }),
      card(2, { preview: { kind: 'screen', src: '/b.png' } }),
      card(3, { productKey: 'library', product: null, stage: 'with-devs', state: 'Waiting for code' }),
      card(4, { preview: { kind: 'screen', src: '/d.png' } }),
      card(5, { preview: { kind: 'screen', src: '/e.png' } }),
    ];
    const [admin, lib] = productFolders(products, cards);
    expect(admin).toMatchObject({ key: 'admin-app', name: 'Product admin', href: '/studio/products/admin-app/', line: '4 exploring', total: 4 });
    expect(admin!.shots.map((s) => s.key)).toEqual(['5', '4', '2']);
    expect(lib).toMatchObject({ key: 'library', line: '1 waiting for code', total: 1 });
  });

  it('keeps a product with no exploration (it is a real app), and files a card without a product under the library', () => {
    const folders = productFolders(products, [card(1, { productKey: undefined, product: null })]);
    expect(folders.map((f) => [f.key, f.total])).toEqual([
      ['admin-app', 0],
      ['library', 1],
    ]);
  });
});

describe('product of an exploration', () => {
  it('reads the product repository first, then the product label, else the library', () => {
    expect(explorationProductKey({ product: 'admin-app', labels: [] }, products)).toBe('admin-app');
    expect(explorationProductKey({ labels: [{ name: 'product: Product admin' }] }, products)).toBe('admin-app');
    expect(explorationProductKey({ labels: ['exploration'] }, products)).toBe('library');
  });

  it('keeps archived explorations apart, for the fold', () => {
    const pulls = [
      { number: 1, title: 'Pill buttons', state: 'open', draft: true, labels: [{ name: 'exploration' }], head: { ref: 'explore/pills' }, user: { login: 'ann' }, updated_at: '2026-10-20T10:00:00Z' },
      { number: 2, title: 'Old idea', state: 'open', draft: true, labels: [{ name: 'exploration' }, { name: 'archived' }], head: { ref: 'explore/old' }, user: { login: 'ann' }, updated_at: '2026-10-19T10:00:00Z' },
    ];
    const opts = { products, author: () => person('ann', 'Ann', null) };
    expect(homeExplorations(pulls, opts).map((c) => [c.number, c.productKey])).toEqual([[1, 'library']]);
    expect(homeExplorations(pulls, { ...opts, archived: 'only' }).map((c) => c.number)).toEqual([2]);
  });
});

describe('product facts', () => {
  it('says where it is live, where its code lives and whether Bridge reaches it', () => {
    expect(productFacts(products[0]!, 'acme/product-admin', true)).toEqual({
      production: { href: 'https://admin.acme.app', label: 'admin.acme.app' },
      repo: { href: 'https://github.com/acme/product-admin', label: 'acme/product-admin' },
      inLibrary: null,
      connection: { text: 'Connected', ok: true },
    });
    expect(productFacts(products[0]!, 'acme/product-admin', false).connection).toEqual({ text: 'Not connected yet', ok: false });
    expect(productFacts(products[1]!, null, null)).toMatchObject({ production: null, repo: null, inLibrary: 'In the library repository', connection: null });
  });

  it('gives the empty page a reason, never an em dash', () => {
    for (const line of [emptyProductLine(products[0]!, false), emptyProductLine(products[1]!, true)]) {
      expect(line).not.toContain('—');
      expect(line.endsWith('.')).toBe(true);
    }
    expect(emptyProductLine(products[0]!, false)).toContain('Product admin');
  });
});
