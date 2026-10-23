// @vitest-environment jsdom
// The one sign-in screen (/signin/, boards E1 to E5), against the /api/account and /api/entry contracts with the
// network mocked: email only (no GitHub on a site with accounts), Send code, a pasted "123 456" is checked at once, a
// new account without a name is asked "Your name" once, a known one goes back to the page it came from (?next=). With
// no ?next=, Bridge picks the room: one team, the most recent of several, the picker (E5), an invite (E3), a team
// found by work domain (E4, then E4b), or "Create your team" (E6). Errors in designer words, resend on a cooldown, a
// site without accounts keeps GitHub only, the way back from GitHub links the sign-in. Axe clean.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { setAccountFetch } from '../../../scripts/account-session';
import { setEntryFetch } from '../../../scripts/entry-session';
import { RECENT_TEAMS_KEY } from '../../../lib/access-view';
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
type EntryCall = { url: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let entryCalls: EntryCall[] = [];
let entryReply: (c: EntryCall) => Response;
const account = (over: Record<string, unknown> = {}) => ({ email: 'leo@acme.design', name: 'Leo', github: null, teams: [], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  gh.token = null;
  calls = [];
  sessionStorage.clear();
  localStorage.clear();
  entryCalls = [];
  entryReply = () => json(200, { kind: 'create' });
  setEntryFetch(async (url, init) => {
    const c = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> };
    entryCalls.push(c);
    return entryReply(c);
  });
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
  setEntryFetch(null);
  vi.useRealTimers();
});

const posts = (action: string) => calls.filter((c) => c.body?.action === action);

