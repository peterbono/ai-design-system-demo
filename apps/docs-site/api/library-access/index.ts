// /api/library-access: who reads a team's Library (/library/<owner>/<repo>/...), and the email sign-in for readers who
// have no GitHub account (docs/HOSTED.md, "Library access").
//
// Two audiences. Contributors (edit, review, admin) sign in with GitHub and are invited from Studio (api/invites).
// Readers, the whole company, need no GitHub account: an admin picks who reads the Library, per team:
//   anyone  "Anyone with the link"       the Library opens for everyone (today's behaviour for a public repository)
//   email   "Anyone with a work email at" + domains: the reader enters their work email on the Library, gets a one-time
//           link by email, and that link opens a signed session for this team's Library (an httpOnly cookie)
//   team    "Only the team"              people with access on GitHub, signed in with GitHub (today's behaviour for a
//           private repository)
// Without a stored setting a team keeps that default: anyone for a public repository, the team for a private one.
//
// Where the setting lives, and why Redis and not bridge.config.json: it is an access rule of this hosting site, read
// on every Library visit by a server that must not spend GitHub API calls for it (a guest on a public Library makes
// none today), and a change must apply at once (it ends every reader session), where a change to bridge.config.json is
// a reviewed pull request that applies once merged. A company's email domain also does not belong in a public
// repository. If the store is lost, every team falls back to the default above, which never opens more than GitHub does.
//
// Private repositories: once the reader's session is checked here, this function reads the team's published snapshot
// (bridge-data branch, the file every Library page reads) with an installation token of the Bridge Direct app, minted
// per request for that one repository and never stored, and serves it. The browser never gets a GitHub token. Public
// repositories are still read from the raw host by the browser, at no GitHub API call, as before.
//
// Endpoints (JSON, errors are { error, message } in reader words):
//   GET  /api/library-access                         { available }
//   GET  /api/library-access?repo=owner/name         { available, setting, session }  no GitHub call
//   GET  /api/library-access?repo=owner/name&file=snapshot|llms   the published file of a private Library, after the
//                                                    access check (cookie)
//   POST { action: 'set', repo, mode, domains }      admins only, checked on GitHub with the caller's own sign-in
//   POST { action: 'sign-in', repo, email }          emails a sign-in link (email mode, domain checked, capped)
//   POST { action: 'verify', repo, token }           spends the link, sets the session cookie
//   POST { action: 'sign-out', repo }                clears it
// POSTs must come from a page of this site.
//
// The sign-in link is <site>/library/<owner>/<repo>/#signin=<token>: 32 random bytes in the fragment, so it reaches no
// server log. Only its SHA-256 is stored, with the team, the email's domain and the setting's version (never the
// email), for 15 minutes; it works once (GETDEL).
//
// The session: one cookie per team, `bridge_library_<hash of the team>`, Path=/api/library-access (only this
// function ever reads it), HttpOnly, Secure, SameSite=Lax, 30 days. Its value is the team, the email's domain, the
// setting's version and the expiry, signed with HMAC-SHA256 under LIBRARY_SESSION_SECRET and compared in constant
// time. Changing the setting bumps its version, which ends every session of that team at once.
//
// Caps (Redis counters that expire on their own): links per email, per network (IP), per team and for the whole site
// per UTC day. Emails and IPs are counted under an HMAC, never in clear. Over a cap: 429 with a sentence and
// Retry-After. Nothing here logs.
//
// Later, not built (extension points): company SSO (Google Workspace, Okta) is another way to prove a work email, so
// it would be one more `verify` source that ends in the same session cookie (issueSession); comments and suggestions
// from email readers would need the session to name the reader, which it does not today (only the domain).
//
// Env (server only):
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)   the setting, links
//   RESEND_API_KEY + INVITE_EMAIL_FROM                                                           the sign-in email
//   LIBRARY_SESSION_SECRET (32 characters or more, random)                                       signs sessions
//   GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY                                                        private Libraries
//   PUBLIC_SITE_URL (optional)                                                                    link origin
//   LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY, _PER_IP_DAY, _PER_TEAM_DAY, _SITE_DAY (optional)            caps, LIMIT_DEFAULTS
// Missing storage, email, the secret or the app: `available` is false, the Library behaves as before (no gate), and
// every action answers 503 "Library access is not available yet on this site."
// Shared pieces (HTTP, Redis, email, the GitHub App, signed cookies) live in api/_lib, which is not a function.

