// Where a person who joined a team with their email (no GitHub) finds their Studio. Bridge's own Studio at /studio/ and
// its Library are read with GitHub: for an email member they are the read-only showcase, while their team's Studio is
// the team address (/studio/<owner>/<repo>/), which reads through the team's proxy. So the Library <-> Studio switch and
// the Library's Studio links take them to that address, and /studio/ itself sends them there, on the same page.
// Signed out, or signed in with GitHub, nothing changes. Pure: covered by email-studio.test.ts.
import { STUDIO_ROOT, teamHref, type ReservedPaths } from './team-path';

export interface TeamPair {
  owner: string;
  repo: string;
}

/** '/studio', the Studio root without its slash (an address typed without it). */
const STUDIO_BARE = STUDIO_ROOT.slice(0, -1);

/** The Studio pages a team address has (pages/team-shell/): '' is Home. Other /studio/ pages are shared ones. */
export const TEAM_STUDIO_ROUTES: readonly string[] = ['', 'brands', 'building', 'changes', 'components', 'products', 'quality', 'review', 'settings', 'tokens'];

const pairOf = (repo: string): TeamPair | null => {
  const [owner, name, extra] = repo.split('/');
  return owner && name && extra === undefined ? { owner, repo: name } : null;
};

/**
 * The team an email member's Studio links go to: the page's own team when they are a member of it, else the team they
 * used last (`recent`, newest first), else the first of theirs. Null when they are a member of no team by email.
 */
export function emailMemberTeam(emailTeams: readonly string[], recent: readonly string[] = [], pageRepo: string | null = null): TeamPair | null {
  const mine = new Map(emailTeams.map((t) => [t.toLowerCase(), t]));
  const pick = (pageRepo && mine.get(pageRepo.toLowerCase())) ?? recent.map((r) => mine.get(r.toLowerCase())).find(Boolean) ?? emailTeams[0];
  return pick ? pairOf(pick) : null;
}

/**
 * The route of a self-hosted Studio address ('/studio/changes/' -> 'changes/'), or null when the page is not one a
 * team address has (sign-in callback, invite, Connect Claude, workspace, a team address itself).
 */
export function teamStudioRoute(pathname: string): string | null {
  if (pathname !== STUDIO_BARE && !pathname.startsWith(STUDIO_ROOT)) return null;
  const rest = pathname.slice(STUDIO_ROOT.length).replace(/^\/+/, '');
  const first = rest.split('/')[0] ?? '';
  return TEAM_STUDIO_ROUTES.includes(first) ? rest : null;
}

export interface StudioEntry {
  pathname: string;
  search?: string;
  hash?: string;
  /** Signed in with GitHub on this browser: the self-hosted Studio is theirs, it stays. */
  github: boolean;
  /** The page is a team address already, or reads no repository (start, workspace). */
  teamPage: boolean;
  /** "owner/repo" of the teams this browser's person joined by email. */
  emailTeams: readonly string[];
  recent?: readonly string[];
  /** The repository the page shows ("owner/repo"), to keep its team when they are a member of it. */
  pageRepo?: string | null;
  reserved?: ReservedPaths | null;
}

/**
 * Where /studio/<route> sends an email member: the same route on their team's address, with the query and the anchor.
 * Null keeps the page (signed out, GitHub, a team address, a shared page, no email team).
 */
export function emailStudioRedirect(e: StudioEntry): string | null {
  if (e.github || e.teamPage) return null;
  const route = teamStudioRoute(e.pathname);
  if (route === null) return null;
  const team = emailMemberTeam(e.emailTeams, e.recent, e.pageRepo ?? null);
  if (!team) return null;
  return teamHref(team.owner, team.repo, e.reserved ?? null) + route + (e.search ?? '') + (e.hash ?? '');
}

/** A build-time Studio link ('/studio/tokens/?focus=color') pointed at the team's address, or null when it stays. */
export function emailStudioLink(href: string, team: TeamPair, reserved: ReservedPaths | null = null): string | null {
  const m = /^([^?#]*)(.*)$/.exec(href);
  const path = m?.[1] ?? '';
  const route = teamStudioRoute(path === STUDIO_BARE ? STUDIO_ROOT : path);
  if (route === null) return null;
  return teamHref(team.owner, team.repo, reserved) + route + (m?.[2] ?? '');
}

export interface MemberEntry {
  pathname: string;
  search?: string;
  hash?: string;
  /** The hosted site (<html data-hosted-site>): its /studio/ is Bridge's showcase, each team has its own address. */
  hostedSite: boolean;
  /** The page is a team address already, or reads no repository (start, workspace). */
  teamPage: boolean;
  /** The repository the showcase shows ("owner/repo"). */
  pageRepo: string | null;
  /** The person is on that team: GitHub says they can change it, or their Bridge account lists it. */
  member: boolean;
  reserved?: ReservedPaths | null;
}

/**
 * Where /studio/<route> of the hosted site sends someone on the team it shows (Bridge's own design system): the same
 * page of the team's address, with the query and the anchor. The team's address is the one place its people work, so
 * the role, the greeting and what waits on them read the same as on every other team page. Null keeps the page (a
 * self-hosted Studio, where /studio/ is the team's own; a visitor; a team address; a shared page).
 */
export function memberStudioRedirect(e: MemberEntry): string | null {
  if (!e.hostedSite || e.teamPage || !e.member || !e.pageRepo) return null;
  const route = teamStudioRoute(e.pathname);
  if (route === null) return null;
  const team = pairOf(e.pageRepo);
  if (!team) return null;
  return teamHref(team.owner, team.repo, e.reserved ?? null) + route + (e.search ?? '') + (e.hash ?? '');
}
