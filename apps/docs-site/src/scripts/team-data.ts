// Team pages (multi-team PR 3b): the one loader every team shell page reads its team from. The team comes from the
// address (/studio/<owner>/<repo>/...); the data, in this order: this browser's cache for the default branch head,
// the team's published snapshot when it was computed from that head (bridge-data branch, one raw read), else the
// repository itself, live from GitHub (scripts/repo-context.ts loadTeamModel). Signed in, reads carry the visitor's
// token (private repositories); signed out, public repositories are read anonymously.
//
// One load per page (memoized); Refresh and Try again start a new one. The snapshot is also read on its own for
// what only it carries (adoption audits), even when the model came from the cache.
//
// A team's Library (/library/<owner>/<repo>/..., multi-team PR 4a) reads the same way when signed in. Signed out, it
// reads the published snapshot first, straight from the raw host: no GitHub API call at all, so an anonymous reader
// never spends the 60 requests an hour GitHub gives an address. Only a team without a snapshot is read live.
import { loadRepoModel, parseSnapshot, SNAPSHOT_BRANCH, SNAPSHOT_FILE, SNAPSHOT_LLMS_FILE, SNAPSHOT_MAX_BYTES, snapshotSource, storybookUrl, type GitHubClient, type RepoModel, type RepoSnapshot } from '@bridge-ds/core';
import { getToken, hasWorkingToken, studioClient } from './github-session';
import { loadTeamModel, type SnapshotReader, type TeamModelSource } from './repo-context';
import { repoFromPath } from '../lib/team-path';
import { libraryFromPath } from '../lib/library-shells';
import type { ProductAudit } from '../lib/components-studio';
import { TEAM_PROGRESS_START, teamProgress, type TeamLoadEvent, type TeamProgress } from '../lib/load-progress';

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
  /**
   * When the snapshot read was published (its commit date, else when it was written). Set on a signed-out Library
   * read, which takes the snapshot as published without asking GitHub for the head.
   */
  published?: string;
}

/** The team in this page's address (a Studio or a Library team address), null off a team address. */
export function teamOfPage(): { owner: string; repo: string } | null {
  return typeof location === 'undefined' ? null : (repoFromPath(location.pathname) ?? libraryFromPath(location.pathname));
}

/** True on a team's Library page (/library/<owner>/<repo>/...). */
export const onLibraryPage = (): boolean => typeof location !== 'undefined' && libraryFromPath(location.pathname) !== null;

/**
 * The snapshot a team published, read anonymously from the raw host (no API quota), null when there is none, it is
 * not this repository's (a fork keeps its parent's bridge-data branch), too large or broken.
 */
