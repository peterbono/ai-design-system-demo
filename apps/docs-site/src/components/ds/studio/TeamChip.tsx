// The team chip at the top of the Studio side nav (multi-team plan 7.1): the design system you are looking at, not your
// account. The owner's avatar, owner/repo in mono and what you can do on it as a badge ("Can edit", "Can suggest",
// "Guest"), then a chevron. On the demo (the self-hosted site's own repository) it shows the Bridge mark and "Bridge
// demo" instead of the owner's photo, and a visitor without an account reads "Explore freely". It is the nav's
// first focus stop and a full-width target. The name stays on one line (ellipsis, the full name in its title). Its
// menu: Invite your team (signed in) or Sign in with GitHub (signed out: there is nobody to invite yet), then on the hosted site the teams opened in this browser (max 5) and "Create a new team",
// which opens a dialog over the page (NewTeamDialog.tsx) to connect another design system: the person keeps their
// place. Who you are stays at the bottom of the nav (components/GitHubAccount.astro): proximity keeps the team at the
// top and the account at the bottom.
// Mounted by layouts/Layout.astro on every Studio page, both modes: a self-hosted Studio is its own one team.
import { useCallback, useEffect, useState } from 'react';
import { ChevronsUpDown, Plus, UserPlus } from 'lucide-react';
import { Avatar, Badge, Button, Icon, Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import { chipIdentity, isDemoTeam, ownerAvatarUrl, parseRecentTeams, pushRecentTeam, RECENT_TEAMS_KEY } from '../../../lib/access-view';
import { studioHref, teamHref } from '../../../lib/team-path';
import { ghButton } from '../../../lib/gh-wording';
import NewTeamDialog, { type TeamAccessCheck } from './NewTeamDialog';
import { GitHubMark } from './brand-icons';
import { Drawing } from './Drawing';

export interface TeamChipProps {
  /** owner/repo known at build time (self-hosted). Null on a team shell: read from the address. */
  repo?: string | null;
  /** The hosted site: offer the other teams of this browser and "Create a new team". */
  launcher?: boolean;
}

function readRecent(): string[] {
  try {
    return parseRecentTeams(localStorage.getItem(RECENT_TEAMS_KEY));
  } catch {
    return [];
  }
}

export default function TeamChip({ repo: built = null, launcher = false }: TeamChipProps) {
  const [name, setName] = useState<string | null>(built);
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
      const team = `${r.owner}/${r.repo}`;
      setName(team);
      setHosted(r.hosted);
      // A team page remembers itself for the chip menu of the next one.
      let list = readRecent();
      if (r.hosted) {
        list = pushRecentTeam(list, team);
        try {
          localStorage.setItem(RECENT_TEAMS_KEY, JSON.stringify(list));
        } catch {
          /* storage blocked: the menu lists none */
        }
      }
      setRecent(list.filter((t) => t.toLowerCase() !== team.toLowerCase()));
      setSignInApp(session.prefersSignIn());
      session.initGitHubConnect((v) => {
        setSignedIn(Boolean(v));
        if (!v) setAccess(r.hosted ? (session.currentAccess()?.state ?? null) : null);
      });
      session.onAccess((a) => setAccess(a?.state ?? null));
    })();
    return () => {
      live = false;
    };
  }, []);

  const [owner = ''] = (name ?? '').split('/');
  const chip = chipIdentity(name, { demo: isDemoTeam(name, hosted), state: access, signedIn });
  const badge = chip.badge;
  const offerTeams = launcher || hosted;
  const createItem = (
    // A dialog over the page: connect another design system by its repository, without leaving this one.
    <MenuItem icon={Plus} onClick={() => setCreating(true)}>
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
  const label = name ? `${chip.title}, ${badge.label}. Team menu` : 'Team menu';
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" fullWidth className="tc-trigger" aria-label={label} />}
        >
          {chip.kind === 'demo' ? (
            <span className="tc-mark" aria-hidden="true">
              <Drawing name="logo" width={18} />
            </span>
          ) : (
            <Avatar name={owner || 'Team'} src={owner ? ownerAvatarUrl(owner) : undefined} size="sm" decorative className="tc-avatar" />
          )}
          <span className="tc-text">
            <span className={chip.kind === 'demo' ? 'tc-name' : 'tc-name mono'} title={chip.title}>
              {chip.name}
            </span>
            <Badge size="sm" tone={badge.tone} dot className="tc-badge">
              {badge.label}
            </Badge>
          </span>
          <Icon icon={ChevronsUpDown} size="sm" className="tc-chev" />
        </MenuTrigger>
        <MenuContent className="tc-menu" align="start">
          {signedIn ? (
            <MenuItem icon={UserPlus} onClick={() => go(studioHref('?setup=team'))}>
              Invite your team
            </MenuItem>
          ) : (
            <>
              {/* Signed out the next steps come first: start a team of your own, or sign in to do more here. */}
              {offerTeams && createItem}
              {/* The shared session listens for these attributes (scripts/github-session.ts): sign in, or the dialog. */}
              <MenuItem icon={GitHubMark} data-gh-open="" data-gh-signin="">
                {ghButton(signInApp)}
              </MenuItem>
            </>
          )}
          {offerTeams && recent.length > 0 && (
            <>
              <MenuSeparator />
              <MenuGroup label="Recent teams">
                {recent.map((t) => {
                  const [o = '', r = ''] = t.split('/');
                  return (
                    <MenuItem key={t} icon={<Avatar name={o} src={ownerAvatarUrl(o, 32)} size="xs" decorative />} onClick={() => go(teamHref(o, r, null))}>
                      <span className="mono">{t}</span>
                    </MenuItem>
                  );
                })}
              </MenuGroup>
            </>
          )}
          {offerTeams && signedIn && (
            <>
              <MenuSeparator />
              {createItem}
            </>
          )}
        </MenuContent>
      </Menu>
      {offerTeams && <NewTeamDialog open={creating} onOpenChange={setCreating} signedIn={signedIn} check={check} />}
    </>
  );
}

