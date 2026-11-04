import { describe, expect, it } from 'vitest';
import type { ProductConfig } from '@bridge-ds/core';
import { explorationState, isDoneStage, withDevTask } from './exploration-state';
import { taskStage, type DesignTaskRead, type LifecyclePull, type LifecycleStage } from './review-state';
import { homeExplorations, ownOpenWork, quietSentence, type ExplorationPull } from './home-explorations';
import { folderLine, productFolders, productGroups, productSummary } from './product-page';
import { shippedByTask, stateOf } from './branches-page';
import { explorationBuildRows, filterCounts, listedRows, pageSentence } from './building-view';
import { withTaskRow } from './explorations-view';
import { person } from './home-model';
import { startedAtOf } from './exploration-page';
import { explorationAuthorFor } from './author';

const NOW = Date.parse('2026-11-04T10:00:00Z');
const products: ProductConfig[] = [
  { key: 'art-print-shop', name: 'Art print shop', repo: 'the-bridge-company/art-print-shop' },
  { key: 'library', name: 'Library', default: true },
];

// The production case of the audit (M1): "Add a toast alert", design pull request the-bridge-company/
// art-print-shop-design#4 still open as a draft with `ready-for-devs`, its developers' task art-print-shop#12 closed
// as completed. The body is the real one's Bridge block.
const M1_BLOCK =
  '<!-- bridge-exploration {"name":"add a toast alert","purpose":"","slug":"add-a-toast-alert","useCase":"terminal","startedAt":"2026-11-01T23:44:11.105Z","source":"studio","doneAt":"2026-11-02T01:40:45.516Z","doneSha":"82fa629ebf34e0f247137c9a1294aa137b78ef6e","task":"https://github.com/art-print-shop-co/art-print-shop/issues/12","member":"254dfac3665d4d07","memberName":"Dino","doneByMember":"254dfac3665d4d07"} -->\n\nRequested by Dino through Bridge.';
const M1_PULL = {
  number: 4,
  title: 'Exploration: add a toast alert',
  body: M1_BLOCK,
  state: 'open',
  draft: true,
  merged_at: null,
  labels: [{ name: 'ready-for-devs' }],
  head: { ref: 'explore/add-a-toast-alert', sha: '82fa629ebf34e0f247137c9a1294aa137b78ef6e' },
  user: { login: 'peterbono' },
  created_at: '2026-11-02T11:47:20Z',
  updated_at: '2026-11-04T03:10:04Z',
  html_url: 'https://github.com/the-bridge-company/art-print-shop-design/pull/4',
  product: 'art-print-shop',
};
const M1_TASK: DesignTaskRead = { assignees: [{ login: 'peterbono' }], state: 'closed', stateReason: 'completed', closedAt: '2026-11-02T18:42:24Z', devPull: null, labels: [] };

// Its neighbour in the same repository: #1 "Dashboard, orders waiting to ship", task art-print-shop#7 open, nobody on it.
const M7_PULL = {
  ...M1_PULL,
  number: 1,
  title: 'Exploration: Dashboard, orders waiting to ship',
  body: '<!-- bridge-exploration {"name":"Dashboard: orders waiting to ship","startedAt":"2026-10-30T17:19:26.187Z","source":"cli","agent":"claude","doneAt":"2026-10-31T00:45:36.771Z","doneSha":"5584f94","task":"https://github.com/art-print-shop-co/art-print-shop/issues/7","doneBy":"peterbono"} -->',
  labels: [{ name: 'ready-for-devs' }, { name: 'product: admin-app' }],
  head: { ref: 'explore/dashboard-orders-waiting-to-ship', sha: '5584f94' },
  html_url: 'https://github.com/the-bridge-company/art-print-shop-design/pull/1',
};
const M7_TASK: DesignTaskRead = { assignees: [], state: 'open', stateReason: 'reopened', closedAt: null, devPull: null, labels: [] };

const TASKS: Record<string, DesignTaskRead> = {
  'https://github.com/art-print-shop-co/art-print-shop/issues/12': M1_TASK,
  'https://github.com/art-print-shop-co/art-print-shop/issues/7': M7_TASK,
};
const taskOf = (body: string | null | undefined): DesignTaskRead | null => {
  const m = /"task":"([^"]+)"/.exec(body ?? '');
  return m ? (TASKS[m[1]!] ?? null) : null;
};
const stageOf = (p: { body?: string | null }): LifecycleStage | null => {
  const t = taskOf(p.body);
  return t ? taskStage(t) : null;
};

