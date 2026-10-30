// Stepping through the changes of a screen, the pure part: the order a person reads them in, the previous and next
// one, the words of the count, and which keys the toolbar answers. The DOM part (Toolbar.tsx) measures the changed
// surfaces, scrolls to the current one and outlines it stronger than the others.

/** Where a changed surface sits on the page (scroll included), to read the changes top to bottom, then left to right. */
export interface Place {
  top: number;
  left: number;
}

/** Two surfaces whose tops are this close share a line: read left to right. */
const SAME_LINE = 8;

/** The indexes of `places`, in reading order: top to bottom, then left to right on one line. */
export function readingOrder(places: Place[]): number[] {
  return places
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (Math.abs(a.p.top - b.p.top) <= SAME_LINE ? a.p.left - b.p.left : a.p.top - b.p.top) || a.i - b.i)
    .map((x) => x.i);
}

/**
 * The next position (delta 1) or the previous one (delta -1) among `count` changes, wrapping at both ends. Nothing
 * current yet: Next starts at the first, Previous at the last. No change: null.
 */
export function stepTo(current: number | null, delta: 1 | -1, count: number): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0 || current >= count) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** "1 change", "3 changes": what the bar shows before stepping. */
export const changeCount = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;

/** "2 of 3": the bar while stepping. */
export const positionLabel = (position: number, n: number) => `${position + 1} of ${n}`;

/** "Change 2 of 3: Save bar (Save changes)": what a screen reader hears on each step. */
export const stepAnnouncement = (position: number, n: number, label: string) => `Change ${position + 1} of ${n}: ${label}`;

/** No changed surface on this screen: say so, and where the change shows when the toolbar knows it. */
export function elsewhereLine(screens: string[]): string {
  if (!screens.length) return "This change doesn't touch this screen.";
  const names = screens.length <= 2 ? screens.join(' and ') : `${screens.slice(0, 2).join(', ')} and ${screens.length - 2} more`;
  return `This change doesn't touch this screen. It shows on ${names}.`;
}

interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: unknown;
}

/** Whether the person is typing: a field, an editable region, a combobox. Shortcuts never fire there. */
export function isTyping(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return Boolean(t.closest && t.closest('[role="combobox"], [role="textbox"], [role="searchbox"]'));
}

/** Escape turns Isolate off, unless the person is typing (Escape clears or closes the field there). */
export function isEscape(e: KeyLike): boolean {
  return e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !isTyping(e.target);
}
