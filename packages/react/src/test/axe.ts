import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core on a rendered tree and fails with a readable list of violations.
 * color-contrast is off: jsdom does not compute styles; contrast is enforced by the token build.
 */
export async function expectNoAxeViolations(container: Element = document.body) {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(summary, summary.join('\n')).toEqual([]);
}
