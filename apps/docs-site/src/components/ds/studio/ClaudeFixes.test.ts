// @vitest-environment jsdom
// Being built, Claude's fixes: one row per run with one status tag, a ready fix opens its review in Studio (never
// GitHub), a run in progress moves while the page shows it, and nothing shows without runs.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';

const run = (over: Record<string, unknown>) => ({
  id: 'a'.repeat(16),
  component: 'TextInput',
  status: 'running',
  label: 'Claude is on it',
  sentence: 'Claude is on TextInput: round 2 of 3.',
  startedBy: 'Malik Haddad',
  createdAt: '2026-10-25T10:00:00Z',
  retryAfter: 0.01,
  developer: 'Anthropic API 529: Overloaded',
  ...over,
});

let list: unknown[] = [];
let polls: unknown[] = [];
const polled: string[] = [];
vi.mock('../../../scripts/claude-api', () => ({
  listClaudeRuns: () => Promise.resolve(list),
  pollClaudeRun: (_repo: string, id: string) => {
    polled.push(id);
    return Promise.resolve(polls.shift() ?? null);
  },
}));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'design', defaultBranch: 'main', hosted: false }) }));
const { default: ClaudeFixes } = await import('./ClaudeFixes');

beforeEach(() => {
  list = [];
  polls = [];
  polled.length = 0;
});

describe("Claude's fixes", () => {
  it('shows nothing when there is no run', async () => {
    const { container } = render(createElement(ClaudeFixes));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe('');
  });

  it('one row per run with one tag; a ready fix opens its review in Studio; never the developer cause', async () => {
    list = [
      run({ id: 'b'.repeat(16), component: 'Toggle', status: 'ready', label: "Claude's fix is ready", sentence: "Claude's fix brings Toggle closer to the code. Someone on your team reviews it, then it reaches Figma.", review: 'changes/?pr=91' }),
      run({ id: 'c'.repeat(16), component: 'Tabs', status: 'no-fix', label: 'No fix found', sentence: 'Claude could not find a fix that brings Tabs closer to the code. It stays as it is.' }),
    ];
    const { container } = render(createElement(ClaudeFixes));
    expect(await screen.findByText("Claude's fixes")).toBeTruthy();
    expect(container.querySelectorAll('.sh-row-item')).toHaveLength(2);
    expect(container.querySelectorAll('.sh-row-pill')).toHaveLength(2);
    const see = screen.getByText("See Claude's fix").closest('a')!;
    expect(see.getAttribute('href')).toBe('/studio/changes/?pr=91');
    expect(container.innerHTML).not.toContain('github.com');
    expect(container.textContent).not.toContain('Anthropic API');
    expect(container.textContent).toContain('Asked by Malik Haddad.');
    expect(container.querySelector('a[href="/studio/components/?c=tabs"]')).toBeTruthy();
    expect(container.querySelectorAll('.sh-row-item button')).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it('moves a run in progress while the page shows it, one request at a time, until it is final', async () => {
    list = [run({})];
    polls = [run({ sentence: 'Claude is on TextInput: round 3 of 3.' }), run({ status: 'ready', label: "Claude's fix is ready", sentence: "Claude's fix brings TextInput closer to the code. Someone on your team reviews it, then it reaches Figma.", review: 'changes/?pr=92' })];
    render(createElement(ClaudeFixes));
    expect(await screen.findByText('Claude is on it')).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Claude's fix is ready")).toBeTruthy());
    expect(polled).toEqual(['a'.repeat(16), 'a'.repeat(16)]);
    expect(screen.getByText("See Claude's fix").closest('a')!.getAttribute('href')).toBe('/studio/changes/?pr=92');
  });
});
