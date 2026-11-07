// How a Studio list is shown: as rows, or as cards (the Home's card). The lists hold screens, and a screen says more
// than its title: the grid is offered wherever a list is only read, and never on "Waiting on me", where rows are
// picked, compared and reviewed one after the other (the checkboxes and "Review all" belong to a list).
// The choice is this person's, on this browser, and holds for the page: it is remembered per page, not in the address,
// so a link they share opens the way the person they send it to reads their lists. Tested in list-view.test.ts.
export type ListView = 'list' | 'grid';

/** The words on the switch, and its accessible name. */
export const LIST_VIEW_WORDS = { label: 'Show as', list: 'List', grid: 'Grid' } as const;

const key = (page: string) => `bridge.view.${page}`;

/** Told on `document` when the view changes, so every list painted on the page follows the same choice. */
export const LIST_VIEW_EVENT = 'bridge:list-view';

export interface ListViewChange {
  page: string;
  view: ListView;
}

/** The view this person last picked on a page, List until they pick one. Unreadable storage counts as no choice. */
export function readListView(page: string): ListView {
  try {
    return localStorage.getItem(key(page)) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

/** Remembers the view for a page. A browser that refuses to store it keeps the choice for this page's lifetime only. */
export function rememberListView(page: string, view: ListView): void {
  try {
    localStorage.setItem(key(page), view);
  } catch {
    /* A private window, or storage turned off: the page still works, it just forgets. */
  }
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent<ListViewChange>(LIST_VIEW_EVENT, { detail: { page, view } }));
}
