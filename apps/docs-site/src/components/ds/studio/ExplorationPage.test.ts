// @vitest-environment jsdom
// The exploration page while it runs, boards X1 (nothing built yet) and X2 (Claude has changed things).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorationPage, type ExplorationPageProps } from './ExplorationPage';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';

const florian = { login: 'florian', name: 'Florian', agent: false, avatar: null };
const claude = { login: 'claude', name: 'Claude', agent: true, avatar: null };

const base: ExplorationPageProps = {
  number: 611,
  crumbs: [{ label: 'Changes', href: '/studio/changes/' }, { label: 'Admin demo', href: '/studio/changes/' }, { label: 'Orders: bulk actions' }],
  title: 'Orders: bulk actions',
  stage: 'not-started',
  author: florian,
  startedTail: 'Admin demo · today',
  lines: { app: 'Continue Bridge exploration #611 "Orders: bulk actions" in Admin demo and use the Bridge library.', terminal: 'claude "Continue Bridge exploration #611"' },
  todayUrl: 'https://bridge-demo.example.com',
  headline: null,
  previewUrl: null,
  previewNote: null,
  thumb: null,
  activity: null,
  done: { kind: 'run' },
  onDone: () => {},
  onArchive: async () => undefined,
  onCopy: async () => {},
  developer: [{ label: 'Branch', value: 'explore/611-orders-bulk-actions' }],
  take: null,
  githubUrl: 'https://github.com/acme/ds/pull/611',
};

const paint = (over: Partial<ExplorationPageProps> = {}) => render(createElement(ExplorationPage, { ...base, ...over }));

afterEach(cleanup);

describe('ExplorationPage, not started (X1)', () => {
  it('says nothing is built yet, who started it, and offers the line to paste in Claude', () => {
    paint();
    expect(screen.getByRole('heading', { level: 1, name: 'Orders: bulk actions' })).toBeTruthy();
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.getByText('Florian')).toBeTruthy();
    expect(screen.getByText(/Admin demo · today/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nothing built yet' })).toBeTruthy();
    expect(screen.getByText(base.lines.app)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the product today' }).getAttribute('href')).toBe('https://bridge-demo.example.com');
    expect(screen.getByText('Your preview')).toBeTruthy();
    // No Done exploring and no preview button before the first change; no grey note beside the button.
    expect(screen.queryByRole('button', { name: 'Done exploring' })).toBeNull();
    expect(screen.queryByText(/Same as the product today/)).toBeNull();
  });

  it('Continue in Claude copies the line of the selected tab', async () => {
    const onCopy = vi.fn(async () => {});
    paint({ onCopy });
    fireEvent.click(screen.getByRole('button', { name: /Continue in Claude/ }));
    expect(onCopy).toHaveBeenLastCalledWith(base.lines.app);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied. Paste it in Claude.'));
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Terminal' }));
    });
    expect(screen.getByText(base.lines.terminal)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Continue in Claude/ }));
    expect(onCopy).toHaveBeenLastCalledWith(base.lines.terminal);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the line' }));
    expect(onCopy).toHaveBeenLastCalledWith(base.lines.terminal);
  });

  it('has no axe violations', async () => {
    const { container } = paint();
    await expectNoAxeViolations(container);
  });
});

