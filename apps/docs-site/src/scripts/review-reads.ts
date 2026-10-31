// The reviews of a few pull requests (GET pulls/{n}/reviews), for the lifecycle's In review words on every page
// (lib/review-state). Only the pull requests that need them are read (needsReviewRead: open explorations handed to
// developers that are no longer drafts, and build requests in review), all at once, and each answer is kept in
// sessionStorage for 5 minutes per pull request version (its last update), so a page load never costs one read per
// row. The GitHub quota is shared with the rest of Studio. A refused read answers null: the page then says less.
import type { PullReviewLike } from '../lib/review-state';
import { ghGet } from './github-session';

const TTL = 5 * 60 * 1000;
const keyOf = (repo: string, number: number, version: string) => `bridge.reviews:${repo.toLowerCase()}#${number}@${version}`;

function cached(key: string): PullReviewLike[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; data: PullReviewLike[] };
    return Date.now() - v.at < TTL && Array.isArray(v.data) ? v.data : null;
  } catch {
    return null;
  }
}

function keep(key: string, data: PullReviewLike[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* private mode or quota: one more read next time */
  }
}

/** Only what the review state reads: who, what they said, when. */
const slim = (r: PullReviewLike): PullReviewLike => ({ user: r.user?.login ? { login: r.user.login } : null, state: r.state, submitted_at: r.submitted_at ?? null });

/** One pull request's reviews, cached per version; null when GitHub could not be read. */
export async function pullReviewsOf(repo: string, number: number, version: string | null | undefined): Promise<PullReviewLike[] | null> {
  const key = keyOf(repo, number, version ?? '');
  const hit = cached(key);
  if (hit) return hit;
  try {
    const f = await ghGet<PullReviewLike[]>(`/repos/${repo}/pulls/${number}/reviews?per_page=100`);
    const data = f.data.map(slim);
    if (!f.stale) keep(key, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * The reviews of several pull requests at once (Promise.all), by the key the caller gives each ("shop#12", "12").
 * Pull requests without a key are not read.
 */
export async function readReviews(items: readonly { key: string; repo: string; number: number; version?: string | null }[]): Promise<Map<string, PullReviewLike[]>> {
  const out = new Map<string, PullReviewLike[]>();
  await Promise.all(
    items.map(async (x) => {
      const r = await pullReviewsOf(x.repo, x.number, x.version);
      if (r) out.set(x.key, r);
    }),
  );
  return out;
}
