// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mergeState, onSelectPick, SELECT_PICK_EVENT, SELECT_SET_EVENT, selectState, selectValue, setSelect } from './select-bridge';

describe('mergeState', () => {
  it('keeps the keys the new state leaves out', () => {
    expect(mergeState({ value: 'a', options: [{ value: 'a', label: 'A' }] }, { value: 'b' })).toEqual({ value: 'b', options: [{ value: 'a', label: 'A' }] });
  });
  it('starts from nothing', () => {
    expect(mergeState(undefined, { value: '' })).toEqual({ value: '' });
  });
});

describe('setSelect and onSelectPick', () => {
  it('remembers what a script set, for an island that hydrates later, and announces it', () => {
    const heard = vi.fn();
    document.addEventListener(SELECT_SET_EVENT, (e) => heard((e as CustomEvent).detail));
    setSelect('fam', { value: 'Forms' });
    expect(selectState('fam')).toEqual({ value: 'Forms' });
    expect(heard).toHaveBeenCalledWith({ id: 'fam', value: 'Forms' });
    setSelect('fam', { options: [{ value: '', label: 'All', count: 3 }] });
    expect(selectState('fam')).toEqual({ value: 'Forms', options: [{ value: '', label: 'All', count: 3 }] });
  });

  it('calls back only for its own select and keeps the picked value', () => {
    const fn = vi.fn();
    const off = onSelectPick('syntax', fn);
    document.dispatchEvent(new CustomEvent(SELECT_PICK_EVENT, { detail: { id: 'other', value: 'x' } }));
    document.dispatchEvent(new CustomEvent(SELECT_PICK_EVENT, { detail: { id: 'syntax', value: 'js' } }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('js');
    expect(selectValue('syntax')).toBe('js');
    off();
    document.dispatchEvent(new CustomEvent(SELECT_PICK_EVENT, { detail: { id: 'syntax', value: 'css' } }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back when nothing was set', () => {
    expect(selectValue('never', 'all')).toBe('all');
  });
});