describe('ExplorationPage, exploring (X2)', () => {
  const exploring: Partial<ExplorationPageProps> = {
    stage: 'exploring',
    headline: { who: claude, text: 'changed Orders table and Bulk actions bar', when: '2 h ago' },
    previewUrl: 'https://bridge-admin-git-explore.example.com/',
    activity: [
      { who: claude, text: 'added a Bulk actions bar: Mark shipped, Export, Cancel', when: '2 h ago' },
      { who: claude, text: 'added row selection to the Orders table', when: '2 h ago' },
      { who: florian, text: 'started the exploration', when: 'Yesterday' },
    ],
  };

  it('says who changed what, opens the preview, and keeps Continue in Claude second', () => {
    paint(exploring);
    expect(screen.getByText('Exploring')).toBeTruthy();
    expect(screen.getByText('changed Orders table and Bulk actions bar,', { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe('https://bridge-admin-git-explore.example.com/');
    expect(screen.getByRole('button', { name: /Continue in Claude/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Nothing built yet' })).toBeNull();
  });

  it('Open the preview opens the product with the Bridge toolbar when it has one; no second preview button', () => {
    paint({ ...exploring, tryUrl: 'https://bridge-admin-git-explore.example.com/?bridge=611' });
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe('https://bridge-admin-git-explore.example.com/?bridge=611');
    expect(screen.queryByRole('link', { name: /Try it in the product/ })).toBeNull();
    const acts = screen.getByRole('link', { name: /Open the preview/ }).parentElement!;
    expect(within(acts).getByRole('button', { name: /Continue in Claude/ })).toBeTruthy();
    expect(acts.children).toHaveLength(2);
  });

  it('without a toolbar link it opens the plain preview, and before the preview exists it waits', () => {
    paint(exploring);
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe('https://bridge-admin-git-explore.example.com/');
    cleanup();
    paint({ ...exploring, previewUrl: null, tryUrl: 'https://x.example.com/?bridge=611', previewNote: 'Your preview appears a few minutes after each change.' });
    expect(screen.queryByRole('link', { name: /Open the preview/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Try it in the product/ })).toBeNull();
  });

  it('shows the Done exploring card and the last 3 events', () => {
    const onDone = vi.fn();
    paint({ ...exploring, onDone });
    expect(screen.getByRole('heading', { name: 'Happy with it?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done exploring' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const rows = within(screen.getByRole('region', { name: 'Activity' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[2]!.textContent).toContain('Florian started the exploration');
  });

  it('without a build yet: the button waits and says why in words', () => {
    paint({ ...exploring, previewUrl: null, previewNote: 'Your preview appears a few minutes after each change.' });
    expect((screen.getByRole('button', { name: 'Open the preview' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/appears a few minutes after/)).toBeTruthy();
  });

  it('while the preview builds: a busy status at full contrast, not a greyed-out button', async () => {
    const { container } = paint({ ...exploring, previewUrl: null, previewNote: 'Preview is building', previewBuilding: true });
    const b = screen.getByRole('button', { name: 'Preview is building' });
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.hasAttribute('data-loading')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Open the preview' })).toBeNull();
    expect(screen.getAllByText('Preview is building')).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('a signed-out visitor or a viewer without write access sees no Done exploring card', () => {
    paint({ ...exploring, done: null });
    expect(screen.queryByRole('heading', { name: 'Happy with it?' })).toBeNull();
    expect(screen.queryByRole('button', { name: /done exploring/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Open the preview/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue in Claude/ })).toBeTruthy();
  });

  it('a viewer who cannot keep it reads who can, never a GitHub error', () => {
    paint({ ...exploring, done: { kind: 'note', text: 'Florian or a reviewer says when it is done exploring.' } });
    expect(screen.queryByRole('button', { name: 'Done exploring' })).toBeNull();
    expect(screen.getByText(/says when it is done exploring/)).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = paint({ ...exploring, thumb: 'https://example.com/after.png' });
    await expectNoAxeViolations(container);
  });
});

describe('ExplorationPage, after Done exploring (Waiting for code, Being built, Shipped)', () => {
  const steps = [
    { status: 'done' as const, title: 'Done exploring', detail: 'Florian, today' },
    { status: 'waiting' as const, title: 'Developers build it', detail: 'Waiting for a developer', current: true },
    { status: 'waiting' as const, title: 'Shipped', detail: 'Then live in Admin demo' },
  ];
  const handed = (over: Partial<NonNullable<ExplorationPageProps['handoff']>> = {}, page: Partial<ExplorationPageProps> = {}) =>
    paint({
      stage: 'handed-off',
      previewUrl: 'https://orders-git-explore.vercel.app',
      tryUrl: 'https://orders-git-explore.vercel.app/?bridge=611',
      activity: [{ who: florian, text: 'said done exploring', when: '40 min ago' }],
      done: null,
      plate: { product: 'Admin demo', screen: 'Orders table' },
      handoff: { status: 'ready', doneBy: florian, doneWhen: 'today', steps, pieces: { state: 'none' }, ...over },
      ...page,
    });

  it('keeps the page family: status tag, who said done and when, the preview with one action, then what happens next', () => {
    handed();
    expect(screen.getByText('Waiting for code')).toBeTruthy();
    expect(screen.getByText(/said done exploring/, { selector: '.xp-meta span' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe('https://orders-git-explore.vercel.app/?bridge=611');
    expect(screen.queryByRole('button', { name: /Continue in Claude/ })).toBeNull();
    const next = screen.getByRole('region', { name: 'What happens next' });
    expect(within(next).getByRole('list', { name: 'From exploration to product' }).querySelectorAll('li')).toHaveLength(3);
    expect(within(next).getByText('Waiting for a developer')).toBeTruthy();
    expect(within(next).getByText('Nothing missing: everything comes from the library.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
    // No capture: the plate names the screen and the product, never a fake wireframe.
    expect(document.querySelector('.xp-plate')!.textContent).toContain('Orders table');
    expect(document.querySelector('.xp-plate')!.textContent).toContain('Admin demo · no screenshot yet');
    // One Harbor zone on the page, no grey footnote that repeats the state.
    expect(document.querySelectorAll('.zone')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Ask Claude/);
  });

  it('says Bridge checks the library while it runs, and lists the pieces with their request status after', () => {
    const { rerender } = handed({ pieces: { state: 'checking' } });
    expect(screen.getByText('Bridge is checking what the library is missing.')).toBeTruthy();
    const onPiece = vi.fn(async () => 'Opened a token change for New color #C2410C.');
    rerender(
      createElement(ExplorationPage, {
        ...base,
        stage: 'handed-off',
        previewUrl: 'https://orders-git-explore.vercel.app',
        activity: [],
        done: null,
        handoff: {
          status: 'ready',
          doneBy: florian,
          doneWhen: 'today',
          steps,
          onPiece,
          pieces: {
            state: 'rows',
            rows: [
              { id: 'alert', title: 'Alert: count of orders waiting', href: '?request=81', line: 'Requested', tone: 'neutral', opens: 'request', number: 81 },
              { id: 'color', title: 'New color #C2410C', href: null, line: null, tone: 'neutral', value: '#C2410C', action: { kind: 'open', label: 'Send for review' } },
            ],
          },
        },
      }),
    );
    expect(screen.getByRole('link', { name: 'Alert: count of orders waiting' }).getAttribute('data-open-request')).toBe('81');
    expect(screen.getByText('Requested')).toBeTruthy();
    // The value is already in the name: no second swatch label.
    expect(screen.getAllByText(/#C2410C/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(onPiece).toHaveBeenCalledWith(expect.objectContaining({ id: 'color' }));
  });

  it('never checked and Bridge cannot run it: one quiet line with the way to check in Claude', async () => {
    const onCopy = vi.fn(async () => {});
    handed({ pieces: { state: 'unchecked', claude: 'Check what the exploration "Orders" (#611) adds that the library does not have, and record it in Bridge.' } }, { onCopy });
    expect(screen.getByText('Not checked against the library.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Check in Claude/ }));
    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('adds that the library does not have'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied. Paste it in Claude.'));
  });

  it('says the line of the write that brought it here as a toast, once', async () => {
    handed({}, { said: 'Done exploring. Your developers take it from here.' });
    expect(await screen.findByText('Done exploring. Your developers take it from here.')).toBeTruthy();
    expect(document.querySelector('.xp-said')!.textContent).toBe('');
  });

  it('shipped: the tag, the product itself, and how it went', () => {
    handed({ status: 'shipped', steps: steps.map((s) => ({ ...s, status: 'done' as const })) });
    expect(screen.getByText('Shipped', { selector: '[class*="badge"]' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /See it in the product/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How it went' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = handed({ pieces: { state: 'rows', rows: [{ id: 'a', title: 'Alert: count', href: '?request=81', line: 'Requested', tone: 'neutral', opens: 'request', number: 81 }] } });
    await expectNoAxeViolations(container);
  });
});
