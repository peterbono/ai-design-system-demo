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
  assert.deepEqual(realConfig().previews?.packages, ['@bridge-ds/tokens', '@bridge-ds/core', '@bridge-ds/react', '@bridge-ds/toolbar']);
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

// --- Real preview URLs: PR #64 (explore/button-normal-again), whose admin and storybook aliases Vercel shortened ----

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GitHubClient, type FetchLike } from '../src/github-client';
import { appForProject, findVercelComment, isVercelComment, parseVercelComment, previewLinksOf, previewsSettled, projectOfLabel, resolveBranchPreviews } from '../src/previews';
import { branchPreviewUrls } from '../src/previews-github';
import { productPreview } from '../src/try-in-product';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/previews/${name}`, import.meta.url)), 'utf8');
const PR64 = {
  branch: 'explore/button-normal-again',
  sha: '2ccfe16fa28a2ea6df1639fe7675fa005b66170a',
  vercel: fixture('pr64-vercel-comment.md'),
  bridge: fixture('pr64-preview-comment.md'),
  statuses: JSON.parse(fixture('pr64-statuses.json')) as { context: string; state: string; target_url: string }[],
};
const REAL = {
  admin: 'https://bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app/',
  docs: 'https://bridge-docs-git-explore-button-normal-again-peterbonos-projects.vercel.app/',
  storybook: 'https://bridge-storybook-git-explore-button-8a43de-peterbonos-projects.vercel.app/',
};
const realApps = () => realConfig().previews!.apps;

test('parseVercelComment decodes the hidden [vc] header of the real #64 comment', () => {
  assert.equal(isVercelComment(PR64.vercel), true);
  assert.equal(isVercelComment(PR64.bridge), false);
  const projects = parseVercelComment(PR64.vercel)!;
  assert.deepEqual(
    projects.map((p) => [p.name, p.previewUrl, p.status]),
    [
      ['bridge-docs', REAL.docs, 'IGNORED'],
      ['bridge-storybook', REAL.storybook, 'IGNORED'],
      ['bridge-admin', REAL.admin, 'PENDING'],
    ],
  );
  assert.equal(parseVercelComment('no header'), null);
  assert.equal(parseVercelComment('[vc]: #x:bm90IGpzb24='), null, 'base64 of something that is not JSON');
  assert.equal(findVercelComment([{ body: PR64.bridge }, { body: PR64.vercel }])?.body, PR64.vercel);
});

test('projects map to apps by the template host prefix', () => {
  const apps = realApps();
  assert.equal(appForProject('bridge-admin', apps), 'admin');
  assert.equal(appForProject('bridge-docs', apps), 'docs');
  assert.equal(appForProject('bridge-storybook', apps), 'storybook');
  assert.equal(appForProject('bridge', apps), null, 'a prefix of every project names none of them');
  assert.equal(appForProject('other', apps), null);
  // Overlapping names: the Vercel shape <project>-git- wins.
  const overlap = { docs: 'https://site-git-{branch}-t.vercel.app', admin: 'https://site-admin-git-{branch}-t.vercel.app' };
  assert.equal(appForProject('site', overlap), 'docs');
  assert.equal(appForProject('site-admin', overlap), 'admin');
  assert.equal(projectOfLabel('Vercel – bridge-admin'), 'bridge-admin');
  assert.equal(projectOfLabel('Preview - bridge-docs'), 'bridge-docs');
  assert.equal(projectOfLabel('Unit and a11y tests'), null);
});

test('the template alone never shows a shortened alias: admin (64) and storybook (68) stay unknown on #64', () => {
  const previews = resolveBranchPreviews(realApps(), { branch: PR64.branch, pr: 64 });
  assert.deepEqual(
    previews.map((p) => [p.app, p.url, p.source]),
    [
      ['docs', REAL.docs, 'template'],
      ['storybook', null, null],
      ['admin', null, null],
    ],
  );
  assert.equal(previewsSettled(previews), false);
  // A build Vercel refused (rate limit) fails without a URL: settled, so polling stops instead of waiting forever.
  const refused = resolveBranchPreviews(realApps(), { branch: PR64.branch, pr: 64 }, {
    statuses: ['bridge-docs', 'bridge-storybook', 'bridge-admin'].map((p) => ({ context: `Vercel – ${p}`, state: 'failure', target_url: 'https://vercel.com/team?upgradeToPro=build-rate-limit' })),
  });
  assert.deepEqual(refused.map((p) => [p.app, p.state]), [['docs', 'failed'], ['storybook', 'failed'], ['admin', 'failed']]);
  assert.equal(refused[1]!.url, null);
  assert.equal(previewsSettled(refused), true);
});

test('the Vercel comment and statuses give the real #64 URLs and their state', () => {
  const previews = resolveBranchPreviews(realApps(), { branch: PR64.branch, pr: 64, sha: PR64.sha }, { comments: [{ body: PR64.bridge }, { body: PR64.vercel }], statuses: PR64.statuses });
  assert.deepEqual(
    previews.map((p) => [p.app, p.url, p.source, p.state]),
    [
      ['docs', REAL.docs, 'vercel-comment', 'ready'],
      ['storybook', REAL.storybook, 'vercel-comment', 'ready'],
      // The comment still says PENDING; the newer commit status says success.
      ['admin', REAL.admin, 'vercel-comment', 'ready'],
    ],
  );
  assert.equal(previewsSettled(previews), true);
  // #64 only added its note file: Vercel's Ignored Build Step canceled all three builds, so none is a link.
  assert.deepEqual(previews.map((p) => p.skipped), [true, true, true]);
  assert.deepEqual(previewLinksOf(previews), []);
  assert.deepEqual(previewLinksOf(previews.map(({ skipped: _, ...p }) => p)).map((l) => l.label), ['Docs', 'Storybook', 'Admin demo']);
  // Inspector links (vercel.com/...) in statuses are never taken for a preview URL.
  const onlyStatuses = resolveBranchPreviews(realApps(), { branch: PR64.branch }, { statuses: PR64.statuses });
  assert.deepEqual(onlyStatuses.map((p) => p.url), [REAL.docs, null, null]);
  assert.deepEqual(onlyStatuses.map((p) => p.state), ['ready', 'ready', 'ready']);
  // While Vercel builds: the oldest statuses only (pending).
  const building = resolveBranchPreviews(realApps(), { branch: PR64.branch }, { comments: [{ body: PR64.vercel }], statuses: PR64.statuses.filter((s) => s.state === 'pending') });
  assert.deepEqual(building.map((p) => p.state), ['building', 'building', 'building']);
  assert.equal(previewsSettled(building), false);
});

test('a GitHub deployment URL beats the comment', () => {
  const previews = resolveBranchPreviews(
    realApps(),
    { branch: PR64.branch },
    {
      comments: [{ body: PR64.vercel }],
      deployments: [{ environment: 'Preview – bridge-admin', state: 'success', environmentUrl: 'https://bridge-admin-abc123-peterbonos-projects.vercel.app' }],
    },
  );
  const admin = previews.find((p) => p.app === 'admin')!;
  assert.deepEqual([admin.url, admin.source, admin.state], ['https://bridge-admin-abc123-peterbonos-projects.vercel.app/', 'deployment', 'ready']);
});

test('the sticky comment never prints a shortened template URL', () => {
  const md = previewComment({ owner: 'o', repo: 'r', pr: 64, branch: PR64.branch, sha: PR64.sha, packages: [], source: 'none', apps: realApps(), exploration: true });
  assert.ok(!md.includes('bridge-admin-git-explore-button-normal-again'), 'no guessed admin URL');
  assert.match(md, /\| Admin demo \| Link in the Vercel comment on this pull request \|/);
  assert.ok(md.includes(REAL.docs));
  const real = previewComment({ owner: 'o', repo: 'r', pr: 64, branch: PR64.branch, sha: PR64.sha, packages: [], source: 'none', apps: realApps(), exploration: true, previews: resolveBranchPreviews(realApps(), { branch: PR64.branch }, { comments: [{ body: PR64.vercel }] }) });
  assert.match(real, new RegExp(`\\| Admin demo \\| ${REAL.admin.replace(/[.]/g, '\\.')} \\|`));
});

test('branchPreviewUrls reads the pull request, its comments, statuses and deployments', async () => {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    '/pulls/64': { number: 64, title: 'Exploration', state: 'open', draft: true, user: { login: 'x' }, head: { ref: PR64.branch, sha: PR64.sha }, base: { ref: 'main' }, labels: [], html_url: '', updated_at: '' },
    '/issues/64/comments': [{ id: 1, body: PR64.vercel, user: { login: 'vercel[bot]' }, updated_at: '' }],
    [`/commits/${PR64.sha}/statuses`]: PR64.statuses,
    '/deployments': [],
  };
  const f: FetchLike = async (url) => {
    const path = new URL(url).pathname.replace('/repos/acme/ds', '');
    calls.push(path);
    const body = routes[path];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body ?? {}, text: async () => '' };
  };
  const gh = new GitHubClient('acme/ds', 't', f, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
  const previews = await branchPreviewUrls(gh, 64, realConfig());
  assert.deepEqual(previews.map((p) => p.url), [REAL.docs, REAL.storybook, REAL.admin]);
  assert.ok(calls.includes('/pulls/64') && calls.includes('/deployments'));
  // By commit with no pull request: the branch is unknown, so no template either; statuses carry the state only.
  routes[`/commits/${PR64.sha}/pulls`] = [];
  const bySha = await branchPreviewUrls(gh, PR64.sha, realConfig());
  assert.deepEqual(bySha.map((p) => [p.url, p.state]), [[null, 'ready'], [null, 'ready'], [null, 'ready']]);
  assert.deepEqual(await branchPreviewUrls(gh, 64, { previews: { apps: {} } }), []);
});

// Exploration #611: only its note file changed, so Vercel's Ignored Build Step canceled every build. The statuses
// say success, the comment names a branch alias, and that alias opens "Deployment was cancelled".
test('a build Vercel skipped (Ignored Build Step) is marked skipped and never offered as a link', () => {
  const vercel = `[vc]: #x:${btoa(JSON.stringify({ projects: [{ name: 'bridge-admin', previewUrl: 'bridge-admin-git-explore-explore-new-a658e0-peterbonos-projects.vercel.app', nextCommitStatus: 'IGNORED' }] }))}\nThe latest updates on your projects.`;
  const statuses = [{ context: 'Vercel – bridge-admin', state: 'success', description: 'Canceled by Ignored Build Step', target_url: 'https://vercel.com/peterbonos-projects/bridge-admin/8qZck' }];
  const ctx = { branch: 'explore/explore-new-design-pr-being-built', pr: 611 };
  const admin = resolveBranchPreviews(realApps(), ctx, { comments: [{ body: vercel }], statuses }).find((p) => p.app === 'admin')!;
  assert.equal(admin.skipped, true);
  assert.equal(admin.url, 'https://bridge-admin-git-explore-explore-new-a658e0-peterbonos-projects.vercel.app/');
  assert.deepEqual(previewLinksOf([admin]), []);
  // The comment alone says so too; a newer status that built wins over it.
  assert.equal(resolveBranchPreviews(realApps(), ctx, { comments: [{ body: vercel }] }).find((p) => p.app === 'admin')!.skipped, true);
  const builtStatuses = [{ ...statuses[0]!, description: 'Deployment has completed' }];
  const built = resolveBranchPreviews(realApps(), ctx, { comments: [{ body: vercel }], statuses: builtStatuses }).find((p) => p.app === 'admin')!;
  assert.equal(built.skipped, undefined);
  assert.equal(productPreview(realApps(), { ...ctx, sha: 'abc' }, { comments: [{ body: vercel }], statuses }), null);
  assert.equal(productPreview(realApps(), { ...ctx, sha: 'abc' }, { comments: [{ body: vercel }], statuses: builtStatuses }), 'https://bridge-admin-git-explore-explore-new-a658e0-peterbonos-projects.vercel.app/');
});
