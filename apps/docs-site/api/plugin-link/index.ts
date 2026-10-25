// /api/plugin-link: "Sign in with Bridge" in the Figma plugin (docs/SIGN-IN.md, "The Figma plugin"). The designer never
// pastes a token: the plugin opens Studio with a one-time code, the designer signs in there with the account they
// already have and picks the team, and the plugin receives the team's repository and the GitHub sign-in Studio holds.
//
//   POST { action: "start" }                          from the plugin (any origin)
//     -> 200 { code, secret, url, expiresIn, interval }  code goes in the Studio address; secret stays in the plugin
//   POST { action: "approve", code, repo, token, expires_in?, name? }   from the Studio page (same origin only)
//     -> 200 { approved: true, repo, login }
//     -> 403 wrong_team (the GitHub sign-in cannot open that repository), 410 expired, 409 used
//   POST { action: "poll", code, secret }             from the plugin (any origin)
//     -> 200 { status: "pending" } | 200 { status: "approved", repo, name, token, expiresAt, login, defaultBranch } (once)
//     -> 410 expired (or already taken), 403 forbidden (wrong secret)
//
// Codes live in Redis like the other short-lived Studio state: 5 minutes, keyed by the code's SHA-256 (the code itself
// is never stored), the poll secret also kept as a hash only. A code is used once: approving twice is refused, and the
// approved answer is taken with GETDEL, so a second poll finds nothing. The token stays in Redis for the rest of those
// 5 minutes at most, sealed at rest (AES-256-GCM, api/_lib/sealed.ts, a key of its own derived from LIBRARY_SESSION_SECRET,
// bound to the link: a sealed token moved to another link does not open). It is the GitHub App user token Studio holds and renews (api/github/token.ts); the plugin gets the
// access token and its expiry, never the refresh token: GitHub refresh tokens rotate on use, so sharing one would sign
// Studio out. When it expires the plugin asks to sign in with Bridge again. Nothing is logged.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { b64url, fail, GITHUB_DOWN, HttpError, json, parseRepo, readBody, sameOrigin, sha256, type FetchLike } from '../_lib/http.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import { seal, sealingKey, unseal, type Sealed } from '../_lib/sealed.js';

export type { FetchLike };

/** How long a code waits for the designer, in seconds. */
export const LINK_TTL_S = 5 * 60;
/** How often the plugin asks, in seconds. */
export const POLL_INTERVAL_S = 3;
/** Where the designer approves, on this site. */
export const CONNECT_PATH = '/studio/connect-figma/';

const MAX_BODY = 4096;
const CODE = /^[A-Z2-7]{10}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const GH_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' };

export const LINK_WORDS = {
  notConfigured: 'Sign in with Bridge is not set up on this site yet. A developer can paste a token under For developers.',
  expired: 'This sign-in expired. Start again from the plugin.',
  used: 'This sign-in was already used. Start again from the plugin.',
  wrongTeam: 'Your GitHub sign-in cannot open this team\'s design system. Pick a team you belong to, or ask its admin for access.',
  signIn: 'Sign in with GitHub in Studio first, then connect Figma.',
  storage: 'Bridge could not keep the sign-in. Try again in a minute.',
} as const;

export interface LinkDeps {
  fetch: FetchLike;
  redis?: Redis | undefined;
  now?: (() => number) | undefined;
  random?: ((bytes: number) => Buffer) | undefined;
}

export interface LinkEnv {
  KV_REST_API_URL?: string | undefined;
  KV_REST_API_TOKEN?: string | undefined;
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
  PUBLIC_SITE_URL?: string | undefined;
  /** The sealing key of the token while it waits (32 characters or more). */
  LIBRARY_SESSION_SECRET?: string | undefined;
}

/** The sealing purpose of the hand-off token: a key no other feature derives. */
export const LINK_SEAL_PURPOSE = 'plugin-link-github-token';
export const linkSealingKey = (secret: string | undefined) => sealingKey(secret, LINK_SEAL_PURPOSE);

