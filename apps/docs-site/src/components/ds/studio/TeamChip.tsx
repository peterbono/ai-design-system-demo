// The team chip at the top of the Studio side nav (multi-team plan 7.1): where you are. The owner's avatar, owner/repo
// in mono and your access on it as a badge ("Can edit", "Can suggest", "No access"), then a chevron. It is the nav's
// first focus stop and a full-width target. Its menu: Invite your team, View on GitHub, and on the hosted site the
// teams opened in this browser (max 5) and "Open another repository". Who you are stays at the bottom of the nav
// (components/GitHubAccount.astro): proximity keeps the team at the top and the account at the bottom.
// Mounted by layouts/Layout.astro on every Studio page, both modes: a self-hosted Studio is its own one team.
import { useEffect, useState } from 'react';
import { ChevronsUpDown, FolderOpen, UserPlus } from 'lucide-react';
import { Avatar, Badge, Button, Icon, Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import { GitHubMark } from './brand-icons';
import { accessBadge, ownerAvatarUrl, parseRecentTeams, pushRecentTeam, RECENT_TEAMS_KEY, repoUrl } from '../../../lib/access-view';
import { STUDIO_ROOT, studioHref, teamHref } from '../../../lib/team-path';

export interface TeamChipProps {
  /** owner/repo known at build time (self-hosted). Null on a team shell: read from the address. */
  repo?: string | null;
  /** The hosted site: offer the other teams of this browser and "Open another repository". */
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

  const [owner = '', repo = ''] = (name ?? '').split('/');
  const badge = accessBadge(access, signedIn);
  const go = (href: string) => location.assign(href);
  const label = name ? `${name}, ${badge.label}. Team menu` : 'Team menu';
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" fullWidth className="tc-trigger" aria-label={label} />}
      >
        <Avatar name={owner || 'Team'} src={owner ? ownerAvatarUrl(owner) : undefined} size="sm" decorative className="tc-avatar" />
        <span className="tc-text">
          <span className="tc-name mono">
            {name ?? 'Your team'}
          </span>
          <Badge size="sm" tone={badge.tone} dot className="tc-badge">
            {badge.label}
          </Badge>
        </span>
        <Icon icon={ChevronsUpDown} size="sm" className="tc-chev" />
      </MenuTrigger>
      <MenuContent className="tc-menu" align="start">
        <MenuItem icon={UserPlus} onClick={() => go(studioHref('?setup=team'))}>
          Invite your team
        </MenuItem>
        {owner && (
          <MenuItem icon={GitHubMark} onClick={() => window.open(repoUrl(owner, repo), '_blank', 'noopener,noreferrer')}>
            View on GitHub
          </MenuItem>
        )}
        {(launcher || hosted) && (
          <>
            <MenuSeparator />
            {recent.length > 0 && (
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
            )}
            <MenuItem icon={FolderOpen} onClick={() => go(STUDIO_ROOT)}>
              Open another repository
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

