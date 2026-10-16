import { describe, expect, it } from 'vitest';
import {
  allowedMergeMethods,
  canOverride,
  canWrite,
  mergeGate,
  openPulls,
  OVERRIDE_HEADING,
  overrideComment,
  overrideReasonProblem,
  overrideRefusedComment,
  parseOverrideComment,
  PULL_STATE_PILL,
  pullState,
  summarizeApprovals,
  summarizeCi,
  type OverridePolicy,
  type ReviewLike,
} from './review-rules';

// Solo maintainer: the same login is design owner, tech owner, author and the only one allowed to override.
const owners = { design: ['peterbono'], tech: ['peterbono'] };
const policy: OverridePolicy = { allowed: ['peterbono'], requireReason: true, minReasonLength: 20 };
const green = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'success' }]);
const red = summarizeCi([{ name: 'Guardrails', status: 'completed', conclusion: 'failure' }]);
const running = summarizeCi([{ name: 'CI', status: 'in_progress', conclusion: null }]);
const selfApproval: ReviewLike[] = [{ user: { login: 'peterbono' }, state: 'APPROVED', submitted_at: '2026-10-16T10:00:00Z' }];
const noApprovals = summarizeApprovals(selfApproval, owners, 'peterbono');

const gate = (over: Partial<Parameters<typeof mergeGate>[0]> = {}) =>
  mergeGate({ tier: 3, ci: green, approvals: noApprovals, draft: false, state: 'open', viewer: 'peterbono', override: policy, ...over });

