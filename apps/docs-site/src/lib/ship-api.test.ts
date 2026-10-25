// The /api/ship Vercel function (api/ship/index.ts) with a mocked GitHub: who may ask, which pushes from Figma Bridge
// ships by itself (token values only), and how it arms the merge (ready, approval, auto-merge), never merging while a
// check runs.
import { describe, expect, it } from 'vitest';
import type { AppTokens } from '../../api/_lib/github-app';
import { FIGMA_SHIP_HEADING, VALUES_SHIP_HEADING } from '../../api/_lib/figma-ship';
import { TIER1_PUBLISH_HEADING } from '../../api/_lib/tier1-publish';
import { bearerToken, handleShip, PUBLISH_WORDS, SHIP_DEVELOPER_WORDS, SHIP_WORDS, type FetchLike, type ShipDeps } from '../../api/ship/index';

const HOST = 'bridge.example.com';
const BASE_SHA = 'b'.repeat(40);
const HEAD_SHA = 'h'.repeat(40);
const MB = 'm'.repeat(40);
const TOKEN_FILE = 'design/tokens/color.tokens.json';
const CONFIG = JSON.stringify({ tokens: { root: 'design/tokens' }, governance: { owners: { design: ['dana', '@acme/design'], tech: ['malik'] } } });
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
  /** Active members of the @acme/design team, as GitHub answers the app. */
  team: string[];
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
    const member = /^\/orgs\/acme\/teams\/design\/memberships\/(.+)$/.exec(p);
    if (member) return w.team.includes(member[1]!) ? res(200, { state: 'active' }) : res(404, {});
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
    team: [],
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
    expect((await ok(await renamedSetup.call({ repo: 'acme/design', pr: 7 }))).body).toEqual({ armed: false, route: 'waiting-for-developer', code: 'not_values', reason: SHIP_WORDS.not_values, developer: SHIP_DEVELOPER_WORDS.not_values });
    expect(renamedSetup.w.calls.some((c) => c.path === '/graphql' || c.method === 'POST')).toBe(false);
    const code = setup({ files: [{ filename: TOKEN_FILE, status: 'modified' }, { filename: 'src/components/Button/Button.tsx', status: 'modified' }] });
    expect((await ok(await code.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_values');
    const broken = setup({ head: '{ not json' });
    expect((await ok(await broken.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_values');
  });

  it('only ships open changes to the default branch, never an exploration', async () => {
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

  it('takes short GitHub tokens (the local personas) only in local mode', async () => {
    const LOCAL = { BRIDGE_LOCAL: '1' };
    expect(bearerToken('Bearer ghu_reader_token_000000', {})).toBe('ghu_reader_token_000000');
    expect(bearerToken('Bearer ghp_local_dana', {})).toBeNull();
    expect(bearerToken('Bearer ghp_local_dana', LOCAL)).toBe('ghp_local_dana');
    expect(bearerToken('Bearer short', LOCAL)).toBeNull();
    expect(bearerToken('Bearer ghp_local_dana', { ...LOCAL, VERCEL: '1' })).toBeNull();
    expect(bearerToken('Bearer ghp_local_dana', { ...LOCAL, NODE_ENV: 'production' })).toBeNull();
    // Through the handler, outside local mode: a short token never reaches GitHub.
    const { w, call } = setup();
    const r = await call({ repo: 'acme/design', pr: 7 }, { authorization: 'Bearer ghp_local_dana' });
    expect(r.status).toBe(403);
    expect(w.calls).toEqual([]);
  });

  it('says Bridge cannot ship by itself when the app is not on the repository', async () => {
    const { w } = setup();
    const deps: ShipDeps = { fetch: github(w), app: { installationToken: async () => null } };
    const r = await handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, authorization: 'Bearer ghu_reader_token_000000' }, body: JSON.stringify({ repo: 'acme/design', pr: 7 }) }), {}, deps);
    expect(await r.json()).toMatchObject({ armed: false, route: 'waiting-for-developer', code: 'app_missing' });
  });

  it('writes no em dash, and the designer words name no GitHub setting', () => {
    for (const s of [...Object.values(SHIP_WORDS), ...Object.values(SHIP_DEVELOPER_WORDS)]) expect(s).not.toMatch(/—/);
    for (const s of Object.values(SHIP_WORDS)) expect(s).not.toMatch(/auto-?merge|pull request|branch|merge/i);
  });
});

