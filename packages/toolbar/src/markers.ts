// What a code change changed, as its exploration marks it. Token changes are measured (outline.ts); a code change
// cannot be: its live side is another origin. So an exploration marks each new or changed area of the UI with
// data-bridge-change="<short plain label>" on its outermost element, and on This change the toolbar outlines, counts
// and steps through those areas like token changes. On Live product the areas are not there: the bar says how many
// wait on This change, from the count the switch carried over (MARKS_PARAM), for the screen it was counted on.
import type { ChangedElement } from './outline';
import { MARKS_PARAM } from './session';

/** The attribute an exploration puts on each new or changed area: its value is the area's label. */
export const CHANGE_ATTR = 'data-bridge-change';
/** Where Live product keeps that count, with the screen it was counted on. */
export const MARKS_KEY = 'bridge-admin:marks';

/** The toolbar's own nodes: never counted, even when a page marks its root. */
const IGNORE = '[data-bridge-toolbar], [data-bridge-overlay]';

/** The label of an area: its marker, tidied. An empty marker still counts: "Changed area". */
export function markerLabel(value: string | null | undefined): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Changed area';
}

/** Every marked area of the page, in document order, as the outlines take them (no token, no property). */
export function markedElements(root: ParentNode = document): ChangedElement[] {
  return Array.from(root.querySelectorAll(`[${CHANGE_ATTR}]`))
    .filter((el) => !el.closest(IGNORE))
    .map((el) => ({ el, pseudo: null, roots: [], props: [], label: markerLabel(el.getAttribute(CHANGE_ATTR)), keys: [], floating: false }));
}

/** Same areas, same labels: a re-scan that found nothing new keeps the list (and the outlines) as they are. */
export function sameMarks(a: readonly ChangedElement[] | null, b: readonly ChangedElement[]): boolean {
  return Boolean(a) && a!.length === b.length && a!.every((x, i) => x.el === b[i]!.el && x.label === b[i]!.label);
}

/** "1 changed on This change": Live product, where the areas are not. Unknown count: where to see them. */
export const waitingText = (n: number | null) => (n === null ? 'See what changed' : `${n} changed on This change`);

/** No marker on This change: say so plainly, and how to see the difference anyway. */
export const NO_MARKS_LINE = 'This change does not mark what it changed yet. Compare Live product and This change.';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The count the switch to Live product carried (MARKS_PARAM), kept for the screen it was counted on, so it survives a
 * reload there. Another screen: unknown (null), the areas of that screen were never counted.
 */
export function readMarks(search: string, route: string, storage: StorageLike | null): number | null {
  const raw = new URLSearchParams(search).get(MARKS_PARAM);
  if (raw !== null && /^\d{1,4}$/.test(raw)) {
    try {
      storage?.setItem(MARKS_KEY, JSON.stringify({ route, n: Number(raw) }));
    } catch {
      // Storage blocked: the count lasts for this page only.
    }
    return Number(raw);
  }
  try {
    const kept = JSON.parse(storage?.getItem(MARKS_KEY) ?? 'null') as { route?: unknown; n?: unknown } | null;
    return kept && kept.route === route && typeof kept.n === 'number' ? kept.n : null;
  } catch {
    return null;
  }
}
