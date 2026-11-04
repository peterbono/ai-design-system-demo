// @vitest-environment jsdom
// The side nav's two groups (option A): Products (the viewer's own first, five at most, "All products" with the total
// beyond that, the product on screen always listed) and Design system (Components, Tokens, Quality, Explorations).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { ProductConfig } from '@bridge-ds/core';
import { navProducts, ProductsNavView, type NavPage } from './ProductsNav';

const PAGES: NavPage[] = [
  { href: '/studio/components/', label: 'Components', icon: 'diamonds' },
  { href: '/studio/tokens/', label: 'Tokens', icon: 'grid' },
  { href: '/studio/quality/', label: 'Quality', icon: 'shield' },
];

const two: ProductConfig[] = [
  { key: 'shop', name: 'Art print shop' },
  { key: 'poster-studio', name: 'Poster studio' },
  { key: 'library', name: 'Library', default: true },
];

const NAMES = ['Checkout', 'Mobile app', 'Art print shop', 'Poster studio', 'Billing', 'Onboarding', 'Admin console', 'Help center', 'Search', 'Reports', 'Settings app', 'Marketing site', 'Partner portal', 'Email kit', 'Kiosk'];
const many: ProductConfig[] = [...NAMES.map((name) => ({ key: name.toLowerCase().replace(/\s+/g, '-'), name })), { key: 'library', name: 'Library', default: true }];

const nav = (props: Parameters<typeof ProductsNavView>[0]) => render(createElement('nav', { 'aria-label': 'Studio navigation' }, createElement(ProductsNavView, props)));
const group = (name: string) => screen.getByText(name, { selector: 'div' }).parentElement as HTMLElement;
const linksIn = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);

describe('ProductsNavView', () => {
  it('lists the products under Products, and the library as Explorations under Design system', async () => {
    const { container } = nav({ products: navProducts(two), current: 'library', path: '/studio/products/library/', pages: PAGES });
    expect(linksIn(group('Products'))).toEqual([
      ['Art print shop', '/studio/products/shop/'],
      ['Poster studio', '/studio/products/poster-studio/'],
    ]);
    expect(linksIn(group('Design system'))).toEqual([
      ['Components', '/studio/components/'],
      ['Tokens', '/studio/tokens/'],
      ['Quality', '/studio/quality/'],
      ['Explorations', '/studio/products/library/'],
    ]);
    expect(screen.getByRole('link', { name: 'Explorations' }).getAttribute('aria-current')).toBe('page');
    // Five or fewer: no All products.
    expect(screen.queryByRole('link', { name: /All products/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('marks the Design system page on screen, a page under it too', () => {
    nav({ products: navProducts(two), current: null, path: '/studio/components/storybook/', pages: PAGES });
    expect(screen.getByRole('link', { name: 'Components' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Tokens' }).getAttribute('aria-current')).toBeNull();
  });

  it('lists five products, the viewer\'s own first, then All products with the total', () => {
    nav({ products: navProducts(many), current: null, path: '/studio/', pages: PAGES, signals: { mine: { checkout: 2 }, opened: { 'mobile-app': 1 } } });
    const rows = linksIn(group('Products')).map(([name]) => name);
    expect(rows).toEqual(['Checkout', 'Mobile app', 'Admin console', 'Art print shop', 'Billing', 'All products15']);
    const all = screen.getByRole('link', { name: 'All products, 15' });
    expect(all.getAttribute('href')).toBe('/studio/products/');
  });

  it('keeps the product on screen in the list, and marks All products on its page', () => {
    nav({ products: navProducts(many), current: 'reports', path: '/studio/products/reports/', pages: PAGES });
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
    expect(within(group('Products')).getAllByRole('link')).toHaveLength(6);
    render(createElement(ProductsNavView, { products: navProducts(many), current: null, path: '/studio/products/', pages: PAGES }));
    expect(screen.getAllByRole('link', { name: 'All products, 15' }).at(-1)!.getAttribute('aria-current')).toBe('page');
  });
});
