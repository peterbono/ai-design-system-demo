// Storybook quick start (plan section 5): the words and rules of the Storybook components page
// (components/ds/studio/StorybookComponents.tsx) and of onboarding step 2. Pure, covered by storybook-view.test.ts.
// Everything shown comes from the Storybook's own index: titles, story names, docs pages, tags. Nothing is guessed.
import type { StorybookComponent, StorybookErrorCode, StorybookIndex } from '@bridge-ds/core';
import { studioHref } from './team-path';

/** Whether the Storybook lets Bridge show a story in a frame: read by /api/storybook, unknown on a direct read. */
export type FrameVerdict = 'allowed' | 'blocked' | 'unknown';

export interface StorybookRow {
  /** The title, unique in the index: the row key. */
  title: string;
  name: string;
  /** The title's folders joined ("Forms", "Components / Inputs"); empty at the root. */
  family: string;
  stories: number;
  docs: boolean;
  /** The first story, what the preview opens on. */
  firstStory: string | null;
}

/** One row per component with at least one story. Docs-only pages (Intro, Getting started) are counted apart. */
export function storybookRows(index: Pick<StorybookIndex, 'components'>): StorybookRow[] {
  return index.components
    .filter((c) => c.stories.length > 0)
    .map((c) => ({ title: c.title, name: c.name, family: c.group.join(' / '), stories: c.stories.length, docs: c.docs.length > 0, firstStory: c.stories[0]?.id ?? null }));
}

/** Families in index order, with how many rows each holds. Rows at the root are "Top level". */
export const TOP_LEVEL = 'Top level';
export function storybookFamilies(rows: StorybookRow[]): { name: string; n: number }[] {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.family || TOP_LEVEL, (out.get(r.family || TOP_LEVEL) ?? 0) + 1);
  return [...out.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => (a.name === TOP_LEVEL ? 1 : b.name === TOP_LEVEL ? -1 : a.name.localeCompare(b.name)));
}

/** Rows matching a search (name or title, any case) and a family ('' = all). */
export function filterStorybookRows(rows: StorybookRow[], query: string, family: string): StorybookRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!family || (r.family || TOP_LEVEL) === family) && (!q || r.title.toLowerCase().includes(q)));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "53 components, 196 stories, read from your Storybook." plus the docs-only pages when there are some. */
export function storybookLead(index: Pick<StorybookIndex, 'components'>): string {
  const rows = storybookRows(index);
  const stories = rows.reduce((n, r) => n + r.stories, 0);
  const pages = index.components.filter((c) => c.stories.length === 0 && c.docs.length > 0).length;
  return `${plural(rows.length, 'component')}, ${plural(stories, 'story', 'stories')}${pages ? ` and ${plural(pages, 'docs page')}` : ''}, read from your Storybook.`;
}

/** What a component row says in words: "4 stories, docs". */
export const rowFacts = (r: Pick<StorybookRow, 'stories' | 'docs'>) => `${plural(r.stories, 'story', 'stories')}${r.docs ? ', docs' : ''}`;

/** The tags worth showing on a component: the ones a team sets, not Storybook's own bookkeeping. */
const BOOKKEEPING = new Set(['dev', 'test', 'manifest', 'story', 'docs', 'autodocs', 'attached-mdx', 'unattached-mdx', 'play-fn', '!dev', '!test', '!autodocs']);
export const shownTags = (c: Pick<StorybookComponent, 'tags'>) => c.tags.filter((t) => !BOOKKEEPING.has(t));

/** What to say when a Storybook cannot be read, with how to fix it. */
export function storybookErrorLine(code: StorybookErrorCode | 'blocked' | 'too-large' | 'timeout' | 'redirects' | string): string {
  switch (code) {
    case 'invalid-url':
      return 'Enter the full address, starting with https://';
    case 'not-found':
      return 'No Storybook here. Use the address of the published Storybook, the page with the sidebar.';
    case 'not-json':
      return 'This address answers with a web page, not a Storybook index. Use the address of the published Storybook.';
    case 'private':
      return 'This Storybook asks for a sign-in, so Bridge cannot read it. Use a public Storybook, or connect the repository.';
    case 'empty':
      return 'This Storybook lists no stories yet.';
    case 'blocked':
      return 'This address is on a private network. Bridge reads Storybooks published on the internet.';
    case 'too-large':
      return 'This Storybook index is larger than 5 MB, more than Bridge reads.';
    case 'timeout':
      return 'The Storybook took too long to answer. Try again in a moment.';
    case 'redirects':
      return 'This address redirects too many times. Use the final Storybook address.';
    default:
      return 'Bridge could not reach this Storybook. Check the address, then try again.';
  }
}

/** The preview area when the story cannot be framed, or may not be. */
export function frameLine(frame: FrameVerdict): string | null {
  if (frame === 'blocked') return 'This Storybook does not allow showing its stories on other sites. Open it in Storybook.';
  return null;
}

/** What quick start does not have: the features that read the repository, said once, calmly. */
export const LOCKED_FEATURES = ['Tokens', 'contrast checks', 'suggestions'] as const;
export const LOCKED_LINE = 'Tokens, contrast checks and suggestions need the repository connected.';
export const CONNECT_REPO = { label: 'Connect the repository', href: studioHref('?setup=library') } as const;

/** "Checked 5 minutes ago" for the saved Storybook. */
export function checkedAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'Checked just now';
  const m = Math.round(s / 60);
  if (m < 60) return `Checked ${plural(m, 'minute')} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Checked ${plural(h, 'hour')} ago`;
  return `Checked ${plural(Math.round(h / 24), 'day')} ago`;
}
