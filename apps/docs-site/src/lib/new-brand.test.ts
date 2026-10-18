import assert from 'node:assert/strict';
import { test } from 'vitest';
import { LayeredTokenSet, loadConfig, type BrandSource } from '@bridge-ds/core';
import { tokenFiles } from './explorer';
import { readText } from './repo';
import { CONTRAST_FILE } from './contrast';
import { brandFacts, contrastLine, draftInput, draftSlug, emptyDraft, hueOf, normalizeHex, pairLabel, parseDraft, planDraft, radiusOf, withHue } from './new-brand';

const configText = readText('bridge.config.json');
const source = (): BrandSource => ({ config: loadConfig(configText), configText, files: tokenFiles(), contrastText: readText(CONTRAST_FILE) });

test('the slug follows the name until it is edited', () => {
  assert.equal(draftSlug({ name: 'North Star' }), 'north-star');
  assert.equal(draftSlug({ name: '  ' }), '');
  assert.equal(draftSlug({ name: 'North Star', slug: 'polaris' }), 'polaris');
});

test('a starting brand brings its corners and fonts', () => {
  const bridge = brandFacts(source(), 'bridge');
  assert.deepEqual([bridge.radius, bridge.heading, bridge.text, bridge.fonts], ['soft', 'fraunces', 'instrument-sans', 'Fraunces and Instrument Sans']);
  // The primary action color, read live: a designer may move it to another step in Studio.
  const set = new LayeredTokenSet(source().config, new Map(Object.entries(tokenFiles())));
  assert.equal(bridge.primary, normalizeHex(set.resolve('color.action.primary.bg', set.normalizeCombo({ brand: 'bridge' })).css));
  assert.match(bridge.primary, /^#[0-9A-F]{6}$/);
  const ocean = brandFacts(source(), 'ocean');
  assert.deepEqual([ocean.radius, ocean.heading, ocean.text, ocean.fonts], ['balanced', 'plex-sans', 'plex-sans', 'IBM Plex Sans']);
});

test('draft to planner input: half-typed colors fall back, empty extra colors follow primary, advanced radius wins', () => {
  const d = { ...emptyDraft('bridge'), name: 'Acme', primary: '#1F5', accent: '', link: '#123456', radiusRoles: { control: 4 } };
  const input = draftInput(d);
  assert.equal(input.slug, 'acme');
  assert.equal(input.primaryHue, undefined, 'half-typed: the starting ramp stays');
  assert.deepEqual(input.colors, { link: '#123456' });
  assert.deepEqual(radiusOf(d), { inset: 6, control: 4, container: 20, overlay: 20 });
});

test('planning a draft: passing and failing contrast lines', () => {
  const ok = planDraft(source(), { ...emptyDraft('bridge', brandFacts(source(), 'bridge')), name: 'Acme', primary: '#1F5F3A' });
  assert.equal(contrastLine(ok).text, `All ${ok.contrast.checks} checks pass`);
  assert.equal(contrastLine(ok).ok, true);
  const bad = planDraft(source(), { ...emptyDraft('bridge'), name: 'Sunny', primary: '#8CC8FF' });
  assert.match(contrastLine(bad).text, /^\d+ pairs fail$/);
  // Unnamed drafts still preview, under a placeholder slug.
  assert.equal(planDraft(source(), emptyDraft('bridge')).slug, 'new-brand');
});

test('stored drafts: unreadable data is ignored, unknown values fall back', () => {
  assert.equal(parseDraft('not json', ['bridge']), null);
  assert.equal(parseDraft(JSON.stringify({ v: 2 }), ['bridge']), null);
  const d = parseDraft(JSON.stringify({ v: 1, step: 9, name: 'Acme', from: 'nope', radius: 'wobbly', heading: 'comic-sans', text: 'fraunces' }), ['bridge', 'ocean'])!;
  assert.deepEqual([d.step, d.name, d.from, d.radius, d.heading, d.text], [0, 'Acme', 'bridge', 'soft', 'fraunces', 'instrument-sans']);
});

test('hex and hue helpers', () => {
  assert.equal(normalizeHex('1f5f3a'), '#1F5F3A');
  assert.equal(normalizeHex('#1f5'), null);
  const turned = withHue('#1F5F3A', hueOf('#0B4A8B'));
  assert.ok(Math.abs(hueOf(turned) - hueOf('#0B4A8B')) <= 2, turned);
  assert.equal(pairLabel('color.action.primary.text', 'color.action.primary.bg'), 'action primary text on action primary bg');
  assert.equal(pairLabel('focus.ring.color', 'color.bg.zone'), 'focus ring on bg zone');
});
