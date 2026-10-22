// /api/contribute: email contributors (docs/HOSTED.md, "Email contributors").
//
// A designer invited with "Can edit" joins with their email only, no GitHub account. Clicking the emailed invite link
// proves they read that inbox, so accepting needs no GitHub check. Their browser then talks to GitHub through this
// function: it holds a signed session cookie, and every call goes out with an installation token of the Bridge app
// (contents, pull requests and issues write, one repository, minted here and never sent to the browser), under a
// deny-by-default policy. Reviewers and admins keep GitHub, because they approve and merge: an email contributor can
// never approve, merge or touch the default branch, and branch protection with required reviews stays the safety net.
//
// Endpoints (JSON, errors are { error, message } in Studio words):
//   GET  /api/contribute?repo=owner/name                 { available, member }  member is { email, name, role } or null
//   POST { action: 'accept', token, name }               joins with a pending "Can edit" invite (api/invites token),
//                                                        sets the session cookie; { member, repo }
//   POST { action: 'sign-in', repo, email }              always { ok: true }; emails a link to members only
//   POST { action: 'verify', repo, token }               spends that link, sets the session cookie; { member }
//   POST { action: 'sign-out', repo }                    clears it
//   ANY  /api/contribute?repo=owner/name&gh=<GitHub REST path and query, URL-encoded, starting with />
//                                                        the GitHub call, under the policy below; GitHub's status,
//                                                        body and Link header come back as they are
// Every request other than GET must carry `X-Bridge-Contribute: 1` and, when the browser sends an Origin, come from a
// page of this site (CSRF).
//
// The proxy policy (anything else answers 403 { error: 'not-allowed' }). Only paths under /repos/<the session's repo>:
//   GET    anything under the repository (read)
//   POST   git/blobs, git/trees
//   POST   git/commits                 the author is set to the member (date kept), any committer dropped
//   POST   git/refs                    refs/heads/<b>, b not the default branch and not existing; b becomes theirs
//   PATCH  git/refs/heads/<b>          their branch only, never force
//   PUT    contents/<path>             branch required and theirs; the author is set to the member
//   DELETE contents/<path>             same
//   POST   pulls                       head is their branch, base the default branch or their branch; the body gets
//                                      "Requested by <name> (<email>) through Bridge."; the pull request becomes theirs
//   PATCH  pulls/<n>                   theirs only; only title, body, state, draft
//   PUT    pulls/<n>/update-branch     theirs only
//   POST   issues                      the same "Requested by" line; the issue becomes theirs
//   PATCH  issues/<n>                  theirs only; only title, body, state, labels
//   POST   issues/<n>/comments         any issue or pull request; the body starts with "**<name>** (via Bridge):"
//   POST   issues/<n>/labels           theirs only
// Never: merges, reviews, requested reviewers, rulesets, branch protection, collaborators, deleting a ref, hooks,
// settings, another repository, GraphQL. Every call other than GET counts against a daily cap per member
// (CONTRIB_MAX_WRITES, 300 by default): over it, 429 { error: 'limit' }.
//
// Sessions: one cookie per team, `bridge_contrib_<sha256 of the team, 16 hex>`, Path=/api/contribute, HttpOnly, Secure,
// SameSite=Lax, 30 days, signed with HMAC-SHA256 under LIBRARY_SESSION_SECRET (api/_lib/session.ts). Every request
// reads the member again: removed, or joined again since (the version moves), and the session ends (401).
//
// Storage (Upstash Redis, the same database as api/invites):
//   bridge:member:<repo>:<email>, bridge:members:<repo>    the members (api/_lib/members.ts)
//   bridge:contrib:branch:<repo>:<branch>                   who created a branch through here (a year)
//   bridge:contrib:issue:<repo>:<number>                    who opened an issue or pull request through here (a year)
//   bridge:contrib:signin:<sha256 of token>                 a sign-in link { repo, email }, 15 minutes, works once
//   bridge:contrib:count:<repo>:<email>:<day>               writes today; sign-in links per email, network, team, site
// Nothing here logs.
//
// Env (server only): KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_ pair), LIBRARY_SESSION_SECRET (32+ characters),
// GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, RESEND_API_KEY + INVITE_EMAIL_FROM (sign-in links), PUBLIC_SITE_URL
// (optional), CONTRIB_MAX_WRITES (optional). Without storage, the secret or the app, `available` is false and every
// action answers 503.

