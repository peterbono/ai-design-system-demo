// Studio GitHub session state, pure (no DOM, no storage): what the sidebar account block shows, when the token
// must be checked again, and what a write action says when GitHub refuses the token. The browser glue lives in
// scripts/github-session.ts.
import { GitHubError, missingPermissionMessage, permissionLabel, TOKEN_SETTINGS_URL } from '@bridge-ds/core';

/** none: no token. checking: first check running. connected: GitHub accepts it. rejected: GitHub refused it (401). */
export type SessionState = 'none' | 'checking' | 'connected' | 'rejected';

export interface CheckedViewer {
  login: string;
  avatar_url: string;
  name?: string | null;
}

/**
 * The last token check, kept in localStorage next to the token. `fp` ties it to one token (a short hash, never the
 * token itself) so a replaced token is always checked again.
 */
export interface TokenCheck {
  fp: string;
  /** Epoch ms of the check. */
  at: number;
  ok: boolean;
  viewer?: CheckedViewer | null;
  /** Whether the token may write to the repository, once read. */
  write?: boolean | null;
  /** Signed in with the GitHub App: whether the app reaches the repository for this account, once read. */
  reach?: boolean | null;
}

/** A token is checked again once its last check is older than this (one call per hour at most). */
export const CHECK_MAX_AGE_MS = 60 * 60 * 1000;

/** FNV-1a of the token, hex. Identifies which token a check belongs to without storing it twice. */
export function tokenFingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The stored check, when it belongs to this token. */
export function checkFor(check: TokenCheck | null | undefined, token: string | null): TokenCheck | null {
  if (!token || !check || check.fp !== tokenFingerprint(token)) return null;
  return check;
}

/** True when the token needs a call to GitHub: no check for it yet, or the last one is an hour old. */
export function needsCheck(check: TokenCheck | null | undefined, token: string | null, now: number): boolean {
  if (!token) return false;
  const mine = checkFor(check, token);
  return !mine || now - mine.at >= CHECK_MAX_AGE_MS || now < mine.at;
}

/** What the account block shows. */
export function sessionState(token: string | null, check: TokenCheck | null | undefined): SessionState {
  if (!token) return 'none';
  const mine = checkFor(check, token);
  if (!mine) return 'checking';
  return mine.ok ? 'connected' : 'rejected';
}

export const okCheck = (token: string, viewer: CheckedViewer, now: number, write?: boolean | null): TokenCheck => ({
  fp: tokenFingerprint(token),
  at: now,
  ok: true,
  viewer: { login: viewer.login, avatar_url: viewer.avatar_url, name: viewer.name ?? null },
  ...(write === undefined ? {} : { write }),
});

/** GitHub refused the token (401). The token stays saved, so the account block can say so and offer to replace it. */
export const rejectedCheck = (token: string, now: number): TokenCheck => ({ fp: tokenFingerprint(token), at: now, ok: false, viewer: null });

/** The one message every write action shows once GitHub stops accepting the token. */
export const STUDIO_TOKEN_REJECTED = 'Your GitHub token stopped working. Reconnect GitHub to replace it, then try again.';

/** The same message for a "Sign in with GitHub" session whose refresh failed. */
export const STUDIO_SIGNIN_EXPIRED = 'Your GitHub sign-in expired. Sign in with GitHub again, then try again.';

/** How the browser holds GitHub access: a pasted token, or a GitHub App sign-in. */
export type SessionMode = 'token' | 'app';

/** A signed-in user cannot fix a missing app permission: the repository owner grants it on the GitHub App. */
export function appMissingPermissionMessage(permission: string | undefined, action?: string): string {
  const what = action ? `The Bridge GitHub App cannot ${action} yet.` : 'The Bridge GitHub App is missing a permission for this.';
  if (!permission) return `${what} Ask the repository owner to check its permissions (docs/SIGN-IN.md lists them).`;
  return `${what} Ask the repository owner to give it ${permissionLabel(permission)}: Read and write.`;
}

export interface AuthFailure {
  kind: 'rejected' | 'missing-permission';
  text: string;
  /** Where to fix it on GitHub (missing permission). */
  href?: string;
}

/**
 * The auth part of an error, or null for any other failure. `action` is a verb phrase for the missing permission
 * sentence ("create issues" -> "This token cannot create issues. Add Issues: Read and write on GitHub.").
 */
export function authFailure(err: unknown, action?: string, mode: SessionMode = 'token'): AuthFailure | null {
  if (!(err instanceof GitHubError)) return null;
  if (err.auth === 'rejected') return { kind: 'rejected', text: mode === 'app' ? STUDIO_SIGNIN_EXPIRED : STUDIO_TOKEN_REJECTED };
  if (err.auth === 'missing-permission') {
    return mode === 'app'
      ? { kind: 'missing-permission', text: appMissingPermissionMessage(err.permission, action) }
      : { kind: 'missing-permission', text: missingPermissionMessage(err.permission, action), href: TOKEN_SETTINGS_URL };
  }
  return null;
}

/** Plain text for an error: the auth sentence when it is about the token, else `fallback` (the action's own words). */
export function errorText(err: unknown, fallback: string, action?: string, mode: SessionMode = 'token'): string {
  return authFailure(err, action, mode)?.text ?? fallback;
}
