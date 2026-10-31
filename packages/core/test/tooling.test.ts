import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { ConfigError, loadConfig, toConfigJson } from '../src/config';
import { siteRepoFromConfig } from '../src/repo-model';
import { isToolingFile, isToolingPull, NO_TOOLING, onlyTooling, titleScopes, toolingOf, toolingProblems, type ToolingConfig } from '../src/tooling';
import { realConfig } from './helpers';

const T: ToolingConfig = { paths: ['apps/docs-site/', 'packages/core', 'docs/', '!docs/DESIGN-LANGUAGE.md', 'CLAUDE.md'], scopes: ['studio', 'core'] };

test('a tooling file: under a listed folder or the listed file, unless a ! entry keeps it', () => {
  assert.equal(isToolingFile('apps/docs-site/src/x.ts', T), true);
  assert.equal(isToolingFile('packages/core/src/a.ts', T), true);
  assert.equal(isToolingFile('packages/core-extra/a.ts', T), false);
  assert.equal(isToolingFile('CLAUDE.md', T), true);
  assert.equal(isToolingFile('docs/GOVERNANCE.md', T), true);
  assert.equal(isToolingFile('docs/DESIGN-LANGUAGE.md', T), false);
  assert.equal(isToolingFile('packages/react/src/Button.tsx', T), false);
  assert.equal(isToolingFile('apps/docs-site/x', NO_TOOLING), false);
});

test('onlyTooling: every file tooling, changesets neutral; empty, unread or no config is never tooling', () => {
  assert.equal(onlyTooling(['apps/docs-site/a.ts', '.changeset/x.md'], T), true);
  assert.equal(onlyTooling(['apps/docs-site/a.ts', 'packages/react/src/Button.tsx'], T), false);
  assert.equal(onlyTooling(['packages/tokens/src/semantic/light.tokens.json'], T), false);
  assert.equal(onlyTooling(['.changeset/x.md'], T), false);
  assert.equal(onlyTooling([], T), false);
  assert.equal(onlyTooling(null, T), false);
  assert.equal(onlyTooling(['apps/docs-site/a.ts'], NO_TOOLING), false);
});

test('titleScopes: conventional scopes, a leading word, never a bare type', () => {
  assert.deepEqual(titleScopes('fix(studio): Changes states as underline Tabs'), ['studio']);
  assert.deepEqual(titleScopes('feat(mcp, docs-site): one connector'), ['mcp', 'docs-site']);
  assert.deepEqual(titleScopes('feat(core)!: breaking'), ['core']);
  assert.deepEqual(titleScopes('Toolbar: count, step through'), ['toolbar']);
  assert.deepEqual(titleScopes('fix: something'), []);
  assert.deepEqual(titleScopes('Button: new size'), ['button']);
  assert.deepEqual(titleScopes('New ocean brand'), []);
  assert.deepEqual(titleScopes(null), []);
});

test('isToolingPull: files decide once read, the title scopes before; explorations and Bridge branches never', () => {
  assert.equal(isToolingPull({ title: 'fix(studio): x', headRef: 'fix/x' }, T), true);
  assert.equal(isToolingPull({ title: 'feat(studio, button): x', headRef: 'fix/x' }, T), false);
  // The files win over the title, both ways.
  assert.equal(isToolingPull({ title: 'fix(studio): x', headRef: 'fix/x', files: ['packages/react/src/Button.tsx'] }, T), false);
  assert.equal(isToolingPull({ title: 'Library: Copy for Confluence', headRef: 'feat/y', files: ['apps/docs-site/a.ts'] }, T), true);
  assert.equal(isToolingPull({ title: 'Library: Copy for Confluence', headRef: 'feat/y' }, T), false);
  // Never hidden.
  assert.equal(isToolingPull({ title: 'fix(studio): x', headRef: 'explore/card', files: ['apps/docs-site/a.ts'] }, T), false);
  assert.equal(isToolingPull({ title: 'fix(studio): x', headRef: 'feat/x', exploration: true }, T), false);
  assert.equal(isToolingPull({ title: 'fix(core): x', headRef: 'bridge/tokens', files: ['packages/core/a.ts'] }, T), false);
  assert.equal(isToolingPull({ title: 'fix(core): x', headRef: 'ds/tokens', files: ['packages/core/a.ts'] }, T, ['ds/']), false);
  assert.equal(isToolingPull({ title: 'docs(core): x', headRef: 'docs/x', labels: [{ name: 'source: bridge-web' }] }, T), false);
  // A team repository without the key: nothing is tooling.
  assert.equal(isToolingPull({ title: 'fix(studio): x', headRef: 'fix/x', files: ['apps/docs-site/a.ts'] }, NO_TOOLING), false);
  assert.equal(isToolingPull({ title: 'fix(studio): x' }, undefined), false);
});

test('config: tooling is optional, validated, kept by toConfigJson and siteRepoFromConfig', () => {
  const c = loadConfig({ repo: 'acme/ds', tooling: { paths: ['tools/'] } });
  assert.deepEqual(c.tooling, { paths: ['tools/'] });
  assert.deepEqual(toConfigJson(c).tooling, { paths: ['tools/'] });
  assert.deepEqual(siteRepoFromConfig(c).tooling, { paths: ['tools/'] });
  const none = loadConfig({ repo: 'acme/ds' });
  assert.equal(none.tooling, undefined);
  assert.equal(toConfigJson(none).tooling, undefined);
  assert.deepEqual(toolingOf(siteRepoFromConfig(none)), NO_TOOLING);
  assert.deepEqual(toolingProblems(undefined), []);
  assert.ok(toolingProblems([]).length);
  assert.ok(toolingProblems({ scopes: ['x'] }).some((p) => /tooling.paths/.test(p)));
  assert.ok(toolingProblems({ paths: ['/abs'] }).some((p) => /relative/.test(p)));
  assert.ok(toolingProblems({ paths: ['a/'], extra: 1 }).some((p) => /tooling.extra/.test(p)));
  assert.throws(
    () => loadConfig({ repo: 'acme/ds', tooling: { paths: 'apps/' } } as never),
    (err: ConfigError) => err.problems.some((p) => /"tooling.paths"/.test(p)),
  );
});

test("the JSON schema lists tooling like the parser", () => {
  const schema = JSON.parse(readFileSync(new URL('../bridge.config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.tooling.required, ['paths']);
  assert.deepEqual(Object.keys(schema.properties.tooling.properties), ['paths', 'scopes']);
});

test("this repository: Bridge's own folders are tooling, the design system is not", () => {
  const t = toolingOf(realConfig());
  for (const f of ['apps/docs-site/src/lib/x.ts', 'packages/core/src/a.ts', 'packages/mcp/src/a.ts', 'packages/cli/src/a.ts', 'packages/toolbar/src/a.ts', 'scripts/x.mjs', 'docs/GOVERNANCE.md']) assert.equal(isToolingFile(f, t), true, f);
  for (const f of ['packages/tokens/src/semantic/light.tokens.json', 'packages/react/src/components/Button/Button.tsx', 'packages/react/src/components/Button/Button.docs.json', 'apps/admin/src/App.tsx', 'docs/DESIGN-LANGUAGE.md', 'AGENTS.md']) assert.equal(isToolingFile(f, t), false, f);
  assert.equal(isToolingPull({ title: 'fix(studio): Being built filters as underline Tabs', headRef: 'fix/being-built-tabs' }, t, [realConfig().governance.branchPrefix]), true);
});
