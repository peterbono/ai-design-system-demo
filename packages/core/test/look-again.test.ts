import { describe, expect, it } from 'vitest';
import { lookAgainReviewers, type ReviewLike } from '../src/review-gate';

const HEAD = 'h'.repeat(40);
const OLD = 'o'.repeat(40);
const r = (login: string, state: string, commit: string | null, at: string): ReviewLike => ({ user: { login }, state, commit_id: commit, submitted_at: at });

describe('lookAgainReviewers', () => {
  it('gives the turn back once the author updated the branch after every changes request', () => {
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', OLD, '1')], HEAD, 'priya')).toEqual(['dana']);
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', HEAD, '1')], HEAD, 'priya')).toEqual([]);
  });

  it('waits while one request is on the current head, and reads the latest decisive review only', () => {
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', OLD, '1'), r('malik', 'CHANGES_REQUESTED', HEAD, '2')], HEAD)).toEqual([]);
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', OLD, '1'), r('dana', 'COMMENTED', HEAD, '2')], HEAD)).toEqual(['dana']);
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', OLD, '1'), r('dana', 'APPROVED', HEAD, '2')], HEAD)).toEqual([]);
  });

  it('never guesses: no commit on the review, no head, or no request', () => {
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', null, '1')], HEAD)).toEqual([]);
    expect(lookAgainReviewers([r('dana', 'CHANGES_REQUESTED', OLD, '1')], null)).toEqual([]);
    expect(lookAgainReviewers([r('dana', 'APPROVED', OLD, '1')], HEAD)).toEqual([]);
  });
});
