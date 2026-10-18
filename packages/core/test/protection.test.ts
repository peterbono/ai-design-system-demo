import assert from 'node:assert/strict';
import { test } from 'vitest';
import { type FetchLike, GitHubClient, GitHubError } from '../src/github-client';
import { protectionRuleset, protectionSentence, protectionState, requiredCheckNames, rulesetTargetsDefault, type Ruleset } from '../src/protection';
import { loadProtection, loadRequiredChecks, protectLibrary, protectRefusal } from '../src/protection-github';

const CHECKS = ['Guardrails', 'Unit and a11y tests'];

/** The repo's own ruleset (id 25324954), as GitHub returns it. */
const reference: Ruleset = {
  id: 25324954,
  name: 'Protect the library (main)',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'pull_request', parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true } },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'Guardrails' }] } },
  ],
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
  _links: { html: { href: 'https://github.com/o/r/rules/25324954' } },
};

test('protectionRuleset: default branch, no deletion, no force push, reviewed PR, checks, admin override in PR mode', () => {
  const p = protectionRuleset({ repo: { defaultBranch: 'main' } }, { checks: CHECKS, approvals: 1, adminBypass: true });
  assert.equal(p.name, 'Protect the library (main)');
  assert.equal(p.target, 'branch');
  assert.equal(p.enforcement, 'active');
  assert.deepEqual(p.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(
    p.rules.map((r) => r.type),
    ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'],
  );
  const pr = p.rules.find((r) => r.type === 'pull_request')!.parameters!;
  assert.equal(pr.required_approving_review_count, 1);
  assert.equal(pr.dismiss_stale_reviews_on_push, true);
  const checks = p.rules.find((r) => r.type === 'required_status_checks')!.parameters!;
  assert.deepEqual(checks.required_status_checks, [{ context: 'Guardrails' }, { context: 'Unit and a11y tests' }]);
  assert.deepEqual(p.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }]);
});

test('protectionRuleset: never below 1 approval, no checks rule without checks, no bypass when off', () => {
  const p = protectionRuleset(undefined, { checks: [' ', ''], approvals: 0, adminBypass: false });
  assert.equal(p.rules.find((r) => r.type === 'pull_request')!.parameters!.required_approving_review_count, 1);
  assert.equal(p.rules.some((r) => r.type === 'required_status_checks'), false);
  assert.deepEqual(p.bypass_actors, []);
  assert.equal(protectionRuleset(undefined, { checks: [], approvals: 2, adminBypass: false }).rules[2]!.parameters!.required_approving_review_count, 2);
});

test('the payload it builds reads back as protected', () => {
  const p = protectionRuleset({ repo: { defaultBranch: 'trunk' } }, { checks: CHECKS, approvals: 1, adminBypass: true });
  assert.equal(protectionState([{ ...p, id: 1 }], null, 'trunk').kind, 'protected');
});

test('requiredCheckNames: from the default branch, without Vercel and skipped, kept to what PRs run', () => {
  const main = [
    { name: 'Guardrails', conclusion: 'success', app: 'github-actions' },
    { name: 'Changeset present', conclusion: 'skipped', app: 'github-actions' },
    { name: 'Version or publish', conclusion: 'success', app: 'github-actions' },
    { name: 'Vercel Preview Comments', conclusion: 'success', app: 'vercel' },
    { name: 'Vercel - docs', conclusion: 'success' },
    { name: 'Docs site', conclusion: 'failure', app: 'github-actions' },
    { name: 'Guardrails', conclusion: 'success', app: 'github-actions' },
  ];
  assert.deepEqual(requiredCheckNames(main), ['Guardrails', 'Version or publish', 'Docs site']);
  const pr = [
    { name: 'Guardrails', conclusion: 'success' },
    { name: 'Docs site', conclusion: 'success' },
    { name: 'Snapshot packages', conclusion: 'success' },
  ];
  assert.deepEqual(requiredCheckNames(main, pr), ['Guardrails', 'Docs site']);
});

