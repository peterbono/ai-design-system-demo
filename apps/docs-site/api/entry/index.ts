// /api/entry: where a person goes once their Bridge account is verified (email code or GitHub), and the join requests
// and team discovery that route needs (docs/HOSTED.md, "Accounts").
//
// GET /api/entry answers one `kind`, the first rule that matches:
//   1. teams    they are on teams already: email memberships, plus, only for an account that already has GitHub
//               linked and when the request carries that GitHub account's own token (Bearer), the repositories the
//               Bridge app is installed on where it can push or administer (GitHub proves the rights). Sign-in is by
//               email; GitHub is never needed here
//               { kind: 'teams', teams: [{ repo, name, role: 'edit' | 'reviewer' | 'admin', via: 'email' | 'github' }] }
//   2. invites  invites wait for their email
//               { kind: 'invites', invites: [{ id, team, repo, role, invitedBy, invitedAt, memberCount, people }] }
//               (accept-invite joins directly)
//   3. domain   teams whose admin opened them to the person's work domain, all of them, largest first
//               { kind: 'domain', domain, teams: [{ repo, name, memberCount, people, adminName, requested }] }
//   `people`: the names of the first few people on the team (admins first, at most PEOPLE_SHOWN), for the avatars of
//   the team card; the card shows the rest as "+N" from memberCount. Names only, never an email.
//   4. create   { kind: 'create' }
// Public and free mailbox domains (api/_lib/domains.ts) never match and can never be opened.
//
// Other endpoints (JSON, errors are { error, message } in Studio words). All need the account cookie (api/account):
//   GET  /api/entry?requests=owner/name     admin: { requests: [{ id, name, email, createdAt, expiresAt }] }
//   GET  /api/entry?discovery=owner/name    admin: { domain, enabled, configured, eligible }
//   POST { action: 'accept-invite', repo, id }   the invite sent to the account email; joins directly
//                                                { joined: true, status, repo, role, next }
//   POST { action: 'request', repo }        asks to join a team open to their work domain (an invite for that team
//                                           is accepted instead: { joined: true, ... }); { requested: true, expiresAt }
//   POST { action: 'cancel-request', repo }  the requester takes back their own pending request (keyed by the
//                                           account email, so nobody else's); { cancelled: true }, 404 when none waits
//   POST { action: 'approve', repo, id }    admin: the requester joins with Can edit; { member: { name, role }, repo }
//   POST { action: 'decline', repo, id }    admin: { ok: true }
//   POST { action: 'discovery', repo, enabled }  admin: opens the team to the admin's own work domain, or closes it;
//                                           { domain, enabled }
// Every POST carries `X-Bridge-Contribute: 1` (or `X-Bridge-Account: 1`), JSON, and an Origin of this site (CSRF).
//
// Admins: the account's linked GitHub account is an admin of the repository, read with the Bridge app's installation
// token on every call (the GitHub id must match, so a renamed login never passes for another). Nothing the browser
// says about its role is trusted.
//
// Privacy: other members' emails never leave here. A domain team or an invite shows the admin by name (their Bridge
// account name, else their GitHub login), the team's size and the names of its first few people. Admins see a requester's name and email, like an invite. A team that did
// not open itself to a domain is never listed, and asking to join it answers the same 404 as a team that does not
// exist. Requests expire after 14 days; deleting the account deletes them.
//
// Storage: api/_lib/teams.ts (discovery, requests), api/_lib/members.ts (memberships), api/invites (invites by email).
// Env (server only): KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_ pair), LIBRARY_SESSION_SECRET,
// GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (admins, sizes, reviewer and admin invites), RESEND_API_KEY +
// INVITE_EMAIL_FROM (request emails), PUBLIC_SITE_URL (optional).

