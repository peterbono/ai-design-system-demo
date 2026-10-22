// A team's Library (multi-team PR 4a): vercel.json rewrites /library/<owner>/<repo>/... to the Library shells and never
// indexes the shells themselves; the address names the team; the build check catches a missing or malformed shell and
// any file that would take a team's Library address.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FOUNDATIONS } from './nav';
import { checkLibraryHeaders, checkLibraryShells, LIBRARY_FOUNDATION_PAGES, LIBRARY_SHELL_ROUTES, LIBRARY_TEAM_NAV, libraryTeamPages, libraryFromPath, libraryHref, libraryNoindexSources, libraryRedirects, libraryRewrites, libraryShellMarker, ownLibrary, ownLibraryPath, ownLibraryRedirects, publicLibraryProblems, routeOfShell } from './library-shells';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  redirects: { source: string; destination: string; permanent: boolean }[];
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const publicLibraries = (JSON.parse(readFileSync(new URL('../../hosted/public-libraries.json', import.meta.url), 'utf8')) as { libraries: string[] }).libraries;

// The repository this site documents (bridge.config.json): its Library is the site's own, for every visitor.
const siteConfig = JSON.parse(readFileSync(new URL('../../../../bridge.config.json', import.meta.url), 'utf8')) as { repo: { owner: string; name: string } };
const own = { owner: siteConfig.repo.owner, repo: siteConfig.repo.name };

