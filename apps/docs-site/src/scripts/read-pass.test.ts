// @vitest-environment jsdom
// Studio hands a member's read pass to the preview link they open (scripts/read-pass.ts). The owner's report: "Open the
// preview" opened the private product's preview with no pass in its fragment, so the toolbar there could not read the
// change. The pass must ride along even when the member opens the link before the pass arrived, a refusal must not
// stick for the life of the page, and a preview whose toolbar is too old for the pass never gets one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ github: true }));
vi.mock('./github-session', () => ({
  signedInWithGitHub: () => session.github,
  bridgeReadAuth: async () => null,
  readRepo: () => ({ owner: 'the-bridge-company', repo: 'ai-design-system-demo' }),
}));
vi.mock('./contribute-session', () => ({ contributorFor: () => null }));
vi.mock('./account-session', () => ({ onAccountChange: () => () => undefined }));

import { installReadPass, readPassOf, resetReadPass, RETRY_MS, WAIT_MS } from './read-pass';

const PASS = 'v1.eyJ0IjoiYWNtZS9kcyJ9.c2lnbmF0dXJlLWJ5dGVz';
const TEAM = 'the-bridge-company/ai-design-system-demo';
const PREVIEW = 'https://explore-dashboard-orders-wai.art-print-shop-design.pages.dev/?bridge=1&bridge-repo=the-bridge-company%2Fart-print-shop-design';
const grant = () => ({ pass: PASS, exp: Date.now() + 8 * 3600_000, origins: ['https://{branch}.art-print-shop-design.pages.dev', 'https://art-print-shop.pages.dev'] });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let mint: () => Promise<Response>;
let mints = 0;
let opened: { url: string; tab: { opener: unknown; location: { replace: (u: string) => void } } }[];

function link(attrs: Record<string, string> = {}) {
  const a = document.createElement('a');
  a.href = PREVIEW;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Open the preview';
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  document.body.appendChild(a);
  return a;
}

/** Clicks `a` and returns the address the browser would follow, or null when Studio took the click over. */
function click(a: HTMLAnchorElement): string | null {
  let followed: string | null = null;
  const after = (e: Event) => {
    if (!e.defaultPrevented) followed = a.href;
    e.preventDefault();
  };
  document.addEventListener('click', after);
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  document.removeEventListener('click', after);
  return followed;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetReadPass();
  sessionStorage.clear();
  document.body.innerHTML = '';
  session.github = true;
  mints = 0;
  mint = async () => json(200, grant());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('mint=read-pass')) {
        mints += 1;
        return mint();
      }
      return json(404, {});
    }),
  );
  opened = [];
  vi.stubGlobal(
    'open',
    vi.fn((url: string) => {
      const tab = { opener: window as unknown, location: { replace: (u: string) => void (entry.url = u) } };
      const entry = { url, tab };
      opened.push(entry);
      return tab;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Open the preview for a member', () => {
  it('carries the pass in the fragment once the pass is there', async () => {
    installReadPass();
    await readPassOf(TEAM);
    const a = link();
    const href = click(a);
    expect(href).toBe(`${PREVIEW}#bridge-pass=${PASS}`);
    await tick();
    // The page keeps the link without it (copy link address, share).
    expect(a.getAttribute('href')).toBe(PREVIEW);
  });

  it('waits for a pass still on its way instead of opening without it (the owner clicked before it arrived)', async () => {
    let answer!: (r: Response) => void;
    mint = () => new Promise<Response>((r) => (answer = r));
    installReadPass();
    const a = link();
    expect(click(a)).toBeNull();
    // A new tab opened inside the click, detached from Studio, still empty.
    expect(opened).toHaveLength(1);
    expect(opened[0]!.url).toBe('about:blank');
    expect(opened[0]!.tab.opener).toBeNull();
    await vi.waitFor(() => expect(mints).toBe(1));
    answer(json(200, grant()));
    await vi.waitFor(() => expect(opened[0]!.url).toBe(`${PREVIEW}#bridge-pass=${PASS}`));
  });

  it('opens without the pass when the server keeps it waiting too long', async () => {
    vi.useFakeTimers();
    mint = () => new Promise<Response>(() => undefined);
    installReadPass();
    click(link());
    await vi.advanceTimersByTimeAsync(WAIT_MS + 10);
    expect(opened[0]!.url).toBe(PREVIEW);
  });

  it('asks again after a refusal instead of keeping it for the life of the page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mint = async () => json(401, { error: 'signin' });
    installReadPass();
    expect(await readPassOf(TEAM)).toBeNull();
    // Right after the refusal: opens at once without the pass, and does not ask again.
    click(link());
    await vi.waitFor(() => expect(opened[0]?.url).toBe(PREVIEW));
    expect(mints).toBe(1);
    // Signed in since: the next open asks again and carries the pass.
    mint = async () => json(200, grant());
    vi.setSystemTime(Date.now() + RETRY_MS + 1);
    click(link());
    await vi.waitFor(() => expect(opened[1]?.url).toBe(`${PREVIEW}#bridge-pass=${PASS}`));
    expect(mints).toBe(2);
  });

  it('never hands the pass to a preview whose toolbar is too old to take it', async () => {
    installReadPass();
    await readPassOf(TEAM);
    expect(click(link({ 'data-bridge-pass': 'off' }))).toBe(PREVIEW);
    expect(opened).toHaveLength(0);
  });

  it('leaves links that are not toolbar links alone, and a visitor asks nothing', async () => {
    installReadPass();
    await readPassOf(TEAM);
    const plain = link();
    plain.href = 'https://explore-dashboard-orders-wai.art-print-shop-design.pages.dev/';
    expect(click(plain)).toBe('https://explore-dashboard-orders-wai.art-print-shop-design.pages.dev/');

    resetReadPass();
    sessionStorage.clear();
    session.github = false;
    mints = 0;
    installReadPass();
    expect(click(link())).toBe(PREVIEW);
    expect(opened).toHaveLength(0);
    expect(mints).toBe(0);
  });
});