/** The email field, once the screen knows nobody is signed in (it is disabled while it asks). */
async function emailField() {
  const field = await screen.findByRole('textbox', { name: 'Work email' });
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
    expect(await screen.findByRole('heading', { name: 'Welcome to Bridge' })).toBeInTheDocument();
    expect(screen.getByText("Use your work email. We'll take you to your team, or help you start one.")).toBeInTheDocument();
    // Email only: GitHub comes back where a repository is linked, and in Settings.
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send code' }).className).toMatch(/primary/);
    expect(await screen.findByRole('link', { name: 'Open the demo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'What Bridge keeps about you' })).toHaveAttribute('href', '/privacy/');
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.type(await emailField(), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByText('Enter your work email, like name@company.com.')).toBeInTheDocument();
    expect(posts('code')).toHaveLength(0);
    await user.clear(screen.getByRole('textbox', { name: 'Work email' }));
    await user.type(screen.getByRole('textbox', { name: 'Work email' }), 'leo@acme.design{Enter}');
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
    // ?next= wins: Bridge does not pick a room.
    expect(entryCalls).toHaveLength(0);
  });

  it('checks a code once: Enter right after the 6th digit does not send it again', async () => {
    let release: () => void = () => {};
    reply = (c) => {
      if (c.method === 'GET') return json(200, { available: true, account: null });
      return json(200, { ok: true });
    };
    setAccountFetch(async (_url, init) => {
      const c = { method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> };
      calls.push(c);
      if (c.body?.action === 'verify') {
        await new Promise<void>((ok) => (release = ok));
        return json(200, { account: account({ teams: [{ repo: 'acme/ds', role: 'edit', via: 'email' }] }), created: false, next: '' });
      }
      return reply(c);
    });
    render(createElement(SignIn));
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    const field = await screen.findByRole('textbox', { name: 'Code' });
    await user.type(field, '123456');
    await user.keyboard('{Enter}');
    await act(async () => release());
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/ds/tokens/'));
    await user.keyboard('{Enter}');
    expect(posts('verify')).toHaveLength(1);
    // The account's email team knows its member before the page opens: no "Sign in to open" there.
    expect(JSON.parse(localStorage.getItem('bridge.contribute.member:acme/ds') ?? 'null')).toEqual({ email: 'leo@acme.design', name: 'Leo', role: 'edit' });
  });

  it("says You're signed out once, above the email field", async () => {
    history.replaceState(null, '', '/signin/?next=%2Fstudio%2Facme%2Fds%2F&bye=out');
    const { container } = render(createElement(SignIn));
    expect(await screen.findByText("You're signed out.")).toBeInTheDocument();
    await emailField();
    expect(location.search).toBe('?next=%2Fstudio%2Facme%2Fds%2F');
    await expectNoAxeViolations(container);
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

  it('says how many tries are left, and after the last one a new code can go out at once', async () => {
    let tries = 2;
    reply = (c) => {
      if (c.method === 'GET') return json(200, { available: true, account: null });
      if (c.body?.action === 'verify') return tries-- > 1 ? json(400, { error: 'wrong-code', message: 'This code is not the one we sent.', triesLeft: 1 }) : json(410, { error: 'expired', message: 'This code expired or was used too many times. Ask for a new one.' });
      return json(200, { ok: true });
    };
    render(createElement(SignIn));
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    const field = await screen.findByRole('textbox', { name: 'Code' });
    expect(screen.getByRole('button', { name: /Send a new code in/ })).toBeDisabled();
    await user.type(field, '111111');
    expect(await screen.findByText('This code is not the one we sent. 1 try left.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '222222');
    expect(await screen.findByText('This code expired or was used too many times. Ask for a new one.')).toBeInTheDocument();
    const resend = screen.getByRole('button', { name: 'Send a new code' });
    expect(resend).toBeEnabled();
    await user.click(resend);
    await waitFor(() => expect(posts('code')).toHaveLength(2));
  });

  it('on the daily limit, "I have a code" opens the code field', async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : c.body?.action === 'code' ? json(429, { error: 'limit', message: 'Bridge already sent a few codes today. Use the latest one, or try again tomorrow.' }) : json(200, { account: account(), created: false, next: '' }));
    render(createElement(SignIn));
    const user = userEvent.setup();
    const email = await emailField();
    expect(email).toHaveFocus();
    await user.type(email, 'leo@acme.design{Enter}');
    await user.click(await screen.findByRole('button', { name: 'I have a code' }));
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Code' }), '123456');
    await waitFor(() => expect(posts('verify')[0]!.body).toEqual({ action: 'verify', email: 'leo@acme.design', code: '123456' }));
  });

  it("says the server's own sentence when the daily cap is reached", async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(429, { error: 'rate', message: 'Bridge sent enough codes to this email today. Try again tomorrow, or continue with GitHub.' }));
    render(createElement(SignIn));
    await userEvent.setup().type(await emailField(), 'leo@acme.design{Enter}');
    expect(await screen.findByText('Bridge sent enough codes to this email today. Try again tomorrow, or continue with GitHub.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your inbox' })).toBeNull();
  });

  it('picks the room of a brand new GitHub account, with its GitHub sign-in so the server finds its teams', async () => {
    gh.token = 'ghu_new';
    sessionStorage.setItem(GITHUB_PENDING_KEY, '1');
    history.replaceState(null, '', '/signin/');
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(200, { account: account({ github: { login: 'leo', id: 1 } }), created: true, next: '/studio/' }));
    entryReply = () => json(200, { kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'admin', via: 'github' }] });
    render(createElement(SignIn));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/~/acme/ds/'));
    expect(entryCalls[0]!.headers.Authorization).toBe('Bearer ghu_new');
  });

  it('lets a new code go out only after the cooldown, and goes back to another email', async () => {
    render(createElement(SignIn));
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    const resend = await screen.findByRole('button', { name: /Send a new code in \d+ s/ });
    expect(resend).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Use another email' }));
    expect(screen.getByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
  });

  it('asks a new account its name once, then opens Create your team', async () => {
    reply = (c) => {
      if (c.method === 'GET') return json(200, { available: true, account: null });
      if (c.body?.action === 'verify') return json(200, { account: account({ name: null }), created: true, next: '/start/' });
      if (c.body?.action === 'rename') return json(200, { account: account({ name: 'Leo Martin' }) });
      return json(200, { ok: true });
    };
    history.replaceState(null, '', '/signin/?new=1');
    const { container } = render(createElement(SignIn));
    // Get started lands on the same screen: no sign in or sign up choice.
    expect(await screen.findByRole('heading', { name: 'Welcome to Bridge' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open the demo' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(await emailField(), 'leo@acme.design{Enter}');
    await user.type(await screen.findByRole('textbox', { name: 'Code' }), '123456');
    expect(await screen.findByRole('heading', { name: 'One last thing: your name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus();
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Add your name, so your team knows who made a change.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Leo Martin{Enter}');
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/workspace/?setup=create'));
    expect(posts('rename')[0]!.body).toEqual({ action: 'rename', name: 'Leo Martin' });
    expect(entryCalls[0]!.method).toBe('GET');
    expect(entryCalls[0]!.url).toBe('/api/entry');
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

  it('turns a GitHub sign-in into the account on the way back from GitHub (Link GitHub), then goes on', async () => {
    gh.token = 'ghu_abc';
    sessionStorage.setItem(GITHUB_PENDING_KEY, '1');
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: null }) : json(200, { account: account({ github: { login: 'leo', id: 1 } }), created: false, next: '/studio/acme/ds/' }));
    await act(async () => {
      render(createElement(SignIn));
    });
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/ds/tokens/'));
    expect(posts('github')[0]!.body).toEqual({ action: 'github', token: 'ghu_abc' });
    expect(sessionStorage.getItem(GITHUB_PENDING_KEY)).toBeNull();
  });

  it('keeps the GitHub way on a site without accounts', async () => {
    reply = () => new Response('<html></html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    render(createElement(SignIn));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue with GitHub' }));
    await waitFor(() => expect(gh.startSignIn).toHaveBeenCalledWith('/signin/?next=%2Fstudio%2Facme%2Fds%2Ftokens%2F'));
    expect(sessionStorage.getItem(GITHUB_PENDING_KEY)).toBe('1');
  });
});

describe('entry: Bridge picks the room after the code (E3 to E6)', () => {
  /** Signed in already, opened without ?next=: the screen asks /api/entry where to go. */
  function signedIn(entry: (c: EntryCall) => Response, over: Record<string, unknown> = {}) {
    history.replaceState(null, '', '/signin/');
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: account({ email: 'jordan.lee@acme.com', name: 'Jordan Lee', ...over }) }) : json(200, { ok: true }));
    entryReply = entry;
    return render(createElement(SignIn));
  }
  const entryPosts = (action: string) => entryCalls.filter((c) => c.body?.action === action);

  it('opens the one team', async () => {
    signedIn(() => json(200, { kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'edit', via: 'email' }] }));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/~/acme/ds/'));
  });

  it('reopens the most recent of several teams', async () => {
    localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(['acme/mobile']));
    signedIn(() => json(200, { kind: 'teams', teams: [{ repo: 'acme/ds', name: 'Acme Design', role: 'edit', via: 'email' }, { repo: 'acme/mobile', name: 'Acme Mobile', role: 'reviewer', via: 'github' }] }));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/~/acme/mobile/'));
  });

  it('E5: lets the person pick a team when none was opened recently', async () => {
    const { container } = signedIn(() =>
      json(200, {
        kind: 'teams',
        teams: [
          { repo: 'acme/mobile', name: 'Acme Mobile', role: 'reviewer', via: 'github' },
          { repo: 'acme/ds', name: 'Acme Design', role: 'edit', via: 'email' },
          { repo: 'acme/brand', name: 'Acme Brand', role: 'admin', via: 'github' },
        ],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Pick a team' })).toBeInTheDocument();
    expect(screen.getByText('You are in 3 teams. Switch any time from the team menu.')).toBeInTheDocument();
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/studio/~/'));
    expect(links.map((a) => a.textContent)).toEqual(['Acme Brand', 'Acme Design', 'Acme Mobile']);
    expect(screen.getByText('You are admin')).toBeInTheDocument();
    expect(screen.getByText('You review design')).toBeInTheDocument();
    expect(screen.getByText('You can edit')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a team' })).toHaveAttribute('href', '/studio/workspace/?setup=create');
    expect(navigate.to).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('E3: joins with an invite, no approval', async () => {
    const { container } = signedIn((c) =>
      c.method === 'GET'
        ? json(200, { kind: 'invites', invites: [{ id: 'inv1', team: 'Acme Design', repo: 'acme/ds', role: 'edit', invitedBy: 'Sam Rivera', invitedAt: new Date().toISOString().slice(0, 4) + '-10-21T12:00:00Z', memberCount: 12, people: ['Sam Rivera', 'Ada Lovelace', 'Lea Eng', 'Kim'] }] })
        : json(200, { joined: true, status: 'joined', repo: 'acme/ds', role: 'edit', next: '/studio/acme/ds/' }),
    );
    expect(await screen.findByRole('heading', { name: 'Acme Design invited you' })).toBeInTheDocument();
    expect(screen.getByText('jordan.lee@acme.com')).toBeInTheDocument();
    expect(screen.getByText(/Sam Rivera invited/).textContent).toBe('Sam Rivera invited jordan.lee@acme.com on 21 October.');
    expect(screen.getByText('Can edit')).toBeInTheDocument();
    // The team's people: four initials avatars, +8 for the rest, then the size. Names only, hidden from the reader.
    expect(screen.getByText('12 members')).toBeInTheDocument();
    const stack = container.querySelector('.ent-people-stack')!;
    expect(stack).toHaveAttribute('aria-hidden', 'true');
    expect(stack.textContent).toBe('SRALLEK+8');
    await expectNoAxeViolations(container);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Join Acme Design' }));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/ds/'));
    expect(entryPosts('accept-invite')[0]!.body).toEqual({ action: 'accept-invite', repo: 'acme/ds', id: 'inv1' });
    expect(entryPosts('accept-invite')[0]!.headers['X-Bridge-Contribute']).toBe('1');
  });

  it('E3: a reviewer invite without GitHub says so before the action, in one line, with New to GitHub?', async () => {
    document.documentElement.dataset.ghApp = 'suggest';
    try {
      const { container } = signedIn(() => json(200, { kind: 'invites', invites: [{ id: 'inv2', team: 'Acme Design', repo: 'acme/ds', role: 'reviewer', reviewAs: 'design', invitedBy: 'Sam Rivera' }] }));
      const connect = await screen.findByRole('button', { name: 'Connect GitHub to accept' });
      expect(screen.queryByRole('button', { name: 'Join Acme Design' })).toBeNull();
      expect(screen.getByText('Reviewer: design')).toBeInTheDocument();
      expect(screen.getByText("As Reviewer: design, you approve changes on GitHub, the free account where your team's design system lives.")).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Create a free account/ })).toHaveAttribute('href', 'https://github.com/signup');
      expect(container.textContent).not.toMatch(/ai-design-system-demo|peterbono|token/i);
      await expectNoAxeViolations(container);
      await userEvent.setup().click(connect);
      await waitFor(() => expect(gh.startSignIn).toHaveBeenCalled());
      expect(sessionStorage.getItem(GITHUB_PENDING_KEY)).toBe('1');
      expect(entryPosts('accept-invite')).toHaveLength(0);
    } finally {
      delete document.documentElement.dataset.ghApp;
    }
  });

  it('E3: on a site without GitHub sign-in, a reviewer invite says it is not available here and whom to ask', async () => {
    signedIn(() => json(200, { kind: 'invites', invites: [{ id: 'inv2', team: 'Acme Design', repo: 'acme/ds', role: 'admin', invitedBy: 'Sam Rivera' }] }));
    expect(await screen.findByText('Joining as Admin needs GitHub, which is not available on this Bridge site. Ask Sam Rivera to invite you as Can edit instead.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect GitHub to accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join Acme Design' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open the demo' })).toBeInTheDocument();
  });

  it('E3: an expired invite says so, with a way on', async () => {
    signedIn((c) =>
      c.method === 'GET'
        ? json(200, { kind: 'invites', invites: [{ id: 'inv3', team: 'Acme Design', repo: 'acme/ds', role: 'edit', invitedBy: 'Sam Rivera' }] })
        : json(410, { error: 'expired', message: 'This invite expired or was cancelled. Ask your admin for a new one.' }),
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Join Acme Design' }));
    expect(await screen.findByText('This invite expired or was cancelled. Ask your admin for a new one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a new team instead' })).toHaveAttribute('href', '/studio/workspace/?setup=create');
  });

  it('E4 then E4b: asks to join the team found by work domain', async () => {
    const { container } = signedIn((c) =>
      c.method === 'GET' ? json(200, { kind: 'domain', domain: 'acme.com', teams: [{ repo: 'acme/ds', name: 'Acme Design', memberCount: 12, people: ['Sam Rivera', 'Ada Lovelace', 'Lea Eng', 'Kim'], adminName: 'Sam Rivera', requested: false }] }) : json(200, { requested: true, expiresAt: '2026-11-06T00:00:00Z' }),
    );
    expect(await screen.findByRole('heading', { name: 'Your colleagues already use Bridge' })).toBeInTheDocument();
    expect(screen.getByText('@acme.com')).toBeInTheDocument();
    expect(screen.getByText('12 members')).toBeInTheDocument();
    expect(container.querySelector('.ent-people-stack')!.textContent).toBe('SRALLEK+8');
    expect(screen.getByText('Admin: Sam Rivera')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a new team instead' })).toHaveAttribute('href', '/studio/workspace/?setup=create');
    await expectNoAxeViolations(container);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeInTheDocument();
    expect(screen.getByText("We asked Sam Rivera to let you in. You'll get an email.")).toBeInTheDocument();
    expect(screen.getByText('Waiting for Sam')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore the demo while you wait' })).toBeInTheDocument();
    expect(entryPosts('request')[0]!.body).toEqual({ action: 'request', repo: 'acme/ds' });
    await expectNoAxeViolations(container);
  });

  it('E4: several teams, largest first, three then Show N more, each with its own Ask to join', async () => {
    const team = (repo: string, name: string, memberCount: number, requested = false) => ({ repo, name, memberCount, adminName: 'Sam Rivera', requested });
    signedIn(() => json(200, { kind: 'domain', domain: 'acme.com', teams: [team('acme/a', 'Acme A', 2), team('acme/b', 'Acme B', 30), team('acme/c', 'Acme C', 8, true), team('acme/d', 'Acme D', 12), team('acme/e', 'Acme E', 1)] }));
    expect(await screen.findByText(/Bridge found 5 teams for/)).toBeInTheDocument();
    const names = () => screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(names()).toEqual(['Acme B', 'Acme D', 'Acme C']);
    expect(screen.getByRole('button', { name: 'Ask to join Acme B' })).toBeInTheDocument();
    expect(screen.getByText('Request sent')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show 2 more teams' }));
    expect(names()).toEqual(['Acme B', 'Acme D', 'Acme C', 'Acme A', 'Acme E']);
  });

  it('E4b straight away when the one team was asked before', async () => {
    signedIn(() => json(200, { kind: 'domain', domain: 'acme.com', teams: [{ repo: 'acme/ds', name: 'Acme Design', memberCount: 12, adminName: 'Sam Rivera', requested: true }] }));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeInTheDocument();
  });

  it('E4b: Cancel the request takes it back and returns to E4', async () => {
    const { container } = signedIn((c) => (c.method === 'GET' ? json(200, { kind: 'domain', domain: 'acme.com', teams: [{ repo: 'acme/ds', name: 'Acme Design', memberCount: 2, people: ['Sam Rivera', 'Lea Eng'], adminName: 'Sam Rivera', requested: true }] }) : json(200, { cancelled: true })));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeInTheDocument();
    expect(screen.getByText(/Changed your mind\?/)).toBeInTheDocument();
    expect(container.querySelector('.ent-people-stack')!.textContent).toBe('SRLE');
    await expectNoAxeViolations(container);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel the request' }));
    expect(await screen.findByRole('heading', { name: 'Your colleagues already use Bridge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask to join' })).toBeInTheDocument();
    expect(entryPosts('cancel-request')[0]!.body).toEqual({ action: 'cancel-request', repo: 'acme/ds' });
    expect(entryPosts('cancel-request')[0]!.headers['X-Bridge-Contribute']).toBe('1');
  });

  it('E4b: a request already gone (expired, answered) still returns to E4', async () => {
    signedIn((c) =>
      c.method === 'GET'
        ? json(200, { kind: 'domain', domain: 'acme.com', teams: [{ repo: 'acme/ds', name: 'Acme Design', memberCount: 12, adminName: 'Sam Rivera', requested: true }] })
        : json(404, { error: 'not_found', message: 'This request expired or was already answered.' }),
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel the request' }));
    expect(await screen.findByRole('heading', { name: 'Your colleagues already use Bridge' })).toBeInTheDocument();
    expect(screen.queryByText('This request expired or was already answered.')).toBeNull();
  });

  it('E4b: a cancel that fails keeps the request and says why', async () => {
    signedIn((c) =>
      c.method === 'GET'
        ? json(200, { kind: 'domain', domain: 'acme.com', teams: [{ repo: 'acme/ds', name: 'Acme Design', memberCount: 12, adminName: 'Sam Rivera', requested: true }] })
        : json(502, { error: 'unreachable', message: 'Bridge could not reach its storage. Try again in a minute.' }),
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel the request' }));
    expect(await screen.findByText('Bridge could not reach its storage. Try again in a minute.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Request sent' })).toBeInTheDocument();
  });

  it('E6: nothing matched, Create your team', async () => {
    signedIn(() => json(200, { kind: 'create' }));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/workspace/?setup=create'));
  });

  it('Not you? signs out and goes back to the email', async () => {
    signedIn(() => json(200, { kind: 'domain', domain: 'acme.com', teams: [{ repo: 'acme/ds', name: 'Acme Design', memberCount: 12, adminName: 'Sam Rivera', requested: false }] }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use another email' }));
    expect(await screen.findByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
    expect(posts('sign-out')).toHaveLength(1);
  });

  it('falls back to the account answer when /api/entry cannot answer', async () => {
    signedIn(() => new Response('<html></html>', { status: 404, headers: { 'Content-Type': 'text/html' } }), { teams: [{ repo: 'acme/ds', role: 'edit', via: 'email' }] });
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/~/acme/ds/'));
  });
});

describe('the invite link: one identity, the account of the invited email', () => {
  const TOKEN = 'K'.repeat(43);
  const live = { state: 'live', team: 'Acme Product', invitedBy: 'Sam Rivera', role: 'edit', sentTo: 'm•••@acme.com', member: false };
  const card = { id: 'inv1', team: 'Acme Product', repo: 'acme/acme-product', role: 'edit', invitedBy: 'Sam Rivera', invitedAt: '2026-10-22T10:00:00Z', memberCount: 3, people: ['Sam Rivera'] };
  const open = (hash = `#t=${TOKEN}`) => {
    history.replaceState(null, '', `/studio/invite/${hash}`);
    return render(createElement(SignIn, { invite: true }));
  };

  it('signed out: the code goes to the invited address, then the name, then E3 for that invite', async () => {
    let signed = false;
    reply = (c) => {
      if (c.method === 'GET') return json(200, { available: true, account: signed ? account({ email: 'mia@acme.com', name: 'mia' }) : null });
      if (c.body?.action === 'verify') return (signed = true), json(200, { account: account({ email: 'mia@acme.com', name: 'mia', nameSet: false }), created: true, next: '/start/' });
      if (c.body?.action === 'rename') return json(200, { account: account({ email: 'mia@acme.com', name: 'Mia Rossi' }) });
      return json(200, { ok: true });
    };
    entryReply = (c) => {
      if (c.body?.action === 'invite-link') return json(200, signed ? { ...live, signedIn: true, mine: true, invite: card } : { ...live, signedIn: false, mine: false });
      return json(200, { joined: true, status: 'joined', repo: 'acme/acme-product', role: 'edit', next: '/studio/acme/acme-product/' });
    };
    const { container } = open();
    expect(await screen.findByRole('heading', { name: 'Join Acme Product' })).toBeInTheDocument();
    // The token leaves the address bar at once, and stays in this tab only.
    expect(location.hash).toBe('');
    expect(sessionStorage.getItem('bridge.invite.token')).toBe(TOKEN);
    expect(screen.getByText('m•••@acme.com')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Work email' })).toBeNull();
    expect(screen.getByText('Not your email? Ask Sam Rivera to invite the one you use.')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/Bridge sent a 6-digit code to m•••@acme\.com/)).toBeInTheDocument();
    expect(posts('code')[0]!.body).toEqual({ action: 'code', invite: TOKEN });
    expect(screen.queryByRole('button', { name: 'Use another email' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Code' }), '123456');
    expect(posts('verify')[0]!.body).toEqual({ action: 'verify', invite: TOKEN, code: '123456' });
    await user.type(await screen.findByRole('textbox', { name: 'Your name' }), 'Mia Rossi{Enter}');
    expect(await screen.findByRole('heading', { name: 'Acme Product invited you' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Join Acme Product' }));
    await waitFor(() => expect(navigate.to).toHaveBeenCalledWith('/studio/acme/acme-product/'));
    expect(sessionStorage.getItem('bridge.invite.token')).toBeNull();
    // Never a separate contributor session: no /api/contribute call, the account joins.
    expect(entryCalls.filter((c) => c.body?.action === 'accept-invite')[0]!.body).toEqual({ action: 'accept-invite', repo: 'acme/acme-product', id: 'inv1' });
  });

  it('signed in as another email: says where it went, and "Sign in as that email" signs out and sends the code there', async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: account({ email: 'mia.rossi@gmail.com', name: 'Mia Rossi' }) }) : json(200, { ok: true }));
    entryReply = () => json(200, { ...live, signedIn: true, mine: false });
    const { container } = open();
    expect(await screen.findByRole('heading', { name: 'This invite was sent to m•••@acme.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue as mia.rossi@gmail.com' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in as that email' }));
    expect(await screen.findByRole('heading', { name: 'Join Acme Product' })).toBeInTheDocument();
    expect(posts('sign-out')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
  });

  it('a member: "You\'re already in", with the team to open', async () => {
    reply = (c) => (c.method === 'GET' ? json(200, { available: true, account: account({ email: 'mia@acme.com', name: 'Mia' }) }) : json(200, { ok: true }));
    entryReply = () => json(200, { state: 'gone', team: 'Acme Product', invitedBy: 'Sam Rivera', signedIn: true, member: true, repo: 'acme/acme-product' });
    open();
    expect(await screen.findByRole('heading', { name: "You're already in Acme Product" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Acme Product' })).toHaveAttribute('href', '/studio/~/acme/acme-product/');
  });

  it('a spent link, signed out: whom to ask, and Sign in; an incomplete link says so', async () => {
    entryReply = () => json(200, { state: 'gone', team: 'Acme Product', invitedBy: 'Sam Rivera', signedIn: false, member: false });
    const first = open();
    expect(await screen.findByRole('heading', { name: 'This invite link no longer works' })).toBeInTheDocument();
    expect(screen.getByText('Invites work once, for 7 days. Ask Sam Rivera for a new invite to Acme Product.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin/');
    first.unmount();
    sessionStorage.clear();
    open('');
    expect(await screen.findByRole('heading', { name: 'This invite link is incomplete' })).toBeInTheDocument();
    expect(entryCalls.filter((c) => c.body?.action === 'invite-link')).toHaveLength(1);
  });
});
