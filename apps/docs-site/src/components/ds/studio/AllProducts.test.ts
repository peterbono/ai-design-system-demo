// @vitest-environment jsdom
// All products: the summary line, the viewer's own first with "You explore here", one status line per product, the
// filter, and the progressive "Show more". The library is not listed (it is Explorations, under Design system).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { ProductConfig } from '@bridge-ds/core';
import { allProductsRows, AllProductsView } from './AllProducts';
import type { ExplorationCard } from '../../../lib/home-explorations';

const NAMES = ['Checkout', 'Mobile app', 'Art print shop', 'Poster studio', 'Billing', 'Onboarding', 'Admin console', 'Help center', 'Search', 'Reports', 'Settings app', 'Marketing site', 'Partner portal', 'Email kit', 'Kiosk'];
const many: ProductConfig[] = [...NAMES.map((name) => ({ key: name.toLowerCase().replace(/\s+/g, '-'), name })), { key: 'library', name: 'Library', default: true }];

const card = (n: number, productKey: string, lifecycle: ExplorationCard['lifecycle'], own = false) => ({ number: n, productKey, lifecycle, own, updated: '2026-11-03T10:00:00Z' }) as ExplorationCard;

const rowNames = () => within(screen.getByRole('list', { name: 'Products' })).getAllByRole('link').map((a) => a.textContent);

describe('All products', () => {
  it('lists the products, the viewer\'s own first and marked, each with its status line', async () => {
    const cards = [card(1, 'checkout', 'exploring', true), card(2, 'checkout', 'exploring', true), card(3, 'billing', 'waiting-for-code'), card(4, 'kiosk', 'shipped')];
    const rows = allProductsRows(many, cards, { mine: { checkout: 2 }, opened: {} });
    const { container } = render(createElement(AllProductsView, { rows, products: many }));
    expect(screen.getByRole('heading', { level: 1, name: 'All products' })).toBeTruthy();
    expect(screen.getByText("15 products, with the whole team's explorations. Yours come first.")).toBeTruthy();
    expect(rowNames()).toEqual(['Checkout', 'Admin console', 'Art print shop', 'Billing', 'Email kit', 'Help center', 'Kiosk', 'Marketing site']);
    expect(rowNames()).not.toContain('Library');
    const first = screen.getAllByRole('listitem')[0]!;
    expect(first.textContent).toContain('2 exploring');
    expect(first.textContent).toContain('You explore here');
    expect(screen.getAllByText('You explore here')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Billing' }).closest('li')!.textContent).toContain('1 waiting to be picked up');
    expect(screen.getByRole('link', { name: 'Kiosk' }).closest('li')!.textContent).toContain('1 shipped');
    expect(screen.getByRole('link', { name: 'Admin console' }).closest('li')!.textContent).toContain('Nothing explored yet');
    expect(screen.getByRole('link', { name: 'Checkout' }).getAttribute('href')).toBe('/studio/products/checkout/');
    await expectNoAxeViolations(container);
  });

  it('shows the rest on demand', async () => {
    render(createElement(AllProductsView, { rows: allProductsRows(many, [], { mine: {}, opened: {} }), products: many }));
    expect(rowNames()).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: 'Show 7 more' }));
    expect(rowNames()).toHaveLength(15);
    expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
  });

  it('finds a product by name, and says so when nothing matches', async () => {
    render(createElement(AllProductsView, { rows: allProductsRows(many, null, { mine: {}, opened: {} }), products: many }));
    const find = screen.getByRole('searchbox', { name: 'Find a product' });
    await userEvent.type(find, 'app');
    expect(rowNames()).toEqual(['Mobile app', 'Settings app']);
    await userEvent.clear(find);
    await userEvent.type(find, 'zzz');
    expect(screen.queryByRole('list', { name: 'Products' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('No product called "zzz". Check the name or clear the filter.');
  });

  it('keeps a short list plain: no filter, no Show more, names only while the explorations are read', () => {
    const two = many.slice(0, 2).concat(many.slice(-1));
    render(createElement(AllProductsView, { rows: allProductsRows(two, null, { mine: {}, opened: {} }), products: two }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
    expect(screen.getByText("2 products, with the whole team's explorations. Yours come first.")).toBeTruthy();
    expect(screen.getAllByRole('listitem')[0]!.textContent).toBe('Checkout');
  });
});
