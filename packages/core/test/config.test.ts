import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConfigError, defineConfig, loadConfig } from '../src/config';
import { buildTokenSet, detectLayout, layoutOptions } from '../src/token-set';
import { realConfig, realFiles } from './helpers';

test('the repo config loads and describes the real token layout', () => {
  const c = realConfig();
  assert.equal(`${c.repo.owner}/${c.repo.name}`, 'peterbono/ai-design-system-demo');
  assert.equal(c.tokens.root, 'packages/tokens/src');
  assert.deepEqual(c.modes.defaults, { brand: 'bridge', theme: 'light', density: 'comfortable' });
  const set = buildTokenSet(realFiles(), layoutOptions(c));
  assert.deepEqual(set.layout.brands.map((b) => b.mode), ['bridge', 'ocean']);
  assert.deepEqual(set.layout.themes.map((t) => t.mode), ['light', 'dark']);
  assert.deepEqual(set.layout.densities.map((d) => d.mode), ['comfortable', 'compact']);
  assert.deepEqual(set.layout.baseFiles, ['semantic/base.tokens.json']);
  assert.deepEqual(set.layout.overrides.map((o) => `${o.brand}.${o.theme}`).sort(), ['ocean.dark', 'ocean.light']);
  assert.ok(set.layout.componentFiles.length >= 5);
  assert.deepEqual(set.problems, []);
});

test('defineConfig fills defaults; loadConfig lists every problem', () => {
  const c = defineConfig({ repo: { owner: 'acme', name: 'ds' } });
  assert.equal(c.repo.defaultBranch, 'main');
  assert.equal(c.tokens.root, 'tokens');
  assert.equal(c.tokens.contrastChecks, 'contrast.checks.json');
  assert.equal(c.changeset, undefined);
  assert.throws(() => loadConfig('{'), ConfigError);
  try {
    loadConfig({ repo: { owner: '' }, tokens: { rooot: 'x' }, modes: { themes: ['light'], defaults: { theme: 'dark' } } });
    assert.fail('should throw');
  } catch (err) {
    const problems = (err as ConfigError).problems.join('\n');
    assert.match(problems, /repo\.owner/);
    assert.match(problems, /repo\.name/);
    assert.match(problems, /tokens\.rooot" is not a known key/);
    assert.match(problems, /modes\.defaults\.theme" \("dark"\) is not in "modes\.themes"/);
  }
});

test('custom tier folders and mode order are honored', () => {
  const c = defineConfig({
    repo: { owner: 'acme', name: 'ds' },
    tokens: { primitives: 'core', brands: 'brand', semantic: 'theme', base: 'common', density: 'spacing', components: 'comp' },
    modes: { themes: ['dark', 'light'], brands: ['b'], densities: ['tight', 'roomy'] },
  });
  const layout = detectLayout(
    ['core/color.tokens.json', 'brand/a.tokens.json', 'brand/b.tokens.json', 'brand/b.dark.tokens.json', 'theme/light.tokens.json', 'theme/dark.tokens.json', 'theme/common.tokens.json', 'spacing/roomy.tokens.json', 'spacing/tight.tokens.json', 'comp/button.tokens.json'],
    layoutOptions(c),
  );
  assert.deepEqual(layout.primitiveFiles, ['core/color.tokens.json']);
  assert.deepEqual(layout.brands.map((b) => b.mode), ['b', 'a']);
  assert.deepEqual(layout.themes.map((t) => t.mode), ['dark', 'light']);
  assert.deepEqual(layout.baseFiles, ['theme/common.tokens.json']);
  assert.deepEqual(layout.overrides, [{ brand: 'b', theme: 'dark', file: 'brand/b.dark.tokens.json' }]);
  assert.deepEqual(layout.densities.map((d) => d.mode), ['tight', 'roomy']);
  assert.deepEqual(layout.componentFiles, ['comp/button.tokens.json']);
});
