import { describe, expect, it } from 'vitest';
import {
  filterByTier,
  tierParam,
  asOf,
  byUrgency,
  cachedOpenCount,
  currentPackageName,
  approvalRows,
  detailSentence,
  listSource,
  needFromDetail,
  needFromStatus,
  pendingApprovals,
  requiredApprovals,
  whoActs,
  openerFor,
  primaryAction,
  readSnapshot,
  STATUS_GROUP,
  statusTone,
  tierLabel,
  undoSentence,
  writeSnapshot,
  type CachedPull,
  type StorageLike,
} from './changes';
import { mergeGate, REVIEW_STATUS, summarizeCi, type ApprovalSummary, type ReviewStatusKind } from './review-rules';

const KINDS = Object.keys(REVIEW_STATUS) as ReviewStatusKind[];

describe('status colors', () => {
  it('maps every status to one of four tones: red blocked, violet waiting, green ready, grey the rest', () => {
    expect(statusTone('ci-failing')).toBe('danger');
    expect(statusTone('changes-requested')).toBe('danger');
    expect(statusTone('conflict')).toBe('danger');
    expect(statusTone('needs-design')).toBe('info');
    expect(statusTone('needs-tech')).toBe('info');
    expect(statusTone('needs-approval')).toBe('info');
    expect(statusTone('ready')).toBe('success');
    for (const k of ['draft', 'unknown', 'ci-running', 'merged', 'closed'] as const) expect(statusTone(k), k).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
  });

  it('keeps the chip tones of review-rules in step with the groups', () => {
    for (const k of KINDS) expect(REVIEW_STATUS[k].tone, k).toBe(statusTone(k));
    expect(new Set(Object.values(STATUS_GROUP))).toEqual(new Set(['blocked', 'waiting', 'ready', 'neutral']));
  });

  it('labels tiers in plain words, with no color', () => {
    expect(tierLabel(3)).toBe('Tier 3');
    expect(tierLabel(null)).toBe('Tier not set');
  });
});

