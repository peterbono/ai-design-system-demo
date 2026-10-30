// /api/contribute: email contributors (docs/HOSTED.md, "Email contributors").
//
// A designer invited with "Can edit" joins with their email only, no GitHub account, through their Bridge account
// (api/entry, accept-invite): no GitHub check. Their browser then talks to GitHub through this
// function: it holds a signed session cookie, and every call goes out with an installation token of the Bridge app
// (contents, pull requests and issues write, one repository, minted here and never sent to the browser), under a
// deny-by-default policy. Reviewers and admins keep GitHub, because they approve and merge: an email contributor can
// never approve, merge or touch the default branch, and branch protection with required reviews stays the safety net.
//
// Endpoints (JSON, errors are { error, message } in Studio words):
//   GET  /api/contribute?repo=owner/name                 { available, member }  member is { email, name, role } or null
//   GET  /api/contribute?repo=owner/name&mine=1          { branches, issues }  what the signed-in member made and owns
//   GET  /api/contribute?repo=owner/name&members=1       { collaborators, members }  who is on the team, for Settings >
//                                                        Members of anyone on it: an email contributor (the cookie) or
//                                                        a GitHub account that can read the repository (Bearer). The
//                                                        GitHub people come from the app's token (login, avatar,
//                                                        permissions); the email members by name and role only, never
//                                                        another member's email
//   POST { action: 'sign-in', repo, email }              always { ok: true }; emails a link to members only
//   POST { action: 'verify', repo, token }               spends that link, sets the session cookie; { member }
//   POST { action: 'sign-out', repo }                    clears it
//   GET  /api/contribute?repo=owner/name&gh=<GitHub REST path and query, URL-encoded, starting with />
//   GET  /api/contribute?repo=owner/name&blobs=<sha>,<sha>,...
//   GET  /api/contribute?repo=owner/name&users=<login>,...   (members only: public names and avatars)
//   GET  /api/contribute?repo=owner/name&changes=<n>:<sha>,... (members only: the status reads of open changes, read
//                                                        once and shared by the team's members for 30 s)
//                                                        a read of the team's repository through Bridge, for its
//                                                        members and for anyone on a public demo team: allow-listed,
//                                                        read-only token, cached, rate limited (api/_lib/team-read.ts)
//   GET  /api/contribute?repo=owner/name&gh=/repos/<product owner>/<product name>/...
//                                                        a read of one of the team's product repositories (its
//                                                        bridge.config.json products[].repo), read only, same
//                                                        allow-list minus members-only resources, the product's own
//                                                        read token, the team's budget; 409 product_missing when the
//                                                        app is not installed there (api/_lib/team-read.ts)
//   ANY  other than GET, same gh=                         the GitHub call, under the policy below; GitHub's status,
//                                                        body and Link header come back as they are
// Every request other than GET must carry `X-Bridge-Contribute: 1` and, when the browser sends an Origin, come from a
// page of this site (CSRF).
//
// The proxy policy (anything else answers 403 { error: 'not-allowed' }). Only paths under /repos/<the session's repo>:
//   GET    the read allow-list of api/_lib/team-read.ts (READ_RULES), with a read-only token
//   POST   git/blobs
//   POST   git/trees                   every entry a design file (below), no submodule, no symlink
//   POST   git/commits                 the author is set to the member (date kept), any committer dropped
//   POST   git/refs                    refs/heads/<b>, b not the default branch and not existing, at a commit that
//                                      changes design files only; b becomes theirs
//   PATCH  git/refs/heads/<b>          their branch only, never force, to a commit that changes design files only
//   PUT    contents/<path>             a design file; branch required and theirs; the author is set to the member
//   DELETE contents/<path>             same
//   POST   pulls                       head is their branch, base the default branch or their branch; the body gets
//                                      "Requested by <name> (<email>) through Bridge."; the pull request becomes theirs
//   PATCH  pulls/<n>                   theirs only; only title, body, state, draft; a new body keeps the line
//   PUT    pulls/<n>/update-branch     theirs only
//   POST   issues                      the same "Requested by" line; the issue becomes theirs
//   PATCH  issues/<n>                  theirs only; only title, body, state, labels; a new body keeps the line
//   POST   issues/<n>/comments         any issue or pull request; the body starts with "**<name>** (via Bridge):"
//   POST   issues/<n>/labels           theirs only
// Never: merges, reviews, requested reviewers, rulesets, branch protection, collaborators, deleting a ref, hooks,
// settings, another repository, GraphQL.
// Design files only: writes land in the folders bridge.config.json declares for tokens, component docs and specs,
// changesets and Bridge's own files (designPaths), never code, CI, package files or guardrails, because CI runs what
// a pull request contains. On a public repository the member's email is never published: commits carry
// <hash>@contributors.bridge.invalid and the "Requested by" line names them without the email.
// Every call other than GET counts against a daily cap per member (CONTRIB_MAX_WRITES, 300 by default): over it,
// 429 { error: 'limit' }.
//
// Sessions: one cookie per team, `bridge_contrib_<sha256 of the team, 16 hex>`, Path=/api/contribute, HttpOnly, Secure,
// SameSite=Lax, 30 days, signed with HMAC-SHA256 under LIBRARY_SESSION_SECRET (api/_lib/session.ts). Every request
// reads the member again: removed, or joined again since (the version moves), and the session ends (401).
// A Bridge account session (`bridge_account`, Path=/, api/account) works too: an account whose email is a member of
// the team is that member. The per-team cookie stays valid.
//
// Storage (Upstash Redis, the same database as api/invites):
//   bridge:member:<repo>:<email>, bridge:members:<repo>    the members (api/_lib/members.ts)
//   bridge:contrib:branch:<repo>:<branch>                   who created a branch through here (a year)
//   bridge:contrib:issue:<repo>:<number>                    who opened an issue or pull request through here (a year)
//   bridge:contrib:mine:<repo>:<email>                      set of "b:<branch>" and "i:<number>" they made (a year)
//   bridge:contrib:signin:<sha256 of token>                 a sign-in link { repo, email }, 15 minutes, works once
//   bridge:contrib:count:<repo>:<email>:<day>               writes today; sign-in links per email, network, team, site
// When a member deletes their Bridge account, api/_lib/former-member.ts forgets the keys that hold their email and their
// "Requested by" lines name "A former member": their changes stay in the team's history.
// Nothing here logs.
//
// Env (server only): KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_ pair), LIBRARY_SESSION_SECRET (32+ characters),
// GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, RESEND_API_KEY + INVITE_EMAIL_FROM (sign-in links), PUBLIC_SITE_URL
// (optional), CONTRIB_MAX_WRITES (optional). Without storage, the secret or the app, `available` is false and every
// action answers 503.

