// /api/entry: where a person goes once their Bridge account is verified (email code or GitHub), and the join requests
// and team discovery that route needs (docs/HOSTED.md, "Accounts").
//
// GET /api/entry answers one `kind`, the first rule that matches:
//   1. teams    they are on teams already: email memberships, plus, only for an account that already has GitHub
//               linked and when the request carries that GitHub account's own token (Bearer), the repositories the
//               Bridge app is installed on where it can push or administer (GitHub proves the rights). Sign-in is by
//               email; GitHub is never needed here
//               { kind: 'teams', teams: [{ repo, id, name, role: 'edit' | 'reviewer' | 'admin', via: 'email' | 'github' }] }
//   2. invites  invites wait for their email
//               { kind: 'invites', invites: [{ id, team, repo, role, reviewAs?, invitedBy, invitedAt, memberCount, people }] }
//               (accept-invite joins directly)
//   3. domain   teams whose admin opened them to the person's work domain, all of them, largest first
//               { kind: 'domain', domain, teams: [{ id, name, memberCount, people, adminName, requested, expired }] }
//               `id`: an opaque team id (the person is not a member: the repository is never named). `expired`:
//               their last request ran out unanswered.
//   `people`: the names of the first few people on the team (admins first, at most PEOPLE_SHOWN), for the avatars of
//   the team card; the card shows the rest as "+N" from memberCount. Names only, never an email; on a domain card
//   (people not on the team yet) first names and an initial only ("Sam R.").
//   4. create   { kind: 'create' }
// Public and free mailbox domains (api/_lib/domains.ts) never match and can never be opened.
//
// Other endpoints (JSON, errors are { error, message } in Studio words). All need the account cookie (api/account):
//   GET  /api/entry?requests=owner/name     admin: { requests: [{ id, name, email, createdAt, expiresAt }] }
//   GET  /api/entry?discovery=owner/name    admin: { domain, enabled, configured, eligible }
//   POST { action: 'invite-link', token }  what an invite link (/studio/invite/#t=<token>) is, signed in or not (the
//                                           only call without the cookie; capped per network):
//            { state: 'live', team, invitedBy, role, reviewAs?, sentTo (masked), signedIn, mine, member, invite?, repo? }
//            { state: 'gone', team, invitedBy, signedIn, member, repo? }   accepted, cancelled or expired
//            { state: 'unknown', signedIn }                                 a token Bridge never knew
//            `invite` (an E3 card, as in GET) only when the invite is the signed-in account's own; `repo` only for
//            a member of that team (to open it). Never the invited email, only masked.
//   POST { action: 'accept-invite', repo, id }   the invite sent to the account email; joins directly
//                                                { joined: true, status, repo, role, next }
//   POST { action: 'request', team }        asks to join a team open to their work domain, by its opaque id (`repo`
//                                           works too); an invite for that team is accepted instead: { joined: true,
//                                           ... }; { requested: true, expiresAt }; 409 already { repo } for a member
//   POST { action: 'cancel-request', team }  the requester takes back their own pending request (keyed by the
//                                           account email, so nobody else's); { cancelled: true }, 404 when none waits
//   POST { action: 'approve', repo, id }    admin: the requester joins with Can edit; { member: { name, role }, repo }
//   POST { action: 'decline', repo, id }    admin: { ok: true }
//   POST { action: 'undo', repo, id }       admin, within 30 s of an approve or decline: the request waits again and a
//                                           person the approve added leaves; { undone: true, request }, 410 after
//   POST { action: 'discovery', repo, enabled }  admin: opens the team to the admin's own work domain, or closes it;
//                                           { domain, enabled }
//   POST { action: 'create-team', name, discover }  "Create your team" step 1: a real team before any repository, its
//                                           creator its first admin, open to their work domain when `discover` (never a
//                                           public one). One team without a repository per creator: calling it again
//                                           renames that team and changes its discovery. { team, created }
//   POST { action: 'rename-team', team, name }  admin of a team made in Bridge (no repository yet): renames it, nothing
//                                           else changes (discovery stays). 404 for anyone not on it, 403 for a member
//                                           who is not admin, 409 linked once it has a repository (bridge.config.json
//                                           names it then). { team }
//   GET  /api/entry?team=_team/<id>         a member of a team made in Bridge: { team } (name, role, repo, storybook,
//                                           discovery, memberCount, people: names and roles, never an email, for its
//                                           Settings); 404 for anyone else, like a team that does not exist
//   GET  /api/entry?ai-tools=<team>         a member of the team (email member, or the linked GitHub account on its
//                                           repository): { tools } the team default of the AI tools new members start
//                                           from (src/lib/ai-tools.ts), null when none; 404 for anyone else
//   POST { action: 'ai-tools', team, tools }  admin: sets that default (null or [] clears it); { tools }, 400 bad_tools
//   POST { action: 'link-team', team, storybook }  admin: keeps the Storybook connected with the quick start. { team }
//   POST { action: 'link-team', team, repo }  admin of the team and of the repository: the team moves to the repository
//                                           (members, admins, discovery, requests, invites, name). { repo, next }
// A team made in Bridge goes by its key `_team/<id>` (src/lib/team-path.ts) until a repository is linked; every
// action that takes `repo` takes that key too, and an old key resolves to the repository it was linked to.
// Every POST carries `X-Bridge-Contribute: 1` (or `X-Bridge-Account: 1`), JSON, and an Origin of this site (CSRF).
//
// Admins: an email member the team made Admin (api/_lib/members.ts: members, requests, discovery, settings and invites
// need no GitHub), or the account's linked GitHub account is an admin of the repository, read with the Bridge app's
// installation token on every call (the GitHub id must match, so a renamed login never passes for another). A team made
// in Bridge without a repository has email admins only. Nothing the browser says about its role is trusted. `npm run dev:full` only: an account seeded as admin (api/_lib/local-admin.ts) passes
// without GitHub; the Vercel exports never pass that dependency and it is ignored outside local mode.
//
// Privacy: other members' emails never leave here. A domain team or an invite shows the admin or inviter by their
// display name (GitHub profile name, else Bridge account name, else GitHub login: displayName in api/_lib/account.ts),
// the team's size and the names of its first few people. Admins see a requester's name and email, like an invite. A
// team that did not open itself to a domain is never listed, and asking to join it answers the same 404 as a team that
// does not exist. Requests expire after 14 days; deleting the account deletes them.
//
// Storage: api/_lib/teams.ts (discovery, requests, the AI tools default), api/_lib/members.ts (memberships), api/invites (invites by email).
// Env (server only): KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_ pair), LIBRARY_SESSION_SECRET,
// GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (admins, sizes, reviewer and admin invites), RESEND_API_KEY +
// INVITE_EMAIL_FROM (request emails), PUBLIC_SITE_URL (optional).

