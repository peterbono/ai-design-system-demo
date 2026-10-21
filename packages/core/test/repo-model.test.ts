import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import { loadConfig, toConfigJson, ConfigError } from '../src/config';
import { fsSource } from '../src/node/fs-source';
import { loadRepoModel, REPO_MODEL_DEFAULTS, siteRepoFromConfig } from '../src/repo-model';
import { memorySource, readRepoTexts } from '../src/repo-source';

const color = (hex: string) => ({ $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0].map((_, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255), hex } });
const dim = (value: number) => ({ $type: 'dimension', $value: { value, unit: 'px' } });
const json = (x: unknown) => JSON.stringify(x);

/** A small team repo that keeps everything somewhere else than this repo does. */
const TEAM: Record<string, string> = {
  'bridge.config.json': json({
    repo: { owner: 'acme', name: 'design', defaultBranch: 'trunk' },
    tokens: { root: 'design/tokens', usage: 'notes.json' },
    modes: {
      brand: { values: ['acme', 'night-owl'], default: 'acme' },
      theme: { values: ['light', 'dark'], default: 'light', parity: true },
      density: { values: ['comfortable', 'compact'], default: 'comfortable' },
    },
    contrast: { path: 'design/tokens/pairs.json' },
    components: { dir: 'src/ui', index: 'src/main.ts', specs: 'src/specs.json' },
    governance: { owners: { design: ['ana'], tech: ['bo'] } },
    changes: 'direct',
  }),
  'design/tokens/primitives/color.tokens.json': json({ color: { navy: { 900: color('#0a1f44') }, white: color('#ffffff'), sky: { 500: color('#3b82f6') } } }),
  'design/tokens/brands/acme.tokens.json': json({ $extensions: { 'dev.bridge.brand': { name: 'ACME Corp' } }, palette: { ink: { $type: 'color', $value: '{color.navy.900}' } } }),
  'design/tokens/brands/night-owl.tokens.json': json({ palette: { ink: { $type: 'color', $value: '{color.sky.500}' } } }),
  'design/tokens/semantic/light.tokens.json': json({ color: { text: { default: { $type: 'color', $value: '{palette.ink}', $description: 'Body text' } }, bg: { default: { $type: 'color', $value: '{color.white}' } } } }),
  'design/tokens/semantic/dark.tokens.json': json({ color: { text: { default: { $type: 'color', $value: '{color.white}' } }, bg: { default: { $type: 'color', $value: '{color.navy.900}' } } } }),
  'design/tokens/density/comfortable.tokens.json': json({ control: { height: dim(40) } }),
  'design/tokens/density/compact.tokens.json': json({ control: { height: dim(32) } }),
  'design/tokens/pairs.json': json({ pairs: [['color.text.default', 'color.bg.default', 4.5]] }),
  'design/tokens/notes.json': json({ 'color.text': 'Words on surfaces' }),
  'src/main.ts': "// Actions\nexport * from './ui/Button';\n",
  'src/ui/Button/Button.tsx': "export interface ButtonProps {\n  /** Look. */\n  variant?: 'solid' | 'ghost';\n}\n\nexport function Button({ variant = 'solid' }: ButtonProps) {}\n",
  'src/ui/Button/Button.module.css': '.root { color: var(--color-text-default); min-height: var(--control-height); }',
  'src/ui/Button/Button.docs.json': json({ summary: 'Starts an action' }),
  'src/specs.json': json({ version: 0, components: [], coverage: [{ name: 'Button', status: 'generated' }] }),
};

