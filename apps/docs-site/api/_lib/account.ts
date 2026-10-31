// Bridge accounts: one per person, identified by email (api/account). The record, its keys and the session cookie
// live here so api/contribute can accept an account session without bundling the whole account function.
//
// Keys (Upstash Redis, the same database as invites and members; emails lower case):
//   bridge:account:<email>                 the account (JSON), no expiry
//   bridge:account:gh:<githubId>           the email of the account that GitHub account is linked to
//   bridge:account:teams:<email>           set of "owner/repo" (or `_team/<id>`, a team made in Bridge) the email is a
//                                          member of (api/_lib/members.ts keeps it)
//   bridge:account:code:<sha256(email+code)>   a sign-in code { email, tries }, 10 minutes
// The session cookie `bridge_account` (Path=/, HttpOnly, Secure, SameSite=Lax, 30 days) is v1.<claims>.<hmac> under
// LIBRARY_SESSION_SECRET with its own purpose; claims { email, v, exp }. Every request reads the account again: a
// version bump (sign out everywhere) or a deleted account ends every session at once.

import type { Redis } from './redis.js';
import type { AiTool } from '../../src/lib/ai-tools.js';
import { cookieAttrs, readCookie, signClaims, verifyClaims } from './session.js';

export interface Account {
  id: string;
  email: string;
  name: string;
  /** False while `name` is a stand-in made from the email: the person is asked their name once (older accounts: set). */
  nameSet?: boolean;
  github: { login: string; id: number } | null;
  createdAt: string;
  /** Bumped by "sign out everywhere": a session signed for another version is refused. */
  version: number;
  /** The AI tools the person uses with Bridge (src/lib/ai-tools.ts); absent while they never answered. */
  aiTools?: AiTool[];
}

export interface AccountClaims {
  email: string;
  v: number;
  exp: number;
}

export const ACCOUNT_COOKIE = 'bridge_account';
export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PURPOSE = 'account-session';

export const accountKey = (email: string) => `bridge:account:${email.trim().toLowerCase()}`;
export const githubKey = (id: number) => `bridge:account:gh:${id}`;
export const codeKey = (hash: string) => `bridge:account:code:${hash}`;

function parseAccount(raw: unknown): Account | null {
  if (typeof raw !== 'string') return null;
  try {
    const a = JSON.parse(raw) as Account;
    return a && typeof a.email === 'string' && typeof a.name === 'string' && typeof a.id === 'string' && Number.isInteger(a.version) ? a : null;
  } catch {
    return null;
  }
}

export async function getAccount(redis: Redis, email: string): Promise<Account | null> {
  return parseAccount(await redis.cmd('GET', accountKey(email)));
}

/** The name of the Bridge account linked to a GitHub id (matched by id, so a renamed login never passes), or null. */
export async function accountNameByGithub(redis: Redis, githubId: number): Promise<string | null> {
  const email = await redis.cmd('GET', githubKey(githubId));
  if (typeof email !== 'string') return null;
  const a = await getAccount(redis, email);
  return a?.github?.id === githubId && a.name.trim() ? a.name.trim() : null;
}

/**
 * The name Bridge shows for a GitHub person (inviter, admin): the first of their GitHub profile name, their Bridge
 * account name, their login. Never an email: a candidate that looks like one is skipped.
 */
export function displayName(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const n = typeof c === 'string' ? c.trim() : '';
    if (n && !n.includes('@')) return n;
  }
  return '';
}

export async function putAccount(redis: Redis, a: Account): Promise<void> {
  await redis.cmd('SET', accountKey(a.email), JSON.stringify(a));
}

const isClaims = (c: any) => typeof c.email === 'string' && Number.isInteger(c.v) && typeof c.exp === 'number';

export const signAccountSession = (c: AccountClaims, secret: string) => signClaims(c, secret, PURPOSE);
export const verifyAccountSession = (value: string, secret: string) => verifyClaims<AccountClaims>(value, secret, PURPOSE, isClaims);

export function issueAccountCookie(a: Account, secret: string, now: number): string {
  const value = signAccountSession({ email: a.email, v: a.version, exp: now + ACCOUNT_SESSION_TTL_MS }, secret);
  return `${ACCOUNT_COOKIE}=${value}; Max-Age=${Math.floor(ACCOUNT_SESSION_TTL_MS / 1000)}; ${cookieAttrs('/')}`;
}

export const clearAccountCookie = () => `${ACCOUNT_COOKIE}=; Max-Age=0; ${cookieAttrs('/')}`;

/** The account behind the request's `bridge_account` cookie: signed here, not expired, same version. Else null. */
export async function sessionAccount(req: Request, redis: Redis, secret: string, now: number): Promise<Account | null> {
  const raw = readCookie(req, ACCOUNT_COOKIE);
  if (!raw) return null;
  const c = verifyAccountSession(raw, secret);
  if (!c || c.exp <= now) return null;
  const a = await getAccount(redis, c.email);
  return a && a.version === c.v && a.email === c.email ? a : null;
}
