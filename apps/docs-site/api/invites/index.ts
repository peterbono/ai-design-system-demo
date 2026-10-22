// /api/invites: invite people to a team's Bridge by work email, and manage who has access (docs/HOSTED.md, "Invites by email").
//
// The flow: an admin picks emails and a role in Studio; this function stores a pending invite (server side, never in
// the browser) and emails a one-time link; the invitee opens it, signs in with GitHub, and this function gives their
// GitHub account access to the repository with the role's permission. It also changes roles, removes people and
// resends or cancels invites. Shared pieces (HTTP, Redis, email, the GitHub App) live in api/_lib, not a function.
//
// Roles, as designers read them, and what each one is on GitHub (keep the Studio words in lib/invites.ts in step):
//   view      "Can view"   GitHub `pull`  (read). No longer offered (CHOOSABLE_ROLES): readers use Library access.
//   edit      "Can edit"   GitHub `push`  (write)
//   reviewer  "Reviewer"   GitHub `push`, and the login is listed in bridge.config.json `governance.owners.design`
//                          (reviews as Designer) or `governance.owners.tech` (reviews as Developer)
//   admin     "Admin"      GitHub `admin`
// Owners live in bridge.config.json, a guardrail file: they change through a pull request on it (the same file and
// keys Studio Settings edits), opened by the Bridge app, never a commit straight to the default branch. The reviewer
// role takes effect once that pull request is merged.
// A repository owned by a personal account has no per-person permissions on GitHub: every collaborator can push and
// only the owner is admin. GitHub ignores the permission there; GET says `personal: true` so Studio can say it.
//
// Who acts on GitHub, and why: changing collaborators needs the Administration permission. The invitee accepts when
// the admin is gone, so the admin's own token cannot do it, and storing an admin's token for later would keep a
// powerful personal credential on a server: refused. The function instead uses the Bridge Direct GitHub App's
// installation token (the app already asks for Administration read and write, docs/SIGN-IN.md), minted per request
// for that one repository and never stored. The caller is always identified with their own GitHub token
// (GET /user) and their role on the repository is read again from GitHub with the installation token on every call:
// nothing the browser says about who it is or what it may do is trusted.
//
// Endpoints (JSON, errors are { error, message } in Studio words):
//   GET  /api/invites                       { available }  storage, email and the app are all configured
//   GET  /api/invites?repo=owner/name       { invites, personal, members }  caller can push; `members` are the email
//                                           contributors ({ via: 'email', name, email, role }), the GitHub ones are
//                                           read from GitHub by Studio
//   POST /api/invites { action: 'invite' | 'resend' | 'invite-role' | 'cancel' | 'set-role' | 'remove' }  caller is admin
//                                           set-role and remove take `email` instead of `login` for an email
//                                           contributor; set-role to reviewer or admin answers 409 github-required
//   POST /api/invites { action: 'accept', token }  caller is the invitee, any GitHub account
//   POST /api/invites { action: 'peek', token }    no sign-in: { team, repo, role, sentTo (masked) }, 410 when expired
// A "Can edit" invite can also be accepted with the email alone, no GitHub account: api/contribute (action accept).
// Requests carry `Authorization: Bearer <GitHub user token>` (Studio's Sign in with GitHub). POSTs must come from a
// page of this site.
//
// The invite link is <site>/studio/invite/#t=<token>: 32 random bytes, in the fragment so it never reaches a server
// log. Only its SHA-256 is stored. It works once and expires after 7 days; Resend makes a new one.
//
// Only the invited person can accept: the GitHub account that opens the link must have the invited email as a
// verified email (GET /user/emails with their own sign-in, so the Bridge apps need the account permission "Email
// addresses: Read-only", docs/SIGN-IN.md). Otherwise nothing is granted, the invite stays valid, and the answer says
// which address it was sent to, masked ("m•••@acme.design").
//
// Caps (Redis counters that expire on their own): emails sent per admin, per team and for the whole site per UTC day,
// a pause between two sends of one invite and a few resends per invite per day, at most MAX_PEOPLE per request. A cap
// answers 429 with a sentence that says it and when to try again (Retry-After), never a silent drop.
//
// What is kept: per pending invite only its email, role, team, who invited, created, sent and expiry dates and the
// link token's hash, each record expiring in Redis with the invite. Accept and cancel delete it. Nothing here logs.
//
// Env (server only):
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)   pending invites
//   RESEND_API_KEY + INVITE_EMAIL_FROM                                                           the invite email
//   GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY                                                        Bridge Direct app
//   PUBLIC_SITE_URL (optional)                                                                    link origin
//   INVITES_MAX_PER_ADMIN_DAY, INVITES_MAX_PER_TEAM_DAY, INVITES_MAX_SITE_DAY (optional)          caps, see LIMIT_DEFAULTS
// Missing any of the first three groups: every action answers 503 "Invites are not available yet on this site."

import { randomBytes } from 'node:crypto';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { githubApp as sharedGithubApp, type AppTokens } from '../_lib/github-app.js';
import { b64url, clientIp, dayOf, envInt, fail, GITHUB_DOWN, HttpError, json, parseRepo, readBody as readJsonBody, sameOrigin, secondsToTomorrow, sha256, siteOrigin as originOf, type FetchLike } from '../_lib/http.js';
import { memberStore, type EmailMember, type MemberStore } from '../_lib/members.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import { teamDisplayName } from '../../src/lib/demo.js';

export { appJwt } from '../_lib/github-app.js';
export { resendSender, sameOrigin };
export type { AppTokens, EmailMember, EmailMessage, EmailSender, FetchLike, MemberStore };

// ---------------------------------------------------------------------------------------------------------------
// Types and constants

export type Role = 'view' | 'edit' | 'reviewer' | 'admin';
export type ReviewAs = 'design' | 'tech';
export type GitHubPermission = 'pull' | 'push' | 'admin';

export const ROLES: readonly Role[] = ['view', 'edit', 'reviewer', 'admin'];

/**
 * The roles an admin picks in Studio: contributors only. Readers need no GitHub account (Settings, Library access,
 * api/library-access), so "Can view" is no longer offered; a pending invite or a member that already has it keeps it.
 */
export const CHOOSABLE_ROLES: readonly Role[] = ['edit', 'reviewer', 'admin'];

/** The GitHub permission of each role. Reviewer is `push` plus an owners entry in bridge.config.json. */
export const ROLE_PERMISSION: Record<Role, GitHubPermission> = { view: 'pull', edit: 'push', reviewer: 'push', admin: 'admin' };

/** The role in the words of the email (the same words as the Studio role picker). */
export const ROLE_WORDS: Record<Role, { label: string; text: string }> = {
  view: { label: 'Can view', text: 'Sees everything, comments and suggests.' },
  edit: { label: 'Can edit', text: 'Also explores and changes the library.' },
  reviewer: { label: 'Reviewer', text: 'Also approves changes before they ship.' },
  admin: { label: 'Admin', text: 'Also invites people and changes settings.' },
};

