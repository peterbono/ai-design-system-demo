// GitHub access from the browser. Reads are unauthenticated when no token is set (public repos, 60 requests an
// hour per IP); every successful GET is cached in localStorage so a rate-limited visitor still sees the last data.
// Writes (reviews, merges, token proposals) need a token: a user access token from "Sign in with GitHub" (when the
// site has a GitHub App, see docs/SIGN-IN.md and lib/github-signin.ts), or a fine-grained token the user pastes
// once. Either stays in this browser's localStorage, is only ever sent to api.github.com (and, for a refresh, to
// this site's own /api/github/token), and is never part of the build.

import { attrUrl, escapeHtml } from '../lib/html';
import { classifyAuth, type FetchLike, GitHubClient, GitHubError, type ClientOptions, friendlyMessage, resolveRepoAccess } from '@bridge-ds/core';
import { accessFromCheck, accessLabel, accessStorageKey, accessView, contributorAccess, freshAccess, type RepoAccess, type RepoAccessState } from '../lib/access';
import { repoContext } from './repo-context';
import { clearPrivateRepoCaches, clearRepoCache } from './repo-cache';
import {
  authFailure,
  type AuthFailure,
  type TokenCheck,
  checkFor,
  needsCheck,
  okCheck,
  rejectedCheck,
  sessionState,
  rejectedText,
  type SessionMode,
} from '../lib/token-session';
import { closeDialog, isDialogOpen, openDialog as openDsDialog } from '@bridge-ds/react/dom';
import { paintAvatar, paintDrawnAvatar } from './avatar';
import { askDirectInstallMessage, DIRECT_CONSENT, DIRECT_SETUP, directSetupLine, ghAction, ghButton, ghVerb } from '../lib/gh-wording';
import { installUrl } from '../lib/access-view';
import { changesModeOnPage } from './changes-mode';
import { bindDemoGate } from './demo-gate';
import {
  type AppSession,
  type DirectApp,
  authorizeUrl,
  callbackUrl,
  canRefresh,
  encodeState,
  exchangeErrorText,
  needsDirectApp,
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
  type SignInApp,
  type SignInConfig,
  SIGNIN_TEXT,
  type SlotContent,
  slotKey,
  STORAGE_SLOTS,
  type StorageSlot,
  TOKEN_ENDPOINT,
  type TokenResponse,
} from '../lib/github-signin';
import { studioHref } from '../lib/team-path';
import { clearGuestReads, guestFetch } from './guest-activity';
import { CONTRIB_TOKEN, CONTRIBUTE_WORDS, contributeEligible, isContribAuth, type ContributeMember } from '../lib/contribute';
import { contributeFetch, contributeInfo, contributorFor, onContributeChange, signOutEmail, takeContributeHash, verifyEmailSignIn } from './contribute-session';

export { GitHubError };

export interface RepoRef {
  owner: string;
  repo: string;
  defaultBranch: string;
}

// The token, its check and its sign-in session live in one slot per GitHub App (lib/github-signin.ts slotKey):
// 'bridge.github.token.suggest' for "Bridge", '.direct' for "Bridge Direct", no suffix without a GitHub App.
const TOKEN_BASE = 'bridge.github.token';
const CHECK_BASE = 'bridge.github.check';
/** The sign-in session (expiry, refresh token) next to its token. Absent for a pasted token. */
const APP_BASE = 'bridge.github.app';
/** Set when a sign-in of another app was removed: the account block and the dialog ask to sign in again. */
const SWITCHED_KEY = 'bridge.github.switched';

/**
 * The app this site signs in with, written at build time on <html data-gh-app> by the layout ('' without a GitHub
 * App). Null on a page without the attribute: nothing is moved or cleared there.
 */
