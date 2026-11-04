// @vitest-environment jsdom
// One GitHub App (docs/SIGN-IN.md): every page signs in with Bridge Direct, and a code write goes out with that one
// sign-in, on a team page or the self-hosted site, with no second OK. A browser that still holds a sign-in of the older
// second app (bridge-ds) looks signed out and is told once, in plain words, to sign in again. Fake tokens only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ghWrite } from './github-session';
import { rememberRepo } from './repo-context';

const CFG = { clientId: 'Iv23liDirect', productionOrigin: null, previewPattern: null, slug: 'bridge-design-studio' };

function page(hosted: boolean) {
  const html = document.documentElement;
  html.toggleAttribute('data-hosted', hosted);
  html.setAttribute('data-gh-app', 'direct');
  const cfg = JSON.stringify(CFG).replace(/'/g, '&#39;');
  document.body.innerHTML = `<div id="gh-dialog"><div data-signin='${cfg}'></div></div><script type="application/json" id="bridge-repo">${JSON.stringify({ owner: 'the-bridge-company', repo: 'ai-design-system-demo', changes: 'direct' })}</script>`;
  history.replaceState(null, '', hosted ? '/studio/acme/ds/tokens/' : '/studio/tokens/');
}

type Route = { status?: number; body: unknown };
function fakeGitHub(routes: Record<string, Route>) {
  const calls: { method: string; url: string; auth: string | undefined }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, auth: headers.Authorization });
    const route = routes[`${method} ${url.replace('https://api.github.com', '')}`] ?? { status: 404, body: { message: 'Not Found' } };
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

const writes = <T extends { method: string }>(calls: T[]) => calls.filter((c) => c.method !== 'GET');

describe('one GitHub App', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    rememberRepo('acme', 'ds', { defaultBranch: 'main', site: { owner: 'acme', repo: 'ds', defaultBranch: 'main', changes: 'direct' } as never });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('a team page in direct mode sends a code write with the one sign-in: no second OK, no reach check', async () => {
    page(true);
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    const calls = fakeGitHub({ 'POST /repos/acme/ds/git/refs': { status: 201, body: { ref: 'refs/heads/bridge/x' } } });
    await ghWrite('POST', '/repos/acme/ds/git/refs', { ref: 'refs/heads/bridge/x', sha: 'a' });
    expect(writes(calls)).toEqual([expect.objectContaining({ method: 'POST', auth: 'Bearer fake-direct' })]);
    expect(calls.some((c) => c.url.includes('/user/installations'))).toBe(false);
    expect(document.getElementById('gh-direct-dialog')).toBeNull();
  });

  it('the self-hosted site writes with its own sign-in, exactly as before', async () => {
    page(false);
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    const calls = fakeGitHub({ 'POST /repos/the-bridge-company/ai-design-system-demo/git/refs': { status: 201, body: {} } });
    await ghWrite('POST', '/repos/the-bridge-company/ai-design-system-demo/git/refs', {});
    expect(calls).toEqual([{ method: 'POST', url: 'https://api.github.com/repos/the-bridge-company/ai-design-system-demo/git/refs', auth: 'Bearer fake-direct' }]);
  });

  it('a browser with only the old bridge-ds sign-in looks signed out, is asked once in plain words, and the old sign-in is gone', async () => {
    page(true);
    localStorage.setItem('bridge.github.token.suggest', 'fake-suggest');
    localStorage.setItem('bridge.github.app.suggest', JSON.stringify({ kind: 'app', clientId: 'Iv23liSuggest', expiresAt: null, refreshToken: 'fake-r', refreshExpiresAt: null }));
    // A fresh page: the slots are settled once per page load.
    vi.resetModules();
    const { anyGitHubToken, getToken, saveSignIn, signInSwitched, switchedText } = await import('./github-session');
    expect(getToken()).toBeNull();
    expect(signInSwitched()).toBe(true);
    expect(switchedText()).toBe('Bridge changed how it connects to GitHub. Sign in again once to keep working.');
    // Nothing can renew or use it any more: removed, and never counted as signed in.
    expect(localStorage.getItem('bridge.github.token.suggest')).toBeNull();
    expect(localStorage.getItem('bridge.github.app.suggest')).toBeNull();
    expect(anyGitHubToken()).toBeNull();
    // Signing in once ends the notice.
    saveSignIn({ access_token: 'fake-direct-2' }, { clientId: 'Iv23liDirect' });
    expect(getToken()).toBe('fake-direct-2');
    expect(signInSwitched()).toBe(false);
  });

  it('someone already signed in with Bridge Direct stays signed in, with no notice', async () => {
    page(true);
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    localStorage.setItem('bridge.github.app.direct', JSON.stringify({ kind: 'app', clientId: 'Iv23liDirect', expiresAt: null, refreshToken: null, refreshExpiresAt: null }));
    localStorage.setItem('bridge.github.token.suggest', 'fake-suggest');
    localStorage.setItem('bridge.github.app.suggest', JSON.stringify({ kind: 'app', clientId: 'Iv23liSuggest', expiresAt: null, refreshToken: null, refreshExpiresAt: null }));
    vi.resetModules();
    const { getToken, signInSwitched } = await import('./github-session');
    expect(getToken()).toBe('fake-direct');
    expect(signInSwitched()).toBe(false);
    expect(localStorage.getItem('bridge.github.token.suggest')).toBeNull();
  });
});
