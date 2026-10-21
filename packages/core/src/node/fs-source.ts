// fsSource: a RepoSource over a local checkout (build time, CLI, tests). Lists files with node:fs, skipping
// .git and node_modules, and pins the ref to the checkout's HEAD when git answers ("working-tree" otherwise).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRepoPath, type RepoSource, type RepoSourceRef } from '../repo-source';

const SKIP = new Set(['.git', 'node_modules']);

function gitOut(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** owner, repo and sha of a checkout: the github.com origin remote and HEAD, when git knows them. */
export function localRepoRef(root: string): RepoSourceRef {
  const origin = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(\.git)?$/.exec(gitOut(root, ['remote', 'get-url', 'origin']));
  return { owner: origin?.[1] ?? '', repo: origin?.[2] ?? '', sha: gitOut(root, ['rev-parse', 'HEAD']) || 'working-tree' };
}

/** A RepoSource over the files of `root` as they are on disk (uncommitted changes included). */
export function fsSource(root: string, ref: Partial<RepoSourceRef> = {}): RepoSource {
  let resolved: RepoSourceRef | undefined;
  const walk = (rel: string, out: string[]) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, out);
      else if (entry.isFile()) out.push(path);
      else if (entry.isSymbolicLink() && statSync(join(root, path), { throwIfNoEntry: false })?.isFile()) out.push(path);
    }
  };
  return {
    get ref() {
      resolved ??= { ...localRepoRef(root), ...Object.fromEntries(Object.entries(ref).filter(([, v]) => v !== undefined)) };
      return resolved;
    },
    async list(prefix = '') {
      const rel = normalizeRepoPath(prefix);
      const abs = join(root, rel);
      if (!existsSync(abs)) return [];
      if (!statSync(abs).isDirectory()) return [rel];
      const out: string[] = [];
      walk(rel, out);
      return out.sort();
    },
    async text(path) {
      const abs = join(root, normalizeRepoPath(path));
      try {
        return statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
      } catch {
        return null;
      }
    },
  };
}
