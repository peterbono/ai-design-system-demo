// The action someone was doing when Bridge had to send them to GitHub for Bridge Direct's OK (a team in direct mode,
// gh-wording DIRECT_CONSENT). Kept in this tab's sessionStorage until they come back, so Studio reopens the same dialog
// at the same step with what they typed, the primary button focused and one line: "GitHub gave the OK. Create Atlas
// now?". Never a token, never a write on its own: the person clicks. Storage and timing: scripts/pending-action.ts.
import { DIRECT_CONSENT } from './gh-wording';

/** sessionStorage key (this tab only). */
export const PENDING_ACTION_KEY = 'bridge.pending-action';
/** Older than this, it is dropped: the person moved on. */
export const PENDING_ACTION_MAX_AGE_MS = 15 * 60_000;
/** An action armed longer ago than this is not the one that asked for the OK (scripts/pending-action freezeArmed). */
export const ARMED_MAX_AGE_MS = 60_000;

/**
 * What was being done. `retry`: any other write (values.label, a verb phrase such as "send the new team name", or
 * nothing): Studio only says the OK is there and asks to do it again.
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

/** A same-site path only (never another site, never the sign-in callback). */
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

/**
 * The line over the reopened dialog. `ok`: GitHub gave the OK (Bridge Direct's token is saved); else the person said
 * no or closed GitHub, and the usual "needed" line says what to do.
 */
export function resumeLine(action: Pick<PendingAction, 'kind' | 'values'>, ok: boolean): string {
  if (!ok) return DIRECT_CONSENT.needed;
  const v = action.values;
  const name = text(v.name);
  switch (action.kind) {
    case 'new-product':
      return name ? `GitHub gave the OK. Create ${name} now?` : 'GitHub gave the OK. Create the product now?';
    case 'add-product':
      return name ? `GitHub gave the OK. Add ${name} now?` : 'GitHub gave the OK. Add the product now?';
    case 'start-exploration':
      return 'GitHub gave the OK. Start this exploration now?';
    case 'rename-product':
      return text(v.to) ? `GitHub gave the OK. Rename it to ${text(v.to)} now?` : 'GitHub gave the OK. Save the new name now?';
    case 'remove-product':
      return name ? `GitHub gave the OK. Remove ${name} from Bridge now?` : 'GitHub gave the OK. Remove it from Bridge now?';
    case 'new-brand':
      return name ? `GitHub gave the OK. Send ${name} for review now?` : 'GitHub gave the OK. Send the brand for review now?';
    case 'retry':
    default:
      return text(v.label) ? `GitHub gave the OK. You can ${text(v.label)} now.` : 'GitHub gave the OK. Bridge can save your changes now: do it again to finish.';
  }
}

/**
 * The line to show when a write stopped to wait for Bridge Direct (its OK, or its setup on the repository): the
 * error's own sentence, which the consent dialog explains. Null for any other error.
 */
export function directWaitLine(err: unknown): string | null {
  const e = err as { detail?: unknown; message?: unknown } | null;
  return e && (e.detail === 'direct-consent' || e.detail === 'direct-not-installed') && typeof e.message === 'string' ? e.message : null;
}
