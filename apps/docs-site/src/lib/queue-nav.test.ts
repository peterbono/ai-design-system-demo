import { describe, expect, it } from 'vitest';
import { afterApprove, branchOf, keyDecision, keyFromSearch, keyMove, moveIndex, nextIndex, nextOpen, outcomeLine, positionLabel, previousIndex, queueWindow, searchFor, skipIndex, type QueueOutcome } from './queue-nav';

describe('the list with outcomes', () => {
  it('shows the rows up to the current one and the next three, the rest counted', () => {
    expect(queueWindow(20, 2)).toEqual({ end: 6, more: 14 });
    expect(queueWindow(20, -1)).toEqual({ end: 5, more: 15 });
    expect(queueWindow(3, 0)).toEqual({ end: 3, more: 0 });
    expect(queueWindow(20, 18)).toEqual({ end: 20, more: 0 });
  });
  it('moves to the next row without an outcome, wrapping to the ones left before', () => {
    const o = new Map<string, QueueOutcome>([
      ['b', 'approved'],
      ['d', 'suggested'],
    ]);
    expect(nextOpen(['a', 'b', 'c', 'd'], 0, o)).toBe(2);
    expect(nextOpen(['a', 'b', 'c', 'd'], 2, o)).toBe(0);
    expect(nextOpen(['b', 'd'], 0, o)).toBeNull();
  });
  it('says what happened', () => {
    expect(outcomeLine('approved', 'Darker background')).toBe('Approved Darker background');
    expect(outcomeLine('suggested', 'X')).toBe('Suggested changes on X');
    expect(outcomeLine('declined', 'X')).toBe('Declined X');
    expect(outcomeLine('asked', 'X')).toBe('Asked someone else to review X');
  });
  it('reads A and S, never with a modifier', () => {
    expect(keyDecision({ key: 'a' })).toBe('approve');
    expect(keyDecision({ key: 'S' })).toBe('suggest');
    expect(keyDecision({ key: 'a', metaKey: true })).toBeNull();
    expect(keyDecision({ key: 'j' })).toBeNull();
  });
});

describe('next and previous', () => {
  it('moves one step and stops at the ends', () => {
    expect(nextIndex(3, 0)).toBe(1);
    expect(nextIndex(3, 2)).toBeNull();
    expect(previousIndex(3, 2)).toBe(1);
    expect(previousIndex(3, 0)).toBeNull();
  });

  it('starts at the first row when nothing is selected', () => {
    expect(nextIndex(3, -1)).toBe(0);
    expect(previousIndex(3, -1)).toBeNull();
  });

  it('never moves in an empty queue', () => {
    expect(nextIndex(0, 0)).toBeNull();
    expect(previousIndex(0, 0)).toBeNull();
  });

  it('follows the move', () => {
    expect(moveIndex(5, 2, 'next')).toBe(3);
    expect(moveIndex(5, 2, 'previous')).toBe(1);
    expect(moveIndex(5, 4, 'next')).toBeNull();
  });
});

describe('positionLabel', () => {
  it('says where the viewer is, 1-based', () => {
    expect(positionLabel(20, 2)).toBe('3 of 20');
    expect(positionLabel(1, 0)).toBe('1 of 1');
  });

  it('is empty without a selection', () => {
    expect(positionLabel(0, 0)).toBe('');
    expect(positionLabel(3, -1)).toBe('');
    expect(positionLabel(3, 3)).toBe('');
  });
});

describe('keyMove', () => {
  it('maps j and ArrowDown to next, k and ArrowUp to previous', () => {
    expect(keyMove({ key: 'j' })).toBe('next');
    expect(keyMove({ key: 'ArrowDown' })).toBe('next');
    expect(keyMove({ key: 'k' })).toBe('previous');
    expect(keyMove({ key: 'ArrowUp' })).toBe('previous');
  });

  it('ignores other keys and any modifier', () => {
    expect(keyMove({ key: 'a' })).toBeNull();
    expect(keyMove({ key: 'Enter' })).toBeNull();
    expect(keyMove({ key: 'j', metaKey: true })).toBeNull();
    expect(keyMove({ key: 'k', ctrlKey: true })).toBeNull();
    expect(keyMove({ key: 'ArrowDown', altKey: true })).toBeNull();
    expect(keyMove({ key: 'J', shiftKey: true })).toBeNull();
  });
});

describe('skipIndex', () => {
  it('goes to the next row, then back to the first from the last', () => {
    expect(skipIndex(3, 0)).toBe(1);
    expect(skipIndex(3, 1)).toBe(2);
    expect(skipIndex(3, 2)).toBe(0);
  });

  it('has nowhere to go with one row or none', () => {
    expect(skipIndex(1, 0)).toBeNull();
    expect(skipIndex(0, 0)).toBeNull();
  });
});

describe('afterApprove', () => {
  it('drops the row and points at the one after it', () => {
    expect(afterApprove(['a', 'b', 'c'], 1)).toEqual({ items: ['a', 'c'], index: 1 });
    expect(afterApprove(['a', 'b', 'c'], 0)).toEqual({ items: ['b', 'c'], index: 0 });
  });

  it('points at the row before when the last one is approved', () => {
    expect(afterApprove(['a', 'b', 'c'], 2)).toEqual({ items: ['a', 'b'], index: 1 });
  });

  it('is empty after the only row', () => {
    expect(afterApprove(['a'], 0)).toEqual({ items: [], index: -1 });
  });

  it('keeps the list when the index is out of range', () => {
    expect(afterApprove(['a', 'b'], 5)).toEqual({ items: ['a', 'b'], index: 1 });
    expect(afterApprove([], 0)).toEqual({ items: [], index: -1 });
  });
});

describe('URL', () => {
  it('reads the selected row from ?pr= or ?item=', () => {
    expect(keyFromSearch('?pr=42')).toBe('change-42');
    expect(keyFromSearch('?item=guidance-Button')).toBe('guidance-Button');
    expect(keyFromSearch('?pr=nope&item=health-contrast')).toBe('health-contrast');
    expect(keyFromSearch('')).toBeNull();
  });

  it('writes ?pr= for branch rows and ?item= for the rest', () => {
    expect(searchFor({ key: 'change-42', number: 42 })).toBe('?pr=42');
    expect(searchFor({ key: 'guidance-Date picker' })).toBe('?item=guidance-Date%20picker');
    expect(searchFor(null)).toBe('');
  });

  it('round-trips a key', () => {
    expect(keyFromSearch(searchFor({ key: 'guidance-Date picker' }))).toBe('guidance-Date picker');
  });
});

describe('branchOf', () => {
  it('reads the branch number of a branch review link only', () => {
    expect(branchOf({ href: '/studio/changes/?pr=7' })).toBe(7);
    expect(branchOf({ href: '/studio/components/button/edit/' })).toBeNull();
    expect(branchOf({ href: '/studio/quality/' })).toBeNull();
  });
});
