import type { Brand } from '@bridge-ds/react';

/**
 * Two fictional shops share one back office. Each tenant picks a Bridge brand, so the same components
 * re-skin through tokens only: this is the white-label proof. Names and data are invented.
 */
export type TenantId = 'northwind' | 'harbor';

export interface Tenant {
  id: TenantId;
  name: string;
  /** Two letters shown in the logo mark. */
  mark: string;
  /** Short line under the name in the sidebar. */
  tagline: string;
  brand: Brand;
  currency: 'USD' | 'EUR';
  /** Seed for the data generator, so each shop gets its own stable customers and orders. */
  seed: number;
  /** Display names for the generator's category ids. */
  categories: string[];
}

export const TENANTS: Record<TenantId, Tenant> = {
  northwind: {
    id: 'northwind',
    name: 'Northwind Prints',
    mark: 'NP',
    tagline: 'Art prints, demo shop',
    brand: 'bridge',
    currency: 'USD',
    seed: 1207,
    categories: ['Animals', 'Portraits', 'Workplace', 'Cars', 'City', 'Flowers', 'Food', 'Nature', 'People', 'Sports', 'Tech', 'Travel', 'Water'],
  },
  harbor: {
    id: 'harbor',
    name: 'Harbor Goods',
    mark: 'HG',
    tagline: 'Coastal decor, demo shop',
    brand: 'ocean',
    currency: 'EUR',
    seed: 4242,
    categories: ['Wildlife', 'Characters', 'Office', 'Road trips', 'Harbor towns', 'Botanicals', 'Kitchen', 'Landscapes', 'Faces', 'Outdoors', 'Gadgets', 'Journeys', 'Seascapes'],
  },
};

export const TENANT_LIST = Object.values(TENANTS);

export function isTenantId(value: unknown): value is TenantId {
  return value === 'northwind' || value === 'harbor';
}
