// Flow: Compare with code renders every variant of every set and compares it with the code's image, minutes on a full
// library. The bar sits in the Compare with code block, where the result appears: the set it compares in words, and
// the percentage of all the variants, then the result replaces it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin, pixelsImage } from './ui-harness';

test('Compare with code: a bar of the variants compared, in the block where the result appears', async () => {
  const p = await openPlugin({ pixels: true });
  await p.click('Check for updates');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);

  const sets = (await p.main['scan-generated']!({})) as { componentId: string; name: string; codeHash?: string; specHash: string; variants: string[] }[];
  const picked = sets.slice(0, 3);
  const total = sets.reduce((n, s) => n + Math.max(1, s.variants.length), 0);
  const manifest = {
    version: 1,
    tool: '@bridge-ds/visual',
    createdAt: 'x',
    sha: 'x',
    scale: 2,
    mode: {},
    storyId: '',
    components: Object.fromEntries(picked.map((s) => [s.componentId, { specHash: s.codeHash || s.specHash, variants: Object.fromEntries(s.variants.map((k) => [k, { file: 'b.png', width: 4, height: 4 }])) }])),
  };
  const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');
  p.routes.unshift((method, path) => {
    if (method !== 'GET') return undefined;
    if (path.endsWith('/contents/figma-references/manifest.json')) return { status: 200, body: { type: 'file', encoding: 'base64', content: b64(JSON.stringify(manifest)), sha: 'm' } };
    if (path.endsWith('/contents/figma-references/b.png')) return { status: 200, body: { type: 'file', encoding: 'base64', content: pixelsImage(4, 4, 255), size: 9, sha: 'i' } };
    return undefined;
  });
  // The second set's render waits: the bar shows how far the run is meanwhile.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let exports = 0;
  p.main['fidelity-export'] = async (m: { keys: string[] }) => {
    if (++exports === 2) await gate;
    return Object.fromEntries(m.keys.map((k) => [k, pixelsImage(4, 4, 255)]));
  };
  p.main['read-built'] = () => ({});

  const bar = () => p.document.querySelector('[data-progress="compare"]');
  await p.click('Compare with code');
  await p.until(() => /Comparing .+, 2 of/.test(bar()?.textContent ?? ''));
  const track = bar()!.querySelector('[role="progressbar"]')!;
  const first = Math.max(1, picked[0]!.variants.length);
  assert.equal(track.getAttribute('aria-valuemax'), String(total), 'counted in variants, every set of the file');
  assert.equal(track.getAttribute('aria-valuenow'), String(first), "the first set's variants are done");
  assert.match(track.getAttribute('aria-valuetext')!, new RegExp(`^\\d+%, ${first} of ${total} variants`));
  assert.match(bar()!.querySelector('.progress-pct')!.textContent!, /^\d+%$/);
  // Too early to say the time left: the bar says it is working it out instead of guessing.
  assert.equal(bar()!.querySelector('.progress-eta')!.textContent, 'Working out the time left');
  // In the Compare with code block, under its sentence: where the result will appear.
  assert.ok(bar()!.closest('section.group')?.textContent?.includes('Compare with code'));
  assert.ok(!p.document.querySelector('.bar [data-progress]'), 'one bar for this job, not a second one in the action bar');

  release();
  await p.until(() => !bar(), 15000);
  assert.match(p.text(), /match the code|differ/);
});