import { createHmac, randomBytes } from 'node:crypto';
import { type Account, sessionAccount } from '../_lib/account.js';
import { workDomain } from '../_lib/domains.js';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { githubApp, type AppTokens } from '../_lib/github-app.js';
import { clientIp, dayOf, fail, GITHUB_DOWN, HttpError, json, parseRepo, readBody, sameOrigin, secondsToTomorrow, siteOrigin, type FetchLike } from '../_lib/http.js';
import { accountTeamsKey, memberStore, type EmailMember, type MemberStore } from '../_lib/members.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import {
  type Discovery,
  getDiscovery,
  getRequest,
  JOIN_REQUEST_TTL_MS,
  type JoinRequest,
  listRequests,
  myRequests,
  putDiscovery,
  putRequest,
  removeRequest,
  teamsForDomain,
} from '../_lib/teams.js';
import { acceptInviteForGithub, githubApp as invitesApp, inviteStoreOn, type InviteStore, type StoredInvite } from '../invites/index.js';
import { teamDisplayName } from '../../src/lib/demo.js';
import { STUDIO_ROOT } from '../../src/lib/team-path.js';

export type { FetchLike };

// ---------------------------------------------------------------------------------------------------------------
// Types and constants

export interface EntryEnv {
  KV_REST_API_URL?: string | undefined;
  KV_REST_API_TOKEN?: string | undefined;
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
  LIBRARY_SESSION_SECRET?: string | undefined;
  GITHUB_APP_ID?: string | undefined;
  GITHUB_APP_PRIVATE_KEY?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  INVITE_EMAIL_FROM?: string | undefined;
  PUBLIC_SITE_URL?: string | undefined;
}

export interface EntryDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  redis?: Redis;
  members?: MemberStore;
  invites?: InviteStore;
  email?: EmailSender;
  /** Installation tokens to read a repository (admins, collaborators). */
  app?: AppTokens;
  /** Installation tokens with Administration write (reviewer and admin invites). */
  grantApp?: AppTokens;
}

export type EntryTeamRole = 'edit' | 'reviewer' | 'admin';

export type Entry =
  | { kind: 'teams'; teams: { repo: string; name: string; role: EntryTeamRole; via: 'email' | 'github' }[] }
  | { kind: 'invites'; invites: { id: string; team: string; repo: string; role: string; invitedBy: string; invitedAt: string; memberCount: number; people: string[] }[] }
  | { kind: 'domain'; domain: string; teams: { repo: string; name: string; memberCount: number; people: string[]; adminName: string; requested: boolean }[] }
  | { kind: 'create' };

/** Names sent per team card (its avatars); the card counts the rest from memberCount. */
export const PEOPLE_SHOWN = 4;
/** Requests per UTC day: per person, per network, and admin emails per team. */
export const REQUEST_LIMITS = { email: 10, ip: 30, team: 20 } as const;
const MAX_BODY = 4096;
const COUNTER_TTL_S = 2 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;
const API = 'https://api.github.com';
const ID = /^[a-f0-9]{16}$/;
const GH_TOKEN = /^[A-Za-z0-9_.-]{20,255}$/;

// ---------------------------------------------------------------------------------------------------------------
// Words

export const NOT_CONFIGURED = 'Bridge accounts are not available yet on this site.';
export const SIGNIN = 'Your session ended. Sign in again.';
export const NOT_OPEN = 'This team is not open to your email. Ask an admin of the team to invite you.';
export const ADMIN_ONLY = 'Only admins of this team can do this. Continue with GitHub with an admin account.';
export const PUBLIC_DOMAIN = 'Teams open to a work email only. Your account uses a public email, like Gmail or Outlook: sign in with your work email to turn this on.';
export const GITHUB_REQUIRED = 'Reviewers and admins approve and merge on GitHub. Continue with GitHub, then accept this invite.';
export const ALREADY = 'You are already on this team.';
export const INVITE_GONE = 'This invite expired or was cancelled. Ask your admin for a new one.';
export const REQUEST_GONE = 'This request expired or was already answered.';
const APP_MISSING = 'Bridge cannot read this team on GitHub yet. An admin of the repository gives the Bridge app access to it.';
const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
export const LIMIT_WORDS = {
  email: 'You asked to join a few teams today. Try again tomorrow.',
  ip: 'Too many requests from this network today. Try again tomorrow.',
  team: 'This team got many requests today. Try again tomorrow.',
};

