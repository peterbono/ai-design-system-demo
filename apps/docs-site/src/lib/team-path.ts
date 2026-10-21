// Studio addresses in both modes (multi-team plan, section 4.1). Pure and browser-safe: no Node API, no import.
//
// - Self-hosted (today's site, and every page at build time): Studio lives at /studio/, so studioHref('changes/')
//   is '/studio/changes/', byte for byte the literal it replaces.
// - Team shell (<html data-hosted>, address /studio/<owner>/<repo>/... or the escape form /studio/~/<owner>/<repo>/...):
//   every Studio link keeps the team, so studioHref('changes/') is '/studio/<owner>/<repo>/changes/'.
//
// Every Studio link, redirect and fetch of a Studio file goes through studioHref. A literal '/studio/...' outside the
// files listed in no-studio-literals.test.ts fails CI.

/** Where Studio lives in self-hosted mode. */
export const STUDIO_ROOT = '/studio/';

// GitHub's own limits: an owner is 1-39 alphanumerics or single hyphens, not starting with one; a repository name is
// 1-100 of letters, digits, '.', '-', '_' (and never "." or "..").
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** A team address split into its parts; `escaped` for the /studio/~/ form. Null for any other path. */
function teamAddress(pathname: string): { owner: string; repo: string; escaped: boolean } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'studio') return null;
  const escaped = parts[1] === '~';
  const [owner, repo] = escaped ? [parts[2], parts[3]] : [parts[1], parts[2]];
  if (!owner || !repo) return null;
  let o: string;
  let r: string;
  try {
    o = decodeURIComponent(owner);
    r = decodeURIComponent(repo);
  } catch {
    return null;
  }
  if (!OWNER.test(o) || !REPO.test(r) || r === '.' || r === '..') return null;
  return { owner: o, repo: r, escaped };
}

/**
 * Owner and repository from a team address: /studio/<owner>/<repo>/... or /studio/~/<owner>/<repo>/... (the escape
 * form for an owner that shadows a Studio page). Null for any other path or an invalid name.
 */
export function repoFromPath(pathname: string): { owner: string; repo: string } | null {
  const team = teamAddress(pathname);
  return team && { owner: team.owner, repo: team.repo };
}

/** True on a team shell (the layout sets <html data-hosted>). False at build time. */
export const isHosted = (): boolean => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-hosted');

/**
 * The Studio root for a page: '/studio/' in self-hosted mode, '/studio/<owner>/<repo>/' (or '/studio/~/<owner>/<repo>/')
 * on a team shell. `hosted` is the <html data-hosted> flag; a hosted page whose address is not a team keeps '/studio/'.
 */
export function studioBase(pathname: string, hosted: boolean): string {
  const team = hosted ? teamAddress(pathname) : null;
  return team ? `${STUDIO_ROOT}${team.escaped ? '~/' : ''}${team.owner}/${team.repo}/` : STUDIO_ROOT;
}

// A full self-hosted Studio path ('/studio/changes/', '/studio'), as the nav.ts constants spell them.
const FULL = /^\/studio(?:\/|(?=[?#]|$))/;

/** studioHref against an explicit Studio root (studioBase). Pure: what studioHref does once it knows the page. */
export function studioHrefAt(base: string, path = ''): string {
  return base + path.replace(FULL, '').replace(/^\/+/, '');
}

/**
 * A Studio address for this page. `path` is relative to the Studio root ('changes/?pr=12', 'tokens/', '' for Home,
 * '?setup=library', '#x'); a full '/studio/...' path (a nav.ts constant) is accepted too. In self-hosted mode and at
 * build time it returns '/studio/' + path, unchanged from the literal it replaces; on a team shell it keeps the team.
 */
export function studioHref(path = ''): string {
  const hosted = isHosted() && typeof location !== 'undefined';
  return studioHrefAt(hosted ? studioBase(location.pathname, true) : STUDIO_ROOT, path);
}
