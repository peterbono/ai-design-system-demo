import { describe, expect, it } from 'vitest';
import { needFromStatus, whoActs } from './changes';
import { developerLine, greetingLine, headlineFor, isGuidanceChange, moreLabel, reviewDecisions, reviewNeedsYou, isGuidanceOnly, othersLine, overviewTodo, showAllLabel, SIGNED_OUT_LINE, signedOutLine, REQUEST_TRIAGE_IN_STUDIO, type TodoChange, type TodoInput, type TodoRequest } from './overview-todo';
import { jargonIn } from './vocabulary';

// Request triage is off in Studio (REQUEST_TRIAGE_IN_STUDIO); these tests keep its rows covered by turning it on.
const todo = (input: TodoInput) => overviewTodo({ requestTriage: true, ...input });

const owners = { design: ['peterbono'], tech: ['peterbono'] };
type Kind = Parameters<typeof needFromStatus>[0];
const who = (kind: Kind, author: string, viewer: string | null, extra: { failing?: number; changesRequestedBy?: string[] } = {}, o = owners) =>
  whoActs(needFromStatus(kind, extra), { owners: o, author, viewer, overrideBy: ['peterbono'] });
const change = (n: number, kind: Kind, author: string, viewer: string | null, extra: Partial<TodoChange> = {}, o = owners): TodoChange => ({
  number: n,
  title: `Change ${n}`,
  who: who(kind, author, viewer, { failing: extra.failing, changesRequestedBy: extra.changesBy }, o),
  ...extra,
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
const team = { design: ['peterbono', 'lea'], tech: ['peterbono', 'dev'] };

describe('overview to-do: work sorted by kind', () => {
  it('sends technical blockers to the developer group, even when the viewer wrote the change', () => {
    // The owner's case: agent-made changes under his name, a test fails and one clashes with the library.
    const t = todo({
      changes: [change(3, 'ci-failing', 'peterbono', 'peterbono', { failing: 1 }), change(2, 'conflict', 'peterbono', 'peterbono'), change(1, 'ci-failing', 'peterbono', 'peterbono', { failing: 2 })],
      requests: [request(81), request(65, { requester: '' })],
      viewer: 'peterbono',
      owners: ['peterbono'],
    });
    expect(t.headline).toBe('2 things need you.');
    expect(t.mine.map((r) => [r.title, r.why, r.action, r.href])).toEqual([
      ['Add a native Select', '@ana wants to change Select. Start an exploration, assign someone or decline it.', 'Decide', '/studio/changes/?request=81'],
      ['Add a native Select', 'Someone wants to change Select. Start an exploration, assign someone or decline it.', 'Decide', '/studio/changes/?request=65'],
    ]);
    expect(t.developer.map((r) => [r.why, r.action])).toEqual([
      ['Blocked: a test fails. A developer needs to fix it before you review.', 'Open branch'],
      ['Blocked: it clashes with main. A developer needs to update it before you review.', 'Open branch'],
      ['Blocked: 2 tests fail. A developer needs to fix them before you review.', 'Open branch'],
    ]);
    expect(developerLine(t.developer.length)).toBe('3 branches wait on a developer');
  });

  it('keeps developer work out of Needs you and the Changes badge', () => {
    const changes = [change(7, 'needs-design', 'ana', 'peterbono', { nature: 'developer' }), change(8, 'needs-design', 'ana', 'peterbono')];
    const t = todo({ changes, requests: [request(81, { nature: 'developer' }), request(82)], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine.map((r) => r.key)).toEqual(['change-8', 'request-82']);
    expect(t.devWork.map((r) => r.key)).toEqual(['change-7', 'request-81']);
    expect([...t.developer, ...t.others].map((r) => r.key)).toEqual([]);
    expect(reviewNeedsYou({ changes, viewer: 'peterbono', owners: ['peterbono'] })).toBe(1);
  });

  it('tells tests still running from a person who decides', () => {
    const t = todo({ changes: [change(5, 'ci-running', 'peterbono', 'peterbono'), change(6, 'checking', 'ana', 'peterbono')], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.others.map((r) => r.task)).toEqual(['checking', 'checking']);
    expect(othersLine(t.others, t.mine.length)).toBe('2 are being checked');
  });

  it('names the author when someone else wrote the blocked change', () => {
    const t = todo({ changes: [change(3, 'ci-failing', 'ana', 'peterbono', { failing: 2 })], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.headline).toBe("You're all caught up.");
    expect(t.developer[0]!.why).toBe('Blocked: 2 tests fail. @ana needs to fix them before you review.');
    expect(t.others).toEqual([]);
  });

  it('names the blocker in plain words: release note, review answers, draft', () => {
    const t = todo({
      changes: [
        change(1, 'ci-failing', 'me', 'me', { failing: 1, failingChecks: ['Changeset present'] }),
        change(2, 'ci-failing', 'me', 'me', { failing: 2, failingChecks: ['Changeset present', 'Docs site'] }),
        change(3, 'ci-failing', 'me', 'me'),
        change(4, 'changes-requested', 'ana', 'me', { changesBy: ['lea'] }),
        change(5, 'changes-requested', 'ana', 'me', { changesBy: ['me'] }),
        change(6, 'changes-requested', 'ana', 'me'),
        change(7, 'draft', 'ana', 'me'),
      ],
      requests: [],
      viewer: 'me',
      owners: ['me'],
    });
    expect(t.developer.map((r) => r.why)).toEqual([
      'Blocked: the release note is missing. A developer needs to add it before you review.',
      'Blocked: 2 tests fail. A developer needs to fix them before you review.',
      'Blocked: tests fail. A developer needs to fix them before you review.',
      'Blocked: @lea asked for changes. @ana needs to make them before you review.',
      'Blocked: you asked for changes. @ana needs to make them before you review.',
      'Blocked: a reviewer asked for changes. @ana needs to make them before you review.',
      'Blocked: it is still a draft. @ana needs to finish it before you review.',
    ]);
    expect(t.mine).toEqual([]);
  });

  it('keeps the tech review in the developer group, for a viewer who holds it too', () => {
    const t = todo({ changes: [change(4, 'needs-tech', 'ana', 'peterbono')], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine).toEqual([]);
    expect(t.developer[0]).toMatchObject({ task: 'blocked', why: 'Design is approved. It waits for your tech review.', action: 'Open branch' });
    const other = todo({ changes: [change(4, 'needs-tech', 'ana', 'lea', {}, team)], requests: [], viewer: 'lea', owners: ['peterbono', 'lea', 'dev'] });
    expect(other.developer[0]!.why).toBe('Design is approved. Waiting for the tech owner (@peterbono or @dev) to approve.');
  });

  it('labels each designer task and says what happens once it is done', () => {
    const t = todo({
      changes: [
        change(1, 'ready', 'ana', 'peterbono'),
        change(2, 'needs-design', 'ana', 'peterbono', { visual: 'ready' }),
        change(3, 'needs-approval', 'ana', 'peterbono', { guidance: true }),
        change(4, 'needs-approval', 'ana', 'peterbono', { visual: 'ready' }),
        change(5, 'needs-design', 'ana', 'peterbono', { visual: 'none' }),
        change(6, 'needs-design', 'ana', 'peterbono'),
      ],
      requests: [request(81)],
      viewer: 'peterbono',
      owners: ['peterbono'],
    });
    expect(t.headline).toBe('7 things need you.');
    expect(t.mine.map((r) => [r.title, r.action, r.why])).toEqual([
      ['Change 2', 'Review design', 'Before and after are ready. Your design approval is the next step.'],
      ['Change 4', 'Review design', 'Before and after are ready. Your approval lets it merge.'],
      ['Change 5', 'Review design', 'Nothing changes on screen. Your design approval is the next step.'],
      ['Change 6', 'Review design', 'Your design approval is the next step.'],
      ['Change 1', 'Merge', 'Approved and tested. Merging puts it in the next release.'],
      ['Add a native Select', 'Decide', '@ana wants to change Select. Start an exploration, assign someone or decline it.'],
      ['Change 3', 'Review guidance', 'Usage guidance changed. Read it, then approve it or edit it.'],
    ]);
  });

  it('puts requests to decide above changes that need no designer', () => {
    const changes = [1, 2, 3, 4].map((n) => change(n, 'ci-failing', 'peterbono', 'peterbono'));
    const t = todo({ changes, requests: [request(81)], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine.map((r) => r.action)).toEqual(['Decide']);
    expect(showAllLabel(t.mine.length)).toBe('');
  });

  it('gives the owner override to the owner who may use it, as a design review', () => {
    // The owner wrote the change: no other design owner can approve, only the override ships it.
    const t = todo({ changes: [change(2, 'needs-design', 'peterbono', 'peterbono', { visual: 'ready' })], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine[0]).toMatchObject({ task: 'design', action: 'Review design', why: 'Before and after are ready. No other owner can approve it. Check the design, then merge it with the owner override.' });
    const other = todo({ changes: [change(2, 'needs-design', 'peterbono', 'ana')], requests: [], viewer: 'ana', owners: ['peterbono'] });
    expect(other.mine).toEqual([]);
    expect(other.others).toHaveLength(1);
  });

  it('folds what another person decides, naming who', () => {
    const t = todo({ changes: [change(7, 'needs-design', 'ana', 'dev', {}, team)], requests: [request(1, { assignees: ['bo'] })], viewer: 'dev', owners: ['peterbono', 'lea'] });
    expect(t.headline).toBe("You're all caught up.");
    expect(t.others.map((r) => r.why)).toEqual(['Waiting for the design owner (@peterbono or @lea) to approve.', '@ana wants to change Select. Waiting for @bo to start it.']);
    expect(othersLine(t.others, t.mine.length)).toBe('2 wait on someone else');
  });

  it('routes requests: assigned to you, to someone else, linked to a change, or waiting for an owner', () => {
    const rows = [
      request(1, { assignees: ['bo'] }),
      request(2, { assignees: ['ana'] }),
      request(3),
      request(4, { status: 'in-progress', prs: [{ state: 'open', merged: false, author: 'bo' }] }),
      request(5, { status: 'done' }),
      request(6, { prs: [{ state: 'closed', merged: false, author: null }] }),
    ];
    const t = todo({ changes: [], requests: rows, viewer: 'ana', owners: ['peterbono'] });
    expect(t.headline).toBe('1 thing needs you.');
    expect(t.mine.map((r) => [r.why, r.action])).toEqual([['@ana wants to change Select. Assigned to you. Nobody has started the work yet.', 'Open request']]);
    expect(t.others.map((r) => r.why)).toEqual(['@ana wants to change Select. Waiting for @bo to start it.', '@ana wants to change Select. Waiting for a design system owner (@peterbono) to decide.']);
  });

  it('adds the protection setup step for owners, after the decisions', () => {
    const t = todo({ changes: [change(3, 'needs-design', 'ana', 'peterbono')], requests: [request(81)], viewer: 'peterbono', owners: ['peterbono'], unprotected: true });
    expect(t.headline).toBe('3 things need you.');
    expect(t.mine.map((r) => r.task)).toEqual(['design', 'decide', 'setup']);
    expect(t.mine[2]).toMatchObject({ title: 'Protect your library', action: 'Protect it', href: '/studio/settings/#protection' });
    expect(todo({ changes: [], requests: [], viewer: 'ana', owners: ['peterbono'], unprotected: true }).mine).toEqual([]);
    expect(todo({ changes: [], requests: [], viewer: 'peterbono', owners: ['peterbono'], unprotected: true }).headline).toBe('1 thing needs you.');
  });

  it('signed out: decisions show with who makes them, blockers still go to the developer group', () => {
    const t = todo({
      changes: [change(3, 'ci-failing', 'peterbono', null, { failing: 1 }), change(4, 'needs-design', 'ana', null)],
      requests: [request(81)],
      viewer: null,
      owners: ['peterbono'],
    });
    expect(t.headline).toBe('Connect GitHub to start working on the library.');
    expect(t.mine.map((r) => [r.why, r.action])).toEqual([
      ['Waiting for the design owner (@peterbono) to approve.', 'Open branch'],
      ['@ana wants to change Select. Waiting for a design system owner (@peterbono) to decide.', 'Open request'],
    ]);
    expect(t.developer.map((r) => r.why)).toEqual(['Blocked: a test fails. @peterbono needs to fix it before review.']);
    expect(todo({ changes: [], requests: [], viewer: null, owners: [] }).headline).toBe('Connect GitHub to start working on the library.');
  });

  it('lists guidance to review or write in Needs you, so the greeting never says nothing waits beside it', () => {
    const g = { drafted: [{ name: 'Icon', href: '/components/icon/?edit=1' }, { name: 'VisuallyHidden', href: '/components/visually-hidden/?edit=1' }], missing: [] };
    const t = todo({ changes: [change(3, 'ci-failing', 'peterbono', 'peterbono', { failing: 1 })], requests: [], viewer: 'peterbono', owners: ['peterbono'], guidance: g });
    expect(t.headline).toBe('1 thing needs you.');
    expect(t.mine).toEqual([
      { key: 'guidance-drafted', kind: 'setup', task: 'guidance', title: 'Usage guidance of Icon and VisuallyHidden', why: 'Claude drafted it from the code. Read it, fix it, then mark it reviewed.', action: 'Review guidance', href: '/components/icon/?edit=1' },
    ]);
    const missing = todo({ changes: [], requests: [], viewer: null, owners: [], guidance: { drafted: [], missing: ['A', 'B', 'C', 'D'].map((name) => ({ name, href: `/${name}` })) } });
    expect(missing.headline).toBe('Connect GitHub to start working on the library.');
    expect(missing.mine[0]).toMatchObject({ title: 'Usage guidance of A, B and 2 more', action: 'Write guidance', href: '/A' });
    expect(headlineFor([], 'me')).toBe("You're all caught up.");
    expect(greetingLine('Florian Gouloubi', '1 thing needs you.', 'peterbono')).toBe('Hello, Florian. 1 thing needs you.');
    expect(greetingLine(null, "You're all caught up.", 'peterbono')).toBe("Hello. You're all caught up.");
    expect(greetingLine('Florian', 'Connect GitHub to start working on the library.', null)).toBe('Connect GitHub to start working on the library.');
    expect(signedOutLine(true)).toBe('Sign in with GitHub to start working on the library.');
    expect(signedOutLine(false)).toBe(SIGNED_OUT_LINE);
    expect(headlineFor([{ task: 'design' }, { task: 'guidance' }], 'me')).toBe('2 things need you.');
  });

  it('counts the review decisions for the Changes badge with the same rule as Needs you', () => {
    const changes = [change(1, 'needs-design', 'ana', 'peterbono'), change(2, 'ready', 'ana', 'peterbono'), change(3, 'ci-failing', 'peterbono', 'peterbono', { failing: 1 }), change(4, 'needs-tech', 'ana', 'peterbono')];
    const t = todo({ changes, requests: [request(81)], viewer: 'peterbono', owners: ['peterbono'], guidance: { drafted: [{ name: 'Icon', href: '/' }], missing: [] } });
    expect(reviewDecisions(t.mine)).toBe(2);
    expect(reviewNeedsYou({ changes, viewer: 'peterbono', owners: ['peterbono'] })).toBe(2);
    expect(reviewNeedsYou({ changes, viewer: null, owners: ['peterbono'] })).toBe(0);
    expect(reviewNeedsYou({ changes: [change(3, 'ci-failing', 'peterbono', 'peterbono', { failing: 1 })], viewer: 'peterbono', owners: ['peterbono'] })).toBe(0);
  });

  it('keeps changes whose status is not read yet out of "yours"', () => {
    const t = todo({ changes: [{ number: 9, title: 'Nine', who: null }], requests: [], viewer: 'me', owners: [], loading: true });
    expect(t.mine).toEqual([]);
    expect(t.others[0]).toMatchObject({ task: 'checking', why: 'Checking what it needs.' });
    // Not readable (anonymous reads skipped): the row says where to look.
    expect(todo({ changes: [{ number: 9, title: 'Nine', who: null }], requests: [], viewer: null, owners: [] }).others[0]!.why).toBe('Open it to see what it needs.');
  });

  it('never uses developer words on the designer rows or the headline', () => {
    const t = todo({
      changes: (['ci-failing', 'conflict', 'changes-requested', 'draft', 'ready', 'needs-tech', 'needs-approval', 'needs-design'] as const).map((k, i) =>
        change(i + 1, k, 'me', 'me', { failingChecks: ['Changeset present'], failing: 1 }),
      ),
      requests: [request(81)],
      viewer: 'me',
      owners: ['me'],
    });
    const words = [t.headline, ...[...t.mine, ...t.developer].flatMap((r) => [r.why, r.action, r.title])].join(' ');
    expect(jargonIn(words)).toEqual([]);
    expect(words).not.toMatch(/\bGitHub\b|#\d/);
  });

  it('labels the folded lines', () => {
    expect(developerLine(0)).toBe('');
    expect(developerLine(1)).toBe('1 branch waits on a developer');
    const waiting = { task: 'waiting' as const };
    const checking = { task: 'checking' as const };
    expect(othersLine([], 2)).toBe('');
    expect(othersLine([waiting, waiting], 1)).toBe('2 more wait on someone else');
    expect(othersLine([waiting], 1)).toBe('1 more waits on someone else');
    expect(othersLine([checking], 0)).toBe('1 is being checked');
    expect(othersLine([checking, checking], 1)).toBe('2 more are being checked');
    expect(othersLine([waiting, checking, checking], 1)).toBe('3 more wait on someone else or on checks');
    expect(showAllLabel(3)).toBe('');
    expect(showAllLabel(5)).toBe('Show all 5');
    expect(moreLabel(5)).toBe('');
    expect(moreLabel(7)).toBe('Show 2 more');
  });
});

describe('request triage', () => {
  it('stays out of the Overview by default: teams triage in Jira', () => {
    expect(REQUEST_TRIAGE_IN_STUDIO).toBe(false);
    const t = overviewTodo({ changes: [], requests: [request(81), request(82, { assignees: ['ana'] })], viewer: 'ana', owners: ['ana'] });
    expect([...t.mine, ...t.others, ...t.devWork]).toEqual([]);
    expect(t.headline).toBe("You're all caught up.");
  });
});

describe('guidance changes', () => {
  it('counts only docs.json files and their release note', () => {
    expect(isGuidanceOnly(['packages/react/src/components/Button/Button.docs.json', '.changeset/brave-owls.md'])).toBe(true);
    expect(isGuidanceOnly(['packages/react/src/components/Button/Button.docs.json', 'packages/react/src/components/Button/Button.tsx'])).toBe(false);
    expect(isGuidanceOnly(['.changeset/brave-owls.md'])).toBe(false);
    expect(isGuidanceOnly([])).toBe(false);
  });

  it('trusts the files once read, else the Library editor branch', () => {
    expect(isGuidanceChange('docs/button-2026-10-18-ab12', undefined)).toBe(true);
    expect(isGuidanceChange('docs/button-2026-10-18-ab12', false)).toBe(false);
    expect(isGuidanceChange('agent/card', true)).toBe(true);
    expect(isGuidanceChange('agent/card', undefined)).toBe(false);
  });
});

describe('For you: the change lifecycle (lib/change-status)', () => {
  it('badges each change row with its state, in the status line words and tone', () => {
    const t = todo({ changes: [change(1, 'ready', 'ana', 'peterbono', { lifecycle: 'ready' }), change(2, 'needs-design', 'ana', 'peterbono', { lifecycle: 'ready' })], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine.map((r) => r.state)).toEqual([
      { lifecycle: 'ready', label: 'In review', tone: 'info' },
      { lifecycle: 'ready', label: 'In review', tone: 'info' },
    ]);
    // Unknown lifecycle: no badge rather than a guess.
    expect(todo({ changes: [change(1, 'ready', 'ana', 'peterbono')], requests: [], viewer: 'peterbono', owners: ['peterbono'] }).mine[0]!.state).toBeUndefined();
  });

  it('puts the own draft of the viewer in For you, but not in the review badge count, and never one an agent made', () => {
    const t = todo({ changes: [change(5, 'draft', 'me', 'me', { lifecycle: 'draft' })], requests: [], viewer: 'me', owners: ['me'] });
    expect(t.mine).toEqual([
      { key: 'change-5', kind: 'change', title: 'Change 5', href: '/studio/changes/?pr=5', task: 'finish', why: 'Reviewers are not asked until you request a review.', action: 'Open draft', state: { lifecycle: 'draft', label: 'Draft', tone: 'neutral' } },
    ]);
    expect(reviewDecisions(t.mine)).toBe(0);
    const agent = todo({ changes: [change(5, 'draft', 'me', 'me', { lifecycle: 'draft', agent: true })], requests: [], viewer: 'me', owners: ['me'] });
    expect(agent.mine).toEqual([]);
    expect(agent.developer[0]!.task).toBe('blocked');
  });

  it('keeps a change that waits for code off For you, with no designer action', () => {
    const t = todo({ changes: [change(6, 'ci-failing', 'ana', 'peterbono', { failing: 2, lifecycle: 'waiting' })], requests: [], viewer: 'peterbono', owners: ['peterbono'] });
    expect(t.mine).toEqual([]);
    expect(t.developer[0]).toMatchObject({ task: 'blocked', why: 'Design is approved. A developer finishes the code before it is merged.', state: { label: 'Approved, waiting for code', tone: 'neutral' } });
  });
});
