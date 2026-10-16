// Remote mode against an in-memory GitHub: read-only without a token, PRs on new branches with one, never main.
import { describe, expect, it } from 'vitest';
import { BridgeContext, ops } from '../dist/lib.js';
import { GitHubClient } from '@bridge/core';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const files = () => readTree(REPO, REAL_PATHS);
const edit = { op: 'set' as const, path: 'color.text.muted', value: '{palette.neutral.700}', mode: { theme: 'light' } };

describe('remote mode (GitHub API)', () => {
  it('without a token: reads work, proposals return a preview, reviews are refused', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ctx = await BridgeContext.create({ repo: 'acme/ds', fetch: gh.fetch });
    const cfg = await ops.getConfig(ctx);
    expect(cfg.write).toMatch(/read-only/);
    const t = await ops.getToken(ctx, { path: 'color.text.muted' });
    expect(t.values).toHaveLength(4);
    const c = await ops.checkContrast(ctx, {});
    expect('failing' in c && c.failing).toBe(0);
    const p = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [edit] })) as any;
    expect(p.status).toBe('preview');
    expect(p.fileContents).toHaveLength(2);
    await expect(ops.reviewPr(ctx, { pr: 1, event: 'approve', body: 'ok' })).rejects.toThrow(/GITHUB_TOKEN/);
    expect(gh.log.filter((l) => l.method !== 'GET')).toEqual([]);
    // File reads go to raw.githubusercontent.com, not the rate-limited API.
    expect(gh.log.some((l) => l.path.startsWith('raw:'))).toBe(true);
  });

  it('with a token: branch + commit + draft PR labelled source: mcp and tier, main untouched', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const mainBefore = gh.refs.get('main');
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 'test-token', fetch: gh.fetch });
    const p = (await ops.proposeTokenChange(ctx, { title: 'Darken muted text', summary: 'Muted text needs more contrast on subtle backgrounds.', edits: [edit] })) as any;
    expect(p.status).toBe('pr-opened');
    expect(p.branch).toBe('bridge/darken-muted-text');
    expect(p.draft).toBe(true);
    expect(p.labels).toEqual(['source: mcp', 'tier: 3', 'tokens']);
    expect(gh.refs.get('main')).toBe(mainBefore);
    expect(gh.fileAt('bridge/darken-muted-text', 'packages/tokens/src/semantic/light.tokens.json')).toContain('{palette.neutral.700}');
    expect(gh.fileAt('bridge/darken-muted-text', '.changeset/bridge-darken-muted-text.md')).toContain('minor');
    const pr = gh.pulls[0]!;
    expect(pr.base.ref).toBe('main');
    expect(pr.body).toContain('Muted text needs more contrast');
    expect(pr.labels.map((l: any) => l.name)).toContain('source: mcp');
    // Every ref write targets a bridge/* branch.
    const refWrites = gh.log.filter((l) => l.method === 'POST' && l.path === '/git/refs');
    expect(refWrites.map((l) => l.body.ref)).toEqual(['refs/heads/bridge/darken-muted-text']);
  });

  it('get_review and review_pr on the PR', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const ctx = await BridgeContext.create({ repo: 'acme/ds', token: 'test-token', fetch: gh.fetch });
    await ops.proposeTokenChange(ctx, { title: 'Darken muted text', edits: [edit] });
    const list = (await ops.listReviews(ctx, { onlyBridge: true })) as any;
    expect(list.pullRequests).toHaveLength(1);
    expect(list.pullRequests[0].bridge).toBe(true);
    const r = (await ops.getReview(ctx, { pr: 1 })) as any;
    expect(r.tier).toBe(3);
    expect(r.diffTable).toContain('`color.text.muted`');
    expect(r.ci.state).toBe('success');
    expect(r.changedFiles).toContain('packages/tokens/src/semantic/light.tokens.json');
    const rev = await ops.reviewPr(ctx, { pr: 1, event: 'request_changes', body: 'Use palette.neutral.700 in dark too.' });
    expect(rev.event).toBe('REQUEST_CHANGES');
    const after = (await ops.getReview(ctx, { pr: 1 })) as any;
    expect(after.changesRequested).toEqual(['owner']);
  });

  it('the client refuses protected branches whatever the caller asks', async () => {
    const gh = fakeGitHub('acme', 'ds', files());
    const client = new GitHubClient('acme/ds', 't', (url, init) => gh.fetch(url, init as RequestInit) as never, undefined, { protectedBranches: ['main', 'master'], branchPrefix: 'bridge/' });
    const files1 = [{ path: 'x.txt', content: 'x' }];
    await expect(client.commitToNewBranch({ base: 'main', branch: 'main', message: 'x', files: files1 })).rejects.toThrow(/protected/);
    await expect(client.commitToNewBranch({ base: 'develop', branch: 'develop', message: 'x', files: files1 })).rejects.toThrow(/protected/);
    await expect(client.commitToNewBranch({ base: 'main', branch: 'feature/x', message: 'x', files: files1 })).rejects.toThrow(/must start with "bridge\/"/);
    await expect(client.createPullRequest({ base: 'main', head: 'main', title: 'x', body: 'x', draft: true })).rejects.toThrow(/protected/);
    expect(gh.log.filter((l) => l.method !== 'GET')).toEqual([]);
  });
});
