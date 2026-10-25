// @vitest-environment jsdom
// Bridge Direct on team pages (multi-team plan 3.2, PR 3d): a code write on a team in direct mode asks for the OK once,
// then goes out with Bridge Direct's token; issues stay on Bridge; the self-hosted site is untouched. Fake tokens only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogHtml, trusted } from '@bridge-ds/react/dom';
import { ghWrite, isDirectWait, saveSignIn, studioClient } from './github-session';
import { rememberRepo } from './repo-context';

// jsdom has no CSS.escape; the DS dialog uses it to find its close button.
if (!globalThis.CSS?.escape) vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) });

const BOTH = {
  clientId: 'Iv23liSuggest',
  app: 'suggest',
  suggestApp: 'suggest',
  productionOrigin: null,
  previewPattern: null,
  direct: { clientId: 'Iv23liDirect', slug: 'bridge-direct' },
};

const DIRECT_DIALOG = dialogHtml({
  id: 'gh-direct-dialog',
  title: 'Allow Bridge to save your changes',
  body: trusted(
    '<div data-gh-direct-view="consent"></div><div data-gh-direct-view="setup" hidden><p data-gh-direct-setup-text></p></div><div data-gh-direct-note hidden><span data-gh-direct-note-text></span></div>',
  ),
  footer: trusted('<button data-gh-direct-continue><span>Continue on GitHub</span></button><a data-gh-direct-install hidden href="#">Install Bridge Direct</a><button data-gh-direct-ask hidden><span>Ask your lead</span></button>'),
});

function page(opts: { hosted: boolean; app?: string; cfg?: object }) {
  const html = document.documentElement;
  html.toggleAttribute('data-hosted', opts.hosted);
  html.setAttribute('data-gh-app', opts.app ?? 'suggest');
  const cfg = JSON.stringify(opts.cfg ?? BOTH).replace(/'/g, '&#39;');
  document.body.innerHTML = `<div id="gh-dialog"><div data-signin='${cfg}'></div></div>${opts.hosted ? DIRECT_DIALOG : ''}<script type="application/json" id="bridge-repo">${JSON.stringify({ owner: 'peterbono', repo: 'ai-design-system-demo', changes: 'direct' })}</script>`;
  history.replaceState(null, '', opts.hosted ? '/studio/acme/ds/tokens/' : '/studio/tokens/');
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
const directOpen = () => document.querySelector('#gh-direct-dialog [data-open]') !== null;

describe('Bridge Direct on a team page in direct mode', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('bridge.github.token.suggest', 'fake-suggest');
    rememberRepo('acme', 'ds', { defaultBranch: 'main', site: { owner: 'acme', repo: 'ds', defaultBranch: 'main', changes: 'direct' } as never });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('CSS', { escape: (s: string) => s });
    document.body.innerHTML = '';
  });

  it('asks for the OK before the first code write, and sends nothing', async () => {
    page({ hosted: true });
    const calls = fakeGitHub({});
    const err = await ghWrite('POST', '/repos/acme/ds/git/refs', { ref: 'refs/heads/bridge/x', sha: 'a' }).catch((e: unknown) => e);
    expect(isDirectWait(err)).toBe(true);
    expect((err as Error).message).toBe('Allow Bridge to save your changes, then try again.');
    expect(directOpen()).toBe(true);
    expect(calls).toEqual([]);
  });

  it('asks through the core client too, with the same sentence (no "could not reach GitHub")', async () => {
    page({ hosted: true });
    const calls = fakeGitHub({});
    const err = await studioClient('acme/ds').createBranch('bridge/x', 'a'.repeat(40)).catch((e: unknown) => e);
    expect(isDirectWait(err)).toBe(true);
    expect((err as Error).message).toMatch(/^Allow Bridge to save your changes/);
    expect(writes(calls)).toEqual([]);
  });

  it('sends the code write with Bridge Direct once it has the OK and is set up on the repository', async () => {
    page({ hosted: true });
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    const calls = fakeGitHub({
      'GET /user': { body: { login: 'ann' } },
      'GET /user/installations?per_page=100': { body: { total_count: 1, installations: [{ id: 7, account: { login: 'acme' }, repository_selection: 'all' }] } },
      'GET /user/installations?per_page=100&page=1': { body: { total_count: 1, installations: [{ id: 7, account: { login: 'acme' }, repository_selection: 'all' }] } },
      'POST /repos/acme/ds/git/refs': { status: 201, body: { ref: 'refs/heads/bridge/x' } },
    });
    await ghWrite('POST', '/repos/acme/ds/git/refs', { ref: 'refs/heads/bridge/x', sha: 'a' });
    const [write] = writes(calls);
    expect(write).toMatchObject({ method: 'POST', auth: 'Bearer fake-direct' });
    expect(directOpen()).toBe(false);
  });

  it('says it is not set up yet when Bridge Direct is not on the repository, and sends nothing', async () => {
    page({ hosted: true });
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    const none = { body: { total_count: 0, installations: [] } };
    const calls = fakeGitHub({ 'GET /user': { body: { login: 'ann' } }, 'GET /user/installations?per_page=100': none, 'GET /user/installations?per_page=100&page=1': none });
    const err = await ghWrite('PUT', '/repos/acme/ds/pulls/3/merge', {}).catch((e: unknown) => e);
    expect(isDirectWait(err)).toBe(true);
    expect((err as Error).message).toBe('Saving changes is not set up for this team yet.');
    expect(writes(calls)).toEqual([]);
    const dialog = document.getElementById('gh-direct-dialog')!;
    expect(dialog.querySelector<HTMLElement>('[data-gh-direct-view="setup"]')!.hidden).toBe(false);
    // Not an admin of the repository (as far as this page knows): ask the lead, no install link.
    expect(dialog.querySelector<HTMLElement>('[data-gh-direct-ask]')!.hidden).toBe(false);
    expect(dialog.querySelector<HTMLElement>('[data-gh-direct-install]')!.hidden).toBe(true);
    expect(dialog.querySelector('[data-gh-direct-setup-text]')!.textContent).toMatch(/^Your lead needs/);
  });

  it('forgets an OK GitHub refuses and asks for it again', async () => {
    page({ hosted: true });
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    sessionStorage.setItem('bridge.github.direct-ok::acme/ds', String(Date.now()));
    fakeGitHub({ 'POST /repos/acme/ds/git/refs': { status: 401, body: { message: 'Bad credentials' } } });
    const err = await ghWrite('POST', '/repos/acme/ds/git/refs', {}).catch((e: unknown) => e);
    expect(isDirectWait(err)).toBe(true);
    expect(localStorage.getItem('bridge.github.token.direct')).toBeNull();
    // Bridge's own sign-in is untouched.
    expect(localStorage.getItem('bridge.github.token.suggest')).toBe('fake-suggest');
    expect(directOpen()).toBe(true);
  });

  it('keeps suggestions and comments on Bridge, without asking', async () => {
    page({ hosted: true });
    const calls = fakeGitHub({ 'POST /repos/acme/ds/issues': { status: 201, body: { number: 4 } } });
    await ghWrite('POST', '/repos/acme/ds/issues', { title: 't', body: 'b' });
    expect(writes(calls)).toEqual([{ method: 'POST', url: 'https://api.github.com/repos/acme/ds/issues', auth: 'Bearer fake-suggest' }]);
    expect(directOpen()).toBe(false);
  });

  it('asks nothing in suggest mode', async () => {
    rememberRepo('acme', 'ds', { site: { owner: 'acme', repo: 'ds', defaultBranch: 'main', changes: 'suggest' } as never });
    page({ hosted: true });
    const calls = fakeGitHub({ 'POST /repos/acme/ds/git/refs': { status: 201, body: {} } });
    await ghWrite('POST', '/repos/acme/ds/git/refs', {});
    expect(writes(calls)[0]?.auth).toBe('Bearer fake-suggest');
  });
});

