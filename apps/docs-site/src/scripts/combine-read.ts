// Try several changes together, the reads (rules and words: lib/combine-changes.ts, the combination: @bridge-ds/core
// token-combine). For each change: one compare against the library (the files it edits since it started, and where
// it started), then its token files at its start and now, from raw.githubusercontent.com for visitors (no API read) or
// the API when signed in. The latest library is this build's own token files (/studio/library-files.json), or on a
// team shell the team's own tokens at its default branch head (scripts/team-data.ts, already read by the page). Kept in
// memory per version of each change, so checking and unchecking never reads GitHub twice. Nothing is written.
import { contrastPair, layoutOptions, loadConfig, parseContrastChecks, readCombineBranch, type ChangeEdits, type ContrastPair, type LayoutOptions } from '@bridge-ds/core';
import { hasWorkingToken, readRepo, studioClient } from './github-session';
import { isHosted, STUDIO_ROOT } from '../lib/team-path';
import { loadTeamData } from './team-data';

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

/** Why the latest library could not be read: the message says what failed and how to fix it. */
export class LatestLibraryError extends Error {}

/** This build's token files (a team shell: the team's), layout and contrast pairs: the latest library the changes are combined on. */
export function readLatestLibrary(): Promise<LatestLibrary> {
  latest ??= isHosted() ? readTeamLibrary() : readSiteLibrary();
  latest.catch(() => (latest = null));
  return latest;
}

/** The team's tokens at its default branch head, from the repo model the team shell already reads. */
async function readTeamLibrary(): Promise<LatestLibrary> {
  let model;
  try {
    ({ model } = await loadTeamData());
  } catch (err) {
    throw new LatestLibraryError(`Could not read this team's latest tokens from GitHub (${(err as Error).message}). Reload the page to try again.`);
  }
  return {
    files: model.tokens.files,
    options: layoutOptions(model.config),
    tokensRoot: model.tokens.root,
    pairs: model.contrast.specs.map((p) => contrastPair(p.fg, p.bg, p.min)),
  };
}

/** This build's own token files. Self-hosted Studio lives at /studio/, so the file is always at its root. */
function readSiteLibrary(): Promise<LatestLibrary> {
  return fetch(`${STUDIO_ROOT}library-files.json`)
    .catch(() => {
      throw new LatestLibraryError('Could not reach Bridge to read the latest tokens. Check your connection and reload the page.');
    })
    .then((r) => {
      if (!r.ok) throw new LatestLibraryError(`Could not read the latest tokens (Bridge answered ${r.status}). Reload the page to try again.`);
      return r.json() as Promise<{ files: Record<string, string>; config: string; tokensRoot: string }>;
    })
    .then((body) => {
      const config = loadConfig(body.config);
      const checks = document.getElementById('bridge-contrast')?.textContent || document.getElementById('xp-checks')?.textContent || undefined;
      return { files: body.files, options: layoutOptions(config), tokensRoot: body.tokensRoot, pairs: parseContrastChecks(checks) };
    });
}
