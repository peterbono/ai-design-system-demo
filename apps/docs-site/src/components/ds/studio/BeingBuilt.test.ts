// @vitest-environment jsdom
// Being built: the list with one tag per row and no row buttons, the detail in place, the empty state that teaches,
// and Claude's fixes as rows of the same list (no section of their own).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { assembleBuildRequests, composeBuildRequestIssue } from '@bridge-ds/core';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { sampleBuildData, SAMPLE_BUILDERS } from '../../../lib/building-sample';
import { explorationBuildRows, toBuildIssue, toBuildPull, type RestPull } from '../../../lib/building-view';
import { DEFAULT_PRODUCTS } from '@bridge-ds/core';
import { fixRows, parseSession } from '../../../lib/claude-connector';

const NOW = Date.now();
let data: unknown = null;
vi.mock('../../../scripts/building-data', () => ({ loadBuildData: () => Promise.resolve(data), readFixes: () => Promise.resolve([]) }));
const { default: BeingBuilt } = await import('./BeingBuilt');

function sample() {
  const { issues, pulls } = sampleBuildData(NOW);
  const nameOf = (l: string) => SAMPLE_BUILDERS[l] ?? l;
  return { views: assembleBuildRequests({ issues: issues.map(toBuildIssue), pulls: pulls.map(toBuildPull), now: NOW, nameOf }), bodies: new Map(issues.map((i) => [i.number, i.body ?? ''])), sample: true, stale: false, nameOf, jiraBase: null };
}

beforeEach(() => history.replaceState(null, '', '/studio/building/'));

