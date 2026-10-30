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
//       A request that carries X-Bridge-Missing: 1 (Bridge's own pages) gets GitHub's 404 (a file or branch that is not
//       there, such as a team without a Bridge snapshot) as 200 with X-Bridge-Missing: 1 and GitHub's body, so the
//       browser logs no error for an expected empty state; the page reads it back as the 404 (lib/contribute.ts).
//   GET /api/contribute?repo=owner/name&users=<login>,<login>,...   (members only, at most MAX_USERS logins)
//       { users: { <login lower case>: { login, name, avatar_url, type } | null } }  the public GitHub profile of each
//       login (name and avatar, nothing else), null for one GitHub does not know. Studio names the builders and
//       reviewers of the team with it for a member without GitHub (an email member), instead of anonymous GitHub reads.
//   GET /api/contribute?repo=owner/name&changes=<number>:<head sha>,...   (members only, at most MAX_CHANGES)
//       { changes: { <number>: { <path under the repository, with its query>: { status, body } } } }  every read the
//       status of an open change needs (scripts/pr-status.ts pullStatus: the pull request, its reviews and files, the
//       check runs and commit status of its head), read once on the server and kept FRESH_MS for every member of the
//       team: the home of each member asks once for all its changes instead of five reads per change. A change Bridge
//       could not read (GitHub busy or down, nothing kept) is left out: the page reads it on its own.
//   GET /api/contribute?repo=owner/name&blobs=<sha>,<sha>,...   (at most MAX_BATCH full blob shas)
//       { blobs: { <sha>: "<text>" | null } , later: [<sha>...] }  the bodies of these blobs at once (null: GitHub has
//       none), `later` the ones left out to keep the answer under MAX_BATCH_BYTES (ask again).
//
// Policy, deny by default:
//   - read only: GET, and a token narrowed to read permissions (READ_PERMISSIONS, else READ_BASE)
//   - only paths under /repos/<the team> (api/contribute parseTarget: no `..`, no encoded slash), and only the
//     resources of READ_RULES; everything else answers 403 not-allowed (hooks, keys, secrets, invitations, settings...)
//   - or paths under a product repository the team's bridge.config.json lists (products[].repo, productReposOf, kept
//     PRODUCTS_KEEP_S): the same READ_RULES minus members-only ones, with a read token of that repository, on the
//     team's budget; the app missing there answers 409 product_missing (the page skips that product only); a visitor
//     of a public demo team also needs the product repository to be public
//   - who: a member of the team (the team's email session cookie, or a Bridge account that is a member), or anyone for
//     the public demo teams (PUBLIC_TEAMS, and only while GitHub says the repository is public). `collaborators`
//     only for members.
//   - the token never leaves the server; no request header of the browser is passed on (Accept is re-validated).
//   - another origin (a product's page with the Bridge toolbar) may read gh= and blobs= of a public demo team and its
//     public product repositories, as a visitor: every cookie is ignored, and the answer carries
//     Access-Control-Allow-Origin for that origin only (never credentials) when the team's bridge.config.json names
//     it (previews.production, previews.apps, products[].production and .preview, `{branch}` one host label part) or
//     it is a local dev server (http://localhost). Writes keep their CSRF rule (same origin, X-Bridge-Contribute).
//
// Cache (Upstash Redis, keys under bridge:read:):
//   bridge:read:get:<repo>:<sha256(accept url)>   { status, etag, type, link, body, at }  a GET answer; fresh for
//                                                 FRESH_MS, then revalidated with If-None-Match (a 304 does not count
//                                                 against GitHub's limit); kept KEEP_S for stale-on-limit
//   bridge:read:blob:<repo>:<sha>                 a blob's text (content-addressed), BLOB_KEEP_S
//   bridge:read:change:<repo>:<number>:<sha>      the reads of one change's status { at, reads }, shared by the
//                                                 team's members while fresh (FRESH_MS, and no write since)
//   bridge:read:products:<repo>                  { repos, origins }: the product repositories and the origins of the
//                                                 pages and products its bridge.config.json lists, PRODUCTS_KEEP_S
//   bridge:read:user:<login>                      a public profile { login, name, avatar_url, type } or "null", USER_KEEP_S
//                                                 (public data, shared by every team)
//   bridge:read:wrote:<repo>                      when a write went through Bridge (api/contribute): older answers
//                                                 are revalidated at once
//   bridge:read:count:<kind>:<who>:<window>       requests per window (READ_WINDOW_S): per signed-in member (a hash of
//                                                 their email, so one office behind one address is not one budget),
//                                                 per address for a visitor of a public demo team, and per team
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
/** Changes per status request (an open list page of the home or Branches). */
export const MAX_CHANGES = 20;
/** Logins per people request, and how long a public profile is kept. */
export const MAX_USERS = 30;
export const USER_KEEP_S = 24 * 60 * 60;
export const MAX_BATCH_BYTES = 3_000_000;
export const READ_WINDOW_S = 10 * 60;
/**
 * Requests per window: per signed-in member (`ip` keeps its name: READ_MAX_IP sets it), per address on a public demo
 * team (no sign-in), per team.
 */