import { createHmac, randomBytes } from 'node:crypto';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { githubApp, type AppTokens } from '../_lib/github-app.js';
import {
  b64url,
  clientIp,
  dayOf,
  envInt,
  fail,
  GITHUB_DOWN,
  HttpError,
  json,
  parseRepo,
  readBody,
  sameOriginWhenPresent,
  SECURITY_HEADERS,
  secondsToTomorrow,
  sha256,
  siteOrigin,
  type FetchLike,
} from '../_lib/http.js';
import { memberStore, type EmailMember, type MemberStore } from '../_lib/members.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import { cookieAttrs, readCookie, signClaims, verifyClaims } from '../_lib/session.js';
import { inviteStoreOn, type InviteStore } from '../invites/index.js';

export type { FetchLike };

// ---------------------------------------------------------------------------------------------------------------
// Types and constants

export interface ContribEnv {
  KV_REST_API_URL?: string | undefined;
  KV_REST_API_TOKEN?: string | undefined;
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  INVITE_EMAIL_FROM?: string | undefined;
  LIBRARY_SESSION_SECRET?: string | undefined;
  GITHUB_APP_ID?: string | undefined;
  GITHUB_APP_PRIVATE_KEY?: string | undefined;
  PUBLIC_SITE_URL?: string | undefined;
  CONTRIB_MAX_WRITES?: string | undefined;
}

export interface ContribDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  /** Injected services (tests); otherwise built from the env. */
  redis?: Redis;
  invites?: InviteStore;
  members?: MemberStore;
  email?: EmailSender;
  app?: AppTokens;
}

/** What a session cookie says. */
export interface ContribClaims {
  /** The team, lower case. */
  repo: string;
  email: string;
  name: string;
  /** The member's version it was signed for. */
  v: number;
  /** Expiry (ms). */
  exp: number;
}

export const COOKIE_PATH = '/api/contribute';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SIGNIN_TTL_MS = 15 * 60 * 1000;
export const MIN_SECRET_LENGTH = 32;
/** Writes per member per UTC day, unless CONTRIB_MAX_WRITES says otherwise. */
export const WRITE_LIMIT_DEFAULT = 300;
/** Sign-in links per UTC day, like api/library-access. */
export const SIGNIN_LIMITS = { email: 3, ip: 10, team: 20, site: 20 } as const;
/** A proxied body (a blob of an image, a token file) is at most 5 MB. */
export const MAX_PROXY_BODY = 5 * 1024 * 1024;
const MAX_ACTION_BODY = 8192;
const COUNTER_TTL_S = 2 * 24 * 60 * 60;
const OWNERSHIP_TTL_S = 365 * 24 * 60 * 60;
const API = 'https://api.github.com';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
const PURPOSE = 'contrib-session';
/** The permissions the proxy's installation token carries, and nothing more. */
export const PROXY_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write' } as const;

// ---------------------------------------------------------------------------------------------------------------
// Words

export const NOT_CONFIGURED = 'Joining with an email is not available yet on this site.';
export const EXPIRED = 'This link expired or was already used. Ask your admin for a new invitation, or enter your email to get a sign-in link.';
export const GITHUB_REQUIRED = 'Reviewers and admins approve and merge on GitHub. Sign in with GitHub to join with this role.';
export const NOT_ALLOWED = 'Bridge does not do this for people who joined with their email. Ask a reviewer or an admin.';
const SIGNIN = 'Your session ended. Enter your email to get a new sign-in link.';
const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
const APP_MISSING = 'Bridge cannot write to this design system yet. An admin of the repository gives the Bridge app access to it.';
export const LIMIT_WORDS = {
  writes: "You reached today's limit of changes through Bridge. Try again tomorrow.",
  signin: 'Bridge already sent a few links today. Use the latest one, or try again tomorrow.',
};

