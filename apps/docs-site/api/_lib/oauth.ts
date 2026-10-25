// The OAuth 2.1 authorization server of the hosted Bridge MCP connector (api/mcp, docs/FIGMA-FIXES.md "Bridge inside
// your team's Claude"), following the MCP authorization spec 2026-07-28 and Claude's connector requirements:
//   - Client registration: Client ID Metadata Documents (an https client_id URL, fetched and checked) and Dynamic Client
//     Registration (RFC 7591, kept for older clients). Public clients only: token_endpoint_auth_method "none".
//   - Authorization code with PKCE S256 (required), the `resource` indicator (RFC 8707) checked, `iss` in the redirect
//     (RFC 9207). Redirect URIs match exactly, except loopback (Claude Code): http://localhost or 127.0.0.1, any port.
//   - The person signs in to Bridge (their Bridge account session), picks the team on /studio/connect-claude/, then
//     GitHub confirms who they are with the Bridge GitHub App (user-to-server); Bridge checks that GitHub account can
//     push to the team's repository. The server then acts on that repository with that person's GitHub App user token,
//     renewed on the server (GitHub's refresh token, sealed at rest, never sent to any client).
//   - Bridge's own tokens are opaque and short-lived: access tokens 1 hour, refresh tokens 30 days, rotated on every use
//     (a used one is gone). Only their SHA-256 is stored. A grant (one person, one team, one client) is revocable from
//     Studio Settings, which ends its tokens at once.
// No secret ever goes in a URL: codes are one-time and live 2 minutes, tokens travel in bodies and headers only.
//
// Keys (Upstash Redis; hashes are SHA-256 hex):
//   bridge:oauth:client:<client_id>       a registered client (DCR) or a fetched client metadata document (CIMD, 1 hour)
//   bridge:oauth:req:<id>                 an authorization request waiting for the person, 30 minutes (sign-in on the way)
//   bridge:oauth:gh:<hash(state)>         the GitHub leg of a request, 10 minutes
//   bridge:oauth:code:<hash(code)>        an authorization code, 2 minutes, used once (GETDEL)
//   bridge:oauth:grant:<id>               a grant { repo, client, who, sealed GitHub tokens, dates }, 90 days after last use
//   bridge:oauth:grants:<repo>            set of the team's grant ids
//   bridge:oauth:at:<hash>                an access token -> grant id, 1 hour
//   bridge:oauth:rt:<hash>                a refresh token -> grant id, 30 days, used once (GETDEL)
//   bridge:oauth:reg:<ip hash>:<hour>     registrations per network and hour

import { createHash, randomBytes } from 'node:crypto';
import { b64url, HttpError, sha256, type FetchLike } from './http.js';
import type { Redis } from './redis.js';
import { seal, unseal, type Sealed } from './sealed.js';

export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const GRANT_TTL_S = 90 * 24 * 60 * 60;
/** Long enough to sign in to Bridge (an email code) on the way, and come back to the same request. */
export const REQ_TTL_S = 30 * 60;
const CODE_TTL_S = 2 * 60;
const CLIENT_TTL_S = 180 * 24 * 60 * 60;
const CIMD_TTL_S = 60 * 60;
const REG_PER_HOUR = 30;
export const SCOPE = 'bridge';
export const CONNECT_PAGE = '/studio/connect-claude/';
export const REQUEST_COOKIE = 'bridge_oauth';

export const OAUTH_WORDS = {
  badClient: 'This app is not registered with Bridge. Remove the connector in Claude and add it again.',
  badRedirect: 'This app asked to go back to an address it did not register.',
  badRequest: 'Claude sent a sign-in request Bridge cannot use. Remove the connector in Claude and add it again.',
  expired: 'This sign-in took too long. Start again from Claude.',
  otherBrowser: 'Finish signing in in the browser where you started it from Claude.',
  signIn: 'Sign in to Bridge first.',
  noAccess: "Your GitHub account cannot change this team's design system. Pick a team you can edit, or ask its admin for access.",
  notConfigured: 'Bridge inside Claude is not set up on this site yet.',
  github: 'GitHub did not confirm your sign-in. Start again from Claude.',
} as const;

const now = () => Date.now();
const hash = (s: string) => sha256(s);
const token = (prefix: string, random: (n: number) => Uint8Array) => `${prefix}${b64url(Buffer.from(random(32)))}`;

