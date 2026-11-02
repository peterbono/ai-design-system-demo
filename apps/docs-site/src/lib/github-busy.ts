// GitHub is busy for the viewer: its hourly read limit ran out (403 or 429 with x-ratelimit-remaining 0, an "API rate
// limit exceeded" answer, or Bridge's own limit in front of GitHub). The one classification every Studio read uses, so
// such an answer is never read as "not found", "empty", "no access" or "Make my copy": it is a wait, with when it ends
// (x-ratelimit-reset). Designer words only: never "rate limit", "API" or "token". Pure: tested in github-busy.test.ts.

/** The time a wait ends, as the viewer's clock shows it ("13:52"). */
export const resetClock = (at: Date): string => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A read GitHub (or Bridge in front of it) refused for now: when it answers again, null when it did not say. */
export interface GitHubBusy {
  resetsAt: Date | null;
  /** 'bridge': Bridge's own limit (its server said so); 'github': the viewer's GitHub account. */
  source: 'github' | 'bridge';
}

/** GitHub's words for its limits (primary and secondary), in a message or an answer's body. */
const LIMIT_WORDS = /rate limit/i;
/** Bridge's own sentence for its limit (api/_lib/team-read.ts READ_WORDS.busy, lib/team-load.ts busyText). */
const BRIDGE_WORDS = /^Bridge is busy/i;

const dateOf = (v: unknown): Date | null => (v instanceof Date && Number.isFinite(v.getTime()) ? v : null);

/**
 * The wait in `err`, or null when it is any other failure. Recognizes core's GitHubError (status 429, or 403 with
 * GitHub's limit words in its message or detail), github-session's RateLimitError (`resetAt`), and Bridge's busy
 * answer. Duck-typed, so it holds for errors from every client and proxy on the page.
 */
export function githubBusy(err: unknown): GitHubBusy | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: unknown; message?: unknown; detail?: unknown; resetsAt?: unknown; resetAt?: unknown; auth?: unknown };
  // A refused sign-in is never a wait: the page offers Sign in again.
  if (e.auth === 'rejected') return null;
  const message = typeof e.message === 'string' ? e.message : '';
  const detail = typeof e.detail === 'string' ? e.detail : '';
  const resetsAt = dateOf(e.resetsAt) ?? dateOf(e.resetAt);
  const limited = e.status === 429 || ((e.status === 403 || e.status === undefined) && (LIMIT_WORDS.test(message) || LIMIT_WORDS.test(detail))) || 'resetAt' in e;
  if (!limited) return null;
  // GitHub's anonymous limit said in Bridge's sentence (github-session busyIfLimited) is still GitHub's.
  const source = detail !== 'rate-limit' && (BRIDGE_WORDS.test(message) || /busy$/.test(detail)) ? 'bridge' : 'github';
  return { resetsAt, source };
}

/** The wait GitHub put on an answer (its status and headers), or null when the answer is not a limit. */
export function busyFromHeaders(status: number, headers: { get(name: string): string | null }, body = ''): GitHubBusy | null {
  if (status !== 403 && status !== 429) return null;
  const limited = status === 429 || headers.get('x-ratelimit-remaining') === '0' || LIMIT_WORDS.test(body);
  if (!limited) return null;
  const reset = Number(headers.get('x-ratelimit-reset'));
  return { resetsAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null, source: 'github' };
}

/**
 * The calm sentence: "GitHub is busy for your account. Bridge is back at 13:52." (the viewer's clock). Signed out,
 * "GitHub is busy right now." Bridge's own limit: "Bridge is busy right now. It is back at 13:52." Unknown reset:
 * "back within the hour"; a reset already past: "back in a moment".
 */
export function busyLine(b: GitHubBusy, opts: { now?: number; signedIn?: boolean } = {}): string {
  const now = opts.now ?? Date.now();
  const at = b.resetsAt;
  const when = !at ? 'within the hour' : at.getTime() <= now + 30_000 ? 'in a moment' : `at ${resetClock(at)}`;
  if (b.source === 'bridge') return `Bridge is busy right now. It is back ${when}.`;
  const head = opts.signedIn === false ? 'GitHub is busy right now.' : 'GitHub is busy for your account.';
  return `${head} Bridge is back ${when}.`;
}

/** The one action of a busy notice. */
export const BUSY_RETRY = 'Try again';

/** Waits between the reset and the one automatic read again: a little after the reset, never sooner than this. */
const MIN_RETRY_MS = 3_000;
const AFTER_RESET_MS = 2_000;
/** Unknown reset: one read again after this. GitHub's window is an hour, so never later than that. */
const UNKNOWN_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 61 * 60_000;

/** How long to wait before the one automatic read again: just after the reset, within [3 s, 61 min]. */
export function busyRetryDelay(b: GitHubBusy, now = Date.now()): number {
  if (!b.resetsAt) return UNKNOWN_RETRY_MS;
  return Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, b.resetsAt.getTime() - now + AFTER_RESET_MS));
}
