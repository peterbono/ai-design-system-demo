import { describe, expect, it } from 'vitest';
import { jargonIn } from './vocabulary';
import { previewComment } from '@bridge-ds/core';
import { canShare, EXPLAIN, mailtoHref, shareDescription, showShare, packageDir, shareMessage, shareState, stableCommand, stateSentence, touchesPackages } from './share-change';

const PACKAGES = ['@bridge-ds/tokens', '@bridge-ds/core', '@bridge-ds/react'];
const SHA = 'f9121d72dcdacb8fb4897c9d61c4da1cbfe3a7b2';
const TOKEN_FILE = ['packages/tokens/src/semantic/light.tokens.json'];
const RELEASE_URLS = PACKAGES.map((p) => `https://github.com/peterbono/ai-design-system-demo/releases/download/preview-pr-101/${p.slice(1).replace('/', '-')}-f9121d7.tgz`);

// The sticky comment exactly as the workflow builds it (same builder), with the prerelease fallback this repository uses.
const releaseComment = (sha = SHA) =>
  previewComment({
    owner: 'peterbono',
    repo: 'ai-design-system-demo',
    pr: 101,
    branch: 'tokens/color-bg-default-20261018-1348',
    sha,
    packages: PACKAGES.map((name, i) => ({ name, url: RELEASE_URLS[i]! })),
    source: 'release',
    apps: {},
  });
const pkgPrNewComment = previewComment({
  owner: 'peterbono',
  repo: 'ai-design-system-demo',
  pr: 101,
  branch: 'b',
  sha: SHA,
  packages: [{ name: '@bridge-ds/react', url: `https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/react@${SHA.slice(0, 7)}` }],
  source: 'pkg.pr.new',
  apps: {},
});
const failedComment = previewComment({ owner: 'o', repo: 'r', pr: 101, branch: 'b', sha: SHA, packages: [], source: 'none', apps: {} });

const base = { files: TOKEN_FILE, packages: PACKAGES, headSha: SHA };

describe('touchesPackages', () => {
  it('maps a package name to the folder the workflow builds', () => {
    expect(packageDir('@bridge-ds/react')).toBe('packages/react/');
  });
  it('is true for a token or component file, false for docs only', () => {
    expect(touchesPackages(TOKEN_FILE, PACKAGES)).toBe(true);
    expect(touchesPackages(['packages/react/src/components/Button/Button.tsx'], PACKAGES)).toBe(true);
    expect(touchesPackages(['apps/docs-site/src/pages/index.astro', 'docs/PREVIEWS.md', 'packages/cli/src/index.ts'], PACKAGES)).toBe(false);
  });
});

describe('canShare', () => {
  it('is off for forks and repositories without preview packages', () => {
    expect(canShare({ fromFork: false, packages: PACKAGES })).toBe(true);
    expect(canShare({ fromFork: true, packages: PACKAGES })).toBe(false);
    expect(canShare({ fromFork: false, packages: [] })).toBe(false);
  });
});

describe('shareState', () => {
  it('reads the command of the latest update from the sticky comment', () => {
    const s = shareState({ ...base, lifecycle: 'open', comment: releaseComment() });
    expect(s).toEqual({ kind: 'ready', command: `npm i ${RELEASE_URLS.join(' ')}`, source: 'release' });
  });
  it('works for a draft too (the workflow runs on drafts)', () => {
    expect(shareState({ ...base, lifecycle: 'draft', comment: pkgPrNewComment }).kind).toBe('ready');
  });
  it('is building with no comment yet, or a comment about an older update', () => {
    expect(shareState({ ...base, lifecycle: 'open', comment: null })).toEqual({ kind: 'building' });
    expect(shareState({ ...base, lifecycle: 'open', comment: releaseComment('aaaaaaa1111111') })).toEqual({ kind: 'building' });
    expect(shareState({ ...base, lifecycle: 'open', comment: 'Some other comment' })).toEqual({ kind: 'building' });
  });
  it('is failed when the workflow posted without a command', () => {
    expect(shareState({ ...base, lifecycle: 'open', comment: failedComment })).toEqual({ kind: 'failed' });
  });
  it('says there is nothing to install when no package changes, whatever the comment says', () => {
    expect(shareState({ ...base, files: ['docs/PREVIEWS.md'], lifecycle: 'open', comment: releaseComment() })).toEqual({ kind: 'no-packages' });
    expect(shareState({ ...base, files: ['docs/PREVIEWS.md'], lifecycle: 'merged', comment: releaseComment() })).toEqual({ kind: 'no-packages' });
  });
  it('after shipping or closing: the prerelease is removed, pkg.pr.new snapshots stay', () => {
    expect(shareState({ ...base, lifecycle: 'merged', comment: releaseComment() })).toMatchObject({ kind: 'shipped', stillWorks: false });
    expect(shareState({ ...base, lifecycle: 'closed', comment: releaseComment() })).toMatchObject({ kind: 'closed', stillWorks: false });
    expect(shareState({ ...base, lifecycle: 'merged', comment: pkgPrNewComment })).toMatchObject({ kind: 'shipped', stillWorks: true });
    expect(shareState({ ...base, lifecycle: 'closed', comment: null })).toEqual({ kind: 'closed', stillWorks: null, command: null });
  });
});

