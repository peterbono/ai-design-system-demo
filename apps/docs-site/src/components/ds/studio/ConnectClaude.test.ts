// @vitest-environment jsdom
// The consent card Claude opens when it adds the Bridge connector: signed out (sign in, come back to the same request,
// Allow), no team, one team, several teams, and Cancel back to Claude. The server is faked at the two calls the page
// makes (GET /oauth/request, POST /oauth/approve); location.assign is recorded instead of navigating.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';

const ID = 'abcdefghijklmnopqrstuvwx';
const PAGE = `/studio/connect-claude/?request=${ID}`;
let info: Record<string, unknown> = {};
const approvals: Record<string, unknown>[] = [];
const assigned: string[] = [];
const signOut = vi.fn(async () => {});
let githubToken: string | null = null;
vi.mock('../../../scripts/account-session', () => ({ signOut, workingGitHubToken: async () => githubToken }));
const { default: ConnectClaude } = await import('./ConnectClaude');

beforeEach(() => {
  approvals.length = 0;
  assigned.length = 0;
  signOut.mockClear();
  githubToken = null;
  delete document.documentElement.dataset.ownLibrary;
  localStorage.clear();
  history.replaceState(null, '', PAGE);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === 'https://api.github.com/repos/peterbono/ai-design-system-demo') return new Response(JSON.stringify({ permissions: { admin: true, push: true, pull: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('/oauth/request')) return new Response(JSON.stringify(info), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === '/oauth/approve') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      approvals.push(body);
      const redirect = body.allow ? 'https://github.com/login/oauth/authorize?state=s' : 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=st8&iss=x';
      return new Response(JSON.stringify({ redirect }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, pathname: '/studio/connect-claude/', search: `?request=${ID}`, assign: (u: string) => assigned.push(u) } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reply = (o: Record<string, unknown>) => (info = { client: 'Claude', redirectHost: 'claude.ai', sameBrowser: true, signedIn: true, name: 'Dana Kim', teams: [], ...o });

describe('Use Bridge in Claude: the consent card', () => {
  it('signed out: Sign in returns to this same request; back signed in, Allow goes on to GitHub', async () => {
    reply({ signedIn: false, name: null });
    const first = render(createElement(ConnectClaude));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(assigned[0]).toBe(`/signin/?next=${encodeURIComponent(PAGE)}`);
    expect(first.container.textContent).not.toMatch(/come back here/i);
    first.unmount();
    // Sign-in brought the person back to the same address, now signed in with one team.
    reply({ teams: [{ repo: 'acme/design', name: 'Acme Design' }] });
    render(createElement(ConnectClaude));
    expect(await screen.findByText('Acme Design')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(approvals).toEqual([{ request: ID, allow: true, repo: 'acme/design' }]));
    expect(assigned.at(-1)).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/);
  });

  it('no team with a design system: says so, offers Create your team, an invite, another account, and Cancel', async () => {
    reply({});
    const { container } = render(createElement(ConnectClaude));
    expect(await screen.findByText("Your Bridge account isn't in a team with a design system yet.")).toBeTruthy();
    expect(screen.getByText(/ask your admin for an invite/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create your team' }));
    expect(assigned.at(-1)).toContain('setup=create');
    await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(assigned.at(-1)).toBe(`/signin/?next=${encodeURIComponent(PAGE)}`);
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("an admin of the site's own team with zero Bridge account teams picks it (regression: 'You are not in a team yet')", async () => {
    document.documentElement.dataset.ownLibrary = 'peterbono/ai-design-system-demo';
    githubToken = 'ghu_signed_in_token_0000000000';
    reply({ teams: [] });
    render(createElement(ConnectClaude));
    expect(await screen.findByText('ai-design-system-demo')).toBeTruthy();
    expect(screen.queryByText("Your Bridge account isn't in a team with a design system yet.")).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(approvals[0]).toMatchObject({ allow: true, repo: 'peterbono/ai-design-system-demo' }));
  });

  it('one team: preselected, with what Claude gets', async () => {
    reply({ teams: [{ repo: 'acme/design', name: 'Acme Design' }] });
    const { container } = render(createElement(ConnectClaude));
    expect(await screen.findByText('Acme Design')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('Read your design system')).toBeTruthy();
    expect(screen.getByText('Open changes for review in your name')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('several teams: a picker, and Allow sends the one picked', async () => {
    reply({ teams: [{ repo: 'acme/web', name: 'Web' }, { repo: 'acme/design', name: 'Acme Design' }] });
    render(createElement(ConnectClaude));
    expect(await screen.findByRole('radiogroup')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Web' }));
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(approvals[0]).toMatchObject({ allow: true, repo: 'acme/web' }));
  });

  it('Cancel goes back to Claude with access_denied, signed in or not', async () => {
    for (const o of [{ signedIn: false }, {}, { teams: [{ repo: 'acme/design', name: 'Acme Design' }] }]) {
      approvals.length = 0;
      reply(o);
      render(createElement(ConnectClaude));
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(approvals).toEqual([{ request: ID, allow: false }]));
      expect(assigned.at(-1)).toContain('error=access_denied');
      cleanup();
    }
  });
});
