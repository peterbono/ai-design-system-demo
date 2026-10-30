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
  /**
   * The previews as Vercel reports them (`resolveBranchPreviews` over the deployments, statuses and the Vercel
   * comment). Without it, only template URLs Vercel cannot have shortened are written.
   */
  previews?: BranchPreview[] | undefined;
}

/** The sticky PR comment: install commands for each package, then the per-branch previews. Markdown, no HTML. */
export function previewComment(input: PreviewCommentInput): string {
  const sha7 = input.sha.slice(0, 7);
  const lines = [PREVIEW_COMMENT_MARKER, input.exploration ? '## Try this exploration in your product' : '## Try this DS branch in your product', ''];
  lines.push(`Snapshot of \`${sha7}\` on \`${input.branch}\`. Install it in a product branch that deploys to staging; production keeps the released version.`, '');
  if (input.exploration) lines.push('This is an exploration: it is never merged as is. Use it for a prototype, a user test, a demo or an A/B idea, then say it is done exploring: developers take it from there, and it stays open so this preview keeps working.', '');

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
  const previews = input.previews ?? resolveBranchPreviews(input.apps, ctx);
  lines.push('### Previews', '');
  if (previews.length) {
    lines.push('| App | Preview |', '| --- | --- |');
    // A URL Vercel shortened is never guessed: its own comment on this pull request has the link.
    for (const p of previews) lines.push(`| ${p.label} | ${p.url ?? 'Link in the Vercel comment on this pull request'} |`);
    const docs = previews.find((p) => p.app === 'docs')?.url;
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

// ---------------------------------------------------------------------------------------------------------------
// Real branch preview URLs. Vercel shortens a branch alias whose first host label would pass 63 characters
// (`bridge-admin-git-explore-button-norm-0ed5ba-peterbonos-projects.vercel.app`), with a hash nobody can predict, so
// tools read the URL Vercel reports instead of filling the template: GitHub deployments, then the Vercel commit
// statuses, then the Vercel bot comment on the pull request, and the template only when its host labels fit.

/** Where a preview URL comes from, most trusted first. */
export type PreviewUrlSource = 'deployment' | 'status' | 'vercel-comment' | 'template';
/** Whether the preview of the latest commit can be opened. `unknown` when only the template says where it is. */
export type PreviewState = 'ready' | 'building' | 'failed' | 'unknown';

export interface BranchPreview {
  app: keyof PreviewApps;
  label: string;
  /** Null when nothing reports it yet and the template cannot be trusted (a host label over 63 characters). */
  url: string | null;
  state: PreviewState;
  source: PreviewUrlSource | null;
}

/** A GitHub deployment with its latest status, as `GitHubClient.listDeployments` returns it. */
export interface DeploymentLike {
  environment: string;
  state?: string | null | undefined;
  environmentUrl?: string | null | undefined;
}

/** A commit status (`GET /commits/{sha}/statuses`), newest first like GitHub returns them. */
export interface CommitStatusLike {
  context: string;
  state: string;
  target_url?: string | null | undefined;
}

/** One project of the Vercel bot comment. */
export interface VercelCommentProject {
  name: string;
  /** https URL of the branch alias, as Vercel built it (shortened when long). */
  previewUrl: string | null;
  /** `DEPLOYED`, `PENDING`, `BUILDING`, `IGNORED`, `FAILED`... as Vercel writes it. */
  status: string | null;
}

const httpsUrl = (raw: string | null | undefined): string | null => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};

const decodeBase64 = (b64: string): string => {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
};

/** True for the comment the Vercel GitHub app posts (and edits) on a pull request. */
export const isVercelComment = (body: string | null | undefined): boolean => !!body && /^\[vc\]: #[^:\s]*:[A-Za-z0-9+/=]+/m.test(body);

/**
 * The projects of a Vercel bot comment, from its hidden header `[vc]: #<hash>:<base64 JSON>` (projects[].name and
 * previewUrl). Null when the body is not that comment or the header does not decode.
 */
export function parseVercelComment(body: string | null | undefined): VercelCommentProject[] | null {
  if (!body) return null;
  const m = /^\[vc\]: #[^:\s]*:([A-Za-z0-9+/=]+)/m.exec(body);
  if (!m) return null;
  let data: { projects?: { name?: unknown; previewUrl?: unknown; nextCommitStatus?: unknown }[] };
  try {
    data = JSON.parse(decodeBase64(m[1]!));
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.projects)) return null;
  return data.projects
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({ name: p.name as string, previewUrl: httpsUrl(typeof p.previewUrl === 'string' ? p.previewUrl : null), status: typeof p.nextCommitStatus === 'string' ? p.nextCommitStatus : null }));
}

