// @vitest-environment jsdom
// The team chip's "Recent teams": a team joins only after its page read the repository, and each entry has its own
// remove action, a sibling menu item reachable with the arrow keys, that updates the list in place. Its "Your team"
// and "Try it" sections (board EmptyB), and the browser workspace's chip.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoAccessState } from '@bridge-ds/core';
import axe from 'axe-core';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { RECENT_TEAMS_KEY } from '../../../lib/access-view';
import TeamChip from './TeamChip';
import { setAccountFetch } from '../../../scripts/account-session';

const page = vi.hoisted(() => ({
  team: { owner: 'acme', repo: 'ds' },
  site: {} as { name?: string },
  viewer: null as { login: string; name?: string } | null,
  listeners: [] as ((a: { state: RepoAccessState } | null) => void)[],
}));

vi.mock('../../../scripts/repo-context', () => ({
  repoContext: () => ({ ...page.team, hosted: true }),
  siteConfig: () => page.site,
}));

vi.mock('../../../scripts/github-session', () => ({
  prefersSignIn: () => true,
  initGitHubConnect: (fn: (v: { login: string; name?: string } | null) => void) => fn(page.viewer),
  currentAccess: () => null,
  onAccess: (fn: (a: { state: RepoAccessState } | null) => void) => void page.listeners.push(fn),
  resolveAccess: async () => null,
}));

const stored = () => JSON.parse(localStorage.getItem(RECENT_TEAMS_KEY) ?? '[]') as string[];

async function openMenu() {
  const user = userEvent.setup();
  render(createElement(TeamChip, { launcher: true }));
  const trigger = await screen.findByRole('button', { name: /, team menu$/ });
  await user.click(trigger);
  const menu = await screen.findByRole('menu');
  return { user, menu };
}

beforeEach(() => {
  localStorage.clear();
  page.listeners = [];
  page.viewer = null;
  page.team = { owner: 'acme', repo: 'ds' };
  page.site = {};
});

describe('TeamChip recent teams', () => {
  it('cleans placeholders out of the list and does not remember the team before its access is known', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['owner/design', 'globex/tokens', 'owner/repo']));
    const { menu } = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Tokens' })).toBeInTheDocument();
    expect(within(menu).queryByText('Design')).toBeNull();
    expect(stored()).toEqual(['globex/tokens']);
  });

  it('remembers this team once the page read it, and forgets it on a 404', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens']));
    render(createElement(TeamChip, { launcher: true }));
    await waitFor(() => expect(page.listeners.length).toBeGreaterThan(0));
    // Every chip mounted so far hears it: a chip left from an earlier test may have registered first.
    act(() => page.listeners.forEach((l) => l({ state: 'anonymous-public' })));
    await waitFor(() => expect(stored()).toEqual(['acme/ds', 'globex/tokens']));
    act(() => page.listeners.forEach((l) => l({ state: 'anonymous-unknown' })));
    await waitFor(() => expect(stored()).toEqual(['globex/tokens']));
  });

  it('never remembers a team whose page did not load', async () => {
    page.team = { owner: 'typo', repo: 'nothing' };
    render(createElement(TeamChip, { launcher: true }));
    await waitFor(() => expect(page.listeners.length).toBeGreaterThan(0));
    act(() => page.listeners.forEach((l) => l({ state: 'no-access' })));
    act(() => page.listeners.forEach((l) => l({ state: 'not-installed' })));
    expect(localStorage.getItem(RECENT_TEAMS_KEY)).toBeNull();
    page.team = { owner: 'acme', repo: 'ds' };
  });

  it('removes one entry from the keyboard and keeps the menu open', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens', 'initech/ui']));
    const { user, menu } = await openMenu();
    const remove = within(menu).getByRole('menuitem', { name: 'Remove Tokens from recent teams' });
    // A sibling of the team's item, never nested inside it.
    expect(within(menu).getByRole('menuitem', { name: 'Tokens' })).not.toContainElement(remove);
    expect(remove.querySelector('button, a, [role="menuitem"]')).toBeNull();
    // Arrow keys reach it: down from the team item lands on its remove action.
    within(menu).getByRole('menuitem', { name: 'Tokens' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(remove).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Tokens' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Ui' })).toBeInTheDocument();
    expect(stored()).toEqual(['initech/ui']);
  });

  it('has no axe violations with recent teams listed', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens']));
    const { menu } = await openMenu();
    // Scoped to the menu, like the DS Menu tests: Base UI's focus guards outside it are its own business.
    await expectNoAxeViolations(menu);
  });
});

