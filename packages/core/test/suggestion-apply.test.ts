import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeSuggestionIssue,
  composeSuggestionReviewComment,
  gitBlobSha,
  loadConfig,
  parseSuggestionIssue,
  planSuggestionApply,
  SUGGESTION_SCHEMA,
  suggestionAppliedComment,
  suggestionApplyTable,
  suggestionPayloadSha,
  type BridgeConfig,
  type SuggestionCommentLike,
  type SuggestionPayloadV1,
  type SuggestionWorkspace,
} from '../src/index';
import { applySuggestionLocally } from '../src/node/index';

// A small design system: two primitives files, light and dark semantic files, one contrast pair, two owners.
const CONFIG = {
  repo: 'acme/ds',
  tokens: { root: 'tokens' },
  modes: { themes: ['light', 'dark'] },
  contrast: { path: 'tokens/contrast.checks.json' },
  changeset: { package: '@acme/tokens' },
  components: { dir: 'src/components' },
  governance: { owners: { design: ['dana'], tech: ['theo'] } },
};
const config: BridgeConfig = loadConfig(CONFIG);

const PRIMITIVES = `{
  "color": {
    "$type": "color",
    "white": { "$value": "#ffffff" },
    "ink": { "$value": "#111111" },
    "pale": { "$value": "#eeeeee" },
    "blue": {
      "500": { "$value": "#2f6f8f" },
      "700": { "$value": "#1d4a60" }
    }
  }
}
`;
const semantic = (bg = '{color.blue.500}', fg = '{color.white}') => `{
  "action": {
    "$type": "color",
    "bg": { "$value": "${bg}" },
    "fg": { "$value": "${fg}" }
  }
}
`;
const CHECKS = '{ "pairs": [["action.fg", "action.bg", 4.5]] }\n';
const CHANGESET = '---\n"@acme/tokens": minor\n---\n\nDarker primary action.\n';
const NOTES = ['# Notes', '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', ''].join('\n');

const initialFiles = (): Record<string, string> => ({
  'bridge.config.json': `${JSON.stringify(CONFIG, null, 2)}\n`,
  'tokens/primitives/color.tokens.json': PRIMITIVES,
  'tokens/semantic/light.tokens.json': semantic(),
  'tokens/semantic/dark.tokens.json': semantic(),
  'tokens/contrast.checks.json': CHECKS,
  'docs/notes.md': NOTES,
});

const BASE = 'a'.repeat(40);

function payload(over: Partial<SuggestionPayloadV1> = {}): SuggestionPayloadV1 {
  return {
    schema: SUGGESTION_SCHEMA,
    kind: 'token-change',
    title: 'Darker primary action',
    summary: 'The primary action reads stronger on light backgrounds.',
    source: 'studio',
    suggestedBy: 'ana',
    createdAt: '2026-10-21T09:00:00.000Z',
    base: { ref: 'main', sha: BASE },
    tier: { tier: 3, bump: 'minor' },
    tokens: {
      edits: [{ op: 'set', path: 'action.bg', value: '{color.blue.700}', file: 'semantic/light.tokens.json' }],
      changes: [{ kind: 'changed', path: 'action.bg', file: 'semantic/light.tokens.json', before: '{color.blue.500}', after: '{color.blue.700}' }],
    },
    files: [{ path: '.changeset/bridge-darker-primary-action.md', beforeSha: null, afterSha: gitBlobSha(CHANGESET), content: CHANGESET }],
    checks: { newErrors: 0, contrast: [], blocked: null, impact: 0 },
    ...over,
  };
}

/** The suggestion as a developer reads it from GitHub: composed into an issue body, then parsed back. */
function parsedOf(p: SuggestionPayloadV1) {
  const issue = composeSuggestionIssue(p, { repo: 'acme/ds' });
  const parsed = parseSuggestionIssue(issue.body, { comments: issue.parts.map((body) => ({ body, author: 'ana' })), author: 'ana' });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed;
}

const review = (author: string, p: SuggestionPayloadV1, event: 'approve' | 'request-changes' = 'approve', sha = suggestionPayloadSha(p)): SuggestionCommentLike => ({
  author,
  body: composeSuggestionReviewComment({ event, payloadSha: sha, at: '2026-10-21T10:00:00.000Z', by: author }),
  createdAt: '2026-10-21T10:00:00.000Z',
});
const approvedBoth = (p: SuggestionPayloadV1) => [review('dana', p), review('theo', p)];

