// The /api/ship Vercel function (api/ship/index.ts) with a mocked GitHub: who may ask, which pushes from Figma Bridge
// ships by itself (token values only), and how it arms the merge (ready, approval, auto-merge), never merging while a
// check runs.
import { describe, expect, it } from 'vitest';
import type { AppTokens } from '../../api/_lib/github-app';
import { FIGMA_SHIP_HEADING } from '../../api/_lib/figma-ship';
import { handleShip, SHIP_WORDS, type FetchLike, type ShipDeps } from '../../api/ship/index';

const HOST = 'bridge.example.com';
const BASE_SHA = 'b'.repeat(40);
const HEAD_SHA = 'h'.repeat(40);
const MB = 'm'.repeat(40);
const TOKEN_FILE = 'design/tokens/color.tokens.json';
const CONFIG = JSON.stringify({ tokens: { root: 'design/tokens' } });
const before = JSON.stringify({ color: { a: { $type: 'color', $value: '#000' }, b: { $type: 'color', $value: '#111' } } });
const valuesOnly = JSON.stringify({ color: { a: { $type: 'color', $value: '#222' }, b: { $type: 'color', $value: '#111' }, c: { $type: 'color', $value: '#333' } } });
const renamed = JSON.stringify({ color: { a: { $type: 'color', $value: '#000' }, bee: { $type: 'color', $value: '#111' } } });

interface World {
  pr: Record<string, any>;
  repo: Record<string, any>;
  files: { filename: string; status: string }[];
  head: string;
  reviews: any[];
  /** GraphQL answers: errors for auto-merge, when any. */
  autoMergeErrors: string[];
  rules: any[];
  ci: { runs: any[]; statuses: any[] };
  approveStatus: number;
  calls: { method: string; path: string; body?: any; auth: string }[];
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function github(w: World): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const auth = init.headers.Authorization ?? '';
    const body = init.body ? JSON.parse(init.body) : undefined;
    w.calls.push({ method: init.method, path: u.pathname + u.search, body, auth });
    const p = u.pathname;
    if (auth === 'Bearer ghu_reader_token_000000') {
      if (p === '/repos/acme/design') return res(200, { permissions: { pull: true } });
      return res(404, {});
    }
    if (auth === 'Bearer ghu_stranger_token_00000') return res(404, {});
    expect(auth).toMatch(/^Bearer ghs_/);
    if (p === '/repos/acme/design') return res(200, w.repo);
    if (p === '/repos/acme/design/pulls/7') return res(200, w.pr);
    if (p === '/repos/acme/design/pulls/7/files') return res(200, w.files);
    if (p === `/repos/acme/design/compare/${BASE_SHA}...${HEAD_SHA}`) return res(200, { merge_base_commit: { sha: MB } });
    if (p.startsWith('/repos/acme/design/contents/')) {
      const path = decodeURIComponent(p.slice('/repos/acme/design/contents/'.length));
      const ref = u.searchParams.get('ref');
      expect(init.headers.Accept).toBe('application/vnd.github.raw');
      if (path === 'bridge.config.json') return new Response(CONFIG, { status: 200 });
      if (path === TOKEN_FILE && ref === MB) return new Response(before, { status: 200 });
      if (path === TOKEN_FILE && ref === HEAD_SHA) return new Response(w.head, { status: 200 });
      return res(404, {});
    }
    if (p === '/repos/acme/design/pulls/7/reviews' && init.method === 'GET') return res(200, w.reviews);
    if (p === '/repos/acme/design/pulls/7/reviews' && init.method === 'POST') {
      if (body.event === 'APPROVE' && w.approveStatus !== 200) return res(w.approveStatus, { message: 'Can not approve your own pull request' });
      w.reviews.push({ state: body.event === 'APPROVE' ? 'APPROVED' : 'COMMENTED', body: body.body, commit_id: body.commit_id, user: { type: 'Bot' } });
      return res(200, { id: 1 });
    }
    if (p === '/repos/acme/design/rules/branches/main') return res(200, w.rules);
    if (p === '/graphql') {
      if (body.query.includes('markPullRequestReadyForReview')) {
        w.pr.draft = false;
        return res(200, { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
      }
      if (body.query.includes('enablePullRequestAutoMerge')) {
        expect(body.variables).toMatchObject({ id: 'PR_node', oid: HEAD_SHA });
        return w.autoMergeErrors.length ? res(200, { data: null, errors: w.autoMergeErrors.map((message) => ({ message })) }) : res(200, { data: { enablePullRequestAutoMerge: { pullRequest: { number: 7 } } } });
      }
    }
    if (p === `/repos/acme/design/commits/${HEAD_SHA}/check-runs`) return res(200, { check_runs: w.ci.runs });
    if (p === `/repos/acme/design/commits/${HEAD_SHA}/status`) return res(200, { statuses: w.ci.statuses });
    if (p === '/repos/acme/design/pulls/7/merge') return res(200, { merged: true, sha: 'z'.repeat(40) });
    return res(404, {});
  };
}

function setup(over: Partial<World> = {}, pr: Record<string, any> = {}) {
  const w: World = {
    pr: { number: 7, state: 'open', draft: true, node_id: 'PR_node', labels: [{ name: 'source: figma' }, { name: 'tier: 3' }], body: 'Values from Figma.', base: { ref: 'main', sha: BASE_SHA }, head: { sha: HEAD_SHA }, user: { login: 'sam', type: 'User' }, changed_files: 2, ...pr },
    repo: { default_branch: 'main', allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, allow_auto_merge: true },
    files: [
      { filename: TOKEN_FILE, status: 'modified' },
      { filename: '.changeset/figma-x.md', status: 'added' },
    ],
    head: valuesOnly,
    reviews: [],
    autoMergeErrors: [],
    rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 1 } }],
    ci: { runs: [{ status: 'completed', conclusion: 'success' }], statuses: [] },
    approveStatus: 200,
    calls: [],
    ...over,
  };
  const app: AppTokens = { installationToken: async () => 'ghs_write' };
  const deps: ShipDeps = { fetch: github(w), app, readApp: app };
  const call = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer ghu_reader_token_000000' }) =>
    handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, ...headers }, body: JSON.stringify(body) }), {}, deps);
  return { w, call, deps };
}

