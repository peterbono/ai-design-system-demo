import { studioHref } from './team-path';
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

/**
 * The two GitHub Apps (docs/SIGN-IN.md). 'suggest': "Bridge", read only on code (Contents read, Issues write), the
 * default. 'direct': "Bridge Direct" (the original "Bridge Studio" app), writes branches and pull requests; Studio
 * signs in with it only when bridge.config.json says `"changes": "direct"`.
 */
export type SignInApp = 'suggest' | 'direct';

/** What the browser needs to start a sign-in. Built at build time; null when the GitHub App is not set up. */
export interface SignInConfig {
  /** The GitHub App client ID (public). */
  clientId: string;
  /** Which of the two apps that client ID belongs to. Token storage keys carry it. */
  app: SignInApp;
  /**
   * The app Studio signs in with once `changes` is "suggest": 'suggest' when the read-only app is configured, else
   * 'direct' (the one app this site has). Settings uses it to say whether suggest mode is enforced by GitHub.
   */
  suggestApp: SignInApp;
  /** Production origin, whose callback is the one registered on GitHub. Null: the current origin's callback. */
  productionOrigin: string | null;
  /** Preview origin pattern with {branch} (bridge.config.json previews.apps.docs). Null: no previews. */
  previewPattern: string | null;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

const validId = (id: string | undefined) => {
  const v = id?.trim();
  return v && /^[A-Za-z0-9._-]{4,64}$/.test(v) ? v : null;
};

/**
 * Which app a sign-in uses (multi-team plan 3.2). Identity first: every visitor signs in with the read-only Bridge app
 * (suggest), whose token reads, comments and files suggestions on any repository it is installed on. Bridge Direct
 * only when it is needed: the repository's `changes` is "direct" (read at runtime on a team shell) and the sign-in is
 * for writing code (`need: 'write'`). When only one app is configured, that one (a site that never set up the
 * suggest app keeps signing in as before).
 */
export function pickSignInApp(
  env: { GITHUB_APP_CLIENT_ID?: string | undefined; GITHUB_APP_SUGGEST_CLIENT_ID?: string | undefined },
  changes?: string | null,
  need: 'identity' | 'write' = 'identity',
): { clientId: string; app: SignInApp } | null {
  const direct = validId(env.GITHUB_APP_CLIENT_ID);
  const suggest = validId(env.GITHUB_APP_SUGGEST_CLIENT_ID);
  if (need === 'write' && changes === 'direct' && direct) return { clientId: direct, app: 'direct' };
  if (suggest) return { clientId: suggest, app: 'suggest' };
  if (direct) return { clientId: direct, app: 'direct' };
  return null;
}

/**
 * The config from build-time env vars and bridge.config.json (previews, changes). Null without a client ID.
 * `changes` is bridge.config.json "changes" ("suggest" when absent).
 */
export function signInConfigFrom(
  env: { GITHUB_APP_CLIENT_ID?: string | undefined; GITHUB_APP_SUGGEST_CLIENT_ID?: string | undefined },
  previews?: { apps?: { docs?: string }; production?: { docs?: string } } | null,
  changes?: string | null,
): SignInConfig | null {
  // The self-hosted site has one repository and signs in once: in direct mode its Studio writes code, so it asks for
  // Bridge Direct up front, as before. Team shells sign in for identity and ask for Direct on demand (plan 3.2).
  const picked = pickSignInApp(env, changes, 'write');
  if (!picked) return null;
  const prod = previews?.production?.docs?.trim();
  const preview = previews?.apps?.docs?.trim();
  return {
    ...picked,
    suggestApp: pickSignInApp(env)!.app,
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
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.startsWith(CALLBACK_PATH)) return studioHref();
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
  notConfigured: 'Sign in with GitHub is not set up on this site yet. Ask the site owner to finish the setup.',
  misconfigured: 'GitHub refused the sign-in settings of this site. Ask the site owner to check the GitHub App client ID and secret.',
  badCode: 'GitHub did not accept the sign-in code: it works once and expires after 10 minutes. Sign in again.',
  redirectMismatch: 'This site address is not registered on the Bridge GitHub App. Ask the site owner to add the callback URL, then sign in again.',
  unreachable: 'Studio could not reach its sign-in service. Check your connection, then sign in again.',
  expired: 'Your GitHub sign-in expired. Sign in again to keep editing.',
  switched: 'Bridge now signs in to GitHub with a different app, so your previous sign-in was removed. Sign in again to keep editing.',
  unknownClient: 'This site no longer signs in with that GitHub App. Sign in again.',
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
    if (!originAllowed(decoded.origin, cfg, here)) return { kind: 'error', message: SIGNIN_TEXT.unknownOrigin, returnTo: studioHref() };
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
  /** The client ID of the app that issued the token (refreshes go to the same app). Absent on older sessions. */
  clientId?: string;
  expiresAt: number | null;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
}

export function sessionFrom(r: TokenResponse, now: number, clientId?: string): AppSession {
  const secs = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? now + n * 1000 : null);
  return {
    kind: 'app',
    ...(clientId ? { clientId } : {}),
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
  if (error === 'unknown_client') return SIGNIN_TEXT.unknownClient;
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

/**
 * Where a token lives in localStorage: one slot per app ('suggest', 'direct'), so a token of one app is never used as
 * the other's. '' is the slot without an app: a pasted token on a site with no GitHub App, and every token saved
 * before the two apps existed.
 */
export type StorageSlot = SignInApp | '';
export const STORAGE_SLOTS: readonly StorageSlot[] = ['', 'suggest', 'direct'];

/** A storage key with its slot suffix: 'bridge.github.token' + 'suggest' -> 'bridge.github.token.suggest'. */
export const slotKey = (base: string, slot: StorageSlot) => (slot ? `${base}.${slot}` : base);

/** What one slot holds, as far as the switch cares. */
export interface SlotContent {
  token: boolean;
  /** The sign-in session next to the token: present for Sign in with GitHub, absent for a pasted token. */
  session: Pick<AppSession, 'clientId'> | null;
}

export interface SlotPlan {
  /** Slots whose token goes to the current slot (a pasted token, or a sign-in of the same app). At most one. */
  move: StorageSlot | null;
  /** Slots to empty: sign-ins of another app (their token belongs to an app this site no longer signs in with). */
  clear: StorageSlot[];
  /** A sign-in was removed: say so, and offer to sign in again. */
  switched: boolean;
}

/**
 * What to do with tokens saved in other slots when the page loads. The current slot is the app this page signs in
 * with ('' without a GitHub App). Token slots are global per app: a token of one app stays valid on every repository,
 * so a page never removes the other app's sign-in because its repository's mode differs (multi-team plan 3.2).
 * - The other app's sign-in is kept. When the current slot is empty, the page says that Bridge signs in with a
 *   different app here (`switched`), so the visitor knows why they look signed out.
 * - A sign-in saved before the apps had slots ('') was made with today's Direct app: it moves to 'direct' when that is
 *   the current app and its client ID still matches; on a suggest page it is removed (no app owns that slot).
 * - A pasted token belongs to no app: it moves to the current slot when that one is empty.
 * - The current slot's own sign-in is removed when its client ID is not the current one (the app was replaced).
 * - On a site without a GitHub App ('') the app sign-ins are removed: nothing there can refresh or use them.
 */
export function planSlots(slots: Partial<Record<StorageSlot, SlotContent>>, current: StorageSlot, clientId: string | null): SlotPlan {
  const plan: SlotPlan = { move: null, clear: [], switched: false };
  const here = slots[current];
  let filled = Boolean(here?.token);
  if (here?.token && here.session?.clientId && clientId && here.session.clientId !== clientId) {
    plan.clear.push(current);
    plan.switched = true;
    filled = false;
  }
  let otherApp = false;
  for (const slot of STORAGE_SLOTS) {
    if (slot === current) continue;
    const c = slots[slot];
    if (!c?.token) continue;
    const sameApp = c.session && slot === '' && current === 'direct' && (!c.session.clientId || c.session.clientId === clientId);
    if (!filled && (!c.session || sameApp)) {
      plan.move = slot;
      filled = true;
      continue;
    }
    // Another app's sign-in (or a pasted token kept there): valid for that app, kept for its pages.
    if (slot !== '' && current !== '') {
      if (c.session) otherApp = true;
      continue;
    }
    plan.clear.push(slot);
    if (c.session && current) plan.switched = true;
  }
  if (otherApp && !filled) plan.switched = true;
  return plan;
}
