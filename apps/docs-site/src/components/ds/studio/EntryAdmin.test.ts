// @vitest-environment jsdom
// Entry, the screens around a team (boards E6, E7a, E7b, E7c): "Create your team" (the team name, "Let people with
// @acme.com find this team" checked for a work email, one line for a public email, "Expecting an invite?"), the join
// request row on an admin's Studio home (Decline and Approve inline up to 3 things, folded beyond), and the request in
// Settings, Members with its discovery line. "Connect GitHub to manage requests" instead of a refusal. Axe clean.
import '../../../../../../packages/react/src/test/setup';
import { createElement, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { onboardingSteps } from '../../../lib/onboarding';
import { changeNeed, joinNeed, person } from '../../../lib/home-model';
import { setEntryFetch } from '../../../scripts/entry-session';
import { joinHandlers } from '../../../scripts/team-home';
import { Onboarding, type OnboardingContext } from './Onboarding';
import { StudioHome, type StudioHomeProps } from './StudioHome';
import { DiscoveryLine, JoinRequests } from './JoinRequests';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let reply: (c: Call) => Response;

beforeEach(() => {
  calls = [];
  reply = () => json(200, { ok: true });
  setEntryFetch(async (url, init) => {
    const c = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return reply(c);
  });
});

afterEach(() => setEntryFetch(null));

// ---------------------------------------------------------------------------------------------------------------
// E6 and E7a

const ctx = (account: OnboardingContext['account']): OnboardingContext => ({
  repo: '',
  repoUrl: '',
  storybook: null,
  quickStart: null,
  products: [],
  mcpCommand: '',
  figmaHref: '/install/#figma-plugin',
  claudeHref: '/agents/#claude-code',
  team: { owner: '', repo: '', link: '', access: null, changes: null },
  workspace: true,
  account,
});
const steps = onboardingSteps({ login: null, repo: '', storybook: null, products: [], changes: null, workspace: true, account: { teamName: null } });

describe('Create your team (E6, E7a)', () => {
  it('names the team and lets the work domain find it, checked by default', async () => {
    const createTeam = vi.fn();
    const connectGitHub = vi.fn();
    const { container } = render(
      createElement(Onboarding, {
        steps,
        name: 'Jordan',
        initial: 'create',
        ctx: ctx({ email: 'jordan@lumen.studio', domain: 'lumen.studio', teamName: null, github: false }),
        actions: { propose: async () => ({ number: 1, url: '' }), mark: () => undefined, later: () => undefined, createTeam, connectGitHub },
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: "Welcome, Jordan. Let's set up your team." })).toBeInTheDocument();
    expect(screen.getByText('0 of 6 done')).toBeInTheDocument();
    expect(screen.getByText('Only the first step is needed today.')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Create your team' })).toBeInTheDocument();
    expect(screen.getByText('Your teammates see this name in their invite. You can change it later.')).toBeInTheDocument();
    expect(screen.getByText(/Expecting an invite\? Ask your design lead to send it to this email:/)).toBeInTheDocument();
    expect(screen.getByText('jordan@lumen.studio')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'Let people with @lumen.studio find this team' });
    expect(box).toBeChecked();
    expect(screen.getByText('They can ask to join. You approve each person, and they start as Can edit.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'No design system yet? Keep exploring the demo' })).toBeInTheDocument();
    expect(screen.getByText('Next: connect your design system')).toBeInTheDocument();
    // No sign-in step: GitHub only comes back on step 2, to link the repository.
    expect(screen.queryByText('Sign in with GitHub')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).toBeNull();
    expect(screen.getByText('Storybook URL, or connect GitHub to link your repo')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    const field = screen.getByRole('textbox', { name: 'Team name' });
    expect(field).toHaveValue('Lumen');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Type a name for your team.')).toBeInTheDocument();
    await user.type(field, 'Lumen Studio');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(createTeam).toHaveBeenCalledWith('Lumen Studio', true);
    // On to step 2: GitHub comes back only to link the repository.
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(connectGitHub).toHaveBeenCalledOnce();
  });

  it('a public email gets one line instead of the choice, and the box can be unchecked', async () => {
    const createTeam = vi.fn();
    render(
      createElement(Onboarding, {
        steps,
        name: null,
        initial: 'create',
        ctx: ctx({ email: 'sam.rivera.design@gmail.com', domain: null, teamName: null, github: true }),
        actions: { propose: async () => ({ number: 1, url: '' }), mark: () => undefined, later: () => undefined, createTeam },
      }),
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Teammates join by invite. You send invites right after setup.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Team name' }), 'Acme Design');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(createTeam).toHaveBeenCalledWith('Acme Design', false);
    // GitHub signed in here already: step 2 picks the repository.
    expect(screen.getByRole('textbox', { name: 'GitHub repository' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// E7b

const NOW = Date.parse('2026-10-23T10:00:00Z');
const jordan = joinNeed({ id: 'a1b2c3d4e5f60718', name: 'Jordan Lee', email: 'jordan.lee@acme.com', createdAt: '2026-10-23T09:00:00Z' }, 'Acme Design', NOW);
const ann = person('ann', 'Ann Kowalski', null);
const review = (n: number) => changeNeed({ number: n, title: `Change ${n}`, author: ann, asker: ann, since: '2026-10-21T10:00:00Z', task: 'requested', thumb: { kind: 'icon', icon: 'branch' } }, NOW);
const home = (over: Partial<StudioHomeProps>): StudioHomeProps => ({
  state: 'busy',
  greeting: 'Good morning, Sam.',
  needs: [],
  branches: [],
  health: null,
  now: NOW,
  components: [],
  signedOut: { line: '', button: '', signIn: true },
  failed: null,
  startHrefs: { tokens: '#t', component: '#c', guidance: '#g' },
  ...over,
});

describe('join request on the admin home (E7b)', () => {
  it('keeps Decline and Approve inline, then removes the row at once and offers Undo in a toast', async () => {
    reply = () => json(200, { member: { name: 'Jordan Lee', role: 'edit' }, repo: 'acme/ds' });
    const gone = vi.fn();
    const back = vi.fn();
    const { container } = render(createElement(StudioHome, home({ needs: [jordan, review(1)], join: joinHandlers(() => 'acme/ds', gone, back) })));
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('· asks to join Acme Design')).toBeInTheDocument();
    expect(screen.getByText('jordan.lee@acme.com · joins as Can edit')).toBeInTheDocument();
    expect(screen.getByText('Waiting 1 h')).toBeInTheDocument();
    expect(screen.getByText(/are waiting on you/).textContent).toContain('Jordan and Ann');
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Approve Jordan Lee' }));
    expect(await screen.findByText('Jordan joined as Can edit.')).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({ action: 'approve', repo: 'acme/ds', id: 'a1b2c3d4e5f60718' });
    expect(gone).toHaveBeenCalledWith(jordan.key);
    reply = () => json(200, { undone: true });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText("Jordan's request is back.")).toBeInTheDocument();
    expect(calls[1]!.body).toEqual({ action: 'undo', repo: 'acme/ds', id: 'a1b2c3d4e5f60718' });
    expect(back).toHaveBeenCalledWith(jordan.key);
  });

  it('recounts the headline once the last request is decided', async () => {
    reply = () => json(200, { ok: true });
    function Host() {
      const [needs, setNeeds] = useState([jordan]);
      return createElement(StudioHome, home({ needs, join: joinHandlers(() => 'acme/ds', (k) => setNeeds((n) => n.filter((r) => r.key !== k))) }));
    }
    render(createElement(Host));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decline Jordan Lee' }));
    expect(await screen.findByText(/Nothing needs you/)).toBeInTheDocument();
    expect(screen.queryByText('Jordan Lee')).toBeNull();
  });

  it('folds into N more beyond 3, no inline buttons', () => {
    render(createElement(StudioHome, home({ needs: [jordan, review(1), review(2), review(3)], join: joinHandlers(() => 'acme/ds', () => undefined) })));
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Decline/ })).toBeNull();
    expect(screen.getByText('1 more')).toBeInTheDocument();
  });

  it('says Connect GitHub to manage requests instead of a refusal', async () => {
    reply = () => json(403, { error: 'forbidden', message: 'Only admins of this team can do this. Continue with GitHub with an admin account.' });
    render(createElement(StudioHome, home({ needs: [jordan], join: joinHandlers(() => 'acme/ds', () => undefined) })));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decline Jordan Lee' }));
    expect(await screen.findByRole('button', { name: 'Connect GitHub to manage requests' })).toBeInTheDocument();
    expect(screen.queryByText(/Only admins of this team/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// E7c

describe('Settings, Members (E7c, E7a)', () => {
  const req = { id: 'a1b2c3d4e5f60718', name: 'Jordan Lee', email: 'jordan.lee@acme.com', createdAt: new Date(Date.now() - 3_700_000).toISOString(), expiresAt: '' };

  it('lists who asks to join with the role preset Can edit, and approves', async () => {
    const onDone = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(createElement(JoinRequests, { repo: 'acme/ds', requests: [req], onDone }));
    expect(screen.getByRole('heading', { name: 'Asks to join 1' })).toBeInTheDocument();
    expect(screen.getByText('Found the team with @acme.com · asked 1 h ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Role for Jordan Lee: Can edit' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    reply = () => json(200, { member: { name: 'Jordan Lee', role: 'edit' }, repo: 'acme/ds' });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Approve Jordan Lee' }));
    expect(await screen.findByText('Jordan joined as Can edit.')).toBeInTheDocument();
    vi.advanceTimersByTime(5000);
    expect(onDone).toHaveBeenCalledWith(req, true);
    vi.useRealTimers();
  });

  it('shows nothing when nobody asks', () => {
    const { container } = render(createElement(JoinRequests, { repo: 'acme/ds', requests: [], onDone: () => undefined }));
    expect(container).toBeEmptyDOMElement();
  });

  it('says who can find the team, with Turn off', async () => {
    reply = () => json(200, { domain: 'acme.com', enabled: false });
    const onChange = vi.fn();
    render(createElement(DiscoveryLine, { repo: 'acme/ds', discovery: { domain: 'acme.com', enabled: true, configured: true, eligible: true }, github: false, onChange }));
    expect(screen.getByText('@acme.com')).toBeInTheDocument();
    expect(screen.getByText(/can find this team and ask to join\./)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ domain: 'acme.com', enabled: false, configured: true, eligible: true }));
    expect(calls[0]!.body).toEqual({ action: 'discovery', repo: 'acme/ds', enabled: false });
  });

  it('offers to turn it on for a work email that never chose, and hides it for a public one', () => {
    const { rerender } = render(createElement(DiscoveryLine, { repo: 'acme/ds', discovery: { domain: 'acme.com', enabled: false, configured: false, eligible: true }, github: false, onChange: () => undefined }));
    expect(screen.getByText('Let people with @acme.com find this team.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    rerender(createElement(DiscoveryLine, { repo: 'acme/ds', discovery: { domain: null, enabled: false, configured: false, eligible: false }, github: false, onChange: () => undefined }));
    expect(screen.queryByRole('button')).toBeNull();
    rerender(createElement(DiscoveryLine, { repo: 'acme/ds', discovery: null, github: true, onChange: () => undefined }));
    expect(screen.getByRole('button', { name: 'Connect GitHub to manage requests' })).toBeInTheDocument();
  });
});
