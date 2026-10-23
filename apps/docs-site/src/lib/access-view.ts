// What each access state shows on a team's Bridge (multi-team plan 3.3, 7.1 to 7.3): the no-access screen, the
// banner over a read-only Studio, the team chip's access words, the ready-made messages people copy for their lead,
// and "Who can do what". Pure words and rules, covered by access-view.test.ts. No DOM, no fetch, no storage.
//
// The states come from core resolveRepoAccess (lib/access.ts). Designer-facing words only: "your lead", "the team",
// "set up", never collaborator, installation, permission scopes or tokens.

import { CONTRIBUTE_WORDS } from './contribute';
import type { ChangesMode, RepoAccessState } from '@bridge-ds/core';
import { isDemoRepo, isSampleTeam, SAMPLE_TEAM, teamDisplayName } from './demo';

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
  /** Continue with email: the one sign-in screen of Bridge (pages/signin.astro), back to this page afterwards. */
  | { kind: 'email'; label: string }
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
  /** This site signs email contributors in on this team (real teams only): a signed-out screen offers it second. */
  email?: boolean;
  /** The team's configured name when this browser knows it (bridge.config.json `name`, kept by the server). */
  name?: string | null;
}

const EMAIL_ACTION: AccessAction = { kind: 'email', label: CONTRIBUTE_WORDS.continueWithEmail };
/** The quiet way in for people invited with their email, under Sign in with GitHub: the one sign-in screen of Bridge. */
const EMAIL_LINK = { lead: CONTRIBUTE_WORDS.invitedWithEmail, action: EMAIL_ACTION };

