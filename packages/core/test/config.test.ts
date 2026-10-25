import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { changesMode, ConfigError, defineConfig, libraryIsPublic, loadConfig, storybookUrl, TEAM_NAME_MAX, toConfigJson } from '../src/config';
import { buildTokenSet, detectLayout, layoutOptions } from '../src/token-set';
import { realConfig, realFiles } from './helpers';

test('the repo config loads and describes the real token layout', () => {
  const c = realConfig();
  assert.equal(`${c.repo!.owner}/${c.repo!.name}`, 'peterbono/ai-design-system-demo');
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
  assert.equal(c.repo!.defaultBranch, 'main');
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

test('changes: "suggest" by default, "direct" when set, anything else refused', () => {
  const plain = loadConfig({ repo: 'acme/ds' });
  assert.equal(plain.changes, 'suggest');
  assert.equal(changesMode(plain), 'suggest');
  assert.equal(changesMode(undefined), 'suggest');
  assert.equal(toConfigJson(plain).changes, 'suggest');
  const direct = loadConfig({ repo: 'acme/ds', changes: 'direct' });
  assert.equal(changesMode(direct), 'direct');
  assert.equal(toConfigJson(direct).changes, 'direct');
  assert.equal(loadConfig(toConfigJson(realConfig())).changes, 'direct');
  assert.equal(loadConfig({ repo: 'acme/ds', changes: 'suggest' }).changes, 'suggest');
  for (const bad of ['Direct', 'pr', true, null]) {
    assert.throws(
      () => loadConfig({ repo: 'acme/ds', changes: bad }),
      (err: ConfigError) => err.problems.some((p) => /"changes" must be "suggest" or "direct"/.test(p)),
    );
  }
  // This repo keeps opening branches until the owner switches it.
  assert.equal(realConfig().changes, 'direct');
});

test('storybook.url: explicit, else the production Storybook from previews; https only', () => {
  assert.equal(storybookUrl(loadConfig({ repo: 'acme/ds' })), undefined);
  const explicit = loadConfig({ repo: 'acme/ds', storybook: { url: 'https://storybook.acme.dev/' } });
  assert.deepEqual(explicit.storybook, { url: 'https://storybook.acme.dev' });
  assert.equal(storybookUrl(explicit), 'https://storybook.acme.dev');
  assert.deepEqual(toConfigJson(explicit).storybook, { url: 'https://storybook.acme.dev' });
  const fromPreviews = loadConfig({ repo: 'acme/ds', previews: { production: { storybook: 'https://sb.acme.dev/' } } });
  assert.equal(fromPreviews.storybook, undefined);
  assert.equal(storybookUrl(fromPreviews), 'https://sb.acme.dev');
  assert.ok(!('storybook' in toConfigJson(fromPreviews)));
  // The explicit one wins; an http production URL is not used.
  assert.equal(storybookUrl(loadConfig({ repo: 'acme/ds', storybook: { url: 'https://a.dev' }, previews: { production: { storybook: 'https://b.dev' } } })), 'https://a.dev');
  assert.equal(storybookUrl(loadConfig({ repo: 'acme/ds', previews: { production: { storybook: 'http://sb.acme.dev' } } })), undefined);
  assert.equal(storybookUrl(realConfig()), 'https://bridge-storybook.floriangouloubi.com');
  const bad: [unknown, RegExp][] = [
    [{ url: 'http://sb.acme.dev' }, /must start with https/],
    [{ url: '' }, /"storybook" must be \{ "url" \}/],
    ['https://sb.acme.dev', /"storybook" must be \{ "url" \}/],
    [{ url: 'https://sb.acme.dev', token: 'x' }, /"storybook\.token" is not a known key/],
  ];
  for (const [value, msg] of bad) {
    assert.throws(
      () => loadConfig({ repo: 'acme/ds', storybook: value }),
      (err: ConfigError) => err.problems.some((p) => msg.test(p)),
    );
  }
});

test('demo: a persona, kept as written, refused when malformed', () => {
  assert.equal(loadConfig({ repo: 'acme/ds' }).demo, undefined);
  const demo = loadConfig({ repo: 'acme/ds', demo: { viewer: ' Dana ', role: 'DS lead' } });
  assert.deepEqual(demo.demo, { viewer: 'Dana', role: 'DS lead' });
  assert.deepEqual(toConfigJson(demo).demo, { viewer: 'Dana', role: 'DS lead' });
  assert.deepEqual(loadConfig({ repo: 'acme/ds', demo: { viewer: 'Dana' } }).demo, { viewer: 'Dana' });
  for (const [d, msg] of [
    [{ role: 'DS lead' }, /"demo" must be \{ "viewer" \}/],
    [{ viewer: 'Dana', role: 3 }, /"demo\.role" must be a string/],
    [{ viewer: 'Dana', avatar: 'x' }, /"demo\.avatar" is not a known key/],
  ] as [unknown, RegExp][]) {
    assert.throws(
      () => loadConfig({ repo: 'acme/ds', demo: d }),
      (err: ConfigError) => err.problems.some((p) => msg.test(p)),
    );
  }
});

test('library.public: off by default, true only when the file says so', () => {
  assert.equal(libraryIsPublic(loadConfig({ repo: 'acme/ds' })), false);
  assert.equal(libraryIsPublic(loadConfig({ repo: 'acme/ds', library: {} })), false);
  assert.equal(libraryIsPublic(loadConfig({ repo: 'acme/ds', library: { public: false } })), false);
  const open = loadConfig({ repo: 'acme/ds', library: { public: true } });
  assert.equal(libraryIsPublic(open), true);
  assert.deepEqual(toConfigJson(open).library, { public: true });
  assert.equal(libraryIsPublic(null), false);
  for (const [library, msg] of [
    [{ public: 'yes' }, /"library\.public" must be true or false/],
    [true, /"library" must be an object/],
    [{ public: true, robots: 'all' }, /"library\.robots" is not a known key/],
  ] as [unknown, RegExp][]) {
    assert.throws(
      () => loadConfig({ repo: 'acme/ds', library }),
      (err: ConfigError) => err.problems.some((p) => msg.test(p)),
    );
  }
});

test('the JSON schema lists changes and storybook like the parser', () => {
  const schema = JSON.parse(readFileSync(new URL('../bridge.config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.changes.enum, ['suggest', 'direct']);
  assert.equal(schema.properties.changes.default, 'suggest');
  assert.deepEqual(schema.properties.storybook.required, ['url']);
  assert.equal(schema.properties.storybook.properties.url.pattern, '^https://');
  assert.equal(schema.properties.library.properties.public.type, 'boolean');
  assert.equal(schema.properties.library.properties.public.default, false);
});

test('name: the team display name, trimmed, 1 to 60 characters, kept by siteRepoFromConfig', () => {
  assert.equal(loadConfig({ repo: 'acme/ds', name: '  Acme   Design ' }).name, 'Acme Design');
  assert.equal(loadConfig({ repo: 'acme/ds' }).name, undefined);
  assert.equal(realConfig().name, 'Bridge DS');
  for (const name of ['', ' ', 'x'.repeat(61), 42]) {
    assert.throws(
      () => loadConfig({ repo: 'acme/ds', name } as never),
      (err: ConfigError) => err.problems.some((p) => /"name" must be the team's name, 1 to 60 characters/.test(p)),
    );
  }
  const schema = JSON.parse(readFileSync(new URL('../bridge.config.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.name.maxLength, TEAM_NAME_MAX);
  assert.equal(schema.properties.name.minLength, 1);
});
