// @vitest-environment jsdom
// The setup steps' buttons (Florian, 2026-11-01): the primary does the step's action, a done step says where it goes
// next, and "Do this later" is the only way to skip. Never a "Continue" that skips like "Do this later" does.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { onboardingSteps, PRODUCTS_COPY_LINE, type StepId } from '../../../lib/onboarding';
import { Onboarding } from './Onboarding';

const products = [
  { name: 'Art print shop', key: 'admin-app', design: true },
  { name: 'Library', key: 'library', path: 'packages' },
];
const facts = (marked: StepId[] = [], changes: 'suggest' | null = null) =>
  onboardingSteps({ login: 'ann', repo: 'acme/ds', storybook: null, products: products.map((p) => p.name), changes, teamName: 'Acme', marked });
const ctx = {
  repo: 'acme/ds',
  repoUrl: 'https://github.com/acme/ds',
  storybook: null,
  products,
  mcpCommand: '',
  figmaHref: '/install/#figma-plugin',
  claudeHref: '/agents/#claude-code',
  team: { owner: 'acme', repo: 'ds', link: '', access: null, changes: null },
};
const actions = (mark = vi.fn<(id: StepId) => void>()) => ({ propose: async () => ({ number: 4, url: '' }), mark, later: vi.fn<(at: StepId) => void>() });
const open = (initial: StepId, marked: StepId[] = [], mark = vi.fn<(id: StepId) => void>()) =>
  render(createElement(Onboarding, { steps: facts(marked), name: 'Ann', initial, ctx, actions: actions(mark) }));

describe('setup step buttons', () => {
  it('a step to do: its primary does it, and "Do this later" is the only skip', async () => {
    const mark = vi.fn<(id: StepId) => void>();
    const { container } = open('figma', [], mark);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Do this later' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'I installed it' }));
    expect(mark).toHaveBeenCalledWith('figma');
    await expectNoAxeViolations(container);
  });

  it('How changes reach your code sends the choice for review, by name', () => {
    open('changes');
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('a step already done moves on and says where, with nothing to put off', () => {
    open('signin');
    expect(screen.getByRole('button', { name: /^Next: / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Do this later' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('Invite your team, not done: the invite is the action, the footer only skips', () => {
    open('team');
    expect(screen.getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Do this later' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Next: |Continue/ })).toBeNull();
  });

  it('Products: a product with a design team copy opens its page, where its copy is made', () => {
    open('products');
    expect(screen.getByRole('link', { name: 'Art print shop' })).toHaveAttribute('href', expect.stringContaining('products/admin-app/'));
    expect(screen.queryByRole('link', { name: 'Library' })).toBeNull();
    expect(screen.getByText(PRODUCTS_COPY_LINE)).toBeInTheDocument();
  });

  it('every step done: the title says so', () => {
    render(createElement(Onboarding, { steps: facts(['team', 'figma', 'claude'], 'suggest'), name: 'Ann', initial: 'figma', ctx, actions: actions() }));
    expect(screen.getByRole('heading', { level: 1, name: 'All set, Ann. Your design system is connected.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Next: / })).toBeInTheDocument();
  });
});
