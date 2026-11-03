// Taking a kept action back after Bridge Direct's OK, with its line (scripts/pending-action.ts, lib/pending-action.ts).
// Kept apart so dialogs load it lazily: it reads whether GitHub gave the OK (scripts/github-session hasDirectOk).
import { resumeLine, type PendingAction, type PendingKind } from '../lib/pending-action';
import { hasDirectOk } from './github-session';
import { takePendingAction } from './pending-action';

export interface Resume {
  action: PendingAction;
  /** GitHub gave the OK (else the person said no or closed GitHub). */
  ok: boolean;
  /** "GitHub gave the OK. Create Atlas now?", or the usual "needed" line when there is no OK. */
  line: string;
}

/** The kept action of this kind on this page, once, with its line. Null when there is none. */
export function takeResume(kinds: PendingKind | readonly PendingKind[] | null): Resume | null {
  const action = takePendingAction(kinds);
  if (!action) return null;
  const ok = hasDirectOk();
  return { action, ok, line: resumeLine(action, ok) };
}

export { armPendingAction, disarmPendingAction } from './pending-action';
