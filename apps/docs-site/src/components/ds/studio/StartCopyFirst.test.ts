// @vitest-environment jsdom
// Start an exploration on a product explored in the design team's copy that has none yet (added before Bridge made
// copies right at the add): Start makes the copy first, in the same action, with one short wait line, then starts.
// Never a "Make my copy" step for anyone; the GitHub tick (CopyAccessStep) only for an admin.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import StartExploration from './StartExploration';
import * as session from '../../../scripts/github-session';
import * as starting from '../../../scripts/exploration-start';
import * as copies from '../../../scripts/design-copy';
import type { StartedExploration } from '@bridge-ds/core';

const viewer = vi.hoisted(() => ({ access: { state: 'writer', write: true, admin: false, contributor: false } as Record<string, unknown> | null }));
// Spied modules (one object for every import, see StartExploration.test.ts).
vi.mock('../../../scripts/github-session', { spy: true });
vi.mock('../../../scripts/exploration-start', { spy: true });
vi.mock('../../../scripts/design-copy', { spy: true });

const SHOP = { key: 'shop', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' } };
const started: StartedExploration = {
  branch: 'explore/orders',
  slug: 'orders',
  pr: 4,
  url: 'https://github.com/acme/shop-design/pull/4',
  commit: 'abc',
  tryIt: { kind: 'none' } as unknown as StartedExploration['tryIt'],
  previews: [],
};

let embed: HTMLScriptElement;
beforeEach(() => {
  vi.mocked(session.onAccess).mockImplementation((fn) => {
    if (viewer.access) fn(viewer.access as unknown as session.RepoAccess);
  });
  vi.mocked(session.hasWorkingToken).mockReturnValue(true);
  vi.mocked(session.currentContributor).mockReturnValue(null);
  vi.mocked(session.currentViewer).mockReturnValue({ login: 'ann' } as unknown as ReturnType<typeof session.currentViewer>);
  vi.mocked(starting.explorationsConfig).mockReturnValue({ owner: 'acme', repo: 'ds', defaultBranch: 'main', apps: {}, packages: [] });
  embed = document.createElement('script');
  embed.id = 'bridge-repo';
  embed.type = 'application/json';
  embed.textContent = JSON.stringify({ owner: 'acme', repo: 'ds', products: [SHOP, { key: 'library', name: 'Library', default: true }] });
  document.body.append(embed);
});
afterEach(() => {
  embed.remove();
  vi.mocked(starting.startInProductRepo).mockReset();
  vi.mocked(copies.makeCopy).mockReset();
  viewer.access = { state: 'writer', write: true, admin: false, contributor: false };
});

async function startShop() {
  const user = userEvent.setup();
  render(createElement(StartExploration, { components: [], product: 'shop' }));
  await user.click(await screen.findByRole('button', { name: 'Start an exploration' }));
  await screen.findByRole('dialog');
  await user.type(screen.getByRole('textbox', { name: 'Describe it in a sentence' }), 'Orders page');
  await user.click(screen.getByRole('button', { name: 'Start with Claude AI' }));
  return user;
}

describe('Start an exploration makes the designers\' copy first', () => {
  it('one action: the short wait line, then the exploration starts, never "Make my copy"', async () => {
    let made!: (r: 'ready') => void;
    vi.mocked(starting.startInProductRepo)
      .mockResolvedValueOnce({ blocked: 'no-copy' })
      .mockResolvedValueOnce({ started });
    vi.mocked(copies.makeCopy).mockImplementation(() => new Promise((r) => (made = r)));
    await startShop();
    const wait = await screen.findByText('Getting Art print shop ready to explore. It takes about a minute.');
    expect(wait.closest('[data-copy-wait]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make my copy' })).toBeNull();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/make my copy|fork|repositor/i);
    await expectNoAxeViolations(document.body);
    made('ready');
    await screen.findByText('Ready for Claude AI');
    expect(copies.makeCopy).toHaveBeenCalledTimes(1);
    expect(starting.startInProductRepo).toHaveBeenCalledTimes(2);
  });

  it('only a tick on GitHub lets Bridge open it: an admin gets the one more step, anyone else who can finish it', async () => {
    const access = { kind: 'needs-access' as const, copy: 'acme/shop-design', name: 'shop-design', installation: { id: 42, account: { login: 'acme', type: 'Organization' }, repository_selection: 'selected' } };
    vi.mocked(starting.startInProductRepo).mockResolvedValue({ blocked: 'no-copy' });
    vi.mocked(copies.makeCopy).mockResolvedValue(access);
    const designer = await startShop();
    await screen.findByText('Art print shop is almost ready. Ask an admin to start its first exploration: that finishes the setup.');
    expect(screen.queryByRole('button', { name: 'Open GitHub' })).toBeNull();
    await designer.keyboard('{Escape}');
    document.body.innerHTML = '';
    document.body.append(embed);

    viewer.access = { state: 'admin', write: true, admin: true, contributor: false };
    await startShop();
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain("One more step: let Bridge open the designers' copy. Tick shop-design on GitHub, then Save."));
    expect(screen.getByRole('button', { name: 'Open GitHub' })).toBeTruthy();
  });
});
