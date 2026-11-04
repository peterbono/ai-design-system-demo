// @vitest-environment jsdom
// Bridge DS's Settings opened right after sign-in: a fresh GitHub sign-in this browser never checked. Settings asks
// for the access at once (Members, Library access) while the session still checks the sign-in with GitHub. The page
// must never read the team as a signed-out visitor meanwhile: that painted "Guest", the "Bridge DS, read only" banner
// and a members list of one until a reload. A real visitor (no sign-in) still gets the public read and the banner.
// The network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://api.github.com';
const REPO = 'the-bridge-company/ai-design-system-demo';
const TOKEN = 'ghu_peterbono_fresh_token_bbbb';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ADMIN = { admin: true, maintain: true, push: true, triage: true, pull: true };

let calls: { url: string; auth: boolean }[];
/** GET /user answers once this is called: the sign-in check takes its time, like on a cold first load. */
let answerUser: () => void;

function page(signedIn: boolean) {
  document.documentElement.setAttribute('data-hosted', '');
  document.documentElement.setAttribute('data-gh-app', 'direct');
  history.replaceState(null, '', `/studio/${REPO}/settings/`);
  document.body.innerHTML = `<div data-demo-strip hidden></div><dialog id="gh-dialog"><div data-gh-view="signin"></div></dialog>`;
  if (signedIn) {
    localStorage.setItem('bridge.github.token.direct', TOKEN);
    localStorage.setItem('bridge.github.app.direct', JSON.stringify({ kind: 'app', expiresAt: Date.now() + 8 * 3600_000, refreshToken: null, refreshExpiresAt: null }));
  }
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  const userAnswered = new Promise<void>((resolve) => (answerUser = resolve));
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const auth = Boolean(((init?.headers ?? {}) as Record<string, string>).Authorization);
    calls.push({ url, auth });
    if (url.startsWith('/api/contribute')) return json({ full_name: REPO, private: false, default_branch: 'main' });
    if (url.startsWith('/api/account')) return json({ available: true, account: null });
    if (url === `${API}/user`) {
      await userAnswered;
      return json({ login: 'peterbono', id: 8754, name: 'Florian' });
    }
    if (url.startsWith(`${API}/user/installations`)) return json({ total_count: 1, installations: [{ id: 7, account: { login: 'the-bridge-company', type: 'Organization' }, repository_selection: 'all', app_slug: 'bridge-design-studio' }] });
    if (url === `${API}/repos/${REPO}`) return json({ full_name: REPO, private: false, default_branch: 'main', ...(auth ? { permissions: ADMIN } : {}) });
    return json({ message: 'Not Found' }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-hosted');
  document.documentElement.removeAttribute('data-gh-app');
});

describe('Settings opened right after sign-in', () => {
  it('waits for the sign-in check, then reads the admin as Admin: never the public read, never the banner', async () => {
    page(true);
    const session = await import('./github-session');
    const gate = await import('./demo-gate');
    const states: (string | null)[] = [];
    session.onAccess((a) => states.push(a?.state ?? null));
    session.initGitHubConnect();
    // Settings' own read (Members, Library access) starts before GitHub answered who is signed in.
    const early = session.resolveAccess(undefined, { anonymous: true });
    await new Promise((r) => setTimeout(r, 20));
    // Still checking: not a visitor, so no banner and no public read of the team.
    expect(gate.exploringDemo()).toBe(false);
    expect(calls.some((c) => c.url === `${API}/repos/${REPO}` && !c.auth)).toBe(false);
    answerUser();
    expect((await early)?.state).toBe('admin');
    await vi.waitFor(() => expect(session.currentAccess()?.state).toBe('admin'));
    expect(states).not.toContain('anonymous-public');
    expect(gate.exploringDemo()).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-demo-strip]')!.hidden).toBe(true);
  });

  it('a visitor with no sign-in reads the public state at once and explores the read-only demo', async () => {
    page(false);
    const session = await import('./github-session');
    const gate = await import('./demo-gate');
    session.initGitHubConnect();
    expect((await session.resolveAccess(undefined, { anonymous: true }))?.state).toBe('anonymous-public');
    // Once the page knows nobody is signed in to Bridge either, the visitor explores the demo (its banner shows).
    await vi.waitFor(() => expect(gate.exploringDemo()).toBe(true));
    expect(calls.some((c) => c.url === `${API}/user`)).toBe(false);
  });
});