describe('mergeGate owner override', () => {
  it('solo owner: only approvals are missing, so the override is offered and Merge stays off', () => {
    const g = gate();
    expect(g.allowed).toBe(false);
    expect(g.overridable).toBe(true);
    expect(g.missing).toEqual(['design approval', 'tech approval']);
    expect(g.reasons).toEqual(['Tier 3 needs a design owner approval.', 'Tier 3 needs a tech owner approval.']);
  });

  it('the author approving their own PR never counts as an approval', () => {
    expect(noApprovals).toMatchObject({ approvers: [], design: false, tech: false });
  });

  it('matches the login case-insensitively and ignores a leading @', () => {
    expect(gate({ viewer: 'PeterBono' }).overridable).toBe(true);
    expect(canOverride('peterbono', { ...policy, allowed: ['@PeterBono'] })).toBe(true);
  });

  it('never overrides failing CI', () => {
    const g = gate({ ci: red });
    expect(g.overridable).toBe(false);
    expect(g.reasons.join(' ')).toMatch(/CI fails: Guardrails/);
  });

  it('never overrides CI that is still running', () => {
    expect(gate({ ci: running }).overridable).toBe(false);
  });

  it('never overrides requested changes', () => {
    const approvals = summarizeApprovals([{ user: { login: 'dana' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-16T11:00:00Z' }], owners, 'peterbono');
    const g = gate({ approvals });
    expect(g.overridable).toBe(false);
    expect(g.reasons.join(' ')).toMatch(/Changes requested by @dana/);
  });

  it('never overrides a draft', () => {
    const g = gate({ draft: true });
    expect(g.overridable).toBe(false);
    expect(g.reasons[0]).toMatch(/draft/);
  });

  it('never overrides a merge conflict or a closed PR', () => {
    expect(gate({ mergeable: false }).overridable).toBe(false);
    expect(gate({ state: 'closed' }).overridable).toBe(false);
  });

  it('a viewer who is not in override.allowed gets no override', () => {
    expect(gate({ viewer: 'dana' }).overridable).toBe(false);
    expect(gate({ viewer: null }).overridable).toBe(false);
  });

  it('no override configured (the default) means no override for anyone', () => {
    expect(gate({ override: { ...policy, allowed: [] } }).overridable).toBe(false);
    expect(gate({ override: undefined }).overridable).toBe(false);
  });

  it('nothing to override when the gate is already open', () => {
    const both = summarizeApprovals(
      [
        { user: { login: 'dana' }, state: 'APPROVED', submitted_at: '2026-10-16T10:00:00Z' },
        { user: { login: 'theo' }, state: 'APPROVED', submitted_at: '2026-10-16T10:00:00Z' },
      ],
      { design: ['dana'], tech: ['theo'] },
      'peterbono',
    );
    expect(gate({ approvals: both })).toEqual({ allowed: true, reasons: [], overridable: false, missing: [] });
  });

  it('Tier 1 and 2 report one missing approval', () => {
    expect(gate({ tier: 2 })).toMatchObject({ overridable: true, missing: ['approval'] });
  });
});

describe('override reason and audit comment', () => {
  it('requires a reason of the configured length', () => {
    expect(overrideReasonProblem('', policy)).toMatch(/Write why/);
    expect(overrideReasonProblem('too short', policy)).toMatch(/at least 20 characters \(9 so far\)/);
    expect(overrideReasonProblem('Solo maintainer, CI green, reviewed the diff myself.', policy)).toBeNull();
    expect(overrideReasonProblem('', { ...policy, requireReason: false })).toBeNull();
  });

  it('writes a stable comment that reads back', () => {
    const body = overrideComment('peterbono', 'Solo maintainer, nobody else can approve.  ', ['design approval', 'tech approval']);
    expect(body).toBe(
      '**Bridge owner override**\n\nOwner override by @peterbono: Solo maintainer, nobody else can approve. Missing: design approval, tech approval. Merged from Bridge.',
    );
    expect(body.startsWith(OVERRIDE_HEADING)).toBe(true);
    expect(parseOverrideComment(body)).toEqual({
      login: 'peterbono',
      reason: 'Solo maintainer, nobody else can approve',
      missing: ['design approval', 'tech approval'],
      merged: true,
    });
    expect(parseOverrideComment('LGTM')).toBeNull();
  });

  it('rewrites the comment when GitHub refuses the merge', () => {
    const body = overrideRefusedComment(overrideComment('peterbono', 'Solo maintainer, nobody else can approve', ['tech approval']), 'Required status check "CI" is expected.');
    expect(body).toMatch(/Merge refused by GitHub: Required status check "CI" is expected\. Not merged\.$/);
    expect(parseOverrideComment(body)).toMatchObject({ merged: false, missing: ['tech approval'] });
  });
});

describe('repo permissions and merge methods', () => {
  it('needs push, maintain or admin', () => {
    expect(canWrite({ push: true })).toBe(true);
    expect(canWrite({ admin: true })).toBe(true);
    expect(canWrite({ push: false })).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });

  it('lists the merge methods the repo allows, squash first', () => {
    expect(allowedMergeMethods({ allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true })).toEqual(['squash', 'merge', 'rebase']);
    expect(allowedMergeMethods({ allow_squash_merge: false, allow_merge_commit: true, allow_rebase_merge: false })).toEqual(['merge']);
    expect(allowedMergeMethods(undefined)).toEqual(['squash', 'merge', 'rebase']);
  });
});

describe('pullState', () => {
  it('reads a merged pull request as Merged, even though GitHub reports it closed', () => {
    const merged = { state: 'closed', draft: false, merged_at: '2026-10-10T09:00:00Z' };
    expect(pullState(merged)).toBe('merged');
    expect(PULL_STATE_PILL[pullState(merged)].label).toBe('Merged');
    expect(pullState({ state: 'closed', merged: true })).toBe('merged');
  });

  it('tells closed, draft and open apart', () => {
    expect(pullState({ state: 'closed', draft: false, merged_at: null })).toBe('closed');
    expect(pullState({ state: 'closed', draft: true, merged_at: null })).toBe('closed');
    expect(pullState({ state: 'open', draft: true, merged_at: null })).toBe('draft');
    expect(pullState({ state: 'open', draft: false, merged_at: null })).toBe('open');
    expect(PULL_STATE_PILL.open.label).toBe('Open');
  });

  it('counts only open and draft pull requests as open reviews', () => {
    const pulls = [
      { number: 1, state: 'open', draft: false, merged_at: null },
      { number: 2, state: 'open', draft: true, merged_at: null },
      { number: 3, state: 'closed', draft: false, merged_at: null },
      { number: 4, state: 'closed', draft: false, merged_at: '2026-10-10T09:00:00Z' },
    ];
    expect(openPulls(pulls).map((p) => p.number)).toEqual([1, 2]);
  });

  it('blocks merging a pull request that is already merged or closed', () => {
    expect(gate({ state: 'closed', merged_at: '2026-10-10T09:00:00Z' }).reasons[0]).toBe('This pull request is already merged.');
    expect(gate({ state: 'closed', merged_at: null }).reasons[0]).toBe('This pull request is closed.');
  });
});
