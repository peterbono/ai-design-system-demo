import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  designCopyOf,
  productCodeRepoOf,
  productOfDesignCopy,
  productOfRepo,
  productProblems,
  productRepoOf,
  productRepos,
  type ProductConfig,
} from '../src/products';
import {
  designCopyStateOnGitHub,
  designTaskBody,
  githubLoginOf,
  designTaskTitle,
  FROM_DESIGN_LABEL,
  getLatestDesignCopyOnGitHub,
  makeDesignCopyOnGitHub,
  waitForDesignCopy,
} from '../src/design-copy-github';
import { designCopyTakeCommands, doneExploringPlan, explorationNote, explorationNotePath, explorationPrBody, parseExplorationBody, withDoneExploring, type Exploration } from '../src/explorations';
import { designTaskRef, doneExploringOnGitHub, DESIGN_TASK_BACK_COMMENT, reopenExplorationOnGitHub } from '../src/exploration-done-github';
import { GitHubClient } from '../src/github-client';
import { fakeGitHub } from './fake-github';
import { realConfig } from './helpers';

const DS = 'acme/ds';
const SHOP: ProductConfig = { key: 'shop', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design', preview: 'https://shop-design-git-{branch}.vercel.app' }, preview: 'https://shop-git-{branch}.vercel.app' };
const PLAIN: ProductConfig = { key: 'mobile', name: 'Mobile', repo: 'acme/mobile' };
const LIB: ProductConfig = { key: 'library', name: 'Library', default: true };
const PRODUCTS = [SHOP, PLAIN, LIB];
const NO_RETRY = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };
const client = (repo: string, f: ReturnType<typeof fakeGitHub>, token = 't') => new GitHubClient(repo, token, f.fetchImpl, NO_RETRY, { etags: false });

test('a product with a design copy explores in the copy, its developers keep their own repository', () => {
  assert.equal(designCopyOf(SHOP, DS), 'acme/shop-design');
  assert.equal(productRepoOf(SHOP, DS), 'acme/shop-design');
  assert.equal(productCodeRepoOf(SHOP, DS), 'acme/shop');
  // No copy set: the product's own repository, as before.
  assert.equal(designCopyOf(PLAIN, DS), null);
  assert.equal(productRepoOf(PLAIN, DS), 'acme/mobile');
  // A copy without the product's own repository, or the same one, is no copy.
  assert.equal(designCopyOf({ key: 'x', name: 'X', design: { repo: 'acme/x-design' } }, DS), null);
  assert.equal(designCopyOf({ key: 'x', name: 'X', repo: 'acme/x', design: { repo: 'ACME/x' } }, DS), null);
});

test('lists read the copy, with the copy previews; both repositories still name the product', () => {
  const repos = productRepos(PRODUCTS, DS);
  assert.deepEqual(
    repos.map((x) => [x.product.key, x.repo, x.product.preview]),
    [
      ['shop', 'acme/shop-design', 'https://shop-design-git-{branch}.vercel.app'],
      ['mobile', 'acme/mobile', undefined],
    ],
  );
  // A copy without preview deploys yet: no preview pattern, never the developers' one.
  const bare = productRepos([{ ...SHOP, design: { repo: 'acme/shop-design' } }], DS);
  assert.equal(bare[0]!.product.preview, undefined);
  assert.equal(productOfRepo(PRODUCTS, 'acme/shop-design', DS)?.key, 'shop');
  assert.equal(productOfRepo(PRODUCTS, 'ACME/SHOP', DS)?.key, 'shop');
  assert.equal(productOfDesignCopy(PRODUCTS, 'acme/shop-design')?.key, 'shop');
  assert.equal(productOfDesignCopy(PRODUCTS, 'acme/shop'), undefined);
});

