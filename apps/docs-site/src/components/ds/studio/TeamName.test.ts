// @vitest-environment jsdom
// The team's display name: the setup step "Name your team" (Onboarding.tsx) and Settings > General
// (TeamNameSetting.tsx), each saving through a config pull request.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { onboardingSteps, type OnboardingFacts } from '../../../lib/onboarding';
import { Onboarding } from './Onboarding';
import TeamNameSetting from './TeamNameSetting';

const page = vi.hoisted(() => ({
  team: { owner: 'acme', repo: 'design-system' },
  site: {} as { name?: string },
  access: null as { admin: boolean } | null,
  proposed: [] as string[],
}));

vi.mock('../../../scripts/repo-context', () => ({
  repoContext: () => ({ ...page.team, hosted: false }),
  siteConfig: () => page.site,
}));

vi.mock('../../../scripts/github-session', () => ({
  onAccess: (fn: (a: { admin: boolean } | null) => void) => fn(page.access),
}));

vi.mock('../../../scripts/roles', () => ({
  proposeTeamName: async (name: string) => {
    page.proposed.push(name);
    return { number: 41, url: 'https://github.com/acme/design-system/pull/41' };
  },
}));

beforeEach(() => {
  page.site = {};
  page.access = null;
  page.proposed = [];
});

const base: OnboardingFacts = { login: 'ann', repo: 'acme/design-system', storybook: null, products: [], changes: 'suggest' };
const ctx = {
  repo: 'acme/design-system',
  repoUrl: 'https://github.com/acme/design-system',
  storybook: null,
  products: [],
  mcpCommand: '',
  figmaHref: '/install/#figma-plugin',
  claudeHref: '/agents/#claude-code',
  team: { owner: 'acme', repo: 'design-system', link: '', access: null, changes: null },
};

describe('the setup step "Name your team"', () => {
  it('prefills the repository name in words, and Save name opens the config pull request', async () => {
    const name = vi.fn(async () => ({ number: 41, url: '' }));
    const later = vi.fn();
    const { container } = render(createElement(Onboarding, { steps: onboardingSteps(base), name: 'Ann', initial: 'name', ctx, actions: { propose: async () => ({ number: 1, url: '' }), mark: () => undefined, later, name } }));
    expect(screen.getByText('Step 3 of 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Name your team' })).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Team name' });
    expect(field).toHaveValue('Design system');
    expect(screen.getByText('Your team sees it in Studio, the Library and invitations.')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Type a name for your team.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(name).not.toHaveBeenCalled();
    await user.type(field, 'Acme Design');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(name).toHaveBeenCalledWith('Acme Design');
    expect(await screen.findByText(/Sent for review, #41\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the branch' })).toHaveAttribute('href', expect.stringContaining('pr=41'));
    await user.click(screen.getByRole('button', { name: 'Do this later' }));
    expect(later).toHaveBeenCalledWith('name');
  });

  it('says the name once bridge.config.json has it, with one way to change it', async () => {
    const { container } = render(createElement(Onboarding, { steps: onboardingSteps({ ...base, teamName: 'Acme Design' }), name: 'Ann', initial: 'name', ctx, actions: { propose: async () => ({ number: 1, url: '' }), mark: () => undefined, later: () => undefined, name: async () => ({ number: 1, url: '' }) } }));
    expect(screen.getByText('Acme Design', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change it in Settings' })).toHaveAttribute('href', expect.stringContaining('settings/#general'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('Settings > General', () => {
  it('lets an admin rename the team, Save off until the name changes', async () => {
    page.access = { admin: true };
    page.site = { name: 'Acme' };
    const { container } = render(createElement(TeamNameSetting, { prefix: 'bridge/' }));
    const field = await screen.findByRole('textbox', { name: 'Team name' });
    expect(field).toHaveValue('Acme');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.clear(field);
    await user.type(field, 'Acme Design');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(page.proposed).toEqual(['Acme Design']));
    expect(await screen.findByText(/Sent for review, #41\./)).toBeInTheDocument();
  });

  it('shows everyone else the name, read only', async () => {
    page.access = { admin: false };
    page.site = { name: 'Acme Design' };
    const { container } = render(createElement(TeamNameSetting));
    expect(await screen.findByText('Acme Design')).toBeInTheDocument();
    expect(screen.getByText('Only an admin of this team can change this.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('names a team without a name after its repository, and says so', async () => {
    render(createElement(TeamNameSetting));
    expect(await screen.findByText('Design system')).toBeInTheDocument();
    expect(screen.getByText('Not set yet, Bridge uses the repository name.')).toBeInTheDocument();
  });
});
