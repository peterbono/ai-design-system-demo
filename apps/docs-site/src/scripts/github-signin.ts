// The /studio/auth/callback/ page: finishes Sign in with GitHub (docs/SIGN-IN.md, lib/github-signin.ts).
// It removes the code and state from the address bar first (they never stay in the history), then forwards a
// sign-in started on a preview to that preview, or trades the code for a token through this site's
// /api/github/token and goes back to the page the sign-in started on. Errors stay on this page with one sentence
// that says how to fix it and a Sign in again button.
import { callbackStep, type PendingSignIn, SIGNIN_TEXT } from '../lib/github-signin';
import { PENDING_KEY, postToken, readSignInConfig, saveSignIn } from './github-session';
import { studioHref } from '../lib/team-path';

function readPending(): PendingSignIn | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingSignIn) : null;
  } catch {
    return null;
  }
}

function dropPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked: nothing was kept */
  }
}

export async function runCallback(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-auth-callback]');
  if (!root) return;
  const params = new URLSearchParams(location.search);
  history.replaceState(history.state, '', location.pathname);

  const fail = (message: string, returnTo: string) => {
    root.dataset.state = 'error';
    const title = root.querySelector<HTMLElement>('[data-auth-title]');
    if (title) title.textContent = 'Sign-in did not finish';
    // The sentence replaces "Finishing the sign-in" in the same status line, so screen readers hear it.
    const sub = root.querySelector<HTMLElement>('[data-auth-sub]');
    if (sub) sub.textContent = message;
    const actions = root.querySelector<HTMLElement>('[data-auth-actions]');
    if (actions) actions.hidden = false;
    root.querySelector<HTMLAnchorElement>('[data-auth-back]')?.setAttribute('href', returnTo);
  };

  const cfg = readSignInConfig();
  if (!cfg) {
    fail(SIGNIN_TEXT.notConfigured, studioHref('settings/#connection'));
    return;
  }
  const step = callbackStep(params, location.origin, readPending(), cfg, Date.now());
  if (step.kind === 'relay') {
    location.replace(step.url);
    return;
  }
  // One use: a reload or the back button cannot replay this sign-in.
  dropPending();
  if (step.kind === 'error') {
    fail(step.message, step.returnTo);
    return;
  }
  try {
    // The app this site signs in with (Bridge, or Bridge Direct in direct mode) trades the code and later renews it.
    const token = await postToken({ grant: 'code', code: step.code, code_verifier: step.verifier, redirect_uri: step.redirectUri, client_id: cfg.clientId });
    saveSignIn(token, { clientId: cfg.clientId });
    location.replace(step.returnTo);
  } catch (err) {
    fail((err as Error).message || SIGNIN_TEXT.failed, step.returnTo);
  }
}
