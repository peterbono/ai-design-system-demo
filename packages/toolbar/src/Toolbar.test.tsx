import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@bridge-ds/react';
import { expectNoAxeViolations } from '../../react/src/test/axe';
import type { ChangeFacts } from './github';
import { OPEN_KEY, type BridgeBuild } from './session';
import type { ToolbarScope } from './scope';

// The change's facts come from GitHub: each test says what loadChange answers.
const loadChange = vi.fn<(build: unknown, n: number) => Promise<ChangeFacts>>();
vi.mock('./github', () => ({ loadChange: (build: unknown, n: number) => loadChange(build, n) }));
import { ReadError } from './reads';

const { default: Toolbar } = await import('./Toolbar');

const N = 4242;
const build: BridgeBuild = { owner: 'acme', repo: 'admin', studio: null, production: null, preview: null, deployEnv: null };
const scope = (): ToolbarScope => ({ theme: 'light', brand: 'bridge', density: 'compact', set: () => {} });
const facts = (over: Partial<ChangeFacts> = {}): ChangeFacts => ({
  number: N,
  title: 'Warmer primary buttons',
  url: '',
  sha: 'abc',
  mode: 'tokens',
  files: ['packages/tokens/src/primitives/color.tokens.json'],
  behind: null,
  tokens: [],
  screens: null,
  ...over,
});

const mount = () =>
  render(
    <TooltipProvider delay={0}>
      <Toolbar build={build} scope={scope} />
    </TooltipProvider>,
  );
// Base UI tooltips render in a portal, without a tooltip role: the text of the open ones.
const openTips = () => [...document.querySelectorAll('[data-base-ui-portal] [data-open] [data-open]')].map((t) => t.textContent ?? '');
const bar = () => screen.getByRole('region', { name: /^Bridge:/ });
const sideButton = (name: string) => within(screen.getByRole('group', { name: 'Compare' })).getByRole('button', { name });

beforeEach(() => {
  window.history.replaceState(null, '', `/?bridge=${N}#/`);
  window.sessionStorage.clear();
  window.sessionStorage.setItem(OPEN_KEY, '0');
  loadChange.mockReset();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('the collapsed toolbar', () => {
  it('names the change and puts the Live product | This change switch in the pill', async () => {
    loadChange.mockResolvedValue(facts());
    mount();
    await waitFor(() => expect(bar()).toHaveAccessibleName('Bridge: This change, Warmer primary buttons'));
    expect(within(bar()).getByText('Bridge')).toBeInTheDocument();
    expect(within(bar()).getByText('Warmer primary buttons')).toBeInTheDocument();
    expect(sideButton('This change')).toHaveAttribute('aria-pressed', 'true');
    expect(sideButton('Live product')).toHaveAttribute('aria-pressed', 'false');
    expect(sideButton('Live product')).toHaveAttribute('aria-keyshortcuts', 'B');
    // No status chip that looks like a button: the pressed side says where the person is.
    expect(within(bar()).queryByText('This change', { selector: '[class*="badge"]' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show Bridge details' })).toBeInTheDocument();
  });

  it('flips sides in one click and with B, without opening', async () => {
    loadChange.mockResolvedValue(facts());
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(sideButton('Live product')).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(sideButton('Live product'));
    expect(sideButton('Live product')).toHaveAttribute('aria-pressed', 'true');
    expect(bar()).toHaveAttribute('data-side', 'before');
    expect(bar()).toHaveAccessibleName('Bridge: Live product, Warmer primary buttons');
    // Still collapsed: the details stay one click away.
    expect(screen.getByRole('button', { name: 'Show Bridge details' })).toBeInTheDocument();
    await user.keyboard('b');
    expect(sideButton('This change')).toHaveAttribute('aria-pressed', 'true');
    expect(bar()).toHaveAttribute('data-side', 'after');
  });

  it('shows the full title in a tooltip and Show Bridge details on the chevron', async () => {
    const long = 'Make the primary action colour warmer across every checkout and order screen, and soften the focus ring';
    loadChange.mockResolvedValue(facts({ title: long }));
    const user = userEvent.setup();
    mount();
    const title = await within(bar()).findByText(long);
    await user.hover(title);
    await waitFor(() => expect(openTips()).toContain(long));
    await user.unhover(title);
    await user.hover(screen.getByRole('button', { name: 'Show Bridge details' }));
    await waitFor(() => expect(openTips()).toContain('Show Bridge details'));
  });

  it('says why a side is not available yet, and keeps it out of reach', async () => {
    loadChange.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    mount();
    const live = sideButton('Live product');
    expect(live).toHaveAttribute('aria-disabled', 'true');
    await user.hover(live);
    await waitFor(() => expect(openTips()).toContain('Live product is not available yet. Reading the change. You can switch sides once it has loaded.'));
    await user.click(live);
    expect(sideButton('This change')).toHaveAttribute('aria-pressed', 'true');
  });

  it('when the change cannot be read, says what helps: Studio for access, never a reload that cannot help', async () => {
    loadChange.mockRejectedValue(new ReadError('GitHub answered 404.', 404));
    const user = userEvent.setup();
    mount();
    const live = sideButton('Live product');
    await user.hover(live);
    await waitFor(() => expect(openTips().join(' ')).toContain('Open it from Studio to compare both sides.'));
    expect(openTips().join(' ')).not.toContain('Reload');
  });

  it('opens on Show Bridge details', async () => {
    loadChange.mockResolvedValue(facts());
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Show Bridge details' }));
    expect(screen.getByRole('button', { name: 'Collapse the Bridge toolbar' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(OPEN_KEY)).toBe('1');
  });

  it('has no axe violations', async () => {
    loadChange.mockResolvedValue(facts());
    const { container } = mount();
    await waitFor(() => expect(sideButton('Live product')).not.toHaveAttribute('aria-disabled', 'true'));
    await act(async () => {
      await expectNoAxeViolations(container);
    });
  });
});