/** An in-memory tree, with a count of reads so a refusal can be shown to read nothing. */
function memoryWorkspace(files: Record<string, string>, opts: { links?: string[] } = {}): SuggestionWorkspace & { reads: number } {
  const ws = {
    reads: 0,
    async read(path: string) {
      ws.reads++;
      const text = files[path];
      return text === undefined ? null : { text, sha: gitBlobSha(text) };
    },
    async readAt() {
      return null;
    },
    async list() {
      return Object.keys(files);
    },
    async isSymlink(path: string) {
      return (opts.links ?? []).some((l) => path === l || path.startsWith(`${l}/`));
    },
  };
  return ws;
}

const plan = (p: SuggestionPayloadV1, files: Record<string, string>, extra: Partial<Parameters<typeof planSuggestionApply>[0]> = {}) =>
  planSuggestionApply({ parsed: parsedOf(p), config, comments: approvedBoth(p), author: 'ana', workspace: memoryWorkspace(files), ...extra });

describe('planSuggestionApply: token edits on the current tokens', () => {
  it('applies an approved token change: the token file and the changeset', async () => {
    const r = await plan(payload(), initialFiles());
    expect(r.outcome).toBe('ready');
    expect(r.exitCode).toBe(0);
    expect(r.ops.map((o) => o.state)).toEqual(['apply', 'apply']);
    expect(r.writes.map((w) => w.path)).toEqual(['.changeset/bridge-darker-primary-action.md', 'tokens/semantic/light.tokens.json']);
    expect(r.writes[1]!.content).toContain('"$value": "{color.blue.700}"');
    // Minimal diff: the dark file and every other line stay as they are.
    expect(r.writes[1]!.content).toBe(semantic('{color.blue.700}'));
    expect(r.checks?.tier.tier).toBe(3);
    expect(r.checks?.newFailures).toEqual([]);
    expect(suggestionApplyTable(r)).toContain('| `action.bg` | apply |');
  });

  it('is a no-op on a tree that already has the change', async () => {
    const files = { ...initialFiles(), 'tokens/semantic/light.tokens.json': semantic('{color.blue.700}'), '.changeset/bridge-darker-primary-action.md': CHANGESET };
    const r = await plan(payload(), files);
    expect(r.outcome).toBe('already-applied');
    expect(r.exitCode).toBe(0);
    expect(r.writes).toEqual([]);
    expect(r.ops.every((o) => o.state === 'already-applied')).toBe(true);
  });

  it('reports a conflict when the value changed on main since it was suggested', async () => {
    const files = { ...initialFiles(), 'tokens/semantic/light.tokens.json': semantic('{color.ink}') };
    const r = await plan(payload(), files);
    expect(r.outcome).toBe('conflict');
    expect(r.exitCode).toBe(3);
    expect(r.writes).toEqual([]);
    const c = r.ops.find((o) => o.state === 'conflict')!;
    expect(c).toMatchObject({ path: 'action.bg', before: '{color.blue.500}', after: '{color.blue.700}', now: '{color.ink}' });
    expect(r.message).toMatch(/refresh the suggestion/);
  });

  it('a set on a token removed since is a conflict', async () => {
    const files = { ...initialFiles(), 'tokens/semantic/light.tokens.json': '{ "action": { "$type": "color", "fg": { "$value": "{color.white}" } } }\n' };
    const r = await plan(payload(), files);
    expect(r.outcome).toBe('conflict');
    expect(r.ops[0]!.detail).toMatch(/no longer exists/);
  });

  it('renames a token everywhere, then sees it as applied', async () => {
    const p = payload({
      tier: { tier: 3, bump: 'major' },
      tokens: {
        edits: [{ op: 'rename', path: 'action.fg', newPath: 'action.text' }],
        changes: ['light', 'dark'].map((t) => ({ kind: 'renamed' as const, path: 'action.text', from: 'action.fg', file: `semantic/${t}.tokens.json`, before: '{color.white}', after: '{color.white}' })),
      },
      files: undefined,
    });
    const files = { ...initialFiles(), 'tokens/contrast.checks.json': '{ "pairs": [] }\n' };
    const r = await plan(p, files);
    expect(r.outcome).toBe('ready');
    expect(r.writes.map((w) => w.path)).toEqual(['tokens/semantic/dark.tokens.json', 'tokens/semantic/light.tokens.json']);
    expect(r.writes[0]!.content).toContain('"text"');
    const again = await plan(p, { ...files, ...Object.fromEntries(r.writes.map((w) => [w.path, w.content!])) });
    expect(again.outcome).toBe('already-applied');
    expect(again.ops[0]!.detail).toMatch(/Already renamed/);
  });

  it('stops when the tier recomputed on today\'s tree is higher than the approved one', async () => {
    const p = payload({ tier: { tier: 1, bump: 'patch' }, files: undefined });
    const r = await plan(p, initialFiles(), { comments: [review('dana', p)] });
    expect(r.outcome).toBe('blocked');
    expect(r.exitCode).toBe(1);
    expect(r.checks?.tierIncreased).toBe(true);
    expect(r.message).toMatch(/tier 3 change, it was approved as tier 1/);
    const forced = await plan(p, initialFiles(), { comments: [review('dana', p)], forceUnapproved: true });
    expect(forced.outcome).toBe('ready');
    expect(forced.gate?.forced).toBe(true);
  });

  it('stops when a contrast pair that passes today would fail', async () => {
    // Suggested when the label was ink: a pale background was fine. Since then the label became white.
    const p = payload({
      tokens: {
        edits: [{ op: 'set', path: 'action.bg', value: '{color.pale}', file: 'semantic/light.tokens.json' }],
        changes: [{ kind: 'changed', path: 'action.bg', file: 'semantic/light.tokens.json', before: '{color.blue.500}', after: '{color.pale}' }],
      },
      files: undefined,
    });
    const r = await plan(p, initialFiles());
    expect(r.outcome).toBe('blocked');
    expect(r.checks?.newFailures.map((d) => `${d.fg} on ${d.bg}`)).toEqual(['action.fg on action.bg']);
    expect(r.message).toMatch(/contrast pair\(s\) would fail/);
    expect(r.writes).toEqual([]);
    // Forcing approvals never overrides the contrast gate.
    expect((await plan(p, initialFiles(), { forceUnapproved: true })).outcome).toBe('blocked');
  });
});

