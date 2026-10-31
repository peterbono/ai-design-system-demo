import { describe, expect, it } from 'vitest';
import type { BranchCommitLike } from '@bridge-ds/core';
import {
  activityRows,
  avatarOf,
  buildersOf,
  changedScreenOf,
  checkInClaudeLine,
  doneActionFor,
  doneByOf,
  explorationTag,
  faceOf,
  gitNamesOf,
  handoffActivity,
  handoffSteps,
  reviewersAsked,
  reviewVerdictOf,
  headlineOf,
  isHandoffStatus,
  libraryPreviewApp,
  pageLines,
  requestPieces,
  startedTail,
} from './exploration-page';

const NOW = new Date('2026-10-30T14:00:00Z');
const c = (sha: string, message: string, date: string, login = 'florian'): BranchCommitLike => ({ sha, commit: { message, author: { name: login, date } }, author: { login } });
const CLAUDE = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const commits = [
  c('a', 'chore(explore): start Orders: bulk actions', '2026-10-29T10:00:00Z'),
  c('b', `feat: add row selection to the Orders table${CLAUDE}`, '2026-10-30T11:55:00Z'),
  c('d', 'tweak the empty state copy', '2026-10-30T11:58:00Z', 'dana'),
  c('e', `feat: add a Bulk actions bar: Mark shipped, Export, Cancel${CLAUDE}`, '2026-10-30T12:00:00Z'),
];

describe('exploration page model', () => {
  it('names people by their name, Claude as Claude, with GitHub photos for accounts only', () => {
    expect(faceOf('florian', false, { florian: 'Florian' })).toEqual({ login: 'florian', name: 'Florian', agent: false, avatar: 'https://github.com/florian.png?size=64' });
    expect(faceOf('claude', true)).toMatchObject({ name: 'Claude', agent: true, avatar: null });
    expect(avatarOf('ann@example.com')).toBeNull();
    expect(avatarOf('github-actions[bot]')).toBeNull();
  });

  it('credits Claude alone only when no person authored the commit', () => {
    const bot = { sha: 'x', commit: { message: `feat: add a toolbar${CLAUDE}`, author: { name: 'bridge-ds[bot]', date: '2026-10-30T12:00:00Z' } }, author: { login: 'bridge-ds[bot]' } };
    expect(activityRows({ commits: [bot], author: 'florian', now: NOW })[0]!.who).toMatchObject({ name: 'Claude', agent: true });
    expect(activityRows({ commits: [c('y', 'feat: add a toolbar', '2026-10-30T12:00:00Z', 'claude')], author: 'florian', now: NOW })[0]!.who.agent).toBe(true);
  });

  it('reads display names from the commits for a signed-out visitor, the login as fallback', () => {
    const named: BranchCommitLike = { sha: 'n', commit: { message: 'chore(explore): start X', author: { name: 'Florian', date: '2026-10-30T12:00:00Z' } }, author: { login: 'peterbono' } };
    const same: BranchCommitLike = { sha: 's', commit: { message: 'feat: x', author: { name: 'dana', date: '2026-10-30T12:00:00Z' } }, author: { login: 'dana' } };
    expect(gitNamesOf([same, named])).toEqual({ peterbono: 'Florian' });
    expect(faceOf('dana', false, gitNamesOf([same])).name).toBe('dana');
  });

  it('shows Done exploring only to people who can keep it', () => {
    const v = { direct: true, demo: false, connected: true, write: true, keeper: true, keeperNote: 'Florian or a reviewer says when it is done exploring.' };
    expect(doneActionFor(v)).toEqual({ kind: 'run' });
    expect(doneActionFor({ ...v, connected: false })).toBeNull();
    expect(doneActionFor({ ...v, connected: false, demo: true })).toEqual({ kind: 'demo' });
    expect(doneActionFor({ ...v, write: false })).toBeNull();
    expect(doneActionFor({ ...v, keeper: false })).toEqual({ kind: 'note', text: v.keeperNote });
    expect(doneActionFor({ ...v, direct: false })).toBeNull();
    expect(doneActionFor({ ...v, productNote: 'Ask a Shop developer.' })).toEqual({ kind: 'note', text: 'Ask a Shop developer.' });
  });

  it('says who started it, where and when', () => {
    expect(startedTail('Admin demo', '2026-10-30T09:00:00Z', NOW)).toBe('Admin demo · today');
    expect(startedTail('Admin demo', null)).toBe('Admin demo');
  });

  it('lists the last 3 events, newest first', () => {
    const rows = activityRows({ commits, author: 'florian', startedAt: '2026-10-29T10:00:00Z', names: { florian: 'Florian', dana: 'Dana' }, now: NOW });
    expect(rows.map((r) => `${r.who.name} ${r.text}, ${r.when}`)).toEqual(['Florian with Claude added a Bulk actions bar: Mark shipped, Export, Cancel, 2 h ago', 'Dana tweaked the empty state copy, 2 h ago', 'Florian with Claude added row selection to the Orders table, 2 h ago']);
    expect(rows[0]!.who).toMatchObject({ login: 'florian', agent: false, avatar: 'https://github.com/florian.png?size=64' });
  });

  it('shows a merge of the latest product in designer words, never git ones', () => {
    const merged = [...commits, c('m', "Merge branch 'main' into explore/dashboard-orders-waiting-to-ship", '2026-10-30T13:00:00Z')];
    const rows = activityRows({ commits: merged, author: 'florian', names: { florian: 'Florian' }, now: NOW });
    expect(`${rows[0]!.who.name} ${rows[0]!.text}`).toBe('Florian brought in the latest product');
    expect(rows.map((r) => r.text).join(' ')).not.toMatch(/merge|branch|main/i);
    expect(headlineOf({ commits: merged, files: [], author: 'florian', now: NOW })?.text).toBe('added a Bulk actions bar: Mark shipped, Export, Cancel');
  });

  it('says the last change from the files, else from the latest commit; nothing before the first change', () => {
    expect(headlineOf({ commits, files: ['apps/admin/src/OrdersTable.tsx', 'apps/admin/src/BulkActionsBar.tsx'], author: 'florian', now: NOW })).toMatchObject({ who: { name: 'florian with Claude', agent: false }, text: 'changed Orders table and Bulk actions bar', when: '2 h ago' });
    expect(headlineOf({ commits, files: ['apps/admin/src/lib/x.ts'], author: 'florian', now: NOW })?.text).toBe('added a Bulk actions bar: Mark shipped, Export, Cancel');
    expect(headlineOf({ commits: commits.slice(0, 1), files: ['.bridge/explorations/orders.md'], author: 'florian' })).toBeNull();
  });

  it('copies the line Claude resolves, in the app and in a terminal', () => {
    expect(pageLines({ number: 12, name: 'Checkout', productName: 'Shop', product: 'shop', repo: 'acme/shop' })).toEqual({ app: 'Continue Bridge exploration shop#12 "Checkout" in Shop and use the Bridge library.', terminal: 'claude "Continue Bridge exploration shop#12"' });
  });

  it('opens the library app the exploration changes', () => {
    const apps = { docs: 'https://docs-{branch}', storybook: 'https://sb-{branch}', admin: 'https://admin-{branch}' };
    expect(libraryPreviewApp(['apps/docs-site/src/x.ts'], apps)).toBe('docs');
    expect(libraryPreviewApp(['apps/admin/src/App.tsx'], apps)).toBe('admin');
    expect(libraryPreviewApp(['packages/react/src/components/Button/Button.tsx'], apps)).toBe('storybook');
    expect(libraryPreviewApp(['packages/core/src/x.ts'], apps)).toBe('docs');
    expect(libraryPreviewApp(null, {})).toBeNull();
  });
});

