// The review queue (pages/studio/review.astro): how the viewer moves through the rows that wait on them. Pure: no DOM.
// Unit tested in queue-nav.test.ts.
//   - J and ArrowDown go to the next row, K and ArrowUp to the previous one; nothing wraps at the ends.
//   - Skip goes to the next row; from the last one it comes back to the first, where the skipped rows wait.
//   - Approve drops the row and keeps the position on what came after it.

export type QueueMove = 'next' | 'previous';

/** The next index, or null at the end (no wrap). */
export function nextIndex(length: number, index: number): number | null {
  return index + 1 < length ? Math.max(0, index + 1) : null;
}

/** The previous index, or null at the start (no wrap). */
export function previousIndex(length: number, index: number): number | null {
  if (!length || index <= 0) return null;
  return Math.min(index - 1, length - 1);
}

/** Where a move lands, or null when it cannot move. */
export function moveIndex(length: number, index: number, move: QueueMove): number | null {
  return move === 'next' ? nextIndex(length, index) : previousIndex(length, index);
}

/** "3 of 20", 1-based; empty when nothing is selected. */
export function positionLabel(length: number, index: number): string {
  return length && index >= 0 && index < length ? `${index + 1} of ${length}` : '';
}

/** Which way a key moves: j or ArrowDown next, k or ArrowUp previous. Null for any other key or with a modifier. */
export function keyMove(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): QueueMove | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') return 'next';
  if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') return 'previous';
  return null;
}

/** Where Skip lands: the next row, else back to the first one; null when nothing else waits. */
export function skipIndex(length: number, index: number): number | null {
  if (length < 2) return null;
  return index + 1 < length ? index + 1 : 0;
}

/**
 * What remains once the row at `index` is approved: the list without it, and the index of the row that came after it
 * (the one before when it was the last). Index -1 when nothing remains.
 */
export function afterApprove<T>(items: readonly T[], index: number): { items: T[]; index: number } {
  if (index < 0 || index >= items.length) return { items: [...items], index: items.length ? Math.min(Math.max(index, 0), items.length - 1) : -1 };
  const rest = items.filter((_, i) => i !== index);
  return { items: rest, index: rest.length ? Math.min(index, rest.length - 1) : -1 };
}

/** The row key a queue URL names: ?pr=N is the branch row "change-N", else ?item=<key>. */
export function keyFromSearch(search: string): string | null {
  const p = new URLSearchParams(search);
  const n = Number(p.get('pr'));
  if (Number.isInteger(n) && n > 0) return `change-${n}`;
  return p.get('item') || null;
}

/** The query that keeps a selection: ?pr=N for a branch row, ?item=<key> for the rest, empty without one. */
export function searchFor(row: { key: string; number?: number } | null): string {
  if (!row) return '';
  return row.number ? `?pr=${row.number}` : `?item=${encodeURIComponent(row.key)}`;
}

/** The branch number of a row that opens a branch review in place (its link is /studio/changes/?pr=N). */
export function branchOf(row: { href: string; number?: number }): number | null {
  const m = /^\/studio\/changes\/\?pr=(\d+)$/.exec(row.href);
  return m ? Number(m[1]) : null;
}
