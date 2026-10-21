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

// The list with outcomes: what the viewer did to each row here, and which rows show.

/** What the viewer did to a row in this visit. Approved and suggested rows stay listed, marked. Declined: a suggestion. */
export type QueueOutcome = 'approved' | 'suggested' | 'asked' | 'declined';

/** How many rows to do show after the current one before "and N more". */
export const QUEUE_AHEAD = 3;

/**
 * The rows the list shows: every row up to the current one, then the next QUEUE_AHEAD, at least `min` rows; the rest
 * is counted as "and N more" (the phone picker, J and K reach them).
 */
export function queueWindow(length: number, index: number, min = 5): { end: number; more: number } {
  const end = Math.min(length, Math.max(min, (index < 0 ? 0 : index + 1) + QUEUE_AHEAD));
  return { end, more: length - end };
}

/** "Approved Darker default background", the toast after a decision. */
export function outcomeLine(outcome: QueueOutcome, title: string): string {
  const verb = { approved: 'Approved', suggested: 'Suggested changes on', asked: 'Asked someone else to review', declined: 'Declined' }[outcome];
  return `${verb} ${title}`;
}

/** Where the queue goes after a decision: the next row without an outcome after `index`, else before it; null when done. */
export function nextOpen(keys: readonly string[], index: number, outcomes: ReadonlyMap<string, QueueOutcome>): number | null {
  for (let i = index + 1; i < keys.length; i++) if (!outcomes.has(keys[i]!)) return i;
  for (let i = 0; i < index; i++) if (!outcomes.has(keys[i]!)) return i;
  return null;
}

/** The queue's decision keys: A approves, S suggests changes. Null for any other key or with a modifier. */
export function keyDecision(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): 'approve' | 'suggest' | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === 'a' || e.key === 'A') return 'approve';
  if (e.key === 's' || e.key === 'S') return 'suggest';
  return null;
}

/** How long an approval waits for Undo before it is sent (nothing reaches GitHub before). */
export const UNDO_MS = 6000;

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