describe('after Done exploring (Waiting for code, Being built, Shipped)', () => {
  const done = c('n', 'chore(explore): done exploring, remove the exploration note', '2026-10-30T12:30:00Z', 'ann');
  const dev = c('x', 'feat(orders): wire the bulk actions to the API', '2026-10-30T13:00:00Z', 'sam');
  const florian = faceOf('florian', false, { florian: 'Florian' });
  const sam = faceOf('sam', false, { sam: 'Sam' });

  it('shows the hand-off states on this page, the same tags as the lists', () => {
    expect(['ready', 'building', 'shipped'].every(isHandoffStatus)).toBe(true);
    expect(['active', 'promoted', 'closed'].some(isHandoffStatus)).toBe(false);
    expect(explorationTag('active')).toEqual({ label: 'Exploring', tone: 'info', dot: true });
    expect(explorationTag('active', { notStarted: true })).toMatchObject({ label: 'Not started', tone: 'neutral' });
    expect(explorationTag('ready')).toEqual({ label: 'Waiting for code', tone: 'warning', dot: false });
    expect(explorationTag('building')).toMatchObject({ label: 'Being built', tone: 'info' });
    expect(explorationTag('shipped')).toMatchObject({ label: 'Shipped', tone: 'success' });
  });

  it('knows who said done from Bridge\'s commit at that moment', () => {
    expect(doneByOf([...commits, done])).toBe('ann');
    expect(doneByOf(commits)).toBeNull();
  });

  it('names the developers: assigned first, then who pushed after Done exploring (never the explorer, Claude or the note commit)', () => {
    expect(buildersOf({ commits: [...commits, done, dev], doneAt: '2026-10-30T12:20:00Z', author: 'florian' })).toEqual(['sam']);
    expect(buildersOf({ assignees: [{ login: 'lee' }, { login: 'florian' }], commits: [...commits, dev], doneAt: '2026-10-30T12:20:00Z', author: 'florian' })).toEqual(['lee', 'sam']);
    expect(buildersOf({ commits: [...commits, dev], doneAt: null, author: 'florian' })).toEqual([]);
  });

  it('says the hand-off in four steps, in designer words', () => {
    const waiting = handoffSteps({ status: 'ready', doneBy: florian, doneAt: '2026-10-30T12:20:00Z', builders: [], product: 'Admin demo', now: NOW });
    expect(waiting.map((s) => [s.status, s.title, s.detail, Boolean(s.current)])).toEqual([
      ['done', 'Done exploring', 'Florian, today. Sent to the Admin demo developers.', false],
      ['waiting', 'Developers build it', 'In their task list. You see here when one picks it up.', true],
      ['waiting', 'Review', 'After the developers', false],
      ['waiting', 'Shipped', 'Then live in Admin demo', false],
    ]);
    expect(handoffSteps({ status: 'ready', doneBy: florian, doneAt: null, builders: [sam], product: 'Admin demo', now: NOW })[1]!.detail).toBe('Waiting for Sam');
    expect(handoffSteps({ status: 'ready', doneBy: null, doneAt: null, builders: [], product: 'Admin demo', now: NOW })[0]!.detail).toBe('Sent to the Admin demo developers.');
    expect(handoffSteps({ status: 'ready', doneBy: florian, doneAt: null, builders: [], product: 'the library', library: true, now: NOW })[0]!.detail).toBe('Florian. Sent to the library developers.');
    expect(handoffSteps({ status: 'building', doneBy: florian, doneAt: null, builders: [sam], product: 'Admin demo', now: NOW })[1]!.detail).toBe('Sam is building it');
    const shipped = handoffSteps({ status: 'shipped', doneBy: florian, doneAt: '2026-10-29T12:00:00Z', builders: [], shippedAt: '2026-10-30T09:00:00Z', product: 'Admin demo', now: NOW });
    expect(shipped.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(shipped[3]).toMatchObject({ title: 'Shipped', detail: 'In Admin demo, today', current: true });
    expect(JSON.stringify([waiting, shipped])).not.toMatch(/merge|pull request|branch|commit|\u2014/i);
  });

  describe('the review step', () => {
    const dana = faceOf('dana', false, { dana: 'Dana' });
    const lee = faceOf('lee', false, { lee: 'Lee' });
    const base = { doneBy: florian, doneAt: null, builders: [sam], product: 'Admin demo', now: NOW };
    const row = (steps: ReturnType<typeof handoffSteps>, i: number) => [steps[i]!.status, steps[i]!.title, steps[i]!.detail, Boolean(steps[i]!.current)];

    it('nobody pushed yet: the review comes after the developers', () => {
      const steps = handoffSteps({ ...base, status: 'ready', builders: [] });
      expect(row(steps, 2)).toEqual(['waiting', 'Review', 'After the developers', false]);
    });

    it('still a draft: the developers build it, the review waits until they ask', () => {
      const steps = handoffSteps({ ...base, status: 'building', review: { draft: true, asked: [dana], verdict: null } });
      expect(row(steps, 1)).toEqual(['waiting', 'Developers build it', 'Sam is building it', true]);
      expect(row(steps, 2)).toEqual(['waiting', 'Review', 'When the developers ask', false]);
      // Nothing read yet reads the same.
      expect(row(handoffSteps({ ...base, status: 'building' }), 2)).toEqual(['waiting', 'Review', 'When the developers ask', false]);
    });

    it('ready for review: built, and the review waits for who is asked', () => {
      const steps = handoffSteps({ ...base, status: 'building', review: { draft: false, asked: [dana, lee], verdict: null, viewer: 'florian', compareUrl: 'https://x.vercel.app' } });
      expect(row(steps, 1)).toEqual(['done', 'Built', 'By Sam', false]);
      expect(row(steps, 2)).toEqual(['waiting', 'Review', 'Waiting for Dana and Lee', true]);
      expect(steps[2]!.link).toBeUndefined();
      expect(row(handoffSteps({ ...base, status: 'building', review: { draft: false, asked: [], verdict: null } }), 2)).toEqual(['waiting', 'Review', 'Waiting for a reviewer', true]);
    });

    it('the viewer is asked: "Your review", with the preview to compare when known', () => {
      const steps = handoffSteps({ ...base, status: 'building', review: { draft: false, asked: [dana], verdict: null, viewer: 'Dana', compareUrl: 'https://x.vercel.app' } });
      expect(row(steps, 2)).toEqual(['waiting', 'Review', 'Your review', true]);
      expect(steps[2]!.link).toEqual({ label: 'Compare with the exploration', href: 'https://x.vercel.app' });
      const noPreview = handoffSteps({ ...base, status: 'building', review: { draft: false, asked: [dana], verdict: null, viewer: 'dana', compareUrl: null } });
      expect(noPreview[2]!.detail).toBe('Your review');
      expect(noPreview[2]!.link).toBeUndefined();
    });

    it('changes requested: the review stays current and names who asked', () => {
      const steps = handoffSteps({ ...base, status: 'building', review: { draft: false, asked: [dana], verdict: { kind: 'changes', by: dana } } });
      expect(row(steps, 1)).toEqual(['done', 'Built', 'By Sam', false]);
      expect(row(steps, 2)).toEqual(['waiting', 'Review', 'Changes requested by Dana', true]);
    });

    it('approved: the review is done, shipping is next', () => {
      const steps = handoffSteps({ ...base, status: 'building', review: { draft: false, asked: [dana], verdict: { kind: 'approved', by: dana } } });
      expect(row(steps, 2)).toEqual(['done', 'Reviewed', 'Approved by Dana', false]);
      expect(row(steps, 3)).toEqual(['waiting', 'Shipped', 'Then live in Admin demo', true]);
    });

    it('shipped: every step done', () => {
      const steps = handoffSteps({ ...base, status: 'shipped', review: { draft: false, asked: [], verdict: { kind: 'approved', by: dana } } });
      expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
      expect(steps[2]!.detail).toBe('Approved by Dana');
      expect(JSON.stringify(steps)).not.toMatch(/merge|pull request|branch|commit|draft|—/i);
    });

    it('reads the verdict from the reviews: last say per person, changes requested wins, a dismissal clears', () => {
      expect(reviewVerdictOf([])).toBeNull();
      expect(reviewVerdictOf([{ user: { login: 'dana' }, state: 'COMMENTED' }])).toBeNull();
      expect(reviewVerdictOf([{ user: { login: 'dana' }, state: 'APPROVED' }])).toEqual({ kind: 'approved', login: 'dana' });
      expect(reviewVerdictOf([{ user: { login: 'lee' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'dana' }, state: 'APPROVED' }])).toEqual({ kind: 'changes', login: 'lee' });
      expect(reviewVerdictOf([{ user: { login: 'lee' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'lee' }, state: 'APPROVED' }])).toEqual({ kind: 'approved', login: 'lee' });
      expect(reviewVerdictOf([{ user: { login: 'lee' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'lee' }, state: 'COMMENTED' }])).toEqual({ kind: 'changes', login: 'lee' });
      expect(reviewVerdictOf([{ user: { login: 'lee' }, state: 'APPROVED' }, { user: { login: 'lee' }, state: 'DISMISSED' }])).toBeNull();
      expect(reviewVerdictOf([{ user: { login: 'bot[bot]' }, state: 'APPROVED' }])).toBeNull();
    });

    it('asks the requested reviewers, else the design approvers (not the developer, not an unexpanded team)', () => {
      expect(reviewersAsked({ requested: [{ login: 'lee' }], approvers: ['dana'] })).toEqual(['lee']);
      expect(reviewersAsked({ requested: [], approvers: ['dana', 'sam', 'acme/design', 'Dana'], builders: ['sam'] })).toEqual(['dana']);
      expect(reviewersAsked({ approvers: [] })).toEqual([]);
    });
  });

  it('puts "said done exploring" in the activity, without Bridge\'s own commit', () => {
    const rows = handoffActivity({ commits: [...commits, done, dev], author: 'florian', doneBy: 'ann', doneAt: '2026-10-30T12:20:00Z', names: { ann: 'Ann', sam: 'Sam' }, now: NOW });
    expect(rows.map((r) => `${r.who.name} ${r.text}`)).toEqual(['Sam wired the bulk actions to the API', 'Ann said done exploring', 'florian with Claude added a Bulk actions bar: Mark shipped, Export, Cancel']);
  });

  it('lists the requests a library exploration already sent, with their status', () => {
    expect(requestPieces([{ number: 81, title: 'Select: native', component: 'Select', statusLabel: 'In progress', open: true }])).toEqual([
      { id: 'request-81', title: 'Select', href: '?request=81', line: 'In progress', tone: 'info', opens: 'request', number: 81 },
    ]);
  });

  it('names the changed screen for the preview plate, and the line to check in Claude', () => {
    expect(changedScreenOf(['src/resources/dashboard/Dashboard.tsx'])).toBe('Dashboard');
    expect(changedScreenOf(['.bridge/exploration.md'])).toBeNull();
    expect(changedScreenOf(null)).toBeNull();
    expect(checkInClaudeLine('Dashboard', '#admin-app#2')).toBe('Check what the exploration "Dashboard" (#admin-app#2) adds that the library does not have, and record it in Bridge.');
  });
});
