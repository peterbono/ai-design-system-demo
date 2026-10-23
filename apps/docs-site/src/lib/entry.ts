// Entry (boards E1 to E7c): one door, then Bridge takes the person to the right room. The words, the parsing of
// /api/entry answers (api/entry/index.ts) and the routing after the email code. Pure, no DOM, no fetch, covered by
// entry.test.ts. The calls live in scripts/entry-session.ts, the screens in components/ds/account/EntryRooms.tsx
// (E3, E4, E4b, E5), components/ds/studio/Onboarding.tsx (E6, E7a), StudioHome.tsx (E7b) and JoinRequests.tsx (E7c).
//
// After the code (first match wins, the server decides the kind):
//   teams    one team: its Studio home. Two or more: the most recent one this browser opened, else "Pick a team" (E5).
//   invites  "Acme Design invited you" (E3): Join accepts the invite, no approval.
//   domain   "Your colleagues already use Bridge" (E4): every team open to the work domain, largest first, three then
//            "N more"; Ask to join, then "Request sent" (E4b).
//   create   "Create your team" (E6): the workspace setup, step 1.
import { teamHref } from './team-path';
import { WORKSPACE_HOME } from './start';

export const ENTRY_API = '/api/entry';

export type EntryRole = 'edit' | 'reviewer' | 'admin';

export interface EntryTeam {
  repo: string;
  name: string;
  role: EntryRole;
  via: string;
}

export interface EntryInvite {
  id: string;
  team: string;
  repo: string;
  role: string;
  invitedBy: string;
  /** When the invite was sent (ISO), '' when unknown. */
  invitedAt: string;
  memberCount: number;
  /** The first few people on the team, names only (the avatars of the card). */
  people: string[];
}

export interface DomainTeam {
  repo: string;
  name: string;
  memberCount: number;
  people: string[];
  adminName: string;
  requested: boolean;
}

export type Entry =
  | { kind: 'teams'; teams: EntryTeam[] }
  | { kind: 'invites'; invites: EntryInvite[] }
  | { kind: 'domain'; domain: string; teams: DomainTeam[] }
  | { kind: 'create' };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const REPO = /^[^/\s]+\/[^/\s]+$/;
const repoOf = (v: unknown): string | null => {
  const r = str(v);
  return r && REPO.test(r) ? r : null;
};
const ROLES: readonly EntryRole[] = ['edit', 'reviewer', 'admin'];
const countOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
/** Names for avatars: strings only, never anything shaped like an email, at most PEOPLE_SHOWN. */
const namesOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map(str)
    .filter((n): n is string => Boolean(n) && !n!.includes('@'))
    .slice(0, PEOPLE_SHOWN);
const isoOf = (v: unknown): string => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? s : '';
};

/** An /api/entry answer, or null when it is not one. Unknown fields and malformed rows are dropped. */
export function parseEntry(v: unknown): Entry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === 'object') : []);
  switch (o.kind) {
    case 'teams': {
      const teams = list(o.teams).flatMap((t): EntryTeam[] => {
        const repo = repoOf(t.repo);
        if (!repo) return [];
        const role = ROLES.includes(t.role as EntryRole) ? (t.role as EntryRole) : 'edit';
        return [{ repo, name: str(t.name) ?? repo, role, via: str(t.via) ?? 'email' }];
      });
      return teams.length ? { kind: 'teams', teams } : { kind: 'create' };
    }
    case 'invites': {
      const invites = list(o.invites).flatMap((i): EntryInvite[] => {
        const repo = repoOf(i.repo);
        const id = str(i.id);
        if (!repo || !id) return [];
        return [{ id, repo, team: str(i.team) ?? repo, role: str(i.role) ?? 'edit', invitedBy: str(i.invitedBy) ?? '', invitedAt: isoOf(i.invitedAt), memberCount: countOf(i.memberCount), people: namesOf(i.people) }];
      });
      return invites.length ? { kind: 'invites', invites } : { kind: 'create' };
    }
    case 'domain': {
      const domain = str(o.domain);
      const teams = list(o.teams).flatMap((t): DomainTeam[] => {
        const repo = repoOf(t.repo);
        if (!repo) return [];
        return [{ repo, name: str(t.name) ?? repo, memberCount: countOf(t.memberCount), people: namesOf(t.people), adminName: str(t.adminName) ?? '', requested: t.requested === true }];
      });
      return domain && teams.length ? { kind: 'domain', domain, teams: sortDomainTeams(teams) } : { kind: 'create' };
    }
    case 'create':
      return { kind: 'create' };
    default:
      return null;
  }
}

/** Largest first, then by name: the order the server sends, kept when a list comes back unsorted. */
export const sortDomainTeams = <T extends Pick<DomainTeam, 'memberCount' | 'name'>>(teams: readonly T[]): T[] =>
  [...teams].sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));

/** Avatars on a team card before "+N" (the server sends at most this many names). */
export const PEOPLE_SHOWN = 4;

