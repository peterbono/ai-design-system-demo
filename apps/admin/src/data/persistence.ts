import type { Identifier } from 'ra-core';

/**
 * Browser persistence for the demo dataset. Pure functions over a `Storage`-like object so the logic is
 * testable in node. Every storage access is guarded: private mode, a full quota or blocked site data
 * fall back to memory and the demo keeps working for the session.
 */

export type Collections = Record<string, unknown>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_VERSION = 1;

export function storageKey(tenantId: string): string {
  return `bridge-admin:${tenantId}:v${STORAGE_VERSION}`;
}

interface Envelope {
  version: number;
  savedAt: string;
  db: Collections;
}

export function getStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** The stored dataset for a tenant, or null when absent, unreadable or from another version. */
export function loadDb(storage: StorageLike | null, key: string): Collections | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (parsed.version !== STORAGE_VERSION || !parsed.db || typeof parsed.db !== 'object') return null;
    return parsed.db;
  } catch {
    return null;
  }
}

/** Writes the dataset. Returns false when the browser refused (quota, blocked storage). */
export function saveDb(storage: StorageLike | null, key: string, db: Collections): boolean {
  if (!storage) return false;
  try {
    const envelope: Envelope = { version: STORAGE_VERSION, savedAt: new Date().toISOString(), db };
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function clearDb(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

type Rec = { id: Identifier } & Record<string, unknown>;

const WRITE_METHODS = new Set(['create', 'update', 'updateMany', 'delete', 'deleteMany']);

export function isWrite(method: string): boolean {
  return WRITE_METHODS.has(method);
}

/**
 * Mirrors a successful data provider write into the plain collections object, so it can be saved.
 * `params` and `result` follow the ra-core DataProvider contract.
 */
export function applyWrite(db: Collections, method: string, resource: string, params: Record<string, unknown>, result: { data?: unknown }): Collections {
  const list = (Array.isArray(db[resource]) ? [...(db[resource] as Rec[])] : []) as Rec[];
  const same = (a: Identifier, b: Identifier) => String(a) === String(b);
  switch (method) {
    case 'create': {
      const created = result.data as Rec | undefined;
      if (created) list.push(created);
      break;
    }
    case 'update': {
      const updated = (result.data ?? { ...(params.previousData as Rec), ...(params.data as Rec), id: params.id }) as Rec;
      const i = list.findIndex((r) => same(r.id, updated.id ?? (params.id as Identifier)));
      if (i >= 0) list[i] = { ...list[i], ...updated };
      break;
    }
    case 'updateMany': {
      const ids = (params.ids as Identifier[]) ?? [];
      const patch = (params.data as Record<string, unknown>) ?? {};
      for (let i = 0; i < list.length; i++) {
        const r = list[i]!;
        if (ids.some((id) => same(id, r.id))) list[i] = { ...r, ...patch };
      }
      break;
    }
    case 'delete': {
      const id = params.id as Identifier;
      return { ...db, [resource]: list.filter((r) => !same(r.id, id)) };
    }
    case 'deleteMany': {
      const ids = (params.ids as Identifier[]) ?? [];
      return { ...db, [resource]: list.filter((r) => !ids.some((id) => same(id, r.id))) };
    }
    default:
      return db;
  }
  return { ...db, [resource]: list };
}
