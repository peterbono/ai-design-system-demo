// POST /api/github/token: the one server piece of "Sign in with GitHub" (see docs/SIGN-IN.md).
//
// The Studio is a static site, and GitHub's token endpoint needs the GitHub App client secret and does not answer
// browsers (no CORS), so this Vercel function adds the secret and passes GitHub's answer back. It stores nothing
// and logs nothing: the user access token goes straight back to the browser that asked, which keeps it like a
// pasted token. Two requests, both JSON from the same origin:
//   { "grant": "code", "code", "code_verifier", "redirect_uri", "client_id"? }   finish a sign-in (PKCE)
//   { "grant": "refresh", "refresh_token", "client_id"? }                        renew an expired token
// Two GitHub Apps (docs/SIGN-IN.md): "Bridge" (read only, suggest mode) and "Bridge Direct" (writes code).
// Env (server only): GITHUB_APP_SUGGEST_CLIENT_ID + GITHUB_APP_SUGGEST_CLIENT_SECRET for Bridge,
// GITHUB_APP_CLIENT_ID + GITHUB_APP_CLIENT_SECRET for Bridge Direct. `client_id` picks the app, from an allow-list of
// those two configured ids; without it the Direct app answers (the one-app setup and tabs opened before the switch).
// With no app configured it answers 503 and the Studio keeps the token paste. Self-contained on purpose (no
// imports), so Vercel bundles it as is.

export const CALLBACK_PATH = '/studio/auth/callback/';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const MAX_BODY = 4096;

export interface TokenEnv {
  GITHUB_APP_CLIENT_ID?: string | undefined;
  GITHUB_APP_CLIENT_SECRET?: string | undefined;
  GITHUB_APP_SUGGEST_CLIENT_ID?: string | undefined;
  GITHUB_APP_SUGGEST_CLIENT_SECRET?: string | undefined;
}

interface AppCredentials {
  clientId: string;
  secret: string;
}

/** The configured apps, Direct first (the default without a client_id). An app needs both its id and its secret. */
export function configuredApps(env: TokenEnv): AppCredentials[] {
  const pairs: [string | undefined, string | undefined][] = [
    [env.GITHUB_APP_CLIENT_ID, env.GITHUB_APP_CLIENT_SECRET],
    [env.GITHUB_APP_SUGGEST_CLIENT_ID, env.GITHUB_APP_SUGGEST_CLIENT_SECRET],
  ];
  const out: AppCredentials[] = [];
  for (const [id, secret] of pairs) {
    const clientId = id?.trim();
    const s = secret?.trim();
    if (clientId && s && !out.some((a) => a.clientId === clientId)) out.push({ clientId, secret: s });
  }
  return out;
}

const CLIENT_ID = /^[A-Za-z0-9._-]{4,64}$/;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

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

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/** The request comes from a page on this very site: Origin names this host, and the browser says same-origin. */
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

/** A callback the Studio may have used: https (or a local http server), path /studio/auth/callback/, nothing else. */
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const u = new URL(value);
    const okProto = u.protocol === 'https:' || (u.protocol === 'http:' && isLocalHost(u.host));
    return okProto && u.pathname === CALLBACK_PATH && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

const CODE = /^[A-Za-z0-9_-]{8,128}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const REFRESH = /^[A-Za-z0-9_.-]{8,512}$/;

/** GitHub's error codes, in the Studio's words (scripts read `error`, people read `message`). */
function githubError(code: string): Response {
  switch (code) {
    case 'bad_verification_code':
      return fail(400, 'bad_code', 'GitHub did not accept the sign-in code: it works once and expires after 10 minutes. Sign in again.');
    case 'bad_refresh_token':
      return fail(401, 'bad_refresh_token', 'Your GitHub sign-in expired. Sign in again to keep editing.');
    case 'redirect_uri_mismatch':
      return fail(400, 'redirect_uri_mismatch', 'This site address is not registered on the Bridge GitHub App. Add the callback URL, then sign in again.');
    case 'incorrect_client_credentials':
      return fail(503, 'misconfigured', 'GitHub refused the client ID or secret of this site. Check the GitHub App settings on the host.');
    default:
      return fail(400, 'failed', 'GitHub could not finish the sign-in. Sign in again.');
  }
}

