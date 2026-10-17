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
  REVIEW_STATUS_ORDER,
  reviewStatus,
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

describe('reviewStatus', () => {
  const both = summarizeApprovals(
    [
      { user: { login: 'designer' }, state: 'APPROVED', submitted_at: '2026-10-16T10:00:00Z' },
      { user: { login: 'engineer' }, state: 'APPROVED', submitted_at: '2026-10-16T11:00:00Z' },
    ],
    { design: ['designer'], tech: ['engineer'] },
    'author',
  );
  const designOnly = summarizeApprovals([{ user: { login: 'designer' }, state: 'APPROVED' }], { design: ['designer'], tech: ['engineer'] }, 'author');
  const changes = summarizeApprovals([{ user: { login: 'engineer' }, state: 'CHANGES_REQUESTED' }], { design: ['designer'], tech: ['engineer'] }, 'author');
  const none = summarizeApprovals([], { design: ['designer'], tech: ['engineer'] }, 'author');
  const base = { state: 'open', draft: false, merged_at: null, ci: green, approvals: both, tier: 3 as const, mergeable: true };
  const st = (over: Partial<Parameters<typeof reviewStatus>[0]> = {}) => reviewStatus({ ...base, ...over });

  it('reads each state from real data', () => {
    expect(st().kind).toBe('ready');
    expect(st().label).toBe('Ready to merge');
    expect(st().tone).toBe('is-pass');
    expect(st({ state: 'closed', merged_at: '2026-10-10T09:00:00Z' }).kind).toBe('merged');
    expect(st({ state: 'closed' }).kind).toBe('closed');
    expect(st({ draft: true }).kind).toBe('draft');
    expect(st({ ci: red }).kind).toBe('ci-failing');
    expect(st({ ci: running }).kind).toBe('ci-running');
    expect(st({ approvals: changes }).kind).toBe('changes-requested');
    expect(st({ approvals: none }).kind).toBe('needs-design');
    expect(st({ approvals: designOnly }).kind).toBe('needs-tech');
    expect(st({ mergeable: false }).kind).toBe('conflict');
  });

  it('never says ready while CI fails, the old "Ready" bug', () => {
    expect(st({ ci: red }).label).toBe('CI failing');
    expect(st({ ci: red }).tone).toBe('is-fail');
  });

  it('follows the merge gate priority', () => {
    expect(st({ draft: true, ci: red }).kind).toBe('draft');
    expect(st({ ci: red, approvals: changes }).kind).toBe('ci-failing');
    expect(st({ ci: running, approvals: changes }).kind).toBe('changes-requested');
    expect(st({ ci: running, approvals: none }).kind).toBe('ci-running');
    expect(st({ approvals: none, mergeable: false }).kind).toBe('needs-design');
    expect(st({ state: 'closed', merged_at: '2026-10-10T09:00:00Z', draft: true }).kind).toBe('merged');
  });

  it('treats a missing tier as Tier 3, like mergeGate', () => {
    expect(st({ tier: null, approvals: designOnly }).kind).toBe('needs-tech');
  });

  it('Tier 1 and 2 need one approval only', () => {
    expect(st({ tier: 1, approvals: designOnly }).kind).toBe('ready');
    expect(st({ tier: 2, approvals: none }).kind).toBe('needs-approval');
  });

  it('without configured owners, two approvers stand in for design and tech', () => {
    const one = summarizeApprovals([{ user: { login: 'a' }, state: 'APPROVED' }], { design: [], tech: [] }, 'author');
    const two = summarizeApprovals(
      [
        { user: { login: 'a' }, state: 'APPROVED' },
        { user: { login: 'b' }, state: 'APPROVED' },
      ],
      { design: [], tech: [] },
      'author',
    );
    expect(st({ approvals: one }).kind).toBe('needs-tech');
    expect(st({ approvals: two }).kind).toBe('ready');
  });

  it('unknown CI or reviews never read as ready', () => {
    expect(st({ ci: null }).kind).toBe('unknown');
    expect(st({ approvals: null }).kind).toBe('unknown');
    expect(st({ ci: null }).label).toBe('Status unknown');
    // A known blocker still shows while the rest loads.
    expect(st({ ci: red, approvals: null }).kind).toBe('ci-failing');
  });

  it('is ready exactly when mergeGate allows the merge', () => {
    const cases: Partial<Parameters<typeof reviewStatus>[0]>[] = [
      {},
      { ci: red },
      { ci: running },
      { ci: summarizeCi([]) },
      { draft: true },
      { approvals: none },
      { approvals: designOnly },
      { approvals: changes },
      { tier: 1, approvals: designOnly },
      { tier: 2, approvals: none },
      { tier: null },
      { mergeable: false },
      { mergeable: null },
      { state: 'closed' },
    ];
    for (const c of cases) {
      const input = { ...base, ...c };
      const allowed = mergeGate({ tier: input.tier, ci: input.ci!, approvals: input.approvals!, draft: input.draft, mergeable: input.mergeable, state: input.state, merged_at: input.merged_at }).allowed;
      expect(reviewStatus(input).kind === 'ready').toBe(allowed);
    }
  });

  it('sorts what blocks first, then what waits for approval, then ready, drafts last', () => {
    expect(REVIEW_STATUS_ORDER['ci-failing']).toBeLessThan(REVIEW_STATUS_ORDER.ready);
    expect(REVIEW_STATUS_ORDER['needs-approval']).toBeLessThan(REVIEW_STATUS_ORDER.ready);
    expect(REVIEW_STATUS_ORDER['changes-requested']).toBeLessThan(REVIEW_STATUS_ORDER['needs-design']);
    expect(REVIEW_STATUS_ORDER.draft).toBeGreaterThan(REVIEW_STATUS_ORDER['ci-running']);
  });
});
