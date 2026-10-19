import { describe, expect, it } from 'vitest';
import type { TokenSet } from '@bridge-ds/core';
import {
  changeLifecycle,
  designApprovalIn,
  draftFromTokenSets,
  emptyFilterLine,
  failingByName,
  GONE_SENTENCE,
  LIFECYCLE,
  lifecycleSentence,
  lifecycleTone,
  needsClosed,
  reopenEligibility,
  restartLine,
  rowLifecycle,
  showsUnderStatus,
  STATUS_FILTERS,
  statusAction,
  statusFilterParam,
  statusOpener,
  byLifecycle,
  todoBadge,
  waitingForCode,
  waitingSentence,
  type WaitingInput,
} from './change-status';
import { classifyCheck } from './check-explain';
import { pullState, reviewStatus, summarizeApprovals, summarizeCi } from './review-rules';

const owners = { design: ['dana'], tech: ['theo'] };
const approved = (logins: string[]) => logins.map((l, i) => ({ user: { login: l }, state: 'APPROVED', submitted_at: `2026-10-0${i + 1}T10:00:00Z` }));
const run = (name: string, conclusion: string | null, status = 'completed') => ({ name, status, conclusion });

const base: WaitingInput = { state: 'open', nature: 'design', designApproved: true, changesRequested: 0, failing: [{ kind: 'developer' }] };

describe('designApprovalIn', () => {
  it('reads the design owner approval for Tier 2 and 3, any approval for Tier 1, nothing when unread', () => {
    const design = summarizeApprovals(approved(['dana']), owners, 'ann');
    const tech = summarizeApprovals(approved(['theo']), owners, 'ann');
    expect(designApprovalIn(3, design)).toBe(true);
    expect(designApprovalIn(2, tech)).toBe(false);
    expect(designApprovalIn(null, design)).toBe(true);
    expect(designApprovalIn(1, tech)).toBe(true);
    expect(designApprovalIn(1, summarizeApprovals([], owners, 'ann'))).toBe(false);
    expect(designApprovalIn(3, null)).toBe(false);
  });
});

describe('waitingForCode', () => {
  it('holds for approved design work whose failing checks are all developer checks', () => {
    expect(waitingForCode(base)).toBe(true);
  });

  it('never holds without every signal', () => {
    expect(waitingForCode({ ...base, state: 'draft' })).toBe(false);
    expect(waitingForCode({ ...base, state: 'merged' })).toBe(false);
    expect(waitingForCode({ ...base, exploration: true })).toBe(false);
    expect(waitingForCode({ ...base, nature: 'developer' })).toBe(false);
    expect(waitingForCode({ ...base, designApproved: false })).toBe(false);
    expect(waitingForCode({ ...base, changesRequested: 1 })).toBe(false);
    expect(waitingForCode({ ...base, failing: [] })).toBe(false);
    expect(waitingForCode({ ...base, failing: [{ kind: 'developer' }, { kind: 'design' }] })).toBe(false);
  });

  it('classifies failing checks by name the way the detail does without job steps', () => {
    expect(failingByName(['Unit tests', 'Typecheck']).map((c) => c.kind)).toEqual(['developer', 'developer']);
    expect(failingByName(['Contrast checks']).map((c) => c.kind)).toEqual(['design']);
    expect(failingByName(undefined)).toEqual([]);
    // Same answer as the detail when the job step is known and says the same thing.
    expect(classifyCheck({ name: 'CI', step: 'Run unit tests' }).kind).toBe('developer');
  });
});