export const REVIEW_AS_WORDS: Record<ReviewAs, string> = { design: 'design', tech: 'tech' };

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PEOPLE = 10;

/**
 * Emails sent per UTC day (invites and resends), unless the env says otherwise. The site cap stays below the email
 * provider's free daily quota with room to spare; per admin and per team keep one account or one team from using it
 * all. Change them with INVITES_MAX_PER_ADMIN_DAY, INVITES_MAX_PER_TEAM_DAY and INVITES_MAX_SITE_DAY (whole numbers).
 */
export const LIMIT_DEFAULTS = { admin: 20, team: 40, site: 80 } as const;
/** The pause between two sends of the same invite. */
export const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
/** Resends of one invite per UTC day. */
export const MAX_RESENDS_PER_INVITE_DAY = 3;
/** Counters live two days: the key carries the day, so a new day starts at zero. */
const COUNTER_TTL_S = 2 * 24 * 60 * 60;
export const MAX_PENDING = 50;
const MAX_BODY = 8192;
const CONFIG_FILE = 'bridge.config.json';
/** The invite page: one address for every team, the token in the fragment. */
export const INVITE_PATH = '/studio/invite/';
const BRANCH_PREFIX = 'bridge/';
const API = 'https://api.github.com';

/** What is stored per pending invite. `tokenHash` never leaves the server. */
export interface StoredInvite {
  id: string;
  repo: string;
  email: string;
  role: Role;
  reviewAs?: ReviewAs;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  sentAt: string;
  tokenHash: string;
}

/** What GET returns per invite. */
export type PendingInvite = Omit<StoredInvite, 'repo' | 'tokenHash'>;

export interface InvitesEnv {
  KV_REST_API_URL?: string | undefined;
  KV_REST_API_TOKEN?: string | undefined;
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  INVITE_EMAIL_FROM?: string | undefined;
  GITHUB_APP_ID?: string | undefined;
  GITHUB_APP_PRIVATE_KEY?: string | undefined;
  PUBLIC_SITE_URL?: string | undefined;
  INVITES_MAX_PER_ADMIN_DAY?: string | undefined;
  INVITES_MAX_PER_TEAM_DAY?: string | undefined;
  INVITES_MAX_SITE_DAY?: string | undefined;
}

/** Pending invites, per repository. Every record disappears on its own once its TTL (the invite's expiry) is over. */
export interface InviteStore {
  list(repo: string): Promise<StoredInvite[]>;
  get(repo: string, id: string): Promise<StoredInvite | null>;
  /** Saves the invite and indexes it by its token hash, both expiring after `ttlSeconds`. */
  put(inv: StoredInvite, ttlSeconds: number): Promise<void>;
  /** Deletes the invite and its token index. */
  remove(inv: StoredInvite): Promise<void>;
  byTokenHash(hash: string): Promise<StoredInvite | null>;
  /** Adds `by` (negative gives back) to each counter, which expires after `ttlSeconds`; returns the new values. */
  bump(keys: string[], by: number, ttlSeconds: number): Promise<number[]>;
}

export interface InvitesDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  /** Injected services (tests); otherwise built from the env. */
  store?: InviteStore;
  email?: EmailSender;
  app?: AppTokens;
  /** Email contributors (api/contribute); built from the same Redis as the invites otherwise. */
  members?: MemberStore;
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers

export const NOT_CONFIGURED = 'Invites are not available yet on this site.';
const APP_MISSING = 'Bridge cannot add people to this design system yet. An admin of the repository gives Bridge access to members.';
export const EXPIRED = 'This invitation expired or was already used. Ask your admin to send a new one.';

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[a-f0-9]{16}$/;

export const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());

function parseRole(role: unknown, reviewAs: unknown): { role: Role; reviewAs?: ReviewAs } {
  if (typeof role !== 'string' || !(CHOOSABLE_ROLES as readonly string[]).includes(role)) throw new HttpError(400, 'bad_request', 'Pick a role: Can edit, Reviewer or Admin.');
  if (role === 'reviewer') {
    if (reviewAs !== 'design' && reviewAs !== 'tech') throw new HttpError(400, 'bad_request', 'Pick how they review: Designer or Developer.');
    return { role, reviewAs };
  }
  return { role: role as Role };
}

function parseLogin(v: unknown): string {
  if (typeof v !== 'string' || !LOGIN.test(v.trim().replace(/^@/, ''))) throw new HttpError(400, 'bad_request', 'Say who, by their GitHub account.');
  return v.trim().replace(/^@/, '');
}

const norm = (x: string) => x.trim().replace(/^@/, '').toLowerCase();

// ---------------------------------------------------------------------------------------------------------------
// GitHub

interface GhResult {
  status: number;
  data: any;
}

async function gh(f: FetchLike, token: string, method: string, path: string, body?: unknown): Promise<GhResult> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'bridge-studio-invites',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let data: any = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  return { status: res.status, data };
}

/**
 * Installation tokens of the Bridge Direct app, scoped to the one repository, never stored. Without Administration
 * write the app cannot add or remove anyone: null, so the answer says so instead of failing later.
 */
export const githubApp = (appId: string, privateKey: string, f: FetchLike, now: () => number): AppTokens =>
  sharedGithubApp(appId, privateKey, f, now, { require: { administration: 'write' }, userAgent: 'bridge-studio-invites' });

// ---------------------------------------------------------------------------------------------------------------
// Storage: Upstash Redis over REST (Vercel Marketplace), or memory in tests
//
// Keys, each with a TTL so nothing outlives its invite:
//   bridge:invite:<repo>:<id>        the invite (JSON), expires with the invite
//   bridge:invite-token:<hash>       "<repo>|<id>", expires with the invite
//   bridge:invites:<repo>            sorted set of invite ids by expiry (ids only), expires 7 days after the last put
//   bridge:invites:count:<...>:<day> daily counters for the caps, expire after 2 days

const inviteKey = (repo: string, id: string) => `bridge:invite:${repo.toLowerCase()}:${id}`;
const repoKey = (repo: string) => `bridge:invites:${repo.toLowerCase()}`;
const tokenKey = (hash: string) => `bridge:invite-token:${hash}`;

function parseStored(raw: unknown): StoredInvite | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw) as StoredInvite;
    return v && typeof v.id === 'string' && typeof v.tokenHash === 'string' ? v : null;
  } catch {
    return null;
  }
}

const STORAGE_DOWN = 'Bridge could not reach its invite storage. Try again in a minute.';

export function redisStore(url: string, token: string, f: FetchLike, now: () => number = Date.now): InviteStore {
  return inviteStoreOn(redisRest(url, token, f, STORAGE_DOWN), now);
}

