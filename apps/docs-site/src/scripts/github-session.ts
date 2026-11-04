// GitHub access from the browser. Reads are unauthenticated when no token is set (public repos, 60 requests an
// hour per IP); every successful GET is cached in localStorage so a rate-limited visitor still sees the last data.
// Writes (reviews, merges, token proposals) need a token: a user access token from "Sign in with GitHub" (when the
// site has a GitHub App, see docs/SIGN-IN.md and lib/github-signin.ts), or a fine-grained token the user pastes
// once. Either stays in this browser's localStorage, is only ever sent to api.github.com (and, for a refresh, to
// this site's own /api/github/token), and is never part of the build.

import { attrUrl, escapeHtml } from '../lib/html';
import { agoInSentence, classifyAuth, type FetchLike, GitHubClient, GitHubError, type ClientOptions, friendlyMessage, resolveRepoAccess } from '@bridge-ds/core';
import { ACCESS_READ, accessFromCheck, anonymousAccess, accessLabel, accessStorageKey, accessView, contributorAccess, freshAccess, lastKnownAccess, pillState, type RepoAccess, type RepoAccessState } from '../lib/access';
import { busyRetryDelay, githubBusy, type GitHubBusy } from '../lib/github-busy';
import { repoContext, siteConfig } from './repo-context';
import { productRouteFor, teamReadRoute } from '../lib/write-route';
import { clearPrivateRepoCaches, clearRepoCache } from './repo-cache';
import {
  authFailure,
  type AuthFailure,
  type TokenCheck,
  checkFor,
  needsCheck,
  okCheck,
  readCacheMode,
  rejectedCheck,
  sessionState,
  rejectedText,
  type SessionMode,
} from '../lib/token-session';
import { closeDialog, isDialogOpen, openDialog as openDsDialog } from '@bridge-ds/react/dom';
import { paintAvatar, paintDrawnAvatar } from './avatar';
import { clearPendingAction, keepPendingAction } from './pending-action';
import { accountLimitLine, ghAction, ghButton, ghVerb } from '../lib/gh-wording';
import { SIGNED_OUT_ELSEWHERE_KEY } from '../lib/access-view';
import { bindDemoGate } from './demo-gate';
import {
  type AppSession,
  authorizeUrl,
  callbackUrl,
  canRefresh,
  encodeState,
  exchangeErrorText,
  needsRefresh,
  noReachText,
  type PendingSignIn,
  pkceChallenge,
  planSlots,
  randomString,
  readOnlyText,
  refreshDelay,
  safeReturnTo,
  sessionFrom,
  type SignInConfig,
  SIGNIN_TEXT,
  type AnySlot,
  OLD_APP_SLOT,
  type SlotContent,
  slotKey,
  STORAGE_SLOTS,
  type StorageSlot,
  TOKEN_ENDPOINT,
  type TokenResponse,
} from '../lib/github-signin';
import { isTeamKey, studioHref } from '../lib/team-path';
import { isSampleTeam } from '../lib/demo';
import { linkedMember, RECONNECT_WORDS, type LinkedRole } from '../lib/linked-role';
import { linkedRole, linkedRoleRead, onLinkedRole, readLinkedRole } from './linked-role';
import { clearGuestReads, guestFetch } from './guest-activity';
import { CONTRIB_TOKEN, CONTRIBUTE_WORDS, contributeEligible, isContribAuth, productReposOfConfig, type ContributeMember } from '../lib/contribute';
import { ROLE_WORDS } from '../lib/invites';
import { contributeFetch, contributeInfo, contributorFor, contributorKey, onContributeChange, publicTeamRead, signOutEmail, takeContributeHash, verifyEmailSignIn } from './contribute-session';
import { busyText } from '../lib/team-load';
import { emailMemberFace } from '../lib/people';

export { GitHubError };

export interface RepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
}

// The token, its check and its sign-in session live in one slot (lib/github-signin.ts slotKey):
// 'bridge.github.token.direct' for a sign-in with Bridge Direct, no suffix without a GitHub App.
/** An email contributor's role, in the words Members uses: "Can edit", or "Can view" for a read-only member. */
const contributorRole = () => (contributorFor(pageRepo())?.role === 'view' ? ROLE_WORDS.view.label : ROLE_WORDS.edit.label);
const TOKEN_BASE = 'bridge.github.token';
const CHECK_BASE = 'bridge.github.check';
/** The sign-in session (expiry, refresh token) next to its token. Absent for a pasted token. */
const APP_BASE = 'bridge.github.app';
/** Set when an older app's sign-in was removed: the account block and the dialog ask to sign in again, once. */
const SWITCHED_KEY = 'bridge.github.switched';

/**
 * The app this site signs in with, written at build time on <html data-gh-app> by the layout ('' without a GitHub
 * App). Null on a page without the attribute: nothing is moved or cleared there.
 */
function pageSlot(): StorageSlot | null {
  const v = document.documentElement.getAttribute('data-gh-app');
  return v === null ? null : v === 'direct' ? v : '';
}

let slotsReady = false;
/**
 * Once per page: tokens saved by another app are moved here (a pasted token, or the old one-app sign-in when this is
 * still that app) or removed with a prompt to sign in again (planSlots).
 */
function settleSlots(slot: StorageSlot) {
  if (slotsReady) return;
  slotsReady = true;
  try {
    const read = (s: AnySlot): SlotContent => {
      let session: AppSession | null = null;
      try {
        session = JSON.parse(localStorage.getItem(slotKey(APP_BASE, s)) ?? 'null') as AppSession | null;
      } catch {
        session = null;
      }
      return { token: Boolean(localStorage.getItem(slotKey(TOKEN_BASE, s))), session: session && session.kind === 'app' ? session : null };
    };
    const slots: Partial<Record<AnySlot, SlotContent>> = {};
    for (const s of STORAGE_SLOTS) slots[s] = read(s);
    const plan = planSlots(slots, slot, readSignInConfig()?.clientId ?? null);
    for (const s of plan.clear) for (const base of [TOKEN_BASE, CHECK_BASE, APP_BASE]) localStorage.removeItem(slotKey(base, s));
    if (plan.move !== null) {
      for (const base of [TOKEN_BASE, CHECK_BASE, APP_BASE]) {
        const v = localStorage.getItem(slotKey(base, plan.move));
        if (v !== null) localStorage.setItem(slotKey(base, slot), v);
        localStorage.removeItem(slotKey(base, plan.move));
      }
    }
    if (plan.switched) localStorage.setItem(SWITCHED_KEY, '1');
  } catch {
    /* storage blocked: nothing to move */
  }
}

/** The storage key of `base` for this page's app, after settling the other apps' tokens. */
function key(base: string): string {
  const slot = pageSlot();
  if (slot === null) return base;
  settleSlots(slot);
  return slotKey(base, slot);
}

/** A sign-in of another app was removed on this browser and nobody has signed in since. */
export function signInSwitched(): boolean {
  try {
    return localStorage.getItem(SWITCHED_KEY) === '1' && !getToken();
  } catch {
    return false;
  }
}

/** Why this browser looks signed out after its older sign-in was removed: one plain sentence, until they sign in. */
export const switchedText = (): string => SIGNIN_TEXT.switched;

function clearSwitched() {
  try {
    localStorage.removeItem(SWITCHED_KEY);
  } catch {
    /* storage blocked */
  }
}
/** The sign-in this tab started, until GitHub sends it back (sessionStorage). */
export const PENDING_KEY = 'bridge.github.signin';
const CACHE_PREFIX = 'bridge.gh.cache:';
export const API = 'https://api.github.com';

/** The repository this page works on (scripts/repo-context.ts: the team address, else #bridge-repo). */
export function readRepo(): RepoRef {
  const { owner, repo, defaultBranch } = repoContext();
  return { owner, repo, defaultBranch };
}

/** The GitHub token saved in this browser (Sign in with GitHub or a pasted token), never the email stand-in. */
function githubToken(): string | null {
  try {
    return localStorage.getItem(key(TOKEN_BASE));
  } catch {
    return null;
  }
}

/** "owner/repo" of this page, as written in the address (the proxy and the server keep its case). */
const pageRepo = () => {
  const r = readRepo();
  return `${r.owner}/${r.repo}`;
};

/**
 * The product repositories of this page's team (bridge.config.json products[].repo and each design copy,
 * products[].design.repo): everyone on the team reads them through the team's proxy (an email member, anyone signed in
 * with GitHub: teamReadViaBridge), and so does a visitor of a public demo team. Writes keep their own route.
 */
const pageProductRepos = (): string[] => {
  try {
    return productReposOfConfig((siteConfig() as { products?: { repo?: string; design?: { repo?: string } }[] }).products, pageRepo());
  } catch {
    return [];
  }
};

/**
 * The email contributor signed in on this page's team (lib/contribute.ts), when there is no GitHub sign-in: real teams
 * only, never the sample team, Bridge's demo or the browser workspace. Null otherwise.
 */
export function currentContributor(): ContributeMember | null {
  if (typeof document === 'undefined' || githubToken() || document.documentElement.hasAttribute('data-no-repo')) return null;
  const repo = pageRepo();
  return contributeEligible(repo, repoContext().hosted) ? contributorFor(repo) : null;
}