test('the design field is checked like the rest of a product', () => {
  assert.deepEqual(productProblems([SHOP, LIB]), []);
  assert.match(productProblems([{ key: 'a', name: 'A', repo: 'acme/a', design: 'acme/a-design' }]).join(' '), /must be \{ "repo": "owner\/name" \}/);
  assert.match(productProblems([{ key: 'a', name: 'A', design: { repo: 'acme/a-design' } }]).join(' '), /needs "repo" too/);
  assert.match(productProblems([{ key: 'a', name: 'A', repo: 'acme/a', design: { repo: 'acme/a' } }]).join(' '), /another repository than "repo"/);
  assert.match(productProblems([{ key: 'a', name: 'A', repo: 'acme/a', design: { repo: 'acme/b', branch: 'x' } }]).join(' '), /design\.branch" is not a known field/);
});

test("this repository's own config explores Art print shop in the design team's copy", () => {
  const shop = realConfig().products.find((p) => p.key === 'admin-app')!;
  assert.equal(shop.name, 'Art print shop');
  assert.equal(productCodeRepoOf(shop, 'peterbono/ai-design-system-demo'), 'art-print-shop-co/art-print-shop');
  assert.equal(productRepoOf(shop, 'peterbono/ai-design-system-demo'), 'art-print-shop-co/art-print-shop-design');
});

test('where the copy stands: missing, up to date, or behind the product', async () => {
  const missing = fakeGitHub({ routes: {} });
  assert.deepEqual(await designCopyStateOnGitHub(client('acme/shop-design', missing), client('acme/shop', missing)), { kind: 'missing' });

  const behind = fakeGitHub({
    routes: {
      'GET /repos/acme/shop-design': { body: { full_name: 'acme/shop-design', default_branch: 'main', private: false } },
      'GET /repos/acme/shop/git/ref/heads/main': { body: { object: { sha: 'p1' } } },
      'GET /repos/acme/shop-design/compare/main...p1': { body: { status: 'ahead', ahead_by: 3, behind_by: 0 } },
    },
  });
  assert.deepEqual(await designCopyStateOnGitHub(client('acme/shop-design', behind), client('acme/shop', behind)), { kind: 'ready', branch: 'main', behind: 3 });

  // The product head the copy cannot see: unknown, never "behind".
  const unknown = fakeGitHub({
    routes: {
      'GET /repos/acme/shop-design': { body: { full_name: 'acme/shop-design', default_branch: 'main', private: false } },
      'GET /repos/acme/shop/git/ref/heads/main': { body: { object: { sha: 'p1' } } },
    },
  });
  assert.deepEqual(await designCopyStateOnGitHub(client('acme/shop-design', unknown), client('acme/shop', unknown)), { kind: 'ready', branch: 'main', behind: null });
});

test('Make my copy asks GitHub for a fork in the organization, with every branch', async () => {
  const f = fakeGitHub({
    routes: {
      'GET /users/acme': { body: { login: 'acme', type: 'Organization' } },
      'POST /repos/acme/shop/forks': { status: 202, body: { full_name: 'acme/shop-design' } },
    },
  });
  const calls: { url: string; body?: string }[] = [];
  const spy: typeof f.fetchImpl = (url, init) => {
    calls.push({ url, ...(init?.body ? { body: String(init.body) } : {}) });
    return f.fetchImpl(url, init);
  };
  const gh = new GitHubClient('acme/shop', 't', spy, NO_RETRY, { etags: false });
  assert.deepEqual(await makeDesignCopyOnGitHub(gh, 'acme/shop-design'), { ok: true, repo: 'acme/shop-design' });
  const fork = calls.find((c) => c.url.endsWith('/forks'))!;
  assert.deepEqual(JSON.parse(fork.body!), { organization: 'acme', name: 'shop-design', default_branch_only: false });
});

test('Make my copy: copies turned off, no access, or already there', async () => {
  const off = fakeGitHub({ routes: { 'POST /repos/acme/shop/forks': { status: 403, body: { message: 'Forking is disabled for this repository' } } } });
  assert.deepEqual(await makeDesignCopyOnGitHub(client('acme/shop', off), 'acme/shop-design'), { ok: false, reason: 'turned-off' });
  const hidden = fakeGitHub({ routes: { 'POST /repos/acme/shop/forks': { status: 404, body: { message: 'Not Found' } } } });
  assert.deepEqual(await makeDesignCopyOnGitHub(client('acme/shop', hidden), 'acme/shop-design'), { ok: false, reason: 'no-access' });
  const there = fakeGitHub({ routes: { 'POST /repos/acme/shop/forks': { status: 422, body: { message: 'Validation Failed', errors: [{ message: 'Name already exists on this account' }] } } } });
  assert.deepEqual(await makeDesignCopyOnGitHub(client('acme/shop', there), 'acme/shop-design'), { ok: true, repo: 'acme/shop-design' });
});

test('waits until GitHub has built the copy and its default branch', async () => {
  let reads = 0;
  const f = fakeGitHub({
    routes: {
      'GET /repos/acme/shop-design/git/ref/heads/main': { body: { object: { sha: 'p1' } } },
    },
  });
  const later: typeof f.fetchImpl = (url, init) => {
    if (url.endsWith('/repos/acme/shop-design')) {
      reads++;
      if (reads < 3) return f.fetchImpl('https://api.github.com/nothing-here', init);
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ full_name: 'acme/shop-design', default_branch: 'main', private: false }), text: async () => '' });
    }
    return f.fetchImpl(url, init);
  };
  const gh = new GitHubClient('acme/shop-design', 't', later, NO_RETRY, { etags: false });
  assert.equal(await waitForDesignCopy(gh, { tries: 5, sleep: async () => {} }), true);
  assert.equal(reads, 3);
  assert.equal(await waitForDesignCopy(client('acme/none', fakeGitHub()), { tries: 2, sleep: async () => {} }), false);
});

