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

/** The Library address of a team, at `route` ('' is Home; a query or hash may follow the route). */
export const libraryHref = (owner: string, repo: string, route = ''): string => `${LIBRARY_ROOT}${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${route.replace(/^\/+/, '')}`;

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

/** The shells themselves are never indexed (a team's address decides in the page, with library.public). */
export const libraryNoindexSources = (): string[] => [`${shell}/(.*)`];

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
