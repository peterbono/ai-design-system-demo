// Studio Changes, a pull request's "Docs" section: the docs.json files it changes, which of them hold prose Claude
// drafted and nobody reviewed yet ("Draft by Claude, needs review", with Accept and Edit). Pure, tested in
// pr-docs.test.ts; scripts/reviews/docs-section.ts reads the files and wires the buttons.
export const isDocsFile = (path: string) => /(^|\/)[A-Z]\w*\.docs\.json$/.test(path);

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

export function componentOfDocsPath(path: string): { name: string; slug: string } {
  const name = path.split('/').pop()!.replace(/\.docs\.json$/, '');
  return { name, slug: kebab(name) };
}

export type PrDocState = 'review' | 'reviewed' | 'written' | 'unreadable';

export interface PrDocRow {
  path: string;
  name: string;
  slug: string;
  state: PrDocState;
  /** draftedBy from the file ("claude"), when set. */
  draftedBy?: string;
}

/** One row per docs.json in the pull request, drafts waiting for review first. `text` null: could not be read. */
export function prDocRows(entries: { path: string; text: string | null }[]): PrDocRow[] {
  const rank: Record<PrDocState, number> = { review: 0, unreadable: 1, written: 2, reviewed: 3 };
  return entries
    .map(({ path, text }) => {
      const c = componentOfDocsPath(path);
      if (text === null) return { path, ...c, state: 'unreadable' as const };
      try {
        const d = JSON.parse(text) as { draftedBy?: string; needsReview?: boolean };
        const state: PrDocState = d.needsReview === true ? 'review' : d.draftedBy ? 'reviewed' : 'written';
        return { path, ...c, state, ...(d.draftedBy ? { draftedBy: d.draftedBy } : {}) };
      } catch {
        return { path, ...c, state: 'unreadable' as const };
      }
    })
    .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
}

/** Pill of a row: violet while a draft waits for review (status colors of the Studio), green once reviewed. */
export const PR_DOC_PILL: Record<PrDocState, { label: string; tone: string }> = {
  review: { label: 'Draft by Claude, needs review', tone: 'is-info' },
  reviewed: { label: 'Reviewed', tone: 'is-pass' },
  written: { label: 'Written by a person', tone: '' },
  unreadable: { label: 'Could not read', tone: '' },
};

/** Section meta: what waits, else how many files. */
export function prDocsMeta(rows: PrDocRow[]): string {
  const waiting = rows.filter((r) => r.state === 'review').length;
  if (waiting) return `${waiting} ${waiting === 1 ? 'draft needs' : 'drafts need'} review`;
  return `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`;
}

/** Edit mode of the Library page, on the pull request's branch. */
export const prDocsEditHref = (slug: string, pr: number, branch: string) => `/components/${slug}/?edit=1&pr=${pr}&ref=${encodeURIComponent(branch)}`;
