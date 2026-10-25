import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixPr, minutesAgo, reopenWith } from './claude-progress';
void fixPr;
void minutesAgo;

// The Bridge site cannot say (not deployed, offline): the plugin still finds Claude's fix on GitHub, by its branch and label.
test('fallback: the fix found on GitHub (bridge/figma-fixes-icon-button, figma-fixes) makes the row ready', async () => {
  const p = await reopenWith({ prs: [fixPr] });
  await p.until(() => p.row()!.getAttribute('data-claude') === 'ready');
  assert.equal(p.row()!.querySelector('[data-head]')!.textContent, "Claude's fix is ready");
  assert.ok([...p.row()!.querySelectorAll('button')].some((b) => b.textContent?.includes("See Claude's fix")));
});
