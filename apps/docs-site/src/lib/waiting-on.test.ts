import { describe, expect, it } from 'vitest';
import { whoActs, type People, type Need } from './changes';
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
