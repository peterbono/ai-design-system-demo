// Suggestions from Claude: the writing tools in suggest mode (an issue, never a branch), explicit direct mode, list,
// get, review (owners only, bound to the version), decline, and apply on a local checkout (dry run, branch, already
// applied, not approved, conflict) or on a remote repo (the files come back). Fake GitHub, temp git repos, no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, brand, history, ops, studio, suggestions } from '../dist/lib.js';
import { fakeGitHub, git, readTree, REAL_PATHS, REPO, tempGitRepo } from './helpers.js';

const OWNER = 'peterbono';
const NAME = 'ai-design-system-demo';
const FULL = `${OWNER}/${NAME}`;
const DARKEN = { title: 'Darken muted text', summary: 'Muted text is too light on subtle backgrounds.', edits: [{ op: 'set' as const, path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } }] };

/** The repo's config in suggest mode (no "changes" key: the default), with two owners who are not the author. */
function suggestConfig(text: string): string {
  const out = text.replace(/\n\s*"changes": "direct",/, '').replace(/"owners": \{[^}]*\}/, '"owners": { "design": ["designer"], "tech": ["dev"] }');
  if (out.includes('"changes"') || !out.includes('"designer"')) throw new Error('suggestConfig: the config changed shape');
  return out;
}

/** A local checkout in suggest mode and the same files on a fake GitHub. */
function localRepo() {
  const dir = tempGitRepo(REPO, REAL_PATHS);
  const cfg = join(dir, 'bridge.config.json');
  writeFileSync(cfg, suggestConfig(readFileSync(cfg, 'utf8')));
  git(dir, 'commit', '-qam', 'suggest mode');
  const gh = fakeGitHub(OWNER, NAME, readTree(dir, REAL_PATHS));
  return { dir, gh };
}

function remoteRepo() {
  const files = readTree(REPO, REAL_PATHS);
  files['bridge.config.json'] = suggestConfig(files['bridge.config.json']!);
  return fakeGitHub(OWNER, NAME, files);
}

const writes = (gh: ReturnType<typeof fakeGitHub>) => gh.log.filter((l) => l.method !== 'GET');

describe('writing tools in suggest mode', () => {
  it('bridge_propose_token_change files a suggestion issue, never a branch; dryRun writes nothing; changes "direct" opens a pull request', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const refsBefore = [...gh.refs.keys()];

    const dry = (await ops.proposeTokenChange(ctx, { ...DARKEN, dryRun: true })) as any;
    expect(dry.status).toBe('dry-run');
    expect(dry.changesMode).toBe('suggest');
    expect(dry.suggestion.title).toBe('Tokens: darken muted text');
    expect(writes(gh)).toEqual([]);

    const s = (await ops.proposeTokenChange(ctx, DARKEN)) as any;
    expect(s.status).toBe('suggested');
    expect(s.number).toBe(100);
    expect(s.changes.map((c: any) => c.path)).toContain('color.text.muted');
    expect(s.next).toMatch(/bridge apply 100.*"Apply Bridge suggestion #100" \(bridge_apply_suggestion\)/);
    const issue = gh.issues[0]!;
    expect(issue.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['bridge-suggestion', 'suggestion: token-change', 'source: mcp', 'tier: 3', 'suggestion: needs review']));
    expect(issue.body).toContain('bridge_apply_suggestion');
    expect([...gh.refs.keys()]).toEqual(refsBefore);
    expect(gh.pulls).toEqual([]);

    const d = (await ops.proposeTokenChange(ctx, { ...DARKEN, title: 'Darken muted text again', edits: [{ ...DARKEN.edits[0]!, value: '{palette.neutral.800}' }], changes: 'direct' })) as any;
    expect(d.status).toBe('pr-opened');
    expect(gh.pulls).toHaveLength(1);
  });

  it('without a token: a preview that says what token a suggestion needs, nothing sent', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, fetch: gh.fetch });
    const r = (await ops.proposeTokenChange(ctx, DARKEN)) as any;
    expect(r.status).toBe('preview');
    expect(r.message).toMatch(/Issues: read and write/);
    expect(writes(gh)).toEqual([]);
  });

  it('brand, revert and docs follow the same mode; the config is read from the repo', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const b = (await brand.proposeBrand(ctx, { slug: 'acme', from: 'bridge', primary: '#1F5F3A', neutral: '#2A2F2C' })) as any;
    expect(b.status).toBe('suggested');
    const issue = gh.issues.find((i) => i.number === b.number)!;
    expect(issue.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['suggestion: brand', 'tier: 3', 'tokens']));
    expect(gh.pulls).toEqual([]);

    const docs = (await studio.saveDocs(ctx, { component: 'Button', docs: { summary: 'Starts the main action of a view.' } })) as any;
    expect(docs.status).toBe('suggested');
    expect(gh.issues.find((i) => i.number === docs.number)!.labels.map((l: any) => l.name)).toContain('suggestion: docs');
    expect(gh.pulls).toEqual([]);

    const cfg = await ops.getConfig(ctx);
    expect(cfg.changes).toMatch(/^suggest:/);
  });

  it('the revert tool files a suggestion in suggest mode too (dry run shows the issue)', async () => {
    const { dir, gh } = localRepo();
    // A merged token change to undo.
    const light = join(dir, 'packages/tokens/src/semantic/light.tokens.json');
    writeFileSync(light, readFileSync(light, 'utf8').replace('"$value": "{palette.neutral.600}"', '"$value": "{palette.neutral.700}"'));
    git(dir, 'commit', '-qam', 'feat(tokens): darken muted text');
    const ctx = await BridgeContext.create({ root: dir, token: 'test-token', fetch: gh.fetch });
    const r = (await history.proposeRevert(ctx, { target: git(dir, 'rev-parse', '--short', 'HEAD').trim(), dryRun: true })) as any;
    expect(r.status).toBe('dry-run');
    expect(r.changesMode).toBe('suggest');
    expect(r.suggestion.labels).toContain('suggestion: revert');
    expect(writes(gh)).toEqual([]);
  });
});