test('rulesetTargetsDefault: ~DEFAULT_BRANCH, ~ALL, refs and patterns, excludes win, tag rulesets never', () => {
  const r = (include: string[], exclude: string[] = [], target = 'branch'): Ruleset => ({ name: 'x', enforcement: 'active', target, conditions: { ref_name: { include, exclude } } });
  assert.equal(rulesetTargetsDefault(r(['~DEFAULT_BRANCH']), 'main'), true);
  assert.equal(rulesetTargetsDefault(r(['~ALL']), 'main'), true);
  assert.equal(rulesetTargetsDefault(r(['refs/heads/main']), 'main'), true);
  assert.equal(rulesetTargetsDefault(r(['refs/heads/ma*']), 'main'), true);
  assert.equal(rulesetTargetsDefault(r(['refs/heads/release/*']), 'main'), false);
  assert.equal(rulesetTargetsDefault(r(['~ALL'], ['refs/heads/main']), 'main'), false);
  assert.equal(rulesetTargetsDefault(r(['~ALL'], [], 'tag'), 'main'), false);
});

test('protectionState: protected, partial with what is missing, unprotected, unknown', () => {
  const s = protectionState([reference], null, 'main');
  assert.equal(s.kind, 'protected');
  assert.deepEqual(s.missing, []);
  assert.equal(s.url, 'https://github.com/o/r/rules/25324954');
  assert.equal(s.bridgeRulesetId, 25324954);

  const noChecks = { ...reference, rules: reference.rules!.filter((r) => r.type !== 'required_status_checks') };
  const partial = protectionState([noChecks], null, 'main');
  assert.equal(partial.kind, 'partial');
  assert.deepEqual(partial.missing, ['checks']);
  assert.equal(protectionSentence(partial), 'Partly protected: checks do not have to pass.');

  // A ruleset in "evaluate" only reports: it protects nothing.
  assert.equal(protectionState([{ ...reference, enforcement: 'evaluate' }], null, 'main').kind, 'unprotected');
  assert.equal(protectionState([], null, 'main').kind, 'unprotected');
  // Nothing found in rulesets while classic protection could not be read: unknown, never "unprotected".
  assert.equal(protectionState([], undefined, 'main').kind, 'unknown');
  assert.equal(protectionState(null, null, 'main').kind, 'unknown');
  // But what one source shows is enough to say protected.
  assert.equal(protectionState([reference], undefined, 'main').kind, 'protected');
});

