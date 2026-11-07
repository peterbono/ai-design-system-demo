// Email members: people who joined with their email, no GitHub account needed (api/contribute, api/entry). Most are
// "Can edit"; "Can view" sees everything in Studio and the library and changes nothing (every write path refuses them:
// api/contribute's proxy, api/_lib/team-caller `need: 'edit'`, api/ship); an admin can make one Admin, which covers everything that does not happen on GitHub: members and roles,
// join requests, discovery, team settings and invites by email (Reviewer stays GitHub: approvals happen there). The
// creator of a team made in Bridge before any repository ("Create your team", api/entry) is its first email admin.
// api/invites lists them in Members, changes their role and removes them; api/contribute reads them on every request.
//
// Keys (Upstash Redis, no expiry: a member stays until an admin removes them):
//   bridge:member:<owner/repo>:<email>   the member (JSON)
//   bridge:members:<owner/repo>          set of their emails
//   bridge:account:teams:<email>         set of the teams that email is a member of (api/account reads it)
// Repository lower case, email canonical (api/_lib/canonical-email.ts: one spelling per mailbox). A member written
// before canonical keys may still sit under its address lower-cased: reads try the spelling they hold first, then the
// canonical one, and the next write or the person's next sign-in (api/_lib/account-merge.ts) moves it. The record
// keeps the address as it was given (`email`): what admins see in Members. `<owner/repo>` may be the key `_team/<id>`
// of a team made in Bridge (teams.ts).

import type { Redis } from './redis.js';
import { canonicalEmail, emailSpellings, legacyEmail } from './canonical-email.js';
import { canonicalRepo, repoNames } from '../../src/lib/team-path.js';

/** What an email member can be: Can view (read only), Can edit, or Admin (everything that does not need GitHub). */
export type EmailRole = 'view' | 'edit' | 'admin';
export const EMAIL_ROLES: readonly EmailRole[] = ['view', 'edit', 'admin'];

/** Rank of an email role, to keep the higher one when two memberships meet (a merge, a team moved to its repository). */
const RANK: Record<EmailRole, number> = { view: 0, edit: 1, admin: 2 };
export const higherRole = (a: EmailRole, b: EmailRole): EmailRole => (RANK[a] >= RANK[b] ? a : b);

/** True for an email member who may change things (Can edit or Admin); a Can view member reads only. */
export const memberCanWrite = (m: Pick<EmailMember, 'role'>): boolean => m.role !== 'view';

export interface EmailMember {
  email: string;
  name: string;
  role: EmailRole;
  /** Bumped on every (re)join: a session signed for another version is refused. */
  version: number;
  /** A design lead of the team, given by an admin: they answer on explorations, through api/contribute's policy. Never on GitHub reviews. */
  lead?: boolean;
  /** Who added them: a GitHub login, or the name of the email admin who did. */
  addedBy: string;
  at: string;
}

export interface MemberStore {
  get(repo: string, email: string): Promise<EmailMember | null>;
  put(repo: string, m: EmailMember): Promise<void>;
  /** Deletes the member and its set entry, under every spelling; true when there was one. Ends their sessions. */
  remove(repo: string, email: string): Promise<boolean>;
  list(repo: string): Promise<EmailMember[]>;
}

export const memberKey = (repo: string, email: string) => `bridge:member:${repo.toLowerCase()}:${canonicalEmail(email)}`;
export const membersKey = (repo: string) => `bridge:members:${repo.toLowerCase()}`;
/** The teams one email is a member of: the Bridge account of that email finds its memberships here. */
export const accountTeamsKey = (email: string) => `bridge:account:teams:${canonicalEmail(email)}`;
/** The keys a member of `email` may sit under, by one repository name, the spelling given first (see the note above). */
const memberKeysAt = (repo: string, email: string) => emailSpellings(email).map((e) => `bridge:member:${repo.toLowerCase()}:${e}`);
/**
 * Every name the team went by (src/lib/team-path.ts repoNames: its current name first, then the ones before a rename or
 * a transfer). A membership made before the move stays under its old key: reads find it under the team's current name.
 */
const namesOf = (repo: string): string[] => {
  const names = repoNames(repo);
  return names.includes(repo.toLowerCase()) ? names : [repo.toLowerCase(), ...names];
};
const accountTeamsKeys = (email: string) => emailSpellings(email).map((e) => `bridge:account:teams:${e}`);

/**
 * The teams an email is a member of, as its account sets list them (both spellings until merged). Not read again.
 * Each team once, by its current name: a set entry kept under a name the repository had before a rename is the same team.
 */
