// GitHub quota of each Bridge GitHub App installation: every customer organisation installs the app once and gets its
// own hourly budget per resource (core, graphql, search). Bridge reads it from the x-ratelimit-* headers of the answers
// to calls made with that installation's tokens, so a team's admins see it coming before reads slow down.
//
// How it hooks in: github-app.ts tells this module which installation each token it mints belongs to (memory only, a
// hash of the token, never the token); each function's fetch is wrapped by meteredFetch, which looks at every answer
// from api.github.com sent with such a token. Calls with a person's own GitHub token or the app's JWT are not counted
// here (they spend another budget).
//
// Redis (cheap on purpose):
//   bridge:gh:quota:<installation>:<resource>   JSON { limit, remaining, used, reset, resource, at }, kept until an
//                                              hour after the reset. Written at most once per THROTTLE_MS per
//                                              installation and resource in a warm function, sooner only when the
//                                              window resets or the low state flips; never when nothing changed.
//   bridge:gh:quota:repo:<owner/name>          the installation of a repository (the team's, for Settings), 1 day.
//   bridge:gh:quota:<installation>:secondary   GitHub's secondary rate limit: how many times today (counter), and
//   bridge:gh:quota:<installation>:secondary-at  when last (ms).
//   bridge:gh:quota:warned:<inst>:<res>:<reset> one structured warning per installation, resource and reset window.
// The log lines carry the installation id, the repository and numbers, never a token.

import { createHash } from 'node:crypto';
import type { FetchLike } from './http.js';
import { redisRest, type Redis, type RedisArg } from './redis.js';

/** Under this share of the hourly limit left, the installation is low: one warning, and Settings says so to admins. */
export const LOW_SHARE = 0.2;
/** A warm function writes one installation's numbers at most this often (unless the window resets or it turns low). */
export const THROTTLE_MS = 15 * 1000;
export const REPO_KEEP_S = 24 * 60 * 60;
export const SECONDARY_KEEP_S = 24 * 60 * 60;
/** How long a secondary limit hit is still worth telling an admin about. */
export const SECONDARY_RECENT_MS = 60 * 60 * 1000;

const API = 'https://api.github.com/';
const RESOURCE = /^[a-z][a-z_]{0,39}$/;

export interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  /** When the window resets, in epoch seconds (GitHub's x-ratelimit-reset). */
  reset: number;
  resource: string;
}

export const quotaKey = (installation: number, resource: string) => `bridge:gh:quota:${installation}:${resource}`;
export const quotaRepoKey = (repo: string) => `bridge:gh:quota:repo:${repo.toLowerCase()}`;
export const secondaryKey = (installation: number) => `bridge:gh:quota:${installation}:secondary`;
export const secondaryAtKey = (installation: number) => `bridge:gh:quota:${installation}:secondary-at`;
export const warnedKey = (installation: number, resource: string, reset: number) => `bridge:gh:quota:warned:${installation}:${resource}:${reset}`;

const whole = (v: string | null): number | null => {
  if (v === null || !/^\d{1,12}$/.test(v.trim())) return null;
  return Number(v.trim());
};

/** The x-ratelimit-* headers of a GitHub answer, or null when they are missing or not numbers. */
export function rateLimitOf(headers: Headers): RateLimit | null {
  const limit = whole(headers.get('x-ratelimit-limit'));
  const remaining = whole(headers.get('x-ratelimit-remaining'));
  const reset = whole(headers.get('x-ratelimit-reset'));
  if (limit === null || remaining === null || reset === null || limit === 0) return null;
  const used = whole(headers.get('x-ratelimit-used')) ?? Math.max(0, limit - remaining);
  const r = (headers.get('x-ratelimit-resource') ?? 'core').trim().toLowerCase();
  return { limit, remaining, used, reset, resource: RESOURCE.test(r) ? r : 'core' };
}

/** Under LOW_SHARE of the limit left. */
export const isLow = (r: Pick<RateLimit, 'limit' | 'remaining'>) => r.limit > 0 && r.remaining < r.limit * LOW_SHARE;

/**
 * GitHub's secondary rate limit (too many calls at once, or too fast), told apart from the hourly one running out: a
 * 403 or 429 with Retry-After, or saying "secondary rate limit", while the hourly budget is not at zero.
 */