describe('the one status of an exploration', () => {
  it('M1: the developers closed their task as done, the design pull request is still open: Shipped', () => {
    expect(explorationState({ pull: M1_PULL })).toBe('waiting-for-code');
    expect(explorationState({ pull: M1_PULL, task: taskStage(M1_TASK) })).toBe('shipped');
  });

  it('M7: the task is open and nobody is on it: Waiting to be picked up', () => {
    expect(explorationState({ pull: M7_PULL, task: taskStage(M7_TASK) })).toBe('waiting-for-code');
  });

  it('applies the precedence: merged, closed, archived and running win over the task', () => {
    const task: LifecycleStage = 'shipped';
    expect(explorationState({ pull: { ...M1_PULL, merged_at: '2026-11-03T10:00:00Z' }, task: 'waiting-for-code' })).toBe('shipped');
    expect(explorationState({ pull: { ...M1_PULL, merged_at: '2026-11-03T10:00:00Z' }, nextRelease: true })).toBe('next-release');
    expect(explorationState({ pull: { ...M1_PULL, state: 'closed' }, task })).toBe('closed');
    expect(explorationState({ pull: { ...M1_PULL, labels: [{ name: 'ready-for-devs' }, { name: 'archived' }] }, task })).toBe('archived');
    // Back to exploring: the body records it and the label is back. The task (closed as not planned) is not read.
    const running: LifecyclePull = { ...M1_PULL, labels: [{ name: 'exploration' }], body: '<!-- bridge-exploration {"name":"add a toast alert","reopenedAt":"2026-11-03T10:00:00Z"} -->' };
    expect(explorationState({ pull: running, task: 'not-planned' })).toBe('exploring');
  });

  it('reads every task stage while the developers have it', () => {
    for (const t of ['waiting-for-code', 'being-built', 'in-review', 'approved', 'shipped', 'not-planned'] as const) expect(explorationState({ pull: M1_PULL, task: t })).toBe(t);
    // A task never says exploring, archived or closed: the pull request's stage stays.
    expect(withDevTask('waiting-for-code', 'closed')).toBe('waiting-for-code');
    expect(withDevTask('exploring', 'shipped')).toBe('exploring');
    expect(withDevTask('archived', 'shipped')).toBe('archived');
  });

  it('without a task, the pull request decides: picked up once pushed, in review once reviewers are asked', () => {
    const lib: LifecyclePull = { state: 'open', draft: true, labels: [{ name: 'ready-for-devs' }], head: { ref: 'explore/pills', sha: 'bbb' }, body: '<!-- bridge-exploration {"name":"Pills","doneAt":"2026-11-01T10:00:00Z","doneSha":"aaa"} -->' };
    expect(explorationState({ pull: { ...lib, head: { ref: 'explore/pills', sha: 'aaa' } } })).toBe('waiting-for-code');
    expect(explorationState({ pull: lib })).toBe('being-built');
    expect(explorationState({ pull: { ...lib, draft: false } })).toBe('in-review');
    expect(explorationState({ pull: { ...lib, requested_reviewers: [{ login: 'ann' }] } })).toBe('in-review');
  });

  it('never handed off: a draft is being tried, a promoted one is in review', () => {
    expect(explorationState({ pull: { state: 'open', draft: true, labels: [{ name: 'exploration' }], head: { ref: 'explore/x' } } })).toBe('exploring');
    expect(explorationState({ pull: { state: 'open', draft: true, labels: [{ name: 'product: account' }], head: { ref: 'feat/profile' } } })).toBe('exploring');
    expect(explorationState({ pull: { state: 'open', draft: false, labels: [{ name: 'product: account' }], head: { ref: 'feat/profile' } } })).toBe('in-review');
    expect(explorationState({ pull: { state: 'closed', merged_at: '2026-10-23T10:00:00Z', draft: false, labels: [], head: { ref: 'feat/profile' } } })).toBe('shipped');
  });

  it('says which stages are done', () => {
    expect(['shipped', 'next-release', 'closed', 'not-planned'].every((s) => isDoneStage(s as LifecycleStage))).toBe(true);
    expect(['exploring', 'waiting-for-code', 'being-built', 'in-review', 'approved'].some((s) => isDoneStage(s as LifecycleStage))).toBe(false);
  });
});

