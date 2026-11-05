// /api/mcp: Bridge inside the team's own Claude (docs/FIGMA-FIXES.md "Bridge inside your team's Claude"). The Bridge MCP
// server (packages/mcp, every tool but the merge: agents never merge here, HOSTED_REFUSED_TOOLS) as a remote MCP server
// over Streamable HTTP, with its OAuth 2.1 authorization
// server (api/_lib/oauth.ts), and the fix sessions people watch while Claude works (api/_lib/fix-sessions.ts). One
// function; vercel.json rewrites give the public addresses:
//
//   /mcp                                                -> MCP (POST, GET, DELETE; Authorization: Bearer <Bridge token>)
//   /.well-known/oauth-protected-resource(/mcp)         -> ?wk=resource   RFC 9728 metadata
//   /.well-known/oauth-authorization-server             -> ?wk=as         RFC 8414 metadata
//   /oauth/authorize | token | register | revoke | github | request | approve
//                                                       -> ?oauth=<step>
//   GET  ?view=session&repo=owner/name&component=Name   a fix session: { session: SessionView } (plugin, Studio)
//   GET  ?view=sessions&repo=owner/name                 the team's sessions of the last 7 days
//   GET  ?view=connections&repo=owner/name              who connected Bridge in Claude for this team, last used
//   GET  ?view=github-usage&repo=owner/name             the team's GitHub usage this hour (admins only, Settings):
//                                                       { usage: { limit, used, remaining, resetAt, low } | null, slowedAt }
//   POST ?view=disconnect { repo, id }                  ends one connection (its owner, or a team admin)
//   POST ?view=pieces { repo, pr }                      Studio's library check of an exploration: the adoption audit
//                                                       on its diff (bridge_missing_pieces), recorded on it. GitHub
//                                                       sign-in with push only: the audit reads and writes as them
// The views take the Bridge sign-in (a GitHub token, as the plugin and Studio send it, or the Studio member session);
// CORS is open for token calls (the Figma plugin).
//
// The MCP server acts on the team's repository chosen at sign-in, with the signed-in person's GitHub App user token:
// every write is theirs and goes through the usual paths (a draft pull request on bridge/figma-fixes-<component>,
// labelled drafted-by-claude and figma-fixes, Tier 2), never the default branch.
// Someone who joined the team with their email (no GitHub account) connects with their Bridge sign-in alone (an email
// grant, api/_lib/oauth.ts): every GitHub call of their session goes through the email contributors' proxy in process
// (api/contribute handleContribute, its deny-by-default policy: their explorations in the design team's copy, their
// developers' task, design files of the library), and the tools that need GitHub powers (reviews, merges, Figma fixes,
// code in the library, the library's own explorations) are neither listed nor run (EMAIL_REFUSED_TOOLS).
//
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_* pair), LIBRARY_SESSION_SECRET (the Bridge account session,
// and the sealing key of the GitHub tokens kept for a connection), GITHUB_APP_CLIENT_ID + GITHUB_APP_CLIENT_SECRET (the
// Bridge Direct GitHub App: its callback list must include <site>/oauth/github), GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY
// (email members in Studio), PUBLIC_SITE_URL (the issuer; else the request's origin). Nothing here logs.

import { randomBytes } from 'node:crypto';
import { BridgeContext, handleHttp, maskEmail, pieces, type ClaudeDesignHost, type WhoAmI } from '@bridge-ds/mcp';
import { contributorOf, cookieName, designerProductsFor, handleContribute, ownedWorkFor, signSession, type ContribEnv } from '../contribute/index.js';
import { displayName, sessionAccount } from '../_lib/account.js';
import { sameEmail } from '../_lib/canonical-email.js';
import { getSession, listSessions, recordToolCall, sessionView } from '../_lib/fix-sessions.js';
import type { AppTokens } from '../_lib/github-app.js';
import { clientIp, fail, HttpError, json, parseRepo, readBody, sameOrigin, type FetchLike } from '../_lib/http.js';
import { meteredFromEnv, readUsage } from '../_lib/github-quota.js';
import { memberStore, teamsInSet, type MemberStore } from '../_lib/members.js';
import { getTeamClaudeDesign, getTeamNames, putTeamClaudeDesign } from '../_lib/teams.js';
import { teamDisplayName } from '../../src/lib/demo.js';
import { isTeamKey } from '../../src/lib/team-path.js';
import {
  accountRef,
  challenge,
  CONNECT_PAGE,
  clientRedirect,
  createGrant,
  dropRequest,
  exchangeToken,
  getGrant,
  getRequest,
  ghStateKey,
  githubTokenRequest,
  grantOfAccessToken,
  issueCode,
  listGrants,
  OAUTH_WORDS,
  openGitHubTokens,
  openGrantEmail,
  pkcePair,
  putRequest,
  registerClient,
  REQUEST_COOKIE,
  REQ_TTL_S,
  resourceMetadata,
  revokeGrant,
  revokeToken,
  sameBrowser,
  saveGrant,
  serverMetadata,
  siteOf,
  startAuthorization,
  TokenError,
  type Grant,
  type Site,
} from '../_lib/oauth.js';
import { redisRest, type Redis } from '../_lib/redis.js';
import { seal, sealingKey } from '../_lib/sealed.js';
import { readCookie } from '../_lib/session.js';
import { bearerOf, CALLER_WORDS, githubGet, teamCaller } from '../_lib/team-caller.js';

export type { FetchLike };

export interface ConnectorEnv extends ContribEnv {
  GITHUB_APP_CLIENT_ID?: string | undefined;
  GITHUB_APP_CLIENT_SECRET?: string | undefined;
}

/** One MCP request on a context (tests replace it; default: the Bridge MCP server, packages/mcp handleHttp). */
export type McpHandler = (ctx: BridgeContext, req: Request, body: unknown) => Promise<Response>;

export interface ConnectorDeps {
  fetch: FetchLike;
  now?: () => number;
  random?: (n: number) => Uint8Array;
  redis?: Redis;
  members?: MemberStore;
  app?: AppTokens;
  mcp?: McpHandler;
  /** How the context is made (tests: a context without GitHub calls). */
  context?: (opts: { repo: string; token: string; fetch?: FetchLike; owned?: () => Promise<{ repo: string; branch: string }[] | null>; identity?: () => Promise<WhoAmI | null>; claudeDesign?: ClaudeDesignHost }) => Promise<BridgeContext>;
  /** The library check of an exploration (tests replace it; default: the MCP server's bridge_missing_pieces, recorded). */
  checkPieces?: (ctx: BridgeContext, pr: number | string) => Promise<{ pieces: unknown[]; recorded: boolean }>;
}

/** What Studio reads when the library check cannot run: the page then offers the line to paste in Claude. */
export const PIECES_WORDS = {
  github: 'Sign in to Bridge so it can check the library.',
  failed: 'Bridge could not check it against the library this time.',
} as const;

/**
 * Agents never merge through the hosted connector: these tools are neither listed (handleHttp exclude) nor run (a call
 * is refused here, before the MCP server). A person merges from Bridge Studio or GitHub. The local CLI and MCP server
 * keep them.
 */
export const HOSTED_REFUSED_TOOLS: readonly string[] = ['bridge_merge_branch'];
export const HOSTED_REFUSED_WORDS = 'Claude does not merge through Bridge: a person merges it from Bridge Studio or GitHub.';

/**
 * The tools a member who joined with their email cannot use through Claude: they need GitHub powers (reviews, merges,
 * code in the library, Figma fixes, product package changes) or a lead's (the library's own explorations, its Figma links). Neither
 * listed nor run; a call gets EMAIL_REFUSED_WORDS (or LIBRARY_LEADS_WORDS) in plain words.
 */
export const EMAIL_REFUSED_TOOLS: readonly string[] = [
  'bridge_review_branch',
  'bridge_review_pr',
  'bridge_review_suggestion',
  'bridge_apply_suggestion',
  'bridge_combine_branches',
  'bridge_propose_figma_fixes',
  'bridge_try_figma_fix',
  'bridge_push_figma_component',
  'bridge_scaffold_component',
  'bridge_propose_revert',
  'bridge_switch_to_published',
  'bridge_use_library_preview',
  'bridge_open_library_branch',
  'bridge_propose_component_map',
];
export const EMAIL_REFUSED_WORDS = 'You joined this team with your email, so Bridge does not do this for you. Ask a reviewer or an admin of your team.';
export const USAGE_ADMINS_ONLY = 'Only admins of this team see its GitHub usage.';
export const LIBRARY_LEADS_WORDS = 'The design system leads change the library. Ask them for what you need, or explore one of your products.';
/** Refused to an email member with LIBRARY_LEADS_WORDS: library changes only its leads make (a library branch, its Figma links). */
const LIBRARY_LEADS_TOOLS: readonly string[] = ['bridge_open_library_branch', 'bridge_propose_component_map'];

const STORAGE_DOWN = 'Bridge could not reach its storage. Try again in a minute.';
const SEAL_PURPOSE = 'mcp-connector-github-tokens';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '600',
};
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export interface Services {
  redis: Redis;
  key: Buffer;
  secret: string;
}

