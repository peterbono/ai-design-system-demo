// activity.json: what `bridge snapshot --activity` records for signed-out visitors, read from a fake GitHub.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SCHEMA_VERSION,
  activityAnswer,
  activityBytes,
  activityIsUsable,
  activityKey,
  activityTreeFilter,
  collectActivity,
  composeSuggestionIssue,
  fitActivity,
  gitBlobSha,
  loadConfig,
  parseActivity,
  SUGGESTION_SCHEMA,
  trimGitHub,
  type RepoActivity,
  type SuggestionPayloadV1,
} from '../src/index';
import { fakeGitHub, type FakeRoute } from './fake-github';

const HEAD = 'a'.repeat(40);
const PR_HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const R = '/repos/acme/ds';
const config = loadConfig({ tokens: { root: 'tokens' }, repo: { owner: 'acme', name: 'ds', defaultBranch: 'main' }, governance: { owners: { design: ['dana'], tech: ['teo'] } } });

const content = 'Darker primary.\n';
const payload: SuggestionPayloadV1 = {
  schema: SUGGESTION_SCHEMA,
  kind: 'token-change',
  title: 'Raise color.action.primary.bg contrast',
  summary: 'Primary labels read too light in dark mode.',
  source: 'studio',
  suggestedBy: 'ana',
  createdAt: '2026-10-21T09:00:00.000Z',
  base: { ref: 'main', sha: 'e30fbcc' },
  tier: { tier: 3, bump: 'minor' },
  tokens: { edits: [{ op: 'set', path: 'color.action.primary.bg', value: '{palette.harbor.700}' }], changes: [] },
  files: [{ path: '.changeset/x.md', beforeSha: null, afterSha: gitBlobSha(content), content }],
  checks: { newErrors: 0, contrast: [], blocked: null, impact: 0 },
};
const suggestion = composeSuggestionIssue(payload);

const user = (login: string) => ({ login, id: 1, node_id: 'U_1', avatar_url: `https://avatars.githubusercontent.com/${login}`, url: `https://api.github.com/users/${login}`, html_url: `https://github.com/${login}`, type: 'User', site_admin: false });
const repoObj = { id: 9, node_id: 'R_9', name: 'ds', full_name: 'acme/ds', private: false, fork: false, owner: user('acme'), html_url: 'https://github.com/acme/ds', url: 'https://api.github.com/repos/acme/ds', forks_url: 'x', default_branch: 'main' };
const pull = {
  number: 7,
  node_id: 'PR_7',
  title: 'Darker primary',
  html_url: 'https://github.com/acme/ds/pull/7',
  url: 'https://api.github.com/repos/acme/ds/pulls/7',
  diff_url: 'https://github.com/acme/ds/pull/7.diff',
  state: 'open',
  draft: false,
  body: 'Makes it darker.',
  user: user('ana'),
  labels: [{ name: 'tier: 2', node_id: 'L_1', url: 'x' }],
  head: { ref: 'bridge/darker', sha: PR_HEAD, repo: repoObj },
  base: { ref: 'main', sha: HEAD, repo: repoObj },
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-21T10:00:00Z',
  merged_at: null,
  comments: 2,
  review_comments: 1,
  mergeable: true,
  _links: { self: { href: 'x' } },
};
const merged = { ...pull, number: 5, title: 'Old change', state: 'closed', merged_at: '2026-10-19T10:00:00Z', labels: [] };
const request = { number: 9, title: 'Button: a loading label', body: '<!-- bridge-request {"component":"Button","kind":"prop-change","title":"A loading label","summary":"s","changes":[],"source":"studio"} -->', html_url: 'https://github.com/acme/ds/issues/9', state: 'open', state_reason: null, labels: [{ name: 'component-change' }], user: user('ana'), created_at: '2026-10-21T08:00:00Z', updated_at: '2026-10-21T08:00:00Z' };
const sgIssue = { number: 8, title: suggestion.title, body: suggestion.body, html_url: 'https://github.com/acme/ds/issues/8', state: 'open', state_reason: null, labels: suggestion.labels.map((name) => ({ name })), user: user('ana'), created_at: '2026-10-21T09:00:00Z', updated_at: '2026-10-21T09:00:00Z' };

