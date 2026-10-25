// @vitest-environment jsdom
// Being built, Claude's fixes: one row per fix session with one tag, the real steps folded under it, a ready fix opening
// its review in Studio, and nothing without sessions.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';

let sessions: unknown[] = [];
vi.mock('../../../scripts/connector-api', () => ({ listFixSessions: () => Promise.resolve(sessions) }));
vi.mock('../../../scripts/repo-context', () => ({ repoContext: () => ({ owner: 'acme', repo: 'design', defaultBranch: 'main', hosted: false }) }));
const { default: ClaudeFixes } = await import('./ClaudeFixes');

beforeEach(() => {
  sessions = [];
});

const step = (kind: string, text: string, extra: Record<string, unknown> = {}) => ({ kind, text, at: '2026-10-25T10:00:00Z', by: 'Dana Kim', ...extra });

describe("Claude's fixes", () => {
  it('shows nothing without sessions', async () => {
    const { container } = render(createElement(ClaudeFixes));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe('');
  });

  it('one row per session with one tag and its steps; a ready fix opens its review in Studio', async () => {
    sessions = [
      { component: 'Toggle', state: 'ready', startedAt: 'x', updatedAt: 'x', elapsed: 300, steps: [step('read', 'Claude read the differences (2)'), step('try', 'Claude tried a fix (round 1): closer'), step('proposed', 'Claude opened its fix for review', { review: 'changes/?pr=91', pr: { number: 91, url: 'https://github.com/acme/design/pull/91' } })] },
      { component: 'Tabs', state: 'working', startedAt: 'x', updatedAt: 'x', elapsed: 60, steps: [step('read', 'Claude read the differences (1)')] },
    ];
    const { container } = render(createElement(ClaudeFixes));
    expect(await screen.findByText("Claude's fixes")).toBeTruthy();
    expect(container.querySelectorAll('.sh-row-item')).toHaveLength(2);
    expect(container.querySelectorAll('.sh-row-pill')).toHaveLength(2);
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.getByText('Claude is working')).toBeTruthy();
    expect(screen.getByText("See Claude's fix").closest('a')!.getAttribute('href')).toBe('/studio/changes/?pr=91');
    expect(container.querySelector('a[href="/studio/components/?c=tabs"]')).toBeTruthy();
    expect(container.textContent).toContain('Claude tried a fix (round 1): closer');
    expect(container.innerHTML).not.toContain('github.com');
    expect(container.textContent).not.toMatch(/%/);
    await expectNoAxeViolations(container);
  });
});