// ---------------------------------------------------------------------------------------------------------------
// Services

interface Services {
  redis: Redis;
  invites: InviteStore;
  members: MemberStore;
  email: EmailSender | null;
  app: AppTokens;
  secret: string;
}

/** Installation tokens live an hour: a warm function reuses one for 30 minutes (memory only, never stored). */
const tokenCache = new Map<string, { token: string; until: number }>();

function cachedApp(app: AppTokens, key: string, now: () => number): AppTokens {
  return {
    async installationToken(owner, repo) {
      const k = `${key}:${owner}/${repo}`.toLowerCase();
      const hit = tokenCache.get(k);
      if (hit && hit.until > now()) return hit.token;
      const token = await app.installationToken(owner, repo);
      if (token) tokenCache.set(k, { token, until: now() + 30 * 60 * 1000 });
      return token;
    },
  };
}

/** Storage, the session secret and the app (email for sign-in links), or null when one is missing. */
export function services(env: ContribEnv, deps: ContribDeps): Services | null {
  const now = deps.now ?? Date.now;
  const kvUrl = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const kvToken = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const redis = deps.redis ?? (kvUrl && kvToken ? redisRest(kvUrl, kvToken, deps.fetch, STORAGE_DOWN) : null);
  const key = env.RESEND_API_KEY?.trim();
  const from = env.INVITE_EMAIL_FROM?.trim();
  const email = deps.email ?? (key && from ? resendSender(key, from, deps.fetch) : null);
  const appId = env.GITHUB_APP_ID?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const app = deps.app ?? (appId && pem ? cachedApp(githubApp(appId, pem, deps.fetch, now, { permissions: { ...PROXY_PERMISSIONS }, require: { ...PROXY_PERMISSIONS }, userAgent: 'bridge-contribute' }), appId, now) : null);
  const secret = env.LIBRARY_SESSION_SECRET?.trim() ?? '';
  if (!redis || !app || secret.length < MIN_SECRET_LENGTH) return null;
  return { redis, invites: deps.invites ?? inviteStoreOn(redis, now), members: deps.members ?? memberStore(redis), email, app, secret };
}

interface Ctx {
  f: FetchLike;
  now: () => number;
  random: (n: number) => Uint8Array;
  svc: Services;
  env: ContribEnv;
}

// ---------------------------------------------------------------------------------------------------------------
// Sessions

/** One cookie per team: its name carries a hash of the team, never the name itself. */
export const cookieName = (repo: string) => `bridge_contrib_${sha256(repo.toLowerCase()).slice(0, 16)}`;

const isClaims = (c: any) => typeof c.repo === 'string' && typeof c.email === 'string' && typeof c.name === 'string' && Number.isInteger(c.v) && typeof c.exp === 'number';

export const signSession = (c: ContribClaims, secret: string) => signClaims(c, secret, PURPOSE);
export const verifySession = (value: string, secret: string) => verifyClaims<ContribClaims>(value, secret, PURPOSE, isClaims);

export function issueSession(m: EmailMember, repoFull: string, secret: string, now: number): string {
  const value = signSession({ repo: repoFull.toLowerCase(), email: m.email, name: m.name, v: m.version, exp: now + SESSION_TTL_MS }, secret);
  return `${cookieName(repoFull)}=${value}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; ${cookieAttrs(COOKIE_PATH)}`;
}

export const clearSession = (repoFull: string) => `${cookieName(repoFull)}=; Max-Age=0; ${cookieAttrs(COOKIE_PATH)}`;

/** The member behind the request's cookie for this team, or null: signed here, this team, not expired, same version. */
async function sessionMember(ctx: Ctx, req: Request, repoFull: string): Promise<EmailMember | null> {
  const raw = readCookie(req, cookieName(repoFull));
  if (!raw) return null;
  const c = verifySession(raw, ctx.svc.secret);
  if (!c || c.repo !== repoFull.toLowerCase() || c.exp <= ctx.now()) return null;
  const m = await ctx.svc.members.get(repoFull, c.email);
  // Removed, or joined again since: the session ends.
  return m && m.version === c.v && m.email === c.email ? m : null;
}

