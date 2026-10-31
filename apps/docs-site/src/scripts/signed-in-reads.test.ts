// @vitest-environment jsdom
// A signed-in viewer's reads never go out to GitHub without their token: an expired sign-in is renewed first, a 401 is
// renewed and read again, a client made before a refresh sends the fresh token. When GitHub's hourly limit is reached
// with the token, the words say the account's limit and when it resets, never "anonymous" nor "Sign in".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Session = typeof import('./github-session');

interface Call {
  url: string;
  method: string;
  auth: string | null;
}

let calls: Call[];
let answer: (url: string, auth: string | null) => Response;

const API = 'https://api.github.com';
const PULLS = `${API}/repos/acme/ds/pulls?state=closed`;
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

/** A GitHub App sign-in saved in this browser (no app attribute on <html>: the plain keys). */
function signIn(expiresInMs: number) {
  localStorage.setItem('bridge.github.token', 'old-token');
  localStorage.setItem('bridge.github.app', JSON.stringify({ kind: 'app', clientId: 'Iv1.test', expiresAt: Date.now() + expiresInMs, refreshToken: 'refresh-1', refreshExpiresAt: Date.now() + 1e9 }));
}

async function load(): Promise<Session> {
  vi.resetModules();
  return import('./github-session');
}

const reads = () => calls.filter((c) => c.url.startsWith(API));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  answer = () => json([]);
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), auth });
    if (url === '/api/github/token') return json({ access_token: 'new-token', expires_in: 28800, refresh_token: 'refresh-2', refresh_token_expires_in: 15897600 });
    return answer(url, auth);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('a signed-in read', () => {
  it('waits for an expired sign-in to be renewed, then carries the fresh token', async () => {
    signIn(-60_000);
    const s = await load();
    await s.ghGet(PULLS);
    expect(calls[0]!.url).toBe('/api/github/token');
    expect(reads().map((c) => c.auth)).toEqual(['Bearer new-token']);
  });

  it('renews after a 401 and reads again with the token, never anonymously', async () => {
    signIn(60 * 60_000);
    answer = (_url, auth) => (auth === 'Bearer old-token' ? json({ message: 'Bad credentials' }, { status: 401 }) : json([]));
    const s = await load();
    await s.ghGet(PULLS);
    expect(reads().map((c) => c.auth)).toEqual(['Bearer old-token', 'Bearer new-token']);
    expect(s.tokenRejected()).toBe(false);
  });

  it('shares one renewal between reads that got a 401 together', async () => {
    signIn(60 * 60_000);
    answer = (_url, auth) => (auth === 'Bearer old-token' ? json({ message: 'Bad credentials' }, { status: 401 }) : json([]));
    const s = await load();
    await Promise.all([s.ghGet(`${PULLS}&a`), s.ghGet(`${PULLS}&b`), s.studioFetch(`${PULLS}&c`, { headers: { Authorization: 'Bearer old-token' } })]);
    expect(calls.filter((c) => c.url === '/api/github/token')).toHaveLength(1);
    expect(reads().filter((c) => c.auth === null)).toEqual([]);
    expect(s.tokenRejected()).toBe(false);
  });

  it('goes out with the current token from a client made before a refresh', async () => {
    signIn(60 * 60_000);
    answer = (_url, auth) => (auth === 'Bearer old-token' ? json({ message: 'Bad credentials' }, { status: 401 }) : json([]));
    const s = await load();
    await s.ghGet(PULLS);
    calls = [];
    // A GitHubClient made earlier still holds the old token in its headers.
    await s.studioFetch(`${API}/repos/acme/ds/pulls/1`, { headers: { Authorization: 'Bearer old-token' } });
    expect(reads().map((c) => c.auth)).toEqual(['Bearer new-token']);
  });

  it('reads anonymously only once the sign-in is really refused, and then says to sign in again', async () => {
    signIn(60 * 60_000);
    localStorage.setItem('bridge.github.app', JSON.stringify({ kind: 'app', expiresAt: Date.now() + 3_600_000, refreshToken: null, refreshExpiresAt: null }));
    answer = (_url, auth) =>
      auth ? json({ message: 'Bad credentials' }, { status: 401 }) : json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000000000' } });
    const s = await load();
    const err = await s.ghGet(PULLS).catch((e: unknown) => e);
    expect(s.tokenRejected()).toBe(true);
    expect(err).toBeInstanceOf(s.RateLimitError);
    const line = s.limitLine(err)!;
    expect(line).toMatch(/sign-in expired|again/i);
    expect(line).not.toMatch(/anonymous/i);
  });
});

describe("GitHub's hourly limit", () => {
  const limited = () => json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 23 * 60) } });

  it('signed in: the account limit and when it resets, never anonymous nor Sign in', async () => {
    signIn(60 * 60_000);
    answer = limited;
    const s = await load();
    const err = (await s.ghGet(PULLS).catch((e: unknown) => e)) as InstanceType<Session['RateLimitError']>;
    expect(err).toBeInstanceOf(s.RateLimitError);
    expect(err.signedIn).toBe(true);
    expect(reads().every((c) => c.auth === 'Bearer old-token')).toBe(true);
    const line = s.limitLine(err, 'Changes added to the library or closed')!;
    expect(line).toMatch(/^Changes added to the library or closed cannot be shown right now: GitHub's hourly limit for your account is reached\. It resets at .+ \(in 23 min\), then reload the page\.$/);
    expect(line).not.toMatch(/anonymous|sign in/i);
  });

  it('signed out: no account line, the caller keeps its anonymous words', async () => {
    answer = limited;
    const s = await load();
    const err = (await s.ghGet(PULLS).catch((e: unknown) => e)) as InstanceType<Session['RateLimitError']>;
    expect(err).toBeInstanceOf(s.RateLimitError);
    expect(err.signedIn).toBe(false);
    expect(s.limitLine(err)).toBeNull();
  });
});
