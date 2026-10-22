// The team chip at the top of the Studio side nav (multi-team plan 7.1): the design system you are looking at, not your
// account. The owner's avatar, the team's name (lib/demo.ts teamDisplayName: bridge.config.json `name` once read, else
// the repository name in words; owner/repo in its title) and what you can do on it as a badge ("Can edit", "Can suggest",
// "Guest"), then a chevron. On Bridge's own design system (the self-hosted site's own repository) it shows the Bridge
// mark and "Bridge" instead of the owner's photo, and a visitor without an account reads "Explore freely". On the
// sample team it reads "Acme Design" with its initials and a "Demo" tag (lib/demo.ts). It is the nav's
// first focus stop and a full-width target. The name stays on one line (ellipsis, the full name in its title). Its
// menu: Invite collaborators (signed in, the main action; it opens InviteDialog over the page, and on the sample team it is
// there for everyone, with its sample people) or Sign in with GitHub (signed out), then on the hosted site the teams opened in this browser (max 5) and "Create a new team" (secondary, muted),
// which opens a dialog over the page (NewTeamDialog.tsx) to connect another design system: the person keeps their
// place. Who you are stays at the bottom of the nav (components/GitHubAccount.astro): proximity keeps the team at the
// top and the account at the bottom.
// On the hosted site the menu opens with "Your teams" (board EmptyB): the teams the signed-in person belongs to (their
// role remembered in this browser), the one they are on first with a check and their role; the empty browser
// workspace only while they are in it or have no team of their own (lib/start.ts); and "Try it" with Acme Design, the
// sample team. The browser workspace (no repository yet,
// pages/studio/workspace.astro) names itself on the chip: "Ann's workspace", kept in this browser.
// Mounted by layouts/Layout.astro on every Studio page, both modes: a self-hosted Studio is its own one team.
import { Fragment, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Check, ChevronsUpDown, LogIn, Plus, UserPlus, X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import { chipIdentity, isDemoTeam, memberRole, ownerAvatarUrl, recentTeamName } from '../../../lib/access-view';
import { forgetRecentTeam, loadRecentTeams, loadTeamNames, loadTeamRoles, noteTeamAccess, noteTeamName, noteTeamRole } from '../../../lib/recent-teams';
import { teamHref } from '../../../lib/team-path';
import { ghButton } from '../../../lib/gh-wording';
import { ACCOUNT_WORDS, roleWord, signInHref } from '../../../lib/account';
import NewTeamDialog, { type TeamAccessCheck } from './NewTeamDialog';
import { useAccount } from '../account/AccountMenu';

// Loaded on first use: most pages never open it.
const InviteDialog = lazy(() => import('./InviteDialog'));
import { GitHubMark } from './brand-icons';
import { Drawing } from './Drawing';
import { shortName } from '../../../lib/home-model';
import { isSampleTeam } from '../../../lib/demo';
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

/** One team in "Your teams" and "Try it": its mark, its name, one muted line or the person's role as a tag, and a check on the one you are on. */
function TeamItem({ mark, title, line, role, href, current }: { mark: ReactElement; title: string; line?: string; role?: string; href: string; current?: boolean }) {
  return (
    <MenuItem className="tc-team" data-current={current ? '' : undefined} label={title} icon={mark} onClick={() => location.assign(href)}>
      <span className="tc-team-text">
        <span className="tc-team-name">{title}</span>
        {line && <span className="tc-team-line">{line}</span>}
      </span>
      {role && (
        <Badge size="sm" tone="neutral" className="tc-team-role">
          {role}
        </Badge>
      )}
      {current && <Icon icon={Check} size="sm" className="tc-team-check" aria-label="Current team" />}
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
  const [ghSignedIn, setSignedIn] = useState(false);
  // A Bridge account (GET /api/account): its teams join "Your teams", each with its role.
  const account = useAccount();
  const signedIn = ghSignedIn || Boolean(account);
  const [recent, setRecent] = useState<string[]>([]);
  const [hosted, setHosted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invitedOnce, setInvitedOnce] = useState(false);
  const [signInApp, setSignInApp] = useState(false);
  // The team's own name (bridge.config.json `name`) once its settings are read, and the names of the recent teams.
  const [cfg, setCfg] = useState<{ read: boolean; name: string | null }>({ read: false, name: null });
  const [names, setNames] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ repoContext, siteConfig }, session] = await Promise.all([import('../../../scripts/repo-context'), import('../../../scripts/github-session')]);
      if (!live) return;
      const r = repoContext();
      const team = workspace ? null : `${r.owner}/${r.repo}`;
      setName(team);
      setHosted(r.hosted);
      // The stored list, cleaned of placeholders. This team joins it only once its page read the repository (below).
      setRecent(others(loadRecentTeams(), team));
      setNames(loadTeamNames());
      setRoles(loadTeamRoles());
      const readName = () => {
        if (!live) return document.removeEventListener('bridge:team-model', readName);
        const c = siteConfig();
        // A team shell knows its settings once GitHub answered (bridge:team-model); the self-hosted page from the start.
        setCfg({ read: Object.keys(c).length > 0, name: c.name?.trim() || null });
      };
      readName();
      document.addEventListener('bridge:team-model', readName);
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

  // The name it goes by joins the recent teams' names once its settings were read.
  useEffect(() => {
    if (!hosted || !name || !cfg.read) return;
    setNames(noteTeamName(name, cfg.name));
  }, [hosted, name, cfg, recent]);

  // Signed in, the person's role here: a team they belong to joins "Your teams" on the next pages. Signed out says nothing.
  useEffect(() => {
    if (!hosted || !name || !access || !ghSignedIn) return;
    setRoles(noteTeamRole(name, memberRole(access, ghSignedIn)));
  }, [hosted, name, access, ghSignedIn, recent]);

  const forget = (team: string) => setRecent(others(forgetRecentTeam(team), name));

  const [owner = ''] = (name ?? '').split('/');
  const wsName = workspaceName(viewerName);
  const wsLine = facts?.storybook ? 'Storybook connected' : MENU_WORDS.workspaceLine;
  const chip = workspace
    ? { kind: 'workspace' as const, name: wsName, title: `${wsName}, ${WORKSPACE_WORDS.kept.toLowerCase()}`, badge: { label: facts?.storybook ? 'Storybook' : WORKSPACE_WORDS.notConnected, tone: 'neutral' as const } }
    : chipIdentity(name, { demo: isDemoTeam(name, hosted), state: access, signedIn: ghSignedIn, name: cfg.name });
  const badge = chip.badge;
  const offerTeams = launcher || hosted;
  // "Your teams": the teams the signed-in person belongs to (their role known in this browser), the one you are on first
  // with a check and your role. The browser workspace shows only while you are in it or have no team of your own; from
  // the sample team or a team you are a guest of, the place you came from. The sample team stays under "Try it".
  type TeamRow = { key: string; mark: ReactElement; title: string; line?: string; role?: string; href: string; current: boolean };
  const wsMark = <Avatar name={viewerName ?? 'Workspace'} size="xs" decorative />;
  const teamMark = (t: string) => (isDemoTeam(t) && !isSampleTeam(t) ? <DemoMark /> : <Avatar name={t.split('/')[0] ?? ''} src={ownerAvatarUrl(t.split('/')[0] ?? '', 32)} size="xs" decorative />);
  const teamRowOf = (t: string, current: boolean, role?: string): TeamRow => {
    const [o = '', r = ''] = t.split('/');
    return { key: t, mark: teamMark(t), title: current ? chip.name : recentTeamName(t, names), role, href: teamHref(o, r, null), current };
  };
  const yours: TeamRow[] = (() => {
    if (!offerTeams) return [];
    const rows: TeamRow[] = [];
    if (chip.kind === 'workspace') rows.push({ key: 'ws', mark: wsMark, title: wsName, line: wsLine, href: WORKSPACE_HOME, current: true });
    const here = chip.kind !== 'workspace' && name && !isSampleTeam(name) ? name : null;
    const mine = (t: string) => account?.teams.find((x) => x.repo.toLowerCase() === t.toLowerCase());
    const here_ = here ? mine(here) : undefined;
    const role = memberRole(access, ghSignedIn) ?? (here_ ? roleWord(here_.role) : null);
    // The team you are on: yours when you belong to it; a guest still sees where they are on someone else's team.
    if (here && (role || chip.kind === 'team')) rows.push(teamRowOf(here, true, role ?? badge.label));
    for (const t of recent) {
      const r = roles[t.toLowerCase()];
      if (r && !isSampleTeam(t) && t.toLowerCase() !== here?.toLowerCase()) rows.push(teamRowOf(t, false, r));
    }
    // The account's teams, wherever this browser has not opened them yet, each to its own space.
    for (const t of account?.teams ?? []) {
      if (isSampleTeam(t.repo) || rows.some((x) => x.key.toLowerCase() === t.repo.toLowerCase())) continue;
      rows.push({ ...teamRowOf(t.repo, false, roleWord(t.role)), ...(t.name ? { title: t.name } : {}) });
    }
    if (rows.length || !facts) return rows;
    // No team of your own here: the place you came from, a team you opened or the browser workspace.
    const [team] = ownTeams(facts.recent);
    const href = workspaceHref(facts);
    if (!href) return rows;
    if (team) return [{ ...teamRowOf(team, false), line: 'Your most recent team' }];
    return [{ key: 'ws', mark: wsMark, title: wsName, line: wsLine, href, current: false }];
  })();
  const yourKeys = new Set(yours.map((y) => y.key.toLowerCase()));
  const listed = recent.filter((t) => !yourKeys.has(t.toLowerCase()));
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
      {yours.length > 0 && (
        <MenuGroup label={MENU_WORDS.yourTeams}>
          {yours.map((y) => (
            <TeamItem key={y.key} mark={y.mark} title={y.title} line={y.line} role={y.role} href={y.href} current={y.current} />
          ))}
        </MenuGroup>
      )}
      {offerTeams && chip.kind !== 'demo' && (
        <MenuGroup label={MENU_WORDS.tryIt}>
          <TeamItem mark={<SampleMark />} title={MENU_WORDS.demo} line={MENU_WORDS.demoLine} href={DEMO_HOME} />
        </MenuGroup>
      )}
    </>
  );
  if (yours.length > 0 || (offerTeams && chip.kind !== 'demo')) blocks.push({ key: 'teams', node: teams });
  // Invite collaborators opens the dialog over the page (board I1). The sample team shows it to everyone, with its
  // sample people: sending opens the demo dialog. The browser workspace has no repository, so nobody to invite yet.
  const sample = chip.kind === 'demo' && Boolean(chip.sample) && isSampleTeam(name);
  const inviteItem = (
    <MenuItem
      icon={UserPlus}
      className="tc-invite"
      onClick={() => {
        setInvitedOnce(true);
        setInviting(true);
      }}
    >
      Invite collaborators
    </MenuItem>
  );
  if (!signedIn)
    blocks.push({
      key: 'actions',
      node: (
        <>
          {sample && inviteItem}
          {/* Signed out the next steps come first: start a team of your own, or sign in to do more here. */}
          {offerTeams && createItem}
          {/* With a GitHub App, the one sign-in screen of Bridge (back here afterwards); else the token dialog. */}
          {signInApp ? (
            <MenuItem icon={LogIn} onClick={() => go(signInHref(location.pathname + location.search + location.hash))}>
              {ACCOUNT_WORDS.signInShort}
            </MenuItem>
          ) : (
            <MenuItem icon={GitHubMark} data-gh-open="">
              {ghButton(signInApp)}
            </MenuItem>
          )}
        </>
      ),
    });
  else if (chip.kind !== 'workspace') blocks.push({ key: 'actions', node: inviteItem });
  if (offerTeams && listed.length > 0)
    blocks.push({
      key: 'recent',
      node: (
        <MenuGroup label="Recent teams">
          {listed.map((t) => {
            const [o = '', r = ''] = t.split('/');
            // Every team goes by its name (lib/demo.ts teamDisplayName), never its repository.
            const demo = isDemoTeam(t);
            const shown = recentTeamName(t, names);
            // Two sibling menu items on one row (proximity), never a button inside an item: arrow keys reach the team,
            // then its remove action, and the menu stays open so the list updates in place.
            return (
              <div key={t} className="tc-recent">
                <MenuItem className="tc-recent-open" label={shown} icon={<Avatar name={demo ? shown : o} src={demo ? undefined : ownerAvatarUrl(o, 32)} size="xs" decorative />} onClick={() => go(teamHref(o, r, null))}>
                  <span>{shown}</span>
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
            <span className="tc-name" title={chip.title}>
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
      {offerTeams && <NewTeamDialog open={creating} onOpenChange={setCreating} signedIn={ghSignedIn} check={check} />}
      {invitedOnce && (
        <Suspense fallback={null}>
          <InviteDialog open={inviting} onOpenChange={setInviting} />
        </Suspense>
      )}
    </>
  );
}

