// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { watchOverflowEdges } from './overflow-edges';

const row = (scrollWidth: number, clientWidth: number) => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  return el;
};

describe('watchOverflowEdges', () => {
  it('marks the end of a row that scrolls, then the start once scrolled to the end', () => {
    const el = row(560, 358);
    const stop = watchOverflowEdges(el);
    expect(el.hasAttribute('data-overflow-end')).toBe(true);
    expect(el.hasAttribute('data-overflow-start')).toBe(false);
    el.scrollLeft = 202;
    el.dispatchEvent(new Event('scroll'));
    expect(el.hasAttribute('data-overflow-start')).toBe(true);
    expect(el.hasAttribute('data-overflow-end')).toBe(false);
    stop();
  });

  it('marks nothing when every chip fits', () => {
    const el = row(300, 358);
    watchOverflowEdges(el)();
    expect(el.hasAttribute('data-overflow-start') || el.hasAttribute('data-overflow-end')).toBe(false);
  });
});
