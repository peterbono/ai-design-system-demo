import { describe, expect, it } from 'vitest';
import { needFromStatus, whoActs } from './changes';
import { boardColumns, columnHeading, combinedAdoption, healthFigures, inFlightLine, releaseTitle, startChangeHref, type BoardChange } from './overview-board';

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
    expect(review[0]).toMatchObject({ title: 'Change 3', who: 'peterbono', note: 'Blocked: a test fails. A developer is on it.', tone: 'blocked', badge: null, href: '/studio/changes/?pr=3' });
    expect(review[1]!.note).toBe('Blocked: it clashes with the latest library. @ana is on it.');
    expect(review[2]).toMatchObject({ tone: 'yours', badge: 'Your turn', note: 'Your design review is next.' });
    expect(cols[2]!.cards[0]).toMatchObject({ tone: 'yours', note: 'Approved and tested. Ship it to put it in the next release.' });
    expect(cols[0]!.cards[0]).toMatchObject({ note: 'You are trying it. Send it for review once it holds up.', href: '/studio/changes/?exploration=98' });
    expect(cols[3]!.cards[0]).toMatchObject({ title: 'Textarea gets a new appearance option for editing existing text in place', note: 'Shipped. A new option, nothing breaks.' });
  });

  it('keeps Bridge app updates out of the next release column and says who acts for others', () => {
    const cols = boardColumns({ explorations: [], changes: [change(5, 'ready', 'ana', 'lea'), change(6, 'needs-design', 'ana', null)], release: [studio], viewer: null });
    expect(cols[3]!.cards).toEqual([]);
    expect(cols[3]!.empty).toBe('Nothing shipped since the last release.');
    expect(cols[2]!.cards[0]!.note).toBe('Approved and tested. @peterbono can ship it.');
    expect(cols[1]!.cards[0]).toMatchObject({ tone: null, note: 'Waiting for the design owner (@peterbono) to approve.' });
  });

  it('says a change is being checked while its status loads', () => {
    const cols = boardColumns({ explorations: [], changes: [{ number: 9, title: 'Nine', author: 'ana', who: null }], release: [], viewer: 'me', loading: true });
    expect(cols[1]!.cards[0]!.note).toBe('Checking what it needs.');
  });

  it('labels columns and the summary line', () => {
    const cols = boardColumns({ explorations: [{ number: 1, name: 'A', author: 'x' }], changes: [change(2, 'ci-failing', 'x', null)], release: [textarea], viewer: null });
    expect(columnHeading(cols[1]!)).toBe('In review, 1');
    expect(inFlightLine(cols)).toBe('2 changes in flight, 1 shipped for the next release.');
    expect(inFlightLine(boardColumns({ explorations: [], changes: [], release: [], viewer: null }))).toBe('Nothing in flight.');
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
      adoption: [{ now: m(239, 265), before: m(0, 526) }, { now: m(210, 210), before: m(47, 89) }],
      guidance: { total: 48, reviewed: 46, drafted: 2, missing: 0 },
    });
    expect(f.map((x) => [x.value, x.label, x.detail, x.href])).toEqual([
      ['296', 'contrast checks pass', 'Every pair, in 2 brands, light and dark.', '/studio/quality/'],
      ['94.5%', 'of components come from Bridge', 'Up from 7.6% before Bridge, across 2 products.', '/studio/quality/#ql-adoption'],
      ['46 of 48', 'components have reviewed guidance', '2 drafted by Claude to review.', '/studio/quality/#ql-findings'],
    ]);
  });

  it('leads with the failures when contrast fails, and leaves adoption out without reports', () => {
    const f = healthFigures({ contrast: { total: 296, fail: 3, brands: 2 }, adoption: [], guidance: { total: 2, reviewed: 2, drafted: 0, missing: 0 } });
    expect(f.map((x) => x.id)).toEqual(['contrast', 'guidance']);
    expect(f[0]).toMatchObject({ value: '3', label: 'of 296 contrast checks fail', tone: 'fail' });
    expect(f[1]!.detail).toBe('Every component is documented.');
  });
});
