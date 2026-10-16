import type { DataProvider } from 'ra-core';
import type { Db } from 'data-generator-retail';
import type { Tenant } from '../tenants';
import { productDescription, reviewComment } from './copy';
import { applyWrite, clearDb, getStorage, isWrite, loadDb, saveDb, storageKey, type Collections } from './persistence';

/** Generates the seeded dataset for a tenant (the generator and faker load lazily). */
export async function generateTenantData(tenant: Tenant): Promise<Collections> {
  const [{ faker }, { default: generateData }] = await Promise.all([import('@faker-js/faker'), import('data-generator-retail')]);
  faker.seed(tenant.seed);
  const db = generateData() as Db;
  db.categories = db.categories.map((c) => ({ ...c, name: tenant.categories[c.id] ?? c.name }));
  db.reviews = db.reviews.map((r) => ({ ...r, comment: reviewComment(r.id, r.rating) }));
  db.products = db.products.map((p) => ({ ...p, description: productDescription(p.id, p.reference, p.width, p.height) }));
  return db as unknown as Collections;
}

/**
 * In-memory REST-like data provider for one tenant, persisted in this browser. The first visit generates
 * the seeded dataset and stores it; later visits load it back, so demo edits survive a reload. Every
 * successful write is mirrored into the stored copy. Calls made before the data is ready wait for it.
 */
export function createDataProvider(tenant: Tenant): DataProvider {
  const key = storageKey(tenant.id);
  const storage = getStorage();
  let db: Collections = {};

  const ready = (async () => {
    const { default: fakeRestProvider } = await import('ra-data-fakerest');
    const stored = loadDb(storage, key);
    if (stored) db = stored;
    else {
      db = await generateTenantData(tenant);
      saveDb(storage, key, db);
    }
    // fakerest keeps its own copy; `db` stays the plain mirror we save.
    return fakeRestProvider(structuredClone(db), false, { min: 120, max: 360 });
  })();

  return new Proxy({} as DataProvider, {
    get(_, name) {
      if (name === 'then') return undefined;
      if (name === 'supportAbortSignal') return false;
      const method = String(name);
      return async (resource: string, params: Record<string, unknown>) => {
        const provider = await ready;
        const fn = provider[method as keyof DataProvider] as (r: string, p: unknown) => Promise<{ data?: unknown }>;
        const result = await fn(resource, params);
        if (isWrite(method)) {
          db = applyWrite(db, method, resource, params, result);
          saveDb(storage, key, db);
        }
        return result;
      };
    },
  });
}

/** Drops the stored dataset of a tenant; the next provider created for it regenerates from the seed. */
export function resetTenantData(tenant: Tenant): void {
  clearDb(getStorage(), storageKey(tenant.id));
}