describe('the callback page keeps each app in its own slot', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('saves a team page sign-in or the Direct OK beside the page app, never over it', () => {
    // The callback page is built for the self-hosted site (Bridge Direct there, this repository is in direct mode).
    page({ hosted: false, app: 'direct', cfg: { ...BOTH, clientId: 'Iv23liDirect', app: 'direct', direct: undefined } });
    localStorage.setItem('bridge.github.token.direct', 'fake-self-hosted');
    saveSignIn({ access_token: 'fake-team-signin', expires_in: 28800, refresh_token: 'fake-r', refresh_token_expires_in: 1000 }, { clientId: 'Iv23liSuggest', slot: 'suggest' });
    expect(localStorage.getItem('bridge.github.token.suggest')).toBe('fake-team-signin');
    expect(JSON.parse(localStorage.getItem('bridge.github.app.suggest')!)).toMatchObject({ kind: 'app', clientId: 'Iv23liSuggest' });
    expect(localStorage.getItem('bridge.github.token.direct')).toBe('fake-self-hosted');
    // The page's own app: the usual save, as before.
    saveSignIn({ access_token: 'fake-direct-2' }, { clientId: 'Iv23liDirect', slot: 'direct' });
    expect(localStorage.getItem('bridge.github.token.direct')).toBe('fake-direct-2');
    expect(localStorage.getItem('bridge.github.token.suggest')).toBe('fake-team-signin');
  });
});

describe('the self-hosted site', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes with its own sign-in, exactly as before', async () => {
    page({ hosted: false, app: 'direct', cfg: { ...BOTH, clientId: 'Iv23liDirect', app: 'direct', direct: undefined } });
    localStorage.setItem('bridge.github.token.direct', 'fake-direct');
    const calls = fakeGitHub({ 'POST /repos/peterbono/ai-design-system-demo/git/refs': { status: 201, body: {} } });
    await ghWrite('POST', '/repos/peterbono/ai-design-system-demo/git/refs', {});
    expect(calls).toEqual([{ method: 'POST', url: 'https://api.github.com/repos/peterbono/ai-design-system-demo/git/refs', auth: 'Bearer fake-direct' }]);
  });
});