export async function handleTokenRequest(req: Request, env: TokenEnv, fetchImpl: FetchLike): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method', message: 'Use POST.' }, { Allow: 'POST' });
  if (!sameOrigin(req)) return fail(403, 'origin', 'Sign in from the Studio on this site.');
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return fail(415, 'content_type', 'Send JSON.');
  const apps = configuredApps(env);
  if (!apps.length) return fail(503, 'not_configured', 'Sign in with GitHub is not set up on this site yet.');

  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail(413, 'too_large', 'Request too large.');
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, 'bad_request', 'Send a JSON object.');
  }

  // The app: the one whose client id the Studio sent (allow-list of the configured ids), else the first one.
  let app = apps[0]!;
  if (body.client_id !== undefined) {
    if (typeof body.client_id !== 'string' || !CLIENT_ID.test(body.client_id)) return fail(400, 'bad_request', 'The GitHub App client ID is malformed. Sign in again.');
    const found = apps.find((a) => a.clientId === body.client_id);
    if (!found) return fail(400, 'unknown_client', 'This site no longer signs in with that GitHub App. Sign in again.');
    app = found;
  }
  const params = new URLSearchParams({ client_id: app.clientId, client_secret: app.secret });
  if (body.grant === 'code') {
    const { code, code_verifier: verifier, redirect_uri: redirect } = body;
    if (typeof code !== 'string' || !CODE.test(code)) return fail(400, 'bad_request', 'The sign-in code is missing or malformed. Sign in again.');
    if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return fail(400, 'bad_request', 'The sign-in verifier is missing or malformed. Sign in again.');
    if (!validRedirectUri(redirect)) return fail(400, 'bad_request', 'The callback address is not the Studio callback. Sign in again.');
    params.set('code', code);
    params.set('code_verifier', verifier);
    params.set('redirect_uri', redirect);
  } else if (body.grant === 'refresh') {
    const { refresh_token: refresh } = body;
    if (typeof refresh !== 'string' || !REFRESH.test(refresh)) return fail(400, 'bad_request', 'The refresh token is missing or malformed. Sign in again.');
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refresh);
  } else {
    return fail(400, 'bad_request', 'Unknown grant.');
  }

  let res: Response;
  try {
    res = await fetchImpl(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'bridge-studio-signin' },
      body: params.toString(),
    });
  } catch {
    return fail(502, 'unreachable', 'GitHub did not answer. Try again in a minute.');
  }
  if (!res.ok) return fail(502, 'unreachable', 'GitHub did not answer. Try again in a minute.');
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return fail(502, 'unreachable', 'GitHub answered something unexpected. Try again in a minute.');
  }
  if (typeof data.error === 'string') return githubError(data.error);
  if (typeof data.access_token !== 'string' || !data.access_token) return fail(502, 'failed', 'GitHub could not finish the sign-in. Sign in again.');

  // Only GitHub's token fields go back; never the request, never the secret.
  const out: Record<string, unknown> = { access_token: data.access_token, token_type: typeof data.token_type === 'string' ? data.token_type : 'bearer' };
  for (const k of ['expires_in', 'refresh_token', 'refresh_token_expires_in'] as const) {
    if (typeof data[k] === 'number' || typeof data[k] === 'string') out[k] = k === 'refresh_token' ? data[k] : Number(data[k]);
  }
  return json(200, out);
}

/** Vercel Functions entry (Web standard signature). Other methods get 405 from Vercel. */
export function POST(request: Request): Promise<Response> {
  const env: TokenEnv = {
    GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
    GITHUB_APP_SUGGEST_CLIENT_ID: process.env.GITHUB_APP_SUGGEST_CLIENT_ID,
    GITHUB_APP_SUGGEST_CLIENT_SECRET: process.env.GITHUB_APP_SUGGEST_CLIENT_SECRET,
  };
  return handleTokenRequest(request, env, (url, init) => fetch(url, init));
}