import { createHmac, randomBytes } from 'node:crypto';
import { type Account, accountNameByGithub, displayName, sessionAccount } from '../_lib/account.js';
import { workDomain } from '../_lib/domains.js';
import { escHtml, resendSender, type EmailMessage, type EmailSender } from '../_lib/email.js';
import { githubApp, type AppTokens } from '../_lib/github-app.js';
import { activeLocalAdmins, type LocalAdmins } from '../_lib/local-admin.js';
import { clientIp, dayOf, fail, GITHUB_DOWN, HttpError, json, parseRepo, readBody, sameOrigin, secondsToTomorrow, sha256, siteOrigin, type FetchLike } from '../_lib/http.js';
import { accountTeamsKey, memberStore, type EmailMember, type MemberStore } from '../_lib/members.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import {
  configName,
  forgetTeamKey,
  getTeamRecord,
  parseTeam,
  resolveTeam as resolveTeamOn,
  type TeamRef,
  putTeamRecord,
  type TeamRecord,
  type Discovery,
  getDiscovery,
  getTeamNames,
  getTeamAiTools,
  putTeamAiTools,
  getRequest,
  JOIN_REQUEST_TTL_MS,
  type JoinRequest,
  listRequests,
  myRequests,
  putDecided,
  putDiscovery,
  putRequest,
  putTeamName,
  removeRequest,
  takeDecided,
  TEAM_NAME_MAX_AGE_MS,
  teamsForDomain,
} from '../_lib/teams.js';
import { acceptInviteForGithub, githubApp as invitesApp, inviteStoreOn, maskEmail, type InviteStore, type StoredInvite } from '../invites/index.js';
import { teamDisplayName } from '../../src/lib/demo.js';
import { parseAiTools } from '../../src/lib/ai-tools.js';
import { isTeamKey, STUDIO_ROOT, teamHref as studioTeamHref, teamKeyId, teamKeyOf } from '../../src/lib/team-path.js';

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
  /** `npm run dev:full` only (api/_lib/local-admin.ts): admins seeded locally, ignored outside local mode. */
  localAdmins?: LocalAdmins;
}

export type EntryTeamRole = 'edit' | 'reviewer' | 'admin';

export type Entry =
  | { kind: 'teams'; teams: { repo: string; id: string; name: string; role: EntryTeamRole; via: 'email' | 'github' }[] }
  | { kind: 'invites'; invites: EntryInviteCard[] }
  | { kind: 'domain'; domain: string; teams: { id: string; name: string; memberCount: number; people: string[]; adminName: string; requested: boolean; expired: boolean }[] }
  | { kind: 'create' };

export interface EntryInviteCard {
  id: string;
  team: string;
  repo: string;
  role: string;
  reviewAs?: string;
  invitedBy: string;
  invitedAt: string;
  memberCount: number;
  people: string[];
}

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
export const ADMIN_ONLY_TEAM = 'Only admins of this team can do this. Ask an admin of the team to make you one.';
export const TEAM_GONE = 'This team no longer exists, or you are not on it.';
export const BAD_TEAM_NAME = 'Name your team: 1 to 60 characters.';
export const REPO_ADMIN_ONLY = 'Only an admin of this repository on GitHub can connect it to your team. Ask them, or connect your GitHub account if it is you.';
export const ALREADY_LINKED = (repo: string) => `This team is already connected to ${repo}.`;
export const LINK_APP_MISSING = 'Bridge is not installed on this repository yet. Open it and install Bridge: your team moves there once it is.';
export const BAD_STORYBOOK = 'Paste the address of your published Storybook, starting with https://.';
export const PUBLIC_DOMAIN = 'Teams open to a work email only. Your account uses a public email, like Gmail or Outlook: sign in with your work email to turn this on.';
export const GITHUB_REQUIRED = 'Reviewers approve changes on GitHub. Continue with GitHub, then accept this invite.';
export const ALREADY = 'You are already on this team.';
export const INVITE_GONE = 'This invite expired or was cancelled. Ask your admin for a new one.';
export const REQUEST_GONE = 'This request expired or was already answered.';
export const UNDO_GONE = 'It is too late to undo this. Change who is on the team from Members.';
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
  /** Local mode only (api/_lib/local-admin.ts); always null in production. */
  localAdmins: LocalAdmins | null;
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
    localAdmins: activeLocalAdmins(deps.localAdmins),
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
/**
 * A member as colleagues outside the team see them on its card: the first name and the initial of the last ("Sam R."),
 * enough for the avatar's initials, never the whole name (/privacy/ says so).
 */
export const firstNameOnly = (name: string): string => {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
};

