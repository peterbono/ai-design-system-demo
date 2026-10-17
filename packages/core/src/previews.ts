// Branch previews: where a design system branch can be tried before it merges. Pure URL and text building, shared
// by the PR comment workflow (.github/workflows/preview-packages.yml) and the docs site Branches page, so both
// print the same links. See docs/PREVIEWS.md.

/** Apps deployed once per branch. Values are URL templates (see `previewUrl`). */
export interface PreviewApps {
  docs?: string | undefined;
  storybook?: string | undefined;
  admin?: string | undefined;
}

export interface PreviewsConfig {
  /** Packages published as snapshots for every PR commit (pkg.pr.new). */
  packages: string[];
  /** Per-branch deploy URL templates. Missing entries mean "not set up". */
  apps: PreviewApps;
  /** Production URL of each app (the default branch's deploy), fixed URLs without placeholders. */
  production?: PreviewApps | undefined;
}

export const PREVIEW_APP_LABELS: Record<keyof PreviewApps, string> = { docs: 'Docs', storybook: 'Storybook', admin: 'Admin demo' };
export const PREVIEW_PLACEHOLDERS = ['branch', 'rawBranch', 'pr', 'sha', 'sha7'] as const;

export interface PreviewContext {
  branch: string;
  pr?: number | undefined;
  sha?: string | undefined;
}

/**
 * Vercel's branch alias slug: lowercase, every run of characters outside [a-z0-9] becomes one dash, no dash at
 * either end. `feat/Branch_previews` -> `feat-branch-previews`.
 */
export function branchSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Fills a URL template. Placeholders: `{branch}` (slug), `{rawBranch}` (URL-encoded), `{pr}`, `{sha}`, `{sha7}`.
 * Returns null when the template needs a value the context lacks, when the result is not an http(s) URL, or when
 * a host label exceeds 63 characters (Vercel then shortens the alias with a hash nobody can predict: read the
 * URL from the Vercel bot comment on the PR instead).
 */
export function previewUrl(template: string | undefined, ctx: PreviewContext): string | null {
  if (!template) return null;
  const values: Record<string, string | undefined> = {
    branch: branchSlug(ctx.branch),
    rawBranch: encodeURIComponent(ctx.branch),
    pr: ctx.pr === undefined ? undefined : String(ctx.pr),
    sha: ctx.sha,
    sha7: ctx.sha?.slice(0, 7),
  };
  let missing = false;
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    if (!v) missing = true;
    return v ?? '';
  });
  if (missing) return null;
  let url: URL;
  try {
    url = new URL(filled);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname.split('.').some((label) => label.length > 63)) return null;
  return url.href;
}

/** All configured app previews for a branch, in a stable order. Unconfigured or unbuildable ones are left out. */
export function previewLinks(apps: PreviewApps, ctx: PreviewContext): { app: keyof PreviewApps; label: string; url: string }[] {
  const out: { app: keyof PreviewApps; label: string; url: string }[] = [];
  for (const app of Object.keys(PREVIEW_APP_LABELS) as (keyof PreviewApps)[]) {
    const url = previewUrl(apps[app], ctx);
    if (url) out.push({ app, label: PREVIEW_APP_LABELS[app], url });
  }
  return out;
}

/**
 * Where an app lives for a build: its branch preview on any branch other than the default one, its production URL
 * on the default branch or when the branch is unknown (local builds). Falls back to the other one when only one is
 * set up, and returns null when neither is. Trailing slash removed, for joining paths.
 */
export function appUrl(
  previews: Pick<PreviewsConfig, 'apps' | 'production'> | undefined,
  app: keyof PreviewApps,
  ctx: { branch?: string | undefined; defaultBranch?: string | undefined } = {},
): string | null {
  const main = ctx.defaultBranch ?? 'main';
  const production = previewUrl(previews?.production?.[app], { branch: main });
  const onPreview = !!ctx.branch && ctx.branch !== main;
  const url = onPreview
    ? (previewUrl(previews?.apps[app], { branch: ctx.branch! }) ?? production)
    : (production ?? previewUrl(previews?.apps[app], { branch: main }));
  return url ? url.replace(/\/$/, '') : null;
}

/**
 * pkg.pr.new snapshot URL for a package at a commit (or a PR number, which pkg.pr.new resolves to its latest
 * commit). Long form `https://pkg.pr.new/<owner>/<repo>/<package>@<ref>`, which works before the package is on npm.
 */
export function snapshotUrl(owner: string, repo: string, pkg: string, ref: string | number): string {
  return `https://pkg.pr.new/${owner}/${repo}/${pkg}@${ref}`;
}

/** One install command for several packages, so internal dependencies resolve to the same snapshot. */
export function installCommand(urls: string[], pm: 'npm' | 'pnpm' | 'yarn' = 'npm'): string {
  const verb = pm === 'npm' ? 'npm i' : pm === 'pnpm' ? 'pnpm add' : 'yarn add';
  return `${verb} ${urls.join(' ')}`;
}

/** Release asset name the fallback workflow uploads (`@bridge-ds/react` -> `bridge-ds-react-<sha7>.tgz`). */
export function tarballAssetName(pkg: string, sha: string): string {
  return `${pkg.replace(/^@/, '').replace(/\//g, '-')}-${sha.slice(0, 7)}.tgz`;
}

/** Download URL of a fallback tarball attached to the `preview-pr-<n>` prerelease. */
export function tarballUrl(owner: string, repo: string, pr: number, pkg: string, sha: string): string {
  return `https://github.com/${owner}/${repo}/releases/download/preview-pr-${pr}/${tarballAssetName(pkg, sha)}`;
}