// ---------------------------------------------------------------------------------------------------------------
// Services

interface Services {
  redis: Redis;
  members: MemberStore;
  invites: InviteStore;
  email: EmailSender | null;
  app: AppTokens | null;
  grantApp: AppTokens | null;
  secret: string;
}

export function services(env: EntryEnv, deps: EntryDeps): Services | null {
  const now = deps.now ?? Date.now;
  const url = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const redis = deps.redis ?? (url && token ? redisRest(url, token, deps.fetch, STORAGE_DOWN) : null);
  const secret = env.LIBRARY_SESSION_SECRET?.trim() ?? '';
  if (!redis || secret.length < MIN_SECRET_LENGTH) return null;
  const key = env.RESEND_API_KEY?.trim();
  const from = env.INVITE_EMAIL_FROM?.trim();
  const appId = env.GITHUB_APP_ID?.trim();
  const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
  return {
    redis,
    secret,
    members: deps.members ?? memberStore(redis),
    invites: deps.invites ?? inviteStoreOn(redis, now),
    email: deps.email ?? (key && from ? resendSender(key, from, deps.fetch) : null),
    app: deps.app ?? (appId && pem ? githubApp(appId, pem, deps.fetch, now, { userAgent: 'bridge-entry' }) : null),
    grantApp: deps.grantApp ?? (appId && pem ? invitesApp(appId, pem, deps.fetch, now) : null),
  };
}

interface Ctx {
  f: FetchLike;
  now: () => number;
  random: (n: number) => Uint8Array;
  svc: Services;
  env: EntryEnv;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const hmacHex = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('hex').slice(0, 32);
const teamHref = (repo: string) => {
  const [o, r] = repo.split('/') as [string, string];
  return `${STUDIO_ROOT}${encodeURIComponent(o)}/${encodeURIComponent(r)}/`;
};

function requireCsrf(req: Request): void {
  const header = req.headers.get('x-bridge-contribute') === '1' || req.headers.get('x-bridge-account') === '1';
  if (!header || !sameOrigin(req)) throw new HttpError(403, 'origin', 'Continue from Bridge on this site.');
}

async function gh(f: FetchLike, token: string, path: string): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-entry', 'X-GitHub-Api-Version': '2022-11-28' } });
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

async function bumpOrRefuse(ctx: Ctx, keys: string[], limits: number[], kinds: (keyof typeof LIMIT_WORDS)[]): Promise<void> {
  const r = await ctx.svc.redis.pipe(keys.flatMap((k) => [['INCRBY', k, 1], ['EXPIRE', k, COUNTER_TTL_S]]));
  const over = keys.findIndex((_, i) => Number(r[i * 2]) > limits[i]!);
  if (over < 0) return;
  await ctx.svc.redis.pipe(keys.map((k) => ['INCRBY', k, -1]));
  throw new HttpError(429, 'limit', LIMIT_WORDS[kinds[over]!], { limit: kinds[over] }, { 'Retry-After': String(secondsToTomorrow(ctx.now())) });
}

// ---------------------------------------------------------------------------------------------------------------
// Teams of the person

/** Email memberships, each one read again (a removed membership leaves the set). */
async function membershipsOf(ctx: Ctx, email: string): Promise<{ repo: string; member: EmailMember }[]> {
  const raw = await ctx.svc.redis.cmd('SMEMBERS', accountTeamsKey(email));
  const repos = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').sort() : [];
  const out: { repo: string; member: EmailMember }[] = [];
  for (const repo of repos) {
    const m = await ctx.svc.members.get(repo, email);
    if (m) out.push({ repo, member: m });
    else await ctx.svc.redis.cmd('SREM', accountTeamsKey(email), repo);
  }
  return out;
}

/**
 * The teams the linked GitHub account can push to or administer, among the repositories the Bridge app shares with
 * it. Read with the person's own token (Bearer), only when it belongs to the linked account. Empty otherwise.
 */
async function githubTeams(ctx: Ctx, req: Request, a: Account): Promise<{ repo: string; role: EntryTeamRole }[]> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!a.github || !bearer || !GH_TOKEN.test(bearer)) return [];
  const user = await gh(ctx.f, bearer, '/user');
  if (user.status !== 200 || user.data?.id !== a.github.id) return [];
  const inst = await gh(ctx.f, bearer, '/user/installations?per_page=100');
  const installations: any[] = Array.isArray(inst.data?.installations) ? inst.data.installations : [];
  const out = new Map<string, EntryTeamRole>();
  for (const i of installations.slice(0, 20)) {
    if (!Number.isSafeInteger(i?.id)) continue;
    const r = await gh(ctx.f, bearer, `/user/installations/${i.id}/repositories?per_page=100`);
    const repos: any[] = Array.isArray(r.data?.repositories) ? r.data.repositories : [];
    for (const repo of repos) {
      if (typeof repo?.full_name !== 'string') continue;
      let full: string;
      try {
        full = parseRepo(repo.full_name).full;
      } catch {
        continue;
      }
      if (repo.permissions?.admin === true) out.set(full, 'admin');
      else if (repo.permissions?.push === true && !out.has(full)) out.set(full, 'edit');
    }
  }
  return [...out].map(([repo, role]) => ({ repo, role })).sort((x, y) => x.repo.localeCompare(y.repo));
}