describe('vercel.json', () => {
  it('sends the team address of the site\'s own repository to the site\'s own Library, ahead of the rewrites', () => {
    expect(vercel.redirects).toEqual([...ownLibraryRedirects(own), ...libraryRedirects()]);
  });

  it('sends a component link from before component pages had their own address to that address', () => {
    const [slash, bare] = libraryRedirects();
    expect(slash).toMatchObject({ destination: '/library/:owner/:repo/components/:slug/', has: [{ type: 'query', key: 'c' }] });
    expect(slash!.source.endsWith('/components/')).toBe(true);
    expect(bare!.source.endsWith('/components')).toBe(true);
  });

  it('rewrites team Library addresses to the shells, the trailing slash rule first', () => {
    const rules = libraryRewrites();
    for (const r of rules) expect(vercel.rewrites).toContainEqual(r);
    const at = (source: string) => vercel.rewrites.findIndex((r) => r.source === source);
    for (let i = 1; i < rules.length; i++) expect(at(rules[i - 1]!.source)).toBeLessThan(at(rules[i]!.source));
    // One shell for every component page, ahead of the route rules; the trailing slash rule first each time.
    expect(rules.slice(0, 2).map((r) => r.destination)).toEqual(['/library-shell/components/item/', '/library-shell/components/item/']);
    expect(rules[0]!.source.endsWith('/')).toBe(true);
    expect(rules[2]!.source.endsWith('/:path*/')).toBe(true);
    const item = new RegExp(`^${rules[0]!.source.replace(/:(owner|repo|slug)\(([^)]+)\)/g, '($2)').replace(/\./g, '\\.')}$`);
    expect(item.test('/library/acme/ds/components/button/')).toBe(true);
    expect(item.test('/library/acme/ds/components/')).toBe(false);
    expect(item.test('/library/acme/ds/components/button/x/')).toBe(false);
  });

  it('never indexes the shells, nor a team Library outside the allow-list (hosted/public-libraries.json)', () => {
    expect(publicLibraryProblems(publicLibraries)).toEqual([]);
    for (const source of libraryNoindexSources(publicLibraries)) {
      expect(vercel.headers.find((h) => h.source === source)?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
    }
    expect(checkLibraryHeaders(vercel.headers, publicLibraries)).toEqual([]);
  });

  it('leaves Bridge\'s own Library home alone: one segment is not a team', () => {
    const owner = new RegExp(`^${/:owner\(([^)]+)\)/.exec(libraryRewrites()[1]!.source)![1]}$`);
    expect(owner.test('acme')).toBe(true);
    expect(owner.test('-acme')).toBe(false);
  });
});

// What Vercel does with a header source (path-to-regexp 6, as @vercel/routing-utils), for the cases below.
function sourceRegex(source: string): RegExp {
  const body = source
    .replace(/\/:path\*/, '(?:/[^/]+?(?:/[^/]+?)*)?')
    .replace(/\/:(?:owner|repo)\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, '/(?:$1)')
    .replace('(.*)', '.*');
  return new RegExp(`^${body}$`, 'i');
}
const noindexed = (path: string, list: string[]) => libraryNoindexSources(list).some((s) => sourceRegex(s).test(path));

describe('public Library allow-list', () => {
  it('noindexes every team Library and the shells when the list is empty', () => {
    for (const p of ['/library/acme/ds/', '/library/acme/ds', '/library/acme/ds/tokens/', '/library/acme/ds.v2/components', '/library-shell/', '/library-shell/tokens/']) expect(noindexed(p, []), p).toBe(true);
    expect(noindexed('/library/', [])).toBe(false);
  });

  it('leaves out exactly the listed pairs, on every route and slash form', () => {
    const list = ['acme/ds', 'peterbono/ai-design-system-demo'];
    for (const p of ['/library/acme/ds/', '/library/acme/ds', '/library/acme/ds/tokens/', '/library/acme/ds/components?c=x', '/library/peterbono/ai-design-system-demo/foundations/']) expect(noindexed(p.replace(/\?.*$/, ''), list), p).toBe(false);
    for (const p of ['/library/acme/ds2/', '/library/acme/dsx/tokens', '/library/acme/d/', '/library/acme-x/ds/', '/library/other/ds/', '/library-shell/']) expect(noindexed(p, list), p).toBe(true);
  });

  it('escapes the dot of a repository name', () => {
    expect(noindexed('/library/acme/ds.v2/', ['acme/ds.v2'])).toBe(false);
    expect(noindexed('/library/acme/dsxv2/', ['acme/ds.v2'])).toBe(true);
  });

  it('refuses entries that are not owner/repo pairs, and duplicates', () => {
    expect(publicLibraryProblems(['acme/ds', 'ACME/ds', '-bad/ds', 'acme', 'a/b/c', 3])).toEqual([
      'ACME/ds is listed twice.',
      '"-bad/ds" is not an "owner/repo" pair GitHub accepts.',
      '"acme" is not an "owner/repo" pair GitHub accepts.',
      '"a/b/c" is not an "owner/repo" pair GitHub accepts.',
      '3 is not an "owner/repo" pair GitHub accepts.',
    ]);
    expect(publicLibraryProblems({})).toHaveLength(1);
  });

  it('names the rules to paste when vercel.json falls behind the list', () => {
    const [problem] = checkLibraryHeaders(vercel.headers, ['acme/ds']);
    expect(problem).toContain('(?!(?:acme/ds)(?:/|$))');
    expect(problem).toContain('remove /library/:owner(');
    expect(checkLibraryHeaders(vercel.headers, ['nope'])[0]).toContain('hosted/public-libraries.json');
  });
});

describe('addresses', () => {
  it('reads the team from a Library address only', () => {
    expect(libraryFromPath('/library/acme/ds/')).toEqual({ owner: 'acme', repo: 'ds' });
    expect(libraryFromPath('/library/acme/ds.v2/components/')).toEqual({ owner: 'acme', repo: 'ds.v2' });
    expect(libraryFromPath('/library/acme/ds')).toEqual({ owner: 'acme', repo: 'ds' });
    expect(libraryFromPath('/library/')).toBeNull();
    expect(libraryFromPath('/library/acme/')).toBeNull();
    expect(libraryFromPath('/library/-bad/ds/')).toBeNull();
    expect(libraryFromPath('/library/acme/../')).toBeNull();
    expect(libraryFromPath('/library/acme/%E0%A4%A/')).toBeNull();
    expect(libraryFromPath('/studio/acme/ds/')).toBeNull();
  });

  it('builds team Library links', () => {
    expect(libraryHref('acme', 'ds')).toBe('/library/acme/ds/');
    expect(libraryHref('acme', 'ds', 'components/button/')).toBe('/library/acme/ds/components/button/');
    expect(libraryHref('acme', 'ds', '/tokens/')).toBe('/library/acme/ds/tokens/');
  });

  it('maps a shell path to its route and marker', () => {
    expect(routeOfShell('/library-shell/')).toBe('');
    expect(routeOfShell('/library-shell/tokens/')).toBe('tokens/');
    expect(routeOfShell('/library-shell/tokens')).toBe('tokens/');
    expect(libraryShellMarker('')).toBe('home');
    expect(libraryShellMarker('components/')).toBe('components');
    expect(libraryShellMarker('components/item/')).toBe('components-item');
  });

  it('gives every nav page a shell route, with the same Foundations pages as the own Library', () => {
    const pages = libraryTeamPages().map((p) => p.route);
    for (const r of pages) expect(LIBRARY_SHELL_ROUTES).toContain(r);
    expect(LIBRARY_TEAM_NAV.map((e) => e.label)).toEqual(['Home', 'Foundations', 'Components']);
    expect(FOUNDATIONS.map((f) => f.href)).toEqual(LIBRARY_FOUNDATION_PAGES.map((p) => `/${p.route}`));
    expect(pages).toContain('foundations/accessibility/');
  });
});

describe('checkLibraryShells', () => {
  const shell = (route: string) => `<html lang="en" data-library-shell="${libraryShellMarker(route)}">`;
  const site = (): Record<string, string> => {
    const files: Record<string, string> = { 'library/index.html': '<html lang="en">' };
    for (const r of LIBRARY_SHELL_ROUTES) files[`library-shell/${r}index.html`] = shell(r);
    return files;
  };
  const check = (files: Record<string, string>) => checkLibraryShells(Object.keys(files), (f) => files[f]!);

  it('passes a complete site', () => {
    expect(check(site())).toEqual([]);
  });

  it('fails on a missing or malformed shell', () => {
    const files = site();
    delete files['library-shell/tokens/index.html'];
    files['library-shell/components/index.html'] = '<html lang="en" data-hosted data-library-shell="components">';
    files['library-shell/foundations/index.html'] = '<html lang="en">';
    files['library-shell/nope/index.html'] = shell('nope/');
    const problems = check(files).join('\n');
    expect(problems).toContain('Library route "tokens/" has no shell');
    expect(problems).toContain('library-shell/components/index.html carries data-hosted');
    expect(problems).toContain('library-shell/foundations/index.html lacks <html data-library-shell="foundations">');
    expect(problems).toContain('library-shell/nope/index.html is a Library shell for no route');
  });

  it('fails when a file would take a team\'s Library address', () => {
    const files = { ...site(), 'library/acme/ds/index.html': '<html lang="en">', 'library/old/index.html': '<html lang="en">' };
    const problems = check(files);
    expect(problems).toEqual(['library/acme/ds/index.html takes the Library address of the team "acme/ds": move it out of /library/<owner>/<repo>/.']);
  });
});

describe('the site\'s own Library', () => {
  const doc = (attr?: string) => ({ documentElement: { dataset: attr ? { ownLibrary: attr } : {} } }) as unknown as Document;

  it('reads the repository from <html data-own-library>', () => {
    expect(ownLibrary(doc('peterbono/ai-design-system-demo'))).toEqual({ owner: 'peterbono', repo: 'ai-design-system-demo' });
    expect(ownLibrary(doc())).toBeNull();
  });

  it('links the own repository to the rich Library, whoever builds the link, and other teams to their shell', () => {
    expect(libraryHref(own.owner, own.repo, '', own)).toBe('/library/');
    expect(libraryHref(own.owner.toUpperCase(), own.repo, 'foundations/', own)).toBe('/foundations/color/');
    expect(libraryHref(own.owner, own.repo, 'components/?c=Button', own)).toBe('/components/button/');
    expect(libraryHref(own.owner, own.repo, 'components/', own)).toBe('/components/');
    expect(libraryHref(own.owner, own.repo, 'components/button/', own)).toBe('/components/button/');
    expect(libraryHref(own.owner, own.repo, 'components/button/#tokens', own)).toBe('/components/button/#tokens');
    expect(libraryHref(own.owner, own.repo, 'tokens/', own)).toBe('/tokens/');
    expect(libraryHref(own.owner, own.repo, 'foundations/radius/', own)).toBe('/foundations/radius/');
    expect(libraryHref(own.owner, own.repo, 'foundations/color/#focus-ring-color', own)).toBe('/foundations/color/#focus-ring-color');
    expect(libraryHref('acme', 'ds', 'tokens/', own)).toBe('/library/acme/ds/tokens/');
    expect(libraryHref('acme', 'ds', '', null)).toBe('/library/acme/ds/');
  });

  it('maps unknown routes and bad slugs to a page that exists', () => {
    expect(ownLibraryPath('nope/')).toBe('/library/');
    expect(ownLibraryPath('components/?c=../x')).toBe('/components/');
  });

  it('redirects every team route, the component query first and each trailing slash rule before its bare one', () => {
    const rules = ownLibraryRedirects({ owner: 'acme', repo: 'ds' });
    expect(rules[0]).toMatchObject({ source: '/library/acme/ds/components/', destination: '/components/:slug/', has: [{ type: 'query', key: 'c' }] });
    const dest = (source: string) => rules.find((r) => r.source === source && !r.has)?.destination;
    expect(dest('/library/acme/ds/foundations/')).toBe('/foundations/color/');
    expect(dest('/library/acme/ds/tokens')).toBe('/tokens/');
    expect(dest('/library/acme/ds/components/:slug([A-Za-z0-9][A-Za-z0-9-]*)/')).toBe('/components/:slug/');
    expect(dest('/library/acme/ds/foundations/typography/')).toBe('/foundations/typography/');
    expect(dest('/library/acme/ds/:path*/')).toBe('/library/');
    expect(rules.every((r) => r.permanent === false)).toBe(true);
    expect(rules.findIndex((r) => r.source.endsWith(':path*/'))).toBeLessThan(rules.findIndex((r) => r.source.endsWith(':path*')));
  });
});
