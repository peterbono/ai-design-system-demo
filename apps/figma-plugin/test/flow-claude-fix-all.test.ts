// Flow: many components differ from the code; the designer asks the team's Claude once for all of them. "Ask Claude to
// fix all N" under the summary: the first time, the connect sentence once for the list; then one request naming every
// component, the check written once, and every row waiting for its own fix. Each row keeps its own button until asked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openPlugin, pixelsImage } from './ui-harness';

test('Ask Claude to fix all N: connect once, one request for the list, every row waiting', async () => {
  const p = await openPlugin({
    specSource: 'measured',
    files: { 'measured-specs.json': readFileSync('test/fixtures/measured-specs.json', 'utf8') },
    pixels: true,
    register: (routes) =>
      routes.push((method, path) => {
        if (path === '/api/fix-sessions' && method === 'GET') return { status: 404, body: { error: 'not_found' } };
        if (method === 'GET' && /\/pulls$/.test(path)) return { status: 200, body: [] };
        return undefined;
      }),
  });
  await p.click('Check for updates');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);

  // Code images for three sets: Figma draws grey 0 where the code draws grey 255, so all three differ.
  const sets = (await p.main['scan-generated']!({})) as { componentId: string; name: string; codeHash?: string; specHash: string; variants: string[] }[];
  const picked = sets.slice(0, 3);
  assert.equal(picked.length, 3, sets.map((s) => s.name).join(', '));
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
  p.main['fidelity-export'] = (m: { keys: string[] }) => Object.fromEntries(m.keys.map((k) => [k, pixelsImage(4, 4, 0)]));
  p.main['read-built'] = () => ({});

  await p.click('Compare with code');
  await p.until(() => /differ/.test(p.headline()), 15000);
  const rowButtons = () => [...p.document.querySelectorAll('button')].filter((b) => b.textContent === 'Ask Claude to fix it').length;
  assert.equal(rowButtons(), 3, 'each row keeps its own button');
  // The rows' order, which the request keeps.
  const names = [...p.document.querySelectorAll('button')].filter((b) => b.textContent === 'Ask Claude to fix it').map((b) => b.getAttribute('data-focus-id')!.replace(/^fix-/, ''));
  const all = p.document.querySelector<HTMLButtonElement>('[data-focus-id="fix-all"]')!;
  assert.equal(all.textContent, 'Ask Claude to fix all 3');
  assert.ok(all.classList.contains('primary'));

  // Not connected yet: the connect sentence once, for the list, not on every row.
  await p.click('Ask Claude to fix all 3');
  await p.until(() => !!p.document.querySelector('[data-claude="connect"]'));
  assert.equal(p.document.querySelectorAll('[data-claude="connect"]').length, 1);

  const opened: string[] = [];
  p.main['open-url'] = (m: { url: string }) => (opened.push(m.url), { opened: true });
  const request = `Fix these 3 components in Figma with Bridge: ${names.join(', ')}`;
  await p.click('Bridge is in our Claude');
  await p.until(() => !!p.document.querySelector('[data-claude="asked"]'));
  assert.deepEqual(opened, [`https://claude.ai/new?q=${encodeURIComponent(request)}`], 'Claude opens once, with the list');
  assert.ok(p.copied.includes(request), 'the full request on the clipboard too');
  assert.equal(p.calls.filter((c) => c === 'PUT /repos/acme/acme-design-system/contents/figma-fidelity.json').length, 1, 'the check written once');
  assert.equal(p.document.querySelectorAll('[data-claude="asked"]').length, 1, 'what to do in Claude, once');
  assert.match(p.document.querySelector('[data-claude="asked"]')!.textContent ?? '', /Claude fixes them one by one/);

  // Every row waits for its own fix; no ask button is left.
  await p.until(() => p.document.querySelectorAll('[data-claude="waiting"]').length === 3, 25000);
  assert.equal(rowButtons(), 0);
  assert.ok(!p.document.querySelector('[data-focus-id="fix-all"]'));
  assert.doesNotMatch(p.text(), /\u2014/);
});