describe('changeLifecycle and rowLifecycle', () => {
  it('maps the pull request state, then the waiting rule', () => {
    expect(changeLifecycle({ state: 'merged', waiting: false })).toBe('shipped');
    expect(changeLifecycle({ state: 'closed', waiting: true })).toBe('closed');
    expect(changeLifecycle({ state: 'draft', waiting: true })).toBe('draft');
    expect(changeLifecycle({ state: 'open', waiting: true })).toBe('waiting');
    expect(changeLifecycle({ state: 'open', waiting: false })).toBe('ready');
  });

  it('derives a row from real PR, review and check shapes', () => {
    const pull = { state: 'open', draft: false, merged_at: null };
    const ci = summarizeCi([run('Unit tests', 'failure'), run('Contrast checks', 'success')]);
    const approvals = summarizeApprovals(approved(['dana']), owners, 'ann');
    const kind = reviewStatus({ ...pull, ci, approvals, tier: 3 }).kind;
    expect(kind).toBe('ci-failing');
    const st = { kind, nature: 'design' as const, tier: 3 as const, design: approvals.design, approvers: approvals.approvers, changesRequested: approvals.changesRequested, failingChecks: ci.failed.map((f) => f.name) };
    expect(rowLifecycle(pull, st)).toBe('waiting');
    // Same failure, no design approval yet: still in review.
    const none = summarizeApprovals([], owners, 'ann');
    expect(rowLifecycle(pull, { ...st, design: none.design, approvers: none.approvers })).toBe('ready');
    // A design rule fails: the author's to fix, not code.
    expect(rowLifecycle(pull, { ...st, failingChecks: ['Contrast checks'] })).toBe('ready');
    // Status not read yet: open and not a draft reads Ready for review.
    expect(rowLifecycle(pull, { kind: null, nature: 'design', tier: null })).toBe('ready');
    expect(rowLifecycle({ ...pull, draft: true }, { kind: null, nature: 'design', tier: null })).toBe('draft');
    expect(rowLifecycle({ state: 'closed', merged_at: '2026-10-01T00:00:00Z' }, { kind: 'merged', nature: 'design', tier: 3 })).toBe('shipped');
    expect(rowLifecycle({ state: 'closed', merged_at: null }, { kind: 'closed', nature: 'design', tier: 3 })).toBe('closed');
    expect(pullState({ state: 'closed', merged_at: null })).toBe('closed');
  });

  it('tones the lifecycle state alone: Ready for review is never red because a check fails', () => {
    expect(lifecycleTone('ready')).toBe('info');
    expect(lifecycleTone('waiting')).toBe('neutral');
    expect(lifecycleTone('shipped')).toBe('neutral');
    expect(lifecycleTone('draft')).toBe('neutral');
  });
});

describe('waitingSentence', () => {
  it('names the tech owners from the config, else the role', () => {
    expect(waitingSentence({ failing: 2, techOwners: '@theo' })).toBe('Design is approved. Waiting for the tech owner (@theo) to fix 2 developer tests.');
    expect(waitingSentence({ failing: 1, oldValue: true, techOwners: null })).toBe('Design is approved. Waiting for a developer to update 1 developer test.');
    expect(waitingSentence({ failing: 1, techOwners: '@theo', viewerIsTech: true })).toBe('Design is approved. Your turn as tech owner: fix 1 developer test.');
  });
});

describe('reopenEligibility', () => {
  const closed = { state: 'closed' as const, viewer: 'ann', author: 'ann', owners: ['dana', 'theo'], canWrite: false, branch: 'exists' as const };
  it('lets the author or an owner reopen while the branch exists', () => {
    expect(reopenEligibility(closed)).toEqual({ kind: 'reopen' });
    expect(reopenEligibility({ ...closed, viewer: '@Dana', canWrite: true })).toEqual({ kind: 'reopen' });
  });
  it('says the work is gone when the branch was removed', () => {
    expect(reopenEligibility({ ...closed, branch: 'gone' })).toEqual({ kind: 'gone' });
  });
  it('offers nothing to others, to owners without write access, before the branch is read, or when not closed', () => {
    expect(reopenEligibility({ ...closed, viewer: 'zed', canWrite: true })).toEqual({ kind: 'none' });
    expect(reopenEligibility({ ...closed, viewer: 'dana', canWrite: false })).toEqual({ kind: 'none' });
    expect(reopenEligibility({ ...closed, branch: 'unknown' })).toEqual({ kind: 'none' });
    expect(reopenEligibility({ ...closed, viewer: null })).toEqual({ kind: 'none' });
    expect(reopenEligibility({ ...closed, state: 'merged' })).toEqual({ kind: 'none' });
    expect(reopenEligibility({ ...closed, state: 'open' })).toEqual({ kind: 'none' });
  });
});