import { createHmac, randomBytes } from 'node:crypto';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { githubApp as sharedGithubApp, type AppTokens } from '../_lib/github-app.js';
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
  readBody as readJsonBody,
  sameOrigin,
  SECURITY_HEADERS,
  secondsToTomorrow,
  sha256,
  siteOrigin as originOf,
  type FetchLike,
} from '../_lib/http.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import { cookieAttrs as attrsFor, readCookie, signClaims, verifyClaims } from '../_lib/session.js';

export { appJwt } from '../_lib/github-app.js';
export { parseRepo, readCookie, resendSender, sameOrigin };
export type { AppTokens, EmailMessage, EmailSender, FetchLike };

// ---------------------------------------------------------------------------------------------------------------
// Types and constants

export type LibraryMode = 'anyone' | 'email' | 'team';
export const MODES: readonly LibraryMode[] = ['anyone', 'email', 'team'];

/** What is stored per team. `private` is what GitHub said when an admin last saved it. */
export interface LibrarySetting {
  mode: LibraryMode;
  domains: string[];
  /** Bumped on every change: sessions signed for another version are refused. */
  version: number;
  private: boolean;
  updatedBy: string;
  updatedAt: string;
}

/** A pending sign-in link, under the SHA-256 of its token. No email: only its domain. */
export interface SignInRecord {
  repo: string;
  domain: string;
  version: number;
}

export interface LibraryEnv {
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
  LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY?: string | undefined;
  LIBRARY_SIGNIN_MAX_PER_IP_DAY?: string | undefined;
  LIBRARY_SIGNIN_MAX_PER_TEAM_DAY?: string | undefined;
  LIBRARY_SIGNIN_MAX_SITE_DAY?: string | undefined;
}

export interface LibraryStore {
  getSetting(repo: string): Promise<LibrarySetting | null>;
  putSetting(repo: string, s: LibrarySetting): Promise<void>;
  /** Saves a sign-in link record for `ttlSeconds`. */
  putSignIn(hash: string, rec: SignInRecord, ttlSeconds: number): Promise<void>;
  /** Reads and deletes in one step: a link works once. */
  takeSignIn(hash: string): Promise<SignInRecord | null>;
  dropSignIn(hash: string): Promise<void>;
  /** Adds `by` to each counter, which expires after `ttlSeconds`; returns the new values. */
  bump(keys: string[], by: number, ttlSeconds: number): Promise<number[]>;
}

export interface LibraryDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  store?: LibraryStore;
  email?: EmailSender;
  app?: AppTokens;
}

/** The sign-in link lives 15 minutes. */
export const SIGNIN_TTL_MS = 15 * 60 * 1000;
/** A session lives 30 days, unless the setting changes first. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_DOMAINS = 10;
/** Vercel answers at most 4.5 MB from a function: a larger snapshot is refused with a sentence. */
export const MAX_SERVED_BYTES = 4_400_000;
export const SNAPSHOT_BRANCH = 'bridge-data';
export const SERVED_FILES = { snapshot: 'snapshot.json', llms: 'llms.txt' } as const;
export type ServedFile = keyof typeof SERVED_FILES;
export const COOKIE_PATH = '/api/library-access';
export const MIN_SECRET_LENGTH = 32;

/**
 * Sign-in emails per UTC day, unless the env says otherwise. The site cap leaves room for invites under the email
 * provider's free daily quota (api/invites INVITES_MAX_SITE_DAY is 80 of 100): raise both with your plan.
 */
