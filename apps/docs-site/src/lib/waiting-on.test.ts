import { describe, expect, it } from 'vitest';
import { CLAUDE_WAITING_SENTENCE, needFromStatus, whoActs, type People, type Need } from './changes';
import { rowLifecycle } from './change-status';
import { reviewStatus, summarizeCi } from './review-rules';
import { isReviewTask, reviewCount, waitingOn, waitsOnMe, type WaitChange, type WaitViewer } from './waiting-on';

// One team: Ann designs (design owner), Theo codes (tech owner), Sam contributes. Florian is the only owner of a solo
// team and the only one allowed to use the owner override.
const owners = { design: ['ann'], tech: ['theo'] };
const ann: WaitViewer = { login: 'ann', role: 'reviewer' };
const theo: WaitViewer = { login: 'theo', role: 'reviewer' };
const sam: WaitViewer = { login: 'sam', role: 'contributor' };

const who = (need: Need, author: string, viewer: string, extra: Partial<People> = {}) => whoActs(need, { owners, author, viewer, ...extra });
const change = (author: string, need: Need, viewer: string, extra: Partial<WaitChange> = {}, people: Partial<People> = {}): WaitChange => ({
  author,
  lifecycle: 'ready',
  who: who(need, author, viewer, people),
  ...extra,
});

