import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  flattenTokens,
  moveToken,
  parseTokenFile,
  readTokenAt,
  removeToken,
  serializeTokenFile,
  upsertToken,
} from '../src/core/dtcg-codec';
import { clearRawDeep, parseJson, serializeJson } from '../src/core/json-ast';
import { realFiles } from './helpers';

const files = realFiles();

test('real token files are found', () => {
  assert.ok(Object.keys(files).length >= 7, `found ${Object.keys(files).join(', ')}`);
  assert.ok(files['semantic/light.tokens.json']);
  assert.ok(files['primitives/color.tokens.json']);
});

for (const [file, text] of Object.entries(files)) {
  test(`round trip is byte-identical: ${file}`, () => {
    const doc = parseTokenFile(file, text);
    assert.equal(serializeTokenFile(doc), text);
  });

  test(`formatter reproduces the file from scratch (no cached source): ${file}`, () => {
    const json = parseJson(text);
    clearRawDeep(json.root);
    assert.equal(serializeJson(json), text);
  });
}

test('flatten inherits group $type and keeps $description', () => {
  const tokens = flattenTokens(parseTokenFile('primitives/shadow.tokens.json', files['primitives/shadow.tokens.json']!));
  const md = tokens.find((t) => t.path === 'shadow.md-strong')!;
  assert.equal(md.type, 'shadow');
  assert.equal(md.ownType, undefined);
  assert.match(md.description!, /Higher-opacity/);
  const space = flattenTokens(parseTokenFile('primitives/space.tokens.json', files['primitives/space.tokens.json']!));
  assert.deepEqual(space.map((t) => t.path).slice(0, 3), ['space.0', 'space.1', 'space.2'], 'numeric keys keep source order');
});

test('editing one value changes exactly one line, in the file style', () => {
  const file = 'primitives/radius.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  assert.equal(upsertToken(doc, 'radius.md', { type: 'dimension', value: { value: 8, unit: 'px' }, description: undefined }), true);
  const out = serializeTokenFile(doc);
  const before = files[file]!.split('\n');
  const after = out.split('\n');
  assert.equal(after.length, before.length);
  const diff = after.filter((l, i) => l !== before[i]);
  assert.deepEqual(diff, ['    "md": { "$value": { "value": 8, "unit": "px" } },']);
});

test('setting an equal value leaves the text untouched', () => {
  const file = 'semantic/light.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  const changed = upsertToken(doc, 'color.text.default', { type: 'color', value: '{color.neutral.900}', description: undefined });
  assert.equal(changed, false);
  assert.equal(serializeTokenFile(doc), files[file]);
});

test('$description and $extensions are preserved and written in stable order', () => {
  const file = 'semantic/light.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  upsertToken(doc, 'color.text.muted', {
    type: 'color',
    value: '{color.neutral.700}',
    description: 'Secondary text',
    extensions: { 'com.figma.scopes': ['TEXT_FILL'], 'com.dsbridge.id': 'abc' },
  });
  const text = serializeTokenFile(doc);
  const reparsed = parseTokenFile(file, text);
  const t = readTokenAt(reparsed, 'color.text.muted')!;
  assert.equal(t.description, 'Secondary text');
  assert.deepEqual(t.extensions, { 'com.figma.scopes': ['TEXT_FILL'], 'com.dsbridge.id': 'abc' });
  assert.equal(t.type, 'color', 'type still inherited from the group');
  const block = text.slice(text.indexOf('"muted"'), text.indexOf('"disabled"'));
  assert.ok(block.indexOf('$description') < block.indexOf('$value'));
  assert.ok(block.indexOf('$value') < block.indexOf('$extensions'));
  // Round trip of the edited file is stable too.
  assert.equal(serializeTokenFile(reparsed), text);
});

test('new token copies the layout of its siblings and omits an inherited $type', () => {
  const file = 'primitives/space.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  upsertToken(doc, 'space.16', { type: 'dimension', value: { value: 64, unit: 'px' }, description: undefined });
  const out = serializeTokenFile(doc);
  assert.match(out, /"12": \{ "\$value": \{ "value": 48, "unit": "px" \} \},\n {4}"16": \{ "\$value": \{ "value": 64, "unit": "px" \} \}\n/);
});

test('new token with a different type than its group writes $type', () => {
  const file = 'primitives/space.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  upsertToken(doc, 'space.ratio', { type: 'number', value: 1.5, description: undefined });
  assert.equal(readTokenAt(parseTokenFile(file, serializeTokenFile(doc)), 'space.ratio')!.ownType, 'number');
});

test('remove prunes empty groups; move keeps every field', () => {
  const file = 'primitives/shadow.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  assert.ok(moveToken(doc, 'shadow.md-strong', 'shadow.strong.md'));
  const moved = readTokenAt(parseTokenFile(file, serializeTokenFile(doc)), 'shadow.strong.md')!;
  assert.match(moved.description!, /Higher-opacity/);
  assert.equal(moved.type, 'shadow');
  assert.ok(removeToken(doc, 'shadow.strong.md'));
  const text = serializeTokenFile(doc);
  assert.doesNotMatch(text, /"strong"/);
  JSON.parse(text);
});

test('invalid JSON is reported, not thrown away', () => {
  assert.throws(() => parseTokenFile('x.tokens.json', '{ "a": }'), /Unexpected token/);
});
