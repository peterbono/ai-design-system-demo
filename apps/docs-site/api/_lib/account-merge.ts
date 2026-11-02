// One Gmail mailbox, one Bridge account. Before canonical keys (api/_lib/canonical-email.ts) Bridge keyed people by
// their address lower-cased, so florian.gouloubi@gmail.com and floriangouloubi@gmail.com could become two accounts,
// each with its own memberships, invites and notifications. This moves everything kept under another spelling of a
// mailbox to its canonical key, lazily: api/account calls it on sign-in and on every account read. No batch job.
//
// What it does, for a Gmail address (any other address has one spelling and is left alone):
//   1. Finds every key of that mailbox under another spelling, with one SCAN whose pattern only matches addresses
//      that could be spellings of it (each one checked with canonicalEmail).
//   2. Accounts: the oldest one gives the identity (id, createdAt, name, linked GitHub, notification choices; its
//      address as typed stays the one Bridge shows). Two accounts linked to two different GitHub accounts are never
//      merged: both stay as they are, nothing moves, and one line says so (never an address).
//   3. Moves, writing the canonical key before deleting the old one: memberships (Admin wins on a team both were on),
//      the teams list, the teams the linked GitHub account was found on (ghteams, and the ghteams-of index names the
//      canonical address), invites waiting, join requests, kept notifications and the summary's place on the due
//      list, unsubscribe choices, the changes they sent (Studio's "mine"), connections in Claude (their account reference),
//      local admin seats (npm run dev:full), and teams made in Bridge they created (`createdBy`).
//   4. An empty workspace the newer account made on its own (named "Your workspace" or "<name>'s workspace", no
//      repository, nobody else on it, no invite or request) goes only when the merged account is on another team;
//      otherwise it stays theirs.
//   5. Deletes the old keys, then marks the mailbox done (bridge:account:canon:<hash>), so later reads skip the scan.
// Idempotent and crash-safe: every step is a union or a max, writes come before deletes, and a lock per mailbox
// (bridge:account:merge-lock:<hash>, 60 s) keeps two requests from merging at once. Nothing here logs an address.

import { type Account, accountKey, GITHUB_TEAMS_TTL_S, githubKey, githubTeamOfKey, githubTeamsKey, parseGithubTeams, unionGithubTeams } from './account.js';
import { canonicalEmail, isGmail, legacyEmail, sameEmail } from './canonical-email.js';
import { sha256 } from './http.js';
import { accountTeamsKey, memberKey, membersKey, type EmailMember } from './members.js';
import { DUE_KEY, KEEP_S, YEAR_S } from './notify.js';
import { accountGrantsKey, accountRef, accountRefs, getGrant, repointGrant, revokeTeamGrants } from './oauth.js';
import { globEscape, type Redis } from './redis.js';
import { deleteTeamRecord, forgetTeamKey, getTeamRecord, JOIN_REQUEST_TTL_MS, listRequests, putTeamRecord, requestKey, requestsKey, myRequestsKey } from './teams.js';
import { localAdminOfKey, localAdminsKey } from './local-admin.js';
import { mineKey } from './former-member.js';
import { teamKeyId } from '../../src/lib/team-path.js';
import { invitesByEmailKey, inviteStoreOn, INVITE_TTL_MS, repoKey as invitesKey } from '../invites/index.js';

export type MergeOutcome = 'not-gmail' | 'done-before' | 'none' | 'merged' | 'conflict' | 'busy';

export interface MergeDeps {
  redis: Redis;
  now: () => number;
  /** Where a merge that was refused says so: never an address. */
  warn?: (msg: string) => void;
  /** The lock's token (tests). */
  token?: () => string;
}

export const MERGE_LOCK_S = 60;
const hashOf = (canonical: string) => sha256(`mailbox:${canonical}`).slice(0, 32);
export const mergedKey = (canonical: string) => `bridge:account:canon:${hashOf(canonical)}`;
export const mergeLockKey = (canonical: string) => `bridge:account:merge-lock:${hashOf(canonical)}`;
/** "Your workspace", "Ann's workspace": the name of a workspace made for someone (src/lib/start.ts workspaceName). */
const WORKSPACE_NAME = /^(?:Your workspace|.+'s workspace)$/;

/** Mailboxes this warm function already merged or checked, per Redis connection (tests use several). */
const checked = new WeakMap<Redis, Set<string>>();

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const out = new Set<string>();
  let cursor = '0';
  for (let i = 0; i < 1000; i++) {
    const r = (await redis.cmd('SCAN', cursor, 'MATCH', pattern, 'COUNT', 500)) as [string | number, string[]] | null;
    if (!Array.isArray(r)) break;
    for (const k of r[1] ?? []) out.add(k);
    cursor = String(r[0]);
    if (cursor === '0') break;
  }
  return [...out];
}