describe('waitingOn: one rule for every "waiting on me" surface', () => {
  it('never waits on anyone for a token push from Figma that ships after the checks (docs/BUILD-REQUESTS.md)', () => {
    const need: Need = { kind: 'approve', roles: ['design', 'tech'] };
    expect(waitingOn(change('sam', need, 'ann', { autoShip: true, requested: ['ann'] }), ann)).toBeNull();
    expect(reviewCount([change('sam', need, 'ann', { autoShip: true })], ann)).toBe(0);
  });

  it('waits on the design owner for the design approval, never on the tech owner', () => {
    const need: Need = { kind: 'approve', roles: ['design', 'tech'] };
    expect(waitingOn(change('sam', need, 'ann'), ann)).toBe('design');
    expect(waitingOn(change('sam', need, 'theo'), theo)).toBeNull();
  });

  it('keeps the tech review off every designer list: it is developer work', () => {
    const need: Need = { kind: 'approve', roles: ['tech'] };
    expect(waitingOn(change('sam', need, 'theo'), theo)).toBeNull();
    expect(waitingOn(change('sam', need, 'ann'), ann)).toBeNull();
  });

  it('never lands a technical blocker on a designer, even when GitHub asks them for a review', () => {
    const failing = change('sam', { kind: 'fix-checks', failing: 2, developerOnly: true }, 'ann', { requested: ['ann'] });
    expect(waitingOn(failing, ann)).toBeNull();
    const conflict = change('sam', { kind: 'resolve-conflict' }, 'ann', { requested: ['ann'] });
    expect(waitingOn(conflict, ann)).toBeNull();
    const forCode = change('sam', { kind: 'approve', roles: ['tech'] }, 'ann', { lifecycle: 'waiting', requested: ['ann'] });
    expect(waitingOn(forCode, ann)).toBeNull();
  });

  it('lets an approval the designer can give go first while a developer fixes tests', () => {
    const c = change('sam', { kind: 'fix-checks', failing: 1, developerOnly: true, then: ['design'] }, 'ann');
    expect(waitingOn(c, ann)).toBe('design');
  });

  it('asks a contributor only about their own branch sent back with changes', () => {
    const back = change('sam', { kind: 'address-changes', by: ['ann'] }, 'sam', { changesRequested: ['ann'] });
    expect(waitingOn(back, sam)).toBe('own-changes');
    // Even with no owner named (anyone may approve), a contributor reviews nothing.
    const open = whoActs({ kind: 'approve', roles: ['approval'] }, { owners: { design: [], tech: [] }, author: 'lea', viewer: 'sam' });
    expect(waitingOn({ author: 'lea', lifecycle: 'ready', who: open }, sam)).toBeNull();
    // An email contributor's own branch, before any status: the changes asked are enough.
    expect(waitingOn({ author: 'sam@acme.com', who: null, changesRequested: ['ann'] }, { login: 'sam@acme.com', role: 'contributor' })).toBe('own-changes');
  });

  it('never counts a solo owner\'s own branch that only the owner override can merge', () => {
    const solo = { design: ['florian'], tech: ['florian'] };
    const own = whoActs({ kind: 'approve', roles: ['design', 'tech'] }, { owners: solo, author: 'florian', viewer: 'florian', overrideBy: ['florian'], overridable: true });
    expect(own.action).toBe('override');
    expect(waitingOn({ author: 'florian', lifecycle: 'ready', who: own }, { login: 'florian', role: 'reviewer' })).toBeNull();
  });

  it('offers the override to an owner it names when no other owner can approve, as a design review', () => {
    const w = whoActs({ kind: 'approve', roles: ['design'] }, { owners: { design: ['lea'], tech: ['theo'] }, author: 'lea', viewer: 'ann', overrideBy: ['ann'], overridable: true });
    expect(waitingOn({ author: 'lea', lifecycle: 'ready', who: w }, ann)).toBe('design');
  });

  it('waits on the shipper to merge an approved change, and on the author to merge their own', () => {
    const ready: Need = { kind: 'ready' };
    expect(waitingOn(change('sam', ready, 'ann'), ann)).toBe('ship');
    expect(waitingOn(change('ann', ready, 'ann'), ann)).toBe('own-ship');
    // A contributor never merges.
    expect(waitingOn(change('sam', ready, 'sam', {}, { canMerge: true }), sam)).toBeNull();
  });

  it('names usage guidance as guidance', () => {
    expect(waitingOn(change('sam', { kind: 'approve', roles: ['design'] }, 'ann', { guidance: true }), ann)).toBe('guidance');
  });

  it('leaves out drafts, explorations, developer work and changes not read yet', () => {
    const need: Need = { kind: 'approve', roles: ['design'] };
    expect(waitingOn(change('sam', need, 'ann', { draft: true }), ann)).toBeNull();
    expect(waitingOn(change('sam', need, 'ann', { exploration: true }), ann)).toBeNull();
    expect(waitingOn(change('sam', need, 'ann', { nature: 'developer' }), ann)).toBeNull();
    expect(waitingOn({ author: 'sam', who: null }, ann)).toBeNull();
    expect(waitingOn(change('sam', need, 'ann'), { login: null, role: 'reviewer' })).toBeNull();
  });

  it('counts a review GitHub asks of a reviewer who cannot approve yet as requested', () => {
    const w = whoActs({ kind: 'approve', roles: ['design'] }, { owners, author: 'sam', viewer: 'theo' });
    expect(waitingOn({ author: 'sam', lifecycle: 'ready', who: w, requested: ['theo'] }, theo)).toBe('requested');
  });

  it('puts every branch in review on the demo lead, never drafts, explorations or developer work', () => {
    const seat: WaitViewer = { login: null, role: 'reviewer', seat: true };
    expect(waitingOn({ author: 'ann', who: null }, seat)).toBe('requested');
    expect(waitingOn({ author: 'ann', who: null, guidance: true }, seat)).toBe('guidance');
    expect(waitingOn({ author: 'ann', who: null, draft: true }, seat)).toBeNull();
    expect(waitingOn({ author: 'ann', who: null, exploration: true }, seat)).toBeNull();
    expect(waitingOn({ author: 'ann', who: null, nature: 'developer' }, seat)).toBeNull();
  });

  it('gives the badge count of review rows only, and the Waiting on me filter every row', () => {
    const changes = [
      change('sam', { kind: 'approve', roles: ['design'] }, 'ann'),
      change('ann', { kind: 'address-changes', by: ['theo'] }, 'ann', { changesRequested: ['theo'] }),
      change('sam', { kind: 'approve', roles: ['tech'] }, 'ann'),
    ];
    expect(reviewCount(changes, ann)).toBe(1);
    expect(changes.filter((c) => waitsOnMe(c, ann))).toHaveLength(2);
    expect(isReviewTask('own-changes')).toBe(false);
    expect(isReviewTask('ship')).toBe(true);
  });
});

