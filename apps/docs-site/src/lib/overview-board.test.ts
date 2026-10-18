import { describe, expect, it } from 'vitest';
import { needFromStatus, whoActs } from './changes';
import { boardColumns, developerWork, columnHeading, columnMeta, combinedAdoption, splitTokens, visibleCards, healthFigures, inFlightLine, releaseTitle, startChangeHref, type BoardChange } from './overview-board';

const owners = { design: ['peterbono'], tech: ['peterbono'] };
type Kind = Parameters<typeof needFromStatus>[0];
const change = (n: number, kind: Kind, author: string, viewer: string | null, extra: Partial<BoardChange> = {}): BoardChange => ({
  number: n,
  title: `Change ${n}`,
  author,
  who: whoActs(needFromStatus(kind, { failing: extra.failing }), { owners, author, viewer, overrideBy: ['peterbono'] }),
  ...extra,
});
const textarea = { ref: '.changeset/textarea-inline.md', title: 'Textarea gets `appearance="inline"` for editing existing text in place: no border, no resize handle.', packages: ['@bridge-ds/react', '@bridge-ds/docs-site'], bump: 'minor' as const, author: 'peterbono' };
const studio = { ref: '.changeset/overview.md', title: 'Studio Overview sorts the to-do list.', packages: ['@bridge-ds/docs-site'], bump: 'patch' as const, author: 'peterbono' };