describe('list, get, review, decline', () => {
  it('owners approve on the version they read; others cannot; the status follows', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const s = (await ops.proposeTokenChange(ctx, DARKEN)) as any;
    const n = s.number as number;

    const list = await suggestions.listSuggestionsOp(ctx);
    expect(list.suggestions.map((x) => [x.number, x.status, x.kind, x.tier])).toEqual([[n, 'needs-review', 'token-change', 3]]);

    const got = (await suggestions.getSuggestionOp(ctx, { number: `#${n}` })) as any;
    expect(got.status).toBe('needs-review');
    // A token value suggestion needs the design approval only (decision TV-1).
    expect(got.approvals.missing).toEqual(['design approval']);
    expect(got.payloadSha).toMatch(/^[0-9a-f]{64}$/);
    expect(got.change.tokens[0].path).toBe('color.text.muted');

    gh.viewer.login = 'outsider';
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'approve' })).rejects.toThrow(/Only the owners in bridge.config.json/);
    gh.viewer.login = 'designer';
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'approve', payloadSha: 'deadbee' })).rejects.toThrow(/changed since you read it/);
    const one = (await suggestions.reviewSuggestionOp(ctx, { number: n, event: 'approve', payloadSha: got.payloadSha })) as any;
    expect(one.counts).toBe(true);
    // The design approval is all a token value suggestion needs (TV-1); the developer's OK changes nothing.
    expect(one.status).toBe('approved');
    gh.viewer.login = 'dev';
    const two = (await suggestions.reviewSuggestionOp(ctx, { number: n, event: 'approve', payloadSha: got.version })) as any;
    expect(two.status).toBe('approved');
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).toContain('suggestion: approved');
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).not.toContain('suggestion: needs review');

    const approved = await suggestions.listSuggestionsOp(ctx, { status: 'approved' });
    expect(approved.suggestions.map((x) => x.number)).toEqual([n]);
    expect(approved.next).toMatch(/bridge_apply_suggestion/);

    // Remote mode: the plan and the files to write, nothing written on GitHub.
    const before = writes(gh).length;
    const applied = (await suggestions.applySuggestionOp(ctx, { number: n })) as any;
    expect(applied.status).toBe('planned');
    expect(applied.exitCode).toBe(0);
    expect(applied.files.map((f: any) => f.path)).toContain('packages/tokens/src/semantic/light.tokens.json');
    expect(applied.next).toMatch(/Closes #100/);
    expect(writes(gh).length).toBe(before);
  });

  it('request changes needs a message; decline closes it as not planned and apply refuses it', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const n = ((await ops.proposeTokenChange(ctx, DARKEN)) as any).number as number;
    gh.viewer.login = 'designer';
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'request-changes' })).rejects.toThrow(/Say what should change/);
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'decline' })).rejects.toThrow(/Say why/);
    const d = (await suggestions.reviewSuggestionOp(ctx, { number: n, event: 'decline', message: 'We keep the lighter muted text for now.' })) as any;
    expect(d.status).toBe('declined');
    expect(gh.issues[0]!.state).toBe('closed');
    expect(gh.issues[0]!.state_reason).toBe('not_planned');
    const a = (await suggestions.applySuggestionOp(ctx, { number: n })) as any;
    expect(a.status).toBe('refused');
    expect(a.exitCode).toBe(1);
  });

  it('an issue that is not a suggestion is said so; a generic payload is checked before it is sent', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    gh.issues.push({ number: 100, title: 'A bug', body: 'Plain issue.', state: 'open', state_reason: null, labels: [], user: { login: 'someone' }, html_url: `https://github.com/${FULL}/issues/100`, created_at: '', updated_at: '' });
    await expect(suggestions.getSuggestionOp(ctx, { number: 100 })).rejects.toThrow(/not a Bridge suggestion/);
    await expect(suggestions.applySuggestionOp(ctx, { number: 100 })).rejects.toThrow(/not a Bridge suggestion/);

    await expect(
      suggestions.createSuggestionOp(ctx, { payload: { kind: 'revert', title: 'Edit the agent rules', summary: 'x', tier: { tier: 3, bump: 'patch' }, files: [{ path: 'AGENTS.md', beforeSha: null, afterSha: 'abc', content: 'x' }] }, dryRun: true }),
    ).rejects.toThrow(/guardrail/);
    const ok = (await suggestions.createSuggestionOp(ctx, { payload: { kind: 'token-change', title: 'Describe muted text', summary: 'Say what it is for.', tier: { tier: 1, bump: 'patch' }, tokens: { edits: [{ op: 'set', path: 'color.text.muted', description: 'Secondary text.', file: 'semantic/light.tokens.json' }], changes: [] } }, dryRun: true })) as any;
    expect(ok.status).toBe('dry-run');
    expect(ok.title).toBe('Tokens: describe muted text');
    expect(writes(gh)).toEqual([]);
  });
});

