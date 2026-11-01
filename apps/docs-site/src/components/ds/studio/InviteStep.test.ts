// @vitest-environment jsdom
// The setup step "Invite your team" (Onboarding.tsx): one sentence and "Invite collaborators", which opens the invite
// dialog (InviteDialog.tsx, stubbed here). No team link to copy: /studio/ is Bridge's showcase, not the team.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { onboardingSteps, type OnboardingFacts } from '../../../lib/onboarding';
import { Onboarding } from './Onboarding';

vi.mock('./InviteDialog', () => ({
  default: ({ open, onSent }: { open: boolean; onSent?: () => void }) =>
    open ? createElement('div', { role: 'dialog', 'aria-label': 'Invite collaborators' }, createElement('button', { type: 'button', onClick: onSent }, 'Send 1 invite')) : null,
}));

const base: OnboardingFacts = { login: 'ann', repo: 'acme/design-system', storybook: null, products: [], changes: 'suggest' };
const ctx = {
  repo: 'acme/design-system',
  repoUrl: 'https://github.com/acme/design-system',
  storybook: null,
  products: [],
  mcpCommand: '',
  figmaHref: '/install/#figma-plugin',
  claudeHref: '/agents/#claude-code',
  team: { owner: 'acme', repo: 'design-system', link: 'https://bridge.example.com/studio/', access: null, changes: null },
};

describe('the setup step "Invite your team"', () => {
  it('invites by email from the invite dialog, and sending marks the step done', async () => {
    const mark = vi.fn();
    const later = vi.fn();
    const { container } = render(createElement(Onboarding, { steps: onboardingSteps(base), name: 'Ann', initial: 'team', ctx, actions: { propose: async () => ({ number: 1, url: '' }), mark, later } }));
    expect(screen.getByRole('heading', { level: 2, name: 'Invite your team' })).toBeInTheDocument();
    expect(screen.getByText('They get an email and land in your team with the role you pick.')).toBeInTheDocument();
    // No raw link, no GitHub words: the showcase address never reaches a teammate.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
    expect(container.textContent).not.toContain('bridge.example.com');
    expect(container.textContent).not.toContain('GitHub decides');
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Invite collaborators' }));
    expect(screen.getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
    expect(mark).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send 1 invite' }));
    expect(mark).toHaveBeenCalledWith('team');
  });
});
