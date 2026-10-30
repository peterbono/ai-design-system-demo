import { describe, expect, it } from 'vitest';
import { canReview, contributorAccess } from './access';
import { CONTRIB_TOKEN, CONTRIBUTE_WORDS, contributeEligible, contributeHashToken, isContribAuth, parseMember, productReposOfConfig, proxyUrl } from './contribute';
import { accessScreen } from './access-view';
import { emailMembers } from './invites';
import { reviewActions, type ActionInput } from './review-page';

describe('proxyUrl', () => {
  it("sends the team's repository calls to the proxy, path and query encoded", () => {
    expect(proxyUrl('https://api.github.com/repos/acme/ds/git/refs?per_page=5', 'acme/ds')).toBe('/api/contribute?repo=acme%2Fds&gh=%2Frepos%2Facme%2Fds%2Fgit%2Frefs%3Fper_page%3D5');
    expect(proxyUrl('https://api.github.com/repos/Acme/DS', 'acme/ds')).toBe('/api/contribute?repo=acme%2Fds&gh=%2Frepos%2FAcme%2FDS');
  });

  it('leaves every other call alone: another repository, the account, another host', () => {
    expect(proxyUrl('https://api.github.com/repos/acme/ds-other/pulls', 'acme/ds')).toBeNull();
    expect(proxyUrl('https://api.github.com/user', 'acme/ds')).toBeNull();
    expect(proxyUrl('https://api.github.com/graphql', 'acme/ds')).toBeNull();
    expect(proxyUrl('https://raw.githubusercontent.com/acme/ds/main/x.json', 'acme/ds')).toBeNull();
  });
  it("routes a read of the team's product repository through the team's proxy, never an unlisted one", () => {
    const products = productReposOfConfig([{ repo: 'Acme/Shop' }, { repo: 'acme/ds' }, { repo: 'bad' }, {}], 'acme/ds');
    expect(products).toEqual(['acme/shop']);
    expect(proxyUrl('https://api.github.com/repos/acme/shop/pulls?state=open', 'acme/ds', products)).toBe(`/api/contribute?repo=acme%2Fds&gh=${encodeURIComponent('/repos/acme/shop/pulls?state=open')}`);
    expect(proxyUrl('https://api.github.com/repos/acme/shop/pulls', 'acme/ds')).toBeNull();
    expect(proxyUrl('https://api.github.com/repos/acme/other/pulls', 'acme/ds', products)).toBeNull();
  });
});

describe('the email session', () => {
  it('reads the link token from #contribute= only', () => {
    const t = 'a'.repeat(43);
    expect(contributeHashToken(`#contribute=${t}`)).toBe(t);
    expect(contributeHashToken(`#t=${t}`)).toBeNull();
    expect(contributeHashToken('#contribute=short')).toBeNull();
  });

  it('is offered on real teams only, never the sample team, the demo or a page without a team', () => {
    expect(contributeEligible('acme/ds', true)).toBe(true);
    expect(contributeEligible('peterbono/bridge-demo-ds', true)).toBe(false);
    expect(contributeEligible('peterbono/ai-design-system-demo', true)).toBe(true);
    expect(contributeEligible('acme/ds', false)).toBe(false);
    expect(contributeEligible(null, true)).toBe(false);
  });

  it('tells the stand-in token from a GitHub one', () => {
    expect(isContribAuth(`Bearer ${CONTRIB_TOKEN}`)).toBe(true);
    expect(isContribAuth(`token ${CONTRIB_TOKEN}`)).toBe(true);
    expect(isContribAuth('Bearer ghu_abc')).toBe(false);
    expect(isContribAuth(undefined)).toBe(false);
  });

  it('keeps a member only with an email, always Can edit', () => {
    expect(parseMember({ email: 'leo@acme.design', name: ' Leo ', role: 'admin' })).toEqual({ email: 'leo@acme.design', name: 'Leo', role: 'edit' });
    expect(parseMember({ email: 'leo@acme.design' })).toEqual({ email: 'leo@acme.design', name: 'leo@acme.design', role: 'edit' });
    expect(parseMember({ name: 'Leo' })).toBeNull();
  });

  it('never writes an em dash', () => {
    const all = JSON.stringify(Object.values(CONTRIBUTE_WORDS).map((v) => (typeof v === 'function' ? (v as (a: string) => string)('x') : v)));
    expect(all).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('what an email contributor may do', () => {
  it('edits, never administers or reviews', () => {
    const a = contributorAccess();
    expect(a).toMatchObject({ state: 'writer', write: true, admin: false, contributor: true });
    expect(canReview(a)).toBe(false);
    expect(canReview({ write: true })).toBe(true);
    expect(canReview(null)).toBe(false);
  });

  it('gets no approve, ask for changes, merge or override in the review bar', () => {
    const base: ActionInput = { lifecycle: 'ready', connected: true, canWrite: true, isAuthor: false, canApprove: true, canMerge: true, mergeAfterApprove: true, overrideOnly: true, visual: false, shareable: false, exploration: false, statusAction: null };
    expect(reviewActions(base).primary?.kind).toBe('approve-merge');
    const r = reviewActions({ ...base, canMerge: false, canReview: false });
    expect(r.primary).toBeNull();
    expect(r.suggest).toBe(false);
    expect(r.menu.override).toBeNull();
    expect(r.comment).toBe(true);
  });

  it('closes only their own change: the proxy refuses anyone else\'s', () => {
    const base: ActionInput = { lifecycle: 'ready', connected: true, canWrite: true, isAuthor: false, canApprove: false, canMerge: false, mergeAfterApprove: false, overrideOnly: false, visual: false, shareable: false, exploration: false, statusAction: null, canReview: false };
    expect(reviewActions(base).menu.close).toBe(false);
    expect(reviewActions({ ...base, isAuthor: true }).menu.close).toBe(true);
    expect(reviewActions({ ...base, canReview: true }).menu.close).toBe(true);
  });
});

describe('signed-out screens', () => {
  it('sign in by email first, GitHub second, when the site has email sign-in', () => {
    const f = { owner: 'acme', repo: 'ds', link: 'https://x/studio/acme/ds/' };
    const withEmail = accessScreen('anonymous-unknown', { ...f, email: true })!;
    expect(withEmail.title).toBe('Sign in to open Ds');
    expect(withEmail.primary).toEqual({ kind: 'email', label: 'Sign in' });
    expect(withEmail.secondary).toEqual({ kind: 'signin', label: 'Sign in with GitHub' });
    expect(withEmail.links).toBeUndefined();
    expect(accessScreen('anonymous-public', { ...f, email: true })?.links?.[0]?.action.kind).toBe('email');
    expect(accessScreen('anonymous-unknown', f)?.title).toBe('Sign in with GitHub to open Ds');
    expect(accessScreen('anonymous-unknown', f)?.links).toBeUndefined();
  });
});

describe('email members', () => {
  it('reads the rows the server marks via email, Can edit or Admin, with you', () => {
    const rows = [{ email: 'Leo@acme.design', name: 'Leo', via: 'email', role: 'admin' }, { email: 'x@acme.design', via: 'github' }, { email: 'kim@acme.design', via: 'email', role: 'reviewer' }, null];
    expect(emailMembers(rows, 'leo@acme.design')).toEqual([
      { login: 'leo@acme.design', name: 'Leo', role: 'admin', reviews: [], email: 'leo@acme.design', via: 'email', you: true },
      // Anything else reads as Can edit: an email member is never Reviewer.
      { login: 'kim@acme.design', name: 'kim@acme.design', role: 'edit', reviews: [], email: 'kim@acme.design', via: 'email' },
    ]);
  });
});
