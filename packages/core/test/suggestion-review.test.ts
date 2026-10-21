import { describe, expect, it } from 'vitest';
import {
  composeSuggestionAppliedComment,
  composeSuggestionReviewComment,
  parseSuggestionAppliedComment,
  parseSuggestionReviewComment,
  suggestionReviewState,
  suggestionStateLabel,
  suggestionStatus,
  summarizeSuggestionApprovals,
  type SuggestionCommentLike,
  type SuggestionReviewEvent,
} from '../src/index';

const SHA = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const gov = { owners: { design: ['dana'], tech: ['@teo'] } };

const review = (author: string, event: SuggestionReviewEvent, payloadSha = SHA, extra: Partial<SuggestionCommentLike> = {}): SuggestionCommentLike => ({
  author,
  body: composeSuggestionReviewComment({ event, payloadSha, at: '2026-10-21T10:00:00Z', by: author }),
  ...extra,
});

describe('review comments', () => {
  it('round-trips the hidden record and reads like a sentence', () => {
    const body = composeSuggestionReviewComment({ event: 'approve', role: 'design', payloadSha: SHA, at: '2026-10-21T10:00:00Z', by: '@dana', message: 'Nice.\nShip it.' });
    expect(body.startsWith('Approved for design by @dana in Bridge.\n\n> Nice.\n> Ship it.')).toBe(true);
    expect(body).toContain('version `aaaaaaa`');
    expect(body).not.toMatch(/—/);
    expect(parseSuggestionReviewComment(body)).toEqual({ event: 'approve', role: 'design', payloadSha: SHA, at: '2026-10-21T10:00:00Z' });
    expect(composeSuggestionReviewComment({ event: 'request-changes', payloadSha: SHA, at: '' }).split('\n')[0]).toBe('Changes requested in Bridge.');
    expect(parseSuggestionReviewComment('LGTM')).toBeNull();
    expect(parseSuggestionReviewComment('<!-- bridge-suggestion-review {"event":"approve","payloadSha":"short"} -->')).toBeNull();
    expect(parseSuggestionReviewComment('<!-- bridge-suggestion-review {"event":"merge","payloadSha":"' + SHA + '"} -->')).toBeNull();
  });

  it('round-trips the applied marker', () => {
    const body = composeSuggestionAppliedComment({ by: 'dev', pr: 88, branch: 'bridge/suggestion-42-x', payloadSha: SHA, at: '2026-10-21T11:00:00Z' });
    expect(body.split('\n')[0]).toBe('Being applied in pull request #88 by @dev.');
    expect(parseSuggestionAppliedComment(body)).toMatchObject({ pr: 88, branch: 'bridge/suggestion-42-x', payloadSha: SHA });
    expect(composeSuggestionAppliedComment({ branch: 'b', payloadSha: SHA, at: '', forced: true })).toMatch(/^Being applied on `b`\. Applied before every approval was in\./);
  });
});