const ok = async (r: Response) => ({ status: r.status, body: await r.json() });

describe('POST /api/ship', () => {
  it('arms a token values push: ready for review, approved with the rule, auto-merge on, never merged on the spot', async () => {
    const { w, call } = setup();
    const r = await ok(await call({ repo: 'acme/design', pr: 7 }));
    expect(r).toEqual({ status: 200, body: { armed: true, route: 'shipped' } });
    expect(w.pr.draft).toBe(false);
    const review = w.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))!;
    expect(review.body).toMatchObject({ event: 'APPROVE', commit_id: HEAD_SHA });
    expect(review.body.body.startsWith(FIGMA_SHIP_HEADING)).toBe(true);
    expect(review.body.body).toContain('Pushed from Figma by @sam');
    expect(w.calls.some((c) => c.path.endsWith('/merge'))).toBe(false);
    expect(w.calls.find((c) => c.path === '/graphql' && c.body.query.includes('AutoMerge'))!.body.variables.m).toBe('SQUASH');
  });

  it('answers the plugin across origins (CORS), and the preflight', async () => {
    const { call, deps } = setup();
    const r = await call({ repo: 'acme/design', pr: 7 }, { authorization: 'Bearer ghu_reader_token_000000', origin: 'null' });
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await handleShip(new Request(`https://${HOST}/api/ship`, { method: 'OPTIONS' }), {}, deps);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('does not approve twice: the review is once per head commit', async () => {
    const { w, call } = setup();
    await call({ repo: 'acme/design', pr: 7 });
    await call({ repo: 'acme/design', pr: 7 });
    expect(w.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/reviews'))).toHaveLength(1);
  });

  it('leaves a rename, a removal or code to a developer', async () => {
    const renamedSetup = setup({ head: renamed });
    expect((await ok(await renamedSetup.call({ repo: 'acme/design', pr: 7 }))).body).toEqual({ armed: false, route: 'waiting-for-developer', code: 'not_values', reason: SHIP_WORDS.not_values });
    expect(renamedSetup.w.calls.some((c) => c.path === '/graphql' || c.method === 'POST')).toBe(false);
    const code = setup({ files: [{ filename: TOKEN_FILE, status: 'modified' }, { filename: 'src/components/Button/Button.tsx', status: 'modified' }] });
    expect((await ok(await code.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_values');
    const broken = setup({ head: '{ not json' });
    expect((await ok(await broken.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_values');
  });

  it('only ships open pushes from Figma to the default branch, never an exploration', async () => {
    expect((await ok(await setup({}, { labels: [{ name: 'source: studio' }] }).call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_from_figma');
    expect((await ok(await setup({}, { labels: [{ name: 'source: figma' }, { name: 'exploration' }] }).call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('exploration');
    expect((await ok(await setup({}, { base: { ref: 'explore/x', sha: BASE_SHA } }).call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_default_branch');
    expect((await ok(await setup({}, { state: 'closed' }).call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_open');
  });

  it('says when auto-merge is off on the repository', async () => {
    const { call } = setup({ repo: { default_branch: 'main', allow_auto_merge: false } });
    const r = (await ok(await call({ repo: 'acme/design', pr: 7 }))).body;
    expect(r).toMatchObject({ armed: false, route: 'waiting-for-developer', code: 'auto_merge_off' });
    expect(r.reason).not.toMatch(/auto-?merge|GitHub setting/i);
  });

  it('merges on the spot only when GitHub can merge now and every check passed', async () => {
    const clean = setup({ autoMergeErrors: ['Pull request is in clean status'] });
    expect((await ok(await clean.call({ repo: 'acme/design', pr: 7 }))).body).toEqual({ armed: true, route: 'shipped', merged: true });
    expect(clean.w.calls.find((c) => c.path.endsWith('/merge'))!.body).toEqual({ merge_method: 'squash', sha: HEAD_SHA });
    const running = setup({ autoMergeErrors: ['Pull request is in clean status'], ci: { runs: [{ status: 'in_progress', conclusion: null }], statuses: [] } });
    expect((await ok(await running.call({ repo: 'acme/design', pr: 7 }))).body).toMatchObject({ armed: false, code: 'checks_pending', retryAfter: 60 });
    expect(running.w.calls.some((c) => c.path.endsWith('/merge'))).toBe(false);
    const failing = setup({ autoMergeErrors: ['Pull request is in clean status'], ci: { runs: [{ status: 'completed', conclusion: 'failure' }], statuses: [] } });
    expect((await ok(await failing.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('checks_failed');
  });

  it('a push the app opened (an email member): no self-approval, so a developer approves when the library requires one', async () => {
    const { w, call } = setup({ approveStatus: 422 }, { user: { login: 'bridge-app[bot]', type: 'Bot' } });
    const r = (await ok(await call({ repo: 'acme/design', pr: 7 }))).body;
    expect(r).toMatchObject({ armed: false, route: 'waiting-for-developer', code: 'needs_approval' });
    expect(w.reviews.at(-1)).toMatchObject({ state: 'COMMENTED' });
    expect(w.reviews.at(-1).body).toContain('Pushed from Figma:');
    // Auto-merge still goes on: the developer's approval then ships it.
    expect(w.calls.some((c) => c.path === '/graphql' && c.body.query.includes('AutoMerge'))).toBe(true);
    const free = setup({ approveStatus: 422, rules: [] }, { user: { login: 'bridge-app[bot]', type: 'Bot' } });
    expect((await ok(await free.call({ repo: 'acme/design', pr: 7 }))).body).toEqual({ armed: true, route: 'shipped' });
  });

  it('refuses callers who cannot read the repository, and bad input', async () => {
    const { call } = setup();
    expect((await call({ repo: 'acme/design', pr: 7 }, { authorization: 'Bearer ghu_stranger_token_00000' })).status).toBe(401);
    expect((await call({ repo: 'acme/design', pr: 'x' })).status).toBe(400);
    expect((await call({ repo: 'not a repo', pr: 7 })).status).toBe(400);
    // A cookie call from another site never reaches GitHub.
    const cross = await call({ repo: 'acme/design', pr: 7 }, { 'x-bridge-contribute': '1', origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    const noHeader = await call({ repo: 'acme/design', pr: 7 }, {});
    expect(noHeader.status).toBe(403);
  });

  it('says Bridge cannot ship by itself when the app is not on the repository', async () => {
    const { w } = setup();
    const deps: ShipDeps = { fetch: github(w), app: { installationToken: async () => null } };
    const r = await handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, authorization: 'Bearer ghu_reader_token_000000' }, body: JSON.stringify({ repo: 'acme/design', pr: 7 }) }), {}, deps);
    expect(await r.json()).toMatchObject({ armed: false, route: 'waiting-for-developer', code: 'app_missing' });
  });

  it('writes no em dash', () => {
    for (const s of Object.values(SHIP_WORDS)) expect(s).not.toMatch(/—/);
  });
});
