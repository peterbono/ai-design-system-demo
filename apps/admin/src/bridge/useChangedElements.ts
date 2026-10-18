// Runs "Show what changed" on demand: once when turned on, again after a route change or a shop or theme switch
// (the screen re-renders, so it waits for the new content), never in the background otherwise.
import { useEffect, useState } from 'react';
import { changedElements, type DiffResult } from './outline';

const IGNORE = '[data-bridge-toolbar], [data-bridge-overlay]';

export function useChangedElements(on: boolean, live: HTMLLinkElement | null, vars: string[], screen: string): DiffResult | null {
  const [result, setResult] = useState<DiffResult | null>(null);
  const key = vars.join(',');
  useEffect(() => {
    if (!on || !live || !key) {
      setResult(null);
      return;
    }
    const run = () => setResult(changedElements(key.split(','), live, (el) => Boolean(el.closest(IGNORE))));
    // Now, then once the new screen has rendered its data (ra-core loads it asynchronously).
    const ids = [window.setTimeout(run, 0), window.setTimeout(run, 400), window.setTimeout(run, 1200)];
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [on, live, key, screen]);
  return result;
}
