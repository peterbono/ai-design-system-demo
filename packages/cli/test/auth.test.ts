// Which GitHub token a command uses (src/auth.ts). The rule under test: a write never uses a credential the person did
// not pass for it. Signed in with gh but no GITHUB_TOKEN, --token or --use-gh-auth, no write command sends a single
// request that changes GitHub, whatever it then says; reads may use the gh sign-in, say so, and cannot write either.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BridgeContext, branches, ops } from '@bridge-ds/mcp';
import { chooseToken, cliContext, GH_READ_NOTE, TOKEN_HELP } from '../src/auth.js';
import { BRANCH_HELP, runBranch, runDocsSave } from '../src/branch.js';
import { EXPLORE_HELP, runExplore } from '../src/explore.js';
import { FIGMA_HELP, runFigma } from '../src/figma.js';
import { PIECES_HELP, runPieces } from '../src/pieces.js';
import { REQUEST_HELP, runRequest, type RequestIO } from '../src/request.js';
import { runApply, runReview, runSuggestions, SUGGESTIONS_HELP } from '../src/suggest.js';
import { fakeGitHub, pinStart, readTree, REAL_PATHS, REPO, tempGitRepo, withoutSoloOwner } from '../../mcp/test/helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';

/** Signed in with gh (a token is there for the taking), nothing in the environment. */
function signedInWithGh(gh: ReturnType<typeof fakeGitHub>, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let ghCalls = 0;
  const value: RequestIO = {
    print: (s) => out.push(s),
    error: (s) => err.push(s),
    env,
    fetch: gh.fetch,
    ghToken: () => (ghCalls++, 'gho_from_gh_sign_in'),
    hasClaude: () => false,
    runClaude: () => 0,
  };
  return { io: value, out: () => out.join('\n'), err: () => err.join('\n'), ghCalls: () => ghCalls };
}

const args = (...argv: string[]) => {
  const a = { _: [] as string[], flags: {} as Record<string, string[]> };
  const bare = ['json', 'dry-run', 'approve', 'write', 'patch', 'record', 'use-gh-auth', 'all', 'direct', 'suggest'];
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

/** Requests that change GitHub: anything but GET and HEAD, and GraphQL mutations. */
const writes = (gh: ReturnType<typeof fakeGitHub>) => gh.log.filter((l) => l.method !== 'GET' && l.method !== 'HEAD' && !(l.path === 'graphql' && !/^\s*mutation/.test(String(l.body?.query ?? ''))));

/** Runs a command and keeps whatever it ends with: a code or an error message. */
const settle = (p: Promise<number>) => p.then((code) => ({ code, error: '' }), (e: Error) => ({ code: 2, error: e.message }));

async function repoWithBranch() {
  const gh = fakeGitHub(OWNER, NAME, withoutSoloOwner(pinStart(readTree(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']))));
  const ctx = await BridgeContext.create({ repo: `${OWNER}/${NAME}`, token: 't', fetch: gh.fetch });
  await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } }], changes: 'direct' });
  // Seed an issue too, so the suggestion and request commands have something to act on.
  await (await ctx.github())!.createIssue({ title: 'Seed', body: 'seed', labels: ['bridge-suggestion'] });
  gh.log.length = 0;
  return gh;
}