export async function teamsInSet(redis: Redis, email: string): Promise<string[]> {
  const keys = accountTeamsKeys(email);
  const raw = await redis.pipe(keys.map((k) => ['SMEMBERS', k]));
  const out = new Set<string>();
  for (const r of raw) if (Array.isArray(r)) for (const x of r) if (typeof x === 'string') out.add(canonicalRepo(x).toLowerCase());
  return [...out];
}

/** Takes a team out of an email's account sets (a membership that is gone), under every name it went by. */
export async function dropTeamFromSet(redis: Redis, email: string, repo: string): Promise<void> {
  const names = namesOf(repo);
  await redis.pipe(accountTeamsKeys(email).map((k) => ['SREM', k, ...names]));
}

/** True when the email's account sets list the team (under its current name or one it had before). */
export async function teamInSet(redis: Redis, email: string, repo: string): Promise<boolean> {
  const names = namesOf(repo);
  const r = await redis.pipe(accountTeamsKeys(email).flatMap((k) => names.map((n) => ['SISMEMBER', k, n])));
  return r.some((x) => Number(x) === 1);
}

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
      // Under the team's current name and every name it had: one membership per name at most (the given spelling
      // first), and the highest role when a person was added both before and after a rename.
      const byName = namesOf(repo).map((n) => memberKeysAt(n, email));
      const keys = byName.flat();
      const raw = keys.length === 1 ? [await redis.cmd('GET', keys[0]!)] : ((await redis.cmd('MGET', ...keys)) as unknown[] | null);
      let best: EmailMember | null = null;
      let i = 0;
      for (const group of byName) {
        let found: EmailMember | null = null;
        for (let j = 0; j < group.length; j++, i++) found ??= parseMember(raw?.[i]);
        if (found && (!best || RANK[found.role] > RANK[best.role])) best = found;
      }
      return best;
    },
    async put(repo, m) {
      // The record keeps the address as given; the keys and the set entries are canonical. A copy under the older
      // spelling goes once the canonical one is written.
      const email = legacyEmail(m.email);
      const key = canonicalEmail(email);
      const r = repo.toLowerCase();
      await redis.pipe([
        ['SET', memberKey(repo, email), JSON.stringify({ ...m, email })],
        ['SADD', membersKey(repo), key],
        ['SADD', accountTeamsKey(email), r],
      ]);
      if (email !== key) {
        await redis.pipe([
          ['DEL', `bridge:member:${r}:${email}`],
          ['SREM', membersKey(repo), email],
          ['SREM', `bridge:account:teams:${email}`, r],
        ]);
      }
    },
    async remove(repo, email) {
      // Every spelling of that mailbox goes, the team's set names them: a member removed never comes back through an
      // older key.
      const listed = await redis.cmd('SMEMBERS', membersKey(repo));
      const mailbox = canonicalEmail(email);
      const others = Array.isArray(listed) ? listed.filter((x): x is string => typeof x === 'string' && canonicalEmail(x) === mailbox) : [];
      const spellings = [...new Set([...emailSpellings(email), ...others.map(legacyEmail)])];
      // Under every name the team went by too: a membership kept under an old name never comes back through get.
      const names = namesOf(repo);
      const dels = names.flatMap((r) => spellings.map((e) => ['DEL', `bridge:member:${r}:${e}`]));
      const res = await redis.pipe([
        ...dels,
        ...names.map((r) => ['SREM', membersKey(r), ...spellings]),
        ...spellings.map((e) => ['SREM', `bridge:account:teams:${e}`, ...names]),
      ]);
      return res.slice(0, dels.length).some((n) => Number(n) > 0);
    },
    async list(repo) {
      const emails = await redis.cmd('SMEMBERS', membersKey(repo));
      const list = Array.isArray(emails) ? emails.filter((x): x is string => typeof x === 'string') : [];
      if (!list.length) return [];
      // One per mailbox: an older spelling and the canonical one of the same person count once.
      const byMailbox = new Map<string, string[]>();
      for (const e of list) {
        const k = canonicalEmail(e);
        byMailbox.set(k, [...new Set([...(byMailbox.get(k) ?? []), ...memberKeysAt(repo, e)])]);
      }
      const keys = [...byMailbox.values()].flat();
      const raw = (await redis.cmd('MGET', ...keys)) as unknown[] | null;
      const found = new Map<string, EmailMember>();
      keys.forEach((k, i) => {
        const m = parseMember(raw?.[i]);
        const mailbox = m ? canonicalEmail(m.email) : '';
        if (m && !found.has(mailbox) && byMailbox.has(mailbox)) found.set(mailbox, m);
      });
      return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

/** Who approves an exploration: a design lead or an admin, and nobody else. */
export const approves = (m: Pick<EmailMember, 'role' | 'lead'> | null | undefined): boolean => Boolean(m && (m.lead || m.role === 'admin'));
