// Library team shells (multi-team plan, Phase 4 / PR 4a): a team's published design system at
// /library/<owner>/<repo>/<route>. Built once, without any team data, at /library-shell/<route>; Vercel rewrites the
// team address to it (two rules, the trailing slash one first, as for Studio: lib/team-shells.ts). The page reads the
// team from the address in the browser and its data from the team's bridge-data snapshot (scripts/team-data.ts).
//
// Pure: astro.config.mjs (bridge-team-shells) checks the built site with checkLibraryShells after every build, and
// library-shells.test.ts checks vercel.json against libraryRewrites().
import { OWNER_PATTERN, REPO_PATTERN, isTeamName } from './team-path';

/** Where Bridge's own Library lives; a team's Library lives under it, at /library/<owner>/<repo>/. */
export const LIBRARY_ROOT = '/library/';

/** Where the Library shells are built. Not under a folder starting with "_": Astro does not build those. */
export const LIBRARY_SHELL_ROOT = '/library-shell/';

/** The Library routes a team has, relative to its Library root ('' is Home). Each has a shell page. */
export const LIBRARY_SHELL_ROUTES = ['', 'foundations/', 'components/', 'tokens/'] as const;

export type LibraryShellRoute = (typeof LIBRARY_SHELL_ROUTES)[number];

