// @vitest-environment jsdom
// The demo, the visitor in the DS lead's seat ("Dana", sample team Acme Design): one rule, one queue. The home line,
// Changes > Waiting on me and the Changes badge in the side nav all count the same things (lib/demo-home
// leadWaitingCount): the branches in review (a promoted exploration included), the open suggestions and the usage
// guidance drafts; never a running exploration nor a branch being built.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BranchesList, type BranchesListProps, type ListRow } from './BranchesList';
import { isExploration, leadQueue, leadSuggestions, leadWaitingCount, waitsOnLead, type DemoPull, type DemoSuggestion } from '../../../lib/demo-home';
import { demoWaiting } from '../../../lib/demo';
import { guidanceNeed, sortNeeds } from '../../../lib/home-model';
import { guidanceExtra, suggestionExtra } from '../../../lib/review-categories';
import { suggestionNeed } from '../../../lib/suggestions-view';
import { reviewBadgeLabel } from '../../../lib/waiting-on';

const now = Date.parse('2026-11-02T08:00:00Z');
const promoted = '**Promoted from an exploration on 2026-10-25.** Review it like any change.';
const pull = (number: number, ref: string, labels: string[], extra: Partial<DemoPull> = {}): DemoPull => ({
  number,
  title: `Change ${number}`,
  user: { login: 'peterbono' },
  draft: false,
  created_at: '2026-10-25T21:30:00Z',
  updated_at: '2026-10-25T21:30:00Z',
  labels: labels.map((name) => ({ name })),
  head: { ref, sha: `s${number}` },
  body: null,
  ...extra,
});

// The sample team's open branches as its activity snapshot records them (2026-11-02): 2 running explorations, 2 drafts
// (being built), 13 in review, one of them an exploration promoted to review.
const PULLS: DemoPull[] = [
  pull(47, 'explore/notification-channels', ['product: account', 'tier: 2'], { body: promoted }),
  pull(46, 'explore/team-seats-and-roles', ['product: account', 'exploration'], { draft: true }),
  pull(45, 'agent/billing-invoice-status', ['tier: 1', 'product: account']),
  pull(36, 'explore/profile-page', ['product: account', 'exploration'], { draft: true }),
  pull(29, 'bridge/brand-forest', ['source: mcp', 'tier: 3', 'tokens']),
  pull(28, 'docs/slider-20261021-fu6k', ['source: mcp', 'docs', 'tier-1']),
  pull(27, 'docs/tabs-20261021-fphc', ['source: mcp', 'docs', 'tier-1']),
  pull(26, 'agent/request-avatar-xl', ['tier: 2']),
  pull(24, 'agent/request-card-subtle', ['tier: 2'], { draft: true }),
  pull(22, 'agent/request-button-loading-label', ['tier: 2']),
  pull(20, 'agent/request-profile-header', ['tier: 2']),
  pull(18, 'bridge/deprecate-color-bg-zone', ['tier: 3', 'tokens']),
  pull(17, 'bridge/add-a-highlight-surface-for-new-items', ['source: mcp', 'tier: 3', 'tokens']),
  pull(16, 'bridge/fix-muted-text-contrast-on-dark-raised-surfaces', ['source: mcp', 'tier: 3', 'tokens']),
  pull(15, 'bridge/tighter-card-and-panel-corners', ['source: mcp', 'tier: 3', 'tokens'], { draft: true }),
  pull(14, 'bridge/add-a-56px-spacing-step-for-page-sections', ['source: mcp', 'tier: 3', 'tokens']),
  pull(13, 'bridge/deepen-the-primary-blue-for-stronger-buttons', ['source: mcp', 'tier: 3', 'tokens']),
];
const SUGGESTIONS: DemoSuggestion[] = [
  { number: 43, title: 'EmptyState: always offer the next step', user: { login: 'peterbono' }, created_at: '2026-10-28T10:00:00Z' },
  { number: 31, title: 'Tokens: clearer emphasis borders in dark theme', user: { login: 'peterbono' }, created_at: '2026-10-21T10:00:00Z' },
  { number: 30, title: 'Tokens: snappier dialogs and accordions', user: { login: 'peterbono' }, created_at: '2026-10-21T10:00:00Z' },
  { number: 12, title: 'A pull request, not a suggestion', user: { login: 'peterbono' }, created_at: '2026-10-21T10:00:00Z', pull_request: {} },
];
const GUIDANCE = [{ name: 'Slider', href: '/library/components/slider/?edit=1', since: null }];

