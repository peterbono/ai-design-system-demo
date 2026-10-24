// Decision TV-1 (docs/BUILD-REQUESTS.md, "Token values from Studio"): a token value change, whoever opened it, needs the
// design approval only. Once it is in, the tech approval counts as given and the change ships after the checks. A
// rename or removal, unread token changes, code or a guardrail file still need the tech approval.
import { describe, expect, it } from 'vitest';
import {
  branchVerdict,
  isTokenValueChange,
  mayBeTokenValueChange,
  mergeGate,
  pendingApprovals,
  requiredApprovals,
  suggestionIsTokenValues,
  withTokenValueApprovals,
  type ApprovalSummary,
  type CiSummary,
} from '../src';

const TOKENS = [{ path: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' }];
const CHANGESET = { path: '.changeset/darker-muted.md', status: 'added' };
const PASS: CiSummary = { state: 'pass', total: 1, passed: 1, failed: [], pending: [] };
const none: ApprovalSummary = { approvers: [], changesRequested: [], design: false, tech: false };
const design: ApprovalSummary = { approvers: ['ann'], changesRequested: [], design: true, tech: false, owner: true };
const owners = { design: ['ann'], tech: ['theo'] };

describe('isTokenValueChange', () => {
  it('is a value change or an added token, with a changeset at most', () => {
    expect(isTokenValueChange({ files: [...TOKENS, CHANGESET], tokenChanges: [{ kind: 'changed' }, { kind: 'added' }] })).toBe(true);
  });

  it('is not a rename, a removal, unread changes, code, a guardrail, no token file, or an exploration', () => {
    expect(isTokenValueChange({ files: TOKENS, tokenChanges: [{ kind: 'renamed' }] })).toBe(false);
    expect(isTokenValueChange({ files: TOKENS, tokenChanges: [{ kind: 'changed' }, { kind: 'removed' }] })).toBe(false);
    expect(isTokenValueChange({ files: TOKENS, tokenChanges: null })).toBe(false);
    expect(isTokenValueChange({ files: TOKENS, tokenChanges: [] })).toBe(false);
    expect(isTokenValueChange({ files: [...TOKENS, { path: 'packages/react/src/components/Button/Button.tsx', status: 'modified' }], tokenChanges: [{ kind: 'changed' }] })).toBe(false);
    expect(isTokenValueChange({ files: [...TOKENS, { path: 'AGENTS.md', status: 'modified' }], tokenChanges: [{ kind: 'changed' }] })).toBe(false);
    expect(isTokenValueChange({ files: [CHANGESET], tokenChanges: [{ kind: 'changed' }] })).toBe(false);
    expect(isTokenValueChange({ files: TOKENS, tokenChanges: [{ kind: 'changed' }], labels: [{ name: 'exploration' }] })).toBe(false);
  });

  it('reads the token files only when the files could be one', () => {
    expect(mayBeTokenValueChange([...TOKENS, CHANGESET])).toBe(true);
    expect(mayBeTokenValueChange([CHANGESET])).toBe(false);
    expect(mayBeTokenValueChange([...TOKENS, { path: 'src/app.ts', status: 'modified' }])).toBe(false);
  });
});

describe('withTokenValueApprovals and the gate', () => {
  it('asks the design approval only, then counts the tech approval as given', () => {
    expect(requiredApprovals(3, true)).toEqual(['design']);
    expect(requiredApprovals(3)).toEqual(['design', 'tech']);
    const waiting = withTokenValueApprovals(none, true);
    expect(waiting).toMatchObject({ design: false, tech: false, valuesOnly: true });
    expect(pendingApprovals(3, waiting)).toEqual(['design']);
    const gate = mergeGate({ tier: 3, ci: PASS, approvals: waiting, draft: false, state: 'open' });
    expect(gate.reasons).toEqual(['It needs a design owner approval.']);
    expect(gate.missing).toEqual(['design approval']);
    const approved = withTokenValueApprovals(design, true);
    expect(approved).toMatchObject({ design: true, tech: true, valuesOnly: true });
    expect(mergeGate({ tier: 3, ci: PASS, approvals: approved, draft: false, state: 'open' }).allowed).toBe(true);
    // Not a value change: unchanged.
    expect(withTokenValueApprovals(design, false)).toBe(design);
  });

  it('branchVerdict: ready on the design approval alone, CI and changes requested still gate', () => {
    const v = (approvals: ApprovalSummary, ci: CiSummary = PASS) => branchVerdict({ tier: 3, ci, approvals, owners, tokenValues: true, mergeable: true });
    expect(v(none).status).toBe('needs-design');
    expect(v(design).status).toBe('ready');
    expect(v(design).gate!.allowed).toBe(true);
    expect(v(design).autoShip).toBe(false);
    expect(v(design, { state: 'fail', total: 1, passed: 0, failed: [{ name: 'test' }], pending: [] }).status).toBe('ci-failing');
    expect(v({ ...design, changesRequested: ['theo'] }).status).toBe('changes-requested');
    // The tech approval alone never covers it: the look is what it needs.
    expect(v({ approvers: ['theo'], changesRequested: [], design: false, tech: true, owner: true }).status).toBe('needs-design');
    // Without the fact, the tech approval is still asked.
    expect(branchVerdict({ tier: 3, ci: PASS, approvals: design, owners, mergeable: true }).status).toBe('needs-tech');
  });

  it('branchVerdict: autoShip once Bridge armed the merge of a design-approved value change (/api/ship)', () => {
    const armed = (approvals: ApprovalSummary, extra: Partial<Parameters<typeof branchVerdict>[0]> = {}) => branchVerdict({ tier: 3, ci: PASS, approvals, owners, tokenValues: true, autoMerge: true, mergeable: true, ...extra }).autoShip;
    expect(armed(design)).toBe(true);
    expect(armed(none)).toBe(false);
    expect(armed(design, { tokenValues: false })).toBe(false);
    expect(armed(design, { autoMerge: false })).toBe(false);
    expect(armed(design, { state: 'closed' })).toBe(false);
    expect(armed(design, { exploration: true })).toBe(false);
  });
});

describe('suggestionIsTokenValues', () => {
  const base = { kind: 'token-change' as const, docs: undefined, componentSpec: undefined };
  it('is every edit a set or an add, with a changeset at most', () => {
    expect(suggestionIsTokenValues({ ...base, tokens: { edits: [{ op: 'set', path: 'a' }, { op: 'add', path: 'b' }], changes: [] }, files: [{ path: '.changeset/x.md', beforeSha: null, afterSha: 'x' }] })).toBe(true);
    expect(suggestionIsTokenValues({ ...base, tokens: { edits: [{ op: 'rename', path: 'a', newPath: 'c' }], changes: [] } })).toBe(false);
    expect(suggestionIsTokenValues({ ...base, tokens: { edits: [{ op: 'remove', path: 'a' }], changes: [] } })).toBe(false);
    expect(suggestionIsTokenValues({ ...base, tokens: { edits: [], changes: [] } })).toBe(false);
    expect(suggestionIsTokenValues({ ...base, kind: 'brand', tokens: { edits: [{ op: 'set', path: 'a' }], changes: [] } })).toBe(false);
    expect(suggestionIsTokenValues({ ...base, tokens: { edits: [{ op: 'set', path: 'a' }], changes: [] }, files: [{ path: 'bridge.config.json', beforeSha: 'a', afterSha: 'b' }] })).toBe(false);
  });
});
