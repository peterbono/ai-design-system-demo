// Studio's side of the read pass (lib/read-pass-link.ts): for a member of the page's team, ask the server for a pass
// once (GET /api/contribute?repo=<team>&mint=read-pass, kept in this tab until shortly before it expires), and put it
// on a product preview link with the toolbar at the moment the member opens it (click, middle click, Enter). The link
// in the page never keeps it: copying the link address, or the link in a share message, carries no pass.
import { CONTRIBUTE_API, localDevHost } from '../lib/contribute';
import { parseGrant, withReadPass, type ReadPassGrant } from '../lib/read-pass-link';
import { contributorFor } from './contribute-session';
import { bridgeReadAuth, readRepo, signedInWithGitHub } from './github-session';

const KEY = 'bridge.read-pass:';
/** Ask again this long before the pass expires. */
const RENEW_MS = 30 * 60 * 1000;

const grants = new Map<string, Promise<ReadPassGrant | null>>();
const ready = new Map<string, ReadPassGrant | null>();

function kept(team: string): ReadPassGrant | null {
  try {
    const g = parseGrant(JSON.parse(sessionStorage.getItem(KEY + team) ?? 'null'));
    return g && g.exp - Date.now() > RENEW_MS ? g : null;
  } catch {
    return null;
  }
}

async function ask(team: string): Promise<ReadPassGrant | null> {
  // Only someone signed in can be a member: a visitor asks nothing.
  if (!signedInWithGitHub() && !contributorFor(team)) return null;
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

/** The pass of `team` for this tab: kept, else asked once (null for anyone who is not a member). */
export function readPassOf(team: string): Promise<ReadPassGrant | null> {
  const k = team.toLowerCase();
  const have = ready.get(k) ?? kept(k);
  if (have && have.exp - Date.now() > RENEW_MS) {
    ready.set(k, have);
    return Promise.resolve(have);
  }
  let going = grants.get(k);
  if (!going) {
    going = ask(k).then((g) => {
      ready.set(k, g);
      // A refusal is asked again on the next page, not on every click.
      return g;
    });
    grants.set(k, going);
  }
  return going;
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

function onOpen(e: MouseEvent) {
  const team = teamOfPage();
  const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!team || !a) return;
  const grant = ready.get(team) ?? null;
  const href = withReadPass(a.href, grant, Date.now(), localDevHost());
  if (!href) return;
  const was = a.getAttribute('href')!;
  a.setAttribute('href', href);
  // The browser follows the link after this event; the page keeps the link without the pass.
  setTimeout(() => a.setAttribute('href', was), 0);
}

let installed = false;

/** Once per page: ask for the team's pass, and hand it to toolbar links the member opens. */
export function installReadPass() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const team = teamOfPage();
  if (team) void readPassOf(team);
  document.addEventListener('click', onOpen, true);
  document.addEventListener('auxclick', onOpen, true);
}
