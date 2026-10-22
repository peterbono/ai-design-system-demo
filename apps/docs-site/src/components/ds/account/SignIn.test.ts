// @vitest-environment jsdom
// The one sign-in screen (/signin/), against the /api/account contract with the network mocked: Continue with email
// sends a code, a pasted "123 456" is checked at once, a new account without a name is asked "Your name" once and goes to
// "How do you want to start?", a known one goes back to the page it came from. Errors in designer words, resend on a
// cooldown, Get started wording, a site without accounts keeps GitHub only, the GitHub way links the sign-in. Axe clean.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { setAccountFetch } from '../../../scripts/account-session';
import { GITHUB_PENDING_KEY } from '../../../lib/account';
import SignIn, { navigate } from './SignIn';

const gh = vi.hoisted(() => ({ token: null as string | null, startSignIn: vi.fn(async () => {}) }));
vi.mock('../../../scripts/github-session', () => ({
  hasWorkingToken: () => Boolean(gh.token),
  getToken: () => gh.token,
  startSignIn: gh.startSignIn,
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Call = { method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let calls: Call[] = [];
let reply: (c: Call) => Response;
const account = (over: Record<string, unknown> = {}) => ({ email: 'leo@acme.design', name: 'Leo', github: null, teams: [], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  gh.token = null;
  calls = [];
  sessionStorage.clear();
  reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(200, { ok: true }));
  setAccountFetch(async (_url, init) => {
    const c = { method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(c);
    return reply(c);
  });
  vi.spyOn(navigate, 'to').mockImplementation(() => {});
  history.replaceState(null, '', '/signin/?next=%2Fstudio%2Facme%2Fds%2Ftokens%2F');
});

afterEach(() => {
  setAccountFetch(null);
  vi.useRealTimers();
});

const posts = (action: string) => calls.filter((c) => c.body?.action === action);

/** The email field, once the screen knows nobody is signed in (it is disabled while it asks). */
async function emailField() {
  const field = await screen.findByRole('textbox', { name: 'Continue with email' });
  await waitFor(() => expect(field).toBeEnabled());
  return field;
}

describe('sign-in screen, email', () => {
  it('sends a code, checks a pasted code at once and goes back to the page it came from', async () => {
    reply = (c) => {
      if (c.method === 'GET') return json(200, { available: true, account: null });
      if (c.body?.action === 'verify') return json(200, { account: account({ teams: [{ repo: 'acme/ds', role: 'edit', via: 'email' }] }), created: false, next: '/studio/acme/ds/' });
      return json(200, { ok: true });
    };
    const { container } = render(createElement(SignIn));
    expect(await screen.findByRole('heading', { name: 'Sign in to Bridge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'What Bridge keeps about you' })).toHaveAttribute('href', '/privacy/');
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.type(await emailField(), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByText('Enter your work email, like name@company.com.')).toBeInTheDocument();
    expect(posts('code')).toHaveLength(0);
    await user.clear(screen.getByRole('textbox', { name: 'Continue with email' }));
    await user.type(screen.getByRole('textbox', { name: 'Continue with email' }), 'leo@acme.design{Enter}');
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(posts('code')[0]!.body).toEqual({ action: 'code', email: 'leo@acme.design' });
    expect(posts('code')[0]!.headers['X-Bridge-Account']).toBe('1');
    const field = screen.getByRole('textbox', { name: 'Code' });
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    await waitFor(() => expect(field).toHaveFocus());
    await expectNoAxeViolations(container);
    await user.click(field);
    await user.paste('123 456');
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/ds/tokens/'));
    expect(posts('verify')[0]!.body).toEqual({ action: 'verify', email: 'leo@acme.design', code: '123456' });
    expect(document.documentElement.hasAttribute('data-account')).toBe(true);
  });

  it('says a wrong code in designer words and keeps the field', async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : c.body?.action === 'verify' ? json(400, { error: 'bad-code' }) : json(200, { ok: true }));
    render(createElement(SignIn));
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    const field = await screen.findByRole('textbox', { name: 'Code' });
    await user.type(field, '12');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter the 6 digits from the email.')).toBeInTheDocument();
    await user.type(field, '3456');
    expect(await screen.findByText('That code does not match. Check the latest email and try again.')).toBeInTheDocument();
    expect(navigate.to).not.toHaveBeenCalled();
  });

  it("says the server's own sentence when the daily cap is reached", async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(429, { error: 'rate', message: 'Bridge sent enough codes to this email today. Try again tomorrow, or continue with GitHub.' }));
    render(createElement(SignIn));
    await userEvent.setup().type(await emailField(), 'leo@acme.design{Enter}');
    expect(await screen.findByText('Bridge sent enough codes to this email today. Try again tomorrow, or continue with GitHub.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your inbox' })).toBeNull();
  });

  it('follows the server for a brand new GitHub account', async () => {
    gh.token = 'ghu_new';
    sessionStorage.setItem(GITHUB_PENDING_KEY, '1');
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(200, { account: account({ github: { login: 'leo', id: 1 } }), created: true, next: '/studio/' }));
    render(createElement(SignIn));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/'));
  });

  it('lets a new code go out only after the cooldown, and goes back to another email', async () => {
    render(createElement(SignIn));
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    const resend = await screen.findByRole('button', { name: /Send a new code in \d+ s/ });
    expect(resend).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use another email' }));
    expect(screen.getByRole('textbox', { name: 'Continue with email' })).toBeInTheDocument();
  });

  it('asks a new account its name once, then opens How do you want to start?', async () => {
    reply = (c) => {
      if (c.method === 'GET') return json(200, { available: true, account: null });
      if (c.body?.action === 'verify') return json(200, { account: account({ name: null }), created: true, next: '/start/' });
      if (c.body?.action === 'rename') return json(200, { account: account({ name: 'Leo Martin' }) });
      return json(200, { ok: true });
    };
    history.replaceState(null, '', '/signin/?new=1');
    const { container } = render(createElement(SignIn));
    expect(await screen.findByRole('heading', { name: 'Get started with Bridge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the demo' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    await user.type(await screen.findByRole('textbox', { name: 'Code' }), '123456');
    expect(await screen.findByRole('heading', { name: 'One last thing' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Add your name, so your team knows who made a change.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Leo Martin{Enter}');
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/start/'));
    expect(posts('rename')[0]!.body).toEqual({ action: 'rename', name: 'Leo Martin' });
  });
});

describe('sign-in screen, the other ways', () => {
  it('sends a signed-in account straight on', async () => {
    reply = () => json(200, { available: true, account: account() });
    render(createElement(SignIn));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/ds/tokens/'));
  });

  it('keeps GitHub only on a site without accounts', async () => {
    reply = () => new Response('<html></html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    render(createElement(SignIn));
    expect(await screen.findByText('Email sign-in is not available on this site yet. Continue with GitHub.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('leaves for GitHub, then turns the GitHub sign-in into the account on the way back', async () => {
    const { unmount } = render(createElement(SignIn));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue with GitHub' }));
    await waitFor(() => expect(gh.startSignIn).toHaveBeenCalledWith('/signin/?next=%2Fstudio%2Facme%2Fds%2Ftokens%2F'));
    expect(sessionStorage.getItem(GITHUB_PENDING_KEY)).toBe('1');
    unmount();
    // Back from GitHub with a token.
    gh.token = 'ghu_abc';
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(200, { account: account({ github: { login: 'leo', id: 1 } }), created: false, next: '/studio/acme/ds/' }));
    await act(async () => {
      render(createElement(SignIn));
    });
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/ds/tokens/'));
    expect(posts('github')[0]!.body).toEqual({ action: 'github', token: 'ghu_abc' });
    expect(sessionStorage.getItem(GITHUB_PENDING_KEY)).toBeNull();
  });
});