/** A team as people outside it know it: an opaque id, stable for the site, that never names the repository. */
export const teamId = (secret: string, repo: string) => `t${hmacHex(secret, `team:${repo.trim().toLowerCase()}`).slice(0, 20)}`;
const TEAM_ID = /^t[a-f0-9]{20}$/;
const teamHref = (repo: string) => {
  const [o, r] = repo.split('/') as [string, string];
  // A team made in Bridge, no repository yet: its home is the workspace page.
  if (isTeamKey(repo)) return studioTeamHref(o, r, null);
  return `${STUDIO_ROOT}${encodeURIComponent(o)}/${encodeURIComponent(r)}/`;
};
/** Where an admin reviews requests: the team's Settings, or the home of a team made in Bridge. */
const manageHref = (repo: string) => (isTeamKey(repo) ? teamHref(repo) : `${teamHref(repo)}settings/`);

export { parseTeam, type TeamRef };

/** The team an action names, a key whose team has been linked to a repository since resolving to that repository. */
const resolveTeam = (ctx: Ctx, v: unknown): Promise<TeamRef> => resolveTeamOn(ctx.svc.redis, v);

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
  let account: string | null = null;
  try {
    account = await accountNameByGithub(ctx.svc.redis, githubId);
  } catch {
    account = null;
  }
  return displayName(account, login);
}

/** The admin's name for a domain team card: the display name kept when they opened the team, else read now. */
const adminNameOf = async (ctx: Ctx, d: Discovery): Promise<string> => (d.byName ? displayName(d.byName, d.byLogin) : githubNameOf(ctx, d.byGithubId, d.byLogin));

/**
 * A GitHub admin's display name, the one invites keep: GitHub profile name (read with the app's token), else their
 * Bridge account name, else the login.
 */
async function adminDisplayName(ctx: Ctx, token: string, a: Account): Promise<string> {
  const gh1 = a.github!;
  let profile: string | null = null;
  try {
    const r = await gh(ctx.f, token, `/user/${gh1.id}`);
    profile = r.status === 200 && r.data?.id === gh1.id && typeof r.data?.name === 'string' ? r.data.name : null;
  } catch {
    profile = null;
  }
  return displayName(profile, a.name, gh1.login);
}

