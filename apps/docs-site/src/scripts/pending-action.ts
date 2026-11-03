// Keeping what someone was doing across Bridge Direct's OK on GitHub (lib/pending-action.ts has the rules and words).
//
// 1. Right before a write that may ask for the OK, the dialog arms its action (memory only): armPendingAction.
// 2. When Bridge opens "Allow Bridge to save your changes" (scripts/github-session openDirectDialog), the armed action
//    is frozen for that dialog: freezeArmed. Nothing armed: a plain "do it again" (kind 'retry').
// 3. Continue on GitHub keeps the frozen one in this tab's sessionStorage, with the page and the time: keepPendingAction.
// 4. Back on the page, the dialog that owns it takes it once (takePendingAction) and reopens with its values; the
//    Studio shell (components/ds/studio/ResumeAction.tsx) takes the ones nobody claims. Never a token, never a write.
import { ARMED_MAX_AGE_MS, makePendingAction, onPage, parsePendingAction, PENDING_ACTION_KEY, type PendingAction, type PendingKind } from '../lib/pending-action';

type Armed = { kind: PendingKind; values: Record<string, unknown>; at: number };
let armed: Armed | null = null;
let frozen: Armed | null = null;

const here = () => (typeof location === 'undefined' ? '/' : location.pathname + location.search + location.hash);

/** Notes what the person is about to do (call it right before the write). The last one wins. */
export function armPendingAction(kind: PendingKind, values: Record<string, unknown> = {}, now = Date.now()) {
  armed = { kind, values, at: now };
}

/** The write went through (or was given up): nothing to resume. */
export function disarmPendingAction() {
  armed = null;
}

/** The consent dialog opened: the action armed just before is the one it is for (else a plain retry). */
export function freezeArmed(now = Date.now()) {
  frozen = armed && now - armed.at <= ARMED_MAX_AGE_MS ? armed : { kind: 'retry', values: {}, at: now };
  armed = null;
}

/** Continue on GitHub: keeps the frozen action for this page in sessionStorage. False when storage is blocked. */
export function keepPendingAction(now = Date.now(), storage: Storage | null = safeSession()): boolean {
  const a = makePendingAction(frozen?.kind ?? 'retry', frozen?.values ?? {}, here(), now);
  if (!a || !storage) return false;
  try {
    storage.setItem(PENDING_ACTION_KEY, JSON.stringify(a));
    return true;
  } catch {
    return false;
  }
}

/** The kept action for this page, without taking it. Expired or broken ones are dropped. */
export function peekPendingAction(now = Date.now(), storage: Storage | null = safeSession(), url = here()): PendingAction | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_ACTION_KEY);
  } catch {
    return null;
  }
  const a = parsePendingAction(raw, now);
  if (!a) {
    if (raw) clearPendingAction(storage);
    return null;
  }
  return onPage(a, url) ? a : null;
}

/** Takes the kept action of this kind on this page (once: the next call gets null). */
export function takePendingAction(kinds: PendingKind | readonly PendingKind[] | null, now = Date.now(), storage: Storage | null = safeSession(), url = here()): PendingAction | null {
  const a = peekPendingAction(now, storage, url);
  const list = kinds === null ? null : Array.isArray(kinds) ? kinds : [kinds];
  if (!a || (list && !list.includes(a.kind))) return null;
  clearPendingAction(storage);
  return a;
}

export function clearPendingAction(storage: Storage | null = safeSession()) {
  try {
    storage?.removeItem(PENDING_ACTION_KEY);
  } catch {
    /* storage blocked */
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
