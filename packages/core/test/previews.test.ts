import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { appUrl, branchSlug, installCommand, PREVIEW_COMMENT_MARKER, previewComment, previewLinks, previewUrl, snapshotUrl, tarballAssetName, tarballUrl } from '../src/previews';
import { realConfig } from './helpers';

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('branchSlug follows the Vercel alias shape', () => {
  assert.equal(branchSlug('feat/branch-previews'), 'feat-branch-previews');
  assert.equal(branchSlug('Agent/Badge_Subtle.Variant'), 'agent-badge-subtle-variant');
  assert.equal(branchSlug('--x//y--'), 'x-y');
});

test('previewUrl fills placeholders and refuses what it cannot build', () => {
  const ctx = { branch: 'feat/branch-previews', pr: 42, sha: SHA };
  assert.equal(previewUrl('https://bridge-docs-git-{branch}-acme.vercel.app', ctx), 'https://bridge-docs-git-feat-branch-previews-acme.vercel.app/');
  assert.equal(previewUrl('https://pr-{pr}.preview.example.com/{sha7}/', ctx), 'https://pr-42.preview.example.com/0123456/');
  assert.equal(previewUrl('https://x.example.com/?b={rawBranch}', ctx), 'https://x.example.com/?b=feat%2Fbranch-previews');
  assert.equal(previewUrl(undefined, ctx), null);
  assert.equal(previewUrl('https://pr-{pr}.example.com', { branch: 'x' }), null, 'missing value');
  assert.equal(previewUrl('https://{unknown}.example.com', ctx), null, 'unknown placeholder');
  assert.equal(previewUrl('javascript:alert({pr})', ctx), null, 'non-http scheme');
  assert.equal(previewUrl('https://bridge-docs-git-{branch}-acme.vercel.app', { branch: 'a'.repeat(60) }), null, 'label over 63 characters');
});

test('previewLinks keeps configured apps in a stable order', () => {
  const links = previewLinks({ admin: 'https://admin-{branch}.example.com', docs: 'https://docs-{branch}.example.com' }, { branch: 'main' });
  assert.deepEqual(links.map((l) => [l.app, l.label, l.url]), [
    ['docs', 'Docs', 'https://docs-main.example.com/'],
    ['admin', 'Admin demo', 'https://admin-main.example.com/'],
  ]);
});

test('snapshot and tarball URLs', () => {
  assert.equal(snapshotUrl('peterbono', 'ai-design-system-demo', '@bridge-ds/react', SHA), `https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/react@${SHA}`);
  assert.equal(snapshotUrl('o', 'r', '@bridge-ds/tokens', 12), 'https://pkg.pr.new/o/r/@bridge-ds/tokens@12');
  assert.equal(tarballAssetName('@bridge-ds/react', SHA), 'bridge-ds-react-0123456.tgz');
  assert.equal(tarballUrl('o', 'r', 7, '@bridge-ds/core', SHA), 'https://github.com/o/r/releases/download/preview-pr-7/bridge-ds-core-0123456.tgz');
  assert.equal(installCommand(['a', 'b']), 'npm i a b');
  assert.equal(installCommand(['a'], 'pnpm'), 'pnpm add a');
});

