// @vitest-environment jsdom
// The account row at the foot of the Studio side nav (components/GitHubAccount.astro), painted by
// scripts/github-session.ts. An email contributor signed in on a real team gets the same signed-in row a GitHub user
// gets: the DS drawn face (no initials), their name, their role ("Can edit") as the second line, a menu with their name,
// their full email on its own line, Access "Can edit" and Sign out. Never a sign-in button. "Read only until you sign in" is only for a visitor with no session at all. The network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let member: { email: string; name: string; role: string } | null = null;

// The footer as GitHubAccount.astro renders it on a team page, with the Connect dialog the session needs.
const FOOTER = `
  <div class="gh-acct" data-gh-connect data-gh-acct data-state="checking">
    <div class="gh-acct-connect">
      <button type="button" data-gh-open data-gh-signin data-gh-signin-screen aria-describedby="gh-acct-note">Sign in</button>
      <p class="gh-acct-note" id="gh-acct-note">Read only until you sign in</p>
    </div>
    <div class="gh-acct-rejected" role="status"><span data-gh-rejected-text></span></div>
    <details class="menu gh-acct-menu" data-menu>
      <summary class="gh-acct-who">
        <span class="avatar" data-gh-avatar hidden><span aria-hidden="true">GH</span></span>
        <span class="gh-acct-text">
          <span class="gh-acct-login" data-gh-login></span>
          <span class="gh-acct-repo" data-team-display data-gh-acct-team>Ds</span>
          <span class="gh-acct-repo" data-gh-acct-role hidden></span>
        </span>
        <span class="sr-only">, account menu</span>
      </summary>
      <div class="menu-panel"><p data-gh-menu-title>GitHub</p><p data-gh-menu-email hidden></p>
        <dl><dt data-gh-github-only>Signed in</dt><dd data-gh-github-only data-gh-login-full></dd><dt>Access</dt><dd><span data-gh-perm>Checking</span></dd></dl>
        <button type="button" data-gh-forget><span data-gh-forget-label>Disconnect</span></button>
      </div>
    </details>
  </div>
  <dialog id="gh-dialog"><div data-gh-view="signin"><button type="button" data-gh-signin>Sign in with GitHub</button></div></dialog>`;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  member = null;
  document.documentElement.setAttribute('data-hosted', '');
  history.replaceState(null, '', '/studio/acme/ds/');
  document.body.innerHTML = FOOTER;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (String(url).startsWith('/api/contribute') ? json(200, { available: true, member }) : json(401, {}))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-hosted');
  document.documentElement.removeAttribute('data-email-contributor');
});

const acct = () => document.querySelector<HTMLElement>('[data-gh-acct]')!;
const boot = async () => {
  const session = await import('./github-session');
  session.initGitHubConnect();
};

describe('the side nav account row', () => {
  it('opens a team never seen in this browser as its member: the server says so first, no guest check on GitHub', async () => {
    member = { email: 'florian@acme.design', name: 'Florian', role: 'edit' };
    const session = await import('./github-session');
    const access: (string | null)[] = [];
    session.onAccess((a) => access.push(a?.state ?? null));
    session.initGitHubConnect();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('connected'));
    await vi.waitFor(() => expect(acct().querySelector('[data-gh-perm]')!.textContent).toBe('Can edit'));
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.startsWith('https://api.github.com'))).toEqual([]);
    expect(access).not.toContain('anonymous-unknown');
  });

  it('a visitor with no session goes on as a guest once the server says nobody is signed in', async () => {
    const session = await import('./github-session');
    session.initGitHubConnect();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('readonly'));
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls[0]).toBe('/api/contribute?repo=acme%2Fds');
  });

  it('shows an email contributor signed in: name, email, Sign out, no sign-in button', async () => {
    member = { email: 'florian@acme.design', name: 'Florian', role: 'edit' };
    localStorage.setItem('bridge.contribute.member:acme/ds', JSON.stringify(member));
    await boot();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('connected'));
    expect(acct().hasAttribute('data-contributor')).toBe(true);
    expect(acct().querySelector('[data-gh-login]')!.textContent).toBe('Florian');
    expect(acct().querySelector('[data-gh-acct-role]')!.textContent).toBe('Can edit');
    expect(acct().querySelector<HTMLElement>('[data-gh-acct-role]')!.hidden).toBe(false);
    expect(acct().querySelector<HTMLElement>('[data-gh-acct-team]')!.hidden).toBe(true);
    const emailLine = acct().querySelector<HTMLElement>('[data-gh-menu-email]')!;
    expect(emailLine.hidden).toBe(false);
    expect(emailLine.textContent).toBe('florian@acme.design');
    expect(acct().querySelector('[data-gh-perm]')!.textContent).toBe('Can edit');
    // The drawn face, never initials.
    expect(acct().querySelector<HTMLElement>('[data-gh-avatar]')!.hidden).toBe(false);
    expect(acct().querySelector('[data-gh-avatar] > span[aria-hidden="true"]')!.textContent).toBe('');
    expect(acct().querySelector('[data-gh-menu-title]')!.textContent).toBe('Florian');
    expect(acct().querySelector('[data-gh-forget-label]')!.textContent).toBe('Sign out');
    // Named by what it shows (WCAG 2.5.3): no aria-label, the visible name first.
    expect(acct().querySelector('summary')!.hasAttribute('aria-label')).toBe(false);
    expect(acct().querySelector('summary')!.textContent!.replace(/\s+/g, ' ')).toMatch(/Florian.*account menu/);
  });

  it('turns signed in when the server says so, with nothing remembered in this browser', async () => {
    member = { email: 'florian@acme.design', name: 'Florian', role: 'edit' };
    await boot();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('connected'));
    expect(acct().querySelector<HTMLElement>('[data-gh-menu-email]')!.textContent).toBe('florian@acme.design');
  });

  it('asks to sign in, with the read-only line, only when there is no session at all', async () => {
    await boot();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('readonly'));
    expect(acct().hasAttribute('data-contributor')).toBe(false);
    expect(acct().querySelector<HTMLElement>('[data-gh-menu-email]')!.hidden).toBe(true);
    // A GitHub user's second line is the team's name, never owner/repo.
    expect(acct().querySelector<HTMLElement>('[data-gh-acct-team]')!.hidden).toBe(false);
    expect(acct().querySelector<HTMLElement>('[data-gh-acct-role]')!.hidden).toBe(true);
  });
});