function services(env: ConnectorEnv, deps: ConnectorDeps): Services | null {
  const kvUrl = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL)?.trim();
  const kvToken = (env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const redis = deps.redis ?? (kvUrl && kvToken ? redisRest(kvUrl, kvToken, deps.fetch, STORAGE_DOWN) : null);
  const secret = env.LIBRARY_SESSION_SECRET?.trim() ?? '';
  const key = sealingKey(secret, SEAL_PURPOSE);
  return redis && key ? { redis, key, secret } : null;
}

const githubApp = (env: ConnectorEnv) => {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const secret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  return clientId && secret ? { clientId, secret } : null;
};

const withCors = (r: Response) => {
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
};

const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 302, headers: { Location: to, ...NO_STORE, ...headers } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A plain page for an authorization error that cannot go back to the client (an unknown client or address). */
function errorPage(message: string, status = 400): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bridge</title><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Bridge could not connect Claude</h1><p>${esc(message)}</p></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
}

const requestCookie = (value: string, maxAge: number) => `${REQUEST_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

const tokenError = (e: TokenError) => new Response(JSON.stringify({ error: e.error, error_description: e.message }), { status: e.status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });

/**
 * Who a grant acts as, for bridge_whoami: an email member (their name, role and masked email; saves go through Bridge),
 * a designer signed in with GitHub (Can edit; their saves in products go through Bridge), or a lead with their own
 * GitHub access (Admin when they administer the design system repository, else Reviewer).
 */
export async function grantIdentity(x: {
  grant: { repo: string; name: string; login: string };
  emailMember: { email: string; name: string; role?: string } | null;
  designer: boolean;
  routed: boolean;
  token: string;
  redis: Redis;
  fetch: FetchLike;
}): Promise<WhoAmI> {
  const names = await getTeamNames(x.redis, [x.grant.repo]).catch(() => new Map<string, { name: string }>());
  const team = teamDisplayName(x.grant.repo, { name: names.get(x.grant.repo.toLowerCase())?.name });
  // A Reader (Can view) saves nothing: the proxy refuses their writes, and the exploration tools read it here.
  if (x.emailMember) return { name: x.emailMember.name || 'Email member', email: maskEmail(x.emailMember.email), role: x.emailMember.role === 'admin' ? 'Admin' : x.emailMember.role === 'view' ? 'Reader' : 'Can edit', via: 'email', team, writes: x.emailMember.role === 'view' ? 'none' : 'bridge' };
  const login = x.grant.login || undefined;
  if (x.designer) return { name: x.grant.name || x.grant.login, ...(login ? { login } : {}), role: 'Can edit', via: 'github', team, writes: x.routed ? 'bridge' : 'own' };
  const [owner, repo] = x.grant.repo.split('/');
  const r = await githubGet(x.fetch, x.token, `/repos/${owner}/${repo}`, 'bridge-mcp').catch(() => ({ status: 0, data: null }));
  const admin = r.status === 200 && r.data?.permissions?.admin === true;
  return { name: x.grant.name || x.grant.login, ...(login ? { login } : {}), role: admin ? 'Admin' : 'Reviewer', via: 'github', team, writes: 'own' };
}

// ---------------------------------------------------------------------------------------------------------------
// OAuth steps

/** The teams of a Bridge account that have a repository (a design system), by the name their settings gave. */
async function teamsWithDesignSystem(redis: Redis, email: string): Promise<{ repo: string; name: string; email: true; role: 'admin' | 'edit' | 'view' }[]> {
  // Each team once, by its current name (a set entry or a membership kept under a name from before a rename is the
  // same team): the card never offers one team twice, and the grant is made for the name the team goes by now.
  const repos = (await teamsInSet(redis, email)).filter((r) => !isTeamKey(r) && /^[^/_][^/]*\/[^/]+$/.test(r)).sort();
  const members = memberStore(redis);
  const live: { repo: string; role: 'admin' | 'edit' | 'view' }[] = [];
  for (const repo of repos) {
    const m = await members.get(repo, email);
    if (m) live.push({ repo, role: m.role });
  }
  const names = await getTeamNames(redis, live.map((t) => t.repo)).catch(() => new Map<string, { name: string }>());
  // Every team here knows the account by its email: Claude can connect with the Bridge sign-in alone (no GitHub). Its
  // role there is shown on the page ("You're connecting Claude as Dino, Can edit").
  return live.map(({ repo, role }) => ({ repo, name: teamDisplayName(repo, { name: names.get(repo.toLowerCase())?.name }), email: true as const, role }));
}

async function onOAuth(step: string, req: Request, env: ConnectorEnv, deps: ConnectorDeps, svc: Services, site: Site): Promise<Response> {
  const random = deps.random ?? ((n) => randomBytes(n));
  const now = (deps.now ?? Date.now)();
  const { redis } = svc;
  switch (step) {
    case 'register': {
      if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');
      const body = await readBody(req, 16_384).catch(() => {
        throw new HttpError(400, 'invalid_client_metadata', 'Send the client metadata as a JSON object.');
      });
      return json(201, await registerClient(redis, body, clientIp(req), random, now), NO_STORE);
    }
    case 'authorize': {
      if (!githubApp(env)) return errorPage(OAUTH_WORDS.notConfigured, 503);
      const r = await startAuthorization(redis, deps.fetch, site, new URL(req.url).searchParams, random, now);
      if (!r.ok) return r.redirect ? redirect(r.redirect) : errorPage(r.message);
      return redirect(`${CONNECT_PAGE}?request=${encodeURIComponent(r.req.id)}`, { 'Set-Cookie': requestCookie(r.cookie, REQ_TTL_S) });
    }
    case 'request': {
      // The Studio page reads what it asks the person: which app, and where it goes back to.
      const r = await getRequest(redis, new URL(req.url).searchParams.get('id') ?? '');
      if (!r) return json(410, { error: 'expired', message: OAUTH_WORDS.expired }, NO_STORE);
      // Who is signed in, and their teams with a design system, read here from the session cookie: the page shows the
      // right step with no other call (a team made in Bridge without a repository has nothing for Claude yet).
      const account = await sessionAccount(req, redis, svc.secret, now);
      const teams = account ? await teamsWithDesignSystem(redis, account.email) : [];
      return json(
        200,
        { client: r.clientName, redirectHost: new URL(r.redirectUri).host, sameBrowser: sameBrowser(r, readCookie(req, REQUEST_COOKIE)), signedIn: Boolean(account), name: account?.name ?? null, email: account ? maskEmail(account.email) : null, teams },
        NO_STORE,
      );
    }
    case 'approve': {
      if (req.method !== 'POST' || !sameOrigin(req)) return fail(403, 'origin', OAUTH_WORDS.otherBrowser);
      const body = await readBody(req, 4096);
      const r = await getRequest(redis, typeof body.request === 'string' ? body.request : '');
      if (!r) return fail(410, 'expired', OAUTH_WORDS.expired);
      if (!sameBrowser(r, readCookie(req, REQUEST_COOKIE))) return fail(403, 'other_browser', OAUTH_WORDS.otherBrowser);
      if (body.allow !== true) {
        await dropRequest(redis, r.id);
        return json(200, { redirect: clientRedirect(r, site.issuer, { error: 'access_denied', error_description: 'The person did not allow Bridge.' }) }, { 'Set-Cookie': requestCookie('', 0) });
      }
      const account = await sessionAccount(req, redis, svc.secret, now);
      if (!account) return fail(401, 'signin', OAUTH_WORDS.signIn);
      const { full } = parseRepo(body.repo);
      if (body.via === 'email') {
        // Their Bridge sign-in is the proof: a member of this team by that email, no GitHub leg.
        const member = await (deps.members ?? memberStore(redis)).get(full, account.email);
        if (!member || !sameEmail(member.email, account.email)) return fail(403, 'not_member', OAUTH_WORDS.notMember);
        const grant = await createGrant(redis, svc.key, { repo: full, client: r, login: '', name: member.name || account.name, email: member.email, account: accountRef(account.email) }, random, now);
        const issued = await issueCode(redis, r, grant.id, random);
        await dropRequest(redis, r.id);
        return json(200, { redirect: clientRedirect(r, site.issuer, { code: issued }) }, { ...NO_STORE, 'Set-Cookie': requestCookie('', 0) });
      }
      const app = githubApp(env);
      if (!app) return fail(503, 'not_configured', OAUTH_WORDS.notConfigured);
      const state = Buffer.from(random(24)).toString('base64url');
      const pkce = pkcePair(random);
      await putRequest(redis, { ...r, repo: full, by: account.name, ghVerifier: pkce.verifier, account: accountRef(account.email) });
      await redis.cmd('SET', ghStateKey(state), r.id, 'EX', 600);
      const gh = new URL('https://github.com/login/oauth/authorize');
      gh.searchParams.set('client_id', app.clientId);
      gh.searchParams.set('redirect_uri', `${site.issuer}/oauth/github`);
      gh.searchParams.set('state', state);
      gh.searchParams.set('code_challenge', pkce.challenge);
      gh.searchParams.set('code_challenge_method', 'S256');
      return json(200, { redirect: gh.toString() }, NO_STORE);
    }
    case 'github': {
      const q = new URL(req.url).searchParams;
      const id = await redis.cmd('GETDEL', ghStateKey(q.get('state') ?? ''));
      const r = typeof id === 'string' ? await getRequest(redis, id) : null;
      if (!r || !r.repo || !r.ghVerifier) return errorPage(OAUTH_WORDS.expired, 410);
      if (!sameBrowser(r, readCookie(req, REQUEST_COOKIE))) return errorPage(OAUTH_WORDS.otherBrowser, 403);
      const back = (error: string, description: string) => redirect(clientRedirect(r, site.issuer, { error, error_description: description }), { 'Set-Cookie': requestCookie('', 0) });
      const app = githubApp(env)!;
      const code = q.get('code');
      if (!code) return back('access_denied', OAUTH_WORDS.github);
      const tokens = await githubTokenRequest(deps.fetch, app, { code, redirect_uri: `${site.issuer}/oauth/github`, code_verifier: r.ghVerifier }, now);
      if (!tokens) return back('access_denied', OAUTH_WORDS.github);
      const [owner, name] = r.repo.split('/') as [string, string];
      const me = await githubGet(deps.fetch, tokens.access, '/user', 'bridge-mcp');
      const repo = await githubGet(deps.fetch, tokens.access, `/repos/${owner}/${name}`, 'bridge-mcp');
      const p = repo.status === 200 ? repo.data?.permissions : null;
      if (me.status !== 200 || typeof me.data?.login !== 'string') return back('access_denied', OAUTH_WORDS.github);
      if (!p || !(p.push || p.admin)) {
        await dropRequest(redis, r.id);
        return redirect(`${site.issuer}${CONNECT_PAGE}?error=no_access`, { 'Set-Cookie': requestCookie('', 0) });
      }
      const who = displayName(typeof me.data.name === 'string' ? me.data.name : null, r.by, me.data.login) || me.data.login;
      const grant = await createGrant(redis, svc.key, { repo: r.repo, client: r, login: me.data.login, name: who, gh: tokens, account: r.account }, random, now);
      const issued = await issueCode(redis, r, grant.id, random);
      await dropRequest(redis, r.id);
      return redirect(clientRedirect(r, site.issuer, { code: issued }), { 'Set-Cookie': requestCookie('', 0) });
    }
    case 'token': {
      if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');
      if (!/^application\/x-www-form-urlencoded\b/i.test(req.headers.get('content-type') ?? '')) return tokenError(new TokenError('invalid_request', 'Send the form as application/x-www-form-urlencoded.'));
      const form = new URLSearchParams(await req.text());
      try {
        return json(200, await exchangeToken(redis, site, form, random), NO_STORE);
      } catch (e) {
        if (e instanceof TokenError) return tokenError(e);
        throw e;
      }
    }
    case 'revoke': {
      if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');
      await revokeToken(redis, new URLSearchParams(await req.text()).get('token') ?? '');
      return new Response(null, { status: 200, headers: NO_STORE });
    }
    default:
      return fail(404, 'not_found', 'Unknown OAuth step.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// MCP

/** The person's GitHub token for a grant, renewed on the server when it is about to expire; null ends the grant. */
async function githubTokenOf(g: Grant, env: ConnectorEnv, deps: ConnectorDeps, svc: Services, now: number): Promise<string | null> {
  const t = openGitHubTokens(g, svc.key);
  if (!t) return null;
  if (!t.accessExp || t.accessExp - now > 120_000) return t.access;
  const app = githubApp(env);
  if (!app || !t.refresh || (t.refreshExp && t.refreshExp <= now)) return null;
  const next = await githubTokenRequest(deps.fetch, app, { grant_type: 'refresh_token', refresh_token: t.refresh }, now);
  if (!next) return null;
  await saveGrant(svc.redis, { ...g, gh: seal(JSON.stringify(next), svc.key, g.id, deps.random ?? ((n) => randomBytes(n))) });
  return next.access;
}

// ---------------------------------------------------------------------------------------------------------------
// Email grants: the MCP server's GitHub calls through the email contributors' proxy

const GITHUB_API = 'https://api.github.com';
/** The proxy's session for one call: a few minutes, signed like the Studio cookie, never sent anywhere but in process. */
const PROXY_SESSION_MS = 5 * 60_000;

const proxyError = (status: number, message: string) => new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * The fetch an email member's MCP session uses for GitHub: every call to api.github.com/repos/... goes to
 * handleContribute in process, as their Studio session would (the same member check, policy, daily cap and attribution);
 * anything else (GraphQL, /user, the raw host) is refused. A refusal of the policy comes back as a 422 that carries the
 * proxy's own words, so Claude says why in plain words instead of a token message.
 */
export function proxyFetchFor(member: { email: string; name: string; version: number }, team: string, env: ConnectorEnv, deps: ConnectorDeps, svc: Services): FetchLike {
  const now = deps.now ?? Date.now;
  return async (url, init) => {
    const u = new URL(url);
    if (u.origin !== GITHUB_API || !u.pathname.startsWith('/repos/')) return proxyError(403, 'Bridge reads and writes your team\'s repositories only.');
    const method = (init?.method ?? 'GET').toUpperCase();
    const session = signSession({ repo: team.toLowerCase(), email: member.email, name: member.name, v: member.version, exp: now() + PROXY_SESSION_MS }, svc.secret);
    const given = new Headers((init?.headers as HeadersInit | undefined) ?? {});
    const headers: Record<string, string> = { Cookie: `${cookieName(team)}=${session}`, 'X-Bridge-Contribute': '1' };
    for (const h of ['accept', 'content-type', 'if-none-match']) {
      const v = given.get(h);
      if (v) headers[h] = v;
    }
    const body = init?.body;
    const req = new Request(`https://bridge.invalid/api/contribute?repo=${encodeURIComponent(team)}&gh=${encodeURIComponent(u.pathname + u.search)}`, {
      method,
      headers,
      ...(body !== undefined && body !== null && method !== 'GET' ? { body: body as BodyInit } : {}),
    });
    const res = await handleContribute(req, env, { fetch: deps.fetch, now, redis: svc.redis, ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) });
    if (res.status === 403 || res.status === 401) {
      const said = (await res.clone().json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
      if (said && typeof said.message === 'string') return proxyError(422, said.message);
    }
    return res;
  };
}

