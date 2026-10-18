// Sign in with GitHub for the Studio, pure helpers (no DOM, no storage), covered by github-signin.test.ts.
//
// The flow is the GitHub App user-to-server flow with state and PKCE:
//   1. The browser makes a state and a code verifier, keeps them in sessionStorage, and goes to GitHub's authorize
//      page with the verifier's S256 challenge. The state also carries the origin the sign-in started on.
//   2. GitHub sends the browser back to the one registered callback, /studio/auth/callback/ on the production site.
//      When the sign-in started on a preview (or a local dev server), that page forwards the code to the same path
//      on the starting origin, only when that origin matches the preview pattern of bridge.config.json.
//   3. The callback page on the starting origin checks the state, removes the code from the address bar, and POSTs
//      the code and the verifier to its own /api/github/token function (api/github/token.ts), which adds the client
//      secret and returns the user access token. The token then lives in this browser, like a pasted one.
// The browser glue is scripts/github-signin.ts; refreshing an expired token lives in scripts/github-session.ts.

/** Where GitHub sends the browser back. Register `<production site>/studio/auth/callback/` on the GitHub App. */
export const CALLBACK_PATH = '/studio/auth/callback/';
/** The serverless function that trades a code (or a refresh token) for a user access token. */
export const TOKEN_ENDPOINT = '/api/github/token';
export const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
/** A sign-in not finished within this time is dropped (GitHub codes also expire after 10 minutes). */
export const PENDING_MAX_AGE_MS = 10 * 60 * 1000;
/** A user access token is refreshed when it expires within this margin. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** What the browser needs to start a sign-in. Built at build time; null when the GitHub App is not set up. */
export interface SignInConfig {
  /** The GitHub App client ID (public). */
  clientId: string;
  /** Production origin, whose callback is the one registered on GitHub. Null: the current origin's callback. */
  productionOrigin: string | null;
  /** Preview origin pattern with {branch} (bridge.config.json previews.apps.docs). Null: no previews. */
  previewPattern: string | null;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** The config from build-time env vars and bridge.config.json previews. Null without a client ID. */
export function signInConfigFrom(
  env: { GITHUB_APP_CLIENT_ID?: string | undefined },
  previews?: { apps?: { docs?: string }; production?: { docs?: string } } | null,
): SignInConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  if (!clientId || !/^[A-Za-z0-9._-]{4,64}$/.test(clientId)) return null;
  const prod = previews?.production?.docs?.trim();
  const preview = previews?.apps?.docs?.trim();
  return {
    clientId,
    productionOrigin: prod && /^https:\/\/[^/]+\/?$/.test(prod) ? trimSlash(prod) : null,
    previewPattern: preview && preview.includes('{branch}') && preview.startsWith('https://') ? trimSlash(preview) : null,
  };
}

/** Base64url without padding (RFC 4648 section 5). */
export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random URL-safe string from `bytes` random bytes. 32 bytes give a 43-character PKCE verifier. */
export function randomString(bytes: number, fill: (a: Uint8Array) => Uint8Array): string {
  return base64url(fill(new Uint8Array(bytes)));
}

/** The PKCE S256 challenge of a verifier: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string, sha256: (data: Uint8Array) => Promise<ArrayBuffer>): Promise<string> {
  return base64url(new Uint8Array(await sha256(new TextEncoder().encode(verifier))));
}

const textToB64url = (s: string) => base64url(new TextEncoder().encode(s));
function b64urlToText(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The OAuth state: a random nonce, then the origin the sign-in started on (so the callback can forward to it). */
export const encodeState = (nonce: string, origin: string) => `${nonce}.${textToB64url(origin)}`;

export function decodeState(state: string | null | undefined): { nonce: string; origin: string } | null {
  if (!state) return null;
  const m = /^([A-Za-z0-9_-]{16,128})\.([A-Za-z0-9_-]{4,400})$/.exec(state);
  if (!m) return null;
  const origin = b64urlToText(m[2]!);
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.origin !== origin) return null;
  } catch {
    return null;
  }
  return { nonce: m[1]!, origin };
}

const isLocal = (u: URL) => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');