describe('planSuggestionApply: the approval gate', () => {
  it('needs the owners on the current payload: missing, stale and non-owner reviews do not count', async () => {
    const p = payload();
    const none = await plan(p, initialFiles(), { comments: [] });
    expect(none.outcome).toBe('not-approved');
    expect(none.exitCode).toBe(1);
    // A token value suggestion needs the design approval only (decision TV-1).
    expect(none.gate?.missing).toEqual(['design']);
    expect(none.writes).toEqual([]);
    // Ops are still planned, so a dry run shows what would happen.
    expect(none.ops.length).toBe(2);

    const stale = await plan(p, initialFiles(), { comments: [review('dana', p, 'approve', 'f'.repeat(64)), review('theo', p), review('mallory', p)] });
    expect(stale.outcome).toBe('not-approved');
    expect(stale.gate?.approvals.stale).toEqual(['dana']);
    expect(stale.gate?.approvals.ignored).toEqual(['mallory']);
    expect(stale.message).toMatch(/missing design approval/);

    const asked = await plan(p, initialFiles(), { comments: [review('dana', p), review('theo', p, 'request-changes')] });
    expect(asked.message).toMatch(/changes requested by @theo/);

    const forced = await plan(p, initialFiles(), { comments: [], forceUnapproved: true });
    expect(forced.outcome).toBe('ready');
    expect(suggestionAppliedComment(forced, { by: 'dev', branch: 'bridge/x', at: '2026-10-21T11:00:00Z' })).toMatch(/Applied before every approval was in\./);
  });

  it('the author never approves their own suggestion', async () => {
    const p = payload();
    // dana, the design owner, sent it: her approval does not count, and theo's tech approval does not cover the look.
    const r = await plan(p, initialFiles(), { comments: [review('dana', p), review('theo', p)], author: 'dana' });
    expect(r.outcome).toBe('not-approved');
  });

  it('refuses a payload edited by hand unless the developer accepts it', async () => {
    const p = payload();
    const parsed = { ...parsedOf(p), edited: true };
    const r = await planSuggestionApply({ parsed, config, comments: approvedBoth(p), author: 'ana', workspace: memoryWorkspace(initialFiles()) });
    expect(r.outcome).toBe('refused');
    expect(r.message).toMatch(/edited by hand/);
    const ok = await planSuggestionApply({ parsed, config, comments: approvedBoth(p), author: 'ana', workspace: memoryWorkspace(initialFiles()), acceptEdited: true });
    expect(ok.outcome).toBe('ready');
    expect(ok.gate?.edited).toBe(true);
  });
});

