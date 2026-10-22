// @vitest-environment jsdom
// Settings > Account: an email contributor gets the same compact row as a GitHub user (drawn face, "Signed in as" with
// Can edit, their email, Sign out that ends the email session and opens the team's sign-in screen); a GitHub owner's
// badge is the team chip's Admin, never Can edit.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';

const s = vi.hoisted(() => ({
  viewer: null as null | { login: string; avatar_url: string; name?: string; email?: string },
  access: null as null | { state: string; write: boolean; admin: boolean },
  signOutEmail: vi.fn(async () => {}),
}));

vi.mock('../../../scripts/github-session', () => ({
  currentViewer: () => s.viewer,
  getToken: () => (s.viewer ? 'token' : null),
  initGitHubConnect: (cb: (v: unknown) => void) => cb(s.viewer),
  onAccess: (cb: (a: unknown) => void) => cb(s.access),
  sessionMode: () => 'app',
  tokenRejected: () => false,
}));
vi.mock('../../../scripts/contribute-session', () => ({ signOutEmail: s.signOutEmail }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main', hosted: true }) }));

import SettingsAccount, { ContributorAccountBand } from './SettingsAccount';

beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, '', '/studio/acme/ds/settings/');
  document.documentElement.setAttribute('data-hosted', '');
});

describe('Settings > Account', () => {
  it('gives an email contributor their account row and a Sign out that opens the team sign-in', async () => {
    s.viewer = { login: 'goulou@example.com', avatar_url: '', name: 'Goulou Photographie', email: 'goulou@example.com' };
    s.access = { state: 'writer', write: true, admin: false };
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, pathname: '/studio/acme/ds/settings/', assign });
    const { container } = render(createElement(ContributorAccountBand));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('You joined with your email. Bridge saves your changes to the library for you.')).toBeInTheDocument();
    expect(screen.getByText(/Signed in as Goulou Photographie/)).toBeInTheDocument();
    expect(screen.getByText('Can edit')).toBeInTheDocument();
    expect(screen.getByText('goulou@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/Sign in with GitHub|Connected as/)).toBeNull();
    await expectNoAxeViolations(container);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/studio/acme/ds/?signin='));
    expect(s.signOutEmail).toHaveBeenCalledWith('acme/ds');
    vi.unstubAllGlobals();
  });

  it('shows nothing on a team for someone who is not an email contributor', () => {
    s.viewer = { login: 'ana', avatar_url: '' };
    const { container } = render(createElement(ContributorAccountBand));
    expect(container.innerHTML).toBe('');
  });

  it("badges an owner Admin, like the team chip, and names the team, never owner/repo", async () => {
    s.viewer = { login: 'peterbono', avatar_url: '' };
    s.access = { state: 'admin', write: true, admin: true };
    render(createElement(SettingsAccount, { repo: 'peterbono/ai-design-system-demo', signIn: true }));
    expect(await screen.findByText('Connected as @peterbono')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Can edit')).toBeNull();
    expect(screen.getByText('Bridge DS')).toBeInTheDocument();
  });
});
