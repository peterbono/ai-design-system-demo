// /api/account: Bridge accounts, one per person, identified by email (docs/HOSTED.md, "Accounts").
//
// No password, no username. Sign in is "Continue with GitHub" (a GitHub user token, its verified emails) or "Continue
// with email" (a 6-digit code by email, 10 minutes, single use, 5 tries then burned). The same screen signs in and
// signs up: a new email creates the account. Existing email members (bridge:member:*) find their memberships by email
// on first sign-in. GitHub sign-in links GitHub to the account whose email is one of the GitHub verified emails, else
// creates an account with the primary verified email.
//
// Endpoints (JSON, errors are { error, message } in Studio words):
//   GET  /api/account                          { available, account }  account is { email, name, github, teams } or null
//   GET  /api/account?export=1                 the daily backup (Vercel cron, Authorization: Bearer $CRON_SECRET)
//   POST { action: 'code', email }             always { ok: true } (a cap answers 429 for everyone alike); emails a code
//   POST { action: 'verify', email, code, name? }   sets the cookie; { account, created, next }
//   POST { action: 'github', token }           links or creates from a GitHub user token, sets the cookie; same answer
//   POST { action: 'rename', name }            { account }
//   POST { action: 'sign-out' }                clears the cookie on this browser
//   POST { action: 'sign-out-everywhere' }     bumps the account version: every session ends
//   POST { action: 'delete' }                  deletes the account, its email memberships and sessions; 409 last-admin
//                                              when the person is the only admin of a team with other members (checked
//                                              on GitHub when the request carries their GitHub token as Bearer)
// Every request other than GET carries `X-Bridge-Account: 1`, JSON, and an Origin of this very site (CSRF).
//
// Security: codes are compared in constant time on their SHA-256, stored only hashed, 10 minutes, single use; 5 wrong
// tries burn the code. Codes are capped per email, per network and for the site per UTC day (emails and networks
// under an HMAC), and the answer is the same whether or not an account exists. Nothing here logs an email or a code.
//
// Storage: api/_lib/account.ts (accounts, GitHub links, teams, codes) and api/_lib/members.ts (memberships).
// Env (server only): KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_ pair), LIBRARY_SESSION_SECRET (32+
// characters), RESEND_API_KEY + INVITE_EMAIL_FROM (codes), CRON_SECRET + BLOB_READ_WRITE_TOKEN (backup).

import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  type Account,
  accountKey,
  clearAccountCookie,
  codeKey,
  getAccount,
  githubKey,
  issueAccountCookie,
  putAccount,
  sessionAccount,
} from '../_lib/account.js';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { clientIp, dayOf, envInt, fail, GITHUB_DOWN, HttpError, json, readBody, sameOrigin, secondsToTomorrow, sha256, type FetchLike } from '../_lib/http.js';
import { accountTeamsKey, memberStore, type MemberStore } from '../_lib/members.js';
import { globEscape, redisRest, type Redis } from '../_lib/redis.js';
import { readCookie } from '../_lib/session.js';
import { teamDisplayName } from '../../src/lib/demo.js';
import { STUDIO_ROOT } from '../../src/lib/team-path.js';

export type { Account, FetchLike };

// ---------------------------------------------------------------------------------------------------------------
// Types and constants

export interface AccountEnv {
  KV_REST_API_URL?: string | undefined;
  KV_REST_API_TOKEN?: string | undefined;
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  INVITE_EMAIL_FROM?: string | undefined;
  LIBRARY_SESSION_SECRET?: string | undefined;
  CRON_SECRET?: string | undefined;
  BLOB_READ_WRITE_TOKEN?: string | undefined;
  ACCOUNT_CODES_MAX_SITE_DAY?: string | undefined;
}

/** The backup store (Vercel Blob in production). */
export interface BlobStore {
  put(pathname: string, body: string): Promise<void>;
  list(prefix: string): Promise<{ pathname: string; url: string; uploadedAt: Date }[]>;
  del(urls: string[]): Promise<void>;
}

export interface AccountDeps {
  fetch: FetchLike;
  now?: () => number;
  /** A 6-digit code (tests). */
  code?: () => string;
  redis?: Redis;
  members?: MemberStore;
  email?: EmailSender;
  /** Builds the backup store from the token (tests inject one). */
  blob?: (token: string) => BlobStore | Promise<BlobStore>;
  /** Where a skipped backup says so (never an email). */
  warn?: (msg: string) => void;
}

