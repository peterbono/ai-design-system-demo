// Build-time access to the repository. Every page reads its data through here, so nothing is typed twice:
// tokens, components, governance and changelog all come from files that already exist in the repo.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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

export const GITHUB_URL = 'https://github.com/peterbono/ai-design-system-demo';
export const STORYBOOK_URL = (process.env.STORYBOOK_URL || 'http://localhost:6006').replace(/\/$/, '');

/** DS Bridge Figma plugin (apps/figma-plugin). Override with PLUGIN_URL once it is published to Figma Community. */
export const PLUGIN_URL = process.env.PLUGIN_URL || `${GITHUB_URL}/tree/main/apps/figma-plugin`;

export const sourceUrl = (rel: string) => `${GITHUB_URL}/blob/main/${rel}`;

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