/** A GitHub person's name: the name of the Bridge account linked to that GitHub id, else the login. Never an email. */
async function githubNameOf(ctx: Ctx, githubId: number, login: string): Promise<string> {
  const email = await ctx.svc.redis.cmd('GET', `bridge:account:gh:${githubId}`);
  if (typeof email === 'string') {
    const raw = await ctx.svc.redis.cmd('GET', `bridge:account:${email}`);
    try {
      const a = typeof raw === 'string' ? (JSON.parse(raw) as Account) : null;
      if (a?.github?.id === githubId && typeof a.name === 'string' && a.name) return a.name;
    } catch {
      /* the login below */
    }
  }
  return login;
}

/** The admin's name for a domain team card. */
const adminNameOf = (ctx: Ctx, d: Discovery): Promise<string> => githubNameOf(ctx, d.byGithubId, d.byLogin);

/** GitHub collaborators of a team, through the app; null when the app cannot read it. */
async function collaboratorsOf(ctx: Ctx, repo: string): Promise<any[] | null> {
  if (!ctx.svc.app) return null;
  const { owner, repo: name } = parseRepo(repo);
  const token = await ctx.svc.app.installationToken(owner, name);
  if (!token) return null;
  const r = await gh(ctx.f, token, `/repos/${owner}/${name}/collaborators?affiliation=all&per_page=100`);
  return r.status === 200 && Array.isArray(r.data) ? r.data : null;
}

/**
 * People on a team, for its card: how many (email members, plus GitHub collaborators when the app can read them) and
 * the names of the first PEOPLE_SHOWN (GitHub admins first, then the other collaborators, then email members). Only
 * names: an email never leaves here, a member without a name is counted but not named.
 */
async function teamPeople(ctx: Ctx, repo: string): Promise<{ memberCount: number; people: string[] }> {
  const emails = await ctx.svc.members.list(repo);
  let collaborators: any[] = [];
  try {
    collaborators = (await collaboratorsOf(ctx, repo)) ?? [];
  } catch {
    collaborators = [];
  }
  const github = collaborators
    .filter((c) => Number.isSafeInteger(c?.id) && typeof c?.login === 'string' && c.login)
    .sort((x, y) => Number(y.permissions?.admin === true) - Number(x.permissions?.admin === true));
  const people: string[] = [];
  for (const c of github) {
    if (people.length >= PEOPLE_SHOWN) break;
    people.push(await githubNameOf(ctx, c.id, c.login));
  }
  for (const m of emails) {
    if (people.length >= PEOPLE_SHOWN) break;
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (name && !name.includes('@')) people.push(name);
  }
  return { memberCount: emails.length + collaborators.length, people };
}