describe('every screen says the same for M1 and M7', () => {
  const pulls = [M1_PULL, M7_PULL] as unknown as ExplorationPull[];
  const cards = homeExplorations(pulls, { products, viewer: 'peterbono', author: (p) => person(p.user?.login ?? 'x', null, null), taskStage: stageOf });
  const m1 = cards.find((c) => c.number === 4)!;
  const m7 = cards.find((c) => c.number === 1)!;

  it('Home cards', () => {
    expect(m1).toMatchObject({ lifecycle: 'shipped', state: 'Shipped', tone: 'success' });
    expect(m7).toMatchObject({ lifecycle: 'waiting-for-code', state: 'Waiting to be picked up' });
  });

  it('the Home greeting counts only M7 as waiting', () => {
    expect(quietSentence(ownOpenWork(cards.map((c) => ({ ...c, own: true }))))).toBe('Nothing needs you. 1 of your explorations waits for a developer to pick it up.');
  });

  it('the Home product folder and the product page groups and header', () => {
    expect(productGroups(cards).map((g) => [g.label, g.cards.map((c) => c.number)])).toEqual([
      ['Waiting to be picked up', [1]],
      ['Shipped', [4]],
    ]);
    expect(productSummary(cards)).toBe('1 waiting to be picked up.');
    expect(folderLine(cards)).toBe('1 waiting to be picked up');
    expect(productFolders(products, cards)[0]).toMatchObject({ line: '1 waiting to be picked up', total: 2 });
  });

  it('Changes: M1 leaves All for Shipped, M7 sits under Waiting to be picked up', () => {
    const rows = [
      { number: 4, lifecycle: 'exploration', pill: null, stage: explorationState({ pull: M1_PULL, task: stageOf(M1_PULL) }) },
      { number: 1, lifecycle: 'exploration', pill: null, stage: explorationState({ pull: M7_PULL, task: stageOf(M7_PULL) }) },
    ];
    const { open, shipped } = shippedByTask(rows);
    expect(open.map((r) => [r.number, stateOf(r)])).toEqual([[1, 'code']]);
    expect(shipped.map((r) => r.number)).toEqual([4]);
  });

  it('Being built: M7 waits for a developer, M1 shipped this week', () => {
    const rows = listedRows(explorationBuildRows([M1_PULL, M7_PULL], { products, now: NOW, task: (u) => TASKS[u] ?? null }), NOW);
    expect(rows.map((r) => [r.number, r.status, r.label])).toEqual([
      [4, 'shipped', 'Shipped'],
      [1, 'requested', 'Waiting to be picked up'],
    ]);
    expect(filterCounts(rows, NOW)).toMatchObject({ waiting: 1, 'shipped-this-week': 1 });
    expect(pageSentence(rows)).toBe('1 waiting for a developer.');
  });

  it('the Explorations rows', () => {
    const row = { status: 'ready' as const, statusLabel: 'Waiting to be picked up', archived: false };
    expect(withTaskRow(row, stageOf(M1_PULL))).toMatchObject({ status: 'shipped', statusLabel: 'Shipped' });
    expect(withTaskRow(row, stageOf(M7_PULL))).toMatchObject({ status: 'ready', statusLabel: 'Waiting to be picked up' });
  });
});

describe('who started it and when (M2)', () => {
  it('reads the start from the Bridge block, not from a pull request opened again later', () => {
    // The pull request was opened again at 11:47 on Nov 2, after Done exploring at 01:40: the block keeps Nov 1, 23:44.
    expect(startedAtOf(M1_BLOCK, M1_PULL.created_at)).toBe('2026-11-01T23:44:11.105Z');
    expect(startedAtOf('no block', '2026-11-02T11:47:20Z')).toBe('2026-11-02T11:47:20Z');
    expect(startedAtOf(null, null, '2026-10-01T10:00:00Z')).toBe('2026-10-01T10:00:00Z');
  });

  it('names the person the exploration records, whoever opened its pull request', () => {
    expect(explorationAuthorFor('peterbono', M1_BLOCK)).toBe('name:Dino');
    expect(explorationAuthorFor('peterbono', 'Requested by Ann Leroy (@ann) through Bridge.')).toBe('ann');
    expect(explorationAuthorFor('peterbono', '<!-- bridge-exploration {"name":"x","author":"lee"} -->')).toBe('lee');
    expect(explorationAuthorFor('peterbono', '')).toBe('peterbono');
    expect(explorationAuthorFor('bridge-design-studio[bot]', '')).toBe('bridge-design-studio[bot]');
  });
});
