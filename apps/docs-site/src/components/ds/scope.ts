// The design system preview scope (brand x density) for React islands. scripts/shell.ts owns the state (kept on
// <html> as data-preview-brand / data-preview-density, stored per browser); islands read it, ask shell.ts to change it
// with a `bridge:set-scope` event, and follow `bridge:scope` events.
import { useEffect, useState } from 'react';

export interface PreviewScope {
  brand: string;
  density: string;
}

export function readScope(): PreviewScope {
  if (typeof document === 'undefined') return { brand: 'bridge', density: 'comfortable' };
  const d = document.documentElement.dataset;
  return { brand: d.previewBrand ?? 'bridge', density: d.previewDensity ?? 'comfortable' };
}

export function requestScope(patch: Partial<PreviewScope>) {
  document.dispatchEvent(new CustomEvent('bridge:set-scope', { detail: patch }));
}

/** Current preview scope, kept in step with every change made anywhere on the page. */
export function useScope(): PreviewScope {
  const [scope, setScope] = useState<PreviewScope>({ brand: 'bridge', density: 'comfortable' });
  useEffect(() => {
    setScope(readScope());
    const on = (e: Event) => setScope((e as CustomEvent<PreviewScope>).detail ?? readScope());
    document.addEventListener('bridge:scope', on);
    return () => document.removeEventListener('bridge:scope', on);
  }, []);
  return scope;
}
