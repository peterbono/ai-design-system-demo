// @vitest-environment jsdom
// The exploration page while it runs, boards X1 (nothing built yet) and X2 (Claude has changed things).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { forgetAiToolsRead } from '../../../scripts/ai-tools';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { ExplorationPage, type ExplorationPageProps } from './ExplorationPage';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { userEvent } from '@testing-library/user-event';
import { explorationMenu } from '../../../lib/exploration-page';

// The connection read: once connected in Claude, the next read says yes.
const linkReads = vi.hoisted(() => ({ forget: vi.fn() }));
vi.mock('../../../scripts/claude-link', () => ({
  forgetClaudeLink: linkReads.forget,
  viewerClaudeLink: async () => 'yes',
  knownClaudeLink: () => 'unknown',
}));

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

afterEach(() => {
  cleanup();
  // The last tab and the AI tools are this browser's: each test starts without them. The read of the tools is kept
  // once per page: the one of an earlier test would otherwise answer here, with no tools.
  localStorage.clear();
  forgetAiToolsRead();
});

describe('the Continue panel shows only the viewer\'s own AI tools', () => {
  it('never answered: Claude app and Terminal, and a quiet Use another AI tool? that opens the choice', async () => {
    paint();
    expect(screen.getByRole('radio', { name: 'Claude app' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Terminal' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /^VS Code/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use another AI tool?' }));
    });
    const dialog = await screen.findByRole('dialog', { name: 'Your AI tools' });
    expect(within(dialog).getByRole('checkbox', { name: /GitHub Copilot in VS Code/ })).toBeTruthy();
    await expectNoAxeViolations(dialog);
  });

  it('one tool (Copilot): no tabs, the line for Copilot Chat, the once-only command, and Copy for Copilot copies', async () => {
    localStorage.setItem('bridge.ai-tools', '["copilot"]');
    const onCopy = vi.fn(async () => {});
    paint({ onCopy, copilotSetup: { label: "Needs this once, in the product's folder:", command: 'npx @bridge-ds/cli connect --ds acme/design --tool copilot' } });
    await screen.findByText('Paste this in Copilot Chat');
    // The viewer's tools are read after the first paint: wait for the panel to settle on them.
    await waitFor(() => expect(screen.queryAllByRole('radio')).toHaveLength(0));
    expect(screen.queryByRole('button', { name: 'Use another AI tool?' })).toBeNull();
    expect(screen.getByText('npx @bridge-ds/cli connect --ds acme/design --tool copilot')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Continue in Claude/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy for Copilot' }));
    });
    expect(onCopy).toHaveBeenLastCalledWith(base.lines.app);
    expect(screen.getByText('Copied. Paste it in Copilot Chat in VS Code, in Agent mode.')).toBeTruthy();
  });

  it('several tools: tabs limited to them, and the last tab used opens next time', async () => {
    localStorage.setItem('bridge.ai-tools', '["claude-app","copilot"]');
    paint();
    await screen.findByRole('radio', { name: /^VS Code/ });
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'Terminal' })).toBeNull());
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^VS Code/ }));
    });
    expect(localStorage.getItem('bridge.ai-tab')).toBe('copilot');
    cleanup();
    paint();
    await waitFor(() => expect(screen.getByText('Paste this in Copilot Chat')).toBeTruthy());
  });
});

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

  it('Continue in Claude opens a new Claude conversation with the line (Claude app), copies it for the Terminal', async () => {
    const onCopy = vi.fn(async () => {});
    paint({ onCopy });
    const open = screen.getByRole('link', { name: /Continue in Claude/ });
    expect(open.getAttribute('href')).toBe(`https://claude.ai/new?q=${encodeURIComponent(base.lines.app)}`);
    expect(open.getAttribute('target')).toBe('_blank');
    fireEvent.click(open);
    expect(onCopy).toHaveBeenLastCalledWith(base.lines.app);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Opened in Claude with the line ready. Press Enter to start.'));
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

describe("Continue in Claude, gated on the viewer's own Claude connection", () => {
  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(base.lines.app)}`;

  it('connected: opens Claude directly with the line', () => {
    paint({ claudeLink: 'yes' });
    expect(screen.getByRole('link', { name: /Continue in Claude/ }).getAttribute('href')).toBe(claudeUrl);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the read failed or did not run (unknown): opens Claude directly, as before', () => {
    paint({ claudeLink: 'unknown' });
    expect(screen.getByRole('link', { name: /Continue in Claude/ }).getAttribute('href')).toBe(claudeUrl);
  });

  it('not connected: the steps come first in place, the one primary opens Claude connectors, the line waits under them', async () => {
    const onCopy = vi.fn(async () => {});
    paint({ claudeLink: 'no', connectorAddress: 'https://bridge.example.com/mcp', onCopy });
    expect(screen.queryByRole('link', { name: /Continue in Claude/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Continue in Claude/ })).toBeNull();
    expect(screen.getByText(/Add custom connector, name it Bridge/)).toBeTruthy();
    expect(screen.getByText('Sign in with Bridge when Claude asks.')).toBeTruthy();
    expect(screen.getByText('https://bridge.example.com/mcp')).toBeTruthy();
    expect(screen.getByText('Then paste this in Claude')).toBeTruthy();
    expect(screen.getByText(base.lines.app)).toBeTruthy();
    const connect = screen.getByRole('link', { name: /Connect Bridge to Claude/ });
    expect(connect.getAttribute('href')).toBe('https://claude.ai/settings/connectors');
    expect(connect.getAttribute('target')).toBe('_blank');
    // One primary: the steps do not repeat the connectors link.
    expect(screen.queryByRole('link', { name: /Open Claude connectors/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    });
    expect(onCopy).toHaveBeenLastCalledWith('https://bridge.example.com/mcp');
    expect(screen.getByRole('button', { name: 'Address copied' })).toBeTruthy();
  });

  it('not connected: coming back to the page reads the connection again and hands it to the page', async () => {
    const onClaudeLink = vi.fn();
    paint({ claudeLink: 'no', onClaudeLink });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(onClaudeLink).toHaveBeenCalledWith('yes'));
    expect(linkReads.forget).toHaveBeenCalled();
  });

  it('the Terminal tab still copies, and names the one command a product folder needs', async () => {
    const onCopy = vi.fn(async () => {});
    paint({ claudeLink: 'no', onCopy, terminalSetup: 'npx @bridge-ds/cli connect --ds acme/design' });
    expect(screen.queryByText('npx @bridge-ds/cli connect --ds acme/design')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Terminal' }));
    });
    expect(screen.getByText("Once, in the product's folder:")).toBeTruthy();
    expect(screen.getByText('npx @bridge-ds/cli connect --ds acme/design')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Continue in Claude/ }));
    expect(onCopy).toHaveBeenLastCalledWith(base.lines.terminal);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Check in Claude has the same gate', async () => {
    paint({
      claudeLink: 'no',
      stage: 'handed-off',
      done: null,
      handoff: { status: 'ready', doneBy: florian, doneWhen: 'today', steps: [], pieces: { state: 'unchecked', claude: 'Check what the exploration adds.' } },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check in Claude/ }));
    });
    const dialog = await screen.findByRole('dialog', { name: 'Connect Bridge to your Claude first' });
    expect(within(dialog).getByRole('link', { name: "I've connected it, continue" }).getAttribute('href')).toBe(`https://claude.ai/new?q=${encodeURIComponent('Check what the exploration adds.')}`);
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
    expect(screen.getByRole('link', { name: /Continue in Claude/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Nothing built yet' })).toBeNull();
  });

  it('the product moved since it started: a quiet line, and Bring it in says what happened', async () => {
    const onBring = vi.fn(async () => 'The latest is in. Your preview updates in a few minutes.');
    paint({ ...exploring, latest: { line: 'Art print shop changed since this exploration started.', onBring } });
    expect(screen.getByText('Art print shop changed since this exploration started.', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bring it in' }));
    await waitFor(() => expect(onBring).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText('The latest is in. Your preview updates in a few minutes.')).toBeTruthy());
  });

  it('Open the preview opens the product with the Bridge toolbar when it has one; no second preview button', () => {
    paint({ ...exploring, tryUrl: 'https://bridge-admin-git-explore.example.com/?bridge=611' });
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe('https://bridge-admin-git-explore.example.com/?bridge=611');
    expect(screen.queryByRole('link', { name: /Try it in the product/ })).toBeNull();
    const acts = screen.getByRole('link', { name: /Open the preview/ }).closest<HTMLElement>('.xp-preview-acts')!;
    expect(within(acts).getByRole('link', { name: /Continue in Claude/ })).toBeTruthy();
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
    expect(screen.getByRole('link', { name: /Continue in Claude/ })).toBeTruthy();
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

describe('ExplorationPage, after Done exploring (Waiting to be picked up, Being built, Shipped)', () => {
  const steps = [
    { status: 'done' as const, title: 'Done exploring', detail: 'Florian, today. Sent to the Admin demo developers.' },
    { status: 'waiting' as const, title: 'Developers build it', detail: 'In their task list. You see here when one picks it up.', current: true },
    { status: 'waiting' as const, title: 'Review', detail: 'After the developers' },
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
    expect(screen.getByText('Waiting to be picked up')).toBeTruthy();
    expect(screen.getByText(/said done exploring/, { selector: '.xp-meta span' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe('https://orders-git-explore.vercel.app/?bridge=611');
    expect(screen.queryByRole('link', { name: /Continue in Claude/ })).toBeNull();
    const next = screen.getByRole('region', { name: 'What happens next' });
    expect(within(next).getByRole('list', { name: 'From exploration to product' }).querySelectorAll('li')).toHaveLength(4);
    expect(within(next).getByText('In their task list. You see here when one picks it up.')).toBeTruthy();
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
    const check = screen.getByRole('link', { name: /Check in Claude/ });
    expect(check.getAttribute('href')).toContain('https://claude.ai/new?q=');
    fireEvent.click(check);
    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining('adds that the library does not have'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Opened in Claude with the line ready. Press Enter to start.'));
  });

  it('says the line of the write that brought it here as a toast, once', async () => {
    handed({}, { said: 'Done exploring. Your developers take it from here.' });
    expect(await screen.findByText('Done exploring. Your developers take it from here.')).toBeTruthy();
    expect(document.querySelector('.xp-said')!.textContent).toBe('');
  });

  it('shows the preview capture with when it was taken, and the plate again when the image does not load', () => {
    // Midday: "3 h ago" never crosses midnight (it reads "yesterday" then, as CI found at 00:05).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0));
    onTestFinished(() => void vi.useRealTimers());
    const capturedAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    handed({}, { thumb: 'https://raw.githubusercontent.com/o/r/bridge-shots/o/p/2.webp?v=abc1234', thumbCapturedAt: capturedAt });
    const img = screen.getByRole('img', { name: 'The latest captured screen of this exploration' });
    expect(img.getAttribute('src')).toContain('/bridge-shots/');
    expect(document.querySelector('.xp-captured')!.textContent).toBe('Captured 3 h ago');
    fireEvent.error(img);
    expect(document.querySelector('.xp-frame.is-shot')).toBeNull();
    expect(document.querySelector('.xp-plate')!.textContent).toContain('Orders table');
  });

  it("Check the build: Open the build lands on the page Bridge captured the developers' build on", () => {
    handed({ build: { url: 'https://build-x.acme-account.pages.dev/', builder: 'Lee', shot: { src: 'blob:x', capturedAt: null, route: '/billing' } } });
    expect(screen.getByRole('link', { name: /Open the build/ }).getAttribute('href')).toBe('https://build-x.acme-account.pages.dev/billing');
  });

  it('puts the activity under the preview, beside the hand-off zone: the same skeleton as while exploring', () => {
    handed();
    const grid = document.querySelector('.xp-board')!;
    expect(grid.className).toBe('xp-board');
    expect([...grid.children].map((c) => c.className.split(' ')[0])).toEqual(['xp-preview', 'xp-side', 'xp-activity']);
  });

  it('the viewer asked to review: the review row says so, with the link to compare under the steps', () => {
    handed({
      status: 'building',
      steps: [
        steps[0]!,
        { status: 'done' as const, title: 'Built', detail: 'By Sam' },
        { status: 'waiting' as const, title: 'Review', detail: 'Your review', current: true, link: { label: 'Compare with the exploration', href: 'https://orders-git-explore.vercel.app' } },
        steps[3]!,
      ],
    });
    const next = screen.getByRole('region', { name: 'What happens next' });
    const row = within(next).getByText('Your review').closest('li')!;
    expect(row.getAttribute('aria-current')).toBe('step');
    // Under the steps, never inside the row: a row action squeezed every detail to one word a line.
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(next).getByRole('link', { name: 'Compare with the exploration' }).getAttribute('href')).toBe('https://orders-git-explore.vercel.app');
    expect(within(next).getAllByRole('link', { name: 'Compare with the exploration' })).toHaveLength(1);
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

  describe('a question on the task', () => {
    const sam = { login: 'sam', name: 'Sam Lee', agent: false, avatar: null };
    const asking = [steps[0]!, { status: 'warning' as const, title: 'Developers build it', detail: 'Sam Lee, design lead, asked a question', current: true }, steps[2]!, steps[3]!];
    const long = `Should the empty state use the illustration from the old page? ${'We want to match the rest of the shop. '.repeat(12)}Thanks!`;

    it('quotes their words as plain text, who and when, with the reply box; long words fold behind Show more', async () => {
      const onReply = vi.fn(async () => 'Sent to Sam Lee.');
      handed({ steps: asking, question: { text: `<img src=x onerror=alert(1)> ${long}`, by: sam, when: 'today', answered: false, onReply } });
      const next = screen.getByRole('region', { name: 'What happens next' });
      expect(within(next).getByText('Sam Lee, design lead, asked a question').closest('li')!.getAttribute('aria-current')).toBe('step');
      const q = within(next).getByRole('region', { name: "Sam Lee's question" });
      // Escaped, never HTML: the tag reads as text, no image is made.
      expect(q.querySelector('img:not([class*="avatar"] img)')).toBeNull();
      expect(q.querySelector('blockquote')!.textContent).toContain('Should the empty state');
      expect(q.querySelector('blockquote')!.textContent!.endsWith('…')).toBe(true);
      expect(within(q).getByText('Sam Lee, today')).toBeTruthy();
      // Where the answer goes, in neutral words: the asker may not be a developer.
      expect(within(q).getByText('They read your answer where they work.')).toBeTruthy();
      const more = within(q).getByRole('button', { name: 'Show more' });
      expect(more.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(more);
      expect(q.querySelector('blockquote')!.textContent).toContain('Thanks!');
      expect(within(q).getByRole('button', { name: 'Show less' })).toBeTruthy();
      // The reply goes out once there are words, through the viewer's own route.
      const send = within(q).getByRole('button', { name: 'Send to Sam' });
      expect((send as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(within(q).getByLabelText('Your answer'), { target: { value: 'Yes, the old illustration.' } });
      await act(async () => {
        fireEvent.click(send);
      });
      expect(onReply).toHaveBeenCalledWith('Yes, the old illustration.');
      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sent to Sam Lee.'));
      expect(document.body.textContent).not.toMatch(/\bissue\b|pull request|state_reason|—|the developers read|send to the developers/i);
      await expectNoAxeViolations(next);
    });

    it('waiting on the viewer: the question leads the zone, its answer is the one primary action', () => {
      handed({ steps: asking, question: { text: 'Red or orange?', by: sam, when: 'today', answered: false, onReply: async () => undefined } });
      const next = screen.getByRole('region', { name: 'What happens next' });
      const q = within(next).getByRole('region', { name: "Sam Lee's question" });
      // Before the steps, and who asked before their words.
      expect(q.compareDocumentPosition(next.querySelector('ol, ul')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(q.querySelector('figcaption')!.compareDocumentPosition(q.querySelector('blockquote')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(q).getByRole('button', { name: 'Send to Sam' }).className).toMatch(/primary/);
      expect(screen.getByRole('link', { name: /Open the preview/ }).className).not.toMatch(/primary/);
    });

    it('answered: one quiet line, no reply box', () => {
      handed({ question: { text: 'Red or orange?', by: sam, when: 'today', answered: true, onReply: null } });
      expect(screen.getByText('Answered. The work goes on from here.')).toBeTruthy();
      expect(screen.queryByLabelText('Your answer')).toBeNull();
    });

    it('a needs-design label with no words: says their input is needed, names nobody', () => {
      handed({ steps: asking, question: { text: null, by: null, when: '', answered: false, onReply: async () => undefined } });
      expect(screen.getByText('Your input is needed before it is built.')).toBeTruthy();
      expect(screen.getByLabelText('Your answer')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Send your answer' })).toBeTruthy();
    });
  });

  describe('declined by the developers', () => {
    const sam = { login: 'sam', name: 'Sam', agent: false, avatar: null };
    const declinedSteps = [
      steps[0]!,
      { status: 'warning' as const, title: 'Developers build it', detail: 'Developers closed it without building it.', current: true },
      { status: 'waiting' as const, title: 'Review', detail: 'Not built' },
      { status: 'waiting' as const, title: 'Shipped', detail: 'Not built' },
    ];

    it('Not planned, their last word, and Back to exploring as the one primary action', async () => {
      const onReopen = vi.fn(async () => 'Back to exploring. Say Done exploring again when it is ready for developers.');
      handed({ stage: 'not-planned', steps: declinedSteps, declined: { note: { text: 'Not this quarter, sorry.', by: sam, when: 'Oct 31' } } }, { onReopen });
      expect(screen.getByText('Not planned', { selector: '[class*="badge"]' })).toBeTruthy();
      const next = screen.getByRole('region', { name: 'What happens next' });
      expect(within(next).getByText('Developers closed it without building it.')).toBeTruthy();
      expect(within(next).getByText('Not this quarter, sorry.')).toBeTruthy();
      expect(within(next).getByText('Sam, Oct 31')).toBeTruthy();
      // One primary action: Back to exploring; the preview steps back to secondary.
      const back = within(next).getByRole('button', { name: 'Back to exploring' });
      expect(back.className).toMatch(/primary/);
      expect(screen.getByRole('link', { name: /Open the preview/ }).className).not.toMatch(/primary/);
      fireEvent.click(back);
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toContain('Your developers closed it without building it.');
      expect(document.body.textContent).not.toMatch(/not_planned|state_reason|\bissue\b|—/i);
    });

    it('closed without a word: the sentence alone, still the way back', () => {
      handed({ stage: 'not-planned', steps: declinedSteps, declined: { note: null } }, { onReopen: async () => undefined });
      expect(screen.getByText('Developers closed it without building it.')).toBeTruthy();
      expect(document.querySelector('.xp-quote')).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Back to exploring' }).length).toBeGreaterThan(0);
    });
  });

  it('approved by the designer: the tag reads the next state', () => {
    handed({ status: 'building', stage: 'approved' });
    expect(screen.getByText('Approved, waiting to ship', { selector: '[class*="badge"]' })).toBeTruthy();
  });

  describe('a product added from its address: its developers work elsewhere', () => {
    const elsewhere = [steps[0]!, { ...steps[1]!, detail: 'Their developers work elsewhere: send them the message.' }, steps[2]!, steps[3]!];
    const message = 'A change to Poster Studio is ready to build.\n\nWhat changes: Bigger frame picker';

    it('"Copy for your developers" on the step it acts on, then says where to paste it', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { container } = handed({ steps: elsewhere, forDevelopers: { message } });
      const step = screen.getByText('Developers build it').closest('li')!;
      expect(step.textContent).toContain('Their developers work elsewhere: send them the message.');
      // Proximity: the action sits on the row of the status it acts on, right under its words, and it is quiet (a link).
      const button = within(step).getByRole('button', { name: 'Copy for your developers' });
      expect(button.className).toMatch(/link/);
      expect(button.closest('.xp-send')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Copy for your developers' })).toHaveLength(1);
      await user.click(button);
      expect(writeText).toHaveBeenCalledWith(message);
      expect(step.textContent).toContain('Message copied. Paste it where your developers work.');
      expect([...document.querySelectorAll('[role="status"]')].some((n) => n.textContent === 'Message copied. Paste it where your developers work.')).toBe(true);
      await expectNoAxeViolations(container);
    });

    it('not for a visitor (no message passed), nor once shipped or declined', () => {
      handed({ steps: elsewhere });
      expect(screen.queryByRole('button', { name: 'Copy for your developers' })).toBeNull();
      cleanup();
      handed({ status: 'shipped', steps: elsewhere, forDevelopers: { message } });
      expect(screen.queryByRole('button', { name: 'Copy for your developers' })).toBeNull();
      cleanup();
      handed({ steps: elsewhere, forDevelopers: { message }, declined: { note: null } });
      expect(screen.queryByRole('button', { name: 'Copy for your developers' })).toBeNull();
    });
  });
});

describe('the "..." menu: Rename, Back to exploring, Archive', () => {
  it('who sees what: only the keeper; Back to exploring only while waiting to be picked up, never once developers build', () => {
    expect(explorationMenu({ writable: false, status: 'ready' })).toEqual({ rename: false, reopen: false, archive: false });
    expect(explorationMenu({ writable: true, status: 'active' })).toEqual({ rename: true, reopen: false, archive: true });
    expect(explorationMenu({ writable: true, status: 'ready' })).toEqual({ rename: true, reopen: true, archive: true });
    expect(explorationMenu({ writable: true, status: 'building' })).toEqual({ rename: true, reopen: false, archive: true });
    expect(explorationMenu({ writable: true, status: 'shipped' }).rename).toBe(false);
  });

  it('nothing offered: no menu at all', () => {
    paint({ onArchive: null, onRename: null, onReopen: null });
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('the keeper: the three items in order', async () => {
    paint({ onRename: async () => undefined, onReopen: async () => undefined });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await screen.findByRole('menuitem', { name: 'Rename' });
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual(['Rename', 'Back to exploring', 'Archive']);
  });

  it('building (no Back to exploring offered): Rename and Archive only', async () => {
    paint({ onRename: async () => undefined, onReopen: null });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await screen.findByRole('menuitem', { name: 'Rename' });
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual(['Rename', 'Archive']);
  });

  it('Rename: a DS dialog with the name prefilled, Save sends the new name and says it', async () => {
    const onRename = vi.fn(async () => 'Renamed. Its link and preview stay the same.');
    paint({ onRename });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename this exploration' });
    const field = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(field.value).toBe('Orders: bulk actions');
    await expectNoAxeViolations(dialog);
    await user.clear(field);
    await user.type(field, 'Orders: faster bulk actions');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Orders: faster bulk actions'));
    expect(await screen.findByText('Renamed. Its link and preview stay the same.')).toBeTruthy();
  });

  it('Rename refused: the reason under the field, the dialog stays', async () => {
    paint({ onRename: async () => Promise.reject(new Error('Keep the name under 60 characters.')) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename this exploration' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' again');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Keep the name under 60 characters.')).toBeTruthy();
  });

  it('Back to exploring: a confirmation first, then the line', async () => {
    const onReopen = vi.fn(async () => 'Back to exploring. Say Done exploring again when it is ready for developers.');
    paint({ onReopen });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Back to exploring' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Back to exploring?' });
    expect(within(dialog).getByText('Your developers have not started yet. The exploration runs again and Done exploring comes back.')).toBeTruthy();
    expect(onReopen).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Back to exploring' }));
    await waitFor(() => expect(onReopen).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Back to exploring. Say Done exploring again when it is ready for developers.')).toBeTruthy();
  });
});

describe('Where it stands on the page', () => {
  const notes = { context: '', decisions: ['Pill on primary'], edgeCases: [], openQuestions: [], nextStep: 'Try the cart.' };
  it('sits above the activity while exploring, under the start panel while nothing is built, not shown without notes', () => {
    paint({ stage: 'exploring', activity: [], notes: { notes } });
    const where = screen.getByRole('heading', { name: 'Where it stands' });
    const activity = screen.getByRole('heading', { name: 'Activity' });
    expect(where.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    paint({ notes: { notes } });
    const start = screen.getByRole('heading', { name: 'Nothing built yet' });
    expect(start.compareDocumentPosition(screen.getByRole('heading', { name: 'Where it stands' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    paint({ stage: 'exploring', activity: [] });
    expect(screen.queryByRole('heading', { name: 'Where it stands' })).toBeNull();
  });
});

describe('Send to Figma', () => {
  const exploring: Partial<ExplorationPageProps> = { stage: 'exploring', previewUrl: 'https://preview.example.com', activity: [] };
  const figma = { app: 'Put Bridge exploration admin-app#1 "Orders" in Figma.', terminal: 'claude "Put Bridge exploration admin-app#1 in Figma"' };
  const notes = (figmaPage?: string) => ({ notes: { context: '', decisions: [], edgeCases: [], openQuestions: [], nextStep: '', ...(figmaPage ? { figmaPage } : {}) } });

  it('one action row in fixed places: the preview first, the AI tool second, Send to Figma third; activity under the preview', () => {
    paint({ ...exploring, figma, claudeLink: 'yes' });
    const places = [...document.querySelectorAll('.xp-preview-acts > .xp-act')].map((el) => el.className.split(' ')[1]);
    expect(places).toEqual(['is-main', 'is-second', 'is-third']);
    expect(document.querySelector('.xp-act.is-main')!.textContent).toContain('Open the preview');
    expect(document.querySelector('.xp-act.is-third')!.textContent).toContain('Send to Figma');
    const grid = document.querySelector('.xp-board')!;
    expect([...grid.children].map((c) => c.className.split(' ')[0])).toEqual(['xp-preview', 'xp-side', 'xp-activity']);
  });

  it('no Figma file or no right to edit (no line): no button', () => {
    paint(exploring);
    expect(screen.queryByText('Send to Figma')).toBeNull();
    expect(screen.queryByRole('link', { name: /See it in Figma/ })).toBeNull();
  });

  it('opens a new Claude conversation with the line, and copies it', async () => {
    const onCopy = vi.fn(async () => {});
    paint({ ...exploring, figma, onCopy, claudeLink: 'yes' });
    const link = await screen.findByRole('link', { name: /Send to Figma/ });
    expect(link.getAttribute('href')).toBe(`https://claude.ai/new?q=${encodeURIComponent(figma.app)}`);
    await act(async () => {
      fireEvent.click(link);
    });
    expect(onCopy).toHaveBeenCalledWith(figma.app);
  });

  it('asks to connect Claude first while its Claude has no Bridge', async () => {
    paint({ ...exploring, figma, claudeLink: 'no' });
    expect(await screen.findByRole('button', { name: /Send to Figma/ })).toBeTruthy();
  });

  it('in the design copy: still goes to the Claude app, never Claude Code', async () => {
    paint({ ...exploring, figma, claudeCodeUrl: 'https://claude.ai/code?repo=x' });
    expect((await screen.findByRole('link', { name: /Send to Figma/ })).getAttribute('href')).toContain('claude.ai/new?q=');
  });

  it('once Claude recorded the page: the link, for everyone, and the action says again', async () => {
    paint({ ...exploring, figma, notes: notes('https://www.figma.com/design/x/?node-id=24-5') });
    expect((await screen.findByRole('link', { name: /See it in Figma/ })).getAttribute('href')).toBe('https://www.figma.com/design/x/?node-id=24-5');
    expect(screen.getByRole('link', { name: /Send to Figma again/ })).toBeTruthy();
    cleanup();
    paint({ ...exploring, notes: notes('https://www.figma.com/design/x/?node-id=24-5') });
    expect(screen.getByRole('link', { name: /See it in Figma/ })).toBeTruthy();
    expect(screen.queryByText(/Send to Figma/)).toBeNull();
  });

  it('archived: nothing offers it', () => {
    paint({ ...exploring, figma, archived: true, notes: notes() });
    expect(screen.queryByText('Send to Figma')).toBeNull();
  });

  it('a page with the action has no axe violations', async () => {
    const { container } = paint({ ...exploring, figma, notes: notes() });
    await expectNoAxeViolations(container);
  });
});

describe('the talk with a lead on the page', () => {
  const bar = { onLooksRight: async () => 'ok', onChanges: async () => 'ok', onComment: async () => 'ok', onNotDoing: async () => undefined, onAskOther: null, link: 'https://x', onCopy: async () => undefined, changedSince: false };
  const face = { login: 'flo', name: 'Florian', agent: false, avatar: null };
  it('a lead whose question waits keeps the bar, reads their own words, and gets no way into Claude', () => {
    paint({ stage: 'exploring', tag: { label: 'Waiting for Ann', tone: 'info' }, lead: { heading: 'With Ann', line: 'You asked Ann. Waiting for their answer.', bar } });
    expect(screen.getByRole('heading', { name: 'With Ann' })).toBeTruthy();
    expect(screen.getByText('You asked Ann. Waiting for their answer.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeTruthy();
    expect(screen.queryByText(/Open in Claude Code|Continue in Claude/)).toBeNull();
  });
  it('Not doing this shows its reason, and the way to start again, on the board', () => {
    paint({ stage: 'exploring', archived: true, tag: { label: 'Not doing this', tone: 'neutral' }, notDoing: { title: 'Florian decided not to do this', who: face, when: 'today', text: 'Billing covers it', onReopen: async () => undefined }, decisions: [{ key: '0', name: 'Florian', login: 'flo', verb: 'decided not to do this', why: 'Billing covers it', round: 1, at: '2026-11-07T00:00:00Z' }] });
    expect(screen.getByRole('heading', { name: 'Florian decided not to do this' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reopen as a new exploration' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Decisions' })).toBeTruthy();
    expect(screen.queryByText('Nothing built yet')).toBeNull();
  });
});

describe('the product manager (boards R1, R3)', () => {
  const dino = { login: 'name:Dino', name: 'Dino', agent: false, avatar: null };
  it('the PM gives their opinion in place of the Harbor card: a note is needed for Needs changes', async () => {
    const onSay = vi.fn(async () => 'Sent to the designer, with your note.');
    paint({ stage: 'exploring', pm: { mine: true, title: 'What do you think, Dino?', intro: 'Mia shares this with you before it goes to the design lead.', line: 'You have not said what you think yet.', onSay } });
    expect(screen.getByRole('heading', { name: 'What do you think, Dino?' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Happy with it?' })).toBeNull();
    const changes = screen.getByRole('button', { name: 'Needs changes' }) as HTMLButtonElement;
    expect(changes.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Your note/), { target: { value: 'Show how many days late' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Needs changes' }));
    });
    expect(onSay).toHaveBeenCalledWith('pm-changes', 'Show how many days late');
    await expectNoAxeViolations(document.body);
  });

  it('the designer reads where the PM stands, and can say they agreed in a call', async () => {
    const onCall = vi.fn(async () => 'Noted.');
    paint({ stage: 'exploring', pm: { mine: false, title: '', intro: '', line: 'Dino asked for changes, today.', quote: { who: dino, when: 'today', text: 'Show how many days late' }, call: { label: 'Dino agreed in a call', onCall } } });
    expect(screen.getByRole('heading', { name: 'Product manager' })).toBeTruthy();
    expect(screen.getByText('Show how many days late')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Happy with it?' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dino agreed in a call' }));
    });
    expect(onCall).toHaveBeenCalled();
  });
});
