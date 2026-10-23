// @vitest-environment jsdom
// The start flow's screens (lib/start.ts): the browser workspace's home (board EmptyB), its setup step 2 (a repository
// opens that team at its next step), and the demo banner for a visitor with a workspace (board EmptyA2).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { onboardingSteps, type StepId } from '../../../lib/onboarding';
import { DemoBanner } from './DemoBanner';
import { Onboarding } from './Onboarding';
import { WorkspaceHome } from './WorkspaceHome';

const steps = (login: string | null) => onboardingSteps({ login, repo: '', storybook: null, products: [], changes: null, workspace: true });

describe('the browser workspace home (board EmptyB)', () => {
  it('says nothing is connected, with one primary action that resumes the setup', async () => {
    const onConnect = vi.fn();
    const { container } = render(createElement(WorkspaceHome, { name: 'Ann', storybook: null, onConnect }));
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Ann.' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is connected yet\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Your library' })).toBeInTheDocument();
    for (const t of ['Tokens', 'Components', 'Products']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText('None yet. Branches you start or review show up here.')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    await userEvent.setup().click(buttons[0]!);
    expect(onConnect).toHaveBeenCalledOnce();
    await expectNoAxeViolations(container);
  });

  it('says what a Storybook added in this browser brought, never "nothing is connected"', async () => {
    const { container } = render(
      createElement(WorkspaceHome, { name: null, storybook: { url: 'https://sb.acme.dev', components: 12, stories: 40, checkedAt: '2026-10-01T00:00:00Z' }, onConnect: () => undefined }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome.' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is connected yet/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect the repository' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See them' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

const ctx = {
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
  signIn: { button: 'Sign in with GitHub', direct: true },
};

const actions = (later = vi.fn<(at: StepId) => void>()) => ({ propose: async () => ({ number: 1, url: '' }), mark: () => undefined, later });

describe('the browser workspace setup', () => {
  it('opens on sign in while signed out, with the button the session listens for', async () => {
    const { container } = render(createElement(Onboarding, { steps: steps(null), name: null, initial: 'signin', ctx, actions: actions() }));
    const button = screen.getByRole('button', { name: 'Sign in with GitHub' });
    expect(button).toHaveAttribute('data-gh-signin');
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('opens a repository typed on step 2 at its next step', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ firsts: [], pairs: [] }) }));
    const { container } = render(createElement(Onboarding, { steps: steps('ann'), name: 'Ann', initial: 'library', ctx, actions: actions() }));
    expect(screen.getByRole('heading', { level: 2, name: 'Connect your design system' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'GitHub repository' }), 'acme/ds');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/studio/acme/ds/?setup=name'));
    await expectNoAxeViolations(container);
    vi.unstubAllGlobals();
  });

  it('says a step that needs the repository waits for it, and leaves from the step that was open', async () => {
    const later = vi.fn<(at: StepId) => void>();
    render(createElement(Onboarding, { steps: steps('ann'), name: 'Ann', initial: 'changes', ctx, actions: actions(later) }));
    expect(screen.getByText('This comes with the repository. Connect it on step 2 first.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Do this later' }));
    expect(later).toHaveBeenCalledWith('changes');
    await user.click(screen.getByRole('button', { name: 'Connect the repository' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Connect your design system' })).toBeInTheDocument();
  });
});

describe('the setup steps, in order and by keyboard', () => {
  it('puts the open step before the checklist in the page', () => {
    const { container } = render(createElement(Onboarding, { steps: steps('ann'), name: 'Ann', initial: 'library', ctx, actions: actions() }));
    const panel = screen.getByRole('heading', { level: 2, name: 'Connect your design system' });
    const list = screen.getByRole('list', { name: 'Setup steps' });
    expect(panel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('h1')!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('moves focus to the new step and keeps it in the address, so a reload opens it again', async () => {
    window.history.replaceState(null, '', '/studio/workspace/?setup=library&x=1');
    render(createElement(Onboarding, { steps: steps('ann'), name: 'Ann', initial: 'library', ctx, actions: actions() }));
    expect(window.location.search).toBe('?setup=library&x=1');
    await userEvent.setup().click(screen.getByRole('button', { name: /Name your team|Continue/ }));
    const heading = screen.getAllByRole('heading', { level: 2 })[0]!;
    expect(document.activeElement).toBe(heading);
    expect(new URLSearchParams(window.location.search).get('setup')).not.toBe('library');
    expect(new URLSearchParams(window.location.search).get('x')).toBe('1');
    window.history.replaceState(null, '', '/');
  });

  it('folds the checklist on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const { container } = render(createElement(Onboarding, { steps: steps('ann'), name: 'Ann', initial: 'library', ctx, actions: actions() }));
    const toggle = screen.getByRole('button', { name: /All setup steps/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Setup steps' })).toBeNull();
    await userEvent.setup().click(toggle);
    expect(screen.getByRole('list', { name: 'Setup steps' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    vi.unstubAllGlobals();
  });
});

describe('the demo banner (boards D1, EmptyA2)', () => {
  const SAMPLE = 'peterbono/bridge-demo-ds';

  it('gives the sample team one banner and one action: Get started, the email sign-in, never GitHub', async () => {
    const { container } = render(createElement(DemoBanner, { repo: SAMPLE }));
    const banner = container.firstElementChild as HTMLElement;
    expect(within(banner).getByText('Acme Design.')).toBeInTheDocument();
    expect(within(banner).getByText('This is a sample team: your edits stay in this browser and nothing is sent.')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const start = screen.getByRole('link', { name: 'Get started' });
    expect(start).toHaveAttribute('href', '/signin/');
    // Secondary weight: the page keeps its own primary (Review all on the demo home).
    expect(start.className).not.toMatch(/primary/);
    expect(banner.textContent).not.toMatch(/GitHub|Use your own repo/);
    await expectNoAxeViolations(container);
  });

  it('leads someone signed in to Bridge back to their own team instead', async () => {
    const { container } = render(createElement(DemoBanner, { repo: SAMPLE, back: { href: '/studio/acme/ds/', connect: false } }));
    expect(screen.getByRole('link', { name: 'Back to your workspace' })).toHaveAttribute('href', '/studio/acme/ds/');
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('offers to connect the design system when there is no workspace to go back to', async () => {
    const onConnect = vi.fn();
    const { container } = render(createElement(DemoBanner, { repo: SAMPLE, back: { href: '/studio/workspace/?setup=library', connect: true }, onConnect }));
    const link = screen.getByRole('link', { name: 'Connect your design system' });
    expect(link).toHaveAttribute('href', '/studio/workspace/?setup=library');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(onConnect).toHaveBeenCalledWith(expect.any(Event), '/studio/workspace/?setup=library');
    await expectNoAxeViolations(container);
  });

  it("names Bridge's own design system, never sample data, with one action for a guest", async () => {
    const { container } = render(createElement(DemoBanner, { repo: 'peterbono/ai-design-system-demo', back: { href: '/studio/workspace/?setup=library', connect: true } }));
    expect(screen.getByText('Bridge DS, read only.')).toBeInTheDocument();
    expect(screen.getByText("You're looking at the design system behind Bridge. Nothing here touches your repository.")).toBeInTheDocument();
    expect(screen.queryByText(/Acme Design|sample/i)).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Connect your design system' })).toHaveAttribute('href', '/studio/workspace/?setup=library');
    await expectNoAxeViolations(container);
  });
});
