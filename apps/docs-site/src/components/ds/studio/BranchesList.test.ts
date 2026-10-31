// @vitest-environment jsdom
// Changes: the designer's state tabs (All, Waiting on me, Exploring, Shipped; the developers' states only from an old
// ?state= link; Archived when something is), alone on their row, and one quieter filter row under them on every tab,
// the product and the people (Everyone, You, then each designer), the picks kept across tabs.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import { BranchesList, type BranchesListProps, type ListRow } from './BranchesList';

const row = (n: number, author: string, over: Partial<ListRow> = {}): ListRow => ({
  number: n,
  title: `Change ${n}`,
  jira: null,
  author,
  agent: false,
  opens: 'pr',
  pill: null,
  lifecycle: 'ready',
  yourTurn: false,
  behindBy: null,
  signals: null,
  guidance: false,
  head: { ref: `bridge/${author}-${n}`, sha: `s${n}` },
  base: null,
  labels: null,
  neededBy: null,
  requester: null,
  ...over,
});

const props = (over: Partial<BranchesListProps> = {}): BranchesListProps => ({
  rows: [row(1, 'ann'), row(2, 'dana', { yourTurn: true }), row(3, 'leo@acme.design', { mine: true })],
  closed: null,
  closedLimit: 20,
  loading: false,
  viewer: 'leo@acme.design',
  connected: false,
  admin: null,
  tokensRoot: 'packages/tokens/src',
  tierLabel: null,
  failure: () => 'failed',
  readClosed: () => undefined,
  ...over,
});

beforeEach(() => history.replaceState(null, '', '/studio/changes/'));

const triggers = () => screen.getAllByRole('combobox').map((c) => c.textContent ?? '');

