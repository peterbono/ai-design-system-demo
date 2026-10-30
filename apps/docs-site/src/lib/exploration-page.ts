// The exploration page while it runs (validated boards X1 "nothing built yet" and X2 "Claude has changed things"):
// pure view rules over @bridge-ds/core's exploration-resume words. Not started: the Continue in Claude panel and an
// empty "Your preview" frame. Exploring: the preview, the last activity in words, Done exploring, the last 3 events.
// Later states keep their own pages. No DOM, no fetch: tested in exploration-page.test.ts.
import { continueLines, explorationActivity, lastActivity, shortAgo, startedWhen, type BranchCommitLike, type PreviewApps } from '@bridge-ds/core';

/** A person or Claude on the page: the login (for the face), the name to show, and whether it is Claude. */
export interface PageFace {
  login: string;
  name: string;
  agent: boolean;
  avatar: string | null;
}

/** GitHub's public photo of an account (no API read); none for an email or Claude. */
export const avatarOf = (login: string): string | null => (/^[A-Za-z0-9-]+(\[bot\])?$/.test(login) && !/\[bot\]$/.test(login) ? `https://github.com/${login}.png?size=64` : null);

export const faceOf = (who: string, claude: boolean, names: Record<string, string> = {}): PageFace =>
  claude ? { login: 'claude', name: 'Claude', agent: true, avatar: null } : { login: who, name: names[who] ?? who, agent: false, avatar: avatarOf(who) };

/** "Started by" line after the name: " · Admin demo · today". */
export const startedTail = (productName: string, startedAt: string | null | undefined, now?: Date): string => [productName, startedAt ? startedWhen(startedAt, now) : ''].filter(Boolean).join(' · ');

/** One row of the activity list, and the line under the title (the same words). */
export interface ActivityRow {
  who: PageFace;
  text: string;
  when: string;
}

/** The last 3 events: Claude's and people's changes, then "started the exploration" when it fits. */
export function activityRows(input: { commits: readonly BranchCommitLike[]; author: string; startedAt?: string | null | undefined; names?: Record<string, string>; now?: Date }): ActivityRow[] {
  return explorationActivity({ commits: input.commits, author: input.author, startedAt: input.startedAt, limit: 3 }).map((e) => ({ who: faceOf(e.who, e.claude, input.names), text: e.text, when: shortAgo(e.at, input.now) }));
}

/** "Claude changed Orders table and Bulk actions bar, 2 h ago": the line under the title once something changed. */
export function headlineOf(input: { commits: readonly BranchCommitLike[]; files: readonly string[] | null; author: string; names?: Record<string, string>; now?: Date }): ActivityRow | null {
  const last = lastActivity({ commits: input.commits, files: input.files, author: input.author });
  return last ? { who: faceOf(last.who, last.claude, input.names), text: last.text, when: shortAgo(last.at, input.now) } : null;
}

/** The two lines of the Continue in Claude panel. */
export const pageLines = continueLines;

/**
 * Which preview a library exploration opens: the app its files change (the docs site, the admin demo), else the
 * Storybook for library components, else the docs site. Only apps the repository has previews for.
 */
export function libraryPreviewApp(files: readonly string[] | null | undefined, apps: PreviewApps): keyof PreviewApps | null {
  const has = (k: keyof PreviewApps) => Boolean(apps[k]);
  const f = files ?? [];
  if (f.some((x) => x.startsWith('apps/admin/')) && has('admin')) return 'admin';
  if (f.some((x) => x.startsWith('apps/docs-site/')) && has('docs')) return 'docs';
  if (f.some((x) => x.startsWith('packages/react/')) && has('storybook')) return 'storybook';
  return has('docs') ? 'docs' : has('storybook') ? 'storybook' : has('admin') ? 'admin' : null;
}

/** The Done exploring card: what its button does for this viewer (never a technical blocker). */
export type DoneAction = { kind: 'run' } | { kind: 'connect'; label: string } | { kind: 'demo' } | { kind: 'note'; text: string } | null;
