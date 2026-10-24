// One status for one branch on every Studio surface: the Branches row, the branch page header and the home card all
// read statusPill over core reviewStatusKind, so the demo repo's branches (no CI, one owner who wrote them) read the
// same everywhere instead of "Status unknown", "Checking", "Owner override needed" and "In review".
import { describe, expect, it } from 'vitest';
import { mergeGate, reviewStatus, summarizeApprovals, summarizeCi } from './review-rules';
import { needFromDetail, needFromStatus, statusPill, whoActs, type People } from './changes';
import { branchStatus } from './home-model';
import { checksLine } from './review-page';

const noCi = summarizeCi([], []);
// The demo repo: one owner holds both roles and wrote every branch.
const people: People = { owners: { design: ['peterbono'], tech: ['peterbono'] }, author: 'peterbono', overrideBy: ['peterbono'] };
const approvals = summarizeApprovals([], people.owners, 'peterbono', { soloOwnerCanApproveBoth: true });
const pull = { state: 'open', draft: false, merged_at: null };

describe('statusPill', () => {
  it('a branch with no checks reads the same in the list and on its page, whatever GitHub says about the merge', () => {
    for (const mergeable of [true, null, undefined]) {
      const kind = reviewStatus({ ...pull, ci: noCi, approvals, tier: 3, mergeable }).kind;
      expect(kind).toBe('needs-design');
      // The list row (needFromStatus) and the page header (needFromDetail) name the same next step.
      const row = whoActs(needFromStatus(kind, { pending: ['design', 'tech'] }), people);
      const gate = mergeGate({ tier: 3, ci: noCi, approvals, draft: false, mergeable, state: 'open' });
      const page = whoActs(needFromDetail({ state: 'open', ci: noCi, gate, changesRequestedBy: [], mergeable }), people);
      expect(statusPill(kind, row)).toEqual(statusPill(kind, page));
      expect(statusPill(kind, row)).toEqual({ label: 'Owner override needed', tone: 'info' });
    }
  });

  it('the viewer who may use the override reads their turn, in the list and on the page alike', () => {
    const viewer = { ...people, viewer: 'peterbono', overridable: true };
    const kind = reviewStatus({ ...pull, ci: noCi, approvals, tier: 1, mergeable: null }).kind;
    expect(kind).toBe('needs-approval');
    expect(statusPill(kind, whoActs(needFromStatus(kind), viewer)).label).toBe('Your turn: owner override');
  });

  it('falls back to the status words when who acts adds nothing', () => {
    expect(statusPill('merged', null)).toEqual({ label: 'Added to the library', tone: 'neutral' });
    expect(statusPill('needs-design', { short: null })).toEqual({ label: 'Needs design approval', tone: 'info' });
  });
});

describe('home card and checks line', () => {
  it('an in-review card says the same as its row once its status is read', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(branchStatus({ stage: 'ready', updated: '2026-10-21T12:00:00Z', reviewer: null, status: 'Owner override needed' }, now)).toEqual({ stage: 'In review', detail: 'Owner override needed' });
    expect(branchStatus({ stage: 'ready', updated: '2026-10-21T12:00:00Z', reviewer: null, status: null }, now).detail).toBe('waiting for a reviewer');
  });

  it('no automated checks is said calmly, never as missing or running', () => {
    expect(checksLine({ design: null, developer: null, designFails: false, developerFailing: 0, oldValue: false })).toMatchObject({ state: 'none', text: 'No automated checks.' });
  });
});