/**
 * The GitHub calls of a designer signed in with GitHub (contribute githubDesignerOf): a call to one of the team's
 * product repositories goes through Bridge's proxy with their own token as proof of who they are (the proxy checks it
 * with GitHub, then writes with the Bridge app under the same policy as for an email member); every other call goes
 * out with their token as before. A refusal of the policy comes back as a 422 with the proxy's own words.
 */
export function designerFetchFor(token: string, team: string, products: readonly string[], env: ConnectorEnv, deps: ConnectorDeps, svc: Services): FetchLike {
  const now = deps.now ?? Date.now;
  const under = (path: string) => products.some((r) => path.toLowerCase() === `/repos/${r}` || path.toLowerCase().startsWith(`/repos/${r}/`));
  return async (url, init) => {
    const u = new URL(url);
    if (u.origin !== GITHUB_API || !under(u.pathname)) return deps.fetch(url, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const given = new Headers((init?.headers as HeadersInit | undefined) ?? {});
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Bridge-Contribute': '1' };
    for (const h of ['accept', 'content-type', 'if-none-match']) {
      const v = given.get(h);
      if (v) headers[h] = v;
    }
    const body = init?.body;
    const req = new Request(`https://bridge.invalid/api/contribute?repo=${encodeURIComponent(team)}&gh=${encodeURIComponent(u.pathname + u.search)}`, {
      method,
      headers,
      ...(body !== undefined && body !== null && method !== 'GET' ? { body: body as BodyInit } : {}),
    });
    const res = await handleContribute(req, env, { fetch: deps.fetch, now, redis: svc.redis, ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) });
    if (res.status === 403 || res.status === 401) {
      const said = (await res.clone().json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
      if (said && typeof said.message === 'string') return proxyError(422, said.message);
    }
    return res;
  };
}

interface RpcMessage {
  id?: string | number | null;
  method?: string;
  params?: { name?: unknown; arguments?: unknown };
}

/** The tool calls of a JSON-RPC body (one message or a batch). */
function toolCalls(body: unknown): { id: string | number; name: string; args: Record<string, unknown> }[] {
  const list = (Array.isArray(body) ? body : [body]) as RpcMessage[];
  return list.flatMap((m) =>
    m && m.method === 'tools/call' && (typeof m.id === 'string' || typeof m.id === 'number') && typeof m.params?.name === 'string'
      ? [{ id: m.id, name: m.params.name, args: m.params.arguments && typeof m.params.arguments === 'object' ? (m.params.arguments as Record<string, unknown>) : {} }]
      : [],
  );
}

/** The JSON a tool answered (its text content), by request id; null for an error or a non-JSON answer. */
function toolResults(body: unknown): Map<string | number, Record<string, unknown> | null> {
  const out = new Map<string | number, Record<string, unknown> | null>();
  for (const m of (Array.isArray(body) ? body : [body]) as { id?: string | number; result?: { isError?: boolean; content?: { type?: string; text?: string }[] } }[]) {
    if (!m || (typeof m.id !== 'string' && typeof m.id !== 'number')) continue;
    const text = m.result && !m.result.isError ? m.result.content?.find((c) => c.type === 'text')?.text : undefined;
    try {
      out.set(m.id, text ? (JSON.parse(text) as Record<string, unknown>) : null);
    } catch {
      out.set(m.id, null);
    }
  }
  return out;
}

/** Where the hosted connector reads the Library for Claude Design (this site) and keeps the team's artifact (Redis). */
export function claudeDesignHost(repo: string, redis: Redis, site: Site, f: FetchLike): ClaudeDesignHost {
  return {
    site: site.issuer,
    fetch: f as unknown as typeof fetch,
    read: () => getTeamClaudeDesign(redis, repo),
    save: (value) => putTeamClaudeDesign(redis, repo, value),
  };
}

async function onMcp(req: Request, env: ConnectorEnv, deps: ConnectorDeps, svc: Services, site: Site): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const unauthorized = (error?: 'invalid_token') => new Response(JSON.stringify({ error: error ?? 'unauthorized', error_description: 'Sign in with Bridge from Claude.' }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge(site, error), ...NO_STORE } });
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return unauthorized();
  const grant = await grantOfAccessToken(svc.redis, bearer);
  if (!grant) return unauthorized('invalid_token');
  // An email grant: still a member of the team (removed, or joined again since, ends it), acting through the proxy.
  let emailMember: { email: string; name: string; version: number; role?: string } | null = null;
  if (grant.via === 'email') {
    const email = openGrantEmail(grant, svc.key);
    const m = email ? await (deps.members ?? memberStore(svc.redis)).get(grant.repo, email) : null;
    if (!m) {
      await revokeGrant(svc.redis, grant);
      return unauthorized('invalid_token');
    }
    emailMember = m;
  }
  const token = emailMember ? 'bridge-email-member' : await githubTokenOf(grant, env, deps, svc, now);
  if (!token) {
    await revokeGrant(svc.redis, grant);
    return unauthorized('invalid_token');
  }
  if (now - Date.parse(grant.lastUsedAt) > 5 * 60_000) await saveGrant(svc.redis, { ...grant, lastUsedAt: new Date(now).toISOString() }).catch(() => {});
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = JSON.parse(await req.text());
    } catch {
      return json(400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    }
  }
  // Agents never merge here: a call to a refused tool (alone or in a batch) gets the protocol's unknown-tool error and
  // nothing of the request runs.
  const messages = (Array.isArray(body) ? body : [body]) as RpcMessage[];
  const refused = emailMember ? [...HOSTED_REFUSED_TOOLS, ...EMAIL_REFUSED_TOOLS] : HOSTED_REFUSED_TOOLS;
  const refusedCall = messages.find((m) => m && m.method === 'tools/call' && typeof m.params?.name === 'string' && refused.includes(m.params.name));
  if (refusedCall) {
    const name = refusedCall.params!.name as string;
    const words = HOSTED_REFUSED_TOOLS.includes(name) ? HOSTED_REFUSED_WORDS : LIBRARY_LEADS_TOOLS.includes(name) ? LIBRARY_LEADS_WORDS : EMAIL_REFUSED_WORDS;
    const errors = messages.filter((m) => m && (typeof m.id === 'string' || typeof m.id === 'number')).map((m) => ({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: words } }));
    return json(200, Array.isArray(body) ? errors : (errors[0] ?? { jsonrpc: '2.0', id: null, error: { code: -32602, message: words } }), NO_STORE);
  }
  // An email member's GitHub calls go through the proxy (proxyFetchFor); a designer signed in with GitHub sends their
  // calls in the team's products through it too (designerFetchFor); a lead's go out with their own GitHub token.
  const designerProducts = emailMember ? null : await designerProductsFor(token, grant.repo, env, deps).catch(() => null);
  const ghFetch = emailMember ? proxyFetchFor(emailMember, grant.repo, env, deps, svc) : designerProducts?.length ? designerFetchFor(token, grant.repo, designerProducts, env, deps, svc) : deps.fetch;
  const routed = Boolean(emailMember || designerProducts?.length);
  // "mine" for a member Bridge writes for: what its app made for them (GitHub names the app as the author).
  const owned = routed ? () => ownedWorkFor(emailMember ? { email: emailMember.email } : { token }, grant.repo, env, deps).catch(() => null) : undefined;
  // bridge_whoami: who this grant is, read on demand (one team-name read; a lead's role needs one GitHub read).
  const identity = () => grantIdentity({ grant, emailMember, designer: designerProducts !== null, routed, token, redis: svc.redis, fetch: deps.fetch });
  // The Library in Claude Design: served by this site, the team's artifact kept with the team. The MCP tool checks the
  // role (admins and leads, from this grant's identity) before it saves.
  const claudeDesign = claudeDesignHost(grant.repo, svc.redis, site, deps.fetch);
  const ctx = deps.context
    ? await deps.context({ repo: grant.repo, token, ...(routed ? { fetch: ghFetch } : {}), ...(owned ? { owned } : {}), identity, claudeDesign })
    : await BridgeContext.create({ repo: grant.repo, token, surface: 'mcp', fetch: ghFetch as unknown as typeof fetch, ...(owned ? { owned } : {}), identity, claudeDesign });
  // The body was read here (to record the steps): the transport takes it parsed, the request goes on without it.
  const headers = new Headers(req.headers);
  headers.delete('content-length');
  const forward = new Request(req.url, { method: req.method, headers });
  // Each Claude session opens with one 400 here: Claude tries the 2026-07-28 revision first, Bridge (2025-11-25 and
  // earlier) says no, Claude falls back to initialize. That is the spec's era detection, not an error (see handleHttp).
  const res = await (deps.mcp ?? ((c, r, b) => handleHttp(c, r, b, { exclude: [...refused] })))(ctx, forward, body);
  const calls = toolCalls(body).filter((c) => c.name === 'bridge_get_gap_case' || c.name === 'bridge_try_figma_fix' || c.name === 'bridge_propose_figma_fixes');
  if (!calls.length || !/json/i.test(res.headers.get('content-type') ?? '')) return res;
  const text = await res.text();
  let answer: unknown = null;
  try {
    answer = JSON.parse(text);
  } catch {
    answer = null;
  }
  const results = toolResults(answer);
  for (const c of calls) await recordToolCall(svc.redis, { repo: grant.repo, tool: c.name, args: c.args, result: results.get(c.id) ?? null, by: grant.name, now });
  return new Response(text, { status: res.status, headers: res.headers });
}

