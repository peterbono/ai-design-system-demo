// The view a person picked for a list, remembered on their browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readListView, rememberListView } from './list-view';

const store = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

describe('the view of a list', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', store());
  });

  it('is the list until the person picks the grid', () => {
    expect(readListView('changes')).toBe('list');
    rememberListView('changes', 'grid');
    expect(readListView('changes')).toBe('grid');
  });

  it('is remembered per page', () => {
    rememberListView('changes', 'grid');
    expect(readListView('building')).toBe('list');
  });

  it('is the list when the browser refuses to store anything', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage);
    expect(() => rememberListView('changes', 'grid')).not.toThrow();
    expect(readListView('changes')).toBe('list');
  });
});