export interface PublicTeam {
  repo: string;
  name: string;
  role: 'edit' | 'reviewer' | 'admin';
  via: 'email';
}

export interface PublicAccount {
  email: string;
  name: string;
  github: { login: string; id: number } | null;
  teams: PublicTeam[];
}

export const CODE_TTL_S = 10 * 60;
export const MAX_TRIES = 5;
/** Codes per UTC day. The site cap stays under the email provider's free daily quota. */
export const CODE_LIMITS = { email: 5, ip: 20, site: 100 } as const;
/** Code checks and GitHub sign-ins per network per UTC day. */
export const VERIFY_PER_IP_DAY = 60;
export const GITHUB_PER_IP_DAY = 60;
/** Daily backups kept. */
export const BACKUPS_KEPT = 30;
export const BACKUP_PREFIX = 'bridge-backups/accounts-';
/** What the backup holds. Codes and counters never leave Redis. */
export const EXPORT_PATTERNS = ['bridge:account:*', 'bridge:member:*', 'bridge:members:*', 'bridge:invite:*'];
const EXPORT_SKIP = /^bridge:account:(code|codefor|codetries|count):/;
const MAX_ACTION_BODY = 4096;
const COUNTER_TTL_S = 2 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;
const API = 'https://api.github.com';
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
const CODE = /^\d{6}$/;
const GH_TOKEN = /^[A-Za-z0-9_.-]{20,255}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

// ---------------------------------------------------------------------------------------------------------------
// Words

export const NOT_CONFIGURED = 'Bridge accounts are not available yet on this site.';
export const EMAIL_NOT_CONFIGURED = 'Signing in with an email is not available yet on this site. Continue with GitHub.';
export const SIGNIN = 'Your session ended. Sign in again.';
export const WRONG_CODE = 'This code is not the one we sent. Check the latest email and try again.';
export const CODE_EXPIRED = 'This code expired or was used too many times. Ask for a new one.';
export const BAD_EMAIL = 'Enter your email, like name@company.com.';
export const GITHUB_AGAIN = 'GitHub did not accept this sign-in. Continue with GitHub again.';
export const EMAIL_ACCESS = 'Bridge needs to see the verified emails of your GitHub account. Continue with GitHub again and allow it.';
export const NO_VERIFIED_EMAIL = 'Your GitHub account has no verified email. Verify one on GitHub, then continue with GitHub again.';
export const GITHUB_TAKEN = 'This Bridge account is already linked to another GitHub account. Sign in with that one.';
export const LAST_ADMIN = 'You are the only admin of a team that has other members. Make someone else admin first, then delete your account.';
const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
export const LIMIT_WORDS = {
  code: 'Bridge already sent a few codes today. Use the latest one, or try again tomorrow.',
  verify: 'Too many tries from this network today. Try again tomorrow.',
};

// ---------------------------------------------------------------------------------------------------------------
// Services

interface Services {
  redis: Redis;
  members: MemberStore;
  email: EmailSender | null;
  secret: string;
}

function redisOf(env: AccountEnv, deps: AccountDeps): Redis | null {
  const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  return deps.redis ?? (url && token ? redisRest(url, token, deps.fetch, STORAGE_DOWN) : null);
}

/** Storage and the session secret (email for codes), or null when one is missing. */
export function services(env: AccountEnv, deps: AccountDeps): Services | null {
  const redis = redisOf(env, deps);
  const key = env.RESEND_API_KEY?.trim();
  const from = env.INVITE_EMAIL_FROM?.trim();
  const email = deps.email ?? (key && from ? resendSender(key, from, deps.fetch) : null);
  const secret = env.LIBRARY_SESSION_SECRET?.trim() ?? '';
  if (!redis || secret.length < MIN_SECRET_LENGTH) return null;
  return { redis, members: deps.members ?? memberStore(redis), email, secret };
}

interface Ctx {
  f: FetchLike;
  now: () => number;
  svc: Services;
  env: AccountEnv;
  deps: AccountDeps;
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

export const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());
const hmacHex = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('hex').slice(0, 32);
const codeForKey = (secret: string, email: string) => `bridge:account:codefor:${hmacHex(secret, `codefor:${email}`)}`;
const triesKey = (secret: string, email: string) => `bridge:account:codetries:${hmacHex(secret, `tries:${email}`)}`;
const countKey = (kind: string, who: string, day: string) => `bridge:account:count:${kind}:${who}:${day}`;

