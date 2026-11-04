// Studio's side of the read pass (lib/read-pass-link.ts): for a member of the page's team, ask the server for a pass
// once (GET /api/contribute?repo=<team>&mint=read-pass, kept in this tab until shortly before it expires), and put it
// on a product preview link with the toolbar at the moment the member opens it (click, middle click, Enter). The link
// in the page never keeps it: copying the link address, or the link in a share message, carries no pass.
//
// A member who opens the preview before the pass arrived (the page just opened, the server took a moment) waits for it
// a moment instead of opening the preview without it: without the pass the toolbar of a private product cannot read
// the change. A refusal (signed in a moment later, a busy server) is asked again on the next open, never kept for the
// life of the page. A link marked data-bridge-pass="off" (a preview whose toolbar is too old to take the pass,
// lib/read-pass-link.ts toolbarTakesPass) never carries it.
import { CONTRIBUTE_API, localDevHost } from '../lib/contribute';
import { isToolbarLink, parseGrant, withReadPass, type ReadPassGrant } from '../lib/read-pass-link';
import { onAccountChange } from './account-session';
import { contributorFor } from './contribute-session';
import { bridgeReadAuth, readRepo, signedInWithGitHub } from './github-session';

const KEY = 'bridge.read-pass:';
/** Ask again this long before the pass expires. */
const RENEW_MS = 30 * 60 * 1000;
/** A refusal stands this long: opening a preview again after it asks again. */
export const RETRY_MS = 10 * 1000;
/** How long opening a toolbar link waits for a pass still on its way, then opens without it. */
export const WAIT_MS = 4 * 1000;

const grants = new Map<string, Promise<ReadPassGrant | null>>();
const ready = new Map<string, ReadPassGrant | null>();
const refusedAt = new Map<string, number>();

const fresh = (g: ReadPassGrant | null | undefined, now = Date.now()): g is ReadPassGrant => Boolean(g && g.exp - now > RENEW_MS);

function kept(team: string): ReadPassGrant | null {
  try {
    const g = parseGrant(JSON.parse(sessionStorage.getItem(KEY + team) ?? 'null'));
    return fresh(g) ? g : null;
  } catch {
    return null;
  }
}

/** Someone who may be a member of `team`: signed in with GitHub, by email on the team, or with a Bridge account. */
function maybeMember(team: string): boolean {
  return signedInWithGitHub() || Boolean(contributorFor(team)) || (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-account'));
}

async function ask(team: string): Promise<ReadPassGrant | null> {
  // Only someone signed in can be a member: a visitor asks nothing.
  if (!maybeMember(team)) return null;
  try {
    const auth = await bridgeReadAuth(team).catch(() => null);
    const res = await fetch(`${CONTRIBUTE_API}?repo=${encodeURIComponent(team)}&mint=read-pass`, { headers: { Accept: 'application/json', ...(auth ? { Authorization: auth } : {}) }, credentials: 'include' });
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return null;
    const g = parseGrant(await res.json());
    try {
      if (g) sessionStorage.setItem(KEY + team, JSON.stringify(g));
    } catch {
      // Storage blocked: this page keeps it.
    }
    return g;
  } catch {
    return null;
  }
}

/** The pass of `team` for this tab: kept, else asked (null for anyone who is not a member). */
export function readPassOf(team: string): Promise<ReadPassGrant | null> {
  const k = team.toLowerCase();
  const now = Date.now();
  const have = ready.get(k) ?? kept(k);
  if (fresh(have, now)) {
    ready.set(k, have);
    return Promise.resolve(have);
  }
  let going = grants.get(k);
  // Settled without a pass that still holds: a refusal a while ago, or a pass about to expire. Ask again.
  if (going && ready.has(k) && (ready.get(k) ? true : now - (refusedAt.get(k) ?? 0) >= RETRY_MS)) going = undefined;
  if (!going) {
    going = ask(k).then((g) => {
      ready.set(k, g);
      if (g) refusedAt.delete(k);
      else refusedAt.set(k, Date.now());
      return g;
    });
    grants.set(k, going);
  }
  return going;
}

/** Tests start from a fresh page. */
export function resetReadPass() {
  grants.clear();
  ready.clear();
  refusedAt.clear();
  installed = false;
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', onOpen, true);
    document.removeEventListener('auxclick', onOpen, true);
  }
  offAccount?.();
  offAccount = null;
}

const teamOfPage = (): string | null => {
  if (typeof document === 'undefined' || document.documentElement.hasAttribute('data-no-repo')) return null;
  try {
    const r = readRepo();
    return r.owner && r.repo ? `${r.owner}/${r.repo}`.toLowerCase() : null;
  } catch {
    return null;
  }
};

const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => Promise.race([p, new Promise<T>((done) => setTimeout(() => done(fallback), ms))]);

function onOpen(e: MouseEvent) {
  // Only the main button (click) and the middle one (auxclick) open a link.
  if (e.defaultPrevented || (e.type === 'auxclick' && e.button !== 1)) return;
  const team = teamOfPage();
  const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!team || !a || a.dataset.bridgePass === 'off' || !isToolbarLink(a.href)) return;
  const grant = ready.get(team) ?? null;
  const href = withReadPass(a.href, grant, Date.now(), localDevHost());
  if (href) {
    const was = a.getAttribute('href')!;
    a.setAttribute('href', href);
    // The browser follows the link after this event; the page keeps the link without the pass.
    setTimeout(() => a.setAttribute('href', was), 0);
    return;
  }
  // A pass that holds and does not fit this link (another origin): the link opens as it is.
  if (fresh(grant) || !maybeMember(team)) return;
  // The pass is on its way, or was refused a while ago: wait for it a moment, then open (with it when it came).
  e.preventDefault();
  const target = a.href;
  const newTab = a.target === '_blank' || e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey;
  // The tab opens now, inside the click (no popup blocker); it gets its address once the pass is there.
  const tab = newTab ? window.open('about:blank', '_blank') : null;
  if (tab) {
    try {
      tab.opener = null;
    } catch {
      // Already detached.
    }
  }
  void within(readPassOf(team), WAIT_MS, null).then((g) => {
    const url = withReadPass(target, g, Date.now(), localDevHost()) ?? target;
    if (tab) tab.location.replace(url);
    else if (newTab) window.open(url, '_blank', 'noopener');
    else window.location.assign(url);
  });
}

let installed = false;
let offAccount: (() => void) | null = null;

/** Once per page: ask for the team's pass, and hand it to toolbar links the member opens. */
export function installReadPass() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const team = teamOfPage();
  if (team) void readPassOf(team);
  // Signed in after the page opened (the account answers later than the first paint): ask now, not on the click.
  offAccount = onAccountChange((account) => {
    const t = teamOfPage();
    if (!account || !t) return;
    refusedAt.delete(t);
    if (ready.has(t) && !ready.get(t)) grants.delete(t);
    void readPassOf(t);
  });
  document.addEventListener('click', onOpen, true);
  document.addEventListener('auxclick', onOpen, true);
}
