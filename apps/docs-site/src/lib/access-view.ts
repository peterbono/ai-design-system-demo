// What each access state shows on a team's Bridge (multi-team plan 3.3, 7.1 to 7.3): the no-access screen, the
// banner over a read-only Studio, the team chip's access words, the ready-made messages people copy for their lead,
// and "Who can do what". Pure words and rules, covered by access-view.test.ts. No DOM, no fetch, no storage.
//
// The states come from core resolveRepoAccess (lib/access.ts). Designer-facing words only: "your lead", "the team",
// "set up", never collaborator, installation, permission scopes or tokens.

import type { ChangesMode, RepoAccessState } from '@bridge-ds/core';

/** The public GitHub App people sign in with (docs/SIGN-IN.md). Its page lists it at github.com/apps/<slug>. */
export const BRIDGE_APP_SLUG = 'bridge-ds';

/** Where an admin installs Bridge on a repository (GitHub asks which repositories). */
export const installUrl = (slug = BRIDGE_APP_SLUG) => `https://github.com/apps/${slug}/installations/new`;

const gh = (owner: string, repo: string) => `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** Where someone the lead invited accepts the invitation. */
export const invitationsUrl = (owner: string, repo: string) => `${gh(owner, repo)}/invitations`;

/** Where an admin adds people and sets what they can do. */
export const manageAccessUrl = (owner: string, repo: string) => `${gh(owner, repo)}/settings/access`;

/** The owner's teams, for an organization (GitHub shows a 404 page for a person, so only offer it for orgs). */
export const orgTeamsUrl = (owner: string) => `https://github.com/orgs/${encodeURIComponent(owner)}/teams`;

/** The owner's avatar, served by GitHub for any account (no API call). */
export const ownerAvatarUrl = (owner: string, size = 48) => `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?size=${size}`;

/** The link a lead shares: this site's address of the team's Studio home. */
export const teamLink = (origin: string, base: string) => `${origin.replace(/\/+$/, '')}${base.startsWith('/') ? base : `/${base}`}`;

/** "@ann" or "this account" when the login is unknown. */
const who = (login: string | null | undefined) => (login ? `@${login}` : 'this account');

// --- The messages people copy -------------------------------------------------------------------------------------

/** No access: what a teammate sends their lead. */
export function askAccessMessage(login: string | null | undefined, repo: string, link: string): string {
  return `Hi, can you give ${who(login)} access to github.com/${repo}? I want to use our Bridge Studio: ${link}`;
}

/** Bridge is not set up on the repository: what a teammate sends their lead (an admin). */
export function askInstallMessage(repo: string, link: string, slug = BRIDGE_APP_SLUG): string {
  return `Hi, can you install Bridge on github.com/${repo}? It takes a minute: ${installUrl(slug)} (pick ${repo.split('/')[1] ?? repo}). Then the team opens ${link}`;
}

/** Someone outside the team on GitHub who wants to join it. */
export function askJoinMessage(login: string | null | undefined, repo: string, link: string): string {
  return `Hi, can you add ${who(login)} to github.com/${repo}? I use our Bridge Studio and would like to do more than suggest: ${link}`;
}

// --- The screen per state -----------------------------------------------------------------------------------------

/** What a click does: the shared session listens for sign-in and sign-out attributes; copy puts `text` on the clipboard. */
export type AccessAction =
  | { kind: 'signin'; label: string }
  | { kind: 'signout'; label: string }
  | { kind: 'copy'; label: string; text: string; copied: string }
  | { kind: 'link'; label: string; href: string; external?: boolean };

export interface AccessScreen {
  /** block: replaces the page (the visitor cannot see anything); banner: one line over a read-only Studio. */
  layout: 'block' | 'banner';
  title: string;
  body: string;
  primary: AccessAction;
  secondary?: AccessAction;
  /** Quiet text links under the actions. */
  links?: { lead?: string; action: AccessAction }[];
  /** One quiet line under everything (how to switch accounts). */
  note?: string;
  /** Banner tone: info for a read-only Studio, warning when Bridge is not set up. */
  tone?: 'info' | 'warning';
}

export interface AccessScreenInput {
  owner: string;
  repo: string;
  /** The GitHub login when signed in. */
  login?: string | null;
  /** The team link (teamLink). */
  link: string;
  /** GitHub said the viewer is an admin (only for not-installed, where GitHub still shows the repository). */
  admin?: boolean;
}

