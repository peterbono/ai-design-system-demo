// History and rollback through the MCP ops and the CLI, on a throwaway repo with a known token history:
//   #3 muted text 600 -> 700 (light), #7 muted text 700 -> 800 (light): reverting #3 conflicts with #7.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BridgeContext, history } from '../dist/lib.js';
import { CLI, git, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

const LIGHT = 'packages/tokens/src/semantic/light.tokens.json';
let dir: string;
let ctx: BridgeContext;

function commitMuted(from: string, to: string, message: string, date: string) {
  const f = join(dir, LIGHT);
  const text = readFileSync(f, 'utf8');
  const i = text.indexOf('"muted"', text.indexOf('"text"'));
  writeFileSync(f, text.slice(0, i) + text.slice(i).replace(from, to));
  execFileSync('git', ['commit', '-q', '-am', message], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

beforeAll(async () => {
  dir = tempGitRepo(REPO, REAL_PATHS);
  const old = '2026-09-01T10:00:00Z';
  execFileSync('git', ['commit', '-q', '--amend', '--no-edit', `--date=${old}`], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: old } });
  commitMuted('{palette.neutral.600}', '{palette.neutral.700}', 'feat(tokens): darken muted text (#3)', '2026-10-01T10:00:00Z');
  commitMuted('{palette.neutral.700}', '{palette.neutral.800}', 'fix(tokens): muted text even darker (#7)', '2026-10-02T10:00:00Z');
  ctx = await BridgeContext.create({ root: dir });
});

const bridge = (...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe('history tools', () => {
  it('bridge_get_history: entries with PR, tier, why, versions; filter by token', async () => {
    const h = (await history.getHistory(ctx, {})) as any;
    expect(h.entries.map((e: any) => e.id)).toEqual(['pr-7', 'pr-3', expect.stringMatching(/^[0-9a-f]{7}$/)]);
    expect(h.entries[0]).toMatchObject({ pr: 7, tier: 3, bump: 'minor', breaking: false, version: 'Unreleased' });
    expect(h.versions[0]).toMatchObject({ version: 'Unreleased', prs: [7, 3] });
    const f = (await history.getHistory(ctx, { token: '--color-text-muted' })) as any;
    expect(f.entries.slice(0, 2).map((e: any) => e.id)).toEqual(['pr-7', 'pr-3']);
    expect(f.entries[0].changes[0]).toMatchObject({ kind: 'changed', path: 'color.text.muted' });
  });

  it('bridge_get_token_history: before and after per mode, newest first', async () => {
    const t = (await history.getTokenHistory(ctx, { path: 'color.text.muted' })) as any;
    expect(t.changes.slice(0, 2).map((c: any) => [c.entry, c.mode, c.before, c.after])).toEqual([
      ['pr-7', 'Light', '{palette.neutral.700}', '{palette.neutral.800}'],
      ['pr-3', 'Light', '{palette.neutral.600}', '{palette.neutral.700}'],
    ]);
  });

  it('bridge_plan_revert: a later change is a conflict, kept unless asked; nothing written', async () => {
    const p = (await history.planRevertOp(ctx, { target: '#3' })) as any;
    expect(p.status).toBe('nothing-to-do');
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toMatchObject({ reason: 'changed-later', later: ['#7 fix(tokens): muted text even darker (#7)'], resolution: 'keep-current' });
    const forced = (await history.planRevertOp(ctx, { target: 'pr-3', restoreConflicts: true })) as any;
    expect(forced.status).toBe('ready');
    expect(forced.title).toBe('Revert: feat(tokens): darken muted text (#3)');
    expect(forced.prBody).toContain('Reverts [#3](https://github.com/peterbono/ai-design-system-demo/pull/3)');
    expect(forced.prBody).not.toMatch(/\u2014/);
    expect(forced.contrast.moved).toBeGreaterThan(0);
    const clean = (await history.planRevertOp(ctx, { target: '7' })) as any;
    expect(clean).toMatchObject({ status: 'ready', tier: 3, conflicts: [] });
    expect(clean.edits).toEqual(['Set color.text.muted back to {palette.neutral.700} (Light)']);
    const restore = (await history.planRevertOp(ctx, { restore: { path: 'color.text.muted', entry: 'pr-3', side: 'before', mode: { theme: 'light' } } })) as any;
    expect(restore).toMatchObject({ status: 'ready', kind: 'restore', title: 'Restore color.text.muted (Light) from #3' });
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');
  });

  it('bridge_propose_revert: new local bridge/* branch, main and the working tree untouched', async () => {
    const mainBefore = git(dir, 'rev-parse', 'main').trim();
    const p = (await history.proposeRevert(ctx, { target: 'pr-7' })) as any;
    expect(p.status).toBe('branch-created');
    expect(p.branch).toMatch(/^bridge\/revert-/);
    expect(git(dir, 'rev-parse', 'main').trim()).toBe(mainBefore);
    expect(git(dir, 'status', '--porcelain').trim()).toBe('');
    expect(git(dir, 'show', `${p.branch}:${LIGHT}`)).toContain('{palette.neutral.700}');
    expect(git(dir, 'log', '-1', '--format=%s', p.branch).trim()).toBe('revert(tokens): fix(tokens): muted text even darker (#7)');
  });
});

describe('bridge CLI history and revert', () => {
  it('history and history <token>', () => {
    const r = bridge('history');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/pr-7\s+T3 minor\s+fix\(tokens\): muted text even darker/);
    const t = bridge('history', 'color.text.muted');
    expect(t.out).toMatch(/#7\s+Light\s+#\w{6} -> #\w{6}/);
  });

  it('revert --dry-run shows the conflict and how to restore it; unknown target exits 2', () => {
    const r = bridge('revert', '3', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/conflict\s+color\.text\.muted/);
    expect(r.out).toMatch(/--use-before color\.text\.muted@semantic\/light\.tokens\.json/);
    const forced = bridge('revert', '3', '--dry-run', '--use-before', 'color.text.muted@semantic/light.tokens.json');
    expect(forced.out).toMatch(/status: dry-run/);
    expect(forced.out).toContain('## Risk tier');
    expect(bridge('revert').code).toBe(2);
    expect(bridge('revert', '#99').code).toBe(2);
  });
});