describe('GitHub tokens: writes only with a token passed on purpose', () => {
  const dir = tempGitRepo(REPO, [...REAL_PATHS, 'packages/react/component-specs.json']);

  it('chooseToken: a write never reads the gh sign-in on its own; --token, the environment and --use-gh-auth do', () => {
    const gh = fakeGitHub(OWNER, NAME, {});
    const t = signedInWithGh(gh);
    expect(chooseToken(args('x'), t.io, 'write')).toEqual({ origin: 'none' });
    expect(t.ghCalls()).toBe(0);
    expect(chooseToken(args('x'), t.io, 'local')).toEqual({ origin: 'none' });
    expect(chooseToken(args('x', '--use-gh-auth'), t.io, 'write')).toEqual({ token: 'gho_from_gh_sign_in', origin: 'gh' });
    expect(chooseToken(args('x', '--token', 'ghp_passed'), t.io, 'write')).toEqual({ token: 'ghp_passed', origin: 'flag' });
    expect(chooseToken(args('x'), signedInWithGh(gh, { GITHUB_TOKEN: 'ghp_env' }).io, 'write')).toEqual({ token: 'ghp_env', origin: 'env' });
    expect(chooseToken(args('x'), signedInWithGh(gh, { BRIDGE_GITHUB_TOKEN: 'ghp_bridge' }).io, 'write')).toEqual({ token: 'ghp_bridge', origin: 'env' });
    // A read may borrow the gh sign-in, and says so in one line on stderr.
    const r = signedInWithGh(gh);
    expect(chooseToken(args('x'), r.io, 'read')).toEqual({ token: 'gho_from_gh_sign_in', origin: 'gh' });
    expect(r.err()).toBe(GH_READ_NOTE);
    expect(GH_READ_NOTE.split('\n')).toHaveLength(1);
  });

  it('no write command changes GitHub with only a gh sign-in around', { timeout: 120_000 }, async () => {
    const gh = await repoWithBranch();
    const docs = join(mkdtempSync(join(tmpdir(), 'bridge-test-docs-')), 'docs.json');
    writeFileSync(docs, JSON.stringify({ summary: 'A button.' }));
    const diff = join(mkdtempSync(join(tmpdir(), 'bridge-test-diff-')), 'diff.json');
    writeFileSync(diff, JSON.stringify({ v: 1, component: 'Button', figmaName: 'Button', coded: true, kind: 'variant', title: 'x', summary: 'y', changes: [], rebinds: [], needsCode: [], unknown: [] }));
    const commands: [string, (io: RequestIO) => Promise<number>][] = [
      ['branch ready', (io) => runBranch(args('branch', 'ready', '1'), dir, io)],
      ['branch draft', (io) => runBranch(args('branch', 'draft', '1'), dir, io)],
      ['branch review', (io) => runBranch(args('branch', 'review', '1', '--approve'), dir, io)],
      ['branch ask', (io) => runBranch(args('branch', 'ask', '1'), dir, io)],
      ['branch comment', (io) => runBranch(args('branch', 'comment', '1', 'hello'), dir, io)],
      ['branch merge', (io) => runBranch(args('branch', 'merge', '1'), dir, io)],
      ['branch merge --override', (io) => runBranch(args('branch', 'merge', '1', '--override', 'Release blocker, tech owner on leave this week'), dir, io)],
      ['branch update', (io) => runBranch(args('branch', 'update', '1'), dir, io)],
      ['branch close', (io) => runBranch(args('branch', 'close', '1'), dir, io)],
      ['branch reopen', (io) => runBranch(args('branch', 'reopen', '1'), dir, io)],
      ['docs save', (io) => runDocsSave(args('docs', 'save', 'Button', '--file', docs, '--suggest'), dir, io)],
      ['request create', (io) => runRequest(args('request', 'create', '--component', 'Button', '--kind', 'new-variant', '--title', 'Add a ghost', '--summary', 'Quieter.'), dir, io)],
      ['explore start', (io) => runExplore(args('explore', 'start', 'Pill buttons', '--purpose', 'Rounder?'), dir, io)],
      ['explore promote', (io) => runExplore(args('explore', 'promote', '#1'), dir, io)],
      ['explore close', (io) => runExplore(args('explore', 'close', '#1'), dir, io)],
      ['suggestions link', (io) => runSuggestions(args('suggestions', 'link', '2', '--pr', '1'), dir, io)],
      ['review', (io) => runReview(args('review', '2', '--approve'), dir, io)],
      ['apply', (io) => runApply(args('apply', '2'), dir, io)],
      ['figma drafted', (io) => runFigma(args('figma', 'drafted', '1'), dir, io)],
      ['figma push', (io) => runFigma(args('figma', 'push', diff, '--suggest'), dir, io)],
      ['pieces 1 --record', (io) => runPieces(args('pieces', '1', '--record'), dir, io)],
      ['pieces switch', (io) => runPieces(args('pieces', 'switch', '1'), dir, io)],
    ];
    for (const [name, run] of commands) {
      const t = signedInWithGh(gh);
      const r = await settle(run(t.io));
      expect({ name, writes: writes(gh), ghCalls: t.ghCalls() }).toEqual({ name, writes: [], ghCalls: 0 });
      // When it fails for want of a token, it says how to pass one in the words of the CLI.
      if (/needs a (GitHub )?token/.test(r.error)) expect(r.error).toMatch(/--token|--use-gh-auth/);
    }
    // The same request with the gh sign-in passed on purpose goes through.
    const t = signedInWithGh(gh);
    expect(await runBranch(args('branch', 'comment', '1', 'hello', '--use-gh-auth'), dir, t.io)).toBe(0);
    expect(writes(gh).map((w) => w.method)).toEqual(['POST']);
    expect(t.err()).not.toContain(GH_READ_NOTE);
  });

  it('a read may use the gh sign-in (one line on stderr), and that context refuses every write', async () => {
    const gh = await repoWithBranch();
    const t = signedInWithGh(gh);
    expect(await runBranch(args('branch', 'status', '1'), dir, t.io)).toBe(0);
    expect(t.ghCalls()).toBe(1);
    expect(t.err()).toBe(GH_READ_NOTE);
    expect(gh.log.some((l) => l.path === 'user')).toBe(false);
    expect(writes(gh)).toEqual([]);

    // Defense in depth: even an operation that writes, given the read context, sends nothing.
    const ctx = await cliContext(dir, t.io, args('branch', 'status', '1'), 'read');
    expect(ctx.canWriteRemote).toBe(false);
    expect(ctx.access()).toMatch(/^Read-only on GitHub/);
    const gh2 = (await ctx.github())!;
    await expect(gh2.createIssueComment(1, 'should not post')).rejects.toThrow(/only reads GitHub, with your gh sign-in, so Bridge refused/);
    await expect(branches.commentOnBranch(ctx, { pr: 1, body: 'x' })).rejects.toThrow(/--token|--use-gh-auth/);
    expect(writes(gh)).toEqual([]);
  });

  it('the rate-limit message says how to add a token in the words of each surface (AUD-3)', async () => {
    const limited = (async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const t = signedInWithGh(fakeGitHub(OWNER, NAME, {}));
    t.io.fetch = limited;
    t.io.ghToken = () => undefined;
    const cli = await cliContext(dir, t.io, args('branch', 'list'), 'read');
    const cliError = await (await cli.github())!.getRepo().then(() => '', (e: Error) => e.message);
    expect(cliError).toMatch(/hourly limit/);
    expect(cliError).toContain('pass --token <token>');
    expect(cliError).not.toMatch(/MCP server/);
    const mcp = await BridgeContext.create({ root: dir, fetch: limited });
    const mcpError = await (await mcp.github())!.getRepo().then(() => '', (e: Error) => e.message);
    expect(mcpError).toMatch(/environment of the Bridge MCP server/);
    expect(mcpError).not.toMatch(/--token/);
  });

  it('every GitHub command says the same about tokens in its help', () => {
    for (const help of [BRANCH_HELP, EXPLORE_HELP, FIGMA_HELP, PIECES_HELP, REQUEST_HELP, SUGGESTIONS_HELP]) {
      expect(help).toContain(TOKEN_HELP);
      expect(help).not.toMatch(/else `gh auth token`/);
    }
  });

  it('merge --dry-run only reads: no write token needed (AUD-5)', async () => {
    const gh = await repoWithBranch();
    const t = signedInWithGh(gh);
    const code = await runBranch(args('branch', 'merge', '1', '--dry-run'), dir, t.io);
    expect(t.out()).toMatch(/cannot be merged yet|Every rule Bridge can check without a token passes/);
    expect(code).toBe(/cannot be merged yet/.test(t.out()) ? 1 : 0);
    expect(writes(gh)).toEqual([]);
    // No token at all, nothing signed in: the same answer, and how to check who may merge.
    const none = signedInWithGh(gh);
    none.io.ghToken = () => undefined;
    await runBranch(args('branch', 'merge', '1', '--dry-run'), dir, none.io);
    expect(none.out()).toMatch(/cannot be merged yet|passes/);
  });
});