test('Get the latest syncs the copy, and says when GitHub cannot merge on its own', async () => {
  const ok = fakeGitHub({
    routes: {
      'GET /repos/acme/shop-design': { body: { full_name: 'acme/shop-design', default_branch: 'main', private: false } },
      'POST /repos/acme/shop-design/merge-upstream': { body: { merge_type: 'fast-forward', message: 'Successfully fetched and fast-forwarded' } },
    },
  });
  assert.deepEqual(await getLatestDesignCopyOnGitHub(client('acme/shop-design', ok)), { ok: true, merged: true });
  const conflict = fakeGitHub({ routes: { 'POST /repos/acme/shop-design/merge-upstream': { status: 409, body: { message: 'There are merge conflicts' } } } });
  assert.deepEqual(await getLatestDesignCopyOnGitHub(client('acme/shop-design', conflict), 'main'), { ok: false, reason: 'conflict' });
});

test("the developers' task: preview, changes, pieces and where the prototype code is", () => {
  const body = designTaskBody({
    name: 'Orders waiting to ship',
    purpose: 'See what to pack first',
    previewUrl: 'https://shop-design-git-explore-orders.vercel.app',
    changes: ['src/pages/Orders.tsx'],
    pieces: [{ title: 'Status chip', url: 'https://github.com/acme/ds/issues/9' }],
    copy: 'acme/shop-design',
    branch: 'explore/orders',
    pr: { number: 4, url: 'https://github.com/acme/shop-design/pull/4' },
    doneBy: 'ann',
  });
  assert.match(body, /\*\*Preview\.\*\* https:\/\/shop-design-git-explore-orders\.vercel\.app/);
  assert.match(body, /- src\/pages\/Orders\.tsx/);
  assert.match(body, /\[Status chip\]\(https:\/\/github\.com\/acme\/ds\/issues\/9\)/);
  assert.match(body, /git fetch https:\/\/github\.com\/acme\/shop-design\.git explore\/orders/);
  assert.doesNotMatch(body, /—/);
  assert.equal(designTaskTitle(' Orders waiting to ship '), 'Design: Orders waiting to ship');
});