/** The Vercel bot comment among a pull request's comments (the last one, if there were ever two). */
export function findVercelComment<T extends { body?: string | null | undefined }>(comments: T[]): T | undefined {
  return [...comments].reverse().find((c) => isVercelComment(c.body));
}

/** The first host label of a template, up to its first placeholder: `bridge-admin-git-` for the admin template. */
function templateHostPrefix(template: string | undefined): string | null {
  if (!template) return null;
  const host = /^https?:\/\/([^/?#]+)/i.exec(template)?.[1];
  if (!host) return null;
  return host.split('.')[0]!.split('{')[0]!.toLowerCase();
}

/**
 * The app (`docs`, `storybook`, `admin`) a Vercel project serves, from the host its template starts with: project
 * `bridge-admin` serves the app whose template host starts with `bridge-admin-git-` (Vercel's branch alias shape),
 * else with `bridge-admin-` when only one template does. Null when no template names it.
 */
export function appForProject(project: string, apps: PreviewApps): keyof PreviewApps | null {
  const name = project.trim().toLowerCase();
  if (!name) return null;
  const keys = Object.keys(PREVIEW_APP_LABELS) as (keyof PreviewApps)[];
  const prefixes = keys.map((app) => [app, templateHostPrefix(apps[app])] as const);
  const exact = prefixes.find(([, p]) => p === `${name}-git-` || p === name);
  if (exact) return exact[0];
  // Otherwise one template must start with `<project>-`; several (a project name that prefixes others) name none.
  const loose = prefixes.filter(([, p]) => p !== null && p.startsWith(`${name}-`));
  return loose.length === 1 ? loose[0]![0] : null;
}

/** The project a deployment environment or a status context names: `Preview – bridge-admin` -> `bridge-admin`. */
export function projectOfLabel(label: string): string | null {
  const m = /^\s*(?:preview|vercel)\s*[\u2013\u2014-]\s*(.+?)\s*$/i.exec(label);
  return m ? m[1]! : null;
}

const STATE_OF: Record<string, PreviewState> = {
  success: 'ready',
  inactive: 'ready',
  deployed: 'ready',
  ready: 'ready',
  ignored: 'ready', // Vercel skipped the build (nothing changed for this app): the branch alias serves the last one.
  pending: 'building',
  queued: 'building',
  in_progress: 'building',
  building: 'building',
  initializing: 'building',
  failure: 'failed',
  error: 'failed',
  failed: 'failed',
  canceled: 'failed',
};
const stateOf = (s: string | null | undefined): PreviewState => STATE_OF[(s ?? '').toLowerCase()] ?? 'unknown';
const isInspectorUrl = (u: string) => /^https:\/\/(?:www\.)?vercel\.com\//i.test(u);

export interface BranchPreviewSources {
  /** GitHub deployments of the head commit, each with its latest status. */
  deployments?: DeploymentLike[] | undefined;
  /** Commit statuses of the head commit, newest first. */
  statuses?: CommitStatusLike[] | undefined;
  /** The pull request's comments (the Vercel bot comment is read from them). */
  comments?: { body?: string | null | undefined }[] | undefined;
}

/**
 * The preview of each configured app, real URL first: a GitHub deployment's environment URL, then a Vercel commit
 * status pointing at the deployment (not at the inspector), then the Vercel bot comment, and the config template only
 * when its host labels fit in 63 characters (else Vercel shortened it: url null until a real source reports it).
 * The state comes from the freshest signal: commit status, then deployment, then the comment.
 */
export function resolveBranchPreviews(apps: PreviewApps, ctx: PreviewContext, sources: BranchPreviewSources = {}): BranchPreview[] {
  type Seen = { url?: string; urlSource?: PreviewUrlSource; state?: PreviewState; stateRank?: number };
  const seen = new Map<keyof PreviewApps, Seen>();
  const at = (app: keyof PreviewApps) => seen.get(app) ?? (seen.set(app, {}), seen.get(app)!);
  const offer = (app: keyof PreviewApps | null, url: string | null, urlSource: PreviewUrlSource, state: PreviewState, stateRank: number) => {
    if (!app) return;
    const s = at(app);
    if (url && !s.url) Object.assign(s, { url, urlSource });
    if (state !== 'unknown' && (s.stateRank === undefined || stateRank < s.stateRank)) Object.assign(s, { state, stateRank });
  };

  // 1. Commit statuses (Vercel – <project>): newest first, so the first one per context is current.
  const contexts = new Set<string>();
  for (const st of sources.statuses ?? []) {
    if (contexts.has(st.context)) continue;
    contexts.add(st.context);
    const project = projectOfLabel(st.context);
    if (!project) continue;
    const url = httpsUrl(st.target_url);
    offer(appForProject(project, apps), url && !isInspectorUrl(url) ? url : null, 'status', stateOf(st.state), 0);
  }
  // 2. Deployments (Preview – <project>): their URL beats the status's.
  for (const d of sources.deployments ?? []) {
    const project = projectOfLabel(d.environment);
    const app = project ? appForProject(project, apps) : null;
    if (!app) continue;
    const url = httpsUrl(d.environmentUrl);
    const s = at(app);
    if (url && s.urlSource !== 'deployment') Object.assign(s, { url, urlSource: 'deployment' as const });
    const state = stateOf(d.state);
    if (state !== 'unknown' && (s.stateRank === undefined || 1 < s.stateRank)) Object.assign(s, { state, stateRank: 1 });
  }
  // 3. The Vercel bot comment.
  for (const p of parseVercelComment(findVercelComment(sources.comments ?? [])?.body) ?? []) offer(appForProject(p.name, apps), p.previewUrl, 'vercel-comment', stateOf(p.status), 2);

  const out: BranchPreview[] = [];
  for (const app of Object.keys(PREVIEW_APP_LABELS) as (keyof PreviewApps)[]) {
    if (!apps[app]) continue;
    const s = seen.get(app) ?? {};
    // 4. The template, only when Vercel would not have shortened it (previewUrl returns null over 63 characters).
    const url = s.url ?? previewUrl(apps[app], ctx);
    const source: PreviewUrlSource | null = s.url ? s.urlSource! : url ? 'template' : null;
    out.push({ app, label: PREVIEW_APP_LABELS[app], url, state: s.state ?? 'unknown', source });
  }
  return out;
}

/** The previews that have a URL, as links (`{ app, label, url }`), in the stable app order. */
export const previewLinksOf = (previews: BranchPreview[]): { app: keyof PreviewApps; label: string; url: string }[] =>
  previews.filter((p): p is BranchPreview & { url: string } => !!p.url).map((p) => ({ app: p.app, label: p.label, url: p.url }));

/**
 * True when every configured app has a finished build: ready with its URL, or failed (a build Vercel refused, such as
 * a rate limit, never gets a URL). Polling can stop.
 */
export const previewsSettled = (previews: BranchPreview[]): boolean => previews.every((p) => p.state === 'failed' || (!!p.url && p.state === 'ready'));