/** The home line, as StudioHome words it from the demo home's rows (scripts/demo-home.ts loadDemoHome). */
function homeCount(approved?: ReadonlySet<number>): { line: string; n: number } {
  const needs = sortNeeds([...GUIDANCE.map((g) => guidanceNeed(g, now)), ...leadQueue(PULLS, SUGGESTIONS, now, approved ? { approved } : {})]);
  const line = demoWaiting(needs.filter((r) => r.kind === 'review').length, null, 'Dana', needs.filter((r) => r.kind === 'guidance').length).count;
  return { line, n: [...line.matchAll(/(\d+) (?:change|documentation)/g)].reduce((sum, m) => sum + Number(m[1]), 0) };
}

/** A branch as Changes lists it in the lead's seat (scripts/reviews.ts listRow). */
const listRow = (p: DemoPull, approved?: ReadonlySet<number>): ListRow => ({
  number: p.number,
  title: p.title,
  jira: null,
  author: p.user!.login,
  agent: false,
  opens: isExploration(p) ? 'exploration' : 'pr',
  pill: null,
  lifecycle: isExploration(p) ? 'exploration' : p.draft ? 'draft' : 'ready',
  yourTurn: !approved?.has(p.number) && waitsOnLead(p),
  behindBy: null,
  signals: null,
  guidance: p.head!.ref.startsWith('docs/'),
  head: { ref: p.head!.ref, sha: p.head!.sha! },
  base: null,
  labels: p.labels ?? null,
  neededBy: null,
  requester: null,
});

/** Changes > Waiting on me's count, with what waits besides branches (scripts/waiting-extras.ts, in the seat). */
function waitingTab(approved?: ReadonlySet<number>): number {
  const waiting = [
    ...leadSuggestions(SUGGESTIONS).map((s) => suggestionExtra({ ...suggestionNeed({ number: s.number, title: s.title, createdAt: s.created_at }, { login: 'peterbono', name: 'Florian', avatar: null }, now), number: s.number }, s.number, [], [])),
    ...GUIDANCE.map((g) => guidanceExtra(guidanceNeed(g, now))),
  ];
  const props: BranchesListProps = {
    rows: PULLS.map((p) => listRow(p, approved)),
    closed: null,
    closedLimit: 20,
    loading: false,
    viewer: 'Dana',
    connected: false,
    admin: null,
    tokensRoot: 'packages/tokens/src',
    tierLabel: null,
    failure: () => 'failed',
    readClosed: () => undefined,
    waiting,
  };
  const { unmount } = render(createElement(BranchesList, props));
  const tab = screen.getByRole('tab', { name: /^Waiting on me/ }).textContent ?? '';
  unmount();
  return Number(tab.replace('Waiting on me', ''));
}

beforeEach(() => history.replaceState(null, '', '/studio/peterbono/bridge-demo-ds/changes/'));

describe("the demo lead's one count", () => {
  it('is the same on the home line, in Changes > Waiting on me and on the Changes badge', () => {
    const badge = leadWaitingCount(PULLS, SUGGESTIONS, GUIDANCE.length);
    const home = homeCount();
    // 13 branches in review (the promoted exploration included), 3 suggestions, 1 usage guidance draft.
    expect(home.line).toBe('16 changes and 1 documentation draft need your review.');
    expect(home.n).toBe(17);
    expect(waitingTab()).toBe(home.n);
    expect(badge).toBe(home.n);
    expect(reviewBadgeLabel(badge)).toBe(', 17 waiting for a review');
  });

  it('leaves running explorations and branches being built out, and counts a promoted exploration as in review', () => {
    const waits = PULLS.filter(waitsOnLead).map((p) => p.number);
    expect(waits).toContain(47);
    for (const n of [46, 36, 24, 15]) expect(waits).not.toContain(n);
    expect(waits).toHaveLength(13);
  });

  it('stays the same everywhere once the visitor approves a change', () => {
    const approved = new Set([45, 22]);
    const n = homeCount(approved).n;
    expect(n).toBe(15);
    expect(waitingTab(approved)).toBe(n);
    expect(leadWaitingCount(PULLS, SUGGESTIONS, GUIDANCE.length, approved)).toBe(n);
  });

  it('says nothing about reviews when there is no count to show', () => {
    expect(reviewBadgeLabel(0)).toBe('');
    expect(reviewBadgeLabel(null)).toBe('');
  });
});