test('previewComment lists installs, previews and the tokens-only override', () => {
  const md = previewComment({
    owner: 'o',
    repo: 'r',
    pr: 42,
    branch: 'feat/x',
    sha: SHA,
    source: 'pkg.pr.new',
    packages: [
      { name: '@bridge-ds/tokens', url: snapshotUrl('o', 'r', '@bridge-ds/tokens', SHA) },
      { name: '@bridge-ds/react', url: snapshotUrl('o', 'r', '@bridge-ds/react', SHA) },
    ],
    apps: { docs: 'https://docs-{branch}.example.com', storybook: 'https://sb-{branch}.example.com' },
  });
  assert.ok(md.startsWith(PREVIEW_COMMENT_MARKER));
  assert.match(md, /## Try this DS branch in your product/);
  assert.match(md, new RegExp(`npm i https://pkg.pr.new/o/r/@bridge-ds/tokens@${SHA} https://pkg.pr.new/o/r/@bridge-ds/react@${SHA}`));
  assert.match(md, /\| Docs \| https:\/\/docs-feat-x\.example\.com\/ \|/);
  assert.match(md, /\| Storybook \| https:\/\/sb-feat-x\.example\.com\/ \|/);
  assert.match(md, /\?bridge-tokens=https:\/\/docs-feat-x\.example\.com\/tokens\.css/);
  assert.doesNotMatch(md, /\u2014/, 'no em dash');
});

test('previewComment explains missing snapshots and missing deploy config', () => {
  const md = previewComment({ owner: 'o', repo: 'r', pr: 1, branch: 'b', sha: SHA, source: 'none', packages: [], apps: {} });
  assert.match(md, /publish step failed/);
  assert.match(md, /Preview deploys are not set up/);
  const rel = previewComment({ owner: 'o', repo: 'r', pr: 3, branch: 'b', sha: SHA, source: 'release', packages: [{ name: 'p', url: 'u' }], apps: {} });
  assert.match(rel, /preview-pr-3/);
});

test('config: previews load, unknown apps and non-URL templates are refused', () => {
  assert.deepEqual(realConfig().previews?.packages, ['@bridge-ds/tokens', '@bridge-ds/core', '@bridge-ds/react']);
  const base = { repo: { owner: 'o', name: 'r' } };
  const ok = loadConfig({ ...base, previews: { apps: { docs: 'https://d-{branch}.example.com' } } });
  assert.deepEqual(ok.previews, { packages: [], apps: { docs: 'https://d-{branch}.example.com' } });
  assert.throws(() => loadConfig({ ...base, previews: { apps: { site: 'https://x' } } }), ConfigError);
  assert.throws(() => loadConfig({ ...base, previews: { apps: { docs: 'ftp://x' } } }), ConfigError);
  assert.throws(() => loadConfig({ ...base, previews: { packages: 'x' } }), ConfigError);
});

test('branchSlug matches the Vercel branch aliases of this repo', () => {
  // Alias read with `vercel inspect` on a real bridge-docs deployment (scope peterbonos-projects).
  const docs = 'https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app';
  assert.equal(previewUrl(docs, { branch: 'feat/library-studio' }), 'https://bridge-docs-git-feat-library-studio-peterbonos-projects.vercel.app/');
  // 64 characters in the first label: Vercel shortens it with a hash, so Bridge leaves the link out.
  assert.equal(previewUrl(docs, { branch: 'chore/previews-and-figma-kit' }), null);
  assert.equal(previewUrl(docs, { branch: 'chore/previews-and-figma-ki' }), 'https://bridge-docs-git-chore-previews-and-figma-ki-peterbonos-projects.vercel.app/');
});

test('appUrl picks the branch preview, else production', () => {
  const previews = {
    apps: { storybook: 'https://sb-git-{branch}-acme.vercel.app', admin: 'https://admin-git-{branch}-acme.vercel.app' },
    production: { storybook: 'https://storybook.example.com/', docs: 'https://docs.example.com' },
  };
  assert.equal(appUrl(previews, 'storybook', { branch: 'feat/x', defaultBranch: 'main' }), 'https://sb-git-feat-x-acme.vercel.app');
  assert.equal(appUrl(previews, 'storybook', { branch: 'main', defaultBranch: 'main' }), 'https://storybook.example.com');
  assert.equal(appUrl(previews, 'storybook'), 'https://storybook.example.com', 'local build: production');
  assert.equal(appUrl(previews, 'docs', { branch: 'feat/x' }), 'https://docs.example.com', 'no preview template: production');
  assert.equal(appUrl(previews, 'admin', { branch: 'trunk', defaultBranch: 'trunk' }), 'https://admin-git-trunk-acme.vercel.app', 'no production URL: default branch preview');
  assert.equal(appUrl(previews, 'storybook', { branch: 'a'.repeat(70) }), 'https://storybook.example.com', 'unbuildable preview: production');
  assert.equal(appUrl(undefined, 'docs'), null);
});

test('config: production URLs load and refuse placeholders', () => {
  const base = { repo: { owner: 'o', name: 'r' } };
  const ok = loadConfig({ ...base, previews: { production: { docs: 'https://docs.example.com' } } });
  assert.deepEqual(ok.previews, { packages: [], apps: {}, production: { docs: 'https://docs.example.com' } });
  assert.throws(() => loadConfig({ ...base, previews: { production: { docs: 'https://{branch}.example.com' } } }), ConfigError);
  assert.throws(() => loadConfig({ ...base, previews: { production: { site: 'https://x.example.com' } } }), ConfigError);
  assert.equal(realConfig().previews?.production?.storybook, 'https://bridge-storybook.floriangouloubi.com');
});