// Decision RT-1: a change sent from the Figma plugin opens a branch labelled waiting-for-claude (the spec only); once a
// developer drafts the code with Claude it is labelled drafted-by-claude, which reads as ready for review even while
// GitHub still calls it a draft.
describe('waitingOn: branches opened from Figma (RT-1)', () => {
  const waiting = [{ name: 'from-figma' }, { name: 'waiting-for-claude' }];
  const drafted = [{ name: 'from-figma' }, { name: 'drafted-by-claude' }];
  const green = summarizeCi([{ name: 'test', status: 'completed', conclusion: 'success' }]);
  const none = { approvers: [], changesRequested: [], design: false, tech: false };

  it('before the draft: waits on a developer, never on the designer who sent it, in nobody\'s queue', () => {
    const pull = { state: 'open', draft: true, labels: waiting };
    const kind = reviewStatus({ ...pull, ci: green, approvals: none, tier: 2 }).kind;
    expect(kind).toBe('draft');
    const lifecycle = rowLifecycle(pull, { kind, nature: 'design', tier: 2 });
    expect(lifecycle).toBe('draft');
    const need = needFromStatus(kind, { claude: 'waiting' });
    for (const [viewer, v] of [['sam', sam], ['ann', ann], ['theo', theo]] as const) {
      const w = who(need, 'sam', viewer);
      expect(w).toMatchObject({ who: 'developer', yourTurn: false, sentence: CLAUDE_WAITING_SENTENCE });
      expect(waitingOn({ author: 'sam', draft: true, labels: waiting, lifecycle, who: w, requested: ['ann'] }, v)).toBeNull();
    }
    // Even when GitHub no longer calls it a draft, nothing waits on a designer until the code is there.
    const open = change('sam', { kind: 'approve', roles: ['design'] }, 'ann', { labels: waiting, requested: ['ann'] });
    expect(waitingOn(open, ann)).toBeNull();
    expect(waitingOn({ author: 'ann', who: null, labels: waiting }, { login: null, role: 'reviewer', seat: true })).toBeNull();
  });

  it('after the draft: ready for review though GitHub still calls it a draft, in the owners\' queue', () => {
    const pull = { state: 'open', draft: true, labels: drafted };
    const kind = reviewStatus({ ...pull, ci: green, approvals: none, tier: 2 }).kind;
    expect(kind).toBe('needs-design');
    const lifecycle = rowLifecycle(pull, { kind, nature: 'design', tier: 2 });
    expect(lifecycle).toBe('ready');
    const need = needFromStatus(kind, { claude: 'drafted' });
    expect(waitingOn({ author: 'sam', draft: true, labels: drafted, lifecycle, who: who(need, 'sam', 'ann') }, ann)).toBe('design');
    // The designer who sent it waits on the owners; the tech owner is not asked for the design approval.
    expect(waitingOn({ author: 'sam', draft: true, labels: drafted, lifecycle, who: who(need, 'sam', 'sam') }, sam)).toBeNull();
    expect(waitingOn({ author: 'sam', draft: true, labels: drafted, lifecycle, who: who(need, 'sam', 'theo') }, theo)).toBeNull();
    // The demo lead's seat reads it as in review too.
    expect(waitingOn({ author: 'ann', who: null, draft: true, labels: drafted }, { login: null, role: 'reviewer', seat: true })).toBe('requested');
  });
});

describe('a branch updated after the changes request', () => {
  const need = needFromStatus('changes-requested', { changesRequestedBy: ['ann'], lookAgain: ['ann'] });

  it('goes back to the reviewer who asked: her turn to look again, a review row', () => {
    const w = who(need, 'sam', 'ann');
    expect(w).toMatchObject({ yourTurn: true, action: 'look-again', sentence: '@sam updated it after your changes: look again.', short: 'Your turn: look again' });
    const task = waitingOn(change('sam', need, 'ann', { changesRequested: ['ann'] }), ann);
    expect(task).toBe('look-again');
    expect(isReviewTask(task)).toBe(true);
  });

  it('no longer waits on the author; others read who looks again', () => {
    expect(who(need, 'sam', 'sam')).toMatchObject({ yourTurn: false, sentence: 'Waiting for @ann to look again.' });
    expect(waitingOn(change('sam', need, 'sam', { changesRequested: ['ann'] }), sam)).toBeNull();
    expect(who(need, 'sam', 'theo')).toMatchObject({ yourTurn: false, short: 'Reviewer to look again' });
  });

  it('stays with the author until the branch moved on', () => {
    const before = needFromStatus('changes-requested', { changesRequestedBy: ['ann'], lookAgain: [] });
    expect(before.kind).toBe('address-changes');
    expect(waitingOn(change('sam', before, 'sam', { changesRequested: ['ann'] }), sam)).toBe('own-changes');
  });
});