describe('urgency', () => {
  const rows = [
    { number: 1, kind: 'ready' as const, updated_at: '2026-10-16T10:00:00Z' },
    { number: 2, kind: 'needs-design' as const, updated_at: '2026-10-16T09:00:00Z' },
    { number: 3, kind: 'ci-failing' as const, updated_at: '2026-10-15T09:00:00Z' },
    { number: 4, kind: 'draft' as const, updated_at: '2026-10-17T09:00:00Z' },
    { number: 5, kind: 'ci-running' as const, updated_at: '2026-10-17T09:00:00Z' },
    { number: 6, kind: null, updated_at: '2026-10-17T09:00:00Z' },
  ];

  it('puts blocked first, then waiting for approval, then ready, then running and unknown, drafts last', () => {
    expect(byUrgency(rows).map((r) => r.number)).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it('breaks ties by the most recent update', () => {
    const tie = [
      { number: 7, kind: 'needs-approval' as const, updated_at: '2026-10-10T00:00:00Z' },
      { number: 8, kind: 'needs-design' as const, updated_at: '2026-10-12T00:00:00Z' },
    ];
    expect(byUrgency(tie).map((r) => r.number)).toEqual([8, 7]);
  });

  it('writes the opener about the most urgent change, with one action', () => {
    expect(openerFor(rows.map((r) => ({ ...r, title: `PR ${r.number}` })))).toEqual({
      sentence: '6 changes in review. #3 is blocked by failing checks.',
      action: { label: 'Review #3', pr: 3 },
    });
    expect(openerFor([{ number: 2, kind: 'needs-design', title: 'x' }]).sentence).toBe('1 change in review. #2 waits for a design approval.');
    expect(openerFor([{ number: 1, kind: 'ready', title: 'x' }]).sentence).toBe('1 change in review. #1 is ready to add to the library.');
    expect(openerFor([]).action).toBeNull();
  });

  it("points at the most urgent change where it is the viewer's turn, before a more urgent one", () => {
    const opener = openerFor([
      { number: 3, kind: 'ci-failing', title: 'x', developer: true, updated_at: '2026-10-18T00:00:00Z' },
      { number: 2, kind: 'needs-tech', title: 'x', updated_at: '2026-10-17T00:00:00Z' },
      { number: 1, kind: 'ready', title: 'x', yourTurn: true },
      { number: 7, kind: 'needs-design', title: 'x', yourTurn: true, updated_at: '2026-10-16T00:00:00Z' },
    ]);
    expect(opener).toEqual({ sentence: '4 changes in review. Your turn on #7: it waits for a design approval.', action: { label: 'Review #7', pr: 7 } });
  });

  it('says a change waits on a developer, with no button, when nothing else is the viewer turn', () => {
    const dev = { number: 3, kind: 'ci-failing' as const, title: 'x', developer: true, updated_at: '2026-10-18T00:00:00Z' };
    expect(openerFor([dev, { number: 2, kind: 'needs-tech', title: 'x' }])).toEqual({ sentence: '2 changes in review. #3 waits on a developer to fix its tests.', action: null });
    // The most urgent change is not a developer's: it is named with its button, as before.
    expect(openerFor([{ ...dev, developer: false }, { number: 2, kind: 'needs-tech', title: 'x' }]).action).toEqual({ label: 'Review #3', pr: 3 });
  });
});

const approvals = (a: Partial<ApprovalSummary> = {}): ApprovalSummary => ({ approvers: [], changesRequested: [], design: false, tech: false, ...a });

describe('pull request opener', () => {
  const red = summarizeCi([
    { name: 'Guardrails', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/run/1' },
    { name: 'Build', status: 'completed', conclusion: 'success' },
  ]);
  const green = summarizeCi([{ name: 'Build', status: 'completed', conclusion: 'success' }]);

  it('says what blocks it, then what it needs after that', () => {
    const gate = mergeGate({ tier: 1, ci: red, approvals: approvals(), draft: false, state: 'open' });
    expect(detailSentence({ state: 'open', ci: red, gate, changesRequestedBy: [] })).toBe('Blocked: the Guardrails test fails. After that it needs 1 approval.');
    const t3 = mergeGate({ tier: 3, ci: green, approvals: approvals(), draft: false, state: 'open' });
    expect(detailSentence({ state: 'open', ci: green, gate: t3, changesRequestedBy: [] })).toBe('Waiting for a design and a tech approval. Tests pass.');
    const ok = mergeGate({ tier: 1, ci: green, approvals: approvals({ approvers: ['a'] }), draft: false, state: 'open' });
    expect(detailSentence({ state: 'open', ci: green, gate: ok, changesRequestedBy: [] })).toMatch(/^Ready to add to the library/);
  });

  it('picks one primary: the failing run, connect, approve or merge', () => {
    const gate = mergeGate({ tier: 1, ci: red, approvals: approvals(), draft: false, state: 'open' });
    expect(primaryAction({ state: 'open', ci: red, gate, connected: false, canWrite: false })).toEqual({ kind: 'open-run', label: 'Open failing test', url: 'https://github.com/run/1' });
    const waiting = mergeGate({ tier: 1, ci: green, approvals: approvals(), draft: false, state: 'open' });
    expect(primaryAction({ state: 'open', ci: green, gate: waiting, connected: false, canWrite: false })).toEqual({ kind: 'connect', label: 'Connect GitHub to review' });
    expect(primaryAction({ state: 'open', ci: green, gate: waiting, connected: false, canWrite: false, signIn: true })).toEqual({ kind: 'connect', label: 'Sign in to review' });
    expect(primaryAction({ state: 'open', ci: green, gate: waiting, connected: true, canWrite: true }).kind).toBe('approve');
    expect(primaryAction({ state: 'open', ci: green, gate: waiting, connected: true, canWrite: true, isAuthor: true }).kind).toBe('github');
    const ready = mergeGate({ tier: 1, ci: green, approvals: approvals({ approvers: ['a'] }), draft: false, state: 'open' });
    expect(primaryAction({ state: 'open', ci: green, gate: ready, connected: true, canWrite: true }).kind).toBe('merge');
    expect(primaryAction({ state: 'open', ci: green, gate: ready, connected: true, canWrite: false }).kind).toBe('github');
  });

  it('shows changesets under the current package scope', () => {
    // Old scopes spelled in two parts: the repo guardrail (scripts/rename-scope.mjs) forbids them as literals.
    const old = (scope: string, pkg: string) => `@${scope}/${pkg}`;
    expect(currentPackageName(old('demo-ds', 'react'))).toBe('@bridge-ds/react');
    expect(currentPackageName(old('bridge', 'core'))).toBe('@bridge-ds/core');
    expect(currentPackageName('@bridge-ds/tokens')).toBe('@bridge-ds/tokens');
  });
});

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('cached list fallback', () => {
  const pull: CachedPull = { number: 3, title: 'feat(card): lift', updated_at: '2026-10-16T10:00:00Z', tier: 2, kind: 'ci-failing', head: { ref: 'agent/x', sha: 'abc' }, user: { login: 'p' } };

  it('round-trips the last list and its open count', () => {
    const s = memory();
    writeSnapshot(s, 'o/r', [pull], new Date('2026-10-17T08:00:00Z'));
    expect(readSnapshot(s, 'o/r')).toEqual({ at: '2026-10-17T08:00:00.000Z', pulls: [pull] });
    expect(readSnapshot(s, 'other/repo')).toBeNull();
    expect(cachedOpenCount(s)).toBe(1);
  });

  it('survives broken or missing storage', () => {
    const s = memory();
    s.data.set('bridge.changes.list:o/r', '{nope');
    s.data.set('bridge.reviews.open', '"x"');
    expect(readSnapshot(s, 'o/r')).toBeNull();
    expect(cachedOpenCount(s)).toBeNull();
    expect(readSnapshot(null, 'o/r')).toBeNull();
    expect(() => writeSnapshot({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'o/r', [pull], new Date())).not.toThrow();
  });

  it('prefers live data, then the request cache, then the snapshot, else says unavailable', () => {
    const snap = { at: '2026-10-17T08:00:00Z', pulls: [pull] };
    expect(listSource({ pulls: [1] }, snap)).toEqual({ kind: 'live', pulls: [1] });
    expect(listSource({ pulls: [1], staleAt: '2026-10-17T07:00:00Z' }, snap)).toEqual({ kind: 'stale', pulls: [1], at: '2026-10-17T07:00:00Z' });
    expect(listSource(null, snap)).toEqual({ kind: 'cached', pulls: [pull], at: snap.at });
    expect(listSource(null, null)).toEqual({ kind: 'unavailable' });
  });

  it('labels the cached list with its time', () => {
    const now = new Date('2026-10-17T15:00:00');
    expect(asOf(new Date('2026-10-17T14:05:00').toISOString(), now)).toBe('as of 14:05');
    expect(asOf(new Date('2026-10-16T09:30:00').toISOString(), now)).toBe('as of Oct 16, 09:30');
  });
});

describe('undo sentence', () => {
  const change = { path: 'color.text.muted', kind: 'changed' as const, tier: 'semantic', context: 'light', before: { alias: 'palette.neutral.600', css: '#5b6672', hex: '#5b6672' }, after: { alias: 'palette.neutral.700', css: '#495562', hex: '#495562' } };
  const pair = (before: number, after: number) => ({ fg: 'a', bg: 'b', where: 'Bridge light', before, after, min: 4.5, fgHexAfter: '#000', bgHexAfter: '#fff' });

  it('says what it restores and how contrast moves', () => {
    expect(undoSentence({ changes: [change], contrast: [pair(4.6, 6), pair(5, 6.6)] })).toBe('Restores color.text.muted to {palette.neutral.700} in Light. 2 contrast pairs improve, none fail.');
    expect(undoSentence({ changes: [change, { ...change, path: 'color.text.subtle' }], contrast: [pair(5, 4)] })).toBe('Restores 2 token values. 1 contrast pair gets lower, 1 fails.');
    expect(undoSentence({ changes: [change], contrast: [] })).toBe('Restores color.text.muted to {palette.neutral.700} in Light. No checked contrast pair moves.');
  });
});

describe('tier filter', () => {
  it('reads ?tier=1|2|3 and ignores anything else', () => {
    expect(tierParam('?tier=2')).toBe(2);
    expect(tierParam('?pr=4&tier=3')).toBe(3);
    expect(tierParam('?tier=4')).toBeNull();
    expect(tierParam('')).toBeNull();
  });

  it('keeps rows at that tier only, or all rows without a filter', () => {
    const rows = [{ n: 1, tier: 1 as const }, { n: 2, tier: 3 as const }, { n: 3, tier: null }];
    expect(filterByTier(rows, 3).map((r) => r.n)).toEqual([2]);
    expect(filterByTier(rows, null)).toHaveLength(3);
  });
});

describe('who acts now', () => {
  const owners = { design: ['dana'], tech: ['theo'] };
  const red = summarizeCi([
    { name: 'Guardrails', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/run/1' },
    { name: 'Build', status: 'completed', conclusion: 'failure' },
  ]);
  const green = summarizeCi([{ name: 'Build', status: 'completed', conclusion: 'success' }]);
  const running = summarizeCi([{ name: 'Build', status: 'in_progress', conclusion: null }]);
  const detail = (o: { tier?: 1 | 2 | 3; ci?: typeof green; a?: Partial<ApprovalSummary>; state?: 'open' | 'draft' | 'merged' | 'closed'; mergeable?: boolean; exploration?: boolean }) => {
    const a = approvals(o.a);
    const gate = mergeGate({ tier: o.tier ?? 3, ci: o.ci ?? green, approvals: a, draft: o.state === 'draft', mergeable: o.mergeable, state: o.state === 'merged' || o.state === 'closed' ? 'closed' : 'open', merged_at: o.state === 'merged' ? '2026-10-01' : null });
    return needFromDetail({ state: o.state ?? 'open', ci: o.ci ?? green, gate, changesRequestedBy: a.changesRequested, exploration: o.exploration });
  };

  it('names the design owner first when a Tier 3 change waits for both approvals', () => {
    const w = whoActs(detail({}), { owners, author: 'ann' });
    expect(w.sentence).toBe('Waiting for the design owner (@dana) and the tech owner (@theo) to approve.');
    expect(w).toMatchObject({ who: 'design', yourTurn: false, action: 'approve-design', short: 'Design owner to approve' });
    const one = whoActs(detail({ a: { approvers: ['dana'], design: true } }), { owners, author: 'ann', approvers: ['dana'] });
    expect(one.sentence).toBe('Waiting for the tech owner (@theo) to approve.');
  });

  it('says one owner holding both roles once', () => {
    const w = whoActs(detail({}), { owners: { design: ['pat'], tech: ['pat'] }, author: 'ann' });
    expect(w.sentence).toBe('Waiting for the design and tech owners (@pat) to approve.');
  });

  it('turns to the viewer with "Your turn" and the action they hold', () => {
    expect(whoActs(detail({}), { owners, author: 'ann', viewer: 'dana' })).toMatchObject({ yourTurn: true, who: 'you', action: 'approve-design', sentence: 'Your turn: approve the design.', short: 'Your turn: approve design' });
    expect(whoActs(detail({}), { owners, author: 'ann', viewer: 'THEO' })).toMatchObject({ yourTurn: true, action: 'approve-tech', sentence: 'Your turn: approve the tech side.' });
    // Someone outside the roles is not asked.
    expect(whoActs(detail({}), { owners, author: 'ann', viewer: 'zoe' }).yourTurn).toBe(false);
  });

  it('puts failing checks before anything else, a developer on them when the viewer made it', () => {
    expect(whoActs(detail({ ci: red }), { owners, author: 'ann', viewer: 'dana' }).sentence).toBe('Waiting for @ann to fix 2 failing checks.');
    expect(whoActs(detail({ ci: red }), { owners, author: 'ann', viewer: 'ann' })).toMatchObject({ yourTurn: false, action: 'fix-checks', sentence: 'Blocked: checks fail. A developer is on it.' });
    expect(whoActs(detail({ a: { changesRequested: ['dana'] } }), { owners, author: 'ann' }).sentence).toBe('Waiting for @ann to address the changes @dana requested.');
    expect(whoActs(detail({ state: 'draft' }), { owners, author: 'ann' }).sentence).toBe('Waiting for @ann to send this draft for review.');
    expect(whoActs(detail({ mergeable: false, a: { approvers: ['dana', 'theo'], design: true, tech: true } }), { owners, author: 'ann' }).action).toBe('resolve-conflict');
    expect(whoActs(detail({ state: 'draft', exploration: true }), { owners, author: 'ann' }).action).toBe('promote');
  });

  it('an approved change for a viewer who may not ship: ready, naming who merges, never "open the checks"', () => {
    const a = approvals({ approvers: ['dana'], design: true });
    const gate = mergeGate({ tier: 1, ci: green, approvals: a, draft: false, mergeable: true, state: 'open', viewer: 'dana', ship: { logins: ['theo'], groups: ['tech'] } });
    expect(gate.allowed).toBe(false);
    const need = needFromDetail({ state: 'open', ci: green, gate, changesRequestedBy: [], mergeable: true });
    expect(need).toEqual({ kind: 'ready' });
    expect(whoActs(need, { owners, author: 'ann', viewer: 'dana', shippers: ['theo'], canMerge: false }).sentence).toBe('Ready to add to the library: @theo can add it.');
  });

  it('names the missing approval while GitHub computes whether it fits, and checks the merge only once approved', () => {
    const a = approvals();
    const gate = mergeGate({ tier: 3, ci: green, approvals: a, draft: false, mergeable: null, state: 'open' });
    const need = needFromDetail({ state: 'open', ci: green, gate, changesRequestedBy: [], mergeable: null });
    // The same as the list chip (core reviewStatusKind): a missing approval is missing either way.
    expect(need).toEqual({ kind: 'approve', roles: ['design', 'tech'] });
    const both = approvals({ approvers: ['dana', 'theo'], design: true, tech: true });
    const approved = mergeGate({ tier: 3, ci: green, approvals: both, draft: false, mergeable: null, state: 'open' });
    const checking = needFromDetail({ state: 'open', ci: green, gate: approved, changesRequestedBy: [], mergeable: null });
    expect(checking.kind).toBe('checking-merge');
    expect(whoActs(checking, { owners, author: 'ann' }).sentence).toBe('Checking that it fits the library.');
    // A known conflict wins, in the detail as in the list.
    const conflict = mergeGate({ tier: 3, ci: green, approvals: a, draft: false, mergeable: false, state: 'open' });
    expect(needFromDetail({ state: 'open', ci: green, gate: conflict, changesRequestedBy: [], mergeable: false }).kind).toBe('resolve-conflict');
  });

  it('waits for running checks, then names who approves', () => {
    expect(whoActs(detail({ ci: running }), { owners, author: 'ann' }).sentence).toBe('Tests are still running. Then the design owner (@dana) approves.');
  });

  it('says who ships a ready change, and gives the viewer the merge when they can', () => {
    const ready = detail({ a: { approvers: ['dana', 'theo'], design: true, tech: true } });
    expect(whoActs(ready, { owners, author: 'ann' }).sentence).toBe('Ready to add to the library: @dana or @theo can add it.');
    expect(whoActs(ready, { owners, author: 'ann', viewer: 'ann', canMerge: true })).toMatchObject({ yourTurn: true, action: 'merge', short: 'Your turn: add it to the library' });
    expect(whoActs(ready, { owners, author: 'ann', viewer: 'zoe', canMerge: false }).yourTurn).toBe(false);
  });

  it('names only who holds the ship right when the team set one', () => {
    const ready = detail({ a: { approvers: ['dana', 'theo'], design: true, tech: true } });
    expect(whoActs(ready, { owners, shippers: ['theo'], author: 'ann' }).sentence).toBe('Ready to add to the library: @theo can add it.');
    expect(whoActs(ready, { owners, shippers: ['theo'], author: 'ann', viewer: 'dana' }).yourTurn).toBe(false);
  });

  it('asks for the owner override when the only owner wrote the change', () => {
    const solo = { design: ['pat'], tech: ['pat'] };
    expect(whoActs(detail({}), { owners: solo, author: 'pat', overrideBy: ['pat'] }).sentence).toBe('No other design owner can approve. @pat can add it to the library with the owner override.');
    expect(whoActs(detail({}), { owners: solo, author: 'pat', viewer: 'pat', overridable: true })).toMatchObject({ yourTurn: true, action: 'override' });
  });

  it('asks any reviewer when the config names no owner, never the author', () => {
    const none = { design: [], tech: [] };
    expect(whoActs(detail({ tier: 1 }), { owners: none, author: 'ann' }).sentence).toBe('Waiting for a reviewer to approve.');
    expect(whoActs(detail({ tier: 1 }), { owners: none, author: 'ann', viewer: 'zoe' }).yourTurn).toBe(true);
    expect(whoActs(detail({ tier: 1 }), { owners: none, author: 'ann', viewer: 'ann' }).yourTurn).toBe(false);
  });

  it('gives list rows the same short line from their status alone', () => {
    const p = { owners, author: 'ann' };
    expect(whoActs(needFromStatus('needs-design'), p).short).toBe('Design owner to approve');
    expect(whoActs(needFromStatus('needs-tech'), p).short).toBe('Tech owner to approve');
    expect(whoActs(needFromStatus('ci-failing'), p).short).toBe('Blocked by tests');
    expect(whoActs(needFromStatus('ready'), p).short).toBe('Ready to add to the library');
    expect(whoActs(needFromStatus('ci-running'), p).short).toBe('Tests running');
    expect(whoActs(needFromStatus('checking'), p).short).toBe('Checking');
    expect(whoActs(needFromStatus('needs-design'), { ...p, viewer: 'dana' }).short).toBe('Your turn: approve design');
    // An owner who already approved is not asked again.
    expect(whoActs(needFromStatus('needs-tech'), { owners: { design: ['pat'], tech: ['pat'] }, author: 'ann', viewer: 'pat', approvers: ['pat'] }).yourTurn).toBe(false);
    for (const k of [null, 'unknown', 'merged', 'closed'] as const) expect(whoActs(needFromStatus(k), p).short, String(k)).toBeNull();
  });
});

describe('approval rows', () => {
  const owners = { design: ['dana'], tech: ['theo'] };

  it('shows the rows the tier needs, as mergeGate counts them', () => {
    expect(requiredApprovals(3)).toEqual(['design', 'tech']);
    expect(requiredApprovals(null)).toEqual(['design', 'tech']);
    expect(requiredApprovals(2)).toEqual(['design', 'tech']);
    expect(requiredApprovals(1)).toEqual(['approval']);
  });

  it('says who approved, who asked for changes and who it waits for', () => {
    const rows = approvalRows({ tier: 3, approvals: approvals({ approvers: ['dana'], design: true, changesRequested: ['theo'] }), people: { owners, author: 'ann' }, open: true });
    expect(rows.map((r) => [r.label, r.state, r.text])).toEqual([
      ['Design', 'approved', 'Approved by @dana'],
      ['Tech', 'changes', 'Changes requested by @theo'],
    ]);
    // Updated after theo's changes request: theo looks again, never a stale "Changes requested".
    const again = approvalRows({ tier: 3, approvals: approvals({ approvers: ['dana'], design: true, changesRequested: ['theo'] }), people: { owners, author: 'ann' }, open: true, lookAgain: ['theo'] });
    expect(again[1]).toMatchObject({ state: 'waiting', text: 'Updated, waiting for @theo to look again' });
    const mine = approvalRows({ tier: 3, approvals: approvals({ approvers: ['dana'], design: true, changesRequested: ['theo'] }), people: { owners, author: 'ann', viewer: 'theo' }, open: true, lookAgain: ['theo'] });
    expect(mine[1]).toMatchObject({ state: 'waiting', text: 'Updated after your changes: look again' });
    const waiting = approvalRows({ tier: 3, approvals: approvals(), people: { owners, author: 'ann' }, open: true });
    expect(waiting.map((r) => r.text)).toEqual(['Waiting for @dana', 'Waiting for @theo']);
    expect(waiting.some((r) => r.canAct)).toBe(false);
  });

  it('a token value change shows the design row only (decision TV-1): never waits for the tech owner', () => {
    const rows = approvalRows({ tier: 3, approvals: approvals({ valuesOnly: true }), people: { owners, author: 'ann' }, open: true });
    expect(rows.map((r) => [r.label, r.state, r.text])).toEqual([['Design', 'waiting', 'Waiting for @dana']]);
    const done = approvalRows({ tier: 3, approvals: approvals({ approvers: ['dana'], design: true, tech: true, valuesOnly: true }), people: { owners, author: 'ann' }, open: true });
    expect(done.map((r) => [r.label, r.state])).toEqual([['Design', 'approved']]);
    expect(requiredApprovals(3, true)).toEqual(['design']);
  });

  it('puts the action on the row the viewer holds, once', () => {
    const rows = approvalRows({ tier: 3, approvals: approvals(), people: { owners, author: 'ann', viewer: 'theo' }, open: true });
    expect(rows.map((r) => r.canAct)).toEqual([false, true]);
    expect(rows[1]).toMatchObject({ actionLabel: 'Approve tech', text: 'Waiting for you' });
    const both = approvalRows({ tier: 3, approvals: approvals(), people: { owners: { design: ['pat'], tech: ['pat'] }, author: 'ann', viewer: 'pat' }, open: true });
    expect(both.map((r) => r.canAct)).toEqual([true, false]);
    expect(approvalRows({ tier: 3, approvals: approvals(), people: { owners, author: 'dana', viewer: 'dana' }, open: true })[0]).toMatchObject({ canAct: false, text: 'Waiting: no other design owner can approve' });
    expect(approvalRows({ tier: 3, approvals: approvals(), people: { owners, author: 'ann', viewer: 'dana' }, open: false })[0]!.canAct).toBe(false);
  });

  it('lets the only owner approve both parts with one review once the team opted in', () => {
    const solo = { owners: { design: ['pat'], tech: ['pat'] }, author: 'ann', viewer: 'pat', soloOwner: 'pat' };
    const rows = approvalRows({ tier: 3, approvals: approvals(), people: solo, open: true });
    expect(rows.map((r) => [r.canAct, r.actionLabel, r.text])).toEqual([
      [true, 'Approve', 'Waiting for you'],
      [false, 'Approve', 'Covered by your approval'],
    ]);
    expect(whoActs({ kind: 'approve', roles: ['design', 'tech'] }, solo)).toMatchObject({ yourTurn: true, action: 'approve', sentence: 'Your turn: approve. As the only owner, your approval covers design and code.' });
    // Their own change: never their turn to approve.
    expect(whoActs({ kind: 'approve', roles: ['design', 'tech'] }, { ...solo, author: 'pat' }).yourTurn).toBe(false);
  });

  it('shows one Approval row below Tier 3, given by an owner (GOVERNANCE.md "1 code owner")', () => {
    const rows = approvalRows({ tier: 1, approvals: approvals({ approvers: ['dana'], owner: true }), people: { owners, author: 'ann' }, open: true });
    expect(rows).toEqual([expect.objectContaining({ label: 'Approval', state: 'approved', text: 'Approved by @dana' })]);
    // Someone who is not an owner: it still waits for one.
    const stranger = approvalRows({ tier: 1, approvals: approvals({ approvers: ['zoe'], owner: false }), people: { owners, author: 'ann' }, open: true });
    expect(stranger[0]).toMatchObject({ state: 'waiting' });
  });
});

describe('failing developer tests on a list row', () => {
  it('never makes them the author\'s turn: a developer fixes them, as the detail says', () => {
    const p = { owners: { design: ['dana'], tech: ['theo'] }, author: 'ann', viewer: 'ann' };
    expect(whoActs(needFromStatus('ci-failing', { failing: 1, developerOnly: true }), p)).toMatchObject({
      who: 'developer',
      yourTurn: false,
      short: 'Blocked by tests',
      sentence: 'Waiting for a developer to fix the failing check.',
    });
    // Failures not named yet: never "Your turn: fix tests" on the pill, the same as the Home (a developer is on it).
    expect(whoActs(needFromStatus('ci-failing', { failing: 1 }), p)).toMatchObject({ who: 'developer', yourTurn: false, short: 'Blocked by tests', sentence: 'Blocked: a check fails. A developer is on it.' });
  });

  it('never makes a conflict the author\'s turn either', () => {
    const p = { owners: { design: ['dana'], tech: ['theo'] }, author: 'ann', viewer: 'ann' };
    expect(whoActs({ kind: 'resolve-conflict' }, p)).toMatchObject({ who: 'developer', yourTurn: false, short: 'Blocked by a conflict', sentence: 'Blocked: it clashes with the library. A developer is on it.' });
    expect(whoActs({ kind: 'resolve-conflict' }, { ...p, viewer: 'dana' })).toMatchObject({ who: 'author', yourTurn: false, short: 'Blocked by a conflict' });
  });

  it('puts an approval the viewer can give before the developer fix', () => {
    const p = { owners: { design: ['dana'], tech: ['theo'] }, author: 'ann', viewer: 'dana' };
    expect(whoActs(needFromStatus('ci-failing', { failing: 2, developerOnly: true, pending: ['design', 'tech'] }), p)).toMatchObject({
      who: 'you',
      yourTurn: true,
      action: 'approve-design',
      short: 'Your turn: approve design',
      sentence: 'Your turn: approve the design. A developer fixes 2 failing checks meanwhile.',
    });
    // Nothing left for the viewer to approve: still a developer's to fix.
    expect(whoActs(needFromStatus('ci-failing', { failing: 2, developerOnly: true, pending: ['tech'] }), p)).toMatchObject({ who: 'developer', short: 'Blocked by tests' });
  });
});

describe('pendingApprovals', () => {
  it('lists the approvals the tier still needs, empty when the tier or reviews are unknown', () => {
    const none = { approvers: [], changesRequested: [], design: false, tech: false };
    expect(pendingApprovals(2, none)).toEqual(['design', 'tech']);
    expect(pendingApprovals(2, { ...none, approvers: ['dana'], design: true })).toEqual(['tech']);
    expect(pendingApprovals(null, none)).toEqual([]);
    expect(pendingApprovals(2, null)).toEqual([]);
  });
});
