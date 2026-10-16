import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  flattenTokens,
  moveToken,
  parseTokenFile,
  readTokenAt,
  removeToken,
  serializeTokenFile,
  upsertToken,
} from '../src/dtcg-codec';
import { clearRawDeep, parseJson, serializeJson } from '../src/json-ast';
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
  const tokens = flattenTokens(parseTokenFile('semantic/base.tokens.json', files['semantic/base.tokens.json']!));
  const fast = tokens.find((t) => t.path === 'motion.duration.fast')!;
  assert.equal(fast.type, 'duration');
  assert.equal(fast.ownType, undefined);
  assert.match(fast.description!, /Tooltips, menus/);
  const shadows = flattenTokens(parseTokenFile('primitives/shadow.tokens.json', files['primitives/shadow.tokens.json']!));
  assert.ok(shadows.every((t) => t.type === 'shadow' && t.ownType === undefined), 'group $type written after the tokens still applies');
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
  assert.deepEqual(diff, ['        "value": 8,']);
});

test('setting an equal value leaves the text untouched', () => {
  const file = 'semantic/light.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  const changed = upsertToken(doc, 'color.text.default', { type: 'color', value: '{palette.neutral.900}', description: undefined });
  assert.equal(changed, false);
  assert.equal(serializeTokenFile(doc), files[file]);
});

test('$description and $extensions are preserved and written in stable order', () => {
  const file = 'semantic/light.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  upsertToken(doc, 'color.text.default', {
    type: 'color',
    value: '{palette.neutral.950}',
    description: 'Body text',
    extensions: { 'com.figma.scopes': ['TEXT_FILL'], 'com.dsbridge.id': 'abc' },
  });
  const text = serializeTokenFile(doc);
  const reparsed = parseTokenFile(file, text);
  const t = readTokenAt(reparsed, 'color.text.default')!;
  assert.equal(t.description, 'Body text');
  assert.deepEqual(t.extensions, { 'com.figma.scopes': ['TEXT_FILL'], 'com.dsbridge.id': 'abc' });
  assert.equal(t.type, 'color');
  const textGroup = text.indexOf('"text": {');
  const block = text.slice(text.indexOf('"default"', textGroup), text.indexOf('"muted"', textGroup));
  assert.ok(block.indexOf('$description') < block.indexOf('$value'));
  assert.ok(block.indexOf('$value') < block.indexOf('$extensions'));
  // Round trip of the edited file is stable too.
  assert.equal(serializeTokenFile(reparsed), text);
});

test('new token copies the layout of its siblings and omits an inherited $type', () => {
  const file = 'primitives/space.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  upsertToken(doc, 'space.32', { type: 'dimension', value: { value: 128, unit: 'px' }, description: undefined });
  const out = serializeTokenFile(doc);
  assert.match(out, /\n {4}\},\n {4}"32": \{\n {6}"\$value": \{\n {8}"value": 128,\n {8}"unit": "px"\n {6}\}\n {4}\}\n {2}\}\n\}\n$/);
  assert.doesNotMatch(out.slice(out.indexOf('"32"')), /\$type/);
});

test('new token with a different type than its group writes $type', () => {
  const file = 'primitives/space.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  upsertToken(doc, 'space.ratio', { type: 'number', value: 1.5, description: undefined });
  assert.equal(readTokenAt(parseTokenFile(file, serializeTokenFile(doc)), 'space.ratio')!.ownType, 'number');
});

test('remove prunes empty groups; move keeps every field', () => {
  const file = 'semantic/base.tokens.json';
  const doc = parseTokenFile(file, files[file]!);
  assert.ok(moveToken(doc, 'motion.duration.fast', 'motion.quick.fast'));
  const moved = readTokenAt(parseTokenFile(file, serializeTokenFile(doc)), 'motion.quick.fast')!;
  assert.match(moved.description!, /Tooltips, menus/);
  assert.equal(moved.type, 'duration', 'type written on the node when the new group does not provide it');
  assert.ok(removeToken(doc, 'motion.quick.fast'));
  const text = serializeTokenFile(doc);
  assert.doesNotMatch(text, /"quick"/);
  JSON.parse(text);
});

test('invalid JSON is reported, not thrown away', () => {
  assert.throws(() => parseTokenFile('x.tokens.json', '{ "a": }'), /Unexpected token/);
});
