// @vitest-environment jsdom
// Studio Home for someone without a review right: only what waits on them, never the review queue, and the
// contributor tour (their branches, then how to start) instead of the lead's.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { StudioHome, type StudioHomeProps } from './StudioHome';
import { changeNeed, joinNeed, person, type BranchCard } from '../../../lib/home-model';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const dana = person('dana', 'Dana Kim', null);
const leo = person('leo@acme.design', 'Leo', null);

const sentBack = changeNeed({ number: 42, title: 'Spacing scale for dense tables', author: leo, asker: leo, since: null, task: 'own-changes', changesBy: [dana], thumb: { kind: 'icon', icon: 'branch' } }, NOW);
const branch: BranchCard = { number: 42, title: 'Spacing scale for dense tables', href: '/studio/changes/?pr=42', stage: 'ready', updated: '2026-10-21T10:00:00Z', reviewer: dana, thumb: { kind: 'icon', icon: 'branch' } };

const props = (over: Partial<StudioHomeProps> = {}): StudioHomeProps => ({
  state: 'busy',
  greeting: 'Good morning, Leo.',
  needs: [],
  branches: [branch],
  health: null,
  now: NOW,
  components: [],
  signedOut: { line: '', button: '', signIn: true },
  failed: null,
  startHrefs: { tokens: '#t', component: '#c', guidance: '#g' },
  contributor: true,
  ...over,
});

beforeEach(() => localStorage.clear());

describe('StudioHome, contributor', () => {
  it('says nothing waits when no reviewer sent anything back, and tours their branches, not the lead queue', async () => {
    const { container } = render(createElement(StudioHome, props()));
    expect(screen.getByText('Nothing needs you.')).toBeTruthy();
    expect(screen.queryByText(/need your review/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Review all' })).toBeNull();
    expect(screen.queryByText(/Changes wait for the lead/)).toBeNull();
    expect(await screen.findByText(/until a reviewer approves them/)).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('lists a branch sent back with changes, with Update and its one status', async () => {
    localStorage.setItem('bridge.home.contributor-tour', 'done');
    const { container } = render(createElement(StudioHome, props({ needs: [sentBack] })));
    expect(screen.getByText('Your branches need you.')).toBeTruthy();
    expect(container.textContent).toContain('Dana asked for changes');
    expect(screen.getAllByText('Changes requested').length).toBeGreaterThan(0);
    expect(screen.getByText('Update')).toBeTruthy();
    expect(screen.queryByText('Review')).toBeNull();
    expect(screen.queryByText(/until a reviewer approves them/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('moves to the second step, then remembers the tour is done', async () => {
    const user = userEvent.setup();
    render(createElement(StudioHome, props()));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Start a change')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(localStorage.getItem('bridge.home.contributor-tour')).toBe('done');
  });

  it('shows no tour to a reviewer', () => {
    render(createElement(StudioHome, props({ contributor: false })));
    expect(screen.queryByText(/until a reviewer approves them/)).toBeNull();
  });
});

describe('StudioHome, contributor with nothing yet', () => {
  it('tours only where to start: there are no branches to point at', async () => {
    render(createElement(StudioHome, props({ state: 'empty' })));
    expect(await screen.findByText('Start a change')).toBeTruthy();
    expect(screen.queryByText('Your branches')).toBeNull();
    expect(screen.queryByText(/of 1$/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});

describe('StudioHome, lead', () => {
  const jamie = joinNeed({ id: 'a1b2c3d4e5f60718', name: 'Jamie Lee', email: 'jamie@acme.com', createdAt: '2026-10-22T08:00:00Z' }, 'Acme Product', NOW);
  const review = changeNeed({ number: 7, title: 'Deeper primary blue', author: leo, asker: leo, since: null, task: 'design', thumb: { kind: 'icon', icon: 'branch' } }, NOW);

  it('tours the queue only when it holds changes, never join requests alone', () => {
    const { unmount } = render(createElement(StudioHome, props({ contributor: false, lead: true, needs: [jamie] })));
    expect(screen.getByText('asks to join Acme Product', { exact: false })).toBeTruthy();
    expect(screen.queryByText(/Changes wait for the lead/)).toBeNull();
    unmount();
    render(createElement(StudioHome, props({ contributor: false, lead: true, needs: [review] })));
    expect(screen.getByText(/Changes wait for the lead/)).toBeTruthy();
  });

  it('skips the rows step when the rows on screen are join requests and the changes are folded under N more', () => {
    const joins = ['a', 'b', 'c'].map((x, i) => joinNeed({ id: `${x}1b2c3d4e5f6071${i}`, name: `Person ${x}`, email: `${x}@acme.com`, createdAt: '2026-10-22T08:00:00Z' }, 'Acme Product', NOW));
    render(createElement(StudioHome, props({ contributor: false, lead: true, needs: [...joins, review] })));
    expect(screen.queryByText(/Changes wait for the lead/)).toBeNull();
    expect(screen.getByText(/The whole queue, one by one/)).toBeTruthy();
  });
});

describe('StudioHome, demo', () => {
  it('starts the branch cards with Create branch, gated by the demo, and shows no Sample chip', () => {
    const demo = { lead: dana, branchesTitle: 'Explorations and branches', branchesMax: 3 };
    const { container } = render(createElement(StudioHome, props({ contributor: false, demo, tour: () => null })));
    const items = container.querySelectorAll('.sh-cards > li');
    expect(items[0]!.classList.contains('sh-create')).toBe(true);
    expect(items[0]!.querySelector('[data-demo-write="create branches"]')).toBeTruthy();
    expect(screen.queryByText('Sample')).toBeNull();
  });
});

describe('StudioHome, lead (a reviewer, or an admin, an email admin included)', () => {
  it('tours the lead, never the contributor', async () => {
    render(createElement(StudioHome, props({ contributor: false, lead: true })));
    expect(await screen.findByText('Work in progress stays apart')).toBeTruthy();
    expect(screen.queryByText(/until a reviewer approves them/)).toBeNull();
  });
});