describe('overview board', () => {
  it('puts each thing in the column of where it stands, blockers written on the card', () => {
    const cols = boardColumns({
      explorations: [{ number: 98, name: 'Add a native Select for pages without React', author: 'peterbono' }],
      changes: [change(3, 'ci-failing', 'peterbono', 'peterbono', { failing: 1 }), change(2, 'conflict', 'ana', 'peterbono'), change(5, 'ready', 'ana', 'peterbono'), change(6, 'needs-design', 'ana', 'peterbono')],
      release: [textarea, studio],
      viewer: 'peterbono',
    });
    expect(cols.map((c) => [c.label, c.cards.length])).toEqual([
      ['Exploring', 1],
      ['In review', 3],
      ['Ready to ship', 1],
      ['Next release', 1],
    ]);
    const review = cols[1]!.cards;
    // The viewer's own change: no avatar of the viewer, and nobody is said to be on it.
    expect(review[0]).toMatchObject({ title: 'Change 3', who: null, note: 'A test fails. No developer yet.', status: { tone: 'blocked', label: 'Blocked' }, href: '/studio/changes/?pr=3' });
    expect(review[1]).toMatchObject({ who: null, note: 'It clashes with the latest library. @ana is on it.' });
    expect(review[2]).toMatchObject({ status: { tone: 'you', label: 'You' }, note: 'Your design review is next.' });
    expect(cols[1]!.blocked).toBe(2);
    expect(columnMeta(cols[1]!)).toBe('3, 2 blocked');
    expect(columnMeta({ cards: [1, 2] as never, blocked: 2 })).toBe('2, all blocked');
    expect(cols[2]!.empty).toBe('Nothing approved yet.');
    expect(columnMeta(cols[0]!)).toBe('1');
    expect(cols[2]!.cards[0]).toMatchObject({ status: { tone: 'you' }, note: 'Approved and tested. Ship it to put it in the next release.' });
    // The viewer's account, no Studio marker: never "You are trying it" from the login alone.
    expect(cols[0]!.cards[0]).toMatchObject({ who: null, note: 'Started with your GitHub account. Send it for review once it holds up.', href: '/studio/changes/?exploration=98' });
    expect(cols[3]!.cards[0]).toMatchObject({ title: 'Textarea gets a new appearance option for editing existing text in place', note: 'Approved, goes out in the next release.', who: null });
    expect(cols.map((c) => c.href)).toEqual(['/studio/changes/?view=explorations', '/studio/changes/', '/studio/changes/', '/studio/changes/?view=history']);
  });

  it('keeps Bridge app updates out of the next release column and says who acts for others', () => {
    const cols = boardColumns({ explorations: [], changes: [change(5, 'ready', 'ana', 'lea'), change(6, 'needs-design', 'ana', null)], release: [studio], viewer: null });
    expect(cols[3]!.cards).toEqual([]);
    expect(cols[2]!.cards[0]!.note).toBe('Approved and tested. @peterbono can ship it.');
    expect(cols[1]!.cards[0]).toMatchObject({ status: null, who: null, note: 'Waiting for the design owner (@peterbono) to approve.' });
    // Signed out, the author is named in the third person; one author on the whole board: no avatar.
    const out = boardColumns({ explorations: [{ number: 9, name: 'Pill buttons', author: 'peterbono' }], changes: [change(3, 'ci-failing', 'peterbono', null, { failing: 2 })], release: [], viewer: null });
    expect(out[1]!.cards[0]).toMatchObject({ who: null, note: '2 tests fail. @peterbono is on it.' });
    expect(out[0]!.cards[0]!.note).toBe('@peterbono is trying it. Sent for review once it holds up.');
    // Two authors on the board: each card shows its author.
    const two = boardColumns({ explorations: [{ number: 9, name: 'Pill buttons', author: 'lea' }], changes: [change(3, 'ci-failing', 'ana', null, { failing: 2 })], release: [], viewer: null });
    expect([two[0]!.cards[0]!.who, two[1]!.cards[0]!.who]).toEqual(['lea', 'ana']);
    // The viewer's own blocked change waits for its assignee.
    const mine = boardColumns({ explorations: [], changes: [change(3, 'ci-failing', 'me', 'me', { failing: 1, assignees: ['me', 'dev'] })], release: [], viewer: 'me' });
    expect(mine[1]!.cards[0]!.note).toBe('A test fails. Waiting for @dev.');
  });

  it('says who from real markers: Claude, or You only when started from Studio', () => {
    const ex = (maker: Parameters<typeof boardColumns>[0]['explorations'][number]['maker']) =>
      boardColumns({ explorations: [{ number: 1, name: 'Pill buttons', author: 'me', maker }], changes: [], release: [], viewer: 'me' })[0]!.cards[0]!.note;
    expect(ex({ kind: 'claude' })).toBe('Claude is building it. Send it for review once it holds up.');
    expect(ex({ kind: 'you' })).toBe('You are trying it. Send it for review once it holds up.');
    expect(ex({ kind: 'account', where: 'cli' })).toBe('Started from the command line with your GitHub account. Send it for review once it holds up.');
    // A blocked change Claude drafted with the viewer's account.
    const mine = boardColumns({ explorations: [], changes: [change(3, 'ci-failing', 'me', 'me', { failing: 1, agent: true })], release: [], viewer: 'me' });
    expect(mine[1]!.cards[0]!.note).toBe('A test fails. Claude drafted it, no developer is on it yet.');
  });

  it('moves developer work off the columns into one list under the board', () => {
    const input = {
      explorations: [
        { number: 98, name: 'Add a native Select for pages without React', author: 'peterbono', nature: 'developer' as const, maker: { kind: 'account' as const, where: 'cli' as const } },
        { number: 64, name: 'Button normal again', author: 'peterbono' },
      ],
      changes: [change(2, 'needs-design', 'ana', 'peterbono'), change(7, 'ready', 'ana', 'peterbono', { nature: 'developer' })],
      release: [],
      viewer: 'peterbono',
    };
    const cols = boardColumns(input);
    expect(cols.map((c) => c.cards.map((x) => x.key))).toEqual([['exploration-64'], ['change-2'], [], []]);
    expect(inFlightLine(cols)).toBe('2 changes in flight.');
    expect(developerWork(input).map((d) => [d.key, d.stage, d.who])).toEqual([
      ['exploration-98', 'Exploring', null],
      ['change-7', 'Ready to ship', null],
    ]);
    expect(developerWork(input)[0]!.note).toBe('Started from the command line with your GitHub account.');
  });

  it('caps each column and sets token names apart', () => {
    expect(visibleCards([1, 2])).toEqual({ shown: [1, 2], more: '' });
    expect(visibleCards([1, 2, 3, 4])).toEqual({ shown: [1, 2], more: 'Show all 4' });
    expect(splitTokens('Add focus.ring.offset semantic token')).toEqual([
      { text: 'Add ', token: false },
      { text: 'focus.ring.offset', token: true },
      { text: ' semantic token', token: false },
    ]);
    expect(splitTokens('Lift cards. On hover')).toEqual([{ text: 'Lift cards. On hover', token: false }]);
  });

  it('says a change is being checked while its status loads', () => {
    const cols = boardColumns({ explorations: [], changes: [{ number: 9, title: 'Nine', author: 'ana', who: null }], release: [], viewer: 'me', loading: true });
    expect(cols[1]!.cards[0]!.note).toBe('Checking what it needs.');
  });

  it('labels columns and the summary line', () => {
    const cols = boardColumns({ explorations: [{ number: 1, name: 'A', author: 'x' }], changes: [change(2, 'ci-failing', 'x', null)], release: [textarea], viewer: null });
    expect(columnHeading(cols[1]!)).toBe('In review, 1');
    expect(inFlightLine(cols)).toBe('2 changes in flight, 1 approved for the next release.');
    expect(inFlightLine(boardColumns({ explorations: [], changes: [], release: [], viewer: null }))).toBe('Nothing in flight.');
  });

  it('says a change that waits for code is approved, never blocked (lib/change-status)', () => {
    const cols = boardColumns({ explorations: [], changes: [change(7, 'ci-failing', 'ana', 'peterbono', { failing: 1, lifecycle: 'waiting' })], release: [], viewer: 'peterbono' });
    expect(cols[1]!.cards[0]).toMatchObject({ note: 'Approved, waiting for code.', status: null });
    expect(cols[1]!.blocked).toBe(0);
    const draft = boardColumns({ explorations: [], changes: [change(8, 'draft', 'ana', 'peterbono', { lifecycle: 'draft' })], release: [], viewer: 'peterbono' });
    expect(draft[1]!.cards[0]).toMatchObject({ note: 'Draft. Nobody is asked to review it yet.', status: null });
    expect(draft[1]!.blocked).toBe(0);
  });
});

