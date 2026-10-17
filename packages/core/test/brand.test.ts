import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { addBrandToConfigText, brandPreviewVariables, checkBrandSlug, composeNewBrandBody, listBrands, planNewBrand, type BrandSource } from '../src/brand';
import { loadConfig } from '../src/config';
import { LayeredTokenSet, validateLayered } from '../src/layered';
import { BELL, STEPS, generateRamp, neutralChroma, toHex, toOklch, fromHex } from '../src/ramps';
import { realChecksText, realConfig, realFiles, TOKENS_DIR } from './helpers';

const CONFIG_TEXT = readFileSync(join(TOKENS_DIR, '../../../bridge.config.json'), 'utf8');
const source = (): BrandSource => ({ config: realConfig(), configText: CONFIG_TEXT, files: realFiles(), contrastText: realChecksText() });
const primitive = (ramp: string, step: number) => (JSON.parse(realFiles()['primitives/color.tokens.json']!) as any).color[ramp][step].$value.hex as string;

test('the shared ramp engine reproduces the committed primitives (same code as scripts/ramps.mjs)', () => {
  const harbor = generateRamp({ hue: 251, chroma: (s) => 0.14 * BELL[s], pins: { 200: '#CFE8FF', 700: '#0B4A8B' } });
  const ink = generateRamp({ hue: 250, chroma: neutralChroma(), pins: { 200: '#E3E8EE', 600: '#5B6672', 900: '#15202B' } });
  for (const s of STEPS) {
    assert.equal(toHex(harbor[s]), primitive('harbor', s), `harbor ${s}`);
    assert.equal(toHex(ink[s]), primitive('ink', s), `ink ${s}`);
  }
  // OKLCH round trip of a brand hex.
  const { L, h } = toOklch(fromHex('#0B4A8B'));
  assert.ok(Math.abs(L - 0.445) < 0.04 && h > 240 && h < 265);
});

test('slug rules: format, uniqueness and reserved mode names', () => {
  const s = source();
  assert.deepEqual(checkBrandSlug(s.config, s.files, 'acme'), []);
  assert.equal(checkBrandSlug(s.config, s.files, 'ocean')[0]!.code, 'slug-taken');
  assert.equal(checkBrandSlug(s.config, s.files, 'dark')[0]!.code, 'slug-reserved');
  assert.equal(checkBrandSlug(s.config, s.files, 'Acme Co')[0]!.code, 'slug-format');
  assert.equal(checkBrandSlug(s.config, s.files, 'a')[0]!.code, 'slug-format');
  assert.equal(checkBrandSlug(s.config, s.files, '')[0]!.code, 'slug-empty');
});

test('config edit is a one-line diff', () => {
  const next = addBrandToConfigText(CONFIG_TEXT, 'acme');
  assert.match(next, /"brand": \{ "values": \["bridge", "ocean", "acme"\], "default": "bridge" \}/);
  const changed = next.split('\n').filter((l, i) => l !== CONFIG_TEXT.split('\n')[i]);
  assert.equal(changed.length, 1);
  assert.deepEqual(loadConfig(next).axes.brand!.values, ['bridge', 'ocean', 'acme']);
  assert.match(addBrandToConfigText('{ "modes": { "brands": ["a"] } }', 'b'), /\["a", "b"\]/);
});

