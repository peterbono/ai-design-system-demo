// Who is in the team of this page, for Settings > Members and the Invite collaborators dialog (lib/invites.ts has the
// rules). Three contexts, never mixed (lib/invites membersContext):
//   sample  Acme Design (peterbono/bridge-demo-ds): its fixed sample people, no GitHub call at all, so a guest spends
//           none of the 60 reads an hour GitHub gives them. Every change opens the demo dialog instead.
//   real    any other team, Bridge's own included: the repository's people on GitHub (signed in with write access,
//           GitHub lists them; any other member, an email contributor or a GitHub reader, reads the same list from
//           /api/contribute?members=1; else the reviewers from the settings), pending invites from this site's invites
//           server, and suggestions from the people who committed to the repository.
//   none    the browser workspace, which has no repository yet.
// Who may change anything comes from the session's access (repository admin) and is checked again by the server.
import type { Owners } from '@bridge-ds/core';
import { teamDisplayName } from '../lib/demo';
import { knownTeamName } from '../lib/recent-teams';
import { accountName } from '../lib/account';
import { teamKeyOfPage } from '../lib/team-path';
import { emailMembers, membersContext, roleOf, sampleTeam, type KnownPerson, type Member, type MembersContext, type PendingInvite } from '../lib/invites';
import { loginKey, personName } from '../lib/people';
import { currentViewer, getToken, ghGet, resolveAccess } from './github-session';
import { invitesAvailable, listInvites } from './invites-api';
import { knownNames } from './people';
import { repoContext, siteConfig } from './repo-context';

export interface MembersData {
  context: MembersContext;
  /** "owner/repo". */
  repo: string;
  /** The team as people call it: "Acme Design", "Bridge", or owner/repo. */
  team: string;
  members: Member[];
  pending: PendingInvite[];
  /** Who the email field suggests. */
  people: KnownPerson[];
  /** The viewer administers the repository: invites, roles and removals. */
  canManage: boolean;
  /** The repository belongs to one person on GitHub (no read-only or admin collaborators there). */
  personal: boolean;
  /** GitHub listed everyone; false: only the reviewers from the settings are known. */
  complete: boolean;
  /** This site can send invites (its invites server answers and is set up). */
  invites: boolean;
  /**
   * The team's reviewers (its settings) were known when this was read. False on a team whose design system is still
   * being read, or could not be: review roles are missing until it lands, then Members reads again.
   */
  ownersKnown?: boolean;
}

interface Collaborator {
  login: string;
  avatar_url?: string;
  role_name?: string;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
}

interface CommitLike {
  author?: { login?: string } | null;
  commit?: { author?: { name?: string; email?: string } };
}

/** A commit email that reaches a person: not GitHub's private relay, not a bot. */
const usableEmail = (e: string | undefined) => Boolean(e && !/noreply/i.test(e) && !/\[bot\]/i.test(e));

/** People who committed recently, with the email their commits carry, for the email field's suggestions. */
export function peopleFromCommits(commits: readonly CommitLike[]): KnownPerson[] {
  const out = new Map<string, KnownPerson>();
  for (const c of commits) {
    const email = c.commit?.author?.email?.trim().toLowerCase();
    if (!email || !usableEmail(email) || out.has(email)) continue;
    const login = c.author?.login;
    if (login && /\[bot\]$/i.test(login)) continue;
    out.set(email, { name: c.commit?.author?.name?.trim() || login || email, email, ...(login ? { login } : {}) });
  }
  return [...out.values()];
}

/** How long Members waits for the team's settings before it paints without them (they fill in once read). */
export const OWNERS_WAIT_MS = 800;

/**
 * The reviewers of the team, and whether they are known yet. On a team shell they come from the repository model:
 * Members never waits for the whole design system read (a large team takes a while, GitHub may be slow or refuse).
 * Already read: at once. Else the read gets OWNERS_WAIT_MS; past that, or when it fails, the people paint without
 * review roles and Members reads again when the settings land (bridge:team-model, components/ds/studio/members-state).
 */
