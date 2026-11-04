// Taking a kept action back after a trip to GitHub, with its line (scripts/pending-action.ts, lib/pending-action.ts).
// Kept apart so dialogs load it lazily: it reads whether this browser is signed in (scripts/github-session).
import { resumeLine, signInNeededLine, type PendingAction, type PendingKind } from '../lib/pending-action';
import { ghAuthFailure, hasWorkingToken } from './github-session';
import { takePendingAction } from './pending-action';

export interface Resume {
  action: PendingAction;
  /** Signed in (else the sign-in did not finish). */
  ok: boolean;
  /** "Back from GitHub. Create Atlas now?", or "Sign in again to finish." without a sign-in. */
  line: string;
}

/** The kept action of this kind on this page, once, with its line. Null when there is none. */
export function takeResume(kinds: PendingKind | readonly PendingKind[] | null): Resume | null {
  const action = takePendingAction(kinds);
  if (!action) return null;
  const ok = hasWorkingToken();
  return { action, ok, line: resumeLine(action, ok) };
}

/** The sign-in sentence when a save stopped because GitHub needs the person to sign in again, else null. */
export function signInLineFor(err: unknown, action?: string): string | null {
  try {
    return signInNeededLine(err, ghAuthFailure(err, action));
  } catch {
    // The session is not there (a test, a page without it): the caller keeps its own words.
    return null;
  }
}

export { armPendingAction, disarmPendingAction } from './pending-action';
