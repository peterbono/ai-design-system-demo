import { describe, expect, it } from 'vitest';
import { demoLogins, isBotPull, leadQueue, teamBranches, type DemoPull } from './demo-home';
import { person, sortNeeds } from './home-model';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-10-22T12:00:00Z');
const at = (days: number) => new Date(now - days * DAY).toISOString();
const pull = (n: number, extra: Partial<DemoPull> = {}): DemoPull => ({
  number: n,
  title: `feat(tokens): change ${n}`,
  user: { login: 'ann', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  created_at: at(n),
  updated_at: at(0),
  head: { ref: `agent/change-${n}` },
  ...extra,
});

describe("the DS lead's queue on the demo", () => {
  it('lists every branch ready for review and every suggestion, as waiting on the lead', () => {
    const rows = sortNeeds(
      leadQueue(
        [pull(1), pull(4), pull(2, { draft: true }), pull(9, { user: { login: 'github-actions[bot]', type: 'Bot' } }), pull(5, { head: { ref: 'docs/tabs-20261021-x' }, title: 'Tabs: when tabs are the wrong choice' })],
        [{ number: 30, title: 'Tokens: raise contrast', user: { login: 'dana' }, created_at: at(3) }, { number: 31, title: 'A pull request', user: { login: 'x' }, created_at: at(1), pull_request: {} }],
        now,
        { people: new Map([['ann', person('ann', 'Ann Lee', null)]]) },
      ),
    );
    expect(rows.map((r) => r.key)).toEqual(['change-5', 'change-4', 'suggestion-30', 'change-1']);
    expect(rows.every((r) => r.waitsOnYou)).toBe(true);
    expect(rows[0]).toMatchObject({ title: 'Tabs: when tabs are the wrong choice', line: 'Ann asks you to check the usage guidance' });
    expect(rows[1]).toMatchObject({ title: 'Change 4', line: 'Ann asks for your review', pill: { label: 'Waiting 4 days', tone: 'warning' }, href: '/studio/changes/?pr=4' });
    expect(rows[2]).toMatchObject({ title: 'Raise contrast', line: 'dana suggests a change' });
  });

  it('names Claude AI on agent work', () => {
    const [row] = leadQueue([pull(1, { labels: [{ name: 'source: mcp' }] })], [], now);
    expect(row!.person?.agent).toBe(true);
  });

  it('reads each person once, reviewers too', () => {
    expect(demoLogins([pull(1), pull(2, { user: { login: 'Ann' }, requested_reviewers: [{ login: 'Dana' }] }), pull(3, { draft: true, user: { login: 'zed' } })], [{ number: 4, title: 't', user: { login: 'dana' }, created_at: at(1) }])).toEqual(['ann', 'dana', 'zed']);
  });

  it('leaves automation out', () => {
    expect(isBotPull({ user: { login: 'app/github-actions' } })).toBe(true);
    expect(isBotPull({ user: { login: 'dependabot[bot]' } })).toBe(true);
    expect(isBotPull({ user: { login: 'ann' } })).toBe(false);
  });

  it("shows the team's explorations and branches as the board words them", () => {
    const cards = teamBranches([
      pull(36, { draft: true, title: 'Exploration: profile page', labels: [{ name: 'product: account' }, { name: 'exploration' }], head: { ref: 'explore/profile-page' } }),
      pull(20, { title: 'New ProfileHeader component', requested_reviewers: [{ login: 'dana' }] }),
      pull(15, { draft: true }),
      pull(9, { user: { login: 'release[bot]', type: 'Bot' } }),
    ]);
    expect(cards.map((c) => [c.number, c.stage, c.statusLine])).toEqual([
      [36, 'draft', { stage: 'Exploration in Account', detail: 'ann' }],
      [20, 'ready', { stage: 'Library branch', detail: 'in review' }],
      [15, 'draft', { stage: 'Library branch', detail: 'draft' }],
    ]);
    expect(cards[1]!.reviewer?.login).toBe('dana');
  });
});
