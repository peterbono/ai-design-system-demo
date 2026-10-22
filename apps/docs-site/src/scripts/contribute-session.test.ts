// @vitest-environment jsdom
// An email contributor on a real team: every feature's GitHub call goes through this site's proxy, with no change to
// the feature (scripts/github-session.ts getToken and studioClient). The network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIB_TOKEN } from '../lib/contribute';
import { contributeInfo, contributorFor, setContributeFetch, signOutEmail, verifyEmailSignIn } from './contribute-session';
import { currentContributor, getToken, ghWrite, studioClient, studioFetch } from './github-session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const calls: { url: string; init: RequestInit }[] = [];
let answer: (url: string) => Response = () => json(200, {});

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  document.documentElement.setAttribute('data-hosted', '');
  history.replaceState(null, '', '/studio/acme/ds/');
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer(url);
  });
  setContributeFetch(f);
  vi.stubGlobal('fetch', f);
  answer = () => json(200, {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  setContributeFetch(null);
  document.documentElement.removeAttribute('data-hosted');
});

const signIn = () => localStorage.setItem('bridge.contribute.member:acme/ds', JSON.stringify({ email: 'leo@acme.design', name: 'Leo', role: 'edit' }));

describe('the email session', () => {
  it('reads who is signed in once per team and page, with the cookie', async () => {
    answer = () => json(200, { available: true, member: { email: 'leo@acme.design', name: 'Leo', role: 'edit' } });
    const info = await contributeInfo('acme/ds');
    await contributeInfo('acme/ds');
    expect(info).toEqual({ available: true, member: { email: 'leo@acme.design', name: 'Leo', role: 'edit' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/contribute?repo=acme%2Fds');
    expect(calls[0]!.init.credentials).toBe('include');
    expect(contributorFor('acme/ds')?.name).toBe('Leo');
  });

  it('spends the link and signs out', async () => {
    answer = () => json(200, { member: { email: 'leo@acme.design', name: 'Leo' } });
    await verifyEmailSignIn('acme/ds', 'T'.repeat(43));
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ action: 'verify', repo: 'acme/ds', token: 'T'.repeat(43) });
    expect(contributorFor('acme/ds')).not.toBeNull();
    await signOutEmail('acme/ds');
    expect(contributorFor('acme/ds')).toBeNull();
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ action: 'sign-out', repo: 'acme/ds' });
  });
});

describe("Studio's GitHub calls for an email contributor", () => {
  it('carry the stand-in token, only on a real team without a GitHub sign-in', () => {
    expect(getToken()).toBeNull();
    signIn();
    expect(currentContributor()?.email).toBe('leo@acme.design');
    expect(getToken()).toBe(CONTRIB_TOKEN);
    history.replaceState(null, '', '/studio/peterbono/bridge-demo-ds/');
    localStorage.setItem('bridge.contribute.member:peterbono/bridge-demo-ds', JSON.stringify({ email: 'leo@acme.design', name: 'Leo' }));
    expect(getToken()).toBeNull();
  });

  it('go through the proxy, same method and body, the team only', async () => {
    signIn();
    answer = (url) => (url.includes('git%2Frefs') ? json(201, { ref: 'refs/heads/leo/blue', object: { sha: 'abc' } }) : json(200, { default_branch: 'main', private: true, full_name: 'acme/ds' }));
    const client = studioClient('acme/ds');
    await client.getRepo();
    expect(calls[0]!.url).toBe('/api/contribute?repo=acme%2Fds&gh=%2Frepos%2Facme%2Fds');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['X-Bridge-Contribute']).toBe('1');
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(calls[0]!.init.credentials).toBe('same-origin');

    await ghWrite('POST', '/repos/acme/ds/git/refs', { ref: 'refs/heads/leo/blue', sha: 'abc' });
    const w = calls[1]!;
    expect(w.url).toBe('/api/contribute?repo=acme%2Fds&gh=%2Frepos%2Facme%2Fds%2Fgit%2Frefs');
    expect(w.init.method).toBe('POST');
    expect(JSON.parse(String(w.init.body))).toEqual({ ref: 'refs/heads/leo/blue', sha: 'abc' });
  });

  it('read anything outside the team as a guest, and forget an ended session', async () => {
    signIn();
    answer = () => json(200, {});
    await studioFetch('https://api.github.com/users/ann', { headers: { Authorization: `Bearer ${CONTRIB_TOKEN}` } });
    expect(calls[0]!.url).toBe('https://api.github.com/users/ann');
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).not.toContain('Authorization');
    answer = () => json(401, { error: 'signin' });
    await studioClient('acme/ds')
      .getRepo()
      .catch(() => null);
    expect(contributorFor('acme/ds')).toBeNull();
    expect(getToken()).toBeNull();
  });
});
