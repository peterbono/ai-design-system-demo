import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { defineConfig, loadConfig } from '../src/config';
import { LayeredTokenSet, globToRegExp, selectTokenFiles, validateLayered } from '../src/layered';
import { classifyLayered, contrastDelta, diffLayered, layeredImpact, runLayeredContrast } from '../src/layered-review';
import { applyTokenEdits, coerceValue } from '../src/token-edits';
import { parseContrastChecks } from '../src/wcag';
import { commitToNewLocalBranch, branchExists } from '../src/node/git-local';
import { realChecksText, realConfig, realFiles } from './helpers';

const realSet = () => new LayeredTokenSet(realConfig(), new Map(Object.entries(realFiles())));

test('the canonical config: tiers, ordered layers, modes with parity, governance with owners', () => {
  const c = realConfig();
  assert.deepEqual(Object.keys(c.axes), ['brand', 'theme', 'density']);
  assert.equal(c.axes.theme!.parity, true);
  assert.equal(c.tokens.layers[4]!.files, 'brands/{brand}.{theme}.tokens.json');
  assert.equal(c.tokens.layers[4]!.optional, true);
  assert.equal(c.tokens.contrastChecks, 'contrast.checks.json');
  assert.equal(c.contrast?.path, 'packages/tokens/src/contrast.checks.json');
  assert.deepEqual(c.governance.owners, { design: ['peterbono'], tech: ['peterbono'] });
  assert.deepEqual(c.governance.override, { allowed: ['peterbono'], requireReason: true, minReasonLength: 20 });
  assert.equal(c.changesets?.package, '@bridge-ds/tokens');
  assert.equal(c.changeset?.package, '@bridge-ds/tokens');
});

test('the flat form still loads and gets conventional layers', () => {
  const c = loadConfig({ repo: { owner: 'a', name: 'b' }, tokens: { root: 'tokens' }, modes: { themes: ['light', 'dark'], brands: ['x'] }, changeset: { package: '@a/t' } });
  assert.equal(c.axes.theme!.parity, true);
  assert.ok(c.tokens.layers.some((l) => l.files === 'semantic/{theme}.tokens.json'));
  assert.equal(c.changesets?.dir, '.changeset');
  assert.equal(loadConfig({ repo: 'acme/ds', branch: 'trunk' }).repo?.defaultBranch, 'trunk');
  assert.throws(() => loadConfig({ tokens: { layers: [{ files: 'x/{brand}.json' }] }, modes: { theme: { values: ['l'] } } }), /modes\.brand/);
  assert.throws(() => loadConfig({ governance: { owners: { design: 'me' } } }), /owners/);
  assert.equal(loadConfig({ repo: 'acme/ds' }).governance.override, undefined);
  assert.deepEqual(loadConfig({ repo: 'acme/ds', governance: { override: { allowed: ['me'] } } }).governance.override, { allowed: ['me'], requireReason: true, minReasonLength: 20 });
  assert.throws(() => loadConfig({ governance: { override: { allowed: 'me' } } } as never), /override\.allowed/);
  assert.throws(() => loadConfig({ governance: { override: { minReasonLength: -1 } } }), /minReasonLength/);
});

test('globs and token file selection', () => {
  assert.ok(globToRegExp('**/*.tokens.json').test('a/b/c.tokens.json'));
  assert.ok(globToRegExp('**/*.tokens.json').test('c.tokens.json'));
  assert.ok(!globToRegExp('primitives/*.tokens.json').test('primitives/x/y.tokens.json'));
  const c = defineConfig({ tokens: { root: 'design', include: ['**/*.json'] }, contrast: { path: 'design/contrast.json' } });
  assert.deepEqual(selectTokenFiles(c, ['design/a.json', 'design/contrast.json', 'src/x.json']), ['a.json']);
});