export const LIMIT_DEFAULTS = { email: 3, ip: 10, team: 20, site: 20 } as const;
export type LimitKind = keyof typeof LIMIT_DEFAULTS;
const COUNTER_TTL_S = 2 * 24 * 60 * 60;
const MAX_BODY = 4096;
const API = 'https://api.github.com';

/**
 * Consumer email providers: a domain anyone can sign up to, so "Anyone with a work email at gmail.com" would open the
 * Library to everyone. Refused with a sentence; "Anyone with the link" says that honestly.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'hey.com',
  'fastmail.com',
];

// ---------------------------------------------------------------------------------------------------------------
// Words

export const NOT_CONFIGURED = 'Library access is not available yet on this site.';
export const EXPIRED = 'This link expired or was already used. Enter your email to get a new one.';
const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
const APP_MISSING = 'Bridge cannot read this library yet. An admin of the repository gives the Bridge app access to it.';
export const NOT_PUBLISHED = 'This library is not published yet. Its design system team publishes it with the Bridge snapshot workflow.';

/** "This library is open to @acme.design emails. Ask your design system team for access." */
export function wrongDomainWords(domains: readonly string[]): string {
  const list = domains.map((d) => `@${d}`);
  const names = list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
  return `This library is open to ${names} emails. Ask your design system team for access.`;
}

export const LIMIT_WORDS: Record<LimitKind, string> = {
  email: 'Bridge already sent a few links to this email today. Use the latest one, or try again tomorrow.',
  ip: 'Too many sign-in links were asked from this network today. Try again tomorrow.',
  team: 'This library sent all its sign-in links for today. Try again tomorrow.',
  site: 'Bridge sent all its sign-in links for today. Try again tomorrow.',
};

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@([A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+)$/;
const DOMAIN = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------------------------------------------
// Domains

/** A domain as an admin may type it ("@Acme.design ") made plain ("acme.design"), or null when it is not one. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, '');
  return DOMAIN.test(d) ? d : null;
}

/** The domains a setting keeps: normalized, unique, at most MAX_DOMAINS, no consumer provider. Throws a sentence. */
export function parseDomains(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'bad_request', 'Add your company email domain, like acme.design.');
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const d = normalizeDomain(raw);
    if (!d) throw new HttpError(400, 'bad_domain', `${raw.trim().slice(0, 80)} is not an email domain. Write it like acme.design.`);
    if (PUBLIC_EMAIL_DOMAINS.includes(d)) throw new HttpError(400, 'public_domain', `Anyone can get an email at ${d}. Pick your company domain, or choose Anyone with the link.`);
    if (!out.includes(d)) out.push(d);
  }
  if (!out.length) throw new HttpError(400, 'bad_request', 'Add your company email domain, like acme.design.');
  if (out.length > MAX_DOMAINS) throw new HttpError(400, 'bad_request', `Add at most ${MAX_DOMAINS} domains.`);
  return out;
}

/**
 * The domain of `email` when it is one of `domains`, else null. Exact match on the part after the @, case-insensitive:
 * a subdomain (eng.acme.design), a lookalike (acme.design.evil.com) or a second @ never match.
 */
export function emailDomainIn(email: unknown, domains: readonly string[]): string | null {
  if (typeof email !== 'string' || email.length > 254) return null;
  const m = EMAIL.exec(email.trim());
  if (!m) return null;
  const d = m[1]!.toLowerCase();
  return domains.includes(d) ? d : null;
}

export const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());

// ---------------------------------------------------------------------------------------------------------------
// Sessions

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest();

/** One cookie per team: its name carries a hash of the team, never the name itself. */
export const cookieName = (repo: string) => `bridge_library_${sha256(repo.toLowerCase()).slice(0, 16)}`;

