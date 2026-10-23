// The read path of a team's repository through Bridge (docs/HOSTED.md, "Team reads through Bridge"). Members of a
// team who have no GitHub token of their own (email members, Bridge accounts) and signed-out visitors of the public
// demo teams read the repository here, with an installation token of the Bridge GitHub App narrowed to read
// permissions, instead of anonymous browser calls to api.github.com (60 an hour per address). api/contribute wires it
// (its session cookie is scoped to /api/contribute); this file holds the policy, the cache and the limits.
//
// Contract (GET only; JSON errors are { error, message } in Bridge's words):
//   GET /api/contribute?repo=owner/name&gh=<GitHub REST path under /repos/owner/name, URL-encoded>
//       GitHub's status, body, Content-Type, Link and ETag, from the cache when it is fresh. If-None-Match that
//       matches the kept ETag answers 304. X-Bridge-Cache says hit, revalidated, miss or stale.
//   GET /api/contribute?repo=owner/name&blobs=<sha>,<sha>,...   (at most MAX_BATCH full blob shas)
//       { blobs: { <sha>: "<text>" | null } , later: [<sha>...] }  the bodies of these blobs at once (null: GitHub has
//       none), `later` the ones left out to keep the answer under MAX_BATCH_BYTES (ask again).
//
// Policy, deny by default:
//   - read only: GET, and a token narrowed to read permissions (READ_PERMISSIONS, else READ_BASE)
//   - only paths under /repos/<the team> (api/contribute parseTarget: no `..`, no encoded slash), and only the
//     resources of READ_RULES; everything else answers 403 not-allowed (hooks, keys, secrets, invitations, settings...)
//   - who: a member of the team (the team's email session cookie, or a Bridge account that is a member), or anyone for
//     the public demo teams (PUBLIC_TEAMS, and only while GitHub says the repository is public). `collaborators`
//     only for members.
//   - the token never leaves the server; no request header of the browser is passed on (Accept is re-validated).
//
// Cache (Upstash Redis, keys under bridge:read:):
//   bridge:read:get:<repo>:<sha256(accept url)>   { status, etag, type, link, body, at }  a GET answer; fresh for
//                                                 FRESH_MS, then revalidated with If-None-Match (a 304 does not count
//                                                 against GitHub's limit); kept KEEP_S for stale-on-limit
//   bridge:read:blob:<repo>:<sha>                 a blob's text (content-addressed), BLOB_KEEP_S
//   bridge:read:wrote:<repo>                      when a write went through Bridge (api/contribute): older answers
//                                                 are revalidated at once
//   bridge:read:count:<kind>:<who>:<window>       requests per window (READ_WINDOW_S) per address and per team
// Answers that never change (a blob, a tree or a commit by its sha) are also kept in this function's memory.
// Over a limit, or when GitHub says slow down and nothing is kept: 429 { error: 'busy', message: "Bridge is busy, try
// again in N min." } with Retry-After.

import { GITHUB_DOWN, HttpError, SECURITY_HEADERS, clientIp, envInt, json, sha256, type FetchLike } from './http.js';
import type { Redis } from './redis.js';

/** The public demo teams: anyone may read them through Bridge (lower case). Same list as src/lib/demo.ts DEMO_REPOS. */
export const PUBLIC_TEAMS: readonly string[] = ['peterbono/bridge-demo-ds', 'peterbono/ai-design-system-demo'];

/** Read permissions asked for the read token; without some of them on the installation, READ_BASE. */
export const READ_PERMISSIONS = { contents: 'read', pull_requests: 'read', issues: 'read', statuses: 'read', checks: 'read' } as const;
export const READ_BASE = { contents: 'read', pull_requests: 'read', issues: 'read' } as const;

export const FRESH_MS = 30 * 1000;
export const KEEP_S = 10 * 60;
export const IMMUTABLE_KEEP_S = 24 * 60 * 60;
export const BLOB_KEEP_S = 7 * 24 * 60 * 60;
/** Bigger answers are not kept in Redis (one Upstash request carries at most 1 MB). */
export const MAX_KEPT_CHARS = 700_000;
export const MAX_BATCH = 100;
export const MAX_BATCH_BYTES = 3_000_000;
export const READ_WINDOW_S = 10 * 60;
/** Requests per window: per address, per address on a public demo team (no sign-in), per team. */
export const READ_LIMITS = { ip: 1200, guest: 400, team: 6000 } as const;