/** The screen of one state, null when the Studio opens as usual (reader, writer, admin). */
export function accessScreen(state: RepoAccessState, f: AccessScreenInput): AccessScreen | null {
  const repo = `${f.owner}/${f.repo}`;
  // Titles name the team (never owner/repo); the messages people copy to a GitHub admin keep the repository.
  const team = teamDisplayName(repo, { name: f.name });
  switch (state) {
    case 'anonymous-unknown':
      // With email sign-in the title names no provider: GitHub stays the main way, the email link a quiet one under it.
      return f.email
        ? {
            layout: 'block',
            title: `Sign in to open ${team}`,
            body: 'This design system may be private. Sign in to see it.',
            primary: { kind: 'signin', label: 'Sign in with GitHub' },
            links: [EMAIL_LINK],
          }
        : {
            layout: 'block',
            title: `Sign in with GitHub to open ${team}`,
            body: 'This design system may be private. Once you sign in, GitHub tells Bridge what you can see.',
            primary: { kind: 'signin', label: 'Sign in with GitHub' },
          };
    case 'no-access':
      return {
        layout: 'block',
        title: `You do not have access to ${team} yet`,
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
        ...(f.email ? { links: [EMAIL_LINK] } : {}),
      };
    case 'not-installed':
      return f.admin
        ? {
            layout: 'banner',
            tone: 'warning',
            title: `Bridge is not set up on ${team} yet`,
            body: 'Install it once and your whole team can review and suggest from here. You stay in control of what it can reach.',
            primary: { kind: 'link', label: 'Install Bridge', href: installUrl(), external: true },
          }
        : {
            layout: 'banner',
            tone: 'warning',
            title: `Bridge is not set up on ${team} yet`,
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

/** Set in this tab when the session ended in another one (scripts/github-session.ts): the page says so once. */
export const SIGNED_OUT_ELSEWHERE_KEY = 'bridge.signedOutElsewhere';

/** The screen of a tab whose session ended in another tab: "You signed out", and Sign in back to this page. */
export function signedOutScreen(owner: string, repo: string): AccessScreen {
  return {
    layout: 'block',
    title: 'You signed out',
    body: `You signed out in another tab. Sign in again to open ${teamDisplayName(`${owner}/${repo}`)}: Bridge sends a code to your email.`,
    primary: { kind: 'email', label: 'Sign in' },
  };
}

/** The old team sign-in screen's search parameter: such an address now opens the one sign-in screen (/signin/). */
export const SIGN_IN_PARAM = 'signin';

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

/** The design system the self-hosted site shows to everyone: Bridge's own. */
export const DEMO_TEAM = 'peterbono/ai-design-system-demo';

/**
 * A demo design system (lib/demo.ts DEMO_REPOS): the self-hosted site's own repository, or the demo team on the
 * hosted site. `hosted` is kept for callers; both kinds of page show a demo the same way.
 */
export const isDemoTeam = (team: string | null | undefined, _hosted?: boolean) => isDemoRepo(team);

/** What the team chip shows: the design system being viewed, and what the visitor can do on it. */
export interface ChipIdentity {
  /** demo: a friendly name (Bridge's own with the Bridge mark, Acme Design with its initials); team: the owner's avatar and the team's name. */
  kind: 'demo' | 'team';
  /** The simulated team with sample data (Acme Design): its initials instead of the Bridge mark. */
  sample?: boolean;
  /** The name on the chip. */
  name: string;
  /** The full name, in the tooltip. */
  title: string;
  badge: { label: string; tone: ChipTone };
}

/**
 * The chip of `team` ("owner/repo", null while unknown), named by teamDisplayName (lib/demo.ts): the team's own name
 * from bridge.config.json (`name`, once its settings are read), else its repository name in words; owner/repo stays in
 * the tooltip. The sample team reads "Acme Design" with a "Demo" tag for everyone: it is a simulated team, whatever
 * access the viewer has on its repository. Bridge's own design system reads "Bridge": a visitor without an account
 * explores freely (nothing they do reaches the repository), signed in it shows their real access like any team.
 */
export function chipIdentity(team: string | null, f: { demo: boolean; state: RepoAccessState | null; signedIn: boolean; name?: string | null }): ChipIdentity {
  if (f.demo && isSampleTeam(team)) {
    return { kind: 'demo', sample: true, name: SAMPLE_TEAM, title: `${SAMPLE_TEAM}, a sample team, ${team}`, badge: { label: 'Demo', tone: 'info' } };
  }
  const name = team ? teamDisplayName(team, { name: f.name }) : null;
  if (f.demo) {
    return {
      kind: 'demo',
      name: name ?? teamDisplayName(DEMO_TEAM),
      title: team ? `${name} design system, ${team}` : `${teamDisplayName(DEMO_TEAM)} design system`,
      badge: f.signedIn ? accessBadge(f.state, true) : { label: 'Explore freely', tone: 'info' },
    };
  }
  return { kind: 'team', name: name ?? 'Your team', title: team ? `${name}, ${team}` : 'Your team', badge: accessBadge(f.state, f.signedIn) };
}

/** One sentence for Settings: what the viewer can do here. On the sample team (`demo`), a signed-out visitor explores freely. */
export function accessSummary(state: RepoAccessState | null, f: { login?: string | null; repo: string; demo?: boolean; name?: string | null }): string {
  const team = teamDisplayName(f.repo, { name: f.name });
  if (!state && !f.login && f.demo) return "You're exploring the demo with sample data. Nothing you do here is saved.";
  if (!state) return f.login ? `Checking what ${who(f.login)} can do on ${team}.` : `Sign in with GitHub to see what you can do on ${team}.`;
  switch (state) {
    case 'admin':
      return `${who(f.login)} is an admin of ${team}: you can change anything here, and decide who gets in on GitHub.`;
    case 'writer':
      return `${who(f.login)} can edit ${team}: review, suggest and start changes.`;
    case 'reader':
      return `${who(f.login)} can read ${team}: review, comment and send suggestions.`;
    case 'outside-contributor':
      return `${who(f.login)} is not on this team on GitHub: you can look around and send suggestions.`;
    case 'not-installed':
      return `Bridge is not set up on ${team} yet: you can look around until an admin installs it.`;
    case 'no-access':
      return `${who(f.login)} cannot see ${team}.`;
    default:
      return `You are viewing ${team} as a guest. Sign in with GitHub to do more.`;
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

const TEAM_NAME = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

/**
 * A real-looking "owner/repo": GitHub's owner and repository syntax, and not a placeholder someone typed while trying
 * the launcher ("owner/repo", "owner/design", anything owned by "owner").
 */
export function isRecentTeamName(team: string): boolean {
  const m = TEAM_NAME.exec(team);
  if (!m) return false;
  const [, owner = '', repo = ''] = m;
  if (owner.toLowerCase() === 'owner') return false;
  if (owner.endsWith('-') || owner.includes('--')) return false;
  return repo !== '.' && repo !== '..';
}

/** The stored list, dropping anything that is not a real "owner/repo", duplicates (case-insensitive) included. */
export function parseRecentTeams(text: string | null): string[] {
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string' || !isRecentTeamName(x) || seen.has(x.toLowerCase())) continue;
      seen.add(x.toLowerCase());
      out.push(x);
    }
    return out.slice(0, RECENT_TEAMS_MAX);
  } catch {
    return [];
  }
}

/** The list with `team` first, once (GitHub names are case-insensitive), at most RECENT_TEAMS_MAX. */
export function pushRecentTeam(list: readonly string[], team: string): string[] {
  if (!isRecentTeamName(team)) return [...list];
  return [team, ...list.filter((t) => t.toLowerCase() !== team.toLowerCase())].slice(0, RECENT_TEAMS_MAX);
}

/** The list without `team` (case-insensitive). */
export function removeRecentTeam(list: readonly string[], team: string): string[] {
  return list.filter((t) => t.toLowerCase() !== team.toLowerCase());
}

/**
 * The page read its repository: the team is real and worth remembering. Never on a 404 (no-access,
 * anonymous-unknown), an App that is not set up there, or an access not known yet.
 */
export function remembersTeam(state: RepoAccessState | null | undefined): boolean {
  return state === 'anonymous-public' || state === 'reader' || state === 'writer' || state === 'admin' || state === 'outside-contributor';
}

/** The names teams go by, as their pages read them (bridge.config.json `name`), for the recent teams: lower-case "owner/repo" to name. */
export const TEAM_NAMES_KEY = 'bridge.teamNames';

/** The stored names, cleaned: real-looking teams with a name of 1 to 60 characters. */
export function parseTeamNames(text: string | null): Record<string, string> {
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, n] of Object.entries(v)) if (isRecentTeamName(k) && typeof n === 'string' && n.trim() && n.trim().length <= 60) out[k.toLowerCase()] = n.trim();
    return out;
  } catch {
    return {};
  }
}