describe('TeamChip names the team', () => {
  it("goes by the team's name from bridge.config.json, owner/repo in its title, and remembers it for the recent teams", async () => {
    page.site = { name: 'Acme Studio' };
    render(createElement(TeamChip, { launcher: true }));
    // The menu button says the name, the role and the menu, never the repository.
    const trigger = await screen.findByRole('button', { name: 'Acme Studio, Guest, team menu' });
    expect(within(trigger).getByText('Acme Studio')).toHaveAttribute('title', 'Acme Studio, acme/ds');
    // Named by its visible text (WCAG 2.5.3), the avatar out of the name: no aria-label to drift from what it shows.
    expect(trigger).not.toHaveAttribute('aria-label');
    const mismatch = await axe.run(trigger, { runOnly: ['label-content-name-mismatch'] });
    expect(mismatch.violations).toEqual([]);
    await waitFor(() => expect(page.listeners.length).toBeGreaterThan(0));
    act(() => page.listeners.forEach((l) => l({ state: 'reader' })));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('bridge.teamNames') ?? '{}')).toEqual({ 'acme/ds': 'Acme Studio' }));
  });

  it('names a recent team by the name its page read, else its repository in words', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens', 'initech/ui-kit']));
    localStorage.setItem('bridge.teamNames', JSON.stringify({ 'globex/tokens': 'Globex Design' }));
    const { menu } = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Globex Design' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Ui kit' })).toBeInTheDocument();
    expect(within(menu).queryByText('globex/tokens')).toBeNull();
  });
});