export const PREVIEW_COMMENT_MARKER = '<!-- bridge-branch-preview -->';

export interface PreviewCommentInput {
  owner: string;
  repo: string;
  pr: number;
  branch: string;
  sha: string;
  /** Snapshot URLs by package, from pkg.pr.new or the tarball fallback. Empty when publishing failed. */
  packages: { name: string; url: string }[];
  /** Where the snapshots come from, for the note under the table. */
  source: 'pkg.pr.new' | 'release' | 'none';
  apps: PreviewApps;
  /** An exploration (`explore/*` branch or `exploration` label): staging only, never merged as is (docs/EXPLORATIONS.md). */
  exploration?: boolean | undefined;
}

/** The sticky PR comment: install commands for each package, then the per-branch previews. Markdown, no HTML. */
export function previewComment(input: PreviewCommentInput): string {
  const sha7 = input.sha.slice(0, 7);
  const lines = [PREVIEW_COMMENT_MARKER, input.exploration ? '## Try this exploration in your product' : '## Try this DS branch in your product', ''];
  lines.push(`Snapshot of \`${sha7}\` on \`${input.branch}\`. Install it in a product branch that deploys to staging; production keeps the released version.`, '');
  if (input.exploration) lines.push('This is an exploration: it is never merged as is. Use it for a prototype, a user test, a demo or an A/B idea, then promote it to review or close it.', '');

  if (input.packages.length) {
    // Explorations install as `name@url`, so the product's package.json keeps the package names.
    lines.push('```sh', installCommand(input.packages.map((p) => (input.exploration ? `${p.name}@${p.url}` : p.url))), '```', '');
    lines.push('| Package | Install this package only |', '| --- | --- |');
    for (const p of input.packages) lines.push(`| \`${p.name}\` | \`npm i ${p.url}\` |`);
    lines.push('');
    lines.push(
      input.source === 'release'
        ? `Tarballs from the [\`preview-pr-${input.pr}\` prerelease](https://github.com/${input.owner}/${input.repo}/releases/tag/preview-pr-${input.pr}) (pkg.pr.new is not set up). Only the latest commit is kept.`
        : 'Snapshots on [pkg.pr.new](https://pkg.pr.new), one per commit. Swap the commit for the PR number to always get the latest.',
    );
  } else {
    lines.push('No package snapshot for this commit: the publish step failed. See the workflow run.');
  }
  lines.push('');

  const ctx = { branch: input.branch, pr: input.pr, sha: input.sha };
  const links = previewLinks(input.apps, ctx);
  lines.push('### Previews', '');
  if (links.length) {
    lines.push('| App | Preview |', '| --- | --- |');
    for (const l of links) lines.push(`| ${l.label} | ${l.url} |`);
    const docs = previewUrl(input.apps.docs, ctx);
    if (docs) {
      lines.push('');
      lines.push(`Tokens only, no reinstall: open your staging with \`?bridge-tokens=${new URL('tokens.css', docs).href}\` (the staging app must allow this origin, see docs/PREVIEWS.md).`);
    }
  } else {
    lines.push('Preview deploys are not set up: add `previews.apps` to `bridge.config.json` (docs/PREVIEWS.md).');
  }
  return lines.join('\n') + '\n';
}

/** What the sticky comment says about installing a snapshot, read back by tools (plugin, Studio). */
export interface PreviewCommentInstall {
  /** The command of the first ```sh block, exactly as the workflow wrote it. Null when publishing failed. */
  command: string | null;
  /** The commit the snapshot was built from (`Snapshot of \`1a2b3c4\``), or null when the comment does not say. */
  sha7: string | null;
  /** Where the snapshots live, from the command's URLs. */
  source: 'pkg.pr.new' | 'release' | 'other' | 'none';
}

/**
 * The install command of a `<!-- bridge-branch-preview -->` comment: the first ```sh block, its lines joined (a
 * trailing `\` continues a line). Null when the body is not that comment or has no command (the publish failed).
 * This is the command that works: pkg.pr.new when the workflow published there, the prerelease tarballs otherwise.
 */
export function installCommandFromPreviewComment(body: string | null | undefined): string | null {
  if (!body || !body.trimStart().startsWith(PREVIEW_COMMENT_MARKER)) return null;
  const m = /```(?:sh|bash|shell)[^\n]*\n([\s\S]*?)```/.exec(body);
  if (!m) return null;
  const command = m[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .join(' ')
    .replace(/\s*\\\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return command || null;
}

/** Reads a sticky preview comment back: its command, the commit it was built from, where the snapshots live. */
export function readPreviewComment(body: string | null | undefined): PreviewCommentInstall | null {
  if (!body || !body.trimStart().startsWith(PREVIEW_COMMENT_MARKER)) return null;
  const command = installCommandFromPreviewComment(body);
  const sha7 = /Snapshot of `([0-9a-f]{7,40})`/.exec(body)?.[1]?.slice(0, 7) ?? null;
  const source = !command ? 'none' : command.includes('https://pkg.pr.new/') ? 'pkg.pr.new' : /\/releases\/download\/preview-pr-\d+\//.test(command) ? 'release' : 'other';
  return { command, sha7, source };
}

/** The sticky preview comment among a pull request's comments (the last one, if a run ever posted twice). */
export function findPreviewComment<T extends { body?: string | null | undefined }>(comments: T[]): T | undefined {
  return [...comments].reverse().find((c) => !!c.body && c.body.trimStart().startsWith(PREVIEW_COMMENT_MARKER));
}
