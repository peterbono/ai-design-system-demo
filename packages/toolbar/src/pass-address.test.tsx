// The pass leaves the real address (jsdom): a hash router that read `#bridge-pass=...` before the toolbar loaded must
// end on the screen the address names, never on an empty page for a route that does not exist.
import { afterEach, describe, expect, it } from 'vitest';
import { PASS_KEY, resetPass, takePassFromAddress } from './pass';

const PASS = 'v1.eyJ0IjoiYWNtZS9kcyJ9.c2lnbmF0dXJlLWJ5dGVz';

/** A product's hash router: the screen is the hash, read once at start and again on hashchange. */
function hashRouter() {
  const route = () => window.location.hash.replace(/^#/, '') || '/';
  const r = { screen: route(), heard: 0 };
  const on = () => {
    r.heard += 1;
    r.screen = route();
  };
  window.addEventListener('hashchange', on);
  return { r, stop: () => window.removeEventListener('hashchange', on) };
}

afterEach(() => {
  resetPass();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the pass leaves the address', () => {
  it('and a router that read it first moves to the real screen', () => {
    window.history.replaceState(null, '', `/?bridge=1#bridge-pass=${PASS}&/orders`);
    const { r, stop } = hashRouter();
    expect(r.screen).toBe(`bridge-pass=${PASS}&/orders`);
    expect(takePassFromAddress()).toBe(PASS);
    expect(window.location.hash).toBe('#/orders');
    expect(window.location.search).toBe('?bridge=1');
    expect(r.heard).toBe(1);
    expect(r.screen).toBe('/orders');
    expect(sessionStorage.getItem(PASS_KEY)).toBe(PASS);
    stop();
  });

  it('and the home screen when the pass was the whole fragment', () => {
    window.history.replaceState(null, '', `/?bridge=1#bridge-pass=${PASS}`);
    const { r, stop } = hashRouter();
    takePassFromAddress();
    expect(window.location.href.endsWith('/?bridge=1')).toBe(true);
    expect(r.screen).toBe('/');
    stop();
  });

  it('tells no router anything when there was no pass in the address', () => {
    window.history.replaceState(null, '', '/?bridge=1#/orders');
    const { r, stop } = hashRouter();
    expect(takePassFromAddress()).toBeNull();
    expect(r.heard).toBe(0);
    expect(r.screen).toBe('/orders');
    stop();
  });
});
