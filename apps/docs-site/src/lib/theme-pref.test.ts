// @vitest-environment jsdom
// Appearance (light, dark or System) is a choice of this browser: the same `ds-theme` key the no-flash script in the
// <head> reads, System removes it so the page follows the OS. The header no longer carries a theme button.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followThemePref, parseThemePref, readThemePref, resolveTheme, setThemePref, THEME_KEY, THEME_PREFS } from './theme-pref';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

let dark = false;
const listeners = new Set<() => void>();
beforeEach(() => {
  dark = false;
  listeners.clear();
  localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') && dark;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => vi.restoreAllMocks());

describe('theme preference', () => {
  it('offers Light, Dark and System, in that order', () => {
    expect(THEME_PREFS.map((p) => p.label)).toEqual(['Light', 'Dark', 'System']);
  });

  it('reads anything but light or dark as System', () => {
    expect(parseThemePref('dark')).toBe('dark');
    expect(parseThemePref('light')).toBe('light');
    expect(parseThemePref(null)).toBe('system');
    expect(parseThemePref('sepia')).toBe('system');
    expect(readThemePref()).toBe('system');
  });

  it('resolves System from the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('stores Light and Dark under the key the head script reads, and System removes it', () => {
    const seen: string[] = [];
    document.addEventListener('bridge:theme', (e) => seen.push((e as CustomEvent<string>).detail));
    setThemePref('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setThemePref('system');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(seen).toEqual(['dark', 'light']);
    expect(src('../layouts/Layout.astro')).toContain(`localStorage.getItem('${THEME_KEY}')`);
    expect(src('../layouts/Landing.astro')).toContain(`localStorage.getItem('${THEME_KEY}')`);
  });

  it('follows the OS while the choice is System, not once Light or Dark is picked', () => {
    const stop = followThemePref();
    dark = true;
    listeners.forEach((fn) => fn());
    expect(document.documentElement.dataset.theme).toBe('dark');
    localStorage.setItem(THEME_KEY, 'light');
    listeners.forEach((fn) => fn());
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    expect(listeners.size).toBe(0);
  });

  it('picks up a choice made in another tab', () => {
    const stop = followThemePref();
    const prefs: string[] = [];
    document.addEventListener('bridge:theme-pref', (e) => prefs.push((e as CustomEvent<string>).detail));
    localStorage.setItem(THEME_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(prefs).toEqual(['dark']);
    stop();
  });
});

describe('where the choice lives', () => {
  it('has no theme button in the header or the side nav', () => {
    const layout = src('../layouts/Layout.astro');
    expect(layout).not.toMatch(/data-theme-toggle|Dark theme|\bMoon\b/);
  });

  it('is a section of the self-hosted Settings and of a team Settings, guests included', () => {
    for (const page of ['../pages/studio/settings/index.astro', '../pages/team-shell/settings/index.astro']) {
      const s = src(page);
      expect(s).toContain('id="appearance"');
      expect(s).toContain('<AppearanceSetting client:load />');
      expect(s).toContain('only in this browser');
    }
    // On a team, outside the team read: there whatever GitHub answers, on the sample team and every other one.
    const team = src('../pages/team-shell/settings/index.astro');
    expect(team.indexOf('<AppearanceSetting')).toBeGreaterThan(team.indexOf('<TeamSettings'));
  });
});
