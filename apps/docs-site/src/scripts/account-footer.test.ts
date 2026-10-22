// @vitest-environment jsdom
// The account row at the foot of the Studio side nav (components/GitHubAccount.astro), painted by
// scripts/github-session.ts. An email contributor signed in on a real team gets the same signed-in row a GitHub user
// gets: the DS drawn face (no initials), their name, their email as the second line, the menu with Sign out. Never a
// sign-in button. "Read only until you sign in" is only for a visitor with no session at all. The network is mocked.
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
      <summary class="gh-acct-who" aria-label="GitHub account">
        <span class="avatar" data-gh-avatar hidden><span aria-hidden="true">GH</span></span>
        <span class="gh-acct-text">
          <span class="gh-acct-login" data-gh-login></span>
          <span class="gh-acct-repo mono" data-team-name data-gh-acct-repo>acme/ds</span>
          <span class="gh-acct-repo" data-gh-email hidden></span>
        </span>
      </summary>
      <div class="menu-panel"><p data-gh-menu-title>GitHub</p><dd data-gh-login-full></dd>
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
  it('shows an email contributor signed in: name, email, Sign out, no sign-in button', async () => {
    member = { email: 'florian@acme.design', name: 'Florian', role: 'edit' };
    localStorage.setItem('bridge.contribute.member:acme/ds', JSON.stringify(member));
    await boot();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('connected'));
    expect(acct().hasAttribute('data-contributor')).toBe(true);
    expect(acct().querySelector('[data-gh-login]')!.textContent).toBe('Florian');
    const emailLine = acct().querySelector<HTMLElement>('[data-gh-email]')!;
    expect(emailLine.hidden).toBe(false);
    expect(emailLine.textContent).toBe('florian@acme.design');
    expect(acct().querySelector<HTMLElement>('[data-gh-acct-repo]')!.hidden).toBe(true);
    // The drawn face, never initials.
    expect(acct().querySelector<HTMLElement>('[data-gh-avatar]')!.hidden).toBe(false);
    expect(acct().querySelector('[data-gh-avatar] > span[aria-hidden="true"]')!.textContent).toBe('');
    expect(acct().querySelector('[data-gh-menu-title]')!.textContent).toBe('Your account');
    expect(acct().querySelector('[data-gh-forget-label]')!.textContent).toBe('Sign out');
    expect(acct().querySelector('summary')!.getAttribute('aria-label')).toBe('Your account: Florian. Account menu');
  });

  it('turns signed in when the server says so, with nothing remembered in this browser', async () => {
    member = { email: 'florian@acme.design', name: 'Florian', role: 'edit' };
    await boot();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('connected'));
    expect(acct().querySelector<HTMLElement>('[data-gh-email]')!.textContent).toBe('florian@acme.design');
  });

  it('asks to sign in, with the read-only line, only when there is no session at all', async () => {
    await boot();
    await vi.waitFor(() => expect(acct().dataset.state).toBe('readonly'));
    expect(acct().hasAttribute('data-contributor')).toBe(false);
    expect(acct().querySelector<HTMLElement>('[data-gh-email]')!.hidden).toBe(true);
    expect(acct().querySelector<HTMLElement>('[data-gh-acct-repo]')!.hidden).toBe(false);
  });
});
