// bridge suggestions, bridge review and bridge apply end to end on a temp git repo and an in-memory GitHub: exit codes
// 0 (applied, already applied, clean dry run), 1 (not approved), 2 (usage) and 3 (conflict), and the --suggest and
// --direct flags.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '@bridge-ds/mcp';
import { changesFlag, runApply, runReview, runSuggestions, SuggestUsageError } from '../src/suggest.js';
import type { RequestIO } from '../src/request.js';
import { fakeGitHub, git, readTree, REAL_PATHS, REPO, tempGitRepo } from '../../mcp/test/helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';
const LIGHT = 'packages/tokens/src/semantic/light.tokens.json';

function setup() {
  const dir = tempGitRepo(REPO, REAL_PATHS);
  const cfg = join(dir, 'bridge.config.json');
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/\n\s*"changes": "direct",/, '').replace(/"owners": \{[^}]*\}/, '"owners": { "design": ["designer"], "tech": ["dev"] }'));
  git(dir, 'commit', '-qam', 'suggest mode');
  const gh = fakeGitHub(OWNER, NAME, readTree(dir, REAL_PATHS));
  return { dir, gh };
}

function io(gh: ReturnType<typeof fakeGitHub>) {
  const out: string[] = [];
  const err: string[] = [];
  const value: RequestIO = { print: (s) => out.push(s), error: (s) => err.push(s), env: { GITHUB_TOKEN: 'test-token' }, fetch: gh.fetch, ghToken: () => undefined, hasClaude: () => false, runClaude: () => 0 };
  return { io: value, out: () => out.join('\n'), err: () => err.join('\n'), clear: () => ((out.length = 0), (err.length = 0)) };
}

const args = (...argv: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  const bare = ['json', 'dry-run', 'approve', 'write', 'patch', 'accept-edited', 'force-unapproved', 'suggest', 'direct'];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (x.startsWith('--')) {
      const k = x.slice(2);
      const next = argv[i + 1];
      (a.flags[k] ??= []).push(next !== undefined && !next.startsWith('--') && !bare.includes(k) ? argv[++i]! : 'true');
    } else a._.push(x);
  }
  return a;
};

async function suggest(dir: string, gh: ReturnType<typeof fakeGitHub>, value = '{palette.neutral.700}') {
  const ctx = await BridgeContext.create({ root: dir, token: 'test-token', fetch: gh.fetch });
  const r = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [{ op: 'set', path: 'color.text.muted', value, mode: { theme: 'light' } }], source: 'cli' })) as any;
  expect(r.status).toBe('suggested');
  return r.number as number;
}

describe('bridge suggestions, review, apply', () => {
  // End to end over a real git repo and the whole token set: tens of seconds on a busy machine, so its own timeout.
  it('lists and shows a suggestion, reviews it as each owner, then applies it on a branch (exit 0), again (exit 0)', { timeout: 180_000 }, async () => {
    const { dir, gh } = setup();
    const n = await suggest(dir, gh);
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).toContain('source: cli');
    const t = io(gh);

    expect(await runSuggestions(args('suggestions'), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(new RegExp(`#${n}\\s+Needs review\\s+token-change\\s+tier 3\\s+Tokens: darken muted text`));
    t.clear();
    expect(await runSuggestions(args('suggestions', 'show', String(n)), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(/Missing: design approval and tech approval/);
    expect(t.out()).toMatch(/color\.text\.muted/);
    t.clear();

    // Not approved: exit 1, nothing written.
    expect(await runApply(args('apply', String(n), '--dry-run'), dir, t.io)).toBe(1);
    expect(t.out()).toMatch(/not approved yet/);
    t.clear();

    gh.viewer.login = 'outsider';
    await expect(runReview(args('review', String(n), '--approve'), dir, t.io)).rejects.toThrow(/Only the owners/);
    await expect(runReview(args('review', String(n)), dir, t.io)).rejects.toThrow(SuggestUsageError);
    await expect(runReview(args('review', String(n), '--decline'), dir, t.io)).rejects.toThrow(/needs --message/);
    gh.viewer.login = 'designer';
    expect(await runReview(args('review', String(n), '--approve'), dir, t.io)).toBe(0);
    gh.viewer.login = 'dev';
    expect(await runReview(args('review', String(n), '--approve'), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(/Now: Approved, ready to apply\./);
    t.clear();

    gh.viewer.login = 'developer';
    expect(await runApply(args('apply', String(n), '--dry-run'), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(/Dry run/);
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');
    t.clear();
    expect(await runApply(args('apply', String(n)), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(new RegExp(`branch: bridge/suggestion-${n}-darken-muted-text`));
    expect(t.out()).toMatch(new RegExp(`Closes #${n}`));
    expect(git(dir, 'show', `bridge/suggestion-${n}-darken-muted-text:${LIGHT}`)).toContain('{palette.neutral.700}');
    t.clear();
    expect(await runApply(args('apply', String(n)), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(/Already on bridge\/suggestion-/);

    // --patch prints the patch alone on stdout.
    t.clear();
    expect(await runApply(args('apply', String(n), '--patch'), dir, t.io)).toBe(0);
    expect(t.out()).toMatch(/^From [0-9a-f]{40} /);
    expect(t.out()).toContain('Applies Bridge suggestion');
  });

  it('a conflict with today\'s code exits 3 and writes nothing; usage errors are clear', { timeout: 120_000 }, async () => {
    const { dir, gh } = setup();
    const n = await suggest(dir, gh);
    const t = io(gh);
    for (const who of ['designer', 'dev']) {
      gh.viewer.login = who;
      await runReview(args('review', String(n), '--approve'), dir, t.io);
    }
    const light = join(dir, LIGHT);
    writeFileSync(light, readFileSync(light, 'utf8').replace('"$value": "{palette.neutral.600}"', '"$value": "{palette.neutral.800}"'));
    git(dir, 'commit', '-qam', 'someone else changed it');
    t.clear();
    expect(await runApply(args('apply', String(n)), dir, t.io)).toBe(3);
    expect(t.out()).toMatch(/conflict/);
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');

    await expect(runApply(args('apply'), dir, t.io)).rejects.toThrow(/Usage: bridge apply <number>/);
    await expect(runApply(args('apply', String(n), '--write', '--patch'), dir, t.io)).rejects.toThrow(/not both/);
    expect(changesFlag(args('propose', '--direct'))).toBe('direct');
    expect(changesFlag(args('propose', '--suggest'))).toBe('suggest');
    expect(changesFlag(args('propose'))).toBeUndefined();
    expect(() => changesFlag(args('propose', '--suggest', '--direct'))).toThrow(/not both/);
  });
});