// ---------------------------------------------------------------------------------------------------------------
// GET: the routing

export async function entryFor(ctx: Ctx, req: Request, a: Account): Promise<Entry> {
  // 1. Teams they are on.
  const email = (await membershipsOf(ctx, a.email)).map(({ repo }) => ({ repo, name: teamDisplayName(repo), role: 'edit' as EntryTeamRole, via: 'email' as const }));
  const github = (await githubTeams(ctx, req, a)).filter((t) => !email.some((e) => e.repo === t.repo)).map((t) => ({ ...t, name: teamDisplayName(t.repo), via: 'github' as const }));
  const teams = [...email, ...github].sort((x, y) => x.name.localeCompare(y.name));
  if (teams.length) return { kind: 'teams', teams };

  // 2. Invites waiting for their email.
  const invites = await ctx.svc.invites.byEmail(a.email);
  if (invites.length) {
    const out: Extract<Entry, { kind: 'invites' }>['invites'] = [];
    for (const inv of invites) {
      out.push({ id: inv.id, team: teamDisplayName(inv.repo), repo: inv.repo, role: inv.role, invitedBy: inv.invitedBy, invitedAt: inv.createdAt, ...(await teamPeople(ctx, inv.repo)) });
    }
    return { kind: 'invites', invites: out };
  }

  // 3. Teams open to their work domain.
  const domain = workDomain(a.email);
  if (domain) {
    const open = await teamsForDomain(ctx.svc.redis, domain);
    if (open.length) {
      const asked = await myRequests(ctx.svc.redis, a.email, ctx.now());
      const out: Extract<Entry, { kind: 'domain' }>['teams'] = [];
      for (const { repo, discovery } of open) {
        const { memberCount, people } = await teamPeople(ctx, repo);
        out.push({ repo, name: teamDisplayName(repo), memberCount, people, adminName: await adminNameOf(ctx, discovery), requested: asked.has(repo) });
      }
      // Every matching team, the largest first (the UI shows a few, then "N more").
      out.sort((x, y) => y.memberCount - x.memberCount || x.name.localeCompare(y.name));
      return { kind: 'domain', domain, teams: out };
    }
  }

  // 4. Nothing yet.
  return { kind: 'create' };
}

// ---------------------------------------------------------------------------------------------------------------
// Admins

/** The account's linked GitHub account is an admin of the repository (read by the app, matched by GitHub id). */
async function requireAdmin(ctx: Ctx, a: Account, repoArg: unknown): Promise<{ owner: string; repo: string; full: string; login: string }> {
  const { owner, repo, full } = parseRepo(repoArg);
  if (!a.github) throw new HttpError(403, 'forbidden', ADMIN_ONLY);
  if (!ctx.svc.app) throw new HttpError(503, 'not_configured', APP_MISSING);
  const token = await ctx.svc.app.installationToken(owner, repo);
  if (!token) throw new HttpError(403, 'forbidden', ADMIN_ONLY);
  const r = await gh(ctx.f, token, `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(a.github.login)}/permission`);
  if (r.status !== 200 || r.data?.permission !== 'admin' || r.data?.user?.id !== a.github.id) throw new HttpError(403, 'forbidden', ADMIN_ONLY);
  return { owner, repo, full, login: a.github.login };
}

