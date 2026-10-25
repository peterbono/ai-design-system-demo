// Team pages (multi-team PR 3b): the words for how a team's repository was read, and for why it could not be.
// Pure: scripts/team-data.ts loads, components/ds/studio/TeamState.tsx shows, team-load.test.ts covers the wording.

import { teamDisplayName } from './demo';
import { knownTeamName } from './recent-teams';
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

/**
 * "Bridge is busy, try again in N min." from a wait in seconds (at least 1 minute); "in a few minutes" when the wait
 * is unknown. The one sentence for any limit a designer meets (Bridge's or GitHub's).
 */
export function busyText(waitSeconds?: number | null): string {
  if (waitSeconds == null || !Number.isFinite(waitSeconds)) return 'Bridge is busy, try again in a few minutes.';
  return `Bridge is busy, try again in ${Math.max(1, Math.ceil(waitSeconds / 60))} min.`;
}

/** The wait Bridge's server already put in its sentence ("try again in 5 min."), in seconds, else null. */
function busyWait(message: string): number | null {
  const m = /try again in (\d+) min/i.exec(message);
  return m ? Number(m[1]) * 60 : null;
}

/** A failure to read `repo` ("owner/name") as the page says it. Never shows a stack or a raw API body. */
export function teamFailure(err: unknown, full: string): TeamFailure {
  const status = statusOf(err);
  // The team by its name, never owner/repo ("this repository" when the address names none).
  const repo = full.includes('/') ? teamDisplayName(full, { name: knownTeamName(full) }) : full;
  const message = err instanceof Error ? err.message : '';
  // A private Library this site serves (api/library-access): its own sentence, never "GitHub answered".
  if ((err as { source?: unknown } | null)?.source === 'bridge') {
    return status === 0
      ? { kind: 'network', title: 'Bridge did not answer', body: 'Check your connection, then try again.' }
      : { kind: 'unknown', title: `Bridge cannot open ${repo} yet`, body: message || 'Something went wrong while opening the library. Try again.' };
  }
  // The session ended (signed out in another tab, or on another device): a way back in, never the server's sentence.
  if (status === 401) return SIGNED_OUT_FAILURE(repo);
  // A limit (Bridge's own, or GitHub's): Bridge's words and when to come back, never "add a GitHub token".
  if (status === 429 || (status === 403 && /rate limit/i.test(message))) {
    const resetsAt = (err as { resetsAt?: unknown } | null)?.resetsAt;
    const wait = resetsAt instanceof Date ? (resetsAt.getTime() - Date.now()) / 1000 : busyWait(message);
    return { kind: 'rate-limit', title: busyText(wait), body: 'Bridge reads this design system again then. Nothing you changed is lost.' };
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      title: `Bridge cannot open ${repo}`,
      // Designer words (email-only entry): a team's member signs in with the email the team invited, never "with GitHub".
      body: 'This design system is private, or the address has a typo. If you are on the team, sign in with the email your team invited, then try again.',
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
