import { describe, expect, it } from 'vitest';
import { demoLogins, isBotPull, leadQueue, teamExplorations, type DemoPull } from './demo-home';
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

  it('leaves out a branch the visitor approved during the visit', () => {
    const approved = new Set([4]);
    expect(leadQueue([pull(1), pull(4)], [], now, { approved }).map((r) => r.key)).toEqual(['change-1']);
  });

  it('shows who asked, as Bridge recorded it, before the account that opened it', () => {
    const rows = leadQueue(
      [
        pull(1, { labels: [{ name: 'source: mcp' }], body: 'Why.\n\nRequested by Ann Leroy.\n' }),
        pull(2, { body: 'Requested by Leo Martin (@leom).' }),
      ],
      [{ number: 30, title: 'Tokens: raise contrast', user: { login: 'bot' }, created_at: at(3), body: 'Requested by Sofia Reyes.' }],
      now,
    );
    expect(rows.map((r) => [r.person?.name, r.line])).toEqual([
      ['Ann', 'Ann asks for your review'],
      ['Leo', 'Leo asks for your review'],
      ['Sofia', 'Sofia suggests a change'],
    ]);
    expect(rows[0]!.person).toMatchObject({ login: '~ann-leroy', avatar: null });
    expect(rows[1]!.person?.login).toBe('leom');
    expect(rows.every((r) => r.sample)).toBe(true);
  });

  it('leaves explorations and developer work out, by the same rule as every waiting on me list', () => {
    const rows = leadQueue([pull(1), pull(2, { labels: [{ name: 'exploration' }] }), pull(3, { head: { ref: 'explore/checkout' } }), pull(4, { labels: [{ name: 'dependencies' }] })], [], now);
    expect(rows.map((r) => r.key)).toEqual(['change-1']);
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

  it("shows the team's explorations only, each with its explored screen: library changes stay in the queue", () => {
    const cards = teamExplorations(
      [
        pull(36, {
          draft: true,
          title: 'Exploration: profile page',
          labels: [{ name: 'product: account' }, { name: 'exploration' }],
          head: { ref: 'explore/profile-page' },
          body: 'Requested by Ann Leroy (@ann-leroy).',
        }),
        pull(45, { title: 'Billing: invoice status as badges', labels: [{ name: 'tier: 1' }, { name: 'product: account' }], head: { ref: 'agent/billing-invoice-status' } }),
        pull(20, { title: 'New ProfileHeader component', requested_reviewers: [{ login: 'dana' }] }),
        pull(15, { draft: true }),
        pull(9, { user: { login: 'release[bot]', type: 'Bot' }, labels: [{ name: 'product: account' }] }),
      ],
      { sample: true },
    );
    expect(cards.map((c) => [c.number, c.title, c.product, c.state, c.author.login])).toEqual([
      [36, 'Profile page', 'Account', 'Exploring', 'ann-leroy'],
      [45, 'Billing: invoice status as badges', 'Account', 'In review', 'ann'],
    ]);
    // The sample team's explored screens ship with the site: never a generic icon on its cards.
    expect(cards.map((c) => c.preview)).toMatchObject([
      { kind: 'screen', src: '/sample/explorations/profile-page.png' },
      { kind: 'screen', src: '/sample/explorations/billing-invoice-status.png' },
    ]);
    // No "Sample" chip on the cards: the demo banner already says it is sample data.
    expect(cards.every((c) => !('sample' in c))).toBe(true);
  });

  it("shows every state of the sample team's explorations, each with its shipped screen", () => {
    const pieces = (n: number) => `<!-- bridge-pieces ${JSON.stringify({ checkedAt: 'x', headSha: 'y', pieces: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'token', title: `P${i}`, values: [] })), fixes: 0, links: [] })} -->`;
    const account = [{ name: 'product: account' }];
    const cards = teamExplorations(
      [
        pull(46, { draft: true, labels: [...account, { name: 'exploration' }], head: { ref: 'explore/team-seats-and-roles' }, title: 'Exploration: team seats and roles', body: pieces(3) }),
        pull(47, { labels: [...account, { name: 'tier: 2' }], head: { ref: 'explore/notification-channels' }, title: 'Exploration: notification channels' }),
        pull(48, { state: 'closed', merged_at: at(0), labels: [...account, { name: 'tier: 2' }], head: { ref: 'explore/plan-comparison' }, title: 'Exploration: plan comparison' }),
      ],
      { sample: true },
    );
    expect(cards.map((c) => [c.title, c.state])).toEqual([
      ['Team seats and roles', '3 new pieces found'],
      ['Notification channels', 'In review'],
      ['Plan comparison', 'Kept in the library'],
    ]);
    expect(cards.map((c) => c.preview)).toMatchObject(
      ['team-seats-and-roles', 'notification-channels', 'plan-comparison'].map((f) => ({ kind: 'screen', src: `/sample/explorations/${f}.png` })),
    );
  });

  it('reads the explored screen of another demo when the visual impact run has one, a plate until then', () => {
    const explore = pull(7, { labels: [{ name: 'exploration' }], head: { ref: 'explore/pill-buttons' } });
    const plate = { kind: 'screen', src: null, product: 'Library', screen: null };
    expect(teamExplorations([explore])[0]!.preview).toEqual({ ...plate, seed: '7' });
    const previews = new Map([[7, { kind: 'screen', src: 'https://raw.githubusercontent.com/o/r/bridge-visual/pr-7/sha/after.png' } as const]]);
    expect(teamExplorations([explore], { previews })[0]!.preview).toMatchObject(previews.get(7)!);
    // Off the sample team, the seeded captures are not used.
    expect(teamExplorations([pull(8, { head: { ref: 'explore/profile-page' } })])[0]!.preview).toEqual({ ...plate, seed: '8' });
  });
});

describe('teamExplorations: the state of a running exploration, signed out', () => {
  const running = { number: 611, title: 'Exploration: pill buttons', user: { login: 'peterbono' }, draft: true, created_at: '2026-10-30T08:00:00Z', updated_at: '2026-10-30T08:00:00Z', labels: [{ name: 'exploration' }], head: { ref: 'explore/pill-buttons', sha: 'abc' }, body: null };

  it('says "Not started" while only the Bridge note changed, "Exploring" once more did', () => {
    expect(teamExplorations([running], { files: () => ['.bridge/explorations/pill-buttons.md'] })[0]!.state).toBe('Not started');
    expect(teamExplorations([running], { files: () => ['.bridge/explorations/pill-buttons.md', 'apps/admin/src/App.tsx'] })[0]!.state).toBe('Exploring');
    expect(teamExplorations([running], { files: () => undefined })[0]!.state).toBe('');
  });
});
