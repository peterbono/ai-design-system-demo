// @vitest-environment jsdom
// The invite page. A "Can edit" invite joins with an email and a name, no GitHub (scripts/contribute-session.ts); a
// reviewer or admin invite signs in with GitHub. When the signed-in GitHub account does not have the invited email
// (api/invites accept), it says where the invite was sent (masked) and how to fix it, grants nothing, and keeps the
// link for another try.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import InviteAccept, { INVITE_TOKEN_KEY, navigate } from './InviteAccept';

const api = vi.hoisted(() => {
  class InvitesUnavailable extends Error {}
  class InvitesError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly status: number,
      readonly details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  }
  return { InvitesUnavailable, InvitesError, acceptInvite: vi.fn(), peekInvite: vi.fn() };
});

const contribute = vi.hoisted(() => {
  class ContributeError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { ContributeError, acceptEmailInvite: vi.fn() };
});

const gh = vi.hoisted(() => ({ viewer: { login: 'leo' } as { login: string } | null, startSignIn: vi.fn() }));

vi.mock('../../../scripts/github-session', () => ({ initGitHubConnect: (cb: (v: unknown) => void) => cb(gh.viewer), startSignIn: gh.startSignIn }));
vi.mock('../../../scripts/invites-api', () => api);
vi.mock('../../../scripts/contribute-session', () => contribute);

const TOKEN = 'T'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  gh.viewer = { login: 'leo' };
  api.peekInvite.mockResolvedValue({ repo: 'acme/ds', team: 'Acme Design', role: 'reviewer', sentTo: 'm•••@acme.design' });
  sessionStorage.clear();
  history.replaceState(null, '', `/studio/invite/#t=${TOKEN}`);
});

describe('invite page, another email', () => {
  it('names the masked address and the signed-in account, and checks again when the tab comes back', async () => {
    api.acceptInvite.mockRejectedValueOnce(new api.InvitesError('x', 'email_mismatch', 403, { sentTo: 'm•••@acme.design', login: 'leo' }));
    api.acceptInvite.mockResolvedValueOnce({ status: 'joined', repo: 'acme/ds', role: 'edit' });
    render(createElement(InviteAccept));
    expect(await screen.findByRole('heading', { name: 'This invitation is for another email' })).toBeInTheDocument();
    expect(screen.getByText("It was sent to m•••@acme.design. You're signed in to GitHub as @leo.")).toBeInTheDocument();
    expect(screen.getByText('GitHub uses the account open in this browser. Switch accounts on github.com first if needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use another GitHub account' })).toHaveAttribute('data-gh-forget');
    expect(screen.getByRole('link', { name: /Add this email to @leo on GitHub/ })).toHaveAttribute('href', 'https://github.com/settings/emails');
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    await expectNoAxeViolations(document.body);
    // Back from GitHub's email settings in another tab: the page checks again on its own.
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledTimes(2));
    expect(api.acceptInvite).toHaveBeenLastCalledWith(TOKEN);
    expect(await screen.findByRole('heading', { name: "You're in Acme Design" })).toBeInTheDocument();
  });

  it('asks to verify an unverified email, and to sign in again when emails cannot be read', async () => {
    api.acceptInvite.mockRejectedValueOnce(new api.InvitesError('x', 'email_unverified', 403, { sentTo: 'm•••@acme.design', login: 'leo' }));
    const { unmount } = render(createElement(InviteAccept));
    expect(await screen.findByRole('heading', { name: 'Verify your email on GitHub first' })).toBeInTheDocument();
    unmount();
    history.replaceState(null, '', `/studio/invite/#t=${TOKEN}`);
    api.acceptInvite.mockRejectedValueOnce(new api.InvitesError('x', 'email_access', 403));
    render(createElement(InviteAccept));
    expect(await screen.findByRole('heading', { name: 'Sign in again to join' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toHaveAttribute('data-gh-signin');
  });
});

describe('invite page, Can edit', () => {
  it('joins with an email and a name, then opens the team signed in', async () => {
    gh.viewer = null;
    api.peekInvite.mockResolvedValue({ repo: 'acme/ds', team: 'Acme Design', role: 'edit', sentTo: 'l•••@acme.design' });
    contribute.acceptEmailInvite.mockResolvedValue({ repo: 'acme/ds', member: { email: 'leo@acme.design', name: 'Leo', role: 'edit' } });
    const assign = vi.spyOn(navigate, 'to').mockImplementation(() => {});
    render(createElement(InviteAccept));
    expect(await screen.findByRole('heading', { name: 'Join Acme Design on Bridge' })).toBeInTheDocument();
    expect(screen.getByText(/sent to l•••@acme\.design/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I use GitHub, sign in with GitHub instead' })).toHaveAttribute('data-gh-signin');
    await expectNoAxeViolations(document.body);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Join Acme Design' }));
    expect(await screen.findByText('Add your name, so your team knows who made a change.')).toBeInTheDocument();
    expect(contribute.acceptEmailInvite).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Your name'), 'Leo Martin');
    await user.click(screen.getByRole('button', { name: 'Join Acme Design' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/studio/~/acme/ds/'));
    expect(contribute.acceptEmailInvite).toHaveBeenCalledWith(TOKEN, 'Leo Martin');
    expect(api.acceptInvite).not.toHaveBeenCalled();
  });

  it('sends a reviewer invite the server could not name to GitHub', async () => {
    gh.viewer = null;
    api.peekInvite.mockResolvedValue(null);
    contribute.acceptEmailInvite.mockRejectedValue(new contribute.ContributeError('x', 'github-required', 409));
    render(createElement(InviteAccept));
    expect(await screen.findByRole('heading', { name: 'Join the team on Bridge' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your name'), 'Ann');
    await user.click(screen.getByRole('button', { name: 'Join the team' }));
    expect(await screen.findByText(/This invitation is for a reviewer or an admin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toHaveAttribute('data-gh-signin');
  });
});

describe('invite page, reviewer or admin, signed out', () => {
  it('signs in with GitHub, with a way to create an account', async () => {
    gh.viewer = null;
    render(createElement(InviteAccept));
    expect(await screen.findByRole('button', { name: 'Sign in with GitHub' })).toHaveAttribute('data-gh-signin');
    const create = screen.getByRole('link', { name: /Create a free account with this email/ });
    expect(create).toHaveAttribute('href', 'https://github.com/signup');
    expect(create).toHaveAttribute('target', '_blank');
    expect(screen.queryByLabelText('Your name')).toBeNull();
    await expectNoAxeViolations(document.body);
  });
});