describe('release titles in designer words', () => {
  it('reads code as words and keeps the first clause', () => {
    expect(releaseTitle(textarea.title)).toBe('Textarea gets a new appearance option for editing existing text in place');
    expect(releaseTitle('Badge: add `subtle` appearance. More text.')).toBe('Badge');
    expect(releaseTitle('fix the **focus** ring on [Link](x) (#12)')).toBe('Fix the focus ring on Link');
    expect(releaseTitle('a '.repeat(60)).endsWith('...')).toBe(true);
  });
});

describe('start a change', () => {
  it('leads each choice to the flow that does it', () => {
    expect(startChangeHref('look')).toBe('/studio/tokens/');
    expect(startChangeHref('variant', 'button')).toBe('/studio/components/?c=button&intent=variant');
    expect(startChangeHref('wrong', 'select')).toBe('/studio/components/?c=select&intent=wrong');
    expect(startChangeHref('new')).toBe('/studio/changes/?view=explorations&start=new');
  });
});

describe('library health', () => {
  const m = (ds: number, ui: number) => ({ dsComponentInstances: ds, uiComponentInstances: ui });

  it('sums component adoption over products, with the before value only when every product has one', () => {
    const a = combinedAdoption([
      { now: m(239, 265), before: m(0, 526) },
      { now: m(210, 210), before: m(47, 89) },
    ])!;
    expect(a.products).toBe(2);
    expect(Math.round(a.now * 10) / 10).toBe(94.5);
    expect(Math.round(a.before! * 10) / 10).toBe(7.6);
    expect(combinedAdoption([{ now: m(1, 2) }, { now: m(1, 1), before: m(0, 1) }])!.before).toBeNull();
    expect(combinedAdoption([])).toBeNull();
  });

  it('gives three figures, each a door to Quality', () => {
    const f = healthFigures({
      contrast: { total: 296, fail: 0, brands: 2 },
      adoption: [
        { now: m(239, 265), before: m(0, 526), label: 'Admin demo' },
        { now: m(210, 210), before: m(47, 89), label: 'Bridge itself' },
      ],
      guidance: { total: 48, reviewed: 46, drafted: 2, missing: 0 },
    });
    expect(f.map((x) => [x.value, x.label, x.detail, x.split, x.href])).toEqual([
      ['0 failing', 'contrast checks', '296 checked in 2 brands, light and dark.', null, '/studio/quality/'],
      ['94.5%', 'of components come from Bridge', 'Up from 7.6% before Bridge, across 2 products.', 'Admin demo 90.2%, Bridge itself 100%.', '/studio/quality/#ql-adoption'],
      ['46 of 48', 'components have reviewed guidance', '2 drafted by Claude to review.', null, '/studio/quality/#ql-findings'],
    ]);
  });

  it('leads with the failures when contrast fails, and leaves adoption out without reports', () => {
    const f = healthFigures({ contrast: { total: 296, fail: 3, brands: 2 }, adoption: [], guidance: { total: 2, reviewed: 2, drafted: 0, missing: 0 } });
    expect(f.map((x) => x.id)).toEqual(['contrast', 'guidance']);
    expect(f[0]).toMatchObject({ value: '3 failing', label: 'contrast checks', detail: '293 of 296 pass. The token build waits until every pair passes.', tone: 'fail' });
    expect(f[1]!.detail).toBe('Every component is documented.');
  });
});