const publicMember = (m: EmailMember) => ({ email: m.email, name: m.name, role: m.role });

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());
const hmacHex = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('hex').slice(0, 32);

/** The name shown in pull requests and comments: letters, digits, spaces, . ' - only (no markdown), at most 80. */
export function cleanName(raw: unknown, email: string): string {
  const s = typeof raw === 'string' ? raw.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} .'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() : '';
  if (s) return s;
  return email.split('@')[0]!.replace(/[^A-Za-z0-9.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Contributor';
}

function requireCsrf(req: Request): void {
  if (req.headers.get('x-bridge-contribute') !== '1' || !sameOriginWhenPresent(req)) throw new HttpError(403, 'origin', 'Contribute from Studio on this site.');
}

// ---------------------------------------------------------------------------------------------------------------
// Caps

async function bumpOrRefuse(ctx: Ctx, keys: string[], limits: number[], message: string, kind: string): Promise<() => Promise<void>> {
  const now = ctx.now();
  const r = await ctx.svc.redis.pipe(keys.flatMap((k) => [['INCRBY', k, 1], ['EXPIRE', k, COUNTER_TTL_S]]));
  const back = async () => {
    await ctx.svc.redis.pipe(keys.map((k) => ['INCRBY', k, -1]));
  };
  if (keys.some((_, i) => Number(r[i * 2]) > limits[i]!)) {
    await back();
    throw new HttpError(429, 'limit', message, { limit: kind }, { 'Retry-After': String(secondsToTomorrow(now)) });
  }
  return back;
}

const writeLimit = (env: ContribEnv) => envInt(env.CONTRIB_MAX_WRITES, WRITE_LIMIT_DEFAULT);

// ---------------------------------------------------------------------------------------------------------------
// Actions

function signInEmail(x: { to: string; repo: string; link: string }): EmailMessage {
  const subject = `Your link to ${x.repo} on Bridge`;
  const lines = [
    `Sign in to the ${x.repo} design system on Bridge:`,
    '',
    x.link,
    '',
    'The link works once and expires in 15 minutes. It keeps you signed in on that browser for 30 days.',
    'If you did not ask for it, you can ignore this email.',
  ];
  const html = [
    `<p>Sign in to the <strong>${escHtml(x.repo)}</strong> design system on Bridge.</p>`,
    `<p><a href="${escHtml(x.link)}">Open Bridge</a></p>`,
    '<p>The link works once and expires in 15 minutes. It keeps you signed in on that browser for 30 days.</p>',
    '<p>If you did not ask for it, you can ignore this email.</p>',
  ].join('\n');
  return { to: x.to, subject, text: lines.join('\n'), html };
}

const signInKey = (hash: string) => `bridge:contrib:signin:${hash}`;

async function onAction(req: Request, ctx: Ctx): Promise<Response> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const body = await readBody(req, MAX_ACTION_BODY);
  const { svc } = ctx;

  switch (body.action) {
    case 'accept': {
      // The token of an api/invites invitation: opening the emailed link proves the inbox, no GitHub check.
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return fail(410, 'expired', EXPIRED);
      const inv = await svc.invites.byTokenHash(sha256(body.token));
      if (!inv) return fail(410, 'expired', EXPIRED);
      if (Date.parse(inv.expiresAt) <= ctx.now()) {
        await svc.invites.remove(inv);
        return fail(410, 'expired', EXPIRED);
      }
      // Reviewers and admins approve and merge on GitHub: the invite stays valid for the GitHub way.
      if (inv.role !== 'edit') return fail(409, 'github-required', GITHUB_REQUIRED);
      const email = inv.email.trim().toLowerCase();
      const prev = await svc.members.get(inv.repo, email);
      const member: EmailMember = { email, name: cleanName(body.name, email), role: 'edit', version: (prev?.version ?? 0) + 1, addedBy: inv.invitedBy, at: new Date(ctx.now()).toISOString() };
      await svc.members.put(inv.repo, member);
      // Single use, the same bookkeeping as the GitHub accept.
      await svc.invites.remove(inv);
      return json(200, { member: publicMember(member), repo: inv.repo }, { 'Set-Cookie': issueSession(member, inv.repo, svc.secret, ctx.now()) });
    }

    case 'sign-in': {
      const { owner, repo, full } = parseRepo(body.repo);
      if (!validEmail(body.email)) return fail(400, 'bad_email', 'Enter your email, like name@company.com.');
      if (!svc.email) return fail(503, 'not_configured', NOT_CONFIGURED);
      const email = (body.email as string).trim().toLowerCase();
      const day = dayOf(ctx.now());
      // Counted for everyone, member or not, so the answer never tells who is on the team.
      const keys = [
        `bridge:contrib:count:signin:email:${hmacHex(svc.secret, `email:${email}`)}:${day}`,
        `bridge:contrib:count:signin:ip:${hmacHex(svc.secret, `ip:${clientIp(req)}`)}:${day}`,
        `bridge:contrib:count:signin:team:${full}:${day}`,
        `bridge:contrib:count:signin:site:${day}`,
      ];
      const release = await bumpOrRefuse(ctx, keys, [SIGNIN_LIMITS.email, SIGNIN_LIMITS.ip, SIGNIN_LIMITS.team, SIGNIN_LIMITS.site], LIMIT_WORDS.signin, 'signin');
      const member = await svc.members.get(full, email);
      if (!member) return json(200, { ok: true });
      const token = b64url(Buffer.from(ctx.random(32)));
      const hash = sha256(token);
      await svc.redis.cmd('SET', signInKey(hash), JSON.stringify({ repo: full, email }), 'EX', SIGNIN_TTL_MS / 1000);
      const link = `${siteOrigin(req, ctx.env.PUBLIC_SITE_URL)}/studio/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/#contribute=${token}`;
      try {
        await svc.email.send(signInEmail({ to: email, repo: `${owner}/${repo}`, link }));
      } catch {
        // The same answer as for anyone else (no enumeration); the link and the count go back.
        await svc.redis.cmd('DEL', signInKey(hash));
        await release();
      }
      return json(200, { ok: true });
    }

    case 'verify': {
      const { full } = parseRepo(body.repo);
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return fail(410, 'expired', EXPIRED);
      const raw = await svc.redis.cmd('GETDEL', signInKey(sha256(body.token)));
      let rec: { repo?: unknown; email?: unknown } | null = null;
      try {
        rec = typeof raw === 'string' ? JSON.parse(raw) : null;
      } catch {
        rec = null;
      }
      if (!rec || rec.repo !== full || typeof rec.email !== 'string') return fail(410, 'expired', EXPIRED);
      const member = await svc.members.get(full, rec.email);
      if (!member) return fail(410, 'expired', EXPIRED);
      return json(200, { member: publicMember(member) }, { 'Set-Cookie': issueSession(member, full, svc.secret, ctx.now()) });
    }

    case 'sign-out': {
      const { full } = parseRepo(body.repo);
      return json(200, { ok: true }, { 'Set-Cookie': clearSession(full) });
    }

    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The proxy

const notAllowed = () => new HttpError(403, 'not-allowed', NOT_ALLOWED);

const RAW_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const RAW_QUERY = /^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/;
const NUMBER = /^[1-9]\d{0,9}$/;

export interface Target {
  /** Path segments after /repos/<owner>/<repo>, decoded. */
  rest: string[];
  /** The same, as sent (still encoded), for the call to GitHub. */
  rawRest: string[];
  query: string;
}

/**
 * The GitHub path the browser asks for, checked: under /repos/<owner>/<repo> of the session, no empty, `.` or `..`
 * segment (encoded or not), no encoded slash or backslash, no control character. Anything else: not allowed.
 */
export function parseTarget(raw: unknown, owner: string, repo: string): Target {
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/')) throw notAllowed();
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  const query = q < 0 ? '' : raw.slice(q + 1);
  if (!RAW_PATH.test(path) || !RAW_QUERY.test(query)) throw notAllowed();
  const segs = path.slice(1).split('/');
  const decoded: string[] = [];
  for (const s of segs) {
    let d: string;
    try {
      d = decodeURIComponent(s);
    } catch {
      throw notAllowed();
    }
    if (!d || d === '.' || d === '..' || /[/\\\u0000-\u001f\u007f]/.test(d)) throw notAllowed();
    decoded.push(d);
  }
  if (decoded.length < 3 || decoded[0] !== 'repos' || decoded[1]!.toLowerCase() !== owner.toLowerCase() || decoded[2]!.toLowerCase() !== repo.toLowerCase()) throw notAllowed();
  return { rest: decoded.slice(3), rawRest: segs.slice(3), query };
}

/** A branch name git accepts (git check-ref-format, the parts that matter here). */
export function validBranch(b: string): boolean {
  return (
    b.length > 0 &&
    b.length <= 200 &&
    !/[\u0000- ~^:?*[\\\u007f]/.test(b) &&
    !b.includes('..') &&
    !b.includes('@{') &&
    !b.includes('//') &&
    !b.startsWith('/') &&
    !b.endsWith('/') &&
    !b.endsWith('.') &&
    !b.endsWith('.lock') &&
    b !== '@' &&
    !b.split('/').some((s) => s.startsWith('.'))
  );
}

const branchKey = (repo: string, b: string) => `bridge:contrib:branch:${repo.toLowerCase()}:${b}`;
const issueKey = (repo: string, n: string | number) => `bridge:contrib:issue:${repo.toLowerCase()}:${n}`;
const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

/** Keeps only `keys` of `body`. */
const pick = (body: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
const onlyKeys = (body: Record<string, unknown>, keys: string[]) => Object.keys(body).every((k) => keys.includes(k));

interface Call {
  owner: string;
  repo: string;
  full: string;
  member: EmailMember;
  token: string;
  method: string;
  target: Target;
  body: Record<string, unknown> | null;
}

interface Plan {
  body: Record<string, unknown> | null;
  /** Runs after GitHub answered 2xx, with its JSON. */
  after?: (data: any) => Promise<void>;
}

async function ghApp(ctx: Ctx, token: string, method: string, path: string): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await ctx.f(`${API}${path}`, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-contribute', 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let data: any = null;
  try {
    data = res.status === 204 ? null : await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** What the policy allows for this call, with the body it sends; throws not-allowed otherwise. */
async function planCall(ctx: Ctx, c: Call): Promise<Plan> {
  const r = c.target.rest;
  const at = (...p: string[]) => r.length === p.length && p.every((x, i) => x === '*' || x === r[i]);
  const body = c.body ?? {};
  const author = { name: c.member.name, email: c.member.email };
  let defaultBranch: string | null = null;
  const def = async () => {
    if (defaultBranch !== null) return defaultBranch;
    const repo = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}`);
    if (repo.status !== 200 || typeof repo.data?.default_branch !== 'string') throw new HttpError(409, 'app_missing', APP_MISSING);
    defaultBranch = repo.data.default_branch as string;
    return defaultBranch;
  };
  const isDefault = async (b: string) => b.toLowerCase() === (await def()).toLowerCase();
  const ownsBranch = async (b: unknown) => typeof b === 'string' && validBranch(b) && !(await isDefault(b)) && (await ctx.svc.redis.cmd('GET', branchKey(c.full, b))) === c.member.email;
  const ownsIssue = async (n: string | undefined) => n !== undefined && NUMBER.test(n) && (await ctx.svc.redis.cmd('GET', issueKey(c.full, n))) === c.member.email;
  const recordIssue = async (data: any) => {
    if (typeof data?.number === 'number') await ctx.svc.redis.cmd('SET', issueKey(c.full, data.number), c.member.email, 'EX', OWNERSHIP_TTL_S);
  };
  const requested = (text: unknown) => `${typeof text === 'string' && text.trim() ? `${text}\n\n` : ''}Requested by ${c.member.name} (${c.member.email}) through Bridge.`;

  switch (c.method) {
    case 'GET':
      return { body: null };

    case 'POST': {
      if (at('git', 'blobs') || at('git', 'trees')) return { body };
      if (at('git', 'commits')) {
        const date = body.author && typeof body.author === 'object' && typeof (body.author as Record<string, unknown>).date === 'string' ? { date: (body.author as Record<string, unknown>).date } : {};
        const { committer: _c, author: _a, ...rest } = body;
        return { body: { ...rest, author: { ...author, ...date } } };
      }
      if (at('git', 'refs')) {
        const m = typeof body.ref === 'string' ? /^refs\/heads\/(.+)$/.exec(body.ref) : null;
        const b = m?.[1];
        if (!b || !validBranch(b) || (await isDefault(b)) || typeof body.sha !== 'string') throw notAllowed();
        const exists = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/git/ref/heads/${encodeRef(b)}`);
        if (exists.status !== 404) throw notAllowed();
        return {
          body: { ref: `refs/heads/${b}`, sha: body.sha },
          after: async () => {
            await ctx.svc.redis.cmd('SET', branchKey(c.full, b), c.member.email, 'EX', OWNERSHIP_TTL_S);
          },
        };
      }
      if (at('pulls')) {
        if (typeof body.head !== 'string' || typeof body.base !== 'string') throw notAllowed();
        const i = body.head.indexOf(':');
        if (i >= 0 && body.head.slice(0, i).toLowerCase() !== c.owner.toLowerCase()) throw notAllowed();
        const head = i >= 0 ? body.head.slice(i + 1) : body.head;
        if (!(await ownsBranch(head))) throw notAllowed();
        if (!(await isDefault(body.base)) && !(await ownsBranch(body.base))) throw notAllowed();
        return { body: { ...pick(body, ['title', 'draft']), head, base: body.base, body: requested(body.body) }, after: recordIssue };
      }
      if (at('issues')) return { body: { ...pick(body, ['title', 'labels']), body: requested(body.body) }, after: recordIssue };
      if (at('issues', '*', 'comments')) {
        if (!NUMBER.test(r[1]!) || typeof body.body !== 'string') throw notAllowed();
        return { body: { body: `**${c.member.name}** (via Bridge):\n\n${body.body}` } };
      }
      if (at('issues', '*', 'labels')) {
        if (!(await ownsIssue(r[1]))) throw notAllowed();
        return { body: pick(body, ['labels']) };
      }
      throw notAllowed();
    }

    case 'PATCH': {
      if (r.length >= 4 && r[0] === 'git' && r[1] === 'refs' && r[2] === 'heads') {
        const b = r.slice(3).join('/');
        if (body.force || !(await ownsBranch(b)) || typeof body.sha !== 'string') throw notAllowed();
        return { body: { sha: body.sha, force: false } };
      }
      if (at('pulls', '*')) {
        if (!onlyKeys(body, ['title', 'body', 'state', 'draft']) || !(await ownsIssue(r[1]))) throw notAllowed();
        return { body };
      }
      if (at('issues', '*')) {
        if (!onlyKeys(body, ['title', 'body', 'state', 'labels']) || !(await ownsIssue(r[1]))) throw notAllowed();
        return { body };
      }
      throw notAllowed();
    }

    case 'PUT':
    case 'DELETE': {
      if (r.length >= 2 && r[0] === 'contents') {
        if (!(await ownsBranch(body.branch))) throw notAllowed();
        const keys = c.method === 'PUT' ? ['message', 'content', 'sha', 'branch'] : ['message', 'sha', 'branch'];
        return { body: { ...pick(body, keys), author } };
      }
      if (c.method === 'PUT' && at('pulls', '*', 'update-branch')) {
        if (!(await ownsIssue(r[1]))) throw notAllowed();
        return { body: pick(body, ['expected_head_sha']) };
      }
      throw notAllowed();
    }

    default:
      throw notAllowed();
  }
}

const ACCEPT = /^application\/(json|vnd\.github(\.[A-Za-z0-9.+-]+)?)$/;
const PASS_TYPE = /^(application\/(json|vnd\.github[^;]*)|text\/plain)\b/i;

async function onProxy(req: Request, ctx: Ctx, params: URLSearchParams): Promise<Response> {
  const method = req.method.toUpperCase();
  const { owner, repo, full } = parseRepo(params.get('repo'));
  const member = await sessionMember(ctx, req, full);
  if (!member) return json(401, { error: 'signin', message: SIGNIN }, { 'Set-Cookie': clearSession(full) });
  const target = parseTarget(params.get('gh'), owner, repo);

  let body: Record<string, unknown> | null = null;
  if (method !== 'GET') {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_PROXY_BODY) return fail(413, 'too_large', 'This file is too large to save through Bridge (5 MB at most).');
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_PROXY_BODY) return fail(413, 'too_large', 'This file is too large to save through Bridge (5 MB at most).');
    if (raw.trim()) {
      if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        body = parsed as Record<string, unknown>;
      } catch {
        return fail(400, 'bad_request', 'Send a JSON object.');
      }
    }
  }

  const token = await ctx.svc.app.installationToken(owner, repo);
  if (!token) return fail(409, 'app_missing', APP_MISSING);
  const plan = await planCall(ctx, { owner, repo, full, member, token, method, target, body });

  if (method !== 'GET') {
    const day = dayOf(ctx.now());
    await bumpOrRefuse(ctx, [`bridge:contrib:count:${full}:${member.email}:${day}`], [writeLimit(ctx.env)], LIMIT_WORDS.writes, 'writes');
  }

  const accept = req.headers.get('accept')?.trim() ?? '';
  const inm = req.headers.get('if-none-match');
  const url = `${API}/repos/${owner}/${repo}${target.rawRest.length ? `/${target.rawRest.join('/')}` : ''}${target.query ? `?${target.query}` : ''}`;
  let res: Response;
  try {
    res = await ctx.f(url, {
      method,
      headers: {
        Accept: ACCEPT.test(accept) ? accept : 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'bridge-contribute',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(inm && method === 'GET' && inm.length < 200 ? { 'If-None-Match': inm } : {}),
        ...(plan.body !== null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(plan.body !== null ? { body: JSON.stringify(plan.body) } : {}),
    });
  } catch {
    return fail(502, 'unreachable', GITHUB_DOWN);
  }
  const text = res.status === 204 || res.status === 304 ? null : await res.text();
  if (plan.after && res.status >= 200 && res.status < 300) {
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    await plan.after(data);
  }
  const type = res.headers.get('content-type') ?? '';
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    ...(text !== null ? { 'Content-Type': PASS_TYPE.test(type) ? type : 'application/octet-stream' } : {}),
  };
  for (const h of ['link', 'etag']) {
    const v = res.headers.get(h);
    if (v) headers[h === 'link' ? 'Link' : 'ETag'] = v;
  }
  return new Response(text, { status: res.status, headers });
}

