// The app screens captured for every DS change: the admin back office, per tenant (each tenant is a brand)
// and theme. Ids are stable record ids of the seeded demo data.
import type { AppRoute, Tenant } from './types.js';

export const DEFAULT_ROUTES: AppRoute[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/' },
  { id: 'orders-list', label: 'Orders list', path: '/orders' },
  // Order 12 is cancelled in both seeded shops: the status badge uses the danger tone.
  { id: 'order-edit', label: 'Order edit', path: '/orders/12', waitFor: 'form' },
  // A rejected review in each shop, on the Rejected tab, with the review drawer open.
  {
    id: 'reviews-drawer',
    label: 'Reviews, drawer open',
    path: '/reviews/4',
    pathByTenant: { northwind: `/reviews/4?filter=${encodeURIComponent('{"status":"rejected"}')}`, harbor: `/reviews/9?filter=${encodeURIComponent('{"status":"rejected"}')}` },
    waitFor: '[role="dialog"]',
  },
  { id: 'customers', label: 'Customers', path: '/customers' },
  { id: 'products', label: 'Products', path: '/products' },
];

export const DEFAULT_TENANTS: Tenant[] = [
  { id: 'northwind', name: 'Northwind Prints', brand: 'bridge' },
  { id: 'harbor', name: 'Harbor Goods', brand: 'ocean' },
];

export const THEMES = ['light', 'dark'] as const;
export const BRANDS = ['bridge', 'ocean'] as const;

/** URL of a route in the built admin (hash router), with tenant, theme and language pinned in the query. */
export function routeUrl(base: string, route: AppRoute, tenant: string, theme: string): string {
  return `${base.replace(/\/$/, '')}/?tenant=${encodeURIComponent(tenant)}&theme=${encodeURIComponent(theme)}&density=comfortable&lang=en#${route.pathByTenant?.[tenant] ?? route.path}`;
}

/** URL of one story in the built Storybook, with brand and theme set as Storybook globals. */
export function storyUrl(base: string, id: string, brand: string, theme: string): string {
  return `${base.replace(/\/$/, '')}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=brand:${brand};theme:${theme};density:comfortable`;
}

/** File-safe shot key. */
export const shotKey = (...parts: string[]) => parts.map((p) => p.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')).join('__');
