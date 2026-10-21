// Team pages (multi-team PR 3b): the one loader every team shell page reads its team from. The team comes from the
// address (/studio/<owner>/<repo>/...); the data, in this order: this browser's cache for the default branch head,
// the team's published snapshot when it was computed from that head (bridge-data branch, one raw read), else the
// repository itself, live from GitHub (scripts/repo-context.ts loadTeamModel). Signed in, reads carry the visitor's
// token (private repositories); signed out, public repositories are read anonymously.
//
// One load per page (memoized); Refresh and Try again start a new one. The snapshot is also read on its own for
// what only it carries (adoption audits), even when the model came from the cache.
import { parseSnapshot, SNAPSHOT_BRANCH, SNAPSHOT_FILE, SNAPSHOT_MAX_BYTES, storybookUrl, type GitHubClient, type RepoModel, type RepoSnapshot } from '@bridge-ds/core';
import { getToken, hasWorkingToken, studioClient } from './github-session';
import { loadTeamModel, type SnapshotReader, type TeamModelSource } from './repo-context';
import { repoFromPath } from '../lib/team-path';

export interface TeamData {
  owner: string;
  repo: string;
  model: RepoModel;
  /** The default branch head every file was read at. */
  sha: string;
  defaultBranch: string;
  private: boolean;
  source: TeamModelSource;
  /** The team's Storybook (bridge.config.json storybook.url, else previews.production.storybook), https only. */
  storybook: string | undefined;
  /** The client the data was read with (the visitor's token, or anonymous). */
  client: GitHubClient;
}

/** The team in this page's address, null off a team address. */
export function teamOfPage(): { owner: string; repo: string } | null {
  return typeof location === 'undefined' ? null : repoFromPath(location.pathname);
}

/** A client for the team, with the visitor's token when it works. */
export function teamClient(team: { owner: string; repo: string }): GitHubClient {
  return studioClient(`${team.owner}/${team.repo}`, hasWorkingToken() ? getToken() : null);
}

/**
 * The team's snapshot from its bridge-data branch, null when there is none, it is too large or it does not parse.
 * Public repositories: the raw host, no API quota. Private ones: the contents API with the visitor's token (the raw
 * host refuses a token).
 */
export const readTeamSnapshot: SnapshotReader = async (client, repo) => {
  const text = repo.private && client.canWrite ? await client.getRawText(SNAPSHOT_FILE, SNAPSHOT_BRANCH) : await client.readRawFile(SNAPSHOT_FILE, SNAPSHOT_BRANCH);
  if (!text || text.length > SNAPSHOT_MAX_BYTES) return null;
  try {
    return parseSnapshot(text);
  } catch {
    return null;
  }
};

let pending: Promise<TeamData> | null = null;
let snapshot: Promise<RepoSnapshot | null> | null = null;

/** The team of this page, read once per page. Rejects with the GitHub error (lib/team-load.ts teamFailure words it). */
export function loadTeamData(): Promise<TeamData> {
  pending ??= (async () => {
    const team = teamOfPage();
    if (!team) throw Object.assign(new Error('This page is not a team address.'), { status: 404 });
    const client = teamClient(team);
    const read = await loadTeamModel(client, { snapshot: readTeamSnapshot });
    if (read.snapshot) snapshot ??= Promise.resolve(read.snapshot);
    return {
      ...team,
      model: read.model,
      sha: read.sha,
      defaultBranch: read.defaultBranch,
      private: read.private,
      source: read.source,
      storybook: storybookUrl(read.model.config),
      client,
    };
  })();
  pending.catch(() => {
    pending = null; // a failed read is retried by the next call (Try again)
  });
  return pending;
}

/** The team's snapshot, whatever head it was computed from (adoption audits), null without one. Never rejects. */
export function loadTeamSnapshot(): Promise<RepoSnapshot | null> {
  snapshot ??= loadTeamData()
    .then((d) => readTeamSnapshot(d.client, { private: d.private }))
    .catch(() => null);
  return snapshot;
}

/** Forgets this page's load: the next loadTeamData reads the head again (Refresh, Try again). */
export function resetTeamData() {
  pending = null;
  snapshot = null;
}
