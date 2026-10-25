import assert from 'node:assert/strict';
import { test } from 'vitest';
import { localTryCommand, noOnlinePreview } from '../src/try-in-product';

test('local try: the git command for a branch, quoted when its name has shell characters', () => {
  assert.equal(localTryCommand('explore/pill-buttons'), 'git fetch origin && git switch explore/pill-buttons');
  assert.equal(localTryCommand("explore/a;rm -rf ~'x"), "git fetch origin && git switch 'explore/a;rm -rf ~'\\''x'");
});

test('local try: no online preview while only config templates exist; any Vercel report means online', () => {
  assert.equal(noOnlinePreview([]), true);
  assert.equal(noOnlinePreview([{ source: 'template' }, { source: null }]), true);
  assert.equal(noOnlinePreview([{ source: 'template' }, { source: 'status' }]), false);
});
