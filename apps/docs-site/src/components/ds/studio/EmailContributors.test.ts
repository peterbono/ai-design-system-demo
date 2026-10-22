// @vitest-environment jsdom
// Email contributors in Studio (lib/contribute.ts), from the keyboard, with axe: Settings > Members shows them with no
// tag of their own, Can edit only (Reviewer and Admin disabled, with the reason) and an admin removes them; a signed-out
// visitor of a real team gets Continue with email, which opens the one sign-in screen of Bridge (/signin/).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { accessScreen } from '../../../lib/access-view';
import type { MembersData } from '../../../scripts/members';
import MembersSection from './MembersSection';
import { NoAccess } from './NoAccess';

const page = vi.hoisted(() => ({ data: null as unknown as MembersData }));
const api = vi.hoisted(() => ({
  removeMember: vi.fn(async () => ({ ok: true })),
  removeEmailMember: vi.fn(async () => ({ ok: true })),
  setMemberRole: vi.fn(async () => ({ ok: true })),
}));
const contribute = vi.hoisted(() => ({ requestEmailSignIn: vi.fn(async () => {}) }));

vi.mock('../../../scripts/members', () => ({ loadMembers: async () => page.data }));
vi.mock('../../../scripts/invites-api', () => api);
vi.mock('../../../scripts/contribute-session', () => contribute);

const team = (): MembersData => ({
  context: 'real',
  repo: 'acme/ds',
  team: 'acme/ds',
  members: [
    { login: 'flo', name: 'Florian', role: 'admin', reviews: ['design'], you: true },
    { login: 'leo@acme.design', name: 'Leo', role: 'edit', reviews: [], email: 'leo@acme.design', via: 'email' },
  ],
  pending: [],
  people: [],
  canManage: true,
  personal: false,
  complete: true,
  invites: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  page.data = team();
});

describe('Settings > Members, an email contributor', () => {
  it('reads like any member (no Email tag), stays Can edit with the reason, and an admin removes them', async () => {
    render(createElement(MembersSection));
    const row = (await screen.findByText('Leo')).closest('tr')!;
    // No tag of their own: an email member reads like any member.
    expect(within(row).queryByText('Email')).toBeNull();
    await expectNoAxeViolations(document.body);

    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Role for Leo: Can edit' }));
    expect(await screen.findByText('Reviewers and admins approve changes on GitHub. Invite them with the email of their GitHub account.')).toBeInTheDocument();
    const off = (name: RegExp) => screen.getByRole('radio', { name }).getAttribute('aria-disabled') === 'true';
    expect(off(/Reviewer/)).toBe(true);
    expect(off(/Admin/)).toBe(true);
    expect(off(/Can edit/)).toBe(false);
    await user.keyboard('{Escape}');

    await user.click(within(row).getByRole('button', { name: 'More for Leo' }));
    expect(screen.queryByRole('menuitem', { name: 'Make admin' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from team' }));
    expect(screen.getByText('Remove Leo from acme/ds? They are signed out at once.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.removeEmailMember).toHaveBeenCalledWith('acme/ds', 'leo@acme.design'));
    expect(api.removeMember).not.toHaveBeenCalled();
  });
});

describe('a real team, signed out', () => {
  const f = { owner: 'acme', repo: 'ds', link: 'https://bridge.example/studio/acme/ds/', email: true };

  it('signs in with GitHub first; Continue with email opens the one sign-in screen, back to this page', async () => {
    history.replaceState(null, '', '/studio/acme/ds/tokens/');
    const { container } = render(createElement(NoAccess, { screen: accessScreen('anonymous-unknown', f)!, repo: 'acme/ds' }));
    expect(screen.getByRole('heading', { name: 'Sign in to open Ds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toHaveAttribute('data-gh-signin');
    expect(document.documentElement.hasAttribute('data-signin-card')).toBe(true);
    expect(screen.getByText('Invited with your email?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with email' })).toHaveAttribute('href', '/signin/?next=%2Fstudio%2Facme%2Fds%2Ftokens%2F');
    // No per-team email form any more.
    expect(screen.queryByRole('textbox')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('says an older sign-in link expired, under the way in', () => {
    render(createElement(NoAccess, { screen: accessScreen('anonymous-unknown', f)!, repo: 'acme/ds', emailExpired: true }));
    expect(screen.getByText('This link expired or was already used. Enter your email to get a new one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with email' })).toBeInTheDocument();
  });

  it('on a public team, the guest banner links to the same sign-in screen', async () => {
    history.replaceState(null, '', '/studio/acme/ds/');
    const { container } = render(createElement(NoAccess, { screen: accessScreen('anonymous-public', f)!, repo: 'acme/ds' }));
    expect(screen.getByRole('link', { name: 'Continue with email' })).toHaveAttribute('href', '/signin/?next=%2Fstudio%2Facme%2Fds%2F');
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectNoAxeViolations(container);
  });
});
