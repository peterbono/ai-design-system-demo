// Team discovery by work domain and join requests (api/entry). Kept apart from the function so api/account can delete
// a person's requests with their account without bundling api/entry.
//
// Keys (Upstash Redis, the same database as accounts, invites and members; repository, email and domain lower case):
//   bridge:team:discovery:<repo>        { domain, enabled, byGithubId, byLogin, byName, at }  an admin's choice, no expiry
//   bridge:team:domain:<domain>         set of "owner/repo" open to people with that work domain (enabled only)
//   bridge:joinreq:<repo>:<email>       a pending request { id, repo, email, name, createdAt, expiresAt }, 14 days
//   bridge:joinreqs:<repo>              sorted set of requester emails by expiry (ms)
//   bridge:joinreq:mine:<email>         set of the teams that email asked to join, 14 days after the last request
//   bridge:joinreq:count:<kind>:<who>:<day>   daily caps, 2 days
//   bridge:joinreq:undo:<repo>:<id>     an approve or decline the admin can still undo { request, approved, added }, 30 s
//   bridge:team:name:<repo>             { name, at }  the team's bridge.config.json `name` as last read, no expiry

import type { Redis } from './redis.js';

export interface Discovery {
  domain: string;
  enabled: boolean;
  /** The admin who chose it: their GitHub id and login, and the display name kept then (older records have none: the
   *  Bridge account name is read live, else the login). No email. */
  byGithubId: number;
  byLogin: string;
  byName?: string;
  at: string;
}

export interface JoinRequest {
  id: string;
  repo: string;
  email: string;
  name: string;
  createdAt: string;
  expiresAt: string;
}

export const JOIN_REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const lc = (s: string) => s.trim().toLowerCase();
export const discoveryKey = (repo: string) => `bridge:team:discovery:${lc(repo)}`;
export const domainKey = (domain: string) => `bridge:team:domain:${lc(domain)}`;
export const requestKey = (repo: string, email: string) => `bridge:joinreq:${lc(repo)}:${lc(email)}`;
export const requestsKey = (repo: string) => `bridge:joinreqs:${lc(repo)}`;
export const myRequestsKey = (email: string) => `bridge:joinreq:mine:${lc(email)}`;
export const undoKey = (repo: string, id: string) => `bridge:joinreq:undo:${lc(repo)}:${id}`;
export const teamNameKey = (repo: string) => `bridge:team:name:${lc(repo)}`;