/** The names with `team`'s set (or dropped when the team has none), only for the teams still listed in `keep`. */
export function noteName(names: Record<string, string>, team: string, name: string | null | undefined, keep: readonly string[]): Record<string, string> {
  const listed = new Set(keep.map((t) => t.toLowerCase()));
  const next: Record<string, string> = {};
  for (const [k, n] of Object.entries(names)) if (listed.has(k)) next[k] = n;
  const k = team.toLowerCase();
  if (name?.trim() && listed.has(k)) next[k] = name.trim();
  else delete next[k];
  return next;
}

/**
 * The role a signed-in person holds on the teams they belong to ("Admin", "Can edit"...), kept like the names
 * (parseTeamNames, noteName) so the team menu lists them under "Your teams": lower-case "owner/repo" to role words.
 */
export const TEAM_ROLES_KEY = 'bridge.teamRoles';

/** The role words of a member of the team (reads, edits or administers it), null for anyone else. */
export function memberRole(state: RepoAccessState | null | undefined, signedIn: boolean): string | null {
  if (!signedIn || (state !== 'reader' && state !== 'writer' && state !== 'admin')) return null;
  return accessBadge(state, true).label;
}

/** The name a recent team goes by: the one its page read, else teamDisplayName (a demo's name, the repository in words). */
export const recentTeamName = (team: string, names: Record<string, string>): string => teamDisplayName(team, { name: names[team.toLowerCase()] });

/** The page found nothing at that address (GitHub answered 404): drop it from the recent teams. */
export function forgetsTeam(state: RepoAccessState | null | undefined): boolean {
  return state === 'no-access' || state === 'anonymous-unknown';
}
