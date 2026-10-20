// What a GitHub failure means for the designer's token, in one place. A 401 means GitHub no longer accepts the token
// (revoked, regenerated or expired): every screen then shows the same callout pointing to Settings, never the raw
// error. A 403 for a missing permission names the permission and links to the token page on GitHub.

import { type GitHubClient, GitHubError, TOKEN_SETTINGS_URL, isMissingPermission, isTokenRejected, missingPermissionMessage } from '@bridge-ds/core';
import type { TokenState } from '../shared/messages';

export const TOKEN_REJECTED_CALLOUT = 'Your GitHub token stopped working. Replace it in Settings.';
export const TOKEN_REJECTED_DETAIL = 'GitHub no longer accepts it: it was revoked, regenerated or has expired.';
/** A token pasted in Settings that GitHub refuses at once (never worked, rather than stopped working). */
export const NEW_TOKEN_REFUSED = 'GitHub did not accept this token. Copy it again from GitHub, all of it, and check that it has not expired.';
export { TOKEN_SETTINGS_URL };

/** What DS Bridge was doing when a permission was missing, by permission: the verb phrase of the message. */
const ACTION_BY_PERMISSION: Record<string, string> = {
  issues: 'create requests',
  pull_requests: 'open pull requests',
  contents: 'write to the repository',
  checks: 'read checks',
  statuses: 'read commit statuses',
  deployments: 'read previews',
};

export type TokenProblem =
  | { kind: 'rejected'; text: string }
  | { kind: 'missing-permission'; text: string; permission: string | undefined; url: string };

/** The token problem behind `err`, or undefined when the failure is about something else. */
export function tokenProblem(err: unknown): TokenProblem | undefined {
  if (isTokenRejected(err)) return { kind: 'rejected', text: TOKEN_REJECTED_CALLOUT };
  if (isMissingPermission(err)) {
    const permission = (err as GitHubError).permission;
    const action = permission ? ACTION_BY_PERMISSION[permission] : undefined;
    return { kind: 'missing-permission', text: missingPermissionMessage(permission, action), permission, url: TOKEN_SETTINGS_URL };
  }
  return undefined;
}

/** The message for a failure shown inline: the permission sentence, or the error's own message. */
export function errorText(err: unknown): string {
  const p = tokenProblem(err);
  if (p) return p.text;
  return err instanceof Error ? err.message : String(err);
}

/** A component read that failed, for a callout: what happened and what to do, the technical error folded away. */
export interface ComponentsReadProblem {
  title: string;
  text: string;
  /** The error itself, for a report: shown in a closed disclosure, never as the message. */
  detail?: string | undefined;
}

/**
 * Pull compares the Figma components with main, Push reads them for requests. A token or permission problem keeps its
 * own sentence; anything else says what still works and what to do, with the raw error as a detail to report.
 */
export function componentsReadProblem(err: unknown, flow: 'pull' | 'push'): ComponentsReadProblem {
  const title = 'Components could not be read';
  const token = tokenProblem(err);
  if (token) return { title, text: token.text };
  const raw = err instanceof Error ? err.message : String(err);
  const text =
    flow === 'pull'
      ? 'Bridge could not compare your Figma components with main. Variables still pull as usual. Check again, and if it keeps failing, update DS Bridge and report it with the details below.'
      : 'Bridge could not read your Figma components. Variables still send as usual. Scan again, and if it keeps failing, update DS Bridge and report it with the details below.';
  return { title, text, ...(raw ? { detail: raw } : {}) };
}

/**
 * Checks the saved token once (one call: the repository). "rejected" on a 401, "ok" when GitHub answers, undefined
 * when the answer says nothing about the token (offline, rate limit, repository not found).
 */
export async function checkToken(client: Pick<GitHubClient, 'getRepo'>): Promise<TokenState | undefined> {
  try {
    await client.getRepo();
    return 'ok';
  } catch (err) {
    if (isTokenRejected(err)) return 'rejected';
    // A 403 or 404 still means GitHub took the token: only the repository or a permission is in question.
    if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) return 'ok';
    return undefined;
  }
}