/**
 * A SCAN pattern that matches every key ending in a spelling of this Gmail mailbox: the letters of its name in order
 * with anything between them (dots) and after them ("+tag"), at gmail.com or googlemail.com. It matches more than
 * that; each key is checked with canonicalEmail.
 */
export function spellingsPattern(canonical: string): string {
  const local = canonical.slice(0, canonical.indexOf('@'));
  return `bridge:*${[...local].map(globEscape).join('*')}*@g*mail.com`;
}

type Family = 'account' | 'teams' | 'ghteams' | 'member' | 'invites' | 'request' | 'requests-mine' | 'digest' | 'off' | 'mine' | 'local-admin';

/** What a key holds, for the families keyed by email, with the repository when there is one. Null for anything else. */
export function familyOf(key: string): { family: Family; repo: string | null; spelling: string } | null {
  const at = key.lastIndexOf(':');
  const spelling = key.slice(at + 1);
  const head = key.slice(0, at + 1);
  const repoOf = (prefix: string) => {
    if (!head.startsWith(prefix)) return null;
    const repo = head.slice(prefix.length, -1);
    return repo && /^[^/:]+\/[^/:]+$/.test(repo) ? repo : null;
  };
  const fixed: [string, Family][] = [
    ['bridge:account:teams:', 'teams'],
    ['bridge:account:ghteams:', 'ghteams'],
    ['bridge:account:', 'account'],
    ['bridge:invites:email:', 'invites'],
    ['bridge:joinreq:mine:', 'requests-mine'],
    ['bridge:notify:digest:', 'digest'],
    ['bridge:notify:off:', 'off'],
    ['bridge:local:admin-of:', 'local-admin'],
  ];
  for (const [prefix, family] of fixed) if (head === prefix) return { family, repo: null, spelling };
  for (const [prefix, family] of [['bridge:member:', 'member'], ['bridge:joinreq:', 'request'], ['bridge:contrib:mine:', 'mine']] as [string, Family][]) {
    const repo = repoOf(prefix);
    if (repo) return { family, repo, spelling };
  }
  return null;
}

function parseAccount(raw: unknown): Account | null {
  if (typeof raw !== 'string') return null;
  try {
    const a = JSON.parse(raw) as Account;
    return a && typeof a.email === 'string' && typeof a.name === 'string' && typeof a.id === 'string' && Number.isInteger(a.version) ? a : null;
  } catch {
    return null;
  }
}

function parseMember(raw: unknown): EmailMember | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw) as EmailMember;
    return m && typeof m.email === 'string' && typeof m.role === 'string' && Number.isInteger(m.version) ? m : null;
  } catch {
    return null;
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const time = (iso: string | undefined) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * The account the merged mailbox keeps: the oldest one's identity, and what it never set taken from the others (its
 * name while it was only a stand-in, AI tools, time zone, GitHub when only another one has it). Its notification
 * choices stay its own. Never asked with two different GitHub ids (the caller refuses that first).
 */
export function mergedAccount(canonical: string, accounts: readonly { a: Account; atCanonical: boolean }[]): Account {
  const sorted = [...accounts].sort((x, y) => time(x.a.createdAt) - time(y.a.createdAt) || Number(y.atCanonical) - Number(x.atCanonical));
  const oldest = sorted[0]!.a;
  const others = sorted.slice(1).map((x) => x.a);
  const typed = oldest.displayEmail || (legacyEmail(oldest.email) !== canonical ? legacyEmail(oldest.email) : '');
  const named = oldest.nameSet === false ? others.find((o) => o.nameSet !== false) : undefined;
  const { displayEmail: _d, ...base } = oldest;
  const aiTools = oldest.aiTools ?? others.find((o) => o.aiTools)?.aiTools;
  const tz = oldest.tz ?? others.find((o) => o.tz)?.tz;
  return {
    ...base,
    email: canonical,
    ...(typed ? { displayEmail: typed } : {}),
    ...(named ? { name: named.name, nameSet: true } : {}),
    github: oldest.github ?? others.find((o) => o.github)?.github ?? null,
    version: Math.max(...accounts.map((x) => x.a.version)),
    ...(aiTools ? { aiTools } : {}),
    ...(tz ? { tz } : {}),
  };
}