describe('planSuggestionApply: path rules', () => {
  it('refuses unsafe paths and guardrails before reading anything', async () => {
    for (const path of ['../outside.md', '/etc/passwd', 'AGENTS.md', '.github/workflows/ci.yml', 'src/app.ts']) {
      const p = payload({ files: [{ path, beforeSha: null, afterSha: gitBlobSha('x'), content: 'x' }] });
      const ws = memoryWorkspace(initialFiles());
      const r = await planSuggestionApply({ parsed: parsedOf(p), config, comments: approvedBoth(p), author: 'ana', workspace: ws });
      expect(r.outcome, path).toBe('refused');
      expect(r.problems.length, path).toBeGreaterThan(0);
      expect(ws.reads, path).toBe(0);
    }
  });

  it('refuses content that does not match its recorded sha', async () => {
    const p = payload({ files: [{ path: '.changeset/x.md', beforeSha: null, afterSha: gitBlobSha('other'), content: 'x' }] });
    const r = await plan(p, initialFiles());
    expect(r.outcome).toBe('refused');
    expect(r.problems[0]).toMatch(/does not match/);
  });

  it('refuses to write through a symbolic link', async () => {
    const p = payload();
    const r = await planSuggestionApply({ parsed: parsedOf(p), config, comments: approvedBoth(p), author: 'ana', workspace: memoryWorkspace(initialFiles(), { links: ['.changeset'] }) });
    expect(r.outcome).toBe('refused');
    expect(r.problems[0]).toMatch(/symbolic link/);
  });
});

describe('planSuggestionApply: docs and component specs', () => {
  const docs = { summary: 'A button starts an action.', whenToUse: ['One main action per view.'], whenNotToUse: [], dos: [], donts: [], accessibility: [] };
  it('writes docs field by field, then sees them as applied', async () => {
    const p = payload({ kind: 'docs', tier: { tier: 1, bump: 'patch' }, tokens: undefined, files: undefined, docs: [{ component: 'Button', path: 'src/components/Button/Button.docs.json', after: docs }] });
    const files = initialFiles();
    const r = await plan(p, files, { comments: [review('dana', p)] });
    expect(r.outcome).toBe('ready');
    expect(r.writes[0]!.path).toBe('src/components/Button/Button.docs.json');
    expect(JSON.parse(r.writes[0]!.content!).summary).toBe(docs.summary);
    const again = await plan(p, { ...files, [r.writes[0]!.path]: r.writes[0]!.content! }, { comments: [review('dana', p)] });
    expect(again.outcome).toBe('already-applied');
  });

  it('a component spec writes the spec file and hands over the brief', async () => {
    const p = payload({ kind: 'component-spec', tier: { tier: 2, bump: 'minor' }, tokens: undefined, files: undefined, componentSpec: { component: 'Badge', specPath: '.bridge/figma/badge.json', spec: { variants: ['danger'] }, brief: 'Add a danger tone to Badge.' } });
    const r = await plan(p, initialFiles());
    expect(r.outcome).toBe('ready');
    expect(r.brief).toBe('Add a danger tone to Badge.');
    expect(r.writes).toEqual([{ path: '.bridge/figma/badge.json', content: '{\n  "variants": [\n    "danger"\n  ]\n}\n' }]);
  });
});