describe('stateSentence', () => {
  it('says the preview is being prepared, without a command', () => {
    expect(stateSentence({ kind: 'building' })).toMatch(/^The preview version is being prepared\./);
    expect(stateSentence({ kind: 'ready', command: 'npm i x', source: 'release' })).toBeNull();
  });
  it('says whether the preview still works after shipping or closing', () => {
    expect(stateSentence({ kind: 'shipped', stillWorks: false, command: 'x' })).toMatch(/preview version was removed/);
    expect(stateSentence({ kind: 'closed', stillWorks: true, command: 'x' })).toMatch(/still installs/);
  });
  it('never uses developer words or an em dash', () => {
    const all = (['building', 'failed', 'no-packages'] as const).map((kind) => stateSentence({ kind } as never));
    all.push(stateSentence({ kind: 'shipped', stillWorks: false, command: null }), stateSentence({ kind: 'closed', stillWorks: null, command: null }));
    for (const s of all) {
      expect(jargonIn(s!)).toEqual([]);
      expect(s).not.toMatch(/\bnpm\b/i);
      expect(s).not.toContain('\u2014');
    }
  });
});

describe('shareMessage', () => {
  const url = 'https://github.com/peterbono/ai-design-system-demo/pull/101';
  it('builds the message for a developer: title, command, try link, how long it lasts, how to go back', () => {
    const state = shareState({ ...base, lifecycle: 'open', comment: releaseComment() });
    const m = shareMessage({ title: 'Darker default background', state, packages: PACKAGES, tryUrl: 'https://admin.example/?bridge=101', url })!;
    expect(m.subject).toBe('Try the design system change "Darker default background" before it ships');
    expect(m.body).toContain(`npm i ${RELEASE_URLS.join(' ')}`);
    expect(m.body).toContain('See it in the demo product first: https://admin.example/?bridge=101');
    expect(m.body).toContain('removed when it ships or closes');
    expect(m.body).toContain('npm i @bridge-ds/tokens@latest @bridge-ds/core@latest @bridge-ds/react@latest');
    expect(m.body).toContain(`Details for developers: ${url}`);
    expect(m.body).not.toContain('\u2014');
  });
  it('leaves the try link out when there is none, and says pkg.pr.new snapshots stay', () => {
    const state = shareState({ ...base, lifecycle: 'open', comment: pkgPrNewComment });
    const m = shareMessage({ title: 'A "quoted" title', state, packages: PACKAGES, tryUrl: null, url })!;
    expect(m.body).not.toContain('demo product');
    expect(m.body).toContain("\"A 'quoted' title\"");
    expect(m.body).toContain('This preview stays available.');
  });
  it('has no message while building, failed or with nothing to install', () => {
    for (const state of [{ kind: 'building' }, { kind: 'failed' }, { kind: 'no-packages' }] as const) expect(shareMessage({ title: 't', state, packages: PACKAGES, url })).toBeNull();
    expect(shareMessage({ title: 't', state: { kind: 'shipped', stillWorks: null, command: null }, packages: PACKAGES, url })).toBeNull();
  });
  it('after shipping: tells the team the preview is gone and how to go back', () => {
    const state = shareState({ ...base, lifecycle: 'merged', comment: releaseComment() });
    const m = shareMessage({ title: 'Darker default background', state, packages: PACKAGES, url })!;
    expect(m.subject).toBe('Design system change "Darker default background" has shipped');
    expect(m.body).toContain('Its preview version was removed, so reinstalling it fails.');
    expect(m.body).toContain(stableCommand(PACKAGES));
  });
});

describe('mailtoHref', () => {
  it('encodes subject and body, with CRLF line breaks', () => {
    const href = mailtoHref({ subject: 'A & B', body: 'one\ntwo' });
    expect(href).toBe('mailto:?subject=A%20%26%20B&body=one%0D%0Atwo');
  });
});

describe('showShare', () => {
  it('shows while open or draft, whatever the state, and after shipping only when a preview was posted', () => {
    expect(showShare('open', { kind: 'no-packages' })).toBe(true);
    expect(showShare('draft', { kind: 'building' })).toBe(true);
    expect(showShare('merged', { kind: 'no-packages' })).toBe(false);
    expect(showShare('merged', { kind: 'shipped', stillWorks: null, command: null })).toBe(false);
    expect(showShare('closed', { kind: 'closed', stillWorks: false, command: 'npm i x' })).toBe(true);
  });
});

describe('shareDescription', () => {
  it('explains the preview while it can be tried, says where it stands once finished', () => {
    expect(shareDescription({ kind: 'building' })).toBe(EXPLAIN);
    expect(EXPLAIN).toBe('Product teams can install this branch in their app before it is merged, and remove it any time.');
    expect(shareDescription({ kind: 'shipped', stillWorks: false, command: 'x' })).toMatch(/^This branch was merged, so its preview version was removed\./);
  });
});
