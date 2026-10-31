// @vitest-environment jsdom
// A product page: its explorations grouped by where they stand, the archived ones counted in one quiet line, and the calm empty moment
// with the one action. The sidebar's Products group: one link per configured product, the current one marked.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { ProductConfig } from '@bridge-ds/core';
import { ProductPageView } from './ProductPage';
import { navProducts, ProductsNavView } from './ProductsNav';
import { person } from '../../../lib/home-model';
import type { ExplorationCard } from '../../../lib/home-explorations';
import type { ProductPageData } from '../../../scripts/product-page';

const products: ProductConfig[] = [
  { key: 'admin-app', name: 'Product admin', repo: 'acme/product-admin', production: 'https://admin.acme.app' },
  { key: 'library', name: 'Library', default: true },
];

const card = (n: number, over: Partial<ExplorationCard> = {}): ExplorationCard => ({
  number: n,
  key: `admin-app#${n}`,
  title: `Screen ${n}`,
  href: `/studio/changes/?exploration=${n}&product=admin-app`,
  product: 'Product admin',
  productKey: 'admin-app',
  author: person('ann', 'Ann Leroy', null),
  stage: 'exploring',
  state: 'Exploring',
  updated: '2026-10-20T10:00:00Z',
  preview: { kind: 'screen', src: null },
  own: false,
  ...over,
});

const data = (over: Partial<ProductPageData> = {}): ProductPageData => ({
  product: products[0]!,
  products,
  ownRepo: 'acme/product-admin',
  reached: true,
  loading: false,
  failed: null,
  cards: [],
  archived: [],
  ...over,
});

describe('ProductPageView', () => {
  it('groups the explorations by where they stand, says it in the header, and counts the archived ones in one line', async () => {
    const cards = [card(1), card(2), card(3, { stage: 'with-devs', state: 'Waiting for code' }), card(4, { stage: 'kept', state: 'Shipped' })];
    const { container } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards, archived: [card(9)] }) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Product admin' })).toBeTruthy();
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('2 exploring, 1 waiting for code.');
    expect([...container.querySelectorAll('[data-state-group]')].map((g) => [g.getAttribute('data-state-group'), g.querySelectorAll('.sh-card-item').length])).toEqual([
      ['running', 2],
      ['waiting', 1],
      ['shipped', 1],
    ]);
    // One quiet line: the live product. The repository and a healthy connection are not shown.
    expect(screen.getByRole('link', { name: /Open the live product/ }).getAttribute('href')).toBe('https://admin.acme.app');
    expect(screen.queryByRole('link', { name: /acme\/product-admin/ })).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
    // On a product page the product goes without saying.
    expect(container.querySelector('.sh-card-product')).toBeNull();
    // The one primary action on the title's line; archived ones are one quiet line to Changes' Archived tab, no cards.
    expect(container.querySelector('[data-st-actions]')!.textContent).toContain('Start an exploration');
    const line = container.querySelector('[data-archived-line]')!;
    expect(line.textContent).toBe('1 archived. See archived');
    expect(screen.getByRole('link', { name: 'See archived' }).getAttribute('href')).toBe('/studio/changes/?state=archived&product=admin-app');
    expect(line.querySelector('.sh-card-item')).toBeNull();
    expect(screen.queryByRole('button', { name: /Archived/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('turns nothing yet into a calm moment with the reason and the one action, none in the header', async () => {
    const { container } = render(createElement(ProductPageView, { productKey: 'library', components: [], data: data({ product: products[1]!, ownRepo: null, reached: null }) }));
    expect(container.querySelector('[data-st-summary]')!.textContent).toBe('Nothing explored here yet.');
    expect(container.querySelector('.pp-empty svg')).toBeTruthy();
    expect(container.querySelector('.pp-empty')!.textContent).toContain('Try a token, a variant or a new component');
    expect(container.querySelector('.pp-empty')!.textContent).toContain('Start an exploration');
    expect(container.querySelector('[data-st-actions]')!.textContent).toBe('');
    expect(container.querySelector('.pp-facts')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('says "2 archived." in the plural, and nothing at all without archived ones', () => {
    const { container, unmount } = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)], archived: [card(8), card(9)] }) }));
    expect(container.querySelector('[data-archived-line]')!.textContent).toBe('2 archived. See archived');
    unmount();
    const none = render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }) }));
    expect(none.container.querySelector('[data-archived-line]')).toBeNull();
  });

  it('says when the team lists no such product', () => {
    render(createElement(ProductPageView, { productKey: 'shop', components: [], data: data({ product: null }) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Product not found' })).toBeTruthy();
  });
});

describe('ProductPageView, rename (admins)', () => {
  const view = (rename: Parameters<typeof ProductPageView>[0]['rename']) => render(createElement(ProductPageView, { productKey: 'admin-app', components: [], data: data({ cards: [card(1)] }), rename }));

  it('read only without the rename: no pencil', () => {
    view(null);
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
  });

  it('a pencil after the title opens the name in place; Escape cancels', async () => {
    const onSend = vi.fn(async () => {});
    const { container } = view({ state: 'offer', onSend });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Product admin' }));
    const field = screen.getByRole('textbox', { name: 'Product name' }) as HTMLInputElement;
    expect(field.value).toBe('Product admin');
    expect(screen.getByRole('heading', { level: 1, name: 'Product admin' })).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Product name' })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('checks the name before sending, and says how to fix it', () => {
    const onSend = vi.fn(async () => {});
    view({ state: 'offer', onSend });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Product admin' }));
    const field = screen.getByRole('textbox', { name: 'Product name' });
    fireEvent.change(field, { target: { value: 'library' } });
    fireEvent.submit(field.closest('form')!);
    expect(screen.getByText('Another product already has this name. Pick a different one.')).toBeTruthy();
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Type a name for the product.')).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter sends it for review; the title keeps the current name until it merges', async () => {
    const onSend = vi.fn(async () => {});
    view({ state: 'offer', onSend });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Product admin' }));
    const field = screen.getByRole('textbox', { name: 'Product name' });
    fireEvent.change(field, { target: { value: ' Back office ' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(onSend).toHaveBeenCalledWith(' Back office ');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Rename sent for review. It shows everywhere once merged.'));
    expect(screen.getByRole('heading', { level: 1, name: 'Product admin' })).toBeTruthy();
    expect(screen.getByText('Rename waiting for review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
  });

  it('a refused write: one plain sentence, the details in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    view({ state: 'offer', onSend: async () => Promise.reject(new Error('Resource not accessible by integration')) });
    fireEvent.click(screen.getByRole('button', { name: 'Rename Product admin' }));
    const field = screen.getByRole('textbox', { name: 'Product name' });
    fireEvent.change(field, { target: { value: 'Back office' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(screen.getByText('Bridge could not send the rename. Ask an admin of the repository.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Resource not accessible');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a rename already waiting: says so, no second one', () => {
    view({ state: 'waiting', onSend: async () => {} });
    expect(screen.getByText('Rename waiting for review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull();
  });
});

describe('ProductsNavView', () => {
  it('lists every configured product as a link to its page, the current one marked', async () => {
    const { container } = render(createElement('nav', { 'aria-label': 'Studio navigation' }, createElement(ProductsNavView, { products: navProducts(products), current: 'library' })));
    const links = screen.getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Product admin', '/studio/products/admin-app/'],
      ['Library', '/studio/products/library/'],
    ]);
    expect(links[1]!.getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('Products')).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