export const READ_LIMITS = { ip: 1200, guest: 400, team: 6000 } as const;

const API = 'https://api.github.com';
const UA = 'bridge-read';
const SHA = /^[0-9a-f]{40}$/;
const NUMBER = /^[1-9]\d{0,9}$/;

export const READ_WORDS = {
  notAllowed: 'Bridge does not read this from GitHub.',
  signin: 'Sign in to read this team.',
  appMissing: 'Bridge cannot read this design system yet. An admin of the repository gives the Bridge app access to it.',
  productMissing: 'Bridge cannot read this product yet. An admin connects it in Settings.',
  busy: (seconds: number) => `Bridge is busy, try again in ${Math.max(1, Math.ceil(seconds / 60))} min.`,
};

/** Who reads: a member of the team, or a visitor of a public demo team. */
export interface Reader {
  kind: 'member' | 'guest';
  /**
   * A member's email (lower case): their reads count against their own budget, wherever they read from. Without it
   * (a visitor), the budget is the address's.
   */
  email?: string;
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

export const countKey = (kind: 'ip' | 'member' | 'guest' | 'team', who: string, now: number) => `bridge:read:count:${kind}:${who}:${windowOf(now)}`;
export const wroteKey = (repo: string) => `bridge:read:wrote:${repo.toLowerCase()}`;
const getKey = (repo: string, accept: string, url: string) => `bridge:read:get:${repo.toLowerCase()}:${sha256(`${accept} ${url}`).slice(0, 40)}`;
export const changeKey = (repo: string, n: number, sha: string) => `bridge:read:change:${repo.toLowerCase()}:${n}:${sha}`;
const blobKey = (repo: string, sha: string) => `bridge:read:blob:${repo.toLowerCase()}:${sha}`;
export const userKey = (login: string) => `bridge:read:user:${login.toLowerCase()}`;

export const busy = (seconds: number): HttpError => new HttpError(429, 'busy', READ_WORDS.busy(seconds), { retryAfter: seconds }, { 'Retry-After': String(seconds) });

/** Notes that a write went through Bridge: answers kept before it are revalidated at once (api/contribute calls it). */
export async function noteWrite(redis: Redis, repo: string, now: number): Promise<void> {
  await redis.cmd('SET', wroteKey(repo), String(now), 'EX', KEEP_S);
}

/** Whose budget a read counts against: the signed-in member, else the address. */
export function budgetOf(req: Request, reader: Reader): { kind: 'member' | 'ip' | 'guest'; who: string } {
  const email = reader.kind === 'member' ? reader.email?.trim().toLowerCase() : undefined;
  if (email) return { kind: 'member', who: sha256(`read-member:${email}`).slice(0, 24) };
  return { kind: reader.kind === 'guest' ? 'guest' : 'ip', who: sha256(`read-ip:${clientIp(req)}`).slice(0, 24) };
}

/**
 * Counts one request (`weight` for a batch) against the reader's budget (budgetOf) and the team, and reads `extra`
 * keys in the same round trip. Throws busy over a limit. Returns the values of `extra` and the last write time.
 */
async function countAndRead(ctx: ReadCtx, req: Request, full: string, reader: Reader, weight: number, extra: string[]): Promise<{ values: unknown[]; wrote: number }> {
  const now = ctx.now();
  const budget = budgetOf(req, reader);
  const keys = [countKey(budget.kind, budget.who, now), countKey('team', full.toLowerCase(), now)];
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

/** Request and answer header of a "missing" result: GitHub said 404, answered 200 to a page that asked for it. */
export const MISSING_HEADER = 'X-Bridge-Missing';

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

// ---------------------------------------------------------------------------------------------------------------
// Product repositories of a team

/** How long the team's list of product repositories (and the origins of its products) is kept. */
export const PRODUCTS_KEEP_S = 5 * 60;
export const productsKey = (team: string) => `bridge:read:products:${team.toLowerCase()}`;
const REPO_FULL = /^[\w.-]+\/[\w.-]+$/;

/** What Bridge reads of a team's bridge.config.json for its reads: product repositories and product origins. */
export interface TeamReadConfig {
  /** Product repositories ("owner/name", lower case), never the team's own. */
  repos: string[];
  /** Origin templates of the team's pages and products (https, `{branch}` in the host for previews). */
  origins: string[];
}

/**
 * The https origins a config names for its apps and products: previews.production.*, previews.apps.* and
 * products[].production / products[].preview. A preview template keeps `{branch}` (one host label part).
 */
export function originTemplatesOf(config: unknown): string[] {
  const c = (config && typeof config === 'object' ? config : {}) as {
    previews?: { apps?: Record<string, unknown>; production?: Record<string, unknown> };
    products?: unknown;
  };
  const urls: unknown[] = [...Object.values(c.previews?.production ?? {}), ...Object.values(c.previews?.apps ?? {})];
  if (Array.isArray(c.products)) for (const p of c.products) if (p && typeof p === 'object') urls.push((p as { production?: unknown }).production, (p as { preview?: unknown }).preview);
  const out = new Set<string>();
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    const m = /^https:\/\/([a-z0-9.{}-]+)(?::\d+)?(?:[/?#]|$)/i.exec(u.trim());
    if (!m || !/^[a-z0-9-]+(?:\{branch\}[a-z0-9-]*)?(?:\.[a-z0-9-]+)+$/i.test(m[1]!)) continue;
    out.add(`https://${m[1]!.toLowerCase()}`);
  }
  return [...out];
}

/** A branch as Vercel puts it in a preview host: lower case letters, digits and dashes. */
const BRANCH_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** A page on this computer (a product's dev server): it only ever reads what any visitor of a public team reads. */
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** Whether `origin` (exactly as the browser sends it) is one of `templates`, or a local dev server. */
export function originAllowed(origin: string, templates: readonly string[]): boolean {
  if (LOCAL_ORIGIN.test(origin)) return true;
  const o = origin.toLowerCase();
  return templates.some((t) => {
    if (!t.includes('{branch}')) return o === t;
    const [pre, post] = t.split('{branch}') as [string, string];
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${esc(pre)}${BRANCH_LABEL}${esc(post)}$`).test(o);
  });
}

/**
 * The product repositories and product origins the team's bridge.config.json lists. Read on the default branch with
 * the team's read token, kept PRODUCTS_KEEP_S. A team without the file lists none; a read that fails lists none and is
 * not kept.
 */
export async function teamReadConfigOf(ctx: ReadCtx, owner: string, repo: string): Promise<TeamReadConfig> {
  const full = `${owner}/${repo}`.toLowerCase();
  const kept = await ctx.redis.cmd('GET', productsKey(full));
  if (typeof kept === 'string') {
    try {
      const v = JSON.parse(kept) as Partial<TeamReadConfig>;
      // An entry kept before origins were listed is read again.
      if (v && Array.isArray(v.repos) && Array.isArray(v.origins)) {
        return { repos: v.repos.filter((x): x is string => typeof x === 'string'), origins: v.origins.filter((x): x is string => typeof x === 'string') };
      }
    } catch {
      /* read it again */
    }
  }
  const none: TeamReadConfig = { repos: [], origins: [] };
  // Deny by default: a config Bridge cannot read now (no app, GitHub busy or down) lists nothing, and is not kept.
  const token = await ctx.token(owner, repo).catch(() => null);
  if (!token) return none;
  const res = await upstream(ctx, `${API}/repos/${owner}/${repo}/contents/bridge.config.json`, token, 'application/vnd.github.raw', null).catch(() => null);
  if (!res || (res.status !== 200 && res.status !== 404)) return none;
  let out = none;
  if (res.status === 200) {
    try {
      const config = JSON.parse(await res.text()) as { products?: unknown };
      const repos = Array.isArray(config.products)
        ? [
            ...new Set(
              config.products
                .map((p) => (p && typeof p === 'object' ? (p as { repo?: unknown }).repo : undefined))
                .filter((r): r is string => typeof r === 'string' && REPO_FULL.test(r.trim()))
                .map((r) => r.trim().toLowerCase())
                .filter((r) => r !== full),
            ),
          ]
        : [];
      out = { repos, origins: originTemplatesOf(config) };
    } catch {
      out = none;
    }
  }
  await ctx.redis.cmd('SET', productsKey(full), JSON.stringify(out), 'EX', PRODUCTS_KEEP_S);
  return out;
}

/**
 * The product repositories ("owner/name", lower case) the team's bridge.config.json lists (products[].repo), never
 * the team's own repository (teamReadConfigOf).
 */
export async function productReposOf(ctx: ReadCtx, owner: string, repo: string): Promise<string[]> {
  return (await teamReadConfigOf(ctx, owner, repo)).repos;
}

/**
 * Headers that let a page of another origin read a GET answer: that origin only, never credentials. Only given to an
 * origin the team's config names (originAllowed), and only on reads that ignored every cookie (a visitor's read).
 */
export const corsHeaders = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Expose-Headers': 'ETag, Link, X-Bridge-Cache',
  Vary: 'Origin',
});

/** The Bridge app is not on a product repository: the page leaves that product out, the team's reads go on. */
export const PRODUCT_MISSING = 'product_missing';

/**
 * Whether `reader` (already a reader of the team) may read `product` through the team: the team's bridge.config.json
 * lists it (else 403 not-allowed), the Bridge app is installed on it (else 409 product_missing), and for a visitor of a
 * public demo team GitHub says it is public too (else 403 not-allowed).
 */
export async function productReadAllowed(
  ctx: ReadCtx,
  team: { owner: string; repo: string },
  product: { owner: string; repo: string },
  reader: Reader,
  /** The refusal for an unlisted repository: the caller's own "not allowed" answer for a path outside the team. */
  refuse: () => HttpError = () => new HttpError(403, 'not-allowed', READ_WORDS.notAllowed),
): Promise<void> {
  const listed = await productReposOf(ctx, team.owner, team.repo);
  if (!listed.includes(`${product.owner}/${product.repo}`.toLowerCase())) throw refuse();
  const token = await ctx.token(product.owner, product.repo);
  if (!token) throw new HttpError(409, PRODUCT_MISSING, READ_WORDS.productMissing);
  if (reader.kind === 'guest' && !(await isPublicRepo(ctx, product.owner, product.repo))) throw new HttpError(403, 'not-allowed', READ_WORDS.notAllowed);
}

function answerKept(k: Kept, source: 'hit' | 'revalidated' | 'miss' | 'stale', inm: string | null, missingOk = false): Response {
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
  if (missingOk && k.status === 404) return new Response(k.body, { status: 200, headers: { ...headers, [MISSING_HEADER]: '1' } });
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

/**
 * A kept answer that is not fresh any more (or none): GitHub again, with the kept ETag (a 304 does not count against
 * GitHub's limit), kept for the next reader. GitHub busy or down: what was kept, else busy or unreachable.
 */
async function throughGitHub(ctx: ReadCtx, owner: string, repo: string, url: string, accept: string, key: string, kept: Kept | null, o: { keep: boolean; forever: boolean }): Promise<{ k: Kept; source: 'revalidated' | 'miss' | 'stale' }> {
  const now = ctx.now();
  const token = await tokenFor(ctx, owner, repo);
  let res: Response;
  try {
    res = await upstream(ctx, url, token, accept, kept?.etag ?? null);
  } catch (e) {
    if (kept) return { k: kept, source: 'stale' };
    throw e;
  }
  const wait = limitedFor(res, now);
  if (wait !== null) {
    if (kept) return { k: kept, source: 'stale' };
    throw busy(wait);
  }
  if (res.status >= 500) {
    if (kept) return { k: kept, source: 'stale' };
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status === 304 && kept) {
    const fresh = { ...kept, at: now };
    if (kept.body.length <= MAX_KEPT_CHARS) await ctx.redis.cmd('SET', key, JSON.stringify(fresh), 'EX', KEEP_S);
    return { k: fresh, source: 'revalidated' };
  }
  const body = res.status === 204 || res.status === 304 ? '' : await res.text();
  const k: Kept = { status: res.status === 304 ? 200 : res.status, etag: res.headers.get('etag'), type: res.headers.get('content-type') ?? '', link: res.headers.get('link'), body, at: now };
  // Answers worth keeping: a success, or a 404 (a missing file stays missing for a while).
  if (o.keep && (k.status === 200 || k.status === 404)) {
    if (o.forever && k.status === 200) remember(key, k);
    if (body.length <= MAX_KEPT_CHARS) await ctx.redis.cmd('SET', key, JSON.stringify(k), 'EX', o.forever && k.status === 200 ? IMMUTABLE_KEEP_S : KEEP_S);
  }
  return { k, source: 'miss' };
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
  // GitHub's 404 answered as a 200 "missing" result, for a page that asked for it (MISSING_HEADER).
  const missingOk = req.headers.get(MISSING_HEADER) === '1';
  const answer = (k: Kept, source: 'hit' | 'revalidated' | 'miss' | 'stale', etagIn: string | null) => answerKept(k, source, etagIn, missingOk);
  const now = ctx.now();

  const mem = forever ? memory.get(key) : undefined;
  const { values, wrote } = await countAndRead(ctx, req, t.full, reader, 1, mem || !keep ? [] : [key]);
  if (mem && typeof mem !== 'string') return answer(mem, 'hit', inm);
  const kept = keep ? parseKept(values[0]) : null;
  if (kept && (forever || (now - kept.at < FRESH_MS && kept.at >= wrote))) {
    if (forever) remember(key, kept);
    return answer(kept, 'hit', inm);
  }
  const { k, source } = await throughGitHub(ctx, t.owner, t.repo, url, accept, key, kept, { keep, forever });
  return answer(k, source, inm);
}

// ---------------------------------------------------------------------------------------------------------------
// The status of open changes, read once for the team

/** One change of a status request: its number and the head commit the page knows. */
export interface ChangeRef {
  number: number;
  sha: string;
}

/**
 * The reads one change's status needs, as scripts/pr-status.ts pullStatus asks them (same paths, same queries), so
 * the page answers them from this one request. Fixed resources of the read allow-list, nothing else.
 */
export function changeReads(c: ChangeRef): string[] {
  return [`/pulls/${c.number}`, `/pulls/${c.number}/reviews?per_page=100`, `/pulls/${c.number}/files?per_page=100`, `/commits/${c.sha}/check-runs?per_page=100`, `/commits/${c.sha}/status`];
}

/** Parses `changes=` (comma separated <number>:<full head sha>, at most MAX_CHANGES, no repeats). */
export function parseChangeList(v: string | null): ChangeRef[] {
  const parts = (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out = new Map<number, ChangeRef>();
  for (const p of parts) {
    const m = /^([1-9]\d{0,9}):([0-9a-f]{40})$/.exec(p);
    if (!m) throw new HttpError(400, 'bad_request', `Ask for 1 to ${MAX_CHANGES} changes as number:sha.`);
    out.set(Number(m[1]), { number: Number(m[1]), sha: m[2]! });
  }
  if (!out.size || out.size > MAX_CHANGES) throw new HttpError(400, 'bad_request', `Ask for 1 to ${MAX_CHANGES} changes as number:sha.`);
  return [...out.values()];
}

/** What a change's status reads answered: GitHub's status and body for each path (a success or a 404 only). */
type ChangeReads = Record<string, { status: number; body: string }>;
interface KeptChange {
  at: number;
  reads: ChangeReads;
}

const parseKeptChange = (raw: unknown): KeptChange | null => {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as KeptChange;
    return v && typeof v.at === 'number' && v.reads && typeof v.reads === 'object' ? v : null;
  } catch {
    return null;
  }
};

const STATUS_ACCEPT = 'application/vnd.github+json';

/**
 * The status reads of several open changes, for a member: each change's reads kept together for FRESH_MS (and only
 * until a write through Bridge), shared by every member of the team; past that, each read is checked with GitHub
 * through the same cache as a single read (its ETag, so an unchanged answer does not count against GitHub's limit).
 * Counts one read per change on the member's budget. A change GitHub would not answer (busy, down) is left out.
 */
export async function onChanges(req: Request, ctx: ReadCtx, t: Pick<ReadTarget, 'owner' | 'repo' | 'full'>, changes: ChangeRef[], reader: Reader): Promise<Response> {
  if (reader.kind !== 'member') throw new HttpError(403, 'not-allowed', READ_WORDS.notAllowed);
  const { values, wrote } = await countAndRead(ctx, req, t.full, reader, changes.length, changes.map((c) => changeKey(t.full, c.number, c.sha)));
  const now = ctx.now();
  const out: Record<string, ChangeReads> = {};
  const cold: ChangeRef[] = [];
  changes.forEach((c, i) => {
    const kept = parseKeptChange(values[i]);
    if (kept && now - kept.at < FRESH_MS && kept.at >= wrote) out[c.number] = kept.reads;
    else cold.push(c);
  });
  let limited: number | null = null;
  const urlOf = (path: string) => `${API}/repos/${t.owner}/${t.repo}${path}`;
  const writes: (string | number)[][] = [];
  const readCold = async (c: ChangeRef) => {
    const paths = changeReads(c);
    const keys = paths.map((p) => getKey(t.full, STATUS_ACCEPT, urlOf(p)));
    const kept = (await ctx.redis.pipe(keys.map((k) => ['GET', k]))).map(parseKept);
    const reads: ChangeReads = {};
    for (const [i, path] of paths.entries()) {
      const k0 = kept[i] ?? null;
      let k: Kept;
      if (k0 && now - k0.at < FRESH_MS && k0.at >= wrote) k = k0;
      else {
        try {
          k = (await throughGitHub(ctx, t.owner, t.repo, urlOf(path), STATUS_ACCEPT, keys[i]!, k0, { keep: true, forever: false })).k;
        } catch (e) {
          if (e instanceof HttpError && e.status === 429) limited = Number(e.headers?.['Retry-After']) || 60;
          if (e instanceof HttpError && e.code === 'app_missing') throw e;
          return;
        }
      }
      if (k.status !== 200 && k.status !== 404) return;
      reads[path] = { status: k.status, body: k.body };
    }
    out[c.number] = reads;
    const text = JSON.stringify({ at: now, reads });
    if (text.length <= MAX_KEPT_CHARS) writes.push(['SET', changeKey(t.full, c.number, c.sha), text, 'EX', KEEP_S]);
  };
  let i = 0;
  const worker = async () => {
    while (i < cold.length) await readCold(cold[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(4, cold.length) }, worker));
  if (writes.length) await ctx.redis.pipe(writes).catch(() => undefined);
  if (limited !== null && !Object.keys(out).length) throw busy(limited);
  return json(200, { changes: out }, { 'Cache-Control': 'private, no-store' });
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

// ---------------------------------------------------------------------------------------------------------------
// People: the public profile of the logins Studio shows (builders, reviewers, authors)

/** A GitHub login: letters, digits and single dashes, at most 39 characters; an app's ends in [bot]. */
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})(?:\[bot\])?$/i;

/** What Bridge keeps and answers of a GitHub user: their public name and avatar, nothing else. */
export interface PublicProfile {
  login: string;
  name: string | null;
  avatar_url: string | null;
  type: 'User' | 'Organization' | 'Bot';
}

/** Parses `users=` (comma separated logins, at most MAX_USERS, no repeats, lower case). */
export function parseUserList(v: string | null): string[] {
  const list = (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.length > MAX_USERS || list.some((s) => !LOGIN.test(s))) throw new HttpError(400, 'bad_request', `Ask for 1 to ${MAX_USERS} GitHub people by their login.`);
  return [...new Set(list)];
}

/** Only the public fields Studio shows; anything else GitHub says (email, company, location...) is dropped. */
export function publicProfile(login: string, data: unknown): PublicProfile {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 100) : null;
  const avatar = typeof d.avatar_url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(d.avatar_url) ? d.avatar_url : null;
  const type = d.type === 'Organization' || d.type === 'Bot' ? d.type : 'User';
  return { login: typeof d.login === 'string' && LOGIN.test(d.login) ? d.login : login, name, avatar_url: avatar, type };
}

const parseProfile = (raw: unknown): PublicProfile | null | undefined => {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'null') return null;
  try {
    const p = JSON.parse(raw) as PublicProfile;
    return p && typeof p.login === 'string' ? p : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The public profiles of `logins`, for a member of the team (never a visitor): from Redis, then GitHub with the team's
 * read token (4 at a time). Counts against the member's budget like a blob batch (1 per 20 logins).
 */
export async function onUsers(req: Request, ctx: ReadCtx, t: Pick<ReadTarget, 'owner' | 'repo' | 'full'>, logins: string[], reader: Reader): Promise<Response> {
  if (reader.kind !== 'member') throw new HttpError(403, 'not-allowed', READ_WORDS.notAllowed);
  const { values } = await countAndRead(ctx, req, t.full, reader, Math.max(1, Math.ceil(logins.length / 20)), logins.map(userKey));
  const users: Record<string, PublicProfile | null> = {};
  const missing: string[] = [];
  logins.forEach((l, i) => {
    const kept = parseProfile(values[i]);
    if (kept === undefined) missing.push(l);
    else users[l] = kept;
  });
  if (missing.length) {
    const token = await tokenFor(ctx, t.owner, t.repo);
    const writes: (string | number)[][] = [];
    let limited: number | null = null;
    let i = 0;
    const worker = async () => {
      while (i < missing.length) {
        const l = missing[i++]!;
        if (limited !== null) continue;
        const res = await upstream(ctx, `${API}/users/${encodeURIComponent(l)}`, token, 'application/vnd.github+json', null).catch(() => null);
        if (!res || res.status >= 500) continue;
        const wait = limitedFor(res, ctx.now());
        if (wait !== null) {
          limited = wait;
          continue;
        }
        if (res.status === 404) {
          users[l] = null;
          writes.push(['SET', userKey(l), 'null', 'EX', USER_KEEP_S]);
          continue;
        }
        if (res.status !== 200) continue;
        const p = publicProfile(l, await res.json().catch(() => null));
        users[l] = p;
        writes.push(['SET', userKey(l), JSON.stringify(p), 'EX', USER_KEEP_S]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
    if (writes.length) await ctx.redis.pipe(writes).catch(() => undefined);
    if (limited !== null && !Object.keys(users).length) throw busy(limited);
  }
  // A login GitHub did not answer for (busy, down) is left out: Studio shows the login and asks again later.
  return json(200, { users }, { 'Cache-Control': 'private, no-store' });
}
