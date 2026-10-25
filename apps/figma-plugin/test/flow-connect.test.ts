// Flow: connect with a token (the developers' way), then the next step. The plugin lands on Pull, says "Connected" once
// and offers the one thing to do next (finding 1).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPO, openPlugin } from './ui-harness';

test('after connecting, Pull says Connected once and offers Check for updates', async () => {
  const p = await openPlugin({ connected: false });
  assert.equal(p.primary()?.textContent?.trim(), 'Sign in with Bridge');
  await p.click('For developers: connect with a token');
  p.type('GitHub repository', REPO);
  p.type('Token', 'ghp_test');
  await p.click('Save and check access');
  await p.until(() => p.headline() === 'Get your design system');
  assert.equal((p.text().match(/Connected/g) ?? []).length, 1, p.text());
  assert.match(p.text(), new RegExp(`Connected to ${REPO}\\.`));
  assert.equal(p.primary()?.textContent?.trim(), 'Check for updates');
  // Said once: the next step replaces it.
  await p.click('Check for updates');
  await p.until(() => /Bring your design system into this file/.test(p.headline()));
  assert.doesNotMatch(p.text(), /Connected to/);
});
