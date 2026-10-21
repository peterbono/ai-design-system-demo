// Try several changes together, the reads (rules and words: lib/combine-changes.ts, the combination: @bridge-ds/core
// token-combine). For each change: one compare against the library (the files it edits since it started, and where
// it started), then its token files at its start and now, from raw.githubusercontent.com for visitors (no API read) or
// the API when signed in. The latest library is this build's own token files (/studio/library-files.json). Kept in
// memory per version of each change, so checking and unchecking never reads GitHub twice. Nothing is written.
import { layoutOptions, loadConfig, parseContrastChecks, readCombineBranch, type ChangeEdits, type ContrastPair, type LayoutOptions } from '@bridge-ds/core';
import { hasWorkingToken, readRepo, studioClient } from './github-session';
import { studioHref } from '../lib/team-path';

export interface TogetherPull {
  number: number;
  title: string;
  head: { sha: string };
}

export interface TogetherSource {
  number: number;
  title: string;
  /** Only token files (and release notes): it can be combined here. */
  tokens: boolean;
  /** Its own token edits; null for a code change. */
  edits: ChangeEdits | null;
}

export interface LatestLibrary {
  files: Record<string, string>;
  options: LayoutOptions;
  tokensRoot: string;
  pairs: ContrastPair[];
}

const sources = new Map<string, Promise<TogetherSource>>();

/**
 * One change, as the combination needs it (core readCombineBranch, the same read as the MCP server and the CLI).
 * Throws (GitHubError) when GitHub cannot be read.
 */
export function readTogetherSource(pull: TogetherPull, tokensRoot: string): Promise<TogetherSource> {
  const key = `${pull.number}@${pull.head.sha}`;
  const memo = sources.get(key);
  if (memo) return memo;
  const { owner, repo, defaultBranch } = readRepo();
  const p = readCombineBranch(studioClient(`${owner}/${repo}`, hasWorkingToken() ? undefined : null), { number: pull.number, title: pull.title, headSha: pull.head.sha }, { base: defaultBranch, tokensRoot });
  sources.set(key, p);
  p.catch(() => sources.delete(key));
  return p;
}

let latest: Promise<LatestLibrary> | null = null;

/** This build's token files, layout and contrast pairs: the latest library the changes are combined on. */
export function readLatestLibrary(): Promise<LatestLibrary> {
  latest ??= fetch(studioHref('library-files.json'))
    .then((r) => {
      if (!r.ok) throw new Error('The latest library could not be read. Reload the page to try again.');
      return r.json() as Promise<{ files: Record<string, string>; config: string; tokensRoot: string }>;
    })
    .then((body) => {
      const config = loadConfig(body.config);
      const checks = document.getElementById('bridge-contrast')?.textContent || document.getElementById('xp-checks')?.textContent || undefined;
      return { files: body.files, options: layoutOptions(config), tokensRoot: body.tokensRoot, pairs: parseContrastChecks(checks) };
    });
  latest.catch(() => (latest = null));
  return latest;
}
