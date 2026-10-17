import { describe, expect, it } from 'vitest';
import { composeRequestIssue, explorationPrBody } from '@bridge-ds/core';
import {
  branchFor,
  explorationRows,
  explorationsSummary,
  implementOnCommand,
  isRunningExploration,
  openRequestNumbers,
  runningCount,
  startCommand,
  startProblems,
  tierSlot,
  type ExplorationPullLike,
} from './explorations-view';
import type { IssueLike } from './requests-view';

const cfg = { owner: 'acme', repo: 'ds', defaultBranch: 'main', apps: { docs: 'https://docs-git-{branch}-acme.vercel.app' }, packages: ['@bridge-ds/tokens', '@bridge-ds/react'] };

function pull(n: number, over: Partial<ExplorationPullLike> & { name?: string } = {}): ExplorationPullLike {
  const name = over.name ?? `Idea ${n}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    number: n,
    title: `Exploration: ${name.toLowerCase()}`,
    body: explorationPrBody({ name, purpose: `Learn ${n}.`, useCase: 'user-test', author: 'designer' }, { owner: 'acme', repo: 'ds', pr: n, packages: cfg.packages, apps: cfg.apps }),
    state: 'open',
    draft: true,
    labels: [{ name: 'exploration' }],
    head: { ref: `explore/${slug}`, sha: `${n}`.repeat(7) },
    user: { login: 'designer' },
    updated_at: `2026-10-1${n}T10:00:00Z`,
    html_url: `https://github.com/acme/ds/pull/${n}`,
    ...over,
  };
}

function issue(n: number, exploration?: string): IssueLike {
  const i = composeRequestIssue({ component: 'Button', kind: 'visual', title: `Change ${n}`, summary: 'Why.', changes: [], source: 'studio', ...(exploration ? { exploration } : {}) });
  return { number: n, title: i.title, body: i.body, html_url: `https://github.com/acme/ds/issues/${n}`, state: 'open', labels: i.labels, user: { login: 'designer' }, created_at: '2026-10-16T00:00:00Z' };
}

describe('explorations view', () => {
  it('rows: explorations only, running first, with install, previews and linked requests', () => {
    const normal: ExplorationPullLike = { ...pull(9), title: 'feat: x', body: 'Closes #1', labels: [], head: { ref: 'agent/x', sha: 'abc' } };
    const promoted = pull(3, { name: 'Dense tables', labels: [{ name: 'tier: 2' }] });
    const rows = explorationRows([normal, pull(1, { name: 'Pill buttons' }), promoted, pull(2, { name: 'Warm neutrals' }), pull(2)], cfg, { issues: [issue(40, 'explore/pill-buttons'), issue(41), issue(42, 'explore/other')] });
    expect(rows.map((r) => [r.number, r.status, r.statusLabel])).toEqual([
      [2, 'active', 'Running'],
      [1, 'active', 'Running'],
      [3, 'promoted', 'Promoted to review'],
    ]);
    const pill = rows.find((r) => r.number === 1)!;
    expect(pill).toMatchObject({ name: 'Pill buttons', slug: 'pill-buttons', branch: 'explore/pill-buttons', purpose: 'Learn 1.', useCaseLabel: 'Prototype for a user test', author: 'designer', tone: '' });
    expect(pill.install.command).toBe('npm i @bridge-ds/tokens@https://pkg.pr.new/acme/ds/@bridge-ds/tokens@1 @bridge-ds/react@https://pkg.pr.new/acme/ds/@bridge-ds/react@1');
    expect(pill.install.fallback?.command).toContain('releases/download/preview-pr-1/bridge-ds-react-1111111.tgz');
    expect(pill.previews).toEqual([{ app: 'docs', label: 'Docs', url: 'https://docs-git-explore-pill-buttons-acme.vercel.app/' }]);
    expect(pill.requests.map((q) => q.number)).toEqual([40]);
    expect(openRequestNumbers(pill)).toEqual([40]);
    // Every status is grey: color only says blocked, waiting or ready.
    expect(rows.every((r) => r.tone === '')).toBe(true);
  });

  it('summary first, never invented', () => {
    expect(explorationsSummary([])).toBe('No exploration running.');
    expect(explorationsSummary([{ status: 'active' }])).toBe('1 exploration running.');
    expect(explorationsSummary([{ status: 'active' }, { status: 'active' }, { status: 'promoted' }])).toBe('2 explorations running, 1 promoted to review.');
    expect(explorationsSummary([{ status: 'promoted' }])).toBe('No exploration running, 1 promoted to review.');
    expect(runningCount([{ status: 'active' }, { status: 'closed' }])).toBe(1);
  });

  it('running explorations stay out of In review, and their tier slot says not mergeable', () => {
    expect(isRunningExploration({ state: 'open', labels: [{ name: 'exploration' }] })).toBe(true);
    expect(isRunningExploration({ state: 'open', labels: [{ name: 'tier: 2' }] })).toBe(false);
    expect(isRunningExploration({ state: 'closed', labels: ['exploration'] })).toBe(false);
    expect(tierSlot([{ name: 'exploration' }], 3)).toBe('Exploration (not mergeable)');
    expect(tierSlot([], 2)).toBe('Tier 2');
    expect(tierSlot([], null)).toBe('Tier not set');
  });

  it('start form: problems that say how to fix, the branch it creates, the terminal command', () => {
    expect(startProblems({ name: 'Pill buttons', purpose: 'Learn.', useCase: '' })).toEqual([]);
    expect(startProblems({ name: '', purpose: '', useCase: '' })).toHaveLength(2);
    expect(startProblems({ name: 'x y', purpose: 'p', useCase: 'nope' })).toEqual(['Pick a use case from the list, or leave it empty.']);
    expect(branchFor('Pill buttons')).toBe('explore/pill-buttons');
    expect(branchFor('!')).toBeNull();
    expect(startCommand({ name: 'Pill "round" buttons', purpose: 'Costs $5?' })).toBe('bridge explore start "Pill \\"round\\" buttons" --purpose "Costs \\$5?"');
    expect(implementOnCommand(40, 'explore/pill-buttons')).toBe('bridge request implement 40 --branch explore/pill-buttons');
    expect(implementOnCommand(null, 'explore/x')).toBe('bridge request implement <number> --branch explore/x');
  });
});
