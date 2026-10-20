// The writes behind Studio's branch actions (branch-actions.ts), the docs proposal and the reads of library sync and
// try together: what each one sends GitHub, and what it says when GitHub refuses. Studio, the MCP server and the CLI
// all call these, so a merge from Claude sends the same requests as the Merge button.
import { describe, expect, it } from 'vitest';
import { addedComment, askOthersToReviewOnGitHub, canAddTo, closeOnGitHub, commentOnGitHub, mergeOnGitHub, OverrideMergeError, overrideMergeOnGitHub, reopenOnGitHub, reviewOnGitHub } from '../src/branch-actions';
import { commitFileOnGitHub, DOCS_MCP_ORIGIN, docsProposal, proposeDocsOnGitHub, validateDocs } from '../src/docs-proposal';
import { type FetchLike, GitHubClient } from '../src/github-client';
import { conflictRoute, freshness, overlap, resolutionMessage } from '../src/library-update';
import { onlyTokens, readCombineBranch, tokenFilesOf, tryTogetherUrl } from '../src/combine-branches';
import { branchWithJiraKey, parseJiraKey, titleWithJiraKey } from '../src/jira';
import { eligibleReviewers, pendingApprovals, reopenEligibility, reviewersToAsk, reviewQueue } from '../src/review-gate';

type Route = { status?: number; body: unknown };
function client(routes: Record<string, Route | ((body: any) => Route)>) {
  const calls: { method: string; path: string; body: any }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com/repos/o/r', '').replace('https://api.github.com', '');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const r = routes[`${method} ${path}`];
    const route = typeof r === 'function' ? r(body) : r;
    const status = route ? (route.status ?? 200) : 404;
    const out = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => out, text: async () => JSON.stringify(out) };
  };
  const gh = new GitHubClient('o/r', 'token', fetchImpl, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
  return { gh, calls };
}

