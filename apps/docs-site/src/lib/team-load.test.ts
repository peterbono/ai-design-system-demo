import { describe, expect, it } from 'vitest';
import { commitUrl, fileUrl, sourceLine, teamFailure } from './team-load';

const err = (status: number, message = '') => Object.assign(new Error(message), { status });

describe('teamFailure', () => {
  it('names each failure a team page can hit, with a way out', () => {
    expect(teamFailure(err(429, 'GitHub limit reached. Try again after 14:05.'), 'acme/ds')).toMatchObject({ kind: 'rate-limit', body: 'GitHub limit reached. Try again after 14:05.' });
    expect(teamFailure(err(403, 'API rate limit exceeded'), 'acme/ds').kind).toBe('rate-limit');
    expect(teamFailure(err(404), 'acme/ds')).toMatchObject({ kind: 'not-found', title: 'Bridge cannot open Ds' });
    expect(teamFailure(err(413, 'tree too large'), 'acme/ds')).toMatchObject({ kind: 'too-large' });
    expect(teamFailure(err(0), 'acme/ds').kind).toBe('network');
    expect(teamFailure(err(500, 'Server Error'), 'acme/ds')).toMatchObject({ kind: 'unknown', body: 'GitHub answered: Server Error' });
    expect(teamFailure('weird', 'acme/ds').kind).toBe('unknown');
  });

  it('says "You signed out" with a way back in when the session ended in another tab, never the server sentence', () => {
    const f = teamFailure(err(401, 'You signed out. Sign in again with your email: Bridge sends you a code.'), 'acme/ds');
    expect(f).toEqual({ kind: 'signed-out', title: 'You signed out', body: 'Sign in again to open Ds. Bridge sends a code to your email.' });
    expect(`${f.title} ${f.body}`).not.toMatch(/GitHub answered|link/);
  });

  it('never uses an em dash', () => {
    for (const s of [401, 429, 404, 413, 0, 500]) {
      const f = teamFailure(err(s), 'acme/ds');
      expect(`${f.title} ${f.body}`).not.toMatch(/\u2014/);
    }
  });
});

describe('sourceLine and GitHub links', () => {
  it('says where the page was read from', () => {
    const sha = 'a1b2c3d4e5'.padEnd(40, '0');
    expect(sourceLine({ sha, branch: 'main', source: 'snapshot' })).toBe('Read at a1b2c3d on main, from the Bridge snapshot.');
    expect(sourceLine({ sha, branch: 'trunk', source: 'live' })).toBe('Read at a1b2c3d on trunk, live from GitHub.');
    expect(sourceLine({ sha, branch: 'main', source: 'cache' })).toBe('Read at a1b2c3d on main, kept in this browser.');
  });

  it('encodes every path segment', () => {
    expect(commitUrl('acme', 'ds', 'abc')).toBe('https://github.com/acme/ds/commit/abc');
    expect(fileUrl('acme', 'ds', 'abc', 'src/My Button/x?.json')).toBe('https://github.com/acme/ds/blob/abc/src/My%20Button/x%3F.json');
  });
});