import { createHmac, randomBytes } from 'node:crypto';
import { sessionAccount } from '../_lib/account.js';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { branchKey, issueKey, mineKey } from '../_lib/former-member.js';
import { githubApp, type AppTokens } from '../_lib/github-app.js';
import { activeLocalAdmins, type LocalAdmins } from '../_lib/local-admin.js';
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
import { configName, putTeamName } from '../_lib/teams.js';
import { cookieAttrs, readCookie, signClaims, verifyClaims } from '../_lib/session.js';
import { accountTeamsKey } from '../_lib/members.js';
import { isPublicRepo, productReadAllowed, noteWrite, onBlobs, onChanges, onRead, onUsers, parseBlobList, parseChangeList, parseUserList, PUBLIC_TEAMS, READ_BASE, READ_PERMISSIONS, readAllowed, READ_WORDS, type ReadCtx, type Reader } from '../_lib/team-read.js';

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
  /** Reads through Bridge per 10 minutes: per member, per address (demo visitors), per team. */
  READ_MAX_IP?: string | undefined;
  READ_MAX_GUEST?: string | undefined;
  READ_MAX_TEAM?: string | undefined;
}

export interface ContribDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  /** Injected services (tests); otherwise built from the env. */
  redis?: Redis;
  members?: MemberStore;
  email?: EmailSender;
  app?: AppTokens;
  /** `npm run dev:full` only (api/_lib/local-admin.ts): admins seeded locally, ignored outside local mode. */
  localAdmins?: LocalAdmins;
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
export const NOT_ALLOWED = 'Bridge does not do this for people who joined with their email. Ask a reviewer or an admin.';
const SIGNIN = 'You signed out. Sign in again with your email: Bridge sends you a code.';
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
  members: MemberStore;
  email: EmailSender | null;
  app: AppTokens;
  /** The read token of api/_lib/team-read.ts: the same app, narrowed to read permissions. */
  readApp: AppTokens;
  secret: string;
  /** Local mode only (api/_lib/local-admin.ts); always null in production. */
  localAdmins: LocalAdmins | null;
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

/**
 * Read tokens: the app narrowed to READ_PERMISSIONS, else to READ_BASE when the installation lacks one of the extra
 * read permissions (statuses, checks). Never a write permission.
 */
