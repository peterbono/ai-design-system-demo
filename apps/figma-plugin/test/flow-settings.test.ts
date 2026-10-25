// Flow: a finished Check fidelity, then a settings save that fails (a repository that does not exist). Nothing the
// designer had is lost, Settings never says "Connected" above the error, and the header keeps the design system that
// is really connected (B3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPO, openPlugin } from './ui-harness';

test('a failed settings save keeps the fidelity result and never shows Connected above the error', async () => {
  const p = await openPlugin();
  // A first pull builds the component sets; Check fidelity from its result: no code images yet, a finished result.
  await p.click('Check for updates');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);
  await p.click('Check fidelity');
  await p.until(() => p.text().includes('Images of the code are not published yet'));

  await p.click('Settings');
  await p.click('Edit the connection');
  const savesBefore = p.calls.filter((c) => c === 'save-settings').length;
  p.type('GitHub repository', 'acme/missing');
  await p.click('Save and check access');
  await p.until(() => /can't find|cannot find|not found/i.test(p.text()));
  const settings = p.text();
  assert.doesNotMatch(settings, /Connected/, 'no "Connected" above a "not found" error');
  assert.match(settings, /acme\/missing/, 'the error names the repository it could not find');
  assert.equal(p.calls.filter((c) => c === 'save-settings').length, savesBefore, 'nothing saved');
  // The header still names the design system that is connected, never the one that failed.
  const header = p.document.querySelector('.repo')?.textContent ?? '';
  assert.ok(header && !/missing/.test(header), `header: ${header}`);
  // The cause and the fix, under the field it is about.
  const repoField = [...p.document.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent === 'GitHub repository');
  assert.match(repoField?.textContent ?? '', /Bridge can't find acme\/missing\. Check the name, or ask an admin/);
  void REPO;

  await p.click('Pull');
  assert.match(p.text(), /Images of the code are not published yet/, 'the fidelity result is still there');
});