/** A page where a Bridge account's linked GitHub role is worth reading: a hosted repository team, never a sample. */
function linkedEligible(): boolean {
  if (typeof document === 'undefined' || document.documentElement.hasAttribute('data-no-repo')) return false;
  const repo = pageRepo();
  return repoContext().hosted && !isSampleTeam(repo) && !isTeamKey(repo) && /^[\w.-]+\/[\w.-]+$/.test(repo);
}

/**
 * The role the signed-in Bridge account's linked GitHub account has on this page's team, read by the server with the
 * Bridge app (scripts/linked-role.ts), for a browser that is not an email member here: without a GitHub sign-in, and
 * with one whose own access here is below edit (another GitHub account, or GitHub has not said yet). The page shows the
 * strongest of the two, never the visitor's read-only view. Null otherwise.
 */
export function linkedGitHubRole(): LinkedRole | null {
  if (currentContributor() || !linkedEligible() || currentAccess()?.write) return null;
  return linkedRole(pageRepo());
}

/** Worth asking the server for the linked role: no GitHub sign-in, or one whose access here was read below edit. */
function linkedWorthReading(): boolean {
  if (currentContributor() || !linkedEligible()) return false;
  if (!githubToken()) return true;
  const a = currentAccess();
  return Boolean(a && !a.write);
}

/**
 * Whether this page knows the linked GitHub role it would show: true when there is none worth reading, or once it was
 * read. While false, the page is not sure yet whether the person is on the team: no read-only banner, no "Guest".
 */
export function linkedRoleKnown(): boolean {
  return !linkedWorthReading() || linkedRoleRead(pageRepo());
}

/**
 * The token every GitHub call of the Studio carries: the GitHub one, or, for an email contributor, a stand-in that
 * the session's fetch sends to this site's proxy (scripts/contribute-session.ts). Features never tell them apart.
 */
export function getToken(): string | null {
  return githubToken() ?? (currentContributor() ? CONTRIB_TOKEN : null);
}

/**
 * Signed in with GitHub on this browser (a developer, or anyone who chose GitHub), not an email member or a guest: the
 * one viewer who reads commit SHAs and GitHub's own error words.
 */
export const signedInWithGitHub = (): boolean => Boolean(githubToken());

/**
 * A GitHub sign-in this browser holds under any slot, read only (nothing moved or cleared): for pages outside the app
 * (the landing has no <html data-gh-app>), where key() would only look at the unscoped slot. The older second app's
 * sign-in does not count (it cannot be renewed). The token, or null.
 */
export function anyGitHubToken(): string | null {
  try {
    for (const slot of STORAGE_SLOTS) {
      if (slot === OLD_APP_SLOT) continue;
      const t = localStorage.getItem(slotKey(TOKEN_BASE, slot));
      if (t && !isContribAuth(t)) return t;
    }
  } catch {
    /* storage blocked: nobody signed in here */
  }
  return null;
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(key(TOKEN_BASE), token.trim());
    else localStorage.removeItem(key(TOKEN_BASE));
  } catch {
    /* private mode: token lives for this page only */
  }
  clearGuestReads();
  document.dispatchEvent(new CustomEvent('bridge:auth', { detail: { signedIn: Boolean(token) } }));
}

export function readAppSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(key(APP_BASE));
    const s = raw ? (JSON.parse(raw) as AppSession) : null;
    return s && s.kind === 'app' ? s : null;
  } catch {
    return null;
  }
}

function writeAppSession(s: AppSession | null) {
  try {
    if (s) localStorage.setItem(key(APP_BASE), JSON.stringify(s));
    else localStorage.removeItem(key(APP_BASE));
  } catch {
    /* private mode: the session lives for this page only */
  }
}

/** How this browser holds GitHub access: 'app' after Sign in with GitHub, 'token' for a pasted token (or none). */
export const sessionMode = (): SessionMode => (getToken() && readAppSession() ? 'app' : 'token');

/** Sign in with GitHub settings, written at build time on the Connect dialog. Null: the site has no GitHub App. */
export function readSignInConfig(): SignInConfig | null {
  const raw = document.querySelector<HTMLElement>('#gh-dialog [data-signin]')?.dataset.signin;
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as SignInConfig | null;
    return c && typeof c.clientId === 'string' && c.clientId ? c : null;
  } catch {
    return null;
  }
}

/**
 * Sign in is the only way to connect when the site has a GitHub App: the designer UI then has no token paste (a token
 * pasted before keeps working until it is disconnected). Without a GitHub App the token paste is the way in.
 */
export const prefersSignIn = () => Boolean(readSignInConfig());

export class SignInError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Starts Sign in with GitHub: keeps a state and a PKCE verifier for this tab, then goes to GitHub. `returnTo` is the
 * Studio page to land on afterwards (this one by default, with its search and hash).
 */
export async function startSignIn(returnTo = location.pathname + location.search + location.hash): Promise<void> {
  const cfg = readSignInConfig();
  if (!cfg) throw new SignInError('Sign in with GitHub is not set up on this site. Connect with a token from Settings instead.');
  if (!globalThis.crypto?.subtle) throw new SignInError('This browser cannot sign in safely here (no Web Crypto). Open Studio over https and sign in again.');
  const fill = (a: Uint8Array) => crypto.getRandomValues(a);
  const verifier = randomString(32, fill);
  const state = encodeState(randomString(24, fill), location.origin);
  const redirectUri = callbackUrl(location.origin, cfg);
  const challenge = await pkceChallenge(verifier, (d) => crypto.subtle.digest('SHA-256', d as Uint8Array<ArrayBuffer>));
  const pending: PendingSignIn = { state, verifier, redirectUri, returnTo: safeReturnTo(returnTo), at: Date.now() };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new SignInError('This browser blocks site storage, so the sign-in could not finish. Allow site data for this site, then sign in again.');
  }
  // What the person was doing in the last few minutes comes back with them (scripts/pending-action.ts).
  keepPendingAction();
  location.assign(authorizeUrl({ clientId: cfg.clientId, redirectUri, state, challenge }));
}

/** POSTs to this site's token function. Throws a SignInError with the sentence to show. */
export async function postToken(
  body: ({ grant: 'code'; code: string; code_verifier: string; redirect_uri: string } | { grant: 'refresh'; refresh_token: string }) & { client_id?: string },
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new SignInError(exchangeErrorText(0), 'unreachable');
  }
  let data: (Partial<TokenResponse> & { error?: string }) | null = null;
  try {
    data = (await res.json()) as Partial<TokenResponse> & { error?: string };
  } catch {
    /* not JSON: a host error page */
  }
  if (!res.ok || !data || typeof data.access_token !== 'string') throw new SignInError(exchangeErrorText(res.status, data?.error), data?.error);
  return data as TokenResponse;
}

/** Saves a finished sign-in: the token like a pasted one, plus its expiry, refresh token and the app's client ID. */
export function saveSignIn(r: TokenResponse, opts: { refresh?: boolean; clientId?: string } = {}) {
  const previous = opts.refresh ? currentCheck() : null;
  if (!opts.refresh) clearSwitched();
  // Clients made before a refresh still hold the old token: their calls go out with the new one (liveAuth).
  const old = opts.refresh ? githubToken() : null;
  if (old && old !== r.access_token.trim()) replacedTokens.add(old);
  writeAppSession(sessionFrom(r, Date.now(), opts.clientId));
  // A refresh keeps the account: carry the last good check over to the new token (no extra call to GitHub). A new
  // sign-in may be another account: it is checked again.
  writeCheck(previous?.ok && previous.viewer ? { ...okCheck(r.access_token, previous.viewer, Date.now(), previous.write), ...(typeof previous.reach === 'boolean' ? { reach: previous.reach } : {}), ...(previous.access ? { access: previous.access } : {}) } : null);
  setToken(r.access_token);
}

let refreshing: Promise<boolean> | null = null;
/** Tokens a refresh replaced on this page (memory only): a call that still carries one goes out with the current token. */
const replacedTokens = new Set<string>();

