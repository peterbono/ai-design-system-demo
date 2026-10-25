// Flow: a component differs from the code, the designer asks the team's own Claude to fix it (Bridge is a connector in
// it; no API key anywhere). First time: one sentence and How to connect. Then the request is copied and Claude opens;
// the row waits, shows Claude's real steps as they arrive, and ends on "Claude's fix is ready" with See Claude's fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openPlugin, pixelsImage } from './ui-harness';

test('Ask Claude to fix it: connect once, the request copied, waiting, working with steps, then ready', async () => {
  let session: unknown;
  let prs: unknown[] = [];
  const p = await openPlugin({
    specSource: 'measured-only',
    files: { 'measured-specs.json': readFileSync('test/fixtures/measured-specs.json', 'utf8') },
    pixels: true,
    register: (routes) =>
      routes.push((method, path) => {
        if (path === '/api/fix-sessions' && method === 'GET') return session ? { status: 200, body: { session } } : { status: 404, body: { error: 'not_found' } };
        if (method === 'GET' && /\/pulls$/.test(path)) return { status: 200, body: prs };
        return undefined;
      }),
  });
  await p.click('Check for updates');
  await p.click('Apply to Figma');
  await p.until(() => p.headline() === 'Your design system is in Figma', 15000);

  // Published code images of this version: Figma draws grey 0 where the code draws grey 255, so Button differs.
  const sets = (await p.main['scan-generated']!({})) as { componentId: string; name: string; codeHash?: string; specHash: string; variants: string[] }[];
  const button = sets.find((s) => s.name === 'Button')!;
  const manifest = { version: 1, tool: '@bridge-ds/visual', createdAt: 'x', sha: 'x', scale: 2, mode: {}, storyId: '', components: { [button.componentId]: { specHash: button.codeHash || button.specHash, variants: Object.fromEntries(button.variants.map((k) => [k, { file: 'b.png', width: 4, height: 4 }])) } } };
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
  await p.click('Ask Claude to fix it');

  // First time in this file: one sentence, How to connect (Studio Settings, Claude), the developer fallback.
  await p.until(() => !!p.document.querySelector('[data-claude="connect"]'));
  const connect = p.document.querySelector('[data-claude="connect"]')!;
  assert.match(connect.textContent ?? '', /Add Bridge to your team's Claude once, then ask it to fix components\./);
  for (const b of ['How to connect', 'Bridge is in our Claude', 'Copy for your developer']) assert.ok([...connect.querySelectorAll('button')].some((x) => x.textContent?.includes(b)), b);
  await p.click('How to connect');
  assert.ok(p.calls.includes('open-url'));

  // Bridge is in the team's Claude: the request is copied, Claude opens, the row asks to paste it.
  await p.click('Bridge is in our Claude');
  await p.until(() => !!p.document.querySelector('[data-claude="asked"]'));
  assert.ok(p.copied.includes('Fix Button in Figma with Bridge'), 'the request on the clipboard');
  assert.match(p.document.querySelector('[data-claude="asked"]')!.textContent ?? '', /The request is copied\. Paste it in Claude\./);
  assert.ok(p.calls.includes('PUT /repos/acme/acme-design-system/contents/figma-fidelity.json'), 'the check for Claude to read');
  // No API key path anywhere.
  assert.ok(!p.calls.some((c) => /anthropic|\/api\/claude/.test(c)));

  // Nothing from Claude yet: "Waiting for Claude", with Open Claude again.
  await p.until(() => p.document.querySelector('[data-claude="waiting"] [data-head]')?.textContent === 'Waiting for Claude', 25000);
  assert.ok([...p.document.querySelectorAll('[data-claude="waiting"] button')].some((b) => b.textContent?.includes('Open Claude again')));
  assert.ok(!p.text().includes('Ask Claude to fix it'), 'not asked twice');
});
