// /api/invites: invite people to a team's Bridge by work email, and manage who has access (docs/HOSTED.md, "Invites by email").
//
// The flow: an admin picks emails and a role in Studio; this function stores a pending invite (server side, never in
// the browser) and emails a one-time link; the invitee opens it, signs in with GitHub, and this function gives their
// GitHub account access to the repository with the role's permission. It also changes roles, removes people and
// resends or cancels invites. Self-contained on purpose (node built-ins only), so Vercel bundles it as is.
//
// Roles, as designers read them, and what each one is on GitHub (keep the Studio words in lib/invites.ts in step):
//   view      "Can view"   GitHub `pull`  (read)
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
//   GET  /api/invites?repo=owner/name       { invites, personal }  caller can push
//   POST /api/invites { action: 'invite' | 'resend' | 'invite-role' | 'cancel' | 'set-role' | 'remove' }  caller is admin
//   POST /api/invites { action: 'accept', token }  caller is the invitee, any GitHub account
// Requests carry `Authorization: Bearer <GitHub user token>` (Studio's Sign in with GitHub). POSTs must come from a
// page of this site.
//
// The invite link is <site>/studio/invite/#t=<token>: 32 random bytes, in the fragment so it never reaches a server
// log. Only its SHA-256 is stored. It works once and expires after 7 days; Resend makes a new one.
//
// Env (server only):
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)   pending invites
//   RESEND_API_KEY + INVITE_EMAIL_FROM                                                           the invite email
//   GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY                                                        Bridge Direct app
//   PUBLIC_SITE_URL (optional)                                                                    link origin
// Missing any of the first three groups: every action answers 503 "Invites are not available yet on this site."