/** The emails of the team's admins that have a Bridge account (GitHub admins matched by id to linked accounts). */
async function adminEmails(ctx: Ctx, repo: string): Promise<string[]> {
  let people: any[] | null = null;
  try {
    people = await collaboratorsOf(ctx, repo);
  } catch {
    people = null;
  }
  const out: string[] = [];
  for (const p of people ?? []) {
    if (p?.permissions?.admin !== true || !Number.isSafeInteger(p.id)) continue;
    const email = await ctx.svc.redis.cmd('GET', `bridge:account:gh:${p.id}`);
    if (typeof email !== 'string') continue;
    const raw = await ctx.svc.redis.cmd('GET', `bridge:account:${email}`);
    try {
      const acc = typeof raw === 'string' ? (JSON.parse(raw) as Account) : null;
      if (acc && acc.github?.id === p.id && !out.includes(acc.email)) out.push(acc.email);
    } catch {
      /* skipped */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Emails

export function requestEmail(x: { to: string; name: string; email: string; team: string; link: string }): EmailMessage {
  const subject = `${x.name} asked to join ${x.team} on Bridge`;
  const text = [
    `${x.name} (${x.email}) asked to join the ${x.team} design system on Bridge, with their work email.`,
    '',
    `Review the request in Settings, Members: ${x.link}`,
    '',
    'If you approve, they join with Can edit. The request expires in 14 days.',
    'If you do not know this person, decline it.',
  ].join('\n');
  const html = [
    `<p>${escHtml(x.name)} (${escHtml(x.email)}) asked to join the <strong>${escHtml(x.team)}</strong> design system on Bridge, with their work email.</p>`,
    `<p><a href="${escHtml(x.link)}">Review the request</a></p>`,
    '<p>If you approve, they join with Can edit. The request expires in 14 days.</p>',
    '<p>If you do not know this person, decline it.</p>',
  ].join('\n');
  return { to: x.to, subject, text, html };
}

export function approvedEmail(x: { to: string; admin: string; team: string; link: string }): EmailMessage {
  const subject = `You joined ${x.team} on Bridge`;
  const text = [`${x.admin} approved your request. You joined the ${x.team} design system with Can edit.`, '', `Open it: ${x.link}`].join('\n');
  const html = [
    `<p>${escHtml(x.admin)} approved your request. You joined the <strong>${escHtml(x.team)}</strong> design system with Can edit.</p>`,
    `<p><a href="${escHtml(x.link)}">Open it</a></p>`,
  ].join('\n');
  return { to: x.to, subject, text, html };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

/** Joins with an invite sent to the account's email: Can edit with the email, reviewer and admin with linked GitHub. */
async function acceptInvite(ctx: Ctx, req: Request, a: Account, inv: StoredInvite): Promise<Response> {
  const email = a.email.toLowerCase();
  if (inv.email.trim().toLowerCase() !== email || Date.parse(inv.expiresAt) <= ctx.now()) return fail(410, 'expired', INVITE_GONE);
  if (inv.role === 'edit') {
    const prev = await ctx.svc.members.get(inv.repo, email);
    const member: EmailMember = { email, name: a.name, role: 'edit', version: (prev?.version ?? 0) + 1, addedBy: inv.invitedBy, at: new Date(ctx.now()).toISOString() };
    await ctx.svc.members.put(inv.repo, member);
    await ctx.svc.invites.remove(inv);
    await removeRequest(ctx.svc.redis, inv.repo, email);
    return json(200, { joined: true, status: 'joined', repo: inv.repo, role: 'edit', next: teamHref(inv.repo) });
  }
  if (!a.github) return fail(409, 'github-required', GITHUB_REQUIRED);
  if (!ctx.svc.grantApp) return fail(503, 'not_configured', APP_MISSING);
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  const r = await acceptInviteForGithub(
    { f: ctx.f, now: ctx.now, random: ctx.random, app: ctx.svc.grantApp, store: ctx.svc.invites, members: ctx.svc.members },
    inv,
    a.github.id,
    bearer && GH_TOKEN.test(bearer) ? bearer : null,
  );
  await removeRequest(ctx.svc.redis, inv.repo, email);
  return json(200, { joined: true, ...r, repo: inv.repo, next: teamHref(inv.repo) });
}

async function onRequest(ctx: Ctx, req: Request, a: Account, body: Record<string, unknown>): Promise<Response> {
  const { owner, repo, full } = parseRepo(body.repo);
  const email = a.email.toLowerCase();
  // An invite for this team wins: accepted straight away, no request.
  const inv = (await ctx.svc.invites.byEmail(email)).find((i) => i.repo.toLowerCase() === full);
  if (inv) return acceptInvite(ctx, req, a, inv);
  if (await ctx.svc.members.get(full, email)) return fail(409, 'already', ALREADY);
  // Only a team open to this very work domain; any other answers like a team that does not exist.
  const domain = workDomain(email);
  const d = domain ? await getDiscovery(ctx.svc.redis, full) : null;
  if (!domain || !d || !d.enabled || d.domain !== domain) return fail(404, 'not_found', NOT_OPEN);
  const now = ctx.now();
  const pending = await getRequest(ctx.svc.redis, full, email, now);
  if (pending) return json(200, { requested: true, already: true, expiresAt: pending.expiresAt });
  const day = dayOf(now);
  await bumpOrRefuse(
    ctx,
    [`bridge:joinreq:count:email:${hmacHex(ctx.svc.secret, `email:${email}`)}:${day}`, `bridge:joinreq:count:ip:${hmacHex(ctx.svc.secret, `ip:${clientIp(req)}`)}:${day}`, `bridge:joinreq:count:team:${full}:${day}`],
    [REQUEST_LIMITS.email, REQUEST_LIMITS.ip, REQUEST_LIMITS.team],
    ['email', 'ip', 'team'],
  );
  const r: JoinRequest = {
    id: Buffer.from(ctx.random(8)).toString('hex'),
    repo: full,
    email,
    name: a.name,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + JOIN_REQUEST_TTL_MS).toISOString(),
  };
  await putRequest(ctx.svc.redis, r, now);
  if (ctx.svc.email) {
    const link = `${siteOrigin(req, ctx.env.PUBLIC_SITE_URL)}${STUDIO_ROOT}${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/settings/`;
    const team = teamDisplayName(full);
    for (const to of await adminEmails(ctx, full)) {
      if (to === email) continue;
      try {
        await ctx.svc.email.send(requestEmail({ to, name: a.name, email, team, link }));
      } catch {
        // The request stands: admins see it in Settings, Members.
      }
    }
  }
  return json(200, { requested: true, expiresAt: r.expiresAt });
}

/** The requester takes back their own request: only the one keyed by the account's email, never someone else's. */
async function onCancel(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const { full } = parseRepo(body.repo);
  const email = a.email.toLowerCase();
  if (!(await getRequest(ctx.svc.redis, full, email, ctx.now()))) return fail(404, 'not_found', REQUEST_GONE);
  await removeRequest(ctx.svc.redis, full, email);
  return json(200, { cancelled: true });
}

async function findRequest(ctx: Ctx, repo: string, id: unknown): Promise<JoinRequest> {
  if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(404, 'not_found', REQUEST_GONE);
  const r = (await listRequests(ctx.svc.redis, repo, ctx.now())).find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'not_found', REQUEST_GONE);
  return r;
}

async function onApprove(ctx: Ctx, req: Request, a: Account, body: Record<string, unknown>): Promise<Response> {
  const admin = await requireAdmin(ctx, a, body.repo);
  const r = await findRequest(ctx, admin.full, body.id);
  const prev = await ctx.svc.members.get(admin.full, r.email);
  const member: EmailMember = prev ?? { email: r.email, name: r.name, role: 'edit', version: 1, addedBy: admin.login, at: new Date(ctx.now()).toISOString() };
  if (!prev) await ctx.svc.members.put(admin.full, member);
  await removeRequest(ctx.svc.redis, admin.full, r.email);
  if (ctx.svc.email && !prev) {
    const link = `${siteOrigin(req, ctx.env.PUBLIC_SITE_URL)}${STUDIO_ROOT}${encodeURIComponent(admin.owner)}/${encodeURIComponent(admin.repo)}/`;
    try {
      await ctx.svc.email.send(approvedEmail({ to: r.email, admin: a.name, team: teamDisplayName(admin.full), link }));
    } catch {
      // They are on the team; Bridge shows it at their next sign-in.
    }
  }
  return json(200, { member: { name: member.name, role: member.role }, repo: admin.full });
}

async function onDecline(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const admin = await requireAdmin(ctx, a, body.repo);
  const r = await findRequest(ctx, admin.full, body.id);
  await removeRequest(ctx.svc.redis, admin.full, r.email);
  return json(200, { ok: true });
}

async function onDiscovery(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.enabled !== 'boolean') return fail(400, 'bad_request', 'Say whether the team is open: enabled true or false.');
  const admin = await requireAdmin(ctx, a, body.repo);
  const domain = workDomain(a.email);
  const prev = await getDiscovery(ctx.svc.redis, admin.full);
  const by = { byGithubId: a.github!.id, byLogin: a.github!.login, at: new Date(ctx.now()).toISOString() };
  if (body.enabled) {
    if (!domain) return fail(409, 'public-domain', PUBLIC_DOMAIN);
    await putDiscovery(ctx.svc.redis, admin.full, { domain, enabled: true, ...by });
    return json(200, { domain, enabled: true });
  }
  if (prev) await putDiscovery(ctx.svc.redis, admin.full, { ...prev, enabled: false, ...by });
  return json(200, { domain: prev?.domain ?? domain, enabled: false });
}

async function onAction(ctx: Ctx, req: Request, a: Account): Promise<Response> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const body = await readBody(req, MAX_BODY);
  switch (body.action) {
    case 'accept-invite': {
      const { full } = parseRepo(body.repo);
      const inv = typeof body.id === 'string' && ID.test(body.id) ? await ctx.svc.invites.get(full, body.id) : null;
      // Someone else's invite answers like a missing one.
      if (!inv || inv.email.trim().toLowerCase() !== a.email.toLowerCase()) return fail(410, 'expired', INVITE_GONE);
      return acceptInvite(ctx, req, a, inv);
    }
    case 'request':
      return onRequest(ctx, req, a, body);
    case 'cancel-request':
      return onCancel(ctx, a, body);
    case 'approve':
      return onApprove(ctx, req, a, body);
    case 'decline':
      return onDecline(ctx, a, body);
    case 'discovery':
      return onDiscovery(ctx, a, body);
    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The handler

export async function handleEntry(req: Request, env: EntryEnv, deps: EntryDeps): Promise<Response> {
  try {
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST') return json(405, { error: 'method', message: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    if (method === 'POST') requireCsrf(req);
    const svc = services(env, deps);
    if (!svc) return fail(503, 'not_configured', NOT_CONFIGURED);
    const ctx: Ctx = { f: deps.fetch, now: deps.now ?? Date.now, random: deps.random ?? ((n) => randomBytes(n)), svc, env };
    const a = await sessionAccount(req, svc.redis, svc.secret, ctx.now());
    if (!a) return fail(401, 'signin', SIGNIN);
    if (method === 'POST') return await onAction(ctx, req, a);
    const params = new URL(req.url).searchParams;
    const noStore = { 'Cache-Control': 'private, no-store' };
    const requestsOf = params.get('requests');
    if (requestsOf !== null) {
      const admin = await requireAdmin(ctx, a, requestsOf);
      const list = await listRequests(svc.redis, admin.full, ctx.now());
      return json(200, { requests: list.map(({ id, name, email, createdAt, expiresAt }) => ({ id, name, email, createdAt, expiresAt })) }, noStore);
    }
    const discoveryOf = params.get('discovery');
    if (discoveryOf !== null) {
      const admin = await requireAdmin(ctx, a, discoveryOf);
      const d = await getDiscovery(svc.redis, admin.full);
      const mine = workDomain(a.email);
      return json(200, { domain: d?.domain ?? mine, enabled: d?.enabled ?? false, configured: Boolean(d), eligible: Boolean(mine) }, noStore);
    }
    return json(200, await entryFor(ctx, req, a), noStore);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers);
    return fail(502, 'unreachable', GITHUB_DOWN);
  }
}

const envFromProcess = (): EntryEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  INVITE_EMAIL_FROM: process.env.INVITE_EMAIL_FROM,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleEntry(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
