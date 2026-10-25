// Figma refuses to load a manifest whose networkAccess.reasoning reaches 1000 characters.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as {
  networkAccess: { allowedDomains: string[]; reasoning: string };
};

test('networkAccess.reasoning stays under the 1000 characters Figma accepts', () => {
  assert.ok(manifest.networkAccess.reasoning.length < 1000, `reasoning is ${manifest.networkAccess.reasoning.length} characters`);
});

test('the reasoning names every allowed domain', () => {
  for (const d of manifest.networkAccess.allowedDomains) assert.ok(manifest.networkAccess.reasoning.includes(new URL(d).host), d);
});