describe('the issue tells developers how to apply it', () => {
  it('mentions the CLI, Claude Code with the Bridge MCP and the one-time install command', () => {
    const body = composeSuggestionIssue(payload(), { repo: 'acme/ds' }).body;
    expect(body).toContain('bridge apply <this issue number>');
    expect(body).toContain('Claude Code with the Bridge MCP server');
    expect(body).toContain('`claude mcp add bridge -s user -- npx -y @bridge-ds/mcp --repo acme/ds`');
    expect(composeSuggestionIssue(payload()).body).toContain('--repo <owner/name>`');
    expect(body).not.toMatch(/\u2014/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// On a real git checkout (temp repo)

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(files: Record<string, string> = initialFiles()) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-apply-'));
  dirs.push(dir);
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  const write = (fs: Record<string, string>) => {
    for (const [p, t] of Object.entries(fs)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), t);
    }
  };
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Dev');
  g('config', 'user.email', 'dev@example.com');
  write(files);
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  const base = g('rev-parse', 'HEAD').trim();
  const commit = (fs: Record<string, string>, msg = 'change') => {
    write(fs);
    g('add', '-A');
    g('commit', '-q', '-m', msg);
  };
  return { dir, g, base, write, commit };
}

const local = (r: ReturnType<typeof repo>, p: SuggestionPayloadV1, extra: Partial<Parameters<typeof applySuggestionLocally>[0]> = {}) =>
  applySuggestionLocally({ root: r.dir, number: 12, parsed: parsedOf(p), comments: approvedBoth(p), author: 'ana', by: 'dev', now: () => '2026-10-21T11:00:00.000Z', ...extra });

describe('applySuggestionLocally', () => {
  it('default: one commit on a new local branch, working tree and checked-out branch untouched; a second run reuses it', async () => {
    const r = repo();
    const p = payload({ base: { ref: 'main', sha: r.base } });
    const res = await local(r, p);
    expect(res.status).toBe('branch-created');
    expect(res.exitCode).toBe(0);
    expect(res.branch).toBe('bridge/suggestion-12-darker-primary-action');
    expect(r.g('status', '--porcelain').trim()).toBe('');
    expect(r.g('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(r.g('show', `${res.branch}:tokens/semantic/light.tokens.json`)).toContain('{color.blue.700}');
    expect(r.g('log', '-1', '--format=%B', res.branch!)).toContain('Applies Bridge suggestion #12');
    expect(res.diff).toMatch(/\+\s+"bg": \{ "\$value": "\{color\.blue\.700\}" \}/);
    expect(res.appliedComment).toContain('on `bridge/suggestion-12-darker-primary-action`');
    expect(res.appliedComment).toContain('<!-- bridge-suggestion-applied');

    const again = await local(r, p);
    expect(again.status).toBe('branch-exists');
    expect(again.branch).toBe(res.branch);
    expect(again.commit).toBe(res.commit);
    expect(r.g('branch', '--list').split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('takes -2 when a branch of that name exists without the change', async () => {
    const r = repo();
    r.g('branch', 'bridge/suggestion-12-darker-primary-action');
    const res = await local(r, payload({ base: { ref: 'main', sha: r.base } }));
    expect(res.branch).toBe('bridge/suggestion-12-darker-primary-action-2');
  });

  it('dry run writes nothing and shows the diff', async () => {
    const r = repo();
    const before = r.g('for-each-ref').trim();
    const res = await local(r, payload({ base: { ref: 'main', sha: r.base } }), { dryRun: true });
    expect(res.status).toBe('dry-run');
    expect(res.exitCode).toBe(0);
    expect(res.diff).toContain('--- /dev/null');
    expect(res.diff).toContain('+++ b/.changeset/bridge-darker-primary-action.md');
    expect(res.diff).toContain('+++ b/tokens/semantic/light.tokens.json');
    expect(r.g('status', '--porcelain').trim()).toBe('');
    expect(r.g('for-each-ref').trim()).toBe(before);
    expect(res.appliedComment).toBeUndefined();
  });

  it('write: files in the working tree, idempotent, refused over uncommitted changes', async () => {
    const r = repo();
    const p = payload({ base: { ref: 'main', sha: r.base } });
    const res = await local(r, p, { mode: 'write' });
    expect(res.status).toBe('written');
    expect(res.written).toEqual(['.changeset/bridge-darker-primary-action.md', 'tokens/semantic/light.tokens.json']);
    expect(readFileSync(join(r.dir, 'tokens/semantic/light.tokens.json'), 'utf8')).toBe(semantic('{color.blue.700}'));
    expect(readFileSync(join(r.dir, '.changeset/bridge-darker-primary-action.md'), 'utf8')).toBe(CHANGESET);
    const again = await local(r, p, { mode: 'write' });
    expect(again.status).toBe('already-applied');
    expect(again.exitCode).toBe(0);

    const r2 = repo();
    writeFileSync(join(r2.dir, 'tokens/semantic/light.tokens.json'), `${semantic()} `);
    const dirty = await local(r2, payload({ base: { ref: 'main', sha: r2.base } }), { mode: 'write' });
    expect(dirty.status).toBe('refused');
    expect(dirty.message).toMatch(/uncommitted changes: tokens\/semantic\/light\.tokens\.json/);
  });

  it('patch: a format-patch text, no branch created', async () => {
    const r = repo();
    const res = await local(r, payload({ base: { ref: 'main', sha: r.base } }), { mode: 'patch' });
    expect(res.status).toBe('patch');
    expect(res.patch).toMatch(/^From [0-9a-f]{40} /);
    expect(res.patch).toContain('Subject: [PATCH] feat(tokens): Darker primary action');
    expect(res.patch).toContain('+++ b/tokens/semantic/light.tokens.json');
    expect(r.g('branch', '--list').trim()).toBe('* main');
    // The patch applies on the checkout.
    writeFileSync(join(r.dir, '..', `${r.dir.split('/').pop()}.patch`), res.patch!);
    r.g('am', '-q', join(r.dir, '..', `${r.dir.split('/').pop()}.patch`));
    rmSync(join(r.dir, '..', `${r.dir.split('/').pop()}.patch`));
    expect((await local(r, payload({ base: { ref: 'main', sha: r.base } }))).status).toBe('already-applied');
  });

  describe('whole files: blob shas, then a 3-way merge', () => {
    const edited = NOTES.replace('two', 'TWO');
    const notesPayload = (base: string) =>
      payload({ kind: 'revert', tier: { tier: 1, bump: 'patch' }, tokens: undefined, files: [{ path: 'docs/notes.md', beforeSha: gitBlobSha(NOTES), afterSha: gitBlobSha(edited), content: edited }], base: { ref: 'main', sha: base } });
    const approvedOne = (p: SuggestionPayloadV1) => [review('dana', p)];

    it('applies when the file is as it was, sees it applied when it has the result', async () => {
      const r = repo();
      const p = notesPayload(r.base);
      const res = await local(r, p, { mode: 'write', comments: approvedOne(p) });
      expect(res.plan.ops[0]!.state).toBe('apply');
      expect(readFileSync(join(r.dir, 'docs/notes.md'), 'utf8')).toBe(edited);
      expect((await local(r, p, { mode: 'write', comments: approvedOne(p) })).status).toBe('already-applied');
    });

    it('merges cleanly when main changed another part of the file', async () => {
      const r = repo();
      r.commit({ 'docs/notes.md': NOTES.replace('six', 'SIX') });
      const p = notesPayload(r.base);
      const res = await local(r, p, { comments: approvedOne(p) });
      expect(res.status).toBe('branch-created');
      expect(res.plan.ops[0]!.state).toBe('apply-merged');
      const text = r.g('show', `${res.branch}:docs/notes.md`);
      expect(text).toContain('TWO');
      expect(text).toContain('SIX');
    });

    it('reports a conflict when main changed the same lines, and writes nothing', async () => {
      const r = repo();
      r.commit({ 'docs/notes.md': NOTES.replace('two', 'deux') });
      const p = notesPayload(r.base);
      const res = await local(r, p, { comments: approvedOne(p) });
      expect(res.status).toBe('conflict');
      expect(res.exitCode).toBe(3);
      expect(res.plan.ops[0]).toMatchObject({ state: 'conflict', hunks: 1 });
      expect(r.g('branch', '--list').trim()).toBe('* main');
    });

    it('cannot merge without the base commit: a conflict, not a guess', async () => {
      const r = repo();
      r.commit({ 'docs/notes.md': NOTES.replace('six', 'SIX') });
      const p = notesPayload('b'.repeat(40));
      const res = await local(r, p, { comments: approvedOne(p) });
      expect(res.status).toBe('conflict');
      expect(res.plan.ops[0]!.detail).toMatch(/cannot be read/);
    });

    it('a new file that exists now with other content is a conflict', async () => {
      const r = repo();
      r.commit({ '.changeset/bridge-darker-primary-action.md': 'other\n' });
      const res = await local(r, payload({ base: { ref: 'main', sha: r.base } }));
      expect(res.status).toBe('conflict');
      expect(res.plan.ops.find((o) => o.type === 'file')!.detail).toMatch(/different one exists/);
    });

    it('refuses to write through a symbolic link in the checkout', async () => {
      const r = repo();
      const outside = mkdtempSync(join(tmpdir(), 'bridge-outside-'));
      dirs.push(outside);
      writeFileSync(join(outside, 'notes.md'), NOTES);
      rmSync(join(r.dir, 'docs'), { recursive: true });
      symlinkSync(outside, join(r.dir, 'docs'));
      r.g('add', '-A');
      r.g('commit', '-q', '-m', 'link');
      const p = notesPayload(r.base);
      for (const mode of ['write', 'branch'] as const) {
        const res = await local(r, p, { mode, comments: approvedOne(p) });
        expect(res.status, mode).toBe('refused');
        expect(res.plan.problems[0]).toMatch(/symbolic link/);
      }
      expect(readFileSync(join(outside, 'notes.md'), 'utf8')).toBe(NOTES);
      expect(existsSync(join(r.dir, 'docs'))).toBe(true);
    });
  });
});
