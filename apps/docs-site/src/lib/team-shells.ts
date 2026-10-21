// Team shells (multi-team plan 4.1, amended by the Phase 0 spike): every Studio page is built a second time, without
// any build-time team data, at /team-shell/<route>. Vercel rewrites /studio/<owner>/<repo>/<route> (and the escape
// form /studio/~/<owner>/<repo>/<route>) to it when no real file answers, since static files win over rewrites. The
// page reads the team from the address in the browser (lib/team-path.ts).
//
// Pure: astro.config.mjs (bridge-team-shells) checks the built site with these after every build, and
// team-shells.test.ts checks vercel.json against vercelRewrites().
import { isTeamName, OWNER_PATTERN, REPO_PATTERN, STUDIO_ROOT } from './team-path';

/** Where the shells are built. Not under a folder starting with "_": Astro does not build those. */
export const TEAM_SHELL_ROOT = '/team-shell/';

/** The Studio routes a team can open, relative to the Studio root ('' is Home). Each has a shell page. */
export const TEAM_SHELL_ROUTES = ['', 'changes/', 'review/', 'tokens/', 'components/', 'components/storybook/', 'quality/', 'settings/', 'brands/new/'] as const;

export type TeamShellRoute = (typeof TEAM_SHELL_ROUTES)[number];

/** The marker a shell carries on <html data-shell="...">: its route without slashes ('home' for ''). */
export const shellMarker = (route: string): string => route.replace(/\/$/, '').replace(/\//g, '-') || 'home';

/** The Studio address a shell page stands for: /team-shell/tokens/ -> /studio/tokens/. Other paths unchanged. */
export const studioPathOfShell = (path: string): string => (path.startsWith(TEAM_SHELL_ROOT) ? STUDIO_ROOT + path.slice(TEAM_SHELL_ROOT.length) : path);

const shell = TEAM_SHELL_ROOT.replace(/\/$/, '');
const team = `:owner(${OWNER_PATTERN})/:repo(${REPO_PATTERN})`;
const studio = STUDIO_ROOT.replace(/\/$/, '');

/**
 * The rewrites vercel.json must carry: two rules per address form, the trailing slash one first (`:path*` does not
 * match a trailing slash, spike 1.3), the escape form before the plain one.
 */
export function vercelRewrites(): { source: string; destination: string }[] {
  return [`${studio}/~/${team}`, `${studio}/${team}`].flatMap((base) => [
    { source: `${base}/:path*/`, destination: `${shell}/:path*/` },
    { source: `${base}/:path*`, destination: `${shell}/:path*` },
  ]);
}

/** Header rule sources that must answer X-Robots-Tag: noindex: every team address, and the shells themselves. */
export function noindexSources(): string[] {
  return [...vercelRewrites().map((r) => r.source), `${shell}/(.*)`];
}

/** A built page's <html> start tag. */
const htmlTag = (html: string) => /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
const hasAttr = (tag: string, name: string) => new RegExp(`\\s${name}(?:\\s|=|>|/)`, 'i').test(tag);

/** Every root-relative /studio/... href in a page. */
export function studioLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\shref\s*=\s*["'](\/studio\/[^"'#?]*)/gi)) out.push(m[1]!);
  return out;
}

/**
 * What is wrong with a built site for team addresses. `files` are dist-relative ('studio/changes/index.html');
 * `read` returns a page's HTML. Each problem is one sentence that says what to fix.
 */
export function checkTeamShells(files: readonly string[], read: (file: string) => string): string[] {
  const problems: string[] = [];
  const all = new Set(files);
  const shellDir = TEAM_SHELL_ROOT.slice(1);
  const studioDir = STUDIO_ROOT.slice(1);
  const routes = new Set<string>(TEAM_SHELL_ROUTES);

  // 1. Each route has its Studio page and its shell.
  for (const route of TEAM_SHELL_ROUTES) {
    if (!all.has(`${studioDir}${route}index.html`)) problems.push(`Team shell route "${route}" has no Studio page at ${STUDIO_ROOT}${route}: remove it from TEAM_SHELL_ROUTES.`);
    if (!all.has(`${shellDir}${route}index.html`)) problems.push(`Studio page ${STUDIO_ROOT}${route} has no team shell: add src/pages${TEAM_SHELL_ROOT}${route || 'index'}${route ? 'index' : ''}.astro.`);
  }

  for (const file of files) {
    if (!file.endsWith('.html')) continue;
    const html = read(file);
    const tag = htmlTag(html);
    if (file.startsWith(shellDir)) {
      // 2. Shells: known route, hosted, not indexed, with their marker.
      const route = file.slice(shellDir.length).replace(/index\.html$/, '');
      if (!routes.has(route)) problems.push(`${file} is a team shell for no route in TEAM_SHELL_ROUTES.`);
      if (!hasAttr(tag, 'data-hosted')) problems.push(`${file} lacks <html data-hosted>: build it with <Layout hosted>.`);
      if (!new RegExp(`data-shell="${shellMarker(route)}"`).test(tag)) problems.push(`${file} lacks <html data-shell="${shellMarker(route)}">.`);
      if (!/<meta name="robots" content="noindex"/i.test(html)) problems.push(`${file} lacks <meta name="robots" content="noindex">.`);
    } else if (file.startsWith(studioDir) && hasAttr(tag, 'data-hosted')) {
      problems.push(`${file} is a self-hosted Studio page but carries data-hosted.`);
    }

    // 3. A link to a Studio page that does not exist would not 404 once deployed: the rewrite turns it into a team
    //    shell for "owner/repo" = its first two segments. Fail here instead.
    for (const href of studioLinks(html)) {
      const rest = href.slice(STUDIO_ROOT.length);
      const [a, b] = rest.split('/');
      if (!a || !b || a === '~' || !isTeamName(a, b)) continue;
      const target = `${studioDir}${rest}`;
      if (all.has(target) || all.has(`${target.replace(/\/?$/, '/')}index.html`)) continue;
      problems.push(`${file} links to ${href}, which no page serves: once deployed it would open the team "${a}/${b}" instead of a 404.`);
    }
  }
  return [...new Set(problems)];
}
