// Team shells and their routing (multi-team plan 4.1, amended by the Phase 0 spike): vercel.json carries exactly the
// rewrites and noindex headers of team-shells.ts, every Studio nav page has a shell, and the build check catches a
// missing or malformed shell and a link the rewrite would turn into a team.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTeamShells, noindexSources, shellMarker, studioPathOfShell, TEAM_SHELL_ROUTES, vercelRewrites } from './team-shells';
import { studioNav } from './nav';
import { libraryRewrites } from './library-shells';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
  trailingSlash?: boolean;
};

describe('vercel.json', () => {
  it('rewrites team addresses to the shells: two rules per form, the trailing slash first', () => {
    // Studio's rules, then the team Library's (lib/library-shells.ts): no address matches both.
    // Then the Bridge connector's addresses (api/mcp: /mcp, OAuth and its /.well-known documents), which no team address matches.
    const shells = [...vercelRewrites(), ...libraryRewrites()];
    expect(vercel.rewrites?.slice(0, shells.length)).toEqual(shells);
    expect(vercel.rewrites?.slice(shells.length).every((r) => r.destination.startsWith('/api/mcp'))).toBe(true);
    expect(vercel.rewrites?.[0]?.source.endsWith('/:path*/')).toBe(true);
  });

  it('leaves trailingSlash unset (Vercel serves both spellings without a redirect)', () => {
    expect('trailingSlash' in vercel).toBe(false);
  });

  it('answers X-Robots-Tag: noindex on every team address and on the shells', () => {
    for (const source of noindexSources()) {
      const rule = vercel.headers.find((h) => h.source === source);
      expect(rule?.headers, source).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
    }
  });

  it('matches GitHub names only, and never the escape segment as an owner', () => {
    const plain = vercelRewrites()[3]!.source;
    const owner = new RegExp(`^${/:owner\(([^)]+)\)/.exec(plain)![1]}$`);
    expect(owner.test('acme')).toBe(true);
    expect(owner.test('~')).toBe(false);
    expect(owner.test('-acme')).toBe(false);
    expect(owner.test('a'.repeat(40))).toBe(false);
  });
});

describe('routes', () => {
  it('gives every Studio nav page a shell', () => {
    for (const entry of studioNav()) expect(TEAM_SHELL_ROUTES, entry.href).toContain(entry.href!.replace(/^\/studio\//, ''));
  });

  it('maps a shell to the Studio page it stands for', () => {
    expect(studioPathOfShell('/team-shell/')).toBe('/studio/');
    expect(studioPathOfShell('/team-shell/components/storybook/')).toBe('/studio/components/storybook/');
    expect(studioPathOfShell('/library/')).toBe('/library/');
    expect(shellMarker('')).toBe('home');
    expect(shellMarker('brands/new/')).toBe('brands-new');
  });
});

describe('checkTeamShells', () => {
  const shellHtml = (route: string) => `<html lang="en" data-hosted data-shell="${shellMarker(route)}"><head><meta name="robots" content="noindex"></head></html>`;
  const site = (): Record<string, string> => {
    const files: Record<string, string> = { 'studio/auth/callback/index.html': '<html lang="en">', 'studio/components/docs/button/index.html': '<html lang="en">' };
    for (const r of TEAM_SHELL_ROUTES) {
      files[`studio/${r}index.html`] = '<html lang="en"><a href="/studio/brands/new/">New</a><a href="/studio/components/docs/button/">Button</a>';
      files[`team-shell/${r}index.html`] = shellHtml(r);
    }
    return files;
  };
  const check = (files: Record<string, string>) => checkTeamShells(Object.keys(files), (f) => files[f]!);

  it('passes a complete site', () => {
    expect(check(site())).toEqual([]);
  });

  it('fails on a missing or malformed shell', () => {
    const files = site();
    delete files['team-shell/tokens/index.html'];
    files['team-shell/quality/index.html'] = '<html lang="en" data-shell="quality">';
    files['team-shell/nope/index.html'] = shellHtml('nope/');
    files['studio/changes/index.html'] = '<html lang="en" data-hosted>';
    const problems = check(files).join('\n');
    expect(problems).toContain('/studio/tokens/ has no team shell');
    expect(problems).toContain('team-shell/quality/index.html lacks <html data-hosted>');
    expect(problems).toContain('team-shell/quality/index.html lacks <meta name="robots"');
    expect(problems).toContain('team-shell/nope/index.html is a team shell for no route');
    expect(problems).toContain('studio/changes/index.html is a self-hosted Studio page but carries data-hosted');
  });

  it('fails on a link to a Studio path no file serves, which the rewrite would open as a team', () => {
    const files = site();
    files['studio/index.html'] += '<a href="/studio/quality/audits/gone/">Gone</a><a href="/studio/changes/?pr=1">PR</a><a href="/studio/~/x/y/">Esc</a>';
    expect(check(files)).toEqual([expect.stringContaining('links to /studio/quality/audits/gone/, which no page serves')]);
  });

  it('lets pages link to a demo team on a team shell route, not elsewhere', () => {
    const files = site();
    files['index.html'] = '<html><a href="/studio/peterbono/bridge-demo-ds/">Demo</a><a href="/studio/peterbono/bridge-demo-ds/nope/">Bad</a></html>';
    expect(check(files)).toEqual([expect.stringContaining('links to /studio/peterbono/bridge-demo-ds/nope/, which no page serves')]);
  });
});
