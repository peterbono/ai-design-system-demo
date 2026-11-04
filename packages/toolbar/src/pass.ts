// The read pass Bridge Studio hands a team member's tab (Bridge's api/_lib/read-pass.ts): it lets the toolbar read the
// change of a PRIVATE product through Bridge's read proxy, read only, for a few hours. Studio puts it in front of the
// URL fragment (`#bridge-pass=<pass>&<the hash route>`): a fragment never reaches the preview host or its logs. The
// toolbar takes it out of the address before the product's router reads the hash (at import), keeps it for this tab
// (sessionStorage), and sends it with its reads as `&pass=` (still a "simple" request: no header, no credentials).
import type { StorageLike } from './session';

export const PASS_PARAM = 'bridge-pass';
export const PASS_KEY = 'bridge-toolbar:pass';
const PASS = /^[A-Za-z0-9._-]{16,4096}$/;

/** The pass at the front (or the end) of a fragment, and the fragment without it. */
export function splitPass(hash: string): { pass: string | null; rest: string } {
  const h = hash.replace(/^#/, '');
  const front = /^bridge-pass=([^&]*)(?:&([\s\S]*))?$/.exec(h);
  if (front) return { pass: PASS.test(front[1]!) ? front[1]! : null, rest: front[2] ?? '' };
  const end = /^([\s\S]*?)&bridge-pass=([^&]*)$/.exec(h);
  if (end) return { pass: PASS.test(end[2]!) ? end[2]! : null, rest: end[1]! };
  return { pass: null, rest: h };
}

/**
 * Takes the pass out of the address (history.replaceState: no new entry, no reload) and keeps it for the tab. Returns
 * the pass of this tab: the one just taken, else the one kept. Blocked storage keeps it for this page only.
 */
export function takePass(loc: { href: string; hash: string }, storage: StorageLike | null, replace: (url: string) => void): string | null {
  const { pass, rest } = splitPass(loc.hash);
  if (/^#?bridge-pass=|&bridge-pass=/.test(loc.hash)) {
    const url = new URL(loc.href);
    url.hash = rest;
    replace(url.href.replace(/#$/, ''));
  }
  if (pass) {
    memory = pass;
    try {
      storage?.setItem(PASS_KEY, pass);
    } catch {
      // Blocked storage: this page keeps it.
    }
    return pass;
  }
  return readPass(storage);
}

let memory: string | null = null;

/** The pass of this tab, or null. */
export function readPass(storage: StorageLike | null): string | null {
  let kept: string | null = null;
  try {
    kept = storage?.getItem(PASS_KEY) ?? null;
  } catch {
    kept = null;
  }
  const p = kept ?? memory;
  return p && PASS.test(p) ? p : null;
}

/** Tests start fresh. */
export function resetPass() {
  memory = null;
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * On import in a browser: the pass leaves the address before anything reads the hash. A hash router that already read
 * it (a product that loads the toolbar after its router) hears a hashchange, so it shows the screen the address names
 * instead of an empty page for a `bridge-pass=` route: replaceState alone tells no one.
 */
export function takePassFromAddress(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return takePass(window.location, session(), (url) => {
      const oldURL = window.location.href;
      window.history.replaceState(window.history.state, '', url);
      try {
        window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
      } catch {
        // No HashChangeEvent here: the router reads the clean address on its next look.
      }
    });
  } catch {
    return null;
  }
}

/** The pass of this tab, in a browser. */
export const tabPass = (): string | null => (typeof window === 'undefined' ? null : readPass(session()));

/** `url` (another deployment of the product: Live product, This change) with the tab's pass in front of its fragment. */
export function withPass(url: string, pass: string | null): string {
  if (!pass || !PASS.test(pass)) return url;
  const u = new URL(url);
  const rest = splitPass(u.hash).rest;
  u.hash = `${PASS_PARAM}=${pass}${rest ? `&${rest}` : ''}`;
  return u.href;
}