function readTokens(appId: string, pem: string, f: FetchLike, now: () => number): AppTokens {
  const full = cachedApp(githubApp(appId, pem, f, now, { permissions: { ...READ_PERMISSIONS }, require: { ...READ_PERMISSIONS }, userAgent: 'bridge-read' }), `${appId}:read`, now);
  const base = cachedApp(githubApp(appId, pem, f, now, { permissions: { ...READ_BASE }, require: { ...READ_BASE }, userAgent: 'bridge-read' }), `${appId}:read-base`, now);
  // What the installation does not grant is not asked again for a while (each ask is two calls to GitHub).
  const without = new Map<string, number>();
  return {
    async installationToken(owner, repo) {
      const k = `${owner}/${repo}`.toLowerCase();
      if ((without.get(`full:${k}`) ?? 0) <= now()) {
        const t = await full.installationToken(owner, repo);
        if (t) return t;
        without.set(`full:${k}`, now() + 10 * 60 * 1000);
      }
      if ((without.get(`base:${k}`) ?? 0) > now()) return null;
      const t = await base.installationToken(owner, repo);
      if (!t) without.set(`base:${k}`, now() + 60 * 1000);
      return t;
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
  const readApp = deps.app ?? readTokens(appId!, pem!, deps.fetch, now);
  return { redis, members: deps.members ?? memberStore(redis), email, app, readApp, secret, localAdmins: activeLocalAdmins(deps.localAdmins) };
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

/**
 * The member behind the request for this team, or null. The team's own cookie first: signed here, this team, not
 * expired, same member version. Else the Bridge account session (`bridge_account`, api/account): an account whose
 * email is a member of this team counts as that member (the account's version ends it, deleting it removes it).
 */
async function sessionMember(ctx: Ctx, req: Request, repoFull: string): Promise<EmailMember | null> {
  const raw = readCookie(req, cookieName(repoFull));
  const c = raw ? verifySession(raw, ctx.svc.secret) : null;
  if (c && c.repo === repoFull.toLowerCase() && c.exp > ctx.now()) {
    const m = await ctx.svc.members.get(repoFull, c.email);
    // Removed, or joined again since: the session ends.
    if (m && m.version === c.v && m.email === c.email) return m;
  }
  const a = await sessionAccount(req, ctx.svc.redis, ctx.svc.secret, ctx.now());
  if (!a) return null;
  const m = await ctx.svc.members.get(repoFull, a.email);
  return m && m.email === a.email ? m : null;
}

/**
 * The email member behind a request for this team (the team's cookie or a Bridge account session), for other functions
 * that accept contributors (api/ship). Null when not signed in, or when storage, the secret or the app is missing.
 */
export async function contributorOf(req: Request, repoFull: string, env: ContribEnv, deps: ContribDeps): Promise<EmailMember | null> {
  const svc = services(env, deps);
  if (!svc) return null;
  return sessionMember({ f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env }, req, repoFull);
}

const publicMember = (m: EmailMember) => ({ email: m.email, name: m.name, role: m.role });

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());
const hmacHex = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('hex').slice(0, 32);

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
  const t = parseAnyTarget(raw);
  if (t.owner.toLowerCase() !== owner.toLowerCase() || t.repo.toLowerCase() !== repo.toLowerCase()) throw notAllowed();
  return { rest: t.rest, rawRest: t.rawRest, query: t.query };
}

/**
 * The same checks as parseTarget, for a path under any /repos/<owner>/<repo>: the caller decides whether that
 * repository may be read (the team's own, or a product repository its bridge.config.json lists).
 */
export function parseAnyTarget(raw: unknown): Target & { owner: string; repo: string } {
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
  if (decoded.length < 3 || decoded[0] !== 'repos' || !/^[\w.-]+$/.test(decoded[1]!) || !/^[\w.-]+$/.test(decoded[2]!)) throw notAllowed();
  return { owner: decoded[1]!, repo: decoded[2]!, rest: decoded.slice(3), rawRest: segs.slice(3), query };
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

// branchKey, issueKey and mineKey (everything one member made here, "b:<branch>" and "i:<number>", so Studio counts it
// as theirs, GET ?mine=1) live in api/_lib/former-member.ts: account deletion forgets them.
/** Adds one branch or issue to the member's set, kept a year from the last addition. */
async function rememberMine(ctx: Ctx, repo: string, email: string, item: string) {
  await ctx.svc.redis.pipe([
    ['SADD', mineKey(repo, email), item],
    ['EXPIRE', mineKey(repo, email), OWNERSHIP_TTL_S],
  ]);
}
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

// ---------------------------------------------------------------------------------------------------------------
// Design files: the only paths an email contributor writes

export const DESIGN_ONLY = 'Bridge only saves design files (tokens, docs, assets) for people who joined with their email. Ask a developer to change this file.';

/** Where writes may land: folders, with the file kinds allowed in each. */
export interface DesignPaths {
  dirs: { dir: string; ext: string[] }[];
  /** Guardrails of the repository (bridge.config.json governance.guardrails): never, whatever the folder. */
  never: string[];
}

const DATA = ['.json', '.md'];
const IMAGES = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

/**
 * The design paths of a repository, from its bridge.config.json (the keys Studio and the plugin write under), with
 * the defaults Bridge uses when a key is absent. Without a config file, the built-in defaults alone.
 */
export function designPathsFrom(config: any): DesignPaths {
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  // bridge.config.json itself (owners, guardrails) is never theirs to change: isDesignPath refuses it.
  const dir = (d: string) => d.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  const c = config && typeof config === 'object' ? config : {};
  const componentsDir = typeof c.components?.dir === 'string' && c.components.dir.trim() ? dir(c.components.dir) : null;
  const docsSuffix = str(c.components?.docsSuffix, '.docs.json');
  const changesets = dir(str(c.changesets?.dir, '.changeset'));
  const dirs: DesignPaths['dirs'] = [
    // Token files (token editor, new brand, library update, history, the plugin).
    { dir: dir(str(c.tokens?.root, 'tokens')), ext: ['.json'] },
    // Changesets that go with a change: changesets.dir, and .changeset where some writers always put them.
    { dir: changesets, ext: ['.md'] },
    ...(changesets === '.changeset' ? [] : [{ dir: '.changeset', ext: ['.md'] }]),
    // Bridge's own files: Figma specs, drafts and request images, exploration notes.
    { dir: '.bridge', ext: [...DATA, ...IMAGES] },
  ];
  // Component usage docs (docs proposals) sit next to the code: only that suffix, never the code.
  if (componentsDir) dirs.push({ dir: componentsDir, ext: [docsSuffix] });
  const never = Array.isArray(c.governance?.guardrails) ? c.governance.guardrails.filter((g: unknown): g is string => typeof g === 'string').map((g: string) => g.replace(/^\.?\/+/, '')) : [];
  return { dirs, never };
}

const LOCKFILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lockb', 'bun.lock'];
const CODE = /\.(m?[jt]sx?|c[jt]s|sh|bash|zsh|py|rb|ya?ml|toml|html?|astro|vue|svelte|css|scss|less)$/i;
/** Tool configuration that happens to be JSON, and dotfiles (.npmrc, .eslintrc.json...): never design files. */
const TOOL_CONFIG = /^(\..*|(ts|js)config(\..+)?\.json|.*\.config\.json|(vercel|turbo|nx|lerna|renovate|biome|deno|composer)\.json)$/i;

/** Whether `path` (repository-relative, as GitHub takes it) is a design file this repository lets them write. */
export function isDesignPath(path: string, allowed: DesignPaths): boolean {
  const segs = path.split('/');
  if (!path || path.startsWith('/') || segs.some((s) => !s || s === '.' || s === '..' || /[\\\u0000-\u001f\u007f]/.test(s))) return false;
  const lower = path.toLowerCase();
  const base = segs[segs.length - 1]!.toLowerCase();
  // Never: CI, scripts, dependencies, package files, code, guardrails.
  if (lower.startsWith('.github/') || lower === '.github' || lower.startsWith('scripts/') || segs.some((s) => s.toLowerCase() === 'node_modules')) return false;
  if (LOCKFILES.includes(base) || CODE.test(base) || TOOL_CONFIG.test(base) || base === 'bridge.config.json') return false;
  if (allowed.never.some((g) => (g.endsWith('/') ? lower.startsWith(g.toLowerCase()) || `${lower}/` === g.toLowerCase() : lower === g.toLowerCase()))) return false;
  return allowed.dirs.some(({ dir, ext }) => {
    if (!dir) return false;
    // A folder entry of a tree (no extension needed) inside the design folder, or the folder itself.
    if (path === dir) return true;
    if (!path.startsWith(`${dir}/`)) return false;
    return !/\.[^/]+$/.test(segs[segs.length - 1]!) || ext.some((e) => lower.endsWith(e.toLowerCase()));
  });
}

/** bridge.config.json of the default branch, cached 5 minutes per warm function (memory only). */
const configCache = new Map<string, { at: number; paths: DesignPaths }>();

/** Tests start each case cold. */
export const clearDesignPathCache = () => configCache.clear();

async function designPaths(ctx: Ctx, c: Call, defaultBranch: string): Promise<DesignPaths> {
  const key = `${c.full}@${defaultBranch}`;
  const hit = configCache.get(key);
  if (hit && ctx.now() - hit.at < 5 * 60 * 1000) return hit.paths;
  let res: Response;
  try {
    res = await ctx.f(`${API}/repos/${c.owner}/${c.repo}/contents/bridge.config.json?ref=${encodeURIComponent(defaultBranch)}`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${c.token}`, 'User-Agent': 'bridge-contribute', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  let config: unknown = null;
  if (res.status === 200) {
    try {
      config = JSON.parse(await res.text());
    } catch {
      config = null;
    }
  } else if (res.status !== 404) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  // The name the team goes by, kept with it for the team pickers and emails (api/_lib/teams.ts). Never throws.
  if (res.status === 404 || config) await putTeamName(ctx.svc.redis, c.full, configName(config), ctx.now());
  const paths = designPathsFrom(config);
  configCache.set(key, { at: ctx.now(), paths });
  return paths;
}

interface RepoFacts {
  defaultBranch: string;
  private: boolean;
}

async function repoFacts(ctx: Ctx, c: Call): Promise<RepoFacts> {
  const repo = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}`);
  if (repo.status !== 200 || typeof repo.data?.default_branch !== 'string') throw new HttpError(409, 'app_missing', APP_MISSING);
  // Unknown visibility counts as public: the safer side for an email.
  return { defaultBranch: repo.data.default_branch as string, private: repo.data.private === true };
}

/** The stand-in address on a public repository: stable per member and team, under .invalid (RFC 2606, never routable). */
export const publicEmail = (secret: string, repo: string, email: string) => `${createHmac('sha256', secret).update(`contrib-author:${repo.toLowerCase()}:${email.toLowerCase()}`).digest('hex').slice(0, 12)}@contributors.bridge.invalid`;

/** What the policy allows for this call, with the body it sends; throws not-allowed otherwise. */
async function planCall(ctx: Ctx, c: Call): Promise<Plan> {
  const r = c.target.rest;
  const at = (...p: string[]) => r.length === p.length && p.every((x, i) => x === '*' || x === r[i]);
  const body = c.body ?? {};
  let facts: RepoFacts | null = null;
  const info = async () => (facts ??= await repoFacts(ctx, c));
  const def = async () => (await info()).defaultBranch;
  const isDefault = async (b: string) => b.toLowerCase() === (await def()).toLowerCase();
  const ownsBranch = async (b: unknown) => typeof b === 'string' && validBranch(b) && !(await isDefault(b)) && (await ctx.svc.redis.cmd('GET', branchKey(c.full, b))) === c.member.email;
  const ownsIssue = async (n: string | undefined) => n !== undefined && NUMBER.test(n) && (await ctx.svc.redis.cmd('GET', issueKey(c.full, n))) === c.member.email;
  const recordIssue = async (data: any) => {
    if (typeof data?.number === 'number') {
      await ctx.svc.redis.cmd('SET', issueKey(c.full, data.number), c.member.email, 'EX', OWNERSHIP_TTL_S);
      await rememberMine(ctx, c.full, c.member.email, `i:${data.number}`);
    }
  };
  // A work email is never published on a public repository: a stable address that routes nowhere stands in for it.
  const author = async () => ({ name: c.member.name, email: (await info()).private ? c.member.email : publicEmail(ctx.svc.secret, c.full, c.member.email) });
  const line = async () => `Requested by ${c.member.name}${(await info()).private ? ` (${c.member.email})` : ''} through Bridge.`;
  /** The text with the "Requested by" line at the end, unless it already carries it (attribution is never edited away). */
  const requested = async (text: unknown) => {
    const l = await line();
    const t = typeof text === 'string' ? text : '';
    if (t.includes(l)) return t;
    return `${t.trim() ? `${t}\n\n` : ''}${l}`;
  };
  /** Every path written must be a design file (bridge.config.json folders, or the built-in list). */
  const checkPaths = async (paths: string[]) => {
    const allowed = await designPaths(ctx, c, await def());
    if (!paths.length || paths.some((p) => !isDesignPath(p, allowed))) throw new HttpError(403, 'not-allowed', DESIGN_ONLY);
  };
  /**
   * Where a branch may point: a commit whose changes from the default branch are design files only. Checked on the
   * content, so it holds whatever the commit's origin (a tree built elsewhere, an object of a fork).
   */
  const checkCommit = async (sha: unknown) => {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) throw notAllowed();
    const cmp = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/compare/${encodeRef(await def())}...${sha}`);
    const files = cmp.data?.files;
    if (cmp.status !== 200 || !Array.isArray(files)) throw notAllowed();
    // GitHub lists at most 300 files: a change that large is not a design edit.
    if (files.length >= 300) throw new HttpError(403, 'not-allowed', DESIGN_ONLY);
    const paths = (files as { filename?: unknown; previous_filename?: unknown }[]).flatMap((f) => [f.filename, f.previous_filename].filter((x): x is string => typeof x === 'string'));
    if (paths.length) await checkPaths(paths);
  };

  switch (c.method) {
    case 'GET':
      return { body: null };

    case 'POST': {
      if (at('git', 'blobs')) return { body };
      if (at('git', 'trees')) {
        // Each entry a design file; never a submodule (160000) or a symlink (120000).
        const tree = body.tree;
        if (!Array.isArray(tree) || !tree.length) throw notAllowed();
        const entries = tree as Record<string, unknown>[];
        if (entries.some((e) => !e || typeof e !== 'object' || typeof e.path !== 'string' || (e.mode !== undefined && e.mode !== '100644' && e.mode !== '040000') || e.type === 'commit')) throw new HttpError(403, 'not-allowed', DESIGN_ONLY);
        // Folders too: a tree entry could graft a whole folder anywhere.
        await checkPaths(entries.map((e) => e.path as string));
        return { body: pick(body, ['base_tree', 'tree']) };
      }
      if (at('git', 'commits')) {
        const date = body.author && typeof body.author === 'object' && typeof (body.author as Record<string, unknown>).date === 'string' ? { date: (body.author as Record<string, unknown>).date } : {};
        const { committer: _c, author: _a, ...rest } = body;
        return { body: { ...rest, author: { ...(await author()), ...date } } };
      }
      if (at('git', 'refs')) {
        const m = typeof body.ref === 'string' ? /^refs\/heads\/(.+)$/.exec(body.ref) : null;
        const b = m?.[1];
        if (!b || !validBranch(b) || (await isDefault(b)) || typeof body.sha !== 'string') throw notAllowed();
        const exists = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/git/ref/heads/${encodeRef(b)}`);
        if (exists.status !== 404) throw notAllowed();
        await checkCommit(body.sha);
        return {
          body: { ref: `refs/heads/${b}`, sha: body.sha },
          after: async () => {
            await ctx.svc.redis.cmd('SET', branchKey(c.full, b), c.member.email, 'EX', OWNERSHIP_TTL_S);
            await rememberMine(ctx, c.full, c.member.email, `b:${b}`);
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
        return { body: { ...pick(body, ['title', 'draft']), head, base: body.base, body: await requested(body.body) }, after: recordIssue };
      }
      if (at('issues')) return { body: { ...pick(body, ['title', 'labels']), body: await requested(body.body) }, after: recordIssue };
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
        await checkCommit(body.sha);
        return { body: { sha: body.sha, force: false } };
      }
      if (at('pulls', '*')) {
        if (!onlyKeys(body, ['title', 'body', 'state', 'draft']) || !(await ownsIssue(r[1]))) throw notAllowed();
        return { body: 'body' in body ? { ...body, body: await requested(body.body) } : body };
      }
      if (at('issues', '*')) {
        if (!onlyKeys(body, ['title', 'body', 'state', 'labels']) || !(await ownsIssue(r[1]))) throw notAllowed();
        return { body: 'body' in body ? { ...body, body: await requested(body.body) } : body };
      }
      throw notAllowed();
    }

    case 'PUT':
    case 'DELETE': {
      if (r.length >= 2 && r[0] === 'contents') {
        if (!(await ownsBranch(body.branch))) throw notAllowed();
        await checkPaths([r.slice(1).join('/')]);
        const keys = c.method === 'PUT' ? ['message', 'content', 'sha', 'branch'] : ['message', 'sha', 'branch'];
        return { body: { ...pick(body, keys), author: await author() } };
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
  if (method === 'GET') return onTeamRead(req, ctx, params);
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
  // Reads kept by Bridge (api/_lib/team-read.ts) are checked again after a change made here.
  if (res.status >= 200 && res.status < 300) await noteWrite(ctx.svc.redis, full, ctx.now()).catch(() => undefined);
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
// Reads through Bridge (api/_lib/team-read.ts)

/**
 * Who may read `full` through Bridge: a member (the team's email session, a Bridge account that is a member of the
 * team, or in local mode a seeded admin), else anyone when it is a public demo team GitHub says is public. Null:
 * nobody we know.
 */
async function readerOf(ctx: Ctx, req: Request, full: string, rctx: ReadCtx): Promise<Reader | null> {
  // A member reads on their own budget (api/_lib/team-read.ts budgetOf), not their address's.
  const m = await sessionMember(ctx, req, full);
  if (m) return { kind: 'member', email: m.email };
  const a = await sessionAccount(req, ctx.svc.redis, ctx.svc.secret, ctx.now());
  if (a) {
    // The account's team set (api/_lib/members.ts keeps it, and team creation adds admins to it).
    if (Number(await ctx.svc.redis.cmd('SISMEMBER', accountTeamsKey(a.email), full.toLowerCase())) === 1) return { kind: 'member', email: a.email };
    if (ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(full, a.email))) return { kind: 'member', email: a.email };
  }
  if (PUBLIC_TEAMS.includes(full.toLowerCase())) {
    const { owner, repo } = parseRepo(full);
    if (await isPublicRepo(rctx, owner, repo)) return { kind: 'guest' };
  }
  return null;
}

/**
 * GET gh= (one GitHub read), blobs= (many blobs at once), users= (public profiles) or changes= (the status reads of
 * open changes), for a member or (gh= and blobs= only) a visitor of a public demo team.
 */
async function onTeamRead(req: Request, ctx: Ctx, params: URLSearchParams): Promise<Response> {
  const { owner, repo, full } = parseRepo(params.get('repo'));
  const rctx: ReadCtx = {
    f: ctx.f,
    now: ctx.now,
    redis: ctx.svc.redis,
    token: (o, r) => ctx.svc.readApp.installationToken(o, r),
    env: { READ_MAX_IP: ctx.env.READ_MAX_IP, READ_MAX_GUEST: ctx.env.READ_MAX_GUEST, READ_MAX_TEAM: ctx.env.READ_MAX_TEAM },
  };
  const blobs = params.get('blobs');
  const usersArg = params.get('users');
  const changesArg = params.get('changes');
  // The path is checked before anyone is looked up: a bad address costs no storage call.
  const logins = usersArg !== null ? parseUserList(usersArg) : null;
  const changes = changesArg !== null && !logins ? parseChangeList(changesArg) : null;
  const any = blobs === null && !logins && !changes ? parseAnyTarget(params.get('gh')) : null;
  // A path under another repository: a product repository of the team (bridge.config.json products[].repo), read only,
  // checked once the reader is known. Never its collaborators.
  const product = any && (any.owner.toLowerCase() !== owner.toLowerCase() || any.repo.toLowerCase() !== repo.toLowerCase()) ? { owner: any.owner, repo: any.repo } : null;
  const target = any;
  const shas = blobs !== null && !logins && !changes ? parseBlobList(blobs) : null;
  if (target && !readAllowed(target.rest, { kind: product ? 'guest' : 'member' })) throw new HttpError(403, 'not-allowed', READ_WORDS.notAllowed);
  const reader = await readerOf(ctx, req, full, rctx);
  if (!reader) {
    // A team cookie that no longer holds is cleared, as for any other call.
    const stale = readCookie(req, cookieName(full)) !== null;
    return json(401, { error: 'signin', message: SIGNIN }, stale ? { 'Set-Cookie': clearSession(full) } : {});
  }
  if (logins) return onUsers(req, rctx, { owner, repo, full }, logins, reader);
  if (changes) return onChanges(req, rctx, { owner, repo, full }, changes, reader);
  if (shas) return onBlobs(req, rctx, { owner, repo, full }, shas, reader);
  if (product) {
    await productReadAllowed(rctx, { owner, repo }, product, reader, notAllowed);
    // The team's budget and write marks, the product's token and cache entries (the URL names the product repository).
    return onRead(req, rctx, { owner: product.owner, repo: product.repo, full, rest: target!.rest, rawRest: target!.rawRest, query: target!.query }, reader);
  }
  return onRead(req, rctx, { owner, repo, full, rest: target!.rest, rawRest: target!.rawRest, query: target!.query }, reader);
}

/**
 * What the member made through here and still owns: branch names and issue or pull request numbers, from their set,
 * each one checked against its ownership key (a branch or number that changed hands, or expired, is left out).
 */
async function mineOf(ctx: Ctx, full: string, email: string): Promise<{ branches: string[]; issues: number[] }> {
  const items = ((await ctx.svc.redis.cmd('SMEMBERS', mineKey(full, email))) as string[] | null) ?? [];
  const branches: string[] = [];
  const issues: number[] = [];
  for (const it of items) {
    if (it.startsWith('b:')) {
      const b = it.slice(2);
      if ((await ctx.svc.redis.cmd('GET', branchKey(full, b))) === email) branches.push(b);
    } else if (it.startsWith('i:') && NUMBER.test(it.slice(2))) {
      if ((await ctx.svc.redis.cmd('GET', issueKey(full, it.slice(2)))) === email) issues.push(Number(it.slice(2)));
    }
  }
  return { branches: branches.sort(), issues: issues.sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------------------------------------------
// Members, for anyone on the team

/** A GitHub person as Settings > Members needs them: no email, no more than GitHub's collaborator list says. */
export interface TeamCollaborator {
  login: string;
  avatar_url?: string;
  role_name?: string;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
}

/** GitHub says the Bearer token of the request can read the repository: a member of the team on GitHub. */
async function githubReader(ctx: Ctx, req: Request, owner: string, repo: string): Promise<boolean> {
  const bearer = /^Bearer\s+([A-Za-z0-9_.-]{20,255})$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return false;
  const r = await ghApp(ctx, bearer, 'GET', `/repos/${owner}/${repo}`);
  return r.status === 200 && Boolean(r.data?.permissions?.pull);
}

/**
 * GET ?members=1: the team's people for a member who cannot list them on GitHub (an email contributor, a GitHub
 * reader). The GitHub people through the app's token, the email members by name and role. Never anyone's email:
 * admins manage people through api/invites, which shows them.
 */
async function membersOf(ctx: Ctx, req: Request, full: string, m: EmailMember | null): Promise<Response> {
  const { owner, repo } = parseRepo(full);
  if (!m && !(await githubReader(ctx, req, owner, repo))) return fail(401, 'signin', SIGNIN);
  const token = await ctx.svc.app.installationToken(owner, repo);
  if (!token) return fail(409, 'app_missing', APP_MISSING);
  const r = await ghApp(ctx, token, 'GET', `/repos/${owner}/${repo}/collaborators?affiliation=all&per_page=100`);
  if (r.status !== 200 || !Array.isArray(r.data)) return fail(502, 'unreachable', GITHUB_DOWN);
  const flags = ['admin', 'maintain', 'push', 'triage', 'pull'] as const;
  const collaborators: TeamCollaborator[] = r.data
    .filter((c: any) => c && typeof c.login === 'string')
    .map((c: any) => ({
      login: c.login,
      ...(typeof c.avatar_url === 'string' ? { avatar_url: c.avatar_url } : {}),
      ...(typeof c.role_name === 'string' ? { role_name: c.role_name } : {}),
      ...(c.permissions && typeof c.permissions === 'object' ? { permissions: Object.fromEntries(flags.filter((f) => typeof c.permissions[f] === 'boolean').map((f) => [f, c.permissions[f]])) } : {}),
    }));
  const people = await ctx.svc.members.list(full);
  // Local mode only: members seeded as admin (api/_lib/local-admin.ts) say so.
  const admins = ctx.svc.localAdmins ? await ctx.svc.localAdmins.adminsOf(full) : [];
  const members = people.map((p) => ({ name: p.name, role: admins.includes(p.email) ? 'admin' : p.role, ...(m && p.email === m.email ? { you: true } : {}) }));
  return json(200, { collaborators, members }, { 'Cache-Control': 'private, no-store' });
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
    const blobs = params.get('blobs');
    const users = params.get('users');
    const changes = params.get('changes');

    if (method === 'GET' && gh === null && blobs === null && users === null && changes === null) {
      const repoArg = params.get('repo');
      if (repoArg === null || !svc) {
        if (repoArg !== null) parseRepo(repoArg);
        return json(200, { available: Boolean(svc), member: null });
      }
      const { full } = parseRepo(repoArg);
      const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
      const m = await sessionMember(ctx, req, full);
      if (params.get('members') === '1') return await membersOf(ctx, req, full, m);
      if (params.get('mine') === '1') {
        if (!m) return fail(401, 'signin', SIGNIN);
        return json(200, await mineOf(ctx, full, m.email));
      }
      // Local mode only: a member seeded as admin reads as admin, so Studio shows them the admin screens (the server
      // checks again on every admin action).
      const admin = Boolean(m && svc.localAdmins && (await svc.localAdmins.isAdmin(full, m.email)));
      return json(200, { available: true, member: m ? { ...publicMember(m), ...(admin ? { role: 'admin' } : {}) } : null });
    }

    if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
    const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
    if (gh !== null || ((blobs !== null || users !== null || changes !== null) && method === 'GET')) return await onProxy(req, ctx, params);
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
  READ_MAX_IP: process.env.READ_MAX_IP,
  READ_MAX_GUEST: process.env.READ_MAX_GUEST,
  READ_MAX_TEAM: process.env.READ_MAX_TEAM,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleContribute(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
