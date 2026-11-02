// Settings, How changes reach your code: how much of GitHub's hourly limit Bridge used for this team, for its admins
// only (components/ds/studio/GitHubUsage.tsx, api/mcp ?view=github-usage, api/_lib/github-quota.ts). Each team's
// organisation has its own limit; Bridge keeps a saved copy of what it read, so a team close to the limit still sees
// its pages. Words and the one sentence rule, pure, so tests read them.

export interface GitHubUsage {
  limit: number;
  used: number;
  remaining: number;
  /** When GitHub resets the hour, in ms. */
  resetAt: number;
  low: boolean;
}

export interface GitHubUsageView {
  usage: GitHubUsage | null;
  /** GitHub asked Bridge to slow down within the last hour: when, in ms. */
  slowedAt: number | null;
}

export const USAGE_WORDS = {
  label: 'GitHub usage',
  meter: 'GitHub reads used this hour',
  none: 'Bridge has not used GitHub for this team this hour.',
  used: (used: string, limit: string, at: string) => `Bridge used ${used} of ${limit} GitHub reads this hour. Resets at ${at}.`,
  low: (at: string) => `Bridge is close to GitHub's hourly limit for this team. Pages may load from the last saved copy until ${at}.`,
  lowCount: (used: string, limit: string) => `${used} of ${limit} reads used.`,
  slowed: (at: string) => `GitHub asked Bridge to slow down at ${at}. Pages may load from the last saved copy for a few minutes.`,
} as const;

/** "14:00", in the viewer's time. */
export const clockOf = (ms: number, locale?: string, timeZone?: string) =>
  new Date(ms).toLocaleTimeString(locale ?? [], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) });

const count = (n: number) => Math.max(0, Math.round(n)).toLocaleString('en-US');

/** A window that already reset is a fresh hour: nothing used yet. */
export function currentUsage(v: GitHubUsageView, now: number): GitHubUsage | null {
  const u = v.usage;
  return u && u.limit > 0 && u.resetAt > now ? u : null;
}

/** The sentence and the help lines of the row, in that order. */
export function usageLines(v: GitHubUsageView, now: number, clock: (ms: number) => string = (ms) => clockOf(ms)): { sentence: string; help: string[]; tone: 'calm' | 'warning' } {
  const u = currentUsage(v, now);
  const slowed = v.slowedAt !== null && now - v.slowedAt < 60 * 60 * 1000 ? USAGE_WORDS.slowed(clock(v.slowedAt)) : null;
  if (!u) return { sentence: USAGE_WORDS.none, help: slowed ? [slowed] : [], tone: slowed ? 'warning' : 'calm' };
  if (u.low) return { sentence: USAGE_WORDS.low(clock(u.resetAt)), help: [USAGE_WORDS.lowCount(count(u.used), count(u.limit)), ...(slowed ? [slowed] : [])], tone: 'warning' };
  return { sentence: USAGE_WORDS.used(count(u.used), count(u.limit), clock(u.resetAt)), help: slowed ? [slowed] : [], tone: slowed ? 'warning' : 'calm' };
}

/** What the page receives, checked (anything else reads as no usage). */
export function parseUsage(x: unknown): GitHubUsageView {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const u = (o.usage && typeof o.usage === 'object' ? o.usage : null) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const usage =
    u && num(u.limit) && num(u.used) !== null && num(u.remaining) !== null && num(u.resetAt)
      ? { limit: u.limit as number, used: u.used as number, remaining: u.remaining as number, resetAt: u.resetAt as number, low: u.low === true }
      : null;
  return { usage, slowedAt: num(o.slowedAt) || null };
}
