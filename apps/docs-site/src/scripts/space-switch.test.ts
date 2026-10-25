// @vitest-environment jsdom
// The header switch in the browser: it plays then navigates on a plain click, leaves modified clicks alone, goes at
// once under reduced motion, follows the open Studio drawer, keeps a team, and shows the first-visit hint once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import SpaceSwitch from '../components/SpaceSwitch';
import { HINT_KEY, NAVIGATE_AFTER_MS, type SwitchSpace } from '../lib/space-switch';
import { initSpaceSwitch } from './space-switch';

const memory = (seen = false) => {
  const m = new Map<string, string>(seen ? [[HINT_KEY, '1']] : []);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

function page(path: string, space: SwitchSpace, href: string, extra = '') {
  history.replaceState(null, '', path);
  document.body.innerHTML = `<header>${renderToStaticMarkup(createElement(SpaceSwitch, { space, href }))}</header>${extra}`;
  return document.querySelector<HTMLAnchorElement>('a[data-space-switch]')!;
}

describe('initSpaceSwitch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute('data-hosted');
    history.replaceState(null, '', '/');
  });

  it('plays the switch, then loads the other space', () => {
    const a = page('/components/button/', 'library', '/studio/components/?c=button');
    const navigate = vi.fn();
    initSpaceSwitch({ navigate, reducedMotion: false, store: memory(true) });
    a.click();
    expect(a.dataset.mode).toBe('studio');
    expect(a.hasAttribute('data-anim')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    a.click();
    vi.advanceTimersByTime(NAVIGATE_AFTER_MS);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(`${location.origin}/studio/components/?c=button`);
  });

  it('navigates at once under reduced motion, without playing', () => {
    const a = page('/library/', 'library', '/studio/');
    const navigate = vi.fn();
    initSpaceSwitch({ navigate, reducedMotion: true, store: memory() });
    a.click();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(a.dataset.mode).toBe('library');
    expect(a.hasAttribute('data-hint')).toBe(false);
  });

  it('leaves a new-tab click to the browser', () => {
    const a = page('/library/', 'library', '/studio/');
    const navigate = vi.fn();
    initSpaceSwitch({ navigate, reducedMotion: false, store: memory(true) });
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    a.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(a.hasAttribute('data-anim')).toBe(false);
    vi.advanceTimersByTime(NAVIGATE_AFTER_MS);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('follows the Studio drawer: the open component rides across, named from its row', () => {
    const row = '<table><tr id="c-button"><th><span class="cm-name-text">Button</span></th></tr></table>';
    const a = page('/studio/components/?c=button', 'studio', '/components/', row);
    initSpaceSwitch({ navigate: vi.fn(), reducedMotion: false, store: memory(true) });
    expect(a.getAttribute('href')).toBe('/components/button/');
    expect(a.getAttribute('data-tooltip')).toBe('Open Button in the Library');
    expect(a.getAttribute('aria-label')).toBe('Studio, open Library');
    // The drawer closes: the next use opens the catalog.
    history.replaceState(null, '', '/studio/components/');
    a.dispatchEvent(new Event('pointerenter'));
    expect(a.getAttribute('href')).toBe('/components/');
  });

  it('opens the team Library from a team shell', () => {
    document.documentElement.setAttribute('data-hosted', '');
    const a = page('/studio/acme/ds/components/?c=card', 'studio', '/components/');
    initSpaceSwitch({ navigate: vi.fn(), reducedMotion: false, store: memory(true) });
    expect(a.getAttribute('href')).toBe('/library/acme/ds/components/card/');
  });

  it('shows the first-visit hint once per browser, and records it', () => {
    const store = memory();
    const a = page('/library/', 'library', '/studio/');
    initSpaceSwitch({ navigate: vi.fn(), reducedMotion: false, store });
    expect(a.hasAttribute('data-hint')).toBe(true);
    expect(store.m.get(HINT_KEY)).toBe('1');
    const b = page('/library/', 'library', '/studio/');
    initSpaceSwitch({ navigate: vi.fn(), reducedMotion: false, store });
    expect(b.hasAttribute('data-hint')).toBe(false);
  });
});
