// @vitest-environment jsdom
// The gate of a team's Library: "Enter your work email" and its states (link sent, wrong domain, link expired, not
// available yet), "This library is open to its team", the sample team that never asks, and the link from the email
// (its token leaves the address at once). Keyboard and axe.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { AccessAnswer } from '../../../lib/library-access';
import LibraryGate, { useLibraryGate } from './LibraryGate';

const session = vi.hoisted(() => ({ github: false }));
const data = vi.hoisted(() => ({ openLibrary: vi.fn() }));
const api = vi.hoisted(() => {
  class AccessUnavailable extends Error {
    constructor() {
      super('Library access is not available yet on this site.');
      this.name = 'AccessUnavailable';
    }
  }
  return {
    AccessUnavailable,
    answer: null as unknown as AccessAnswer,
    libraryAccess: vi.fn(async (): Promise<AccessAnswer> => api.answer),
    verifySignIn: vi.fn(async () => ({ domain: 'acme.design' })),
    requestSignIn: vi.fn(async () => {}),
  };
});

vi.mock('../../../scripts/github-session', () => ({ hasWorkingToken: () => session.github }));
vi.mock('../../../scripts/team-data', () => data);
vi.mock('../../../scripts/library-access-api', () => api);

function Harness({ owner = 'acme', repo = 'ds' }: { owner?: string; repo?: string }) {
  const team = { owner, repo };
  const state = useLibraryGate(team);
  if (state.step === 'checking') return createElement('p', null, 'checking');
  if (state.step === 'open') return createElement('p', null, 'the library');
  return createElement(LibraryGate, { team, state });
}

const emailAnswer = (session: AccessAnswer['session'] = null): AccessAnswer => ({ available: true, setting: { mode: 'email', domains: ['acme.design'], source: 'bridge' }, session });

beforeEach(() => {
  vi.clearAllMocks();
  session.github = false;
  api.answer = emailAnswer();
  history.replaceState(null, '', '/library/acme/ds/');
});

describe('the Library gate', () => {
  it('asks for a work email, says a wrong domain on the field, and sends nothing for it', async () => {
    const user = userEvent.setup();
    render(createElement(Harness));
    expect(await screen.findByRole('heading', { level: 1, name: 'Read the design system library' })).toBeInTheDocument();
    expect(screen.getByText('This library is open to people with an @acme.design email. Enter yours and Bridge sends you a link to open it.')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.type(screen.getByRole('textbox', { name: 'Work email' }), 'mia@gmail.com{Enter}');
    expect(await screen.findByText('This library is open to @acme.design emails. Ask your design system team for access.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Work email' })).toHaveAttribute('aria-invalid', 'true');
    expect(api.requestSignIn).not.toHaveBeenCalled();
    expect(data.openLibrary).not.toHaveBeenCalled();
    await expectNoAxeViolations(document.body);
  });

  it('sends the link and says to check the inbox, with the address masked', async () => {
    const user = userEvent.setup();
    render(createElement(Harness));
    await user.type(await screen.findByRole('textbox', { name: 'Work email' }), 'Mia@Acme.design');
    await user.click(screen.getByRole('button', { name: 'Send me a link' }));
    await waitFor(() => expect(api.requestSignIn).toHaveBeenCalledWith('acme/ds', 'Mia@Acme.design'));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Bridge sent a link to m•••@acme.design. Open it on this device. It works once, for 15 minutes.');
    expect(screen.getByRole('button', { name: 'Use another email' })).toHaveFocus();
    await expectNoAxeViolations(document.body);
    await user.click(screen.getByRole('button', { name: 'Use another email' }));
    expect(await screen.findByRole('textbox', { name: 'Work email' })).toHaveValue('');
  });

  it("says the server's sentence when it caps or refuses", async () => {
    api.requestSignIn.mockRejectedValueOnce(new Error('Bridge already sent a few links to this email today. Use the latest one, or try again tomorrow.'));
    const user = userEvent.setup();
    render(createElement(Harness));
    await user.type(await screen.findByRole('textbox', { name: 'Work email' }), 'mia@acme.design{Enter}');
    expect(await screen.findByText('Bridge already sent a few links to this email today. Use the latest one, or try again tomorrow.')).toBeInTheDocument();
  });

  it('says email sign-in is not available yet when the site cannot send it', async () => {
    api.requestSignIn.mockRejectedValueOnce(new api.AccessUnavailable());
    const user = userEvent.setup();
    render(createElement(Harness));
    await user.type(await screen.findByRole('textbox', { name: 'Work email' }), 'mia@acme.design{Enter}');
    expect(await screen.findByText('Email sign-in is not available yet on this site. Ask your design system team how to read this library.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('spends the link from the email, takes the token out of the address, and opens the library from this site', async () => {
    const token = 'k'.repeat(43);
    history.replaceState(null, '', `/library/acme/ds/#signin=${token}`);
    api.libraryAccess.mockResolvedValueOnce(emailAnswer({ domain: 'acme.design' }));
    render(createElement(Harness));
    expect(await screen.findByText('the library')).toBeInTheDocument();
    expect(api.verifySignIn).toHaveBeenCalledWith('acme/ds', token);
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/library/acme/ds/');
    expect(data.openLibrary).toHaveBeenCalledWith(true);
  });

  it('says an expired link above the field', async () => {
    history.replaceState(null, '', `/library/acme/ds/#signin=${'k'.repeat(43)}`);
    api.verifySignIn.mockRejectedValueOnce(new Error('This link expired or was already used. Enter your email to get a new one.'));
    render(createElement(Harness));
    expect(await screen.findByText('This link expired or was already used. Enter your email to get a new one.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
    expect(location.hash).toBe('');
  });

  it('opens to its team only: Sign in from Studio', async () => {
    api.answer = { available: true, setting: { mode: 'team', domains: [] }, session: null };
    render(createElement(Harness));
    expect(await screen.findByRole('heading', { name: 'This library is open to its team' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in from Studio' })).toHaveAttribute('href', expect.stringContaining('acme/ds'));
    await expectNoAxeViolations(document.body);
  });

  it('opens as before for a GitHub sign-in, a site without the feature, and the sample team (no call)', async () => {
    session.github = true;
    const a = render(createElement(Harness));
    expect(await screen.findByText('the library')).toBeInTheDocument();
    expect(data.openLibrary).toHaveBeenLastCalledWith(false);
    a.unmount();

    session.github = false;
    api.answer = { available: false, setting: null, session: null };
    const b = render(createElement(Harness));
    expect(await screen.findByText('the library')).toBeInTheDocument();
    b.unmount();

    api.libraryAccess.mockClear();
    render(createElement(Harness, { owner: 'peterbono', repo: 'bridge-demo-ds' }));
    expect(await screen.findByText('the library')).toBeInTheDocument();
    expect(api.libraryAccess).not.toHaveBeenCalled();
  });
});
