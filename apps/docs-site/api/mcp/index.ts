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
//   POST ?view=disconnect { repo, id }                  ends one connection (its owner, or a team admin)
// The views take the Bridge sign-in (a GitHub token, as the plugin and Studio send it, or the Studio member session);
// CORS is open for token calls (the Figma plugin).
//
// The MCP server acts on the team's repository chosen at sign-in, with the signed-in person's GitHub App user token:
// every write is theirs and goes through the usual paths (a draft pull request on bridge/figma-fixes-<component>,
// labelled drafted-by-claude and figma-fixes, Tier 2), never the default branch.
//
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_* pair), LIBRARY_SESSION_SECRET (the Bridge account session,
// and the sealing key of the GitHub tokens kept for a connection), GITHUB_APP_CLIENT_ID + GITHUB_APP_CLIENT_SECRET (the
// Bridge Direct GitHub App: its callback list must include <site>/oauth/github), GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY
// (email members in Studio), PUBLIC_SITE_URL (the issuer; else the request's origin). Nothing here logs.

import { randomBytes } from 'node:crypto';
import { BridgeContext, handleHttp } from '@bridge-ds/mcp';
import type { ContribEnv } from '../contribute/index.js';
import { displayName, sessionAccount } from '../_lib/account.js';
import { getSession, listSessions, recordToolCall, sessionView } from '../_lib/fix-sessions.js';
import type { AppTokens } from '../_lib/github-app.js';
import { clientIp, fail, HttpError, json, parseRepo, readBody, sameOrigin, type FetchLike } from '../_lib/http.js';
import { accountTeamsKey, memberStore, type MemberStore } from '../_lib/members.js';
import { getTeamNames } from '../_lib/teams.js';
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
import { githubGet, teamCaller } from '../_lib/team-caller.js';

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
  context?: (opts: { repo: string; token: string }) => Promise<BridgeContext>;
}

/**
 * Agents never merge through the hosted connector: these tools are neither listed (handleHttp exclude) nor run (a call
 * is refused here, before the MCP server). A person merges from Bridge Studio or GitHub. The local CLI and MCP server
 * keep them.
 */
export const HOSTED_REFUSED_TOOLS: readonly string[] = ['bridge_merge_branch'];
export const HOSTED_REFUSED_WORDS = 'Claude does not merge through Bridge: a person merges it from Bridge Studio or GitHub.';

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

interface Services {
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

// ---------------------------------------------------------------------------------------------------------------
// OAuth steps

/** The teams of a Bridge account that have a repository (a design system), by the name their settings gave. */
async function teamsWithDesignSystem(redis: Redis, email: string): Promise<{ repo: string; name: string }[]> {
  const raw = await redis.cmd('SMEMBERS', accountTeamsKey(email));
  const repos = (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []).filter((r) => !isTeamKey(r) && /^[^/_][^/]*\/[^/]+$/.test(r)).sort();
  const members = memberStore(redis);
  const live: string[] = [];
  for (const repo of repos) if (await members.get(repo, email)) live.push(repo);
  const names = await getTeamNames(redis, live).catch(() => new Map<string, { name: string }>());
  return live.map((repo) => ({ repo, name: teamDisplayName(repo, { name: names.get(repo.toLowerCase())?.name }) }));
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
        { client: r.clientName, redirectHost: new URL(r.redirectUri).host, sameBrowser: sameBrowser(r, readCookie(req, REQUEST_COOKIE)), signedIn: Boolean(account), name: account?.name ?? null, teams },
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

async function onMcp(req: Request, env: ConnectorEnv, deps: ConnectorDeps, svc: Services, site: Site): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const unauthorized = (error?: 'invalid_token') => new Response(JSON.stringify({ error: error ?? 'unauthorized', error_description: 'Sign in with Bridge from Claude.' }), { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge(site, error), ...NO_STORE } });
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return unauthorized();
  const grant = await grantOfAccessToken(svc.redis, bearer);
  if (!grant) return unauthorized('invalid_token');
  const token = await githubTokenOf(grant, env, deps, svc, now);
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
  if (messages.some((m) => m && m.method === 'tools/call' && typeof m.params?.name === 'string' && HOSTED_REFUSED_TOOLS.includes(m.params.name))) {
    const errors = messages.filter((m) => m && (typeof m.id === 'string' || typeof m.id === 'number')).map((m) => ({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: HOSTED_REFUSED_WORDS } }));
    return json(200, Array.isArray(body) ? errors : (errors[0] ?? { jsonrpc: '2.0', id: null, error: { code: -32602, message: HOSTED_REFUSED_WORDS } }), NO_STORE);
  }
  const ctx = deps.context ? await deps.context({ repo: grant.repo, token }) : await BridgeContext.create({ repo: grant.repo, token, surface: 'mcp', fetch: deps.fetch as unknown as typeof fetch });
  // The body was read here (to record the steps): the transport takes it parsed, the request goes on without it.
  const headers = new Headers(req.headers);
  headers.delete('content-length');
  const forward = new Request(req.url, { method: req.method, headers });
  // Each Claude session opens with one 400 here: Claude tries the 2026-07-28 revision first, Bridge (2025-11-25 and
  // earlier) says no, Claude falls back to initialize. That is the spec's era detection, not an error (see handleHttp).
  const res = await (deps.mcp ?? ((c, r, b) => handleHttp(c, r, b, { exclude: HOSTED_REFUSED_TOOLS })))(ctx, forward, body);
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
    if (!who.admin && (!who.login || who.login.toLowerCase() !== g.login.toLowerCase())) return fail(403, 'forbidden', 'Only the person who connected it, or an admin of this team, can remove it.');
    await revokeGrant(svc.redis, g);
    return json(200, { removed: true });
  }
  const t = parseRepo(q.get('repo'));
  const who = await teamCaller(req, { ...t, need: 'read' }, env, callerDeps);
  if (view === 'session') {
    const component = (q.get('component') ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9 ._-]{0,79}$/.test(component)) return fail(400, 'bad_request', 'Say which component, by its name.');
    return json(200, { session: sessionView(await getSession(svc.redis, t.full, component), component, now) });
  }
  if (view === 'sessions') return json(200, { sessions: (await listSessions(svc.redis, t.full, now)).map((s) => sessionView(s, s.component, now)) });
  if (view === 'connections') {
    const grants = await listGrants(svc.redis, t.full);
    return json(200, {
      connections: grants.map((g) => ({ id: g.id, client: g.clientName, by: g.name, createdAt: g.createdAt, lastUsedAt: g.lastUsedAt, mine: Boolean(who.login && who.login.toLowerCase() === g.login.toLowerCase()) })),
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

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleConnector(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