test('layered set resolves the real tokens in every mode and validates clean', () => {
  const set = realSet();
  assert.equal(set.combos().length, 8);
  const r = set.resolve('color.text.muted', { brand: 'bridge', theme: 'light', density: 'comfortable' });
  assert.deepEqual(r.chain, ['color.text.muted', 'palette.neutral.600', 'color.steel.600']);
  assert.match(r.css, /^#[0-9a-f]{6}$/);
  assert.equal(set.tierOf('color.text.muted'), 'semantic');
  assert.equal(set.tierOfFile('semantic/base.tokens.json'), 'base');
  assert.deepEqual(validateLayered(set).filter((i) => i.level === 'error'), []);
});

test('contrast over layered combos matches the gate, and edits show their deltas', () => {
  const set = realSet();
  const pairs = parseContrastChecks(realChecksText());
  const before = runLayeredContrast(set, pairs);
  assert.equal(before.filter((r) => !r.pass).length, 0);
  const ed = applyTokenEdits(set, [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.300}', mode: { theme: 'light' } }]);
  const after = new LayeredTokenSet(set.config, ed.files);
  const delta = contrastDelta(before, runLayeredContrast(after, pairs));
  assert.ok(delta.some((d) => d.passBefore && !d.passAfter));
});

test('object-form and top-level-array contrast files parse', () => {
  const p = parseContrastChecks('[{ "fg": "a", "bg": "b", "min": 3 }, { "foreground": "c", "background": "d" }, ["e", "f", 4.5]]');
  assert.deepEqual(p.map((x) => [x.foreground, x.background, x.min, x.kind]), [['a', 'b', 3, 'ui'], ['c', 'd', 4.5, 'text'], ['e', 'f', 4.5, 'text']]);
});

test('edits are minimal diffs; diff and tier use the shared rules', () => {
  const set = realSet();
  const r = applyTokenEdits(set, [{ op: 'set', path: 'menu.item.bg-highlight', value: '{color.surface.hover}' }]);
  const before = set.files.get('components/overlays.tokens.json')!.split('\n');
  const after = r.files.get('components/overlays.tokens.json')!.split('\n');
  assert.equal(after.length, before.length);
  assert.equal(after.filter((l, i) => l !== before[i]).length, 1);
  assert.deepEqual(r.touched, ['components/overlays.tokens.json']);

  const desc = applyTokenEdits(set, [{ op: 'set', path: 'color.text.muted', description: 'Secondary text.', file: 'semantic/light.tokens.json' }]);
  const dc = diffLayered(set, new LayeredTokenSet(set.config, desc.files));
  assert.deepEqual(dc.map((c) => [c.kind, c.fields]), [['changed', ['description']]]);
  assert.deepEqual(classifyLayered(dc), { tier: 1, bump: 'patch', reasons: ['Token description changed: color.text.muted'], label: 'Tier 1: low risk, one code owner' });

  const add = applyTokenEdits(set, [{ op: 'add', path: 'color.text.subtle', value: '{palette.neutral.500}', file: 'semantic/light.tokens.json' }]);
  assert.equal(classifyLayered(diffLayered(set, new LayeredTokenSet(set.config, add.files))).bump, 'minor');

  const ren = applyTokenEdits(set, [{ op: 'rename', path: 'color.text.link', newPath: 'color.text.anchor' }]);
  const renSet = new LayeredTokenSet(set.config, ren.files);
  const rc = diffLayered(set, renSet);
  assert.deepEqual(rc.filter((c) => c.kind === 'renamed').map((c) => c.from), ['color.text.link', 'color.text.link']);
  assert.deepEqual([classifyLayered(rc).tier, classifyLayered(rc).bump], [3, 'major']);
  assert.deepEqual(validateLayered(renSet).filter((i) => i.level === 'error'), []);

  const del = applyTokenEdits(set, [{ op: 'remove', path: 'color.action.primary.bg' }]);
  const delSet = new LayeredTokenSet(set.config, del.files);
  assert.equal(classifyLayered(diffLayered(set, delSet)).bump, 'major');
  assert.ok(validateLayered(delSet).some((i) => i.code === 'broken-alias' && i.path === 'button.primary.bg'));
  assert.ok(layeredImpact(set, renSet, rc).total >= 0);
  assert.throws(() => applyTokenEdits(set, [{ op: 'set', path: 'color.text.muted', value: '#000000' }]), /defined in 2 files/);
});

test('coerceValue keeps the repo format', () => {
  assert.deepEqual(coerceValue('#FF5500', 'color'), { colorSpace: 'srgb', components: [1, 0.333, 0], hex: '#ff5500' });
  assert.equal(coerceValue('#FF5500', 'color', '#000000'), '#ff5500');
  assert.deepEqual(coerceValue('12px', 'dimension'), { value: 12, unit: 'px' });
  assert.deepEqual(coerceValue('150ms', 'duration'), { value: 150, unit: 'ms' });
});

test('local git writer: new branch through plumbing, protected and existing branches refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-core-git-'));
  try {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.name', 'T');
    g('config', 'user.email', 't@example.com');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'init');
    const rules = { protectedBranches: ['main', 'master'], branchPrefix: 'bridge/' };
    await assert.rejects(commitToNewLocalBranch(dir, { ...rules, base: 'HEAD', branch: 'main', message: 'x', files: [] }), /Refusing/);
    await assert.rejects(commitToNewLocalBranch(dir, { ...rules, base: 'HEAD', branch: 'feature/x', message: 'x', files: [] }), /must start with "bridge\/"/);
    const r = await commitToNewLocalBranch(dir, { ...rules, base: 'HEAD', branch: 'bridge/x', message: 'x', files: [{ path: 'a.txt', content: 'b\n' }] });
    assert.match(r.diff, /\+b/);
    assert.equal(await branchExists(dir, 'bridge/x'), true);
    assert.equal(g('status', '--porcelain').trim(), '');
    assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
    await assert.rejects(commitToNewLocalBranch(dir, { ...rules, base: 'HEAD', branch: 'bridge/x', message: 'x', files: [] }), /already exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