async function ownersOfTeam(hosted: boolean): Promise<{ owners: Owners; known: boolean }> {
  const o = siteConfig().owners;
  if (o) return { owners: { design: o.design ?? [], tech: o.tech ?? [] }, known: true };
  if (!hosted) return { owners: { design: [], tech: [] }, known: true };
  const { loadTeamData } = await import('./team-data');
  const read = loadTeamData().then(
    (d) => ({ owners: d.model.site.owners, known: true }),
    () => null,
  );
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), OWNERS_WAIT_MS));
  return (await Promise.race([read, late])) ?? { owners: { design: [], tech: [] }, known: false };
}

/**
 * The name the team goes by (lib/demo.ts teamDisplayName): its own once its settings are read, else the name its
 * Bridge team has (the one the team chip shows, lib/recent-teams), and only then words made from the repository.
 */
function teamName(repo: string): string {
  const config = siteConfig();
  if (typeof config.name === 'string' && config.name.trim()) return teamDisplayName(repo, config);
  return knownTeamName(repo) ?? teamDisplayName(repo, config);
}

/**
 * The team's own name, waiting a moment for its settings when they are not read yet (as ownersOfTeam does), so a
 * sentence never names the team by its repository ("Acme product") when bridge.config.json says "Acme Product".
 */
export async function teamNameSoon(repo: string): Promise<string> {
  if (siteConfig().name || !repoContext().hosted) return teamName(repo);
  const { loadTeamData } = await import('./team-data');
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), OWNERS_WAIT_MS));
  await Promise.race([loadTeamData().catch(() => null), late]);
  return teamName(repo);
}

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

/**
 * The people of a team made in Bridge: no GitHub side at all. An admin reads the email members and pending invites
 * from the invites server (as their Bridge account); anyone else on the team reads names and roles from the team.
 */
async function loadKeyMembers(key: string): Promise<MembersData> {
  const [{ getTeam }, { getAccount }] = await Promise.all([import('./entry-session'), import('./account-session')]);
  const [team, info, invites] = await Promise.all([getTeam(key).catch(() => null), getAccount().catch(() => null), invitesAvailable().catch(() => false)]);
  const me = info?.account ?? null;
  const canManage = team?.role === 'admin';
  const base: MembersData = { context: 'real', repo: key, team: team?.name ?? 'Your team', members: [], pending: [], people: [], canManage, personal: false, complete: true, invites, ownersKnown: true };
  if (canManage && invites) {
    try {
      const r = await listInvites(key);
      return { ...base, members: emailMembers(r.members, me?.email), pending: r.invites };
    } catch {
      /* the names below */
    }
  }
  const mine = me ? accountName(me) : null;
  let marked = false;
  const members: Member[] = (team?.people ?? []).map((p, i) => {
    const you = !marked && p.name === mine && (p.role === 'admin') === (team?.role === 'admin');
    if (you) marked = true;
    return { login: `team-member-${i}`, name: p.name, role: p.role, reviews: [], via: 'email' as const, ...(you ? { you: true } : {}) };
  });
  return { ...base, members };
}