// ---------------------------------------------------------------------------------------------------------------
// Views: fix sessions (the plugin, Studio) and the team's connections (Studio Settings)

async function onView(view: string, req: Request, env: ConnectorEnv, deps: ConnectorDeps, svc: Services): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const q = new URL(req.url).searchParams;
  const callerDeps = { fetch: deps.fetch, now: () => now, redis: svc.redis, ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) };
  if (view === 'disconnect') {
    if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');
    const body = await readBody(req, 2048);
    const t = parseRepo(body.repo);
    const who = await teamCaller(req, { ...t, need: 'edit' }, env, callerDeps);
    const g = typeof body.id === 'string' ? await getGrant(svc.redis, body.id) : null;
    if (!g || g.repo !== t.full) return fail(404, 'not_found', 'This connection is already gone.');
    const theirs = (who.login && who.login.toLowerCase() === g.login.toLowerCase()) || (who.account && g.account === who.account);
    if (!who.admin && !theirs) return fail(403, 'forbidden', 'Only the person who connected it, or an admin of this team, can remove it.');
    await revokeGrant(svc.redis, g);
    return json(200, { removed: true });
  }
  if (view === 'pieces') {
    // The library check, run here because the adoption audit needs the TypeScript compiler (not in the browser). The
    // person's own GitHub token reads the branch and records the pieces on it, as `bridge pieces <n> --record` would.
    if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');
    const body = await readBody(req, 2048);
    const t = parseRepo(body.repo);
    const pr = typeof body.pr === 'string' || typeof body.pr === 'number' ? String(body.pr).trim() : '';
    if (!/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,99}#)?\d{1,7}$/.test(pr)) return fail(400, 'bad_request', 'Say which exploration, by its number.');
    // Anyone on the team who can explore runs it, as the connector would act for them: a lead with their own GitHub
    // token, a designer signed in with GitHub through Bridge's proxy for the team's products, an email member (the
    // Studio session cookie) through the proxy for everything. The result is recorded on their own exploration.
    const bearer = bearerOf(req);
    const who = await teamCaller(req, { ...t, need: 'edit' }, env, callerDeps);
    if (!who.canEdit) return fail(403, 'forbidden', CALLER_WORDS.notOnTeam);
    const member = bearer ? null : await contributorOf(req, t.full, env, { fetch: deps.fetch, ...(deps.now ? { now: deps.now } : {}), redis: svc.redis, ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) });
    if (!bearer && !member) return fail(401, 'signin', PIECES_WORDS.github);
    const token = bearer ?? 'bridge-email-member';
    const designerProducts = bearer ? await designerProductsFor(bearer, t.full, env, deps).catch(() => null) : null;
    const ghFetch = member ? proxyFetchFor(member, t.full, env, deps, svc) : designerProducts?.length ? designerFetchFor(token, t.full, designerProducts, env, deps, svc) : deps.fetch;
    const routed = Boolean(member || designerProducts?.length);
    const ctx = deps.context
      ? await deps.context({ repo: t.full, token, ...(routed ? { fetch: ghFetch } : {}) })
      : await BridgeContext.create({ repo: t.full, token, surface: 'mcp', fetch: ghFetch as unknown as typeof fetch });
    try {
      const r = await (deps.checkPieces ?? ((c, n) => pieces.missingPiecesOp(c, { pr: n, record: true })))(ctx, /^\d+$/.test(pr) ? Number(pr) : pr);
      return json(200, { checked: r.recorded, pieces: r.pieces.length }, NO_STORE);
    } catch (err) {
      // The function log says why (GitHub's status and message, never the token); Studio shows one sentence.
      console.error(`library check failed for ${t.full}#${pr}: ${err instanceof Error ? err.message : String(err)}`);
      return fail(422, 'check_failed', PIECES_WORDS.failed);
    }
  }
  const t = parseRepo(q.get('repo'));
  const who = await teamCaller(req, { ...t, need: 'read' }, env, callerDeps);
  if (view === 'session') {
    const component = (q.get('component') ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9 ._-]{0,79}$/.test(component)) return fail(400, 'bad_request', 'Say which component, by its name.');
    return json(200, { session: sessionView(await getSession(svc.redis, t.full, component), component, now) });
  }
  if (view === 'github-usage') {
    // Settings, for the team's admins only (checked here, never trusted from the page): how much of the hourly GitHub
    // budget of the team's installation Bridge used (api/_lib/github-quota.ts). Numbers and times, nothing else.
    if (!who.admin) return fail(403, 'forbidden', USAGE_ADMINS_ONLY);
    return json(200, await readUsage(svc.redis, t.full, now), NO_STORE);
  }
  if (view === 'sessions') return json(200, { sessions: (await listSessions(svc.redis, t.full, now)).map((s) => sessionView(s, s.component, now)) });
  if (view === 'connections') {
    const grants = await listGrants(svc.redis, t.full);
    return json(200, {
      connections: grants.map((g) => ({ id: g.id, client: g.clientName, by: g.name, createdAt: g.createdAt, lastUsedAt: g.lastUsedAt, mine: Boolean((who.login && who.login.toLowerCase() === g.login.toLowerCase()) || (who.account && g.account === who.account)) })),
      canManage: who.admin,
    });
  }
  return fail(404, 'not_found', 'Unknown view.');
}

