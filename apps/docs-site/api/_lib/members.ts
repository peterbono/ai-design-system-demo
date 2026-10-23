// Email members: people who joined with their email, no GitHub account needed (api/contribute, api/entry). Most are
// "Can edit"; an admin can make one Admin, which covers everything that does not happen on GitHub: members and roles,
// join requests, discovery, team settings and invites by email (Reviewer stays GitHub: approvals happen there). The
// creator of a team made in Bridge before any repository ("Create your team", api/entry) is its first email admin.
// api/invites lists them in Members, changes their role and removes them; api/contribute reads them on every request.
//
// Keys (Upstash Redis, no expiry: a member stays until an admin removes them):
//   bridge:member:<owner/repo>:<email>   the member (JSON)
//   bridge:members:<owner/repo>          set of their emails
//   bridge:account:teams:<email>         set of the teams that email is a member of (api/account reads it)
// Repository and email are lower case. `<owner/repo>` may be the key `_team/<id>` of a team made in Bridge (teams.ts).

import type { Redis } from './redis.js';

/** What an email member can be: Can edit, or Admin (everything that does not need GitHub). */
export type EmailRole = 'edit' | 'admin';
export const EMAIL_ROLES: readonly EmailRole[] = ['edit', 'admin'];

export interface EmailMember {
  email: string;
  name: string;
  role: EmailRole;
  /** Bumped on every (re)join: a session signed for another version is refused. */
  version: number;
  /** Who added them: a GitHub login, or the name of the email admin who did. */
  addedBy: string;
  at: string;
}

export interface MemberStore {
  get(repo: string, email: string): Promise<EmailMember | null>;
  put(repo: string, m: EmailMember): Promise<void>;
  /** Deletes the member and its set entry; true when there was one. Ends their sessions. */
  remove(repo: string, email: string): Promise<boolean>;
  list(repo: string): Promise<EmailMember[]>;
}

export const memberKey = (repo: string, email: string) => `bridge:member:${repo.toLowerCase()}:${email.trim().toLowerCase()}`;
export const membersKey = (repo: string) => `bridge:members:${repo.toLowerCase()}`;
/** The teams one email is a member of: the Bridge account of that email finds its memberships here. */
export const accountTeamsKey = (email: string) => `bridge:account:teams:${email.trim().toLowerCase()}`;

function parseMember(raw: unknown): EmailMember | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as EmailMember;
    return v && typeof v.email === 'string' && typeof v.name === 'string' && (EMAIL_ROLES as readonly string[]).includes(v.role) && Number.isInteger(v.version) ? v : null;
  } catch {
    return null;
  }
}

export function memberStore(redis: Redis): MemberStore {
  return {
    async get(repo, email) {
      return parseMember(await redis.cmd('GET', memberKey(repo, email)));
    },
    async put(repo, m) {
      const email = m.email.trim().toLowerCase();
      await redis.pipe([
        ['SET', memberKey(repo, email), JSON.stringify({ ...m, email })],
        ['SADD', membersKey(repo), email],
        ['SADD', accountTeamsKey(email), repo.toLowerCase()],
      ]);
    },
    async remove(repo, email) {
      const [n] = await redis.pipe([
        ['DEL', memberKey(repo, email)],
        ['SREM', membersKey(repo), email.trim().toLowerCase()],
        ['SREM', accountTeamsKey(email), repo.toLowerCase()],
      ]);
      return Number(n) > 0;
    },
    async list(repo) {
      const emails = await redis.cmd('SMEMBERS', membersKey(repo));
      const list = Array.isArray(emails) ? emails.filter((x): x is string => typeof x === 'string') : [];
      if (!list.length) return [];
      const raw = (await redis.cmd('MGET', ...list.map((e) => memberKey(repo, e)))) as unknown[] | null;
      const out: EmailMember[] = [];
      list.forEach((_, i) => {
        const m = parseMember(raw?.[i]);
        if (m) out.push(m);
      });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