async function readPublishedSnapshot(client: GitHubClient, team: { owner: string; repo: string }): Promise<RepoSnapshot | null> {
  const snap = await readTeamSnapshot(client, { private: false }).catch(() => null);
  if (!snap) return null;
  const same = snap.repo.owner.toLowerCase() === team.owner.toLowerCase() && snap.repo.name.toLowerCase() === team.repo.toLowerCase();
  return same ? snap : null;
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

// How far this page's load has gone (lib/load-progress.ts), for every view that waits on it
// (components/ds/studio/LoadProgress). Kept, so a view that mounts late starts from where the load is.
let progress: TeamProgress = TEAM_PROGRESS_START;
const listeners = new Set<(p: TeamProgress) => void>();
function report(event: TeamLoadEvent) {
  progress = teamProgress(progress, event);
  for (const fn of listeners) fn(progress);
}

/** Hears the load's progress, starting with where it is now. Returns the way to stop. */
export function onTeamProgress(fn: (p: TeamProgress) => void): () => void {
  listeners.add(fn);
  fn(progress);
  return () => listeners.delete(fn);
}

/**
 * How long "Ready" stays with a full bar before the page replaces it, after a read the visitor watched. A cache hit
 * never shows the progress, so it never waits.
 */
export const READY_HOLD_MS = 400;

/** The team of this page, read once per page. Rejects with the GitHub error (lib/team-load.ts teamFailure words it). */
export function loadTeamData(): Promise<TeamData> {
  pending ??= (async () => {
    const team = teamOfPage();
    if (!team) throw Object.assign(new Error('This page is not a team address.'), { status: 404 });
    const client = teamClient(team);
    if (onLibraryPage() && !client.canWrite) {
      const published = await readPublishedSnapshot(client, team);
      if (published) {
        report({ step: 'snapshot' });
        snapshot ??= Promise.resolve(published);
        const model = await loadRepoModel(snapshotSource(published));
        return {
          ...team,
          model,
          sha: published.sourceSha,
          defaultBranch: published.repo.branch,
          private: false,
          source: 'snapshot' as const,
          storybook: storybookUrl(model.config),
          client,
          published: published.committedAt ?? published.generatedAt,
        };
      }
    }
    let read: Awaited<ReturnType<typeof loadTeamModel>>;
    try {
      read = await loadTeamModel(client, { snapshot: readTeamSnapshot, onProgress: report });
    } catch (err) {
      // A guest past GitHub's hourly limit: the published snapshot still opens the team (it costs no API request),
      // as the Library reads it. The views that need GitHub say so on their own.
      const published = !client.canWrite && (err as { status?: number }).status === 429 ? await readPublishedSnapshot(client, team) : null;
      if (!published) throw err;
      report({ step: 'snapshot' });
      snapshot ??= Promise.resolve(published);
      const model = await loadRepoModel(snapshotSource(published));
      return { ...team, model, sha: published.sourceSha, defaultBranch: published.repo.branch, private: false, source: 'snapshot' as const, storybook: storybookUrl(model.config), client, published: published.committedAt ?? published.generatedAt };
    }
    if (read.snapshot) snapshot ??= Promise.resolve(read.snapshot);
    if (!read.cached) {
      report({ step: 'ready' });
      await new Promise((r) => setTimeout(r, READY_HOLD_MS));
    }
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

let usage: Promise<ProductAudit[] | null> | null = null;

/** Above this an audit report is not read (the snapshot's own cap: a report is far smaller). */
const AUDIT_MAX_CHARS = SNAPSHOT_MAX_BYTES;

/**
 * Which design system components each audited product renders, from the adoption reports the team's bridge-data
 * workflow publishes next to its snapshot (audits/<id>.json, `bridge snapshot --audit`): the "Used in" column of
 * Components. Public repositories: the raw host, no API quota. Private ones: the contents API with the visitor's
 * token. Null without a snapshot or a report. Never rejects; a report that cannot be read is left out.
 */
export function loadTeamProductUsage(): Promise<ProductAudit[] | null> {
  usage ??= Promise.all([loadTeamData(), loadTeamSnapshot()])
    .then(async ([d, snap]) => {
      if (!snap?.audits?.length) return null;
      const read = (path: string) => (d.private ? (d.client.canWrite ? d.client.getRawText(path, SNAPSHOT_BRANCH) : Promise.resolve(undefined)) : d.client.readRawFile(path, SNAPSHOT_BRANCH));
      const out = await Promise.all(
        snap.audits.map(async (a): Promise<ProductAudit | null> => {
          const text = await read(a.path).catch(() => undefined);
          if (!text || text.length > AUDIT_MAX_CHARS) return null;
          try {
            const ds = (JSON.parse(text) as { components?: { ds?: unknown } }).components?.ds;
            if (!ds || typeof ds !== 'object') return null;
            const components = Object.fromEntries(Object.entries(ds as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'));
            return { product: a.label?.trim() || a.id, components };
          } catch {
            return null;
          }
        }),
      );
      const found = out.filter((x): x is ProductAudit => x !== null);
      return found.length ? found : null;
    })
    .catch(() => null);
  return usage;
}

let llms: Promise<boolean> | null = null;

/**
 * Whether the team published an llms.txt next to its snapshot (`bridge snapshot` writes it; older snapshots lack it).
 * Public repositories: a HEAD on the raw host, no API quota. Private ones: one contents API read with the visitor's
 * token. Never rejects.
 */
export function loadTeamLlms(): Promise<boolean> {
  llms ??= loadTeamData()
    .then(async (d) => {
      if (d.private) return d.client.canWrite ? Boolean(await d.client.getRawText(SNAPSHOT_LLMS_FILE, SNAPSHOT_BRANCH)) : false;
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.repo)}/${SNAPSHOT_BRANCH}/${SNAPSHOT_LLMS_FILE}`;
      return (await fetch(url, { method: 'HEAD' })).ok;
    })
    .catch(() => false);
  return llms;
}

/** Forgets this page's load: the next loadTeamData reads the head again (Refresh, Try again). */
export function resetTeamData() {
  pending = null;
  snapshot = null;
  usage = null;
  llms = null;
}