describe('apply on a local checkout', () => {
  // Four applies over the real token set, each validating and contrast checking every theme: its own timeout.
  it('dry run, then a local branch, recorded on the issue; again: already applied', { timeout: 180_000 }, async () => {
    const { dir, gh } = localRepo();
    const ctx = await BridgeContext.create({ root: dir, token: 'test-token', fetch: gh.fetch });
    const s = (await ops.proposeTokenChange(ctx, DARKEN)) as any;
    expect(s.status).toBe('suggested');
    // Local mode records the checkout's HEAD as the base.
    expect(gh.issues[0]!.body).toContain(git(dir, 'rev-parse', 'HEAD').trim());
    const n = s.number as number;

    // Not approved yet: exit 1, nothing written.
    const gated = (await suggestions.applySuggestionOp(ctx, { number: n, mode: 'dry-run' })) as any;
    expect(gated.status).toBe('not-approved');
    expect(gated.exitCode).toBe(1);

    for (const who of ['designer', 'dev']) {
      gh.viewer.login = who;
      await suggestions.reviewSuggestionOp(ctx, { number: n, event: 'approve' });
    }
    gh.viewer.login = 'developer';

    const dry = (await suggestions.applySuggestionOp(ctx, { number: n, mode: 'dry-run' })) as any;
    expect(dry.status).toBe('dry-run');
    expect(dry.exitCode).toBe(0);
    expect(dry.diff).toContain('palette.neutral.700');
    expect(dry.recorded).toBe(false);
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');

    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const r = (await suggestions.applySuggestionOp(ctx, { number: n })) as any;
    expect(r.status).toBe('branch-created');
    expect(r.branch).toBe(`bridge/suggestion-${n}-darken-muted-text`);
    expect(r.recorded).toBe(true);
    expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(git(dir, 'show', `${r.branch}:packages/tokens/src/semantic/light.tokens.json`)).toContain('{palette.neutral.700}');
    expect(gh.comments.get(n)!.some((c) => c.includes('bridge-suggestion-applied'))).toBe(true);
    expect(gh.issues[0]!.labels.map((l: any) => l.name)).toContain('suggestion: applying');
    expect(r.next).toMatch(/Closes #100/);

    const again = (await suggestions.applySuggestionOp(ctx, { number: n })) as any;
    expect(again.status).toBe('branch-exists');
    expect(again.exitCode).toBe(0);

    // The pull request that applies it: linked, with a warning when it does not close the issue.
    gh.pulls.push({ number: 1, title: 'Darken muted text', body: 'No closing line.', state: 'open', draft: false, user: { login: 'developer' }, head: { ref: r.branch, sha: 'x' }, base: { ref: 'main' }, labels: [], html_url: `https://github.com/${FULL}/pull/1`, updated_at: '' });
    const link = (await suggestions.linkSuggestionOp(ctx, { number: n, pr: 1 })) as any;
    expect(link.status).toBe('applying');
    expect(link.warnings.join(' ')).toMatch(/does not say "Closes #100"/);
  });

  it('a conflict with today\'s code writes nothing (exit 3); write mode puts the files in the working tree', async () => {
    const { dir, gh } = localRepo();
    const ctx = await BridgeContext.create({ root: dir, token: 'test-token', fetch: gh.fetch });
    const n = ((await ops.proposeTokenChange(ctx, DARKEN)) as any).number as number;
    for (const who of ['designer', 'dev']) {
      gh.viewer.login = who;
      await suggestions.reviewSuggestionOp(ctx, { number: n, event: 'approve' });
    }
    const light = join(dir, 'packages/tokens/src/semantic/light.tokens.json');
    const original = readFileSync(light, 'utf8');
    writeFileSync(light, original.replace('"$value": "{palette.neutral.600}"', '"$value": "{palette.neutral.800}"'));
    git(dir, 'commit', '-qam', 'someone else changed it');
    const c = (await suggestions.applySuggestionOp(ctx, { number: n })) as any;
    expect(c.status).toBe('conflict');
    expect(c.exitCode).toBe(3);
    expect(c.table).toMatch(/conflict/);
    expect(git(dir, 'branch', '--list', 'bridge/*').trim()).toBe('');

    writeFileSync(light, original);
    git(dir, 'commit', '-qam', 'back');
    const w = (await suggestions.applySuggestionOp(ctx, { number: n, mode: 'write' })) as any;
    expect(w.status).toBe('written');
    expect(w.written).toContain('packages/tokens/src/semantic/light.tokens.json');
    expect(readFileSync(light, 'utf8')).toContain('{palette.neutral.700}');
  });
});

describe('outdated suggestions and final labels (the same rules as Studio)', () => {
  const LIGHT = 'packages/tokens/src/semantic/light.tokens.json';
  /** A commit straight on main: someone else's change merged after the suggestion was made. */
  const moveMain = (gh: ReturnType<typeof fakeGitHub>, path: string, edit: (text: string) => string) => {
    const head = gh.refs.get('main')!;
    const c = gh.id();
    const next = new Map(gh.commits.get(head)!.files);
    next.set(path, edit(next.get(path) ?? ''));
    gh.commits.set(c, { files: next, parents: [head] });
    gh.refs.set('main', c);
  };
  const setMuted = (value: string) => (text: string) => {
    const json = JSON.parse(text);
    json.color.text.muted.$value = value;
    return `${JSON.stringify(json, null, 2)}\n`;
  };
  const labels = (gh: ReturnType<typeof fakeGitHub>) => gh.issues[0]!.labels.map((l: any) => l.name);

  it('main moved and the value it changes is not the one it was suggested from: Outdated in the list and in get', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const n = ((await ops.proposeTokenChange(ctx, DARKEN)) as any).number as number;

    // Main moved on a file the suggestion does not write: it still applies.
    moveMain(gh, 'README.md', (t) => `${t}\nMore.\n`);
    expect((await suggestions.listSuggestionsOp(ctx)).suggestions.map((x) => x.status)).toEqual(['needs-review']);
    expect(((await suggestions.getSuggestionOp(ctx, { number: n })) as any).status).toBe('needs-review');

    // Main changed the very token (600 to 500) while the suggestion goes from 600 to 700.
    moveMain(gh, LIGHT, setMuted('{palette.neutral.500}'));
    const list = await suggestions.listSuggestionsOp(ctx);
    expect(list.suggestions.map((x) => [x.number, x.status, x.said])).toEqual([[n, 'outdated', 'Outdated']]);
    expect((await suggestions.listSuggestionsOp(ctx, { status: 'outdated' })).suggestions.map((x) => x.number)).toEqual([n]);
    expect((await suggestions.listSuggestionsOp(ctx, { status: 'needs-review' })).suggestions).toEqual([]);
    const got = (await suggestions.getSuggestionOp(ctx, { number: n })) as any;
    expect(got).toMatchObject({ status: 'outdated', said: 'Outdated' });
    expect(got.outdated.conflicts.map((c: any) => c.path)).toEqual(['color.text.muted']);
    expect(got.next).toMatch(/^Outdated: color\.text\.muted changed since it was suggested \(now \{palette\.neutral\.500\}, suggested from \{palette\.neutral\.600\}\)\. Ask the author/);
    // Reads never write.
    expect(writes(gh).filter((w) => w.path.includes('/labels'))).toEqual([]);
  });

  it('applied and closed: apply says so, and the issue keeps only "suggestion: applied"', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const n = ((await ops.proposeTokenChange(ctx, DARKEN)) as any).number as number;
    // What #8 in the demo repo looked like: closed as completed by its pull request, the old labels left behind.
    gh.issues[0]!.labels.push({ name: 'suggestion: applying' });
    Object.assign(gh.issues[0]!, { state: 'closed', state_reason: 'completed' });
    expect(labels(gh)).toEqual(expect.arrayContaining(['suggestion: needs review', 'suggestion: applying']));

    const r = (await suggestions.applySuggestionOp(ctx, { number: n })) as any;
    expect(r).toMatchObject({ status: 'already-applied', exitCode: 0 });
    expect(labels(gh)).toContain('suggestion: applied');
    expect(labels(gh)).not.toContain('suggestion: needs review');
    expect(labels(gh)).not.toContain('suggestion: applying');
    expect(((await suggestions.getSuggestionOp(ctx, { number: n })) as any).status).toBe('applied');
  });

  it('linking a merged pull request marks it applied, not "being applied"', async () => {
    const gh = remoteRepo();
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const n = ((await ops.proposeTokenChange(ctx, DARKEN)) as any).number as number;
    await ops.proposeTokenChange(ctx, { ...DARKEN, title: 'Apply it', changes: 'direct' });
    const pr = gh.pulls[0]!;
    pr.body = `${pr.body}\n\nCloses #${n}`;
    Object.assign(pr, { state: 'closed', merged: true, merged_at: '2026-10-20T00:00:00Z' });
    const r = (await suggestions.linkSuggestionOp(ctx, { number: n, pr: pr.number })) as any;
    expect(r).toMatchObject({ status: 'applied', said: 'Applied' });
    expect(labels(gh)).toContain('suggestion: applied');
    expect(labels(gh)).not.toContain('suggestion: needs review');
    expect(labels(gh)).not.toContain('suggestion: applying');
  });
});