export interface SessionClaims {
  /** The team, lower case. */
  r: string;
  /** The email's domain. */
  d: string;
  /** The setting's version it was signed for. */
  v: number;
  /** Expiry (ms). */
  x: number;
}

const PURPOSE = 'library-session';
const isClaims = (c: any) => typeof c.r === 'string' && typeof c.d === 'string' && Number.isInteger(c.v) && typeof c.x === 'number';

/** The signed cookie value: v1.<claims>.<HMAC-SHA256 of "library-session:v1.<claims>">. */
export const signSession = (claims: SessionClaims, secret: string): string => signClaims(claims, secret, PURPOSE);

/** The claims of a cookie value whose signature holds (constant-time compare), else null. Expiry is not checked here. */
export const verifySignature = (value: string, secret: string): SessionClaims | null => verifyClaims<SessionClaims>(value, secret, PURPOSE, isClaims);

/**
 * The reader's session for this team, or null: signed by this site, for this team, not expired, for the current
 * version of an email setting, and its domain still listed. Any change to the setting ends it.
 */
export function readSession(req: Request, repoFull: string, setting: LibrarySetting | null, secret: string, now: number): { domain: string } | null {
  if (!setting || setting.mode !== 'email') return null;
  const raw = readCookie(req, cookieName(repoFull));
  if (!raw) return null;
  const c = verifySignature(raw, secret);
  if (!c) return null;
  if (c.r !== repoFull.toLowerCase() || c.x <= now || c.v !== setting.version || !setting.domains.includes(c.d)) return null;
  return { domain: c.d };
}

const cookieAttrs = attrsFor(COOKIE_PATH);

/** Set-Cookie for a new session of `repo`. Also the one place a future SSO sign-in would end. */
export function issueSession(repoFull: string, domain: string, version: number, secret: string, now: number): string {
  const value = signSession({ r: repoFull.toLowerCase(), d: domain, v: version, x: now + SESSION_TTL_MS }, secret);
  return `${cookieName(repoFull)}=${value}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; ${cookieAttrs}`;
}

export const clearSession = (repoFull: string) => `${cookieName(repoFull)}=; Max-Age=0; ${cookieAttrs}`;

// ---------------------------------------------------------------------------------------------------------------
// Storage: Upstash Redis over REST, or memory in tests
//
// Keys:
//   bridge:library:setting:<repo>             the setting (JSON), kept until changed
//   bridge:library:signin:<sha256 of token>   a sign-in link (JSON), 15 minutes
//   bridge:library:count:<kind>:<who>:<day>   daily caps, 2 days; emails and IPs under an HMAC

const settingKey = (repo: string) => `bridge:library:setting:${repo.toLowerCase()}`;
const signInKey = (hash: string) => `bridge:library:signin:${hash}`;

