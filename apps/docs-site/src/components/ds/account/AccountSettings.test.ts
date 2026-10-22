// @vitest-environment jsdom
// Settings > Account and the account menu, against the /api/account contract with the network mocked: the name and
// email with Rename, Link GitHub with the reason, the teams with their role, Sign out everywhere, Delete my account
// confirmed in the page (type DELETE, never window.confirm) with the last-admin refusal said in place. The side nav
// row and its menu read the same account. Axe clean.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { setAccountFetch } from '../../../scripts/account-session';
import AccountSettings, { AccountBand, navigate } from './AccountSettings';
import AccountMenu from './AccountMenu';

const gh = vi.hoisted(() => ({ token: null as string | null, startSignIn: vi.fn(async () => {}) }));
vi.mock('../../../scripts/github-session', () => ({
  hasWorkingToken: () => Boolean(gh.token),
  getToken: () => gh.token,
  startSignIn: gh.startSignIn,
  initGitHubConnect: () => {},
  currentViewer: () => null,
}));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'ds', defaultBranch: 'main', hosted: true }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Call = { method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let calls: Call[] = [];
let reply: (c: Call) => Response;
const ACCOUNT = {
  email: 'leo@acme.design',
  name: 'Leo',
  github: null,
  teams: [
    { repo: 'acme/ds', name: 'Acme Design', role: 'admin', via: 'email' },
    { repo: 'acme/web', name: null, role: 'edit', via: 'email' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  gh.token = null;
  calls = [];
  reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: ACCOUNT }) : json(200, { ok: true }));
  setAccountFetch(async (_url, init) => {
    const c = { method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(c);
    return reply(c);
  });
  vi.spyOn(navigate, 'to').mockImplementation(() => {});
  vi.spyOn(window, 'confirm');
  history.replaceState(null, '', '/studio/acme/ds/settings/');
  document.documentElement.setAttribute('data-hosted', '');
});

afterEach(() => {
  setAccountFetch(null);
  document.documentElement.removeAttribute('data-hosted');
  document.documentElement.removeAttribute('data-account');
});

const posts = (action: string) => calls.filter((c) => c.body?.action === action);

describe('Settings > Account', () => {
  it('shows the account, its teams and roles, and why to link GitHub', async () => {
    const { container } = render(createElement(AccountBand));
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('leo@acme.design')).toBeInTheDocument();
    expect(screen.getByText('GitHub not linked')).toBeInTheDocument();
    expect(screen.getByText('Reviewers and admins approve on GitHub: link your GitHub account.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Design' })).toHaveAttribute('href', '/studio/~/acme/ds/');
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Web' })).toBeInTheDocument();
    expect(screen.getByText('Can edit')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('renames in place', async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: ACCOUNT }) : json(200, { account: { ...ACCOUNT, name: 'Leo Martin' } }));
    render(createElement(AccountSettings));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Your name' });
    await user.clear(field);
    await user.type(field, 'Leo Martin{Enter}');
    expect(await screen.findByText('Leo Martin')).toBeInTheDocument();
    expect(posts('rename')[0]!.body).toEqual({ action: 'rename', name: 'Leo Martin' });
    expect(screen.getByRole('status')).toHaveTextContent('Name saved.');
  });

  it('links GitHub at once with the GitHub sign-in this browser has, else through GitHub', async () => {
    render(createElement(AccountSettings));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Link GitHub' }));
    await waitFor(() => expect(gh.startSignIn).toHaveBeenCalledWith('/signin/?next=%2Fstudio%2Facme%2Fds%2Fsettings%2F'));
    expect(posts('github')).toHaveLength(0);
  });

  it('deletes only once DELETE is typed, and says the last-admin refusal in place', async () => {
    reply = (c) =>
      c.method === 'GET'
        ? json(200, { available: true, account: ACCOUNT })
        : json(409, { error: 'last-admin', message: 'You are the only admin of Acme Design. Make someone else an admin first, then delete your account.' });
    const { container } = render(createElement(AccountSettings));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const confirm = screen.getByRole('textbox', { name: 'Type DELETE to confirm' });
    expect(confirm).toHaveFocus();
    const del = screen.getAllByRole('button', { name: 'Delete my account' }).at(-1)!;
    expect(del).toBeDisabled();
    await user.type(confirm, 'delete');
    expect(del).toBeDisabled();
    await user.clear(confirm);
    await user.type(confirm, 'DELETE');
    expect(del).toBeEnabled();
    await expectNoAxeViolations(container);
    await user.click(del);
    expect(await screen.findByText('You are the only admin of Acme Design. Make someone else an admin first, then delete your account.')).toBeInTheDocument();
    expect(posts('delete')).toHaveLength(1);
    expect(navigate.to).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('sends the GitHub sign-in along with a delete when GitHub is linked, then leaves', async () => {
    gh.token = 'ghu_abc';
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: { ...ACCOUNT, github: { login: 'leo', id: 1 } } }) : json(200, { ok: true }));
    render(createElement(AccountSettings));
    const user = userEvent.setup();
    expect(await screen.findByText('GitHub @leo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.type(screen.getByRole('textbox', { name: 'Type DELETE to confirm' }), 'DELETE{Enter}');
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/'));
    expect(posts('delete')[0]!.headers.Authorization).toBe('Bearer ghu_abc');
    expect(posts('delete')[0]!.headers['X-Bridge-Account']).toBe('1');
  });

  it('signs out everywhere and leaves', async () => {
    render(createElement(AccountSettings));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/'));
    expect(posts('sign-out-everywhere')).toHaveLength(1);
  });

  it('keeps the GitHub connection as it was when there is no account', async () => {
    reply = () => json(200, { available: true, account: null });
    render(createElement(AccountSettings, null, createElement('p', null, 'GitHub connection')));
    expect(await screen.findByText('GitHub connection')).toBeInTheDocument();
  });
});

describe('the account menu', () => {
  it('names the person and their role on this team, with Link GitHub, Account settings and Sign out', async () => {
    const { container } = render(createElement(AccountMenu));
    const trigger = await screen.findByRole('button', { name: 'Signed in as Leo. Account menu' });
    expect(within(trigger).getByText('Admin')).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.hasAttribute('data-account')).toBe(true));
    await expectNoAxeViolations(container);
    await userEvent.setup().click(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('leo@acme.design')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Link GitHub' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Account settings' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('shows nothing signed out', async () => {
    reply = () => json(200, { available: true, account: null });
    const { container } = render(createElement(AccountMenu));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container.innerHTML).toBe('');
  });
});