/** Equal strings, compared in constant time (on their SHA-256, so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
}

/** A person's name as Bridge shows it: letters, digits, spaces, . ' - only, at most 80, never empty. */
export function cleanName(raw: unknown, email: string): string {
  const s = typeof raw === 'string' ? raw.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} .'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() : '';
  if (s) return s;
  return email.split('@')[0]!.replace(/[^A-Za-z0-9.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Bridge user';
}

function requireCsrf(req: Request): void {
  if (req.headers.get('x-bridge-account') !== '1' || !sameOrigin(req)) throw new HttpError(403, 'origin', 'Sign in from Bridge on this site.');
}

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

const ipHash = (ctx: Ctx, req: Request) => hmacHex(ctx.svc.secret, `ip:${clientIp(req)}`);

// ---------------------------------------------------------------------------------------------------------------
// Teams

/** Every key of `pattern`, through SCAN (never KEYS). */
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

/** Memberships made before accounts existed: found once by email, then kept in bridge:account:teams:<email>. */
async function backfillTeams(ctx: Ctx, email: string): Promise<void> {
  const keys = await scanKeys(ctx.svc.redis, `bridge:member:*:${globEscape(email)}`);
  const suffix = `:${email}`;
  const repos = keys.filter((k) => k.endsWith(suffix)).map((k) => k.slice('bridge:member:'.length, -suffix.length)).filter((r) => /^[^/:]+\/[^/:]+$/.test(r));
  if (repos.length) await ctx.svc.redis.cmd('SADD', accountTeamsKey(email), ...repos);
}

/** The email memberships of an account, each one read again (a removed membership is dropped from the set). */
async function teamsOf(ctx: Ctx, email: string): Promise<(PublicTeam & { at: string })[]> {
  const raw = await ctx.svc.redis.cmd('SMEMBERS', accountTeamsKey(email));
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').sort() : [];
  const out: (PublicTeam & { at: string })[] = [];
  for (const repo of repos) {
    const m = await ctx.svc.members.get(repo, email);
    if (!m) {
      await ctx.svc.redis.cmd('SREM', accountTeamsKey(email), repo);
      continue;
    }
    out.push({ repo, name: teamDisplayName(repo), role: m.role, via: 'email', at: m.at });
  }
  return out;
}

async function publicAccount(ctx: Ctx, a: Account): Promise<PublicAccount> {
  const teams = (await teamsOf(ctx, a.email)).map(({ at: _at, ...t }) => t);
  return { email: a.email, name: a.name, github: a.github ? { login: a.github.login, id: a.github.id } : null, teams };
}

/**
 * Where to go after signing in: onboarding for a new account; else the team joined last; else Studio, which lists
 * the GitHub teams (a GitHub account), or onboarding (email only, no team yet).
 */
async function nextFor(ctx: Ctx, a: Account, created: boolean): Promise<string> {
  if (created) return '/start/';
  const teams = await teamsOf(ctx, a.email);
  if (teams.length) {
    const last = teams.reduce((x, y) => (Date.parse(y.at || '') > Date.parse(x.at || '') ? y : x));
    const [o, r] = last.repo.split('/') as [string, string];
    return `${STUDIO_ROOT}${encodeURIComponent(o)}/${encodeURIComponent(r)}/`;
  }
  return a.github ? STUDIO_ROOT : '/start/';
}

async function createAccount(ctx: Ctx, email: string, name: string, github: Account['github']): Promise<Account> {
  const a: Account = { id: randomUUID(), email, name, github, createdAt: new Date(ctx.now()).toISOString(), version: 1 };
  await putAccount(ctx.svc.redis, a);
  if (github) await ctx.svc.redis.cmd('SET', githubKey(github.id), email);
  await backfillTeams(ctx, email);
  return a;
}

async function signedIn(ctx: Ctx, a: Account, created: boolean): Promise<Response> {
  return json(200, { account: await publicAccount(ctx, a), created, next: await nextFor(ctx, a, created) }, { 'Set-Cookie': issueAccountCookie(a, ctx.svc.secret, ctx.now()) });
}

// ---------------------------------------------------------------------------------------------------------------
// Codes

function codeEmail(to: string, code: string): EmailMessage {
  const text = [
    `Your Bridge code: ${code}`,
    '',
    'Enter it on the page that asked for it. It works once and expires in 10 minutes.',
    'If you did not ask for it, you can ignore this email.',
  ].join('\n');
  const html = [
    '<p>Your Bridge code:</p>',
    `<p style="font-size:24px;letter-spacing:4px"><strong>${escHtml(code)}</strong></p>`,
    '<p>Enter it on the page that asked for it. It works once and expires in 10 minutes.</p>',
    '<p>If you did not ask for it, you can ignore this email.</p>',
  ].join('\n');
  return { to, subject: `${code} is your Bridge code`, text, html };
}

const newCode = (deps: AccountDeps) => (deps.code ? deps.code() : String(randomInt(0, 1_000_000)).padStart(6, '0'));

async function onCode(ctx: Ctx, req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!validEmail(body.email)) return fail(400, 'bad_email', BAD_EMAIL);
  const { svc } = ctx;
  if (!svc.email) return fail(503, 'not_configured', EMAIL_NOT_CONFIGURED);
  const email = body.email.trim().toLowerCase();
  const day = dayOf(ctx.now());
  // Counted for everyone, with an account or not, so the answer never tells who has one.
  const release = await bumpOrRefuse(
    ctx,
    [countKey('code:email', hmacHex(svc.secret, `email:${email}`), day), countKey('code:ip', ipHash(ctx, req), day), countKey('code:site', 'all', day)],
    [CODE_LIMITS.email, CODE_LIMITS.ip, envInt(ctx.env.ACCOUNT_CODES_MAX_SITE_DAY, CODE_LIMITS.site)],
    LIMIT_WORDS.code,
    'code',
  );
  const code = newCode(ctx.deps);
  const hash = sha256(email + code);
  const pointer = codeForKey(svc.secret, email);
  // One live code per email: a new one replaces the last, and its tries start again.
  const prev = await svc.redis.cmd('GET', pointer);
  await svc.redis.pipe([
    ...(typeof prev === 'string' ? [['DEL', codeKey(prev)]] : []),
    ['SET', codeKey(hash), JSON.stringify({ email, tries: 0, exp: ctx.now() + CODE_TTL_S * 1000 }), 'EX', CODE_TTL_S],
    ['SET', pointer, hash, 'EX', CODE_TTL_S],
    ['DEL', triesKey(svc.secret, email)],
  ]);
  try {
    await svc.email.send(codeEmail(email, code));
  } catch {
    // The same answer as always (no enumeration); the code and the count go back.
    await svc.redis.pipe([['DEL', codeKey(hash)], ['DEL', pointer]]);
    await release();
  }
  return json(200, { ok: true });
}