test('the task names a member without GitHub by name, never by email', () => {
  const base = { name: 'Toast', changes: [], pieces: [], copy: 'acme/shop-design', branch: 'explore/toast', pr: { number: 4, url: 'https://github.com/acme/shop-design/pull/4' } };
  assert.match(designTaskBody({ ...base, doneBy: 'ann' }), /From @ann\./);
  const byName = designTaskBody({ ...base, doneByName: 'Dino' });
  assert.match(byName, /From Dino, through Bridge\./);
  assert.doesNotMatch(byName, /@/);
  const leaked = designTaskBody({ ...base, doneBy: 'dino@yopmail.com', doneByName: 'Dino' });
  assert.doesNotMatch(leaked, /yopmail/);
  assert.match(leaked, /From Dino, through Bridge\./);
  assert.doesNotMatch(designTaskBody({ ...base, doneBy: 'dino@yopmail.com' }), /yopmail|From/);
  assert.equal(githubLoginOf('@ann'), 'ann');
  assert.equal(githubLoginOf('dino@yopmail.com'), null);
  assert.equal(githubLoginOf('Ann Leroy'), null);
});

test('done exploring in a copy: developers fetch from the copy, the body records their task', () => {
  const e: Exploration = { name: 'Orders', purpose: 'Pack first', slug: 'orders' };
  const body = explorationPrBody(e, { owner: 'acme', repo: 'shop-design', packages: [], apps: {}, inProduct: { name: 'Art print shop', library: DS, copyOf: 'acme/shop' } });
  assert.match(body, /design team's copy of Art print shop, never in the developers' repository \(acme\/shop\)/);
  const plan = doneExploringPlan({ body, branch: 'explore/orders', files: [], copy: 'acme/shop-design' });
  assert.deepEqual(plan.take, designCopyTakeCommands('acme/shop-design', 'explore/orders'));
  const done = withDoneExploring(body, { branch: 'explore/orders', doneAt: '2026-11-01T10:00:00Z', copy: 'acme/shop-design', task: 'https://github.com/acme/shop/issues/7' });
  assert.match(done, /The developers' task: https:\/\/github\.com\/acme\/shop\/issues\/7/);
  assert.match(done, /git switch -c explore\/orders FETCH_HEAD/);
  assert.equal(parseExplorationBody(done)?.task, 'https://github.com/acme/shop/issues/7');
});

test('Done exploring from a copy opens a from-design task in the product repository, never a branch there', async () => {
  const e: Exploration = { name: 'Orders', purpose: 'Pack first', slug: 'orders' };
  const body = explorationPrBody(e, { owner: 'acme', repo: 'shop-design', packages: [], apps: {}, inProduct: { name: 'Art print shop', library: DS, copyOf: 'acme/shop' } });
  const pull = { number: 4, node_id: 'PR_4', html_url: 'https://github.com/acme/shop-design/pull/4', title: 'Exploration: Orders', state: 'open', draft: true, body, labels: [{ name: 'exploration' }], head: { ref: 'explore/orders', sha: 'h1' }, base: { ref: 'main' }, user: { login: 'ann' }, updated_at: '2026-11-01T09:00:00Z' };
  const writes: { method: string; path: string; body?: any }[] = [];
  const res = (status: number, b: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => b, text: async () => JSON.stringify(b) });
  const f = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    const b = init?.body ? JSON.parse(init.body) : undefined;
    if (method !== 'GET') writes.push({ method, path, body: b });
    if (path === '/repos/acme/shop-design/pulls/4') {
      if (method === 'PATCH') Object.assign(pull, b);
      return res(200, pull);
    }
    if (path.startsWith('/repos/acme/shop-design/pulls/4/files')) return res(200, [{ filename: explorationNotePath('orders'), status: 'added' }, { filename: 'src/pages/Orders.tsx', status: 'modified' }]);
    if (path === '/repos/acme/shop-design/git/ref/heads/explore/orders') return res(200, { object: { sha: 'h1' } });
    if (path.startsWith('/repos/acme/shop-design/git/commits/')) return res(200, { tree: { sha: 't1' } });
    if (path === '/repos/acme/shop-design/git/trees') return res(201, { sha: 't2' });
    if (path === '/repos/acme/shop-design/git/commits') return res(201, { sha: 'h2' });
    if (path === '/repos/acme/shop-design/git/refs/heads/explore/orders') return res(200, {});
    if (path === '/repos/acme/shop-design/issues/4/labels') return res(200, []);
    if (path === '/repos/acme/shop-design/issues/4/labels/exploration') return res(200, []);
    if (path === '/repos/acme/shop/labels') return res(201, {});
    if (path === '/repos/acme/shop/issues') return res(201, { number: 7, title: b.title, body: b.body, html_url: 'https://github.com/acme/shop/issues/7', state: 'open', labels: [{ name: FROM_DESIGN_LABEL }], user: { login: 'ann' }, created_at: '', updated_at: '' });
    return res(404, { message: `no route ${method} ${path}` });
  }) as unknown as ConstructorParameters<typeof GitHubClient>[2];
  const gh = new GitHubClient('acme/shop-design', 't', f, NO_RETRY, { etags: false, protectedBranches: ['main'], branchPrefix: 'explore/' });
  const r = await doneExploringOnGitHub(gh, 4, { products: PRODUCTS, openedBy: 'ann', date: new Date('2026-11-01T10:00:00Z') });
  assert.deepEqual(r.task, { number: 7, url: 'https://github.com/acme/shop/issues/7', repo: 'acme/shop' });
  assert.deepEqual(r.take, designCopyTakeCommands('acme/shop-design', 'explore/orders'));
  // In the developers' repository: the label and the task only, never a branch or a pull request.
  assert.deepEqual(
    writes.filter((w) => w.path.startsWith('/repos/acme/shop/')).map((w) => `${w.method} ${w.path}`),
    ['POST /repos/acme/shop/labels', 'POST /repos/acme/shop/issues'],
  );
  const issue = writes.find((w) => w.path === '/repos/acme/shop/issues')!;
  assert.deepEqual(issue.body.labels, [FROM_DESIGN_LABEL]);
  assert.equal(issue.body.title, 'Design: Orders');
  assert.match(issue.body.body, /src\/pages\/Orders\.tsx/);
  assert.doesNotMatch(issue.body.body, /\.bridge\/explorations/);
  // No preview passed: the copy's own preview of the branch, never a pointer to a Vercel comment.
  assert.match(issue.body.body, /\*\*Preview\.\*\* https:\/\/shop-design-git-explore-orders\.vercel\.app\//);
  // The exploration records the task.
  assert.equal(parseExplorationBody(pull.body)?.task, 'https://github.com/acme/shop/issues/7');
  assert.ok(explorationNote(e).length > 0);
});


