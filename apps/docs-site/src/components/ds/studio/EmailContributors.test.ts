// @vitest-environment jsdom
// Email contributors in Studio (lib/contribute.ts), from the keyboard, with axe: Settings > Members shows them with one
// "Email" tag, Can edit only (Reviewer and Admin disabled, with the reason) and an admin removes them; a signed-out
// visitor of a real team signs in with their email ("Check your inbox"), the Library gate's form.
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
  it('reads with one Email tag inline, stays Can edit with the reason, and an admin removes them', async () => {
    render(createElement(MembersSection));
    const row = (await screen.findByText('Leo')).closest('tr')!;
    expect(within(row).getByText('Email')).toBeInTheDocument();
    // Inline: the tag is inside the name, never its own cell.
    expect(within(row).getByText('Email').closest('.mem-name')).not.toBeNull();
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

  it('signs in with an email: the form unfolds, then Check your inbox', async () => {
    render(createElement(NoAccess, { screen: accessScreen('anonymous-unknown', f)!, repo: 'acme/ds' }));
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toHaveAttribute('data-gh-signin');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in with your email' }));
    const field = screen.getByRole('textbox', { name: 'Work email' });
    expect(field).toHaveFocus();
    await expectNoAxeViolations(document.body);
    await user.type(field, 'nope');
    await user.click(screen.getByRole('button', { name: 'Send me a link' }));
    expect(screen.getByText('Enter your work email, like name@company.com.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'leo@acme.design{Enter}');
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(contribute.requestEmailSignIn).toHaveBeenCalledWith('acme/ds', 'leo@acme.design');
    expect(screen.getByText(/If l•••@acme\.design is on this team, Bridge sent it a link\./)).toHaveAttribute('role', 'status');
    await expectNoAxeViolations(document.body);
  });

  it('opens the form at once, with the reason, when the link had expired', () => {
    render(createElement(NoAccess, { screen: accessScreen('anonymous-unknown', f)!, repo: 'acme/ds', emailExpired: true }));
    expect(screen.getByText('This link expired or was already used. Enter your email to get a new one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub instead' })).toHaveAttribute('data-gh-signin');
  });

  it('on a public team, the guest banner opens the same form in a dialog', async () => {
    render(createElement(NoAccess, { screen: accessScreen('anonymous-public', f)!, repo: 'acme/ds' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with your email' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign in with your email' });
    expect(within(dialog).getByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });
});
