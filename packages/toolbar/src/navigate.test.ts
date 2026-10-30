import { describe, expect, it } from 'vitest';
import { isFlipKey } from './session';
import { changeCount, elsewhereLine, isEscape, isTyping, positionLabel, readingOrder, stepAnnouncement, stepTo, tipSide } from './navigate';

const key = (k: string, target: unknown = null, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, target, ...mods });

describe('stepping through the changes of a screen', () => {
  it('reads top to bottom, then left to right on one line', () => {
    // Save bar at the bottom, two cards side by side, the header on top.
    const places = [
      { top: 900, left: 0 },
      { top: 300, left: 520 },
      { top: 303, left: 20 },
      { top: 0, left: 0 },
    ];
    expect(readingOrder(places)).toEqual([3, 2, 1, 0]);
  });

  it('keeps the original order for surfaces at the same place', () => {
    expect(readingOrder([{ top: 10, left: 10 }, { top: 10, left: 10 }])).toEqual([0, 1]);
    expect(readingOrder([])).toEqual([]);
  });

  it('starts at the first with Next and at the last with Previous', () => {
    expect(stepTo(null, 1, 3)).toBe(0);
    expect(stepTo(null, -1, 3)).toBe(2);
  });

  it('wraps at both ends', () => {
    expect(stepTo(0, 1, 3)).toBe(1);
    expect(stepTo(2, 1, 3)).toBe(0);
    expect(stepTo(0, -1, 3)).toBe(2);
  });

  it('has nowhere to go without a change, and starts over when the list shrank', () => {
    expect(stepTo(null, 1, 0)).toBeNull();
    expect(stepTo(1, 1, 0)).toBeNull();
    expect(stepTo(5, 1, 3)).toBe(0);
  });

  it('counts changed elements, never "changes" (the bar already says "This change")', () => {
    expect(changeCount(1)).toBe('1 changed');
    expect(changeCount(13)).toBe('13 changed');
    expect(positionLabel(1, 13)).toBe('2 / 13 changed');
    expect(stepAnnouncement(1, 13, 'Avatar')).toBe('Changed element 2 of 13: Avatar');
    for (const text of [changeCount(1), changeCount(13), positionLabel(0, 1), stepAnnouncement(0, 1, 'Avatar')]) expect(text).not.toMatch(/\bchanges?\b/i);
  });

  it('says where the change shows when nothing changes here', () => {
    expect(elsewhereLine([])).toBe("This change doesn't touch this screen.");
    expect(elsewhereLine(['Orders'])).toBe("This change doesn't touch this screen. It shows on Orders.");
    expect(elsewhereLine(['Orders', 'Settings'])).toBe("This change doesn't touch this screen. It shows on Orders and Settings.");
    expect(elsewhereLine(['Orders', 'Settings', 'Reviews', 'Customers'])).toBe("This change doesn't touch this screen. It shows on Orders, Settings and 2 more.");
  });
});

describe('shortcuts never fire while typing', () => {
  const input = { tagName: 'INPUT' };
  const editable = { tagName: 'DIV', isContentEditable: true };
  const combobox = { tagName: 'DIV', closest: () => ({}) };
  const button = { tagName: 'BUTTON', closest: () => null };

  it('knows when the person is typing', () => {
    expect(isTyping(input)).toBe(true);
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTyping({ tagName: 'SELECT' })).toBe(true);
    expect(isTyping(editable)).toBe(true);
    expect(isTyping(combobox)).toBe(true);
    expect(isTyping(button)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('B flips sides anywhere but in a field, without modifiers', () => {
    expect(isFlipKey(key('b', button))).toBe(true);
    for (const t of [input, editable, combobox]) expect(isFlipKey(key('b', t))).toBe(false);
    expect(isFlipKey(key('b', button, { ctrlKey: true }))).toBe(false);
  });

  it('Escape turns Isolate off, but not from a field', () => {
    expect(isEscape(key('Escape', button))).toBe(true);
    expect(isEscape(key('Escape', null))).toBe(true);
    expect(isEscape(key('Escape', input))).toBe(false);
    expect(isEscape(key('Escape', combobox))).toBe(false);
    expect(isEscape(key('Escape', button, { metaKey: true }))).toBe(false);
    expect(isEscape(key('Enter', button))).toBe(false);
  });
});

describe('where the before and after tooltip goes', () => {
  const view = { width: 1280, height: 800 };
  const bar = { left: 360, top: 740, right: 1264, bottom: 784 };
  const box = (left: number, top: number, size = 32) => ({ left, top, right: left + size, bottom: top + size });

  it('goes below the element when there is room above the bar, so the title above stays readable', () => {
    expect(tipSide(box(945, 380), view, bar)).toBe('bottom');
  });

  it('goes beside the element when the bar leaves no room below', () => {
    expect(tipSide(box(300, 660), view, bar)).toBe('right');
    expect(tipSide(box(1200, 660), view, bar)).toBe('left');
  });

  it('goes above only when nothing else fits', () => {
    expect(tipSide({ left: 0, top: 600, right: 1280, bottom: 720 }, view, bar)).toBe('top');
  });

  it('uses the viewport bottom without a bar', () => {
    expect(tipSide(box(10, 700), view, null)).toBe('bottom');
    expect(tipSide(box(10, 720), view, null)).toBe('right');
    expect(tipSide(box(10, 760), view, null)).toBe('top');
  });
});
