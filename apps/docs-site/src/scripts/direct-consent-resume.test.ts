// @vitest-environment jsdom
// What the person was doing goes along to Bridge Direct's OK on GitHub (scripts/pending-action.ts): the dialog armed
// right before the write is kept with this page when they click Continue on GitHub, so it reopens when they come
// back. Never a token. Its own file: the consent dialog wires Continue once per page. Fake tokens only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dialogHtml, trusted } from '@bridge-ds/react/dom';
import { ghWrite, isDirectWait, PENDING_KEY } from './github-session';
import { armPendingAction } from './pending-action';
import { PENDING_ACTION_KEY } from '../lib/pending-action';
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

const directOpen = () => document.querySelector('#gh-direct-dialog [data-open]') !== null;

describe('Continue on GitHub keeps the action that asked', () => {
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

  it('saves the new product typed, this page and the time, then goes to GitHub and back to this page', async () => {
    page({ hosted: true });
    const calls = fakeGitHub({});
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/studio/acme/ds/tokens/', search: '', hash: '', origin: window.location.origin });
    armPendingAction('new-product', { name: 'Atlas', owner: 'art-print-shop-co', copy: true });
    const err = await ghWrite('POST', '/repos/acme/ds-template/generate', { name: 'atlas' }).catch((e: unknown) => e);
    expect(isDirectWait(err)).toBe(true);
    expect(directOpen()).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-gh-direct-continue]')!.click();
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    const kept = JSON.parse(sessionStorage.getItem(PENDING_ACTION_KEY)!);
    expect(kept).toMatchObject({ kind: 'new-product', values: { name: 'Atlas', owner: 'art-print-shop-co', copy: true }, url: '/studio/acme/ds/tokens/' });
    expect(JSON.stringify(kept)).not.toMatch(/fake-suggest/);
    // GitHub sends the person back to this very page, not Home.
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!)).toMatchObject({ returnTo: '/studio/acme/ds/tokens/', app: 'direct' });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});
