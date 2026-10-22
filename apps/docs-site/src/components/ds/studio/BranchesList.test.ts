// @vitest-environment jsdom
// Branches: one filter bar on every tab. "All kinds" on every tab, "Everyone" on Waiting on me and All (not on Mine),
// the picks kept across tabs.
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
  lifecycle: 'review' as ListRow['lifecycle'],
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

describe('BranchesList filters', () => {
  it('shows the kind and designer filters on All', async () => {
    const { container } = render(createElement(BranchesList, props()));
    expect(triggers().some((t) => t.includes('All kinds'))).toBe(true);
    expect(triggers().some((t) => t.includes('Everyone'))).toBe(true);
    await expectNoAxeViolations(container);
  });

  it('keeps the kind filter in place on Mine, without the designer one', async () => {
    const user = userEvent.setup();
    render(createElement(BranchesList, props()));
    await user.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(triggers()).toHaveLength(1);
    expect(triggers()[0]).toContain('All kinds');
    expect(screen.getByText('Change 3')).toBeTruthy();
    expect(screen.queryByText('Change 1')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Waiting on me' }));
    expect(triggers()).toHaveLength(2);
  });

  it('keeps a kind picked in the address when the tab changes', async () => {
    history.replaceState(null, '', '/studio/changes/?kind=docs');
    const user = userEvent.setup();
    render(createElement(BranchesList, props()));
    expect(screen.getByText(/No branch of this kind/)).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(new URLSearchParams(location.search).get('kind')).toBe('docs');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Change 3')).toBeTruthy();
  });
});