describe('branch actions', () => {
  it('merges at the head the person saw, squash by default', async () => {
    const { gh, calls } = client({ 'PUT /pulls/7/merge': { body: { sha: 'm1', merged: true } } });
    expect(await mergeOnGitHub(gh, { number: 7, headSha: 'h1' })).toEqual({ sha: 'm1' });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/pulls/7/merge', body: { merge_method: 'squash', sha: 'h1' } });
  });

  it('owner override: the reason first, then the merge with the reason as its message', async () => {
    const { gh, calls } = client({
      'POST /issues/7/comments': { status: 201, body: { id: 11, html_url: 'https://github.com/o/r/pull/7#c11' } },
      'PUT /pulls/7/merge': { body: { sha: 'm1', merged: true } },
    });
    const r = await overrideMergeOnGitHub(gh, { number: 7, headSha: 'h1', login: '@Ana', reason: 'Release blocker, tech owner away.', missing: ['tech approval'], method: 'merge' });
    expect(r.commentUrl).toBe('https://github.com/o/r/pull/7#c11');
    expect(calls[0]!.body.body).toBe('**Bridge owner override**\n\nOwner override by @ana: Release blocker, tech owner away. Missing: tech approval. Merged from Bridge.');
    expect(calls[1]!.body).toMatchObject({ merge_method: 'merge', sha: 'h1', commit_message: 'Owner override by @ana: Release blocker, tech owner away. Missing: tech approval. Merged from Bridge.' });
  });

  it('owner override refused by GitHub: the comment says not merged; a refused comment merges nothing', async () => {
    const a = client({
      'POST /issues/7/comments': { status: 201, body: { id: 11, html_url: 'u' } },
      'PUT /pulls/7/merge': { status: 405, body: { message: 'Required status check "CI" is expected.' } },
      'PATCH /issues/comments/11': { body: {} },
    });
    const err = await overrideMergeOnGitHub(a.gh, { number: 7, headSha: 'h1', login: 'ana', reason: 'Release blocker, tech owner away.', missing: ['tech approval'], method: 'squash' }).catch((e) => e);
    expect(err).toBeInstanceOf(OverrideMergeError);
    expect(err.stage).toBe('merge');
    expect(err.message).toMatch(/GitHub refused to merge it: .*Your reason stays on the branch, marked not merged/);
    expect(a.calls[2]!.body.body).toMatch(/Merge refused by GitHub: .*Not merged\.$/);

    const b = client({ 'POST /issues/7/comments': { status: 403, body: { message: 'Resource not accessible by personal access token' } } });
    const err2 = await overrideMergeOnGitHub(b.gh, { number: 7, headSha: 'h1', login: 'ana', reason: 'x'.repeat(30), missing: ['approval'], method: 'squash' }).catch((e) => e);
    expect(err2.stage).toBe('comment');
    expect(b.calls.some((c) => c.path.endsWith('/merge'))).toBe(false);
  });

  it('reviews on the head seen; changes and comments need a text; close and reopen', async () => {
    const { gh, calls } = client({
      'POST /pulls/7/reviews': (body) => ({ body: { id: 1, state: body.event === 'APPROVE' ? 'APPROVED' : 'COMMENTED', body: body.body ?? null } }),
      'PATCH /pulls/7': { body: {} },
    });
    await expect(reviewOnGitHub(gh, { number: 7, event: 'REQUEST_CHANGES', body: ' ' })).rejects.toThrow(/what to change/);
    await expect(reviewOnGitHub(gh, { number: 7, event: 'COMMENT' })).rejects.toThrow(/Write a comment first/);
    await reviewOnGitHub(gh, { number: 7, event: 'APPROVE', headSha: 'h1' });
    expect(calls[0]!.body).toEqual({ event: 'APPROVE', commit_id: 'h1' });
    await closeOnGitHub(gh, 7);
    await reopenOnGitHub(gh, 7);
    expect(calls.slice(1).map((c) => c.body)).toEqual([{ state: 'closed' }, { state: 'open' }]);
  });

  it('who adds edits to a branch, and what reviewers read', () => {
    expect(canAddTo({ user: { login: 'Ana' } }, 'ana', false)).toBe(true);
    expect(canAddTo({ user: { login: 'ana' } }, 'bo', false)).toBe(false);
    expect(canAddTo({ user: { login: 'ana' } }, 'bo', true)).toBe(true);
    expect(canAddTo({ user: { login: 'ana' } }, null, true)).toBe(false);
    expect(addedComment(['color.text.muted'], 'bo', 'Claude through the Bridge MCP server')).toBe('@bo added token edits from Claude through the Bridge MCP server:\n\n- `color.text.muted`');
    expect(addedComment(['a'], null)).toMatch(/^Added token edits from the Bridge token editor/);
  });

  it('ask someone else to review: who can give the missing approvals, then the request', async () => {
    const approvals = { approvers: ['ana'], changesRequested: [], design: true, tech: false };
    const owners = { design: ['ana', '@bo'], tech: ['bo', 'cy', 'dee'] };
    expect(pendingApprovals(3, approvals)).toEqual(['tech']);
    expect(eligibleReviewers('tech', { owners, author: 'dee', approvers: ['ana'] })).toEqual({ open: false, logins: ['bo', 'cy'], listed: ['bo', 'cy', 'dee'] });
    expect(reviewersToAsk({ tier: 3, approvals, owners, author: 'dee', viewer: 'BO' })).toEqual(['cy']);
    expect(reviewersToAsk({ tier: 3, approvals: { ...approvals, tech: true }, owners, author: 'dee', viewer: 'bo' })).toEqual([]);
    const { gh, calls } = client({ 'POST /pulls/7/requested_reviewers': { status: 201, body: {} }, 'DELETE /pulls/7/requested_reviewers': { body: {} } });
    await expect(askOthersToReviewOnGitHub(gh, { number: 7, others: [] })).rejects.toThrow(/Nobody else can give the missing approval/);
    expect(await askOthersToReviewOnGitHub(gh, { number: 7, others: ['cy'], viewer: 'bo', viewerRequested: true })).toEqual(['cy']);
    expect(calls.map((c) => [c.method, c.body.reviewers])).toEqual([['POST', ['cy']], ['DELETE', ['bo']]]);
    await expect(commentOnGitHub(gh, 7, ' ')).rejects.toThrow(/Write the comment first/);
  });

  it('reopen and the review queue follow the Studio rules', () => {
    const base = { state: 'closed' as const, viewer: 'ana', author: 'ana', owners: [], canWrite: false };
    expect(reopenEligibility({ ...base, branch: 'exists' })).toEqual({ kind: 'reopen' });
    expect(reopenEligibility({ ...base, branch: 'gone' })).toEqual({ kind: 'gone' });
    expect(reopenEligibility({ ...base, viewer: 'bo', branch: 'exists' })).toEqual({ kind: 'none' });
    const q = reviewQueue([
      { number: 1, state: 'open', head: { ref: 'tokens/a' }, labels: [] },
      { number: 2, state: 'open', head: { ref: 'explore/b' }, labels: [{ name: 'exploration' }] },
      { number: 3, state: 'open', head: { ref: 'changeset-release/main' }, labels: [] },
      { number: 4, state: 'closed', head: { ref: 'tokens/c' }, labels: [] },
    ]);
    expect(q.map((p) => p.number)).toEqual([1]);
  });
});

