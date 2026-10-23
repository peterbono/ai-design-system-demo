import { describe, expect, it } from 'vitest';
import { ACCOUNT_WORDS, accountErrorText, accountName, codeDigits, defaultNext, needsGitHub, parseAccount, readSignInQuery, roleWord, safeNext, signInHref, type Account } from './account';

const acct = (over: Partial<Account> = {}): Account => ({ email: 'leo@acme.design', name: 'Leo', github: null, teams: [], ...over });

describe('accounts, rules and words', () => {
  it('reads an account from the server and drops what is not one', () => {
    expect(parseAccount(null)).toBeNull();
    expect(parseAccount({ name: 'x' })).toBeNull();
    expect(
      parseAccount({
        email: 'leo@acme.design',
        name: '',
        github: { login: 'leo', id: 7 },
        teams: [{ repo: 'acme/ds', name: 'Acme', role: 'admin', via: 'github' }, { repo: 'nope' }, null],
        secret: 'x',
      }),
    ).toEqual({ email: 'leo@acme.design', name: null, nameSet: false, github: { login: 'leo', id: 7 }, teams: [{ repo: 'acme/ds', name: 'Acme', role: 'admin', via: 'github' }] });
  });

  it('only goes on to a same-site page, never back to the sign-in screen or the GitHub callback', () => {
    expect(safeNext('/studio/acme/ds/?pr=3')).toBe('/studio/acme/ds/?pr=3');
    for (const bad of ['https://evil.example/', '//evil.example/', '/\\evil', '/signin/?next=/x', '/studio/auth/callback/', '', null]) expect(safeNext(bad)).toBeNull();
  });

  it('builds the sign-in address, with sign-up words from Get started, and reads it back', () => {
    expect(signInHref()).toBe('/signin/');
    expect(signInHref(null, true)).toBe('/signin/?new=1');
    expect(signInHref('/studio/acme/ds/tokens/')).toBe('/signin/?next=%2Fstudio%2Facme%2Fds%2Ftokens%2F');
    expect(signInHref('https://evil.example/')).toBe('/signin/');
    expect(readSignInQuery('?new=1&next=%2Fstudio%2Facme%2Fds%2F')).toEqual({ fresh: true, next: '/studio/acme/ds/' });
    expect(readSignInQuery('?next=https://evil.example')).toEqual({ fresh: false, next: null });
  });

  it('sends a signed-in person to their most recent team, else their first, else How do you want to start?', () => {
    const teams = [
      { repo: 'acme/ds', name: null, role: 'edit', via: 'email' },
      { repo: 'acme/web', name: null, role: 'admin', via: 'github' },
    ];
    expect(defaultNext(acct())).toBe('/start/');
    expect(defaultNext(acct({ teams }))).toBe('/studio/~/acme/ds/');
    expect(defaultNext(acct({ teams }), ['other/x', 'Acme/Web'])).toBe('/studio/~/acme/web/');
  });

  it('takes the digits of a pasted or typed code, six at most', () => {
    expect(codeDigits('123 456')).toBe('123456');
    expect(codeDigits('Your code: 123-456-789')).toBe('123456');
    expect(codeDigits('12a')).toBe('12');
  });

  it('says roles in words, and asks reviewers and admins without GitHub to link it', () => {
    expect(roleWord('edit')).toBe('Can edit');
    expect(roleWord('admin')).toBe('Admin');
    expect(roleWord('owner')).toBe('Owner');
    expect(needsGitHub(acct({ teams: [{ repo: 'a/b', name: null, role: 'edit', via: 'email' }] }))).toBe(false);
    expect(needsGitHub(acct({ teams: [{ repo: 'a/b', name: null, role: 'reviewer', via: 'email' }] }))).toBe(true);
    expect(needsGitHub(acct({ github: { login: 'leo', id: 1 }, teams: [{ repo: 'a/b', name: null, role: 'admin', via: 'github' }] }))).toBe(false);
    expect(accountName(acct({ name: null }))).toBe('leo');
  });

  it('says every refusal in designer words, the server sentence first', () => {
    expect(accountErrorText(409, 'last-admin')).toBe(ACCOUNT_WORDS.lastAdmin);
    expect(accountErrorText(400, 'bad-code')).toBe(ACCOUNT_WORDS.wrongCode);
    expect(accountErrorText(410, null)).toBe(ACCOUNT_WORDS.expiredCode);
    expect(accountErrorText(429, null)).toBe(ACCOUNT_WORDS.tooMany);
    expect(accountErrorText(500, null)).toBe(ACCOUNT_WORDS.failed);
    expect(accountErrorText(409, 'last-admin', 'Make Ann an admin first.')).toBe('Make Ann an admin first.');
  });

  it('writes no em dash in any account word', () => {
    const all = Object.values(ACCOUNT_WORDS).map((w) => (typeof w === 'function' ? (w as (x: never) => string)('x' as never) : w));
    for (const w of all) expect(w).not.toMatch(/\u2014/);
  });
});

describe('signing out forgets the person', () => {
  it('names the personal keys of this browser, and keeps preferences', async () => {
    const { isPersonalKey } = await import('./account');
    for (const k of ['bridge.reviews.mine', 'bridge.contribute.member:acme/ds', 'bridge.teamRoles', 'bridge.recentTeams', 'bridge.teamNames', 'bridge.accountTeamNames', 'bridge.gh.cache:https://api.github.com/repos/acme/ds', 'bridge.github.access:anonymous:acme/ds', 'bridge.requests:acme/ds:issues', 'bridge.changes.list:acme/ds', 'bridge.prstatus:acme/ds#1@abc'])
      expect(isPersonalKey(k), k).toBe(true);
    for (const k of ['bridge.theme', 'bridge.home.contributor-tour', 'bridge.demo.tour', 'other']) expect(isPersonalKey(k), k).toBe(false);
  });

  it('says it once on the sign-in screen, and still goes back to the page', async () => {
    const { signedOutHref, signedOutNote } = await import('./account');
    expect(signedOutHref('out')).toBe('/signin/?bye=out');
    expect(signedOutHref('out', '/studio/~/acme/ds/')).toBe('/signin/?next=%2Fstudio%2F%7E%2Facme%2Fds%2F&bye=out');
    expect(signedOutHref('deleted')).toBe('/signin/?bye=deleted');
    expect(signedOutNote('?bye=out')).toBe("You're signed out.");
    expect(signedOutNote('?bye=deleted')).toBe('Your account is deleted.');
    expect(signedOutNote('?bye=nope')).toBeNull();
  });
});
