// Where the page is (theme, brand, density, shop) and how the toolbar moves it there. A product passes its own hook
// when it keeps these in state (the Admin demo's preferences); by default the toolbar reads the attributes the
// design system's ThemeProvider (asRoot) puts on <html> and sets data-theme there.
import { useEffect, useMemo, useState } from 'react';

export interface ToolbarScope {
  theme: 'light' | 'dark';
  brand: string;
  density: string;
  /** The shop (tenant) the page shows, when the product has several. */
  shop?: string;
  /** Moves the page to a theme, a shop or both, in one step. */
  set: (next: { theme?: 'light' | 'dark'; shop?: string }) => void;
}

/** A shop of a multi-brand product: its id (in `?tenant=` links), its name and its brand. */
export interface ToolbarShop {
  id: string;
  name: string;
  brand: string;
}

const read = () => {
  const el = document.documentElement;
  return {
    theme: (el.getAttribute('data-theme') === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    brand: el.getAttribute('data-brand') || 'bridge',
    density: el.getAttribute('data-density') || 'comfortable',
  };
};

/** The default scope: <html data-theme data-brand data-density>, kept in sync. */
export function useDocumentScope(): ToolbarScope {
  const [here, setHere] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setHere((p) => {
      const n = read();
      return n.theme === p.theme && n.brand === p.brand && n.density === p.density ? p : n;
    }));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-brand', 'data-density'] });
    return () => mo.disconnect();
  }, []);
  return useMemo(
    () => ({
      ...here,
      set: (next) => {
        if (next.theme) document.documentElement.setAttribute('data-theme', next.theme);
      },
    }),
    [here],
  );
}