function routes(): Record<string, FakeRoute> {
  const tree = { sha: PR_HEAD, truncated: false, tree: [{ path: 'tokens/color.tokens.json', type: 'blob', sha: 'd1', mode: '100644', size: 9, url: 'x' }, { path: 'src/App.tsx', type: 'blob', sha: 'd2', mode: '100644' }, { path: 'bridge.config.json', type: 'blob', sha: 'd3', mode: '100644' }] };
  const r: Record<string, FakeRoute> = {
    [`GET ${R}`]: { body: { full_name: 'acme/ds', default_branch: 'main', private: false } },
    [`GET ${R}/git/ref/heads/main`]: { body: { object: { sha: HEAD } } },
    [`GET ${R}/pulls?state=open&per_page=100`]: { body: [pull] },
    [`GET ${R}/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: { body: [merged] },
    [`GET ${R}/pulls?state=closed&per_page=50&sort=updated&direction=desc`]: { body: [merged] },
    [`GET ${R}/pulls?state=all&per_page=50&sort=updated&direction=desc`]: { body: [pull, merged] },
    [`GET ${R}/rules/branches/main`]: { body: [] },
    [`GET ${R}/git/matching-refs/heads/bridge-visual`]: { body: [] },
    [`GET /users/acme`]: { body: { login: 'acme', type: 'Organization' } },
    [`GET ${R}/pulls/7`]: { body: pull },
    [`GET ${R}/pulls/7/files?per_page=100`]: { body: [{ filename: 'tokens/color.tokens.json', status: 'modified', patch: '@@ -1 +1 @@', additions: 1, deletions: 1 }, { filename: 'README.md', status: 'modified' }] },
    [`GET ${R}/pulls/7/reviews?per_page=100`]: { body: [] },
    [`GET ${R}/issues/7/comments?per_page=100`]: { body: [] },
    [`GET ${R}/pulls/7/comments?per_page=100`]: { body: [] },
    [`GET ${R}/commits/${PR_HEAD}/check-runs?per_page=100`]: { body: { total_count: 0, check_runs: [] } },
    [`GET ${R}/commits/${PR_HEAD}/status`]: { body: { state: 'success', statuses: [{ context: 'Vercel', state: 'success', target_url: 'https://ds-git-darker.vercel.app' }, { context: 'lint', state: 'success', target_url: null }] } },
    [`GET ${R}/compare/main...${PR_HEAD}`]: { body: { status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, commits: [{ sha: PR_HEAD, commit: { message: 'x'.repeat(500) } }], merge_base_commit: { sha: HEAD, commit: { message: 'm' } }, base_commit: { sha: HEAD, commit: { tree: { sha: TREE } } }, files: [{ filename: 'tokens/color.tokens.json', status: 'modified', patch: '@@' }] } },
    [`GET ${R}/git/trees/${HEAD}?recursive=1`]: { body: { ...tree, sha: HEAD } },
    [`GET ${R}/git/trees/${PR_HEAD}?recursive=1`]: { body: tree },
    [`GET ${R}/issues/7/labels`]: { body: pull.labels },
    [`GET ${R}/issues?state=open&per_page=50&sort=created&direction=desc&labels=bridge-suggestion`]: { body: [sgIssue] },
    [`GET ${R}/issues/8`]: { body: sgIssue },
    [`GET ${R}/issues/8/comments?per_page=100`]: { body: [] },
    [`GET ${R}/issues?state=all&per_page=50&sort=created&direction=desc&labels=component-change`]: { body: [request] },
    [`GET ${R}/issues/9`]: { body: request },
    [`GET ${R}/issues/9/comments?per_page=100`]: { body: [] },
    // Token history: no change yet.
    [`GET ${R}/commits?sha=main&path=tokens&per_page=20&page=1`]: { body: [] },
    [`GET ${R}/git/commits/${HEAD}`]: { body: { sha: HEAD, tree: { sha: TREE } } },
    [`GET ${R}/git/trees/${TREE}?recursive=1`]: { body: { sha: TREE, truncated: false, tree: [] } },
    [`GET ${R}/tags?per_page=30`]: { body: [] },
  };
  return r;
}

const collect = (gh: ReturnType<typeof fakeGitHub>, previous?: RepoActivity | null) =>
  collectActivity({ fetch: gh.fetchImpl, token: 't0ken', owner: 'acme', repo: 'ds', config, version: '9.9.9', generatedAt: '2026-10-22T10:00:00.000Z', previous: previous ?? null });

describe('activityKey', () => {
  it('normalizes paths: query sorted, owner and repository lowercased, other hosts refused', () => {
    expect(activityKey('https://api.github.com/repos/Acme/DS/pulls?state=open&per_page=100')).toBe('/repos/acme/ds/pulls?per_page=100&state=open');
    expect(activityKey('/repos/acme/ds/pulls?per_page=100&state=open')).toBe('/repos/acme/ds/pulls?per_page=100&state=open');
    expect(activityKey('https://api.github.com/users/PeterBono')).toBe('/users/peterbono');
    expect(activityKey('https://raw.githubusercontent.com/acme/ds/main/x.json')).toBeNull();
  });
});

describe('trimGitHub', () => {
  it('drops API links, node ids, diffs and nested repositories, keeps what pages read', () => {
    const t = trimGitHub(pull) as Record<string, any>;
    expect(t.url).toBeUndefined();
    expect(t.diff_url).toBeUndefined();
    expect(t._links).toBeUndefined();
    expect(t.node_id).toBeUndefined();
    expect(t.html_url).toBe(pull.html_url);
    expect(t.user).toEqual({ login: 'ana', id: 1, avatar_url: 'https://avatars.githubusercontent.com/ana', html_url: 'https://github.com/ana', type: 'User' });
    expect(t.head.repo).toEqual({ id: 9, name: 'ds', full_name: 'acme/ds', private: false, fork: false, default_branch: 'main', owner: expect.objectContaining({ login: 'acme' }), html_url: 'https://github.com/acme/ds' });
    expect(t.head.sha).toBe(PR_HEAD);
    expect(t.labels[0]).toEqual({ name: 'tier: 2' });
  });

  it('keeps the tree entries a reader lists, and the files a token diff needs', () => {
    const keep = activityTreeFilter(config);
    expect(keep('tokens/color.tokens.json')).toBe(true);
    expect(keep('bridge.config.json')).toBe(true);
    expect(keep('src/App.tsx')).toBe(false);
  });
});

describe('collectActivity', () => {
  it('records the guest pages reads and summarizes branches, suggestions, requests and merges', async () => {
    const gh = fakeGitHub({ routes: routes() });
    const a = await collect(gh);
    expect(a.kind).toBe('bridge-activity');
    expect(a.schemaVersion).toBe(ACTIVITY_SCHEMA_VERSION);
    expect(a.repo).toEqual({ owner: 'acme', name: 'ds', branch: 'main' });
    expect(a.headSha).toBe(HEAD);
    expect(a.problems).toEqual([]);

    expect(a.branches).toEqual([
      expect.objectContaining({ number: 7, title: 'Darker primary', author: 'ana', state: 'open', labels: ['tier: 2'], tier: 3, comments: 3, files: { changed: 2, tokens: ['tokens/color.tokens.json'] }, previews: [{ context: 'Vercel', url: 'https://ds-git-darker.vercel.app' }], checks: 'success' }),
    ]);
    expect(a.suggestions).toEqual([expect.objectContaining({ number: 8, author: 'ana', kind: 'token-change', status: 'needs-review', comments: 0 })]);
    expect(a.suggestions[0]!.payload?.title).toBe(payload.title);
    expect(a.requests).toEqual([expect.objectContaining({ number: 9, state: 'open', status: 'requested', kind: 'prop-change', component: 'Button' })]);
    expect(a.merged).toEqual([expect.objectContaining({ number: 5, title: 'Old change', mergedAt: '2026-10-19T10:00:00Z' })]);
    expect(a.history).toEqual(expect.objectContaining({ source: 'github', entries: [] }));

    // The branch page reads, trimmed: the tree keeps the token and config files, the compare what a page reads.
    const tree = activityAnswer(a, `https://api.github.com${R}/git/trees/${PR_HEAD}?recursive=1`)!.body as { tree: { path: string }[] };
    expect(tree.tree.map((e) => e.path)).toEqual(['tokens/color.tokens.json', 'bridge.config.json']);
    const compare = activityAnswer(a, `${R}/compare/main...${PR_HEAD}`)!.body as Record<string, unknown>;
    expect(compare).toEqual({ status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, merge_base_commit: { sha: HEAD }, base_commit: { sha: HEAD, commit: { tree: { sha: TREE } } }, files: [{ filename: 'tokens/color.tokens.json', status: 'modified' }] });
    const files = activityAnswer(a, `${R}/pulls/7/files?per_page=100`)!.body as Record<string, unknown>[];
    expect(files[0]!.patch).toBeUndefined();
    // History internals are not kept: the history report stands for them.
    expect(Object.keys(a.responses).some((k) => k.includes('/tags') || k.includes('/commits?'))).toBe(false);
    // Every read the guest pages make is there.
    for (const path of [R, `${R}/git/ref/heads/main`, `${R}/pulls?state=open&per_page=100`, `${R}/pulls/7`, `${R}/pulls/7/reviews?per_page=100`, `${R}/issues/8/comments?per_page=100`, `${R}/issues/9`, '/users/acme']) {
      expect(activityAnswer(a, path), path).toBeDefined();
    }
    // Only the activity's repository is answered.
    expect(activityAnswer(a, '/repos/other/ds/pulls/7')).toBeUndefined();
  });

  it('keeps the token history while the default branch has not moved', async () => {
    const first = await collect(fakeGitHub({ routes: routes() }));
    const gh = fakeGitHub({ routes: routes() });
    const again = await collect(gh, { ...first, history: { ...first.history!, label: 'kept' } });
    expect(again.history?.label).toBe('kept');
    expect(gh.apiCalls().some((c) => c.url.includes('/commits?'))).toBe(false);
    // An untouched branch keeps its recorded page: only its checks and statuses are read again.
    const pr = gh.apiCalls().map((c) => c.url.replace('https://api.github.com', '')).filter((u) => u.includes('/pulls/7') || u.includes('/issues/7') || u.includes(PR_HEAD));
    expect(pr).toEqual([`${R}/commits/${PR_HEAD}/check-runs?per_page=100`, `${R}/commits/${PR_HEAD}/status`]);
    expect(again.responses).toEqual(first.responses);
    // A moved head reads it again.
    const moved = await collect(fakeGitHub({ routes: routes() }), { ...first, headSha: 'f'.repeat(40), history: { ...first.history!, label: 'kept' } });
    expect(moved.history?.label).not.toBe('kept');
  });

  it('stops at an exhausted hourly limit and says so, keeping what it read', async () => {
    const gh = fakeGitHub({ routes: routes(), budget: 4 });
    const a = await collect(gh);
    expect(a.problems.join(' ')).toMatch(/hourly limit/);
    expect(a.responses[`${R}`]).toBeDefined();
    expect(a.branches.every((b) => b.comments === null)).toBe(true);
  });
});

