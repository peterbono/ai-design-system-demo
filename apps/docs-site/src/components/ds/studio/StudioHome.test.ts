// @vitest-environment jsdom
// Studio Home for someone without a review right: only what waits on them, never the review queue, and the
// contributor tour (their branches, then how to start) instead of the lead's.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { EXPLORE_LINE, StudioHome, type StudioHomeProps } from './StudioHome';
import { changeNeed, joinNeed, person, SEP, type BranchCard } from '../../../lib/home-model';
import type { ExplorationCard } from '../../../lib/home-explorations';
import { NARROW_TOUR, tourPlacement } from './HomeTour';

const NOW = Date.parse('2026-10-22T10:00:00Z');
const dana = person('dana', 'Dana Kim', null);
const leo = person('leo@acme.design', 'Leo', null);

const sentBack = changeNeed({ number: 42, title: 'Spacing scale for dense tables', author: leo, asker: leo, since: null, task: 'own-changes', changesBy: [dana], thumb: { kind: 'icon', icon: 'branch' } }, NOW);
const branch: BranchCard = { number: 42, title: 'Spacing scale for dense tables', href: '/studio/changes/?pr=42', stage: 'ready', updated: '2026-10-21T10:00:00Z', reviewer: dana, thumb: { kind: 'icon', icon: 'branch' } };
const exploration = (n: number, over: Partial<ExplorationCard> = {}): ExplorationCard => ({
  number: n,
  title: `Profile page ${n}`,
  href: `/studio/changes/?exploration=${n}`,
  product: 'Account',
  author: leo,
  stage: 'exploring',
  state: 'Exploring',
  updated: '2026-10-21T10:00:00Z',
  preview: { kind: 'screen', src: `/sample/explorations/${n}.png` },
  ...over,
});

