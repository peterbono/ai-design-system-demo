import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  classifyAuth,
  type FetchLike,
  GitHubClient,
  GitHubError,
  isMissingPermission,
  isTokenRejected,
  missingPermissionMessage,
  permissionLabel,
  requiredPermission,
} from '../src/github-client';

const once = { attempts: 1, baseDelayMs: 0, sleep: async () => undefined };

function answer(status: number, message: string, headers: Record<string, string> = {}): FetchLike {
  return async () => ({
    ok: false,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => ({ message }),
    text: async () => '',
  });
}

test('401 with a token: the token was rejected (revoked, regenerated or expired)', async () => {
  const c = new GitHubClient('o/r', 'test-token', answer(401, 'Bad credentials'), once);
  await assert.rejects(c.getRepo(), (err: unknown) => {
    assert.ok(err instanceof GitHubError);
    assert.equal(err.auth, 'rejected');
    assert.equal(err.permission, undefined);
    assert.match(err.message, /^Your GitHub token stopped working/);
    assert.ok(isTokenRejected(err));
    return true;
  });
});

test('no token: a write is refused before any request and is not a rejected token', async () => {
  let called = false;
  const c = new GitHubClient('o/r', '', async () => {
    called = true;
    throw new Error('unreachable');
  });
  await assert.rejects(c.markReadyForReview(3), (err: unknown) => err instanceof GitHubError && err.status === 401 && err.auth === undefined);
  assert.equal(called, false);
});

test('403 "Resource not accessible by personal access token" names the permission from the endpoint', async () => {
  const c = new GitHubClient('o/r', 'test-token', answer(403, 'Resource not accessible by personal access token'), once);
  await assert.rejects(c.createIssue({ title: 't', body: 'b' }), (err: unknown) => {
    assert.ok(err instanceof GitHubError);
    assert.equal(err.auth, 'missing-permission');
    assert.equal(err.permission, 'issues');
    assert.ok(isMissingPermission(err));
    assert.equal(err.message, 'This token is missing a permission for this. Add Issues: Read and write on GitHub.');
    return true;
  });
});

test('403 with X-Accepted-GitHub-Permissions trusts the header over the endpoint', async () => {
  const c = new GitHubClient('o/r', 'test-token', answer(403, 'Resource not accessible by personal access token', { 'x-accepted-github-permissions': 'pull_requests=write' }), once);
  await assert.rejects(c.addComment(3, 'hi'), (err: unknown) => err instanceof GitHubError && err.permission === 'pull_requests');
});

test('403 rate limits stay rate limits, archived stays archived', async () => {
  const limited = new GitHubClient('o/r', 'test-token', answer(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0' }), once);
  await assert.rejects(limited.getRepo(), (err: unknown) => err instanceof GitHubError && err.status === 429 && err.auth === undefined && /hourly request limit/.test(err.message));
  const secondary = new GitHubClient('o/r', 'test-token', answer(403, 'You have exceeded a secondary rate limit'), once);
  await assert.rejects(secondary.getRepo(), (err: unknown) => err instanceof GitHubError && err.auth === undefined && /limiting requests/.test(err.message));
  assert.deepEqual(classifyAuth(403, 'Repository was archived so is read-only.'), {});
});

test('requiredPermission reads the header first, then the endpoint', () => {
  assert.equal(requiredPermission('/repos/o/r/issues', 'issues=write'), 'issues');
  assert.equal(requiredPermission('/repos/o/r/issues', 'metadata=read, contents=write'), 'contents');
  assert.equal(requiredPermission('/repos/o/r/pulls/3/reviews'), 'pull_requests');
  assert.equal(requiredPermission('/repos/o/r/git/refs'), 'contents');
  assert.equal(requiredPermission('/repos/o/r/contents/a%2Fb.json?ref=x'), 'contents');
  assert.equal(requiredPermission('/repos/o/r/issues/4/labels'), 'issues');
  assert.equal(requiredPermission('/repos/o/r/check-runs'), 'checks');
  assert.equal(requiredPermission('/user'), undefined);
});

test('classifyAuth: unknown 403 stays generic, 401 without a token is not "rejected"', () => {
  assert.deepEqual(classifyAuth(403, 'Forbidden'), {});
  assert.deepEqual(classifyAuth(401, 'Requires authentication', { withToken: false }), {});
  assert.deepEqual(classifyAuth(401, 'Bad credentials'), { auth: 'rejected' });
  assert.deepEqual(classifyAuth(403, 'Must have admin rights to Repository.', { path: '/repos/o/r/branches/main/protection' }), {
    auth: 'missing-permission',
    permission: 'administration',
  });
});

test('missingPermissionMessage says which permission to add and how', () => {
  assert.equal(missingPermissionMessage('issues', 'create issues'), 'This token cannot create issues. Add Issues: Read and write on GitHub.');
  assert.equal(permissionLabel('pull_requests'), 'Pull requests');
  assert.equal(permissionLabel('statuses'), 'Commit statuses');
  assert.match(missingPermissionMessage(undefined, 'merge'), /^This token cannot merge\. Check its repository permissions/);
  assert.doesNotMatch(missingPermissionMessage('contents'), /\u2014/);
});
