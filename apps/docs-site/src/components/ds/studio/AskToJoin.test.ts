// @vitest-environment jsdom
// "Ask to join the team" on a team's address (NoAccess.tsx AskButton, lib/access-view.ts): the request goes to the
// admins inside Bridge; an earlier request shows as sent; without a Bridge account, the GitHub sign-in makes one first;
// when Bridge cannot send it, the ready message is copied and the page says so.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { accessScreen, ASK_WORDS } from '../../../lib/access-view';
import { NoAccess } from './NoAccess';

const acc = vi.hoisted(() => ({ account: null as null | { teams: { repo: string }[] }, token: null as string | null, signIn: vi.fn() }));
const entry = vi.hoisted(() => ({ asked: false, ask: vi.fn() }));

vi.mock('../../../scripts/account-session', () => ({
  getAccount: async () => ({ available: true, account: acc.account }),
  workingGitHubToken: async () => acc.token,
  signInWithGitHub: (t: string) => acc.signIn(t),
}));
vi.mock('../../../scripts/entry-session', () => ({
  askedToJoin: async () => entry.asked,
  askToJoin: (repo: string) => entry.ask(repo),
}));

const base = { owner: 'acme', repo: 'ds', login: 'sam', link: 'https://bridge.example.com/studio/acme/ds/', asks: true };

beforeEach(() => {
  acc.account = { teams: [] };
  acc.token = null;
  acc.signIn.mockReset();
  entry.asked = false;
  entry.ask.mockReset();
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe('access-view: Ask to join the team', () => {
  it('asks inside Bridge on the hosted site, copies a message elsewhere, never names GitHub on the hosted banner', () => {
    const hosted = accessScreen('outside-contributor', base)!;
    expect(hosted.primary).toMatchObject({ kind: 'ask', label: 'Ask to join the team', repo: 'acme/ds' });
    expect(hosted.body).not.toContain('GitHub');
    expect(accessScreen('outside-contributor', { ...base, asks: false })!.primary).toMatchObject({ kind: 'copy' });
  });

  it('offers it to a Bridge account that is not on the team, and keeps Sign in for a guest', () => {
    expect(accessScreen('anonymous-public', { ...base, account: true })!.primary).toMatchObject({ kind: 'ask' });
    expect(accessScreen('anonymous-public', { ...base, account: false })!.primary).toMatchObject({ kind: 'signin' });
  });
});

describe('the Ask to join button', () => {
  const show = () => render(createElement(NoAccess, { screen: accessScreen('outside-contributor', base)! }));

  it('sends the request and says an admin lets them in', async () => {
    entry.ask.mockResolvedValue({ requested: true });
    const { container } = show();
    await userEvent.click(await screen.findByRole('button', { name: 'Ask to join the team' }));
    // The click handler awaits two dynamic imports before it sends: wait for the call, never assume it already ran.
    await waitFor(() => expect(entry.ask).toHaveBeenCalledWith('acme/ds'));
    expect(await screen.findByText(ASK_WORDS.sent)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask to join the team' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows an earlier request as sent, from the server', async () => {
    entry.asked = true;
    show();
    expect(await screen.findByText(ASK_WORDS.sent)).toBeInTheDocument();
  });

  it('signs in with GitHub first when there is no Bridge account', async () => {
    acc.account = null;
    acc.token = 'ghu_' + 'x'.repeat(36);
    acc.signIn.mockResolvedValue({});
    entry.ask.mockResolvedValue({ requested: true });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Ask to join the team' }));
    await waitFor(() => expect(acc.signIn).toHaveBeenCalledWith(acc.token));
    expect(await screen.findByText(ASK_WORDS.sent)).toBeInTheDocument();
  });

  it('copies the message and says so when Bridge cannot send it', async () => {
    entry.ask.mockRejectedValue(Object.assign(new Error('no'), { status: 404 }));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Ask to join the team' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    // Visible, and said once to a screen reader.
    expect(await screen.findAllByText(ASK_WORDS.fallback)).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent(ASK_WORDS.fallback);
  });
});
