import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Density, Theme } from '@bridge-ds/react';
import { TENANTS, isTenantId, type Tenant, type TenantId } from './tenants';
import type { Locale } from './i18n/i18nProvider';

/** Viewer preferences that live outside ra-core: theme, density, tenant and language. */
export interface Preferences {
  theme: Theme;
  density: Density;
  tenantId: TenantId;
  locale: Locale;
}

interface PreferencesContextValue extends Preferences {
  tenant: Tenant;
  set: (patch: Partial<Preferences>) => void;
  /** Bumped after a demo data reset, so the admin remounts on a fresh provider. */
  dataVersion: number;
  bumpDataVersion: () => void;
}

const KEY = 'bridge-admin:preferences';
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function read(): Partial<Preferences> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

function initial(): Preferences {
  const stored = read();
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('tenant');
  const theme = params.get('theme');
  const density = params.get('density');
  const lang = params.get('lang');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return {
    tenantId: isTenantId(fromUrl) ? fromUrl : isTenantId(stored.tenantId) ? stored.tenantId : 'northwind',
    theme: theme === 'dark' || theme === 'light' ? theme : stored.theme ?? (prefersDark ? 'dark' : 'light'),
    density: density === 'compact' || density === 'comfortable' ? density : stored.density ?? 'comfortable',
    locale: lang === 'fr' || lang === 'en' ? lang : stored.locale ?? 'en',
  };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(initial);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // Storage can be blocked (private mode): preferences then last for the session only.
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get('tenant') !== prefs.tenantId) {
      url.searchParams.set('tenant', prefs.tenantId);
      window.history.replaceState(window.history.state, '', url);
    }
    document.documentElement.lang = prefs.locale;
  }, [prefs]);

  const [dataVersion, setDataVersion] = useState(0);
  const set = useCallback((patch: Partial<Preferences>) => setPrefs((p) => ({ ...p, ...patch })), []);
  const bumpDataVersion = useCallback(() => setDataVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ ...prefs, tenant: TENANTS[prefs.tenantId], set, dataVersion, bumpDataVersion }),
    [prefs, set, dataVersion, bumpDataVersion],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
