import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTokenSet } from '../src/core/token-set';
import { validateProposal, validateSet } from '../src/core/validators';
import { parseContrastPairs } from '../src/core/wcag';
import { realFiles, realPairsText, realSet } from './helpers';

const pairs = parseContrastPairs(realPairsText());

function edit(file: string, from: string, to: string) {
  const files = realFiles();
  assert.ok(files[file]!.includes(from), `${from} not found in ${file}`);
  files[file] = files[file]!.replace(from, to);
  return buildTokenSet(files);
}

test('the real token set passes every guardrail', () => {
  const { issues } = validateSet(realSet(), pairs);
  assert.deepEqual(issues, []);
});

test('semantic raw value is an error', () => {
  const set = edit('semantic/dark.tokens.json', '"$value": "{color.neutral.950}"', '"$value": "#000000"');
  const codes = validateSet(set, pairs).issues.map((i) => i.code);
  assert.ok(codes.includes('semantic-raw-value'));
});

test('semantic pointing to a semantic token is an error', () => {
  const set = edit('semantic/light.tokens.json', '"$value": "{color.neutral.600}"', '"$value": "{color.text.default}"');
  const issue = validateSet(set, pairs).issues.find((i) => i.code === 'semantic-alias-not-primitive');
  assert.equal(issue?.path, 'color.text.muted');
  assert.match(issue!.message, /must point directly to a primitive/);
});

test('cycles and broken references are errors', () => {
  const cyc = edit('semantic/light.tokens.json', '"$value": "{color.neutral.600}"', '"$value": "{color.text.muted}"');
  assert.ok(validateSet(cyc, pairs).issues.some((i) => i.code === 'alias-cycle' && i.path === 'color.text.muted'));
  const broken = edit('semantic/light.tokens.json', '"$value": "{color.neutral.600}"', '"$value": "{color.neutral.650}"');
  assert.ok(validateSet(broken, pairs).issues.some((i) => i.code === 'broken-reference' && i.path === 'color.text.muted'));
});

test('ALL_SCOPES is an error', () => {
  const set = edit('primitives/radius.tokens.json', '"sm": { "$value": { "value": 4, "unit": "px" } }', '"sm": { "$value": { "value": 4, "unit": "px" }, "$extensions": { "com.figma.scopes": ["ALL_SCOPES"] } }');
  assert.ok(validateSet(set, pairs).issues.some((i) => i.code === 'all-scopes' && i.path === 'radius.sm'));
});

test('a semantic token missing from one theme is an error', () => {
  const set = edit('semantic/dark.tokens.json', '"on-solid": {\n        "$value": "{color.neutral.0}"\n      }', '"on-solid-x": {\n        "$value": "{color.neutral.0}"\n      }');
  const missing = validateSet(set, pairs).issues.filter((i) => i.code === 'missing-theme').map((i) => `${i.path}@${i.mode}`);
  assert.deepEqual(missing.sort(), ['color.text.on-solid-x@light', 'color.text.on-solid@dark']);
});

test('text contrast below 4.5:1 blocks; problems already on main only warn', () => {
  const head = realSet();
  const bad = edit('semantic/light.tokens.json', '"$value": "{color.neutral.600}"', '"$value": "{color.neutral.300}"');
  const v = validateProposal(bad, head, pairs);
  assert.ok(v.blocking.some((i) => i.code === 'contrast' && i.path === 'color.text.muted on color.bg.default' && i.mode === 'light'));
  assert.match(v.blocking.find((i) => i.code === 'contrast')!.message, /WCAG AA needs 4\.5:1/);
  // Same problem on both sides: reported, not blocking.
  const again = validateProposal(bad, bad, pairs);
  assert.equal(again.blocking.length, 0);
  assert.ok(again.warnings.every((w) => w.message.startsWith('Already on main:')));
});

test('type changes always block', () => {
  const head = realSet();
  const v = validateProposal(head, head, pairs, [{ path: 'radius.sm', from: 'dimension', to: 'number' }]);
  assert.deepEqual(v.blocking.map((i) => i.code), ['type-change']);
});
