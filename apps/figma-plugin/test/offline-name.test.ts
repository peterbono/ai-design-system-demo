// Offline is one calm sentence with no details; the design system keeps one name across sessions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHubError } from '@bridge-ds/core';
import { type SharedStore, saveSettings, sharedSettings } from '../src/main/shared-state';
import { OFFLINE_TEXT, friendlyError, isOffline } from '../src/sync/token-health';

function fakeRoot(initial: Record<string, string> = {}): SharedStore {
  const data = new Map(Object.entries(initial));
  return { get: (k) => data.get(k) ?? '', set: (k, v) => void data.set(k, v), keys: () => [...data.keys()] };
}

test('no network: one calm sentence, nothing technical folded under it', () => {
  const fromClient = new GitHubError(0, 'Could not reach GitHub. Check your connection, then try again.', 'Failed to fetch');
  for (const err of [fromClient, new TypeError('Failed to fetch')]) {
    assert.ok(isOffline(err));
    assert.deepEqual(friendlyError(err), { text: OFFLINE_TEXT });
  }
  assert.equal(OFFLINE_TEXT, "You're offline. Bridge will try again when you're back.");
  assert.equal(isOffline(new GitHubError(404, 'Not Found', 'Not Found')), false);
  assert.equal(isOffline(new TypeError('x is undefined')), false);
});

test('the design system name is kept with the file, and forgotten when the repository changes', () => {
  const root = fakeRoot({ repo: 'acme/ds' });
  assert.equal(sharedSettings(root).name, undefined);
  saveSettings(root, { ...sharedSettings(root), name: 'Acme DS' });
  assert.equal(sharedSettings(root).name, 'Acme DS');
  // Saving again without a name (the Settings form of an older session) keeps it for the same repository.
  saveSettings(root, { repo: 'acme/ds', branch: 'main', tokensPath: 'tokens' });
  assert.equal(sharedSettings(root).name, 'Acme DS');
  saveSettings(root, { repo: 'other/ds', branch: 'main', tokensPath: 'tokens' });
  assert.equal(sharedSettings(root).name, undefined);
});
