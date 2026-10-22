// @vitest-environment jsdom
// Settings, Library access: an admin changes who reads the library (the work email choice unfolds its domains), a
// member reads it, the sample team only opens the demo dialog, a site without the server says so, and everyone can copy
// the library link. Keyboard and axe.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import type { AccessData } from '../../../scripts/library-access-settings';
import LibraryAccessSection from './LibraryAccessSection';

const page = vi.hoisted(() => ({ data: null as unknown as AccessData }));
const demo = vi.hoisted(() => ({ openMakeItYours: vi.fn(async () => {}) }));
const api = vi.hoisted(() => {
  class AccessUnavailable extends Error {
    constructor() {
      super('Library access is not available yet on this site.');
      this.name = 'AccessUnavailable';
    }
  }
  return {
    AccessUnavailable,
    saveLibraryAccess: vi.fn(async (_repo: string, mode: string, domains: string[]) => ({ mode, domains })),
  };
});

vi.mock('../../../scripts/library-access-settings', () => ({ loadAccessSettings: async () => page.data }));
vi.mock('../../../scripts/demo-gate', () => demo);
vi.mock('../../../scripts/library-access-api', () => api);

const real = (over: Partial<AccessData> = {}): AccessData => ({
  context: 'real',
  repo: 'acme/ds',
  team: 'acme/ds',
  setting: { mode: 'team', domains: [] },
  stored: false,
  canManage: true,
  isPrivate: true,
  available: true,
  link: 'https://bridge.example.com/library/acme/ds/',
  ...over,
});

const sample = (): AccessData => ({ ...real(), context: 'sample', repo: 'peterbono/bridge-demo-ds', team: 'Acme Design', setting: { mode: 'email', domains: ['acme.design'] }, stored: true, isPrivate: null });

beforeEach(() => {
  vi.clearAllMocks();
  page.data = real();
});

describe('Settings, Library access', () => {
  it('an admin opens the library to work emails: the domains field unfolds under that choice only, then Save', async () => {
    const user = userEvent.setup();
    render(createElement(LibraryAccessSection));
    expect(await screen.findByRole('heading', { name: 'Library access' })).toBeInTheDocument();
    expect(await screen.findByText('Only the team')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.queryByRole('textbox', { name: 'Work email domains' })).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Anyone with a work email at/ }));
    const field = await screen.findByRole('textbox', { name: 'Work email domains' });
    await user.type(field, '@Acme.design, acme.studio');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveLibraryAccess).toHaveBeenCalledWith('acme/ds', 'email', ['acme.design', 'acme.studio']));
    expect(await screen.findByText('Saved. Anyone with a work email at acme.design and acme.studio reads the library now.')).toBeInTheDocument();
    expect(screen.getByText('Anyone with a work email at acme.design and acme.studio')).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it('says what is wrong with a domain before anything is sent', async () => {
    const user = userEvent.setup();
    render(createElement(LibraryAccessSection));
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('radio', { name: /Anyone with a work email at/ }));
    await user.type(await screen.findByRole('textbox', { name: 'Work email domains' }), 'gmail.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Anyone can get an email at gmail.com. Pick your company domain, or choose Anyone with the link.')).toBeInTheDocument();
    expect(api.saveLibraryAccess).not.toHaveBeenCalled();
  });

  it('says the server sentence when it refuses, and keeps the form', async () => {
    api.saveLibraryAccess.mockRejectedValueOnce(Object.assign(new Error('Only admins can change who reads the library.'), { name: 'AccessError' }));
    const user = userEvent.setup();
    render(createElement(LibraryAccessSection));
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('radio', { name: /Anyone with the link/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only admins can change who reads the library.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('a member reads the same card as an admin, with Change disabled and why', async () => {
    page.data = real({ canManage: false, setting: { mode: 'email', domains: ['acme.design'] } });
    render(createElement(LibraryAccessSection));
    expect(await screen.findByText('Anyone with a work email at acme.design')).toBeInTheDocument();
    expect(screen.getByText('Who reads your design system library. Readers need no GitHub account.')).toBeInTheDocument();
    const change = screen.getByRole('button', { name: 'Change' });
    expect(change).toBeDisabled();
    expect(change).toHaveAccessibleDescription('Only admins can change this.');
    expect(screen.getByRole('button', { name: 'Copy library link' })).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
  });

  it('copies the library link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(createElement(LibraryAccessSection));
    expect(await screen.findByText('https://bridge.example.com/library/acme/ds/')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy library link' }));
    expect(writeText).toHaveBeenCalledWith('https://bridge.example.com/library/acme/ds/');
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it('says it is not available yet on a site without the server, and offers no Change', async () => {
    page.data = real({ available: false, setting: { mode: 'anyone', domains: [] }, isPrivate: false });
    render(createElement(LibraryAccessSection));
    expect(await screen.findByText(/Library access is not available yet on this site\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('says the files of a public repository stay readable on GitHub when the library is gated', async () => {
    page.data = real({ isPrivate: false, setting: { mode: 'email', domains: ['acme.design'] } });
    render(createElement(LibraryAccessSection));
    expect(await screen.findByText('The repository is public on GitHub, so its files stay readable there.')).toBeInTheDocument();
  });

  it('on the sample team, shows the sample choice and Save opens the demo dialog, with no call', async () => {
    page.data = sample();
    const user = userEvent.setup();
    render(createElement(LibraryAccessSection));
    expect(await screen.findByText('Anyone with a work email at acme.design')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('textbox', { name: 'Work email domains' })).toHaveValue('acme.design');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(demo.openMakeItYours).toHaveBeenCalled());
    expect(api.saveLibraryAccess).not.toHaveBeenCalled();
    expect(screen.getByText('Anyone with a work email at acme.design')).toBeInTheDocument();
  });
});