describe('fitActivity', () => {
  it('drops recorded file lists first, then older branch pages, never the summaries', async () => {
    const a = await collect(fakeGitHub({ routes: routes() }));
    const noTrees = fitActivity(a, activityBytes(a) - 1);
    expect(Object.keys(noTrees.responses).some((k) => k.includes('/git/trees/'))).toBe(false);
    expect(noTrees.truncated.join(' ')).toMatch(/File lists/);
    const bare = fitActivity(a, 2000);
    expect(bare.responses).toEqual({});
    expect(bare.branches).toEqual(a.branches);
    expect(fitActivity(a)).toBe(a);
  });
});

describe('parseActivity and freshness', () => {
  it('round-trips and refuses what is not an activity file', async () => {
    const a = await collect(fakeGitHub({ routes: routes() }));
    expect(parseActivity(JSON.stringify(a))).toEqual(a);
    expect(() => parseActivity('{')).toThrow(/not valid JSON/);
    expect(() => parseActivity({ kind: 'bridge-snapshot' })).toThrow(/not a Bridge activity/);
    expect(() => parseActivity({ ...a, schemaVersion: 2 })).toThrow(/schema version 2/);
    expect(() => parseActivity({ ...a, responses: { x: 1 } })).toThrow(/responses/);
  });

  it('is usable for its own repository while it is younger than a day', async () => {
    const a = await collect(fakeGitHub({ routes: routes() }));
    const at = Date.parse(a.generatedAt);
    expect(activityIsUsable(a, { owner: 'ACME', repo: 'ds' }, at + 60_000)).toBe(true);
    expect(activityIsUsable(a, { owner: 'acme', repo: 'other' }, at)).toBe(false);
    expect(activityIsUsable(a, { owner: 'acme', repo: 'ds' }, at + 25 * 3600_000)).toBe(false);
  });
});
