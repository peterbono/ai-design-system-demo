import { describe, expect, it } from 'vitest';
import {
  joinNeed,
  rowAction,
  holdsReviewRight,
  moreNeedsAction,
  waitsOnContributor,
  CONTRIBUTOR_TOUR_STEPS,
  contributorTourSteps,
  contributorTour,
  CLAUDE,
  adoptionDrop,
  ago,
  branchStatus,
  changeNeed,
  contrastNeed,
  daysSince,
  displayName,
  greeting,
  guidanceNeed,
  hintSnoozed,
  homeState,
  isOnlyReviewer,
  oldestLabel,
  onlyReviewerLine,
  partOfDay,
  person,
  showsBranch,
  sortBranches,
  sortNeeds,
  splitNeeds,
  uniquePeople,
  waitingLabel,
  waitingSentence,
  waitingSince,
  HINT_SNOOZE_MS,
  type ChangeFacts,
  type NeedRow,
} from './home-model';

const NOW = new Date('2026-10-19T09:30:00Z').getTime();
const daysAgo = (d: number, h = 0) => new Date(NOW - d * 86400000 - h * 3600000).toISOString();
const ann = person('ann-lee', 'Ann Lee');
const dana = person('dana-k', 'Dana Kim');
const icon = { kind: 'icon', icon: 'branch' } as const;

describe('greeting', () => {
  it('follows the local hour', () => {
    expect(partOfDay(5)).toBe('morning');
    expect(partOfDay(11)).toBe('morning');
    expect(partOfDay(12)).toBe('afternoon');
    expect(partOfDay(17)).toBe('afternoon');
    expect(partOfDay(18)).toBe('evening');
    expect(partOfDay(2)).toBe('evening');
  });
  it('uses the first word of the profile name, else none', () => {
    expect(greeting(9, 'Florian Gouloubi')).toBe('Good morning, Florian.');
    expect(greeting(14, null)).toBe('Good afternoon.');
    expect(greeting(20, '  ')).toBe('Good evening.');
  });
});

describe('people', () => {
  it('shows display names, never @handles', () => {
    expect(displayName('ann-lee', 'Ann Lee')).toBe('Ann');
    expect(displayName('@dana-k', null)).toBe('dana-k');
    // An article or a one-letter first word is not a first name: the whole name reads better.
    expect(displayName('octocat', 'The Octocat')).toBe('The Octocat');
    expect(displayName('laposte', '  La   Poste ')).toBe('La Poste');
    expect(displayName('an-team', 'An Team')).toBe('An Team');
    expect(displayName('jdoe', 'J. Doe')).toBe('J. Doe');
    expect(displayName('lea', 'Léa Martin')).toBe('Léa');
    expect(greeting(9, 'The Octocat')).toBe('Good morning, The Octocat.');
    expect(CLAUDE.name).toBe('Claude AI');
  });
  it('names the Bridge agent account Claude AI, with its own face', () => {
    expect(person('bridge-agent', 'bridge-agent')).toMatchObject({ name: 'Claude AI', agent: true, avatar: null });
    expect(person('bridge-agent[bot]').name).toBe('Claude AI');
    expect(person('claude').agent).toBe(true);
  });
  it('keeps each person once, Claude once', () => {
    expect(uniquePeople([ann, null, person('ANN-LEE', 'Ann'), CLAUDE, { ...CLAUDE }, dana]).map((p) => p.name)).toEqual(['Ann', 'Claude AI', 'Dana']);
  });
  it('says who waits in one sentence', () => {
    expect(waitingSentence([])).toBeNull();
    expect(waitingSentence([ann])).toEqual({ names: 'Ann', rest: ' is waiting on you.' });
    expect(waitingSentence([ann, dana])).toEqual({ names: 'Ann and Dana', rest: ' are waiting on you.' });
    expect(waitingSentence([ann, dana, CLAUDE])?.names).toBe('Ann, Dana and Claude AI');
    expect(waitingSentence([ann, dana, CLAUDE, person('x', 'Xi')])?.names).toBe('Ann, Dana, Claude AI and 1 other');
    expect(waitingSentence([ann, dana, CLAUDE, ...['a', 'b', 'c', 'd', 'e', 'f'].map((l) => person(l))])?.names).toBe('Ann, Dana, Claude AI and 6 others');
  });
});