test('a team repo: every path comes from its bridge.config.json', async () => {
  const model = await loadRepoModel(memorySource(TEAM, { owner: 'acme', repo: 'design', sha: 'f00' }), { href: (v, type, tier) => `/t/${tier}/${type}/${v}` });
  assert.deepEqual(model.problems, []);
  assert.deepEqual(model.ref, { owner: 'acme', repo: 'design', sha: 'f00' });
  assert.equal(model.site.owner, 'acme');
  assert.equal(model.site.defaultBranch, 'trunk');
  assert.equal(model.site.tokensRoot, 'design/tokens');
  assert.equal(model.site.changes, 'direct');
  assert.deepEqual(model.site.owners, { design: ['ana'], tech: ['bo'] });

  const rows = model.tokens.rows;
  assert.deepEqual(rows.brands, ['acme', 'night-owl']);
  assert.deepEqual(rows.brandLabels, { acme: 'ACME Corp', 'night-owl': 'Night Owl' });
  assert.deepEqual(Object.keys(model.tokens.files).sort(), [
    'brands/acme.tokens.json',
    'brands/night-owl.tokens.json',
    'density/comfortable.tokens.json',
    'density/compact.tokens.json',
    'primitives/color.tokens.json',
    'semantic/dark.tokens.json',
    'semantic/light.tokens.json',
  ]);
  const text = rows.all.find((t) => t.path === 'color.text.default')!;
  assert.equal(text.description, 'Body text');
  assert.deepEqual(text.brands.acme!.light, { alias: 'palette.ink', chain: ['palette.ink', 'color.navy.900'], css: '#0a1f44', hex: '#0a1f44' });
  assert.equal(text.brands['night-owl']!.light!.hex, '#3b82f6');
  assert.equal(text.modes.dark!.hex, '#ffffff');
  assert.equal(text.brandSpecific, true);
  assert.equal(text.file, 'design/tokens/semantic/light.tokens.json, design/tokens/semantic/dark.tokens.json');
  const height = rows.density.find((t) => t.path === 'control.height')!;
  assert.deepEqual(Object.fromEntries(Object.entries(height.densities!).map(([d, v]) => [d, v.css])), { comfortable: '40px', compact: '32px' });
  assert.deepEqual(model.tokens.usage, { 'color.text': 'Words on surfaces' });

  assert.equal(model.contrast.path, 'design/tokens/pairs.json');
  const pair = model.contrast.pairs[0]!;
  assert.equal(pair.usage, 'text');
  assert.equal(pair.modes.light!.aa, true);
  assert.equal(pair.brands['night-owl']!.light!.aa, false, 'sky on white fails 4.5:1');

  assert.equal(model.components?.dir, 'src/ui');
  assert.equal(model.components?.index, 'src/main.ts');
  const button = model.components!.list[0]!;
  assert.equal(button.category, 'Actions');
  assert.deepEqual(button.props, [{ name: 'variant', type: "'solid' | 'ghost'", required: false, description: 'Look.', defaultValue: "'solid'" }]);
  assert.deepEqual(button.tokenPaths, ['color.text.default', 'control.height']);
  assert.equal(button.tokensUsed[0]!.href, '/t/semantic/color/--color-text-default');
  assert.equal(button.docs?.summary, 'Starts an action');

  assert.equal(model.specs.path, 'src/specs.json');
  assert.equal(model.specs.file, null, 'version 0 is not read as specs');
  assert.deepEqual(model.specs.coverage, [{ name: 'Button', status: 'generated' }]);
});

test('no bridge.config.json: the paths this repo used before the config named them', async () => {
  const model = await loadRepoModel(memorySource({}, { owner: 'acme', repo: 'design' }));
  assert.deepEqual(model.problems, []);
  assert.equal(model.configText, null);
  assert.equal(model.config.tokens.root, REPO_MODEL_DEFAULTS.tokensRoot);
  assert.equal(model.components?.dir, REPO_MODEL_DEFAULTS.componentsDir);
  assert.equal(model.specs.path, REPO_MODEL_DEFAULTS.componentSpecs);
  assert.equal(model.contrast.path, `${REPO_MODEL_DEFAULTS.tokensRoot}/contrast.checks.json`);
  assert.deepEqual([model.site.owner, model.site.repo], ['acme', 'design'], 'the source names the repo');
  assert.deepEqual(model.tokens.rows.brands, ['bridge', 'ocean']);
  assert.deepEqual(model.components?.list, []);
});

