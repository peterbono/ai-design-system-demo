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

  it('Try it in the product opens the product with the Bridge toolbar, next to Open the preview', () => {
    paint({ ...exploring, tryUrl: 'https://bridge-admin-git-explore.example.com/?bridge=611' });
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links.indexOf('Try it in the product')).toBe(links.findIndex((t) => /Open the preview/.test(t ?? '')) + 1);
    expect(screen.getByRole('link', { name: 'Try it in the product' }).getAttribute('href')).toBe('https://bridge-admin-git-explore.example.com/?bridge=611');
  });

  it('no Try it in the product without a toolbar link, or before the preview exists', () => {
    paint(exploring);
    expect(screen.queryByRole('link', { name: 'Try it in the product' })).toBeNull();
    cleanup();
    paint({ ...exploring, previewUrl: null, tryUrl: 'https://x.example.com/?bridge=611', previewNote: 'Your preview appears a few minutes after each change.' });
    expect(screen.queryByRole('link', { name: 'Try it in the product' })).toBeNull();
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
