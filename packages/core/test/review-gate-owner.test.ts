import { describe, expect, it } from 'vitest';
import { branchVerdict, canOverride, mergeGate, overrideHolders, ownerOverridePolicy, summarizeApprovals, summarizeCi, withSuggestionApprovals, type ApprovalSummary } from '../src/review-gate';

const owners = { design: ['ann'], tech: ['theo'] };
const green = summarizeCi([{ name: 'CI', status: 'completed', conclusion: 'success' }]);
const none: ApprovalSummary = summarizeApprovals([], owners, 'theo');
const approved = (...logins: string[]) => summarizeApprovals(logins.map((l) => ({ user: { login: l }, state: 'APPROVED' })), owners, 'sam');

describe('the pull request that applies an approved suggestion is not gated twice', () => {
  it('carries the suggestion approvals when they cover its tier', () => {
    const carried = withSuggestionApprovals(none, { approvals: approved('ann', 'theo'), tier: 3 }, 3);
    expect(carried).toMatchObject({ design: true, tech: true, owner: true });
    expect(mergeGate({ tier: 3, ci: green, approvals: carried, draft: false, state: 'open' }).allowed).toBe(true);
  });

  it('carries nothing when the suggestion is not fully approved, asked for changes, or the pull request went up a tier', () => {
    expect(withSuggestionApprovals(none, { approvals: approved('ann'), tier: 3 }, 3)).toBe(none);
    const asked = summarizeApprovals([{ user: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], owners, 'sam');
    expect(withSuggestionApprovals(none, { approvals: asked, tier: 1 }, 1)).toBe(none);
    expect(withSuggestionApprovals(none, { approvals: approved('ann'), tier: 1 }, 2)).toBe(none);
    expect(withSuggestionApprovals(none, null, 1)).toBe(none);
  });

  it('a Tier 1 suggestion approved by one owner covers a Tier 1 pull request', () => {
    const carried = withSuggestionApprovals(none, { approvals: approved('ann'), tier: 1 }, 1);
    expect(mergeGate({ tier: 1, ci: green, approvals: carried, draft: false, state: 'open' }).allowed).toBe(true);
  });

  it('changes requested on the pull request itself still block', () => {
    const pr = summarizeApprovals([{ user: { login: 'ann' }, state: 'CHANGES_REQUESTED' }], owners, 'theo');
    const carried = withSuggestionApprovals(pr, { approvals: approved('ann', 'theo'), tier: 3 }, 3);
    expect(mergeGate({ tier: 3, ci: green, approvals: carried, draft: false, state: 'open' }).allowed).toBe(false);
  });
});

describe('the owner override is for owners only', () => {
  const policy = { allowed: ['ann', 'lea'], requireReason: true, minReasonLength: 20 };

  it('keeps the allowed logins that are owners', () => {
    expect(overrideHolders(policy, owners)).toEqual(['ann']);
    expect(canOverride('lea', ownerOverridePolicy(policy, owners))).toBe(false);
    expect(canOverride('ann', ownerOverridePolicy(policy, owners))).toBe(true);
  });

  it('keeps the list as it is when an owner is a team whose members are unknown, or nobody is named', () => {
    expect(overrideHolders(policy, { design: ['@acme/design'], tech: [] })).toEqual(['ann', 'lea']);
    expect(overrideHolders(policy, { design: [], tech: [] })).toEqual(['ann', 'lea']);
  });
});

describe('branchVerdict: one composition for Studio, the MCP server and the CLI', () => {
  const base = { tier: 3 as const, ci: green, owners, override: { allowed: ['ann', 'lea'], requireReason: false, minReasonLength: 0 }, state: 'open' };

  it('carries an approved suggestion, limits the override to owners, and says the status', () => {
    const v = branchVerdict({ ...base, approvals: none, suggestion: { approvals: approved('ann', 'theo'), tier: 3 }, viewer: 'ann' });
    expect(v).toMatchObject({ status: 'ready', gate: { allowed: true }, override: { allowed: ['ann'] } });
    const lea = branchVerdict({ ...base, approvals: none, viewer: 'lea' });
    expect(lea.gate).toMatchObject({ allowed: false, overridable: false });
    expect(branchVerdict({ ...base, approvals: none, viewer: 'ann' }).gate).toMatchObject({ allowed: false, overridable: true });
  });

  it('Tier 1: a plain approval by someone who is no owner does not count', () => {
    const lea = summarizeApprovals([{ user: { login: 'lea' }, state: 'APPROVED' }], owners, 'sam');
    expect(branchVerdict({ ...base, tier: 1, approvals: lea }).status).toBe('needs-approval');
    expect(branchVerdict({ ...base, tier: 1, approvals: approved('theo') }).status).toBe('ready');
  });

  it('an unread read never reads as mergeable', () => {
    expect(branchVerdict({ ...base, approvals: null })).toMatchObject({ gate: null, status: 'unknown' });
    expect(branchVerdict({ ...base, ci: null, approvals: approved('ann', 'theo') })).toMatchObject({ gate: null, status: 'unknown' });
  });
});
