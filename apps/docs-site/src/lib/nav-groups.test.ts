import { describe, expect, it } from 'vitest';
import { navGroupKey, navGroupOpen, readNavGroup, writeNavGroup } from './nav-groups';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('side nav groups', () => {
  it('opens the group of the current page, even when closed earlier in the tab', () => {
    expect(navGroupOpen({ current: true, stored: null })).toBe(true);
    expect(navGroupOpen({ current: true, stored: 'closed' })).toBe(true);
  });

  it('opens other groups by default and follows a toggle in this tab', () => {
    expect(navGroupOpen({ current: false, stored: null })).toBe(true);
    expect(navGroupOpen({ current: false, stored: 'open' })).toBe(true);
    expect(navGroupOpen({ current: false, stored: 'closed' })).toBe(false);
  });

  it('round-trips a toggle and ignores unknown or unreadable values', () => {
    const s = memory();
    writeNavGroup('Use', false, s);
    expect(readNavGroup('Use', s)).toBe('closed');
    writeNavGroup('Use', true, s);
    expect(readNavGroup('Use', s)).toBe('open');
    s.setItem(navGroupKey('Foundations'), 'collapsed');
    expect(readNavGroup('Foundations', s)).toBeNull();
    expect(readNavGroup('Use', null)).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readNavGroup('Use', throwing)).toBeNull();
    expect(() => writeNavGroup('Use', false, throwing)).not.toThrow();
  });
});