describe('waiting time', () => {
  const pull = { created_at: daysAgo(9), user: { login: 'ann-lee' } };
  it('reads the latest review request for the viewer first', () => {
    const events = [
      { event: 'review_requested', created_at: daysAgo(6), review_requester: { login: 'ann-lee' }, requested_reviewer: { login: 'dana-k' } },
      { event: 'review_requested', created_at: daysAgo(4), review_requester: { login: 'marco' }, requested_reviewer: { login: 'peterbono' } },
      { event: 'review_requested', created_at: daysAgo(2), review_requester: { login: 'ann-lee' }, requested_reviewer: { login: 'li' } },
    ];
    expect(waitingSince(events, pull, 'PeterBono')).toEqual({ since: daysAgo(4), asker: 'marco' });
    expect(waitingSince(events, pull, 'nobody')).toEqual({ since: daysAgo(2), asker: 'ann-lee' });
  });
  it('falls back to ready for review, then creation', () => {
    expect(waitingSince([{ event: 'ready_for_review', created_at: daysAgo(3) }], pull, 'v')).toEqual({ since: daysAgo(3), asker: 'ann-lee' });
    expect(waitingSince(null, pull, 'v')).toEqual({ since: daysAgo(9), asker: 'ann-lee' });
  });
  it('the asker defaults to the actor then the author', () => {
    expect(waitingSince([{ event: 'review_requested', created_at: daysAgo(1), actor: { login: 'dana-k' } }], pull, null).asker).toBe('dana-k');
  });
  it('counts whole days', () => {
    expect(daysSince(daysAgo(0, 23), NOW)).toBe(0);
    expect(daysSince(daysAgo(4, 2), NOW)).toBe(4);
    expect(waitingLabel(daysAgo(0, 3), NOW)).toBe('New today');
    expect(waitingLabel(daysAgo(1), NOW)).toBe('Waiting 1 day');
    expect(waitingLabel(daysAgo(4), NOW)).toBe('Waiting 4 days');
  });
  it('the oldest wait counts only what waits on the viewer', () => {
    const rows = [
      { since: daysAgo(2), waitsOnYou: true },
      { since: daysAgo(9), waitsOnYou: false },
      { since: daysAgo(4), waitsOnYou: true },
      { since: null, waitsOnYou: true },
    ];
    expect(oldestLabel(rows, NOW)).toBe('Oldest: 4 days');
    expect(oldestLabel([{ since: daysAgo(0, 2), waitsOnYou: true }], NOW)).toBeNull();
    expect(oldestLabel([], NOW)).toBeNull();
  });
});

const facts = (over: Partial<ChangeFacts>): ChangeFacts => ({ number: 1, title: 'Darker default background', author: ann, asker: ann, since: daysAgo(4), task: 'design', thumb: icon, ...over });

describe('rows', () => {
  it('a review: who asks, how long it waits', () => {
    const r = changeNeed(facts({}), NOW);
    expect(r).toMatchObject({ kind: 'review', line: 'Ann asks for your review', waitsOnYou: true, pill: { label: 'Waiting 4 days', tone: 'warning' }, href: '/studio/changes/?pr=1' });
    expect(changeNeed(facts({ task: 'ship' }), NOW).line).toBe('Ann waits for you to add it to the library');
    // Who asked, not the account that opened it (the Bridge app for an email member).
    expect(changeNeed(facts({ task: 'ship', asker: { ...facts({}).asker, name: 'Priya' } }), NOW).line).toBe('Priya waits for you to add it to the library');
    expect(changeNeed(facts({ task: 'guidance', asker: CLAUDE }), NOW).line).toBe('Claude AI asks you to check the usage guidance');
    const tech = changeNeed(facts({ task: 'tech' }), NOW);
    expect(tech).toMatchObject({ kind: 'review', waitsOnYou: true, line: 'Ann asks for your tech review' });
    expect(changeNeed(facts({ since: null }), NOW).pill).toBeNull();
  });
  it('own branches: changes requested, blocked with what failed, ready to merge', () => {
    expect(changeNeed(facts({ task: 'own-changes', changesBy: [dana] }), NOW)).toMatchObject({ kind: 'own', line: 'Dana asked for changes', waitsOnYou: false, pill: { tone: 'warning' } });
    expect(changeNeed(facts({ task: 'own-changes' }), NOW).line).toBe('A reviewer asked for changes');
    expect(changeNeed(facts({ task: 'own-changes', changesBy: [dana] }), NOW).action).toBe('Update');
    expect(changeNeed(facts({ task: 'own-blocked', blocker: '2 tests fail' }), NOW).pill).toEqual({ label: '2 tests fail', tone: 'danger' });
    expect(changeNeed(facts({ task: 'own-ship' }), NOW).pill).toEqual({ label: 'Ready to add to the library', tone: 'success' });
  });
  it('guidance drafts are Claude waiting', () => {
    const g = guidanceNeed({ name: 'Tooltip', href: '/components/tooltip/?edit=1', since: daysAgo(2) }, NOW);
    expect(g).toMatchObject({ kind: 'guidance', title: 'Tooltip usage guidance', person: CLAUDE, waitsOnYou: true, pill: { label: 'Waiting 2 days' }, thumb: { kind: 'text' } });
    expect(guidanceNeed({ name: 'X', href: '#', since: null }, NOW).pill).toBeNull();
  });
  it('contrast failing on main is a danger row', () => {
    expect(contrastNeed(0)).toBeNull();
    expect(contrastNeed(2)).toMatchObject({ kind: 'health', title: '2 contrast checks fail in the library', pill: { label: '2 checks fail', tone: 'danger' } });
    expect(contrastNeed(1)?.title).toBe('1 contrast check fails in the library');
  });
});

