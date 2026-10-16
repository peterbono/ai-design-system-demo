// Build-time access to the repository. Every page reads its data through here, so nothing is typed twice:
// tokens, components, governance and changelog all come from files that already exist in the repo.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { appUrl, type PreviewApps } from '@bridge-ds/core';

function findRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'packages'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`docs-site: could not find the repo root from ${start}`);
    dir = parent;
  }
}

export const ROOT = findRoot(process.cwd());

export const repoPath = (...parts: string[]) => join(ROOT, ...parts);
export const readText = (rel: string) => readFileSync(repoPath(rel), 'utf8');
export const readJson = <T = unknown>(rel: string): T => JSON.parse(readText(rel)) as T;
export const exists = (rel: string) => existsSync(repoPath(rel));
export const listDir = (rel: string) => (exists(rel) ? readdirSync(repoPath(rel)) : []);
export const toRel = (abs: string) => relative(ROOT, abs);

/** Repo this workspace documents, from bridge.config.json (see lib/config.ts). Read lazily to avoid an import cycle. */
function rawConfig(): Record<string, any> {
  try {
    return existsSync(join(ROOT, 'bridge.config.json')) ? JSON.parse(readFileSync(join(ROOT, 'bridge.config.json'), 'utf8')) : {};
  } catch {
    return {};
  }
}

function configuredRepo(): { owner: string; repo: string; defaultBranch: string } {
  const fallback = { owner: 'peterbono', repo: 'ai-design-system-demo', defaultBranch: 'main' };
  try {
    const raw = rawConfig();
    const r = raw.repo;
    if (typeof r === 'string' && r.includes('/')) return { ...fallback, owner: r.split('/')[0], repo: r.split('/')[1], defaultBranch: raw.defaultBranch ?? fallback.defaultBranch };
    if (r && typeof r === 'object') return { owner: r.owner ?? fallback.owner, repo: r.name ?? r.repo ?? fallback.repo, defaultBranch: r.defaultBranch ?? r.branch ?? fallback.defaultBranch };
  } catch {
    /* invalid config: fall back to the demo repo */
  }
  return fallback;
}

const REPO = configuredRepo();
export const GITHUB_URL = `https://github.com/${REPO.owner}/${REPO.repo}`;
export const DEFAULT_BRANCH = REPO.defaultBranch;

/** Per-branch deploy URL templates from bridge.config.json (`previews.apps`), read by the Branches page too. */
export const PREVIEW_APPS: PreviewApps = (rawConfig().previews?.apps as PreviewApps | undefined) ?? {};
export const PREVIEW_PACKAGES: string[] = (rawConfig().previews?.packages as string[] | undefined) ?? [];
/** Production URL of each app from bridge.config.json (`previews.production`). */
export const PRODUCTION_APPS: PreviewApps = (rawConfig().previews?.production as PreviewApps | undefined) ?? {};

/** Branch being built on a preview host (Vercel, Cloudflare Pages, Netlify), or undefined for a local build. */
export const BUILD_BRANCH: string | undefined =
  process.env.VERCEL_GIT_COMMIT_REF || process.env.CF_PAGES_BRANCH || (process.env.NETLIFY === 'true' ? process.env.BRANCH : undefined) || undefined;

/**
 * Storybook to link and embed: STORYBOOK_URL when set, else this branch's Storybook preview on a preview build,
 * else the production Storybook (`previews.production.storybook`), else a local Storybook.
 */
export const STORYBOOK_URL = (
  process.env.STORYBOOK_URL ||
  appUrl({ apps: PREVIEW_APPS, production: PRODUCTION_APPS }, 'storybook', { branch: BUILD_BRANCH, defaultBranch: DEFAULT_BRANCH }) ||
  'http://localhost:6006'
).replace(/\/$/, '');

/** DS Bridge Figma plugin (apps/figma-plugin). Override with PLUGIN_URL once it is published to Figma Community. */
export const PLUGIN_URL = process.env.PLUGIN_URL || `${GITHUB_URL}/tree/${DEFAULT_BRANCH}/apps/figma-plugin`;

export const sourceUrl = (rel: string) => `${GITHUB_URL}/blob/${DEFAULT_BRANCH}/${rel}`;

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export { git };

const dateCache = new Map<string, string | null>();

/** Last commit date (YYYY-MM-DD) touching any of the given repo-relative paths. Null when git has no answer. */
export function lastUpdated(paths: string[]): string | null {
  const key = paths.join('|');
  if (dateCache.has(key)) return dateCache.get(key)!;
  const out = git(['log', '-1', '--format=%cs', '--', ...paths]);
  const value = out || null;
  dateCache.set(key, value);
  return value;
}

export const today = () => new Date().toISOString().slice(0, 10);
