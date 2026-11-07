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
//   GET  /api/contribute?repo=owner/name&mine=1          { branches, issues, products }  what the signed-in member made
//                                                        and owns, on the team and per product repository (copy, task)
//   GET  /api/contribute?repo=owner/name&mint=read-pass  { pass, exp, origins } | { pass: null }  for a member: a read
//                                                        pass for the team's product repositories (api/_lib/read-pass)
//                                                        and the product origins Studio may hand it to
//   GET  /api/contribute?repo=owner/name&members=1       { collaborators, members }  who is on the team, for Settings >
//                                                        Members of anyone on it: an email contributor (the cookie) or
//                                                        a GitHub account that can read the repository (Bearer). The
//                                                        GitHub people come from the app's token (login, avatar,
//                                                        permissions); the email members by name and role only, never
//                                                        another member's email
//   POST { action: 'sign-in', repo, email }              always { ok: true }; emails a link to members only
//   POST { action: 'verify', repo, token }               spends that link, sets the session cookie; { member }
//   POST { action: 'sign-out', repo }                    clears it
//   POST { action: 'library-update', repo, product }     a lead or an admin of the team: Bridge opens (or updates in
//                                                        place) the "Update the Bridge library" pull request in the
//                                                        product's own repository with its app, under the policy of
//                                                        api/_lib/library-update.ts (an update branch, package.json and
//                                                        package-lock.json only, never the default branch, never a
//                                                        merge); { state, pr, lockfile }
//   GET  /api/contribute?npm=<name>,<name>,...           { latest: { <name>: <version> | null } }  the latest published
//                                                        versions (public data, kept 5 minutes), at most 12 names
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
// A GET from a page of another origin (the Bridge toolbar in a product) reads gh= or blobs= of a public demo team as a
// visitor (every cookie ignored), and gets Access-Control-Allow-Origin (no credentials) only when the team's
// bridge.config.json names that origin or it is a local dev server (api/_lib/team-read.ts originAllowed); anything
// else from another origin answers 403 origin without CORS headers. With `&pass=<read pass>` (GET ?repo=<team>&
// mint=read-pass, members only, api/_lib/read-pass.ts), the same page reads gh= of a product repository the pass
// names, private ones and any team's included, read only.
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
//                                      "Requested by <name> through Bridge." (never their email); the pull request becomes theirs
//   PATCH  pulls/<n>                   theirs only; only title, body, state, draft; a new body keeps the line
//   PUT    pulls/<n>/update-branch     theirs only
//   POST   issues                      the same "Requested by" line; the issue becomes theirs
//   PATCH  issues/<n>                  theirs only; only title, body, state, labels; a new body keeps the line
//   POST   issues/<n>/comments         any issue or pull request; the body starts with "**<name>** (via Bridge):"
//   POST   issues/<n>/labels           theirs only
// Never: merges, reviews, requested reviewers, rulesets, branch protection, collaborators, deleting a ref, hooks,
// settings, another repository, GraphQL.
// A design lead signed in by email (the `lead` of their member record, given by an admin: api/invites set-lead) acts on
// any exploration of the team without owning it: its pull request's body, labels and comments, its developers' task,
// and in the library the note Done exploring removes. Never a push to someone's exploration in a copy, and nothing
// Bridge keeps about who it belongs to moves. For everyone else, the words only a lead says (api/_lib/lead-gate.ts:
// their decisions, their yes, Done exploring and the developers' task on a team with design owners) answer 403
// lead-only, read against the body on GitHub.
// Designers signed in with GitHub (push on the team's repository, not an admin, not a lead: githubDesignerOf) go
// through here too for the team's products, proving who they are with their own GitHub token (Authorization: Bearer,
// read with GET /user and the team's repository, never trusted from the browser); their branches are kept as
// gh:<login>, and an exploration they opened on GitHub before is theirs when its pull request is their own. In the
// library they keep their own GitHub path; leads and admins keep GitHub for every write.
// Reads of the team's library and products (GET gh=, users=, changes=) are for everyone on the team signed in with
// GitHub, leads and admins too (githubTeamReaderOf: an explicit role on the team's repository, or read on a private
// one), with the app's read token and the shared read cache (api/_lib/team-read.ts): a private product or design copy
// reads for them whatever their own token can see, and the Studio no longer spends each viewer's own GitHub limit.
//
// In the team's products (bridge.config.json products[] with a design.repo, planProductCall), an email designer
// explores like everyone: in the design team's copy their explore/* branches (started from the default branch with
// design files only, then moved forward with any file but CI, hosting settings and node_modules: prototype code is
// theirs to write there, isSandboxPath), their draft
// pull request to the default branch, its exploration labels and comments, Sync fork of the default branch and the
// default branch merged into their exploration; in the developers' repository the from-design label and one task per
// exploration of theirs, which they may comment on, close as not planned and reopen. A product without a copy: reads only.
// Design files only, everywhere but their own explorations in a copy: writes land in the folders bridge.config.json
// declares for tokens, component docs and specs, changesets and Bridge's own files (designPaths), never code, CI,
// package files or guardrails, because CI runs what a pull request contains. On a public repository the member's email
// is never published: commits carry <hash>@contributors.bridge.invalid and the "Requested by" line names them without
// the email.
// Whose exploration is whose in a copy: a branch is theirs when Bridge keeps them as its owner (they started it
// through here), else, with no owner kept, when its open pull request says so (opened by their GitHub account, or its
// exploration block names their login or their member reference); a pull request is whoever owns its branch, read on
// GitHub, never an owner kept by number (a copy made again starts its numbers over). ownsExploration, ownedCopyPull.
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
// GITHUB_WEBHOOK_SECRET: the Bridge GitHub App's webhook (?hook=github, api/_lib/github-webhook.ts); without it, 503.
// BREVO_API_KEY + NOTIFY_FROM: the notifications that webhook turns deliveries into for members who joined by email
// (api/_lib/notify.ts); without the key they are kept, not sent. What a member files here, and the team's products
// when they open Studio (?mine=1), are watched for them (bridge:notify:teams).

import { createHmac, randomBytes } from 'node:crypto';
import { sessionAccount } from '../_lib/account.js';
import { demoDialog } from '../../src/lib/demo.js';
import { escHtml, mailButton, mailP, mailPage, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { explorationBlockOf, memberRef, withMemberInBlock } from '../_lib/exploration-member.js';
import { branchKey, issueKey, mineItems, mineKey } from '../_lib/former-member.js';
import { canonicalEmail, sameEmail } from '../_lib/canonical-email.js';
import { githubApp, type AppTokens } from '../_lib/github-app.js';
import { handleGithubWebhook } from '../_lib/github-webhook.js';
import { cleanTitle, linkedCopy } from '../_lib/notify-events.js';
import { itemWrite, notifySenderFromEnv, publicLoginId, repoMetaKey, watchWrites, type RepoMeta } from '../_lib/notify.js';
import { runLeadGuard } from '../_lib/lead-guard.js';
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
import { meteredFromEnv } from '../_lib/github-quota.js';
import { approves, memberCanWrite, memberStore, type EmailMember, type MemberStore } from '../_lib/members.js';
import { askedToReview, decidesOnExplorations, needsReview, reviewModeOf, type ReviewMode } from '../_lib/review-mode.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import { sharedAppTokens } from '../_lib/shared-token.js';
import { configName, putTeamName } from '../_lib/teams.js';
import { cookieAttrs, readCookie, signClaims, verifyClaims } from '../_lib/session.js';
import { teamInSet } from '../_lib/members.js';
import { addsLeadWords, handsOff, LEAD_ONLY } from '../_lib/lead-gate.js';
import { explorationKeeper } from '../_lib/exploration-keeper.js';
import { addsPmWords, isPm, PM_ONLY, PRODUCT_KEY, pmOf, pmsOf, publicPm, setPm, withPmWord, type PmWord, type ProductPm } from '../_lib/product-pm.js';
import { deliverNotices, teamBase, type NotifyDeps } from '../_lib/notify.js';
import { buildComment, buildRecordOf, buildStateOf, buildSummary, designCheckStatus, mentionedIssues, NO_DESIGN, DESIGN_CHECK, DESIGN_TASK_BACK_COMMENT_SERVER, devPullOfEvents, reopenedBody, saveBuild, taskOfUrl, type BuildNeed, type BuildRole, type BuildWord } from '../_lib/build-check.js';
import type { Notice } from '../_lib/notify-events.js';
import { npmLatest, parseNpmNames, sendLibraryUpdate } from '../_lib/library-update.js';
import { validPackageName } from '../../src/lib/library-update.js';
import { canonicalRepo } from '../../src/lib/team-path.js';
import { mintReadPass, passOpens, verifyReadPass, type ReadPass } from '../_lib/read-pass.js';
import { corsHeaders, isPublicRepo, memberBudgetId, originAllowed, productReadAllowed, teamReadConfigOf, noteWrite, onBlobs, onChanges, onRead, onUsers, parseBlobList, profileNameOf, parseChangeList, parseUserList, isPublicTeam, openToVisitors, READ_BASE, READ_PERMISSIONS, readAllowed, READ_WORDS, type ReadCtx, type Reader } from '../_lib/team-read.js';

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
  /** GitHub calls one reader may cost the app per 10 minutes (api/_lib/team-read.ts READ_LIMITS.upstream). */
  READ_MAX_UPSTREAM?: string | undefined;
  /** The Bridge GitHub App's webhook secret (api/_lib/github-webhook.ts, POST /api/github-webhook). */
  GITHUB_WEBHOOK_SECRET?: string | undefined;
  /** Notifications through Brevo (api/_lib/notify.ts); without the key they are kept, not sent. */
  BREVO_API_KEY?: string | undefined;
  NOTIFY_FROM?: string | undefined;
}

export interface ContribDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  /** Injected services (tests); otherwise built from the env. */
  redis?: Redis;
  members?: MemberStore;
  email?: EmailSender;
  /** The notification sender (tests); otherwise Brevo from the env, or null. */
  notifySender?: EmailSender | null;
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
/** A member with Can view writes nothing through Bridge: the same sentence as api/_lib/team-caller CALLER_WORDS.viewOnly. */
export const VIEW_ONLY = 'You can view this team. Ask an admin for Can edit to change things.';
const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
const APP_MISSING = 'Bridge cannot write to this design system yet. An admin of the repository gives the Bridge app access to it.';
const PRODUCT_APP_MISSING = 'Bridge cannot work in this product yet. Ask an admin to connect it to Bridge.';
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
  /**
   * The same app narrowed to Commit statuses write only: the "Design check" Bridge sets on the developers' pull
   * requests. Null token when the installation lacks it (the check is then said in Studio and in comments only).
   */
  statusApp: AppTokens;
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

/** This function's memory of the shared read tokens (api/_lib/shared-token.ts). */
const sharedReadMemory = new Map<string, { token: string; until: number; check: number }>();

/**
 * Read tokens: the app narrowed to READ_PERMISSIONS, else to READ_BASE when the installation lacks one of the extra
 * read permissions (statuses, checks). Never a write permission. One token per repository shared by every function
 * (api/_lib/shared-token.ts), so the ETags Bridge keeps stay valid whichever function revalidates them.
 */
function readTokens(appId: string, pem: string, f: FetchLike, now: () => number, redis: Redis, secret: string): AppTokens {
  const share = (app: AppTokens, scope: string) => sharedAppTokens(app, { redis, secret, now, scope, memory: sharedReadMemory });
  const full = share(githubApp(appId, pem, f, now, { permissions: { ...READ_PERMISSIONS }, require: { ...READ_PERMISSIONS }, userAgent: 'bridge-read' }), `${appId}:read`);
  const base = share(githubApp(appId, pem, f, now, { permissions: { ...READ_BASE }, require: { ...READ_BASE }, userAgent: 'bridge-read' }), `${appId}:read-base`);
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
  const readApp = deps.app ?? readTokens(appId!, pem!, deps.fetch, now, redis, secret);
  const statusApp = deps.app ?? cachedApp(githubApp(appId!, pem!, deps.fetch, now, { permissions: { statuses: 'write' }, require: { statuses: 'write' }, userAgent: 'bridge-contribute' }), `${appId}:statuses`, now);
  return { redis, members: deps.members ?? memberStore(redis), email, app, readApp, statusApp, secret, localAdmins: activeLocalAdmins(deps.localAdmins) };
}

interface Ctx {
  f: FetchLike;
  now: () => number;
  random: (n: number) => Uint8Array;
  svc: Services;
  env: ContribEnv;
  /**
   * A read from a page of another origin (the Bridge toolbar in a product): its Origin. It reads as a visitor (no
   * cookie counts) and gets CORS headers once `ok` (the team's config names that origin).
   */
  cross?: { origin: string; ok: boolean };
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
    if (m && m.version === c.v && sameEmail(m.email, c.email)) return m;
  }
  const a = await sessionAccount(req, ctx.svc.redis, ctx.svc.secret, ctx.now());
  if (!a) return null;
  const m = await ctx.svc.members.get(repoFull, a.email);
  return m && sameEmail(m.email, a.email) ? m : null;
}

/**
 * For the hosted connector (api/mcp): when the GitHub account of `token` is a designer of `team` (githubDesignerOf),
 * the repositories of the team's products (each design copy and developers' repository) it reaches through Bridge;
 * null for a lead, an admin, anyone else, or when the proxy is not set up.
 */
export async function designerProductsFor(token: string, team: string, env: ContribEnv, deps: ContribDeps): Promise<string[] | null> {
  const svc = services(env, deps);
  if (!svc) return null;
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
  const t = parseRepo(team);
  const d = await githubDesignerOf(ctx, new Request('https://bridge.invalid/', { headers: { Authorization: `Bearer ${token}` } }), t);
  if (d.kind !== 'designer') return null;
  return (await productPairs(ctx, t)).flatMap((p) => [p.copy, p.code]);
}