/** Two memberships of one mailbox on one team: the older one, with Admin when either was. */
function mergedMember(a: EmailMember, b: EmailMember): EmailMember {
  const [older, newer] = time(a.at) <= time(b.at) ? [a, b] : [b, a];
  return { ...older, role: older.role === 'admin' || newer.role === 'admin' ? 'admin' : older.role, version: Math.max(a.version, b.version) };
}

/**
 * Merges every spelling of the mailbox of `email` into its canonical key (see the top of this file). Answers what
 * happened; `merged` and `none` mark the mailbox done.
 */
export async function mergeEmailAccounts(d: MergeDeps, email: string): Promise<MergeOutcome> {
  if (!isGmail(email)) return 'not-gmail';
  const { redis } = d;
  const c = canonicalEmail(email);
  const memo = checked.get(redis) ?? new Set<string>();
  checked.set(redis, memo);
  if (memo.has(c)) return 'done-before';
  if (typeof (await redis.cmd('GET', mergedKey(c))) === 'string') {
    memo.add(c);
    return 'done-before';
  }
  const token = d.token ? d.token() : sha256(`${c}:${d.now()}:${Math.random()}`).slice(0, 24);
  if ((await redis.cmd('SET', mergeLockKey(c), token, 'NX', 'EX', MERGE_LOCK_S)) === null) return 'busy';
  try {
    const outcome = await mergeLocked(d, c);
    if (outcome !== 'busy') {
      await redis.cmd('SET', mergedKey(c), outcome === 'conflict' ? 'conflict' : 'merged');
      memo.add(c);
    }
    return outcome;
  } finally {
    if ((await redis.cmd('GET', mergeLockKey(c))) === token) await redis.cmd('DEL', mergeLockKey(c));
  }
}

