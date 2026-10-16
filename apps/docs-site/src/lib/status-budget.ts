// GitHub request budget for pull request status chips. Anonymous visitors share 60 API reads an hour per IP, so a
// list page must not spend them all on one load: without a token it reads the open list once, then the status of
// the first few pull requests, one after the other, and reuses a status for 10 minutes while the head commit is the
// same. Other rows say "Status unknown" and point to Connect GitHub. With a token every row gets its live status.
// Pure decision logic here; scripts/pr-status.ts does the reads and the sessionStorage cache.
import type { ReviewStatus } from './review-rules';

/** Status reads a page may start without a token, after the one list request. */
export const ANON_STATUS_LIMIT = 3;
/** How long a cached status stays valid for the same head commit. */
export const STATUS_TTL_MS = 10 * 60 * 1000;

export interface CachedStatus {
  sha: string;
  at: number;
  status: ReviewStatus;
}

export interface BudgetPull {
  number: number;
  head: { sha: string };
}

export interface StatusPlan {
  /** Rows painted from the cache, with no request. */
  cached: Map<number, ReviewStatus>;
  /** Rows to read from GitHub, in this order. Sequential without a token. */
  fetch: number[];
  /** Rows left without a status: "Status unknown", with a hint to connect GitHub. */
  skipped: number[];
}

/** Cache key of a status: the pull request and its head commit, so a new push never shows an old status. */
export const statusCacheKey = (repo: string, number: number, sha: string) => `bridge.prstatus:${repo}#${number}@${sha}`;

/** True when a cached status belongs to this head commit and is younger than the TTL. */
export function isFresh(entry: CachedStatus | null | undefined, sha: string, now: number, ttl = STATUS_TTL_MS): entry is CachedStatus {
  return Boolean(entry && entry.sha === sha && now - entry.at >= 0 && now - entry.at < ttl);
}

/**
 * Which rows read their status, which reuse a cached one and which go without. `pulls` is in display order: the
 * budget goes to the first rows. With a token everything is read live (the cache is not consulted).
 */
export function planStatusReads<P extends BudgetPull>(
  pulls: P[],
  opts: { connected: boolean; read: (p: P) => CachedStatus | null; now: number; limit?: number; ttl?: number },
): StatusPlan {
  const plan: StatusPlan = { cached: new Map(), fetch: [], skipped: [] };
  if (opts.connected) {
    plan.fetch = pulls.map((p) => p.number);
    return plan;
  }
  const limit = opts.limit ?? ANON_STATUS_LIMIT;
  pulls.forEach((p, i) => {
    const hit = opts.read(p);
    if (isFresh(hit, p.head.sha, opts.now, opts.ttl)) plan.cached.set(p.number, hit.status);
    else if (i < limit) plan.fetch.push(p.number);
    else plan.skipped.push(p.number);
  });
  return plan;
}