/**
 * For the hosted connector (api/mcp): what a member Bridge writes for made through its app on `team` and its products
 * (an email member by their email, a designer signed in with GitHub by their token), as branches by repository, so
 * "mine" finds explorations GitHub shows under the app's name. Null when not one of them or the proxy is not set up.
 */
export async function ownedWorkFor(who: { email: string } | { token: string }, team: string, env: ContribEnv, deps: ContribDeps): Promise<{ repo: string; branch: string }[] | null> {
  const svc = services(env, deps);
  if (!svc) return null;
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
  const t = parseRepo(team);
  let email: string;
  if ('email' in who) email = who.email;
  else {
    const d = await githubDesignerOf(ctx, new Request('https://bridge.invalid/', { headers: { Authorization: `Bearer ${who.token}` } }), t);
    if (d.kind !== 'designer') return null;
    email = d.member.email;
  }
  const m = await mineWithProducts(ctx, t.full, email);
  return [
    ...m.branches.map((branch) => ({ repo: t.full.toLowerCase(), branch })),
    ...Object.entries(m.products).flatMap(([repo, p]) => p.branches.map((branch) => ({ repo, branch }))),
  ];
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

/**
 * The member as their own browser reads them. `lead`: asked to review explorations (emails, Needs you); `decides`: may
 * answer on someone else's exploration (a lead, any designer when review is shared, an admin who is never asked).
 */
const publicMember = (m: EmailMember, mode: ReviewMode = 'one') => ({
  email: m.email,
  name: m.name,
  role: m.role,
  ref: memberRef(m.email),
  ...(askedToReview(m, mode) ? { lead: true } : {}),
  ...(decidesOnExplorations(m, mode) ? { decides: true } : {}),
});

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
  const html = mailPage({
    subject,
    preheader: 'The link works once and expires in 15 minutes.',
    body: [
      mailP(`Sign in to the <strong>${escHtml(x.repo)}</strong> design system on Bridge.`, true),
      mailButton(x.link, 'Open Bridge'),
      `<p style="margin:16px 0 0">The link works once and expires in 15 minutes. It keeps you signed in on that browser for 30 days.</p>`,
    ].join('\n'),
    footer: 'If you did not ask for it, you can ignore this email.',
  });
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
        `bridge:contrib:count:signin:email:${hmacHex(svc.secret, `email:${canonicalEmail(email)}`)}:${day}`,
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

    case 'library-update':
      return await onLibraryUpdate(req, ctx, body);

    case 'set-pm':
      return await onSetPm(req, ctx, body);

    case 'pm-word':
      return await onPmWord(req, ctx, body);

    case 'build-state':
      return await onBuild(req, ctx, body, false);

    case 'build-word':
      return await onBuild(req, ctx, body, true);

    case 'build-checks':
      return await onBuildChecks(req, ctx, body);

    case 'exploration-keeper': {
      // A lead signed in by email hands an exploration over: the member record says they lead, never the browser.
      const team = parseRepo(body.repo);
      const m = await sessionMember(ctx, req, team.full);
      if (!decidesOnExplorations(m, await reviewModeOf(ctx.svc.redis, team.full))) return fail(403, 'not-allowed', LEAD_ONLY);
      return explorationKeeper(ctx.svc, team.full.toLowerCase(), body);
    }

    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The demo's one write gate

/** Actions anyone may send on a demo team: signing in and out, and reads sent as POST. */
const DEMO_OPEN_ACTIONS: ReadonlySet<string> = new Set(['sign-in', 'verify', 'sign-out', 'build-state', 'build-checks']);

/** The refusal code of a write on a demo team by someone who is not on it; Studio opens its demo dialog on it. */
export const DEMO_REFUSAL = 'demo';

/**
 * The one place a demo team (src/lib/demo.ts DEMO_REPOS: the sample team, Bridge's own design system) refuses writes:
 * any POST, PUT, PATCH or DELETE through Bridge, by someone who is not on the team (an email member, a GitHub account
 * that can push or triage, a Bridge account of the team), answers 403 `demo` in the demo dialog's words. Visitors read
 * the demo exactly as a member who views it does; only this gate differs. Null: not a demo team, or someone on it.
 */
export async function demoWriteRefusal(ctx: Ctx, req: Request, params: URLSearchParams): Promise<Response | null> {
  let repoArg = params.get('repo');
  if (params.get('gh') === null) {
    const body = (await req
      .clone()
      .json()
      .catch(() => null)) as { action?: unknown; repo?: unknown } | null;
    if (typeof body?.action === 'string' && DEMO_OPEN_ACTIONS.has(body.action)) return null;
    if (typeof body?.repo === 'string') repoArg = body.repo;
  }
  if (!repoArg) return null;
  let team: { owner: string; repo: string; full: string };
  try {
    team = parseRepo(repoArg);
  } catch {
    return null;
  }
  if (!isPublicTeam(team.full)) return null;
  if (await sessionMember(ctx, req, team.full)) return null;
  if (req.headers.get('authorization') && (await githubTeamReaderOf(ctx, req, { ...team, full: team.full.toLowerCase() }))) return null;
  const a = await sessionAccount(req, ctx.svc.redis, ctx.svc.secret, ctx.now());
  if (a && ((await teamInSet(ctx.svc.redis, a.email, team.full)) || (ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(team.full, a.email))))) return null;
  return fail(403, DEMO_REFUSAL, demoDialog(team.full).lead);
}

// ---------------------------------------------------------------------------------------------------------------
// The product manager of a product (api/_lib/product-pm.ts, boards R2 and R3)

export const PM_WORDS = {
  notLead: 'Leads and admins choose the product manager.',
  noProduct: 'This team lists no such product.',
  notMember: 'They are not on this team.',
  noPm: 'This product has no product manager yet. A lead or an admin picks one in Settings.',
  notYours: 'Only the designer of this exploration can say this.',
  note: 'Say what to change.',
  gone: 'It already went to the developers.',
  noExploration: 'Bridge cannot find this exploration.',
};

/** Who is asking: an email member of the team (any role), or a GitHub account that reads the team's repository. */
async function callerOn(ctx: Ctx, req: Request, team: { owner: string; repo: string; full: string }): Promise<{ email?: string; login?: string; name: string; lead: boolean } | null> {
  const m = await sessionMember(ctx, req, team.full);
  if (m) {
    const admin = m.role === 'admin' || Boolean(ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(team.full, m.email)));
    return { email: m.email, name: m.name, lead: admin || approves(m) };
  }
  if (!req.headers.get('authorization')) return null;
  const a = await githubAccountOn(ctx, req, team);
  if (a?.kind === 'expired') throw new HttpError(401, 'signin', GITHUB_EXPIRED);
  if (a?.kind !== 'account' || !githubReadsTeam(a.perms, a.private)) return null;
  return { login: a.login, name: a.name, lead: githubRoleOf(a.perms, a.login, (await teamFacts(ctx, team)).leads) === 'lead' };
}

/**
 * POST { action: 'set-pm', repo, product, pm: { ref } | { login, name? } | null }: a lead or an admin of the team picks the
 * product manager of a product (any member, Can view is enough), or none. An email member is named by their reference,
 * never their email.
 */
async function onSetPm(req: Request, ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const team = parseRepo(body.repo);
  const t = { ...team, full: team.full.toLowerCase() };
  const who = await callerOn(ctx, req, t);
  if (!who) return fail(401, 'signin', SIGNIN);
  if (!who.lead) return fail(403, 'not-allowed', PM_WORDS.notLead);
  const product = typeof body.product === 'string' ? body.product.trim().toLowerCase() : '';
  if (!PRODUCT_KEY.test(product)) return fail(400, 'bad_request', PM_WORDS.noProduct);
  const pm = body.pm as { ref?: unknown; login?: unknown; name?: unknown } | null | undefined;
  let next: ProductPm | null = null;
  if (pm && typeof pm.ref === 'string') {
    const m = (await ctx.svc.members.list(t.full)).find((x) => memberRef(x.email) === pm.ref);
    if (!m) return fail(404, 'not_found', PM_WORDS.notMember);
    next = { email: m.email, name: m.name };
  } else if (pm && typeof pm.login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(pm.login)) {
    next = { login: pm.login, name: typeof pm.name === 'string' && pm.name.trim() ? pm.name.trim().slice(0, 80) : pm.login };
  } else if (pm !== null) return fail(400, 'bad_request', PM_WORDS.notMember);
  await setPm(ctx.svc.redis, t.full, product, next);
  return json(200, { ok: true, pm: next ? publicPm(next) : null });
}

/**
 * POST { action: 'pm-word', repo, product, copy, number, kind, text? }: the product manager says it looks good or needs
 * changes (with their note) on an exploration of their product, or its designer says the PM agreed in a call. Bridge
 * writes it in the exploration's block with its app (a PM may only view), and tells the other one.
 */
async function onPmWord(req: Request, ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const team = parseRepo(body.repo);
  const t = { ...team, full: team.full.toLowerCase() };
  const who = await callerOn(ctx, req, t);
  if (!who) return fail(401, 'signin', SIGNIN);
  const kind = body.kind;
  if (kind !== 'pm-ok' && kind !== 'pm-changes' && kind !== 'pm-call') return fail(400, 'bad_request', 'Unknown word.');
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (kind === 'pm-changes' && !text) return fail(400, 'bad_request', PM_WORDS.note);
  const product = typeof body.product === 'string' ? body.product.trim().toLowerCase() : '';
  const n = Number(body.number);
  const copy = typeof body.copy === 'string' ? body.copy.toLowerCase() : '';
  if (!PRODUCT_KEY.test(product) || !Number.isSafeInteger(n) || n < 1) return fail(400, 'bad_request', PM_WORDS.noExploration);
  const facts = await teamFacts(ctx, t);
  // Only a repository of that product: its design copy or its developers' repository.
  const pair = facts.pairs.find((p) => p.key?.toLowerCase() === product && (p.copy === copy || p.code === copy));
  if (!pair) return fail(404, 'no_product', PM_WORDS.noProduct);
  const pm = await pmOf(ctx.svc.redis, t.full, product);
  if (!pm) return fail(409, 'no_pm', PM_WORDS.noPm);
  const [owner, name] = copy.split('/') as [string, string];
  const token = await ctx.svc.app.installationToken(owner, name);
  if (!token) return fail(409, 'product_missing', PRODUCT_APP_MISSING);
  const p = await ghApp(ctx, token, 'GET', `/repos/${owner}/${name}/pulls/${n}`);
  const block = p.status === 200 ? explorationBlockOf(p.data?.body) : null;
  if (!block) return fail(404, 'not_found', PM_WORDS.noExploration);
  if (typeof block.doneAt === 'string') return fail(409, 'gone', PM_WORDS.gone);
  const designer = (typeof block.member === 'string' && who.email && block.member === memberRef(who.email)) || (who.login && typeof block.author === 'string' && block.author.toLowerCase() === who.login.toLowerCase());
  if (kind === 'pm-call' ? !designer : !isPm(pm, who)) return fail(403, 'not-allowed', kind === 'pm-call' ? PM_WORDS.notYours : PM_ONLY);
  const word: PmWord = { kind, at: new Date(ctx.now()).toISOString(), ...(who.login ? { by: who.login } : {}), byName: who.name, ...(kind === 'pm-changes' || (kind === 'pm-ok' && text) ? { text } : {}), ...(kind === 'pm-call' ? { to: [pm.name] } : {}) };
  const next = withPmWord(String(p.data.body), word);
  if (!next) return fail(404, 'not_found', PM_WORDS.noExploration);
  const w = await ghAppSend(ctx, token, 'PATCH', `/repos/${owner}/${name}/pulls/${n}`, { body: next });
  if (w.status !== 200) return fail(502, 'unreachable', GITHUB_DOWN);
  await noteWrite(ctx.svc.redis, t.full, ctx.now()).catch(() => undefined);
  // The other one hears it: the designer the PM's word, the PM the designer's word of their call.
  const title = cleanTitle(block.name);
  const notice: Notice = {
    kind: kind === 'pm-ok' ? 'lead-pm-ok' : kind === 'pm-changes' ? 'lead-pm-changes' : 'lead-pm-call',
    repo: copy,
    items: [n],
    title,
    actor: { login: who.login ?? '', id: null },
    actorName: who.name,
    copy: null,
    scope: 'any',
    ...(kind === 'pm-changes' ? { quote: text.slice(0, 280) } : {}),
    ...(kind === 'pm-call' ? { to: [pm.email ? `email:${pm.email}` : pm.login!] } : {}),
  };
  const nd: NotifyDeps = { redis: ctx.svc.redis, sender: notifySenderFromEnv(ctx.env, ctx.f), secret: ctx.svc.secret, origin: siteOrigin(req, ctx.env.PUBLIC_SITE_URL), now: ctx.now, members: ctx.svc.members, loginId: publicLoginId(ctx.f) };
  await deliverNotices([notice], nd, `pm:${copy}:${n}:${word.at}`).catch(() => undefined);
  return json(200, { ok: true, word });
}

export const BUILD_WORDS = {
  notReady: 'The developers have not shown a build yet.',
  notYours: 'Only its designer, the product manager or a design lead checks the build.',
  note: 'Say what to change.',
};

/**
 * POST { action: 'build-state' | 'build-word', repo, product, copy, number, kind?, why?, text? } (board R4): the check
 * of the developers' build of a handed-off exploration of a design copy. Read: who must say it looks right, what each
 * said on the build's last commit, and the "Design check" status Bridge keeps on it (written again on each read, so a
 * push shows pending at once). Write: the designer, the PM of the product or a design lead says Looks right or Needs
 * changes (the build is off, or the design must change), with their note; Bridge signs it on the developers' pull
 * request. Members by email and PMs who only view go through here: the words are Bridge's to write.
 */
