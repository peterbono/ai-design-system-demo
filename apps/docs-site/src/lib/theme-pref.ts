// Appearance: light or dark, a preference of this browser (never a team rule). Picked in Studio Settings
// (components/ds/studio/AppearanceSetting.tsx), which shows only Light and Dark with the theme on screen selected; the
// Library and the landing page have no Settings and follow the same choice, since every page reads the same key.
//
// Storage: localStorage `ds-theme` holds 'light' or 'dark'; no value means no pick yet, and the page takes the OS
// setting. The inline script in the <head> of layouts/Layout.astro and layouts/Landing.astro reads it before first
// paint, so no page flashes the wrong theme. scripts/shell.ts follows the OS until a pick, and other tabs when the
// choice changes. An older stored 'system' (from when Settings offered it) becomes the theme it showed.

export const THEME_KEY = 'ds-theme';

export type Theme = 'light' | 'dark';
export type ThemePref = Theme | 'system';

/** The two choices Settings offers. 'system' stays internal: no pick yet, the OS decides. */
export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** The stored choice; anything else (nothing, an old value, storage blocked) is System. */
export function parseThemePref(stored: string | null | undefined): ThemePref {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** The theme a page shows for a choice: System follows the OS. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function readThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** The theme on screen now: the stored pick, else the OS setting. */
export function effectiveTheme(): Theme {
  return resolveTheme(readThemePref(), systemPrefersDark());
}

/** An older stored 'system' (or any value but light or dark) becomes the theme it showed, a pick from now on. */
export function migrateThemePref() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === null || raw === 'light' || raw === 'dark') return;
    localStorage.setItem(THEME_KEY, resolveTheme('system', systemPrefersDark()));
  } catch {
    /* storage blocked: nothing stored, nothing to move */
  }
}

/** Puts a theme on the page and tells the listeners (the accessibility checks, the token previews). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') === theme) return;
  root.setAttribute('data-theme', theme);
  document.dispatchEvent(new CustomEvent('bridge:theme', { detail: theme }));
}

/** Saves the choice in this browser and applies it now. 'system' (internal) removes the key: the OS decides again. */
export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode: the theme still applies to this page */
  }
  applyTheme(resolveTheme(pref, systemPrefersDark()));
  document.dispatchEvent(new CustomEvent('bridge:theme-pref', { detail: pref }));
}

/**
 * Keeps the page on the choice: follows the OS until a pick, and a pick made in another tab. Moves an older stored
 * 'system' to the theme it showed first. Returns a cleanup.
 */
export function followThemePref(): () => void {
  migrateThemePref();
  const sync = () => applyTheme(resolveTheme(readThemePref(), systemPrefersDark()));
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    sync();
    document.dispatchEvent(new CustomEvent('bridge:theme-pref', { detail: readThemePref() }));
  };
  let mq: MediaQueryList | null = null;
  try {
    mq = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  } catch {
    mq = null;
  }
  mq?.addEventListener?.('change', sync);
  window.addEventListener('storage', onStorage);
  return () => {
    mq?.removeEventListener?.('change', sync);
    window.removeEventListener('storage', onStorage);
  };
}
