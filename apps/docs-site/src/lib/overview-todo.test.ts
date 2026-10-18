import { describe, expect, it } from 'vitest';
import { needFromStatus, whoActs } from './changes';
import { othersLine, overviewTodo, showAllLabel, type TodoChange, type TodoRequest } from './overview-todo';

const owners = { design: ['peterbono'], tech: ['peterbono'] };
const who = (kind: Parameters<typeof needFromStatus>[0], author: string, viewer: string | null, extra: { failing?: number } = {}) =>
  whoActs(needFromStatus(kind, extra), { owners, author, viewer, overrideBy: ['peterbono'] });
const change = (n: number, kind: Parameters<typeof needFromStatus>[0], author: string, viewer: string | null, failing?: number): TodoChange => ({
  number: n,
  title: `Change ${n}`,
  who: who(kind, author, viewer, { failing }),
  failing,
});
const request = (n: number, extra: Partial<TodoRequest> = {}): TodoRequest => ({
  number: n,
  component: 'Select',
  title: 'Add a native Select',
  status: 'requested',
  requester: 'ana',
  assignees: [],
  prs: [],
  ...extra,
});

describe('overview to-do', () => {
  it('lists what waits for the viewer, with the task on the button', () => {
    const t = overviewTodo({
      changes: [change(3, 'ci-failing', 'peterbono', 'peterbono', 1), change(7, 'needs-design', 'ana', 'peterbono')],
      requests: [],
      viewer: 'peterbono',
      owners: ['peterbono'],
    });
    expect(t.headline).toBe('2 changes wait for you.');
    expect(t.mine.map((r) => [r.title, r.why, r.action, r.href])).toEqual([
      ['Change 3', 'A test fails. Fix it or ask a developer.', 'Open change', '/studio/changes/?pr=3'],
      ['Change 7', 'Needs your design approval.', 'Review', '/studio/changes/?pr=7'],
    ]);
    expect(t.others).toEqual([]);
  });

  it('folds what waits on someone else, naming who', () => {
    const t = overviewTodo({ changes: [change(3, 'ci-failing', 'ana', 'peterbono', 2)], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.headline).toBe('Nothing waits for you.');
    expect(t.others[0]!.why).toBe('Waiting for @ana to fix 2 failing checks.');
    expect(othersLine(t.others.length, t.mine.length)).toBe('1 waits on someone else');
  });

  it('counts tests in plain words', () => {
    const t = overviewTodo({ changes: [change(1, 'ci-failing', 'me', 'me', 3), change(2, 'ci-failing', 'me', 'me')], requests: [], viewer: 'me', owners: [] });
    expect(t.mine.map((r) => r.why)).toEqual(['3 tests fail. Fix them or ask a developer.', 'Tests fail. Fix them or ask a developer.']);
  });

  it('gives the owner override to the owner who may use it', () => {
    // The owner wrote the change: no other design owner can approve, only the override ships it.
    const t = overviewTodo({ changes: [change(2, 'needs-design', 'peterbono', 'peterbono')], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine[0]!.why).toBe('No other owner can approve. You can ship it with the owner override.');
    const other = overviewTodo({ changes: [change(2, 'needs-design', 'peterbono', 'ana')], requests: [], viewer: 'ana', owners: ['peterbono'] });
    expect(other.mine).toEqual([]);
    expect(other.others).toHaveLength(1);
  });

  it('asks owners to triage requests nobody is on', () => {
    const t = overviewTodo({ changes: [], requests: [request(81), request(65, { requester: '' })], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.headline).toBe('2 requests wait for you.');
    expect(t.mine.map((r) => [r.title, r.why, r.action, r.href])).toEqual([
      ['Select: Add a native Select', 'Asked by @ana. Nobody is on it yet: explore it, assign someone or decline it.', 'Open request', '/studio/changes/?request=81'],
      ['Select: Add a native Select', 'Nobody is on it yet: explore it, assign someone or decline it.', 'Open request', '/studio/changes/?request=65'],
    ]);
  });

  it('routes requests to whoever is on them, and skips the ones in progress or closed', () => {
    const rows = [
      request(1, { assignees: ['bo'] }),
      request(2, { assignees: ['ana'] }),
      request(3),
      request(4, { status: 'in-progress', prs: [{ state: 'open', merged: false, author: 'bo' }] }),
      request(5, { status: 'done' }),
    ];
    const t = overviewTodo({ changes: [], requests: rows, viewer: 'ana', owners: ['peterbono'] });
    expect(t.headline).toBe('1 request waits for you.');
    expect(t.mine.map((r) => r.why)).toEqual(['Assigned to you. Nobody has started the change yet.']);
    expect(t.others.map((r) => r.why)).toEqual(['Waiting for @bo to start it.', 'Waiting for an owner (@peterbono) to pick it up.']);
  });

  it('mixes changes, requests and protection in the headline', () => {
    const t = overviewTodo({ changes: [change(3, 'ci-failing', 'peterbono', 'peterbono')], requests: [request(81)], viewer: 'peterbono', owners: ['peterbono'], unprotected: true });
    expect(t.headline).toBe('1 change, 1 request and a setup step wait for you.');
    expect(t.mine.map((r) => r.kind)).toEqual(['change', 'setup', 'request']);
    expect(t.mine[1]).toMatchObject({ title: 'Protect your library', action: 'Protect it', href: '/studio/settings/#roles' });
    const notOwner = overviewTodo({ changes: [], requests: [], viewer: 'ana', owners: ['peterbono'], unprotected: true });
    expect(notOwner.mine).toEqual([]);
  });

  it('without a login nobody is "you": every row shows, with who acts', () => {
    const t = overviewTodo({ changes: [change(3, 'ci-failing', 'peterbono', null, 1)], requests: [request(81)], viewer: null, owners: ['peterbono'] });
    expect(t.headline).toBe('1 change and 1 request wait.');
    expect(t.mine.map((r) => r.why)).toEqual(['Waiting for @peterbono to fix the failing check.', 'Waiting for an owner (@peterbono) to pick it up.']);
    expect(t.others).toEqual([]);
    expect(overviewTodo({ changes: [], requests: [], viewer: null, owners: [] }).headline).toBe('Nothing waits for a review.');
  });

  it('keeps changes whose status is not read yet out of "yours"', () => {
    const t = overviewTodo({ changes: [{ number: 9, title: 'Nine', who: null }], requests: [], viewer: 'me', owners: [], loading: true });
    expect(t.mine).toEqual([]);
    expect(t.others[0]!.why).toBe('Checking what it needs.');
    // Not readable (anonymous reads skipped): the row says where to look.
    expect(overviewTodo({ changes: [{ number: 9, title: 'Nine', who: null }], requests: [], viewer: null, owners: [] }).mine[0]!.why).toBe('Open it to see what it needs.');
  });

  it('never uses developer words', () => {
    const t = overviewTodo({
      changes: (['ci-failing', 'conflict', 'changes-requested', 'draft', 'ready', 'needs-tech', 'needs-approval'] as const).map((k, i) => change(i + 1, k, 'me', 'me')),
      requests: [request(81)],
      viewer: 'me',
      owners: ['me'],
    });
    const words = [t.headline, ...t.mine.flatMap((r) => [r.why, r.action, r.title])].join(' ');
    expect(words).not.toMatch(/\b(PR|pull request|merge|CI|GitHub|branch|commit)\b|#\d/);
  });

  it('labels the folded lines', () => {
    expect(othersLine(0, 2)).toBe('');
    expect(othersLine(2, 1)).toBe('2 more wait on someone else');
    expect(othersLine(1, 1)).toBe('1 more waits on someone else');
    expect(showAllLabel(3)).toBe('');
    expect(showAllLabel(5)).toBe('Show all 5');
  });
});
