// Appearance: light, dark or the system setting, a preference of this browser (never a team rule). Picked in Studio
// Settings (components/ds/studio/AppearanceSetting.tsx); the Library and the landing page have no Settings and follow
// the same choice, since every page reads the same key.
//
// Storage: localStorage `ds-theme` holds 'light' or 'dark'; no value means System (follow the OS). The inline script
// in the <head> of layouts/Layout.astro and layouts/Landing.astro reads it before first paint, so no page flashes the
// wrong theme. scripts/shell.ts follows the OS while the choice is System, and other tabs when the choice changes.

export const THEME_KEY = 'ds-theme';

export type Theme = 'light' | 'dark';
export type ThemePref = Theme | 'system';

export const THEME_PREFS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
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

/** Puts a theme on the page and tells the listeners (the accessibility checks, the token previews). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') === theme) return;
  root.setAttribute('data-theme', theme);
  document.dispatchEvent(new CustomEvent('bridge:theme', { detail: theme }));
}

/** Saves the choice in this browser and applies it now. System removes the key, so the page follows the OS. */
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
 * Keeps the page on the choice: follows the OS while it is System, and a pick made in another tab. Returns a cleanup.
 */
export function followThemePref(): () => void {
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