/** True for an origin a production callback may forward a code to: production, a docs preview, or a local server. */
export function originAllowed(origin: string, cfg: Pick<SignInConfig, 'productionOrigin' | 'previewPattern'>, here?: string): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (here && origin === here) return true;
  if (isLocal(u)) return true;
  if (u.protocol !== 'https:') return false;
  if (cfg.productionOrigin && origin === cfg.productionOrigin) return true;
  if (cfg.previewPattern) {
    const [before, after] = cfg.previewPattern.split('{branch}') as [string, string];
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^${esc(before)}[a-z0-9-]{1,63}${esc(after)}$`).test(origin)) return true;
  }
  return false;
}

/** The callback GitHub returns to: the production one when known (the only one registered), else this origin's. */
export function callbackUrl(here: string, cfg: Pick<SignInConfig, 'productionOrigin'>): string {
  return `${cfg.productionOrigin ?? here}${CALLBACK_PATH}`;
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    allow_signup: 'false',
  });
  return `${AUTHORIZE_URL}?${q}`;
}

/** Only a same-site path is a place to come back to ("/studio/changes/?pr=3"). Anything else: Studio home. */
export function safeReturnTo(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.startsWith(CALLBACK_PATH)) return '/studio/';
  return path;
}

/** The sign-in this tab started, kept in sessionStorage until the callback. */
export interface PendingSignIn {
  state: string;
  verifier: string;
  redirectUri: string;
  returnTo: string;
  /** Epoch ms when it started. */
  at: number;
}

/** The plain sentences of the sign-in. Each one says how to fix it. */
export const SIGNIN_TEXT = {
  denied: 'You cancelled the sign-in on GitHub, so Studio stays read only. Sign in again when you are ready.',
  stale: 'This sign-in was started in another tab or has already been used. Sign in again from here.',
  slow: 'The sign-in took more than 10 minutes, so GitHub dropped it. Sign in again.',
  unknownOrigin: 'This sign-in started on a site Bridge does not recognize. Open Studio and sign in again from there.',
  noCode: 'GitHub came back without a sign-in code. Sign in again.',
  notConfigured: 'Sign in with GitHub is not set up on this site yet. Ask the site owner to finish the setup, or use a token instead.',
  misconfigured: 'GitHub refused the sign-in settings of this site. Ask the site owner to check the GitHub App client ID and secret.',
  badCode: 'GitHub did not accept the sign-in code: it works once and expires after 10 minutes. Sign in again.',
  redirectMismatch: 'This site address is not registered on the Bridge GitHub App. Ask the site owner to add the callback URL, then sign in again.',
  unreachable: 'Studio could not reach its sign-in service. Check your connection, then sign in again.',
  expired: 'Your GitHub sign-in expired. Sign in again to keep editing.',
  failed: 'GitHub could not finish the sign-in. Sign in again.',
} as const;

export type CallbackStep =
  | { kind: 'relay'; url: string }
  | { kind: 'exchange'; code: string; verifier: string; redirectUri: string; returnTo: string }
  | { kind: 'error'; message: string; returnTo: string };

/**
 * What the callback page does with GitHub's answer. `here` is this page's origin, `pending` the sign-in this tab
 * started (null when none). Forwarding happens before the state check: the starting tab holds the verifier.
 */
export function callbackStep(params: URLSearchParams, here: string, pending: PendingSignIn | null, cfg: Pick<SignInConfig, 'productionOrigin' | 'previewPattern'>, now: number): CallbackStep {
  const state = params.get('state');
  const decoded = decodeState(state);
  if (decoded && decoded.origin !== here) {
    if (!originAllowed(decoded.origin, cfg, here)) return { kind: 'error', message: SIGNIN_TEXT.unknownOrigin, returnTo: '/studio/' };
    const fwd = new URLSearchParams();
    for (const k of ['code', 'state', 'error', 'error_description']) {
      const v = params.get(k);
      if (v !== null) fwd.set(k, v);
    }
    return { kind: 'relay', url: `${decoded.origin}${CALLBACK_PATH}?${fwd}` };
  }
  const returnTo = safeReturnTo(pending?.returnTo);
  const error = params.get('error');
  if (error === 'access_denied') return { kind: 'error', message: SIGNIN_TEXT.denied, returnTo };
  if (!pending || !state || pending.state !== state) return { kind: 'error', message: SIGNIN_TEXT.stale, returnTo };
  if (now - pending.at > PENDING_MAX_AGE_MS || now < pending.at) return { kind: 'error', message: SIGNIN_TEXT.slow, returnTo };
  if (error === 'redirect_uri_mismatch') return { kind: 'error', message: SIGNIN_TEXT.redirectMismatch, returnTo };
  if (error) return { kind: 'error', message: SIGNIN_TEXT.failed, returnTo };
  const code = params.get('code');
  if (!code) return { kind: 'error', message: SIGNIN_TEXT.noCode, returnTo };
  return { kind: 'exchange', code, verifier: pending.verifier, redirectUri: pending.redirectUri, returnTo };
}

/** The token function's answer (GitHub's fields, nothing else). */
export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/** A signed-in session, kept in localStorage next to the token. Expiry fields are null for tokens that never expire. */
export interface AppSession {
  kind: 'app';
  expiresAt: number | null;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
}

export function sessionFrom(r: TokenResponse, now: number): AppSession {
  const secs = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? now + n * 1000 : null);
  return {
    kind: 'app',
    expiresAt: secs(r.expires_in),
    refreshToken: typeof r.refresh_token === 'string' && r.refresh_token ? r.refresh_token : null,
    refreshExpiresAt: secs(r.refresh_token_expires_in),
  };
}

/** The refresh token is there and still valid. */
export const canRefresh = (s: AppSession | null | undefined, now: number): boolean =>
  Boolean(s?.refreshToken) && (s!.refreshExpiresAt === null || s!.refreshExpiresAt > now);

/** The access token expires within the margin (or has expired) and can be refreshed. */
export const needsRefresh = (s: AppSession | null | undefined, now: number): boolean =>
  Boolean(s && s.expiresAt !== null && s.expiresAt - now < REFRESH_MARGIN_MS && canRefresh(s, now));

/** Milliseconds until the token should be refreshed, for a timer. Null: nothing to schedule. */
export function refreshDelay(s: AppSession | null | undefined, now: number): number | null {
  if (!s || s.expiresAt === null || !canRefresh(s, now)) return null;
  return Math.max(0, s.expiresAt - REFRESH_MARGIN_MS - now);
}

/** The sentence for a failed call to the token function, from its status and its `error` code. */
export function exchangeErrorText(status: number, error?: string | null): string {
  if (error === 'misconfigured') return SIGNIN_TEXT.misconfigured;
  if (status === 503 || status === 404 || error === 'not_configured') return SIGNIN_TEXT.notConfigured;
  if (error === 'bad_code') return SIGNIN_TEXT.badCode;
  if (error === 'bad_refresh_token') return SIGNIN_TEXT.expired;
  if (error === 'redirect_uri_mismatch') return SIGNIN_TEXT.redirectMismatch;
  if (status === 0) return SIGNIN_TEXT.unreachable;
  return SIGNIN_TEXT.failed;
}

/** One installation of the GitHub App, as GET /user/installations lists it. */
export interface InstallationLike {
  id: number;
  account?: { login?: string } | null;
  repository_selection?: 'all' | 'selected' | string;
}

/**
 * Whether the signed-in account reaches the repository through the app: 'yes' when an installation on the owner
 * covers all repositories, 'check' (with its id) when it covers selected ones, 'no' when there is none.
 */
export function installationFor(list: InstallationLike[], owner: string): { reach: 'yes' } | { reach: 'check'; id: number } | { reach: 'no' } {
  const inst = list.find((i) => i.account?.login?.toLowerCase() === owner.toLowerCase());
  if (!inst) return { reach: 'no' };
  return inst.repository_selection === 'all' ? { reach: 'yes' } : { reach: 'check', id: inst.id };
}

/** The sentence when the signed-in account cannot reach the repository (wrong account, or the app is not installed). */
export const noReachText = (login: string, repo: string) =>
  `@${login} cannot edit ${repo} through Bridge. Ask the repository owner to install the Bridge GitHub App on it and give you write access, or sign out and sign in with another GitHub account.`;

/** The sentence when the account reaches the repository but only reads it. */
export const readOnlyText = (login: string, repo: string, app: boolean) =>
  app
    ? `@${login} can read ${repo} but not edit it. Ask an owner for write access, or sign out and sign in with another GitHub account.`
    : 'This token can read but not write. Reviews and token proposals need Contents and Pull requests write access.';
