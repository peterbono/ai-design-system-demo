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
  it('builds preview links and the tokens.css override URL; no install command until the workflow posts one', () => {
    const e = pullEntry(pull(), cfg);
    expect(e.previews.map((p) => p.url)).toEqual([
      'https://bridge-docs-git-agent-badge-subtle-acme.vercel.app/',
      'https://bridge-sb-git-agent-badge-subtle-acme.vercel.app/',
    ]);
    // Never a guessed pkg.pr.new command: the sticky comment has not been read.
    expect(e.install).toBeNull();
    expect(e.installState).toBe('building');
    expect(e.tokensCss).toBe('https://bridge-docs-git-agent-badge-subtle-acme.vercel.app/tokens.css');
  });

  it('reads the install command from the sticky comment of the head commit', () => {
    const command = `npm i https://github.com/peterbono/ai-design-system-demo/releases/download/preview-pr-12/bridge-ds-react-${SHA.slice(0, 7)}.tgz`;
    const sticky = `<!-- bridge-branch-preview -->\n## Try this DS branch in your product\n\nSnapshot of \`${SHA.slice(0, 7)}\` on \`agent/badge-subtle\`.\n\n\`\`\`sh\n${command}\n\`\`\`\n`;
    const e = pullEntry(pull(), cfg, { comments: [{ body: 'LGTM' }, { body: sticky }] });
    expect(e).toMatchObject({ install: command, installState: 'ready' });
    // About an older commit: still being prepared for this one.
    const old = pullEntry(pull({ head: { ref: 'agent/badge-subtle', sha: 'f'.repeat(40), repo: { full_name: 'peterbono/ai-design-system-demo' } } }), cfg, { comments: [{ body: sticky }] });
    expect(old).toMatchObject({ install: null, installState: 'building' });
  });

  it('shows the URL Vercel reports for a long branch, never the template it shortened (PR #64)', () => {
    const real = {
      ...cfg,
      apps: {
        docs: 'https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app',
        storybook: 'https://bridge-storybook-git-{branch}-peterbonos-projects.vercel.app',
        admin: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app',
      },
    };
    const p64 = pull({ number: 64, head: { ref: 'explore/button-normal-again', sha: SHA, repo: { full_name: 'peterbono/ai-design-system-demo' } } });
    const bare = pullEntry(p64, real);
    expect(bare.previews.map((p) => p.app)).toEqual(['docs']);
    expect(bare.pendingPreviews).toEqual(['Storybook', 'Admin demo']);
    const vc = Buffer.from(
      JSON.stringify({
        projects: [
          { name: 'bridge-storybook', previewUrl: 'bridge-storybook-git-explore-button-8a43de-peterbonos-projects.vercel.app' },
          { name: 'bridge-admin', previewUrl: 'bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app' },
        ],
      }),
    ).toString('base64');
    const e = pullEntry(p64, real, { comments: [{ body: `[vc]: #x:${vc}\nThe latest updates on your projects.` }] });
    expect(e.previews.map((p) => p.url)).toEqual([
      'https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/',
      'https://bridge-storybook-git-explore-button-8a43de-peterbonos-projects.vercel.app/',
      'https://bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app/',
    ]);
    expect(e.pendingPreviews).toEqual([]);
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