const props = (over: Partial<StudioHomeProps> = {}): StudioHomeProps => ({
  state: 'busy',
  greeting: 'Good morning, Leo.',
  needs: [],
  branches: [branch],
  explorations: [exploration(36)],
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
    expect(await screen.findByText(/until a reviewer approves it/)).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('lists a branch sent back with changes, with Update and its one status', async () => {
    localStorage.setItem('bridge.home.contributor-tour', 'done');
    const { container } = render(createElement(StudioHome, props({ needs: [sentBack] })));
    expect(screen.getByText('Your changes need you.')).toBeTruthy();
    expect(container.textContent).toContain('Dana asked for changes');
    expect(screen.getAllByText('Changes requested').length).toBeGreaterThan(0);
    expect(screen.getByText('Update')).toBeTruthy();
    expect(screen.queryByText('Review')).toBeNull();
    expect(screen.queryByText(/until a reviewer approves it/)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('moves to the second step, then remembers the tour is done', async () => {
    const user = userEvent.setup();
    render(createElement(StudioHome, props()));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    // The tour step and the card it points at now share the words "Start an exploration".
    expect((await screen.findAllByText('Start an exploration')).length).toBeGreaterThan(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(localStorage.getItem('bridge.home.contributor-tour')).toBe('done');
  });

  it('shows no tour to a reviewer', () => {
    render(createElement(StudioHome, props({ contributor: false })));
    expect(screen.queryByText(/until a reviewer approves it/)).toBeNull();
  });
});

describe('StudioHome, contributor with nothing yet', () => {
  it('tours only where to start: there are no explorations to point at', async () => {
    const { container } = render(createElement(StudioHome, props({ state: 'empty', branches: [], explorations: [] })));
    expect((await screen.findAllByText('Start a change')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/of 1$/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    // Under the ways to start a change, the explorations say how to start one: one sentence, one button.
    expect(screen.getByRole('heading', { level: 2, name: 'Your explorations' })).toBeTruthy();
    expect(screen.getByText(EXPLORE_LINE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start an exploration' })).toBeTruthy();
    expect(container.querySelector('.sh-cards')).toBeNull();
    expect(screen.queryByText(/library change/)).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('StudioHome, explorations only', () => {
  beforeEach(() => localStorage.setItem('bridge.home.contributor-tour', 'done'));

  it('shows each exploration as its explored screen, title, product, who and where it stands, opening its page', async () => {
    const found = exploration(37, { title: 'Billing screen', state: '2 new pieces found', stage: 'found', author: dana });
    const { container } = render(createElement(StudioHome, props({ explorations: [exploration(36), found] })));
    expect(screen.getByRole('heading', { level: 2, name: 'Your explorations' })).toBeTruthy();
    const items = [...container.querySelectorAll('.sh-cards > li')];
    // "Start an exploration" first, then the cards.
    expect(items[0]!.classList.contains('sh-create')).toBe(true);
    expect(items[0]!.textContent).toBe('Start an exploration');
    expect(items[1]!.querySelector('img.bt-screen')?.getAttribute('src')).toBe('/sample/explorations/36.png');
    expect(items[1]!.querySelector('.bt--icon')).toBeNull();
    expect(screen.getByRole('link', { name: 'Billing screen' }).getAttribute('href')).toBe('/studio/changes/?exploration=37');
    const parts = [...items[2]!.querySelector('.sh-card-status')!.children].map((c) => c.textContent?.trim());
    expect(parts.slice(0, 2)).toEqual([`2 new pieces found${SEP.trimEnd()}`, `in Account${SEP.trimEnd()}`]);
    expect(parts[2]).toMatch(/Dana$/);
    await expectNoAxeViolations(container);
  });

  it('starts an exploration on its product step: no question about the library first', async () => {
    const user = userEvent.setup();
    render(createElement(StudioHome, props()));
    await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('What do you want to explore?');
    expect(dialog.textContent).toContain('In which product');
    expect(dialog.textContent).not.toContain('What are you working on?');
    expect(screen.getByRole('button', { name: 'Start with Claude AI' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('draws a screen sketch while an exploration has no capture: never a generic icon', () => {
    const { container } = render(createElement(StudioHome, props({ explorations: [exploration(36, { preview: { kind: 'screen', src: null } })] })));
    expect(container.querySelector('.sh-cards .bt-sketch')).toBeTruthy();
    expect(container.querySelector('.sh-cards .bt--icon')).toBeNull();
  });

  it('leaves library changes out of the section and counts them in one line, with the way to Changes', () => {
    const { container } = render(createElement(StudioHome, props({ branches: [branch, { ...branch, number: 43 }] })));
    expect(screen.queryByText('Spacing scale for dense tables')).toBeNull();
    expect(container.querySelectorAll('.sh-cards > li').length).toBe(2);
    expect(screen.getByText('You have 2 library changes in progress.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your changes' }).getAttribute('href')).toBe('/studio/changes/?who=mine');
  });

  it('shows three cards, and "See all N" counts explorations only', () => {
    const many = [36, 37, 38, 39, 40].map((n) => exploration(n));
    const { container } = render(createElement(StudioHome, props({ explorations: many, branches: [branch, branch, branch] })));
    expect(container.querySelectorAll('.sh-cards > li:not(.sh-create)').length).toBe(3);
    expect(screen.getByRole('link', { name: 'See all 5' })).toBeTruthy();
  });

  it('says how to start when there is none yet: one sentence, the drawing, one button', async () => {
    const { container } = render(createElement(StudioHome, props({ explorations: [] })));
    expect(screen.getByText(EXPLORE_LINE)).toBeTruthy();
    expect(container.querySelector('.sh-explore-empty .ill')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start an exploration' })).toBeTruthy();
    expect(screen.queryByText(/See all/)).toBeNull();
    await expectNoAxeViolations(container);
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
  it("shows the team's explorations, Start an exploration first and gated by the demo, no Sample chip, no library line", () => {
    const demo = { lead: dana, explorationsTitle: 'Explorations' };
    const many = [36, 37, 38, 39].map((n) => exploration(n));
    const { container } = render(createElement(StudioHome, props({ contributor: false, demo, tour: () => null, explorations: many, branches: [] })));
    expect(screen.getByRole('heading', { level: 2, name: 'Explorations' })).toBeTruthy();
    const items = container.querySelectorAll('.sh-cards > li');
    expect(items[0]!.classList.contains('sh-create')).toBe(true);
    expect(items[0]!.querySelector('[data-demo-write="start explorations"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all 4' }).getAttribute('href')).toBe('/studio/changes/');
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText(/library change/)).toBeNull();
  });
});

describe('StudioHome, lead (a reviewer, or an admin, an email admin included)', () => {
  it('tours the lead, never the contributor', async () => {
    render(createElement(StudioHome, props({ contributor: false, lead: true })));
    expect(await screen.findByText('Explore with Claude AI')).toBeTruthy();
    expect(screen.queryByText(/until a reviewer approves it/)).toBeNull();
  });
});

describe('StudioHome, the tour on a phone', () => {
  const phone = (matches: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: matches && q === NARROW_TOUR, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('places a step in the page flow on a narrow screen, a popover otherwise', () => {
    expect(tourPlacement(true)).toBe('inline');
    expect(tourPlacement(false)).toBe('popover');
  });

  it('shows the step as a card between the heading and the cards: it covers no card', async () => {
    phone(true);
    const { container } = render(createElement(StudioHome, props()));
    const step = await screen.findByRole('group', { name: 'Your explorations' });
    expect(step.hasAttribute('data-tour-inline')).toBe(true);
    // In the section, right before the cards, never floating over them.
    expect(step.nextElementSibling?.classList.contains('sh-cards')).toBe(true);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('puts the lead tour first step above the rows, in view where the page opens', async () => {
    phone(true);
    const review = changeNeed({ number: 7, title: 'Deeper primary blue', author: leo, asker: leo, since: null, task: 'design', thumb: { kind: 'icon', icon: 'branch' } }, NOW);
    render(createElement(StudioHome, props({ contributor: false, lead: true, needs: [review] })));
    const step = await screen.findByRole('group', { name: /Changes wait for the lead/ });
    expect(screen.getByText('1 of 2')).toBeTruthy();
    // Before the rows, right under the heading: never below a long list on a phone.
    expect(step.compareDocumentPosition(screen.getByText('Deeper primary blue')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('anchors the wide popover under the cards, never over the first one ("Start an exploration")', async () => {
    phone(false);
    const { container } = render(createElement(StudioHome, props()));
    expect(await screen.findByText(/until a reviewer approves it/)).toBeTruthy();
    const anchor = container.querySelector('.dh-tour-anchor')!;
    expect(container.querySelector('.sh-cards')!.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the popover on a wide screen', async () => {
    phone(false);
    render(createElement(StudioHome, props()));
    expect(await screen.findByText(/until a reviewer approves it/)).toBeTruthy();
    expect(document.querySelector('[data-tour-inline]')).toBeNull();
  });
});

describe('StudioHome, status lines', () => {
  it('never starts a wrapped line with the separator: the dot is glued to what comes before it', () => {
    localStorage.setItem('bridge.home.contributor-tour', 'done');
    const { container } = render(createElement(StudioHome, props({ explorations: [exploration(36, { state: '2 new pieces found' })] })));
    const status = container.querySelector('.sh-card-status')!;
    // Each part wraps on its own; the first part ends with " ·", no part starts with the dot.
    const parts = [...status.children].map((c) => c.textContent ?? '');
    expect(parts[0]).toMatch(/ ·$/);
    for (const p of parts) expect(p.trimStart().startsWith('·')).toBe(false);
    expect(SEP).toBe(' · ');
    // No breakable space before a dot anywhere on the home.
    expect(container.textContent).not.toMatch(/ ·/);
  });
});