describe('the owner override on a suggestion (docs/GOVERNANCE.md)', () => {
  it('the only owner approves their own suggestion as owner, with a reason, and get says so', async () => {
    // The repo's own rules: peterbono is the only owner and the override allows them.
    const files = readTree(REPO, REAL_PATHS);
    files['bridge.config.json'] = files['bridge.config.json']!.replace(/\n\s*"changes": "direct",/, '');
    const gh = fakeGitHub(OWNER, NAME, files);
    gh.viewer.login = 'peterbono';
    const ctx = await BridgeContext.create({ repo: FULL, token: 'test-token', fetch: gh.fetch });
    const n = ((await ops.proposeTokenChange(ctx, DARKEN)) as any).number as number;
    // The fake files issues as 'agent': the owner filed this one.
    gh.issues[0]!.user.login = 'peterbono';
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'override' })).rejects.toThrow(/Say why/);
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'override', message: 'too short' })).rejects.toThrow(/at least 20 characters/);
    const r = (await suggestions.reviewSuggestionOp(ctx, { number: n, event: 'override', message: 'Solo maintainer, checked it in the Library.' })) as any;
    expect(r).toMatchObject({ counts: true, status: 'approved' });
    expect(r.next).toMatch(/Approved as owner/);
    const got = (await suggestions.getSuggestionOp(ctx, { number: n })) as any;
    expect(got.approvals.ownerOverride).toBe('Approved with the owner override by @peterbono without design approval. Reason: Solo maintainer, checked it in the Library.');
    gh.viewer.login = 'outsider';
    await expect(suggestions.reviewSuggestionOp(ctx, { number: n, event: 'override', message: 'Someone else trying the override here.' })).rejects.toThrow(/Only an owner/);
  });
});
