import { describe, expect, it } from 'vitest';
import { applyWrite, clearDb, isWrite, loadDb, saveDb, storageKey, type StorageLike } from './persistence';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const base = () => ({
  orders: [
    { id: 1, status: 'ordered', total: 10 },
    { id: 2, status: 'ordered', total: 20 },
    { id: 3, status: 'delivered', total: 30 },
  ],
});

describe('storage', () => {
  it('uses one versioned key per tenant', () => {
    expect(storageKey('northwind')).toBe('bridge-admin:northwind:v1');
    expect(storageKey('harbor')).not.toBe(storageKey('northwind'));
  });

  it('round-trips a dataset', () => {
    const s = memoryStorage();
    expect(saveDb(s, 'k', base())).toBe(true);
    expect(loadDb(s, 'k')).toEqual(base());
  });

  it('returns null for missing, corrupt or other-version data', () => {
    const s = memoryStorage();
    expect(loadDb(s, 'k')).toBeNull();
    s.setItem('k', '{not json');
    expect(loadDb(s, 'k')).toBeNull();
    s.setItem('k', JSON.stringify({ version: 99, db: base() }));
    expect(loadDb(s, 'k')).toBeNull();
  });

  it('falls back silently when storage throws or is missing', () => {
    expect(loadDb(throwing, 'k')).toBeNull();
    expect(saveDb(throwing, 'k', base())).toBe(false);
    expect(() => clearDb(throwing, 'k')).not.toThrow();
    expect(loadDb(null, 'k')).toBeNull();
    expect(saveDb(null, 'k', base())).toBe(false);
  });

  it('clears a tenant dataset', () => {
    const s = memoryStorage();
    saveDb(s, 'k', base());
    clearDb(s, 'k');
    expect(loadDb(s, 'k')).toBeNull();
  });
});

describe('applyWrite', () => {
  it('only treats mutations as writes', () => {
    expect(isWrite('update')).toBe(true);
    expect(isWrite('deleteMany')).toBe(true);
    expect(isWrite('getList')).toBe(false);
  });

  it('applies update with the server record', () => {
    const db = applyWrite(base(), 'update', 'orders', { id: 2, data: { status: 'cancelled' } }, { data: { id: 2, status: 'cancelled', total: 20 } });
    expect((db.orders as { id: number; status: string }[]).find((o) => o.id === 2)?.status).toBe('cancelled');
  });

  it('matches ids across string and number', () => {
    const db = applyWrite(base(), 'update', 'orders', { id: '1', data: { total: 99 } }, { data: { id: '1', total: 99 } });
    expect((db.orders as { id: number; total: number }[])[0]?.total).toBe(99);
  });

  it('applies updateMany, create, delete and deleteMany', () => {
    let db = applyWrite(base(), 'updateMany', 'orders', { ids: [1, 2], data: { status: 'delivered' } }, { data: [1, 2] });
    expect((db.orders as { status: string }[]).every((o) => o.status === 'delivered')).toBe(true);
    db = applyWrite(db, 'create', 'orders', { data: { status: 'ordered' } }, { data: { id: 4, status: 'ordered' } });
    expect(db.orders as unknown[]).toHaveLength(4);
    db = applyWrite(db, 'delete', 'orders', { id: 4 }, { data: { id: 4 } });
    expect(db.orders as unknown[]).toHaveLength(3);
    db = applyWrite(db, 'deleteMany', 'orders', { ids: [1, 3] }, { data: [1, 3] });
    expect((db.orders as { id: number }[]).map((o) => o.id)).toEqual([2]);
  });

  it('does not mutate the input and creates missing collections', () => {
    const input = base();
    const db = applyWrite(input, 'create', 'reviews', { data: {} }, { data: { id: 1 } });
    expect(input).toEqual(base());
    expect(db.reviews).toEqual([{ id: 1 }]);
  });

  it('survives a save and reload after writes', () => {
    const s = memoryStorage();
    const db = applyWrite(base(), 'update', 'orders', { id: 3, data: { status: 'cancelled' } }, { data: { id: 3, status: 'cancelled', total: 30 } });
    saveDb(s, storageKey('harbor'), db);
    const loaded = loadDb(s, storageKey('harbor'));
    expect((loaded?.orders as { id: number; status: string }[]).find((o) => o.id === 3)?.status).toBe('cancelled');
  });
});
