// Bridge accounts: one per person, identified by email (api/account). The record, its keys and the session cookie
// live here so api/contribute can accept an account session without bundling the whole account function.
//
// Keys (Upstash Redis, the same database as invites and members; emails canonical, api/_lib/canonical-email.ts: one
// spelling per mailbox, so a Gmail address with or without dots or "+tag" is one account):
//   bridge:account:<email>                 the account (JSON), no expiry. An account written before canonical keys may
//                                          still sit under its address lower-cased until its next sign-in merges it
//                                          (api/_lib/account-merge.ts); getAccount reads both
//   bridge:account:gh:<githubId>           the email of the account that GitHub account is linked to
//   bridge:account:teams:<email>           set of "owner/repo" (or `_team/<id>`, a team made in Bridge) the email is a
//                                          member of (api/_lib/members.ts keeps it)
//   bridge:account:code:<sha256(email+code)>   a sign-in code { email, tries }, 10 minutes
//   bridge:account:ghteams:<email>         { "<owner/repo>": { role, at } } the repositories the linked GitHub account
//                                          was last found admin or editor of (api/entry ?linked=, read with the Bridge
//                                          app and matched by GitHub id), so "Your teams" lists them; 30 days after the
//                                          last read. A display list only: every action checks GitHub again
//   bridge:account:ghteams-of:<repo>       set of the (canonical) emails whose ghteams list that repository (same 30
//                                          days), so deleting or disconnecting the team takes it out of every "Your
//                                          teams"
// The session cookie `bridge_account` (Path=/, HttpOnly, Secure, SameSite=Lax, 30 days) is v1.<claims>.<hmac> under
// LIBRARY_SESSION_SECRET with its own purpose; claims { email, v, exp }. Every request reads the account again: a
// version bump (sign out everywhere) or a deleted account ends every session at once.

import type { Redis } from './redis.js';
import { canonicalEmail, emailSpellings, legacyEmail, sameEmail } from './canonical-email.js';
import type { AiTool } from '../../src/lib/ai-tools.js';
import { canonicalRepo } from '../../src/lib/team-path.js';
import { cookieAttrs, readCookie, signClaims, verifyClaims } from './session.js';

export interface Account {
  id: string;
  /** The canonical address (api/_lib/canonical-email.ts), the key of the account. */
  email: string;
  /** The address as the person typed it, when it is not spelled like `email` (a Gmail address with dots): what Bridge shows. */
  displayEmail?: string;
  name: string;
  /** False while `name` is a stand-in made from the email: the person is asked their name once (older accounts: set). */
  nameSet?: boolean;
  github: { login: string; id: number } | null;
  createdAt: string;
  /** Bumped by "sign out everywhere": a session signed for another version is refused. */
  version: number;
  /** The AI tools the person uses with Bridge (src/lib/ai-tools.ts); absent while they never answered. */
  aiTools?: AiTool[];
  /**
   * What Bridge emails the person about their work (Account > Email, api/_lib/notify.ts); absent: the defaults, things
   * that need them right away and what moved in a daily summary.
   */
  notify?: { needs: 'soon' | 'daily' | 'off'; news: 'daily' | 'off' };
  /** Their IANA time zone, from the browser at sign-in (the daily summary comes at 09:00 there); absent: Europe/Paris. */
  tz?: string;
}

export interface AccountClaims {
  email: string;
  v: number;
  exp: number;
}

export const ACCOUNT_COOKIE = 'bridge_account';
export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PURPOSE = 'account-session';

export const accountKey = (email: string) => `bridge:account:${canonicalEmail(email)}`;
/** Where an account record lives: under its own `email`, canonical for every account written since canonical keys. */
const recordKey = (email: string) => `bridge:account:${legacyEmail(email)}`;
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

/**
 * The account of an email. The spelling given first (an account kept under it from before canonical keys, not merged
 * yet), then the canonical key.
 */
export async function getAccount(redis: Redis, email: string): Promise<Account | null> {
  const spellings = emailSpellings(email);
  if (spellings.length === 1) return parseAccount(await redis.cmd('GET', accountKey(email)));
  const raw = (await redis.cmd('MGET', ...spellings.map((e) => `bridge:account:${e}`))) as unknown[] | null;
  for (const r of raw ?? []) {
    const a = parseAccount(r);
    if (a) return a;
  }
  return null;
}

/** The address Bridge shows for an account: as the person typed it. */
export const shownEmail = (a: Pick<Account, 'email' | 'displayEmail'>): string => a.displayEmail || a.email;

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

/** Saves an account where it lives (its own `email`): an account not merged yet never overwrites another one. */
export async function putAccount(redis: Redis, a: Account): Promise<void> {
  await redis.cmd('SET', recordKey(a.email), JSON.stringify(a));
}

const isClaims = (c: any) => typeof c.email === 'string' && Number.isInteger(c.v) && typeof c.exp === 'number';

export const signAccountSession = (c: AccountClaims, secret: string) => signClaims(c, secret, PURPOSE);
export const verifyAccountSession = (value: string, secret: string) => verifyClaims<AccountClaims>(value, secret, PURPOSE, isClaims);

export function issueAccountCookie(a: Account, secret: string, now: number): string {
  const value = signAccountSession({ email: a.email, v: a.version, exp: now + ACCOUNT_SESSION_TTL_MS }, secret);
  return `${ACCOUNT_COOKIE}=${value}; Max-Age=${Math.floor(ACCOUNT_SESSION_TTL_MS / 1000)}; ${cookieAttrs('/')}`;
}

export const clearAccountCookie = () => `${ACCOUNT_COOKIE}=; Max-Age=0; ${cookieAttrs('/')}`;

