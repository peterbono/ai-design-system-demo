import { describe, expect, it } from 'vitest';
import { branchChecks, branchEntry, orphanBranches, pullEntry, setupGaps, type BranchesConfig, type PullLike } from './branches';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const cfg: BranchesConfig = {
  owner: 'peterbono',
  repo: 'ai-design-system-demo',
  defaultBranch: 'main',
  apps: { docs: 'https://bridge-docs-git-{branch}-acme.vercel.app', storybook: 'https://bridge-sb-git-{branch}-acme.vercel.app' },
  packages: ['@bridge-ds/tokens', '@bridge-ds/react'],
};
const pull = (over: Partial<PullLike> = {}): PullLike => ({
  number: 12,
  title: 'Badge subtle variant',
  html_url: 'https://github.com/peterbono/ai-design-system-demo/pull/12',
  draft: false,
  user: { login: 'agent' },
  head: { ref: 'agent/badge-subtle', sha: SHA, repo: { full_name: 'peterbono/ai-design-system-demo' } },
  updated_at: '2026-10-16T10:00:00Z',
  ...over,
});

describe('pullEntry', () => {
  it('builds preview links, one install command and the tokens.css override URL', () => {
    const e = pullEntry(pull(), cfg);
    expect(e.previews.map((p) => p.url)).toEqual([
      'https://bridge-docs-git-agent-badge-subtle-acme.vercel.app/',
      'https://bridge-sb-git-agent-badge-subtle-acme.vercel.app/',
    ]);
    expect(e.install).toBe(
      `npm i https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/tokens@${SHA} https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/react@${SHA}`,
    );
    expect(e.tokensCss).toBe('https://bridge-docs-git-agent-badge-subtle-acme.vercel.app/tokens.css');
  });

  it('gives fork PRs no previews and no snapshot', () => {
    const e = pullEntry(pull({ head: { ref: 'main', sha: SHA, repo: { full_name: 'someone/fork' } } }), cfg);
    expect(e.fromFork).toBe(true);
    expect(e.previews).toEqual([]);
    expect(e.install).toBeNull();
  });

  it('has no install command or override without config', () => {
    const e = pullEntry(pull(), { ...cfg, apps: {}, packages: [] });
    expect(e.install).toBeNull();
    expect(e.tokensCss).toBeNull();
    expect(setupGaps({ ...cfg, apps: {}, packages: [] })).toEqual(['apps', 'packages']);
    expect(setupGaps(cfg)).toEqual([]);
  });
});

describe('branches without a PR', () => {
  it('lists other branches with deploy previews only', () => {
    const branches = [{ name: 'main', commit: { sha: SHA } }, { name: 'agent/badge-subtle', commit: { sha: SHA } }, { name: 'feat/x', commit: { sha: SHA } }];
    const rest = orphanBranches(branches, [pull()], 'main');
    expect(rest.map((b) => b.name)).toEqual(['feat/x']);
    const e = branchEntry(rest[0]!, cfg);
    expect(e.pr).toBeNull();
    expect(e.install).toBeNull();
    expect(e.url).toBe('https://github.com/peterbono/ai-design-system-demo/tree/feat%2Fx');
    expect(e.previews).toHaveLength(2);
  });
});

describe('branchChecks', () => {
  it('separates CI from the visual impact check', () => {
    const c = branchChecks([
      { name: 'Guardrails', status: 'completed', conclusion: 'success' },
      { name: 'Unit and a11y tests', status: 'completed', conclusion: 'failure' },
      { name: 'Visual impact', status: 'completed', conclusion: 'neutral', html_url: 'https://x/1' },
    ]);
    expect(c.ci).toBe('fail');
    expect(c.failed).toEqual(['Unit and a11y tests']);
    expect(c.visual).toEqual({ state: 'pass', url: 'https://x/1', name: 'Visual impact' });
  });

  it('reports no visual check when none ran, and a running one as pending', () => {
    expect(branchChecks([{ name: 'Guardrails', status: 'completed', conclusion: 'success' }]).visual.state).toBe('none');
    expect(branchChecks([{ name: 'Chromatic', status: 'in_progress', conclusion: null }]).visual.state).toBe('pending');
  });
});