import { createHash, createSign, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------------------------------------------
// Types and constants

export type Role = 'view' | 'edit' | 'reviewer' | 'admin';
export type ReviewAs = 'design' | 'tech';
export type GitHubPermission = 'pull' | 'push' | 'admin';

export const ROLES: readonly Role[] = ['view', 'edit', 'reviewer', 'admin'];

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
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

/** Pending invites, per repository. */
export interface InviteStore {
  list(repo: string): Promise<StoredInvite[]>;
  get(repo: string, id: string): Promise<StoredInvite | null>;
  /** Saves the invite and indexes it by its token hash until it expires. */
  put(inv: StoredInvite, ttlSeconds: number): Promise<void>;
  /** Removes the invite and its token index. */
  remove(inv: StoredInvite): Promise<void>;
  byTokenHash(hash: string): Promise<StoredInvite | null>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends one email; throws when the provider refuses it. */
export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** An installation token of the Bridge app for one repository, or null when the app cannot manage its people. */
export interface AppTokens {
  installationToken(owner: string, repo: string): Promise<string | null>;
}

export interface InvitesDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  /** Injected services (tests); otherwise built from the env. */
  store?: InviteStore;
  email?: EmailSender;
  app?: AppTokens;
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

const fail = (status: number, error: string, message: string) => json(status, { error, message });

export const NOT_CONFIGURED = 'Invites are not available yet on this site.';
const GITHUB_DOWN = 'GitHub did not answer. Try again in a minute.';
const APP_MISSING = 'Bridge cannot add people to this design system yet. An admin of the repository gives Bridge access to members.';
export const EXPIRED = 'This invitation expired or was already used. Ask your admin to send a new one.';

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/** The request comes from a page on this very site (same rule as api/github/token.ts). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.origin !== origin) return false;
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host).split(',')[0]!.trim().toLowerCase();
  if (!host || o.host.toLowerCase() !== host) return false;
  if (o.protocol !== 'https:' && !(o.protocol === 'http:' && isLocalHost(o.host))) return false;
  const site = req.headers.get('sec-fetch-site');
  return !site || site === 'same-origin';
}

const REPO = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[a-f0-9]{16}$/;

export const validEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim());

function parseRepo(v: unknown): { owner: string; repo: string; full: string } {
  if (typeof v !== 'string') throw new HttpError(400, 'bad_request', 'Say which design system, as owner/name.');
  const m = REPO.exec(v.trim());
  if (!m || m[2] === '.' || m[2] === '..') throw new HttpError(400, 'bad_request', 'Say which design system, as owner/name.');
  return { owner: m[1]!, repo: m[2]!, full: `${m[1]}/${m[2]}`.toLowerCase() };
}

function parseRole(role: unknown, reviewAs: unknown): { role: Role; reviewAs?: ReviewAs } {
  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) throw new HttpError(400, 'bad_request', 'Pick a role: Can view, Can edit, Reviewer or Admin.');
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

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A GitHub App JWT (RS256), valid 9 minutes, backdated 60 s for clock drift. */
export function appJwt(appId: string, privateKey: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey.replace(/\\n/g, '\n'));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Installation tokens of the Bridge Direct app, scoped to the one repository, never stored. */
export function githubApp(appId: string, privateKey: string, f: FetchLike, now: () => number): AppTokens {
  return {
    async installationToken(owner, repo) {
      const jwt = appJwt(appId, privateKey, now());
      const inst = await gh(f, jwt, 'GET', `/repos/${owner}/${repo}/installation`);
      if (inst.status === 404) return null;
      if (inst.status !== 200 || typeof inst.data?.id !== 'number') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
      const tok = await gh(f, jwt, 'POST', `/app/installations/${inst.data.id}/access_tokens`, { repositories: [repo] });
      if (tok.status === 404 || tok.status === 422) return null;
      if (tok.status !== 201 || typeof tok.data?.token !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
      // Without Administration write the app cannot add or remove anyone: say so instead of failing later.
      if (tok.data.permissions && tok.data.permissions.administration !== 'write') return null;
      return tok.data.token as string;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Storage: Upstash Redis over REST (Vercel Marketplace), or memory in tests

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

export function redisStore(url: string, token: string, f: FetchLike): InviteStore {
  const base = url.replace(/\/+$/, '');
  const call = async (path: string, body: unknown): Promise<any> => {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new HttpError(503, 'storage', 'Bridge could not reach its invite storage. Try again in a minute.');
    }
    if (!res.ok) throw new HttpError(503, 'storage', 'Bridge could not reach its invite storage. Try again in a minute.');
    return res.json();
  };
  const cmd = async (...args: (string | number)[]) => {
    const r = (await call('', args)) as { result?: unknown; error?: string };
    if (r.error) throw new HttpError(503, 'storage', 'Bridge could not reach its invite storage. Try again in a minute.');
    return r.result;
  };
  const pipe = (cmds: (string | number)[][]) => call('/pipeline', cmds);
  const store: InviteStore = {
    async list(repo) {
      const flat = (await cmd('HGETALL', repoKey(repo))) as unknown[] | null;
      const out: StoredInvite[] = [];
      for (let i = 1; i < (flat?.length ?? 0); i += 2) {
        const inv = parseStored(flat![i]);
        if (inv) out.push(inv);
      }
      return out;
    },
    async get(repo, id) {
      return parseStored(await cmd('HGET', repoKey(repo), id));
    },
    async put(inv, ttl) {
      await pipe([
        ['HSET', repoKey(inv.repo), inv.id, JSON.stringify(inv)],
        ['SET', tokenKey(inv.tokenHash), `${inv.repo}|${inv.id}`, 'EX', Math.max(1, ttl)],
      ]);
    },
    async remove(inv) {
      await pipe([
        ['HDEL', repoKey(inv.repo), inv.id],
        ['DEL', tokenKey(inv.tokenHash)],
      ]);
    },
    async byTokenHash(hash) {
      const ref = await cmd('GET', tokenKey(hash));
      if (typeof ref !== 'string') return null;
      const [repo = '', id = ''] = ref.split('|');
      const inv = await store.get(repo, id);
      return inv && inv.tokenHash === hash ? inv : null;
    },
  };
  return store;
}

/** In-memory store (tests, local experiments). Same contract as the Redis one, expiry by `now`. */
export function memoryStore(now: () => number = Date.now): InviteStore {
  const byRepo = new Map<string, Map<string, StoredInvite>>();
  const tokens = new Map<string, { ref: string; until: number }>();
  const store: InviteStore = {
    async list(repo) {
      return [...(byRepo.get(repo.toLowerCase())?.values() ?? [])].map((x) => ({ ...x }));
    },
    async get(repo, id) {
      const v = byRepo.get(repo.toLowerCase())?.get(id);
      return v ? { ...v } : null;
    },
    async put(inv, ttl) {
      const m = byRepo.get(inv.repo) ?? new Map<string, StoredInvite>();
      m.set(inv.id, { ...inv });
      byRepo.set(inv.repo, m);
      tokens.set(inv.tokenHash, { ref: `${inv.repo}|${inv.id}`, until: now() + ttl * 1000 });
    },
    async remove(inv) {
      byRepo.get(inv.repo)?.delete(inv.id);
      tokens.delete(inv.tokenHash);
    },
    async byTokenHash(hash) {
      const t = tokens.get(hash);
      if (!t || t.until <= now()) return null;
      const [repo = '', id = ''] = t.ref.split('|');
      const inv = await store.get(repo, id);
      return inv && inv.tokenHash === hash ? inv : null;
    },
  };
  return store;
}

// ---------------------------------------------------------------------------------------------------------------
// Email: Resend

export function resendSender(apiKey: string, from: string, f: FetchLike): EmailSender {
  return {
    async send(msg) {
      let res: Response;
      try {
        res = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        });
      } catch {
        throw new Error('email provider unreachable');
      }
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The invite email: who invited, the role in words, the one link. */
export function inviteEmail(x: { to: string; inviter: string; repo: string; role: Role; reviewAs?: ReviewAs; link: string }): EmailMessage {
  const w = ROLE_WORDS[x.role];
  const roleLabel = x.role === 'reviewer' && x.reviewAs ? `${w.label}: ${REVIEW_AS_WORDS[x.reviewAs]}` : w.label;
  const subject = `${x.inviter} invited you to ${x.repo} on Bridge`;
  const lines = [
    `${x.inviter} invited you to the ${x.repo} design system on Bridge.`,
    '',
    `Your role: ${roleLabel}. ${w.text}`,
    '',
    `Join the team: ${x.link}`,
    '',
    'You sign in with GitHub. The link works once and expires in 7 days.',
    "If you did not expect this email, you can ignore it.",
  ];
  const html = [
    `<p>${escHtml(x.inviter)} invited you to the <strong>${escHtml(x.repo)}</strong> design system on Bridge.</p>`,
    `<p>Your role: <strong>${escHtml(roleLabel)}</strong>. ${escHtml(w.text)}</p>`,
    `<p><a href="${escHtml(x.link)}">Join the team</a></p>`,
    '<p>You sign in with GitHub. The link works once and expires in 7 days.</p>',
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
}

/** The services from the env (and injected ones), or null when any of storage, email or the app is missing. */
export function services(env: InvitesEnv, deps: InvitesDeps): Services | null {
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
  return store && email && app ? { store, email, app } : null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const publicInvite = ({ repo: _r, tokenHash: _t, ...rest }: StoredInvite): PendingInvite => rest;

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

function siteOrigin(req: Request, env: InvitesEnv): string {
  const pub = env.PUBLIC_SITE_URL?.trim();
  if (pub) {
    try {
      return new URL(pub).origin;
    } catch {
      /* fall back to the request */
    }
  }
  return req.headers.get('origin') ?? new URL(req.url).origin;
}

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

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'too_large', 'Request too large.');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_request', 'Send a JSON object.');
  }
}

async function onGet(req: Request, env: InvitesEnv, deps: InvitesDeps): Promise<Response> {
  const svc = services(env, deps);
  const repoArg = new URL(req.url).searchParams.get('repo');
  if (repoArg === null) return json(200, { available: Boolean(svc) });
  if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc };
  const { facts } = await authorize(ctx, req, repoArg, 'push');
  const list = await pending(ctx, facts.full);
  return json(200, { invites: list.map(publicInvite), personal: facts.personal });
}

async function onPost(req: Request, env: InvitesEnv, deps: InvitesDeps): Promise<Response> {
  if (!sameOrigin(req)) return fail(403, 'origin', 'Manage your team from Studio on this site.');
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const svc = services(env, deps);
  if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
  const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc };
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
      const results: { email: string; status: 'sent' | 'added' | 'already' | 'failed'; message?: string }[] = [];
      const seen = new Set<string>();
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
          results.push({ email, status: 'sent' });
        } catch (e) {
          results.push({ email, status: 'failed', message: e instanceof HttpError ? e.message : GITHUB_DOWN });
        }
      }
      return json(200, { results });
    }

    case 'resend': {
      const { me, facts } = await authorize(ctx, req, body.repo, 'admin');
      const inv = await findInvite(ctx, facts.full, body.id);
      // The old link stops working: its token index goes with the old record.
      await ctx.svc.store.remove(inv);
      try {
        const next = await storeAndSend(ctx, { id: inv.id, repo: inv.repo, email: inv.email, role: inv.role, ...(inv.reviewAs ? { reviewAs: inv.reviewAs } : {}), invitedBy: inv.invitedBy, createdAt: inv.createdAt }, siteOrigin(req, env), me.name);
        return json(200, { invite: publicInvite(next) });
      } catch (e) {
        // No email went out: the invite stays as it was, its first link still valid.
        await ctx.svc.store.put(inv, Math.ceil((Date.parse(inv.expiresAt) - ctx.now()) / 1000));
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
      const login = parseLogin(body.login);
      if (norm(login) === norm(me.login)) throw new HttpError(409, 'self', 'You cannot remove yourself. Ask another admin.');
      if (norm(login) === norm(facts.ownerLogin)) throw new HttpError(409, 'owner', 'The owner of the repository cannot be removed.');
      const r = await gh(ctx.f, appToken, 'DELETE', `/repos/${facts.owner}/${facts.repo}/collaborators/${encodeURIComponent(login)}`);
      if (r.status !== 204 && r.status !== 404) throw new HttpError(422, 'refused', 'GitHub refused to remove this person. Try again.');
      const o = await ownersFor(ctx, appToken, facts, login, { design: false, tech: false });
      return json(200, { ok: true, ...o });
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
    if (e instanceof HttpError) return fail(e.status, e.code, e.message);
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
});

const realFetch: FetchLike = (url, init) => fetch(url, init);

/** Vercel Functions entries (Web standard signature). */
export function GET(request: Request): Promise<Response> {
  return handleInvites(request, envFromProcess(), { fetch: realFetch });
}

export function POST(request: Request): Promise<Response> {
  return handleInvites(request, envFromProcess(), { fetch: realFetch });
}