/** How long an admin can take back an approve or decline (the home's Undo toast is shorter). */
export const UNDO_TTL_S = 30;
/** A stored team name older than this is read again from bridge.config.json when GitHub can be asked. */
export const TEAM_NAME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parse<T>(raw: unknown, ok: (v: any) => boolean): T | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return v && ok(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

const isDiscovery = (v: any) => typeof v.domain === 'string' && typeof v.enabled === 'boolean' && Number.isSafeInteger(v.byGithubId);
const isRequest = (v: any) => typeof v.id === 'string' && typeof v.repo === 'string' && typeof v.email === 'string' && typeof v.expiresAt === 'string';

export async function getDiscovery(redis: Redis, repo: string): Promise<Discovery | null> {
  return parse<Discovery>(await redis.cmd('GET', discoveryKey(repo)), isDiscovery);
}

/** Saves the choice and keeps the domain index in step (a team is in at most one domain set: the one it chose). */
export async function putDiscovery(redis: Redis, repo: string, d: Discovery): Promise<void> {
  const prev = await getDiscovery(redis, repo);
  const r = lc(repo);
  await redis.pipe([
    ...(prev && prev.domain !== d.domain ? [['SREM', domainKey(prev.domain), r]] : []),
    ['SET', discoveryKey(r), JSON.stringify({ ...d, domain: lc(d.domain) })],
    d.enabled ? ['SADD', domainKey(d.domain), r] : ['SREM', domainKey(d.domain), r],
  ]);
}

/** The teams open to a work domain: in the index and still enabled for that very domain (stale entries are dropped). */
export async function teamsForDomain(redis: Redis, domain: string): Promise<{ repo: string; discovery: Discovery }[]> {
  const raw = await redis.cmd('SMEMBERS', domainKey(domain));
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').sort() : [];
  const out: { repo: string; discovery: Discovery }[] = [];
  for (const repo of repos) {
    const d = await getDiscovery(redis, repo);
    if (d && d.enabled && d.domain === lc(domain)) out.push({ repo, discovery: d });
    else await redis.cmd('SREM', domainKey(domain), repo);
  }
  return out;
}

export async function getRequest(redis: Redis, repo: string, email: string, now: number): Promise<JoinRequest | null> {
  const r = parse<JoinRequest>(await redis.cmd('GET', requestKey(repo, email)), isRequest);
  return r && Date.parse(r.expiresAt) > now ? r : null;
}

export async function putRequest(redis: Redis, r: JoinRequest, now: number): Promise<void> {
  const ttl = Math.max(1, Math.ceil((Date.parse(r.expiresAt) - now) / 1000));
  await redis.pipe([
    ['SET', requestKey(r.repo, r.email), JSON.stringify(r), 'EX', ttl],
    ['ZADD', requestsKey(r.repo), Date.parse(r.expiresAt), lc(r.email)],
    ['SADD', myRequestsKey(r.email), lc(r.repo)],
    ['EXPIRE', myRequestsKey(r.email), Math.ceil(JOIN_REQUEST_TTL_MS / 1000)],
  ]);
}

export async function removeRequest(redis: Redis, repo: string, email: string): Promise<void> {
  await redis.pipe([
    ['DEL', requestKey(repo, email)],
    ['ZREM', requestsKey(repo), lc(email)],
    ['SREM', myRequestsKey(email), lc(repo)],
  ]);
}

/** The team's pending requests, oldest first; expired ones are dropped from the index. */
export async function listRequests(redis: Redis, repo: string, now: number): Promise<JoinRequest[]> {
  const [, emails] = await redis.pipe([
    ['ZREMRANGEBYSCORE', requestsKey(repo), '-inf', now],
    ['ZRANGE', requestsKey(repo), 0, -1],
  ]);
  const list = Array.isArray(emails) ? emails.filter((x): x is string => typeof x === 'string') : [];
  const out: JoinRequest[] = [];
  for (const email of list) {
    const r = await getRequest(redis, repo, email, now);
    if (r) out.push(r);
    else await redis.cmd('ZREM', requestsKey(repo), email);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The teams this email has a pending request for. */
export async function myRequests(redis: Redis, email: string, now: number): Promise<Set<string>> {
  const raw = await redis.cmd('SMEMBERS', myRequestsKey(email));
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  const out = new Set<string>();
  for (const repo of repos) if (await getRequest(redis, repo, email, now)) out.add(repo);
  return out;
}

/** Every pending request of an email (account deletion). */
export async function removeAllRequests(redis: Redis, email: string): Promise<void> {
  const raw = await redis.cmd('SMEMBERS', myRequestsKey(email));
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  for (const repo of repos) await removeRequest(redis, repo, email);
  await redis.cmd('DEL', myRequestsKey(email));
}

// ---------------------------------------------------------------------------------------------------------------
// Undo of an approve or decline (the home's join request rows)

export interface Decided {
  request: JoinRequest;
  approved: boolean;
  /** The approve made them a member (they were not one already): undo removes them again. */
  added: boolean;
}

export async function putDecided(redis: Redis, d: Decided): Promise<void> {
  await redis.cmd('SET', undoKey(d.request.repo, d.request.id), JSON.stringify(d), 'EX', UNDO_TTL_S);
}

/** The decision to undo, read once: a second undo finds nothing. */
export async function takeDecided(redis: Redis, repo: string, id: string): Promise<Decided | null> {
  const raw = await redis.cmd('GETDEL', undoKey(repo, id));
  const d = parse<Decided>(raw, (v) => typeof v.approved === 'boolean' && typeof v.added === 'boolean' && v.request && isRequest(v.request));
  return d && lc(d.request.repo) === lc(repo) ? d : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Team names: bridge.config.json `name`, kept with the team when a function reads it (invites, contributions, entry)

/** bridge.config.json `name`: 1 to 60 characters once trimmed (the schema), anything else is no name. */
export function configName(config: unknown): string | null {
  const name = config && typeof config === 'object' ? (config as { name?: unknown }).name : undefined;
  if (typeof name !== 'string') return null;
  const t = name.trim().replace(/\s+/g, ' ');
  return t && t.length <= 60 ? t : null;
}

export interface StoredTeamName {
  name: string;
  at: number;
}

/** The names kept for `repos` (lower case keys); a team without one is absent. */
export async function getTeamNames(redis: Redis, repos: readonly string[]): Promise<Map<string, StoredTeamName>> {
  const out = new Map<string, StoredTeamName>();
  const list = [...new Set(repos.map(lc))];
  if (!list.length) return out;
  const raw = (await redis.cmd('MGET', ...list.map(teamNameKey))) as unknown[] | null;
  list.forEach((repo, i) => {
    const v = parse<StoredTeamName>(raw?.[i], (x) => typeof x.name === 'string' && typeof x.at === 'number');
    const name = v ? configName({ name: v.name }) : null;
    if (v && name) out.set(repo, { name, at: v.at });
  });
  return out;
}

/** Keeps the name a team's settings gave (`null`: the file has none, so the kept one goes). Never throws. */
export async function putTeamName(redis: Redis, repo: string, name: string | null, now: number): Promise<void> {
  try {
    if (name) await redis.cmd('SET', teamNameKey(repo), JSON.stringify({ name, at: now }));
    else await redis.cmd('DEL', teamNameKey(repo));
  } catch {
    // A name is a nicety: the team still goes by its repository in words.
  }
}
