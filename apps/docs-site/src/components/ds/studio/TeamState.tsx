// Team pages (multi-team PR 3b): what every team shell page shares while it reads the team's repository.
//   useTeamData()     the team of this page (scripts/team-data.ts), with retry and refresh
//   TeamSourceNote    one line under the title: the commit it was read at, where from, and Refresh
//   TeamLoadError     a calm full-width state that says what went wrong and the one way out (Try again)
//   TeamLoadProgress  how far the read has gone (LoadProgress), once it is not instant
// Repo content never reaches HTML here: React text nodes only.
import { useCallback, useEffect, useState } from 'react';
import { CloudOff, FileWarning, LogIn, RefreshCw, SearchX, Timer } from 'lucide-react';
import { signInHref } from '../../../lib/account';
import { Button, EmptyState, IconButton, Link } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { loadTeamData, onTeamProgress, resetTeamData, teamOfPage, type TeamData } from '../../../scripts/team-data';
import { LoadProgress } from './LoadProgress';
import { TEAM_PROGRESS_START, teamProgressView, type TeamProgress } from '../../../lib/load-progress';
import { commitUrl, SNAPSHOT_TEMPLATE_URL, sourceLine, teamFailure, type TeamFailure } from '../../../lib/team-load';
import { isDemoRepo } from '../../../lib/demo';

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

/**
 * "Read at a1b2c3d on main, from the Bridge snapshot." with the commit linked, and Refresh at the end. Not on a demo
 * team: its banner already says the data is a sample, and commits mean nothing to a designer looking around.
 */
export function TeamSourceNote({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  if (isDemoRepo(`${data.owner}/${data.repo}`)) return null;
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

const FAILURE_ICON = { 'rate-limit': Timer, 'not-found': SearchX, 'too-large': FileWarning, network: CloudOff, 'signed-out': LogIn, unknown: CloudOff } as const;

/** The sign-in screen, back to this page once signed in again. */
export const signInHereHref = () => signInHref(typeof location === 'undefined' ? null : location.pathname + location.search + location.hash);

/**
 * What went wrong, and Try again (Sign in when the session ended). A repository too large to read also gets the
 * snapshot workflow to copy. `compact`: under content the page shows anyway (Home's greeting and join requests), so
 * the failure of the design system read is one calm block among others, not the whole page.
 */
export function TeamLoadError({ failure, onRetry, compact = false }: { failure: TeamFailure; onRetry: () => void; compact?: boolean }) {
  return (
    <EmptyState
      className="tp-error"
      size={compact ? 'md' : 'lg'}
      headingLevel={2}
      icon={FAILURE_ICON[failure.kind]}
      title={failure.title}
      description={failure.body}
      actions={
        <>
          {failure.kind === 'signed-out' ? (
            <ButtonLink variant="primary" iconStart={LogIn} href={signInHereHref()}>
              Sign in
            </ButtonLink>
          ) : (
            <Button variant="primary" iconStart={RefreshCw} onClick={onRetry}>
              Try again
            </Button>
          )}
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

/** A read that settles within this is never shown (a cache hit costs two quick calls): no flash of progress. */
const SHOW_AFTER_MS = 300;

/** The team load of this page as a LoadProgress, once it is not instant. Until then, a quiet busy region. */
export function TeamLoadProgress({ label }: { label: string }) {
  const [p, setP] = useState<TeamProgress>(TEAM_PROGRESS_START);
  const [waited, setWaited] = useState(false);
  useEffect(() => onTeamProgress(setP), []);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  const shown = p.via !== null || (waited && p.step !== 'cache');
  if (!shown) return <div className="lp-wait" aria-busy="true" aria-label={label} />;
  return <LoadProgress view={teamProgressView(p)} label={label} />;
}
