// Keeping what someone was doing across a trip to GitHub and back (lib/pending-action.ts has the rules and words).
//
// 1. Right before a save, the dialog arms its action (memory only): armPendingAction. A save that went through
//    disarms it.
// 2. Sign in (again) keeps the action armed in the last few minutes, with this page and the time
//    (scripts/github-session startSignIn: keepPendingAction). Nothing armed: nothing kept, a plain sign-in.
//    Add a product's Install on GitHub keeps its step at once (keepAction): GitHub's access page may come back in
//    another tab, whose "Back to Studio" returns to this page (keptActionUrl).
// 3. Back on the page, the dialog that owns it takes it once (takePendingAction) and reopens with its values; the
//    Studio shell (components/ds/studio/ResumeAction.tsx) takes the ones nobody claims. Never a token, never a write.
import { ARMED_MAX_AGE_MS, makePendingAction, onPage, parsePendingAction, PENDING_ACTION_KEY, type PendingAction, type PendingKind } from '../lib/pending-action';

type Armed = { kind: PendingKind; values: Record<string, unknown>; at: number };
let armed: Armed | null = null;

const here = () => (typeof location === 'undefined' ? '/' : location.pathname + location.search + location.hash);

/** Notes what the person is about to do (call it right before the save). The last one wins. */
export function armPendingAction(kind: PendingKind, values: Record<string, unknown> = {}, now = Date.now()) {
  armed = { kind, values, at: now };
}

/** The save went through (or was given up): nothing to resume. */
export function disarmPendingAction() {
  armed = null;
}

/** Leaving for GitHub's sign-in: keeps the action armed in the last few minutes for this page. False when none. */
export function keepPendingAction(now = Date.now(), storage: Storage | null = safeLocal()): boolean {
  const a = armed && now - armed.at <= ARMED_MAX_AGE_MS ? armed : null;
  armed = null;
  return a ? keepAction(a.kind, a.values, now, storage) : false;
}

/** Keeps this action for this page now (Add a product before GitHub's access page). False when storage is blocked. */
export function keepAction(kind: PendingKind, values: Record<string, unknown> = {}, now = Date.now(), storage: Storage | null = safeLocal()): boolean {
  const a = makePendingAction(kind, values, here(), now);
  if (!a || !storage) return false;
  try {
    storage.setItem(PENDING_ACTION_KEY, JSON.stringify(a));
    return true;
  } catch {
    return false;
  }
}

/** The kept action, whatever the page. Expired or broken ones are dropped. */
function readKept(now: number, storage: Storage | null): PendingAction | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_ACTION_KEY);
  } catch {
    return null;
  }
  const a = parsePendingAction(raw, now);
  if (!a && raw) clearPendingAction(storage);
  return a;
}

/** The kept action for this page, without taking it. */
export function peekPendingAction(now = Date.now(), storage: Storage | null = safeLocal(), url = here()): PendingAction | null {
  const a = readKept(now, storage);
  return a && onPage(a, url) ? a : null;
}

/** The page a kept action waits on (GitHub's access page sends "Back to Studio" there). Null when none. */
export function keptActionUrl(now = Date.now(), storage: Storage | null = safeLocal()): string | null {
  return readKept(now, storage)?.url ?? null;
}

/** Takes the kept action of this kind on this page (once: the next call gets null). */
export function takePendingAction(kinds: PendingKind | readonly PendingKind[] | null, now = Date.now(), storage: Storage | null = safeLocal(), url = here()): PendingAction | null {
  const a = peekPendingAction(now, storage, url);
  const list = kinds === null ? null : Array.isArray(kinds) ? kinds : [kinds];
  if (!a || (list && !list.includes(a.kind))) return null;
  clearPendingAction(storage);
  return a;
}

/** Forgets a kept action of this kind (the dialog finished it where it was), leaving any other one alone. */
export function forgetAction(kind: PendingKind, now = Date.now(), storage: Storage | null = safeLocal()) {
  if (readKept(now, storage)?.kind === kind) clearPendingAction(storage);
}

export function clearPendingAction(storage: Storage | null = safeLocal()) {
  try {
    storage?.removeItem(PENDING_ACTION_KEY);
  } catch {
    /* storage blocked */
  }
}

function safeLocal(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
