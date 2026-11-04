// A horizontal row of chips or tabs that scrolls (a phone): the edge with more past it is marked
// (data-overflow-start, data-overflow-end) so its CSS fades that edge, and a cut chip reads as "scroll for more".
// The DS Tabs list does the same for itself (packages/react Tabs watchOverflowEdges); this one serves the plain
// script rows that are not DS Tabs, such as Studio Tokens' type chips (scripts/explorer). Unit tested in
// overflow-edges.test.ts.

/** Marks the scrolling edges of `el` now, on scroll and on resize. Returns the cleanup. */
export function watchOverflowEdges(el: HTMLElement): () => void {
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.toggleAttribute('data-overflow-start', max > 1 && el.scrollLeft > 1);
    el.toggleAttribute('data-overflow-end', max > 1 && el.scrollLeft < max - 1);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  ro?.observe(el);
  // Chips are rendered after load (counts per type): a new child can make the row overflow.
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
  mo?.observe(el, { childList: true, subtree: true });
  return () => {
    el.removeEventListener('scroll', update);
    ro?.disconnect();
    mo?.disconnect();
  };
}