/** The avatars of a team card: the names shown, and the "+N" of everyone else counted. */
export function teamAvatars(people: readonly string[], memberCount: number): { names: string[]; more: number } {
  const names = people.slice(0, PEOPLE_SHOWN);
  return { names, more: Math.max(0, memberCount - names.length) };
}

/** "21 October", the day an invite was sent; with the year when it is not this year. '' when unknown. */
export function invitedOn(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

/** Domain teams shown before "N more". */
export const DOMAIN_SHOWN = 3;

/** The domain teams shown, and how many wait behind "N more". */
export function splitDomainTeams<T>(teams: readonly T[], all = false, max = DOMAIN_SHOWN): { shown: T[]; more: number } {
  if (all || teams.length <= max) return { shown: [...teams], more: 0 };
  return { shown: teams.slice(0, max), more: teams.length - max };
}

/** The Studio home of a team, "owner/repo". */
export function teamHome(repo: string): string {
  const [o = '', r = ''] = repo.split('/');
  return teamHref(o, r, null);
}

/** E6: the workspace setup on "Your team". */
export const CREATE_TEAM_HREF = `${WORKSPACE_HOME}?setup=create`;

/** Where the person goes after the code, or which room shows. */
export type EntryRoute =
  | { to: 'go'; href: string }
  | { to: 'pick'; teams: EntryTeam[] }
  | { to: 'invite'; invite: EntryInvite; more: number }
  | { to: 'domain'; domain: string; teams: DomainTeam[] }
  | { to: 'create'; href: string };

/**
 * The room for an entry answer. `recent`: the teams this browser opened, newest first (lib/recent-teams.ts). Two or
 * more teams reopen the most recent one of them; without one, the picker.
 */
export function routeEntry(e: Entry, recent: readonly string[] = []): EntryRoute {
  switch (e.kind) {
    case 'teams': {
      if (e.teams.length === 1) return { to: 'go', href: teamHome(e.teams[0]!.repo) };
      const mine = new Map(e.teams.map((t) => [t.repo.toLowerCase(), t.repo]));
      const last = recent.map((r) => mine.get(r.toLowerCase())).find(Boolean);
      return last ? { to: 'go', href: teamHome(last) } : { to: 'pick', teams: [...e.teams].sort((a, b) => a.name.localeCompare(b.name)) };
    }
    case 'invites':
      return { to: 'invite', invite: e.invites[0]!, more: e.invites.length - 1 };
    case 'domain':
      return { to: 'domain', domain: e.domain, teams: e.teams };
    default:
      return { to: 'create', href: CREATE_TEAM_HREF };
  }
}

/** "12 members", "1 member". */
export const membersLabel = (n: number): string => `${n} ${n === 1 ? 'member' : 'members'}`;

/** E5: what the person does on a team, from their side: "You can edit", "You review design", "You are admin". */
export function yourRole(role: EntryRole | string): string {
  if (role === 'admin') return 'You are admin';
  if (role === 'reviewer') return 'You review design';
  return 'You can edit';
}

/** The first word of a name ("Sam" for "Sam Rivera"), for "Waiting for Sam". */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** The domain of an email, lower case ("acme.com"), or null. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  const d = at > 0 ? email.slice(at + 1).trim().toLowerCase() : '';
  return d || null;
}

