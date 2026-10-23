// Keyboard for role="menu" (the WAI-ARIA menu pattern): arrows move between items, Home and End jump, Escape closes
// and gives focus back to the button that opened the menu. `menuStep` is pure (tested); `menuKeys` wires it to a menu.

/** The item to focus after `key` from item `index` of `count` (wrapping), or undefined when the key is not a menu key. */
export function menuStep(index: number, count: number, key: string): number | undefined {
  if (count <= 0) return undefined;
  const from = index < 0 ? -1 : index;
  if (key === 'ArrowDown') return (from + 1) % count;
  if (key === 'ArrowUp') return from <= 0 ? count - 1 : from - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/** The enabled items of a menu, in order. */
export const menuItems = (menu: Element): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>(ITEMS)];

/** Focuses the first enabled item of a menu (on open). */
export function focusFirstItem(menu: Element | null): void {
  if (menu) menuItems(menu)[0]?.focus();
}

/**
 * onKeyDown for an element holding a role="menu": arrows, Home and End move focus between its items; Escape calls
 * `close` (which closes the menu and focuses the button that opened it).
 */
export function menuKeys(close: () => void) {
  return (e: KeyboardEvent): void => {
    const root = e.currentTarget as HTMLElement;
    const menu = root.matches('[role="menu"]') ? root : root.querySelector('[role="menu"]');
    if (!menu) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const items = menuItems(menu);
    const next = menuStep(items.indexOf(document.activeElement as HTMLElement), items.length, e.key);
    if (next === undefined) return;
    e.preventDefault();
    items[next]!.focus();
  };
}
