import { describe, expect, it } from 'vitest';
import { GitHubError } from '@bridge-ds/core';
import { busyFromHeaders, busyLine, busyRetryDelay, githubBusy, resetClock } from './github-busy';

const NOW = Date.parse('2026-11-02T12:30:00Z');
const AT = new Date('2026-11-02T12:52:00Z');
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

describe('githubBusy: one classification of a busy GitHub', () => {
  it('reads core’s hourly limit (429 with the reset) as a wait, with when it ends', () => {
    expect(githubBusy(new GitHubError(429, 'GitHub limit reached', 'API rate limit exceeded', { resetsAt: AT }))).toEqual({ resetsAt: AT, source: 'github' });
  });

  it('reads a 403 in GitHub’s limit words as a wait, even without the reset header', () => {
    expect(githubBusy(new GitHubError(403, 'GitHub is limiting requests right now.', 'API rate limit exceeded for user ID 1.'))).toEqual({ resetsAt: null, source: 'github' });
    expect(githubBusy(new GitHubError(403, 'You have exceeded a secondary rate limit.'))).toEqual({ resetsAt: null, source: 'github' });
  });

  it('reads the Studio’s RateLimitError (resetAt) as a wait', () => {
    const err = Object.assign(new Error('GitHub rate limit reached'), { resetAt: AT, signedIn: true });
    expect(githubBusy(err)).toEqual({ resetsAt: AT, source: 'github' });
    expect(githubBusy(Object.assign(new Error('GitHub rate limit reached'), { resetAt: null }))).toEqual({ resetsAt: null, source: 'github' });
  });

  it('tells Bridge’s own limit from GitHub’s', () => {
    const bridge = new GitHubError(429, 'Bridge is busy, try again in 3 min.', 'contribute:busy', { resetsAt: AT });
    expect(githubBusy(bridge)?.source).toBe('bridge');
    // GitHub's anonymous limit said in Bridge's sentence is still GitHub's.
    expect(githubBusy(new GitHubError(429, 'Bridge is busy, try again in 3 min.', 'rate-limit', { resetsAt: AT }))?.source).toBe('github');
  });

  it('never reads a missing repository, a refused permission, a refused sign-in or a network error as busy', () => {
    expect(githubBusy(new GitHubError(404, 'Not Found'))).toBeNull();
    expect(githubBusy(new GitHubError(403, 'Resource not accessible by integration', 'Resource not accessible by integration', { auth: 'missing-permission' }))).toBeNull();
    expect(githubBusy(new GitHubError(401, 'Bad credentials', 'Bad credentials', { auth: 'rejected' }))).toBeNull();
    expect(githubBusy(new GitHubError(0, 'Could not reach GitHub.'))).toBeNull();
    expect(githubBusy(new TypeError('Failed to fetch'))).toBeNull();
    expect(githubBusy(null)).toBeNull();
  });

  it('reads an answer’s status and headers', () => {
    expect(busyFromHeaders(403, headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(AT.getTime() / 1000) }))).toEqual({ resetsAt: AT, source: 'github' });
    expect(busyFromHeaders(403, headers({}), '{"message":"API rate limit exceeded"}')).toEqual({ resetsAt: null, source: 'github' });
    expect(busyFromHeaders(403, headers({ 'x-ratelimit-remaining': '12' }), '{"message":"Must have admin rights"}')).toBeNull();
    expect(busyFromHeaders(404, headers({ 'x-ratelimit-remaining': '0' }))).toBeNull();
  });
});

describe('busyLine: the calm sentence, in designer words', () => {
  it('says when Bridge is back on the viewer’s clock, never "rate limit" nor "API"', () => {
    const line = busyLine({ resetsAt: AT, source: 'github' }, { now: NOW });
    expect(line).toBe(`GitHub is busy for your account. Bridge is back at ${resetClock(AT)}.`);
    expect(line).not.toMatch(/rate limit|API|token|\u2014/i);
  });

  it('without a reset, past it, signed out, and for Bridge’s own limit', () => {
    expect(busyLine({ resetsAt: null, source: 'github' }, { now: NOW })).toBe('GitHub is busy for your account. Bridge is back within the hour.');
    expect(busyLine({ resetsAt: new Date(NOW - 1000), source: 'github' }, { now: NOW })).toBe('GitHub is busy for your account. Bridge is back in a moment.');
    expect(busyLine({ resetsAt: AT, source: 'github' }, { now: NOW, signedIn: false })).toBe(`GitHub is busy right now. Bridge is back at ${resetClock(AT)}.`);
    expect(busyLine({ resetsAt: AT, source: 'bridge' }, { now: NOW })).toBe(`Bridge is busy right now. It is back at ${resetClock(AT)}.`);
  });

  it('reads again once just after the reset, within sane bounds', () => {
    expect(busyRetryDelay({ resetsAt: AT, source: 'github' }, NOW)).toBe(22 * 60_000 + 2_000);
    expect(busyRetryDelay({ resetsAt: new Date(NOW - 60_000), source: 'github' }, NOW)).toBe(3_000);
    expect(busyRetryDelay({ resetsAt: new Date(NOW + 5 * 3600_000), source: 'github' }, NOW)).toBe(61 * 60_000);
    expect(busyRetryDelay({ resetsAt: null, source: 'github' }, NOW)).toBe(5 * 60_000);
  });
});