async function onVerify(ctx: Ctx, req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!validEmail(body.email)) return fail(400, 'bad_email', BAD_EMAIL);
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!CODE.test(code)) return fail(400, 'wrong-code', WRONG_CODE);
  const { svc } = ctx;
  const email = body.email.trim().toLowerCase();
  await bumpOrRefuse(ctx, [countKey('verify:ip', ipHash(ctx, req), dayOf(ctx.now()))], [VERIFY_PER_IP_DAY], LIMIT_WORDS.verify, 'verify');
  const pointer = codeForKey(svc.secret, email);
  const live = await svc.redis.cmd('GET', pointer);
  if (typeof live !== 'string') return fail(410, 'expired', CODE_EXPIRED);
  if (!safeEqual(sha256(email + code), live)) {
    const [tries] = await svc.redis.pipe([['INCRBY', triesKey(svc.secret, email), 1], ['EXPIRE', triesKey(svc.secret, email), CODE_TTL_S]]);
    const n = Number(tries);
    if (n >= MAX_TRIES) {
      // Burned: even the right code no longer works.
      await svc.redis.pipe([['DEL', codeKey(live)], ['DEL', pointer], ['DEL', triesKey(svc.secret, email)]]);
      return fail(410, 'expired', CODE_EXPIRED);
    }
    const rec = await svc.redis.cmd('GET', codeKey(live));
    if (typeof rec === 'string') {
      try {
        const r = JSON.parse(rec) as { exp?: number };
        const left = Math.ceil(((r.exp ?? 0) - ctx.now()) / 1000);
        if (left > 0) await svc.redis.cmd('SET', codeKey(live), JSON.stringify({ ...r, tries: n }), 'EX', left);
      } catch {
        /* the record stays as it is */
      }
    }
    return fail(400, 'wrong-code', WRONG_CODE, { triesLeft: MAX_TRIES - n });
  }
  // Single use: whoever takes the record first signs in.
  const raw = await svc.redis.cmd('GETDEL', codeKey(live));
  await svc.redis.pipe([['DEL', pointer], ['DEL', triesKey(svc.secret, email)]]);
  let rec: { email?: unknown } | null = null;
  try {
    rec = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    rec = null;
  }
  if (!rec || rec.email !== email) return fail(410, 'expired', CODE_EXPIRED);
  const known = await getAccount(svc.redis, email);
  if (known) return signedIn(ctx, known, false);
  return signedIn(ctx, await createAccount(ctx, email, cleanName(body.name, email), null), true);
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub

