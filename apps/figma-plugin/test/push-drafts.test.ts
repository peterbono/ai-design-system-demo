// Push drafts per component (the plugin's own draft, and Claude's lines from the designer's own Claude), and the guard
// that the plugin has no API-key path anywhere: Bridge never calls Anthropic, Claude runs in the team's own account.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type ComponentChangeItem, buildSignature, toRequest } from '../src/sync/components';
import { componentDrafts } from '../src/sync/publish';

test('push requests get their own drafted summary while the description is the plugin draft', () => {
  const signature = buildSignature({ nodeId: '1:1', name: 'Badge', definitions: [], variants: [] });
  const item: ComponentChangeItem = { nodeId: '1:1', component: 'Badge', figmaName: 'Badge', kind: 'new-variant', changes: [{ field: 'Variant Tone', before: 'info', after: 'danger, info' }], signature };
  const drafted = componentDrafts([item], new Set(), 'Changes color.a.', 'Library', true);
  assert.equal(drafted[0]!.title, 'Add a danger tone');
  assert.equal(drafted[0]!.summary, 'Badge gets a new Tone value, danger.');
  const typed = componentDrafts([item], new Set(), 'Destructive states need it.', 'Library', false);
  assert.equal(typed[0]!.summary, 'Destructive states need it.');
  // Each request opens with its change line: Claude's when it wrote one, else the drafted one.
  assert.equal(drafted[0]!.line, 'Danger added to Tone');
  assert.equal(componentDrafts([item], new Set(), '', 'Library', true, new Map([['1:1', 'Danger tone added for destructive states']]))[0]!.line, 'Danger tone added for destructive states');
  // Claude's request title per component replaces the deterministic one; without it the drafted title stays.
  assert.equal(componentDrafts([item], new Set(), '', 'Library', true, undefined, new Map([['1:1', 'Add a danger tone for destructive rows']]))[0]!.title, 'Add a danger tone for destructive rows');
  assert.equal(componentDrafts([item], new Set(), '', 'Library', true)[0]!.title, 'Add a danger tone');
  assert.equal(toRequest(drafted[0]!, {}).line, 'Danger added to Tone');
});

test('no API-key path: no Anthropic address, no key field, in the plugin or its manifest', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(ts|html|css)$/.test(n)) files.push(f);
    }
  };
  walk('src');
  for (const f of [...files, 'manifest.json']) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /api\.anthropic\.com|console\.anthropic\.com|sk-ant-|anthropic-dangerous-direct-browser-access/, f);
  }
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as { networkAccess: { allowedDomains: string[]; reasoning: string } };
  assert.ok(!manifest.networkAccess.allowedDomains.some((d) => d.includes('anthropic')));
  assert.match(manifest.networkAccess.reasoning, /never calls Anthropic and holds no API key/);
});
