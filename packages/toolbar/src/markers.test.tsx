import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_ATTR, markedElements, markerLabel, MARKS_KEY, NO_MARKS_LINE, readMarks, sameMarks, waitingText } from './markers';
import { changeCount, positionLabel } from './navigate';
import { sameScreenOn } from './session';
import { useMarkedChanges } from './useMarkedChanges';

const page = (html: string) => {
  document.body.innerHTML = html;
  return document.body;
};

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('markedElements', () => {
  it('finds every marked area in document order, labelled by its marker', () => {
    page(`
      <main>
        <div ${CHANGE_ATTR}="Orders waiting to ship alert"><p>30 orders are waiting to ship</p></div>
        <section ${CHANGE_ATTR}="  new  revenue   chart "></section>
        <aside ${CHANGE_ATTR}=""></aside>
        <div>Not changed</div>
      </main>`);
    const found = markedElements();
    expect(found.map((m) => m.label)).toEqual(['Orders waiting to ship alert', 'New revenue chart', 'Changed area']);
    expect(found[0]!.el.textContent).toContain('30 orders');
    expect(found[0]).toMatchObject({ pseudo: null, roots: [], props: [], keys: [], floating: false });
    // The bar counts them like token changes: "3 changed", "1 / 3 changed".
    expect(changeCount(found.length)).toBe('3 changed');
    expect(positionLabel(0, found.length)).toBe('1 / 3 changed');
  });

  it('never counts the toolbar or its outlines', () => {
    page(`
      <div ${CHANGE_ATTR}="Alert"></div>
      <div data-bridge-toolbar=""><span ${CHANGE_ATTR}="Toolbar part"></span></div>
      <div data-bridge-overlay=""><span ${CHANGE_ATTR}="Overlay part"></span></div>`);
    expect(markedElements().map((m) => m.label)).toEqual(['Alert']);
  });

  it('finds none on a page that marks nothing', () => {
    page('<main><h1>Dashboard</h1></main>');
    expect(markedElements()).toEqual([]);
    expect(NO_MARKS_LINE).toBe('This change does not mark what it changed yet. Compare Live product and This change.');
  });

  it('keeps the list when a re-scan finds the same areas', () => {
    page(`<div ${CHANGE_ATTR}="A"></div>`);
    const a = markedElements();
    expect(sameMarks(a, markedElements())).toBe(true);
    expect(sameMarks(null, a)).toBe(false);
    document.querySelector(`[${CHANGE_ATTR}]`)!.setAttribute(CHANGE_ATTR, 'B');
    expect(sameMarks(a, markedElements())).toBe(false);
  });

  it('tidies labels', () => {
    expect(markerLabel(' orders   alert ')).toBe('Orders alert');
    expect(markerLabel(null)).toBe('Changed area');
  });
});

describe('Live product', () => {
  it('says how many areas wait on This change, carried by the switch, for that screen only', () => {
    expect(waitingText(1)).toBe('1 changed on This change');
    expect(waitingText(3)).toBe('3 changed on This change');
    expect(waitingText(null)).toBe('See what changed');
    const url = new URL(sameScreenOn('https://admin.example.com', { search: '?bridge=2', hash: '#/' }, { change: 2, returnTo: 'https://preview.example.com', marks: 1 }));
    expect(url.searchParams.get('bridge-marks')).toBe('1');
    const store = memory();
    expect(readMarks(url.search, '/', store)).toBe(1);
    // After the address is tidied, a reload on the same screen still knows; another screen does not.
    expect(readMarks('?bridge=2', '/', store)).toBe(1);
    expect(readMarks('?bridge=2', '/orders', store)).toBeNull();
    expect(JSON.parse(store.getItem(MARKS_KEY)!)).toEqual({ route: '/', n: 1 });
    expect(readMarks('?bridge-marks=abc', '/x', null)).toBeNull();
  });

  it('carries no count when there is none to carry', () => {
    const url = new URL(sameScreenOn('https://admin.example.com', { search: '?bridge=2&bridge-marks=4', hash: '#/' }, { change: 2 }));
    expect(url.searchParams.has('bridge-marks')).toBe(false);
  });
});

describe('useMarkedChanges', () => {
  it('scans on This change, after async render, and when the page adds a marked area', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    page(`<div ${CHANGE_ATTR}="Orders waiting to ship alert"></div>`);
    const { result, rerender } = renderHook(({ on, screen }) => useMarkedChanges(on, screen), { initialProps: { on: true, screen: '/' } });
    expect(result.current).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current?.map((m) => m.label)).toEqual(['Orders waiting to ship alert']);
    // A list that loads later adds another marked area.
    await act(async () => {
      const late = document.createElement('section');
      late.setAttribute(CHANGE_ATTR, 'Ship all button');
      document.body.appendChild(late);
      await Promise.resolve();
      vi.advanceTimersByTime(50);
    });
    expect(result.current?.map((m) => m.label)).toEqual(['Orders waiting to ship alert', 'Ship all button']);
    // Live product: nothing to read.
    rerender({ on: false, screen: '/' });
    expect(result.current).toBeNull();
  });
});
