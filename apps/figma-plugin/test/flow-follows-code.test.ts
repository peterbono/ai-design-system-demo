// Flow: a file pulled from component-specs.json, with no spec source chosen (Automatic). The team's measure appears on
// the measure branch: the next Check for updates moves the sets onto it, and the update list says so once, plainly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

const FOLLOWS = 'Components now follow how they look in code, measured in Storybook.';

test('Automatic: the measure arrives, the update list says once that components now follow the code', async () => {
  const p = await openPlugin();
  await p.click('Check for updates');
  assert.ok(!p.text().includes(FOLLOWS), 'no measure yet: a first pull from the static spec says nothing about it');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);

  // The file as an older plugin left it: sets with no source recorded (they came from the static spec).
  const sets = (await p.main['scan-generated']!({})) as { specSource?: string }[];
  assert.ok(sets.length > 1);
  assert.ok(sets.every((s) => s.specSource === 'static'), 'a pull records the source on each set');
  for (const s of sets) delete s.specSource;

  // The automatic measure publishes on bridge-requests.
  const measure = JSON.parse(readFileSync('test/fixtures/measured-specs.json', 'utf8'));
  p.routes.push((method, path, _b, url) => (method === 'GET' && path.endsWith('/contents/measured-specs.json') && url.searchParams.get('ref') === 'bridge-requests' ? { status: 200, body: measure } : undefined));
  p.main['fidelity-export'] = (m: { keys: string[] }) => Object.fromEntries(m.keys.map((k) => [k, 'RklHTUFOT1c=']));

  await p.click('Compare with code');
  await p.until(() => [...p.document.querySelectorAll('button')].some((b) => b.textContent === 'Check again'), 15000);
  await p.click('Check again');
  await p.until(() => p.text().includes('Component updates'), 15000);
  const text = p.text();
  assert.equal(text.split(FOLLOWS).length - 1, 1, 'said once, not per row');
  assert.match(text, /Spec sourceMeasured only/);
});
