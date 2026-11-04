// The action someone was doing when Bridge sent them to GitHub and back: a sign-in (Sign in again after the sign-in
// expired), or Add a product's Install on GitHub / Give Bridge access. Kept in this browser until they come back, so
// Studio reopens the same dialog at the same step with what they typed, the primary button focused and one line:
// "Back from GitHub. Create Atlas now?". Never a token, never a write on its own: the person clicks.
// Storage and timing: scripts/pending-action.ts.

/** localStorage key: GitHub's access page may come back in another tab (pages/studio/auth/access.astro). */
export const PENDING_ACTION_KEY = 'bridge.pending-action';
/** Older than this, it is dropped: the person moved on. */
export const PENDING_ACTION_MAX_AGE_MS = 15 * 60_000;
/** An action armed longer ago than this is not the one the sign-in is for (scripts/pending-action keepPendingAction). */
export const ARMED_MAX_AGE_MS = 5 * 60_000;

/**
 * What was being done. `retry`: any other save (values.label, a verb phrase such as "send the new team name", or
 * nothing): Studio only says to do it again.
 */
export type PendingKind = 'new-product' | 'add-product' | 'start-exploration' | 'rename-product' | 'remove-product' | 'new-brand' | 'retry';
const KINDS: readonly PendingKind[] = ['new-product', 'add-product', 'start-exploration', 'rename-product', 'remove-product', 'new-brand', 'retry'];

export type PendingValues = Record<string, string | number | boolean | null>;

export interface PendingAction {
  kind: PendingKind;
  /** The form's values: plain text, numbers and switches only. */
  values: PendingValues;
  /** The page it was on (path, search and hash). */
  url: string;
  /** Epoch ms when it was kept. */
  at: number;
}

const MAX_KEYS = 20;
const MAX_TEXT = 2000;
/** Never kept, whatever a caller passes: anything that looks like a credential. */
const SECRET = /token|secret|password|verifier|bearer|credential/i;

/** Plain values only: no objects, no long text, no credential-looking keys. */
export function cleanValues(values: Record<string, unknown> | null | undefined): PendingValues {
  const out: PendingValues = {};
  if (!values || typeof values !== 'object') return out;
  for (const [k, v] of Object.entries(values)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (SECRET.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, MAX_TEXT);
    else if (typeof v === 'boolean' || v === null || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/** A same-site path only (never another site). */
function safeUrl(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : null;
}

export function makePendingAction(kind: PendingKind, values: Record<string, unknown> | null | undefined, url: string, now: number): PendingAction | null {
  const u = safeUrl(url);
  return u && KINDS.includes(kind) ? { kind, values: cleanValues(values), url: u, at: now } : null;
}

/** Reads a kept action; null when missing, broken, expired or from the future. */
export function parsePendingAction(raw: string | null | undefined, now: number): PendingAction | null {
  if (!raw) return null;
  let v: Partial<PendingAction> | null;
  try {
    v = JSON.parse(raw) as Partial<PendingAction>;
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || typeof v.at !== 'number' || !KINDS.includes(v.kind as PendingKind)) return null;
  if (now - v.at > PENDING_ACTION_MAX_AGE_MS || v.at > now + 60_000) return null;
  const url = safeUrl(v.url);
  if (!url) return null;
  return { kind: v.kind as PendingKind, values: cleanValues(v.values as Record<string, unknown>), url, at: v.at };
}

const pathOf = (url: string) => {
  const p = url.split('#')[0]!;
  const [path, search = ''] = p.split('?');
  return `${path!.replace(/\/+$/, '') || '/'}${search ? `?${search}` : ''}`;
};

/** True when the action was kept on this page (path and search; the hash and a trailing slash do not count). */
export function onPage(action: Pick<PendingAction, 'url'>, here: string): boolean {
  return pathOf(action.url) === pathOf(here);
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The line when they came back without a working sign-in (they cancelled on GitHub). */
export const SIGN_IN_TO_FINISH = 'Sign in again to finish.';

/**
 * The line over the reopened dialog. `ok`: they are signed in; else the sign-in did not finish and the line says what
 * to do.
 */
export function resumeLine(action: Pick<PendingAction, 'kind' | 'values'>, ok: boolean): string {
  if (!ok) return SIGN_IN_TO_FINISH;
  const v = action.values;
  const name = text(v.name);
  switch (action.kind) {
    case 'new-product':
      return name ? `Back from GitHub. Create ${name} now?` : 'Back from GitHub. Create the product now?';
    case 'add-product':
      return name ? `Back from GitHub. Add ${name} now?` : 'Back from GitHub. Pick your product to add it.';
    case 'start-exploration':
      return 'Back from GitHub. Start this exploration now?';
    case 'rename-product':
      return text(v.to) ? `Back from GitHub. Rename it to ${text(v.to)} now?` : 'Back from GitHub. Save the new name now?';
    case 'remove-product':
      return name ? `Back from GitHub. Remove ${name} from Bridge now?` : 'Back from GitHub. Remove it from Bridge now?';
    case 'new-brand':
      return name ? `Back from GitHub. Send ${name} for review now?` : 'Back from GitHub. Send the brand for review now?';
    case 'retry':
    default:
      return text(v.label) ? `Back from GitHub. You can ${text(v.label)} now.` : 'Back from GitHub. Do it again to finish.';
  }
}

/**
 * The line for a save that stopped because GitHub needs the person to sign in (again): the sign-in sentence, never
 * "Ask an owner" or a generic refusal, since signing in fixes it. `auth`: the error's auth part (ghAuthFailure).
 * Null for any other error.
 */
export function signInNeededLine(err: unknown, auth: { kind: string; text: string } | null | undefined): string | null {
  if (auth?.kind === 'rejected') return auth.text;
  const e = err as { status?: unknown; detail?: unknown; message?: unknown } | null;
  return e && e.status === 401 && e.detail === 'no-token' && typeof e.message === 'string' ? e.message : null;
}
