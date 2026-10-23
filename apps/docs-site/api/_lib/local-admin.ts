// Local admins: `npm run dev:full` only (docs/HOSTED.md, "Test everything locally"). On the real site an admin is a
// GitHub admin of the repository, read on GitHub on every call. A laptop without a GitHub App cannot do that, so the
// local scenarios (`npm run dev:scenario`) mark an account as admin of a team here, and api/entry and api/account accept
// it in place of the GitHub check.
//
// Two locks, both needed:
//   1. Only dev/local-api.ts passes `localAdmins` to a handler. The Vercel exports (GET, POST) never do.
//   2. Even when passed, it is ignored unless this process runs local mode: BRIDGE_LOCAL=1, no VERCEL, and
//      NODE_ENV is not production (localAdminsOn). So a stray dependency can never grant admin in production.
//
// Keys (the local Redis file, never Upstash; repository and email lower case):
//   bridge:local:admins:<repo>      set of the emails that are admin of that team
//   bridge:local:admin-of:<email>   set of the teams that email is admin of

import type { Redis } from './redis.js';

const lc = (s: string) => s.trim().toLowerCase();
export const localAdminsKey = (repo: string) => `bridge:local:admins:${lc(repo)}`;
export const localAdminOfKey = (email: string) => `bridge:local:admin-of:${lc(email)}`;

export interface LocalAdmins {
  isAdmin(repo: string, email: string): Promise<boolean>;
  /** The teams this email is admin of, sorted. */
  teamsOf(email: string): Promise<string[]>;
  /** The admins of a team, sorted. */
  adminsOf(repo: string): Promise<string[]>;
  add(repo: string, email: string): Promise<void>;
  /** Forgets every admin seat of this email (account deletion). */
  removeEmail(email: string): Promise<void>;
}

/** True only in local mode: BRIDGE_LOCAL=1, not on Vercel, NODE_ENV not production. */
export function localAdminsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.BRIDGE_LOCAL === '1' && !env.VERCEL && env.NODE_ENV !== 'production';
}

/** The injected local admins when this process runs local mode, else null (production never gets past this). */
export function activeLocalAdmins(injected: LocalAdmins | undefined, env: Record<string, string | undefined> = process.env): LocalAdmins | null {
  return injected && localAdminsOn(env) ? injected : null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').sort() : []);

export function localAdminStore(redis: Redis): LocalAdmins {
  return {
    async isAdmin(repo, email) {
      return Number(await redis.cmd('SISMEMBER', localAdminsKey(repo), lc(email))) === 1;
    },
    async teamsOf(email) {
      return strings(await redis.cmd('SMEMBERS', localAdminOfKey(email)));
    },
    async adminsOf(repo) {
      return strings(await redis.cmd('SMEMBERS', localAdminsKey(repo)));
    },
    async add(repo, email) {
      await redis.pipe([
        ['SADD', localAdminsKey(repo), lc(email)],
        ['SADD', localAdminOfKey(email), lc(repo)],
      ]);
    },
    async removeEmail(email) {
      const repos = strings(await redis.cmd('SMEMBERS', localAdminOfKey(email)));
      await redis.pipe([...repos.map((r) => ['SREM', localAdminsKey(r), lc(email)]), ['DEL', localAdminOfKey(email)]]);
    },
  };
}