function parse<T>(raw: unknown, ok: (v: any) => boolean): T | null {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return v && ok(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Metadata

/** The issuer (this site's origin, no path) and the MCP server's canonical URL. */
export interface Site {
  issuer: string;
  resource: string;
}

export function siteOf(req: Request, publicUrl: string | undefined): Site {
  let origin = new URL(req.url).origin;
  try {
    if (publicUrl?.trim()) origin = new URL(publicUrl.trim()).origin;
  } catch {
    /* the request's own origin */
  }
  return { issuer: origin, resource: `${origin}/mcp` };
}

/** The resource URLs a token may be asked for: /mcp, and the function's own /api/mcp. */
const resources = (s: Site) => [s.resource, `${s.issuer}/api/mcp`];

/** RFC 9728 protected resource metadata. */
export function resourceMetadata(s: Site) {
  return { resource: s.resource, authorization_servers: [s.issuer], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Bridge' };
}

/** RFC 8414 authorization server metadata (CIMD needs both client_id_metadata_document_supported and "none"). */
export function serverMetadata(s: Site) {
  return {
    issuer: s.issuer,
    authorization_endpoint: `${s.issuer}/oauth/authorize`,
    token_endpoint: `${s.issuer}/oauth/token`,
    registration_endpoint: `${s.issuer}/oauth/register`,
    revocation_endpoint: `${s.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [SCOPE, 'offline_access'],
    service_documentation: `${s.issuer}/docs/`,
  };
}

/** The 401 an MCP request without a valid token gets: where the metadata is, and the scope. */
export function challenge(s: Site, error?: 'invalid_token'): string {
  return `Bearer resource_metadata="${s.issuer}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"${error ? `, error="${error}"` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Clients

export interface Client {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  kind: 'dcr' | 'cimd';
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function redirectAllowed(u: string): boolean {
  try {
    const x = new URL(u);
    if (x.hash || x.username || x.password) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && LOOPBACK.has(x.hostname);
  } catch {
    return false;
  }
}

/** Exact match, or a loopback redirect with the same host and path on any port (RFC 8252 7.3, Claude Code). */
export function redirectMatches(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let a: URL;
  try {
    a = new URL(asked);
  } catch {
    return false;
  }
  if (a.protocol !== 'http:' || !LOOPBACK.has(a.hostname)) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return x.protocol === 'http:' && x.hostname === a.hostname && x.pathname === a.pathname && x.search === a.search;
    } catch {
      return false;
    }
  });
}

const clientKey = (id: string) => `bridge:oauth:client:${hash(id)}`;
const isClient = (v: any) => typeof v.client_id === 'string' && Array.isArray(v.redirect_uris) && typeof v.client_name === 'string';

/** DCR (RFC 7591): public clients, https or loopback redirects. */
export async function registerClient(redis: Redis, body: Record<string, unknown>, ip: string, random: (n: number) => Uint8Array, at = now()): Promise<Record<string, unknown>> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectAllowed)) throw new HttpError(400, 'invalid_redirect_uri', 'redirect_uris must be https addresses, or http on localhost or 127.0.0.1.');
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw new HttpError(400, 'invalid_client_metadata', 'Bridge registers public clients only: token_endpoint_auth_method "none".');
  const k = `bridge:oauth:reg:${hash(ip).slice(0, 16)}:${Math.floor(at / 3_600_000)}`;
  const [n] = await redis.pipe([['INCRBY', k, 1], ['EXPIRE', k, 3600]]);
  if (Number(n) > REG_PER_HOUR) throw new HttpError(429, 'too_many_registrations', 'Too many registrations from this network. Try again in an hour.');
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'An app';
  const c: Client = { client_id: `bc_${b64url(Buffer.from(random(16)))}`, client_name: name, redirect_uris: uris, kind: 'dcr' };
  await redis.cmd('SET', clientKey(c.client_id), JSON.stringify(c), 'EX', CLIENT_TTL_S);
  return {
    client_id: c.client_id,
    client_id_issued_at: Math.floor(at / 1000),
    client_name: c.client_name,
    redirect_uris: c.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** A CIMD client_id: an https URL with a path, on a named host (no IP literal, no localhost). */
export function isMetadataUrl(id: string): boolean {
  try {
    const u = new URL(id);
    if (u.protocol !== 'https:' || u.pathname === '/' || !u.pathname || u.hash || u.username || u.password || u.port) return false;
    return !/^(\d+\.){3}\d+$/.test(u.hostname) && !u.hostname.startsWith('[') && !LOOPBACK.has(u.hostname) && u.hostname.includes('.') && !u.hostname.endsWith('.local') && !u.hostname.endsWith('.internal');
  } catch {
    return false;
  }
}

/** The client behind a client_id: a registered one, or its metadata document fetched (and kept an hour). */
export async function resolveClient(redis: Redis, f: FetchLike, id: string): Promise<Client | null> {
  if (!id || id.length > 512) return null;
  const kept = parse<Client>(await redis.cmd('GET', clientKey(id)), isClient);
  if (kept) return kept;
  if (!isMetadataUrl(id)) return null;
  let text: string;
  try {
    const res = await Promise.race([
      f(id, { method: 'GET', headers: { Accept: 'application/json' } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }
  if (text.length > 32_000) return null;
  const doc = parse<Record<string, unknown>>(text, (v) => typeof v === 'object');
  if (!doc || doc.client_id !== id || !Array.isArray(doc.redirect_uris)) return null;
  const uris = doc.redirect_uris.filter((u): u is string => typeof u === 'string' && redirectAllowed(u));
  if (!uris.length) return null;
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') return null;
  const c: Client = { client_id: id, client_name: typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim().slice(0, 80) : new URL(id).hostname, redirect_uris: uris, kind: 'cimd' };
  await redis.cmd('SET', clientKey(id), JSON.stringify(c), 'EX', CIMD_TTL_S);
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Authorization requests

export interface AuthRequest {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string;
  /** SHA-256 of the cookie that binds the request to the browser that started it. */
  nonce: string;
  createdAt: number;
  /** Set once the person picked the team. */
  repo?: string;
  by?: string;
  /** The PKCE verifier of the GitHub leg. */
  ghVerifier?: string;
}

const reqKey = (id: string) => `bridge:oauth:req:${id}`;
const isReq = (v: any) => typeof v.id === 'string' && typeof v.clientId === 'string' && typeof v.redirectUri === 'string';

/** Where the client gets the answer: its redirect URI with the parameters and `iss` (RFC 9207). */
export function clientRedirect(r: Pick<AuthRequest, 'redirectUri' | 'state'>, issuer: string, params: Record<string, string>): string {
  const u = new URL(r.redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (r.state !== null) u.searchParams.set('state', r.state);
  u.searchParams.set('iss', issuer);
  return u.toString();
}

const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Checks an authorization request. Returns the request to keep, or an error: `redirect` when the client and its
 * redirect URI are known (the error goes back to the client), else a page error (never redirect to an unknown address).
 */
export async function startAuthorization(
  redis: Redis,
  f: FetchLike,
  site: Site,
  q: URLSearchParams,
  random: (n: number) => Uint8Array,
  at = now(),
): Promise<{ ok: true; req: AuthRequest; cookie: string } | { ok: false; redirect?: string; message: string }> {
  const client = await resolveClient(redis, f, q.get('client_id') ?? '');
  if (!client) return { ok: false, message: OAUTH_WORDS.badClient };
  const asked = q.get('redirect_uri') ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0]! : '');
  if (!asked || !redirectMatches(client.redirect_uris, asked)) return { ok: false, message: OAUTH_WORDS.badRedirect };
  const state = q.get('state');
  const back = (error: string, description: string) => ({ ok: false as const, message: description, redirect: clientRedirect({ redirectUri: asked, state }, site.issuer, { error, error_description: description }) });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Bridge answers response_type=code only.');
  const challengeValue = q.get('code_challenge') ?? '';
  if (!CHALLENGE.test(challengeValue) || q.get('code_challenge_method') !== 'S256') return back('invalid_request', 'PKCE with S256 is required.');
  const resource = q.get('resource') ?? site.resource;
  if (!resources(site).includes(resource.replace(/\/$/, ''))) return back('invalid_target', 'This authorization server issues tokens for the Bridge MCP server only.');
  const cookie = b64url(Buffer.from(random(32)));
  const req: AuthRequest = { id: b64url(Buffer.from(random(18))), clientId: client.client_id, clientName: client.client_name, redirectUri: asked, codeChallenge: challengeValue, state, resource: resource.replace(/\/$/, ''), nonce: hash(cookie), createdAt: at };
  await redis.cmd('SET', reqKey(req.id), JSON.stringify(req), 'EX', REQ_TTL_S);
  return { ok: true, req, cookie };
}

export async function getRequest(redis: Redis, id: string): Promise<AuthRequest | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(id)) return null;
  return parse<AuthRequest>(await redis.cmd('GET', reqKey(id)), isReq);
}

export async function putRequest(redis: Redis, r: AuthRequest): Promise<void> {
  await redis.cmd('SET', reqKey(r.id), JSON.stringify(r), 'EX', REQ_TTL_S);
}

export const dropRequest = (redis: Redis, id: string) => redis.cmd('DEL', reqKey(id));

/** The request belongs to this browser: the cookie set when it started. */
export const sameBrowser = (r: AuthRequest, cookie: string | null) => Boolean(cookie) && hash(cookie!) === r.nonce;

// ---------------------------------------------------------------------------------------------------------------
// The GitHub leg: the Bridge GitHub App confirms who the person is and gives their user token to the server

export const ghStateKey = (state: string) => `bridge:oauth:gh:${hash(state)}`;

export function pkcePair(random: (n: number) => Uint8Array): { verifier: string; challenge: string } {
  const verifier = b64url(Buffer.from(random(32)));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export interface GitHubTokens {
  access: string;
  refresh: string | null;
  /** ms */
  accessExp: number | null;
  refreshExp: number | null;
}

export async function githubTokenRequest(f: FetchLike, app: { clientId: string; secret: string }, params: Record<string, string>, at = now()): Promise<GitHubTokens | null> {
  let res: Response;
  try {
    res = await f('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'bridge-mcp' },
      body: new URLSearchParams({ client_id: app.clientId, client_secret: app.secret, ...params }).toString(),
    });
  } catch {
    return null;
  }
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !d || typeof d.access_token !== 'string' || !d.access_token) return null;
  const secs = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : null);
  const ea = secs(d.expires_in);
  const er = secs(d.refresh_token_expires_in);
  return { access: d.access_token, refresh: typeof d.refresh_token === 'string' ? d.refresh_token : null, accessExp: ea ? at + ea * 1000 : null, refreshExp: er ? at + er * 1000 : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Grants, codes and tokens

export interface Grant {
  v: 1;
  id: string;
  repo: string;
  clientId: string;
  clientName: string;
  login: string;
  /** The display name: GitHub profile name, else the Bridge account name, else the login. Never an email. */
  name: string;
  createdAt: string;
  lastUsedAt: string;
  gh: Sealed;
}

const grantKey = (id: string) => `bridge:oauth:grant:${id}`;
const grantsKey = (repo: string) => `bridge:oauth:grants:${repo.toLowerCase()}`;
const codeKey = (code: string) => `bridge:oauth:code:${hash(code)}`;
const atKey = (t: string) => `bridge:oauth:at:${hash(t)}`;
const rtKey = (t: string) => `bridge:oauth:rt:${hash(t)}`;
const isGrant = (v: any) => v.v === 1 && typeof v.id === 'string' && typeof v.repo === 'string' && v.gh && typeof v.gh.ct === 'string';

export async function createGrant(redis: Redis, key: Buffer, x: { repo: string; client: Pick<AuthRequest, 'clientId' | 'clientName'>; login: string; name: string; gh: GitHubTokens }, random: (n: number) => Uint8Array, at = now()): Promise<Grant> {
  const id = b64url(Buffer.from(random(18)));
  const iso = new Date(at).toISOString();
  const g: Grant = { v: 1, id, repo: x.repo.toLowerCase(), clientId: x.client.clientId, clientName: x.client.clientName, login: x.login, name: x.name, createdAt: iso, lastUsedAt: iso, gh: seal(JSON.stringify(x.gh), key, id, random) };
  await redis.pipe([
    ['SET', grantKey(id), JSON.stringify(g), 'EX', GRANT_TTL_S],
    ['SADD', grantsKey(g.repo), id],
  ]);
  return g;
}

export async function getGrant(redis: Redis, id: string): Promise<Grant | null> {
  return parse<Grant>(await redis.cmd('GET', grantKey(id)), isGrant);
}

export async function saveGrant(redis: Redis, g: Grant): Promise<void> {
  await redis.cmd('SET', grantKey(g.id), JSON.stringify(g), 'EX', GRANT_TTL_S);
}

/** Ends a grant: its tokens stop working at once (every token lookup reads the grant). */
export async function revokeGrant(redis: Redis, g: Pick<Grant, 'id' | 'repo'>): Promise<void> {
  await redis.pipe([
    ['DEL', grantKey(g.id)],
    ['SREM', grantsKey(g.repo), g.id],
  ]);
}

/** The team's grants (people connected in Claude), newest use first; ended ones leave the index. */
export async function listGrants(redis: Redis, repo: string): Promise<Grant[]> {
  const raw = await redis.cmd('SMEMBERS', grantsKey(repo));
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  const out: Grant[] = [];
  for (const id of ids) {
    const g = await getGrant(redis, id);
    if (g) out.push(g);
    else await redis.cmd('SREM', grantsKey(repo), id);
  }
  return out.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export function openGitHubTokens(g: Grant, key: Buffer): GitHubTokens | null {
  const t = unseal(g.gh, key, g.id);
  return t ? (JSON.parse(t) as GitHubTokens) : null;
}

export async function issueCode(redis: Redis, r: AuthRequest, grantId: string, random: (n: number) => Uint8Array): Promise<string> {
  const code = b64url(Buffer.from(random(32)));
  await redis.cmd('SET', codeKey(code), JSON.stringify({ grantId, clientId: r.clientId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, resource: r.resource }), 'EX', CODE_TTL_S);
  return code;
}

async function issueTokens(redis: Redis, grantId: string, clientId: string, random: (n: number) => Uint8Array) {
  const access = token('bat_', random);
  const refresh = token('brt_', random);
  const v = JSON.stringify({ grantId, clientId });
  await redis.pipe([
    ['SET', atKey(access), v, 'EX', ACCESS_TTL_S],
    ['SET', rtKey(refresh), v, 'EX', REFRESH_TTL_S],
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

/** An RFC 6749 token error. */
export class TokenError extends Error {
  constructor(
    readonly error: 'invalid_request' | 'invalid_grant' | 'invalid_client' | 'unsupported_grant_type' | 'invalid_target',
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const s256 = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

/** POST /oauth/token (form): the code exchange (PKCE) and the refresh (rotation: the used refresh token is gone). */
export async function exchangeToken(redis: Redis, site: Site, form: URLSearchParams, random: (n: number) => Uint8Array = (n) => randomBytes(n)) {
  const grantType = form.get('grant_type');
  const clientId = form.get('client_id') ?? '';
  const resource = form.get('resource');
  if (resource && !resources(site).includes(resource.replace(/\/$/, ''))) throw new TokenError('invalid_target', 'Tokens are for the Bridge MCP server only.');
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const c = parse<{ grantId: string; clientId: string; redirectUri: string; codeChallenge: string; resource: string }>(code ? await redis.cmd('GETDEL', codeKey(code)) : null, (v) => typeof v.grantId === 'string');
    if (!c) throw new TokenError('invalid_grant', 'The code is unknown, used or expired.');
    if (clientId && clientId !== c.clientId) throw new TokenError('invalid_grant', 'The code was issued to another client.');
    if ((form.get('redirect_uri') ?? c.redirectUri) !== c.redirectUri) throw new TokenError('invalid_grant', 'redirect_uri does not match.');
    const verifier = form.get('code_verifier') ?? '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || s256(verifier) !== c.codeChallenge) throw new TokenError('invalid_grant', 'The PKCE verifier does not match.');
    if (!(await getGrant(redis, c.grantId))) throw new TokenError('invalid_grant', 'This connection was removed.');
    return issueTokens(redis, c.grantId, c.clientId, random);
  }
  if (grantType === 'refresh_token') {
    const rt = form.get('refresh_token') ?? '';
    const t = parse<{ grantId: string; clientId: string }>(rt ? await redis.cmd('GETDEL', rtKey(rt)) : null, (v) => typeof v.grantId === 'string');
    if (!t) throw new TokenError('invalid_grant', 'The refresh token is unknown, used or expired.');
    if (clientId && clientId !== t.clientId) throw new TokenError('invalid_grant', 'The refresh token was issued to another client.');
    if (!(await getGrant(redis, t.grantId))) throw new TokenError('invalid_grant', 'This connection was removed.');
    return issueTokens(redis, t.grantId, t.clientId, random);
  }
  throw new TokenError('unsupported_grant_type', 'Bridge supports authorization_code and refresh_token.');
}

/** POST /oauth/revoke (RFC 7009): the token is gone; unknown tokens answer the same. */
export async function revokeToken(redis: Redis, value: string): Promise<void> {
  if (!value) return;
  await redis.pipe([
    ['DEL', atKey(value)],
    ['DEL', rtKey(value)],
  ]);
}

/** The grant an access token opens, or null (unknown, expired, or its grant was removed). */
export async function grantOfAccessToken(redis: Redis, value: string): Promise<Grant | null> {
  if (!/^bat_[A-Za-z0-9_-]{40,50}$/.test(value)) return null;
  const t = parse<{ grantId: string }>(await redis.cmd('GET', atKey(value)), (v) => typeof v.grantId === 'string');
  return t ? getGrant(redis, t.grantId) : null;
}
