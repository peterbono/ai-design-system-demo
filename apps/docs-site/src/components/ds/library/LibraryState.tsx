// A team's Library (multi-team PR 4a): what its four pages share. The page header (the Library's Harbor zone, as on
// Bridge's own Library), the line that says where the page was read from, and the load and error states. Loading
// reuses the team pages' reader and progress (components/ds/studio/TeamState.tsx).
// Repo content never reaches HTML here: React text nodes only.
import { useEffect, useState, type ReactNode } from 'react';
import { CloudOff, FileWarning, RefreshCw, SearchX, Timer } from 'lucide-react';
import { Button, EmptyState, IconButton, Link } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from '../studio/brand-icons';
import { Drawing } from '../studio/Drawing';
import { TeamLoadProgress, TeamSourceNote, useTeamData } from '../studio/TeamState';
import { commitUrl, SNAPSHOT_TEMPLATE_URL, type TeamFailure } from '../../../lib/team-load';
import { publishedLine } from '../../../lib/library/published';
import { teamHref } from '../../../lib/team-path';
import { teamOfPage, type TeamData } from '../../../scripts/team-data';
import type { IllustrationName } from '../../../brand/illustrations';
import LibraryGate, { emailFallback, useLibraryGate } from './LibraryGate';
import '../../../styles/library-team.css';

/**
 * The team in the address, after mount: the server renders the shell without a team, so the first client render
 * must match it (no hydration mismatch), then the team fills in.
 */
export function usePageTeam(): { owner: string; repo: string } | null {
  const [team, setTeam] = useState<{ owner: string; repo: string } | null>(null);
  useEffect(() => setTeam(teamOfPage()), []);
  return team;
}

/** The Library section header: title, one lead, an optional drawing (the Harbor zone of the page). */
export function LibraryZone({ title, lead, art, actions }: { title: ReactNode; lead: ReactNode; art?: IllustrationName; actions?: ReactNode }) {
  return (
    <section className="zone lib-zone">
      <header className="lib-zone-text lib-page-header">
        <h1 className="lib-title">{title}</h1>
        <div className="lib-lead">
          <p>{lead}</p>
        </div>
        {actions && <div className="lib-actions">{actions}</div>}
      </header>
      {art && <Drawing name={art} width={112} className="lib-zone-art" />}
    </section>
  );
}

/** Where the page was read from: "Published Oct 20, 2026 from a1b2c3d on main." for a snapshot read as published,
 * else the team pages' line ("Read at a1b2c3d on main, live from GitHub."). Refresh at the end. */
export function LibrarySourceNote({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  const line = publishedLine({ published: data.published, sha: data.sha, branch: data.defaultBranch });
  if (!line) return <TeamSourceNote data={data} refreshing={refreshing} onRefresh={onRefresh} />;
  const sha = data.sha.slice(0, 7);
  const [before, after] = line.split(sha) as [string, string];
  return (
    <p className="tp-source ltm-source" aria-live="polite">
      <span>
        {before}
        <Link href={commitUrl(data.owner, data.repo, data.sha)} target="_blank" rel="noopener noreferrer" className="mono">
          {sha}
        </Link>
        {after}
      </span>
      <IconButton icon={RefreshCw} label="Read the published Library again" size="sm" variant="ghost" loading={refreshing} onClick={onRefresh} />
    </p>
  );
}

const FAILURE_ICON = { 'rate-limit': Timer, 'not-found': SearchX, 'too-large': FileWarning, network: CloudOff, unknown: CloudOff } as const;

/**
 * What went wrong, and Try again. A repository GitHub does not show this visitor (missing, or private) offers its
 * Studio, where they sign in; a repository too large to read live offers the snapshot workflow.
 */
export function LibraryLoadError({ failure, onRetry }: { failure: TeamFailure; onRetry: () => void }) {
  const team = usePageTeam();
  return (
    <EmptyState
      className="tp-error"
      size="lg"
      headingLevel={2}
      icon={FAILURE_ICON[failure.kind]}
      title={failure.title}
      description={failure.kind === 'not-found' ? 'GitHub says this repository does not exist, or it is private. Check the address. If it is private, sign in to its Studio with a GitHub account that can see it, then come back.' : failure.body}
      actions={
        <>
          {failure.kind === 'not-found' && team ? (
            <ButtonLink variant="primary" href={teamHref(team.owner, team.repo, null)} iconStart={GitHubMark}>
              Sign in from Studio
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

/**
 * A Library page. First the gate (Settings, Library access; LibraryGate.tsx): a team that opened its Library to work
 * emails or to its team only shows that screen instead, until the reader is in. Then its header at once (`header` gets
 * the data once read, null before), the progress, the error, or `ready` with the team's data.
 */
export function LibraryPage(props: { label: string; header: (data: TeamData | null) => ReactNode; ready: (data: TeamData, refresh: { refreshing: boolean; onRefresh: () => void }) => ReactNode }) {
  const team = usePageTeam();
  const gate = useLibraryGate(team);
  if (gate.step === 'checking') return (
    <div className="ltm">
      <TeamLoadProgress label={props.label} />
    </div>
  );
  if (gate.step !== 'open') return team ? (
    <div className="ltm">
      <LibraryGate team={team} state={gate} />
    </div>
  ) : null;
  return <LibraryRead {...props} fallback={emailFallback(gate.answer)} />;
}

function LibraryRead({
  label,
  header,
  ready,
  fallback,
}: {
  label: string;
  header: (data: TeamData | null) => ReactNode;
  ready: (data: TeamData, refresh: { refreshing: boolean; onRefresh: () => void }) => ReactNode;
  /** The work email domains to offer when GitHub does not show this signed-in visitor the repository. */
  fallback: string[] | null;
}) {
  const { load, retry } = useTeamData();
  const team = usePageTeam();
  // Signed in with GitHub but not on the team: the Library still opens with a work email when its team allows it.
  if (load.status === 'error' && load.failure.kind === 'not-found' && fallback && team) return <LibraryGate team={team} state={{ step: 'email', domains: fallback }} />;
  return (
    <div className="ltm">
      {header(load.status === 'ready' ? load.data : null)}
      {load.status === 'loading' && <TeamLoadProgress label={label} />}
      {load.status === 'error' && <LibraryLoadError failure={load.failure} onRetry={retry} />}
      {load.status === 'ready' && ready(load.data, { refreshing: load.refreshing, onRefresh: retry })}
    </div>
  );
}
