// Team pages (multi-team PR 3b): what every team shell page shares while it reads the team's repository.
//   useTeamData()     the team of this page (scripts/team-data.ts), with retry and refresh
//   TeamSourceNote    one line under the title: the commit it was read at, where from, and Refresh
//   TeamLoadError     a calm full-width state that says what went wrong and the one way out (Try again)
//   TeamSkeleton      rows of skeletons in the page's own shape while it loads
// Repo content never reaches HTML here: React text nodes only.
import { useCallback, useEffect, useState } from 'react';
import { CloudOff, FileWarning, RefreshCw, SearchX, Timer } from 'lucide-react';
import { Button, EmptyState, IconButton, Link, Skeleton } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { loadTeamData, resetTeamData, teamOfPage, type TeamData } from '../../../scripts/team-data';
import { commitUrl, SNAPSHOT_TEMPLATE_URL, sourceLine, teamFailure, type TeamFailure } from '../../../lib/team-load';

export type TeamLoad = { status: 'loading' } | { status: 'ready'; data: TeamData; refreshing: boolean } | { status: 'error'; failure: TeamFailure };

/** The team of this page, read once; `retry` reads it again from GitHub (head, then cache, snapshot or live). */
export function useTeamData(): { load: TeamLoad; retry: () => void } {
  const [load, setLoad] = useState<TeamLoad>({ status: 'loading' });
  const [run, setRun] = useState(0);
  useEffect(() => {
    let live = true;
    loadTeamData().then(
      (data) => live && setLoad({ status: 'ready', data, refreshing: false }),
      (err: unknown) => {
        if (!live) return;
        const team = teamOfPage();
        setLoad({ status: 'error', failure: teamFailure(err, team ? `${team.owner}/${team.repo}` : 'this repository') });
      },
    );
    return () => {
      live = false;
    };
  }, [run]);
  const retry = useCallback(() => {
    resetTeamData();
    // Keep what is on screen while a refresh reads the head again; an error goes back to loading.
    setLoad((l) => (l.status === 'ready' ? { ...l, refreshing: true } : { status: 'loading' }));
    setRun((n) => n + 1);
  }, []);
  return { load, retry };
}

/** "Read at a1b2c3d on main, from the Bridge snapshot." with the commit linked, and Refresh at the end. */
export function TeamSourceNote({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  const line = sourceLine({ sha: data.sha, branch: data.defaultBranch, source: data.source });
  const sha = data.sha.slice(0, 7);
  const [before, after] = line.split(sha) as [string, string];
  return (
    <p className="tp-source" aria-live="polite">
      <span>
        {before}
        <Link href={commitUrl(data.owner, data.repo, data.sha)} target="_blank" rel="noopener noreferrer" className="mono">
          {sha}
        </Link>
        {after}
      </span>
      <IconButton icon={RefreshCw} label="Read again from GitHub" size="sm" variant="ghost" loading={refreshing} onClick={onRefresh} />
    </p>
  );
}

const FAILURE_ICON = { 'rate-limit': Timer, 'not-found': SearchX, 'too-large': FileWarning, network: CloudOff, unknown: CloudOff } as const;

/** What went wrong, and Try again. A repository too large to read also gets the snapshot workflow to copy. */
export function TeamLoadError({ failure, onRetry }: { failure: TeamFailure; onRetry: () => void }) {
  return (
    <EmptyState
      className="tp-error"
      size="lg"
      headingLevel={2}
      icon={FAILURE_ICON[failure.kind]}
      title={failure.title}
      description={failure.body}
      actions={
        <>
          <Button variant="primary" iconStart={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
          {failure.kind === 'too-large' && (
            <ButtonLink variant="secondary" href={SNAPSHOT_TEMPLATE_URL} target="_blank" rel="noopener noreferrer">
              Get the snapshot workflow
            </ButtonLink>
          )}
        </>
      }
    />
  );
}

/** Skeleton rows in the page's own shape: an opener band, then `rows` list rows. */
export function TeamSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div className="tp-skel" aria-busy="true" aria-label={label}>
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="rect" className="tp-skel-band" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} variant="rect" className="tp-skel-row" />
      ))}
    </div>
  );
}