/** Renews the sign-in with its refresh token. True when a fresh token is saved. One refresh at a time. */
export function refreshSignIn(): Promise<boolean> {
  if (refreshing) return refreshing;
  const s = readAppSession();
  if (!s || !s.refreshToken || !canRefresh(s, Date.now())) return Promise.resolve(false);
  // The app that issued the token renews it (sessions saved before the client ID was kept: the site's app).
  const clientId = s.clientId ?? readSignInConfig()?.clientId;
  refreshing = postToken({ grant: 'refresh', refresh_token: s.refreshToken, ...(clientId ? { client_id: clientId } : {}) })
    .then((r) => {
      saveSignIn(r, { refresh: true, ...(clientId ? { clientId } : {}) });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function readCheck(): TokenCheck | null {
  try {
    const raw = localStorage.getItem(key(CHECK_BASE));
    return raw ? (JSON.parse(raw) as TokenCheck) : null;
  } catch {
    return null;
  }
}

let memoryCheck: TokenCheck | null = null;
function writeCheck(check: TokenCheck | null) {
  memoryCheck = check;
  try {
    if (check) localStorage.setItem(key(CHECK_BASE), JSON.stringify(check));
    else localStorage.removeItem(key(CHECK_BASE));
  } catch {
    /* private mode: the check lives for this page only */
  }
}

/** The last check of the current token, from this page or from storage. */
const currentCheck = () => checkFor(memoryCheck ?? readCheck(), getToken()) ?? checkFor(readCheck(), getToken());

/** True when GitHub refused the saved token (revoked, regenerated or expired). The token is kept until replaced. */
export const tokenRejected = () => sessionState(getToken(), currentCheck()) === 'rejected';

/** A token is saved and GitHub has not refused it. Write actions use this, not getToken(). */
export const hasWorkingToken = () => Boolean(getToken()) && !tokenRejected();

let onRejected: (() => void) | null = null;
let onRefreshed: (() => void) | null = null;
/** A 401 may trigger one refresh per page: a refreshed token GitHub refuses again is really refused. */
let refreshedAfter401 = false;

/**
 * Marks the saved token as refused by GitHub: the account block switches to "Your GitHub token stopped working",
 * write actions say so, reads fall back to anonymous. Called by every GitHub call that gets a 401. A sign-in that
 * can still be refreshed is refreshed first (once per page).
 */
export function markTokenRejected() {
  const token = getToken();
  // An email session that ended is handled by the proxy's fetch (contributeFetch): no GitHub token to mark.
  if (!token || isContribAuth(token) || tokenRejected()) return;
  if (renewal) return;
  if (!refreshedAfter401 && canRefresh(readAppSession(), Date.now())) {
    void renewAfter401(`Bearer ${token}`);
    return;
  }
  writeCheck(rejectedCheck(token, Date.now()));
  onRejected?.();
  document.dispatchEvent(new CustomEvent('bridge:auth', { detail: { signedIn: false, rejected: true } }));
}

/** The one renewal a 401 starts: every call that got a 401 meanwhile waits for it. */
let renewal: Promise<boolean> | null = null;

/**
 * A call that carried `sentAuth` got a 401. True when it can go out again with a working token: another call renewed
 * the sign-in meanwhile, or this one renews it now (once per page). False when the sign-in is really refused: it is
 * marked (the account block says "Sign in again"), and only then do reads go out anonymously.
 */
function renewAfter401(sentAuth: string | undefined): Promise<boolean> {
  const token = githubToken();
  if (!token || !sentAuth || isContribAuth(sentAuth)) return Promise.resolve(false);
  if (sentAuth !== `Bearer ${token}`) return Promise.resolve(!tokenRejected());
  if (tokenRejected()) return Promise.resolve(false);
  if (renewal) return renewal;
  if (!refreshedAfter401 && canRefresh(readAppSession(), Date.now())) {
    refreshedAfter401 = true;
    renewal = refreshSignIn()
      .then((ok) => {
        renewal = null;
        if (ok) onRefreshed?.();
        else markTokenRejected();
        return ok;
      })
      .catch(() => {
        renewal = null;
        return false;
      });
    return renewal;
  }
  markTokenRejected();
  return Promise.resolve(false);
}

/**
 * A GitHub sign-in whose token expired, or expires within the refresh margin, is renewed before a call goes out
 * (every caller waits for the one refresh): a signed-in viewer's call never leaves with a dead token, nor without one.
 */
async function freshToken(): Promise<void> {
  if (renewal) await renewal;
  if (needsRefresh(readAppSession(), Date.now())) await refreshSignIn();
}

/** A GitHub sign-in is being renewed or must be before its next call (freshToken). Sync: other calls start at once. */
const mustRenew = (): boolean => Boolean(githubToken()) && !tokenRejected() && (renewal !== null || needsRefresh(readAppSession(), Date.now()));

/**
 * The Authorization a call goes out with: a GitHub token of this page (the current one, or one a refresh replaced, held
 * by a client made earlier) becomes the current token, renewed first when it expires. Anything else is kept as is.
 */
/** The GitHub sign-in's token, renewed first when it is about to expire (calls to this site's server). Null without one. */
export async function liveGitHubToken(): Promise<string | null> {
  if (!githubToken()) return null;
  if (mustRenew()) await freshToken().catch(() => undefined);
  return githubToken();
}

async function liveAuth(auth: string | undefined): Promise<string | undefined> {
  if (!auth || isContribAuth(auth)) return auth;
  const sent = auth.replace(/^Bearer\s+/i, '');
  if (sent !== githubToken() && !replacedTokens.has(sent)) return auth;
  if (mustRenew()) await freshToken();
  const now = githubToken();
  return now && !tokenRejected() ? `Bearer ${now}` : auth;
}

/**
 * Bridge cannot read the team for this GitHub sign-in (no function here, not on the team, or the app not on the
 * team's library): every read goes to GitHub with the viewer's own token, as before.
 */
let teamReadsDown = false;
/** Until when Bridge said it is busy for this viewer's library reads (ms): they go to GitHub with their own token. */
let libraryBusyUntil = 0;

/** The team of this page ("owner/name"), or null on a page without one (the browser workspace, the site's own). */
const pageTeam = (): string | null => (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo') ? null : pageRepo());

/**
 * A read of the team by someone signed in with GitHub (lib/write-route teamReadRoute): its library repository, one of
 * its products (code repository or design copy) or a person's public profile, through the team's proxy with Bridge's
 * app and the team's shared cache, their token only as proof of who they are (the server checks they are on the
 * team). Each viewer's own GitHub limit stays theirs, and a private product reads for every member, leads included.
 * Null: this read goes to GitHub as before (another repository, a path Bridge does not read, Bridge cannot read it
 * here, the app is not on that product). Bridge's own limit throws its "Bridge is busy" GitHubError for a product
 * (the viewer's token may not read it); a library read goes to GitHub with the viewer's token for a while instead.
 */
async function teamReadViaBridge(url: string, init: { method?: string; headers?: Record<string, string> } & Record<string, unknown>): Promise<Response | null> {
  const auth = init.headers?.Authorization;
  if (teamReadsDown || !auth || isContribAuth(auth)) return null;
  const products = pageProductRepos();
  const route = teamReadRoute({ method: init.method, url, team: pageTeam(), products, session: 'github' });
  if (route.via !== 'bridge') return null;
  if (route.scope !== 'product' && Date.now() < libraryBusyUntil) return null;
  // A designer's reads in the products mark their own explorations; in the library their GitHub login is already the
  // author, and a lead's or an admin's have nothing of theirs to mark.
  const reader = route.scope !== 'product' || !designerRoute();
  let res: Response;
  try {
    res = await contributeFetch(pageRepo(), url, init as RequestInit, products, { authorization: auth, login: viewer?.login ?? '', reader });
  } catch (err) {
    if (err instanceof GitHubError && err.status === 429) {
      if (route.scope === 'product') throw err;
      libraryBusyUntil = Date.now() + (err.resetsAt ? Math.max(0, err.resetsAt.getTime() - Date.now()) : 60_000);
      return null;
    }
    // Not on the team, or a sign-in Bridge cannot check: the rest of the page reads on GitHub. The app missing on
    // one product (product_missing) leaves only that read to GitHub; missing on the library (app_missing), all of them.
    if (err instanceof GitHubError && (err.status === 401 || (route.scope === 'library' && err.status === 409))) teamReadsDown = true;
    return null;
  }
  // No function here (the static host's page, an older deploy): GitHub directly for the rest of the page.
  if (res.status === 405 || (!res.ok && res.status !== 304 && !/json|vnd\.github|text\/plain/i.test(res.headers.get('content-type') ?? ''))) {
    teamReadsDown = true;
    return null;
  }
  return res;
}

/**
 * The Authorization a batched read of `repo` through Bridge carries for a GitHub sign-in (the change statuses of
 * scripts/pr-status.ts, contribute-session prefetchChangeStatuses): proof of who reads, while Bridge reads the team for
 * them (teamReadViaBridge). Null when their reads of `repo` go to GitHub (another repository, Bridge cannot read it).
 */
export async function bridgeReadAuth(repo: string): Promise<string | null> {
  if (teamReadsDown || Date.now() < libraryBusyUntil || !githubToken() || tokenRejected()) return null;
  const team = pageTeam();
  if (!team || team.toLowerCase() !== repo.toLowerCase()) return null;
  const auth = await liveAuth(`Bearer ${githubToken()}`);
  return auth && !isContribAuth(auth) ? auth : null;
}

/**
 * fetch for the core GitHubClient in the Studio: once the token is refused, reads go out anonymously (public repos
 * keep working) and writes fail at once with the same 401; any 401 to a call that carried the token marks it.
 */
export const studioFetch: FetchLike = async (url, init0 = {}) => {
  const method = (init0.method ?? 'GET').toUpperCase();
  if (method !== 'GET') noteWrite();
  // Shortly after a write, a read asks GitHub again rather than the browser's copy (lib/token-session readCacheMode).
  const init: typeof init0 & { cache?: RequestCache } = method === 'GET' ? { ...init0, cache: freshRead() } : init0;
  let headers = init.headers ?? {};
  // An email contributor: every call to the team's repository goes through this site's proxy, the rest as a guest.
  if (isContribAuth(headers.Authorization)) return contributeFetch(pageRepo(), url, init as RequestInit, pageProductRepos());
  // A signed-in call waits for a sign-in being renewed, and never leaves with a token a refresh replaced.
  if (headers.Authorization && !isContribAuth(headers.Authorization)) {
    const auth = await liveAuth(headers.Authorization);
    if (auth !== headers.Authorization) headers = { ...headers, Authorization: auth as string };
  }
  // A write with a token GitHub already refused cannot succeed: answer for it, so the action shows the one message.
  if (method !== 'GET' && tokenRejected() && headers.Authorization) {
    return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'GET' && tokenRejected() && headers.Authorization) {
    const { Authorization: _drop, ...rest } = headers;
    headers = rest;
  }
  // A signed-in read of the team (its library, its products, people): through Bridge's app (lib/write-route teamReadRoute).
  if (method === 'GET' && headers.Authorization) {
    const viaBridge = await teamReadViaBridge(url, { ...init, headers });
    if (viaBridge) return viaBridge;
  }
  // A guest's read: the team's activity, this tab's recent answer, Bridge for a public demo team, or GitHub
  // (scripts/guest-activity.ts). GitHub's hourly limit is said in Bridge's words, never "add a GitHub token".
  if (method === 'GET' && !headers.Authorization && url.startsWith(API)) {
    const h = headers;
    return busyIfLimited(await guestFetch(url, h.Accept ?? '', async () => (await publicTeamRead(pageRepo(), url, h.Accept ?? '', pageProductRepos())) ?? fetch(url, { ...init, headers: h })));
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && headers.Authorization) {
    // Renewed (now or by another call): the same call again with the fresh token (a refused write changed nothing).
    if (await renewAfter401(headers.Authorization)) return fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${githubToken()}` } });
    if (method === 'GET') {
      const { Authorization: _drop, ...rest } = headers;
      return fetch(url, { ...init, headers: rest });
    }
  }
  return res;
};

/**
 * An anonymous answer GitHub refused for its hourly limit becomes Bridge's sentence ("Bridge is busy, try again in N
 * min."), thrown as the GitHubError the core client keeps: a designer never reads "add a GitHub token".
 */
function busyIfLimited(res: Response): Response {
  if ((res.status !== 403 && res.status !== 429) || res.headers.get('x-ratelimit-remaining') !== '0') return res;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const resetsAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : undefined;
  throw new GitHubError(429, busyText(resetsAt ? (resetsAt.getTime() - Date.now()) / 1000 : null), 'rate-limit', { resetsAt });
}

/** The core GitHub client the Studio uses: the saved token, the session-aware fetch. */
export function studioClient(repo: string, token: string | null = getToken(), options?: ClientOptions): GitHubClient {
  // An email member's client goes through this site's proxy for its own repository, which is not always the page's
  // (a team Library page is not a Studio team shell: its page repository is the site's own). A client for one of the
  // team's product repositories goes through the team's proxy (its session is the team's), and so does a client it
  // derives for another of them (Done exploring files the task in the developers' repository from the copy's client).
  const products = pageProductRepos();
  const product = products.includes(repo.toLowerCase());
  const via = product ? pageRepo() : repo;
  // A designer signed in with GitHub: a client for one of the team's products goes through the team's proxy too, with
  // their GitHub token as proof of who they are (lib/write-route productRouteFor); the library stays on GitHub.
  const designer = product && token && !isContribAuth(token) && designerRoute() ? viewer?.login : null;
  const f: FetchLike = isContribAuth(token)
    ? (url, init = {}) => (isContribAuth(init.headers?.Authorization) ? contributeFetch(via, url, init as RequestInit, product ? products : []) : studioFetch(url, init))
    : designer
      ? async (url, init = {}) => {
          const auth = init.headers?.Authorization;
          if (!auth || isContribAuth(auth)) return studioFetch(url, init);
          return contributeFetch(via, url, init as RequestInit, products, { authorization: (await liveAuth(auth)) ?? auth, login: designer });
        }
      : studioFetch;
  return new GitHubClient(repo, token ?? '', f, undefined, options);
}

/** This viewer writes in the team's products through Bridge (a designer, lib/write-route productRouteFor). */
export function designerRoute(): boolean {
  const token = getToken();
  const session = token && isContribAuth(token) ? 'email' : viewer && token && !tokenRejected() ? 'github' : null;
  return productRouteFor({ session, access: currentAccess(), login: viewer?.login ?? null, site: siteConfig() }) === 'bridge';
}

/** The auth sentence for an error (rejected token or missing permission), or null for any other failure. */
export function ghAuthFailure(err: unknown, action?: string): AuthFailure | null {
  return authFailure(err, action, sessionMode(), prefersSignIn());
}

/**
 * Writes an error into `el`: for a refused token the one "stopped working" message with a Reconnect button, for a
 * missing permission the permission to add with a link to the token settings, else `fallback`.
 */
export function showGhError(el: HTMLElement, err: unknown, fallback: string, action?: string) {
  const mode = sessionMode();
  const a = authFailure(err, action, mode, prefersSignIn());
  if (!a) {
    el.textContent = fallback;
    return;
  }
  el.innerHTML =
    a.kind === 'rejected'
      ? `${esc(a.text)} <button type="button" class="gh-inline-link" data-gh-open data-gh-signin>${mode === 'app' || prefersSignIn() ? 'Sign in again' : 'Reconnect'}</button>`
      : a.href
        ? `${esc(a.text)} <a href="${attrUrl(a.href)}" target="_blank" rel="noopener">Edit the token on GitHub</a>`
        : esc(a.text);
}

/** "See the branch" and "Open on GitHub" links for a pull request GitHub just created (number and url from the API). */
export function prLinksHtml(pr: { number: number; url: string }): string {
  return `<a href="${studioHref(`changes/?pr=${Number(pr.number)}`)}">See the change</a> · <a href="${attrUrl(pr.url)}" target="_blank" rel="noopener">Open on GitHub</a>`;
}

export class RateLimitError extends Error {
  /**
   * `signedIn`: the refused read carried the viewer's token (GitHub's limit for their account, 5,000 an hour shared by
   * every tool on it), not an anonymous one. Unset: whatever the session is now (hasWorkingToken).
   */
  constructor(
    public resetAt: Date | null,
    public signedIn?: boolean,
  ) {
    super('GitHub rate limit reached');
  }
}

/**
 * The sentence for a read GitHub refused for its hourly limit, when the viewer is signed in: their account's limit
 * and when it resets (never "anonymous" nor "Sign in"), or the "Sign in again" sentence when the sign-in itself
 * stopped working. Null for a signed-out visitor: the caller keeps its anonymous wording. `what`: what is missing.
 */
export function limitLine(err: unknown, what?: string): string | null {
  if (!(err instanceof RateLimitError)) return null;
  if (getToken() && tokenRejected()) return rejectedText(sessionMode(), prefersSignIn());
  return (err.signedIn ?? hasWorkingToken()) ? accountLimitLine(err.resetAt, Date.now(), what) : null;
}

export interface Fetched<T> {
  data: T;
  /** True when the data comes from this browser's cache because GitHub refused the request. */
  stale: boolean;
  cachedAt?: string;
  resetAt?: Date | null;
}

function cacheGet<T>(url: string): { data: T; at: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    return raw ? (JSON.parse(raw) as { data: T; at: string }) : null;
  } catch {
    return null;
  }
}

function cacheSet(url: string, data: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, at: new Date().toISOString() }));
  } catch {
    /* quota: drop the oldest cache entries and move on */
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .slice(0, 20)
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
}

/**
 * When this tab last wrote to GitHub: reads ask GitHub again for a while after (lib/token-session readCacheMode). Kept
 * in this tab's sessionStorage too, so the page a write leads to (a product just added opens its own page) reads GitHub
 * again instead of the browser's copy from before.
 */
const WROTE_KEY = 'bridge.wroteAt';
let wroteAt: number | null = (() => {
  try {
    const v = Number(typeof sessionStorage === 'undefined' ? NaN : sessionStorage.getItem(WROTE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
})();
/**
 * Notes a write to GitHub. Exported for writes this site's server makes for the tab (the library check records its
 * result on the pull request, a product added straight to the settings): the next reads ask GitHub again, not the
 * browser's copy from before.
 */
export const noteWrite = () => {
  wroteAt = Date.now();
  try {
    sessionStorage.setItem(WROTE_KEY, String(wroteAt));
  } catch {
    /* storage blocked: this page only */
  }
};
const freshRead = (): RequestCache => readCacheMode(wroteAt, Date.now());

/**
 * fetch for a call with the session's headers: the proxy for an email contributor, Bridge's app for a GitHub sign-in's
 * read of the team (teamReadViaBridge), GitHub otherwise.
 */
const ghFetch = async (url: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> => {
  if (isContribAuth(init.headers.Authorization)) return contributeFetch(pageRepo(), url, init, pageProductRepos());
  if ((init.method ?? 'GET').toUpperCase() === 'GET') {
    const viaBridge = await teamReadViaBridge(url, init as Parameters<typeof teamReadViaBridge>[1]);
    if (viaBridge) return viaBridge;
  }
  return fetch(url, init);
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  const token = getToken();
  if (token && !tokenRejected()) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Headers that always carry the saved token (the token check itself, and writes). */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Identical GETs started on the same page load share one request (the header count and the page list read the
// same open pull requests): anonymous visitors only have 60 reads an hour.
const inflight = new Map<string, Promise<Fetched<unknown>>>();

/**
 * GET with cache fallback. `path` is relative to api.github.com, or an absolute URL. `fresh`: ask GitHub again instead
 * of the browser's copy (a conditional read: an unchanged answer does not count against the hourly limit).
 */
export function ghGet<T>(path: string, opts: { accept?: string; raw?: boolean; fresh?: boolean } = {}): Promise<Fetched<T>> {
  // An email member stands in for a login with their email (contribute-session asMine): GitHub has no such user, so
  // answer the 404 here instead of a failed request in the console.
  const user = /^\/users\/([^/?]+)/.exec(path);
  if (user && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:%5Bbot%5D|\[bot\])?$/.test(user[1]!)) return Promise.reject(new GitHubError(404, `GitHub answered 404 for ${path}`));
  const url = path.startsWith('http') ? path : `${API}${path}`;
  // A read after a write never joins one started before it (the write is part of the key).
  const key = `${url}|${opts.accept ?? ''}|${opts.raw ? 'raw' : ''}|${hasWorkingToken() ? 'auth' : 'anon'}|${wroteAt ?? 0}|${opts.fresh ? 'fresh' : ''}`;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<Fetched<T>>;
  const p = ghGetOnce<T>(url, path, `${url}|${opts.accept ?? ''}`, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** owner, repo, ref and path (still URL-encoded) of a raw.githubusercontent.com file address, else null. */
const RAW_FILE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;

/**
 * Where a raw file is read from: raw.githubusercontent.com is free of the API limit but serves public repositories
 * only (a private file answers 404 there, token or not). Signed in (GitHub or an email member, whose calls go through
 * this site's proxy), a private repository's file is read through the contents API with the raw media type instead;
 * whether the repository is private comes from GET /repos (shared with the rest of the page, and kept). Anything else,
 * or when that read fails, stays on the raw host.
 */
export async function rawFileUrl(url: string): Promise<{ url: string; accept?: string }> {
  const m = RAW_FILE.exec(url);
  if (!m || !hasWorkingToken()) return { url };
  const [, owner, repo, ref, path] = m as unknown as [string, string, string, string, string];
  let priv = false;
  try {
    priv = (await ghGet<{ private?: boolean }>(`/repos/${owner}/${repo}`)).data.private === true;
  } catch {
    priv = false;
  }
  if (!priv) return { url };
  return { url: `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(decodeURIComponent(ref))}`, accept: 'application/vnd.github.raw' };
}

async function ghGetOnce<T>(url0: string, path: string, key: string, opts0: { accept?: string; raw?: boolean; fresh?: boolean }): Promise<Fetched<T>> {
  // Only a raw file address waits for the visibility check: every other read starts at once.
  const routed = RAW_FILE.test(url0) ? await rawFileUrl(url0) : { url: url0 };
  const url = routed.url;
  const opts = routed.accept ? { ...opts0, accept: routed.accept } : opts0;
  try {
    // raw.githubusercontent.com: no custom headers, so no CORS preflight (and no API rate limit).
    const isApi = url.startsWith(API);
    // Signed in: a sign-in being renewed (or expired) is renewed first, so the read never goes out without the token.
    if (isApi && mustRenew()) await freshToken();
    const h = headers(opts.accept ? { Accept: opts.accept } : {});
    // A guest's read: the team's activity, this tab's recent answer, or GitHub (scripts/guest-activity.ts).
    const cache = opts.fresh ? 'no-cache' : freshRead();
    let res = isApi && !h.Authorization ? await guestFetch(url, h.Accept ?? '', async () => (await publicTeamRead(pageRepo(), url, h.Accept ?? '', pageProductRepos())) ?? fetch(url, { headers: h, cache })) : isApi ? await ghFetch(url, { headers: h, cache }) : await fetch(url, { cache });
    // GitHub refused the token: renew the sign-in and read again with it. Only a sign-in that is really refused
    // (marked, the account block says "Sign in again") reads anonymously (public repos keep working).
    let sentAuth = h.Authorization;
    if (res.status === 401 && isApi && sentAuth && !isContribAuth(sentAuth)) {
      const renewed = await renewAfter401(sentAuth);
      const h2 = headers(opts.accept ? { Accept: opts.accept } : {});
      sentAuth = h2.Authorization;
      res = renewed ? await ghFetch(url, { headers: h2, cache }) : await fetch(url, { headers: h2 });
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      // GitHub's limit said only in words (a 403 "API rate limit exceeded" without the header): a wait as well.
      const worded = res.status === 403 && remaining !== '0' && /rate limit/i.test(await Promise.resolve().then(() => res.clone().text()).catch(() => ''));
      if (remaining === '0' || res.status === 429 || worded) throw new RateLimitError(reset ? new Date(Number(reset) * 1000) : null, Boolean(sentAuth));
    }
    if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status} for ${path}`);
    const data = (opts.raw ? await res.text() : await res.json()) as T;
    cacheSet(key, data);
    return { data, stale: false };
  } catch (caught) {
    // Bridge's own limit (a read through Bridge): the same as GitHub's for the callers.
    const err = caught instanceof GitHubError && caught.status === 429 ? new RateLimitError(caught.resetsAt ?? null, hasWorkingToken()) : caught;
    const cached = cacheGet<T>(key);
    if (cached && (err instanceof RateLimitError || err instanceof TypeError)) {
      return { data: cached.data, stale: true, cachedAt: cached.at, resetAt: err instanceof RateLimitError ? err.resetAt : null };
    }
    throw err;
  }
}

/**
 * Authenticated write. Throws when no token is set, and with the one "stopped working" message once GitHub refused
 * the token (the error carries `auth`, so callers can show it with showGhError).
 */
export async function ghWrite<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!getToken()) throw new GitHubError(401, `${ghVerb(prefersSignIn())} first.`, 'no-token');
  if (tokenRejected()) throw new GitHubError(401, rejectedText(sessionMode(), prefersSignIn()), 'Bad credentials', { auth: 'rejected' });
  noteWrite();
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const contributor = isContribAuth(headers.Authorization);
  if (!contributor) headers.Authorization = (await liveAuth(headers.Authorization)) as string;
  const send = () => ghFetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let res = await send();
  // A sign-in renewed after the 401 (GitHub changed nothing): the write goes out once more with the fresh token.
  if (res.status === 401 && !contributor && (await renewAfter401(headers.Authorization))) {
    headers.Authorization = `Bearer ${githubToken()}`;
    res = await send();
  }
  if (!res.ok) {
    let message = `GitHub answered ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      /* no body */
    }
    const info = classifyAuth(res.status, message, { path, acceptedPermissions: res.headers.get('x-accepted-github-permissions') });
    if (info.auth === 'rejected') markTokenRejected();
    throw new GitHubError(res.status, info.auth ? friendlyMessage(res.status, message, info) : message, message, info);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** "2 h ago", "yesterday", "3 days ago": the same words and day count as every screen (core shortAgo). */
export const relativeTime = (iso: string): string => agoInSentence(iso);

/** HTML escape for text and quoted attributes (& < > " '). Same helper as lib/html.ts. */
export const esc = (s: string) => escapeHtml(s);

export interface Viewer {
  login: string;
  avatar_url: string;
  /** Profile name, when the user set one. */
  name?: string | null;
  /** An email contributor (lib/contribute.ts): `login` is their email, there is no GitHub account. */
  email?: string;
}

/** The viewer of an email contributor: their email stands for the login, no photo. */
const contributorViewer = (m: ContributeMember): Viewer => ({ login: m.email, avatar_url: '', name: m.name, email: m.email });

let viewer: Viewer | null = null;
export const currentViewer = () => viewer;

let wired = false;
let checked = false;
/**
 * The first check of this page's GitHub sign-in has answered (or there is none to check). Until then a read of who may
 * do what waits for it (resolveAccess): a page opened right after sign-in never reads the team as a signed-out
 * visitor, which painted "Guest", the read-only banner and a members list of one until a reload.
 */
let settle: (() => void) | null = null;
const settled = new Promise<void>((resolve) => (settle = resolve));
/** True once the session started checking a saved sign-in on this page (initGitHubConnect wired the dialog). */
let checking = false;
const markSettled = () => {
  settle?.();
  settle = null;
};
/** Waits for the first check of the saved GitHub sign-in, when one is under way on this page. */
export function sessionSettled(): Promise<void> {
  return checking && !checked && githubToken() ? settled : Promise.resolve();
}
/** The link from a sign-in email on this page: being checked, or expired (the email form says so). */
let contributeLink: 'checking' | 'expired' | null = null;
export const contributeLinkState = () => contributeLink;
const listeners: ((v: Viewer | null) => void)[] = [];
const notify = (v: Viewer | null) => listeners.forEach((fn) => fn(v));

/**
 * Wires every [data-gh-connect] block and the shared dialog (once per page: the Studio layout and the page script
 * may both call it). Calls `onChange` after the first token check, and after every connect or disconnect.
 * The token is checked against GitHub at most once an hour (GET /user, cached with the result); a 401 from any
 * call in between marks it as stopped working.
 */
export function initGitHubConnect(onChange?: (v: Viewer | null) => void) {
  // On the demo, a visitor who cannot write sees the demo banner, and write actions open the demo dialog
  // (scripts/demo-gate.ts). First, so its capture listener runs before the gated-action one below.
  bindDemoGate({
    repo: () => repoName(readRepo()),
    // An email contributor (no GitHub) is a member: never a demo visitor. Nor is a Bridge account whose linked GitHub is
    // on the team (its writes ask to reconnect GitHub: the session's gated actions). Can view writes nothing.
    login: () => viewer?.login ?? currentContributor()?.email ?? (linkedMember(linkedGitHubRole()) ? 'linked' : null),
    write: () => (currentContributor() ? currentContributor()!.role !== 'view' : linkedMember(linkedGitHubRole()) ? true : (currentAccess()?.write ?? null)),
    signIn: prefersSignIn,
    // Not known while the saved sign-in or the account's linked GitHub role is still being read: an admin who just
    // signed in never sees the read-only banner meanwhile.
    known: () => (checked || !githubToken()) && linkedRoleKnown(),
    subscribe: (fn) => {
      listeners.push(() => fn());
      onAccess(() => fn());
      onLinkedRole(() => fn());
    },
  });
  // No GitHub sign-in here, or one GitHub reads below edit: the account's linked GitHub role, once per page (the
  // server reads it with the app). The page shows the strongest of the two.
  const readLinked = () => {
    if (linkedWorthReading()) void readLinkedRole(pageRepo());
  };
  listeners.push(readLinked);
  onAccess(readLinked);
  readLinked();
  if (onChange) listeners.push(onChange);
  if (wired) {
    if (checked) onChange?.(viewer);
    return;
  }
  const dialog = document.getElementById('gh-dialog');
  const input = dialog?.querySelector<HTMLInputElement>('[data-gh-token]') ?? null;
  const errorBox = dialog?.querySelector<HTMLElement>('[data-gh-error]') ?? null;
  const errorText = errorBox?.querySelector<HTMLElement>('[data-gh-error-text]') ?? errorBox;
  // The error is a DS Alert: its text goes in its own span so the tone icon stays.
  const showError = (message: string | null) => {
    if (!errorBox || !errorText) return;
    if (message !== null) errorText.textContent = message;
    errorBox.hidden = message === null;
  };
  const signInBox = dialog?.querySelector<HTMLElement>('[data-gh-signin-error]') ?? null;
  const signInText = signInBox?.querySelector<HTMLElement>('[data-gh-signin-error-text]') ?? signInBox;
  const showSignInError = (message: string | null) => {
    if (!signInBox || !signInText) return;
    if (message !== null) signInText.textContent = message;
    signInBox.hidden = message === null;
  };
  const forget = dialog?.querySelector<HTMLElement>('[data-gh-forget-dialog]') ?? null;
  const save = dialog?.querySelector<HTMLButtonElement>('[data-gh-save]') ?? null;
  const title = dialog?.querySelector<HTMLElement>('#gh-dialog-title') ?? null;
  const rejectedNote = dialog?.querySelector<HTMLElement>('[data-gh-rejected-note]') ?? null;
  const rejectedNoteText = rejectedNote?.querySelector<HTMLElement>('[data-gh-rejected-note-text]') ?? null;
  // With a GitHub App the dialog is Sign in with GitHub only; without one it is the token paste only.
  const signInView = dialog?.querySelector<HTMLElement>('[data-gh-view="signin"]') ?? null;
  const tokenView = dialog?.querySelector<HTMLElement>('[data-gh-view="token"]') ?? null;
  if (!dialog || (!signInView && (!input || !save))) return;
  wired = true;
  checking = true;
  const saveLabel = () => (tokenRejected() || viewer ? 'Check and replace' : 'Check and connect');

  const showView = () => {
    showError(null);
    showSignInError(null);
    if (signInView) signInView.querySelector<HTMLElement>('[data-gh-signin]')?.focus();
    else input?.focus();
  };

  const paint = () => {
    const rejected = tokenRejected();
    const app = sessionMode() === 'app';
    const signIn = prefersSignIn();
    // The site moved to another GitHub App and removed the old sign-in: ask for a new one, like an expired sign-in.
    const switched = !viewer && !rejected && signIn && signInSwitched();
    // Same block as a refused token: the alert line and a Sign in again button.
    // A sign-in link from an email being spent is a session on its way, not a signed-out visitor: no Sign in meanwhile.
    const state = viewer ? 'connected' : rejected || switched ? 'rejected' : (!checked && getToken()) || contributeLink === 'checking' ? 'checking' : 'readonly';
    document.querySelectorAll<HTMLElement>('[data-gh-connect]').forEach((block) => {
      block.dataset.state = state;
      block.dataset.mode = app ? 'app' : 'token';
      const text = block.querySelector('[data-gh-status-text]');
      if (text) text.textContent = viewer?.email ? CONTRIBUTE_WORDS.signedInWithEmail : viewer ? `Connected as @${viewer.login}` : rejected ? (app ? 'Sign-in expired' : 'Token stopped working') : switched ? 'Signed out' : 'Read only';
      const label = block.querySelector('[data-gh-open-label]');
      if (label) label.textContent = viewer ? (app ? 'Account' : 'Token') : rejected || switched ? (app || signIn ? 'Sign in again' : 'Reconnect') : ghButton(signIn);
      block.querySelectorAll<HTMLElement>('[data-gh-rejected-text]').forEach((el) => (el.textContent = switched ? 'Bridge changed how it connects to GitHub' : app ? 'Your GitHub sign-in expired' : 'Your GitHub token stopped working'));
      block.querySelectorAll<HTMLElement>('[data-gh-reconnect-label]').forEach((el) => (el.textContent = app || switched ? 'Sign in again' : signIn ? 'Sign in with GitHub' : 'Reconnect'));
      // Change token only for a pasted token on a site without Sign in with GitHub.
      block.querySelectorAll<HTMLElement>('[data-gh-token-only]').forEach((el) => (el.hidden = app || signIn || Boolean(viewer?.email)));
      block.querySelectorAll<HTMLElement>('[data-gh-forget-label]').forEach((el) => (el.textContent = app || viewer?.email ? 'Sign out' : 'Disconnect'));
    });
    // Header account menu: login, avatar. An email contributor: their name and email, a drawn face, no GitHub words.
    const email = viewer?.email ? viewer : null;
    // Pages hide what an email contributor cannot do (the New brand link: it changes bridge.config.json).
    document.documentElement.toggleAttribute('data-email-contributor', Boolean(email));
    document.querySelectorAll<HTMLElement>('[data-gh-acct]').forEach((acct) => {
      const login = viewer ? `@${viewer.login}` : '';
      acct.toggleAttribute('data-contributor', Boolean(email));
      acct.querySelectorAll('[data-gh-login], [data-gh-login-full]').forEach((el) => {
        const short = el.hasAttribute('data-gh-login');
        // The row says who it is by name, as everywhere in Studio (the GitHub profile name, else the login); the menu
        // keeps the @login on its own line.
        el.textContent = email ? (short ? (email.name ?? email.login) : email.login) : viewer ? (short ? viewer.name?.trim() || viewer.login : login) : '';
      });
      // The side nav's account row: the second line is the team's name, or an email contributor's role in words. Their
      // menu says who they are (name, then the full email on its own line), never GitHub or the repository.
      // (The team's name is [data-team-display], kept by scripts/team-links.ts; a contributor sees their role instead.)
      acct.querySelectorAll<HTMLElement>('[data-gh-acct-team]').forEach((el) => (el.hidden = Boolean(email)));
      acct.querySelectorAll<HTMLElement>('[data-gh-acct-role]').forEach((el) => {
        el.textContent = email ? contributorRole() : '';
        el.hidden = !email;
      });
      acct.querySelectorAll<HTMLElement>('[data-gh-menu-email]').forEach((el) => {
        el.textContent = email ? email.login : '';
        el.hidden = !email;
      });
      acct.querySelectorAll<HTMLElement>('[data-gh-menu-title]').forEach((el) => (el.textContent = email ? (email.name ?? email.login) : 'GitHub'));
      const avatar = acct.querySelector<HTMLElement>('[data-gh-avatar]');
      if (avatar) {
        avatar.hidden = !viewer;
        if (email) paintDrawnAvatar(avatar, emailMemberFace(email.name, email.login));
        else if (viewer) paintAvatar(avatar, viewer.login, viewer.avatar_url, 64);
      }
      // Named by its visible text (WCAG 2.5.3, as the account menu): the name, the team and the role, then a hidden
      // ", account menu"; never an aria-label that drifts from what it shows.
      acct.querySelector('summary')?.removeAttribute('aria-label');
    });
    paintGates();
    if (forget) {
      forget.hidden = !viewer && !rejected;
      setButtonLabel(forget, app ? 'Sign out' : 'Disconnect');
    }
  };

  /** GET /user with the saved token, whatever the session state. 401 = the token was refused (after one refresh). */
  const check = async (): Promise<Viewer | null> => {
    if (!githubToken()) return null;
    let res = await fetch(`${API}/user`, { headers: authHeaders() });
    if (res.status === 401 && (await refreshSignIn())) res = await fetch(`${API}/user`, { headers: authHeaders() });
    const token = githubToken();
    if (!token) return null;
    if (res.status === 401) {
      writeCheck(rejectedCheck(token, Date.now()));
      return null;
    }
    if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status}.`);
    const v = (await res.json()) as Viewer;
    writeCheck(okCheck(token, v, Date.now()));
    return v;
  };

  const openDialog = () => {
    const rejected = tokenRejected();
    const app = sessionMode() === 'app';
    const switched = !viewer && !rejected && Boolean(signInView) && signInSwitched();
    // On the team through the linked GitHub account, no GitHub sign-in here: a change asks to reconnect, in place.
    const linked = !viewer && !rejected && !switched && linkedMember(linkedGitHubRole());
    if (input) input.value = '';
    // Opened from Change token while connected: say so, the saved token stays until the new one is checked.
    if (title) title.textContent = linked ? RECONNECT_WORDS.title : rejected || switched ? (app || signInView ? 'Sign in again' : 'Reconnect GitHub') : viewer && !app && !signInView ? 'Change GitHub token' : ghButton(Boolean(signInView));
    if (rejectedNote) rejectedNote.hidden = !rejected && !switched && !linked;
    if (rejectedNoteText) {
      rejectedNoteText.textContent = linked
        ? RECONNECT_WORDS.dialog
        : switched
        ? switchedText()
        : app
        ? 'Your GitHub sign-in expired and could not be renewed. Sign in again to keep editing.'
        : signInView
          ? 'GitHub no longer accepts the saved token. Sign in with GitHub to keep editing.'
        : 'GitHub no longer accepts the saved token: it was revoked, regenerated or has expired. Paste a new one to replace it.';
    }
    if (save) setButtonLabel(save, saveLabel());
    openDsDialog(dialog);
    showView();
  };

  const signIn = async (from: HTMLElement | null) => {
    const btn = from instanceof HTMLButtonElement ? from : null;
    const label = btn?.textContent?.trim() || 'Sign in with GitHub';
    if (btn) setButtonBusy(btn, true, 'Opening GitHub');
    try {
      await startSignIn();
    } catch (err) {
      if (btn) setButtonBusy(btn, false, label);
      // Shown in the dialog, under its Sign in with GitHub button.
      if (!isDialogOpen(dialog)) openDialog();
      showSignInError((err as Error).message);
    }
  };

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const start = target.closest<HTMLElement>('[data-gh-signin]');
    const opener = target.closest<HTMLElement>('[data-gh-open]');
    if (!start && !opener) return;
    target.closest('details')?.removeAttribute('open');
    // [data-gh-signin]: straight to GitHub when the site signs in with GitHub; else the dialog (sign in or token paste).
    if (start && (start.closest('#gh-dialog') || prefersSignIn())) void signIn(start);
    else openDialog();
  });
  save?.addEventListener('click', async () => {
    if (!input || !save) return;
    const value = input.value.trim();
    if (!value) {
      showError('Paste a token first.');
      return;
    }
    const label = saveLabel();
    setButtonBusy(save, true, 'Checking');
    const previous = getToken();
    const previousCheck = readCheck();
    const previousApp = readAppSession();
    // A pasted token replaces a sign-in: it never refreshes.
    writeAppSession(null);
    setToken(value);
    try {
      const v = await check();
      if (!v) throw new Error('GitHub did not accept this token. Check that you copied all of it, then try again.');
      viewer = v;
      forgetAccess();
      closeDialog(dialog);
      paint();
      notify(viewer);
    } catch (err) {
      setToken(previous);
      writeCheck(previousCheck);
      writeAppSession(previousApp);
      showError((err as Error).message);
    } finally {
      setButtonBusy(save, false, label);
    }
  });
  const disconnect = () => {
    // An email contributor signs out of this team's email session: there is no GitHub sign-in to remove.
    if (viewer?.email && !githubToken()) {
      void signOutEmail(pageRepo());
      viewer = null;
      forgetAccess();
      void clearPrivateRepoCaches();
      paint();
      paintAccess();
      notify(null);
      return;
    }
    clearSwitched();
    // Nothing comes back for the next person on this browser (scripts/pending-action.ts).
    clearPendingAction();
    setToken(null);
    writeCheck(null);
    writeAppSession(null);
    viewer = null;
    forgetAccess();
    // Bodies and models of private repositories read with this account must not outlive its session.
    void clearPrivateRepoCaches();
    closeDialog(dialog);
    paint();
    paintAccess();
    notify(null);
  };
  forget?.addEventListener('click', disconnect);
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-gh-forget]')) return;
    (e.target as HTMLElement).closest('details')?.removeAttribute('open');
    disconnect();
  });
  // Gated actions (data-gh-gate): without a working connection a click opens the Connect dialog instead of acting.
  document.addEventListener(
    'click',
    (e) => {
      const gated = (e.target as HTMLElement).closest<HTMLElement>('[data-gh-gate][aria-disabled="true"]');
      if (!gated) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openDialog();
    },
    true,
  );

  // Any call that gets a 401 later on lands here: same state as a failed check.
  onRejected = () => {
    viewer = null;
    forgetAccess();
    checked = true;
    markSettled();
    paint();
    paintAccess();
    notify(null);
  };
  // A sign-in renewed after a 401: same account, fresh token.
  onRefreshed = () => {
    paint();
    notify(viewer);
  };

  // Renew a sign-in shortly before it expires while the page stays open.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const wait = refreshDelay(readAppSession(), Date.now());
    if (wait === null || !getToken()) return;
    timer = setTimeout(() => void refreshSignIn().then((ok) => (ok ? (paint(), schedule()) : undefined)), Math.min(wait, 2 ** 31 - 1));
  };
  document.addEventListener('bridge:auth', schedule);

  listeners.push(() => void readAccess().then(paintAccess));
  const done = () => {
    checked = true;
    markSettled();
    paint();
    notify(viewer);
    schedule();
  };
  const boot = () => {
    const token = getToken();
    const last = currentCheck();
    if (token && !needsCheck(last, token, Date.now())) {
      // Checked less than an hour ago: no call to GitHub.
      viewer = last?.ok && last.viewer ? last.viewer : null;
      const seen = last?.ok ? accessFromCheck(last, repoName(readRepo()), repoContext().hosted) : null;
      if (seen) accessByRepo.set(repoName(readRepo()), seen);
      done();
    } else {
      paint();
      check()
        .then((v) => {
          viewer = v;
        })
        .catch(() => {
          // GitHub unreachable or limited: keep the last known account rather than looking signed out.
          viewer = last?.ok && last.viewer ? last.viewer : null;
        })
        .finally(done);
    }
  };
  /** Renews a sign-in about to expire, then checks the token (or, signed out, says so at once). */
  const start = () => {
    const app = readAppSession();
    const token = getToken();
    if (token && app && needsRefresh(app, Date.now())) {
      // The sign-in expires soon (or has): renew it before the first call. If that fails and the token is already
      // past its expiry, it is refused without asking GitHub.
      paint();
      void refreshSignIn().then((ok) => {
        if (!ok && app.expiresAt !== null && app.expiresAt <= Date.now()) writeCheck(rejectedCheck(token, Date.now()));
        boot();
      });
    } else boot();
  };
  // An email contributor (real teams only, no GitHub sign-in): the link from the email is spent first, then the server
  // confirms the session; meanwhile the page shows the member this browser last saw. Without one, the same GET tells
  // whether someone is signed in with an email (a session from another tab), after the page painted signed out.
  const repo = pageRepo();
  if (!githubToken() && contributeEligible(repo, repoContext().hosted) && !document.documentElement.hasAttribute('data-no-repo')) {
    const link = takeContributeHash();
    const settle = (m: ContributeMember | null) => {
      const next = m ? contributorViewer(m) : null;
      if (githubToken() || (viewer?.login === next?.login && viewer?.name === next?.name && checked)) return;
      viewer = next;
      forgetAccess();
      if (!m) void clearPrivateRepoCaches();
      done();
      if (!m) paintAccess();
    };
    onContributeChange((r, m) => {
      if (r.toLowerCase() === repo.toLowerCase()) settle(m);
    });
    // Signed out in another tab (it forgot this team's member): this tab says "You signed out" instead of reading on
    // as a guest (components/ds/studio/NoAccess.tsx).
    window.addEventListener('storage', (e) => {
      if (e.key !== contributorKey(repo) || e.newValue !== null || !viewer?.email || githubToken()) return;
      try {
        sessionStorage.setItem(SIGNED_OUT_ELSEWHERE_KEY, '1');
      } catch {
        /* storage blocked: the page reloads signed out all the same */
      }
      location.reload();
    });
    const known = contributorFor(repo);
    if (link) {
      contributeLink = 'checking';
      paint();
      void verifyEmailSignIn(repo, link).then(
        (m) => {
          contributeLink = null;
          settle(m);
        },
        () => {
          contributeLink = 'expired';
          settle(known);
        },
      );
      return;
    }
    if (known) {
      viewer = contributorViewer(known);
      done();
      void contributeInfo(repo);
      return;
    }
    // No member known in this browser (a team opened for the first time, right after a code sign-in): the server says
    // first whether this account is on the team, so the page never checks access as a guest and shows "Sign in" to a
    // member. A member: settle() above takes over. Nobody: the page goes on signed out, as a guest.
    paint();
    void contributeInfo(repo).then((info) => {
      if (!info.member && !checked && !githubToken()) start();
    });
    return;
  }
  start();
}