describe('statusAction and lifecycleSentence', () => {
  const x = { isAuthor: true, canWrite: true, exploration: false, reopen: { kind: 'none' } as const, tokenEdits: true };
  it('gives one action per state', () => {
    expect(statusAction({ ...x, lifecycle: 'draft' })).toBe('mark-ready');
    expect(statusAction({ ...x, lifecycle: 'draft', isAuthor: false })).toBe(null);
    expect(statusAction({ ...x, lifecycle: 'draft', exploration: true })).toBe(null);
    expect(statusAction({ ...x, lifecycle: 'ready' })).toBe(null);
    expect(statusAction({ ...x, lifecycle: 'waiting' })).toBe(null);
    expect(statusAction({ ...x, lifecycle: 'shipped' })).toBe(null);
    expect(statusAction({ ...x, lifecycle: 'closed', reopen: { kind: 'reopen' } })).toBe('reopen');
    expect(statusAction({ ...x, lifecycle: 'closed', reopen: { kind: 'gone' } })).toBe('restart');
    expect(statusAction({ ...x, lifecycle: 'closed', reopen: { kind: 'gone' }, tokenEdits: false })).toBe(null);
  });
  it('says the state in plain words', () => {
    expect(lifecycleSentence({ lifecycle: 'draft', isAuthor: false, author: 'ann' })).toBe('Waiting for @ann to mark it ready for review.');
    expect(lifecycleSentence({ lifecycle: 'shipped', isAuthor: false, author: 'ann', mergedAt: '2026-10-03T12:00:00Z' })).toBe('Shipped into the library on Oct 3, 2026.');
    expect(lifecycleSentence({ lifecycle: 'closed', isAuthor: true, author: 'ann', reopen: { kind: 'gone' } })).toBe(GONE_SENTENCE);
    expect(lifecycleSentence({ lifecycle: 'closed', isAuthor: true, author: 'ann' })).toBe('Closed without shipping.');
    expect(lifecycleSentence({ lifecycle: 'ready', isAuthor: true, author: 'ann' })).toBe(null);
  });
});

describe('statusOpener', () => {
  it('never sends a designer to a change that waits for code', () => {
    const rows = [
      { number: 43, title: 'A', kind: 'ci-failing' as const, lifecycle: 'waiting' as const, updated_at: '2026-10-16' },
      { number: 42, title: 'B', kind: 'needs-design' as const, lifecycle: 'ready' as const, updated_at: '2026-10-17' },
    ];
    expect(statusOpener(rows)).toEqual({ sentence: '2 changes in review. #42 waits for a design approval. 1 waits for code.', action: { label: 'Review #42', pr: 42 } });
    expect(statusOpener([rows[0]!])).toEqual({ sentence: '1 change in review. It is approved and waits for code.', action: null });
    expect(statusOpener([rows[1]!]).sentence).toBe('1 change in review. #42 waits for a design approval.');
    // Drafts are counted apart: they are not in review.
    const draft = { number: 41, title: 'C', kind: 'draft' as const, lifecycle: 'draft' as const, updated_at: '2026-10-18' };
    expect(statusOpener([...rows, draft]).sentence).toBe('2 changes in review and 1 draft. #42 waits for a design approval. 1 waits for code.');
    expect(statusOpener([draft])).toEqual({ sentence: '1 draft, nothing in review yet.', action: null });
  });

  it("points at the viewer's turn first, never at a change only a developer can move", () => {
    const blocked = { number: 50, title: 'D', kind: 'ci-failing' as const, lifecycle: 'ready' as const, updated_at: '2026-10-18', developer: true };
    const mine = { number: 42, title: 'B', kind: 'needs-design' as const, lifecycle: 'ready' as const, updated_at: '2026-10-17', yourTurn: true };
    const waitingCode = { number: 43, title: 'A', kind: 'ci-failing' as const, lifecycle: 'waiting' as const, updated_at: '2026-10-16' };
    expect(statusOpener([blocked, mine, waitingCode])).toEqual({ sentence: '3 changes in review. Your turn on #42: it waits for a design approval. 1 waits for code.', action: { label: 'Review #42', pr: 42 } });
    expect(statusOpener([blocked, waitingCode])).toEqual({ sentence: '2 changes in review. #50 waits on a developer to fix its tests. 1 waits for code.', action: null });
  });

  it('lists work someone can move first, then waiting for code, then drafts', () => {
    const l = (lifecycle: 'ready' | 'waiting' | 'draft', n: number) => ({ n, lifecycle });
    expect(byLifecycle([l('waiting', 1), l('draft', 2), l('ready', 3), l('ready', 4)]).map((r) => r.n)).toEqual([3, 4, 1, 2]);
  });
});