interface Pending {
  state: 'pending';
  poll: string;
  exp: number;
}
interface Approved {
  state: 'approved';
  poll: string;
  exp: number;
  repo: string;
  name: string | null;
  /** The GitHub token, sealed and bound to this link (linkKey). Never stored in clear. */
  token: Sealed;
  tokenExpiresAt: number | null;
  login: string;
  defaultBranch: string | null;
}
type Link = Pending | Approved;

export const linkKey = (code: string) => `bridge:pluginlink:${sha256(code)}`;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Ten base32 characters (50 bits): short enough for an address, never guessed in 5 minutes. */
export function newCode(random: (n: number) => Buffer): string {
  return [...random(10)].map((b) => BASE32[b % 32]).join('');
}

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function read(redis: Redis, code: string, now: number): Promise<Link | null> {
  const raw = await redis.cmd('GET', linkKey(code));
  if (typeof raw !== 'string') return null;
  try {
    const l = JSON.parse(raw) as Link;
    return l.exp > now ? l : null;
  } catch {
    return null;
  }
}

const ttl = (exp: number, now: number) => Math.max(1, Math.ceil((exp - now) / 1000));

/** The plugin asks for a code. */
export async function startLink(redis: Redis, origin: string, now: number, random: (n: number) => Buffer) {
  const code = newCode(random);
  const secret = b64url(random(32));
  const link: Pending = { state: 'pending', poll: sha256(secret), exp: now + LINK_TTL_S * 1000 };
  const ok = await redis.cmd('SET', linkKey(code), JSON.stringify(link), 'EX', LINK_TTL_S, 'NX');
  if (ok !== 'OK') throw new HttpError(503, 'storage', LINK_WORDS.storage);
  return { code, secret, url: `${origin}${CONNECT_PATH}?code=${code}`, expiresIn: LINK_TTL_S, interval: POLL_INTERVAL_S };
}

/** GitHub says who the token is and whether it can read the repository (the team the designer picked). */
async function checkAccess(f: FetchLike, token: string, owner: string, repo: string): Promise<{ login: string; defaultBranch: string | null }> {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-plugin-link', 'X-GitHub-Api-Version': '2022-11-28' };
  let user: Response;
  let repoRes: Response;
  try {
    [user, repoRes] = await Promise.all([f('https://api.github.com/user', { method: 'GET', headers }), f(`https://api.github.com/repos/${owner}/${repo}`, { method: 'GET', headers })]);
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (user.status === 401) throw new HttpError(401, 'signin', LINK_WORDS.signIn);
  if (!user.ok) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const me = (await user.json().catch(() => null)) as { login?: unknown } | null;
  if (typeof me?.login !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  if (repoRes.status === 404 || repoRes.status === 403) throw new HttpError(403, 'wrong_team', LINK_WORDS.wrongTeam);
  if (!repoRes.ok) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const data = (await repoRes.json().catch(() => null)) as { permissions?: { pull?: unknown }; default_branch?: unknown } | null;
  if (data?.permissions && data.permissions.pull !== true) throw new HttpError(403, 'wrong_team', LINK_WORDS.wrongTeam);
  return { login: me.login, defaultBranch: typeof data?.default_branch === 'string' ? data.default_branch : null };
}

/** The Studio page approves a code for one team, with the GitHub sign-in of this browser. */
export async function approveLink(redis: Redis, f: FetchLike, body: Record<string, unknown>, now: number, key: Buffer, random: (n: number) => Uint8Array = randomBytes) {
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!CODE.test(code)) throw new HttpError(400, 'bad_request', LINK_WORDS.expired);
  const { owner, repo } = parseRepo(body.repo);
  if (typeof body.token !== 'string' || !GH_TOKEN.test(body.token)) throw new HttpError(401, 'signin', LINK_WORDS.signIn);
  const link = await read(redis, code, now);
  if (!link) throw new HttpError(410, 'expired', LINK_WORDS.expired);
  if (link.state !== 'pending') throw new HttpError(409, 'used', LINK_WORDS.used);
  const { login, defaultBranch } = await checkAccess(f, body.token, owner, repo);
  const secs = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : null;
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : null;
  const approved: Approved = { state: 'approved', poll: link.poll, exp: link.exp, repo: `${owner}/${repo}`, name, token: seal(body.token, key, linkKey(code), random), tokenExpiresAt: secs ? now + secs * 1000 : null, login, defaultBranch };
  // Still pending at write time (XX would not say "pending"): read again, then write; a racing approve loses.
  const again = await read(redis, code, now);
  if (!again || again.state !== 'pending') throw new HttpError(409, 'used', LINK_WORDS.used);
  await redis.cmd('SET', linkKey(code), JSON.stringify(approved), 'EX', ttl(link.exp, now));
  return { approved: true, repo: approved.repo, login };
}

/** The plugin asks whether the designer approved; the approved answer is given once. */
export async function pollLink(redis: Redis, body: Record<string, unknown>, now: number, key: Buffer) {
  const code = typeof body.code === 'string' ? body.code : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!CODE.test(code) || !SECRET.test(secret)) throw new HttpError(400, 'bad_request', LINK_WORDS.expired);
  const link = await read(redis, code, now);
  if (!link) throw new HttpError(410, 'expired', LINK_WORDS.expired);
  if (!sameHash(link.poll, sha256(secret))) throw new HttpError(403, 'forbidden', LINK_WORDS.expired);
  if (link.state === 'pending') return { status: 'pending' as const };
  const taken = await redis.cmd('GETDEL', linkKey(code));
  if (typeof taken !== 'string') throw new HttpError(410, 'expired', LINK_WORDS.used);
  const l = JSON.parse(taken) as Link;
  if (l.state !== 'approved') throw new HttpError(410, 'expired', LINK_WORDS.used);
  const token = l.token && typeof l.token === 'object' ? unseal(l.token, key, linkKey(code)) : null;
  if (!token) throw new HttpError(410, 'expired', LINK_WORDS.expired);
  return { status: 'approved' as const, repo: l.repo, name: l.name, token, expiresAt: l.tokenExpiresAt, login: l.login, defaultBranch: l.defaultBranch };
}