/** The screen of one state, null when the Studio opens as usual (reader, writer, admin). */
export function accessScreen(state: RepoAccessState, f: AccessScreenInput): AccessScreen | null {
  const repo = `${f.owner}/${f.repo}`;
  switch (state) {
    case 'anonymous-unknown':
      return {
        layout: 'block',
        title: `Sign in with GitHub to open ${repo}`,
        body: 'This design system may be private. Once you sign in, GitHub tells Bridge what you can see.',
        primary: { kind: 'signin', label: 'Sign in with GitHub' },
      };
    case 'no-access':
      return {
        layout: 'block',
        title: `You do not have access to ${repo} yet`,
        body: `Bridge uses GitHub to decide who can open this design system. ${who(f.login)} cannot see it: either you are not on the team on GitHub yet, or Bridge is not set up on it.`,
        primary: { kind: 'copy', label: 'Ask your lead for access', text: askAccessMessage(f.login, repo, f.link), copied: 'Message copied. Paste it to your lead.' },
        secondary: { kind: 'signout', label: 'Sign in with another account' },
        links: [{ lead: 'Already invited?', action: { kind: 'link', label: 'Accept the invitation on GitHub', href: invitationsUrl(f.owner, f.repo), external: true } }],
        note: 'GitHub signs you in with the account open in this browser. To use another one, switch accounts on github.com first.',
      };
    case 'anonymous-public':
      return {
        layout: 'banner',
        tone: 'info',
        title: 'You are viewing as a guest',
        body: 'Sign in with GitHub to review changes and send suggestions.',
        primary: { kind: 'signin', label: 'Sign in with GitHub' },
      };
    case 'not-installed':
      return f.admin
        ? {
            layout: 'banner',
            tone: 'warning',
            title: `Bridge is not set up on ${repo} yet`,
            body: 'Install it once and your whole team can review and suggest from here. You stay in control of what it can reach.',
            primary: { kind: 'link', label: 'Install Bridge', href: installUrl(), external: true },
          }
        : {
            layout: 'banner',
            tone: 'warning',
            title: `Bridge is not set up on ${repo} yet`,
            body: 'You can look around. To review and suggest, an admin of the repository installs Bridge once.',
            primary: { kind: 'copy', label: 'Ask your lead to install Bridge', text: askInstallMessage(repo, f.link), copied: 'Message copied. Paste it to your lead.' },
          };
    case 'outside-contributor':
      return {
        layout: 'banner',
        tone: 'info',
        title: 'Read only',
        body: `${who(f.login)} is not on this team on GitHub. You can look around and still send suggestions: the team reviews them.`,
        primary: { kind: 'copy', label: 'Ask to join the team', text: askJoinMessage(f.login, repo, f.link), copied: 'Message copied. Paste it to your lead.' },
      };
    default:
      return null;
  }
}

// --- The team chip ------------------------------------------------------------------------------------------------

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * The access words on the team chip and in Settings, with their badge tone. Null state: still checking. Signed out is
 * never a word here: the account block at the bottom of the nav says it. A visitor without an account is a guest.
 */
export function accessBadge(state: RepoAccessState | null, signedIn: boolean): { label: string; tone: ChipTone } {
  if (!state) return signedIn ? { label: 'Checking', tone: 'neutral' } : { label: 'Guest', tone: 'neutral' };
  switch (state) {
    case 'admin':
      return { label: 'Admin', tone: 'success' };
    case 'writer':
      return { label: 'Can edit', tone: 'success' };
    case 'reader':
      return { label: 'Can suggest', tone: 'info' };
    case 'outside-contributor':
      return { label: 'Read only', tone: 'neutral' };
    case 'not-installed':
      return { label: 'Not set up', tone: 'warning' };
    case 'no-access':
      return { label: 'No access', tone: 'danger' };
    default:
      return { label: 'Guest', tone: 'neutral' };
  }
}

/** The design system the self-hosted site shows to everyone: Bridge's own demo. */
export const DEMO_TEAM = 'peterbono/ai-design-system-demo';

/** The demo is the self-hosted site's own repository, never a team page (a team page of it is that team's). */
export const isDemoTeam = (team: string | null | undefined, hosted: boolean) => !hosted && (team ?? '').toLowerCase() === DEMO_TEAM;

/** What the team chip shows: the design system being viewed, and what the visitor can do on it. */
export interface ChipIdentity {
  /** demo: the Bridge mark and a friendly name; team: the owner's avatar and owner/repo. */
  kind: 'demo' | 'team';
  /** The name on the chip. */
  name: string;
  /** The full name, in the tooltip. */
  title: string;
  badge: { label: string; tone: ChipTone };
}

