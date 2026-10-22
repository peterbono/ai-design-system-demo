// The team chip at the top of the Studio side nav (multi-team plan 7.1): the design system you are looking at, not your
// account. The owner's avatar, owner/repo in mono and what you can do on it as a badge ("Can edit", "Can suggest",
// "Guest"), then a chevron. On Bridge's own design system (the self-hosted site's own repository) it shows the Bridge
// mark and "Bridge" instead of the owner's photo, and a visitor without an account reads "Explore freely". On the
// sample team it reads "Acme Design" with its initials and a "Demo" tag (lib/demo.ts). It is the nav's
// first focus stop and a full-width target. The name stays on one line (ellipsis, the full name in its title). Its
// menu: Invite collaborators (signed in, the main action) or Sign in with GitHub (signed out: there is nobody to invite yet), then on the hosted site the teams opened in this browser (max 5) and "Create a new team" (secondary, muted),
// which opens a dialog over the page (NewTeamDialog.tsx) to connect another design system: the person keeps their
// place. Who you are stays at the bottom of the nav (components/GitHubAccount.astro): proximity keeps the team at the
// top and the account at the bottom.
// On the hosted site the menu opens with "Your team" (board EmptyB): the team you are on, or from the demo the
// workspace you came from (lib/start.ts), and "Try it" with Acme Design, the sample team. The browser workspace (no repository yet,
// pages/studio/workspace.astro) names itself on the chip: "Ann's workspace", kept in this browser.
// Mounted by layouts/Layout.astro on every Studio page, both modes: a self-hosted Studio is its own one team.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronsUpDown, Plus, UserPlus, X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import { chipIdentity, isDemoTeam, ownerAvatarUrl } from '../../../lib/access-view';
import { forgetRecentTeam, loadRecentTeams, noteTeamAccess } from '../../../lib/recent-teams';
import { studioHref, teamHref } from '../../../lib/team-path';
import { ghButton } from '../../../lib/gh-wording';
import NewTeamDialog, { type TeamAccessCheck } from './NewTeamDialog';
import { GitHubMark } from './brand-icons';
import { Drawing } from './Drawing';
import { shortName } from '../../../lib/home-model';
import { demoTeamName } from '../../../lib/demo';
import { DEMO_HOME, MENU_WORDS, ownTeams, WORKSPACE_HOME, WORKSPACE_WORDS, workspaceHref, workspaceName, type StartFacts } from '../../../lib/start';

export interface TeamChipProps {
  /** owner/repo known at build time (self-hosted). Null on a team shell: read from the address. */
  repo?: string | null;
  /** The hosted site: offer the other teams of this browser and "Create a new team". */
  launcher?: boolean;
  /** The browser workspace (no repository): the chip names the workspace. */
  workspace?: boolean;
}

const others = (list: readonly string[], team: string | null) => list.filter((t) => t.toLowerCase() !== (team ?? '').toLowerCase());

/** One team in the "Your team" and "Try it" sections: its mark, its name and one muted line, the whole row the target. */
function TeamItem({ mark, title, line, href, current, mono }: { mark: ReactElement; title: string; line: string; href: string; current?: boolean; mono?: boolean }) {
  return (
    <MenuItem className="tc-team" data-current={current ? '' : undefined} label={title} icon={mark} onClick={() => location.assign(href)}>
      <span className="tc-team-text">
        <span className={mono ? 'tc-team-name mono' : 'tc-team-name'}>{title}</span>
        <span className="tc-team-line">{line}</span>
      </span>
    </MenuItem>
  );
}

/** The sample team's mark: its initials, like any team without a photo. */
const SampleMark = ({ size = 'xs' }: { size?: 'xs' | 'sm' }) => <Avatar name={MENU_WORDS.demo} size={size} decorative className={size === 'sm' ? 'tc-avatar' : undefined} />;

const DemoMark = () => (
  <span className="tc-mark" aria-hidden="true">
    <Drawing name="logo" width={18} />
  </span>
);