export type { RepoAccess, RepoAccessState };

/**
 * What the visitor may do, per repository ("owner/repo", lower case), once read. Kept for the page in memory and for
 * ACCESS_MAX_AGE_MS in sessionStorage; the token check also remembers the last one so a page paints it at once.
 */
const accessByRepo = new Map<string, RepoAccess>();
const accessListeners: ((a: RepoAccess | null) => void)[] = [];
const repoName = (r: { owner: string; repo: string }) => `${r.owner}/${r.repo}`.toLowerCase();

/** The access to this page's repository, null until known (or signed out on the self-hosted site). */
export const currentAccess = (): RepoAccess | null => accessByRepo.get(repoName(readRepo())) ?? null;

/** GitHub was busy when the access to a repository was last asked: when it is back. Cleared by the next read. */
const accessBusyByRepo = new Map<string, GitHubBusy>();
/** GitHub is busy for this page's repository's access read (the team chip reads neutral, not "Checking"), else null. */
export const accessBusy = (): GitHubBusy | null => accessBusyByRepo.get(repoName(readRepo())) ?? null;

/** Forgets every access read on this page and in this tab (sign-out, another token, a rejected token). */
let accessEpoch = 0;
function forgetAccess() {
  accessEpoch++;
  accessByRepo.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('bridge.github.access:')) sessionStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
}