function parseJson<T>(raw: unknown, ok: (v: any) => boolean): T | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return v && ok(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

const isSetting = (v: any) => (MODES as readonly unknown[]).includes(v.mode) && Array.isArray(v.domains) && Number.isInteger(v.version);
const isSignIn = (v: any) => typeof v.repo === 'string' && typeof v.domain === 'string' && Number.isInteger(v.version);

export function redisStore(url: string, token: string, f: FetchLike): LibraryStore {
  return libraryStoreOn(redisRest(url, token, f, STORAGE_DOWN));
}

/** The Library store on any Redis (Upstash in production, the in-memory one locally). */
export function libraryStoreOn(redis: Redis): LibraryStore {
  const { cmd, pipe } = redis;
  return {
    async getSetting(repo) {
      return parseJson<LibrarySetting>(await cmd('GET', settingKey(repo)), isSetting);
    },
    async putSetting(repo, s) {
      await cmd('SET', settingKey(repo), JSON.stringify(s));
    },
    async putSignIn(hash, rec, ttl) {
      await cmd('SET', signInKey(hash), JSON.stringify(rec), 'EX', Math.max(1, Math.ceil(ttl)));
    },
    async takeSignIn(hash) {
      return parseJson<SignInRecord>(await cmd('GETDEL', signInKey(hash)), isSignIn);
    },
    async dropSignIn(hash) {
      await cmd('DEL', signInKey(hash));
    },
    async bump(keys, by, ttl) {
      if (!keys.length) return [];
      const r = await pipe(keys.flatMap((k) => [['INCRBY', k, by], ['EXPIRE', k, ttl]]));
      return keys.map((_, i) => Number(r[i * 2]) || 0);
    },
  };
}

/** In-memory store (tests). Same contract as the Redis one, TTLs kept by `now`. */
export function memoryStore(now: () => number = Date.now): LibraryStore & { keys(): string[]; raw(): Map<string, string> } {
  const items = new Map<string, { value: string; until: number }>();
  const live = (k: string) => {
    const v = items.get(k);
    if (v && v.until <= now()) items.delete(k);
    return items.get(k)?.value ?? null;
  };
  const set = (k: string, value: string, ttl: number | null) => items.set(k, { value, until: ttl === null ? Infinity : now() + Math.max(1, Math.ceil(ttl)) * 1000 });
  return {
    keys: () => [...items.keys()].filter((k) => live(k) !== null),
    raw: () => new Map([...items.keys()].filter((k) => live(k) !== null).map((k) => [k, live(k)!])),
    async getSetting(repo) {
      return parseJson<LibrarySetting>(live(settingKey(repo)), isSetting);
    },
    async putSetting(repo, s) {
      set(settingKey(repo), JSON.stringify(s), null);
    },
    async putSignIn(hash, rec, ttl) {
      set(signInKey(hash), JSON.stringify(rec), ttl);
    },
    async takeSignIn(hash) {
      const v = live(signInKey(hash));
      items.delete(signInKey(hash));
      return parseJson<SignInRecord>(v, isSignIn);
    },
    async dropSignIn(hash) {
      items.delete(signInKey(hash));
    },
    async bump(keys, by, ttl) {
      return keys.map((k) => {
        const next = Number(live(k) ?? 0) + by;
        set(k, String(next), ttl);
        return next;
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Email: Resend (the invite sender)

/** The sign-in email: which library, the one link, how long it works. */
export function signInEmail(x: { to: string; repo: string; link: string }): EmailMessage {
  const subject = `Your link to the ${x.repo} library`;
  const lines = [
    `Open the ${x.repo} design system library on Bridge:`,
    '',
    x.link,
    '',
    'The link works once and expires in 15 minutes. It keeps you signed in to this library in that browser for 30 days.',
    'If you did not ask for it, you can ignore this email.',
  ];
  const html = [
    `<p>Open the <strong>${escHtml(x.repo)}</strong> design system library on Bridge.</p>`,
    `<p><a href="${escHtml(x.link)}">Open the library</a></p>`,
    '<p>The link works once and expires in 15 minutes. It keeps you signed in to this library in that browser for 30 days.</p>',
    '<p>If you did not ask for it, you can ignore this email.</p>',
  ].join('\n');
  return { to: x.to, subject, text: lines.join('\n'), html };
}

// ---------------------------------------------------------------------------------------------------------------
// GitHub

async function gh(f: FetchLike, token: string, method: string, path: string, opts: { body?: unknown; raw?: boolean } = {}): Promise<{ status: number; data: any; text: string | null }> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, {
      method,
      headers: {
        Accept: opts.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'bridge-library-access',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  if (opts.raw && res.status === 200) return { status: 200, data: null, text: await res.text() };
  let data: any = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  return { status: res.status, data, text: null };
}

/** Installation tokens of the Bridge Direct app, scoped to the one repository and to reading contents, never stored. */
export const githubApp = (appId: string, privateKey: string, f: FetchLike, now: () => number): AppTokens =>
  sharedGithubApp(appId, privateKey, f, now, { permissions: { contents: 'read' }, userAgent: 'bridge-library-access' });

// ---------------------------------------------------------------------------------------------------------------
// Services and caps

interface Services {
  store: LibraryStore;
  email: EmailSender;
  app: AppTokens;
  secret: string;
}

/** Storage, email, the session secret and the app, or null when any is missing (the feature is off). */
export function services(env: LibraryEnv, deps: LibraryDeps): Services | null {
  const now = deps.now ?? Date.now;
  const kvUrl = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const kvToken = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const store = deps.store ?? (kvUrl && kvToken ? redisStore(kvUrl, kvToken, deps.fetch) : null);
  const key = env.RESEND_API_KEY?.trim();
  const from = env.INVITE_EMAIL_FROM?.trim();
  const email = deps.email ?? (key && from ? resendSender(key, from, deps.fetch) : null);
  const appId = env.GITHUB_APP_ID?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const app = deps.app ?? (appId && pem ? githubApp(appId, pem, deps.fetch, now) : null);
  const secret = env.LIBRARY_SESSION_SECRET?.trim() ?? '';
  return store && email && app && secret.length >= MIN_SECRET_LENGTH ? { store, email, app, secret } : null;
}

export function limitsFrom(env: LibraryEnv): Record<LimitKind, number> {
  const pick = envInt;
  return {
    email: pick(env.LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY, LIMIT_DEFAULTS.email),
    ip: pick(env.LIBRARY_SIGNIN_MAX_PER_IP_DAY, LIMIT_DEFAULTS.ip),
    team: pick(env.LIBRARY_SIGNIN_MAX_PER_TEAM_DAY, LIMIT_DEFAULTS.team),
    site: pick(env.LIBRARY_SIGNIN_MAX_SITE_DAY, LIMIT_DEFAULTS.site),
  };
}

interface Ctx {
  f: FetchLike;
  now: () => number;
  random: (n: number) => Uint8Array;
  svc: Services;
  limits: Record<LimitKind, number>;
}

/** Takes one link from each of today's counters, all or nothing; over a cap gives it back and throws 429. */
async function reserve(ctx: Ctx, who: Record<LimitKind, string>): Promise<() => Promise<void>> {
  const now = ctx.now();
  const day = dayOf(now);
  const kinds: LimitKind[] = ['email', 'ip', 'team', 'site'];
  // An HMAC under the session secret: a leaked store does not list who asked, nor from where.
  const keys = kinds.map((k) => `bridge:library:count:${k}:${k === 'email' || k === 'ip' ? hmac(ctx.svc.secret, `${k}:${who[k]}`).toString('hex').slice(0, 32) : who[k]}:${day}`);
  const after = await ctx.svc.store.bump(keys, 1, COUNTER_TTL_S);
  const over = kinds.find((k, i) => after[i]! > ctx.limits[k]);
  if (over) {
    await ctx.svc.store.bump(keys, -1, COUNTER_TTL_S);
    throw new HttpError(429, 'limit', LIMIT_WORDS[over], { limit: over }, { 'Retry-After': String(secondsToTomorrow(now)) });
  }
  return async () => {
    await ctx.svc.store.bump(keys, -1, COUNTER_TTL_S);
  };
}

const siteOrigin = (req: Request, env: LibraryEnv) => originOf(req, env.PUBLIC_SITE_URL);
const readBody = (req: Request) => readJsonBody(req, MAX_BODY);

/** What the browser may know about a team's setting: never who changed it, never the version. */
export function publicSetting(s: LibrarySetting | null) {
  if (!s) return null;
  return { mode: s.mode, domains: s.mode === 'email' ? s.domains : [], source: s.private ? 'bridge' : 'github' };
}

// ---------------------------------------------------------------------------------------------------------------
// The handler

async function onGet(req: Request, env: LibraryEnv, deps: LibraryDeps): Promise<Response> {
  const svc = services(env, deps);
  const params = new URL(req.url).searchParams;
  const repoArg = params.get('repo');
  if (repoArg === null) return json(200, { available: Boolean(svc) });
  const { owner, repo, full } = parseRepo(repoArg);
  if (!svc) {
    if (params.get('file') !== null) return fail(503, 'not_configured', NOT_CONFIGURED);
    return json(200, { available: false, setting: null, session: null });
  }
  const now = (deps.now ?? Date.now)();
  const setting = await svc.store.getSetting(full);
  const session = readSession(req, full, setting, svc.secret, now);
  const fileArg = params.get('file');
  if (fileArg === null) return json(200, { available: true, setting: publicSetting(setting), session });

  // A private Library's published file, after the access check.
  if (!Object.hasOwn(SERVED_FILES, fileArg)) return fail(400, 'bad_request', 'Ask for the snapshot or llms.txt.');
  if (!setting || !setting.private) return fail(404, 'not_served', 'Read this library from GitHub.');
  if (setting.mode === 'team') return fail(403, 'team_only', 'This library is open to its team only. Sign in with GitHub.');
  if (setting.mode === 'email' && !session) return fail(401, 'signin', 'Enter your work email to read this library.');
  const appToken = await svc.app.installationToken(owner, repo);
  if (!appToken) return fail(409, 'app_missing', APP_MISSING);
  const r = await gh(deps.fetch, appToken, 'GET', `/repos/${owner}/${repo}/contents/${SERVED_FILES[fileArg as ServedFile]}?ref=${SNAPSHOT_BRANCH}`, { raw: true });
  if (r.status === 404) return fail(404, 'not_published', NOT_PUBLISHED);
  if (r.status === 401 || r.status === 403) return fail(409, 'app_missing', APP_MISSING);
  if (r.status !== 200 || r.text === null) return fail(502, 'unreachable', GITHUB_DOWN);
  if (r.text.length > MAX_SERVED_BYTES) return fail(413, 'too_large', 'This library is too large to open here yet. Its team can open it in Studio.');
  return new Response(r.text, {
    status: 200,
    headers: {
      'Content-Type': fileArg === 'snapshot' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      ...SECURITY_HEADERS,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

async function onPost(req: Request, env: LibraryEnv, deps: LibraryDeps): Promise<Response> {
  if (!sameOrigin(req)) return fail(403, 'origin', 'Open the library on this site.');
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const svc = services(env, deps);
  if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, limits: limitsFrom(env) };
  const body = await readBody(req);
  const { owner, repo, full } = parseRepo(body.repo);

  switch (body.action) {
    case 'set': {
      // The caller's own sign-in says who they are and whether they administer the repository: GitHub answers both.
      const m = /^Bearer\s+([A-Za-z0-9_.-]{8,512})$/i.exec(req.headers.get('authorization') ?? '');
      if (!m) return fail(401, 'signin', 'Sign in with GitHub to change who reads the library.');
      const me = await gh(ctx.f, m[1]!, 'GET', '/user');
      if (me.status === 401 || me.status === 403) return fail(401, 'signin', 'Your GitHub sign-in expired. Sign in again.');
      if (me.status !== 200 || typeof me.data?.login !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
      const r = await gh(ctx.f, m[1]!, 'GET', `/repos/${owner}/${repo}`);
      if (r.status === 401) return fail(401, 'signin', 'Your GitHub sign-in expired. Sign in again.');
      if (r.status === 403 || r.status === 404) return fail(403, 'forbidden', 'Only admins can change who reads the library.');
      if (r.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
      if (r.data?.permissions?.admin !== true) return fail(403, 'forbidden', 'Only admins can change who reads the library.');
      const mode = body.mode;
      if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) return fail(400, 'bad_request', 'Pick who reads the library.');
      const domains = mode === 'email' ? parseDomains(body.domains) : [];
      const prev = await svc.store.getSetting(full);
      const isPrivate = r.data?.private === true;
      const same = prev && prev.mode === mode && prev.domains.join(',') === domains.join(',');
      const next: LibrarySetting = {
        mode: mode as LibraryMode,
        domains,
        // Any change ends every reader session of this team (their cookie names the old version).
        version: same ? prev.version : (prev?.version ?? 0) + 1,
        private: isPrivate,
        updatedBy: me.data.login as string,
        updatedAt: new Date(ctx.now()).toISOString(),
      };
      await svc.store.putSetting(full, next);
      return json(200, { setting: publicSetting(next) });
    }

    case 'sign-in': {
      const setting = await svc.store.getSetting(full);
      if (!setting || setting.mode !== 'email') return fail(409, 'not_email', 'This library does not open with an email. Ask your design system team how to read it.');
      if (!validEmail(body.email)) return fail(400, 'bad_email', 'Enter your work email, like name@company.com.');
      const email = (body.email as string).trim().toLowerCase();
      const domain = emailDomainIn(email, setting.domains);
      if (!domain) return fail(403, 'domain', wrongDomainWords(setting.domains), { domains: setting.domains });
      const release = await reserve(ctx, { email, ip: clientIp(req), team: full, site: 'all' });
      const token = b64url(Buffer.from(ctx.random(32)));
      const hash = sha256(token);
      await svc.store.putSignIn(hash, { repo: full, domain, version: setting.version }, SIGNIN_TTL_MS / 1000);
      const link = `${siteOrigin(req, env)}/library/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/#signin=${token}`;
      try {
        await svc.email.send(signInEmail({ to: email, repo: `${owner}/${repo}`, link }));
      } catch {
        // Never a link nobody received, and never counted.
        await svc.store.dropSignIn(hash);
        await release();
        throw new HttpError(502, 'email', 'Bridge could not send the email. Try again in a minute.');
      }
      return json(200, { sent: true });
    }

    case 'verify': {
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return fail(410, 'expired', EXPIRED);
      const rec = await svc.store.takeSignIn(sha256(body.token));
      if (!rec || rec.repo !== full) return fail(410, 'expired', EXPIRED);
      // The setting changed since the link was sent (another mode, a domain removed): the link no longer opens it.
      const setting = await svc.store.getSetting(full);
      if (!setting || setting.mode !== 'email' || setting.version !== rec.version || !setting.domains.includes(rec.domain)) return fail(410, 'expired', EXPIRED);
      return json(200, { ok: true, session: { domain: rec.domain } }, { 'Set-Cookie': issueSession(full, rec.domain, setting.version, svc.secret, ctx.now()) });
    }

    case 'sign-out':
      return json(200, { ok: true }, { 'Set-Cookie': clearSession(full) });

    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

export async function handleLibraryAccess(req: Request, env: LibraryEnv, deps: LibraryDeps): Promise<Response> {
  try {
    if (req.method === 'GET') return await onGet(req, env, deps);
    if (req.method === 'POST') return await onPost(req, env, deps);
    return json(405, { error: 'method', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
    return fail(502, 'unreachable', GITHUB_DOWN);
  }
}

const envFromProcess = (): LibraryEnv => ({
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
  LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY: process.env.LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY,
  LIBRARY_SIGNIN_MAX_PER_IP_DAY: process.env.LIBRARY_SIGNIN_MAX_PER_IP_DAY,
  LIBRARY_SIGNIN_MAX_PER_TEAM_DAY: process.env.LIBRARY_SIGNIN_MAX_PER_TEAM_DAY,
  LIBRARY_SIGNIN_MAX_SITE_DAY: process.env.LIBRARY_SIGNIN_MAX_SITE_DAY,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);

/** Vercel Functions entries (Web standard signature). */
export function GET(request: Request): Promise<Response> {
  return handleLibraryAccess(request, envFromProcess(), { fetch: realFetch });
}

export function POST(request: Request): Promise<Response> {
  return handleLibraryAccess(request, envFromProcess(), { fetch: realFetch });
}