export default function TeamChip({ repo: built = null, launcher = false, workspace = false }: TeamChipProps) {
  const [name, setName] = useState<string | null>(workspace ? null : built);
  // Who is signed in (the workspace is named after them) and what this browser remembers (lib/start.ts).
  const [viewerName, setViewerName] = useState<string | null>(null);
  const [facts, setFacts] = useState<StartFacts | null>(null);
  const [access, setAccess] = useState<RepoAccessState | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [hosted, setHosted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [signInApp, setSignInApp] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ repoContext }, session] = await Promise.all([import('../../../scripts/repo-context'), import('../../../scripts/github-session')]);
      if (!live) return;
      const r = repoContext();
      const team = workspace ? null : `${r.owner}/${r.repo}`;
      setName(team);
      setHosted(r.hosted);
      // The stored list, cleaned of placeholders. This team joins it only once its page read the repository (below).
      setRecent(others(loadRecentTeams(), team));
      setSignInApp(session.prefersSignIn());
      // This browser only: no GitHub call (the demo stays free for guests).
      const { startFacts } = await import('../../../scripts/start');
      if (live) setFacts(startFacts());
      session.initGitHubConnect((v) => {
        setSignedIn(Boolean(v));
        setViewerName(v ? (shortName(v.name) ?? v.login) : null);
        if (!v) setAccess(r.hosted ? (session.currentAccess()?.state ?? null) : null);
      });
      session.onAccess((a) => setAccess(a?.state ?? null));
    })();
    return () => {
      live = false;
    };
  }, []);

  // A team page remembers itself for the chip menu of the next one, only once GitHub showed it the repository: never
  // for an address someone typed that leads nowhere. A 404 drops it from the list.
  useEffect(() => {
    if (!hosted || !name || !access) return;
    setRecent(others(noteTeamAccess(name, access), name));
  }, [hosted, name, access]);

  const forget = (team: string) => setRecent(others(forgetRecentTeam(team), name));

  const [owner = ''] = (name ?? '').split('/');
  const wsName = workspaceName(viewerName);
  const wsLine = facts?.storybook ? 'Storybook connected' : MENU_WORDS.workspaceLine;
  const chip = workspace
    ? { kind: 'workspace' as const, name: wsName, title: `${wsName}, ${WORKSPACE_WORDS.kept.toLowerCase()}`, badge: { label: facts?.storybook ? 'Storybook' : WORKSPACE_WORDS.notConnected, tone: 'neutral' as const } }
    : chipIdentity(name, { demo: isDemoTeam(name, hosted), state: access, signedIn });
  const badge = chip.badge;
  const offerTeams = launcher || hosted;
  // "Your team": the workspace or team you are on; from the demo, the workspace you came from (none: no section).
  const yours = (() => {
    if (!offerTeams) return null;
    if (chip.kind === 'workspace') return { key: 'ws', mark: <Avatar name={viewerName ?? 'Workspace'} size="xs" decorative />, title: wsName, line: wsLine, href: WORKSPACE_HOME, current: true, mono: false };
    if (chip.kind === 'team' && name) return { key: name, mark: <Avatar name={owner} src={ownerAvatarUrl(owner, 32)} size="xs" decorative />, title: name, line: badge.label, href: teamHref(owner, name.split('/')[1] ?? '', null), current: true, mono: true };
    if (!facts) return null;
    const [team] = ownTeams(facts.recent);
    const href = workspaceHref(facts);
    if (!href) return null;
    if (team) {
      const [o = ''] = team.split('/');
      return { key: team, mark: <Avatar name={o} src={ownerAvatarUrl(o, 32)} size="xs" decorative />, title: team, line: 'Your most recent team', href, current: false, mono: true };
    }
    return { key: 'ws', mark: <Avatar name={viewerName ?? 'Workspace'} size="xs" decorative />, title: wsName, line: wsLine, href, current: false, mono: false };
  })();
  const listed = recent.filter((t) => t.toLowerCase() !== yours?.key.toLowerCase());
  const createItem = (
    // A dialog over the page: connect another design system by its repository, without leaving this one.
    <MenuItem icon={Plus} className="tc-create" onClick={() => setCreating(true)}>
      Create a new team
    </MenuItem>
  );
  const go = (href: string) => location.assign(href);
  // The dialog's live line: the session's access resolver (cached per repository; signed out, one anonymous read).
  const check = useCallback<TeamAccessCheck>(async (o, r) => {
    const { resolveAccess } = await import('../../../scripts/github-session');
    const a = await resolveAccess({ owner: o, repo: r }, { anonymous: true, probe: true });
    return a && { state: a.state, repoAdmin: a.repoAdmin };
  }, []);
  const label = name || workspace ? `${chip.title}, ${badge.label}. Team menu` : 'Team menu';
  // The menu's parts in order, a separator between two: the teams to switch to (board EmptyB), what to do here, the
  // recent teams, then "Create a new team" once signed in (signed out it comes first among the actions).
  const blocks: { key: string; node: ReactNode }[] = [];
  const teams = (
    <>
      {yours && (
        <MenuGroup label={MENU_WORDS.yourTeam}>
          <TeamItem mark={yours.mark} title={yours.title} line={yours.line} href={yours.href} current={yours.current} mono={yours.mono} />
        </MenuGroup>
      )}
      {offerTeams && chip.kind !== 'demo' && (
        <MenuGroup label={MENU_WORDS.tryIt}>
          <TeamItem mark={<SampleMark />} title={MENU_WORDS.demo} line={MENU_WORDS.demoLine} href={DEMO_HOME} />
        </MenuGroup>
      )}
    </>
  );
  if (yours || (offerTeams && chip.kind !== 'demo')) blocks.push({ key: 'teams', node: teams });
  if (!signedIn)
    blocks.push({
      key: 'actions',
      node: (
        <>
          {/* Signed out the next steps come first: start a team of your own, or sign in to do more here. */}
          {offerTeams && createItem}
          {/* The shared session listens for these attributes (scripts/github-session.ts): sign in, or the dialog. */}
          <MenuItem icon={GitHubMark} data-gh-open="" data-gh-signin="">
            {ghButton(signInApp)}
          </MenuItem>
        </>
      ),
    });
  // Inviting needs a team link: the browser workspace has no repository yet.
  else if (chip.kind !== 'workspace')
    blocks.push({
      key: 'actions',
      node: (
        <MenuItem icon={UserPlus} className="tc-invite" onClick={() => go(studioHref('?setup=team'))}>
          Invite collaborators
        </MenuItem>
      ),
    });
  if (offerTeams && listed.length > 0)
    blocks.push({
      key: 'recent',
      node: (
        <MenuGroup label="Recent teams">
          {listed.map((t) => {
            const [o = '', r = ''] = t.split('/');
            // A demo design system goes by its name (Bridge, Acme Design), never its repository.
            const demo = isDemoTeam(t);
            const shown = demo ? demoTeamName(t) : t;
            // Two sibling menu items on one row (proximity), never a button inside an item: arrow keys reach the team,
            // then its remove action, and the menu stays open so the list updates in place.
            return (
              <div key={t} className="tc-recent">
                <MenuItem className="tc-recent-open" label={shown} icon={<Avatar name={demo ? shown : o} src={demo ? undefined : ownerAvatarUrl(o, 32)} size="xs" decorative />} onClick={() => go(teamHref(o, r, null))}>
                  <span className={demo ? undefined : 'mono'}>{shown}</span>
                </MenuItem>
                <MenuItem
                  className="tc-recent-remove"
                  icon={X}
                  label={`Remove ${shown}`}
                  aria-label={`Remove ${shown} from recent teams`}
                  title="Remove from recent teams"
                  closeOnClick={false}
                  onClick={() => forget(t)}
                />
              </div>
            );
          })}
        </MenuGroup>
      ),
    });
  if (offerTeams && signedIn) blocks.push({ key: 'create', node: createItem });
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" fullWidth className="tc-trigger" aria-label={label} />}
        >
          {chip.kind === 'demo' && chip.sample ? (
            <SampleMark size="sm" />
          ) : chip.kind === 'demo' ? (
            <DemoMark />
          ) : chip.kind === 'workspace' ? (
            <Avatar name={viewerName ?? 'Workspace'} size="sm" decorative className="tc-avatar" />
          ) : (
            <Avatar name={owner || 'Team'} src={owner ? ownerAvatarUrl(owner) : undefined} size="sm" decorative className="tc-avatar" />
          )}
          <span className="tc-text">
            <span className={chip.kind === 'team' ? 'tc-name mono' : 'tc-name'} title={chip.title}>
              {chip.name}
            </span>
            <Badge size="sm" tone={badge.tone} dot className="tc-badge">
              {badge.label}
            </Badge>
          </span>
          <Icon icon={ChevronsUpDown} size="sm" className="tc-chev" />
        </MenuTrigger>
        <MenuContent className="tc-menu" align="start">
          {blocks.map((b, i) => (
            <Fragment key={b.key}>
              {i > 0 && <MenuSeparator />}
              {b.node}
            </Fragment>
          ))}
        </MenuContent>
      </Menu>
      {offerTeams && <NewTeamDialog open={creating} onOpenChange={setCreating} signedIn={signedIn} check={check} />}
    </>
  );
}