const API = 'https://api.github.com';
const UA = 'bridge-read';
const SHA = /^[0-9a-f]{40}$/;
const NUMBER = /^[1-9]\d{0,9}$/;

export const READ_WORDS = {
  notAllowed: 'Bridge does not read this from GitHub.',
  signin: 'Sign in to read this team.',
  appMissing: 'Bridge cannot read this design system yet. An admin of the repository gives the Bridge app access to it.',
  busy: (seconds: number) => `Bridge is busy, try again in ${Math.max(1, Math.ceil(seconds / 60))} min.`,
};

/** Who reads: a member of the team, or a visitor of a public demo team. */
export interface Reader {
  kind: 'member' | 'guest';
}

export interface ReadCtx {
  f: FetchLike;
  now: () => number;
  redis: Redis;
  /** Read token for one repository (narrowed to read permissions), or null when the app is not there. */
  token: (owner: string, repo: string) => Promise<string | null>;
  env: { READ_MAX_IP?: string | undefined; READ_MAX_GUEST?: string | undefined; READ_MAX_TEAM?: string | undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// The allow-list

/**
 * Whether a GET of `rest` (the path segments after /repos/<owner>/<repo>, decoded) is allowed for `reader`: the
 * resources Studio and the Library read, nothing else. `*` one segment, `#` a number, `**` one or more segments.
 */
const READ_RULES: { path: string[]; members?: true }[] = [
  { path: [] },
  { path: ['branches'] },
  { path: ['branches', '**'] },
  { path: ['commits'] },
  { path: ['commits', '**'] },
  { path: ['compare', '**'] },
  { path: ['contents'] },
  { path: ['contents', '**'] },
  { path: ['readme'] },
  { path: ['git', 'trees', '*'] },
  { path: ['git', 'blobs', '*'] },
  { path: ['git', 'commits', '*'] },
  { path: ['git', 'ref', '**'] },
  { path: ['git', 'refs', '**'] },
  { path: ['git', 'matching-refs', '**'] },
  { path: ['pulls'] },
  { path: ['pulls', '#'] },
  { path: ['pulls', '#', '*'] },
  { path: ['issues'] },
  { path: ['issues', '#'] },
  { path: ['issues', '#', '*'] },
  { path: ['labels'] },
  { path: ['tags'] },
  { path: ['deployments'] },
  { path: ['deployments', '#', 'statuses'] },
  { path: ['rulesets'] },
  { path: ['rulesets', '#'] },
  { path: ['rules', 'branches', '**'] },
  { path: ['check-runs', '#'] },
  { path: ['actions', 'jobs', '#'] },
  { path: ['actions', 'runs', '#'] },
  { path: ['collaborators'], members: true },
];

function matches(rule: string[], rest: string[]): boolean {
  for (let i = 0; i < rule.length; i++) {
    const r = rule[i]!;
    if (r === '**') return rest.length > i;
    const s = rest[i];
    if (s === undefined) return false;
    if (r === '*') continue;
    if (r === '#' ? !NUMBER.test(s) : r !== s) return false;
  }
  return rest.length === rule.length;
}

export function readAllowed(rest: string[], reader: Reader): boolean {
  return READ_RULES.some((r) => (!r.members || reader.kind === 'member') && matches(r.path, rest));
}

/** Answers that never change: a blob, a tree or a commit by its sha, contents at a full sha, a compare of two shas. */
export function immutable(rest: string[], query: string): boolean {
  const q = new URLSearchParams(query);
  if (rest[0] === 'git' && ['blobs', 'trees', 'commits'].includes(rest[1] ?? '') && SHA.test(rest[2] ?? '')) return true;
  if (rest[0] === 'commits' && rest.length === 2 && SHA.test(rest[1]!)) return true;
  if (rest[0] === 'compare' && rest.length === 2 && /^[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/.test(rest[1]!)) return true;
  if (rest[0] === 'contents' && SHA.test(q.get('ref') ?? '')) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Limits

const windowOf = (now: number) => Math.floor(now / 1000 / READ_WINDOW_S);
const secondsToNextWindow = (now: number) => Math.max(1, (windowOf(now) + 1) * READ_WINDOW_S - Math.floor(now / 1000));

export const countKey = (kind: 'ip' | 'guest' | 'team', who: string, now: number) => `bridge:read:count:${kind}:${who}:${windowOf(now)}`;
export const wroteKey = (repo: string) => `bridge:read:wrote:${repo.toLowerCase()}`;
const getKey = (repo: string, accept: string, url: string) => `bridge:read:get:${repo.toLowerCase()}:${sha256(`${accept} ${url}`).slice(0, 40)}`;
const blobKey = (repo: string, sha: string) => `bridge:read:blob:${repo.toLowerCase()}:${sha}`;

export const busy = (seconds: number): HttpError => new HttpError(429, 'busy', READ_WORDS.busy(seconds), { retryAfter: seconds }, { 'Retry-After': String(seconds) });

/** Notes that a write went through Bridge: answers kept before it are revalidated at once (api/contribute calls it). */
export async function noteWrite(redis: Redis, repo: string, now: number): Promise<void> {
  await redis.cmd('SET', wroteKey(repo), String(now), 'EX', KEEP_S);
}

/**
 * Counts one request (`weight` for a batch) against the address and the team, and reads `extra` keys in the same
 * round trip. Throws busy over a limit. Returns the values of `extra` and the last write time.
 */
async function countAndRead(ctx: ReadCtx, req: Request, full: string, reader: Reader, weight: number, extra: string[]): Promise<{ values: unknown[]; wrote: number }> {
  const now = ctx.now();
  const ip = sha256(`read-ip:${clientIp(req)}`).slice(0, 24);
  const ipKind = reader.kind === 'guest' ? 'guest' : 'ip';
  const keys = [countKey(ipKind, ip, now), countKey('team', full.toLowerCase(), now)];
  const limits = [reader.kind === 'guest' ? envInt(ctx.env.READ_MAX_GUEST, READ_LIMITS.guest) : envInt(ctx.env.READ_MAX_IP, READ_LIMITS.ip), envInt(ctx.env.READ_MAX_TEAM, READ_LIMITS.team)];
  const r = await ctx.redis.pipe([...keys.flatMap((k) => [['INCRBY', k, weight], ['EXPIRE', k, READ_WINDOW_S + 5]]), ['GET', wroteKey(full)], ...extra.map((k) => ['GET', k])]);
  if (keys.some((_, i) => Number(r[i * 2]) > limits[i]!)) throw busy(secondsToNextWindow(now));
  const wrote = Number(r[keys.length * 2]) || 0;
  return { values: r.slice(keys.length * 2 + 1), wrote };
}

// ---------------------------------------------------------------------------------------------------------------
// Memory (immutable answers only), per warm function

interface Kept {
  status: number;
  etag: string | null;
  type: string;
  link: string | null;
  body: string;
  at: number;
}

const MEMORY_MAX_CHARS = 30_000_000;
const memory = new Map<string, string | Kept>();
let memoryChars = 0;

function remember(key: string, v: string | Kept) {
  const size = typeof v === 'string' ? v.length : v.body.length;
  if (size > MEMORY_MAX_CHARS / 10) return;
  const old = memory.get(key);
  if (old !== undefined) {
    memoryChars -= typeof old === 'string' ? old.length : old.body.length;
    memory.delete(key);
  }
  memory.set(key, v);
  memoryChars += size;
  for (const [k, x] of memory) {
    if (memoryChars <= MEMORY_MAX_CHARS) break;
    memory.delete(k);
    memoryChars -= typeof x === 'string' ? x.length : x.body.length;
  }
}

/** Tests start cold. */
export function clearReadMemory() {
  memory.clear();
  memoryChars = 0;
  publicCache.clear();
}

const parseKept = (raw: unknown): Kept | null => {
  if (typeof raw !== 'string') return null;
  try {
    const k = JSON.parse(raw) as Kept;
    return k && typeof k.body === 'string' && Number.isInteger(k.status) && typeof k.at === 'number' ? k : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------------------
// GitHub

const ACCEPT = /^application\/(json|vnd\.github(\.[A-Za-z0-9.+-]+)?)$/;
const PASS_TYPE = /^(application\/(json|vnd\.github[^;]*)|text\/plain)\b/i;

/** GitHub asked to slow down: the seconds to wait, else null. */
function limitedFor(res: Response, now: number): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retry = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retry) && retry > 0) return Math.ceil(retry);
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return Number.isFinite(reset) && reset > 0 ? Math.max(1, reset - Math.floor(now / 1000)) : 60;
  }
  return null;
}

async function upstream(ctx: ReadCtx, url: string, token: string, accept: string, etag: string | null): Promise<Response> {
  try {
    return await ctx.f(url, {
      method: 'GET',
      headers: { Accept: accept, Authorization: `Bearer ${token}`, 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28', ...(etag ? { 'If-None-Match': etag } : {}) },
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
}

/** The read token, or 409 app_missing. */
async function tokenFor(ctx: ReadCtx, owner: string, repo: string): Promise<string> {
  const t = await ctx.token(owner, repo);
  if (!t) throw new HttpError(409, 'app_missing', READ_WORDS.appMissing);
  return t;
}

/** Whether GitHub says the repository is public (a demo team must be, to be read by anyone), kept 10 minutes. */
const publicCache = new Map<string, { at: number; public: boolean }>();
export async function isPublicRepo(ctx: ReadCtx, owner: string, repo: string): Promise<boolean> {
  const k = `${owner}/${repo}`.toLowerCase();
  const hit = publicCache.get(k);
  if (hit && ctx.now() - hit.at < 10 * 60 * 1000) return hit.public;
  const token = await tokenFor(ctx, owner, repo);
  const res = await upstream(ctx, `${API}/repos/${owner}/${repo}`, token, 'application/vnd.github+json', null);
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const wait = limitedFor(res, ctx.now());
  if (wait !== null) throw busy(wait);
  let pub = false;
  if (res.status === 200) {
    const data = (await res.json().catch(() => null)) as { private?: unknown } | null;
    pub = data?.private === false;
  }
  publicCache.set(k, { at: ctx.now(), public: pub });
  return pub;
}

function answer(k: Kept, source: 'hit' | 'revalidated' | 'miss' | 'stale', inm: string | null): Response {
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
    'X-Bridge-Cache': source,
  };
  if (k.etag) headers.ETag = k.etag;
  if (k.link) headers.Link = k.link;
  if (inm && k.etag && inm === k.etag && k.status === 200) return new Response(null, { status: 304, headers });
  headers['Content-Type'] = PASS_TYPE.test(k.type) ? k.type : 'application/octet-stream';
  return new Response(k.status === 204 ? null : k.body, { status: k.status, headers });
}

export interface ReadTarget {
  owner: string;
  repo: string;
  full: string;
  /** Path segments after /repos/<owner>/<repo>, decoded. */
  rest: string[];
  /** The same, as sent (still encoded). */
  rawRest: string[];
  query: string;
}

/** One GitHub GET through the policy and the cache. */
export async function onRead(req: Request, ctx: ReadCtx, t: ReadTarget, reader: Reader): Promise<Response> {
  if (!readAllowed(t.rest, reader)) throw new HttpError(403, 'not-allowed', READ_WORDS.notAllowed);
  const acceptIn = req.headers.get('accept')?.trim() ?? '';
  const accept = ACCEPT.test(acceptIn) ? acceptIn : 'application/vnd.github+json';
  const url = `${API}/repos/${t.owner}/${t.repo}${t.rawRest.length ? `/${t.rawRest.join('/')}` : ''}${t.query ? `?${t.query}` : ''}`;
  const forever = immutable(t.rest, t.query);
  // A cache buster in the query (?t=...) asks for a fresh answer: never kept.
  const keep = !new URLSearchParams(t.query).has('t');
  const key = getKey(t.full, accept, url);
  const inm = req.headers.get('if-none-match');
  const now = ctx.now();

  const mem = forever ? memory.get(key) : undefined;
  const { values, wrote } = await countAndRead(ctx, req, t.full, reader, 1, mem || !keep ? [] : [key]);
  if (mem && typeof mem !== 'string') return answer(mem, 'hit', inm);
  const kept = keep ? parseKept(values[0]) : null;
  if (kept && (forever || (now - kept.at < FRESH_MS && kept.at >= wrote))) {
    if (forever) remember(key, kept);
    return answer(kept, 'hit', inm);
  }

  const token = await tokenFor(ctx, t.owner, t.repo);
  let res: Response;
  try {
    res = await upstream(ctx, url, token, accept, kept?.etag ?? null);
  } catch (e) {
    if (kept) return answer(kept, 'stale', inm);
    throw e;
  }
  const wait = limitedFor(res, now);
  if (wait !== null) {
    if (kept) return answer(kept, 'stale', inm);
    throw busy(wait);
  }
  if (res.status >= 500) {
    if (kept) return answer(kept, 'stale', inm);
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status === 304 && kept) {
    const fresh = { ...kept, at: now };
    if (kept.body.length <= MAX_KEPT_CHARS) await ctx.redis.cmd('SET', key, JSON.stringify(fresh), 'EX', KEEP_S);
    return answer(fresh, 'revalidated', inm);
  }
  const body = res.status === 204 || res.status === 304 ? '' : await res.text();
  const k: Kept = { status: res.status === 304 ? 200 : res.status, etag: res.headers.get('etag'), type: res.headers.get('content-type') ?? '', link: res.headers.get('link'), body, at: now };
  // Answers worth keeping: a success, or a 404 (a missing file stays missing for a while).
  if (keep && (k.status === 200 || k.status === 404)) {
    if (forever && k.status === 200) remember(key, k);
    if (body.length <= MAX_KEPT_CHARS) await ctx.redis.cmd('SET', key, JSON.stringify(k), 'EX', forever && k.status === 200 ? IMMUTABLE_KEEP_S : KEEP_S);
  }
  return answer(k, 'miss', inm);
}

/** Parses `blobs=` (comma separated full shas, at most MAX_BATCH, no repeats). */
export function parseBlobList(v: string | null): string[] {
  const list = (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.length > MAX_BATCH || list.some((s) => !SHA.test(s))) throw new HttpError(400, 'bad_request', `Ask for 1 to ${MAX_BATCH} blobs by their sha.`);
  return [...new Set(list)];
}

/** Many blobs of the team's repository at once: from memory, then Redis, then GitHub (8 at a time). */
export async function onBlobs(req: Request, ctx: ReadCtx, t: Pick<ReadTarget, 'owner' | 'repo' | 'full'>, shas: string[], reader: Reader): Promise<Response> {
  const out: Record<string, string | null> = {};
  const fromMemory = (s: string) => {
    const v = memory.get(blobKey(t.full, s));
    return typeof v === 'string' ? v : undefined;
  };
  const cold = shas.filter((s) => fromMemory(s) === undefined);
  const { values } = await countAndRead(ctx, req, t.full, reader, Math.max(1, Math.ceil(shas.length / 20)), cold.map((s) => blobKey(t.full, s)));
  let bytes = 0;
  const later: string[] = [];
  const add = (s: string, text: string | null) => {
    if (text !== null && bytes + text.length > MAX_BATCH_BYTES && Object.keys(out).length) {
      later.push(s);
      return;
    }
    bytes += text?.length ?? 0;
    out[s] = text;
  };
  const missing: string[] = [];
  for (const s of shas) {
    const m = fromMemory(s);
    if (m !== undefined) {
      add(s, m);
      continue;
    }
    const v = values[cold.indexOf(s)];
    if (typeof v === 'string') {
      remember(blobKey(t.full, s), v);
      add(s, v);
    } else missing.push(s);
  }
  if (missing.length) {
    const token = await tokenFor(ctx, t.owner, t.repo);
    const writes: (string | number)[][] = [];
    let limited: number | null = null;
    let i = 0;
    const worker = async () => {
      while (i < missing.length) {
        const s = missing[i++]!;
        if (limited !== null || bytes > MAX_BATCH_BYTES) {
          later.push(s);
          continue;
        }
        const res = await upstream(ctx, `${API}/repos/${t.owner}/${t.repo}/git/blobs/${s}`, token, 'application/vnd.github.raw', null).catch(() => null);
        if (!res || res.status >= 500) {
          later.push(s);
          continue;
        }
        const wait = limitedFor(res, ctx.now());
        if (wait !== null) {
          limited = wait;
          later.push(s);
          continue;
        }
        if (res.status === 404 || res.status === 422) {
          add(s, null);
          continue;
        }
        if (res.status !== 200) {
          later.push(s);
          continue;
        }
        const text = await res.text();
        remember(blobKey(t.full, s), text);
        if (text.length <= MAX_KEPT_CHARS) writes.push(['SET', blobKey(t.full, s), text, 'EX', BLOB_KEEP_S]);
        add(s, text);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, missing.length) }, worker));
    if (writes.length) await ctx.redis.pipe(writes).catch(() => undefined);
    // GitHub refused every one for its limit: say so instead of an empty answer.
    if (limited !== null && !Object.keys(out).length) throw busy(limited);
  }
  return json(200, { blobs: out, later }, { 'Cache-Control': 'private, no-store' });
}