/** A first guess at a team name from a work domain: "Lumen" for lumen.studio, "Acme" for acme.com. */
export function teamNameFromDomain(domain: string | null): string {
  const label = domain?.split('.')[0] ?? '';
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

/** Every designer-facing sentence of Entry, in one place. */
export const ENTRY_WORDS = {
  // E3
  invitedTitle: (team: string) => `${team} invited you`,
  invitedBy: (who: string) => (who ? `${who} invited` : 'You were invited with'),
  invitedOn: (day: string) => (day ? ` on ${day}` : ''),
  joinAs: 'You join as',
  join: (team: string) => `Join ${team}`,
  moreInvites: (n: number) => (n === 1 ? 'One more invite waits for you. It shows once you are in.' : `${n} more invites wait for you. They show once you are in.`),
  notYou: 'Not you?',
  otherEmail: 'Use another email',
  githubToAccept: 'Connect GitHub to accept',
  githubToAcceptWhy: (role: string) => `You join as ${role}. Reviewers and admins approve on GitHub, so Bridge needs your GitHub account first.`,
  inviteGone: 'This invite expired or was cancelled. Ask your admin for a new one.',
  acceptOnGitHubTitle: 'One last step on GitHub',
  acceptOnGitHub: (repo: string, role: string) => `GitHub asks you to accept the invitation to ${repo} once. Then come back: you are ${role}.`,
  acceptOnGitHubButton: 'Accept on GitHub',
  openTeam: 'Open the team',
  // E4
  domainTitle: 'Your colleagues already use Bridge',
  domainLead: (n: number) => (n === 1 ? ['Bridge found a team for', '. Ask to join, and an admin lets you in.'] : [`Bridge found ${n} teams for`, '. Ask to join one, and an admin lets you in.']) as [string, string],
  admin: (name: string) => `Admin: ${name}`,
  ask: 'Ask to join',
  askTeam: (team: string) => `Ask to join ${team}`,
  asked: 'Request sent',
  more: (n: number) => `${n} more`,
  showMore: (n: number) => `Show ${n} more ${n === 1 ? 'team' : 'teams'}`,
  createInstead: 'Create a new team instead',
  // E4b
  sentTitle: 'Request sent',
  sentLead: (admin: string) => (admin ? `We asked ${admin} to let you in. You'll get an email.` : "We asked an admin to let you in. You'll get an email."),
  waitingFor: (admin: string) => (admin ? `Waiting for ${firstName(admin)}` : 'Waiting for an admin'),
  exploreDemo: 'Explore the demo while you wait',
  changedMind: 'Changed your mind?',
  cancelRequest: 'Cancel the request',
  // E5
  pickTitle: 'Pick a team',
  pickLead: (n: number) => `You are in ${n} teams. Switch any time from the team menu.`,
  lastOpened: 'Last opened',
  newLead: 'Starting something new?',
  createTeam: 'Create a team',
  // E6 and E7a
  createTitle: 'Create your team',
  createLead: 'Your teammates see this name in their invite. You can change it later.',
  teamName: 'Team name',
  teamNameMissing: 'Type a name for your team.',
  findable: (domain: string) => `Let people with @${domain} find this team`,
  findableHelp: 'They can ask to join. You approve each person, and they start as Can edit.',
  inviteOnly: 'Teammates join by invite. You send invites right after setup.',
  noDesignSystem: 'No design system yet? Keep exploring the demo',
  nextLibrary: 'Next: connect your design system',
  expecting: 'Expecting an invite? Ask your design lead to send it to this email:',
  setupTitle: (name: string | null) => (name ? `Welcome, ${name}. Let's set up your team.` : "Welcome. Let's set up your team."),
  firstOnly: 'Only the first step is needed today.',
  connectGitHub: 'Connect GitHub',
  connectGitHubWhy: 'Bridge reads your repository through GitHub. Connect it once, then pick the repository.',
  // E7a, E7c: Settings
  discoveryOn: ['People with', 'can find this team and ask to join.'] as [string, string],
  discoveryOff: (domain: string) => `People with @${domain} cannot find this team. They join by invite.`,
  turnOff: 'Turn off',
  turnOn: 'Turn on',
  // E7b, E7c: join requests
  asksToJoin: (team: string) => `asks to join ${team}`,
  joinsAs: (email: string) => `${email} · joins as Can edit`,
  requestsTitle: 'Asks to join',
  foundWith: (domain: string | null, ago: string) => (domain ? `Found the team with @${domain} · asked ${ago}` : `Asked ${ago}`),
  approve: 'Approve',
  decline: 'Decline',
  joined: (name: string) => `${firstName(name)} joined as Can edit.`,
  declined: (name: string) => `${firstName(name)} will not join. Bridge does not tell them why.`,
  githubToManage: 'Connect GitHub to manage requests',
  undo: 'Undo',
  /** After Undo: the request waits again (and an approved person left the team). */
  undone: (name: string) => `${firstName(name)}'s request is back.`,
  requestKind: (n: number) => `${n} ${n === 1 ? 'join request' : 'join requests'}`,
} as const;

/** "1 h ago", "2 days ago", "just now": when a request was made, for Settings. */
export function askedAgo(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60 * 60 * 1000) return 'just now';
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/** A join request, as the admin side reads it (GET ?requests=). */
export interface JoinRequest {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

export function parseRequests(v: unknown): JoinRequest[] {
  const list = v && typeof v === 'object' && Array.isArray((v as { requests?: unknown }).requests) ? ((v as { requests: unknown[] }).requests) : [];
  return list.flatMap((r): JoinRequest[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    const email = str(o.email);
    if (!id || !email) return [];
    return [{ id, email, name: str(o.name) ?? email.split('@')[0]!, createdAt: str(o.createdAt) ?? '', expiresAt: str(o.expiresAt) ?? '' }];
  });
}

/** Team discovery, as the admin side reads it (GET ?discovery=). */
export interface Discovery {
  domain: string | null;
  enabled: boolean;
  configured: boolean;
  eligible: boolean;
}

export function parseDiscovery(v: unknown): Discovery | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { domain: str(o.domain), enabled: o.enabled === true, configured: o.configured === true, eligible: o.eligible === true };
}

/**
 * The Settings line (E7a "Later, in Settings, Members", E7c): shown when the team is open, or was, or could be (an
 * admin with a work email whose team never chose). Hidden for a public email that never opened the team.
 */
export function discoveryLine(d: Discovery | null): { on: boolean; domain: string; canTurnOn: boolean } | null {
  if (!d || !d.domain) return null;
  if (d.enabled) return { on: true, domain: d.domain, canTurnOn: false };
  if (!d.configured && !d.eligible) return null;
  if (d.configured && !d.eligible) return { on: false, domain: d.domain, canTurnOn: false };
  return { on: false, domain: d.domain, canTurnOn: true };
}