describe('approvals on a suggestion', () => {
  it('counts design and tech approvals only from the configured owners', () => {
    const a = summarizeSuggestionApprovals([review('dana', 'approve'), review('mallory', 'approve'), review('teo', 'approve')], gov, { payloadSha: SHA, author: 'ana' });
    expect(a).toMatchObject({ approvers: ['dana', 'teo'], design: true, tech: true, changesRequested: [], stale: [], ignored: ['mallory'] });
    expect(suggestionReviewState(3, a)).toBe('approved');

    const onlyOutsiders = summarizeSuggestionApprovals([review('mallory', 'approve'), review('eve', 'approve', SHA, { authorAssociation: 'OWNER' })], gov, { payloadSha: SHA });
    expect(onlyOutsiders).toMatchObject({ approvers: [], design: false, tech: false });
    expect(suggestionReviewState(1, onlyOutsiders)).toBe('needs-review');
  });

  it('follows rights: who may approve design and tech', () => {
    const owners = { design: ['dana'], tech: ['teo'] };
    const rights = { approveDesign: ['design', 'tech'] as ('design' | 'tech')[], approveTech: ['tech'] as ('design' | 'tech')[], ship: ['tech'] as ('design' | 'tech')[] };
    const a = summarizeSuggestionApprovals([review('teo', 'approve')], { owners, rights }, { payloadSha: SHA });
    // One person holding both rights does not cover both approvals alone.
    expect(a).toMatchObject({ design: true, tech: false });
  });

  it('lets the only owner cover design and tech when governance.soloOwnerCanApproveBoth is on', () => {
    const solo = { owners: { design: ['peterbono'], tech: ['@PeterBono'] } };
    const off = summarizeSuggestionApprovals([review('peterbono', 'approve')], solo, { payloadSha: SHA, author: 'ana' });
    expect(off).toMatchObject({ design: true, tech: false });
    expect(suggestionReviewState(3, off)).toBe('needs-review');
    const on = summarizeSuggestionApprovals([review('peterbono', 'approve')], { ...solo, soloOwnerCanApproveBoth: true }, { payloadSha: SHA, author: 'ana' });
    expect(on).toMatchObject({ design: true, tech: true });
    expect(suggestionReviewState(2, on)).toBe('approved');
    expect(suggestionReviewState(3, on)).toBe('approved');
    // The author still never approves their own suggestion.
    const own = summarizeSuggestionApprovals([review('peterbono', 'approve')], { ...solo, soloOwnerCanApproveBoth: true }, { payloadSha: SHA, author: 'peterbono' });
    expect(own).toMatchObject({ approvers: [], design: false, tech: false });
    // Two owners: the rule does not apply, one person still covers one part.
    const two = summarizeSuggestionApprovals([review('dana', 'approve')], { owners: { design: ['dana'], tech: ['dana', 'teo'] }, soloOwnerCanApproveBoth: true }, { payloadSha: SHA });
    expect(two).toMatchObject({ design: true, tech: false });
  });

  it('never counts the author, and needs collaborators when no owner is set', () => {
    const own = summarizeSuggestionApprovals([review('dana', 'approve')], gov, { payloadSha: SHA, author: 'Dana' });
    expect(own.approvers).toEqual([]);
    const noOwners = { owners: { design: [], tech: [] } };
    const c = summarizeSuggestionApprovals(
      [review('drive-by', 'approve', SHA, { authorAssociation: 'NONE' }), review('m1', 'approve', SHA, { authorAssociation: 'MEMBER' }), review('c1', 'approve', SHA, { authorAssociation: 'COLLABORATOR' })],
      noOwners,
      { payloadSha: SHA },
    );
    expect(c).toMatchObject({ approvers: ['m1', 'c1'], design: true, tech: true, ignored: ['drive-by'] });
  });

  it('binds approvals to the payload sha: an edit makes them stale', () => {
    const comments = [review('dana', 'approve', OLD), review('teo', 'approve', OLD)];
    const a = summarizeSuggestionApprovals(comments, gov, { payloadSha: SHA });
    expect(a).toMatchObject({ approvers: [], design: false, tech: false, stale: ['dana', 'teo'] });
    expect(suggestionReviewState(3, a)).toBe('needs-review');
    // Approving the new version counts again; the stale list empties for that person.
    const again = summarizeSuggestionApprovals([...comments, review('dana', 'approve')], gov, { payloadSha: SHA });
    expect(again).toMatchObject({ approvers: ['dana'], design: true, tech: false, stale: ['teo'] });
    // An old "changes requested" does not block the new version either.
    const oldBlock = summarizeSuggestionApprovals([review('teo', 'request-changes', OLD), review('dana', 'approve')], gov, { payloadSha: SHA });
    expect(oldBlock.changesRequested).toEqual([]);
    expect(suggestionReviewState(1, oldBlock)).toBe('approved');
  });

  it('keeps the latest decisive review per person; plain comments change nothing', () => {
    const a = summarizeSuggestionApprovals([review('teo', 'approve'), review('teo', 'request-changes'), review('dana', 'approve'), review('dana', 'comment')], gov, { payloadSha: SHA });
    expect(a).toMatchObject({ approvers: ['dana'], changesRequested: ['teo'] });
    expect(suggestionReviewState(3, a)).toBe('changes-requested');
    const b = summarizeSuggestionApprovals([review('teo', 'request-changes'), review('teo', 'approve'), review('dana', 'approve')], gov, { payloadSha: SHA });
    expect(suggestionReviewState(3, b)).toBe('approved');
  });

  it('orders by creation date when comments come unsorted', () => {
    const a = summarizeSuggestionApprovals(
      [review('teo', 'approve', SHA, { createdAt: '2026-10-21T12:00:00Z' }), review('teo', 'request-changes', SHA, { createdAt: '2026-10-21T09:00:00Z' })],
      gov,
      { payloadSha: SHA },
    );
    expect(a.approvers).toEqual(['teo']);
  });
});

describe('suggestion status', () => {
  it('walks needs review, changes requested, approved, applying, applied', () => {
    expect(suggestionStatus({ state: 'open' })).toBe('needs-review');
    expect(suggestionStatus({ state: 'open', review: 'changes-requested' })).toBe('changes-requested');
    expect(suggestionStatus({ state: 'open', review: 'approved' })).toBe('approved');
    expect(suggestionStatus({ state: 'open', review: 'approved', linkedPrs: [{ state: 'open' }] })).toBe('applying');
    expect(suggestionStatus({ state: 'open', review: 'approved', applied: true })).toBe('applying');
    expect(suggestionStatus({ state: 'closed', linkedPrs: [{ state: 'closed', merged: true }] })).toBe('applied');
    expect(suggestionStatus({ state: 'closed', stateReason: 'completed' })).toBe('applied');
  });

  it('declined when closed not planned or closed without a merge; outdated from the dry run', () => {
    expect(suggestionStatus({ state: 'closed', stateReason: 'not_planned' })).toBe('declined');
    expect(suggestionStatus({ state: 'closed', linkedPrs: [{ state: 'closed', merged: false }] })).toBe('declined');
    expect(suggestionStatus({ state: 'open', review: 'approved', outdated: true })).toBe('outdated');
    // A pull request already applying it wins over outdated.
    expect(suggestionStatus({ state: 'open', outdated: true, linkedPrs: [{ state: 'open' }] })).toBe('applying');
  });

  it('keeps one state label while open, none once closed or outdated', () => {
    expect(suggestionStateLabel('approved')).toBe('suggestion: approved');
    expect(suggestionStateLabel('applying')).toBe('suggestion: applying');
    expect(suggestionStateLabel('applied')).toBeNull();
    expect(suggestionStateLabel('declined')).toBeNull();
    expect(suggestionStateLabel('outdated')).toBeNull();
  });
});