function siteFrom(req: Request, publicUrl: string | undefined): string {
  const pub = publicUrl?.trim();
  if (pub) {
    try {
      return new URL(pub).origin;
    } catch {
      /* the request's own origin */
    }
  }
  return new URL(req.url).origin;
}

export async function handleLink(req: Request, env: LinkEnv, deps: LinkDeps): Promise<Response> {
  const cors = (r: Response, open: boolean) => {
    if (open) for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
    return r;
  };
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), true);
  let open = true;
  try {
    if (req.method !== 'POST') return cors(fail(405, 'method', 'Send a POST.'), true);
    if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return cors(fail(415, 'content_type', 'Send JSON.'), true);
    const body = await readBody(req, MAX_BODY);
    const now = (deps.now ?? Date.now)();
    const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
    const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
    const redis = deps.redis ?? (url && token ? redisRest(url, token, deps.fetch, LINK_WORDS.storage) : null);
    const key = linkSealingKey(env.LIBRARY_SESSION_SECRET);
    if (!redis || !key) return cors(fail(503, 'not_configured', LINK_WORDS.notConfigured), true);
    switch (body.action) {
      case 'start':
        return cors(json(200, await startLink(redis, siteFrom(req, env.PUBLIC_SITE_URL), now, deps.random ?? randomBytes)), true);
      case 'poll':
        return cors(json(200, await pollLink(redis, body, now, key)), true);
      case 'approve':
        // Only the Studio page on this site approves: never a page of another origin, never the plugin.
        open = false;
        if (!sameOrigin(req)) return fail(403, 'origin', 'Connect Figma from Studio on this site.');
        return json(200, await approveLink(redis, deps.fetch, body, now, key, deps.random ?? randomBytes));
      default:
        return cors(fail(400, 'bad_request', 'Unknown action.'), true);
    }
  } catch (e) {
    if (e instanceof HttpError) return cors(json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers), open);
    return cors(fail(502, 'unreachable', GITHUB_DOWN), open);
  }
}

const envFromProcess = (): LinkEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleLink(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const POST = handle;
export const OPTIONS = handle;