// ---------------------------------------------------------------------------------------------------------------
// Handler

export async function handleConnector(req: Request, env: ConnectorEnv, deps: ConnectorDeps): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    const q = new URL(req.url).searchParams;
    const site = siteOf(req, env.PUBLIC_SITE_URL);
    const wk = q.get('wk');
    if (wk === 'resource') return withCors(json(200, resourceMetadata(site), { 'Cache-Control': 'public, max-age=300' }));
    if (wk === 'as') return withCors(json(200, serverMetadata(site), { 'Cache-Control': 'public, max-age=300' }));
    const svc = services(env, deps);
    const oauth = q.get('oauth');
    const view = q.get('view');
    if (!svc) return withCors(oauth === 'authorize' ? errorPage(OAUTH_WORDS.notConfigured, 503) : fail(503, 'not_configured', OAUTH_WORDS.notConfigured));
    if (oauth) {
      const r = await onOAuth(oauth, req, env, deps, svc, site);
      return ['register', 'token', 'revoke'].includes(oauth) ? withCors(r) : r;
    }
    if (view) return withCors(await onView(view, req, env, deps, svc));
    return withCors(await onMcp(req, env, deps, svc, site));
  } catch (e) {
    if (e instanceof HttpError) return withCors(json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers));
    return withCors(fail(502, 'unreachable', 'Something went wrong. Try again in a minute.'));
  }
}

const envFromProcess = (): ConnectorEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
});

// Answers to calls with the Bridge app's tokens are metered per installation (api/_lib/github-quota.ts).
const realFetch: FetchLike = meteredFromEnv();
const handle = (request: Request) => handleConnector(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
