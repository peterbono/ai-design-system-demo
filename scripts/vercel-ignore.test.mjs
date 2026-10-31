import { describe, expect, it } from 'vitest';
import { decide, shouldBuild } from './vercel-ignore.mjs';

describe('vercel-ignore shouldBuild', () => {
  it('builds an app when its own files or shared packages change', () => {
    expect(shouldBuild('docs', ['apps/docs-site/src/pages/index.astro'])).toBe(true);
    expect(shouldBuild('admin', ['packages/react/src/components/Button/Button.tsx'])).toBe(true);
    expect(shouldBuild('storybook', ['.storybook/preview.tsx'])).toBe(true);
    expect(shouldBuild('storybook', ['package-lock.json'])).toBe(true);
  });

  it('skips an app when only another app changed', () => {
    expect(shouldBuild('admin', ['apps/docs-site/src/pages/index.astro', 'docs/GOVERNANCE.md'])).toBe(false);
    expect(shouldBuild('storybook', ['apps/admin/src/App.tsx'])).toBe(false);
    // Bridge's own tools rebuild the docs site only, never the two previews.
    expect(shouldBuild('storybook', ['packages/mcp/src/server.ts'])).toBe(false);
    expect(shouldBuild('admin', ['packages/cli/src/index.ts'])).toBe(false);
    expect(shouldBuild('storybook', ['packages/core/src/explorations.ts'])).toBe(false);
    expect(shouldBuild('admin', ['packages/core/src/explorations.ts'])).toBe(true);
    expect(shouldBuild('admin', ['packages/toolbar/src/index.ts'])).toBe(true);
    expect(shouldBuild('storybook', ['packages/tokens/src/semantic/light/color.json'])).toBe(true);
    expect(shouldBuild('docs', ['packages/mcp/src/server.ts'])).toBe(true);
    expect(shouldBuild('docs', ['apps/admin/src/App.tsx', 'deploy/storybook/vercel.json'])).toBe(false);
    expect(shouldBuild('docs', [])).toBe(false);
  });

  it('matches whole path segments and exact files, and always builds unknown apps', () => {
    expect(shouldBuild('admin', ['apps/admin-legacy/x.ts'])).toBe(false);
    expect(shouldBuild('admin', ['package.json.bak'])).toBe(false);
    expect(shouldBuild('nope', [])).toBe(true);
  });
});

/** Fake git: `diffs` maps a base to the files changed since it; `bases` are the merge-base answers in order. */
function fakeGit({ diffs = {}, bases = [], fetchFails = [] } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'merge-base') {
      const next = bases.shift();
      if (!next) throw new Error('fatal: Not a valid object name origin/main');
      return `${next}\n`;
    }
    if (args[0] === 'fetch') {
      if (fetchFails.some((r) => args.includes(r))) throw new Error('fatal: could not read from remote');
      return '';
    }
    if (args[0] === 'diff') {
      if (!(args[2] in diffs)) throw new Error(`fatal: bad revision ${args[2]}`);
      return diffs[args[2]].join('\n');
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

describe('vercel-ignore decide', () => {
  it('on main, diffs against the previous deployed SHA, else HEAD^', () => {
    const { git } = fakeGit({ diffs: { abc: ['apps/admin/src/App.tsx'], 'HEAD^': ['apps/docs-site/x.astro'] } });
    expect(decide('admin', { ref: 'main', previousSha: 'abc' }, git)).toMatchObject({ build: true, base: 'abc' });
    expect(decide('docs', { ref: 'main', previousSha: 'abc' }, git)).toMatchObject({ build: false, base: 'abc' });
    expect(decide('docs', { ref: 'main' }, git)).toMatchObject({ build: true, base: 'HEAD^' });
  });

  it('on a branch, diffs against the merge-base with main, so earlier commits of the first push count', () => {
    // HEAD^ only touched the admin app, but an earlier commit of the branch changed the docs site.
    const { git, calls } = fakeGit({ bases: ['mb1'], diffs: { mb1: ['apps/docs-site/a.ts', 'apps/admin/b.tsx'], 'HEAD^': ['apps/admin/b.tsx'] } });
    expect(decide('docs', { ref: 'chore/x', previousSha: 'HEAD^' }, git)).toMatchObject({ build: true, base: 'mb1' });
    expect(calls).not.toContain('diff --name-only HEAD^ HEAD');
  });

  it('fetches main when the shallow clone lacks it, then skips when nothing relevant changed', () => {
    const { git, calls } = fakeGit({ bases: [undefined, 'mb2'], diffs: { mb2: ['apps/admin/b.tsx'] } });
    expect(decide('storybook', { ref: 'feat/y' }, git)).toMatchObject({ build: false, base: 'mb2' });
    expect(calls).toContain('fetch --no-tags --depth=50 origin +refs/heads/main:refs/remotes/origin/main');
  });

  it('falls back to the repo URL when origin cannot be fetched', () => {
    const url = 'https://github.com/o/r.git';
    const { git, calls } = fakeGit({ bases: [undefined, 'mb3'], fetchFails: ['origin'], diffs: { mb3: ['packages/core/x.ts'] } });
    expect(decide('admin', { ref: 'feat/z', repoUrl: url }, git)).toMatchObject({ build: true, base: 'mb3' });
    expect(calls).toContain(`fetch --no-tags --depth=50 ${url} +refs/heads/main:refs/remotes/origin/main`);
  });

  it('builds on any git error', () => {
    // No merge-base even after fetching and deepening.
    expect(decide('docs', { ref: 'feat/a' }, fakeGit().git).build).toBe(true);
    // Fetch impossible.
    expect(decide('docs', { ref: 'feat/a' }, fakeGit({ fetchFails: ['origin'] }).git).build).toBe(true);
    // Diff fails (previous SHA no longer in history).
    expect(decide('docs', { ref: 'main', previousSha: 'gone' }, fakeGit().git)).toMatchObject({ build: true, base: 'gone' });
  });
});

describe('vercel-ignore agent branches', () => {
  it('never previews agent/* branches, without touching git', () => {
    const git = () => {
      throw new Error('git must not run');
    };
    expect(decide('docs', { ref: 'agent/library-phase-5' }, git)).toMatchObject({ build: false });
    expect(decide('storybook', { ref: 'agent/x' }, git).build).toBe(false);
  });
});
