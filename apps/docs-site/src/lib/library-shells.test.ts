// A team's Library (multi-team PR 4a): vercel.json rewrites /library/<owner>/<repo>/... to the Library shells and never
// indexes the shells themselves; the address names the team; the build check catches a missing or malformed shell and
// any file that would take a team's Library address.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkLibraryShells, LIBRARY_SHELL_ROUTES, LIBRARY_TEAM_NAV, libraryFromPath, libraryHref, libraryNoindexSources, libraryRewrites, libraryShellMarker, routeOfShell } from './library-shells';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe('vercel.json', () => {
  it('rewrites team Library addresses to the shells, the trailing slash rule first', () => {
    const rules = libraryRewrites();
    expect(rules[0]!.source.endsWith('/:path*/')).toBe(true);
    for (const r of rules) expect(vercel.rewrites).toContainEqual(r);
    expect(vercel.rewrites.findIndex((r) => r.source === rules[0]!.source)).toBeLessThan(vercel.rewrites.findIndex((r) => r.source === rules[1]!.source));
  });

  it('never indexes the shells; team addresses decide in the page (library.public)', () => {
    for (const source of libraryNoindexSources()) {
      expect(vercel.headers.find((h) => h.source === source)?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
    }
    expect(vercel.headers.some((h) => h.source.startsWith('/library/:owner'))).toBe(false);
  });

  it('leaves Bridge\'s own Library home alone: one segment is not a team', () => {
    const owner = new RegExp(`^${/:owner\(([^)]+)\)/.exec(libraryRewrites()[1]!.source)![1]}$`);
    expect(owner.test('acme')).toBe(true);
    expect(owner.test('-acme')).toBe(false);
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
    expect(libraryHref('acme', 'ds', 'components/?c=button')).toBe('/library/acme/ds/components/?c=button');
    expect(libraryHref('acme', 'ds', '/tokens/')).toBe('/library/acme/ds/tokens/');
  });

  it('maps a shell path to its route and marker', () => {
    expect(routeOfShell('/library-shell/')).toBe('');
    expect(routeOfShell('/library-shell/tokens/')).toBe('tokens/');
    expect(routeOfShell('/library-shell/tokens')).toBe('tokens/');
    expect(libraryShellMarker('')).toBe('home');
    expect(libraryShellMarker('components/')).toBe('components');
  });

  it('gives every nav entry a shell route', () => {
    expect(LIBRARY_TEAM_NAV.map((e) => e.route)).toEqual([...LIBRARY_SHELL_ROUTES]);
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