describe('order and grouping', () => {
  const row = (key: string, kind: NeedRow['kind'], since: string | null): NeedRow => ({ key, kind, since, title: key, href: '#', person: null, line: '', waitsOnYou: true, pill: null, thumb: icon });
  it('blocked by you first (oldest first), then health, own, guidance, setup', () => {
    const rows = [row('g', 'guidance', daysAgo(9)), row('own', 'own', null), row('r-new', 'review', daysAgo(1)), row('setup', 'setup', null), row('h', 'health', null), row('r-old', 'review', daysAgo(5)), row('r-none', 'review', null)];
    expect(sortNeeds(rows).map((r) => r.key)).toEqual(['r-old', 'r-new', 'r-none', 'h', 'own', 'g', 'setup']);
  });
  it('shows three, groups the rest by kind', () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => row(`r${i}`, 'review', null)), ...Array.from({ length: 5 }, (_, i) => row(`g${i}`, 'guidance', null)), row('o', 'own', null), row('h', 'health', null)];
    const s = splitNeeds(sortNeeds(rows));
    expect(s.shown).toHaveLength(3);
    expect(s.more).toEqual({ count: 16, label: '16 more', parts: '9 reviews · 1 of your changes · 5 documentation drafts · 1 library check' });
    expect(splitNeeds(rows.slice(0, 3)).more).toBeNull();
    expect(splitNeeds([...rows.slice(0, 3), row('g', 'guidance', null)]).more?.parts).toBe('1 documentation draft');
  });
});

describe('only reviewer', () => {
  it('the viewer alone among the eligible and the requested, author left out', () => {
    expect(isOnlyReviewer({ eligible: ['peterbono'], requested: [], author: 'ann', viewer: 'PeterBono' })).toBe(true);
    expect(isOnlyReviewer({ eligible: ['peterbono', 'ann'], requested: [], author: 'ann', viewer: 'peterbono' })).toBe(true);
    expect(isOnlyReviewer({ eligible: ['peterbono'], requested: ['dana'], author: 'ann', viewer: 'peterbono' })).toBe(false);
    expect(isOnlyReviewer({ eligible: ['dana'], requested: [], author: 'ann', viewer: 'peterbono' })).toBe(false);
    expect(isOnlyReviewer({ eligible: ['peterbono'], requested: [], author: 'ann', viewer: null })).toBe(false);
  });
  it('the hint shows from five, and stays snoozed for seven days', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ onlyReviewer: i !== 0 }));
    expect(onlyReviewerLine(rows)).toEqual({ count: 5, text: 'You are the only reviewer for 5 of them.' });
    expect(onlyReviewerLine(rows.slice(0, 5))).toBeNull();
    expect(hintSnoozed(null, NOW)).toBe(false);
    expect(hintSnoozed(NOW - HINT_SNOOZE_MS + 1000, NOW)).toBe(true);
    expect(hintSnoozed(NOW - HINT_SNOOZE_MS - 1000, NOW)).toBe(false);
    expect(hintSnoozed(Number.NaN, NOW)).toBe(false);
  });
});