async function onBuild(req: Request, ctx: Ctx, body: Record<string, unknown>, write: boolean): Promise<Response> {
  const team = parseRepo(body.repo);
  const t = { ...team, full: team.full.toLowerCase() };
  const who = await callerOn(ctx, req, t);
  if (!who) return fail(401, 'signin', SIGNIN);
  const product = typeof body.product === 'string' ? body.product.trim().toLowerCase() : '';
  const n = Number(body.number);
  const copy = typeof body.copy === 'string' ? body.copy.toLowerCase() : '';
  if (!PRODUCT_KEY.test(product) || !Number.isSafeInteger(n) || n < 1) return fail(400, 'bad_request', PM_WORDS.noExploration);
  const facts = await teamFacts(ctx, t);
  const pair = facts.pairs.find((p) => p.key?.toLowerCase() === product && p.copy === copy);
  if (!pair) return fail(404, 'no_product', PM_WORDS.noProduct);
  const [co, cn] = copy.split('/') as [string, string];
  const copyToken = await ctx.svc.app.installationToken(co, cn);
  if (!copyToken) return fail(409, 'product_missing', PRODUCT_APP_MISSING);
  const ex = await ghApp(ctx, copyToken, 'GET', `/repos/${co}/${cn}/pulls/${n}`);
  const block = ex.status === 200 ? explorationBlockOf(ex.data?.body) : null;
  if (!block) return fail(404, 'not_found', PM_WORDS.noExploration);
  const task = taskOfUrl(block.task);
  // Only the task of that product, in its developers' repository.
  if (!task || task.repo !== canonicalRepo(pair.code).toLowerCase()) return fail(409, 'not_ready', BUILD_WORDS.notReady);
  const [ro, rn] = pair.code.split('/') as [string, string];
  const token = await ctx.svc.app.installationToken(ro, rn);
  if (!token) return fail(409, 'product_missing', PRODUCT_APP_MISSING);
  const tl = await ghApp(ctx, token, 'GET', `/repos/${ro}/${rn}/issues/${task.number}/timeline?per_page=100`);
  const dev = tl.status === 200 ? devPullOfEvents(tl.data, pair.code) : null;
  if (!dev || dev.draft) return fail(409, 'not_ready', BUILD_WORDS.notReady);
  const pr = await ghApp(ctx, token, 'GET', `/repos/${ro}/${rn}/pulls/${dev.number}`);
  const head = typeof pr.data?.head?.sha === 'string' ? (pr.data.head.sha as string) : null;
  if (pr.status !== 200 || !head || pr.data?.draft === true || pr.data?.state !== 'open') return fail(409, 'not_ready', BUILD_WORDS.notReady);
  const pm = await pmOf(ctx.svc.redis, t.full, product);
  // The design lead checks again only when the exploration sent pieces to the library: those change since approval.
  const designerName = typeof block.memberName === 'string' ? block.memberName : typeof block.author === 'string' ? block.author : typeof block.doneBy === 'string' ? block.doneBy : undefined;
  const need: BuildNeed = { pm: Boolean(pm), lead: Array.isArray(block.leadPieces) && block.leadPieces.length > 0, names: { ...(designerName ? { designer: designerName } : {}), ...(pm ? { pm: pm.name } : {}) } };
  const designer = Boolean((typeof block.member === 'string' && who.email && block.member === memberRef(who.email)) || (who.login && [block.author, block.doneBy].some((a) => typeof a === 'string' && a.toLowerCase() === who.login!.toLowerCase())));
  const role: BuildRole | null = designer ? 'designer' : isPm(pm, who) ? 'pm' : who.lead ? 'lead' : null;
  let words = (await buildRecordOf(ctx.svc.redis, pair.code, dev.number)).words;
  if (!write) words = await saveBuild(ctx.svc.redis, pair.code, dev.number, need);
  if (write) {
    if (!role) return fail(403, 'not-allowed', BUILD_WORDS.notYours);
    const kind = body.kind === 'looks-right' || body.kind === 'changes' ? body.kind : null;
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
    if (!kind) return fail(400, 'bad_request', 'Unknown word.');
    if (kind === 'changes' && !text) return fail(400, 'bad_request', BUILD_WORDS.note);
    const word: BuildWord = { role, ...(who.login ? { by: who.login } : {}), byName: who.name, kind, ...(kind === 'changes' ? { why: body.why === 'design' ? 'design' : 'build', text } : {}), sha: head, at: new Date(ctx.now()).toISOString() };
    words = await saveBuild(ctx.svc.redis, pair.code, dev.number, need, word);
    await ghAppSend(ctx, token, 'POST', `/repos/${ro}/${rn}/issues/${dev.number}/comments`, { body: buildComment(word) });
    // The design must change: the exploration runs again for its designer (Back to exploring, a new round, then the
    // lead again), and the developers' task leaves their list with the word that says so.
    if (kind === 'changes' && word.why === 'design') {
      const reopened = reopenedBody(String(ex.data.body), { at: word.at, ...(who.login ? { by: who.login } : {}), byName: who.name, text });
      if (reopened) await ghAppSend(ctx, copyToken, 'PATCH', `/repos/${co}/${cn}/pulls/${n}`, { body: reopened });
      await ghAppSend(ctx, copyToken, 'POST', `/repos/${co}/${cn}/issues/${n}/labels`, { labels: [EXPLORATION_LABEL_SERVER] }).catch(() => undefined);
      await ghAppSend(ctx, copyToken, 'DELETE', `/repos/${co}/${cn}/issues/${n}/labels/${encodeURIComponent(EXPLORATION_READY_LABEL)}`, {}).catch(() => undefined);
      await ghAppSend(ctx, token, 'POST', `/repos/${ro}/${rn}/issues/${task.number}/comments`, { body: `${DESIGN_TASK_BACK_COMMENT_SERVER}\n\n${text}` }).catch(() => undefined);
      await ghAppSend(ctx, token, 'PATCH', `/repos/${ro}/${rn}/issues/${task.number}`, { state: 'closed', state_reason: 'not_planned' }).catch(() => undefined);
      await noteWrite(ctx.svc.redis, t.full, ctx.now()).catch(() => undefined);
    }
    // Needs changes reaches the designer (and the PM, when the designer or a lead said it) right away.
    if (kind === 'changes') {
      const title = cleanTitle(block.name);
      const to = [...(role !== 'designer' ? [null] : []), ...(pm && role !== 'pm' ? [pm.email ? `email:${pm.email}` : pm.login!] : [])];
      const nd: NotifyDeps = { redis: ctx.svc.redis, sender: notifySenderFromEnv(ctx.env, ctx.f), secret: ctx.svc.secret, origin: siteOrigin(req, ctx.env.PUBLIC_SITE_URL), now: ctx.now, members: ctx.svc.members, loginId: publicLoginId(ctx.f) };
      const notices: Notice[] = to.map((x) => ({ kind: 'lead-build-changes', repo: copy, items: [n], title, actor: { login: who.login ?? '', id: null }, actorName: who.name, copy: null, scope: 'any', quote: text.slice(0, 280), ...(x ? { to: [x] } : {}) }));
      await deliverNotices(notices, nd, `build:${pair.code}:${dev.number}:${word.at}`).catch(() => undefined);
    }
  }
  const st = buildStateOf(words, head, need);
  const target = `${teamBase(siteOrigin(req, ctx.env.PUBLIC_SITE_URL), t.full)}changes/?exploration=${n}&product=${encodeURIComponent(product)}`;
  // The status needs the app's Commit statuses write permission: without it the comment still says it, and Studio too.
  const named = designCheckStatus(st, need.names, { designChanging: write && body.why === 'design' && body.kind === 'changes' });
  // The app's token for the proxy carries no status write: a token of its own, narrowed to it.
  const statusToken = await ctx.svc.statusApp.installationToken(ro, rn).catch(() => null);
  const status = statusToken ? await ghAppSend(ctx, statusToken, 'POST', `/repos/${ro}/${rn}/statuses/${head}`, { ...named, context: DESIGN_CHECK, target_url: target }).catch(() => ({ status: 0, data: null })) : { status: 0, data: null };
  return json(200, { ...st, head, pull: { number: dev.number, url: dev.url }, role, statusWritten: status.status === 201 });
}

const EXPLORATION_LABEL_SERVER = 'exploration';

/**
 * POST { action: 'build-checks', repo, pulls: [{ code, number }] }: for the lists (Being built, Home, Changes), where the
 * check of each developers' build stands on its head, from what Bridge keeps (never a write): who is still waiting, or
 * who asked for changes. Null for a build nobody opened in Studio yet (the lists keep the last answer then).
 */
async function onBuildChecks(req: Request, ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const team = parseRepo(body.repo);
  const t = { ...team, full: team.full.toLowerCase() };
  if (!(await callerOn(ctx, req, t))) return fail(401, 'signin', SIGNIN);
  const asked = Array.isArray(body.pulls) ? body.pulls.slice(0, 20) : [];
  const codes = new Set((await teamFacts(ctx, t)).pairs.map((p) => canonicalRepo(p.code).toLowerCase()));
  const checks: Record<string, ReturnType<typeof buildSummary> | null> = {};
  await Promise.all(
    asked.map(async (x: unknown) => {
      const { code, number } = (x ?? {}) as { code?: unknown; number?: unknown };
      if (typeof code !== 'string' || !Number.isSafeInteger(number)) return;
      const repo = canonicalRepo(code).toLowerCase();
      const k = `${repo}#${number}`;
      checks[k] = null;
      if (!codes.has(repo)) return;
      const rec = await buildRecordOf(ctx.svc.redis, repo, number as number);
      if (!rec.need) return;
      const [o, r] = repo.split('/') as [string, string];
      const token = await ctx.svc.app.installationToken(o, r);
      const pr = token ? await ghApp(ctx, token, 'GET', `/repos/${o}/${r}/pulls/${number}`) : null;
      const head = typeof pr?.data?.head?.sha === 'string' ? (pr.data.head.sha as string) : null;
      if (!head) return;
      checks[k] = buildSummary(buildStateOf(rec.words, head, rec.need), rec.need.names);
    }),
  );
  return json(200, { checks });
}

