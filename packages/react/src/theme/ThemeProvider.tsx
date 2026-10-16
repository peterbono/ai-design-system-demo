import { createContext, useContext, useEffect, useMemo, type HTMLAttributes, type ReactNode } from 'react';
import type { Brand, Density, Theme } from '@demo-ds/tokens';

export type { Brand, Density, Theme };

export interface ThemeScope {
  theme: Theme;
  brand: Brand;
  density: Density;
}

const ThemeContext = createContext<ThemeScope | null>(null);

export interface ThemeProviderProps extends HTMLAttributes<HTMLDivElement> {
  /** Color theme. Default `light`. */
  theme?: Theme;
  /** Brand mapping (palette, radius and font roles). Default `bridge`. */
  brand?: Brand;
  /** Control and layout density. Default `comfortable`. */
  density?: Density;
  /**
   * Apply the attributes to `<html>` instead of rendering a wrapper. Use once at the app root so
   * the page background and portaled overlays follow the scope.
   */
  asRoot?: boolean;
  children?: ReactNode;
}

/**
 * Sets `data-theme`, `data-brand` and `data-density` on one scope element, always all three together,
 * so every semantic and component token re-resolves inside the scope. Overlays rendered in a portal
 * read the scope from context and re-apply it on their popup element.
 */
export function ThemeProvider({ theme = 'light', brand = 'bridge', density = 'comfortable', asRoot = false, children, ...rest }: ThemeProviderProps) {
  const value = useMemo(() => ({ theme, brand, density }), [theme, brand, density]);

  useEffect(() => {
    if (!asRoot) return;
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-brand', brand);
    root.setAttribute('data-density', density);
  }, [asRoot, theme, brand, density]);

  return (
    <ThemeContext.Provider value={value}>
      {asRoot ? children : (
        <div data-theme={theme} data-brand={brand} data-density={density} {...rest}>
          {children}
        </div>
      )}
    </ThemeContext.Provider>
  );
}

/** The nearest theme scope, or null when the app relies on attributes set on `<html>`. */
export function useThemeScope(): ThemeScope | null {
  return useContext(ThemeContext);
}

/**
 * Data attributes to spread on an element rendered outside the scope's DOM subtree (portaled popups),
 * so it keeps the theme, brand and density of the component that opened it.
 */
export function useScopeAttributes(): Record<string, string> {
  const scope = useContext(ThemeContext);
  return scope ? { 'data-theme': scope.theme, 'data-brand': scope.brand, 'data-density': scope.density } : {};
}
