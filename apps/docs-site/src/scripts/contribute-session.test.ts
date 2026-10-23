// @vitest-environment jsdom
// An email contributor on a real team: every feature's GitHub call goes through this site's proxy, with no change to
// the feature (scripts/github-session.ts getToken and studioClient). The network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRIB_TOKEN } from '../lib/contribute';
import { errorText } from '../lib/token-session';
import { acceptEmailInvite, contributeInfo, contributorFor, forgetContributors, onContributeChange, requestEmailSignIn, seedContributors, setContributeFetch, signOutEmail, verifyEmailSignIn } from './contribute-session';
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
  it('knows the member of every email team of an account signed in with a code, without a call', () => {
    localStorage.setItem('bridge.contribute.member:lumen/brand', JSON.stringify({ email: 'old@acme.design', name: 'Old', role: 'edit' }));
    const seen: string[] = [];
    onContributeChange((repo) => seen.push(repo));
    seedContributors({ email: 'leo@acme.design', name: 'Leo' }, [
      { repo: 'acme/ds', role: 'edit', via: 'email' },
      { repo: 'Lumen/Mobile-Kit', role: 'edit', via: 'email' },
      { repo: 'lumen/brand', role: 'edit', via: 'email' },
      { repo: 'octo/gh-only', role: 'reviewer', via: 'github' },
    ]);
    expect(contributorFor('acme/ds')).toEqual({ email: 'leo@acme.design', name: 'Leo', role: 'edit' });
    expect(contributorFor('lumen/mobile-kit')?.email).toBe('leo@acme.design');
    // A member already known is left as the server last said; a GitHub team has no email session.
    expect(contributorFor('lumen/brand')?.email).toBe('old@acme.design');
    expect(contributorFor('octo/gh-only')).toBeNull();
    expect(seen).toEqual(['acme/ds', 'Lumen/Mobile-Kit']);
    expect(calls).toHaveLength(0);
    forgetContributors();
    expect(contributorFor('acme/ds')).toBeNull();
    expect(contributorFor('lumen/brand')).toBeNull();
  });

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

  it('sends the header the server requires on every action (join, links, sign out)', async () => {
    answer = () => json(200, { repo: 'acme/ds', member: { email: 'leo@acme.design', name: 'Leo', role: 'edit' } });
    await acceptEmailInvite('T'.repeat(43), 'Leo');
    await requestEmailSignIn('acme/ds', 'leo@acme.design');
    await verifyEmailSignIn('acme/ds', 'T'.repeat(43));
    await signOutEmail('acme/ds');
    expect(calls).toHaveLength(4);
    for (const c of calls) expect((c.init.headers as Record<string, string>)['X-Bridge-Contribute']).toBe('1');
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

  it("say Bridge's own refusal as is: a file outside design files", async () => {
    signIn();
    const message = 'Bridge only saves design files (tokens, docs, assets) for people who joined with their email. Ask a developer to change this file.';
    answer = () => json(403, { error: 'not-allowed', message });
    await expect(ghWrite('PUT', '/repos/acme/ds/contents/src/App.tsx', { message: 'x', content: '', branch: 'leo/x' })).rejects.toThrow(message);
    const err = await studioClient('acme/ds')
      .getRepo()
      .catch((e: unknown) => e);
    expect(errorText(err, 'fallback')).toBe(message);
  });

  it("write the member's own pull requests as theirs, so Studio counts them as mine", async () => {
    signIn();
    answer = (url) =>
      url.includes('mine=1')
        ? json(200, { branches: ['leo/blue'], issues: [7] })
        : json(200, [
            { number: 7, user: { login: 'bridge-design-studio[bot]' }, head: { ref: 'leo/blue' } },
            { number: 8, user: { login: 'bridge-design-studio[bot]' }, head: { ref: 'leo/other' } },
            { number: 9, user: { login: 'ann' }, head: { ref: 'ann/x' } },
          ]);
    const r = await studioFetch('https://api.github.com/repos/acme/ds/pulls?state=open', { headers: { Authorization: `Bearer ${CONTRIB_TOKEN}` } });
    const pulls = (await r.json()) as { number: number; user: { login: string } }[];
    expect(pulls.map((p) => p.user.login)).toEqual(['leo@acme.design', 'bridge-design-studio[bot]', 'ann']);
    expect(calls.some((c) => c.url === '/api/contribute?repo=acme%2Fds&mine=1')).toBe(true);
  });
});

describe("an email contributor on Bridge's own team", () => {
  it('is a member there, not a demo visitor; the sample team stays sample only', () => {
    history.replaceState(null, '', '/studio/peterbono/ai-design-system-demo/');
    localStorage.setItem('bridge.contribute.member:peterbono/ai-design-system-demo', JSON.stringify({ email: 'leo@acme.design', name: 'Leo', role: 'edit' }));
    expect(currentContributor()?.email).toBe('leo@acme.design');
    expect(getToken()).toBe(CONTRIB_TOKEN);
  });
});
