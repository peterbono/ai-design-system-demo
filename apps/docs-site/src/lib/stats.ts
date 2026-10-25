// Everything the Overview dashboard shows, for this build: thin wrappers over the pure lib/library/stats.ts with the
// build-time repo model (lib/model.ts), plus the git facts of this checkout.
import type { TokenUsage } from '@bridge-ds/core';
import * as lib from './library/stats';
import { repoModel } from './model';
import { git } from './repo';

export type { Issue, IssueKind, Slice } from './library/stats';
export { categoryOf, humanDate, typeLabel } from './library/stats';

/** Global stylesheet -> CSS custom properties it reads (base styles, theme), from the repo model. */
export const globalStyleVars = (): Record<string, string[]> => lib.globalStyleVars(repoModel);

/** Which tokens are in use: read by component CSS or the library's global stylesheets, or aliased by a token in use. */
export const libraryTokenUsage = (): TokenUsage => lib.libraryTokenUsage(repoModel);

export const dashboard = () => lib.dashboard(repoModel);

export interface RepoStatus {
  branch: string;
  sha: string;
  lastChange: string | null;
  commits: number;
}

export function repoStatus(): RepoStatus {
  const branch = process.env.VERCEL_GIT_COMMIT_REF || git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || git(['rev-parse', 'HEAD'])).slice(0, 7) || 'unknown';
  const lastChange = git(['log', '-1', '--format=%cs']) || null;
  const commits = Number(git(['rev-list', '--count', 'HEAD'])) || 0;
  return { branch, sha, lastChange, commits };
}