/** The people of this page's team. */
export async function loadMembers(): Promise<MembersData> {
  const key = teamKeyOfPage();
  if (key) return loadKeyMembers(key);
  const ctx = repoContext();
  const repo = `${ctx.owner}/${ctx.repo}`;
  const context = membersContext(noRepoPage() ? null : repo, noRepoPage());
  const team = teamName(repo);
  const empty: MembersData = { context, repo, team, members: [], pending: [], people: [], canManage: false, personal: false, complete: true, invites: false };
  if (context === 'none') return empty;
  if (context === 'sample') {
    const s = sampleTeam();
    // The visitor is in Dana's seat: the admin of the sample team. Changes open the demo dialog (never sent).
    return { ...empty, members: s.members, pending: s.pending, people: s.people, canManage: true, complete: true, invites: true };
  }

  const viewer = currentViewer();
  // Bridge's own lists (members by email, invites) never wait on GitHub: a failed access check reads as no access.
  const [access, team0, invites] = await Promise.all([resolveAccess({ owner: ctx.owner, repo: ctx.repo }, { anonymous: ctx.hosted }).catch(() => null), ownersOfTeam(ctx.hosted), invitesAvailable().catch(() => false)]);
  const owners = team0.owners;
  const canManage = Boolean(viewer && access?.admin);
  const names = knownNames();
  const you = (login: string) => Boolean(viewer && loginKey(viewer.login) === loginKey(login));

  // GitHub lists a repository's people to those who can write to it; a reader sees the reviewers from the settings.
  let members: Member[] = [];
  let complete = false;
  if (viewer && getToken() && access?.write && !access.contributor) {
    try {
      const { data } = await ghGet<Collaborator[]>(`/repos/${repo}/collaborators?affiliation=all&per_page=100`);
      members = data.map((c) => {
        const r = roleOf(c, owners);
        return { login: c.login, name: you(c.login) && viewer.name ? viewer.name : personName(c.login, names), role: r.role, reviews: r.reviews, ...(you(c.login) ? { you: true } : {}), ...(c.avatar_url ? { avatar: c.avatar_url } : {}) };
      });
      complete = true;
    } catch {
      complete = false;
    }
  }
  // Anyone else on the team (an email contributor, a GitHub reader) reads the same list through this site's server,
  // which lists them with the Bridge app: read only, and never another member's email.
  let fromServer: Member[] | null = null;
  if (!complete && viewer && access && (access.contributor || access.state === 'reader')) {
    try {
      const { contributeTeam } = await import('./contribute-session');
      const r = await contributeTeam(repo, access.contributor ? null : getToken());
      members = r.collaborators.map((c) => {
        const role = roleOf(c, owners);
        return { login: c.login, name: you(c.login) && viewer.name ? viewer.name : personName(c.login, names), role: role.role, reviews: role.reviews, ...(you(c.login) ? { you: true } : {}), ...(c.avatar_url ? { avatar: c.avatar_url } : {}) };
      });
      fromServer = r.members.map((m, i) =>
        m.you && viewer.email
          ? { login: viewer.email.toLowerCase(), name: m.name, role: m.role, reviews: [], email: viewer.email.toLowerCase(), via: 'email' as const, you: true }
          : { login: `email-member-${i}`, name: m.name, role: m.role, reviews: [], via: 'email' as const },
      );
      members = [...members, ...fromServer];
      complete = true;
    } catch {
      complete = false;
    }
  }
  if (!complete) {
    const logins = [...new Set([...owners.design, ...owners.tech].filter((e) => !e.includes('/')).map((e) => e.replace(/^@/, '')))];
    members = logins.map((login) => {
      const reviews = (['design', 'tech'] as const).filter((g) => owners[g].some((e) => loginKey(e) === loginKey(login)));
      return { login, name: personName(login, names), role: 'reviewer' as const, reviews, ...(you(login) ? { you: true } : {}) };
    });
  }

  // Pending invites and email members come from this site's invites server, which checks the caller: on GitHub for a
  // GitHub member, by their Bridge account for an email admin (access.contributor and admin). An email member who is not
  // admin reads the list above instead. An email admin gets the email members with their emails, to act on them.
  let pending: PendingInvite[] = [];
  let personal = false;
  const emailAdmin = Boolean(access?.contributor && access.admin);
  if (invites && viewer && ((access?.write && !access.contributor) || emailAdmin)) {
    try {
      const r = await listInvites(repo);
      pending = r.invites;
      personal = r.personal;
      const byEmail = emailMembers(r.members, viewer.email);
      if (emailAdmin) members = members.filter((m) => m.via !== 'email');
      const known = new Set(members.map((m) => m.login.toLowerCase()));
      members = [...members, ...byEmail.filter((m) => !known.has(m.login))];
    } catch {
      pending = [];
    }
  }

  // A personal account's repository has no read-only or admin collaborators on GitHub: the picker says so.
  if (canManage && !personal && !emailAdmin) {
    try {
      const { data } = await ghGet<{ owner?: { type?: string } }>(`/repos/${repo}`);
      personal = data.owner?.type === 'User';
    } catch {
      /* unknown: every role stays offered, the server answers for the rest */
    }
  }

  let people: KnownPerson[] = [];
  if (canManage && !emailAdmin) {
    try {
      const { data } = await ghGet<CommitLike[]>(`/repos/${repo}/commits?per_page=100`);
      people = peopleFromCommits(data);
    } catch {
      people = [];
    }
  }
  // The team's name once more: its settings have often landed by now ("Acme Product", not "Acme product").
  return { context, repo, team: teamName(repo), members, pending, people, canManage, personal, complete, invites, ownersKnown: team0.known };
}