describe('TeamChip "Your teams"', () => {
  it("on the person's own team, lists it first with a check and their role, never the empty workspace", async () => {
    page.viewer = { login: 'peterbono', name: 'Florian' };
    page.team = { owner: 'peterbono', repo: 'ai-design-system-demo' };
    page.site = { name: 'Bridge DS' };
    localStorage.setItem('bridge.start', JSON.stringify({ connect: true }));
    const user = userEvent.setup();
    render(createElement(TeamChip, { launcher: true }));
    await waitFor(() => expect(page.listeners.length).toBeGreaterThan(0));
    act(() => page.listeners.forEach((l) => l({ state: 'admin' })));
    await user.click(await screen.findByRole('button', { name: /^Bridge DS, .*team menu$/ }));
    const menu = await screen.findByRole('menu');
    const yours = within(menu).getByRole('group', { name: 'Your teams' });
    const here = within(yours).getByRole('menuitem', { name: /^Bridge DS/ });
    expect(here).toHaveAttribute('data-current');
    expect(within(here).getByText('Admin')).toBeInTheDocument();
    expect(within(here).getByLabelText('Current team')).toBeInTheDocument();
    expect(within(menu).queryByText(/workspace/)).toBeNull();
    expect(within(menu).queryByText('Not connected yet')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Invite collaborators' })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('bridge.teamRoles') ?? '{}')).toEqual({ 'peterbono/ai-design-system-demo': 'Admin' }));
    await expectNoAxeViolations(menu);
  });

  it('lists the other teams the person belongs to with their role, and only the rest under recent teams', async () => {
    page.viewer = { login: 'ann' };
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens', 'initech/ui-kit']));
    localStorage.setItem('bridge.teamRoles', JSON.stringify({ 'globex/tokens': 'Can edit' }));
    const { menu } = await openMenu();
    const yours = within(menu).getByRole('group', { name: 'Your teams' });
    const globex = within(yours).getByRole('menuitem', { name: /^Tokens/ });
    expect(globex).not.toHaveAttribute('data-current');
    expect(within(globex).getByText('Can edit')).toBeInTheDocument();
    const recent = within(menu).getByRole('group', { name: 'Recent teams' });
    expect(within(recent).queryByRole('menuitem', { name: 'Tokens' })).toBeNull();
    expect(within(recent).getByRole('menuitem', { name: 'Ui kit' })).toBeInTheDocument();
  });
});

describe('TeamChip "Your teams" from a Bridge account', () => {
  it("lists the account's teams with their role, each opening its own space, and no Sign in", async () => {
    setAccountFetch(async () =>
      new Response(JSON.stringify({ available: true, account: { email: 'leo@acme.design', name: 'Leo', github: null, teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'admin', via: 'email' }, { repo: 'globex/tokens', name: 'Globex', role: 'edit', via: 'email' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const { menu } = await openMenu();
    const yours = await within(menu).findByRole('group', { name: 'Your teams' });
    const globex = await within(yours).findByRole('menuitem', { name: /^Globex/ });
    expect(within(globex).getByText('Can edit')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Sign in' })).toBeNull();
    setAccountFetch(null);
  });
});

describe('TeamChip teams to switch to (board EmptyB)', () => {
  it('names the browser workspace after the viewer, current under "Your teams", with the demo under "Try it"', async () => {
    page.viewer = { login: 'ann-lee', name: 'Ann Lee' };
    page.team = { owner: 'peterbono', repo: 'ai-design-system-demo' };
    localStorage.setItem('bridge.start', JSON.stringify({ connect: true }));
    const user = userEvent.setup();
    render(createElement(TeamChip, { launcher: true, workspace: true }));
    const trigger = await screen.findByRole('button', { name: /Ann's workspace/ });
    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    const yours = within(menu).getByRole('group', { name: 'Your teams' });
    expect(within(yours).getByRole('menuitem', { name: /^Ann's workspace/ })).toHaveAttribute('data-current');
    expect(within(yours).getByText('Not connected yet')).toBeInTheDocument();
    const tryIt = within(menu).getByRole('group', { name: 'Try it' });
    expect(within(tryIt).getByRole('menuitem', { name: /^Acme Design/ })).toBeInTheDocument();
    expect(within(tryIt).getByText('Sample data, read only')).toBeInTheDocument();
    // No team link without a repository: nothing to invite to yet.
    expect(within(menu).queryByRole('menuitem', { name: 'Invite collaborators' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Create a new team' })).toBeInTheDocument();
    await expectNoAxeViolations(menu);
  });

  it('on the sample team, offers Invite collaborators even signed out, and opens the dialog over the page', async () => {
    page.team = { owner: 'peterbono', repo: 'bridge-demo-ds' };
    const user = userEvent.setup();
    render(createElement(TeamChip, { launcher: true }));
    await user.click(await screen.findByRole('button', { name: /Acme Design/ }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: 'Invite collaborators' }));
    expect(await screen.findByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
  });

  it('on a team, lists it under "Your teams" once, not again in the recent teams', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['acme/ds', 'globex/tokens']));
    const { menu } = await openMenu();
    expect(within(within(menu).getByRole('group', { name: 'Your teams' })).getByRole('menuitem', { name: /^Ds/ })).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem', { name: /^Ds/ })).toHaveLength(1);
    expect(within(menu).getByRole('menuitem', { name: 'Tokens' })).toBeInTheDocument();
  });

  it('on the demo, offers the workspace the visitor came from and not the demo again', async () => {
    page.team = { owner: 'peterbono', repo: 'bridge-demo-ds' };
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['peterbono/bridge-demo-ds', 'globex/tokens']));
    const user = userEvent.setup();
    render(createElement(TeamChip, { launcher: true }));
    await user.click(await screen.findByRole('button', { name: /Acme Design/ }));
    const menu = await screen.findByRole('menu');
    const yours = within(menu).getByRole('group', { name: 'Your teams' });
    expect(within(yours).getByRole('menuitem', { name: /^Tokens/ })).not.toHaveAttribute('data-current');
    expect(within(menu).queryByRole('group', { name: 'Try it' })).toBeNull();
  });

  it('on the demo without a workspace, shows no "Your teams"', async () => {
    page.team = { owner: 'peterbono', repo: 'bridge-demo-ds' };
    const user = userEvent.setup();
    render(createElement(TeamChip, { launcher: true }));
    await user.click(await screen.findByRole('button', { name: /Acme Design/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('group', { name: 'Your teams' })).toBeNull();
  });
});

describe('TeamChip pill and name, from the server', () => {
  it("shows an email admin's role from /api/contribute, Admin and never Can edit", async () => {
    const { setContributeFetch } = await import('../../../scripts/contribute-session');
    setContributeFetch(async () => new Response(JSON.stringify({ available: true, member: { email: 'leo@acme.design', name: 'Leo', role: 'admin' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    page.viewer = { login: 'leo', name: 'Leo' };
    render(createElement(TeamChip, { launcher: true }));
    await waitFor(() => expect(page.listeners.length).toBeGreaterThan(0));
    act(() => page.listeners.forEach((l) => l({ state: 'writer', contributor: true, admin: false } as never)));
    expect(await screen.findByRole('button', { name: 'Ds, Admin, team menu' })).toBeInTheDocument();
    setContributeFetch(null);
  });

  it('names the team from the first paint with the name the account keeps, before its settings are read', async () => {
    localStorage.setItem('bridge.accountTeamNames', JSON.stringify({ 'acme/ds': 'Mobile Kit Pro' }));
    render(createElement(TeamChip, { launcher: true }));
    expect(await screen.findByRole('button', { name: /^Mobile Kit Pro, .*team menu$/ })).toBeInTheDocument();
    expect(screen.queryByText('Ds')).toBeNull();
  });

  it("keeps the account's name once settings without a name are read, never the repository in words", async () => {
    localStorage.setItem('bridge.accountTeamNames', JSON.stringify({ 'acme/ds': 'Acme Build' }));
    page.site = { tokens: 'tokens' } as never;
    render(createElement(TeamChip, { launcher: true }));
    expect(await screen.findByRole('button', { name: /^Acme Build, .*team menu$/ })).toBeInTheDocument();
    act(() => void document.dispatchEvent(new Event('bridge:team-model')));
    expect(screen.getByRole('button', { name: /^Acme Build, .*team menu$/ })).toBeInTheDocument();
    expect(screen.queryByText('Ds')).toBeNull();
  });
});