test('protectionState: classic branch protection counts, force pushes and deletions refused unless allowed', () => {
  const classic = { required_pull_request_reviews: { required_approving_review_count: 1 }, required_status_checks: { contexts: ['ci'] }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
  assert.equal(protectionState([], classic, 'main').kind, 'protected');
  const loose = { required_pull_request_reviews: { required_approving_review_count: 1 }, allow_force_pushes: { enabled: true }, allow_deletions: { enabled: false } };
  const s = protectionState([], loose, 'main');
  assert.equal(s.kind, 'partial');
  assert.deepEqual(s.missing, ['checks', 'history']);
  // A PR rule with 0 approvals is not a review.
  assert.deepEqual(protectionState([], { required_pull_request_reviews: { required_approving_review_count: 0 } }, 'main').missing, ['review', 'checks']);
});

test('protectionSentence: designer words, no ruleset, branch or force push', () => {
  const all = [
    protectionSentence({ kind: 'protected', missing: [] }),
    protectionSentence({ kind: 'unprotected', missing: ['review', 'checks', 'history', 'deletion'] }),
    protectionSentence({ kind: 'partial', missing: ['review', 'history', 'deletion'] }),
    protectionSentence({ kind: 'unknown', missing: [] }),
  ];
  assert.equal(all[0], 'Protected: every change goes through review.');
  assert.equal(all[1], 'Your library can be changed without review.');
  assert.equal(all[2], 'Partly protected: changes can skip review, past changes can be rewritten and the library can be deleted.');
  for (const s of all) assert.doesNotMatch(s, /ruleset|branch|force push|\u2014/i);
});

// GitHub stub: routes by "METHOD /path".
function stub(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com', '');
    calls.push({ method, path, body: init?.body ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${path}`];
    const status = route ? (route.status ?? 200) : 404;
    const body = route ? route.body : { message: 'Not Found' };
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}
const noRetry = { attempts: 1, baseDelayMs: 0, sleep: async () => {} };

test('client: listRulesets, getRuleset, getBranchProtection (404 none, 403 cannot read unless the branch is unprotected)', async () => {
  const { fetchImpl } = stub({
    'GET /repos/o/r/rulesets?includes_parents=true&per_page=100': { body: [{ id: 25324954, name: reference.name, enforcement: 'active', target: 'branch', _links: reference._links }] },
    'GET /repos/o/r/rulesets/25324954': { body: reference },
    'GET /repos/o/r/branches/main/protection': { status: 403, body: { message: 'Must have admin rights to Repository.' } },
    'GET /repos/o/r/branches/main': { body: { name: 'main', protected: true } },
    'GET /repos/o/r/branches/dev/protection': { status: 403, body: { message: 'Must have admin rights to Repository.' } },
    'GET /repos/o/r/branches/dev': { body: { name: 'dev', protected: false } },
  });
  const c = new GitHubClient('o/r', 't', fetchImpl, noRetry);
  const list = await c.listRulesets();
  assert.equal(list[0]!.html_url, 'https://github.com/o/r/rules/25324954');
  assert.equal((await c.getRuleset(25324954)).rules!.length, 4);
  assert.equal(await c.getBranchProtection('main'), undefined);
  assert.equal(await c.getBranchProtection('dev'), null);
  assert.equal(await c.getBranchProtection('gone'), null);
  const s = await loadProtection(c, 'main');
  assert.equal(s.kind, 'protected');
});

test('loadProtection: unreadable rulesets give unknown', async () => {
  const { fetchImpl } = stub({ 'GET /repos/o/r/rulesets?includes_parents=true&per_page=100': { status: 403, body: { message: 'Forbidden' } } });
  const s = await loadProtection(new GitHubClient('o/r', '', fetchImpl, noRetry), 'main');
  assert.equal(s.kind, 'unknown');
});

test('loadRequiredChecks + protectLibrary: creates the ruleset, or replaces the Bridge one', async () => {
  const runs = (names: [string, string, string?][]) => ({ check_runs: names.map(([name, conclusion, app], i) => ({ id: i, name, status: 'completed', conclusion, app: { slug: app ?? 'github-actions' } })) });
  const { calls, fetchImpl } = stub({
    'GET /repos/o/r/commits/main/check-runs': { body: runs([['Guardrails', 'success'], ['Version or publish', 'success'], ['Vercel Preview Comments', 'success', 'vercel']]) },
    'GET /repos/o/r/pulls?state=closed&per_page=50&sort=updated&direction=desc': {
      body: [
        { number: 9, title: 'closed', state: 'closed', merged_at: null, head: { sha: 'x' }, base: { ref: 'main' } },
        { number: 8, title: 'merged', state: 'closed', merged_at: '2026-10-01', head: { sha: 'prhead' }, base: { ref: 'main' } },
      ],
    },
    'GET /repos/o/r/commits/prhead/check-runs': { body: runs([['Guardrails', 'success'], ['Vercel Preview Comments', 'success', 'vercel']]) },
    'POST /repos/o/r/rulesets': { status: 201, body: { ...reference, id: 1 } },
    'PUT /repos/o/r/rulesets/77': { body: { ...reference, id: 77 } },
  });
  const c = new GitHubClient('o/r', 't', fetchImpl, noRetry);
  assert.deepEqual(await loadRequiredChecks(c, 'main'), ['Guardrails']);
  await protectLibrary(c, 'main');
  const post = calls.find((x) => x.method === 'POST')!;
  assert.equal(post.path, '/repos/o/r/rulesets');
  assert.deepEqual((post.body as { rules: { type: string; parameters?: { required_status_checks?: unknown } }[] }).rules[3]!.parameters!.required_status_checks, [{ context: 'Guardrails' }]);
  await protectLibrary(c, 'main', { checks: ['Guardrails'], state: { kind: 'partial', missing: ['checks'], bridgeRulesetId: 77 } });
  assert.ok(calls.some((x) => x.method === 'PUT' && x.path === '/repos/o/r/rulesets/77'));
  await assert.rejects(new GitHubClient('o/r', '', fetchImpl, noRetry).createRuleset(protectionRuleset(undefined, { checks: [], approvals: 1, adminBypass: true })), /needs a GitHub token/);
});

test('protectRefusal: plan, missing Administration permission, not an admin', () => {
  assert.match(protectRefusal(new GitHubError(403, 'x', 'Upgrade to GitHub Pro or make this repository public to enable this feature.'))!, /plan/);
  assert.match(protectRefusal(new GitHubError(403, 'x', 'Resource not accessible by personal access token', { auth: 'missing-permission', permission: 'administration' }))!, /Administration: Read and write/);
  assert.match(protectRefusal(new GitHubError(403, 'x', 'Must have admin rights'))!, /Only a repository admin/);
  assert.equal(protectRefusal(new GitHubError(500, 'x')), null);
  assert.equal(protectRefusal(new Error('x')), null);
});
