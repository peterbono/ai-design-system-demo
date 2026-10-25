// Flow: a component changed in code, and the team has no image of its code. Bridge draws the incoming version itself,
// off-canvas, as the row comes into view: "After: drawn by Bridge". When it cannot, the list of changes stays.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

test('no code images: "After: drawn by Bridge", drawn off-canvas as the row comes into view', async () => {
  const p = await openPlugin();
  await p.click('Check for updates');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);

  // The code moves on: Button gets a new version (its hash), and the published code images are of that version.
  const specsPath = 'packages/react/component-specs.json';
  const specs = JSON.parse(p.data.files[specsPath]!) as { components: { name: string; hash: string; source?: unknown }[] };
  const button = specs.components.find((c) => c.name === 'Button')!;
  button.hash = 'a1b2c3d4';
  button.source = { changed: true };
  const generated = (await p.main['scan-generated']!({})) as { componentId: string; name: string; variants: string[] }[];
  const set = generated.find((g) => g.name === 'Button')!;
  const key = set.variants[0]!;
  const manifest = { version: 1, tool: '@bridge-ds/visual', createdAt: '2026-10-25', sha: 'x', scale: 2, mode: {}, storyId: '', components: { [set.componentId]: { specHash: 'a1b2c3d4', variants: { [key]: { file: 'button-default.png', width: 80, height: 36 } } } } };
  p.routes.push((method, path) => {
    if (method !== 'GET') return undefined;
    if (decodeURIComponent(path).endsWith(`/git/blobs/blob:${specsPath}`)) return { status: 200, body: { content: b64(JSON.stringify(specs)), encoding: 'base64' } };
    return undefined;
  });
  p.main['fidelity-export'] = (m: { keys: string[] }) => Object.fromEntries(m.keys.map((k) => [k, 'RklHTUFOT1c=']));
  const drawn: string[] = [];
  p.main['render-incoming'] = (m: { component: { name: string }; key: string }) => (drawn.push(`${m.component.name}|${m.key}`), { base64: 'RFJBV05CWUJSSURHRQ==', ms: 120 });
  void manifest;

  // After a first pull the footer holds Compare with code; its result screen offers Check again.
  await p.click('Compare with code');
  await p.until(() => [...p.document.querySelectorAll('button')].some((b) => b.textContent === 'Compare again'));
  await p.click('Check again');
  await p.until(() => p.text().includes('Component updates'));
  await p.until(() => !!p.document.querySelector('[data-preview="bridge"] img[alt="Button, after: drawn by bridge"]'));
  const wrap = p.document.querySelector('[data-preview="bridge"]')!;
  assert.deepEqual([...wrap.querySelectorAll('figcaption')].map((c) => c.textContent), ['Before: in Figma now', 'After: drawn by Bridge']);
  assert.deepEqual([...wrap.querySelectorAll('img')].map((i) => i.getAttribute('src')), ['data:image/png;base64,RklHTUFOT1c=', 'data:image/png;base64,RFJBV05CWUJSSURHRQ==']);
  assert.deepEqual(drawn, [`Button|${key}`], 'one drawing, the default variant, the visible row');
  assert.equal(wrap.getAttribute('title'), 'Drawn by Bridge in 120 ms');
  assert.ok([...wrap.querySelectorAll('button')].some((b) => b.textContent === 'Enlarge'));
});