function pageSlot(): StorageSlot | null {
  const v = document.documentElement.getAttribute('data-gh-app');
  return v === null ? null : v === 'suggest' || v === 'direct' ? v : '';
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
    const read = (s: StorageSlot): SlotContent => {
      let session: AppSession | null = null;
      try {
        session = JSON.parse(localStorage.getItem(slotKey(APP_BASE, s)) ?? 'null') as AppSession | null;
      } catch {
        session = null;
      }
      return { token: Boolean(localStorage.getItem(slotKey(TOKEN_BASE, s))), session: session && session.kind === 'app' ? session : null };
    };
    const slots: Partial<Record<StorageSlot, SlotContent>> = {};
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
 * The email contributor signed in on this page's team (lib/contribute.ts), when there is no GitHub sign-in: real teams
 * only, never the sample team, Bridge's demo or the browser workspace. Null otherwise.
 */
export function currentContributor(): ContributeMember | null {
  if (typeof document === 'undefined' || githubToken() || document.documentElement.hasAttribute('data-no-repo')) return null;
  const repo = pageRepo();
  return contributeEligible(repo, repoContext().hosted) ? contributorFor(repo) : null;
}

/**
 * The token every GitHub call of the Studio carries: the GitHub one, or, for an email contributor, a stand-in that
 * the session's fetch sends to this site's proxy (scripts/contribute-session.ts). Features never tell them apart.
 */
export function getToken(): string | null {
  return githubToken() ?? (currentContributor() ? CONTRIB_TOKEN : null);
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
 * Studio page to land on afterwards (this one by default). `as`: another app than the page's (Bridge Direct, asked
 * for by a team in direct mode); its token goes to that app's slot.
 */
export async function startSignIn(returnTo = location.pathname + location.search + location.hash, as?: { app: SignInApp; clientId: string }): Promise<void> {
  const cfg = readSignInConfig();
  if (!cfg) throw new SignInError('Sign in with GitHub is not set up on this site. Connect with a token from Settings instead.');
  if (!globalThis.crypto?.subtle) throw new SignInError('This browser cannot sign in safely here (no Web Crypto). Open Studio over https and sign in again.');
  const fill = (a: Uint8Array) => crypto.getRandomValues(a);
  const verifier = randomString(32, fill);
  const state = encodeState(randomString(24, fill), location.origin);
  const redirectUri = callbackUrl(location.origin, cfg);
  const challenge = await pkceChallenge(verifier, (d) => crypto.subtle.digest('SHA-256', d as Uint8Array<ArrayBuffer>));
  const app = as ?? { app: cfg.app, clientId: cfg.clientId };
  const pending: PendingSignIn = { state, verifier, redirectUri, returnTo: safeReturnTo(returnTo), at: Date.now(), app: app.app, clientId: app.clientId };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new SignInError('This browser blocks site storage, so the sign-in could not finish. Allow site data for this site, then sign in again.');
  }
  location.assign(authorizeUrl({ clientId: app.clientId, redirectUri, state, challenge }));
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

/**
 * Saves a finished sign-in: the token like a pasted one, plus its expiry, refresh token and the app's client ID.
 * `slot`: the app the sign-in was for, when it is not this page's (the callback page saves a team page's sign-in, or
 * Bridge Direct's OK, into that app's own slot; the other slots are left as they are).
 */
export function saveSignIn(r: TokenResponse, opts: { refresh?: boolean; clientId?: string; slot?: StorageSlot } = {}) {
  if (opts.slot !== undefined && opts.slot !== pageSlot()) {
    saveToSlot(opts.slot, r, opts.clientId);
    if (!opts.refresh) clearSwitched();
    return;
  }
  const previous = opts.refresh ? currentCheck() : null;
  if (!opts.refresh) clearSwitched();
  writeAppSession(sessionFrom(r, Date.now(), opts.clientId));
  // A refresh keeps the account: carry the last good check over to the new token (no extra call to GitHub). A new
  // sign-in may be another account: it is checked again.
  writeCheck(previous?.ok && previous.viewer ? { ...okCheck(r.access_token, previous.viewer, Date.now(), previous.write), ...(typeof previous.reach === 'boolean' ? { reach: previous.reach } : {}), ...(previous.access ? { access: previous.access } : {}) } : null);
  setToken(r.access_token);
}

let refreshing: Promise<boolean> | null = null;

/** Renews the sign-in with its refresh token. True when a fresh token is saved. One refresh at a time. */
export function refreshSignIn(): Promise<boolean> {
  if (refreshing) return refreshing;
  const s = readAppSession();
  if (!s || !s.refreshToken || !canRefresh(s, Date.now())) return Promise.resolve(false);
  // The app that issued the token renews it (sessions saved before the two apps: the site's app).
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

/** Writes a sign-in into one app's slot, without touching this page's (its check is made where it is used). */
function saveToSlot(slot: StorageSlot, r: TokenResponse, clientId?: string) {
  try {
    localStorage.setItem(slotKey(TOKEN_BASE, slot), r.access_token.trim());
    localStorage.setItem(slotKey(APP_BASE, slot), JSON.stringify(sessionFrom(r, Date.now(), clientId)));
    localStorage.removeItem(slotKey(CHECK_BASE, slot));
  } catch {
    /* storage blocked: the sign-in cannot be kept */
  }
}

// --- Bridge Direct on team pages (multi-team plan 3.2, PR 3d) -----------------------------------------------------
// A team page signs in with Bridge (read code, send suggestions). When the team's bridge.config.json says
// "changes": "direct", code writes (branches, saves, merges, reviews) go out with Bridge Direct instead: the first one
// asks for its OK in the "Allow Bridge to save to branches" dialog (components/GitHubDialog.astro), then GitHub
// brings the visitor back to the same page. Its token lives in its own slot ('direct'), next to Bridge's. The
// self-hosted site never takes this path: it signs in with the app its mode needs up front.

const DIRECT_SLOT: StorageSlot = 'direct';
/** Per account and repository: Bridge Direct reaches it (sessionStorage, ACCESS_MAX_AGE_MS like the access). */
const DIRECT_OK_PREFIX = 'bridge.github.direct-ok:';
const DIRECT_OK_MAX_AGE_MS = 10 * 60 * 1000;

/** Bridge Direct, when this page's code writes need it: a team page in direct mode, both apps set up. Else null. */
export function directApp(): DirectApp | null {
  const cfg = readSignInConfig();
  if (!cfg?.direct || cfg.app === 'direct' || pageSlot() === DIRECT_SLOT) return null;
  if (!repoContext().hosted || changesModeOnPage() !== 'direct') return null;
  return cfg.direct;
}

function readDirect(): { token: string | null; session: AppSession | null } {
  try {
    const raw = localStorage.getItem(slotKey(APP_BASE, DIRECT_SLOT));
    const session = raw ? (JSON.parse(raw) as AppSession) : null;
    return { token: localStorage.getItem(slotKey(TOKEN_BASE, DIRECT_SLOT)), session: session?.kind === 'app' ? session : null };
  } catch {
    return { token: null, session: null };
  }
}

/** Bridge Direct's OK, as far as this browser knows: saved and not past its expiry without a way to renew it. */
export function hasDirectOk(): boolean {
  const { token, session } = readDirect();
  return Boolean(token) && !(session && session.expiresAt !== null && session.expiresAt <= Date.now() && !canRefresh(session, Date.now()));
}

/** Forgets Bridge Direct's OK in this browser (sign-out, refused by GitHub, another account). */
function forgetDirect() {
  try {
    for (const base of [TOKEN_BASE, CHECK_BASE, APP_BASE]) localStorage.removeItem(slotKey(base, DIRECT_SLOT));
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(DIRECT_OK_PREFIX)) sessionStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
}

let refreshingDirect: Promise<boolean> | null = null;
/** Renews Bridge Direct's token with its refresh token, into its own slot. True when a fresh one is saved. */
function refreshDirect(clientId: string): Promise<boolean> {
  if (refreshingDirect) return refreshingDirect;
  const { session } = readDirect();
  if (!session?.refreshToken || !canRefresh(session, Date.now())) return Promise.resolve(false);
  const id = session.clientId ?? clientId;
  refreshingDirect = postToken({ grant: 'refresh', refresh_token: session.refreshToken, client_id: id })
    .then((r) => {
      saveToSlot(DIRECT_SLOT, r, id);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshingDirect = null;
    });
  return refreshingDirect;
}

/** Thrown before a code write that cannot go out yet. The dialog is already open; the message goes under the action. */
const directError = (message: string, why: 'direct-consent' | 'direct-not-installed') => new GitHubError(403, message, why);

/** True for the error a write throws while it waits for Bridge Direct (its OK, or its setup on the repository). */
export const isDirectWait = (err: unknown) => err instanceof GitHubError && (err.detail === 'direct-consent' || err.detail === 'direct-not-installed');

/**
 * The token a code write goes out with on this page: Bridge Direct's on a team page in direct mode (renewed when it
 * is about to expire, checked once per repository), null elsewhere (the page's own token, as always). Without its OK,
 * or when it is not set up on the repository, it opens the dialog and throws (nothing was sent).
 */
async function directTokenForWrite(): Promise<string | null> {
  const app = directApp();
  // Signed out, or the sign-in itself stopped working: the usual "Sign in" path says so.
  if (!app || !getToken() || tokenRejected()) return null;
  let { token, session } = readDirect();
  const now = Date.now();
  if (token && session && needsRefresh(session, now)) {
    const ok = await refreshDirect(app.clientId);
    if (!ok && session.expiresAt !== null && session.expiresAt <= now) forgetDirect();
    ({ token, session } = readDirect());
  }
  if (!token) {
    openDirectDialog('consent');
    throw directError(DIRECT_CONSENT.needed, 'direct-consent');
  }
  const repo = readRepo();
  const login = viewer?.login ?? '';
  const okKey = `${DIRECT_OK_PREFIX}${login.toLowerCase()}:${repoName(repo)}`;
  try {
    const at = Number(sessionStorage.getItem(okKey));
    if (at && now - at < DIRECT_OK_MAX_AGE_MS) return token;
  } catch {
    /* storage blocked: check again */
  }
  // Plain fetch: a refusal here is about Bridge Direct's OK, never about the page's own sign-in.
  const client = new GitHubClient(`${repo.owner}/${repo.repo}`, token, (url, init) => fetch(url, init), undefined, { etags: false });
  const refused = (err: unknown) => err instanceof GitHubError && err.status === 401;
  let who: string | null = null;
  try {
    who = (await client.getViewer()).login;
  } catch (err) {
    if (refused(err)) {
      forgetDirect();
      openDirectDialog('consent', DIRECT_CONSENT.expired);
      throw directError(DIRECT_CONSENT.needed, 'direct-consent');
    }
  }
  // The OK must come from the account signed in to Bridge: changes are made in its name.
  if (who && login && who.toLowerCase() !== login.toLowerCase()) {
    forgetDirect();
    openDirectDialog('consent', DIRECT_CONSENT.otherAccount(who, login));
    throw directError(DIRECT_CONSENT.needed, 'direct-consent');
  }
  let found: boolean | null = null;
  try {
    found = Boolean(await client.findInstallation());
  } catch (err) {
    if (refused(err)) {
      forgetDirect();
      openDirectDialog('consent', DIRECT_CONSENT.expired);
      throw directError(DIRECT_CONSENT.needed, 'direct-consent');
    }
    found = null;
  }
  if (found === false) {
    openDirectDialog('setup');
    throw directError(DIRECT_SETUP.needed, 'direct-not-installed');
  }
  // Found (or GitHub would not say): send it, GitHub has the last word.
  if (found)
    try {
      sessionStorage.setItem(okKey, String(now));
    } catch {
      /* storage blocked: checked again next time */
    }
  return token;
}

/** A code write GitHub refused with Bridge Direct's token: forget it and ask for the OK again. */
function directRefused(): GitHubError {
  forgetDirect();
  openDirectDialog('consent', DIRECT_CONSENT.expired);
  return directError(DIRECT_CONSENT.needed, 'direct-consent');
}

let directWired = false;
/**
 * Opens "Allow Bridge to save to branches" (components/GitHubDialog.astro): `consent` explains the OK and continues
 * on GitHub, back to this page; `setup` says Bridge Direct is not on the repository (admins install it, everyone else
 * copies a message for their lead). `note`: one line on top, when an earlier OK stopped working.
 */
export function openDirectDialog(view: 'consent' | 'setup', note?: string) {
  const dialog = document.getElementById('gh-direct-dialog');
  const app = readSignInConfig()?.direct;
  if (!dialog || !app) return;
  const { owner, repo } = readRepo();
  const full = `${owner}/${repo}`;
  const admin = Boolean(currentAccess()?.admin || currentAccess()?.repoAdmin);
  dialog.querySelectorAll<HTMLElement>('[data-gh-direct-view]').forEach((el) => (el.hidden = el.dataset.ghDirectView !== view));
  const title = dialog.querySelector<HTMLElement>('#gh-direct-dialog-title');
  if (title) title.textContent = view === 'consent' ? DIRECT_CONSENT.title : DIRECT_SETUP.title;
  const setupText = dialog.querySelector<HTMLElement>('[data-gh-direct-setup-text]');
  if (setupText) setupText.textContent = directSetupLine(full, admin);
  const noteBox = dialog.querySelector<HTMLElement>('[data-gh-direct-note]');
  const noteText = dialog.querySelector<HTMLElement>('[data-gh-direct-note-text]');
  if (noteBox && noteText) {
    noteText.textContent = note ?? '';
    noteBox.hidden = !note;
  }
  const cont = dialog.querySelector<HTMLButtonElement>('[data-gh-direct-continue]');
  const install = dialog.querySelector<HTMLAnchorElement>('[data-gh-direct-install]');
  const ask = dialog.querySelector<HTMLButtonElement>('[data-gh-direct-ask]');
  if (cont) {
    cont.hidden = view !== 'consent';
    setButtonBusy(cont, false, DIRECT_CONSENT.continueLabel);
  }
  if (install) {
    install.hidden = view !== 'setup' || !admin;
    install.href = installUrl(app.slug);
  }
  if (ask) {
    ask.hidden = view !== 'setup' || admin;
    setButtonLabel(ask, DIRECT_SETUP.askLabel);
  }
  if (!directWired) {
    directWired = true;
    cont?.addEventListener('click', () => {
      const direct = readSignInConfig()?.direct;
      if (!direct) return;
      setButtonBusy(cont, true, 'Opening GitHub');
      startSignIn(undefined, { app: 'direct', clientId: direct.clientId }).catch((err: Error) => {
        setButtonBusy(cont, false, DIRECT_CONSENT.continueLabel);
        if (noteBox && noteText) {
          noteText.textContent = err.message;
          noteBox.hidden = false;
        }
      });
    });
    // Ask your lead: the message, with the install link and this team's Studio, on the clipboard.
    ask?.addEventListener('click', () => {
      const r = readRepo();
      const direct = readSignInConfig()?.direct;
      const text = askDirectInstallMessage(`${r.owner}/${r.repo}`, installUrl(direct?.slug), `${location.origin}${studioHref()}`);
      void navigator.clipboard?.writeText(text).then(
        () => setButtonLabel(ask, DIRECT_SETUP.copied),
        () => undefined,
      );
    });
  }
  if (!isDialogOpen(dialog)) openDsDialog(dialog);
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
  if (!refreshedAfter401 && canRefresh(readAppSession(), Date.now())) {
    refreshedAfter401 = true;
    void refreshSignIn().then((ok) => (ok ? onRefreshed?.() : markTokenRejected()));
    return;
  }
  writeCheck(rejectedCheck(token, Date.now()));
  onRejected?.();
  document.dispatchEvent(new CustomEvent('bridge:auth', { detail: { signedIn: false, rejected: true } }));
}

/**
 * fetch for the core GitHubClient in the Studio: once the token is refused, reads go out anonymously (public repos
 * keep working) and writes fail at once with the same 401; any 401 to a call that carried the token marks it.
 */
export const studioFetch: FetchLike = async (url, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase();
  let headers = init.headers ?? {};
  // An email contributor: every call to the team's repository goes through this site's proxy, the rest as a guest.
  if (isContribAuth(headers.Authorization)) return contributeFetch(pageRepo(), url, init as RequestInit);
  // A write with a token GitHub already refused cannot succeed: answer for it, so the action shows the one message.
  if (method !== 'GET' && tokenRejected() && headers.Authorization) {
    return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (method === 'GET' && tokenRejected() && headers.Authorization) {
    const { Authorization: _drop, ...rest } = headers;
    headers = rest;
  }
  // A code write on a team page in direct mode goes out with Bridge Direct (or waits for its OK: this throws).
  if (headers.Authorization && needsDirectApp(method, url)) {
    const direct = await directTokenForWrite();
    if (direct) {
      const res = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${direct}` } });
      if (res.status === 401) throw directRefused();
      return res;
    }
  }
  // A guest's read: the team's activity, this tab's recent answer, or GitHub (scripts/guest-activity.ts).
  if (method === 'GET' && !headers.Authorization && url.startsWith(API)) {
    const h = headers;
    return guestFetch(url, h.Accept ?? '', () => fetch(url, { ...init, headers: h }));
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && headers.Authorization) {
    markTokenRejected();
    if (method === 'GET') {
      const { Authorization: _drop, ...rest } = headers;
      return fetch(url, { ...init, headers: rest });
    }
  }
  return res;
};

/** The core GitHub client the Studio uses: the saved token, the session-aware fetch. */
export function studioClient(repo: string, token: string | null = getToken(), options?: ClientOptions): GitHubClient {
  return new GitHubClient(repo, token ?? '', studioFetch, undefined, options);
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
  // Waiting for Bridge Direct: its dialog is open; the line says what to do, then try again.
  if (isDirectWait(err)) {
    el.textContent = (err as Error).message;
    return;
  }
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
  return `<a href="${studioHref(`changes/?pr=${Number(pr.number)}`)}">See the branch</a> · <a href="${attrUrl(pr.url)}" target="_blank" rel="noopener">Open on GitHub</a>`;
}

export class RateLimitError extends Error {
  constructor(public resetAt: Date | null) {
    super('GitHub rate limit reached');
  }
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

/** fetch for a call with the session's headers: the proxy for an email contributor, GitHub otherwise. */
const ghFetch = (url: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> =>
  isContribAuth(init.headers.Authorization) ? contributeFetch(pageRepo(), url, init) : fetch(url, init);

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

/** GET with cache fallback. `path` is relative to api.github.com, or an absolute URL. */
export function ghGet<T>(path: string, opts: { accept?: string; raw?: boolean } = {}): Promise<Fetched<T>> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const key = `${url}|${opts.accept ?? ''}|${opts.raw ? 'raw' : ''}|${hasWorkingToken() ? 'auth' : 'anon'}`;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<Fetched<T>>;
  const p = ghGetOnce<T>(url, path, `${url}|${opts.accept ?? ''}`, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ghGetOnce<T>(url: string, path: string, key: string, opts: { accept?: string; raw?: boolean }): Promise<Fetched<T>> {
  try {
    // raw.githubusercontent.com: no custom headers, so no CORS preflight (and no API rate limit).
    const isApi = url.startsWith(API);
    const h = headers(opts.accept ? { Accept: opts.accept } : {});
    // A guest's read: the team's activity, this tab's recent answer, or GitHub (scripts/guest-activity.ts).
    let res = isApi && !h.Authorization ? await guestFetch(url, h.Accept ?? '', () => fetch(url, { headers: h })) : isApi ? await ghFetch(url, { headers: h }) : await fetch(url);
    // GitHub refused the token: mark it, then read anonymously (public repos keep working).
    if (res.status === 401 && isApi && hasWorkingToken()) {
      markTokenRejected();
      res = await fetch(url, { headers: headers(opts.accept ? { Accept: opts.accept } : {}) });
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      if (remaining === '0' || res.status === 429) throw new RateLimitError(reset ? new Date(Number(reset) * 1000) : null);
    }
    if (!res.ok) throw new GitHubError(res.status, `GitHub answered ${res.status} for ${path}`);
    const data = (opts.raw ? await res.text() : await res.json()) as T;
    cacheSet(key, data);
    return { data, stale: false };
  } catch (err) {
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
  // A code write on a team page in direct mode goes out with Bridge Direct (or waits for its OK: this throws).
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const contributor = isContribAuth(headers.Authorization);
  const direct = !contributor && needsDirectApp(method, `${API}${path}`) ? await directTokenForWrite() : null;
  if (direct) headers.Authorization = `Bearer ${direct}`;
  const res = await ghFetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (direct && res.status === 401) throw directRefused();
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

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diff < 60) return 'just now';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
    // An email contributor (no GitHub) is a member who can write: never a demo visitor.
    login: () => viewer?.login ?? currentContributor()?.email ?? null,
    write: () => (currentContributor() ? true : (currentAccess()?.write ?? null)),
    signIn: prefersSignIn,
    known: () => checked || !githubToken(),
    subscribe: (fn) => {
      listeners.push(() => fn());
      onAccess(() => fn());
    },
  });
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
      block.querySelectorAll<HTMLElement>('[data-gh-rejected-text]').forEach((el) => (el.textContent = switched ? 'Bridge changed its GitHub app' : app ? 'Your GitHub sign-in expired' : 'Your GitHub token stopped working'));
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
        el.textContent = email ? (short ? (email.name ?? email.login) : email.login) : viewer ? (short ? viewer.login : login) : '';
      });
      // The side nav's account row: an email contributor's second line is their email, in place of the repository.
      acct.querySelectorAll<HTMLElement>('[data-gh-email]').forEach((el) => {
        el.textContent = email ? email.login : '';
        el.hidden = !email;
      });
      acct.querySelectorAll<HTMLElement>('[data-gh-acct-repo]').forEach((el) => (el.hidden = Boolean(email)));
      acct.querySelectorAll<HTMLElement>('[data-gh-menu-title]').forEach((el) => (el.textContent = email ? CONTRIBUTE_WORDS.account : 'GitHub'));
      const avatar = acct.querySelector<HTMLElement>('[data-gh-avatar]');
      if (avatar) {
        avatar.hidden = !viewer;
        if (email) paintDrawnAvatar(avatar, email.login);
        else if (viewer) paintAvatar(avatar, viewer.login, viewer.avatar_url, 64);
      }
      acct
        .querySelector('summary')
        ?.setAttribute('aria-label', email ? `${CONTRIBUTE_WORDS.account}: ${email.name ?? email.login}. Account menu` : viewer ? `GitHub: connected as ${viewer.login}. Account menu` : 'GitHub account');
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
    if (input) input.value = '';
    // Opened from Change token while connected: say so, the saved token stays until the new one is checked.
    if (title) title.textContent = rejected || switched ? (app || signInView ? 'Sign in again' : 'Reconnect GitHub') : viewer && !app && !signInView ? 'Change GitHub token' : ghButton(Boolean(signInView));
    if (rejectedNote) rejectedNote.hidden = !rejected && !switched;
    if (rejectedNoteText) {
      rejectedNoteText.textContent = switched
        ? SIGNIN_TEXT.switched
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
    setToken(null);
    writeCheck(null);
    writeAppSession(null);
    // On a team page, signing out also takes back Bridge Direct's OK in this browser.
    if (readSignInConfig()?.direct) forgetDirect();
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
    void contributeInfo(repo);
  }
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

/** Forgets every access read on this page and in this tab (sign-out, another token, a rejected token). */
function forgetAccess() {
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
  const token = getToken();
  const signedIn = Boolean(viewer && token && !tokenRejected());
  if (!signedIn && !opts.anonymous) return null;
  const name = repoName(repo);
  // An email contributor can edit this team, never more (they approve nothing): no GitHub call to say it.
  if (signedIn && viewer?.email && isContribAuth(token)) {
    if (name !== repoName(readRepo())) return null;
    const a = contributorAccess();
    accessByRepo.set(name, a);
    return a;
  }
  const held = accessByRepo.get(name);
  if (held) return held;
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
  try {
    const client = studioClient(`${repo.owner}/${repo.repo}`, signedIn ? token : null);
    const read = accessView(await resolveRepoAccess(client, { app }), app);
    // The token may have been refused while reading (studioFetch marks it): nothing to keep then.
    if (signedIn && tokenRejected()) return null;
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
      writeCheck({ ...last, write: read.write, reach: typeof read.reach === 'boolean' ? read.reach : null, access: { repo: name, state: read.state } });
    }
    return read;
  } catch {
    return null;
  }
}

/** This page's repository: signed in always, signed out only on a team shell (public read state). */
const readAccess = () => resolveAccess(readRepo(), { anonymous: repoContext().hosted });

function paintAccess() {
  const r = readRepo();
  const app = sessionMode() === 'app';
  const access = currentAccess();
  const shown = viewer ? access : null;
  document.querySelectorAll<HTMLElement>('[data-gh-perm]').forEach((el) => {
    el.textContent = accessLabel(Boolean(viewer), shown);
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
      if (/^(Connect GitHub|Sign in|Your GitHub|Bridge now signs in)/.test(el.dataset.tooltip ?? '')) delete el.dataset.tooltip;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.dataset.tooltip = !rejected && signIn && signInSwitched()
        ? `Bridge now signs in with a different GitHub App. Sign in again to ${el.dataset.ghGate}.`
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
