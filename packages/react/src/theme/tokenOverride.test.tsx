import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { allowedTokenOverrideUrl, isTokenOverrideActive, resolveTokenOverride, TOKEN_OVERRIDE_ATTR, type TokenOverrideOptions } from './tokenOverride';

const ALLOW = ['https://bridge-docs.example.com', 'https://cdn.example.com/bridge/', 'https://*.preview.example.com', 'http://localhost:4321'];
const on: TokenOverrideOptions = { enabled: true, allow: ALLOW };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('allowedTokenOverrideUrl', () => {
  it('accepts an exact origin, a path prefix and a wildcard subdomain', () => {
    expect(allowedTokenOverrideUrl('https://bridge-docs.example.com/tokens.css', ALLOW)).toBe('https://bridge-docs.example.com/tokens.css');
    expect(allowedTokenOverrideUrl('https://cdn.example.com/bridge/pr-12/tokens.css', ALLOW)).not.toBeNull();
    expect(allowedTokenOverrideUrl('https://pr-12.preview.example.com/tokens.css', ALLOW)).not.toBeNull();
    expect(allowedTokenOverrideUrl('http://localhost:4321/tokens.css', ALLOW)).not.toBeNull();
  });

  it('refuses other hosts, lookalikes, path escapes, plain http, credentials and non-CSS files', () => {
    const refused = [
      'https://evil.com/tokens.css',
      'https://bridge-docs.example.com.evil.com/tokens.css',
      'https://evilbridge-docs.example.com/tokens.css',
      'https://preview.example.com/tokens.css',
      'https://cdn.example.com/bridge-evil/tokens.css',
      'https://cdn.example.com/other/tokens.css',
      'http://bridge-docs.example.com/tokens.css',
      'https://user:pw@bridge-docs.example.com/tokens.css',
      'https://bridge-docs.example.com/tokens.js',
      'javascript:alert(1)//.css',
      'data:text/css,body{}',
      '/tokens.css',
      'http://localhost:9999/tokens.css',
    ];
    for (const url of refused) expect(allowedTokenOverrideUrl(url, ALLOW), url).toBeNull();
  });

  it('ignores malformed allowlist entries instead of widening them', () => {
    expect(allowedTokenOverrideUrl('https://a.com/tokens.css', ['*', 'https://*', 'https://*.com', 'a.com'])).toBeNull();
  });
});

describe('isTokenOverrideActive', () => {
  it('is off by default, without an allowlist, and in production unless opted in', () => {
    expect(isTokenOverrideActive(undefined, 'development')).toBe(false);
    expect(isTokenOverrideActive({ allow: ALLOW }, 'development')).toBe(false);
    expect(isTokenOverrideActive({ enabled: true, allow: [] }, 'development')).toBe(false);
    expect(isTokenOverrideActive(on, 'development')).toBe(true);
    expect(isTokenOverrideActive(on, 'production')).toBe(false);
    expect(isTokenOverrideActive({ ...on, allowInProduction: true }, 'production')).toBe(true);
  });
});

describe('resolveTokenOverride', () => {
  const url = 'https://bridge-docs.example.com/tokens.css';

  it('takes a valid query parameter and remembers it', () => {
    const storage = memoryStorage();
    expect(resolveTokenOverride(on, { search: `?bridge-tokens=${encodeURIComponent(url)}`, storage, env: 'test' })).toEqual({ url, source: 'param' });
    expect(storage.data.get('bridge-tokens')).toBe(url);
    expect(resolveTokenOverride(on, { search: '', storage, env: 'test' })).toEqual({ url, source: 'storage' });
  });

  it('clears with ?bridge-tokens=off and drops a stored URL the allowlist no longer accepts', () => {
    const storage = memoryStorage({ 'bridge-tokens': url });
    expect(resolveTokenOverride(on, { search: '?bridge-tokens=off', storage, env: 'test' }).source).toBe('cleared');
    expect(storage.data.size).toBe(0);
    storage.setItem('bridge-tokens', 'https://evil.com/tokens.css');
    expect(resolveTokenOverride(on, { search: '', storage, env: 'test' }).source).toBe('rejected');
    expect(storage.data.size).toBe(0);
  });

  it('rejects a disallowed parameter without touching storage, and does nothing when inactive', () => {
    const storage = memoryStorage({ 'bridge-tokens': url });
    expect(resolveTokenOverride(on, { search: '?bridge-tokens=https://evil.com/x.css', storage, env: 'test' }).source).toBe('rejected');
    expect(storage.data.get('bridge-tokens')).toBe(url);
    expect(resolveTokenOverride({ ...on, enabled: false }, { search: `?bridge-tokens=${url}`, storage, env: 'test' }).source).toBe('inactive');
    expect(resolveTokenOverride(on, { search: `?bridge-tokens=${url}`, storage, env: 'production' }).source).toBe('inactive');
  });

  it('honors a custom parameter and disabled storage', () => {
    const storage = memoryStorage();
    const opts = { ...on, param: 'ds', storageKey: null };
    expect(resolveTokenOverride(opts, { search: `?ds=${url}`, storage, env: 'test' }).url).toBe(url);
    expect(storage.data.size).toBe(0);
  });
});

describe('ThemeProvider tokenOverride', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
  });

  it('appends one stylesheet link after the installed tokens and removes it on unmount', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    window.history.replaceState(null, '', '/?bridge-tokens=https://bridge-docs.example.com/tokens.css');
    const { unmount } = render(<ThemeProvider tokenOverride={on}>App</ThemeProvider>);
    const links = document.head.querySelectorAll(`link[${TOKEN_OVERRIDE_ATTR}]`);
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://bridge-docs.example.com/tokens.css');
    expect(document.documentElement).toHaveAttribute(TOKEN_OVERRIDE_ATTR, 'bridge-docs.example.com');
    unmount();
    expect(document.head.querySelectorAll(`link[${TOKEN_OVERRIDE_ATTR}]`)).toHaveLength(0);
  });

  it('adds nothing when the option is absent', () => {
    window.history.replaceState(null, '', '/?bridge-tokens=https://bridge-docs.example.com/tokens.css');
    render(<ThemeProvider>App</ThemeProvider>);
    expect(document.head.querySelectorAll(`link[${TOKEN_OVERRIDE_ATTR}]`)).toHaveLength(0);
  });
});