// ---------------------------------------------------------------------------------------------------------------
// The handler

export async function handleContribute(req: Request, env: ContribEnv, deps: ContribDeps): Promise<Response> {
  try {
    const method = req.method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return json(405, { error: 'method', message: 'Use GET, POST, PUT, PATCH or DELETE.' }, { Allow: 'GET, POST, PUT, PATCH, DELETE' });
    if (method !== 'GET') requireCsrf(req);
    const svc = services(env, deps);
    const params = new URL(req.url).searchParams;
    const gh = params.get('gh');

    if (method === 'GET' && gh === null) {
      const repoArg = params.get('repo');
      if (repoArg === null || !svc) {
        if (repoArg !== null) parseRepo(repoArg);
        return json(200, { available: Boolean(svc), member: null });
      }
      const { full } = parseRepo(repoArg);
      const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
      const m = await sessionMember(ctx, req, full);
      return json(200, { available: true, member: m ? publicMember(m) : null });
    }

    if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
    const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
    if (gh !== null) return await onProxy(req, ctx, params);
    if (method !== 'POST') return fail(400, 'bad_request', 'Say which GitHub call, with gh.');
    return await onAction(req, ctx);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
    return fail(502, 'unreachable', GITHUB_DOWN);
  }
}

const envFromProcess = (): ContribEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  INVITE_EMAIL_FROM: process.env.INVITE_EMAIL_FROM,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
  CONTRIB_MAX_WRITES: process.env.CONTRIB_MAX_WRITES,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleContribute(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