/** The invite store on a Redis connection (also the one api/contribute reads invites with). */
export function inviteStoreOn(redis: Redis, now: () => number = Date.now): InviteStore {
  const { cmd, pipe } = redis;
  const store: InviteStore = {
    async list(repo) {
      const [, ids] = await pipe([
        ['ZREMRANGEBYSCORE', repoKey(repo), '-inf', now()],
        ['ZRANGE', repoKey(repo), 0, -1],
      ]);
      const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
      if (!list.length) return [];
      const raw = (await cmd('MGET', ...list.map((id) => inviteKey(repo, id)))) as unknown[] | null;
      const out: StoredInvite[] = [];
      const gone: string[] = [];
      list.forEach((id, i) => {
        const inv = parseStored(raw?.[i]);
        if (inv) out.push(inv);
        else gone.push(id);
      });
      if (gone.length) await cmd('ZREM', repoKey(repo), ...gone);
      return out;
    },
    async get(repo, id) {
      return parseStored(await cmd('GET', inviteKey(repo, id)));
    },
    async put(inv, ttl) {
      const ex = Math.max(1, Math.ceil(ttl));
      await pipe([
        ['SET', inviteKey(inv.repo, inv.id), JSON.stringify(inv), 'EX', ex],
        ['SET', tokenKey(inv.tokenHash), `${inv.repo}|${inv.id}`, 'EX', ex],
        ['ZADD', repoKey(inv.repo), now() + ex * 1000, inv.id],
        ['EXPIRE', repoKey(inv.repo), Math.ceil(INVITE_TTL_MS / 1000)],
      ]);
    },
    async remove(inv) {
      await pipe([
        ['DEL', inviteKey(inv.repo, inv.id)],
        ['DEL', tokenKey(inv.tokenHash)],
        ['ZREM', repoKey(inv.repo), inv.id],
      ]);
    },
    async byTokenHash(hash) {
      const ref = await cmd('GET', tokenKey(hash));
      if (typeof ref !== 'string') return null;
      const [repo = '', id = ''] = ref.split('|');
      const inv = await store.get(repo, id);
      return inv && inv.tokenHash === hash ? inv : null;
    },
    async bump(keys, by, ttl) {
      if (!keys.length) return [];
      const r = await pipe(keys.flatMap((k) => [['INCRBY', k, by], ['EXPIRE', k, ttl]]));
      return keys.map((_, i) => Number(r[i * 2]) || 0);
    },
  };
  return store;
}

/** In-memory store (tests, local experiments). Same contract as the Redis one, every TTL kept by `now`. */
export function memoryStore(now: () => number = Date.now): InviteStore & { keys(): string[] } {
  const items = new Map<string, { value: string; until: number }>();
  const live = (k: string) => {
    const v = items.get(k);
    if (v && v.until <= now()) items.delete(k);
    return items.get(k)?.value ?? null;
  };
  const set = (k: string, value: string, ttl: number) => items.set(k, { value, until: now() + Math.max(1, Math.ceil(ttl)) * 1000 });
  const store: InviteStore & { keys(): string[] } = {
    /** Every key still alive (tests: nothing outlives its invite). */
    keys() {
      return [...items.keys()].filter((k) => live(k) !== null);
    },
    async list(repo) {
      const prefix = inviteKey(repo, '');
      const out: StoredInvite[] = [];
      for (const k of [...items.keys()]) if (k.startsWith(prefix)) {
        const inv = parseStored(live(k));
        if (inv) out.push(inv);
      }
      return out;
    },
    async get(repo, id) {
      return parseStored(live(inviteKey(repo, id)));
    },
    async put(inv, ttl) {
      set(inviteKey(inv.repo, inv.id), JSON.stringify(inv), ttl);
      set(tokenKey(inv.tokenHash), `${inv.repo}|${inv.id}`, ttl);
    },
    async remove(inv) {
      items.delete(inviteKey(inv.repo, inv.id));
      items.delete(tokenKey(inv.tokenHash));
    },
    async byTokenHash(hash) {
      const ref = live(tokenKey(hash));
      if (!ref) return null;
      const [repo = '', id = ''] = ref.split('|');
      const inv = await store.get(repo, id);
      return inv && inv.tokenHash === hash ? inv : null;
    },
    async bump(keys, by, ttl) {
      return keys.map((k) => {
        const next = Number(live(k) ?? 0) + by;
        set(k, String(next), ttl);
        return next;
      });
    },
  };
  return store;
}

// ---------------------------------------------------------------------------------------------------------------
// Email: Resend

/** The invite email: who invited, the role in words, the one link. */
export function inviteEmail(x: { to: string; inviter: string; repo: string; role: Role; reviewAs?: ReviewAs; link: string }): EmailMessage {
  const w = ROLE_WORDS[x.role];
  const roleLabel = x.role === 'reviewer' && x.reviewAs ? `${w.label}: ${REVIEW_AS_WORDS[x.reviewAs]}` : w.label;
  const team = teamDisplayName(x.repo);
  const subject = `${x.inviter} invited you to ${team} on Bridge`;
  // "Can edit" joins with the email alone (api/contribute); reviewers and admins approve on GitHub.
  const how = x.role === 'edit' ? 'You join with this email, no GitHub account needed.' : 'You sign in with GitHub.';
  const lines = [
    `${x.inviter} invited you to the ${team} design system on Bridge.`,
    '',
    `Your role: ${roleLabel}. ${w.text}`,
    '',
    `Join the team: ${x.link}`,
    '',
    `${how} The link works once and expires in 7 days.`,
    "If you did not expect this email, you can ignore it.",
  ];
  const html = [
    `<p>${escHtml(x.inviter)} invited you to the <strong>${escHtml(team)}</strong> design system on Bridge.</p>`,
    `<p>Your role: <strong>${escHtml(roleLabel)}</strong>. ${escHtml(w.text)}</p>`,
    `<p><a href="${escHtml(x.link)}">Join the team</a></p>`,
    `<p>${how} The link works once and expires in 7 days.</p>`,
    '<p>If you did not expect this email, you can ignore it.</p>',
  ].join('\n');
  return { to: x.to, subject, text: lines.join('\n'), html };
}

// ---------------------------------------------------------------------------------------------------------------
// Owners in bridge.config.json: a format-preserving edit of `governance.owners`

