import assert from 'node:assert/strict';
import { test } from 'vitest';
import { GitHubError } from '@bridge-ds/core';
import {
  authFailure,
  CHECK_MAX_AGE_MS,
  checkFor,
  errorText,
  needsCheck,
  okCheck,
  rejectedCheck,
  sessionState,
  STUDIO_TOKEN_REJECTED,
  tokenFingerprint,
} from './token-session';

// Fixture strings only: never a real token.
const OLD = 'fixture-token-old';
const NEW = 'fixture-token-new';
const viewer = { login: 'octo', avatar_url: 'https://avatars.example/octo' };
const t0 = Date.UTC(2026, 9, 18, 9, 0);

test('fingerprint ties a check to one token without storing it', () => {
  assert.equal(tokenFingerprint(OLD), tokenFingerprint(OLD));
  assert.notEqual(tokenFingerprint(OLD), tokenFingerprint(NEW));
  assert.match(tokenFingerprint(OLD), /^[0-9a-f]{8}$/);
  assert.ok(!JSON.stringify(okCheck(OLD, viewer, t0)).includes(OLD));
});

test('state: none, checking, connected, rejected', () => {
  assert.equal(sessionState(null, null), 'none');
  assert.equal(sessionState(OLD, null), 'checking');
  assert.equal(sessionState(OLD, okCheck(OLD, viewer, t0)), 'connected');
  assert.equal(sessionState(OLD, rejectedCheck(OLD, t0)), 'rejected');
});

test('a regenerated token: the old one is rejected, saving the new one starts fresh', () => {
  const rejected = rejectedCheck(OLD, t0);
  assert.equal(sessionState(OLD, rejected), 'rejected');
  // The check belongs to the old token: the new one is checked again, never shown as rejected.
  assert.equal(checkFor(rejected, NEW), null);
  assert.equal(sessionState(NEW, rejected), 'checking');
  assert.equal(needsCheck(rejected, NEW, t0 + 1000), true);
});

test('check at most once an hour', () => {
  const c = okCheck(OLD, viewer, t0);
  assert.equal(needsCheck(c, OLD, t0 + 60_000), false);
  assert.equal(needsCheck(c, OLD, t0 + CHECK_MAX_AGE_MS - 1), false);
  assert.equal(needsCheck(c, OLD, t0 + CHECK_MAX_AGE_MS), true);
  assert.equal(needsCheck(null, OLD, t0), true);
  assert.equal(needsCheck(c, null, t0), false, 'no token, nothing to check');
  assert.equal(needsCheck(c, OLD, t0 - 1), true, 'a clock that went back checks again');
});

test('write actions: one message for a refused token, the permission for a missing one', () => {
  const rejected = new GitHubError(401, 'x', 'Bad credentials', { auth: 'rejected' });
  assert.deepEqual(authFailure(rejected, 'create issues'), { kind: 'rejected', text: STUDIO_TOKEN_REJECTED });
  assert.equal(errorText(rejected, 'GitHub did not open the request'), STUDIO_TOKEN_REJECTED);

  const perm = new GitHubError(403, 'x', 'Resource not accessible by personal access token', { auth: 'missing-permission', permission: 'issues' });
  const a = authFailure(perm, 'create issues');
  assert.equal(a?.kind, 'missing-permission');
  assert.equal(a?.text, 'This token cannot create issues. Add Issues: Read and write on GitHub.');
  assert.equal(a?.href, 'https://github.com/settings/personal-access-tokens');

  assert.equal(authFailure(new GitHubError(404, 'Not found')), null);
  assert.equal(authFailure(new Error('boom')), null);
  assert.equal(errorText(new Error('boom'), 'Not proposed: boom'), 'Not proposed: boom');
  assert.doesNotMatch(STUDIO_TOKEN_REJECTED, /\u2014/);
});