/** Calls `fn` each time the access to this page's repository is read (after connect) or cleared (disconnect). */
export function onAccess(fn: (a: RepoAccess | null) => void) {
  accessListeners.push(fn);
  const a = currentAccess();
  if (a) fn(a);
}

/**
 * What the visitor may do on `repo` (multi-team plan 3.3, core resolveRepoAccess): one of eight states, with the
 * write and reach flags the Studio acts on. Signed out it is null, unless `anonymous` asks for the public read state
 * (team shells). Reused for ACCESS_MAX_AGE_MS; a rejected token or an unreachable GitHub gives null. `probe`: a look at
 * another repository (the "Create a new team" dialog): it leaves this page's remembered check and caches alone.
 */
export async function resolveAccess(repo: { owner: string; repo: string } = readRepo(), opts: { anonymous?: boolean; probe?: boolean } = {}): Promise<RepoAccess | null> {
  // A saved sign-in still being checked: wait for it, so a signed-in person is never read as a signed-out visitor.
  if (!opts.probe) await sessionSettled();
  const token = getToken();
  const signedIn = Boolean(viewer && token && !tokenRejected());
  if (!signedIn && !opts.anonymous) return null;
  const name = repoName(repo);
  // An email member edits this team, or administers it without GitHub (they approve nothing): no GitHub call to say it.
  if (signedIn && viewer?.email && isContribAuth(token)) {
    if (name !== repoName(readRepo())) return null;
    // 'admin' for an email member made Admin (or seeded as admin in `npm run dev:full`): the server checks every admin
    // action again.
    const role = contributorFor(pageRepo())?.role;
    const a = contributorAccess(role === 'admin', role === 'view');
    accessByRepo.set(name, a);
    return a;
  }
  const held = accessByRepo.get(name);
  // A signed-out read never answers for someone signed in (it would say "Guest" to an admin): read again with the sign-in.
  if (held && !(signedIn && anonymousAccess(held))) return held;
  const app = signedIn && sessionMode() === 'app';
  const storageKey = signedIn && viewer ? accessStorageKey(pageSlot() ?? '', viewer.login, name) : `bridge.github.access:anonymous:${name}`;
  try {
    const kept = freshAccess(sessionStorage.getItem(storageKey), Date.now());
    if (kept) {
      accessByRepo.set(name, kept);
      return kept;
    }
  } catch {
    /* storage blocked: ask GitHub */
  }
  const epoch = accessEpoch;
  try {
    const client = studioClient(`${repo.owner}/${repo.repo}`, signedIn ? token : null);
    const read = accessView(await resolveRepoAccess(client, { app }), app);
    // Signed in or out meanwhile (an email session confirmed while GitHub answered a guest): this read is stale, and
    // must not replace what the new session says.
    if (epoch !== accessEpoch) return accessByRepo.get(name) ?? null;
    // Read as a signed-out visitor while the sign-in was being checked, and someone is signed in now: read again as them.
    if (!signedIn && viewer && getToken() && !tokenRejected()) return resolveAccess(repo, opts);
    // The token may have been refused while reading (studioFetch marks it): nothing to keep then.
    if (signedIn && tokenRejected()) return null;
    accessBusyByRepo.delete(name);
    // A repository this visitor can no longer see: drop what this browser kept of it.
    if (!opts.probe && (read.state === 'no-access' || read.state === 'anonymous-unknown')) void clearRepoCache(name);
    accessByRepo.set(name, read);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), access: read }));
    } catch {
      /* storage blocked: memory only */
    }
    const last = signedIn && !opts.probe ? currentCheck() : null;
    if (last?.ok) {
      writeCheck({ ...last, write: read.write, reach: typeof read.reach === 'boolean' ? read.reach : null, access: { repo: name, state: read.state, read: ACCESS_READ } });
    }
    return read;
  } catch (err) {
    // GitHub busy for the viewer: the role as last read here (whatever its age), never "Checking" for the whole wait,
    // and one read again just after the reset.
    const busy = githubBusy(err);
    if (!busy || opts.probe || epoch !== accessEpoch) return null;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(storageKey);
    } catch {
      /* storage blocked */
    }
    const kept = lastKnownAccess(raw, signedIn ? currentCheck()?.access : null, name, app);
    if (kept) accessByRepo.set(name, kept);
    if (!accessBusyByRepo.has(name)) {
      setTimeout(() => {
        accessBusyByRepo.delete(name);
        if (kept && accessByRepo.get(name) === kept) accessByRepo.delete(name);
        void readAccess().then(paintAccess);
      }, busyRetryDelay(busy));
    }
    accessBusyByRepo.set(name, busy);
    return kept;
  }
}