test('Back to exploring closes the developers\' task; Done exploring again reopens that same task', async () => {
  const e: Exploration = { name: 'Orders', purpose: 'Pack first', slug: 'orders' };
  const body = explorationPrBody(e, { owner: 'acme', repo: 'shop-design', packages: [], apps: {}, inProduct: { name: 'Art print shop', library: DS, copyOf: 'acme/shop' } });
  const done = withDoneExploring(body, { branch: 'explore/orders', doneAt: '2026-11-01T10:00:00Z', copy: 'acme/shop-design', task: 'https://github.com/acme/shop/issues/7' });
  const pull = { number: 4, node_id: 'PR_4', html_url: 'https://github.com/acme/shop-design/pull/4', title: 'Exploration: Orders', state: 'open', draft: true, body: done, labels: [{ name: 'ready-for-devs' }], head: { ref: 'explore/orders', sha: 'h1' }, base: { ref: 'main' }, user: { login: 'ann' }, updated_at: '2026-11-01T09:00:00Z' };
  const issue = { number: 7, title: 'Design: Orders', body: 'x', html_url: 'https://github.com/acme/shop/issues/7', state: 'open', labels: [{ name: FROM_DESIGN_LABEL }], user: { login: 'ann' }, created_at: '', updated_at: '' };
  const writes: { method: string; path: string; body?: any }[] = [];
  const res = (status: number, b: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => b, text: async () => JSON.stringify(b) });
  const f = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    const b = init?.body ? JSON.parse(init.body) : undefined;
    if (method !== 'GET') writes.push({ method, path, body: b });
    if (path === '/repos/acme/shop-design/pulls/4') {
      if (method === 'PATCH') Object.assign(pull, b);
      return res(200, pull);
    }
    if (path.startsWith('/repos/acme/shop-design/pulls/4/files')) return res(200, [{ filename: 'src/pages/Orders.tsx', status: 'modified' }]);
    if (path.startsWith('/repos/acme/shop-design/issues/4/labels')) {
      if (method === 'POST') pull.labels = [{ name: 'exploration' }];
      if (method === 'DELETE') pull.labels = pull.labels.filter((l) => !path.endsWith(l.name));
      return res(200, []);
    }
    if (path === '/repos/acme/shop/labels') return res(201, {});
    if (path === '/repos/acme/shop/issues/7/comments') return res(201, { id: 1, html_url: 'https://github.com/acme/shop/issues/7#c1' });
    if (path === '/repos/acme/shop/issues/7') {
      if (method === 'PATCH') Object.assign(issue, b);
      return res(200, issue);
    }
    if (path === '/repos/acme/shop/issues') return res(201, { ...issue, number: 8 });
    if (path.startsWith('/repos/acme/shop-design/commits/')) return res(200, { check_runs: [], statuses: [], state: 'success' });
    return res(404, { message: `no route ${method} ${path}` });
  }) as unknown as ConstructorParameters<typeof GitHubClient>[2];
  const gh = new GitHubClient('acme/shop-design', 't', f, NO_RETRY, { etags: false, protectedBranches: ['main'], branchPrefix: 'explore/' });

  const back = await reopenExplorationOnGitHub(gh, 4, { date: new Date('2026-11-01T11:00:00Z') });
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(
    writes.filter((w) => w.path.startsWith('/repos/acme/shop/')).map((w) => `${w.method} ${w.path} ${w.body?.state_reason ?? ''}`.trim()),
    ['POST /repos/acme/shop/issues/7/comments', 'PATCH /repos/acme/shop/issues/7 not_planned'],
  );
  assert.equal(writes.find((w) => w.path === '/repos/acme/shop/issues/7/comments')!.body.body, DESIGN_TASK_BACK_COMMENT);
  assert.equal(issue.state, 'closed');
  // The task stays recorded, so Done exploring said again finds it.
  assert.equal(parseExplorationBody(pull.body)?.task, 'https://github.com/acme/shop/issues/7');

  writes.length = 0;
  const again = await doneExploringOnGitHub(gh, 4, { products: PRODUCTS, openedBy: 'ann' });
  assert.deepEqual(again.task, { number: 7, url: 'https://github.com/acme/shop/issues/7', repo: 'acme/shop' });
  assert.ok(!writes.some((w) => w.method === 'POST' && w.path === '/repos/acme/shop/issues'), 'no second task');
  const reopen = writes.find((w) => w.method === 'PATCH' && w.path === '/repos/acme/shop/issues/7')!;
  assert.equal(reopen.body.state, 'open');
  assert.equal(reopen.body.state_reason, 'reopened');
  assert.equal(issue.state, 'open');
});

test('designTaskRef reads a task URL, only in the expected repository', () => {
  assert.deepEqual(designTaskRef('https://github.com/acme/shop/issues/7', 'acme/shop'), { repo: 'acme/shop', number: 7, url: 'https://github.com/acme/shop/issues/7' });
  assert.deepEqual(designTaskRef('https://github.com/acme/shop/issues/7', null)?.number, 7);
  assert.equal(designTaskRef('https://github.com/acme/other/issues/7', 'acme/shop'), null);
  assert.equal(designTaskRef('https://github.com/acme/shop/pull/7', null), null);
  assert.equal(designTaskRef(undefined, null), null);
});
