// @vitest-environment jsdom
// Connect Figma (the plugin's "Sign in with Bridge"): the teams to pick are the team switcher's, so an admin of the
// site's own design system with no Bridge account team can connect Figma to it (regression: "You are not in a team yet").
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const approvals: Record<string, unknown>[] = [];
vi.mock('../../../scripts/account-session', () => ({
  getAccount: async () => ({ available: true, account: { email: 'florian@example.com', name: 'Florian', nameSet: true, github: { login: 'peterbono', id: 1 }, teams: [] } }),
  workingGitHubToken: async () => 'ghu_signed_in_token_0000000000',
}));
vi.mock('../../../scripts/github-session', () => ({ readAppSession: () => null, refreshSignIn: async () => true }));
const { default: ConnectFigma } = await import('./ConnectFigma');

beforeEach(() => {
  approvals.length = 0;
  localStorage.clear();
  document.documentElement.dataset.ownLibrary = 'peterbono/ai-design-system-demo';
  history.replaceState(null, '', '/studio/connect-figma/?code=ABCDEFGHIJ');
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === 'https://api.github.com/repos/peterbono/ai-design-system-demo') return new Response(JSON.stringify({ permissions: { admin: true, push: true, pull: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/plugin-link') {
      approvals.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ approved: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.ownLibrary;
});

describe('Connect Figma: the teams to pick', () => {
  it("an admin of the site's own team with zero Bridge account teams can connect Figma to it", async () => {
    render(createElement(ConnectFigma));
    expect(await screen.findByText('ai-design-system-demo')).toBeTruthy();
    expect(screen.queryByText(/You are not in a team yet/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Connect Figma' }));
    await waitFor(() => expect(approvals[0]).toMatchObject({ action: 'approve', code: 'ABCDEFGHIJ', repo: 'peterbono/ai-design-system-demo' }));
  });
});