describe('health', () => {
  it('names an adoption drop above three points only', () => {
    expect(adoptionDrop(90, 94)).toBe(4);
    expect(adoptionDrop(91, 94)).toBeNull();
    expect(adoptionDrop(95, 94)).toBeNull();
    expect(adoptionDrop(null, 94)).toBeNull();
  });
});

describe('your branches', () => {
  it('status lines', () => {
    expect(branchStatus({ stage: 'draft', updated: daysAgo(0, 2), reviewer: null }, NOW)).toEqual({ stage: 'Draft', detail: 'edited 2 h ago' });
    expect(branchStatus({ stage: 'ready', updated: daysAgo(1), reviewer: dana }, NOW)).toEqual({ stage: 'In review', detail: 'Dana reviews' });
    expect(branchStatus({ stage: 'ready', updated: daysAgo(1), reviewer: null }, NOW).detail).toBe('waiting for a reviewer');
    // One status only: the pill alone, never "In review · Ready to add to the library".
    expect(branchStatus({ stage: 'ready', updated: daysAgo(1), reviewer: dana, status: 'Ready to add to the library' }, NOW)).toEqual({ stage: 'Ready to add to the library', detail: '' });
    expect(branchStatus({ stage: 'waiting', updated: daysAgo(1), reviewer: null }, NOW)).toEqual({ stage: 'Approved', detail: 'waiting for code' });
  });
  it('ages', () => {
    expect(ago(new Date(NOW - 30000).toISOString(), NOW)).toBe('just now');
    expect(ago(new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe('5 min ago');
    expect(ago(daysAgo(1), NOW)).toBe('1 day ago');
    expect(ago(daysAgo(3), NOW)).toBe('3 days ago');
  });
  it('filters and orders', () => {
    expect(showsBranch('all', 'waiting')).toBe(true);
    expect(showsBranch('draft', 'ready')).toBe(false);
    expect(showsBranch('ready', 'waiting')).toBe(true);
    const xs = [
      { stage: 'ready' as const, updated: daysAgo(1), n: 1 },
      { stage: 'draft' as const, updated: daysAgo(3), n: 2 },
      { stage: 'draft' as const, updated: daysAgo(0, 1), n: 3 },
      { stage: 'waiting' as const, updated: daysAgo(0), n: 4 },
    ];
    expect(sortBranches(xs).map((x) => x.n)).toEqual([3, 2, 1, 4]);
  });
});

describe('page state', () => {
  it('signed out, loading, busy, empty', () => {
    expect(homeState({ signedIn: false, loading: false, needs: 3, branches: 0 })).toBe('signed-out');
    expect(homeState({ signedIn: true, loading: true, needs: 0, branches: 0 })).toBe('loading');
    expect(homeState({ signedIn: true, loading: true, needs: 1, branches: 0 })).toBe('busy');
    expect(homeState({ signedIn: true, loading: false, needs: 0, branches: 2 })).toBe('busy');
    expect(homeState({ signedIn: true, loading: false, needs: 0, branches: 0 })).toBe('empty');
  });
});

describe('rowAction', () => {
  it('gives each kind of row a verb', () => {
    expect(rowAction('review')).toBe('Review');
    expect(rowAction('guidance')).toBe('Review');
    expect(rowAction('health')).toBe('Fix');
  });
});

describe('contributors: what waits on someone without a review right', () => {
  it('never gives an email contributor the review queue', () => {
    expect(holdsReviewRight({ viewer: 'leo@acme.design', contributor: true, approvers: ['leo@acme.design'], write: true })).toBe(false);
    expect(holdsReviewRight({ viewer: 'leo@acme.design', contributor: true, approvers: [], write: true })).toBe(false);
  });

  it('gives it to the people the approver or ship lists name, nobody else', () => {
    expect(holdsReviewRight({ viewer: 'Dana', contributor: false, approvers: ['dana'], write: true })).toBe(true);
    expect(holdsReviewRight({ viewer: 'ops', contributor: false, approvers: ['dana'], shippers: ['@ops'], write: true })).toBe(true);
    expect(holdsReviewRight({ viewer: 'ann', contributor: false, approvers: ['dana'], shippers: ['ops'], write: true })).toBe(false);
    // A team not read yet matches nobody.
    expect(holdsReviewRight({ viewer: 'ann', contributor: false, approvers: ['@acme/design'], write: true })).toBe(false);
    expect(holdsReviewRight({ viewer: null, contributor: false, approvers: [], write: true })).toBe(false);
  });

  it('lets anyone who writes review while the team names no owner', () => {
    expect(holdsReviewRight({ viewer: 'ann', contributor: false, approvers: [], write: true })).toBe(true);
    expect(holdsReviewRight({ viewer: 'ann', contributor: false, approvers: [], write: null })).toBe(true);
    expect(holdsReviewRight({ viewer: 'ann', contributor: false, approvers: [], write: false })).toBe(false);
  });

  it('keeps only their branches sent back with changes', () => {
    expect(waitsOnContributor('own-changes')).toBe(true);
    for (const t of ['design', 'ship', 'guidance', 'requested', 'own-blocked', 'own-ship', null] as const) expect(waitsOnContributor(t)).toBe(false);
  });

  it('tours their explorations, then how to start one', () => {
    expect(CONTRIBUTOR_TOUR_STEPS).toEqual(['branches', 'start']);
    expect(contributorTour('branches').title).toBe('Your explorations');
    expect(contributorTour('branches').text).toMatch(/until a reviewer approves it/);
    expect(contributorTour('start').title).toBe('Start an exploration');
    // Nothing yet: nothing to point at but where to start, the three ways to start a change.
    expect(contributorTourSteps(true)).toEqual(['start']);
    expect(contributorTourSteps(false)).toEqual(['branches', 'start']);
    expect(contributorTour('start', true).title).toBe('Where to start');
    for (const at of CONTRIBUTOR_TOUR_STEPS) expect(contributorTour(at).text).not.toMatch(/merge/i);
    for (const at of CONTRIBUTOR_TOUR_STEPS) expect(JSON.stringify([contributorTour(at), contributorTour(at, true)])).not.toMatch(/\u2014|lead/);
  });

  it('names the row verb, the row first', () => {
    expect(rowAction('own', 'Update')).toBe('Update');
    expect(rowAction('own')).toBe('Open');
  });
});

describe('join requests on the home (board E7b)', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const row = joinNeed({ id: 'r1', name: 'Jordan Lee', email: 'jordan.lee@acme.com', createdAt: '2026-10-23T11:00:00Z' }, 'Acme Design', now);

  it('reads as a person at the door: name, what they ask, email and role, how long they wait', () => {
    expect(row).toMatchObject({
      key: 'join-r1',
      kind: 'join',
      title: 'Jordan Lee',
      line: 'asks to join Acme Design',
      detail: 'jordan.lee@acme.com · joins as Can edit',
      waitsOnYou: true,
      pill: { label: 'Waiting 1 h', tone: 'warning' },
      request: { id: 'r1', name: 'Jordan Lee' },
    });
    expect(row.person?.name).toBe('Jordan');
    expect(row.href).toMatch(/settings\/#members$/);
    expect(joinNeed({ id: 'r2', name: 'A', email: 'a@b.co', createdAt: '2026-10-21T11:00:00Z' }, 'T', now).pill?.label).toBe('Waiting 2 days');
    expect(joinNeed({ id: 'r3', name: 'A', email: 'a@b.co', createdAt: '2026-10-23T11:45:00Z' }, 'T', now).pill?.label).toBe('New');
  });

  it('comes first, and folds into N more past three like any row', () => {
    const review = { ...row, key: 'change-1', kind: 'review' as const, since: '2026-10-20T00:00:00Z' };
    expect(sortNeeds([review, row]).map((r) => r.key)).toEqual(['join-r1', 'change-1']);
    const rows = [review, { ...review, key: 'c2' }, { ...review, key: 'c3' }, row];
    const { shown, more } = splitNeeds(sortNeeds(rows));
    expect(shown[0]!.key).toBe('join-r1');
    expect(more).toMatchObject({ count: 1, parts: '1 review' });
    expect(splitNeeds([review, review, review, row, { ...row, key: 'j2' }]).more?.parts).toBe('2 join requests');
  });
});

describe('more than 3 waiting', () => {
  it('opens the review queue for a reviewer, their own work on Changes for anyone else', () => {
    expect(moreNeedsAction(false)).toEqual({ label: 'Review all', path: 'review/' });
    expect(moreNeedsAction(true)).toEqual({ label: 'See all', path: 'changes/?who=mine' });
  });
});
