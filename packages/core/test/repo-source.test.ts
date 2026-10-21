import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, test } from 'vitest';
import { fsSource } from '../src/node/fs-source';
import { isUnder, joinRepoPath, memorySource, normalizeRepoPath, parentDir, readRepoTexts, type RepoSource } from '../src/repo-source';

const FILES: Record<string, string> = {
  'bridge.config.json': '{}',
  'tokens/primitives/color.tokens.json': '{"a":1}',
  'tokens/semantic/light.tokens.json': '{}',
  'tokens-extra/x.json': 'x',
  'README.md': '# hi',
};

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function onDisk(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-source-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('path helpers normalize repo-relative paths', () => {
  assert.equal(normalizeRepoPath('./a//b/'), 'a/b');
  assert.equal(normalizeRepoPath('a\\b'), 'a/b');
  assert.equal(joinRepoPath('packages', '', 'a.json'), 'packages/a.json');
  assert.equal(parentDir('a/b/c.json'), 'a/b');
  assert.equal(parentDir('c.json'), '');
  assert.ok(isUnder('tokens/a.json', 'tokens'));
  assert.ok(!isUnder('tokens-extra/x.json', 'tokens'));
  assert.ok(isUnder('anything', ''));
});

async function contract(source: RepoSource) {
  assert.deepEqual(await source.list('tokens'), ['tokens/primitives/color.tokens.json', 'tokens/semantic/light.tokens.json']);
  assert.deepEqual(await source.list('tokens/'), await source.list('tokens'));
  assert.deepEqual(await source.list(), Object.keys(FILES).sort());
  assert.deepEqual(await source.list('missing'), []);
  assert.equal(await source.text('tokens/primitives/color.tokens.json'), '{"a":1}');
  assert.equal(await source.text('./README.md'), '# hi');
  assert.equal(await source.text('missing.json'), null);
  assert.equal(await source.text('tokens'), null, 'a directory is not a file');
}

test('memorySource lists by prefix, sorted, and returns null for a missing file', async () => {
  const source = memorySource(FILES, { owner: 'acme', repo: 'ds', sha: 'abc' });
  assert.deepEqual(source.ref, { owner: 'acme', repo: 'ds', sha: 'abc' });
  await contract(source);
});

test('fsSource keeps the same contract over a folder on disk, skipping node_modules and .git', async () => {
  const root = onDisk({ ...FILES, 'node_modules/x/index.js': '', '.git/HEAD': 'ref' });
  const source = fsSource(root, { owner: 'acme', repo: 'ds', sha: 'local' });
  assert.deepEqual(source.ref, { owner: 'acme', repo: 'ds', sha: 'local' });
  await contract(source);
});

test('fsSource and memorySource agree on the same files', async () => {
  const fs = fsSource(onDisk(FILES), { sha: 'x' });
  const mem = memorySource(FILES);
  assert.deepEqual(await fs.list(), await mem.list());
  for (const path of await mem.list()) assert.equal(await fs.text(path), await mem.text(path));
});

test('readRepoTexts reads each path once with a bounded pool', async () => {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const base = memorySource(FILES);
  const source: RepoSource = {
    ...base,
    text: async (path) => {
      calls++;
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return base.text(path);
    },
  };
  const out = await readRepoTexts(source, ['README.md', 'README.md', 'bridge.config.json', 'missing', 'tokens-extra/x.json'], 2);
  assert.equal(calls, 4);
  assert.ok(peak <= 2);
  assert.equal(out.get('README.md'), '# hi');
  assert.equal(out.get('missing'), null);
});
