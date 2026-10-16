import assert from 'node:assert/strict';
import { test } from 'node:test';
import { threeWayDiff, toMap } from '../src/core/diff-engine';
import { clone, tok } from './helpers';

const black = { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' };
const white = { colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' };
const grey = { colorSpace: 'srgb', components: [0.5, 0.5, 0.5], hex: '#808080' };

const a = tok('color.a', { value: black });
const b = tok('color.b', { value: white });
const s = tok('color.text.default', { light: '{color.a}', dark: '{color.b}' });
const base = [a, b, s];

test('no changes on any side', () => {
  const r = threeWayDiff(toMap(base), toMap(base), toMap(base));
  assert.deepEqual([r.local.length, r.remote.length, r.conflicts.length, r.unchanged], [0, 0, 0, 3]);
});

test('added, changed, renamed and removed in Figma are local changes', () => {
  const figma = [
    clone(a, { values: { value: grey } }), // changed
    clone(s, { path: 'color.text.primary' }), // renamed (same id)
    tok('color.c', { value: grey }), // added
    // b removed
  ];
  const r = threeWayDiff(toMap(base), toMap(figma), toMap(base));
  const kinds = Object.fromEntries(r.local.map((e) => [e.path, e.local!.kind]));
  assert.deepEqual(kinds, { 'color.a': 'changed', 'color.text.primary': 'renamed', 'color.c': 'added', 'color.b': 'removed' });
  assert.equal(r.remote.length, 0);
  assert.equal(r.conflicts.length, 0);
  const rename = r.local.find((e) => e.path === 'color.text.primary')!;
  assert.deepEqual(rename.local!.fields.map((f) => f.field), ['path']);
});

test('float noise from Figma is not a change', () => {
  const noisy = clone(a, { values: { value: { colorSpace: 'srgb', components: [0.0000001, 0, 0.0000002], hex: '#000000' } } });
  const r = threeWayDiff(toMap(base), toMap([noisy, b, s]), toMap(base));
  assert.equal(r.local.length, 0);
});

test('main-only changes are remote, not local', () => {
  const head = [a, clone(b, { values: { value: grey } }), s];
  const r = threeWayDiff(toMap(base), toMap(base), toMap(head));
  assert.equal(r.local.length, 0);
  assert.deepEqual(r.remote.map((e) => [e.path, e.remote!.kind]), [['color.b', 'changed']]);
});

test('same change on both sides converges', () => {
  const both = [a, clone(b, { values: { value: grey } }), s];
  const r = threeWayDiff(toMap(base), toMap(both), toMap(both));
  assert.equal(r.local.length + r.remote.length + r.conflicts.length, 0);
});

test('different changes to the same token conflict', () => {
  const figma = [clone(a, { values: { value: grey } }), b, s];
  const head = [clone(a, { values: { value: white } }), b, s];
  const r = threeWayDiff(toMap(base), toMap(figma), toMap(head));
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0]!.id, a.id);
  assert.equal(r.conflicts[0]!.local!.kind, 'changed');
  assert.equal(r.conflicts[0]!.remote!.kind, 'changed');
});

test('edit in Figma vs removal on main conflicts', () => {
  const figma = [clone(a, { values: { value: grey } }), b, s];
  const head = [b, s];
  const r = threeWayDiff(toMap(base), toMap(figma), toMap(head));
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0]!.remote!.kind, 'removed');
});

test('without a base, any difference is a conflict and additions are one-sided', () => {
  const figma = [clone(a, { values: { value: grey } }), b, tok('color.only-figma', { value: grey })];
  const head = [a, b, tok('color.only-main', { value: grey })];
  const r = threeWayDiff(undefined, toMap(figma), toMap(head));
  assert.deepEqual(r.conflicts.map((e) => e.path), ['color.a']);
  assert.deepEqual(r.local.map((e) => [e.path, e.local!.kind]), [['color.only-figma', 'added']]);
  assert.deepEqual(r.remote.map((e) => [e.path, e.remote!.kind]), [['color.only-main', 'added']]);
});

test('description and scope edits are changes; default scopes equal undefined', () => {
  const figma = [clone(a, { description: 'Pure black' }), b, clone(s, { scopes: ['TEXT_FILL'] })];
  const r = threeWayDiff(toMap(base), toMap(figma), toMap(base));
  assert.deepEqual(r.local.map((e) => [e.path, e.local!.fields.map((f) => f.field).join()]), [['color.a', 'description']]);
  const figma2 = [a, b, clone(s, { scopes: ['FRAME_FILL'] })];
  assert.deepEqual(threeWayDiff(toMap(base), toMap(figma2), toMap(base)).local.map((e) => e.local!.fields[0]!.field), ['scopes']);
});