export async function isSecondaryLimit(res: Response): Promise<boolean> {
  if (res.status !== 403 && res.status !== 429) return false;
  if (res.headers.get('x-ratelimit-remaining')?.trim() === '0') return false;
  if (res.headers.get('retry-after')) return true;
  const text = await res.clone().text().catch(() => '');
  return /secondary rate limit/i.test(text.slice(0, 4000));
}

// ---------------------------------------------------------------------------------------------------------------
// Which installation a token belongs to (memory of this function only)

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 32);
const tokens = new Map<string, { installation: number; repo: string; until: number }>();
/** Installation tokens live an hour. */
const TOKEN_LIFE_MS = 60 * 60 * 1000;

/** github-app.ts, on each token it mints: which installation and repository it is for. */
export function noteInstallationToken(token: string, installation: number, repo: string, now: number): void {
  if (!Number.isSafeInteger(installation) || installation <= 0) return;
  if (tokens.size > 500) for (const [k, v] of tokens) if (v.until <= now) tokens.delete(k);
  tokens.set(tokenHash(token), { installation, repo: repo.toLowerCase(), until: now + TOKEN_LIFE_MS });
}

export function installationOfToken(token: string, now: number): { installation: number; repo: string } | null {
  const hit = tokens.get(tokenHash(token));
  return hit && hit.until > now ? { installation: hit.installation, repo: hit.repo } : null;
}

/** Tests. */
export const clearInstallationTokens = () => tokens.clear();

// ---------------------------------------------------------------------------------------------------------------
// The meter

export interface QuotaLog {
  warn(line: string): void;
}

export interface QuotaMeter {
  /** Records what one GitHub answer says of its installation's budget. Never throws. */
  observe(who: { installation: number; repo: string }, res: Response): Promise<void>;
}

export function quotaMeter(redis: Redis, o: { now?: () => number; log?: QuotaLog; throttleMs?: number } = {}): QuotaMeter {
  const now = o.now ?? Date.now;
  const log = o.log ?? { warn: (line: string) => console.warn(line) };
  const throttle = o.throttleMs ?? THROTTLE_MS;
  const last = new Map<string, RateLimit & { at: number; low: boolean }>();
  const repoAt = new Map<string, number>();
  const warned = new Set<string>();
  const slowedLogAt = new Map<number, number>();

  return {
    async observe(who, res) {
      try {
        const t = now();
        const writes: RedisArg[][] = [];
        const rl = rateLimitOf(res.headers);
        let warn: string | null = null;
        if (rl) {
          const k = `${who.installation}:${rl.resource}`;
          const prev = last.get(k);
          const low = isLow(rl);
          const changed = !prev || prev.limit !== rl.limit || prev.remaining !== rl.remaining || prev.used !== rl.used;
          const due = !prev || prev.reset !== rl.reset || prev.low !== low || (changed && t - prev.at >= throttle);
          if (due) {
            const ttl = Math.min(3 * 60 * 60, Math.max(60, rl.reset - Math.floor(t / 1000) + 60 * 60));
            writes.push(['SET', quotaKey(who.installation, rl.resource), JSON.stringify({ ...rl, at: t }), 'EX', ttl]);
            last.set(k, { ...rl, at: t, low });
            if (last.size > 2000) last.delete(last.keys().next().value!);
          }
          const rk = who.repo;
          if (t - (repoAt.get(rk) ?? -Infinity) >= 60 * 60 * 1000) {
            writes.push(['SET', quotaRepoKey(rk), String(who.installation), 'EX', REPO_KEEP_S]);
            repoAt.set(rk, t);
          }
          if (low) {
            const wk = warnedKey(who.installation, rl.resource, rl.reset);
            if (!warned.has(wk)) {
              warned.add(wk);
              if (warned.size > 2000) warned.delete(warned.values().next().value!);
              warn = wk;
            }
          }
        }
        const slowed = await isSecondaryLimit(res);
        if (slowed) writes.push(['INCRBY', secondaryKey(who.installation), 1], ['EXPIRE', secondaryKey(who.installation), SECONDARY_KEEP_S], ['SET', secondaryAtKey(who.installation), String(t), 'EX', SECONDARY_KEEP_S]);
        if (warn && rl) {
          // One line per installation, resource and window, across every warm function (SET NX).
          const ttl = Math.max(60, rl.reset - Math.floor(t / 1000) + 60);
          writes.push(['SET', warn, '1', 'NX', 'EX', ttl]);
        }
        if (!writes.length) return;
        const out = await redis.pipe(writes);
        if (warn && rl && out[out.length - 1] === 'OK') {
          log.warn(JSON.stringify({ event: 'github_quota_low', installation: who.installation, repo: who.repo, resource: rl.resource, limit: rl.limit, remaining: rl.remaining, used: rl.used, resetAt: new Date(rl.reset * 1000).toISOString() }));
        }
        if (slowed && t - (slowedLogAt.get(who.installation) ?? -Infinity) >= 60 * 1000) {
          slowedLogAt.set(who.installation, t);
          log.warn(JSON.stringify({ event: 'github_secondary_limit', installation: who.installation, repo: who.repo, status: res.status, retryAfter: res.headers.get('retry-after') }));
        }
      } catch {
        /* Monitoring never breaks a read. */
      }
    },
  };
}

