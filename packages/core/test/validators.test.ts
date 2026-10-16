import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseTokenFile, readTokenAt, serializeTokenFile, upsertToken } from '../src/dtcg-codec';
import { buildTokenSet } from '../src/token-set';
import { validateProposal, validateSet } from '../src/validators';
import { parseContrastChecks } from '../src/wcag';
import { realChecksText, realFiles, realSet } from './helpers';

const pairs = parseContrastChecks(realChecksText());

/** Real files with the token at `path` in `file` set to `value` (through the codec, like a push). */
function withValue(edits: [file: string, path: string, value: unknown][], files = realFiles()) {
  for (const [file, path, value] of edits) {
    const doc = parseTokenFile(file, files[file]!);
    const t = readTokenAt(doc, path);
    assert.ok(t, `${path} not found in ${file}`);
    upsertToken(doc, path, { type: t.type!, value, description: t.description });
    files[file] = serializeTokenFile(doc);
  }
  return buildTokenSet(files);
}

const codes = (set: ReturnType<typeof buildTokenSet>) => validateSet(set, pairs).issues.map((i) => `${i.code}:${i.path}`);

test('the real token set passes every guardrail in every brand and theme', () => {
  const { issues, contrast } = validateSet(realSet(), pairs);
  assert.deepEqual(issues, []);
  assert.equal(contrast.length, pairs.length * 4, 'bridge and ocean, light and dark');
});

test('raw values are errors where a tier needs an alias', () => {
  const black = { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' };
  const set = withValue([
    ['semantic/dark.tokens.json', 'color.text.default', black],
    ['brands/ocean.tokens.json', 'palette.neutral.500', black],
    ['components/button.tokens.json', 'button.primary.bg', black],
  ]);
  const c = codes(set);
  for (const p of ['color.text.default', 'palette.neutral.500', 'button.primary.bg']) assert.ok(c.includes(`raw-value:${p}`), c.join('\n'));
});

test('semantic colors must alias a palette role, not a primitive or another semantic token', () => {
  const set = withValue([
    ['semantic/light.tokens.json', 'color.text.muted', '{color.steel.600}'],
    ['semantic/light.tokens.json', 'color.text.disabled', '{color.text.default}'],
  ]);
  const issues = validateSet(set, pairs).issues.filter((i) => i.code === 'alias-tier');
  assert.deepEqual(issues.map((i) => i.path).sort(), ['color.text.disabled', 'color.text.muted']);
  assert.match(issues.find((i) => i.path === 'color.text.muted')!.message, /Brand palette role \(palette\.\*\)/);
});

test('component tokens must alias semantic tokens, never palette roles or raw colors', () => {
  const set = withValue([
    ['components/button.tokens.json', 'button.primary.bg', '{palette.primary.600}'],
    ['components/button.tokens.json', 'button.primary.text', '{color.white}'],
  ]);
  const c = codes(set);
  assert.ok(c.includes('alias-tier:button.primary.bg'), c.join('\n'));
  assert.ok(c.includes('alias-tier:button.primary.text'), c.join('\n'));
});

test('brand and density tokens must alias primitives', () => {
  const set = withValue([
    ['brands/bridge.tokens.json', 'palette.neutral.500', '{color.text.default}'],
    ['density/compact.tokens.json', 'control.height.md', '{radius.control}'],
  ]);
  const c = codes(set);
  assert.ok(c.includes('alias-tier:palette.neutral.500'), c.join('\n'));
  assert.ok(c.includes('alias-tier:control.height.md'), c.join('\n'));
});

test('brand overrides follow the semantic rule and must override an existing token', () => {
  const files = realFiles();
  files['brands/ocean.light.tokens.json'] = files['brands/ocean.light.tokens.json']!.replace('"{palette.primary.600}"', '"{color.steel.600}"').replace('"bg-hover": {', '"bg-hoover": {');
  const c = codes(buildTokenSet(files));
  assert.ok(c.includes('alias-tier:color.action.primary.bg'), c.join('\n'));
  assert.ok(c.includes('override-orphan:color.action.primary.bg-hoover'), c.join('\n'));
});

test('cycles and broken references are errors', () => {
  const cyc = withValue([['semantic/light.tokens.json', 'color.text.muted', '{color.text.muted}']]);
  assert.ok(validateSet(cyc, pairs).issues.some((i) => i.code === 'alias-cycle' && i.path === 'color.text.muted'));
  const broken = withValue([['semantic/light.tokens.json', 'color.text.muted', '{palette.neutral.650}']]);
  assert.ok(validateSet(broken, pairs).issues.some((i) => i.code === 'broken-reference' && i.path === 'color.text.muted'));
});

test('ALL_SCOPES is an error', () => {
  const files = realFiles();
  const doc = parseTokenFile('primitives/radius.tokens.json', files['primitives/radius.tokens.json']!);
  upsertToken(doc, 'radius.sm', { type: 'dimension', value: { value: 4, unit: 'px' }, description: undefined, extensions: { 'com.figma.scopes': ['ALL_SCOPES'] } });
  files['primitives/radius.tokens.json'] = serializeTokenFile(doc);
  assert.ok(validateSet(buildTokenSet(files), pairs).issues.some((i) => i.code === 'all-scopes' && i.path === 'radius.sm'));
});

test('a token missing from one mode of its tier is an error', () => {
  const files = realFiles();
  files['semantic/dark.tokens.json'] = files['semantic/dark.tokens.json']!.replace('"on-solid": {', '"on-solid-x": {');
  files['density/compact.tokens.json'] = files['density/compact.tokens.json']!.replace('"row-height": {', '"row-height-x": {');
  const missing = validateSet(buildTokenSet(files), pairs)
    .issues.filter((i) => i.code === 'missing-mode')
    .map((i) => `${i.path}@${i.mode}`);
  assert.deepEqual(missing.sort(), ['color.text.on-solid-x@light', 'color.text.on-solid@dark', 'table.row-height-x@comfortable', 'table.row-height@compact']);
});

test('contrast below the pair minimum blocks in the brand x theme it fails; problems already on main only warn', () => {
  const head = realSet();
  const bad = withValue([['semantic/light.tokens.json', 'color.text.muted', '{palette.neutral.300}']]);
  const v = validateProposal(bad, head, pairs);
  const failing = v.blocking.filter((i) => i.code === 'contrast' && i.path === 'color.text.muted on color.bg.default').map((i) => i.mode);
  assert.deepEqual(failing.sort(), ['bridge.light', 'ocean.light']);
  assert.match(v.blocking.find((i) => i.code === 'contrast')!.message, /needs 4\.5:1/);
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
