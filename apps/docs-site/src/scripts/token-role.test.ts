// @vitest-environment jsdom
// Bridge's own team for its owner, signed in to Bridge with his email (GitHub "peterbono" linked) AND holding a fresh
// GitHub sign-in of the Bridge app (suggest) in this browser, with a "Can view" this browser noted before. GitHub says
// he administers the repository; Bridge's read proxy answers the same repository with the app's permissions (every
// flag false). The page must read his own: Admin, never "Can view", never the own-team read-only strip. When his GitHub
// sign-in reads below edit (another GitHub account), the account's linked GitHub role still wins. The network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenFingerprint } from '../lib/token-session';

const API = 'https://api.github.com';
const REPO = 'the-bridge-company/ai-design-system-demo';
const TOKEN = 'ghu_peterbono_suggest_token_aaaa';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ADMIN = { admin: true, maintain: true, push: true, triage: true, pull: true };
const APP = { admin: false, maintain: false, push: false, triage: false, pull: false };
const READ = { admin: false, maintain: false, push: false, triage: false, pull: true };

let calls: { url: string; auth: boolean }[];
/** The permissions GitHub gives this browser's own token on the repository. */
let own: typeof ADMIN;
/** What GET /api/entry?linked= says. */
let linked: 'admin' | 'edit' | 'view' | null;

function page() {
  document.documentElement.setAttribute('data-hosted', '');
  document.documentElement.setAttribute('data-gh-app', 'direct');
  history.replaceState(null, '', `/studio/${REPO}/settings/`);
  document.body.innerHTML = `<div data-demo-strip hidden></div><dialog id="gh-dialog"><div data-gh-view="signin"></div></dialog>`;
  localStorage.setItem('bridge.github.token.direct', TOKEN);
  localStorage.setItem('bridge.github.app.direct', JSON.stringify({ kind: 'app', expiresAt: Date.now() + 8 * 3600_000, refreshToken: null, refreshExpiresAt: null }));
  // Checked a minute ago, with the access an earlier read kept through Bridge's proxy: "reader".
  localStorage.setItem(
    'bridge.github.check.direct',
    JSON.stringify({ fp: tokenFingerprint(TOKEN), at: Date.now() - 60_000, ok: true, viewer: { login: 'peterbono', name: 'Florian' }, write: false, reach: true, access: { repo: REPO, state: 'reader' } }),
  );
  localStorage.setItem('bridge.teamRoles', JSON.stringify({ [REPO]: 'Can view' }));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  calls = [];
  own = ADMIN;
  linked = 'admin';
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = Boolean(headers.Authorization);
    calls.push({ url, auth });
    if (url.startsWith('/api/contribute')) {
      const gh = new URL(url, 'https://bridge.test').searchParams.get('gh') ?? '';
      // Bridge's read proxy, as production answers it: the repository with the app's permissions.
      if (gh === `/repos/${REPO}` || gh === '') return json({ full_name: REPO, private: false, default_branch: 'main', permissions: APP });
      return json([]);
    }
    if (url.startsWith('/api/account')) return json({ available: true, account: { email: 'florian@bridge.dev', name: 'Florian', github: { login: 'peterbono', id: 8754 }, teams: [] } });
    if (url.startsWith('/api/entry?linked=')) return json({ role: linked });
    if (url === `${API}/user`) return json({ login: 'peterbono', id: 8754, name: 'Florian' });
    if (url.startsWith(`${API}/user/installations`)) return json({ total_count: 1, installations: [{ id: 7, account: { login: 'the-bridge-company', type: 'Organization' }, repository_selection: 'all', app_slug: 'bridge-design-studio' }] });
    if (url === `${API}/repos/${REPO}`) return json({ full_name: REPO, private: false, default_branch: 'main', ...(auth ? { permissions: own } : {}) });
    return json({ message: 'Not Found' }, 404);
  });
  page();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-hosted');
  document.documentElement.removeAttribute('data-gh-app');
});

async function boot() {
  const session = await import('./github-session');
  const gate = await import('./demo-gate');
  const states: (string | null)[] = [];
  session.onAccess((a) => states.push(a?.state ?? null));
  session.initGitHubConnect();
  return { session, gate, states };
}

describe('a GitHub admin of Bridge DS with a Bridge sign-in (suggest) and an email account', () => {
  it('reads his own permissions on GitHub, not the app\'s through Bridge: Admin, no read-only strip', async () => {
    const { session, gate, states } = await boot();
    await vi.waitFor(() => expect(session.currentAccess()?.state).toBe('admin'));
    expect(session.currentAccess()?.write).toBe(true);
    // The repository itself went to GitHub with his token, never through Bridge's shared read.
    expect(calls.some((c) => c.url === `${API}/repos/${REPO}` && c.auth)).toBe(true);
    expect(calls.some((c) => c.url.startsWith('/api/contribute') && new URL(c.url, 'https://bridge.test').searchParams.get('gh') === `/repos/${REPO}`)).toBe(false);
    // The "reader" kept before is never painted, even for a moment.
    expect(states).not.toContain('reader');
    expect(gate.exploringDemo()).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-demo-strip]')!.hidden).toBe(true);
  });

  it('his GitHub sign-in reads below edit (another GitHub account): the linked GitHub admin role wins', async () => {
    own = READ;
    const { session, gate } = await boot();
    await vi.waitFor(() => expect(session.currentAccess()?.state).toBe('reader'));
    await vi.waitFor(() => expect(session.linkedGitHubRole()).toBe('admin'));
    expect(calls.some((c) => c.url === `/api/entry?linked=${encodeURIComponent(REPO)}`)).toBe(true);
    expect(gate.exploringDemo()).toBe(false);
  });

  it('a GitHub sign-in that can edit never asks the server for the linked role', async () => {
    const { session } = await boot();
    await vi.waitFor(() => expect(session.currentAccess()?.state).toBe('admin'));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.url.startsWith('/api/entry?linked='))).toBe(false);
    expect(session.linkedGitHubRole()).toBeNull();
  });

  it('a guest on GitHub and no linked role on the team: still the visitor strip', async () => {
    own = READ;
    linked = null;
    const { session, gate } = await boot();
    await vi.waitFor(() => expect(session.currentAccess()?.state).toBe('reader'));
    await vi.waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/entry?linked='))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.exploringDemo()).toBe(true);
  });
});