/** A write with the app's token and a JSON body (ghApp reads only). */
async function ghAppSend(ctx: Ctx, token: string, method: string, path: string, body: unknown): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await ctx.f(`${API}${path}`, { method, headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-contribute', 'X-GitHub-Api-Version': '2022-11-28' }, body: JSON.stringify(body) });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------------------------------------------------
// The library update of a product (api/_lib/library-update.ts)

/** Library updates sent per team per UTC day (each one is about ten GitHub calls). */
export const LIBRARY_UPDATE_LIMIT = 30;
export const LIBRARY_UPDATE_WORDS = {
  notLead: 'Leads and admins send library updates to the developers.',
  noProduct: 'This team lists no such product with its own repository.',
  limit: 'Bridge already sent many updates today. Try again tomorrow.',
};

/**
 * POST { action: 'library-update', repo, product }: a lead or an admin of the team (an email admin, or a GitHub
 * account that administers the team's repository or is one of its leads) asks Bridge to send the library update to the
 * developers of `product`. Bridge opens one pull request in the product's own repository with its app (or updates the
 * open one in place), under the policy of api/_lib/library-update.ts. Never merges.
 */
async function onLibraryUpdate(req: Request, ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const team = parseRepo(body.repo);
  const t = { ...team, full: team.full.toLowerCase() };
  let who: string | null = null;
  const m = await sessionMember(ctx, req, team.full);
  if (m && (m.role === 'admin' || (ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(team.full, m.email))))) who = m.name;
  if (!who && req.headers.get('authorization')) {
    const a = await githubAccountOn(ctx, req, t);
    if (a?.kind === 'expired') return fail(401, 'signin', GITHUB_EXPIRED);
    if (a?.kind === 'account' && githubRoleOf(a.perms, a.login, (await teamFacts(ctx, t)).leads) === 'lead') who = a.name;
  }
  if (!who) return fail(403, 'not-allowed', LIBRARY_UPDATE_WORDS.notLead);
  const facts = await teamFacts(ctx, t);
  const key = typeof body.product === 'string' ? body.product.trim().toLowerCase() : '';
  const product = facts.products.find((p) => p.key === key);
  if (!product) return fail(404, 'no_product', LIBRARY_UPDATE_WORDS.noProduct);
  const [owner, name] = product.repo.split('/') as [string, string];
  const token = await ctx.svc.app.installationToken(owner, name);
  if (!token) return fail(409, 'product_missing', PRODUCT_APP_MISSING);
  await bumpOrRefuse(ctx, [`bridge:contrib:count:library-update:${t.full}:${dayOf(ctx.now())}`], [LIBRARY_UPDATE_LIMIT], LIBRARY_UPDATE_WORDS.limit, 'library-update');
  const r = await sendLibraryUpdate({
    f: ctx.f,
    token,
    repo: product.repo,
    product: product.name,
    extra: facts.packages,
    changelog: `${siteOrigin(req, ctx.env.PUBLIC_SITE_URL)}/library/${encodeURIComponent(team.owner)}/${encodeURIComponent(team.repo)}/changelog/`,
    requestedBy: who,
    redis: ctx.svc.redis,
  });
  // The team's next reads of the product ask GitHub again (the open pull requests moved).
  if (r.state === 'opened' || r.state === 'updated') await noteWrite(ctx.svc.redis, t.full, ctx.now()).catch(() => undefined);
  return json(200, r);
}

// ---------------------------------------------------------------------------------------------------------------
// The proxy

const CROSS_ORIGIN = 'Bridge reads this design system only for the pages and products its bridge.config.json names.';
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
  // Under its current name, as parseRepo names the team: an old name is the same repository, read by its new name.
  const [owner, repo] = canonicalRepo(`${decoded[1]}/${decoded[2]}`).split('/') as [string, string];
  return { owner, repo, rest: decoded.slice(3), rawRest: segs.slice(3), query };
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
  /** The team asked for: the repository of bridge.config.json. */
  team: string;
  owner: string;
  repo: string;
  full: string;
  member: ProxyMember;
  token: string;
  method: string;
  target: Target;
  body: Record<string, unknown> | null;
  /**
   * A write in one of the team's product repositories (productScope): the design team's copy, where explorations run,
   * or the developers' repository, where Done exploring files their task. Absent: the team's own repository.
   */
  scope?: ProductScope | undefined;
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

export const SANDBOX_ONLY = 'Bridge leaves the build and hosting settings of the design team\'s copy to the developers. Ask one to change this file.';

/**
 * Whether `path` may be written on an email member's own exploration branch in the design team's copy (the designers'
 * sandbox, never the developers' repository): any file, prototype code included, except CI (.github), the hosting
 * settings (vercel.json, .vercel) and installed dependencies (node_modules). Same path checks as isDesignPath.
 */
export function isSandboxPath(path: string): boolean {
  const segs = path.split('/');
  if (!path || path.startsWith('/') || segs.some((s) => !s || s === '.' || s === '..' || /[\\\u0000-\u001f\u007f]/.test(s))) return false;
  const lower = path.toLowerCase();
  if (lower === '.github' || lower.startsWith('.github/')) return false;
  // Hosting settings wherever the project root sits (a monorepo app folder too).
  return !segs.some((s) => ['node_modules', '.vercel', 'vercel.json'].includes(s.toLowerCase()));
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
  if (!c.scope && (res.status === 404 || config)) await putTeamName(ctx.svc.redis, c.full, configName(config), ctx.now());
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
export const publicEmail = (secret: string, repo: string, email: string) => `${createHmac('sha256', secret).update(`contrib-author:${repo.toLowerCase()}:${canonicalEmail(email)}`).digest('hex').slice(0, 12)}@contributors.bridge.invalid`;

/** What the policy allows for this call, with the body it sends; throws not-allowed otherwise. */
async function planCall(ctx: Ctx, c: Call): Promise<Plan> {
  const r = c.target.rest;
  const at = (...p: string[]) => r.length === p.length && p.every((x, i) => x === '*' || x === r[i]);
  const body = c.body ?? {};
  let facts: RepoFacts | null = null;
  const info = async () => (facts ??= await repoFacts(ctx, c));
  const def = async () => (await info()).defaultBranch;
  const isDefault = async (b: string) => b.toLowerCase() === (await def()).toLowerCase();
  const decider = async () => decidesOnExplorations(c.member, await reviewModeOf(ctx.svc.redis, c.team));
  const ownsBranch = async (b: unknown) => typeof b === 'string' && validBranch(b) && !(await isDefault(b)) && (sameEmail(await ctx.svc.redis.cmd('GET', branchKey(c.full, b)), c.member.email) || Boolean(b.startsWith(EXPLORATION_PREFIX) && (await decider())));
  const ownsIssue = async (n: string | undefined) => n !== undefined && NUMBER.test(n) && (sameEmail(await ctx.svc.redis.cmd('GET', issueKey(c.full, n)), c.member.email) || Boolean((await decider()) && (await explorationOfLead(ctx, c, n))));
  const recordIssue = async (data: any) => {
    if (typeof data?.number === 'number') {
      await ctx.svc.redis.cmd('SET', issueKey(c.full, data.number), c.member.email, 'EX', OWNERSHIP_TTL_S);
      await rememberMine(ctx, c.full, c.member.email, `i:${data.number}`);
    }
  };
  // A work email is never published on a public repository: a stable address that routes nowhere stands in for it.
  // A designer signed in with GitHub: their commits carry GitHub's own no-reply address, so GitHub shows them as the
  // author; their login is public, so the line names it on any repository.
  const author = async () =>
    c.member.login
      ? { name: c.member.name, email: `${c.member.githubId ? `${c.member.githubId}+` : ''}${c.member.login}@users.noreply.github.com` }
      : { name: c.member.name, email: publicEmail(ctx.svc.secret, c.full, c.member.email) };
  // A member's email never goes into GitHub content, public or private repository: their name names them.
  const line = async () => `Requested by ${c.member.name}${c.member.login ? ` (@${c.member.login})` : ''} through Bridge.`;
  /** The text with the "Requested by" line at the end, unless it already carries it (attribution is never edited away). */
  const requested = async (text: unknown, owner?: { ref: string; name: string }) => {
    const l = await line();
    // A member without GitHub is named in the exploration block by their member reference and name, never their email.
    const raw = typeof text === 'string' ? text : '';
    const t = c.member.login ? raw : withMemberInBlock(raw, { ref: memberRef(c.member.email), name: c.member.name }, owner);
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

  if (c.scope) return planProductCall(ctx, c, { at, body, def, isDefault, ownsIssue, recordIssue, author, requested, checkPaths, checkCommit });

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
        if (handsOff(body.labels, EXPLORATION_READY_LABEL)) {
          const p = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/pulls/${r[1]}`);
          await checkReadyLabel(ctx, c, body.labels, p.status === 200 ? p.data?.body : null);
        }
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
        if ('body' in body) await checkLeadWords(ctx, c, c, r[1]!, body.body);
        return { body: 'body' in body ? { ...body, body: (await decider()) && !(await ownedByKey(ctx, c, r[1]!)) ? body.body : await requested(body.body) } : body };
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

// ---------------------------------------------------------------------------------------------------------------
// Product repositories: the design team's copy and the developers' task (email designers explore products too)

/** A product of the team with a design copy (bridge.config.json products[].repo and products[].design.repo). */
export interface ProductPair {
  /** The developers' repository, lower case. */
  code: string;
  /** The design team's copy, lower case. */
  copy: string;
  /** The product's key (products[].key), when the config gives one: notification links open its exploration. */
  key?: string;
}

/** Which product repository a write lands in, and its other half. */
export type ProductScope = { kind: 'copy'; pair: ProductPair } | { kind: 'code'; pair: ProductPair };

/** The products of a team's bridge.config.json that have a design copy. Anything malformed is left out. */
export function productPairsFrom(config: unknown, team: string): ProductPair[] {
  const products = config && typeof config === 'object' ? (config as { products?: unknown }).products : null;
  if (!Array.isArray(products)) return [];
  const repo = (v: unknown) => (typeof v === 'string' && /^[\w.-]+\/[\w.-]+$/.test(v.trim()) ? v.trim().toLowerCase() : null);
  const t = team.toLowerCase();
  const out: ProductPair[] = [];
  for (const p of products) {
    if (!p || typeof p !== 'object') continue;
    const code = repo((p as { repo?: unknown }).repo);
    const copy = repo(((p as { design?: { repo?: unknown } }).design ?? {}).repo);
    const key = (p as { key?: unknown }).key;
    if (code && copy && code !== copy && code !== t && copy !== t) out.push({ code, copy, ...(typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(key) ? { key } : {}) });
  }
  return out;
}

/** The scope of `target` for the team: its design copy or its developers' repository, else null (not the team's). */
export function scopeOf(pairs: readonly ProductPair[], target: string): ProductScope | null {
  const t = target.toLowerCase();
  const asCopy = pairs.find((p) => p.copy === t);
  if (asCopy) return { kind: 'copy', pair: asCopy };
  const asCode = pairs.find((p) => p.code === t);
  return asCode ? { kind: 'code', pair: asCode } : null;
}

/**
 * The team's leads on GitHub (bridge.config.json governance): its design and tech owners and the people allowed the
 * owner override. A GitHub account among them keeps its own GitHub path to the products; everyone else with push on
 * the team is a designer, who writes there through Bridge. Logins lower case; anything malformed is left out.
 */
export function teamLeadsFrom(config: unknown): string[] {
  const g = config && typeof config === 'object' ? (config as { governance?: any }).governance : null;
  const lists = [g?.owners?.design, g?.owners?.tech, g?.override?.allowed];
  const out = new Set<string>();
  for (const l of lists) if (Array.isArray(l)) for (const v of l) if (typeof v === 'string' && /^@?[A-Za-z0-9-]{1,39}$/.test(v.trim())) out.add(v.trim().replace(/^@/, '').toLowerCase());
  return [...out];
}

/** The team's product pairs and leads, read from its default branch with the app, cached 5 minutes per warm function. */
const pairsCache = new Map<string, TeamFacts>();
export const clearProductPairCache = () => pairsCache.clear();

async function productPairs(ctx: Ctx, team: { owner: string; repo: string; full: string }): Promise<ProductPair[]> {
  return (await teamFacts(ctx, team)).pairs;
}

/** A product of the team with a developers' repository of its own (products[].repo), for its library update. */
export interface CodeProduct {
  key: string;
  name: string;
  /** "owner/name" as the settings write it. */
  repo: string;
}

/** The products of a team's bridge.config.json with their own repository (not the team's). Anything malformed is left out. */
export function codeProductsFrom(config: unknown, team: string): CodeProduct[] {
  const products = config && typeof config === 'object' ? (config as { products?: unknown }).products : null;
  if (!Array.isArray(products)) return [];
  const out: CodeProduct[] = [];
  for (const p of products) {
    if (!p || typeof p !== 'object') continue;
    const { key, name, repo } = p as { key?: unknown; name?: unknown; repo?: unknown };
    if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(key) || typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) continue;
    if (repo.trim().toLowerCase() === team.toLowerCase()) continue;
    out.push({ key: key.toLowerCase(), name: typeof name === 'string' && name.trim() ? name.trim() : key, repo: repo.trim() });
  }
  return out;
}

/** The library packages a team's settings name besides the Bridge scope (previews.packages). */
export function libraryPackagesFrom(config: unknown): string[] {
  const list = config && typeof config === 'object' ? (config as { previews?: { packages?: unknown } }).previews?.packages : null;
  return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string' && validPackageName(n)) : [];
}

/** How many design owners bridge.config.json names (governance.owners.design): with none, Done exploring needs nobody. */
export function designOwnersFrom(config: unknown): number {
  const list = (config as { governance?: { owners?: { design?: unknown } } } | null)?.governance?.owners?.design;
  return Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v.trim()).length : typeof list === 'string' && list.trim() ? 1 : 0;
}

/** The design owners that are people (no `org/team` entry), as lower-case logins. */
export function designOwnerLoginsFrom(config: unknown): string[] {
  const list = (config as { governance?: { owners?: { design?: unknown } } } | null)?.governance?.owners?.design;
  const all = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
  return [...new Set(all.filter((v): v is string => typeof v === 'string' && /^@?[A-Za-z0-9-]{1,39}$/.test(v.trim())).map((v) => v.trim().replace(/^@/, '').toLowerCase()))];
}

interface TeamFacts {
  at: number;
  pairs: ProductPair[];
  leads: string[];
  designOwners: number;
  /** The design owners' GitHub logins, lower case (people only): who is asked besides the email leads. */
  designOwnerLogins: string[];
  products: CodeProduct[];
  packages: string[];
}

const NO_FACTS = (): TeamFacts => ({ at: 0, pairs: [], leads: [], designOwners: 0, designOwnerLogins: [], products: [], packages: [] });

async function teamFacts(ctx: Ctx, team: { owner: string; repo: string; full: string }): Promise<TeamFacts> {
  const hit = pairsCache.get(team.full);
  if (hit && ctx.now() - hit.at < 5 * 60 * 1000) return hit;
  const token = await ctx.svc.app.installationToken(team.owner, team.repo);
  // Deny by default: a team Bridge cannot read lists no product (and no lead: nobody is a designer of it either).
  if (!token) return NO_FACTS();
  let res: Response;
  try {
    res = await ctx.f(`${API}/repos/${team.owner}/${team.repo}/contents/bridge.config.json`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-contribute', 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status !== 200) return NO_FACTS();
  let pairs: ProductPair[] = [];
  let leads: string[] = [];
  let designOwners = 0;
  let designOwnerLogins: string[] = [];
  let products: CodeProduct[] = [];
  let packages: string[] = [];
  try {
    const config: unknown = JSON.parse(await res.text());
    pairs = productPairsFrom(config, team.full);
    leads = teamLeadsFrom(config);
    designOwners = designOwnersFrom(config);
    designOwnerLogins = designOwnerLoginsFrom(config);
    products = codeProductsFrom(config, team.full);
    packages = libraryPackagesFrom(config);
  } catch {
    pairs = [];
    leads = [];
  }
  const facts: TeamFacts = { at: ctx.now(), pairs, leads, designOwners, designOwnerLogins, products, packages };
  pairsCache.set(team.full, facts);
  // Each time Bridge reads the team's products, their repositories are watched: GitHub's webhook then knows which team
  // a developers' pull request belongs to (Design check, notifications), even on a team nobody joined by email yet.
  if (pairs.length) await ctx.svc.redis.pipe(watchWrites(watchedOf(team.full, pairs))).catch(() => undefined);
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------
// Designers signed in with GitHub

/**
 * Who writes in the products through Bridge (Florian's rule, 2026-11-02): every designer of the team, with or without
 * GitHub. A GitHub account is a designer of the team when GitHub gives it push on the team's repository, it does not
 * administer it, and it is not one of the team's leads (teamLeadsFrom). Leads and admins keep their own GitHub path
 * (approve, merge, make the copy); an account with read only is not on the team as an editor. Pure.
 */
export function githubRoleOf(perms: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean } | null | undefined, login: string, leads: readonly string[]): 'designer' | 'lead' | 'none' {
  if (!perms) return 'none';
  if (perms.admin || leads.includes(login.toLowerCase())) return 'lead';
  return perms.push || perms.maintain ? 'designer' : 'none';
}

/** A member the proxy acts for: an email member, or a designer signed in with GitHub (`login` set, `email` is gh:<login>). */
export type ProxyMember = EmailMember & { login?: string; githubId?: number };

export type DesignerCheck =
  | { kind: 'designer'; member: ProxyMember }
  | { kind: 'lead' }
  | { kind: 'none' }
  | { kind: 'expired' };

export const LEADS_DIRECT = 'Leads change the products on GitHub directly, not through Bridge.';
export const GITHUB_EXPIRED = 'Your GitHub sign-in expired. Sign in again.';

/**
 * Whether a GitHub account is on the team for reading, from GitHub's permissions on the team's repository read with
 * its own token: any role GitHub grants explicitly (admin, maintain, write, triage), or read on a private repository.
 * Read on a public repository is everyone's, never membership. Pure.
 */
export function githubReadsTeam(perms: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean } | null | undefined, isPrivate: boolean): boolean {
  if (!perms) return false;
  if (perms.admin || perms.maintain || perms.push || perms.triage) return true;
  return Boolean(perms.pull && isPrivate);
}

/** A GitHub account and its permissions on the team's repository, as GitHub says it with the account's own token. */
type GitHubAccountOn = { kind: 'expired' } | { kind: 'account'; login: string; name: string; id: number | null; perms: Record<string, boolean> | null; private: boolean };

const designerCache = new Map<string, { at: number; v: GitHubAccountOn }>();
export const clearDesignerCache = () => designerCache.clear();

/** How long who a GitHub token is on a team is kept (memory of a warm function, and Redis for the other ones). */
const ACCOUNT_KEEP_S = 5 * 60;
/** Redis key of who a GitHub token is on a team: a hash of the token, never the token. */
export const accountOnKey = (tokenHash: string, team: string) => `bridge:read:who:${tokenHash}:${team.toLowerCase()}`;

const parseAccountOn = (raw: unknown): GitHubAccountOn | null => {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as GitHubAccountOn;
    return v && v.kind === 'account' && typeof v.login === 'string' ? v : null;
  } catch {
    return null;
  }
};

/**
 * The GitHub account behind `Authorization: Bearer` and its permissions on the team's repository, read with its own
 * token (GET /user, GET the team's repository): never what the browser says. Kept 5 minutes by a hash of the token,
 * in this function's memory and in Redis, so a Studio page that reads through Bridge costs the viewer's own GitHub
 * limit two calls per 5 minutes, not two per function that answers it. Null without a token.
 */
async function githubAccountOn(ctx: Ctx, req: Request, team: { owner: string; repo: string; full: string }): Promise<GitHubAccountOn | null> {
  const bearer = /^Bearer\s+([A-Za-z0-9_.-]{20,255})$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return null;
  const hash = sha256(bearer);
  const key = `${hash}:${team.full}`;
  const hit = designerCache.get(key);
  if (hit && ctx.now() - hit.at < ACCOUNT_KEEP_S * 1000) return hit.v;
  const shared = parseAccountOn(await ctx.svc.redis.cmd('GET', accountOnKey(hash, team.full)).catch(() => null));
  if (shared) {
    designerCache.set(key, { at: ctx.now(), v: shared });
    return shared;
  }
  const me = await ghApp(ctx, bearer, 'GET', '/user');
  if (me.status === 401 || me.status === 403 || typeof me.data?.login !== 'string') return { kind: 'expired' };
  const r = await ghApp(ctx, bearer, 'GET', `/repos/${team.owner}/${team.repo}`);
  if (r.status === 401) return { kind: 'expired' };
  const login: string = me.data.login;
  const perms = r.status === 200 && r.data?.permissions && typeof r.data.permissions === 'object' ? (r.data.permissions as Record<string, boolean>) : null;
  const v: GitHubAccountOn = {
    kind: 'account',
    login,
    name: typeof me.data.name === 'string' && me.data.name.trim() ? me.data.name.trim() : login,
    id: typeof me.data.id === 'number' ? me.data.id : null,
    perms,
    private: r.status === 200 && r.data?.private === true,
  };
  designerCache.set(key, { at: ctx.now(), v });
  await ctx.svc.redis.cmd('SET', accountOnKey(hash, team.full), JSON.stringify(v), 'EX', ACCOUNT_KEEP_S).catch(() => undefined);
  return v;
}

/** The GitHub account behind `Authorization: Bearer` on this team: a designer, a lead or nobody (githubRoleOf). */
export async function githubDesignerOf(ctx: Ctx, req: Request, team: { owner: string; repo: string; full: string }): Promise<DesignerCheck> {
  const a = await githubAccountOn(ctx, req, team);
  if (!a) return { kind: 'none' };
  if (a.kind === 'expired') return a;
  const role = githubRoleOf(a.perms, a.login, (await teamFacts(ctx, team)).leads);
  if (role === 'designer') return { kind: 'designer', member: { email: `gh:${a.login.toLowerCase()}`, name: a.name, role: 'edit', version: 0, addedBy: 'github', at: '', login: a.login, ...(a.id !== null ? { githubId: a.id } : {}) } };
  return role === 'lead' ? { kind: 'lead' } : { kind: 'none' };
}

/**
 * The login of the GitHub account behind `Authorization: Bearer` when it is on the team for reading (githubReadsTeam):
 * a designer, a lead, an admin, or a reader of a private team. Each of them reads the team's products through Bridge's
 * app (a private product or design copy their own token cannot see); writes keep their own rules. Null otherwise.
 */
export async function githubTeamReaderOf(ctx: Ctx, req: Request, team: { owner: string; repo: string; full: string }): Promise<string | null> {
  const a = await githubAccountOn(ctx, req, team);
  return a?.kind === 'account' && githubReadsTeam(a.perms, a.private) ? a.login : null;
}

// The names core uses (explorations.ts, design-copy-github.ts), kept here so this function bundles without the core
// package; a test holds them equal to core's.
export const EXPLORATION_PREFIX = 'explore/';
export const EXPLORATION_LABEL = 'exploration';
export const EXPLORATION_READY_LABEL = 'ready-for-devs';
export const EXPLORATION_ARCHIVED_LABEL = 'archived';
export const FROM_DESIGN_LABEL = 'from-design';

/** Labels an email designer puts on or takes off their own exploration in the copy. */
const leadOnly = () => new HttpError(403, 'lead-only', LEAD_ONLY);

/** The team of a proxied call, as bridge.config.json on its default branch says it. */
const teamFactsOf = (ctx: Ctx, c: Call) => {
  const [owner, repo] = c.team.split('/') as [string, string];
  return teamFacts(ctx, { owner, repo, full: c.team.toLowerCase() });
};

/** Pull request `n` read on GitHub as the app, when it is an exploration: what a lead may act on, whoever started it. */
async function explorationOfLead(ctx: Ctx, c: Call, n: string): Promise<boolean> {
  const p = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/pulls/${n}`);
  return p.status === 200 && Boolean(explorationBlockOf(p.data?.body));
}

const ownedByKey = async (ctx: Ctx, c: Call, n: string) => sameEmail(await ctx.svc.redis.cmd('GET', issueKey(c.full, n)), c.member.email);

/**
 * Who may answer on this exploration, and whether it needs a review at all (api/_lib/review-mode.ts): never its own
 * author, and a review only when there is someone other than the author to ask. `body` is the pull request's body
 * on GitHub (null: not read, the caller counts as the author).
 */
async function reviewFor(ctx: Ctx, c: Call, body: unknown): Promise<{ decides: boolean; needs: boolean }> {
  const mode = await reviewModeOf(ctx.svc.redis, c.team);
  const block = explorationBlockOf(body);
  const me = memberRef(c.member.email);
  const authorRef = typeof block?.member === 'string' ? block.member : null;
  const authorLogin = typeof block?.author === 'string' ? block.author.replace(/^@/, '').toLowerCase() : null;
  const mine = block === null || authorRef === me || Boolean(c.member.login && authorLogin === c.member.login.toLowerCase());
  const others = (await ctx.svc.members.list(c.team)).filter((m) => memberRef(m.email) !== (authorRef ?? me) && !sameEmail(m.email, c.member.email));
  const owners = (await teamFactsOf(ctx, c)).designOwnerLogins.filter((l) => l !== authorLogin && l !== c.member.login?.toLowerCase());
  return { decides: !mine && decidesOnExplorations(c.member, mode), needs: needsReview({ mode, designOwners: owners.length, members: others }) };
}

/** A member who may not decide never writes a lead's words in a block (api/_lib/lead-gate.ts), read against GitHub's body. */
async function checkLeadWords(ctx: Ctx, c: Call, at: { owner: string; repo: string }, n: string, next: unknown): Promise<void> {
  const p = await ghApp(ctx, c.token, 'GET', `/repos/${at.owner}/${at.repo}/pulls/${n}`);
  if (p.status !== 200) return;
  // The PM's words are Bridge's to write for them (action pm-word), never through the proxy, a lead's neither.
  if (addsPmWords(p.data?.body, next)) throw new HttpError(403, 'pm-only', PM_ONLY);
  const r = await reviewFor(ctx, c, p.data?.body);
  if (!r.decides && addsLeadWords(p.data?.body, next, { hasLeads: r.needs })) throw leadOnly();
  if (addsDone(p.data?.body, next)) await checkPmGate(ctx, c, p.data?.body, r);
}

/** The label that hands it to the developers goes with Done exploring: the same rule, for their own exploration. */
async function checkReadyLabel(ctx: Ctx, c: Call, labels: unknown, body: unknown = null): Promise<void> {
  if (!handsOff(labels, EXPLORATION_READY_LABEL)) return;
  const r = await reviewFor(ctx, c, body);
  if (!r.decides && r.needs) throw leadOnly();
  await checkPmGate(ctx, c, body, r);
}

/**
 * The PM gate on the server (board R1, lib/pm-view pmRequired): when nobody but the author can review ("Shared, no
 * review", or the only designer), an exploration of a product with a PM reaches the developers only once the PM said
 * Looks good, or agreed in a call. The words are the designer's to read in Studio.
 */
export function pmGateStop(body: unknown, pm: { name: string } | null): string | null {
  if (!pm) return null;
  const all = explorationBlockOf(body)?.decisions;
  const last = Array.isArray(all) ? [...all].reverse().find((d) => typeof d?.kind === 'string' && (d.kind as string).startsWith('pm-')) : null;
  if (last?.kind === 'pm-ok' || last?.kind === 'pm-call') return null;
  return last?.kind === 'pm-changes' ? `${pm.name} asked for changes. Answer them first: nothing goes to the developers before ${pm.name} says it looks good.` : `Share it with ${pm.name} first: nothing goes to the developers before ${pm.name} says it looks good.`;
}

async function checkPmGate(ctx: Ctx, c: Call, body: unknown, r: { decides: boolean; needs: boolean }): Promise<void> {
  if (r.decides || r.needs) return;
  const product = c.scope?.pair.key;
  if (!product) return;
  const stop = pmGateStop(body, await pmOf(ctx.svc.redis, c.team, product).catch(() => null));
  if (stop) throw new HttpError(403, 'pm-first', stop);
}

/** Done exploring written in a block (doneAt where there was none): the hand-off the PM gate stands before. */
const addsDone = (before: unknown, after: unknown) => Boolean(explorationBlockOf(after)?.doneAt) && !explorationBlockOf(before)?.doneAt;

const COPY_LABELS = new Set([EXPLORATION_LABEL, EXPLORATION_READY_LABEL, EXPLORATION_ARCHIVED_LABEL]);
const copyLabel = (l: unknown) => typeof l === 'string' && (COPY_LABELS.has(l) || /^product:[\w.-]{1,64}$/.test(l));

interface PlanHelpers {
  at: (...p: string[]) => boolean;
  body: Record<string, unknown>;
  def: () => Promise<string>;
  isDefault: (b: string) => Promise<boolean>;
  ownsIssue: (n: string | undefined) => Promise<boolean>;
  recordIssue: (data: any) => Promise<void>;
  author: () => Promise<{ name: string; email: string }>;
  /** With `owner`, the exploration block names that member whatever the body says (withMemberInBlock). */
  requested: (text: unknown, owner?: { ref: string; name: string }) => Promise<string>;
  checkPaths: (paths: string[]) => Promise<void>;
  checkCommit: (sha: unknown) => Promise<void>;
}

/** A repository of a product, as the proxy calls it. */
interface RepoAt {
  owner: string;
  repo: string;
  /** owner/name, lower case. */
  full: string;
}

/**
 * Whether an open pull request of the copy, from a branch of the copy itself, says it is the member's: for a designer
 * signed in with GitHub, their own account opened it or its exploration block names their login as `author`; for an
 * email member, its exploration block names their member reference (exploration-member.ts). Only asked when Bridge
 * keeps no owner for the branch: an exploration started on GitHub, or a copy made again (a migration re-opens every
 * pull request under the lead's account and the owners Bridge kept by number no longer match).
 */
function pullClaimedBy(p: any, m: ProxyMember, copy: RepoAt, b: string): boolean {
  if (p?.state !== 'open' || p?.head?.ref !== b || typeof p?.head?.repo?.full_name !== 'string' || p.head.repo.full_name.toLowerCase() !== copy.full) return false;
  const block = explorationBlockOf(p.body);
  if (m.login) {
    const login = m.login.toLowerCase();
    if (typeof p.user?.login === 'string' && p.user.login.toLowerCase() === login) return true;
    return typeof block?.author === 'string' && block.author.toLowerCase() === login;
  }
  return typeof block?.member === 'string' && block.member === memberRef(m.email);
}

/**
 * Whether `b` is one of the member's explorations in the design copy: an explore/* branch, never the default one,
 * that Bridge keeps as theirs (they started it through here), or, when Bridge keeps no owner for it, whose open pull
 * request says it is theirs (pullClaimedBy), kept as theirs from then on. A branch Bridge keeps for someone else is
 * never theirs, whatever a pull request says. `pull`: the pull request already read, else the open ones are listed.
 */
async function ownsExploration(ctx: Ctx, m: ProxyMember, copy: RepoAt, token: string, isDefault: (b: string) => Promise<boolean>, b: unknown, pull?: any): Promise<boolean> {
  if (typeof b !== 'string' || !validBranch(b) || !b.startsWith(EXPLORATION_PREFIX) || (await isDefault(b))) return false;
  const owner = await ctx.svc.redis.cmd('GET', branchKey(copy.full, b));
  if (sameEmail(owner, m.email)) return true;
  if (owner) return false;
  let claimed = pull !== undefined && pullClaimedBy(pull, m, copy, b);
  if (!claimed) {
    const pulls = await ghApp(ctx, token, 'GET', `/repos/${copy.owner}/${copy.repo}/pulls?state=open&per_page=100`);
    claimed = Array.isArray(pulls.data) && pulls.data.some((p: any) => pullClaimedBy(p, m, copy, b));
  }
  if (!claimed) return false;
  await ctx.svc.redis.cmd('SET', branchKey(copy.full, b), m.email, 'EX', OWNERSHIP_TTL_S);
  await rememberMine(ctx, copy.full, m.email, `b:${b}`);
  return true;
}

/**
 * Pull request `n` of the design copy when it is the member's: read on GitHub, from a branch of the copy that is
 * their exploration (ownsExploration). A pull request belongs to whoever owns its branch, never to a number kept
 * from before: when a copy is made again its numbers start over, and an owner kept by number would hand one
 * designer's exploration to another. What Bridge keeps by number follows what GitHub says. Null when not theirs.
 */
async function ownedCopyPull(ctx: Ctx, m: ProxyMember, copy: RepoAt, token: string, isDefault: (b: string) => Promise<boolean>, n: string | undefined, team: string = copy.full): Promise<any | null> {
  if (n === undefined || !NUMBER.test(n)) return null;
  const key = issueKey(copy.full, n);
  const p = await ghApp(ctx, token, 'GET', `/repos/${copy.owner}/${copy.repo}/pulls/${n}`);
  const head = p.data?.head;
  const mine =
    p.status === 200 &&
    typeof head?.ref === 'string' &&
    typeof head?.repo?.full_name === 'string' &&
    head.repo.full_name.toLowerCase() === copy.full &&
    (await ownsExploration(ctx, m, copy, token, isDefault, head.ref, p.data));
  // A lead acts on it without owning it: nothing Bridge keeps about who it belongs to moves.
  if (!mine && p.status === 200 && explorationBlockOf(p.data?.body) && decidesOnExplorations(m, await reviewModeOf(ctx.svc.redis, team))) return p.data;
  const kept = await ctx.svc.redis.cmd('GET', key);
  if (mine) {
    if (!sameEmail(kept, m.email)) {
      await ctx.svc.redis.cmd('SET', key, m.email, 'EX', OWNERSHIP_TTL_S);
      await rememberMine(ctx, copy.full, m.email, `i:${n}`);
    }
    return p.data;
  }
  // A number kept for them that GitHub says is someone else's now (a copy made again): forgotten.
  if (sameEmail(kept, m.email) && p.status === 200) await ctx.svc.redis.pipe([['DEL', key], ['SREM', mineKey(copy.full, m.email), `i:${n}`]]);
  return null;
}

/**
 * The policy in a product repository, deny by default. In the design team's copy: only their own explore/* branches
 * (new from the default branch with design files only, then moved forward with sandbox paths: prototype code yes,
 * CI, hosting settings and node_modules never), their draft pull
 * request to the default branch with its labels and comments, "Get the latest" (GitHub's Sync fork of the default
 * branch) and "Bring it in" (the default branch merged into their own exploration). In the developers' repository:
 * the from-design label, one task per exploration of theirs (an issue labeled from-design that links their pull
 * request in the copy), and on that task only a comment, closing it as not planned and opening it again. Never:
 * the default branch written, a merge into it, reviews, settings, any other repository.
 */
async function planProductCall(ctx: Ctx, c: Call, h: PlanHelpers): Promise<Plan> {
  const scope = c.scope!;
  const r = c.target.rest;
  const { at, body } = h;
  const me = { ref: memberRef(c.member.email), name: c.member.name };

  if (scope.kind === 'copy') {
    const copy: RepoAt = { owner: c.owner, repo: c.repo, full: c.full };
    // Their explorations and their pull requests: by branch, never by a number kept from before (ownedCopyPull).
    const ownedExplore = (b: unknown) => ownsExploration(ctx, c.member, copy, c.token, h.isDefault, b);
    const ownedPull = (n: string | undefined) => ownedCopyPull(ctx, c.member, copy, c.token, h.isDefault, n, c.team);
    /** Every path a sandbox path (isSandboxPath): their own exploration may hold prototype code, never CI or hosting. */
    const checkSandbox = (paths: string[]) => {
      if (!paths.length || paths.some((p) => !isSandboxPath(p))) throw new HttpError(403, 'not-allowed', SANDBOX_ONLY);
    };
    /** A move of their branch: a fast-forward whose own changes are sandbox paths only. */
    const checkForward = async (b: string, sha: unknown) => {
      if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) throw notAllowed();
      const ref = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/git/ref/heads/${encodeRef(b)}`);
      const from = ref.data?.object?.sha;
      if (ref.status !== 200 || typeof from !== 'string') throw notAllowed();
      const cmp = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/compare/${from}...${sha}`);
      const files = cmp.data?.files;
      if (cmp.status !== 200 || cmp.data?.status !== 'ahead' || !Array.isArray(files)) throw notAllowed();
      // GitHub lists at most 300 files: past that, the move cannot be checked.
      if (files.length >= 300) throw new HttpError(403, 'not-allowed', SANDBOX_ONLY);
      const paths = (files as { filename?: unknown; previous_filename?: unknown }[]).flatMap((f) => [f.filename, f.previous_filename].filter((x): x is string => typeof x === 'string'));
      checkSandbox(paths);
    };
    switch (c.method) {
      case 'POST': {
        if (at('git', 'blobs')) return { body };
        if (at('git', 'trees')) {
          const tree = body.tree;
          if (!Array.isArray(tree) || !tree.length) throw notAllowed();
          const entries = tree as Record<string, unknown>[];
          // Files and folders, executable files for prototype scripts; never a submodule (160000) or a symlink (120000).
          if (entries.some((e) => !e || typeof e !== 'object' || typeof e.path !== 'string' || (e.mode !== undefined && e.mode !== '100644' && e.mode !== '100755' && e.mode !== '040000') || e.type === 'commit')) throw new HttpError(403, 'not-allowed', SANDBOX_ONLY);
          checkSandbox(entries.map((e) => e.path as string));
          return { body: pick(body, ['base_tree', 'tree']) };
        }
        if (at('git', 'commits')) {
          const date = body.author && typeof body.author === 'object' && typeof (body.author as Record<string, unknown>).date === 'string' ? { date: (body.author as Record<string, unknown>).date } : {};
          return { body: { ...pick(body, ['message', 'tree', 'parents']), author: { ...(await h.author()), ...date } } };
        }
        if (at('git', 'refs')) {
          const m = typeof body.ref === 'string' ? /^refs\/heads\/(.+)$/.exec(body.ref) : null;
          const b = m?.[1];
          if (!b || !validBranch(b) || !b.startsWith(EXPLORATION_PREFIX) || (await h.isDefault(b)) || typeof body.sha !== 'string') throw notAllowed();
          const exists = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/git/ref/heads/${encodeRef(b)}`);
          if (exists.status !== 404) throw notAllowed();
          await h.checkCommit(body.sha);
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
          if (!(await ownedExplore(head)) || !(await h.isDefault(body.base))) throw notAllowed();
          // Always a draft: an exploration is never offered for merging in the copy. Its block names who started it.
          return { body: { ...pick(body, ['title']), head, base: body.base, draft: true, body: await h.requested(body.body, me) }, after: h.recordIssue };
        }
        if (at('issues', '*', 'comments')) {
          if (typeof body.body !== 'string' || !(await ownedPull(r[1]))) throw notAllowed();
          return { body: { body: `**${c.member.name}** (via Bridge):\n\n${body.body}` } };
        }
        if (at('issues', '*', 'labels')) {
          const labels = body.labels;
          const pull = Array.isArray(labels) && labels.length && labels.every(copyLabel) ? await ownedPull(r[1]) : null;
          if (!pull) throw notAllowed();
          await checkReadyLabel(ctx, c, labels, pull.body);
          return { body: { labels } };
        }
        if (at('merge-upstream')) {
          // GitHub's "Sync fork": the copy's default branch takes the product's, nothing else.
          if (typeof body.branch !== 'string' || !(await h.isDefault(body.branch))) throw notAllowed();
          return { body: { branch: body.branch } };
        }
        if (at('merges')) {
          // "Bring it in": the default branch merged into their own exploration, never the other way.
          if (!(await ownedExplore(body.base)) || typeof body.head !== 'string' || !(await h.isDefault(body.head))) throw notAllowed();
          return { body: { ...pick(body, ['commit_message']), base: body.base, head: body.head } };
        }
        throw notAllowed();
      }
      case 'PATCH': {
        if (r.length >= 4 && r[0] === 'git' && r[1] === 'refs' && r[2] === 'heads') {
          const b = r.slice(3).join('/');
          if (body.force || !(await ownedExplore(b)) || typeof body.sha !== 'string') throw notAllowed();
          await checkForward(b, body.sha);
          return { body: { sha: body.sha, force: false } };
        }
        if (at('pulls', '*')) {
          if (!onlyKeys(body, ['title', 'body', 'state']) || (body.state !== undefined && body.state !== 'open' && body.state !== 'closed')) throw notAllowed();
          const pull = await ownedPull(r[1]);
          if (!pull) throw notAllowed();
          // Who started it stays named in its block: the one it names already, else them.
          const was = explorationBlockOf(pull.body);
          if ('body' in body && addsPmWords(pull.body, body.body)) throw new HttpError(403, 'pm-only', PM_ONLY);
          const review = 'body' in body ? await reviewFor(ctx, c, pull.body) : null;
          if (review && !review.decides && addsLeadWords(pull.body, body.body, { hasLeads: review.needs })) throw leadOnly();
          if (review && addsDone(pull.body, body.body)) await checkPmGate(ctx, c, pull.body, review);
          // A lead answering on someone else's: their words are in the block by name, the attribution stays the designer's.
          if (review?.decides && typeof was?.member === 'string' && was.member !== me.ref) return { body };
          const owner = typeof was?.member === 'string' ? { ref: was.member, name: typeof was.memberName === 'string' ? was.memberName : c.member.name } : me;
          return { body: 'body' in body ? { ...body, body: await h.requested(body.body, owner) } : body };
        }
        throw notAllowed();
      }
      case 'PUT':
      case 'DELETE': {
        if (r.length >= 2 && r[0] === 'contents') {
          if (!(await ownedExplore(body.branch))) throw notAllowed();
          checkSandbox([r.slice(1).join('/')]);
          const keys = c.method === 'PUT' ? ['message', 'content', 'sha', 'branch'] : ['message', 'sha', 'branch'];
          return { body: { ...pick(body, keys), author: await h.author() } };
        }
        if (c.method === 'DELETE' && at('issues', '*', 'labels', '*')) {
          if (!copyLabel(r[3]) || !(await ownedPull(r[1]))) throw notAllowed();
          return { body: null };
        }
        throw notAllowed();
      }
      default:
        throw notAllowed();
    }
  }

  // The developers' repository: their task, and nothing else.
  const copy = scope.pair.copy;
  /** A pull request of theirs in the copy that `text` links, as GitHub says it now (ownedCopyPull), or null. */
  const linksOwnedExploration = async (text: unknown): Promise<any | null> => {
    if (typeof text !== 'string') return null;
    const [owner, name] = copy.split('/');
    const re = new RegExp(`https://github\\.com/${owner!.replace(/[.]/g, '\\.')}/${name!.replace(/[.]/g, '\\.')}/pull/(\\d+)`, 'gi');
    const numbers = [...new Set([...text.matchAll(re)].map((m) => m[1]!))].slice(0, 5);
    if (!numbers.length) return null;
    const copyToken = await ctx.svc.app.installationToken(owner!, name!);
    if (!copyToken) return null;
    const at: RepoAt = { owner: owner!, repo: name!, full: copy };
    let copyDefault: string | null = null;
    const isCopyDefault = async (b: string) => {
      if (copyDefault === null) {
        const r = await ghApp(ctx, copyToken, 'GET', `/repos/${owner}/${name}`);
        if (r.status !== 200 || typeof r.data?.default_branch !== 'string') throw notAllowed();
        copyDefault = r.data.default_branch as string;
      }
      return b.toLowerCase() === copyDefault.toLowerCase();
    };
    for (const n of numbers) {
      const pull = await ownedCopyPull(ctx, c.member, at, copyToken, isCopyDefault, n, c.team);
      if (pull) return pull;
    }
    return null;
  };
  /** Their task: opened through here, or a from-design task that links one of their explorations in the copy. */
  const theirTask = async (n: string | undefined) => {
    if (n === undefined || !NUMBER.test(n)) return false;
    if (await h.ownsIssue(n)) return true;
    const issue = await ghApp(ctx, c.token, 'GET', `/repos/${c.owner}/${c.repo}/issues/${n}`);
    if (issue.status !== 200 || issue.data?.pull_request) return false;
    const labels = Array.isArray(issue.data?.labels) ? (issue.data.labels as { name?: unknown }[]).map((l) => l?.name) : [];
    return labels.includes(FROM_DESIGN_LABEL) && Boolean(await linksOwnedExploration(issue.data?.body));
  };
  switch (c.method) {
    case 'POST': {
      if (at('labels')) {
        if (body.name !== FROM_DESIGN_LABEL) throw notAllowed();
        return { body: pick(body, ['name', 'color', 'description']) };
      }
      if (at('issues')) {
        const labels = body.labels;
        if (typeof body.title !== 'string' || !body.title.startsWith('Design: ') || !Array.isArray(labels) || labels.length !== 1 || labels[0] !== FROM_DESIGN_LABEL) throw notAllowed();
        const linked = await linksOwnedExploration(body.body);
        if (!linked) throw notAllowed();
        // The developers' task is what the lead's yes sends: a designer never files it past them.
        const review = await reviewFor(ctx, c, linked.body);
        if (!review.decides && review.needs) throw leadOnly();
        await checkPmGate(ctx, c, linked.body, review);
        return { body: { title: body.title, labels, body: await h.requested(body.body) }, after: h.recordIssue };
      }
      if (at('issues', '*', 'comments')) {
        if (typeof body.body !== 'string' || !(await theirTask(r[1]))) throw notAllowed();
        return { body: { body: `**${c.member.name}** (via Bridge):\n\n${body.body}` } };
      }
      throw notAllowed();
    }
    case 'PATCH': {
      if (at('issues', '*')) {
        if (!onlyKeys(body, ['body', 'state', 'state_reason'])) throw notAllowed();
        // Closing as done means shipped: that is the developers' to say.
        if (body.state !== undefined && body.state !== 'open' && body.state !== 'closed') throw notAllowed();
        if (body.state_reason !== undefined && body.state_reason !== 'not_planned' && body.state_reason !== 'reopened') throw notAllowed();
        if (body.state === 'closed' && body.state_reason !== 'not_planned') throw notAllowed();
        if ('body' in body && !(await linksOwnedExploration(body.body))) throw notAllowed();
        if (!(await theirTask(r[1]))) throw notAllowed();
        return { body: 'body' in body ? { ...body, body: await h.requested(body.body) } : body };
      }
      throw notAllowed();
    }
    default:
      throw notAllowed();
  }
}

/** The team's repository and its products' repositories, as notifications watch them for a member. */
function watchedOf(team: string, pairs: readonly ProductPair[]): { repo: string; meta: RepoMeta }[] {
  const product = (p: ProductPair) => (p.key ? { product: p.key } : {});
  return [
    ...(isTeamKeyRepo(team) ? [] : [{ repo: team, meta: { team, kind: 'team' as const } }]),
    ...pairs.flatMap((p) => [
      { repo: p.copy, meta: { team, kind: 'copy' as const, ...product(p) } },
      { repo: p.code, meta: { team, kind: 'code' as const, ...product(p) } },
    ]),
  ];
}
const isTeamKeyRepo = (r: string) => r.startsWith('_team/');

/**
 * After a member who joined by email filed something (a task, a suggestion, an exploration): its repositories are
 * watched for notifications and Bridge keeps what it is called and, for a task, the exploration it comes from.
 * Designers signed in with GitHub are left out: GitHub tells them (phase 1).
 */
async function noteForNotifications(ctx: Ctx, team: string, repo: string, member: ProxyMember, scope: ProductScope | null, data: any, sent: Record<string, unknown> | null): Promise<void> {
  if (!member.email.includes('@') || member.login || typeof data?.number !== 'number') return;
  // What GitHub answered, else what Bridge sent.
  const title = cleanTitle(data.title ?? sent?.title);
  const copy = scope?.kind === 'code' ? linkedCopy(data.body ?? sent?.body, repo) : null;
  await ctx.svc.redis.pipe([...watchWrites(watchedOf(team, scope ? [scope.pair] : [])), itemWrite(repo, data.number, { ...(title ? { title } : {}), ...(copy ? { copy } : {}) })]);
}

const ACCEPT = /^application\/(json|vnd\.github(\.[A-Za-z0-9.+-]+)?)$/;
const PASS_TYPE = /^(application\/(json|vnd\.github[^;]*)|text\/plain)\b/i;

async function onProxy(req: Request, ctx: Ctx, params: URLSearchParams): Promise<Response> {
  const method = req.method.toUpperCase();
  const { owner, repo, full } = parseRepo(params.get('repo'));
  if (method === 'GET') return onTeamRead(req, ctx, params);
  // The team's own repository, or one of its products' (the design copy, the developers' task): anything else, never.
  const any = parseAnyTarget(params.get('gh'));
  const own = any.owner.toLowerCase() === owner.toLowerCase() && any.repo.toLowerCase() === repo.toLowerCase();
  const scope = own ? null : scopeOf(await productPairs(ctx, { owner, repo, full }), `${any.owner}/${any.repo}`);
  let member: ProxyMember | null = await sessionMember(ctx, req, full);
  if (!member) {
    // A designer signed in with GitHub writes in the products through Bridge too; in the library they keep GitHub.
    const d = await githubDesignerOf(ctx, req, { owner, repo, full });
    if (d.kind === 'expired') return fail(401, 'signin', GITHUB_EXPIRED);
    if (d.kind === 'lead') throw new HttpError(403, 'not-allowed', LEADS_DIRECT);
    if (d.kind === 'designer') {
      if (!scope) throw notAllowed();
      member = d.member;
    }
  }
  if (!member) return json(401, { error: 'signin', message: SIGNIN }, { 'Set-Cookie': clearSession(full) });
  // Can view reads (GETs went to onTeamRead above) and writes nothing: no branch, commit, pull request, issue or review.
  if (!memberCanWrite(member)) return fail(403, 'view-only', VIEW_ONLY);
  if (!own && !scope) throw notAllowed();
  const target: Target = { rest: any.rest, rawRest: any.rawRest, query: any.query };
  const at = own ? { owner, repo, full } : { owner: any.owner, repo: any.repo, full: `${any.owner}/${any.repo}`.toLowerCase() };

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

  const token = await ctx.svc.app.installationToken(at.owner, at.repo);
  if (!token) return fail(409, 'app_missing', scope ? PRODUCT_APP_MISSING : APP_MISSING);
  const plan = await planCall(ctx, { team: full, owner: at.owner, repo: at.repo, full: at.full, member, token, method, target, body, scope: scope ?? undefined });

  if (method !== 'GET') {
    const day = dayOf(ctx.now());
    await bumpOrRefuse(ctx, [`bridge:contrib:count:${full}:${canonicalEmail(member.email)}:${day}`], [writeLimit(ctx.env)], LIMIT_WORDS.writes, 'writes');
  }

  const accept = req.headers.get('accept')?.trim() ?? '';
  const inm = req.headers.get('if-none-match');
  const url = `${API}/repos/${at.owner}/${at.repo}${target.rawRest.length ? `/${target.rawRest.join('/')}` : ''}${target.query ? `?${target.query}` : ''}`;
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
  if (res.status >= 200 && res.status < 300) {
    await noteWrite(ctx.svc.redis, full, ctx.now()).catch(() => undefined);
    if (at.full !== full) await noteWrite(ctx.svc.redis, at.full, ctx.now()).catch(() => undefined);
  }
  if (plan.after && res.status >= 200 && res.status < 300) {
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    await plan.after(data);
    // A task or suggestion filed for a member who joined by email: watched for their notifications (api/_lib/notify.ts).
    if (method === 'POST' && (target.rest.join('/') === 'issues' || target.rest.join('/') === 'pulls')) {
      await noteForNotifications(ctx, full, at.full, member, scope, data, plan.body).catch(() => undefined);
    }
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
async function readerOf(ctx: Ctx, req: Request, full: string, rctx: ReadCtx, pass: ReadPass | null = null): Promise<Reader | null> {
  // A page of another origin with a member's read pass for the product it reads (onTeamRead checked it names it):
  // read only, that product only, the visitor's allow-list, the member's budget. Cookies still ignored.
  if (ctx.cross && pass) return { kind: 'member', pass: { budget: pass.m, repos: pass.r } };
  // A page of another origin reads as a visitor of a public demo team, whatever cookie the browser sent.
  if (ctx.cross) return isPublicTeam(full) && (openToVisitors(full) || (await isPublicRepo(rctx, ...(full.split('/') as [string, string])))) ? { kind: 'guest' } : null;
  // A member reads on their own budget (api/_lib/team-read.ts budgetOf), not their address's.
  const m = await sessionMember(ctx, req, full);
  if (m) return { kind: 'member', email: m.email };
  // Anyone on the team signed in with GitHub (a designer, a lead, an admin) reads the team's products through Bridge:
  // a private product or design copy reads with the app, whatever their own token can see (githubTeamReaderOf).
  if (req.headers.get('authorization')) {
    const login = await githubTeamReaderOf(ctx, req, { ...parseRepo(full), full: full.toLowerCase() });
    if (login) return { kind: 'member', email: `gh:${login.toLowerCase()}` };
  }
  const a = await sessionAccount(req, ctx.svc.redis, ctx.svc.secret, ctx.now());
  if (a) {
    // The account's team set (api/_lib/members.ts keeps it, and team creation adds admins to it).
    if (await teamInSet(ctx.svc.redis, a.email, full)) return { kind: 'member', email: a.email };
    if (ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(full, a.email))) return { kind: 'member', email: a.email };
  }
  if (isPublicTeam(full)) {
    const { owner, repo } = parseRepo(full);
    if (openToVisitors(full) || (await isPublicRepo(rctx, owner, repo))) return { kind: 'guest' };
  }
  return null;
}

/**
 * GET gh= (one GitHub read), blobs= (many blobs at once), users= (public profiles) or changes= (the status reads of
 * open changes), for a member or (gh= and blobs= only) a visitor of a public demo team.
 */
const readCtxOf = (ctx: Ctx): ReadCtx => ({
  f: ctx.f,
  now: ctx.now,
  redis: ctx.svc.redis,
  token: (o, r) => ctx.svc.readApp.installationToken(o, r),
  env: { READ_MAX_IP: ctx.env.READ_MAX_IP, READ_MAX_GUEST: ctx.env.READ_MAX_GUEST, READ_MAX_TEAM: ctx.env.READ_MAX_TEAM, READ_MAX_UPSTREAM: ctx.env.READ_MAX_UPSTREAM },
});

/**
 * GET ?repo=<team>&mint=read-pass, for a member of the team on this site: a read pass (api/_lib/read-pass.ts) for the
 * product repositories the team's config lists, and the origins it may be handed to (the team's product pages). Studio
 * puts it in the fragment of the preview links it opens for this member; the Bridge toolbar there sends it back with
 * its reads. { pass: null } when the team lists no product.
 */
async function mintPass(ctx: Ctx, req: Request, full: string): Promise<Response> {
  const rctx = readCtxOf(ctx);
  const reader = await readerOf(ctx, req, full, rctx);
  if (reader?.kind !== 'member' || !reader.email) return fail(401, 'signin', SIGNIN);
  const { owner, repo } = parseRepo(full);
  const config = await teamReadConfigOf(rctx, owner, repo);
  const minted = mintReadPass({ team: full, repos: config.repos, member: memberBudgetId(reader.email) }, ctx.svc.secret, ctx.now());
  return json(200, minted ? { pass: minted.pass, exp: minted.exp, origins: config.origins } : { pass: null }, { 'Cache-Control': 'private, no-store' });
}

async function onTeamRead(req: Request, ctx: Ctx, params: URLSearchParams): Promise<Response> {
  const { owner, repo, full } = parseRepo(params.get('repo'));
  const rctx = readCtxOf(ctx);
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
  // A member's read pass, from another origin only, for a product repository it names: anything else is ignored (the
  // page reads as a visitor, as without it).
  const given = ctx.cross && product ? verifyReadPass(params.get('pass'), ctx.svc.secret, ctx.now()) : null;
  const pass = given && passOpens(given, full, `${product!.owner}/${product!.repo}`) ? given : null;
  if (ctx.cross) {
    // Another origin: a public demo team or a member's read pass, and only from an origin its bridge.config.json names.
    if (!isPublicTeam(full) && !pass) return json(401, { error: 'signin', message: SIGNIN });
    if (!originAllowed(ctx.cross.origin, (await teamReadConfigOf(rctx, owner, repo)).origins)) throw new HttpError(403, 'origin', CROSS_ORIGIN);
    ctx.cross.ok = true;
  }
  const reader = await readerOf(ctx, req, full, rctx, pass);
  if (!reader) {
    if (ctx.cross) return json(401, { error: 'signin', message: SIGNIN });
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
  const items = await mineItems(ctx.svc.redis, full, email);
  const branches: string[] = [];
  const issues: number[] = [];
  for (const it of items) {
    if (it.startsWith('b:')) {
      const b = it.slice(2);
      if (sameEmail(await ctx.svc.redis.cmd('GET', branchKey(full, b)), email)) branches.push(b);
    } else if (it.startsWith('i:') && NUMBER.test(it.slice(2))) {
      if (sameEmail(await ctx.svc.redis.cmd('GET', issueKey(full, it.slice(2))), email)) issues.push(Number(it.slice(2)));
    }
  }
  return { branches: branches.sort(), issues: issues.sort((a, b) => a - b) };
}

/**
 * What the member made on the team (its library) and in each of its products: their explorations in a design copy
 * and the developers' tasks Bridge filed for them are kept under that product repository's own keys, so the team's
 * set alone never lists them. `products` is keyed by repository (lower case), only the ones with something in them.
 */
export async function mineWithProducts(
  ctx: Ctx,
  full: string,
  email: string,
): Promise<{ branches: string[]; issues: number[]; products: Record<string, { branches: string[]; issues: number[] }> }> {
  const team = { ...parseRepo(full), full: full.toLowerCase() };
  const [own, pairs] = await Promise.all([mineOf(ctx, full, email), productPairs(ctx, team).catch(() => [] as ProductPair[])]);
  const repos = [...new Set(pairs.flatMap((p) => [p.copy, p.code]))];
  const reads = await Promise.all(repos.map((r) => mineOf(ctx, r, email).then((m) => [r, m] as const)));
  const products: Record<string, { branches: string[]; issues: number[] }> = {};
  for (const [r, m] of reads) if (m.branches.length || m.issues.length) products[r] = m;
  return { ...own, products };
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
  // Each with their reference (a hash, never the email): Settings picks a product manager by it. Who is asked to
  // review explorations (api/_lib/review-mode.ts), so Studio knows whether Done exploring goes through someone.
  const mode = await reviewModeOf(ctx.svc.redis, full);
  const members = people.map((p) => ({
    name: p.name,
    role: admins.some((e) => sameEmail(e, p.email)) ? 'admin' : p.role,
    ref: memberRef(p.email),
    ...(askedToReview(p, mode) ? { lead: true } : {}),
    ...(m && sameEmail(p.email, m.email) ? { you: true } : {}),
  }));
  const pms = Object.fromEntries(Object.entries(await pmsOf(ctx.svc.redis, full).catch(() => ({}) as Record<string, ProductPm>)).map(([k, v]) => [k, publicPm(v)]));
  return json(200, { collaborators, members, pms, reviewMode: mode }, { 'Cache-Control': 'private, no-store' });
}

/**
 * The lead guard of the webhook (api/_lib/lead-guard.ts), as the Bridge app: GitHub calls with the app's token on the
 * repository, the design owners of the team it belongs to (the notifications keep which team that is).
 */
const DESIGN_CHECK_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review', 'edited']);

/**
 * The "Design check" on every pull request of a product's developers' repository Bridge watches, from the GitHub
 * webhook (opened, reopened, a push, ready for review, a new description): success "No design to check" when it names
 * no task of a handed-off exploration, else where the check stands, the people still waiting named (failure while the
 * design changes). So a required check never holds a change that has no design, and a linked one shows at once.
 * Answers recompute it (onBuild). Never in the way of the delivery: a refused write is dropped.
 */
export function designCheckFor(ctx: Ctx): (event: string, payload: unknown) => Promise<'none' | 'linked' | 'skipped'> {
  return async (event, payload) => {
    const p = (payload ?? {}) as { action?: unknown; repository?: { full_name?: unknown }; pull_request?: { number?: unknown; body?: unknown; state?: unknown; head?: { sha?: unknown } } };
    if (event !== 'pull_request' || !DESIGN_CHECK_ACTIONS.has(String(p.action))) return 'skipped';
    const repo = typeof p.repository?.full_name === 'string' ? canonicalRepo(p.repository.full_name).toLowerCase() : '';
    const pr = p.pull_request;
    const head = typeof pr?.head?.sha === 'string' ? pr.head.sha : null;
    if (!repo || !head || !Number.isSafeInteger(pr?.number) || pr?.state === 'closed') return 'skipped';
    // Only the developers' repository of a product Bridge watches.
    const metaRaw = await ctx.svc.redis.cmd('GET', `bridge:notify:repo:${repo}`);
    let meta: { team?: string; kind?: string; product?: string } | null = null;
    try {
      meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : null;
    } catch {
      meta = null;
    }
    if (meta?.kind !== 'code' || !meta.team) return 'skipped';
    const [ro, rn] = repo.split('/') as [string, string];
    const token = await ctx.svc.app.installationToken(ro, rn);
    if (!token) return 'skipped';
    // A task it names that links an exploration in the design copy (Done exploring writes that link in the task).
    let linked: { copy: { repo: string; number: number }; issue: number } | null = null;
    for (const n of mentionedIssues(pr!.body, repo)) {
      const issue = await ghApp(ctx, token, 'GET', `/repos/${ro}/${rn}/issues/${n}`);
      const copy = issue.status === 200 && !issue.data?.pull_request ? linkedCopy(issue.data?.body, repo) : null;
      if (copy) {
        linked = { copy, issue: n };
        break;
      }
    }
    const statusToken = await ctx.svc.statusApp.installationToken(ro, rn).catch(() => null);
    if (!statusToken) return 'skipped';
    const write = (x: { state: string; description: string }) => ghAppSend(ctx, statusToken, 'POST', `/repos/${ro}/${rn}/statuses/${head}`, { ...x, context: DESIGN_CHECK }).catch(() => undefined);
    if (!linked) {
      await write(NO_DESIGN);
      return 'none';
    }
    const [co, cn] = linked.copy.repo.split('/') as [string, string];
    const copyToken = await ctx.svc.app.installationToken(co, cn);
    const ex = copyToken ? await ghApp(ctx, copyToken, 'GET', `/repos/${co}/${cn}/pulls/${linked.copy.number}`) : null;
    const block = ex?.status === 200 ? explorationBlockOf(ex.data?.body) : null;
    const pm = meta.product ? await pmOf(ctx.svc.redis, meta.team, meta.product) : null;
    const designer = typeof block?.memberName === 'string' ? block.memberName : typeof block?.author === 'string' ? block.author : typeof block?.doneBy === 'string' ? block.doneBy : undefined;
    const need: BuildNeed = { pm: Boolean(pm), lead: Array.isArray(block?.leadPieces) && (block!.leadPieces as unknown[]).length > 0, names: { ...(designer ? { designer } : {}), ...(pm ? { pm: pm.name } : {}) } };
    const words = await saveBuild(ctx.svc.redis, repo, pr!.number as number, need);
    await write(designCheckStatus(buildStateOf(words, head, need), need.names, { designChanging: Boolean(block && typeof block.doneAt !== 'string') }));
    return 'linked';
  };
}

function leadGuardFor(ctx: Ctx): (event: string, payload: unknown) => Promise<boolean> {
  const call = async (repo: string, method: string, path: string, body?: unknown) => {
    const [owner = '', name = ''] = repo.split('/');
    const token = await ctx.svc.app.installationToken(owner, name);
    if (!token) return null;
    const res = await ctx.f(`${API}${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-contribute', 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const designOwners = async (repo: string) => {
    const meta = await ctx.svc.redis.cmd('GET', repoMetaKey(repo)).catch(() => null);
    let team = repo;
    try {
      const m = typeof meta === 'string' ? (JSON.parse(meta) as { team?: unknown }) : null;
      if (typeof m?.team === 'string') team = m.team;
    } catch {
      /* the repository itself */
    }
    if (isTeamKeyRepo(team)) return [];
    const [owner = '', name = ''] = team.split('/');
    return (await teamFacts(ctx, { owner, repo: name, full: team.toLowerCase() })).designOwnerLogins;
  };
  return (event, payload) => runLeadGuard(event, payload, { call, designOwners });
}

// ---------------------------------------------------------------------------------------------------------------
// The handler

export async function handleContribute(req: Request, env: ContribEnv, deps: ContribDeps): Promise<Response> {
  // A GET from a page of another origin (the Bridge toolbar in a product): a read of gh= or blobs= only.
  const origin = req.headers.get('origin');
  const cross = req.method.toUpperCase() === 'GET' && origin !== null && !sameOriginWhenPresent(req) ? { origin, ok: false } : null;
  const res = await contribute(req, env, deps, cross);
  // A read the team's config allows, and every refusal: the toolbar must read why it was refused (a missing app, an
  // origin the config does not name, a sign-in) to fall back to GitHub and say so, instead of a blocked answer the
  // browser hides. A refusal carries no data, and these reads never send credentials.
  if (cross && (cross.ok || res.status >= 400)) for (const [k, v] of Object.entries(corsHeaders(cross.origin))) res.headers.set(k, v);
  return res;
}

async function contribute(req: Request, env: ContribEnv, deps: ContribDeps, cross: Ctx['cross'] | null): Promise<Response> {
  try {
    const method = req.method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return json(405, { error: 'method', message: 'Use GET, POST, PUT, PATCH or DELETE.' }, { Allow: 'GET, POST, PUT, PATCH, DELETE' });
    const params = new URL(req.url).searchParams;
    // GitHub's webhook (vercel.json rewrites /api/github-webhook here): signed by GitHub, no cookie, no CSRF header.
    if (params.get('hook') === 'github') {
      const kvUrl = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
      const kvToken = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
      const redis = deps.redis ?? (kvUrl && kvToken ? redisRest(kvUrl, kvToken, deps.fetch, STORAGE_DOWN) : null);
      const session = env.LIBRARY_SESSION_SECRET?.trim() ?? '';
      // Notifications need the session secret (unsubscribe links); the sender is optional (kept, not sent). Someone
      // with no Bridge account is named by their GitHub profile name, as Studio names them (the read token's profile).
      const svc = redis ? services(env, { ...deps, redis }) : null;
      const now = deps.now ?? Date.now;
      const profileName = svc
        ? (login: string, repo: string) => {
            const [o = '', r = ''] = repo.split('/');
            return profileNameOf({ f: deps.fetch, now, redis: svc.redis, token: (ow, re) => svc.readApp.installationToken(ow, re) }, o, r, login);
          }
        : undefined;
      const notify =
        session.length >= MIN_SECRET_LENGTH
          ? {
              sender: deps.notifySender !== undefined ? deps.notifySender : notifySenderFromEnv(env, deps.fetch),
              secret: session,
              publicUrl: env.PUBLIC_SITE_URL,
              ...(deps.members ? { members: deps.members } : {}),
              ...(profileName ? { profileName } : {}),
              loginId: publicLoginId(deps.fetch),
              ...(svc
                ? {
                    explorationBlock: async (repo: string, n: number) => {
                      const [o = '', r = ''] = repo.split('/');
                      const token = await svc.readApp.installationToken(o, r);
                      if (!token) return null;
                      const res = await deps.fetch(`${API}/repos/${o}/${r}/pulls/${n}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-contribute', 'X-GitHub-Api-Version': '2022-11-28' } });
                      return res.status === 200 ? explorationBlockOf(((await res.json()) as { body?: unknown }).body) : null;
                    },
                  }
                : {}),
            }
          : undefined;
      const guard = svc ? leadGuardFor({ f: deps.fetch, now, random: deps.random ?? ((n) => randomBytes(n)), svc, env }) : undefined;
      const designCheck = svc ? designCheckFor({ f: deps.fetch, now, random: deps.random ?? ((n) => randomBytes(n)), svc, env }) : undefined;
      return await handleGithubWebhook(req, { redis, secret: env.GITHUB_WEBHOOK_SECRET, now: deps.now ?? Date.now, ...(notify ? { notify } : {}), ...(guard ? { guard } : {}), ...(designCheck ? { designCheck } : {}) });
    }
    if (method !== 'GET') requireCsrf(req);
    const svc = services(env, deps);
    const gh = params.get('gh');
    const blobs = params.get('blobs');
    const users = params.get('users');
    const changes = params.get('changes');
    // Another origin reads one thing: gh= or blobs=, nothing else (no member facts, no people, no change status).
    if (cross && ((gh === null) === (blobs === null) || users !== null || changes !== null)) throw new HttpError(403, 'origin', CROSS_ORIGIN);

    // The latest published version of library packages (the product page's library line): public, kept a few minutes.
    if (method === 'GET' && params.get('npm') !== null && gh === null && blobs === null) {
      return json(200, { latest: await npmLatest(deps.fetch, svc?.redis ?? null, parseNpmNames(params.get('npm'))) });
    }
    if (method === 'GET' && gh === null && blobs === null && users === null && changes === null) {
      const repoArg = params.get('repo');
      if (repoArg === null || !svc) {
        if (repoArg !== null) parseRepo(repoArg);
        return json(200, { available: Boolean(svc), member: null });
      }
      const { full } = parseRepo(repoArg);
      const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
      if (params.get('mint') === 'read-pass') return await mintPass(ctx, req, full);
      const m = await sessionMember(ctx, req, full);
      if (params.get('members') === '1') return await membersOf(ctx, req, full, m);
      if (params.get('mine') === '1') {
        const d = m ? null : await githubDesignerOf(ctx, req, { ...parseRepo(full), full: full.toLowerCase() });
        const who = m?.email ?? (d?.kind === 'designer' ? d.member.email : null);
        if (!who) return fail(401, 'signin', SIGNIN);
        const mine = await mineWithProducts(ctx, full, who);
        // A member who joined by email and opens Studio: their team and products are watched for their notifications,
        // also for what they filed before Bridge sent any (never expires with the read cache).
        if (m) {
          const pairs = await productPairs(ctx, { ...parseRepo(full), full: full.toLowerCase() }).catch(() => [] as ProductPair[]);
          await ctx.svc.redis.pipe(watchWrites(watchedOf(full.toLowerCase(), pairs))).catch(() => undefined);
        }
        return json(200, mine);
      }
      // Local mode only: a member seeded as admin reads as admin, so Studio shows them the admin screens (the server
      // checks again on every admin action).
      const admin = Boolean(m && svc.localAdmins && (await svc.localAdmins.isAdmin(full, m.email)));
      const mode = m ? await reviewModeOf(svc.redis, full) : 'one';
      return json(200, { available: true, member: m ? { ...publicMember(m, mode), ...(admin ? { role: 'admin', decides: true } : {}) } : null, ...(m ? { reviewMode: mode } : {}) });
    }

    if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
    const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env, ...(cross ? { cross } : {}) };
    if (method !== 'GET') {
      const refused = await demoWriteRefusal(ctx, req, params);
      if (refused) return refused;
    }
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
  READ_MAX_UPSTREAM: process.env.READ_MAX_UPSTREAM,
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  NOTIFY_FROM: process.env.NOTIFY_FROM,
});

// Answers to calls with the Bridge app's tokens are metered per installation (api/_lib/github-quota.ts).
const realFetch: FetchLike = meteredFromEnv();
const handle = (request: Request) => handleContribute(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
