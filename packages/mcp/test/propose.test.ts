// Edits and proposals: minimal diffs, validation and contrast gates, local branches that never touch main.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, core, ops } from '../dist/lib.js';
import { commitToNewLocalBranch } from '@bridge-ds/core/node';
import { git, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

let dir: string;
let ctx: BridgeContext;
const LIGHT = 'packages/tokens/src/semantic/light.tokens.json';

beforeAll(async () => {
  dir = tempGitRepo(REPO, REAL_PATHS);
  ctx = await BridgeContext.create({ root: dir });
});

describe('edits', () => {
  it('set keeps every other line of the file (minimal diff, one-line members stay one-line)', async () => {
    const set = await ctx.tokens();
    const r = core.applyEdits(set, [{ op: 'set', path: 'menu.item.bg-highlight', value: '{color.surface.hover}' }]);
    const before = set.files.get('components/overlays.tokens.json')!.split('\n');
    const after = r.files.get('components/overlays.tokens.json')!.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('"$value": "{color.surface.hover}"');
  });

  it('converts friendly values to the repo format', () => {
    expect(core.coerceValue('#FF5500', 'color')).toEqual({ colorSpace: 'srgb', components: [1, 0.333, 0], hex: '#ff5500' });
    expect(core.coerceValue('12px', 'dimension')).toEqual({ value: 12, unit: 'px' });
    expect(core.coerceValue('150ms', 'duration')).toEqual({ value: 150, unit: 'ms' });
    expect(core.coerceValue('#ff5500', 'color', '#000000')).toBe('#ff5500');
  });

  it('asks for a file when a token lives in light and dark', async () => {
    const set = await ctx.tokens();
    expect(() => core.applyEdits(set, [{ op: 'set', path: 'color.text.muted', value: '#000000' }])).toThrow(/defined in 2 files/);
  });

  it('add to light only breaks theme parity; add to both passes', async () => {
    const one = await ops.validateTokens(ctx, { edits: [{ op: 'add', path: 'color.text.subtle', value: '{palette.neutral.500}', file: 'semantic/light.tokens.json' }] });
    expect(one.newErrors!.some((e) => e.code === 'mode-parity')).toBe(true);
    const both = await ops.validateTokens(ctx, {
      edits: [
        { op: 'add', path: 'color.text.subtle', value: '{palette.neutral.500}', file: 'semantic/light.tokens.json' },
        { op: 'add', path: 'color.text.subtle', value: '{palette.neutral.500}', file: 'semantic/dark.tokens.json' },
      ],
    });
    expect(both.newErrors).toEqual([]);
  });

  it('remove flags the aliases it breaks; rename repoints them', async () => {
    const removed = await ops.validateTokens(ctx, { edits: [{ op: 'remove', path: 'color.action.primary.bg' }] });
    expect(removed.newErrors!.some((e) => e.code === 'broken-alias' && e.path === 'button.primary.bg')).toBe(true);
    const renamed = await ops.validateTokens(ctx, { edits: [{ op: 'rename', path: 'color.action.primary.bg', newPath: 'color.action.primary.fill' }] });
    expect(renamed.newErrors).toEqual([]);
  });
});

describe('bridge_propose_token_change (local)', () => {
  it('dry run: tier 3, minor, changeset, PR body with contrast table; nothing written', async () => {
    const p = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', summary: 'Muted text is too light on subtle backgrounds.', edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } }], dryRun: true })) as any;
    expect(p.status).toBe('dry-run');
    expect(p.tier).toBe(3);
    expect(p.bump).toBe('minor');
    expect(p.files).toEqual([LIGHT, '.changeset/bridge-darken-muted-text.md']);
    expect(p.prBody).toContain('- [x] Tier 3');
    // The before value is the resolved muted text of the copy (PINNED alias, live primitive), not a hard-coded hex.
    const set = await ctx.tokens();
    const before = set.resolve('color.text.muted', { brand: 'bridge', theme: 'light', density: 'comfortable' }).css;
    expect(p.prBody).toContain(`| \`color.text.muted\` | value | \`${before}\` (`);
    expect(p.prBody).toContain('## Contrast before and after');
    expect(p.prBody).not.toMatch(/\u2014/);
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');
  });

  it('blocks a change that breaks the contrast gate', async () => {
    const p = (await ops.proposeTokenChange(ctx, { title: 'Lighten muted text', edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.300}', file: 'semantic/light.tokens.json' }] })) as any;
    expect(p.status).toBe('blocked');
    expect(p.why).toMatch(/contrast/);
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');
  });

  it('commits to a new bridge/* branch without touching the working tree or main', async () => {
    const mainBefore = git(dir, 'rev-parse', 'main').trim();
    const fileBefore = readFileSync(join(dir, LIGHT), 'utf8');
    const p = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } }] })) as any;
    expect(p.status).toBe('branch-created');
    expect(p.branch).toBe('bridge/darken-muted-text');
    expect(git(dir, 'rev-parse', 'main').trim()).toBe(mainBefore);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git(dir, 'status', '--porcelain').trim()).toBe('');
    expect(readFileSync(join(dir, LIGHT), 'utf8')).toBe(fileBefore);
    expect(git(dir, 'show', `${p.branch}:${LIGHT}`)).toContain('{palette.neutral.700}');
    expect(git(dir, 'show', `${p.branch}:.changeset/bridge-darken-muted-text.md`)).toContain('"@bridge-ds/tokens": minor');
    expect(p.diff).toContain('-        "$value": "{palette.neutral.600}"');
    // Same title again gets a fresh branch, never overwrites.
    const again = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.800}', mode: { theme: 'light' } }] })) as any;
    expect(again.branch).toBe('bridge/darken-muted-text-2');
  });

  it('bridge_get_review on the local branch: diff table, contrast, tier', async () => {
    const r = (await ops.getReview(ctx, { branch: 'bridge/darken-muted-text' })) as any;
    expect(r.tier).toBe(3);
    expect(r.tokenChanges).toBe(1);
    expect(r.diffTable).toContain('color.text.muted');
    expect(r.contrastTable).toContain('color.text.muted');
    expect(r.validation.newErrors).toEqual([]);
    const list = (await ops.listReviews(ctx, {})) as any;
    expect(list.localBranches.map((b: any) => b.branch)).toContain('bridge/darken-muted-text');
  });

  it('local git writer refuses protected and non-prefixed branches', async () => {
    const args = { base: 'HEAD', message: 'x', files: [{ path: 'a.txt', content: 'a' }], protectedBranches: ['main', 'master'], branchPrefix: 'bridge/' };
    await expect(commitToNewLocalBranch(dir, { ...args, branch: 'main' })).rejects.toThrow(/Refusing/);
    await expect(commitToNewLocalBranch(dir, { ...args, branch: 'feature/x' })).rejects.toThrow(/Refusing/);
  });

  it('a description-only edit is Tier 1, patch (same classifier as the plugin and the docs site)', async () => {
    const p = (await ops.proposeTokenChange(ctx, { title: 'Describe muted text', edits: [{ op: 'set', path: 'color.text.muted', description: 'Secondary text and captions.', file: 'semantic/light.tokens.json' }], dryRun: true })) as any;
    expect([p.tier, p.bump]).toEqual([1, 'patch']);
    expect(p.prBody).toContain('- [x] Tier 1');
  });

  it('designer-readable diff: rename and remove are major', async () => {
    const before = await ctx.tokens();
    const r = core.applyEdits(before, [{ op: 'rename', path: 'color.text.link', newPath: 'color.text.anchor' }]);
    const after = core.tokenSetFromFiles(before.config, r.files);
    const changes = core.diff(before, after);
    expect(changes.filter((c) => c.kind === 'renamed').map((c) => c.from)).toEqual(['color.text.link', 'color.text.link', 'color.text.link']);
    expect(core.classify(changes).bump).toBe('major');
  });
});
