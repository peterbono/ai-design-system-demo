// Team pages (multi-team PR 3b): the words for how a team's repository was read, and for why it could not be.
// Pure: scripts/team-data.ts loads, components/ds/studio/TeamState.tsx shows, team-load.test.ts covers the wording.

import { teamDisplayName } from './demo';
/** Where the team's data came from (scripts/repo-context.ts TeamModelSource). */
export type TeamDataSource = 'cache' | 'snapshot' | 'live';

/** What went wrong reading a team's repository, in the words the page shows. */
export type TeamFailureKind = 'rate-limit' | 'not-found' | 'too-large' | 'network' | 'signed-out' | 'unknown';

export interface TeamFailure {
  kind: TeamFailureKind;
  title: string;
  body: string;
}

/** The workflow a team copies to publish its snapshot (docs/HOSTED.md). */
export const SNAPSHOT_TEMPLATE_URL = 'https://github.com/peterbono/ai-design-system-demo/blob/main/templates/bridge-data.yml';
/** The docs page on hosted Bridge and the snapshot. */
export const HOSTED_DOCS_URL = 'https://github.com/peterbono/ai-design-system-demo/blob/main/docs/HOSTED.md';

const statusOf = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
};

/** Signed out meanwhile: the page says so and offers Sign in (back to the same page with a code). */
const SIGNED_OUT_FAILURE = (repo: string): TeamFailure => ({ kind: 'signed-out', title: 'You signed out', body: `Sign in again to open ${repo}. Bridge sends a code to your email.` });

/** A failure to read `repo` ("owner/name") as the page says it. Never shows a stack or a raw API body. */
export function teamFailure(err: unknown, full: string): TeamFailure {
  const status = statusOf(err);
  // The team by its name, never owner/repo ("this repository" when the address names none).
  const repo = full.includes('/') ? teamDisplayName(full) : full;
  const message = err instanceof Error ? err.message : '';
  // A private Library this site serves (api/library-access): its own sentence, never "GitHub answered".
  if ((err as { source?: unknown } | null)?.source === 'bridge') {
    return status === 0
      ? { kind: 'network', title: 'Bridge did not answer', body: 'Check your connection, then try again.' }
      : { kind: 'unknown', title: `Bridge cannot open ${repo} yet`, body: message || 'Something went wrong while opening the library. Try again.' };
  }
  // The session ended (signed out in another tab, or on another device): a way back in, never the server's sentence.
  if (status === 401) return SIGNED_OUT_FAILURE(repo);
  if (status === 429 || (status === 403 && /rate limit/i.test(message))) {
    return {
      kind: 'rate-limit',
      title: 'GitHub asked Bridge to slow down',
      body: message || 'GitHub allows a limited number of reads an hour. Sign in with GitHub for a higher limit, or try again in a few minutes.',
    };
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      title: `Bridge cannot open ${repo}`,
      body: 'GitHub says this repository does not exist, or it is private. Check the address. If it is private, sign in with GitHub with an account that can see it.',
    };
  }
  if (status === 413) {
    return {
      kind: 'too-large',
      title: `${repo} is too large to read in the browser`,
      body: 'Its file list is over what GitHub returns in one read. Publish the Bridge snapshot from your CI and Bridge reads that instead.',
    };
  }
  if (status === 0) {
    return { kind: 'network', title: 'Bridge could not reach GitHub', body: 'Check your connection, then try again.' };
  }
  return {
    kind: 'unknown',
    title: `Bridge could not read ${repo}`,
    body: message ? `GitHub answered: ${message}` : 'Something went wrong while reading the repository. Try again.',
  };
}

const SOURCE_WORDS: Record<TeamDataSource, string> = {
  snapshot: 'from the Bridge snapshot',
  live: 'live from GitHub',
  cache: 'kept in this browser',
};

/** "Read at a1b2c3d on main, from the Bridge snapshot": the one line under a team page's title. */
export function sourceLine(input: { sha: string; branch: string; source: TeamDataSource }): string {
  return `Read at ${input.sha.slice(0, 7)} on ${input.branch}, ${SOURCE_WORDS[input.source]}.`;
}

/** The commit a team page was read at, on GitHub. */
export const commitUrl = (owner: string, repo: string, sha: string) => `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(sha)}`;

/** A file of the team's repository at a commit, on GitHub. */
export const fileUrl = (owner: string, repo: string, sha: string, path: string) =>
  `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(sha)}/${path.split('/').map(encodeURIComponent).join('/')}`;