/** The marker a shell carries on <html data-library-shell="...">: its route without slashes ('home' for ''). */
export const libraryShellMarker = (route: string): string => route.replace(/\/$/, '').replace(/\//g, '-') || 'home';

/** The side nav of a team's Library: the same four places on every team, labelled as on Bridge's own Library. */
export const LIBRARY_TEAM_NAV: { route: LibraryShellRoute; label: string; icon: string; meta: string }[] = [
  { route: '', label: 'Home', icon: 'home', meta: 'What this design system holds and where to start' },
  { route: 'foundations/', label: 'Foundations', icon: 'layers', meta: 'Color, type, space, radius and shadow, drawn from the tokens' },
  { route: 'components/', label: 'Components', icon: 'diamonds', meta: 'Every component with its guidance and live stories' },
  { route: 'tokens/', label: 'Tokens', icon: 'grid', meta: 'Every token with its value per theme' },
];

const OWNER = new RegExp(`^${OWNER_PATTERN}$`);
const REPO = new RegExp(`^${REPO_PATTERN}$`);

/** Owner and repository from a Library team address, /library/<owner>/<repo>/...; null for any other path. */
export function libraryFromPath(pathname: string): { owner: string; repo: string } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== LIBRARY_ROOT.replace(/\//g, '') || !parts[1] || !parts[2]) return null;
  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(parts[1]);
    repo = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  return OWNER.test(owner) && REPO.test(repo) && isTeamName(owner, repo) ? { owner, repo } : null;
}

export type TeamPair = { owner: string; repo: string };

/**
 * The repository this site documents (bridge.config.json), whose Library is the site's own at /library/ and its
 * pages. Carried on <html data-own-library="owner/repo"> by the layout; null outside a browser or when absent.
 */
export function ownLibrary(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): TeamPair | null {
  const [owner, repo] = (doc?.documentElement.dataset.ownLibrary ?? '').split('/');
  return owner && repo ? { owner, repo } : null;
}

/** GitHub names are case-insensitive. */
export const sameTeam = (a: TeamPair, b: TeamPair | null | undefined): boolean =>
  Boolean(b) && a.owner.toLowerCase() === b!.owner.toLowerCase() && a.repo.toLowerCase() === b!.repo.toLowerCase();

/**
 * The page of the site's own Library that stands for a team Library route: the same Library for every visitor of
 * that team (guest, GitHub or email). Foundations opens on Color (the own Library has a page per foundation), a
 * component (?c=button) on its page, anything else on the Library home.
 */
export function ownLibraryPath(route = ''): string {
  const [path = '', query = ''] = route.replace(/^\/+/, '').split(/[?#]/);
  const p = path.replace(/\/?$/, '/');
  if (p === 'components/') {
    const slug = new URLSearchParams(query).get('c');
    return slug && /^[a-z0-9][a-z0-9-]*$/i.test(slug) ? `/components/${slug.toLowerCase()}/` : '/components/';
  }
  if (p === 'foundations/') return '/foundations/color/';
  if (p === 'tokens/') return '/tokens/';
  return LIBRARY_ROOT;
}

/**
 * The Library address of a team, at `route` ('' is Home; a query or hash may follow the route). The repository this
 * site documents (`own`) has one Library, the site's own: its address is that page, whoever asks.
 */
export const libraryHref = (owner: string, repo: string, route = '', own: TeamPair | null = ownLibrary()): string =>
  sameTeam({ owner, repo }, own) ? ownLibraryPath(route) : `${LIBRARY_ROOT}${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${route.replace(/^\/+/, '')}`;

/**
 * The redirects vercel.json carries ahead of the team rewrites: the team address of the repository this site documents
 * goes to the site's own Library (ownLibraryPath), so its readers never land on the generic team shell.
 */
export function ownLibraryRedirects(own: TeamPair): { source: string; destination: string; permanent: false; has?: { type: 'query'; key: string; value: string }[] }[] {
  const base = `${LIBRARY_ROOT}${own.owner}/${own.repo}`;
  // Two rules per address, the trailing slash one first, as for the rewrites (`:path*` does not match it).
  const pair = (path: string, destination: string) => [
    { source: `${base}${path}/`, destination, permanent: false as const },
    { source: `${base}${path}`, destination, permanent: false as const },
  ];
  return [
    { source: `${base}/components/`, has: [{ type: 'query', key: 'c', value: '(?<slug>[a-z0-9][a-z0-9-]*)' }], destination: '/components/:slug/', permanent: false },
    ...pair('/components', '/components/'),
    ...pair('/foundations', '/foundations/color/'),
    ...pair('/tokens', '/tokens/'),
    ...pair('/:path*', LIBRARY_ROOT),
  ];
}

/** The route a shell page stands for, from its built path (/library-shell/tokens/ -> 'tokens/'). */
export const routeOfShell = (path: string): string => (path.startsWith(LIBRARY_SHELL_ROOT) ? path.slice(LIBRARY_SHELL_ROOT.length).replace(/\/?$/, '/').replace(/^\/$/, '') : '');

const shell = LIBRARY_SHELL_ROOT.replace(/\/$/, '');
const team = `:owner(${OWNER_PATTERN})/:repo(${REPO_PATTERN})`;

/** The rewrites vercel.json carries for team Libraries: the trailing slash rule first (`:path*` does not match it). */
export function libraryRewrites(): { source: string; destination: string }[] {
  const base = `${LIBRARY_ROOT}${team}`;
  return [
    { source: `${base}/:path*/`, destination: `${shell}/:path*/` },
    { source: `${base}/:path*`, destination: `${shell}/:path*` },
  ];
}

/** Problems with the public Library allow-list (hosted/public-libraries.json): each entry an "owner/repo" pair, once. */
export function publicLibraryProblems(list: unknown): string[] {
  if (!Array.isArray(list)) return ['"libraries" must be an array of "owner/repo" strings.'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const [owner, repo, extra] = typeof entry === 'string' ? entry.split('/') : [];
    if (!owner || !repo || extra !== undefined || !isTeamName(owner, repo)) problems.push(`${JSON.stringify(entry)} is not an "owner/repo" pair GitHub accepts.`);
    else if (seen.has(entry.toLowerCase())) problems.push(`${entry} is listed twice.`);
    else seen.add(entry.toLowerCase());
  }
  return problems;
}

// Owner and repository names only hold letters, digits, '-', '_' and '.', so '.' is the one regex character to escape.
const escapeRegex = (s: string) => s.replace(/\./g, '\\.');

/**
 * Header rule sources that answer X-Robots-Tag: noindex for team Libraries. The shells are never indexed. Every team
 * Library address is noindex too, except the teams in the allow-list (hosted/public-libraries.json): their pair is
 * excluded by a lookahead on the owner group, so no rule matches them and the page decides (library.public). Two
 * rules per address, the trailing slash one first, as for the rewrites. Vercel matches headers on the address
 * requested, before the rewrite, so the shell rule never reaches a team address.
 */
export function libraryNoindexSources(publicLibraries: readonly string[] = []): string[] {
  const pairs = [...new Set(publicLibraries)].sort().map((p) => escapeRegex(p));
  const owner = pairs.length ? `(?!(?:${pairs.join('|')})(?:/|$))${OWNER_PATTERN}` : OWNER_PATTERN;
  const base = `${LIBRARY_ROOT}:owner(${owner})/:repo(${REPO_PATTERN})`;
  return [`${shell}/(.*)`, `${base}/:path*/`, `${base}/:path*`];
}

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
const NOINDEX = { key: 'X-Robots-Tag', value: 'noindex' };

/**
 * What is wrong with the Library noindex rules of vercel.json against the allow-list: a missing rule, or a stale one
 * (a team Library rule that the allow-list no longer implies). The build and library-shells.test.ts both run it.
 */
export function checkLibraryHeaders(headers: readonly HeaderRule[], publicLibraries: unknown): string[] {
  const problems = publicLibraryProblems(publicLibraries);
  if (problems.length) return problems.map((p) => `hosted/public-libraries.json: ${p}`);
  const want = libraryNoindexSources(publicLibraries as string[]);
  const missing = want.filter((source) => !headers.some((h) => h.source === source && h.headers.some((x) => x.key === NOINDEX.key && x.value === NOINDEX.value)));
  const stale = headers.filter((h) => h.source.startsWith(`${LIBRARY_ROOT}:owner`) && !want.includes(h.source));
  if (!missing.length && !stale.length) return [];
  const rules = want.map((source) => `    ${JSON.stringify({ source, headers: [NOINDEX] })}`).join(',\n');
  return [`vercel.json does not carry the Library noindex rules of hosted/public-libraries.json${stale.length ? ` (remove ${stale.map((h) => h.source).join(', ')})` : ''}. Its Library header rules must be:\n${rules}`];
}

const htmlTag = (html: string) => /<html\b[^>]*>/i.exec(html)?.[0] ?? '';

/**
 * What is wrong with a built site for team Libraries. `files` are dist-relative ('library-shell/tokens/index.html');
 * `read` returns a page's HTML. Each problem is one sentence that says what to fix.
 */
export function checkLibraryShells(files: readonly string[], read: (file: string) => string): string[] {
  const problems: string[] = [];
  const all = new Set(files);
  const shellDir = LIBRARY_SHELL_ROOT.slice(1);
  const libDir = LIBRARY_ROOT.slice(1);
  const routes = new Set<string>(LIBRARY_SHELL_ROUTES);

  // 1. Each route has its shell.
  for (const route of LIBRARY_SHELL_ROUTES) {
    if (!all.has(`${shellDir}${route}index.html`)) problems.push(`Library route "${route}" has no shell: add src/pages${LIBRARY_SHELL_ROOT}${route}index.astro.`);
  }

  for (const file of files) {
    // 2. Nothing under /library/ deeper than one folder: a real file at /library/<a>/<b>/ would take the address of
    //    the team "a/b" (static files win over the rewrite), and the Library has no escape form.
    if (file.startsWith(libDir)) {
      const parts = file.slice(libDir.length).split('/');
      const [a, b] = parts;
      // library/<a>/index.html is the page /library/<a>/ (one segment, not a team); anything deeper takes a pair.
      if (a && b && (parts.length > 2 || b !== 'index.html') && isTeamName(a, b)) problems.push(`${file} takes the Library address of the team "${a}/${b}": move it out of ${LIBRARY_ROOT}<owner>/<repo>/.`);
    }
    if (!file.endsWith('.html')) continue;
    // 3. Shells: known route, with their marker, never data-hosted (that is Studio's flag).
    if (file.startsWith(shellDir)) {
      const route = file.slice(shellDir.length).replace(/index\.html$/, '');
      const tag = htmlTag(read(file));
      if (!routes.has(route)) problems.push(`${file} is a Library shell for no route in LIBRARY_SHELL_ROUTES.`);
      if (!new RegExp(`data-library-shell="${libraryShellMarker(route)}"`).test(tag)) problems.push(`${file} lacks <html data-library-shell="${libraryShellMarker(route)}">: build it with <Layout library>.`);
      if (/\sdata-hosted[\s>=]/.test(tag)) problems.push(`${file} carries data-hosted: a Library shell is not a Studio shell.`);
    }
  }
  return [...new Set(problems)];
}