/** Index just past the value starting at `i` (object, array or string), skipping strings. -1 when unbalanced. */
function valueEnd(text: string, i: number): number {
  const open = text[i];
  if (open === '"') {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === '"') return j + 1;
    }
    return -1;
  }
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return -1;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '"') {
      const e = valueEnd(text, j);
      if (e < 0) return -1;
      j = e - 1;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** The span of the value of `"key"` inside text[from, to), at the first match. */
function keySpan(text: string, key: string, from: number, to: number): { start: number; end: number } | null {
  const re = new RegExp(`"${key}"\\s*:\\s*`, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m || m.index >= to) return null;
  const start = m.index + m[0].length;
  const end = valueEnd(text, start);
  return end < 0 || end > to ? null : { start, end };
}

/** The array text for `items`, in the style of the one it replaces (one line, or one item per line). */
function arrayText(old: string, items: string[], text: string, at: number): string {
  if (!old.includes('\n') || !items.length) return `[${items.map((x) => JSON.stringify(x)).join(', ')}]`;
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const baseIndent = /^\s*/.exec(text.slice(lineStart))![0];
  const itemIndent = /\n(\s*)\S/.exec(old)?.[1] ?? `${baseIndent}  `;
  return `[\n${items.map((x) => `${itemIndent}${JSON.stringify(x)}`).join(',\n')}\n${baseIndent}]`;
}

export interface OwnerChange {
  /** Owner groups the login must be in (true), out of (false), or left as they are (absent). */
  design?: boolean;
  tech?: boolean;
}

/**
 * bridge.config.json with `login` added to or removed from `governance.owners.design|tech`. Only the changed arrays
 * are rewritten, so the pull request shows one line; if the file does not have that shape, it is parsed and written
 * back with 2-space JSON. Returns the text unchanged when nothing changes.
 */
export function editOwners(text: string, login: string, change: OwnerChange): string {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new HttpError(409, 'config', 'The settings file of this design system does not parse. Fix bridge.config.json first.');
  }
  const owners = doc?.governance?.owners ?? {};
  const want = (g: 'design' | 'tech'): string[] | null => {
    const v = change[g];
    if (v === undefined) return null;
    const cur: string[] = Array.isArray(owners[g]) ? owners[g].filter((x: unknown): x is string => typeof x === 'string') : [];
    const has = cur.some((x) => norm(x) === norm(login));
    if (v && !has) return [...cur, login];
    if (!v && has) return cur.filter((x) => norm(x) !== norm(login));
    return null;
  };
  const next = { design: want('design'), tech: want('tech') };
  if (!next.design && !next.tech) return text;

  const gov = keySpan(text, 'governance', 0, text.length);
  const own = gov && text[gov.start] === '{' ? keySpan(text, 'owners', gov.start + 1, gov.end) : null;
  if (own && text[own.start] === '{') {
    let out = text;
    // Replace later spans first so earlier offsets stay valid.
    const spans = (['design', 'tech'] as const)
      .filter((g) => next[g])
      .map((g) => ({ g, span: keySpan(text, g, own.start + 1, own.end) }))
      .sort((a, b) => (b.span?.start ?? 0) - (a.span?.start ?? 0));
    if (spans.every((s) => s.span && text[s.span.start] === '[')) {
      for (const { g, span } of spans) out = out.slice(0, span!.start) + arrayText(text.slice(span!.start, span!.end), next[g]!, text, span!.start) + out.slice(span!.end);
      return out;
    }
  }
  doc.governance ??= {};
  doc.governance.owners ??= {};
  for (const g of ['design', 'tech'] as const) if (next[g]) doc.governance.owners[g] = next[g];
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** The owner groups a login is in, from the file. */
function ownerGroupsOf(text: string, login: string): { design: boolean; tech: boolean } {
  try {
    const o = JSON.parse(text)?.governance?.owners ?? {};
    const has = (g: string) => Array.isArray(o[g]) && o[g].some((x: unknown) => typeof x === 'string' && norm(x) === norm(login));
    return { design: has('design'), tech: has('tech') };
  } catch {
    return { design: false, tech: false };
  }
}

function ownersTitle(login: string, change: OwnerChange): string {
  const add = (['design', 'tech'] as const).filter((g) => change[g] === true);
  if (add.length) return `Settings: make @${login} a ${add.join(' and ')} reviewer`;
  return `Settings: @${login} no longer reviews`;
}

/**
 * Opens a pull request on bridge.config.json that changes the owner lists, with the installation token. Null when
 * the repository has no config or nothing changes.
 */
async function ownersPullRequest(f: FetchLike, token: string, o: { owner: string; repo: string; defaultBranch: string }, login: string, change: OwnerChange, random: (n: number) => Uint8Array): Promise<{ number: number; url: string } | null> {
  const p = `/repos/${o.owner}/${o.repo}`;
  const file = await gh(f, token, 'GET', `${p}/contents/${CONFIG_FILE}?ref=${encodeURIComponent(o.defaultBranch)}`);
  if (file.status === 404) return null;
  if (file.status !== 200 || typeof file.data?.content !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const text = Buffer.from(file.data.content, 'base64').toString('utf8');
  const next = editOwners(text, login, change);
  if (next === text) return null;
  const head = await gh(f, token, 'GET', `${p}/git/ref/heads/${encodeURIComponent(o.defaultBranch)}`);
  if (head.status !== 200 || typeof head.data?.object?.sha !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const branch = `${BRANCH_PREFIX}members-${login.toLowerCase()}-${Buffer.from(random(3)).toString('hex')}`;
  const ref = await gh(f, token, 'POST', `${p}/git/refs`, { ref: `refs/heads/${branch}`, sha: head.data.object.sha });
  if (ref.status !== 201) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const title = ownersTitle(login, change);
  const put = await gh(f, token, 'PUT', `${p}/contents/${CONFIG_FILE}`, { message: title, content: Buffer.from(next, 'utf8').toString('base64'), sha: file.data.sha, branch });
  if (put.status !== 200 && put.status !== 201) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const pr = await gh(f, token, 'POST', `${p}/pulls`, {
    title,
    head: branch,
    base: o.defaultBranch,
    body: 'Changed from Members in Bridge. Reviewers are listed as design or tech owners in bridge.config.json; the change applies once this is merged.',
  });
  if (pr.status !== 201 || typeof pr.data?.number !== 'number') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { number: pr.data.number, url: String(pr.data.html_url ?? '') };
}

// ---------------------------------------------------------------------------------------------------------------
// The handler

interface Services {
  store: InviteStore;
  email: EmailSender;
  app: AppTokens;
  /** Email contributors; null only when a test injects an invite store without one. */
  members: MemberStore | null;
}

/** The services from the env (and injected ones), or null when any of storage, email or the app is missing. */
export function services(env: InvitesEnv, deps: InvitesDeps): Services | null {
  const now = deps.now ?? Date.now;
  const kvUrl = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const kvToken = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const redis = kvUrl && kvToken ? redisRest(kvUrl, kvToken, deps.fetch, STORAGE_DOWN) : null;
  const store = deps.store ?? (redis ? inviteStoreOn(redis, now) : null);
  const members = deps.members ?? (redis ? memberStore(redis) : null);
  const key = env.RESEND_API_KEY?.trim();
  const from = env.INVITE_EMAIL_FROM?.trim();
  const email = deps.email ?? (key && from ? resendSender(key, from, deps.fetch) : null);
  const appId = env.GITHUB_APP_ID?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  const app = deps.app ?? (appId && pem ? githubApp(appId, pem, deps.fetch, now) : null);
  return store && email && app ? { store, email, app, members } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Caps

export type LimitKind = 'admin' | 'team' | 'site';

/** Looks at invite links (peek) one network may make in an hour: enough for a person, not for guessing. */
export const PEEK_PER_HOUR = 30;
const hourOf = (t: number) => new Date(t).toISOString().slice(0, 13);

/** The daily caps: LIMIT_DEFAULTS, or a whole number from the env (0 stops sending). */
export function limitsFrom(env: InvitesEnv): Record<LimitKind, number> {
  const pick = envInt;
  return {
    admin: pick(env.INVITES_MAX_PER_ADMIN_DAY, LIMIT_DEFAULTS.admin),
    team: pick(env.INVITES_MAX_PER_TEAM_DAY, LIMIT_DEFAULTS.team),
    site: pick(env.INVITES_MAX_SITE_DAY, LIMIT_DEFAULTS.site),
  };
}

export const LIMIT_WORDS: Record<LimitKind | 'resend' | 'resend_soon', string> = {
  admin: "You reached today's invite limit. Try again tomorrow.",
  team: "This team reached today's invite limit. Try again tomorrow.",
  site: "Bridge reached today's invite limit for everyone. Try again tomorrow.",
  resend: `This invite was sent again ${MAX_RESENDS_PER_INVITE_DAY} times today. Try again tomorrow.`,
  resend_soon: 'This invite was just sent. Wait a few minutes, then send it again.',
};

/** "You can send 3 more invites today." when a batch is larger than what is left. */
export const limitLeftWords = (kind: LimitKind, left: number) => {
  const n = `${left} more ${left === 1 ? 'invite' : 'invites'}`;
  const who = kind === 'admin' ? 'You can send' : kind === 'team' ? 'This team can send' : 'Bridge can send';
  return `${who} ${n} today. Remove some people, or try again tomorrow.`;
};

const countKey = (kind: string, who: string, day: string) => `bridge:invites:count:${kind}:${who.toLowerCase()}:${day}`;

function limitError(kind: LimitKind | 'resend' | 'resend_soon', message: string, retryAfter: number): HttpError {
  return new HttpError(429, 'limit', message, { limit: kind }, { 'Retry-After': String(retryAfter) });
}

/**
 * Takes `n` emails from the admin's, the team's and the site's counters of today, all or nothing. Over a cap: gives
 * them back and throws 429. Returns `release(k)` to give back the ones not sent.
 */
async function reserve(ctx: Ctx, admin: string, repo: string, n: number): Promise<(k: number) => Promise<void>> {
  if (n <= 0) return async () => {};
  const now = ctx.now();
  const day = dayOf(now);
  const kinds: LimitKind[] = ['admin', 'team', 'site'];
  const keys = [countKey('admin', admin, day), countKey('team', repo, day), countKey('site', 'all', day)];
  const after = await ctx.svc.store.bump(keys, n, COUNTER_TTL_S);
  // The cap with the least room left decides the words.
  let worst: { kind: LimitKind; left: number } | undefined;
  for (const [i, kind] of kinds.entries()) {
    const left = Math.max(0, ctx.limits[kind] - (after[i]! - n));
    if (left < n && (!worst || left < worst.left)) worst = { kind, left };
  }
  if (worst) {
    await ctx.svc.store.bump(keys, -n, COUNTER_TTL_S);
    throw limitError(worst.kind, worst.left > 0 ? limitLeftWords(worst.kind, worst.left) : LIMIT_WORDS[worst.kind], secondsToTomorrow(now));
  }
  return async (k) => {
    if (k > 0) await ctx.svc.store.bump(keys, -k, COUNTER_TTL_S);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The invitee's email, checked on GitHub

/** "m•••@acme.design": enough to recognise the address, not enough to read it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().split('@');
  return `${local.slice(0, 1)}\u2022\u2022\u2022@${domain}`;
}

export const EMAIL_ACCESS = 'Bridge needs to see the emails on your GitHub account to check this invitation is yours. Sign in with GitHub again and allow it.';

/** Whether the invited email is on the caller's GitHub account, verified, read with their own sign-in. */
async function emailStatus(f: FetchLike, userToken: string, email: string): Promise<'verified' | 'unverified' | 'missing'> {
  const r = await gh(f, userToken, 'GET', '/user/emails?per_page=100');
  if (r.status === 401) throw new HttpError(401, 'signin', 'Your GitHub sign-in expired. Sign in again.');
  // A sign-in from before Bridge asked for email addresses, or a pasted token without user:email.
  if (r.status === 403 || r.status === 404) throw new HttpError(403, 'email_access', EMAIL_ACCESS);
  if (r.status !== 200 || !Array.isArray(r.data)) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const want = email.trim().toLowerCase();
  const found = (r.data as { email?: unknown; verified?: unknown }[]).filter((e) => typeof e?.email === 'string' && e.email.trim().toLowerCase() === want);
  if (!found.length) return 'missing';
  return found.some((e) => e.verified === true) ? 'verified' : 'unverified';
}
const publicInvite = ({ repo: _r, tokenHash: _t, ...rest }: StoredInvite): PendingInvite => rest;

/** An email contributor as Members lists them, next to the GitHub collaborators. */
export interface PublicEmailMember {
  via: 'email';
  name: string;
  email: string;
  role: 'edit';
  addedBy: string;
  at: string;
}

const publicMember = (m: EmailMember): PublicEmailMember => ({ via: 'email', name: m.name, email: m.email, role: m.role, addedBy: m.addedBy, at: m.at });

export const GITHUB_REQUIRED = 'Reviewers and admins approve and merge on GitHub. Invite them again with this role: they join with GitHub.';

/** The email contributor an admin acts on (`email` instead of `login`), or 404. */
async function emailMemberOf(ctx: Ctx, repo: string, raw: unknown): Promise<string> {
  if (!validEmail(raw)) throw new HttpError(400, 'bad_request', 'Say who, by their email.');
  const email = raw.trim().toLowerCase();
  if (!ctx.svc.members || !(await ctx.svc.members.get(repo, email))) throw new HttpError(404, 'not_found', 'This person is not on this team.');
  return email;
}

function bearer(req: Request): string {
  const m = /^Bearer\s+([A-Za-z0-9_.-]{8,512})$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) throw new HttpError(401, 'signin', 'Sign in with GitHub to manage who has access.');
  return m[1]!;
}

/** Who is calling, from their own GitHub token. */
async function caller(f: FetchLike, token: string): Promise<{ login: string; name: string }> {
  const r = await gh(f, token, 'GET', '/user');
  if (r.status === 401 || r.status === 403) throw new HttpError(401, 'signin', 'Your GitHub sign-in expired. Sign in again.');
  if (r.status !== 200 || typeof r.data?.login !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { login: r.data.login, name: typeof r.data.name === 'string' && r.data.name.trim() ? r.data.name.trim() : r.data.login };
}

/** The caller's permission on the repository, read by the app ("admin", "write", "read", "none"). */
async function permissionOf(f: FetchLike, appToken: string, owner: string, repo: string, login: string): Promise<string> {
  const r = await gh(f, appToken, 'GET', `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(login)}/permission`);
  if (r.status === 404) return 'none';
  if (r.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return typeof r.data?.permission === 'string' ? r.data.permission : 'none';
}

interface RepoFacts {
  owner: string;
  repo: string;
  full: string;
  ownerLogin: string;
  personal: boolean;
  defaultBranch: string;
}

async function repoFacts(f: FetchLike, appToken: string, owner: string, repo: string, full: string): Promise<RepoFacts> {
  const r = await gh(f, appToken, 'GET', `/repos/${owner}/${repo}`);
  if (r.status === 404) throw new HttpError(409, 'app_missing', APP_MISSING);
  if (r.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return {
    owner,
    repo,
    full,
    ownerLogin: String(r.data?.owner?.login ?? owner),
    personal: r.data?.owner?.type === 'User',
    defaultBranch: String(r.data?.default_branch ?? 'main'),
  };
}

interface Ctx {
  f: FetchLike;
  now: () => number;
  random: (n: number) => Uint8Array;
  svc: Services;
  limits: Record<LimitKind, number>;
}

async function appFor(ctx: Ctx, owner: string, repo: string): Promise<string> {
  const t = await ctx.svc.app.installationToken(owner, repo);
  if (!t) throw new HttpError(409, 'app_missing', APP_MISSING);
  return t;
}

/** Caller identity, the app token, and the caller's role checked on GitHub. */
async function authorize(ctx: Ctx, req: Request, repoArg: unknown, need: 'admin' | 'push') {
  const userToken = bearer(req);
  const { owner, repo, full } = parseRepo(repoArg);
  const me = await caller(ctx.f, userToken);
  const appToken = await appFor(ctx, owner, repo);
  const perm = await permissionOf(ctx.f, appToken, owner, repo, me.login);
  const ok = need === 'admin' ? perm === 'admin' : perm === 'admin' || perm === 'write';
  if (!ok) throw new HttpError(403, 'forbidden', need === 'admin' ? 'Only admins can invite people or change roles.' : 'Only people on this team can see who is invited.');
  const facts = await repoFacts(ctx.f, appToken, owner, repo, full);
  return { me, userToken, appToken, facts };
}

const alive = (inv: StoredInvite, now: number) => Date.parse(inv.expiresAt) > now;

async function pending(ctx: Ctx, repo: string): Promise<StoredInvite[]> {
  const all = await ctx.svc.store.list(repo);
  const now = ctx.now();
  const out: StoredInvite[] = [];
  for (const inv of all) {
    if (alive(inv, now)) out.push(inv);
    else await ctx.svc.store.remove(inv);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const siteOrigin = (req: Request, env: InvitesEnv) => originOf(req, env.PUBLIC_SITE_URL);

/** A fresh token (base64url of 32 random bytes) and its hash. */
function newToken(random: (n: number) => Uint8Array): { token: string; hash: string } {
  const token = b64url(Buffer.from(random(32)));
  return { token, hash: sha256(token) };
}

async function storeAndSend(ctx: Ctx, inv: Omit<StoredInvite, 'tokenHash' | 'sentAt' | 'expiresAt'>, origin: string, inviter: string): Promise<StoredInvite> {
  const { token, hash } = newToken(ctx.random);
  const now = ctx.now();
  const full: StoredInvite = { ...inv, tokenHash: hash, sentAt: new Date(now).toISOString(), expiresAt: new Date(now + INVITE_TTL_MS).toISOString() };
  await ctx.svc.store.put(full, Math.ceil(INVITE_TTL_MS / 1000));
  try {
    await ctx.svc.email.send(inviteEmail({ to: inv.email, inviter, repo: inv.repo, role: inv.role, ...(inv.reviewAs ? { reviewAs: inv.reviewAs } : {}), link: `${origin}${INVITE_PATH}#t=${token}` }));
  } catch {
    // Never leave an invite nobody received.
    await ctx.svc.store.remove(full);
    throw new HttpError(502, 'email', 'Bridge could not send the email. Try again in a minute.');
  }
  return full;
}

/** Gives `login` the role on GitHub. Returns the invitation id when GitHub created one instead of adding them. */
async function grant(ctx: Ctx, appToken: string, facts: RepoFacts, login: string, role: Role): Promise<number | null> {
  const r = await gh(ctx.f, appToken, 'PUT', `/repos/${facts.owner}/${facts.repo}/collaborators/${encodeURIComponent(login)}`, { permission: ROLE_PERMISSION[role] });
  if (r.status === 201) return typeof r.data?.id === 'number' ? r.data.id : 0;
  if (r.status === 204) return null;
  if (r.status === 403) throw new HttpError(409, 'app_missing', APP_MISSING);
  if (r.status === 404) throw new HttpError(404, 'not_found', `GitHub has no account @${login}.`);
  throw new HttpError(422, 'refused', 'GitHub refused to add this person. Check their account, then try again.');
}

type OwnersOutcome = { ownersPr?: { number: number; url: string }; ownersError?: string };

async function ownersFor(ctx: Ctx, appToken: string, facts: RepoFacts, login: string, change: OwnerChange): Promise<OwnersOutcome> {
  if (change.design === undefined && change.tech === undefined) return {};
  try {
    const pr = await ownersPullRequest(ctx.f, appToken, facts, login, change, ctx.random);
    return pr ? { ownersPr: pr } : {};
  } catch (e) {
    // Access was granted; only the reviewer listing failed. Say it, never hide it.
    return { ownersError: e instanceof HttpError && e.code === 'config' ? e.message : 'Access is set, but Bridge could not open the settings change that lists them as a reviewer. Change it in Settings.' };
  }
}

/** The owner change a role asks for: a reviewer reviews in one group only; view and edit review in none; admin keeps theirs. */
export function ownerChangeFor(role: Role, reviewAs?: ReviewAs): OwnerChange {
  if (role === 'reviewer') return { design: reviewAs === 'design', tech: reviewAs === 'tech' };
  if (role === 'admin') return {};
  return { design: false, tech: false };
}

/** On accept and direct add, a reviewer is added to their group; nothing is removed. */
const addOnly = (role: Role, reviewAs?: ReviewAs): OwnerChange => (role === 'reviewer' && reviewAs ? { [reviewAs]: true } : {});

const readBody = (req: Request) => readJsonBody(req, MAX_BODY);

async function onGet(req: Request, env: InvitesEnv, deps: InvitesDeps): Promise<Response> {
  const svc = services(env, deps);
  const repoArg = new URL(req.url).searchParams.get('repo');
  if (repoArg === null) return json(200, { available: Boolean(svc) });
  if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, limits: limitsFrom(env) };
  const { facts } = await authorize(ctx, req, repoArg, 'push');
  const list = await pending(ctx, facts.full);
  const members = ctx.svc.members ? await ctx.svc.members.list(facts.full) : [];
  return json(200, { invites: list.map(publicInvite), personal: facts.personal, members: members.map(publicMember) });
}

async function onPost(req: Request, env: InvitesEnv, deps: InvitesDeps): Promise<Response> {
  if (!sameOrigin(req)) return fail(403, 'origin', 'Manage your team from Studio on this site.');
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const svc = services(env, deps);
  if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, limits: limitsFrom(env) };
  const body = await readBody(req);

  switch (body.action) {
    case 'invite': {
      const { me, appToken, facts } = await authorize(ctx, req, body.repo, 'admin');
      const { role, reviewAs } = parseRole(body.role, body.reviewAs);
      const people = body.people;
      if (!Array.isArray(people) || people.length === 0) throw new HttpError(400, 'bad_request', 'Add at least one work email.');
      if (people.length > MAX_PEOPLE) throw new HttpError(400, 'bad_request', `Invite at most ${MAX_PEOPLE} people at once.`);
      const origin = siteOrigin(req, env);
      const current = await pending(ctx, facts.full);
      // Reserve today's emails for every address that may get one, all or nothing; unused ones go back at the end.
      const candidates = new Set<string>();
      for (const p of people) {
        const e = p && typeof p === 'object' ? (p as Record<string, unknown>).email : undefined;
        const email = typeof e === 'string' ? e.trim().toLowerCase() : '';
        if (validEmail(email) && !current.some((x) => x.email === email)) candidates.add(email);
      }
      const room = Math.max(0, MAX_PENDING - current.length);
      const reserved = Math.min(candidates.size, room);
      const release = await reserve(ctx, me.login, facts.full, reserved);
      let emailed = 0;
      const results: { email: string; status: 'sent' | 'added' | 'already' | 'failed'; message?: string }[] = [];
      const seen = new Set<string>();
      try {
        for (const p of people) {
          const rawEmail = p && typeof p === 'object' ? (p as Record<string, unknown>).email : undefined;
          const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
          if (!validEmail(email)) {
            results.push({ email: typeof rawEmail === 'string' ? rawEmail.slice(0, 254) : '', status: 'failed', message: 'This is not a valid email address.' });
            continue;
          }
          if (seen.has(email)) continue;
          seen.add(email);
          const rawLogin = (p as Record<string, unknown>).login;
          try {
            // An organization member Bridge already knows is added straight away: no email, no link.
            if (!facts.personal && rawLogin !== undefined) {
              const login = parseLogin(rawLogin);
              const member = await gh(ctx.f, appToken, 'GET', `/orgs/${facts.ownerLogin}/members/${encodeURIComponent(login)}`);
              if (member.status === 204) {
                await grant(ctx, appToken, facts, login, role);
                const o = await ownersFor(ctx, appToken, facts, login, addOnly(role, reviewAs));
                results.push({ email, status: 'added', ...(o.ownersError ? { message: o.ownersError } : {}) });
                continue;
              }
            }
            if (current.some((x) => x.email === email)) {
              results.push({ email, status: 'already' });
              continue;
            }
            if (current.length >= MAX_PENDING) {
              results.push({ email, status: 'failed', message: `This team already has ${MAX_PENDING} invites waiting. Cancel some first.` });
              continue;
            }
            const id = Buffer.from(ctx.random(8)).toString('hex');
            const inv = await storeAndSend(
              ctx,
              { id, repo: facts.full, email, role, ...(reviewAs ? { reviewAs } : {}), invitedBy: me.login, createdAt: new Date(ctx.now()).toISOString() },
              origin,
              me.name,
            );
            current.push(inv);
            emailed++;
            results.push({ email, status: 'sent' });
          } catch (e) {
            results.push({ email, status: 'failed', message: e instanceof HttpError ? e.message : GITHUB_DOWN });
          }
        }
      } finally {
        await release(reserved - emailed);
      }
      return json(200, { results });
    }

    case 'resend': {
      const { me, facts } = await authorize(ctx, req, body.repo, 'admin');
      const inv = await findInvite(ctx, facts.full, body.id);
      const now = ctx.now();
      const since = now - Date.parse(inv.sentAt);
      if (since < RESEND_COOLDOWN_MS) throw limitError('resend_soon', LIMIT_WORDS.resend_soon, Math.ceil((RESEND_COOLDOWN_MS - since) / 1000));
      const resendKey = [countKey('resend', `${facts.full}:${inv.id}`, dayOf(now))];
      const [count = 0] = await ctx.svc.store.bump(resendKey, 1, COUNTER_TTL_S);
      if (count > MAX_RESENDS_PER_INVITE_DAY) {
        await ctx.svc.store.bump(resendKey, -1, COUNTER_TTL_S);
        throw limitError('resend', LIMIT_WORDS.resend, secondsToTomorrow(now));
      }
      let release: (k: number) => Promise<void>;
      try {
        release = await reserve(ctx, me.login, facts.full, 1);
      } catch (e) {
        await ctx.svc.store.bump(resendKey, -1, COUNTER_TTL_S);
        throw e;
      }
      // The old link stops working: its token index goes with the old record.
      await ctx.svc.store.remove(inv);
      try {
        const next = await storeAndSend(ctx, { id: inv.id, repo: inv.repo, email: inv.email, role: inv.role, ...(inv.reviewAs ? { reviewAs: inv.reviewAs } : {}), invitedBy: inv.invitedBy, createdAt: inv.createdAt }, siteOrigin(req, env), me.name);
        return json(200, { invite: publicInvite(next) });
      } catch (e) {
        // No email went out: the invite stays as it was, its first link still valid, and nothing is counted.
        await ctx.svc.store.put(inv, Math.ceil((Date.parse(inv.expiresAt) - ctx.now()) / 1000));
        await release(1);
        await ctx.svc.store.bump(resendKey, -1, COUNTER_TTL_S);
        throw e;
      }
    }

    case 'invite-role': {
      // The role a pending invite will get once accepted. Same link, no new email.
      const { facts } = await authorize(ctx, req, body.repo, 'admin');
      const inv = await findInvite(ctx, facts.full, body.id);
      const { role, reviewAs } = parseRole(body.role, body.reviewAs);
      const { reviewAs: _old, ...rest } = inv;
      const next = { ...rest, role, ...(reviewAs ? { reviewAs } : {}) };
      await ctx.svc.store.put(next, Math.max(1, Math.ceil((Date.parse(inv.expiresAt) - ctx.now()) / 1000)));
      return json(200, { invite: publicInvite(next) });
    }

    case 'cancel': {
      const { facts } = await authorize(ctx, req, body.repo, 'admin');
      const inv = await findInvite(ctx, facts.full, body.id);
      await ctx.svc.store.remove(inv);
      return json(200, { ok: true });
    }

    case 'set-role': {
      const { me, appToken, facts } = await authorize(ctx, req, body.repo, 'admin');
      if (body.login === undefined && body.email !== undefined) {
        // An email contributor can only edit: reviewing and merging happen on GitHub, with a GitHub account.
        await emailMemberOf(ctx, facts.full, body.email);
        const { role } = parseRole(body.role, body.reviewAs);
        if (role !== 'edit') throw new HttpError(409, 'github-required', GITHUB_REQUIRED);
        return json(200, { ok: true });
      }
      const login = parseLogin(body.login);
      const { role, reviewAs } = parseRole(body.role, body.reviewAs);
      // An admin never changes their own role, so there is always another admin left (the caller).
      if (norm(login) === norm(me.login)) throw new HttpError(409, 'self', 'Ask another admin to change your role.');
      if (norm(login) === norm(facts.ownerLogin)) throw new HttpError(409, 'owner', 'The owner of the repository stays admin.');
      const perm = await permissionOf(ctx.f, appToken, facts.owner, facts.repo, login);
      if (perm === 'none') throw new HttpError(404, 'not_found', `@${login} is not on this team.`);
      await grant(ctx, appToken, facts, login, role);
      const o = await ownersFor(ctx, appToken, facts, login, ownerChangeFor(role, reviewAs));
      return json(200, { ok: true, ...o });
    }

    case 'remove': {
      const { me, appToken, facts } = await authorize(ctx, req, body.repo, 'admin');
      if (body.login === undefined && body.email !== undefined) {
        // Deleting the record ends their sessions at once (api/contribute reads it on every request).
        const email = await emailMemberOf(ctx, facts.full, body.email);
        await ctx.svc.members!.remove(facts.full, email);
        return json(200, { ok: true });
      }
      const login = parseLogin(body.login);
      if (norm(login) === norm(me.login)) throw new HttpError(409, 'self', 'You cannot remove yourself. Ask another admin.');
      if (norm(login) === norm(facts.ownerLogin)) throw new HttpError(409, 'owner', 'The owner of the repository cannot be removed.');
      const r = await gh(ctx.f, appToken, 'DELETE', `/repos/${facts.owner}/${facts.repo}/collaborators/${encodeURIComponent(login)}`);
      if (r.status !== 204 && r.status !== 404) throw new HttpError(422, 'refused', 'GitHub refused to remove this person. Try again.');
      const o = await ownersFor(ctx, appToken, facts, login, { design: false, tech: false });
      return json(200, { ok: true, ...o });
    }

    case 'peek': {
      // What an invite link is, before anything is signed in: the invite page opens on the right path (an email for
      // Can edit, GitHub for a reviewer or admin). No sign-in; capped per address; the email only ever masked.
      const ip = sha256(`peek:${clientIp(req)}`).slice(0, 32);
      const [n = 0] = await ctx.svc.store.bump([`bridge:invites:count:peek:${ip}:${hourOf(ctx.now())}`], 1, 2 * 3600);
      if (n > PEEK_PER_HOUR) return fail(429, 'limit', 'Too many tries from this network. Try again in an hour.');
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return fail(410, 'expired', EXPIRED);
      const inv = await ctx.svc.store.byTokenHash(sha256(body.token));
      if (!inv || !alive(inv, ctx.now())) return fail(410, 'expired', EXPIRED);
      return json(200, { team: teamDisplayName(inv.repo), repo: inv.repo, role: inv.role, sentTo: maskEmail(inv.email) });
    }
    case 'accept': {
      const userToken = bearer(req);
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return fail(410, 'expired', EXPIRED);
      const me = await caller(ctx.f, userToken);
      const inv = await ctx.svc.store.byTokenHash(sha256(body.token));
      if (!inv) return fail(410, 'expired', EXPIRED);
      if (!alive(inv, ctx.now())) {
        await ctx.svc.store.remove(inv);
        return fail(410, 'expired', EXPIRED);
      }
      // Only the invited person: the email must be a verified email of this GitHub account. Otherwise nothing is
      // granted and the invite stays valid, so they can fix it on GitHub and open the same link again.
      const email = await emailStatus(ctx.f, userToken, inv.email);
      if (email !== 'verified') {
        const sentTo = maskEmail(inv.email);
        return json(403, {
          error: email === 'unverified' ? 'email_unverified' : 'email_mismatch',
          message:
            email === 'unverified'
              ? `This invitation was sent to ${sentTo}. That email is on your GitHub account but not verified yet. Verify it on GitHub, then try again.`
              : `This invitation was sent to ${sentTo}, which is not an email of your GitHub account @${me.login}. Add and verify it on GitHub, then try again, or ask your admin to invite the email you use on GitHub.`,
          sentTo,
          login: me.login,
        });
      }
      const { owner, repo, full } = parseRepo(inv.repo);
      const appToken = await appFor(ctx, owner, repo);
      const facts = await repoFacts(ctx.f, appToken, owner, repo, full);
      const invitation = await grant(ctx, appToken, facts, me.login, inv.role);
      let status: 'joined' | 'accept-on-github' = 'joined';
      if (invitation !== null) {
        // GitHub invited the account instead of adding it: accept for them with their own token when GitHub lets the
        // app do it, else they accept on GitHub in one click.
        const ok = invitation > 0 && (await gh(ctx.f, userToken, 'PATCH', `/user/repository_invitations/${invitation}`)).status === 204;
        if (!ok) status = 'accept-on-github';
      }
      const o = await ownersFor(ctx, appToken, facts, me.login, addOnly(inv.role, inv.reviewAs));
      // Single use: the link is spent once access is granted.
      await ctx.svc.store.remove(inv);
      // They now work with GitHub: an email membership of the same address would list them twice.
      if (ctx.svc.members) await ctx.svc.members.remove(full, inv.email);
      return json(200, {
        status,
        repo: `${owner}/${repo}`,
        role: inv.role,
        ...(inv.reviewAs ? { reviewAs: inv.reviewAs } : {}),
        ...(status === 'accept-on-github' ? { acceptUrl: `https://github.com/${owner}/${repo}/invitations` } : {}),
        ...o,
      });
    }

    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

async function findInvite(ctx: Ctx, repo: string, id: unknown): Promise<StoredInvite> {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(404, 'not_found', 'This invite no longer exists.');
  const inv = await ctx.svc.store.get(repo, id);
  if (!inv) throw new HttpError(404, 'not_found', 'This invite no longer exists.');
  return inv;
}

export async function handleInvites(req: Request, env: InvitesEnv, deps: InvitesDeps): Promise<Response> {
  try {
    if (req.method === 'GET') return await onGet(req, env, deps);
    if (req.method === 'POST') return await onPost(req, env, deps);
    return json(405, { error: 'method', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
    return fail(502, 'unreachable', GITHUB_DOWN);
  }
}

const envFromProcess = (): InvitesEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  INVITE_EMAIL_FROM: process.env.INVITE_EMAIL_FROM,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
  INVITES_MAX_PER_ADMIN_DAY: process.env.INVITES_MAX_PER_ADMIN_DAY,
  INVITES_MAX_PER_TEAM_DAY: process.env.INVITES_MAX_PER_TEAM_DAY,
  INVITES_MAX_SITE_DAY: process.env.INVITES_MAX_SITE_DAY,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);

/** Vercel Functions entries (Web standard signature). */
export function GET(request: Request): Promise<Response> {
  return handleInvites(request, envFromProcess(), { fetch: realFetch });
}

export function POST(request: Request): Promise<Response> {
  return handleInvites(request, envFromProcess(), { fetch: realFetch });
}