test('a config without tokens.root or components keeps the default paths', async () => {
  const model = await loadRepoModel(memorySource({ 'bridge.config.json': json({ changes: 'suggest' }) }));
  assert.equal(model.config.tokens.root, REPO_MODEL_DEFAULTS.tokensRoot);
  assert.equal(model.config.components?.dir, REPO_MODEL_DEFAULTS.componentsDir);
  assert.equal(model.config.components?.index, undefined);
  assert.equal(model.components?.index, undefined, 'packages/react/src/index.ts does not exist here');
});

test('an invalid config or token files are reported, not thrown', async () => {
  const bad = await loadRepoModel(memorySource({ 'bridge.config.json': json({ changes: 'sometimes' }) }));
  assert.match(bad.problems.join(), /"changes" must be "suggest" or "direct"/);
  assert.equal(bad.config.changes, 'suggest');
  const broken = await loadRepoModel(memorySource({ 'bridge.config.json': '{ nope' }));
  assert.match(broken.problems[0]!, /not valid JSON/);
  const alias = await loadRepoModel(
    memorySource({ ...TEAM, 'design/tokens/semantic/dark.tokens.json': json({ color: { text: { default: { $type: 'color', $value: '{palette.nope}' } }, bg: { default: color('#000000') } } }) }),
  );
  assert.match(alias.problems.join(), /alias \{palette\.nope\} does not resolve/);
  assert.deepEqual(alias.tokens.rows.all, []);
});

test('components can be skipped (the browser scans them lazily)', async () => {
  const model = await loadRepoModel(memorySource(TEAM), { components: false });
  assert.equal(model.components, null);
  assert.equal(model.tokens.rows.all.length, 4);
});

test('siteRepoFromConfig keeps the older top-level owners, owner and defaultBranch keys', () => {
  const raw = { repo: 'acme/design', owner: 'acme-org', defaultBranch: 'develop', owners: { design: ['ana'] } };
  const site = siteRepoFromConfig(loadConfig(raw), raw);
  assert.equal(site.owner, 'acme-org');
  assert.equal(site.repo, 'design');
  assert.equal(site.defaultBranch, 'develop');
  assert.deepEqual(site.owners, { design: ['ana'], tech: [] });
  assert.deepEqual(site.override, { allowed: [], requireReason: true, minReasonLength: 20 });
  assert.equal(site.rights, null);
  assert.deepEqual(site.visualImpact, { mode: 'auto' });
});

test('tokens.usage is an optional config key, written back by toConfigJson', () => {
  const config = loadConfig({ tokens: { root: 'tokens', usage: './notes.json' } });
  assert.equal(config.tokens.usage, 'notes.json');
  assert.equal((toConfigJson(config).tokens as { usage?: string }).usage, 'notes.json');
  assert.equal(loadConfig({}).tokens.usage, undefined);
  assert.throws(() => loadConfig({ tokens: { usage: '' } }), ConfigError);
  assert.throws(() => loadConfig({ tokens: { usages: 'x' } }), /not a known key/);
});

test('this repo: the model is the same whatever source serves the files', async () => {
  const root = join(__dirname, '../../..');
  const fs = fsSource(root, { owner: 'peterbono', repo: 'ai-design-system-demo', sha: 'local' });
  const fromFs = await loadRepoModel(fs);
  assert.deepEqual(fromFs.problems, []);
  assert.ok(fromFs.tokens.rows.all.length > 100);
  assert.ok((fromFs.components?.list.length ?? 0) > 20);
  // The same bytes served from memory, as a GitHub or snapshot source would serve them.
  const paths = [
    'bridge.config.json',
    ...(await fs.list(fromFs.config.tokens.root)),
    ...(await fs.list(fromFs.config.components!.dir)),
    fromFs.config.components!.index!,
    fromFs.specs.path,
  ];
  const bodies = await readRepoTexts(fs, paths);
  const files = Object.fromEntries([...bodies].filter((e): e is [string, string] => e[1] !== null));
  const fromMemory = await loadRepoModel(memorySource(files, fs.ref));
  assert.deepEqual(fromMemory, fromFs);
});
