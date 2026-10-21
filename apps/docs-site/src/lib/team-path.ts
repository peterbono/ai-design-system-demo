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

/** True for an owner and repository name GitHub accepts (what a team address and the Vercel rewrite match). */
export const isTeamName = (owner: string, repo: string): boolean => OWNER.test(owner) && REPO.test(repo) && repo !== '.' && repo !== '..';

/** The same rules as Vercel path-to-regexp groups, for the rewrites in vercel.json (team-shells.ts checks them). */
export const OWNER_PATTERN = '[A-Za-z0-9][A-Za-z0-9-]{0,38}';
export const REPO_PATTERN = '[A-Za-z0-9._-]{1,100}';

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

// --- Opening a team (the launcher on /studio/, multi-team plan 4.2 and 4.3) ------------------------------------------

/** Why a launcher entry is not a repository: nothing typed, another host than GitHub, an owner without a repository,
 * or names GitHub would not accept. */
export type TeamInputError = 'empty' | 'not-github' | 'no-repo' | 'invalid';

export type TeamInput = { ok: true; owner: string; repo: string } | { ok: false; error: TeamInputError };

const GITHUB_HOST = /^(?:www\.)?github\.com$/i;

/**
 * The repository in what someone pastes into the launcher: "owner/repo", a GitHub address (with or without https://,
 * a ".git" suffix, or a deeper path such as /tree/main/tokens), an SSH remote (git@github.com:owner/repo.git), or a
 * team address of this site (/studio/owner/repo/...).
 */
export function parseTeamInput(input: string): TeamInput {
  let text = input.trim();
  if (!text) return { ok: false, error: 'empty' };
  // A team address of this site (any host but GitHub's, or no host): /studio/<owner>/<repo>/...
  const site = /^(?:https?:\/\/([^/]+))?(\/studio\/.*)$/i.exec(text);
  const team = site && !GITHUB_HOST.test(site[1] ?? '') ? repoFromPath(site[2]!) : null;
  if (team) return { ok: true, ...team };
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/i.exec(text);
  if (ssh) {
    if (!GITHUB_HOST.test(ssh[1]!)) return { ok: false, error: 'not-github' };
    text = ssh[2]!;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return { ok: false, error: 'invalid' };
    }
    if (!GITHUB_HOST.test(url.hostname)) return { ok: false, error: 'not-github' };
    text = url.pathname;
  }
  const [owner, rawRepo] = text.split(/[?#]/)[0]!.split('/').filter(Boolean);
  if (!owner) return { ok: false, error: 'invalid' };
  if (!rawRepo) return OWNER.test(owner) ? { ok: false, error: 'no-repo' } : { ok: false, error: 'invalid' };
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return { ok: false, error: 'invalid' };
  return { ok: true, owner, repo };
}

/**
 * Paths a team address can never take, read from the built site (astro.config.mjs, bridge-team-shells, writes them to
 * /team-shell/reserved.json): every first segment under /studio/ and every first two segments of a real file there.
 * A team whose "owner/repo" is one of those pairs would get the Studio page instead of its own (static files win over
 * the rewrite), so it opens on the escape form.
 */
export interface ReservedPaths {
  /** First segments under /studio/ ('changes', 'components', 'versions', ...). */
  firsts: string[];
  /** "first/second" segments of a real file or folder under /studio/ ('brands/new', 'components/docs', ...). */
  pairs: string[];
}

/** Where the build writes ReservedPaths. Outside /studio/, so it reserves nothing itself. */
export const RESERVED_PATHS_URL = '/team-shell/reserved.json';

/** ReservedPaths from the files of the built site under studio/ (paths relative to that folder, '/' separated). */
export function reservedFromFiles(files: readonly string[]): ReservedPaths {
  const firsts = new Set<string>();
  const pairs = new Set<string>();
  for (const file of files) {
    const [a, b] = file.split('/').filter(Boolean);
    if (!a) continue;
    if (b) {
      firsts.add(a);
      pairs.add(`${a}/${b}`);
    } else if (a !== 'index.html') firsts.add(a);
  }
  return { firsts: [...firsts].sort(), pairs: [...pairs].sort() };
}

/** True when a Studio file shadows the team "owner/repo" (case-insensitive: GitHub names are). */
export function isReservedTeam(owner: string, repo: string, reserved: ReservedPaths): boolean {
  const pair = `${owner}/${repo}`.toLowerCase();
  return reserved.pairs.some((p) => p.toLowerCase() === pair);
}

/**
 * The Studio address of a team: /studio/<owner>/<repo>/, or the escape form /studio/~/<owner>/<repo>/ when a Studio
 * file takes that pair. Without the reserved list (it failed to load), the escape form, which always works.
 */
export function teamHref(owner: string, repo: string, reserved: ReservedPaths | null): string {
  const escaped = !reserved || isReservedTeam(owner, repo, reserved);
  return `${STUDIO_ROOT}${escaped ? '~/' : ''}${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`;
}