async function mergeLocked(d: MergeDeps, c: string): Promise<MergeOutcome> {
  const { redis } = d;
  const now = d.now();
  const found = (await scanKeys(redis, spellingsPattern(c)))
    .map((key) => ({ key, f: familyOf(key) }))
    .filter((x): x is { key: string; f: NonNullable<ReturnType<typeof familyOf>> } => x.f !== null && x.f.spelling !== c && canonicalEmail(x.f.spelling) === c);
  const old = (family: Family) => found.filter((x) => x.f.family === family);
  const spellings = [...new Set(found.map((x) => x.f.spelling))];

  // Accounts: the canonical one and every other spelling.
  const oldAccounts = old('account');
  const raw = (await redis.cmd('MGET', accountKey(c), ...oldAccounts.map((x) => x.key))) as unknown[] | null;
  const accounts: { a: Account; atCanonical: boolean; spelling: string }[] = [];
  const atC = parseAccount(raw?.[0]);
  if (atC) accounts.push({ a: atC, atCanonical: true, spelling: c });
  oldAccounts.forEach((x, i) => {
    const a = parseAccount(raw?.[i + 1]);
    if (a) accounts.push({ a, atCanonical: false, spelling: x.f.spelling });
  });
  const githubIds = new Set(accounts.map((x) => x.a.github?.id).filter((id): id is number => Number.isSafeInteger(id)));
  if (githubIds.size > 1) {
    (d.warn ?? ((m: string) => console.warn(m)))('account merge: one mailbox has two accounts linked to different GitHub accounts; both kept as they are');
    return 'conflict';
  }
  if (!found.length) return 'none';

  // The account first: the canonical key holds the merged identity before anything else moves.
  let merged: Account | null = null;
  if (accounts.length) {
    merged = mergedAccount(c, accounts);
    await redis.cmd('SET', accountKey(c), JSON.stringify(merged));
    if (merged.github) await redis.cmd('SET', githubKey(merged.github.id), c);
  }
  // The spellings of the accounts that did not keep their identity (their workspace may go, step 4).
  const keptId = merged?.id;
  const lost = new Set(accounts.filter((x) => x.a.id !== keptId).map((x) => legacyEmail(x.a.email)));

  // The teams list and the memberships.
  for (const { key } of old('teams')) {
    const repos = strings(await redis.cmd('SMEMBERS', key));
    if (repos.length) await redis.cmd('SADD', accountTeamsKey(c), ...repos);
    await redis.cmd('DEL', key);
  }
  for (const { key, f } of old('member')) {
    const repo = f.repo!;
    const [vRaw, cRaw] = (await redis.cmd('MGET', key, memberKey(repo, c))) as unknown[];
    const v = parseMember(vRaw);
    const kept = parseMember(cRaw);
    if (v) {
      const next = kept ? mergedMember(kept, v) : v;
      await redis.pipe([
        ['SET', memberKey(repo, c), JSON.stringify(next)],
        ['SADD', membersKey(repo), c],
        ['SADD', accountTeamsKey(c), repo],
      ]);
    }
    await redis.pipe([
      ['SREM', membersKey(repo), f.spelling],
      ['DEL', key],
    ]);
  }

  // The repositories the linked GitHub account was found on (api/entry ?linked=): one list, the latest read per
  // repository; the reverse index names the canonical address.
  for (const { key, f } of old('ghteams')) {
    const [vRaw, cRaw] = (await redis.cmd('MGET', key, githubTeamsKey(c))) as unknown[];
    const v = parseGithubTeams(vRaw);
    const all = unionGithubTeams(parseGithubTeams(cRaw), v);
    if (Object.keys(all).length) await redis.cmd('SET', githubTeamsKey(c), JSON.stringify(all), 'EX', GITHUB_TEAMS_TTL_S);
    for (const repo of Object.keys(v)) {
      await redis.pipe([
        ['SADD', githubTeamOfKey(repo), c],
        ['EXPIRE', githubTeamOfKey(repo), GITHUB_TEAMS_TTL_S],
        ['SREM', githubTeamOfKey(repo), f.spelling],
      ]);
    }
    await redis.cmd('DEL', key);
  }

  // Invites waiting for the mailbox.
  for (const { key } of old('invites')) {
    const refs = strings(await redis.cmd('SMEMBERS', key));
    if (refs.length) await redis.pipe([['SADD', invitesByEmailKey(c), ...refs], ['EXPIRE', invitesByEmailKey(c), Math.ceil(INVITE_TTL_MS / 1000)]]);
    await redis.cmd('DEL', key);
  }

  // Join requests: a live one moves unless one already waits under the canonical key.
  for (const { key, f } of old('request')) {
    const repo = f.repo!;
    const r = await redis.cmd('GET', key);
    let expiresAt = 0;
    try {
      expiresAt = typeof r === 'string' ? time((JSON.parse(r) as { expiresAt?: string }).expiresAt) : 0;
    } catch {
      expiresAt = 0;
    }
    const left = Math.ceil((expiresAt - now) / 1000);
    if (typeof r === 'string' && left > 0 && (await redis.cmd('GET', requestKey(repo, c))) === null) {
      await redis.pipe([
        ['SET', requestKey(repo, c), r, 'EX', left],
        ['ZADD', requestsKey(repo), expiresAt, c],
        ['SADD', myRequestsKey(c), repo],
        ['EXPIRE', myRequestsKey(c), Math.ceil((2 * JOIN_REQUEST_TTL_MS) / 1000)],
      ]);
    }
    await redis.pipe([
      ['ZREM', requestsKey(repo), f.spelling],
      ['DEL', key],
    ]);
  }
  for (const { key } of old('requests-mine')) {
    const repos = strings(await redis.cmd('SMEMBERS', key));
    if (repos.length) await redis.pipe([['SADD', myRequestsKey(c), ...repos], ['EXPIRE', myRequestsKey(c), Math.ceil((2 * JOIN_REQUEST_TTL_MS) / 1000)]]);
    await redis.cmd('DEL', key);
  }

  // Notifications: kept notices, the summary's place on the due list, unsubscribe choices.
  const digestC = `bridge:notify:digest:${c}`;
  for (const { key } of old('digest')) {
    const items = strings(await redis.cmd('ZRANGE', key, 0, -1));
    const pairs = items.flatMap((it) => {
      let at = now;
      try {
        const v = JSON.parse(it) as { at?: unknown };
        if (typeof v.at === 'number') at = v.at;
      } catch {
        /* now */
      }
      return [at, it];
    });
    if (pairs.length) await redis.pipe([['ZADD', digestC, ...pairs], ['EXPIRE', digestC, KEEP_S]]);
    await redis.cmd('DEL', key);
  }
  for (const s of spellings) {
    const due = await redis.cmd('ZSCORE', DUE_KEY, s);
    if (due !== null && due !== undefined) {
      await redis.cmd('ZADD', DUE_KEY, 'NX', Number(due), c);
      await redis.cmd('ZREM', DUE_KEY, s);
    }
  }
  for (const { key } of old('off')) {
    const v = await redis.cmd('GET', key);
    if (typeof v === 'string') await redis.cmd('SET', `bridge:notify:off:${c}`, v, 'NX');
    await redis.cmd('DEL', key);
  }

  // The changes they sent through Bridge (who owns each branch or number is compared with sameEmail, kept as is).
  for (const { key, f } of old('mine')) {
    const items = strings(await redis.cmd('SMEMBERS', key));
    const to = mineKey(f.repo!, c);
    if (items.length) await redis.pipe([['SADD', to, ...items], ['EXPIRE', to, YEAR_S]]);
    await redis.cmd('DEL', key);
  }

  // Local admin seats (npm run dev:full only).
  for (const { key, f } of old('local-admin')) {
    const repos = strings(await redis.cmd('SMEMBERS', key));
    if (repos.length) {
      await redis.pipe([
        ['SADD', localAdminOfKey(c), ...repos],
        ...repos.flatMap((r) => [['SADD', localAdminsKey(r), c], ['SREM', localAdminsKey(r), f.spelling]]),
      ]);
    }
    await redis.cmd('DEL', key);
  }

  // Connections in Claude: grants made under an older spelling name the canonical account from now on.
  const refC = accountRef(c);
  for (const s of spellings) {
    const ref = accountRefs(s)[0]!;
    if (ref === refC) continue;
    for (const id of strings(await redis.cmd('SMEMBERS', accountGrantsKey(ref)))) {
      const g = await getGrant(redis, id);
      if (g && g.account === ref) await repointGrant(redis, g, refC);
    }
    await redis.cmd('DEL', accountGrantsKey(ref));
  }

  // Teams made in Bridge: created by the canonical account from now on; an empty workspace of a merged-away account
  // goes when the account is on another team.
  const teams = strings(await redis.cmd('SMEMBERS', accountTeamsKey(c)));
  const made: { key: string; rec: NonNullable<Awaited<ReturnType<typeof getTeamRecord>>> }[] = [];
  for (const key of teams) {
    const id = teamKeyId(key);
    const rec = id ? await getTeamRecord(redis, id) : null;
    if (rec && sameEmail(rec.createdBy, c)) made.push({ key, rec });
  }
  const invites = inviteStoreOn(redis, d.now);
  const removable: typeof made = [];
  for (const t of made) {
    if (!lost.has(legacyEmail(t.rec.createdBy)) || t.rec.repo || t.rec.storybook || !WORKSPACE_NAME.test(t.rec.name)) continue;
    const people = strings(await redis.cmd('SMEMBERS', membersKey(t.key)));
    if (people.some((p) => !sameEmail(p, c))) continue;
    if ((await invites.list(t.key)).length || (await listRequests(redis, t.key, now)).length) continue;
    removable.push(t);
  }
  // Another team the account is really on (its membership is there), not one of those workspaces.
  const elsewhere: string[] = [];
  for (const k of teams) if (!removable.some((t) => t.key === k) && (await redis.cmd('GET', memberKey(k, c))) !== null) elsewhere.push(k);
  for (const t of made) {
    if (removable.includes(t) && elsewhere.length) {
      await revokeTeamGrants(redis, t.key);
      await redis.pipe([
        ['DEL', memberKey(t.key, c)],
        ['DEL', membersKey(t.key)],
        ['DEL', invitesKey(t.key)],
        ['SREM', accountTeamsKey(c), t.key],
      ]);
      await forgetTeamKey(redis, t.key, now);
      await deleteTeamRecord(redis, t.rec);
    } else if (t.rec.createdBy !== c) {
      await putTeamRecord(redis, { ...t.rec, createdBy: c });
    }
  }

  // Last, the old account records: everything they held lives under the canonical key now.
  for (const { key } of oldAccounts) await redis.cmd('DEL', key);
  return 'merged';
}