test('planNewBrand from bridge: files, generated ramps pinned at the action step, contrast for every theme, tier 3', () => {
  const plan = planNewBrand(source(), { slug: 'acme', name: 'Acme', from: 'bridge', primaryHue: '#1F5F3A', neutralHue: '#2A2F2C' });
  assert.equal(plan.ok, true, JSON.stringify([plan.issues, plan.contrast.failing], null, 1));
  assert.deepEqual(
    plan.files.map((f) => `${f.action} ${f.path}`),
    ['create packages/tokens/src/primitives/acme.tokens.json', 'create packages/tokens/src/brands/acme.tokens.json', 'modify bridge.config.json', 'create .changeset/bridge-brand-acme.md'],
  );
  // Bridge buttons use primary 700: the brand hex is pinned there.
  assert.equal(plan.actionStep, 700);
  assert.equal(plan.ramps.primary!.find((x) => x.step === 700)!.hex, '#1f5f3a');
  assert.equal(plan.ramps.primary!.length, 11);
  assert.equal(plan.ramps.neutral!.length, 11);
  // Every pair, light and dark.
  const pairs = JSON.parse(realChecksText()).pairs.length;
  assert.equal(plan.contrast.checks, pairs * 2);
  assert.deepEqual(plan.contrast.themes, ['light', 'dark']);
  assert.equal(plan.risk.tier, 3);
  assert.equal(plan.risk.bump, 'minor');
  assert.ok(plan.risk.reasons.some((r) => /Guardrail file changed: bridge.config.json/.test(r)));
  assert.match(plan.changeset!.content, /"@bridge-ds\/tokens": minor/);
  // Two tiers: the ramps are primitives, the brand file only aliases them (no literal values).
  const prim = JSON.parse(plan.files[0]!.content);
  assert.equal(prim.color['acme-primary']['700'].$value.hex, '#1f5f3a');
  assert.deepEqual(Object.keys(prim.color).filter((k) => !k.startsWith('$')), ['acme-primary', 'acme-neutral']);
  const doc = JSON.parse(plan.files[1]!.content);
  const literals = JSON.stringify(doc).match(/"hex"/g);
  assert.equal(literals, null, 'no literal colors in the brand file');
  assert.deepEqual(Object.keys(doc).slice(0, 2), ['$description', '$extensions']);
  assert.equal(doc.$extensions['dev.bridge.brand'].name, 'Acme');
  assert.equal(doc.palette.primary['700'].$value, '{color.acme-primary.700}');
  assert.equal(doc.palette.accent['700'].$value, '{color.acme-primary.700}');
  assert.equal(doc.palette.neutral['900'].$value, '{color.acme-neutral.900}');
  assert.equal(doc.palette.neutral['0'].$value, '{color.white}');
  assert.equal(doc.palette.success['500'].$value, '{color.teal.500}');
  assert.equal(doc.radius.control.$value, '{radius.xl}');
  assert.equal(doc.typography.h1.family.$value, '{font.family.fraunces}');
  // DTCG validation of the whole repo with the brand added: no new problems.
  const after = new LayeredTokenSet(loadConfig(plan.configText), new Map(Object.entries(plan.tokenFiles)));
  assert.equal(validateLayered(after).filter((i) => i.level === 'error').length, 0);
});

test('planNewBrand from ocean copies its theme overrides and pins at ocean action step', () => {
  const plan = planNewBrand(source(), { slug: 'north-star', from: 'ocean', primaryHue: '#7A2E8C', neutralHue: 260, radius: { inset: 2, control: 4, container: 6, overlay: 10 }, fonts: { heading: 'fraunces', text: 'plex-sans' } });
  assert.equal(plan.name, 'North Star');
  assert.equal(plan.actionStep, 600);
  assert.deepEqual(
    plan.files.filter((f) => f.path.endsWith('.tokens.json')).map((f) => f.path),
    ['packages/tokens/src/primitives/north-star.tokens.json', 'packages/tokens/src/brands/north-star.tokens.json', 'packages/tokens/src/brands/north-star.light.tokens.json', 'packages/tokens/src/brands/north-star.dark.tokens.json'],
  );
  assert.equal(plan.ok, true, JSON.stringify([plan.issues, plan.contrast.failing.slice(0, 3)], null, 1));
  const doc = JSON.parse(plan.files[1]!.content);
  assert.equal(doc.radius.control.$value, '{radius.sm}');
  assert.equal(doc.typography.h2.family.$value, '{font.family.fraunces}');
  assert.equal(doc.typography.body.family.$value, '{font.family.plex-sans}');
  assert.equal(doc.font.family.display.$value, '{font.family.fraunces}');
  const light = JSON.parse(plan.files[2]!.content);
  assert.match(light.$description, /North Star overrides on top of semantic\/light/);
});

