// Email contributors: people with the "Can edit" role who joined with their email, no GitHub account
// (api/contribute). api/invites lists them in Members and removes them; api/contribute reads them on every request.
//
// Keys (Upstash Redis, no expiry: a member stays until an admin removes them):
//   bridge:member:<owner/repo>:<email>   the member (JSON)
//   bridge:members:<owner/repo>          set of their emails
//   bridge:account:teams:<email>         set of the teams that email is a member of (api/account reads it)
// Repository and email are lower case.

import type { Redis } from './redis.js';

export interface EmailMember {
  email: string;
  name: string;
  role: 'edit';
  /** Bumped on every (re)join: a session signed for another version is refused. */
  version: number;
  /** Who invited them (a GitHub login). */
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
    return v && typeof v.email === 'string' && typeof v.name === 'string' && v.role === 'edit' && Number.isInteger(v.version) ? v : null;
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
