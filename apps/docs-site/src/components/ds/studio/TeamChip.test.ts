// @vitest-environment jsdom
// The team chip's "Recent teams": a team joins only after its page read the repository, and each entry has its own
// remove action, a sibling menu item reachable with the arrow keys, that updates the list in place.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoAccessState } from '@bridge-ds/core';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { RECENT_TEAMS_KEY } from '../../../lib/access-view';
import TeamChip from './TeamChip';

const page = vi.hoisted(() => ({
  team: { owner: 'acme', repo: 'ds' },
  listeners: [] as ((a: { state: RepoAccessState } | null) => void)[],
}));

vi.mock('../../../scripts/repo-context', () => ({
  repoContext: () => ({ ...page.team, hosted: true }),
}));

vi.mock('../../../scripts/github-session', () => ({
  prefersSignIn: () => true,
  initGitHubConnect: (fn: (v: null) => void) => fn(null),
  currentAccess: () => null,
  onAccess: (fn: (a: { state: RepoAccessState } | null) => void) => void page.listeners.push(fn),
  resolveAccess: async () => null,
}));

const stored = () => JSON.parse(localStorage.getItem(RECENT_TEAMS_KEY) ?? '[]') as string[];

async function openMenu() {
  const user = userEvent.setup();
  render(createElement(TeamChip, { launcher: true }));
  const trigger = await screen.findByRole('button', { name: /acme\/ds/ });
  await user.click(trigger);
  const menu = await screen.findByRole('menu');
  return { user, menu };
}

beforeEach(() => {
  localStorage.clear();
  page.listeners = [];
});

describe('TeamChip recent teams', () => {
  it('cleans placeholders out of the list and does not remember the team before its access is known', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['owner/design', 'globex/tokens', 'owner/repo']));
    const { menu } = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'globex/tokens' })).toBeInTheDocument();
    expect(within(menu).queryByText('owner/design')).toBeNull();
    expect(stored()).toEqual(['globex/tokens']);
  });

  it('remembers this team once the page read it, and forgets it on a 404', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens']));
    render(createElement(TeamChip, { launcher: true }));
    await waitFor(() => expect(page.listeners.length).toBe(1));
    act(() => page.listeners[0]!({ state: 'anonymous-public' }));
    await waitFor(() => expect(stored()).toEqual(['acme/ds', 'globex/tokens']));
    act(() => page.listeners[0]!({ state: 'anonymous-unknown' }));
    await waitFor(() => expect(stored()).toEqual(['globex/tokens']));
  });

  it('never remembers a team whose page did not load', async () => {
    page.team = { owner: 'typo', repo: 'nothing' };
    render(createElement(TeamChip, { launcher: true }));
    await waitFor(() => expect(page.listeners.length).toBe(1));
    act(() => page.listeners[0]!({ state: 'no-access' }));
    act(() => page.listeners[0]!({ state: 'not-installed' }));
    expect(localStorage.getItem(RECENT_TEAMS_KEY)).toBeNull();
    page.team = { owner: 'acme', repo: 'ds' };
  });

  it('removes one entry from the keyboard and keeps the menu open', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens', 'initech/ui']));
    const { user, menu } = await openMenu();
    const remove = within(menu).getByRole('menuitem', { name: 'Remove globex/tokens from recent teams' });
    // A sibling of the team's item, never nested inside it.
    expect(within(menu).getByRole('menuitem', { name: 'globex/tokens' })).not.toContainElement(remove);
    expect(remove.querySelector('button, a, [role="menuitem"]')).toBeNull();
    // Arrow keys reach it: down from the team item lands on its remove action.
    within(menu).getByRole('menuitem', { name: 'globex/tokens' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(remove).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'globex/tokens' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'initech/ui' })).toBeInTheDocument();
    expect(stored()).toEqual(['initech/ui']);
  });

  it('has no axe violations with recent teams listed', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['globex/tokens']));
    const { menu } = await openMenu();
    // Scoped to the menu, like the DS Menu tests: Base UI's focus guards outside it are its own business.
    await expectNoAxeViolations(menu);
  });
});