/** This page's repository: signed in always, signed out only on a team shell (public read state). */
const readAccess = () => resolveAccess(readRepo(), { anonymous: repoContext().hosted });

function paintAccess() {
  const r = readRepo();
  // Can view (an email member who reads only): every action marked as a write ([data-demo-write]) and New token leave
  // the page (site.css). The server refuses them anyway; this keeps the page to what they can do.
  document.documentElement.toggleAttribute('data-view-only', Boolean(viewer?.email && contributorFor(pageRepo())?.role === 'view'));
  const app = sessionMode() === 'app';
  const access = currentAccess();
  const shown = viewer ? access : null;
  document.querySelectorAll<HTMLElement>('[data-gh-perm]').forEach((el) => {
    // An email member reads their role in designer words, the one the team chip shows (lib/access pillState): Admin
    // for an email admin, else Can edit.
    el.textContent = viewer?.email ? (pillState(shown) === 'admin' ? ROLE_WORDS.admin.label : contributorRole()) : accessLabel(Boolean(viewer), shown);
    el.className = `gh-perm${shown ? (shown.write ? ' is-write' : ' is-read') : ''}`;
  });
  document.querySelectorAll<HTMLElement>('[data-gh-perm-help]').forEach((el) => {
    el.hidden = !viewer || !shown || shown.write;
    if (viewer && shown && !shown.write) el.textContent = shown.reach === false ? noReachText(viewer.login, `${r.owner}/${r.repo}`) : readOnlyText(viewer.login, `${r.owner}/${r.repo}`, app);
  });
  accessListeners.forEach((fn) => fn(access));
}

