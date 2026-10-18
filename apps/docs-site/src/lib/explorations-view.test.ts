import { describe, expect, it } from 'vitest';
import { composeRequestIssue, explorationPrBody, previewComment } from '@bridge-ds/core';
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
  tryItCopy,
  explorationPreviews,
  previewRowCopy,
  explorationStateLine,
  promoteAsk,
  promotedLine,
  purposeLine,
  useCaseHint,
  USE_CASE_EMPTY_HINT,
  tryItFromComments,
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
    // No guessed install command on the row: the detail reads it from the preview comment (tryItFromComments).
    expect('install' in pill).toBe(false);
    expect(pill.headSha.startsWith('1111111')).toBe(true);
    expect(pill.previews).toEqual([{ app: 'docs', label: 'Library', url: 'https://docs-git-explore-pill-buttons-acme.vercel.app/' }]);
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

  it('try it: the command from the preview comment of the head commit, never a guessed pkg.pr.new URL', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const tarball = 'https://github.com/acme/ds/releases/download/preview-pr-1/bridge-ds-react-0123456.tgz';
    const comment = previewComment({ owner: 'acme', repo: 'ds', pr: 1, branch: 'explore/pill-buttons', sha, packages: [{ name: '@bridge-ds/react', url: tarball }], source: 'release', apps: {}, exploration: true });
    const ready = tryItCopy(tryItFromComments([{ body: 'DS Bridge added a commit' }, { body: comment }], sha));
    expect(ready.command).toBe(`npm i @bridge-ds/react@${tarball}`);
    expect(ready.sentence).toMatch(/Tarballs of the latest commit/);
    // No comment yet, or a comment about an older commit: being prepared, no command.
    expect(tryItCopy(tryItFromComments([], sha))).toEqual({ sentence: expect.stringMatching(/being prepared/), command: null });
    expect(tryItCopy(tryItFromComments([{ body: comment }], 'fedcba9876543210')).command).toBeNull();
    const failed = previewComment({ owner: 'acme', repo: 'ds', pr: 1, branch: 'explore/pill-buttons', sha, packages: [], source: 'none', apps: {}, exploration: true });
    expect(tryItCopy(tryItFromComments([{ body: failed }], sha)).sentence).toMatch(/did not finish/);
  });

  it('previews: the URL Vercel reports for a long branch, never the template it shortened (PR #64)', () => {
    const apps = {
      docs: 'https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app',
      storybook: 'https://bridge-storybook-git-{branch}-peterbonos-projects.vercel.app',
      admin: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app',
    };
    const r = { branch: 'explore/button-normal-again', number: 64, headSha: '2ccfe16fa28a2ea6df1639fe7675fa005b66170a' };
    const bare = explorationPreviews(r, apps).map(previewRowCopy);
    expect(bare.map((p) => [p.label, p.url, p.note])).toEqual([
      ['Library', 'https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/', null],
      ['Component sandbox', null, 'Link not ready yet'],
      ['Admin demo', null, 'Link not ready yet'],
    ]);
    const vc = Buffer.from(JSON.stringify({ projects: [{ name: 'bridge-admin', previewUrl: 'bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app', nextCommitStatus: 'DEPLOYED' }] })).toString('base64');
    const statuses = [{ context: 'Vercel – bridge-admin', state: 'pending', target_url: 'https://vercel.com/peterbonos-projects/bridge-admin/x' }];
    const admin = previewRowCopy(explorationPreviews(r, apps, { comments: [{ body: `[vc]: #x:${vc}` }], statuses })[2]!);
    expect(admin).toEqual({ label: 'Admin demo', url: 'https://bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app/', host: 'bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app', note: 'Updating to the latest version' });
  });
});

describe('designer words', () => {
  it('shows exploration names in sentence case', () => {
    expect(explorationRows([pull(5, { name: 'button normal again' })], cfg)[0]!.name).toBe('Button normal again');
  });

  it('hides a purpose that only repeats the name', () => {
    expect(purposeLine('Button normal again', 'button normal again')).toBeNull();
    expect(purposeLine('Pill buttons', '  ')).toBeNull();
    expect(purposeLine('Pill buttons', 'Do rounder buttons read as friendlier?')).toBe('Do rounder buttons read as friendlier?');
  });

  it('says what each use case is for without branch or pull request words', () => {
    for (const v of ['user-test', 'stakeholder-demo', 'ab-idea', 'terminal', 'other', '']) {
      expect(useCaseHint(v)).not.toMatch(/branch|pull request|\bmain\b|commit/i);
    }
    expect(useCaseHint('')).toBe(USE_CASE_EMPTY_HINT);
    for (const s of ['active', 'promoted', 'closed'] as const) expect(explorationStateLine(s)).not.toMatch(/branch|pull request|merge/i);
  });
});

describe('promoteAsk', () => {
  it('names the design and tech approvers for a token or component change', () => {
    expect(promoteAsk(3, { design: ['ana'], tech: ['@ben', 'cy'] })).toEqual({
      who: '@ana (design) and @ben and @cy (tech) will be asked to approve.',
      next: 'It moves to In review. Design and tech approve, then it ships.',
    });
    expect(promoteAsk(3, { design: ['ana'], tech: ['ana'] }).who).toBe('@ana will be asked to approve, for design and for tech.');
    expect(promoteAsk(null, { design: [], tech: [] }).who).toBe('A design owner and a tech owner will be asked to approve.');
  });

  it('asks one approval for Tier 1, design and tech from Tier 2 up', () => {
    expect(promoteAsk(2, { design: ['ana'], tech: ['ben'] }).who).toMatch(/@ana \(design\).*@ben \(tech\)/);
    expect(promoteAsk(1, { design: ['ana'], tech: ['ben'] })).toEqual({ who: 'One teammate will be asked to approve: any reviewer can.', next: 'It moves to In review. One approval, then it ships.' });
    expect(promotedLine(64)).toBe('Promoted. #64 is in In review now, waiting for its approvals.');
  });
});
