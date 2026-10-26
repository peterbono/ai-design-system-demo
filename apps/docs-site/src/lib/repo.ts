// Build-time access to the repository checkout: plain file reads and git. What the files mean (bridge.config.json,
// tokens, components, contrast) comes from the repo model (lib/model.ts, @bridge-ds/core loadRepoModel), parsed once.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { appUrl, type PreviewApps } from '@bridge-ds/core';
import { repoModel, ROOT } from './model';

export { ROOT };

export const repoPath = (...parts: string[]) => join(ROOT, ...parts);
export const readText = (rel: string) => readFileSync(repoPath(rel), 'utf8');
export const readJson = <T = unknown>(rel: string): T => JSON.parse(readText(rel)) as T;
export const exists = (rel: string) => existsSync(repoPath(rel));
export const listDir = (rel: string) => (exists(rel) ? readdirSync(repoPath(rel)) : []);
export const toRel = (abs: string) => relative(ROOT, abs);

const REPO = repoModel.site;
export const GITHUB_URL = `https://github.com/${REPO.owner}/${REPO.repo}`;
export const DEFAULT_BRANCH = REPO.defaultBranch;

/** Per-branch deploy URL templates from bridge.config.json (`previews.apps`), read by the Branches page too. */
export const PREVIEW_APPS: PreviewApps = repoModel.config.previews?.apps ?? {};
export const PREVIEW_PACKAGES: string[] = repoModel.config.previews?.packages ?? [];
/** Production URL of each app from bridge.config.json (`previews.production`). */
export const PRODUCTION_APPS: PreviewApps = repoModel.config.previews?.production ?? {};

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

/** The built plugin, ready to import in Figma desktop: .github/workflows/figma-plugin-release.yml publishes it on every
 *  plugin change to main, as this asset on this rolling release. */
export const PLUGIN_RELEASE_TAG = 'figma-plugin-latest';
export const PLUGIN_ZIP = 'bridge-figma-plugin.zip';
export const PLUGIN_ZIP_URL = `${GITHUB_URL}/releases/download/${PLUGIN_RELEASE_TAG}/${PLUGIN_ZIP}`;

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
