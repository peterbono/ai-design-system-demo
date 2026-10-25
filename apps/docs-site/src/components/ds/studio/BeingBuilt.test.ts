// @vitest-environment jsdom
// Being built: the list with one tag per row and no row buttons, the detail in place, the empty state that teaches.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { assembleBuildRequests } from '@bridge-ds/core';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { sampleBuildData, SAMPLE_BUILDERS } from '../../../lib/building-sample';
import { toBuildIssue, toBuildPull } from '../../../lib/building-view';

const NOW = Date.now();
let data: unknown = null;
vi.mock('../../../scripts/building-data', () => ({ loadBuildData: () => Promise.resolve(data) }));
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
    await userEvent.click(screen.getByRole('radio', { name: /In progress/ }));
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
});