describe('BranchesList tabs and filters', () => {
  it('shows the designer tabs with their counts alone on their row, and the product and people filters under them', async () => {
    const { container } = render(createElement(BranchesList, props()));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All3', 'Waiting on me1', 'Exploring0', 'Shipped0']);
    expect(screen.queryByRole('tab', { name: /Mine/ })).toBeNull();
    // The developers' states belong to the Being built page: not tabs here, even with something in them.
    expect(screen.queryByRole('tab', { name: /^In review/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^Being built/ })).toBeNull();
    expect(triggers().some((t) => t.includes('All products'))).toBe(true);
    expect(triggers().some((t) => t.includes('Everyone'))).toBe(true);
    // The tabs own their row; the filters and the count sit on the row under it.
    expect(container.querySelector('.bl-filters [role="combobox"]')).toBeNull();
    expect(container.querySelectorAll('.bl-bar [role="combobox"]').length).toBe(2);
    expect(container.querySelector('.bl-bar')!.textContent).toContain('3 changes.');
    await expectNoAxeViolations(container);
  });

  it("opens a developers' state tab from an old ?state= link", () => {
    history.replaceState(null, '', '/studio/changes/?state=review');
    render(createElement(BranchesList, props()));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All3', 'Waiting on me1', 'Exploring0', 'In review3', 'Shipped0']);
    expect(screen.getByRole('tab', { name: /^In review/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Change 1')).toBeTruthy();
  });

  it('lists each state under its tab, Archived last, without the old archived line', async () => {
    const user = userEvent.setup();
    const ex = (n: number, label: string) => row(n, 'ann', { opens: 'exploration', lifecycle: 'exploration', pill: { label, tone: 'neutral' } });
    render(createElement(BranchesList, props({ rows: [ex(1, 'Not started'), ex(2, 'Exploring'), ex(3, 'Exploring')], archived: [ex(4, 'Archived')] })));
    const names = screen.getAllByRole('tab').map((r) => r.textContent);
    expect(names).toEqual(['All3', 'Waiting on me0', 'Exploring3', 'Shipped0', 'Archived1']);
    expect(screen.queryByText(/archived exploration\./)).toBeNull();
    await user.click(screen.getByRole('tab', { name: /^Exploring/ }));
    // Not started is a running exploration too: under Exploring.
    expect(screen.getByText('Change 1')).toBeTruthy();
    expect(screen.getByText('Change 2')).toBeTruthy();
    expect(new URLSearchParams(location.search).get('state')).toBe('exploring');
    await user.click(screen.getByRole('tab', { name: /^Archived/ }));
    expect(screen.getByText('Change 4')).toBeTruthy();
    expect(screen.queryByText('Change 2')).toBeNull();
  });

  it('tags an archived exploration "Archived" on its tab, never "Exploring"', async () => {
    const user = userEvent.setup();
    const ex = (n: number, label: string) => row(n, 'ann', { opens: 'exploration', lifecycle: 'exploration', pill: { label, tone: 'neutral' } });
    const { container } = render(createElement(BranchesList, props({ rows: [ex(1, 'Exploring')], archived: [ex(4, 'Exploring')] })));
    await user.click(screen.getByRole('tab', { name: /^Archived/ }));
    const list = container.querySelector('.sh-rows')!;
    expect(list.textContent).toContain('Archived');
    expect(list.textContent).not.toContain('Exploring');
  });

  it('lists an exploration in review under In review with who must review, and in Waiting on me when the review is asked of the viewer', async () => {
    const user = userEvent.setup();
    const xp = (n: number, over: Partial<ListRow>) => row(n, 'ann', { opens: 'exploration', lifecycle: 'exploration', ...over });
    // In review is the developers' side: an old ?state= link opens it.
    history.replaceState(null, '', '/studio/changes/?state=review');
    render(
      createElement(
        BranchesList,
        props({
          viewer: 'florian',
          rows: [
            xp(5, { stage: 'in-review', pill: { label: 'In review', tone: 'warning' }, reviewLine: 'Waiting for your review', yourTurn: true }),
            xp(6, { stage: 'in-review', pill: { label: 'In review', tone: 'warning' }, reviewLine: 'Changes requested by Lee' }),
            xp(7, { stage: 'being-built', pill: { label: 'Being built', tone: 'info' } }),
            xp(8, { stage: 'waiting-for-code', pill: { label: 'Waiting for code', tone: 'warning' } }),
          ],
        }),
      ),
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All4', 'Waiting on me1', 'Exploring0', 'In review2', 'Shipped0']);
    expect(screen.getByText('Change 6').closest('li')!.textContent).toContain('Changes requested by Lee');
    expect(screen.queryByText('Change 7')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /^Waiting on me/ }));
    expect(screen.getByText('Change 5')).toBeTruthy();
    expect(screen.queryByText('Change 6')).toBeNull();
  });

  it('opens old ?who=mine links on You, first in the people filter', () => {
    history.replaceState(null, '', '/studio/changes/?who=mine');
    render(createElement(BranchesList, props()));
    expect(triggers().some((t) => t.includes('You'))).toBe(true);
    expect(screen.getByText('Change 3')).toBeTruthy();
    expect(screen.queryByText('Change 1')).toBeNull();
  });

  const products = [
    { key: 'admin-app', name: 'Art print shop' },
    { key: 'account', name: 'Account app' },
    { key: 'library', name: 'Library', default: true },
  ];

  it('filters by product: all products, then each product with something listed, by name', async () => {
    const user = userEvent.setup();
    const shop = { labels: [{ name: 'product: admin-app' }] };
    const { container } = render(createElement(BranchesList, props({ products, rows: [row(1, 'ann', shop), row(2, 'dana', { yourTurn: true }), row(3, 'leo@acme.design', { mine: true })] })));
    await user.click(screen.getAllByRole('combobox')[0]!);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    // Account app has nothing listed: left out.
    expect(options).toEqual(['All products3', 'Art print shop1', 'Library2']);
    await user.click(screen.getByRole('option', { name: /Art print shop/ }));
    expect(new URLSearchParams(location.search).get('product')).toBe('admin-app');
    expect(screen.getByText('Change 1')).toBeTruthy();
    expect(screen.queryByText('Change 2')).toBeNull();
    expect(container.querySelector('.bl-bar')!.textContent).toContain('1 of 3 changes.');
  });

  it('keeps a product picked in the address when the tab changes', async () => {
    history.replaceState(null, '', '/studio/changes/?product=admin-app');
    const user = userEvent.setup();
    render(createElement(BranchesList, props({ products })));
    expect(screen.getByText(/Nothing here matches these filters/)).toBeTruthy();
    expect(triggers().some((t) => t.includes('Art print shop'))).toBe(true);
    await user.click(screen.getByRole('tab', { name: /^Waiting on me/ }));
    expect(new URLSearchParams(location.search).get('product')).toBe('admin-app');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Change 2')).toBeTruthy();
    expect(new URLSearchParams(location.search).get('product')).toBeNull();
  });

  it('opens old ?kind= links on the library product, its usage guidance included', async () => {
    history.replaceState(null, '', '/studio/changes/?kind=docs');
    const user = userEvent.setup();
    render(createElement(BranchesList, props({ products })));
    expect(triggers().some((t) => t.includes('Library'))).toBe(true);
    expect(screen.getByText('Change 1')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /^Exploring/ }));
    expect(new URLSearchParams(location.search).get('kind')).toBeNull();
    expect(new URLSearchParams(location.search).get('product')).toBe('library');
  });

  it('shows one display name for one person, even where only the login is recorded', () => {
    render(
      createElement(
        BranchesList,
        props({
          viewer: 'peterbono',
          rows: [
            row(1, 'bridge-app[bot]', { requester: { name: 'Florian Gouloubi', login: 'peterbono' }, ago: '16 h ago' }),
            row(2, 'peterbono', { requester: { name: null, login: 'peterbono' }, ago: '29 min ago' }),
          ],
        }),
      ),
    );
    expect(screen.queryByText(/peterbono/)).toBeNull();
    expect(screen.getAllByText(/^Florian/).length).toBeGreaterThanOrEqual(2);
  });

  it("leaves Bridge's own pull requests out of every tab and count (bridge.config.json tooling)", async () => {
    const user = userEvent.setup();
    const tooling = { paths: ['apps/docs-site/'], scopes: ['studio'] };
    const merged = (n: number, rawTitle: string, title: string) => row(n, 'ann', { rawTitle, title, lifecycle: 'shipped', merged_at: '2026-10-30T10:00:00Z', head: { ref: `feat/${n}`, sha: `s${n}` } });
    render(
      createElement(
        BranchesList,
        props({
          rows: [row(1, 'ann', { rawTitle: 'fix(studio): Being built filters as underline Tabs', title: 'Being built filters as underline Tabs', head: { ref: 'fix/tabs', sha: 's1' } }), row(2, 'dana', { title: 'New ocean brand' })],
          closed: [merged(10, 'feat(studio): Start an exploration replaces Start a change', 'Start an exploration replaces Start a change'), merged(11, 'feat(button): A new size', 'A new size')],
          tooling,
        }),
      ),
    );
    expect(screen.getByRole('tab', { name: /^All\s*1$/ })).toBeTruthy();
    expect(screen.queryByText('Being built filters as underline Tabs')).toBeNull();
    expect(screen.getByText('New ocean brand')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: /^Shipped\s*1$/ }));
    expect(screen.getByText('A new size')).toBeTruthy();
    expect(screen.queryByText('Start an exploration replaces Start a change')).toBeNull();
  });
});
