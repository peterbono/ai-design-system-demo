// bridge explore (start, list, promote, close) and the exploration flags of propose and request, with an in-memory GitHub.
import { describe, expect, it } from 'vitest';
import { runExplore } from '../src/explore.js';
import { runRequest, type RequestIO } from '../src/request.js';
import { fakeGitHub, git, REAL_PATHS, REPO, tempGitRepo } from '../../mcp/test/helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';

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
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !['json', 'claude', 'dry-run', 'all'].includes(k) ? argv[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

describe('bridge explore', () => {
  const dir = tempGitRepo(REPO, REAL_PATHS);

  it('start, list, request on it, implement brief, promote, close', async () => {
    const gh = fakeGitHub(OWNER, NAME, { 'README.md': 'hi' });

    const help = io(gh);
    expect(await runExplore(args('explore'), dir, help.io)).toBe(2);
    expect(help.out()).toContain('bridge explore start <name> [--purpose "..."]');
    await expect(runExplore(args('explore', 'start'), dir, io(gh).io)).rejects.toThrow(/Usage: bridge explore start <name>/);
    // No purpose needed: nobody is asked for a brief.
    const free = io(gh);
    expect(await runExplore(args('explore', 'start', 'Billing screen', '--dry-run'), dir, free.io)).toBe(0);
    expect(free.out()).not.toContain('**Purpose.**');
    await expect(runExplore(args('explore', 'nope'), dir, io(gh).io)).rejects.toThrow(/Unknown explore command/);

    const dry = io(gh);
    expect(await runExplore(args('explore', 'start', 'Pill', 'buttons', '--purpose', 'Rounder buttons in checkout.', '--dry-run'), dir, dry.io)).toBe(0);
    expect(dry.out()).toContain(`Branch: explore/pill-buttons (from main in ${OWNER}/${NAME})`);
    expect(gh.pulls).toHaveLength(0);

    const s = io(gh);
    expect(await runExplore(args('explore', 'start', 'Pill', 'buttons', '--purpose', 'Rounder buttons in checkout.', '--use-case', 'stakeholder-demo'), dir, s.io)).toBe(0);
    expect(s.out()).toContain(`Started explore/pill-buttons: draft pull request #1 https://github.com/${OWNER}/${NAME}/pull/1`);
    // No guessed install command: the test build is not published yet.
    expect(s.out()).toContain('The test build is being prepared');
    expect(s.out()).not.toContain('pkg.pr.new');
    expect(s.out()).toContain('Docs: https://bridge-docs-git-explore-pill-buttons-peterbonos-projects.vercel.app/');
    expect(gh.pulls[0]!.labels.map((l: any) => l.name)).toEqual(['exploration']);

    const c = io(gh);
    expect(await runRequest(args('request', 'create', '--component', 'Button', '--kind', 'visual', '--title', 'Pill radius', '--summary', 'Try it.', '--exploration', 'explore/pill-buttons'), dir, c.io)).toBe(0);
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).toContain('exploration');

    const b = io(gh);
    expect(await runRequest(args('request', 'implement', '100'), dir, b.io)).toBe(0);
    expect(b.out()).toContain('Work on the existing branch explore/pill-buttons');
    const b2 = io(gh);
    expect(await runRequest(args('request', 'implement', '100', '--branch', 'explore/other'), dir, b2.io)).toBe(0);
    expect(b2.out()).toContain('explore/other');

    const l = io(gh);
    expect(await runExplore(args('explore', 'list'), dir, l.io)).toBe(0);
    expect(l.out()).toMatch(/^1 exploration running\./);
    expect(l.out()).toMatch(/#1 Pill buttons {2}Running {2}explore\/pill-buttons/);
    expect(l.out()).toContain('Requests: #100');
    expect(l.out()).toContain('Install: The test build is being prepared');
    expect(l.out()).not.toContain('pkg.pr.new');
    const lj = io(gh);
    expect(await runExplore(args('explore', 'list', '--json'), dir, lj.io)).toBe(0);
    expect(JSON.parse(lj.out()).running).toBe(1);

    const pd = io(gh);
    expect(await runExplore(args('explore', 'promote', 'pill-buttons', '--dry-run'), dir, pd.io)).toBe(0);
    expect(pd.out()).toContain('Dry run: would promote #1');
    expect(gh.pulls[0]!.draft).toBe(true);
    const p = io(gh);
    expect(await runExplore(args('explore', 'promote', 'pill-buttons'), dir, p.io)).toBe(0);
    expect(p.out()).toMatch(/Promoted #1 "Pill buttons" to review: Tier 1\./);
    expect(p.out()).toContain('Closes requests #100 when it merges.');
    expect(gh.pulls[0]!.draft).toBe(false);
    expect(gh.pulls[0]!.labels.map((x: any) => x.name)).toEqual(['tier: 1']);

    await runExplore(args('explore', 'start', 'Dense tables', '--purpose', 'Compact rows.'), dir, io(gh).io);
    const cl = io(gh);
    expect(await runExplore(args('explore', 'close', '#2'), dir, cl.io)).toBe(0);
    expect(cl.out()).toContain('Closed #2 (explore/dense-tables)');
    expect(gh.pulls[1]!.state).toBe('closed');
  });

  it('without a token: a local branch only, nothing on GitHub', async () => {
    const gh = fakeGitHub(OWNER, NAME, {});
    const s = io(gh, {});
    expect(await runExplore(args('explore', 'start', 'Warm neutrals', '--purpose', 'Warmer greys.'), dir, s.io)).toBe(0);
    expect(s.out()).toContain('Created the local branch explore/warm-neutrals');
    expect(s.out()).toContain('git push -u origin explore/warm-neutrals');
    expect(git(dir, 'branch', '--list', 'explore/*')).toContain('explore/warm-neutrals');
    expect(gh.log.filter((x) => x.method !== 'GET')).toEqual([]);
  });
});