describe('Being built', () => {
  it('lists every build request with one status tag and no row button', async () => {
    data = sample();
    const { container } = render(createElement(BeingBuilt));
    expect(await screen.findByText('Tabs: put a count after the label')).toBeTruthy();
    expect(screen.getByText('Requested 10 days ago')).toBeTruthy();
    expect(container.querySelectorAll('.sh-row-item')).toHaveLength(6);
    expect(container.querySelectorAll('.sh-row-item button')).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it('filters, then opens the detail in place with the developer fold', async () => {
    data = sample();
    render(createElement(BeingBuilt));
    await screen.findByText('Tabs: put a count after the label');
    await userEvent.click(screen.getByRole('tab', { name: /In progress/ }));
    expect(screen.queryByText('Tabs: put a count after the label')).toBeNull();
    await userEvent.click(screen.getByText('Badge: add an info tone'));
    expect(location.search).toBe('?request=33');
    expect(screen.getByRole('heading', { name: 'Badge: add an info tone' })).toBeTruthy();
    expect(screen.getByText('Where it stands')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'For developers' })).toBeTruthy();
  });

  it('teaches what a build request is when nothing was sent', async () => {
    data = { ...sample(), views: [], sample: false };
    const { container } = render(createElement(BeingBuilt));
    expect(await screen.findByText('Nothing is being built yet.')).toBeTruthy();
    expect(container.textContent).toContain('Bridge Figma plugin');
    expect(container.textContent).toContain('GitHub or Jira');
    await expectNoAxeViolations(container);
  });

  it("lists Claude's fixes in the same list, reconciled with their pull request, counted by the filters", async () => {
    const at = new Date(NOW - 2 * 86_400_000).toISOString();
    const session = parseSession({ component: 'Button', state: 'ready', startedAt: at, updatedAt: at, elapsed: 180, steps: [{ kind: 'proposed', text: 'Claude opened its fix for review', at, by: 'peterbono', review: 'changes/?pr=598' }] })!;
    const base = sample();
    const fixes = fixRows([session], [{ number: 598, state: 'closed', merged_at: at, updated_at: at }], NOW, (l) => (l === 'peterbono' ? 'Florian' : l));
    data = { ...base, sample: false, fixes };
    const { container } = render(createElement(BeingBuilt));
    expect(await screen.findByText('Button')).toBeTruthy();
    expect(container.querySelectorAll('.sh-row-item')).toHaveLength(7);
    expect(container.textContent).toContain("Claude's fix from Figma, asked by Florian");
    expect(container.textContent).not.toContain('peterbono');
    expect(container.textContent).not.toContain('Ready for review');
    expect(container.textContent).not.toContain("Claude's fixes\n");
    expect(container.querySelector('a[href="/studio/changes/?pr=598"]')).toBeTruthy();
    expect(container.innerHTML).not.toContain('github.com/peterbono');
    expect(container.querySelectorAll('.sh-row-item button')).toHaveLength(0);
    await userEvent.click(screen.getByRole('tab', { name: /Shipped this week/ }));
    expect(screen.getByText('Button')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: /Waiting to be picked up/ }));
    expect(screen.queryByText('Button')).toBeNull();
    await expectNoAxeViolations(container);
  });

  // Issue #489 "Tag: test: rounder tag corners", closed as not planned, with its In code now and In Figma pictures.
  const declinedTag = (closedDaysAgo: number) => {
    const at = new Date(NOW - closedDaysAgo * 86_400_000).toISOString();
    const r = composeBuildRequestIssue({ component: 'Tag', kind: 'visual', title: 'Test: rounder tag corners', summary: 'Tags would read softer.', figma: { nodeName: 'Tone=signal' }, images: { before: ['https://example.com/tag-before.png'], after: ['https://example.com/tag-after.png'] }, source: 'figma', requestedBy: 'dana' });
    return { number: 489, title: r.title, body: r.body, html_url: 'https://github.com/acme/ds/issues/489', state: 'closed', state_reason: 'not_planned', labels: r.labels, user: { login: 'dana' }, assignees: [], created_at: at, closed_at: at };
  };
  const withTag = (closedDaysAgo: number, fixes: unknown[] = []) => {
    const { issues, pulls } = sampleBuildData(NOW);
    const all = [...issues, declinedTag(closedDaysAgo)];
    const nameOf = (l: string) => SAMPLE_BUILDERS[l] ?? l;
    return { views: assembleBuildRequests({ issues: all.map(toBuildIssue), pulls: pulls.map(toBuildPull), now: NOW, nameOf }), bodies: new Map(all.map((i) => [i.number, i.body ?? ''])), sample: false, stale: false, nameOf, jiraBase: null, fixes };
  };

  it('keeps a request closed as not planned for a week, with its own pictures and component, then leaves it out', async () => {
    data = withTag(6);
    const { container, unmount } = render(createElement(BeingBuilt));
    const title = await screen.findByText('Tag: test: rounder tag corners');
    const row = title.closest('li')!;
    expect(row.textContent).toContain('Developers closed it without building it');
    expect(row.textContent).toContain('Not planned');
    const thumb = row.querySelector('.bt')!;
    expect(thumb.getAttribute('data-label')).toBe('Tag');
    expect([...thumb.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://example.com/tag-before.png', 'https://example.com/tag-after.png']);
    expect(row.querySelector('a')!.getAttribute('title')).toBe('Tag: test: rounder tag corners');
    expect(screen.getByRole('tab', { name: /All/ }).textContent).toContain('7');
    unmount();
    data = withTag(8);
    const again = render(createElement(BeingBuilt));
    await screen.findByText('Tabs: put a count after the label');
    expect(screen.queryByText('Tag: test: rounder tag corners')).toBeNull();
    expect(again.container.querySelectorAll('.sh-row-item')).toHaveLength(6);
    expect(screen.getByRole('tab', { name: /All/ }).textContent).toContain('6');
    expect(container.textContent).not.toContain('Tag: test');
  });

  it('shows the empty state once every listed request has left, never an empty list under a sentence', async () => {
    const nameOf = (l: string) => l;
    data = { views: assembleBuildRequests({ issues: [toBuildIssue(declinedTag(9))], pulls: [], now: NOW, nameOf }), bodies: new Map(), sample: false, stale: false, nameOf, jiraBase: null };
    render(createElement(BeingBuilt));
    expect(await screen.findByText('Nothing is being built yet.')).toBeTruthy();
  });

  it("labels each of Claude's fixes with its own component, one row per session", async () => {
    const at = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
    const stopped = (d: number) => parseSession({ component: 'Button', state: 'stopped', startedAt: at(d), updatedAt: at(d), elapsed: 60, steps: [{ kind: 'step', text: 'Claude stopped', at: at(d), by: 'peterbono' }] })!;
    const fixes = fixRows([stopped(1), stopped(2)], [], NOW);
    expect(new Set(fixes.map((f) => f.id)).size).toBe(2);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    data = withTag(1, fixes);
    const { container } = render(createElement(BeingBuilt));
    await screen.findByText('Tag: test: rounder tag corners');
    expect(error.mock.calls.flat().join(' ')).not.toContain('same key');
    error.mockRestore();
    const rows = [...container.querySelectorAll('.sh-row-item')];
    const fixRowsShown = rows.filter((li) => li.textContent?.includes("Claude's fix from Figma"));
    expect(fixRowsShown).toHaveLength(2);
    for (const li of fixRowsShown) {
      expect(li.querySelector('.bt')!.getAttribute('data-label')).toBe('Button');
      expect(li.querySelector('a')!.getAttribute('title')).toBe("Button: Claude's fix from Figma");
    }
    const tagRow = rows.find((li) => li.textContent?.includes('Tag: test'))!;
    expect(tagRow.querySelector('.bt')!.getAttribute('data-label')).toBe('Tag');
  });

  it('lists explorations handed to developers in the same list, tagged, counted by the filters, opening the exploration', async () => {
    const at = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
    const explored = (n: number, name: string, x: Partial<RestPull>): RestPull => ({
      number: n,
      title: `Exploration: ${name}`,
      html_url: `https://github.com/acme/ds/pull/${n}`,
      state: 'open',
      draft: true,
      created_at: at(5),
      updated_at: at(1),
      labels: ['ready-for-devs', 'product: admin'],
      user: { login: 'peterbono' },
      head: { ref: `explore/${n}`, sha: 'h1' },
      body: `<!-- bridge-exploration ${JSON.stringify({ name, purpose: '', doneAt: at(1), doneSha: 'h1', doneBy: 'peterbono' })} -->`,
      ...x,
    });
    const nameOf = (l: string) => (l === 'peterbono' ? 'Florian' : (SAMPLE_BUILDERS[l] ?? l));
    const explorations = explorationBuildRows(
      [
        explored(611, 'explore new design pr being built', { labels: ['exploration', 'product: admin'] }),
        explored(612, 'Billing screen', { draft: false }),
        explored(613, 'Wishlist', { state: 'closed', merged_at: at(2) }),
        explored(614, 'Still running', { labels: ['exploration'], body: '' }),
      ],
      { products: DEFAULT_PRODUCTS, now: NOW, nameOf },
    );
    data = { ...sample(), sample: false, nameOf, explorations };
    const { container } = render(createElement(BeingBuilt));
    const title = await screen.findByText('Explore new design pr being built');
    expect(container.querySelectorAll('.sh-row-item')).toHaveLength(9);
    expect(screen.queryByText('Still running')).toBeNull();
    const row = title.closest('li')!;
    // No kind tag: every change starts as an exploration.
    expect([...row.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent === 'Exploration')).toBe(false);
    expect(row.textContent).toContain('Waiting for code');
    expect(row.textContent).toContain('Admin demo · Done exploring by Florian on');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/studio/changes/?exploration=611');
    expect(container.textContent).toContain('Explorations handed to developers and changes from Figma or Components that need code.');
    expect(container.textContent).not.toMatch(/—/);
    expect(screen.getByRole('tab', { name: /Waiting to be picked up/ }).textContent).toContain('3');
    expect(screen.getByRole('tab', { name: /In progress/ }).textContent).toContain('4');
    expect(screen.getByRole('tab', { name: /Shipped this week/ }).textContent).toContain('2');
    await userEvent.click(screen.getByRole('tab', { name: /Waiting to be picked up/ }));
    expect(screen.getByText('Explore new design pr being built')).toBeTruthy();
    expect(screen.queryByText('Billing screen')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /In progress/ }));
    expect(screen.getByText('Billing screen')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: /Shipped this week/ }));
    expect(screen.getByText('Wishlist')).toBeTruthy();
    expect(container.querySelectorAll('.sh-row-item button')).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it('keeps "Every build request has been picked up." only while no exploration waits either', async () => {
    const at = new Date(NOW - 86_400_000).toISOString();
    const nameOf = (l: string) => l;
    const ready: RestPull = { number: 611, title: 'Exploration: x', html_url: 'https://github.com/acme/ds/pull/611', state: 'open', draft: true, created_at: at, updated_at: at, labels: ['ready-for-devs'], head: { ref: 'explore/x', sha: 'h1' }, body: `<!-- bridge-exploration ${JSON.stringify({ name: 'Admin filters', purpose: '', doneAt: at, doneSha: 'h1' })} -->` };
    data = { views: [], bodies: new Map(), sample: false, stale: false, nameOf, jiraBase: null, explorations: explorationBuildRows([ready], { products: DEFAULT_PRODUCTS, now: NOW, nameOf }) };
    render(createElement(BeingBuilt));
    await screen.findByText('Admin filters');
    await userEvent.click(screen.getByRole('tab', { name: /Waiting to be picked up/ }));
    expect(screen.getByText('Admin filters')).toBeTruthy();
    expect(screen.queryByText('Every build request has been picked up.')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /In progress/ }));
    expect(screen.getByText('Nothing is in progress right now.')).toBeTruthy();
  });
});
