// bridge branch, products, settings, coverage and docs save: the Studio actions from the terminal, with an in-memory
// GitHub. Same operations as the MCP tools (packages/mcp/test/branches.test.ts covers the rules in depth).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '@bridge-ds/mcp';
import { runBranch, runDocsSave, runStudioRead } from '../src/branch.js';
import type { RequestIO } from '../src/request.js';
import { fakeGitHub, pinStart, readTree, REAL_PATHS, REPO, tempGitRepo, withoutSoloOwner } from '../../mcp/test/helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';
const edit = { op: 'set' as const, path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } };

function io(gh: ReturnType<typeof fakeGitHub>, env: NodeJS.ProcessEnv = { GITHUB_TOKEN: 't' }) {
  const out: string[] = [];
  const err: string[] = [];
  const value: RequestIO = { print: (s) => out.push(s), error: (s) => err.push(s), env, fetch: gh.fetch, ghToken: () => undefined, hasClaude: () => false, runClaude: () => 0 };
  return { io: value, out: () => out.join('\n'), err: () => err.join('\n') };
}

const args = (...argv: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x.startsWith('--')) {
      const k = x.slice(2);
      const next = argv[i + 1];
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !['json', 'dry-run', 'approve'].includes(k) ? argv[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

describe('bridge branch', () => {
  const dir = tempGitRepo(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']);

  const soloOffRepo = () => {
    const d = tempGitRepo(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']);
    const cfg = join(d, 'bridge.config.json');
    writeFileSync(cfg, withoutSoloOwner({ 'bridge.config.json': readFileSync(cfg, 'utf8') })['bridge.config.json']!);
    return d;
  };

  async function withBranch() {
    const gh = fakeGitHub(OWNER, NAME, withoutSoloOwner(pinStart(readTree(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']))));
    const ctx = await BridgeContext.create({ repo: `${OWNER}/${NAME}`, token: 't', fetch: gh.fetch });
    await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [edit] });
    return gh;
  }

  it('help and usage errors say how to fix', async () => {
    const gh = fakeGitHub(OWNER, NAME, { 'README.md': 'hi' });
    const h = io(gh);
    expect(await runBranch(args('branch'), dir, h.io)).toBe(2);
    expect(h.out()).toContain('bridge branch merge <n> [--override "reason"]');
    await expect(runBranch(args('branch', 'status'), dir, io(gh).io)).rejects.toThrow(/Usage: bridge branch status <n>/);
    await expect(runBranch(args('branch', 'review', '1'), dir, io(gh).io)).rejects.toThrow(/--approve, --request-changes/);
    await expect(runBranch(args('branch', 'update', '1', '--choice', 'k=maybe'), dir, io(gh).io)).rejects.toThrow(/takes mine or theirs/);
    await expect(runBranch(args('branch', 'nope'), dir, io(gh).io)).rejects.toThrow(/Unknown branch command/);
  });

  it('send for review, what needs me, status, approve, merge with the owner override', async () => {
    // The default rule (one owner covers design only): this repo's soloOwnerCanApproveBoth left out.
    const dir = soloOffRepo();
    const gh = await withBranch();
    gh.viewer.login = 'agent';
    const ready = io(gh);
    expect(await runBranch(args('branch', 'ready', '#1'), dir, ready.io)).toBe(0);
    expect(ready.out()).toBe('Review requested. Reviewers can see it now.');

    gh.viewer.login = 'peterbono';
    const list = io(gh);
    await runBranch(args('branch', 'list'), dir, list.io);
    expect(list.out()).toContain('1 branch needs you; 1 in review.');
    expect(list.out()).toMatch(/#1 +Needs design approval +feat\(tokens\): Darken muted text +<- Your design approval/);

    const ask = io(gh);
    gh.viewer.login = 'someone';
    await runBranch(args('branch', 'ask', '1'), dir, ask.io);
    expect(ask.out()).toBe('Asked @peterbono to review.');
    gh.viewer.login = 'peterbono';

    const approve = io(gh);
    await runBranch(args('branch', 'review', '1', '--approve'), dir, approve.io);
    expect(approve.out()).toBe('Approved.');

    const status = io(gh);
    await runBranch(args('branch', 'status', '1'), dir, status.io);
    expect(status.out()).toContain('Needs tech approval. Design and tech approval needed; approved by @peterbono.');
    expect(status.out()).toContain('Next: Only approvals are missing and you may use the owner override');

    // Blocked by the gate: exit 1 (not 2, a usage error), the reason on stderr with the CLI flag, never a tool argument.
    const blocked = io(gh);
    expect(await runBranch(args('branch', 'merge', '1'), dir, blocked.io)).toBe(1);
    expect(blocked.err()).toMatch(/cannot be merged yet/);
    expect(blocked.err()).toContain('bridge branch merge 1 --override "why"');
    expect(blocked.err()).not.toMatch(/overrideReason|bridge_[a-z]/);
    expect(status.out()).toContain('`bridge branch merge 1 --override "why"`');
    expect(status.out()).not.toMatch(/bridge_[a-z]|overrideReason/);
    // A dry run that would be blocked says why and exits 1 too.
    const dry = io(gh);
    expect(await runBranch(args('branch', 'merge', '1', '--dry-run'), dir, dry.io)).toBe(1);
    expect(dry.out()).toMatch(/cannot be merged yet/);
    const merged = io(gh);
    await runBranch(args('branch', 'merge', '1', '--override', 'Release blocker, tech owner on leave this week'), dir, merged.io);
    expect(merged.out()).toBe('Merged as owner override. The reason is on #1.');
    expect(gh.pulls[0]).toMatchObject({ merged: true });
  });

  it('products, settings, coverage, docs save (dry run), try', async () => {
    const gh = await withBranch();
    const p = io(gh, {});
    await runStudioRead('products', args('products'), dir, p.io);
    expect(p.out()).toContain('* library      Library (default)');
    expect(p.out()).toContain('  admin        Admin demo  apps/admin');
    const s = io(gh, {});
    await runStudioRead('settings', args('settings'), dir, s.io);
    expect(s.out()).toContain('Owner override: @peterbono.');
    const c = io(gh, {});
    await runStudioRead('coverage', args('coverage', 'Button'), dir, c.io);
    expect(c.out()).toMatch(/Button +Yes/);
    const d = io(gh);
    await expect(runDocsSave(args('docs', 'save', 'Button'), dir, d.io)).rejects.toThrow(/--file docs.json/);
    const t = io(gh, {});
    await runBranch(args('branch', 'try', '1'), dir, t.io);
    // Nothing reported a preview (branches are not deployed): the local way, not one 'no preview' line per app.
    expect(t.out()).toMatch(/Not online: try it locally with git fetch origin && git switch \S+, then start Storybook/);
    expect(t.out()).not.toContain('no preview reported yet');
    expect(t.out()).toContain('Share with a product team: The preview version is being prepared.');
  });
});
