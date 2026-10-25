import { describe, expect, it } from 'vitest';
import { branchVerdict, LOOK_AGAIN_STATUS_LABEL, reviewStatusLabel, summarizeCi, type ApprovalSummary } from '../src/review-gate';

const asked: ApprovalSummary = { approvers: [], changesRequested: ['theo'], design: false, tech: false, owner: false } as ApprovalSummary;
const ci = summarizeCi([], []);

describe('a branch updated after every changes request reads "Updated, look again" (Studio, MCP and CLI)', () => {
  it('says so only while changes are requested and someone looks again', () => {
    expect(reviewStatusLabel('changes-requested', ['theo'])).toBe(LOOK_AGAIN_STATUS_LABEL);
    expect(LOOK_AGAIN_STATUS_LABEL).toBe('Updated, look again');
    expect(reviewStatusLabel('changes-requested', [])).toBe('Changes requested');
    expect(reviewStatusLabel('changes-requested')).toBe('Changes requested');
    expect(reviewStatusLabel('needs-design', ['theo'])).toBe('Needs design approval');
  });

  it('keeps the status and the merge gate as they are', () => {
    const v = branchVerdict({ tier: 3, ci, approvals: asked, owners: { design: ['ann'], tech: ['theo'] }, mergeable: true, lookAgain: ['theo'] });
    expect(v.status).toBe('changes-requested');
    expect(v.label).toBe('Updated, look again');
    expect(v.lookAgain).toEqual(['theo']);
    expect(v.gate?.allowed).toBe(false);
    const before = branchVerdict({ tier: 3, ci, approvals: asked, owners: { design: ['ann'], tech: ['theo'] }, mergeable: true });
    expect(before.label).toBe('Changes requested');
    expect(before.lookAgain).toEqual([]);
  });
});