// Decision TV-1: a token value change opened in Studio, the CLI or the MCP server ships once the design approval is in.
describe('POST /api/ship, a token value change from Studio (TV-1)', () => {
  const studio = { labels: [{ name: 'source: studio' }, { name: 'tier: 3' }], body: 'Brand orange, a little warmer.', draft: false, user: { login: 'sam', type: 'User' } };
  const approval = (login: string, commit = HEAD_SHA, state = 'APPROVED', at = '2026-10-24T10:00:00Z') => ({ user: { login, type: 'User' }, state, commit_id: commit, submitted_at: at, body: '' });

  it('arms it once a design owner approved the head: Bridge approves with the rule and turns auto-merge on', async () => {
    const { w, call } = setup({ reviews: [approval('dana')] }, studio);
    expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body).toEqual({ armed: true, route: 'shipped' });
    const review = w.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))!;
    expect(review.body).toMatchObject({ event: 'APPROVE', commit_id: HEAD_SHA });
    expect(review.body.body.startsWith(VALUES_SHIP_HEADING)).toBe(true);
    expect(review.body.body).toContain('design approved by @dana');
    expect(w.calls.some((c) => c.path === '/graphql' && c.body.query.includes('enablePullRequestAutoMerge'))).toBe(true);
    // Asked again (a second tab, the page opened later): no second review.
    await call({ repo: 'acme/design', pr: 7 });
    expect(w.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/reviews'))).toHaveLength(1);
  });

  it('a signed-in email member of the team may ask too (the Studio cookie path)', async () => {
    const { call } = setup({ reviews: [approval('dana')] }, studio);
    // Without a member session the cookie path answers 401: asking never widens anything.
    expect((await call({ repo: 'acme/design', pr: 7 }, { 'x-bridge-contribute': '1', origin: `https://${HOST}` })).status).toBe(401);
  });

  it('waits for the design approval: none, a tech approval only, or the author alone', async () => {
    for (const reviews of [[], [approval('malik')], [approval('sam')], [approval('stranger')]]) {
      const { w, call } = setup({ reviews }, studio);
      expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body).toMatchObject({ armed: false, code: 'needs_design_approval', reason: SHIP_WORDS.needs_design_approval });
      expect(w.calls.some((c) => c.method !== 'GET')).toBe(false);
    }
  });

  it('never counts Bridge\'s own review as the design approval', async () => {
    const bot = { user: { login: 'bridge-app[bot]', type: 'Bot' }, state: 'APPROVED', commit_id: HEAD_SHA, submitted_at: '2026-10-24T10:00:00Z', body: '' };
    const { call } = setup({ reviews: [bot] }, { ...studio });
    expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('needs_design_approval');
  });

  it('a design approval on an older commit does not ship what came after', async () => {
    const { w, call } = setup({ reviews: [approval('dana', 'o'.repeat(40))] }, studio);
    expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('approval_outdated');
    expect(w.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('holds while changes are requested, even with a design approval', async () => {
    const { call } = setup({ reviews: [approval('dana'), approval('malik', HEAD_SHA, 'CHANGES_REQUESTED')] }, studio);
    expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('changes_requested');
    // The reviewer approved since: it ships.
    const later = setup({ reviews: [approval('dana'), approval('malik', HEAD_SHA, 'CHANGES_REQUESTED'), approval('malik', HEAD_SHA, 'APPROVED', '2026-10-24T11:00:00Z')] }, studio);
    expect((await ok(await later.call({ repo: 'acme/design', pr: 7 }))).body.armed).toBe(true);
  });

  it('a member of a design team counts, when the app can read the team', async () => {
    const out = setup({ reviews: [approval('ann')] }, studio);
    expect((await ok(await out.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('needs_design_approval');
    const member = setup({ reviews: [approval('ann')], team: ['ann'] }, studio);
    const r = await ok(await member.call({ repo: 'acme/design', pr: 7 }));
    expect(r.body.armed).toBe(true);
    expect(member.w.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))!.body.body).toContain('@ann');
  });

  it('a rename or a removal waits for a developer, whatever the design approval', async () => {
    const { w, call } = setup({ reviews: [approval('dana')], head: renamed }, studio);
    expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('not_values');
    expect(w.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('auto-merge off on the repository: nothing written, a calm reason for the designer and the cause for developers', async () => {
    const { w, call } = setup({ reviews: [approval('dana')], repo: { default_branch: 'main', allow_squash_merge: true, allow_auto_merge: false } }, studio);
    const r = (await ok(await call({ repo: 'acme/design', pr: 7 }))).body;
    expect(r).toEqual({ armed: false, route: 'waiting-for-developer', code: 'auto_merge_off', reason: SHIP_WORDS.auto_merge_off, developer: SHIP_DEVELOPER_WORDS.auto_merge_off });
    expect(r.developer).toMatch(/Allow auto-merge/);
    expect(w.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('the app missing answers the same calm way', async () => {
    const { w } = setup({ reviews: [approval('dana')] }, studio);
    const deps: ShipDeps = { fetch: github(w), app: { installationToken: async () => null } };
    const r = await handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, authorization: 'Bearer ghu_reader_token_000000' }, body: JSON.stringify({ repo: 'acme/design', pr: 7 }) }), {}, deps);
    expect(await r.json()).toEqual({ armed: false, route: 'waiting-for-developer', code: 'app_missing', reason: SHIP_WORDS.app_missing, developer: SHIP_DEVELOPER_WORDS.app_missing });
  });

  it('the branch requires one approval: the design approval covers it when the app cannot approve (a change it opened)', async () => {
    const { call } = setup({ reviews: [approval('dana')], approveStatus: 422 }, { ...studio, user: { login: 'bridge-app[bot]', type: 'Bot' } });
    expect((await ok(await call({ repo: 'acme/design', pr: 7 }))).body).toEqual({ armed: true, route: 'shipped' });
    const two = setup({ reviews: [approval('dana')], approveStatus: 422, rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }] }, { ...studio, user: { login: 'bridge-app[bot]', type: 'Bot' } });
    expect((await ok(await two.call({ repo: 'acme/design', pr: 7 }))).body.code).toBe('needs_approval');
  });
});

// Tier 1 publish by leads (docs/GOVERNANCE.md): the author of a Tier 1 change, a repository admin or in the approver
// list of its domain, publishes it without review. Anything else goes to review, in designer words.
describe('POST /api/ship, Tier 1 publish by leads', () => {
  const DOCS = 'packages/react/src/components/Button/Button.docs.json';
  const docsPr = { labels: [{ name: 'source: bridge-web' }, { name: 'tier: 1' }], body: 'Button guidance.', draft: false, user: { login: 'dana', type: 'User' }, changed_files: 1 };
  const people: Record<string, { login: string; name: string | null }> = {
    'Bearer ghu_lead_dana_token_00000': { login: 'dana', name: 'Dana Reyes' },
    'Bearer ghu_lead_malik_token_0000': { login: 'malik', name: null },
    'Bearer ghu_admin_sam_token_00000': { login: 'sam', name: 'Sam' },
  };
  function publishSetup(over: Partial<World> = {}, pr: Record<string, any> = {}, opts: { admins?: string[]; config?: unknown } = {}) {
    const s = setup({ files: [{ filename: DOCS, status: 'modified' }], ...over }, { ...docsPr, ...pr });
    const inner = github(s.w);
    const fetch: FetchLike = async (url, init) => {
      const u = new URL(url);
      const person = people[init.headers.Authorization ?? ''];
      if (person) {
        s.w.calls.push({ method: init.method, path: u.pathname, auth: 'person' });
        if (u.pathname === '/repos/acme/design') return res(200, { permissions: { pull: true } });
        if (u.pathname === '/user') return res(200, person);
        return res(404, {});
      }
      const perm = /^\/repos\/acme\/design\/collaborators\/(.+)\/permission$/.exec(u.pathname);
      if (perm) return res(200, { permission: (opts.admins ?? []).includes(perm[1]!) ? 'admin' : 'write' });
      if (opts.config !== undefined && u.pathname === '/repos/acme/design/contents/bridge.config.json') return new Response(JSON.stringify(opts.config), { status: 200 });
      return inner(url, init);
    };
    s.deps.fetch = fetch;
    const app = s.deps.app!;
    const publish = (token = 'Bearer ghu_lead_dana_token_00000', extra: Record<string, string> = {}) =>
      handleShip(new Request(`https://${HOST}/api/ship`, { method: 'POST', headers: { 'content-type': 'application/json', host: HOST, authorization: token, ...extra }, body: JSON.stringify({ repo: 'acme/design', pr: 7, publish: 'tier1' }) }), {}, { fetch, app, readApp: app });
    return { ...s, publish };
  }
  const writes = (w: World) => w.calls.filter((c) => c.method !== 'GET' && c.auth !== 'person');

  it('a design reviewer publishes their docs change: Bridge approves it with the record and turns auto-merge on', async () => {
    const { w, publish } = publishSetup();
    expect((await ok(await publish())).body).toEqual({ armed: true, route: 'shipped' });
    const review = w.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))!;
    expect(review.body).toMatchObject({ event: 'APPROVE', commit_id: HEAD_SHA });
    expect(review.body.body.startsWith(TIER1_PUBLISH_HEADING)).toBe(true);
    expect(review.body.body).toContain('Published by Dana Reyes without review (Tier 1).');
    expect(w.calls.some((c) => c.path === '/graphql' && c.body.query.includes('enablePullRequestAutoMerge'))).toBe(true);
    // Asked again: no second review on the same head.
    await publish();
    expect(w.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/reviews'))).toHaveLength(1);
  });

  it('a repository admin publishes whatever the domain; a tech reviewer publishes a story fix, not docs', async () => {
    const admin = publishSetup({}, { user: { login: 'sam', type: 'User' } }, { admins: ['sam'] });
    expect((await ok(await admin.publish('Bearer ghu_admin_sam_token_00000'))).body.armed).toBe(true);
    const techDocs = publishSetup({}, { user: { login: 'malik', type: 'User' } });
    expect((await ok(await techDocs.publish('Bearer ghu_lead_malik_token_0000'))).body).toMatchObject({ armed: false, route: 'review', code: 'not_lead', reason: PUBLISH_WORDS.not_lead });
    const story = publishSetup({ files: [{ filename: 'packages/react/src/components/Button/Button.stories.tsx', status: 'modified' }] }, { user: { login: 'malik', type: 'User' } });
    const r = await ok(await story.publish('Bearer ghu_lead_malik_token_0000'));
    expect(r.body.armed).toBe(true);
    expect(story.w.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reviews'))!.body.body).toContain('Published by malik without review');
  });

  it('a person who is not a lead goes to review, with nothing written', async () => {
    const { w, publish } = publishSetup({}, { user: { login: 'sam', type: 'User' } });
    expect((await ok(await publish('Bearer ghu_admin_sam_token_00000'))).body).toMatchObject({ armed: false, route: 'review', code: 'not_lead' });
    expect(writes(w)).toEqual([]);
  });

  it('a Tier 2 change, a guardrail file or a token value goes to review', async () => {
    const code = publishSetup({ files: [{ filename: DOCS, status: 'modified' }, { filename: 'packages/react/src/components/Button/Button.tsx', status: 'modified' }] });
    expect((await ok(await code.publish())).body).toMatchObject({ route: 'review', code: 'not_tier1', reason: PUBLISH_WORDS.not_tier1 });
    expect(writes(code.w)).toEqual([]);
    const guard = publishSetup({ files: [{ filename: 'AGENTS.md', status: 'modified' }] });
    expect((await ok(await guard.publish())).body.code).toBe('not_tier1');
    const values = publishSetup({ files: [{ filename: TOKEN_FILE, status: 'modified' }] });
    expect((await ok(await values.publish())).body.code).toBe('not_tier1');
  });

  it('a token description edit is Tier 1', async () => {
    const described = JSON.stringify({ color: { a: { $type: 'color', $value: '#000', $description: 'Ink.' }, b: { $type: 'color', $value: '#111' } } });
    const { publish } = publishSetup({ files: [{ filename: TOKEN_FILE, status: 'modified' }], head: described });
    expect((await ok(await publish())).body.armed).toBe(true);
  });

  it('the team turned it off: it goes to review', async () => {
    const config = { tokens: { root: 'design/tokens' }, governance: { owners: { design: ['dana'], tech: ['malik'] }, leadsPublishTier1: false } };
    const { w, publish } = publishSetup({}, {}, { config });
    expect((await ok(await publish())).body).toMatchObject({ armed: false, route: 'review', code: 'publish_off', reason: PUBLISH_WORDS.publish_off });
    expect(writes(w)).toEqual([]);
  });

  it('a check that already failed: nothing is armed, it goes to review, and the designer never reads which check', async () => {
    const { w, publish } = publishSetup({ ci: { runs: [{ status: 'completed', conclusion: 'failure', name: 'Typecheck' }], statuses: [] } });
    const r = (await ok(await publish())).body;
    expect(r).toMatchObject({ armed: false, route: 'review', code: 'checks_failed', reason: 'It goes to review like any change.' });
    expect(r.reason).not.toMatch(/check|test|Typecheck/i);
    expect(writes(w)).toEqual([]);
  });

  it('only the author publishes, never someone else on their change, nor an email member session', async () => {
    const { w, publish } = publishSetup({}, { user: { login: 'sam', type: 'User' } });
    expect((await ok(await publish())).body).toMatchObject({ armed: false, route: 'review', code: 'not_author' });
    expect(writes(w)).toEqual([]);
    const bot = publishSetup({}, { user: { login: 'bridge-app[bot]', type: 'Bot' } });
    expect((await ok(await bot.publish())).body.code).toBe('not_author');
  });

  it('refuses an unknown publish value', async () => {
    const { call } = setup();
    expect((await call({ repo: 'acme/design', pr: 7, publish: 'everything' })).status).toBe(400);
  });

  it('the designer words name no GitHub setting, test or em dash', () => {
    for (const s of Object.values(PUBLISH_WORDS)) expect(s).not.toMatch(/auto-?merge|pull request|branch|merge|test|—/i);
  });
});
