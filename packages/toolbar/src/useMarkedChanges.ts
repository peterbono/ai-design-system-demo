// Finds the areas a code change marks (markers.ts) on This change: once when turned on, again after a route change
// (the screen re-renders, so it waits for the new content, as useChangedElements does), and whenever the page adds,
// removes or relabels a marked area (a list that loads its data later, a dialog that opens).
import { useEffect, useState } from 'react';
import type { ChangedElement } from './outline';
import { CHANGE_ATTR, markedElements, sameMarks } from './markers';

const OWN = '[data-bridge-toolbar], [data-bridge-overlay]';

export function useMarkedChanges(on: boolean, screen: string): ChangedElement[] | null {
  const [marks, setMarks] = useState<ChangedElement[] | null>(null);
  useEffect(() => {
    if (!on) {
      setMarks(null);
      return;
    }
    const run = () => {
      const next = markedElements();
      setMarks((prev) => (sameMarks(prev, next) ? prev : next));
    };
    // Now, then once the new screen has rendered its data.
    const ids = [window.setTimeout(run, 0), window.setTimeout(run, 400), window.setTimeout(run, 1200)];
    // Later changes of the page, at most once a frame; the toolbar's own outlines never trigger it.
    let frame = 0;
    const mo =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            if (records.every((r) => r.target instanceof Element && r.target.closest(OWN))) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(run);
          });
    mo?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [CHANGE_ATTR] });
    return () => {
      ids.forEach((id) => window.clearTimeout(id));
      cancelAnimationFrame(frame);
      mo?.disconnect();
    };
  }, [on, screen]);
  return marks;
}