/**
 * Marks every [data-gh-gate="verb phrase"] action as unavailable until GitHub is connected (or reconnected), with a DS
 * tooltip (data-tooltip, bound once by scripts/shell.ts) that says how to unlock it.
 */
export function paintGates(root: ParentNode = document) {
  const on = Boolean(viewer);
  const rejected = tokenRejected();
  const app = sessionMode() === 'app';
  const signIn = prefersSignIn();
  root.querySelectorAll<HTMLElement>('[data-gh-gate]').forEach((el) => {
    if (on) {
      el.removeAttribute('aria-disabled');
      if (/^(Connect GitHub|Sign in|Your GitHub|Bridge changed how)/.test(el.dataset.tooltip ?? '')) delete el.dataset.tooltip;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.dataset.tooltip = !rejected && signIn && signInSwitched()
        ? `Bridge changed how it connects to GitHub. Sign in again to ${el.dataset.ghGate}.`
        : rejected
        ? app
          ? `Your GitHub sign-in expired. Sign in again to ${el.dataset.ghGate}.`
          : signIn
            ? `Your GitHub sign-in stopped working. Sign in again to ${el.dataset.ghGate}.`
            : `Your GitHub token stopped working. Reconnect to ${el.dataset.ghGate}.`
        : `${ghAction(el.dataset.ghGate ?? '', signIn)}.`;
    }
  });
}

/**
 * DS Button state from a vanilla script. A statically rendered DS Button styles its disabled look from
 * data-disabled (set once at render) and wraps its text in a label span next to the icon: keep both in sync.
 */
export function setButtonDisabled(btn: HTMLButtonElement, disabled: boolean) {
  btn.disabled = disabled;
  btn.toggleAttribute('data-disabled', disabled);
}

/** Sets a DS Button's visible text without removing its icon. */
export function setButtonLabel(btn: HTMLElement, text: string) {
  const label = btn.querySelector<HTMLElement>(':scope > span') ?? btn;
  label.textContent = text;
}

/** Disables a DS Button while work runs and shows what it does ("Checking"), then restores it. */
export function setButtonBusy(btn: HTMLButtonElement, busy: boolean, text: string) {
  setButtonDisabled(btn, busy);
  btn.toggleAttribute('aria-busy', busy);
  setButtonLabel(btn, text);
}
