// Who is in the team of this page, for Settings > Members and the Invite collaborators dialog (lib/invites.ts has the
// rules). Three contexts, never mixed (lib/invites membersContext):
//   sample  Acme Design (peterbono/bridge-demo-ds): its fixed sample people, no GitHub call at all, so a guest spends
//           none of the 60 reads an hour GitHub gives them. Every change opens the demo dialog instead.
//   real    any other team, Bridge's own included: the repository's people on GitHub (signed in with write access,
//           GitHub lists them; otherwise the reviewers from the settings), pending invites from this site's invites
//           server, and suggestions from the people who committed to the repository.
//   none    the browser workspace, which has no repository yet.
// Who may change anything comes from the session's access (repository admin) and is checked again by the server.
import type { Owners } from '@bridge-ds/core';
import { teamDisplayName } from '../lib/demo';
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

async function ownersOfTeam(hosted: boolean): Promise<Owners> {
  if (hosted) {
    const { loadTeamData } = await import('./team-data');
    try {
      return (await loadTeamData()).model.site.owners;
    } catch {
      return { design: [], tech: [] };
    }
  }
  const o = siteConfig().owners;
  return { design: o?.design ?? [], tech: o?.tech ?? [] };
}

/** The name the team goes by (lib/demo.ts teamDisplayName): its own once its settings are read. */
function teamName(repo: string): string {
  return teamDisplayName(repo, siteConfig());
}

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

/** The people of this page's team. */
export async function loadMembers(): Promise<MembersData> {
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
  const [access, owners, invites] = await Promise.all([resolveAccess({ owner: ctx.owner, repo: ctx.repo }, { anonymous: ctx.hosted }), ownersOfTeam(ctx.hosted), invitesAvailable()]);
  const canManage = Boolean(viewer && access?.admin);
  const names = knownNames();
  const you = (login: string) => Boolean(viewer && loginKey(viewer.login) === loginKey(login));

  // GitHub lists a repository's people to those who can write to it; a reader sees the reviewers from the settings.
  let members: Member[] = [];
  let complete = false;
  if (viewer && getToken() && access?.write) {
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
  if (!complete) {
    const logins = [...new Set([...owners.design, ...owners.tech].filter((e) => !e.includes('/')).map((e) => e.replace(/^@/, '')))];
    members = logins.map((login) => {
      const reviews = (['design', 'tech'] as const).filter((g) => owners[g].some((e) => loginKey(e) === loginKey(login)));
      return { login, name: personName(login, names), role: 'reviewer' as const, reviews, ...(you(login) ? { you: true } : {}) };
    });
  }

  // Pending invites and email contributors come from this site's invites server, which checks the caller on GitHub:
  // an email contributor (access.contributor) has no GitHub account to show it, so they see GitHub's list only.
  let pending: PendingInvite[] = [];
  let personal = false;
  if (invites && viewer && access?.write && !access.contributor) {
    try {
      const r = await listInvites(repo);
      pending = r.invites;
      personal = r.personal;
      const byEmail = emailMembers(r.members, viewer.email);
      const known = new Set(members.map((m) => m.login.toLowerCase()));
      members = [...members, ...byEmail.filter((m) => !known.has(m.login))];
    } catch {
      pending = [];
    }
  }

  // A personal account's repository has no read-only or admin collaborators on GitHub: the picker says so.
  if (canManage && !personal) {
    try {
      const { data } = await ghGet<{ owner?: { type?: string } }>(`/repos/${repo}`);
      personal = data.owner?.type === 'User';
    } catch {
      /* unknown: every role stays offered, the server answers for the rest */
    }
  }

  let people: KnownPerson[] = [];
  if (canManage) {
    try {
      const { data } = await ghGet<CommitLike[]>(`/repos/${repo}/commits?per_page=100`);
      people = peopleFromCommits(data);
    } catch {
      people = [];
    }
  }
  return { context, repo, team, members, pending, people, canManage, personal, complete, invites };
}
