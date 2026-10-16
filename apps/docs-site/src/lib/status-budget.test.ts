import { describe, expect, it } from 'vitest';
import { REVIEW_STATUS } from './review-rules';
import { ANON_STATUS_LIMIT, isFresh, planStatusReads, STATUS_TTL_MS, statusCacheKey, type CachedStatus } from './status-budget';

const ready = { kind: 'ready' as const, ...REVIEW_STATUS.ready };
const pulls = [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, head: { sha: `sha${n}` } }));
const now = 1_800_000_000_000;
const none = () => null;

describe('planStatusReads', () => {
  it('without a token reads only the first 3 rows and skips the rest', () => {
    const plan = planStatusReads(pulls, { connected: false, read: none, now });
    expect(ANON_STATUS_LIMIT).toBe(3);
    expect(plan.fetch).toEqual([1, 2, 3]);
    expect(plan.skipped).toEqual([4, 5, 6]);
    expect(plan.cached.size).toBe(0);
  });

  it('with a token reads every row live and ignores the cache', () => {
    const cache = (p: { number: number; head: { sha: string } }): CachedStatus => ({ sha: p.head.sha, at: now, status: ready });
    const plan = planStatusReads(pulls, { connected: true, read: cache, now });
    expect(plan.fetch).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.skipped).toEqual([]);
    expect(plan.cached.size).toBe(0);
  });

  it('reuses a fresh cached status for the same head sha, at no request, on any row', () => {
    const cache = (p: { number: number; head: { sha: string } }) => (p.number === 2 || p.number === 5 ? { sha: p.head.sha, at: now - 60_000, status: ready } : null);
    const plan = planStatusReads(pulls, { connected: false, read: cache, now });
    expect([...plan.cached.keys()]).toEqual([2, 5]);
    expect(plan.fetch).toEqual([1, 3]);
    expect(plan.skipped).toEqual([4, 6]);
  });

  it('reads again when the cached status is 10 minutes old or the head moved', () => {
    const stale = () => ({ sha: 'sha1', at: now - STATUS_TTL_MS, status: ready });
    expect(planStatusReads(pulls.slice(0, 1), { connected: false, read: stale, now }).fetch).toEqual([1]);
    const moved = () => ({ sha: 'old', at: now, status: ready });
    expect(planStatusReads(pulls.slice(0, 1), { connected: false, read: moved, now }).fetch).toEqual([1]);
  });

  it('never plans more than the list request plus 3 status reads per anonymous load', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ number: i, head: { sha: `s${i}` } }));
    const plan = planStatusReads(many, { connected: false, read: none, now });
    expect(plan.fetch.length).toBeLessThanOrEqual(ANON_STATUS_LIMIT);
    expect(plan.fetch.length + plan.skipped.length + plan.cached.size).toBe(40);
  });
});

describe('isFresh and statusCacheKey', () => {
  it('rejects entries from the future, missing entries and other commits', () => {
    expect(isFresh(null, 'a', now)).toBe(false);
    expect(isFresh({ sha: 'a', at: now + 1000, status: ready }, 'a', now)).toBe(false);
    expect(isFresh({ sha: 'b', at: now, status: ready }, 'a', now)).toBe(false);
    expect(isFresh({ sha: 'a', at: now - STATUS_TTL_MS + 1, status: ready }, 'a', now)).toBe(true);
  });
  it('keys by repo, pull request and head sha', () => {
    expect(statusCacheKey('o/r', 12, 'abc')).toBe('bridge.prstatus:o/r#12@abc');
  });
});