async function ghUser(ctx: Ctx, token: string, path: string): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await ctx.f(`${API}${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-account', 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** The GitHub user behind a user token, or an HttpError. */
async function githubUser(ctx: Ctx, token: string): Promise<{ id: number; login: string; name: string | null }> {
  const u = await ghUser(ctx, token, '/user');
  if (u.status !== 200 || !Number.isSafeInteger(u.data?.id) || typeof u.data?.login !== 'string') throw new HttpError(401, 'github', GITHUB_AGAIN);
  return { id: u.data.id, login: u.data.login, name: typeof u.data.name === 'string' ? u.data.name : null };
}

async function onGithub(ctx: Ctx, req: Request, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.token !== 'string' || !GH_TOKEN.test(body.token)) return fail(401, 'github', GITHUB_AGAIN);
  const { svc } = ctx;
  await bumpOrRefuse(ctx, [countKey('github:ip', ipHash(ctx, req), dayOf(ctx.now()))], [GITHUB_PER_IP_DAY], LIMIT_WORDS.verify, 'github');
  const user = await githubUser(ctx, body.token);
  const em = await ghUser(ctx, body.token, '/user/emails?per_page=100');
  if (em.status === 401) return fail(401, 'github', GITHUB_AGAIN);
  if (em.status !== 200 || !Array.isArray(em.data)) return fail(403, 'email-access', EMAIL_ACCESS);
  // Verified only, primary first.
  const verified = (em.data as { email?: unknown; verified?: unknown; primary?: unknown }[])
    .filter((e) => e && e.verified === true && validEmail(e.email))
    .sort((a, b) => Number(b.primary === true) - Number(a.primary === true))
    .map((e) => ({ email: (e.email as string).trim().toLowerCase(), primary: e.primary === true }));
  const github = { login: user.login, id: user.id };

  // Already linked: that account, whatever its email.
  const linked = await svc.redis.cmd('GET', githubKey(user.id));
  if (typeof linked === 'string') {
    const a = await getAccount(svc.redis, linked);
    if (a && a.github?.id === user.id) {
      if (a.github.login !== user.login) await putAccount(svc.redis, { ...a, github });
      return signedIn(ctx, { ...a, github }, false);
    }
  }
  // An account with one of the verified emails: GitHub is linked to it.
  for (const { email } of verified) {
    const a = await getAccount(svc.redis, email);
    if (!a) continue;
    if (a.github && a.github.id !== user.id) return fail(409, 'github-taken', GITHUB_TAKEN);
    const next = { ...a, github };
    await putAccount(svc.redis, next);
    await svc.redis.cmd('SET', githubKey(user.id), a.email);
    return signedIn(ctx, next, false);
  }
  const primary = verified.find((e) => e.primary);
  if (!primary) return fail(409, 'no-verified-email', NO_VERIFIED_EMAIL);
  return signedIn(ctx, await createAccount(ctx, primary.email, cleanName(user.name ?? user.login, primary.email), github), true);
}

// ---------------------------------------------------------------------------------------------------------------
// Delete

/**
 * The teams this person is the only admin of while others are on them. Email memberships are never admin (admins
 * join with GitHub). On GitHub, checked when the request carries the person's own GitHub token (Bearer) for the
 * linked account: the repositories the Bridge app and the person share, where they are admin.
 */
async function lastAdminOf(ctx: Ctx, req: Request, a: Account): Promise<string[]> {
  const out: string[] = [];
  for (const t of await teamsOf(ctx, a.email)) {
    if (t.role !== 'admin') continue;
    const others = (await ctx.svc.members.list(t.repo)).filter((m) => m.email !== a.email);
    if (others.length) out.push(t.repo);
  }
  const bearer = /^Bearer\s+([A-Za-z0-9_.-]{20,255})$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!a.github || !bearer) return out;
  const user = await ghUser(ctx, bearer, '/user');
  const ghId = a.github.id;
  if (user.status !== 200 || user.data?.id !== ghId) return out;
  const inst = await ghUser(ctx, bearer, '/user/installations?per_page=100');
  const installations: any[] = Array.isArray(inst.data?.installations) ? inst.data.installations : [];
  for (const i of installations.slice(0, 20)) {
    if (!Number.isSafeInteger(i?.id)) continue;
    const r = await ghUser(ctx, bearer, `/user/installations/${i.id}/repositories?per_page=100`);
    const repos: any[] = Array.isArray(r.data?.repositories) ? r.data.repositories : [];
    for (const repo of repos) {
      if (repo?.permissions?.admin !== true || typeof repo.full_name !== 'string' || !REPO.test(repo.full_name)) continue;
      const full = repo.full_name.toLowerCase();
      if (out.includes(full)) continue;
      const c = await ghUser(ctx, bearer, `/repos/${repo.full_name}/collaborators?affiliation=all&per_page=100`);
      const people: any[] = c.status === 200 && Array.isArray(c.data) ? c.data : [];
      const admins = people.filter((p) => p?.permissions?.admin === true && p.id !== ghId);
      const others = people.filter((p) => p?.id !== ghId).length + (await ctx.svc.members.list(full)).filter((m) => m.email !== a.email).length;
      if (!admins.length && others > 0) out.push(full);
    }
  }
  return out;
}

async function onDelete(ctx: Ctx, req: Request, a: Account): Promise<Response> {
  const blocked = await lastAdminOf(ctx, req, a);
  if (blocked.length) return fail(409, 'last-admin', LAST_ADMIN, { teams: blocked });
  const { svc } = ctx;
  const raw = await svc.redis.cmd('SMEMBERS', accountTeamsKey(a.email));
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  // Each membership goes, which also ends that team's contributor sessions.
  for (const repo of repos) await svc.members.remove(repo, a.email);
  const pointer = codeForKey(svc.secret, a.email);
  const live = await svc.redis.cmd('GET', pointer);
  const gh = a.github ? await svc.redis.cmd('GET', githubKey(a.github.id)) : null;
  await svc.redis.pipe([
    ['DEL', accountKey(a.email)],
    ['DEL', accountTeamsKey(a.email)],
    ['DEL', pointer],
    ['DEL', triesKey(svc.secret, a.email)],
    ...(typeof live === 'string' ? [['DEL', codeKey(live)]] : []),
    ...(a.github && gh === a.email ? [['DEL', githubKey(a.github.id)]] : []),
  ]);
  return json(200, { ok: true }, { 'Set-Cookie': clearAccountCookie() });
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

async function onAction(req: Request, ctx: Ctx): Promise<Response> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const body = await readBody(req, MAX_ACTION_BODY);
  const { svc } = ctx;
  switch (body.action) {
    case 'code':
      return onCode(ctx, req, body);
    case 'verify':
      return onVerify(ctx, req, body);
    case 'github':
      return onGithub(ctx, req, body);
    case 'sign-out':
      return json(200, { ok: true }, { 'Set-Cookie': clearAccountCookie() });
    case 'rename':
    case 'sign-out-everywhere':
    case 'delete': {
      const a = await sessionAccount(req, svc.redis, svc.secret, ctx.now());
      if (!a) return json(401, { error: 'signin', message: SIGNIN }, { 'Set-Cookie': clearAccountCookie() });
      if (body.action === 'rename') {
        if (typeof body.name !== 'string' || !body.name.trim()) return fail(400, 'bad_name', 'Enter your name.');
        const next = { ...a, name: cleanName(body.name, a.email) };
        await putAccount(svc.redis, next);
        return json(200, { account: await publicAccount(ctx, next) });
      }
      if (body.action === 'sign-out-everywhere') {
        await putAccount(svc.redis, { ...a, version: a.version + 1 });
        return json(200, { ok: true }, { 'Set-Cookie': clearAccountCookie() });
      }
      return onDelete(ctx, req, a);
    }
    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The daily backup

async function vercelBlob(token: string): Promise<BlobStore> {
  const blob = await import('@vercel/blob');
  return {
    async put(pathname, body) {
      await blob.put(pathname, body, { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, token });
    },
    async list(prefix) {
      const out: { pathname: string; url: string; uploadedAt: Date }[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const r = await blob.list({ prefix, token, limit: 1000, ...(cursor ? { cursor } : {}) });
        out.push(...r.blobs.map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt })));
        if (!r.hasMore || !r.cursor) break;
        cursor = r.cursor;
      }
      return out;
    },
    async del(urls) {
      if (urls.length) await blob.del(urls, { token });
    },
  };
}

/** GET ?export=1: Bearer $CRON_SECRET (Vercel cron sends it), a JSON of accounts, members and invites to Vercel Blob. */
async function onExport(req: Request, env: AccountEnv, deps: AccountDeps): Promise<Response> {
  const secret = env.CRON_SECRET?.trim();
  const given = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim() ?? '';
  if (!secret || !given || !safeEqual(given, secret)) return fail(401, 'unauthorized', 'Not allowed.');
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    warn('account export: BLOB_READ_WRITE_TOKEN is not set, backup skipped');
    return json(200, { ok: true, skipped: 'no-blob-token' });
  }
  const redis = redisOf(env, deps);
  if (!redis) return fail(503, 'not_configured', NOT_CONFIGURED);
  const keys = [...new Set((await Promise.all(EXPORT_PATTERNS.map((p) => scanKeys(redis, p)))).flat())].filter((k) => !EXPORT_SKIP.test(k)).sort();
  const data: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const types = await redis.pipe(batch.map((k) => ['TYPE', k]));
    const reads = batch.map((k, j) => (types[j] === 'set' ? ['SMEMBERS', k] : types[j] === 'zset' ? ['ZRANGE', k, 0, -1] : ['GET', k]));
    const values = await redis.pipe(reads);
    batch.forEach((k, j) => {
      const v = values[j];
      if (v === null || v === undefined) return;
      if (typeof v === 'string') {
        try {
          data[k] = JSON.parse(v);
        } catch {
          data[k] = v;
        }
      } else data[k] = v;
    });
  }
  const now = (deps.now ?? Date.now)();
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const store = await (deps.blob ?? vercelBlob)(token);
  await store.put(`${BACKUP_PREFIX}${stamp}.json`, JSON.stringify({ exportedAt: new Date(now).toISOString(), keys: data }));
  const all = (await store.list(BACKUP_PREFIX)).sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime() || b.pathname.localeCompare(a.pathname));
  const old = all.slice(BACKUPS_KEPT).map((b) => b.url);
  await store.del(old);
  return json(200, { ok: true, keys: Object.keys(data).length, removed: old.length });
}

// ---------------------------------------------------------------------------------------------------------------
// The handler

export async function handleAccount(req: Request, env: AccountEnv, deps: AccountDeps): Promise<Response> {
  try {
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST') return json(405, { error: 'method', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const params = new URL(req.url).searchParams;
    if (method === 'GET' && params.get('export') !== null) return await onExport(req, env, deps);
    if (method === 'POST') requireCsrf(req);
    const svc = services(env, deps);
    if (method === 'GET') {
      if (!svc) return json(200, { available: false, account: null });
      const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, svc, env, deps };
      const a = await sessionAccount(req, svc.redis, svc.secret, ctx.now());
      // A cookie that no longer opens anything is cleared.
      const clear: Record<string, string> = !a && readCookie(req, 'bridge_account') ? { 'Set-Cookie': clearAccountCookie() } : {};
      return json(200, { available: true, account: a ? await publicAccount(ctx, a) : null }, { 'Cache-Control': 'private, no-store', ...clear });
    }
    if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
    return await onAction(req, { f: deps.fetch, now: deps.now ?? Date.now, svc, env, deps });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
    return fail(502, 'unreachable', GITHUB_DOWN);
  }
}

const envFromProcess = (): AccountEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  INVITE_EMAIL_FROM: process.env.INVITE_EMAIL_FROM,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  ACCOUNT_CODES_MAX_SITE_DAY: process.env.ACCOUNT_CODES_MAX_SITE_DAY,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleAccount(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
