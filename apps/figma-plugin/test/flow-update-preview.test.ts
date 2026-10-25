// Flow: a component changed in code since the last pull. Before updating, the review shows the default variant as it is
// in Figma now next to the code's image of the incoming version: "Before: in Figma now", "After: in code".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

test('an update to review shows "After: in code", the code image of the incoming version', async () => {
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
  p.routes.push((method, path, _b, url) => {
    if (method !== 'GET') return undefined;
    if (decodeURIComponent(path).endsWith(`/git/blobs/blob:${specsPath}`)) return { status: 200, body: { content: b64(JSON.stringify(specs)), encoding: 'base64' } };
    if (path.endsWith('/contents/figma-references/manifest.json') && url.searchParams.get('ref') === 'bridge-visual') return { status: 200, body: { type: 'file', encoding: 'base64', content: b64(JSON.stringify(manifest)), sha: 'm' } };
    if (path.endsWith('/contents/figma-references/button-default.png')) return { status: 200, body: { type: 'file', encoding: 'base64', content: 'Q09ERUFGVEVS', size: 9, sha: 'i' } };
    return undefined;
  });
  p.main['fidelity-export'] = (m: { keys: string[] }) => Object.fromEntries(m.keys.map((k) => [k, 'RklHTUFOT1c=']));

  // After a first pull the footer holds Compare with code; its result screen offers Check again.
  await p.click('Compare with code');
  await p.until(() => [...p.document.querySelectorAll('button')].some((b) => b.textContent === 'Compare again'));
  await p.click('Check again');
  await p.until(() => p.text().includes('Component updates'));
  await p.until(() => !!p.document.querySelector('[data-preview="code"] img[alt="Button, after: in code"]'));
  const wrap = p.document.querySelector('[data-preview="code"]')!;
  const caps = [...wrap.querySelectorAll('figcaption')].map((c) => c.textContent);
  assert.deepEqual(caps, ['Before: in Figma now', 'After: in code']);
  const imgs = [...wrap.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  assert.deepEqual(imgs, ['data:image/png;base64,RklHTUFOT1c=', 'data:image/png;base64,Q09ERUFGVEVS']);
  assert.match(wrap.textContent ?? '', /Figma gets as close to this as Bridge can draw it/);
  assert.ok([...wrap.querySelectorAll('button')].some((b) => b.textContent === 'Enlarge'));
  // The export asked for the default variant only: the same one the code image shows.
  assert.ok(p.calls.includes('fidelity-export'));
});