test('a too-light primary breaks white text on primary buttons: the plan fails and names the pairs', () => {
  const plan = planNewBrand(source(), { slug: 'sunny', from: 'bridge', primaryHue: '#8CC8FF', neutralHue: '#15202B' });
  assert.equal(plan.ok, false);
  const pairs = plan.contrast.failing.map((r) => `${r.fg} on ${r.bg} ${r.modes.includes('theme=light') ? 'light' : 'dark'}`);
  assert.ok(pairs.includes('color.action.primary.text on color.action.primary.bg light'), pairs.join('\n'));
  assert.ok(plan.issues.some((i) => i.code === 'pin-off-ladder' && i.level === 'warning'));
  const body = composeNewBrandBody(plan, { tool: 'the bridge CLI' });
  assert.match(body, /\*\*\d+ of \d+ pairs fail\*\*/);
  assert.match(body, /`color.action.primary.text` on `color.action.primary.bg` \| light/);
});

test('input problems are reported, not thrown: bad slug, off-scale radius, unknown font, bad color', () => {
  const plan = planNewBrand(source(), { slug: 'ocean', from: 'bridge', primaryHue: 'blue', radius: { control: 7 }, fonts: { heading: 'comic-sans' } });
  const codes = plan.issues.filter((i) => i.level === 'error').map((i) => i.code);
  for (const c of ['slug-taken', 'invalid-color', 'radius-off-scale', 'unknown-font']) assert.ok(codes.includes(c), codes.join(', '));
  assert.equal(plan.ok, false);
  assert.throws(() => planNewBrand(source(), { slug: 'x1', from: 'nope' }), /Unknown brand "nope"/);
});

test('blank brand: default structure, Instrument Sans everywhere, soft radius, no overrides', () => {
  const plan = planNewBrand(source(), { slug: 'plain', from: 'blank', primaryHue: 160, neutralHue: '#6B6B6B' });
  assert.equal(plan.ok, true, JSON.stringify(plan.contrast.failing.slice(0, 3)));
  assert.equal(plan.files.filter((f) => f.path.endsWith('.tokens.json')).length, 2);
  const doc = JSON.parse(plan.files[1]!.content);
  assert.equal(doc.typography.h1.family.$value, '{font.family.instrument-sans}');
  // A pure grey neutral has no chroma.
  const n = plan.ramps.neutral!.find((x) => x.step === 500)!.hex;
  assert.equal(n.slice(1, 3), n.slice(3, 5));
});

test('overrides set exact values (the Figma plugin path) and unknown paths are errors', () => {
  const plan = planNewBrand(source(), { slug: 'figma-brand', from: 'bridge', overrides: { 'palette.primary.700': '#123456', 'radius.control': '{radius.lg}', 'palette.nope.1': '#000000' } });
  const prim = JSON.parse(plan.files[0]!.content);
  assert.deepEqual(Object.keys(prim.color['figma-brand-primary']).filter((k) => !k.startsWith('$')), ['700']);
  assert.equal(prim.color['figma-brand-primary']['700'].$value.hex, '#123456');
  const doc = JSON.parse(plan.files[1]!.content);
  assert.equal(doc.palette.primary['700'].$value, '{color.figma-brand-primary.700}');
  assert.equal(doc.radius.control.$value, '{radius.lg}');
  assert.ok(plan.issues.some((i) => i.code === 'unknown-token' && i.path === 'palette.nope.1'));
});

test('listBrands and preview variables', () => {
  const brands = listBrands(source());
  assert.deepEqual(brands.map((b) => [b.slug, b.name, b.default]), [['bridge', 'Bridge', true], ['ocean', 'Ocean', false]]);
  assert.equal(brands[0]!.primary, '#0b4a8b');
  assert.deepEqual(brands[1]!.overrides, ['packages/tokens/src/brands/ocean.light.tokens.json', 'packages/tokens/src/brands/ocean.dark.tokens.json']);
  const plan = planNewBrand(source(), { slug: 'acme', from: 'bridge', primaryHue: '#1F5F3A' });
  const light = brandPreviewVariables(source(), plan, 'light');
  const dark = brandPreviewVariables(source(), plan, 'dark');
  assert.equal(light['--color-action-primary-bg'], '#1f5f3a');
  assert.notEqual(dark['--color-action-primary-bg'], '#1f5f3a');
  assert.ok(light['--button-primary-bg'] || light['--radius-control'], 'component and role tokens are included');
  assert.equal(light['--color-harbor-500'], undefined, 'primitives are not');
});
