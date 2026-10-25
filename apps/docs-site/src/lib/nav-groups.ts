// Side nav groups (Foundations, Use): the same for every visitor, signed in with GitHub, by email or not at all.
// The group holding the current page is always open; every other group starts open and stays as the visitor left it
// in this tab (sessionStorage), never across tabs, browsers or accounts. A stored "closed" never hides the current
// page's group.

/** sessionStorage key of one group's state in this tab. */
export const navGroupKey = (label: string) => `bridge:nav-group:${label}`;

export type StoredGroup = 'open' | 'closed' | null;

/** Whether a group shows its pages: always when it holds the current page, else unless closed in this tab. */
export function navGroupOpen(opts: { current: boolean; stored: StoredGroup }): boolean {
  return opts.current || opts.stored !== 'closed';
}

/** The state stored for a group in this tab; null when none or when storage is unavailable. */
export function readNavGroup(label: string, storage: Pick<Storage, 'getItem'> | null): StoredGroup {
  try {
    const v = storage?.getItem(navGroupKey(label));
    return v === 'open' || v === 'closed' ? v : null;
  } catch {
    return null;
  }
}

/** Remembers a toggle for this tab; storage failures are ignored (the default applies next page). */
export function writeNavGroup(label: string, open: boolean, storage: Pick<Storage, 'setItem'> | null) {
  try {
    storage?.setItem(navGroupKey(label), open ? 'open' : 'closed');
  } catch {
    /* private mode or blocked storage */
  }
}