/**
 * The chip of `team` ("owner/repo", null while unknown). On the demo a visitor without an account explores freely:
 * nothing they do there reaches the repository. Signed in, the demo shows their real access like any team.
 */
export function chipIdentity(team: string | null, f: { demo: boolean; state: RepoAccessState | null; signedIn: boolean }): ChipIdentity {
  if (f.demo) {
    return {
      kind: 'demo',
      name: 'Bridge demo',
      title: team ? `Bridge demo design system, ${team}` : 'Bridge demo design system',
      badge: f.signedIn ? accessBadge(f.state, true) : { label: 'Explore freely', tone: 'info' },
    };
  }
  return { kind: 'team', name: team ?? 'Your team', title: team ?? 'Your team', badge: accessBadge(f.state, f.signedIn) };
}

/** One sentence for Settings: what the viewer can do here. */
export function accessSummary(state: RepoAccessState | null, f: { login?: string | null; repo: string }): string {
  if (!state) return f.login ? `Checking what ${who(f.login)} can do on ${f.repo}.` : `Sign in with GitHub to see what you can do on ${f.repo}.`;
  switch (state) {
    case 'admin':
      return `${who(f.login)} is an admin of ${f.repo}: you can change anything here, and decide who gets in on GitHub.`;
    case 'writer':
      return `${who(f.login)} can edit ${f.repo}: review, suggest and start changes.`;
    case 'reader':
      return `${who(f.login)} can read ${f.repo}: review, comment and send suggestions.`;
    case 'outside-contributor':
      return `${who(f.login)} is not on this team on GitHub: you can look around and send suggestions.`;
    case 'not-installed':
      return `Bridge is not set up on ${f.repo} yet: you can look around until an admin installs it.`;
    case 'no-access':
      return `${who(f.login)} cannot see ${f.repo}.`;
    default:
      return `You are viewing ${f.repo} as a guest. Sign in with GitHub to do more.`;
  }
}

// --- Who can do what ----------------------------------------------------------------------------------------------

export type AccessRowId = 'read' | 'write' | 'admin' | 'owners';

export interface AccessRow {
  id: AccessRowId;
  /** What someone has on GitHub. */
  who: string;
  /** What that lets them do in Bridge. */
  can: string;
}

/** Which row the viewer is on (null when signed out or outside the team). */
export function viewerRow(state: RepoAccessState | null): AccessRowId | null {
  if (state === 'admin') return 'admin';
  if (state === 'writer') return 'write';
  if (state === 'reader') return 'read';
  return null;
}

/**
 * GitHub access, mapped to what a person can do in Bridge, from the live settings: the mode (`changes`) and the
 * owners who approve. Owners are named when there are a few.
 */
export function whoCanDoWhat(f: { changes?: ChangesMode | null; owners?: { design?: string[]; tech?: string[] } }): AccessRow[] {
  const direct = f.changes === 'direct';
  const owners = [...new Set([...(f.owners?.design ?? []), ...(f.owners?.tech ?? [])])];
  const named = owners.length && owners.length <= 3 ? `: ${owners.map((o) => (o.startsWith('@') ? o : `@${o}`)).join(', ')}` : '';
  return [
    { id: 'read', who: 'Read access on GitHub', can: 'Browse, comment, and send suggestions' },
    {
      id: 'write',
      who: 'Write access',
      can: direct ? 'Also start changes: Bridge opens them for review' : 'Same as read: changes go to developers as suggestions',
    },
    { id: 'admin', who: 'Admin', can: 'Also change Settings, and who gets in on GitHub' },
    { id: 'owners', who: 'Owners in Bridge settings', can: `Approve design or tech${named}` },
  ];
}

/** The line under "Who can do what". */
export const NO_ACCESS_LINE = 'People without access see a screen that helps them ask you.';

// --- Recent teams (the team chip's menu) --------------------------------------------------------------------------

/** Teams opened in this browser, newest first (localStorage, a per-viewer convenience). */
export const RECENT_TEAMS_KEY = 'bridge.recentTeams';
export const RECENT_TEAMS_MAX = 5;

/** The stored list, dropping anything that is not "owner/repo". */
export function parseRecentTeams(text: string | null): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(x)).slice(0, RECENT_TEAMS_MAX) : [];
  } catch {
    return [];
  }
}

/** The list with `team` first, once (GitHub names are case-insensitive), at most RECENT_TEAMS_MAX. */
export function pushRecentTeam(list: readonly string[], team: string): string[] {
  return [team, ...list.filter((t) => t.toLowerCase() !== team.toLowerCase())].slice(0, RECENT_TEAMS_MAX);
}