/** GitHub collaborators of a team, through the app; null when the app cannot read it. */
async function collaboratorsOf(ctx: Ctx, repo: string): Promise<any[] | null> {
  if (!ctx.svc.app || isTeamKey(repo)) return null;
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
async function teamPeople(ctx: Ctx, repo: string): Promise<{ memberCount: number; people: string[]; nameOfLogin: (login: string) => Promise<string> }> {
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
  // Email admins first (a team made in Bridge has no GitHub people), then the others.
  for (const m of [...emails].sort((x, y) => Number(y.role === 'admin') - Number(x.role === 'admin'))) {
    if (people.length >= PEOPLE_SHOWN) break;
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (name && !name.includes('@')) people.push(name);
  }
  // An inviter of an older invite, kept by login only: their display name when they are a collaborator (no extra call).
  const nameOfLogin = async (login: string) => {
    const c = github.find((x) => String(x.login).toLowerCase() === login.toLowerCase());
    return c ? githubNameOf(ctx, c.id, c.login) : login;
  };
  return { memberCount: emails.length + collaborators.length, people, nameOfLogin };
}


// ---------------------------------------------------------------------------------------------------------------
// Team names

/** bridge.config.json `name` on the default branch, read with the Bridge app; undefined when GitHub cannot say. */
async function readConfigName(ctx: Ctx, repo: string): Promise<string | null | undefined> {
  const [owner, name] = repo.split('/');
  // A team made in Bridge has no settings file: its name is the one it was given.
  if (!owner || !name || !ctx.svc.app || isTeamKey(repo)) return undefined;
  try {
    const token = await ctx.svc.app.installationToken(owner, name);
    if (!token) return undefined;
    const file = await gh(ctx.f, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/bridge.config.json`);
    if (file.status === 404) return null;
    if (file.status !== 200 || typeof file.data?.content !== 'string') return undefined;
    return configName(JSON.parse(Buffer.from(file.data.content, 'base64').toString('utf8')));
  } catch {
    return undefined;
  }
}

/**
 * The name each team goes by (lib/demo.ts teamDisplayName): its bridge.config.json `name` as kept with the team, read
 * again from GitHub (and kept) when none is kept or it is a day old, else the repository in words. Never fails.
 */
export async function teamNamesOf(ctx: Ctx, repos: readonly string[]): Promise<(repo: string) => string> {
  let kept = new Map<string, { name: string; at: number }>();
  try {
    kept = await getTeamNames(ctx.svc.redis, repos);
  } catch {
    // Storage hiccup: the repository in words.
  }
  const stale = [...new Set(repos.map((r) => r.toLowerCase()))].filter((r) => {
    const k = kept.get(r);
    return !k || ctx.now() - k.at > TEAM_NAME_MAX_AGE_MS;
  });
  await Promise.all(
    stale.map(async (repo) => {
      const read = await readConfigName(ctx, repo);
      if (read === undefined) return;
      await putTeamName(ctx.svc.redis, repo, read, ctx.now());
      if (read) kept.set(repo, { name: read, at: ctx.now() });
      else kept.delete(repo);
    }),
  );
  return (repo) => teamDisplayName(repo, { name: kept.get(repo.toLowerCase())?.name });
}

/** An invite as its E3 card shows it: the team, who invited and when, the role, the team's people. */
async function inviteCard(ctx: Ctx, inv: StoredInvite, team: string): Promise<EntryInviteCard> {
  const { memberCount, people, nameOfLogin } = await teamPeople(ctx, inv.repo);
  const invitedBy = inv.invitedByName ? displayName(inv.invitedByName, inv.invitedBy) : await nameOfLogin(inv.invitedBy);
  return { id: inv.id, team, repo: inv.repo, role: inv.role, ...(inv.reviewAs ? { reviewAs: inv.reviewAs } : {}), invitedBy, invitedAt: inv.createdAt, memberCount, people };
}

// ---------------------------------------------------------------------------------------------------------------
// GET: the routing

export async function entryFor(ctx: Ctx, req: Request, a: Account): Promise<Entry> {
  // 1. Teams they are on (in local mode, a team they were seeded admin of counts, as admin).
  const local = ctx.svc.localAdmins ? await ctx.svc.localAdmins.teamsOf(a.email) : [];
  const memberships = await membershipsOf(ctx, a.email);
  const emailAdmin = new Set(memberships.filter(({ member }) => member.role === 'admin').map(({ repo }) => repo));
  const memberOf = memberships.map(({ repo }) => repo);
  const emailRepos = [...new Set([...memberOf, ...local])];
  const githubRepos = (await githubTeams(ctx, req, a)).filter((t) => !emailRepos.includes(t.repo));
  // Each team by its configured name (bridge.config.json), kept with the team: the picker never shows the slug.
  const nameOf = await teamNamesOf(ctx, [...emailRepos, ...githubRepos.map((t) => t.repo)]);
  const email = emailRepos.map((repo) => ({ repo, name: nameOf(repo), role: (local.includes(repo) || emailAdmin.has(repo) ? 'admin' : 'edit') as EntryTeamRole, via: 'email' as const }));
  const github = githubRepos.map((t) => ({ ...t, name: nameOf(t.repo), via: 'github' as const }));
  const teams = [...email, ...github].map((t) => ({ ...t, id: teamId(ctx.svc.secret, t.repo) })).sort((x, y) => x.name.localeCompare(y.name));
  if (teams.length) return { kind: 'teams', teams };

  // 2. Invites waiting for their email.
  const invites = await ctx.svc.invites.byEmail(a.email);
  if (invites.length) {
    const out: EntryInviteCard[] = [];
    const nameOf = await teamNamesOf(ctx, invites.map((inv) => inv.repo));
    for (const inv of invites) out.push(await inviteCard(ctx, inv, nameOf(inv.repo)));
    return { kind: 'invites', invites: out };
  }

  // 3. Teams open to their work domain.
  const domain = workDomain(a.email);
  if (domain) {
    const open = await teamsForDomain(ctx.svc.redis, domain);
    if (open.length) {
      const asked = await myRequests(ctx.svc.redis, a.email, ctx.now());
      const out: Extract<Entry, { kind: 'domain' }>['teams'] = [];
      const nameOf = await teamNamesOf(ctx, open.map((t) => t.repo));
      for (const { repo, discovery } of open) {
        const { memberCount, people } = await teamPeople(ctx, repo);
        const state = asked.get(repo);
        out.push({ id: teamId(ctx.svc.secret, repo), name: nameOf(repo), memberCount, people: people.map(firstNameOnly), adminName: await adminNameOf(ctx, discovery), requested: state === 'pending', expired: state === 'expired' });
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

interface Admin extends TeamRef {
  /** The GitHub login, '' for an email admin without GitHub. */
  login: string;
  /** The app's installation token, for a GitHub admin only. */
  token: string;
  /** github: an admin of the repository on GitHub; email: an email member made Admin; local: seeded by
   *  `npm run dev:full` (api/_lib/local-admin.ts). Only a GitHub admin has a GitHub profile to read. */
  via: 'github' | 'email' | 'local';
}

/**
 * An admin of the team: an email member made Admin (no GitHub needed), or the account's linked GitHub account is an
 * admin of the repository (read by the app, matched by GitHub id). A team made in Bridge without a repository has email
 * admins only. In local mode only, an account seeded as admin of the team passes too.
 */
async function requireAdmin(ctx: Ctx, a: Account, repoArg: unknown): Promise<Admin> {
  const t = await resolveTeam(ctx, repoArg);
  const { owner, repo, full } = t;
  if (ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(full, a.email))) return { ...t, login: a.github?.login ?? 'local-admin', token: '', via: 'local' };
  if ((await ctx.svc.members.get(full, a.email))?.role === 'admin') return { ...t, login: a.github?.login ?? '', token: '', via: 'email' };
  if (t.id) throw new HttpError(403, 'forbidden', ADMIN_ONLY_TEAM);
  if (!a.github) throw new HttpError(403, 'forbidden', ADMIN_ONLY);
  if (!ctx.svc.app) throw new HttpError(503, 'not_configured', APP_MISSING);
  const token = await ctx.svc.app.installationToken(owner, repo);
  if (!token) throw new HttpError(403, 'forbidden', ADMIN_ONLY);
  const r = await gh(ctx.f, token, `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(a.github.login)}/permission`);
  if (r.status !== 200 || r.data?.permission !== 'admin' || r.data?.user?.id !== a.github.id) throw new HttpError(403, 'forbidden', ADMIN_ONLY);
  return { ...t, login: a.github.login, token, via: 'github' };
}

/** The emails of the team's admins that have a Bridge account (GitHub admins matched by id to linked accounts). */
async function adminEmails(ctx: Ctx, repo: string): Promise<string[]> {
  const local = ctx.svc.localAdmins ? await ctx.svc.localAdmins.adminsOf(repo) : [];
  let people: any[] | null = null;
  try {
    people = await collaboratorsOf(ctx, repo);
  } catch {
    people = null;
  }
  const out: string[] = [...local];
  for (const m of await ctx.svc.members.list(repo)) if (m.role === 'admin' && !out.includes(m.email)) out.push(m.email);
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

/**
 * Joins with an invite sent to the account's email. Can edit and Admin join with the email (an admin needs GitHub only
 * to approve on GitHub); with GitHub linked, an Admin invite to a repository gives the GitHub admin role as before.
 * Reviewer needs linked GitHub. A team made in Bridge has no GitHub side: Admin joins as an email admin.
 */
async function acceptInvite(ctx: Ctx, req: Request, a: Account, inv: StoredInvite): Promise<Response> {
  const email = a.email.toLowerCase();
  if (inv.email.trim().toLowerCase() !== email || Date.parse(inv.expiresAt) <= ctx.now()) return fail(410, 'expired', INVITE_GONE);
  const t = await resolveTeam(ctx, inv.repo);
  if (inv.role === 'edit' || (inv.role === 'admin' && (!a.github || t.id))) {
    const role = inv.role === 'admin' ? 'admin' : 'edit';
    const prev = await ctx.svc.members.get(t.full, email);
    const member: EmailMember = { email, name: a.name, role: prev?.role === 'admin' ? 'admin' : role, version: (prev?.version ?? 0) + 1, addedBy: inv.invitedBy, at: new Date(ctx.now()).toISOString() };
    await ctx.svc.members.put(t.full, member);
    await ctx.svc.invites.remove(inv);
    await removeRequest(ctx.svc.redis, t.full, email);
    return json(200, { joined: true, status: 'joined', repo: t.full, role: member.role, next: teamHref(t.full) });
  }
  if (!a.github || t.id) return fail(409, 'github-required', GITHUB_REQUIRED);
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

/**
 * The team a request names: its opaque id among the teams open to the person's work domain (or, for a cancel, among
 * the teams they asked), else a repository. A team the person cannot see answers like one that does not exist.
 */
async function requestedTeam(ctx: Ctx, a: Account, body: Record<string, unknown>, among: 'domain' | 'mine'): Promise<string> {
  // A repository, or the key of a team made in Bridge (an old key resolves to the repository it was linked to).
  if (body.team === undefined) return (await resolveTeam(ctx, body.repo)).full;
  if (typeof body.team !== 'string' || !TEAM_ID.test(body.team)) throw new HttpError(404, 'not_found', NOT_OPEN);
  const domain = workDomain(a.email);
  const repos =
    among === 'mine'
      ? [...(await myRequests(ctx.svc.redis, a.email, ctx.now())).keys()]
      : domain
        ? (await teamsForDomain(ctx.svc.redis, domain)).map((t) => t.repo)
        : [];
  const repo = repos.find((r) => teamId(ctx.svc.secret, r) === body.team);
  if (!repo) throw new HttpError(404, 'not_found', among === 'mine' ? REQUEST_GONE : NOT_OPEN);
  return parseTeam(repo).full;
}

async function onRequest(ctx: Ctx, req: Request, a: Account, body: Record<string, unknown>): Promise<Response> {
  const full = await requestedTeam(ctx, a, body, 'domain');
  const email = a.email.toLowerCase();
  // An invite for this team wins: accepted straight away, no request.
  const inv = (await ctx.svc.invites.byEmail(email)).find((i) => i.repo.toLowerCase() === full);
  if (inv) return acceptInvite(ctx, req, a, inv);
  if (await ctx.svc.members.get(full, email)) return json(409, { error: 'already', message: ALREADY, repo: full });
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
    const link = `${siteOrigin(req, ctx.env.PUBLIC_SITE_URL)}${manageHref(full)}`;
    const team = (await teamNamesOf(ctx, [full]))(full);
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
  const full = await requestedTeam(ctx, a, body, 'mine');
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
  const member: EmailMember = prev ?? { email: r.email, name: r.name, role: 'edit', version: 1, addedBy: admin.login || a.name, at: new Date(ctx.now()).toISOString() };
  if (!prev) await ctx.svc.members.put(admin.full, member);
  await removeRequest(ctx.svc.redis, admin.full, r.email);
  await putDecided(ctx.svc.redis, { request: r, approved: true, added: !prev });
  if (ctx.svc.email && !prev) {
    const link = `${siteOrigin(req, ctx.env.PUBLIC_SITE_URL)}${teamHref(admin.full)}`;
    try {
      const team = (await teamNamesOf(ctx, [admin.full]))(admin.full);
      await ctx.svc.email.send(approvedEmail({ to: r.email, admin: admin.via === 'github' ? await adminDisplayName(ctx, admin.token, a) : a.name, team, link }));
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
  await putDecided(ctx.svc.redis, { request: r, approved: false, added: false });
  return json(200, { ok: true });
}

/**
 * The admin takes back an approve or decline within UNDO_TTL_S: the request waits again, and a person the approve
 * added leaves the team. Once the window passed, or after a first undo, 410.
 */
async function onUndo(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const admin = await requireAdmin(ctx, a, body.repo);
  const d = typeof body.id === 'string' && ID.test(body.id) ? await takeDecided(ctx.svc.redis, admin.full, body.id) : null;
  if (!d) return fail(410, 'expired', UNDO_GONE);
  if (d.approved && d.added) await ctx.svc.members.remove(admin.full, d.request.email);
  if (Date.parse(d.request.expiresAt) > ctx.now()) await putRequest(ctx.svc.redis, d.request, ctx.now());
  return json(200, { undone: true, request: { id: d.request.id, name: d.request.name, email: d.request.email, createdAt: d.request.createdAt, expiresAt: d.request.expiresAt } });
}

async function onDiscovery(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.enabled !== 'boolean') return fail(400, 'bad_request', 'Say whether the team is open: enabled true or false.');
  const admin = await requireAdmin(ctx, a, body.repo);
  const domain = workDomain(a.email);
  const prev = await getDiscovery(ctx.svc.redis, admin.full);
  const at = new Date(ctx.now()).toISOString();
  const by =
    admin.via === 'github'
      ? { byGithubId: a.github!.id, byLogin: a.github!.login, byName: await adminDisplayName(ctx, admin.token, a), at }
      : { byGithubId: a.github?.id ?? 0, byLogin: admin.login, byName: a.name, at };
  if (body.enabled) {
    if (!domain) return fail(409, 'public-domain', PUBLIC_DOMAIN);
    await putDiscovery(ctx.svc.redis, admin.full, { domain, enabled: true, ...by });
    return json(200, { domain, enabled: true });
  }
  if (prev) await putDiscovery(ctx.svc.redis, admin.full, { ...prev, enabled: false, ...by });
  return json(200, { domain: prev?.domain ?? domain, enabled: false });
}

// ---------------------------------------------------------------------------------------------------------------
// Teams made in Bridge ("Create your team"): a real team before any repository

/** What a member reads of a team made in Bridge. */
export interface PublicTeam {
  id: string;
  /** `_team/<id>`, or the repository once linked. */
  key: string;
  name: string;
  role: 'edit' | 'admin';
  repo: string | null;
  storybook: string | null;
  discovery: { domain: string; enabled: boolean } | null;
  memberCount: number;
  /** Who is on the team, by name and role (never an email): its Settings name the admins to everyone on it. */
  people: { name: string; role: 'edit' | 'admin' }[];
  createdAt: string;
}

async function publicTeam(ctx: Ctx, rec: TeamRecord, role: 'edit' | 'admin'): Promise<PublicTeam> {
  const key = rec.repo ?? teamKeyOf(rec.id);
  const d = await getDiscovery(ctx.svc.redis, key);
  const list = await ctx.svc.members.list(key);
  const local = ctx.svc.localAdmins ? await ctx.svc.localAdmins.adminsOf(key) : [];
  const people = list.map((m) => ({ name: m.name, role: m.role === 'admin' || local.includes(m.email) ? ('admin' as const) : ('edit' as const) }));
  return { id: rec.id, key, name: rec.name, role, repo: rec.repo, storybook: rec.storybook, discovery: d ? { domain: d.domain, enabled: d.enabled } : null, memberCount: list.length, people, createdAt: rec.createdAt };
}

/** The role of the account on a team made in Bridge, or null when it is not on it. */
async function roleOn(ctx: Ctx, a: Account, key: string): Promise<'edit' | 'admin' | null> {
  if (ctx.svc.localAdmins && (await ctx.svc.localAdmins.isAdmin(key, a.email))) return 'admin';
  return (await ctx.svc.members.get(key, a.email))?.role ?? null;
}

/** The team without a repository this person created and still administers: step 1 renames it, never makes another. */
async function ownTeamWithoutRepo(ctx: Ctx, a: Account): Promise<TeamRecord | null> {
  for (const { repo, member } of await membershipsOf(ctx, a.email)) {
    const id = teamKeyId(repo);
    if (!id || member.role !== 'admin') continue;
    const rec = await getTeamRecord(ctx.svc.redis, id);
    if (rec && !rec.repo && rec.createdBy === a.email.toLowerCase()) return rec;
  }
  return null;
}

async function onCreateTeam(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const name = configName({ name: body.name });
  if (!name) return fail(400, 'bad_name', BAD_TEAM_NAME);
  const email = a.email.toLowerCase();
  const now = ctx.now();
  const at = new Date(now).toISOString();
  const kept = await ownTeamWithoutRepo(ctx, a);
  const rec: TeamRecord = kept ? { ...kept, name } : { id: Buffer.from(ctx.random(8)).toString('hex'), name, createdBy: email, createdAt: at, repo: null, storybook: null };
  const key = teamKeyOf(rec.id);
  await putTeamRecord(ctx.svc.redis, rec);
  if (!kept) await ctx.svc.members.put(key, { email, name: a.name, role: 'admin', version: 1, addedBy: a.name, at });
  await putTeamName(ctx.svc.redis, key, name, now);
  // Found by colleagues with the same work domain: only when asked, and never through a public mailbox domain.
  const domain = workDomain(email);
  const by = { byGithubId: a.github?.id ?? 0, byLogin: a.github?.login ?? '', byName: a.name, at };
  const prev = await getDiscovery(ctx.svc.redis, key);
  if (body.discover === true && domain) await putDiscovery(ctx.svc.redis, key, { domain, enabled: true, ...by });
  else if (prev?.enabled) await putDiscovery(ctx.svc.redis, key, { ...prev, enabled: false, ...by });
  return json(200, { team: await publicTeam(ctx, rec, 'admin'), created: !kept });
}

/** An admin renames a team made in Bridge before any repository. Discovery, members and requests stay as they are. */
async function onRenameTeam(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.team === 'string' ? teamKeyId(body.team) : null;
  const rec = id ? await getTeamRecord(ctx.svc.redis, id) : null;
  if (!rec) return fail(404, 'not_found', TEAM_GONE);
  const key = teamKeyOf(rec.id);
  const role = await roleOn(ctx, a, rec.repo ?? key);
  if (!role) return fail(404, 'not_found', TEAM_GONE);
  if (rec.repo) return fail(409, 'linked', ALREADY_LINKED(rec.repo));
  if (role !== 'admin') return fail(403, 'forbidden', ADMIN_ONLY_TEAM);
  const name = configName({ name: body.name });
  if (!name) return fail(400, 'bad_name', BAD_TEAM_NAME);
  const next = { ...rec, name };
  await putTeamRecord(ctx.svc.redis, next);
  await putTeamName(ctx.svc.redis, key, name, ctx.now());
  return json(200, { team: await publicTeam(ctx, next, 'admin') });
}

/** A team made in Bridge, read by one of its members. Anyone else gets the answer of a team that does not exist. */
async function onGetTeam(ctx: Ctx, a: Account, arg: string): Promise<Response> {
  const id = teamKeyId(arg);
  const rec = id ? await getTeamRecord(ctx.svc.redis, id) : null;
  if (!rec) return fail(404, 'not_found', TEAM_GONE);
  const role = await roleOn(ctx, a, rec.repo ?? teamKeyOf(rec.id));
  if (!role) return fail(404, 'not_found', TEAM_GONE);
  return json(200, { team: await publicTeam(ctx, rec, role) }, { 'Cache-Control': 'private, no-store' });
}

const STORYBOOK = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Moves everything a team made in Bridge keeps under its key to the repository it is linked to: email members (a role
 * already there is kept, Admin wins), seeded local admins, discovery (unless the repository chose already), pending
 * requests and invites, and the name (unless the repository has one). The key is forgotten afterwards.
 */
async function moveTeam(ctx: Ctx, from: string, to: string): Promise<void> {
  const { redis, members, invites } = ctx.svc;
  const now = ctx.now();
  for (const m of await members.list(from)) {
    const prev = await members.get(to, m.email);
    await members.put(to, prev ? { ...prev, role: prev.role === 'admin' || m.role === 'admin' ? 'admin' : 'edit' } : m);
    await members.remove(from, m.email);
  }
  if (ctx.svc.localAdmins) {
    for (const e of await ctx.svc.localAdmins.adminsOf(from)) {
      await ctx.svc.localAdmins.add(to, e);
      await ctx.svc.localAdmins.remove(from, e);
    }
  }
  const d = await getDiscovery(redis, from);
  if (d && !(await getDiscovery(redis, to))) await putDiscovery(redis, to, d);
  for (const r of await listRequests(redis, from, now)) {
    if (!(await getRequest(redis, to, r.email, now)) && !(await members.get(to, r.email))) await putRequest(redis, { ...r, repo: to }, now);
  }
  const names = await getTeamNames(redis, [from, to]);
  const name = names.get(from)?.name;
  if (name && !names.get(to)) await putTeamName(redis, to, name, now);
  const tools = await getTeamAiTools(redis, from);
  if (tools && !(await getTeamAiTools(redis, to))) await putTeamAiTools(redis, to, tools);
  for (const inv of await invites.list(from)) {
    const left = Math.ceil((Date.parse(inv.expiresAt) - now) / 1000);
    await invites.remove(inv);
    if (left > 0) await invites.put({ ...inv, repo: to }, left);
  }
  await forgetTeamKey(redis, from, now);
}

async function onLinkTeam(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.team === 'string' ? teamKeyId(body.team) : null;
  const rec = id ? await getTeamRecord(ctx.svc.redis, id) : null;
  if (!rec) return fail(404, 'not_found', TEAM_GONE);
  const key = teamKeyOf(rec.id);
  if (body.storybook !== undefined) {
    await requireAdmin(ctx, a, rec.repo ?? key);
    const url = typeof body.storybook === 'string' ? body.storybook.trim() : '';
    if (url && (url.length > 2048 || !STORYBOOK.test(url))) return fail(400, 'bad_storybook', BAD_STORYBOOK);
    const next = { ...rec, storybook: url || null };
    await putTeamRecord(ctx.svc.redis, next);
    return json(200, { team: await publicTeam(ctx, next, 'admin') });
  }
  const target = parseRepo(body.repo);
  if (rec.repo) {
    if (rec.repo === target.full) return json(200, { repo: rec.repo, next: teamHref(rec.repo) });
    return fail(409, 'linked', ALREADY_LINKED(rec.repo));
  }
  // Admin of the team made in Bridge, and of the repository: an admin there on GitHub, or an admin of its team here.
  await requireAdmin(ctx, a, key);
  try {
    await requireAdmin(ctx, a, target.full);
  } catch (e) {
    if (!(e instanceof HttpError) || (e.code !== 'forbidden' && e.code !== 'not_configured')) throw e;
    // Bridge not installed on the repository yet: the team page installs it, then the link is made from there.
    const installed = ctx.svc.app && a.github ? Boolean(await ctx.svc.app.installationToken(target.owner, target.repo)) : a.github ? false : true;
    if (!installed) throw new HttpError(409, 'app_missing', LINK_APP_MISSING);
    throw new HttpError(403, 'forbidden', REPO_ADMIN_ONLY);
  }
  await moveTeam(ctx, key, target.full);
  await putTeamRecord(ctx.svc.redis, { ...rec, repo: target.full, linkedAt: new Date(ctx.now()).toISOString() });
  return json(200, { repo: target.full, next: teamHref(target.full) });
}

async function onAction(ctx: Ctx, req: Request, a: Account, body: Record<string, unknown>): Promise<Response> {
  switch (body.action) {
    case 'accept-invite': {
      const { full } = await resolveTeam(ctx, body.repo);
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
    case 'undo':
      return onUndo(ctx, a, body);
    case 'discovery':
      return onDiscovery(ctx, a, body);
    case 'create-team':
      return onCreateTeam(ctx, a, body);
    case 'link-team':
      return onLinkTeam(ctx, a, body);
    case 'rename-team':
      return onRenameTeam(ctx, a, body);
    case 'ai-tools':
      return onTeamAiTools(ctx, a, body);
    default:
      return fail(400, 'bad_request', 'Unknown action.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Invite links

/** Invite links one network may look at in an hour: enough for a person, not for guessing. */
export const INVITE_LINK_PER_HOUR = 30;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * What an invite link is, for the one door of Bridge (components/ds/account/SignIn.tsx on /studio/invite/): signed
 * out, which team and the masked address the code goes to; signed in, the E3 card when the invite is theirs, "already
 * in" for a member, or the masked address it was sent to. A spent link still names the team and whom to ask.
 */
async function onInviteLink(ctx: Ctx, req: Request, a: Account | null, body: Record<string, unknown>): Promise<Response> {
  const hour = new Date(ctx.now()).toISOString().slice(0, 13);
  const [n] = await ctx.svc.redis.pipe([
    ['INCRBY', `bridge:entry:count:invite-link:${hmacHex(ctx.svc.secret, `ip:${clientIp(req)}`)}:${hour}`, 1],
    ['EXPIRE', `bridge:entry:count:invite-link:${hmacHex(ctx.svc.secret, `ip:${clientIp(req)}`)}:${hour}`, 2 * 3600],
  ]);
  if (Number(n) > INVITE_LINK_PER_HOUR) return fail(429, 'limit', 'Too many tries from this network. Try again in an hour.');
  const signedIn = Boolean(a);
  const token = typeof body.token === 'string' && INVITE_TOKEN.test(body.token) ? body.token : null;
  const hash = token ? sha256(token) : null;
  const inv = hash ? await ctx.svc.invites.byTokenHash(hash) : null;
  const live = inv && Date.parse(inv.expiresAt) > ctx.now() ? inv : null;
  const trace = live ? { repo: live.repo, invitedBy: '' } : hash ? await ctx.svc.invites.traceByTokenHash(hash) : null;
  if (!live && !trace) return json(200, { state: 'unknown', signedIn });
  const repo = (live ?? trace)!.repo;
  const member = a ? await isMemberOf(ctx, a, repo) : false;
  const team = (await teamNamesOf(ctx, [repo]))(repo);
  if (!live) return json(200, { state: 'gone', team, invitedBy: displayName(trace!.invitedBy), signedIn, member, ...(member ? { repo } : {}) });
  const card = await inviteCard(ctx, live, team);
  const mine = Boolean(a && live.email.trim().toLowerCase() === a.email.toLowerCase());
  return json(200, {
    state: 'live',
    team,
    invitedBy: card.invitedBy,
    role: live.role,
    ...(live.reviewAs ? { reviewAs: live.reviewAs } : {}),
    sentTo: maskEmail(live.email),
    signedIn,
    mine,
    member,
    ...(member ? { repo } : {}),
    ...(mine && !member ? { invite: card } : {}),
  });
}

/** An admin sets the team default of the AI tools (null or [] clears it). */
async function onTeamAiTools(ctx: Ctx, a: Account, body: Record<string, unknown>): Promise<Response> {
  const admin = await requireAdmin(ctx, a, body.team ?? body.repo);
  const clear = body.tools === null || (Array.isArray(body.tools) && body.tools.length === 0);
  const tools = clear ? null : parseAiTools(body.tools);
  if (!clear && !tools) return fail(400, 'bad_tools', 'Pick at least one AI tool, or none for no default.');
  await putTeamAiTools(ctx.svc.redis, admin.full, tools);
  return json(200, { tools });
}

/**
 * Anyone on the team may read its AI tools default: an email member (or a seeded admin), else the account's linked
 * GitHub account with access to the repository (read by the app, matched by GitHub id). Anyone else: 404.
 */
async function onGetTeamAiTools(ctx: Ctx, a: Account, arg: string): Promise<Response> {
  let t: TeamRef;
  try {
    t = await resolveTeam(ctx, arg);
  } catch {
    return fail(404, 'not_found', TEAM_GONE);
  }
  let member = await isMemberOf(ctx, a, t.full);
  if (!member && !t.id && a.github && ctx.svc.app) {
    const token = await ctx.svc.app.installationToken(t.owner, t.repo);
    if (token) {
      const r = await gh(ctx.f, token, `/repos/${t.owner}/${t.repo}/collaborators/${encodeURIComponent(a.github.login)}/permission`);
      member = r.status === 200 && r.data?.user?.id === a.github.id && typeof r.data?.permission === 'string' && r.data.permission !== 'none';
    }
  }
  if (!member) return fail(404, 'not_found', TEAM_GONE);
  return json(200, { tools: await getTeamAiTools(ctx.svc.redis, t.full) }, { 'Cache-Control': 'private, no-store' });
}

/** The account is on the team: an email membership, or (local mode) a seeded admin. */
async function isMemberOf(ctx: Ctx, a: Account, repo: string): Promise<boolean> {
  if (await ctx.svc.members.get(repo, a.email.toLowerCase())) return true;
  return ctx.svc.localAdmins ? (await ctx.svc.localAdmins.teamsOf(a.email)).some((r) => r.toLowerCase() === repo.toLowerCase()) : false;
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
    if (method === 'POST') {
      if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
      const body = await readBody(req, MAX_BODY);
      // The one action without the cookie: what an invite link is, before signing in.
      if (body.action === 'invite-link') return await onInviteLink(ctx, req, a, body);
      if (!a) return fail(401, 'signin', SIGNIN);
      return await onAction(ctx, req, a, body);
    }
    if (!a) return fail(401, 'signin', SIGNIN);
    const params = new URL(req.url).searchParams;
    const noStore = { 'Cache-Control': 'private, no-store' };
    const requestsOf = params.get('requests');
    if (requestsOf !== null) {
      const admin = await requireAdmin(ctx, a, requestsOf);
      const list = await listRequests(svc.redis, admin.full, ctx.now());
      return json(200, { requests: list.map(({ id, name, email, createdAt, expiresAt }) => ({ id, name, email, createdAt, expiresAt })) }, noStore);
    }
    const aiToolsOf = params.get('ai-tools');
    if (aiToolsOf !== null) return await onGetTeamAiTools(ctx, a, aiToolsOf);
    const teamOf = params.get('team');
    if (teamOf !== null) return await onGetTeam(ctx, a, teamOf);
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