/** The email of the request's `bridge_account` session (signed here, not expired), or null. Not the account itself. */
export function sessionEmail(req: Request, secret: string, now: number): string | null {
  const raw = readCookie(req, ACCOUNT_COOKIE);
  const c = raw ? verifyAccountSession(raw, secret) : null;
  return c && c.exp > now ? c.email : null;
}

/** The account behind the request's `bridge_account` cookie: signed here, not expired, same version. Else null. */
export async function sessionAccount(req: Request, redis: Redis, secret: string, now: number): Promise<Account | null> {
  const raw = readCookie(req, ACCOUNT_COOKIE);
  if (!raw) return null;
  const c = verifyAccountSession(raw, secret);
  if (!c || c.exp <= now) return null;
  const a = await getAccount(redis, c.email);
  return a && a.version === c.v && sameEmail(a.email, c.email) ? a : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The teams the linked GitHub account is on, as api/entry last read them (no browser GitHub sign-in needed)

export type GithubTeamRole = 'admin' | 'edit';
export const GITHUB_TEAMS_TTL_S = 30 * 24 * 60 * 60;
export const githubTeamsKey = (email: string) => `bridge:account:ghteams:${canonicalEmail(email)}`;
export const githubTeamOfKey = (repo: string) => `bridge:account:ghteams-of:${repo.trim().toLowerCase()}`;

export type GithubTeams = Record<string, { role: GithubTeamRole; at: number }>;

/** A kept ghteams value, or {} for anything else. */
export function parseGithubTeams(raw: unknown): GithubTeams {
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw) as GithubTeams;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Two lists of one mailbox as one: per repository, the latest read wins. */
export function unionGithubTeams(...lists: GithubTeams[]): GithubTeams {
  const out: GithubTeams = {};
  for (const l of lists) for (const [repo, v] of Object.entries(l)) if (!out[repo] || (v?.at ?? 0) > (out[repo]!.at ?? 0)) out[repo] = v;
  return out;
}

/** The list under the canonical key and, until the next sign-in merges it, under the spelling given. */
async function readGithubTeams(redis: Redis, email: string): Promise<GithubTeams> {
  const spellings = emailSpellings(email);
  if (spellings.length === 1) return parseGithubTeams(await redis.cmd('GET', githubTeamsKey(email)));
  const raw = (await redis.cmd('MGET', ...spellings.map((e) => `bridge:account:ghteams:${e}`))) as unknown[] | null;
  return unionGithubTeams(...(raw ?? []).map(parseGithubTeams));
}

/** Writes the list under the canonical key (or deletes it), and drops a copy kept under an older spelling. */
async function writeGithubTeams(redis: Redis, email: string, all: GithubTeams): Promise<void> {
  if (Object.keys(all).length) await redis.cmd('SET', githubTeamsKey(email), JSON.stringify(all), 'EX', GITHUB_TEAMS_TTL_S);
  else await redis.cmd('DEL', githubTeamsKey(email));
  const legacy = legacyEmail(email);
  if (legacy !== canonicalEmail(email)) await redis.cmd('DEL', `bridge:account:ghteams:${legacy}`);
}

/** Keeps (admin, edit) or forgets (anything else) one repository the linked GitHub account was just read on. */
export async function noteGithubTeam(redis: Redis, email: string, repo: string, role: string | null, now: number): Promise<void> {
  const all = await readGithubTeams(redis, email);
  const k = repo.trim().toLowerCase();
  const had = all[k];
  const e = canonicalEmail(email);
  if (role === 'admin' || role === 'edit') await redis.pipe([['SADD', githubTeamOfKey(k), e], ['EXPIRE', githubTeamOfKey(k), GITHUB_TEAMS_TTL_S]]);
  else await redis.cmd('SREM', githubTeamOfKey(k), ...emailSpellings(email));
  if (role === 'admin' || role === 'edit') all[k] = { role, at: now };
  else if (had) delete all[k];
  else return;
  if (had && had.role === all[k]?.role && now - had.at < 24 * 60 * 60 * 1000) return;
  await writeGithubTeams(redis, email, all);
}

/** The repositories the linked GitHub account was found admin or editor of in the last 30 days, by repository. */
export async function githubTeamsOf(redis: Redis, email: string, now: number): Promise<{ repo: string; role: GithubTeamRole }[]> {
  const all = await readGithubTeams(redis, email);
  // Each repository once, by its current name (src/lib/team-path.ts): one read before a rename or a transfer and one
  // after are the same team, with the higher role.
  const out = new Map<string, GithubTeamRole>();
  for (const [repo, v] of Object.entries(all)) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo) || !(v?.role === 'admin' || v?.role === 'edit') || typeof v.at !== 'number' || now - v.at >= GITHUB_TEAMS_TTL_S * 1000) continue;
    const k = canonicalRepo(repo).toLowerCase();
    if (out.get(k) !== 'admin') out.set(k, v.role);
  }
  return [...out].map(([repo, role]) => ({ repo, role })).sort((a, b) => a.repo.localeCompare(b.repo));
}

/**
 * A team deleted or disconnected from Bridge (api/entry delete-team): it leaves every account's "Your teams" that listed
 * it through GitHub. `extra`: emails to clear as well (the admin who did it). Only Bridge's storage, never GitHub.
 */
export async function forgetGithubTeam(redis: Redis, repo: string, extra: readonly string[] = []): Promise<void> {
  const k = repo.trim().toLowerCase();
  const raw = await redis.cmd('SMEMBERS', githubTeamOfKey(k));
  const emails = new Set([...(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []), ...extra.map((x) => x.trim().toLowerCase())]);
  for (const email of emails) {
    const all = await readGithubTeams(redis, email);
    if (!all[k]) continue;
    delete all[k];
    await writeGithubTeams(redis, email, all);
  }
  await redis.cmd('DEL', githubTeamOfKey(k));
}