const authOf = (headers: Record<string, string>) => {
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === 'authorization') return /^(?:Bearer|token)\s+(\S+)$/i.exec(v)?.[1] ?? null;
  return null;
};

/** `f`, with every answer from api.github.com sent with an installation token shown to the meter. */
export function meteredFetch(f: FetchLike, meter: QuotaMeter | (() => QuotaMeter | null) | null, now: () => number = Date.now): FetchLike {
  return async (url, init) => {
    const res = await f(url, init);
    if (!url.startsWith(API)) return res;
    const token = authOf(init.headers ?? {});
    const who = token ? installationOfToken(token, now()) : null;
    const m = typeof meter === 'function' ? meter() : meter;
    if (who && m) await m.observe(who, res);
    return res;
  };
}

/** The fetch of a Vercel function: the platform's, metered into the KV store of the env when there is one. */
export function meteredFromEnv(env: Record<string, string | undefined> = process.env): FetchLike {
  const raw: FetchLike = (url, init) => fetch(url, init);
  let meter: QuotaMeter | null | undefined;
  return meteredFetch(raw, () => {
    if (meter !== undefined) return meter;
    const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
    const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
    meter = url && token ? quotaMeter(redisRest(url, token, raw, 'storage')) : null;
    return meter;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Reading it back (Settings, admins only: api/mcp ?view=github-usage)

export interface GitHubUsage {
  /** The budget that matters now: the lowest share left among the current windows, else core. */
  resource: string;
  limit: number;
  used: number;
  remaining: number;
  /** When it resets, in ms. */
  resetAt: number;
  low: boolean;
}

export interface GitHubUsageView {
  /** Null: Bridge has not used GitHub for this team in the current hour. */
  usage: GitHubUsage | null;
  /** GitHub asked Bridge to slow down within the last hour: when, in ms. */
  slowedAt: number | null;
}

const parseKept = (v: unknown): RateLimit | null => {
  if (typeof v !== 'string') return null;
  try {
    const x = JSON.parse(v) as Partial<RateLimit>;
    const ok = [x.limit, x.remaining, x.used, x.reset].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) && typeof x.resource === 'string';
    return ok && x.limit! > 0 ? { limit: x.limit!, remaining: x.remaining!, used: x.used!, reset: x.reset!, resource: x.resource! } : null;
  } catch {
    return null;
  }
};

export const USAGE_RESOURCES = ['core', 'graphql', 'search'] as const;

/** What Settings shows of the team repository's installation. A window that already reset counts as unused. */
export async function readUsage(redis: Redis, repo: string, now: number): Promise<GitHubUsageView> {
  const id = Number(await redis.cmd('GET', quotaRepoKey(repo)));
  if (!Number.isSafeInteger(id) || id <= 0) return { usage: null, slowedAt: null };
  const keys = [...USAGE_RESOURCES.map((r) => quotaKey(id, r)), secondaryAtKey(id)];
  const vals = (await redis.cmd('MGET', ...keys)) as unknown[];
  const current = USAGE_RESOURCES.map((_, i) => parseKept(vals[i])).filter((r): r is RateLimit => r !== null && r.reset * 1000 > now);
  const share = (r: RateLimit) => r.remaining / r.limit;
  const pick = current.filter(isLow).sort((a, b) => share(a) - share(b))[0] ?? current.find((r) => r.resource === 'core') ?? null;
  const at = Number(vals[USAGE_RESOURCES.length]);
  const slowedAt = Number.isFinite(at) && at > 0 && now - at < SECONDARY_RECENT_MS ? at : null;
  return {
    usage: pick ? { resource: pick.resource, limit: pick.limit, used: Math.min(pick.used, pick.limit), remaining: pick.remaining, resetAt: pick.reset * 1000, low: isLow(pick) } : null,
    slowedAt,
  };
}