describe('todoBadge', () => {
  it('says the lifecycle in the status line words and tone, whatever the row asks', () => {
    expect(todoBadge('ready')).toEqual({ label: 'Ready for review', tone: 'info' });
    expect(todoBadge('draft')).toEqual({ label: 'Draft', tone: 'neutral' });
    expect(todoBadge('waiting')).toEqual({ label: 'Approved, waiting for code', tone: 'neutral' });
  });
});

describe('status filter', () => {
  it('names each state exactly as the status model does', () => {
    expect(STATUS_FILTERS.map((f) => f.label)).toEqual(['All open', 'Draft', 'Ready for review', 'Approved, waiting for code', 'Shipped', 'Closed']);
    expect(STATUS_FILTERS.slice(1).map((f) => f.label)).toEqual(Object.values(LIFECYCLE).map((l) => l.label));
  });
  it('reads the address, Open by default', () => {
    expect(statusFilterParam('?status=waiting')).toBe('waiting');
    expect(statusFilterParam('?status=nope')).toBe('open');
    expect(statusFilterParam('')).toBe('open');
  });
  it('shows open work under Open and one state under each other filter', () => {
    expect(showsUnderStatus('open', 'draft')).toBe(true);
    expect(showsUnderStatus('open', 'waiting')).toBe(true);
    expect(showsUnderStatus('open', 'shipped')).toBe(false);
    expect(showsUnderStatus('closed', 'closed')).toBe(true);
    expect(showsUnderStatus('ready', 'waiting')).toBe(false);
    expect(needsClosed('shipped')).toBe(true);
    expect(needsClosed('draft')).toBe(false);
    expect(emptyFilterLine('waiting')).toBe('No approved change waits for code.');
  });
});

describe('draftFromTokenSets', () => {
  const tok = (path: string, values: Record<string, unknown>) => ({ id: `id:${path}`, path, type: 'color', tier: 'semantic', values, description: undefined, scopes: undefined, files: {} });
  const set = (tokens: ReturnType<typeof tok>[], overrides: { brand: string; theme: string; path: string; value: unknown }[] = []) =>
    ({ byPath: new Map(tokens.map((t) => [t.path, t])), overrides }) as unknown as TokenSet;

  it('carries value edits per mode and counts what it cannot carry', () => {
    const before = set([tok('color.text.muted', { light: '{palette.neutral.600}', dark: '{palette.neutral.400}' }), tok('color.gone', { light: '{x}' })]);
    const after = set([tok('color.text.muted', { light: '{palette.neutral.700}', dark: '{palette.neutral.400}' }), tok('color.new', { light: '{y}' })], [{ brand: 'ocean', theme: 'light', path: 'color.text.muted', value: '{z}' }]);
    const r = draftFromTokenSets(before, after);
    expect(r.draft.edits).toEqual([{ kind: 'value', id: 'id:color.text.muted', path: 'color.text.muted', mode: 'light', before: '{palette.neutral.600}', after: '{palette.neutral.700}' }]);
    expect(r).toMatchObject({ carried: 1, skipped: 3 });
  });

  it('says what Start again did, or why it could not', () => {
    expect(restartLine({ carried: 2, skipped: 0, draftBusy: false })).toEqual({ ok: true, text: '2 token edits copied into your draft. Opening Tokens to send it for review.' });
    expect(restartLine({ carried: 1, skipped: 1, draftBusy: false }).text).toContain('1 other edit (new, removed or brand-only tokens) could not be carried over.');
    expect(restartLine({ carried: 2, skipped: 0, draftBusy: true }).ok).toBe(false);
    expect(restartLine({ carried: 0, skipped: 3, draftBusy: false }).ok).toBe(false);
  });
});
