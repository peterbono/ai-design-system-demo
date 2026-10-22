// @vitest-environment jsdom
// The invite page when the signed-in GitHub account does not have the invited email (api/invites accept): it says
// where the invite was sent (masked) and how to fix it, grants nothing, and keeps the link for another try.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import InviteAccept, { INVITE_TOKEN_KEY } from './InviteAccept';

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
  return { InvitesUnavailable, InvitesError, acceptInvite: vi.fn() };
});

vi.mock('../../../scripts/github-session', () => ({ initGitHubConnect: (cb: (v: unknown) => void) => cb({ login: 'leo' }) }));
vi.mock('../../../scripts/invites-api', () => api);

const TOKEN = 'T'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  history.replaceState(null, '', `/studio/invite/#t=${TOKEN}`);
});

describe('invite page, another email', () => {
  it('names the masked address and the fix, and tries again with the same link', async () => {
    api.acceptInvite.mockRejectedValueOnce(new api.InvitesError('x', 'email_mismatch', 403, { sentTo: 'm•••@acme.design', login: 'leo' }));
    api.acceptInvite.mockResolvedValueOnce({ status: 'joined', repo: 'acme/ds', role: 'edit' });
    render(createElement(InviteAccept));
    expect(await screen.findByRole('heading', { name: 'This invitation is for another email' })).toBeInTheDocument();
    expect(screen.getByText(/It was sent to m•••@acme\.design, which is not an email of your GitHub account @leo\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add the email on GitHub/ })).toHaveAttribute('href', 'https://github.com/settings/emails');
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    await expectNoAxeViolations(document.body);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.acceptInvite).toHaveBeenCalledTimes(2));
    expect(api.acceptInvite).toHaveBeenLastCalledWith(TOKEN);
    expect(await screen.findByRole('heading', { name: "You're in acme/ds" })).toBeInTheDocument();
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
