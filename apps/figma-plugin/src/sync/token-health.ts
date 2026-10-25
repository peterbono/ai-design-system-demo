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

/** What Bridge was doing when a permission was missing, by permission: the verb phrase of the message. */
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

/** Said for a failure that is not a sentence for a designer (a crash, a parse error): what to do, the error as detail. */
export const UNEXPECTED_ERROR = 'Something went wrong in Bridge. Try again, and if it keeps happening, report it with the details.';

/**
 * A failure as a designer reads it, and the raw error for a "Details" fold. A token or permission problem keeps its
 * sentence; GitHub errors already say what happened and what to do; a plain Error is one of Bridge's own sentences.
 * Anything else (a TypeError, a JSON parse error, a string) is not written for people: one sentence, the rest as detail.
 */
/** No network: one calm sentence, no details. The plugin tries again by itself once the connection is back. */
export const OFFLINE_TEXT = "You're offline. Bridge will try again when you're back.";

/** The request never reached GitHub (no network): the client's status 0, or the browser's own fetch failure. */
export function isOffline(err: unknown): boolean {
  if (err instanceof GitHubError) return err.status === 0;
  return err instanceof TypeError && /failed to fetch|network|load failed/i.test(err.message);
}

export function friendlyError(err: unknown): { text: string; detail?: string | undefined } {
  const p = tokenProblem(err);
  if (p) return { text: p.text };
  if (isOffline(err)) return { text: OFFLINE_TEXT };
  if (err instanceof GitHubError) return { text: err.message, ...(err.detail && /\s/.test(err.detail) && err.detail !== err.message ? { detail: err.detail } : {}) };
  if (err instanceof Error && err.constructor === Error && err.message) return { text: err.message };
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { text: UNEXPECTED_ERROR, ...(raw ? { detail: raw } : {}) };
}

/** The message for a failure shown inline: the permission sentence, a GitHub sentence, or Bridge's own. */
export function errorText(err: unknown): string {
  return friendlyError(err).text;
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
      ? 'Bridge could not compare your Figma components with the design system. Variables still update as usual. Check again, and if it keeps failing, update Bridge and report it with the details below.'
      : 'Bridge could not read your Figma components. Variables still send as usual. Scan again, and if it keeps failing, update Bridge and report it with the details below.';
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