describe('docs proposal', () => {
  const edit = { path: 'packages/react/src/components/Button/Button.docs.json', component: 'Button', slug: 'button', before: '{}', after: '{"summary":"Starts an action."}' };

  it('one branch per docs change, the origin in the body and the label, the Jira key first', async () => {
    const p = docsProposal([edit], { date: new Date('2026-10-20T10:00:00Z'), origin: DOCS_MCP_ORIGIN });
    expect(p.labels).toEqual(['docs', 'source: mcp', 'tier-1']);
    expect(p.body).toContain('written with Claude through the Bridge MCP server');
    expect(p.files.at(-1)!.content).toMatch(/"@bridge-ds\/react": patch/);
    const { gh, calls } = client({
      'GET /git/ref/heads/main': { body: { object: { sha: 'main1' } } },
      'GET /git/commits/main1': { body: { tree: { sha: 'tree1' } } },
      'POST /git/trees': { status: 201, body: { sha: 'tree2' } },
      'POST /git/commits': { status: 201, body: { sha: 'c2' } },
      'POST /git/refs': { status: 201, body: {} },
      'POST /pulls': (body) => ({ status: 201, body: { number: 9, html_url: 'u9', title: body.title, head: { ref: body.head } } }),
      'POST /issues/9/labels': { body: [] },
    });
    const r = await proposeDocsOnGitHub(gh, [edit], { base: 'main', jira: 'DS-7', origin: DOCS_MCP_ORIGIN, extraLabels: ['product: admin'], date: new Date('2026-10-20T10:00:00Z') });
    expect(r.title).toBe('DS-7 docs(button): usage guidance for Button');
    expect(r.branch).toMatch(/^docs\/DS-7-button-20261020-/);
    expect(calls.find((c) => c.path === '/issues/9/labels')!.body.labels).toEqual(['docs', 'source: mcp', 'tier-1', 'product: admin']);
  });

  it('validates like the Library editor and commits one file on an open branch only when it changes', async () => {
    expect(validateDocs({ summary: '', whenToUse: [], whenNotToUse: [], dos: [], donts: [], accessibility: [] } as never)[0]!.message).toMatch(/Add a summary/);
    const { gh, calls } = client({
      'GET /contents/a.json?ref=tokens%2Fx': { body: { type: 'file', encoding: 'base64', content: Buffer.from('old').toString('base64'), sha: 's1' } },
      'PUT /contents/a.json': { body: { commit: { sha: 'c9' } } },
    });
    expect(await commitFileOnGitHub(gh, { path: 'a.json', branch: 'tokens/x', message: 'm', next: (t) => t })).toBe('');
    expect(await commitFileOnGitHub(gh, { path: 'a.json', branch: 'tokens/x', message: 'm', next: () => 'new' })).toBe('c9');
    expect(calls.at(-1)!.body).toMatchObject({ branch: 'tokens/x', sha: 's1', message: 'm' });
  });
});

describe('library sync and try together', () => {
  it('routes conflicts, words the resolution, and says how a branch stands against main', () => {
    const o = overlap([{ filename: 't/a.tokens.json', status: 'modified' }, { filename: 'src/x.ts', status: 'modified' }], [{ filename: 't/a.tokens.json', status: 'modified' }], (p) => p.endsWith('.tokens.json'));
    expect(o).toEqual({ tokenFiles: ['t/a.tokens.json'], codeFiles: [] });
    expect(conflictRoute(o)).toEqual({ kind: 'tokens', files: ['t/a.tokens.json'] });
    expect(conflictRoute(o, { truncated: true }).kind).toBe('code');
    expect(resolutionMessage({ library: 'main', conflicts: [], choices: {}, who: 'ana' })).toBe('Bring in the latest main\n\nResolved in Bridge by @ana.');
    expect(freshness({ compare: { behind_by: 3 }, mergeable: true, open: true }).state).toBe('behind');
    expect(freshness({ compare: { behind_by: 3 }, mergeable: false, open: true }).state).toBe('conflict');
    expect(freshness({ compare: null, mergeable: true, open: true }).state).toBe('unknown');
  });

  it('reads one branch for the combination, and refuses code', async () => {
    expect(onlyTokens(['packages/tokens/src/a.tokens.json', '.changeset/x.md'], 'packages/tokens/src')).toBe(true);
    expect(tokenFilesOf(['packages/tokens/src/a.tokens.json', 'x.ts'], 'packages/tokens/src')).toEqual(['a.tokens.json']);
    expect(tryTogetherUrl('https://demo.test/x?y=1#z', [1, 2], {})).toBe('https://demo.test/?bridge=1,2');
    const code = client({ 'GET /compare/main...h2': { body: { ahead_by: 1, behind_by: 0, merge_base_commit: { sha: 'b' }, files: [{ filename: 'src/x.ts', status: 'modified' }] } } });
    expect(await readCombineBranch(code.gh, { number: 2, title: 'Code', headSha: 'h2' }, { base: 'main', tokensRoot: 'packages/tokens/src' })).toMatchObject({ tokens: false, edits: null });
  });

  it('Jira keys: parsed, first in the title and the branch name', () => {
    expect(parseJiraKey(' ds-42 ')).toBe('DS-42');
    expect(() => parseJiraKey('not a key')).toThrow(/like DS-42/);
    expect(titleWithJiraKey('feat(tokens): x', 'DS-42')).toBe('DS-42 feat(tokens): x');
    expect(branchWithJiraKey('bridge/darker', 'DS-42')).toBe('bridge/DS-42-darker');
  });
});
