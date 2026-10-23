// @vitest-environment jsdom
// studioHref (multi-team plan, section 4.1): self-hosted and build-time addresses stay byte for byte what they were;
// a team shell keeps its team. The literal scan lives in no-studio-literals.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalTeamPath, isReservedTeam, isTeamKey, isTeamName, pageTeamFromPath, parseTeamInput, reservedFromFiles, studioBase, studioHref, studioHrefAt, teamHref, teamKeyId, teamKeyOf } from './team-path';

describe('studioHref', () => {
  it('returns the self-hosted path unchanged outside a team shell (build time, no data-hosted)', () => {
    expect(studioHref()).toBe('/studio/');
    expect(studioHref('changes/?pr=12')).toBe('/studio/changes/?pr=12');
    expect(studioHref('?setup=library')).toBe('/studio/?setup=library');
    expect(studioHref('versions/data.json')).toBe('/studio/versions/data.json');
  });

  it('accepts a full self-hosted path (the nav.ts constants)', () => {
    expect(studioHref('/studio/')).toBe('/studio/');
    expect(studioHref('/studio')).toBe('/studio/');
    expect(studioHref('/studio/quality/')).toBe('/studio/quality/');
    expect(studioHref('/studio?x=1')).toBe('/studio/?x=1');
  });

  it('keeps the team on a team shell, in both address forms', () => {
    expect(studioBase('/studio/acme/ds/changes/', true)).toBe('/studio/acme/ds/');
    expect(studioBase('/studio/~/components/storybook/tokens/', true)).toBe('/studio/~/components/storybook/');
    expect(studioHrefAt(studioBase('/studio/acme/ds.v2/', true), 'changes/?pr=3')).toBe('/studio/acme/ds.v2/changes/?pr=3');
    expect(studioHrefAt(studioBase('/studio/acme/ds/tokens/', true), '/studio/quality/')).toBe('/studio/acme/ds/quality/');
  });

  it('stays on /studio/ when the page is not hosted or the address is not a team', () => {
    expect(studioBase('/studio/acme/ds/', false)).toBe('/studio/');
    expect(studioBase('/studio/changes/', true)).toBe('/studio/');
    expect(studioBase('/studio/-acme/ds/', true)).toBe('/studio/');
    expect(studioBase('/team-shell/changes/', true)).toBe('/studio/');
  });
});

describe('studioHref in the browser', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-hosted');
    history.replaceState(null, '', '/');
  });

  const at = (path: string, hosted: boolean) => {
    document.documentElement.toggleAttribute('data-hosted', hosted);
    history.replaceState(null, '', path);
  };

  it('keeps the team on a team shell', () => {
    at('/studio/acme/ds/tokens/', true);
    expect(studioHref()).toBe('/studio/acme/ds/');
    expect(studioHref('changes/?pr=12')).toBe('/studio/acme/ds/changes/?pr=12');
    expect(studioHref('/studio/settings/#roles')).toBe('/studio/acme/ds/settings/#roles');
    at('/studio/~/brands/new/changes/', true);
    expect(studioHref('quality/')).toBe('/studio/~/brands/new/quality/');
  });

  it('is unchanged in self-hosted mode, even on an address that looks like a team', () => {
    at('/studio/acme/ds/', false);
    expect(studioHref('changes/')).toBe('/studio/changes/');
    at('/studio/changes/', true);
    expect(studioHref('changes/')).toBe('/studio/changes/');
  });
});

describe('parseTeamInput (the launcher field)', () => {
  const ok = (owner: string, repo: string) => ({ ok: true, owner, repo });
  it('reads owner/repo and GitHub addresses in their usual spellings', () => {
    expect(parseTeamInput('acme/ds')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('  acme/ds/  ')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('https://github.com/acme/design-system')).toEqual(ok('acme', 'design-system'));
    expect(parseTeamInput('github.com/acme/ds.v2')).toEqual(ok('acme', 'ds.v2'));
    expect(parseTeamInput('www.github.com/acme/ds')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('https://github.com/acme/ds.git')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('https://github.com/acme/ds/tree/main/packages/tokens?x=1#y')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('git@github.com:acme/ds.git')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('ssh://git@github.com/acme/ds.git')).toEqual(ok('acme', 'ds'));
  });

  it('reads a team address of this site, in both forms', () => {
    expect(parseTeamInput('https://bridge.example.com/studio/acme/ds/tokens/')).toEqual(ok('acme', 'ds'));
    expect(parseTeamInput('/studio/~/brands/new/')).toEqual(ok('brands', 'new'));
    // On GitHub, /studio/ is an owner named "studio".
    expect(parseTeamInput('https://github.com/studio/kit')).toEqual(ok('studio', 'kit'));
  });

  it('says what is wrong otherwise', () => {
    expect(parseTeamInput('   ')).toEqual({ ok: false, error: 'empty' });
    expect(parseTeamInput('acme')).toEqual({ ok: false, error: 'no-repo' });
    expect(parseTeamInput('https://github.com/acme')).toEqual({ ok: false, error: 'no-repo' });
    expect(parseTeamInput('https://gitlab.com/acme/ds')).toEqual({ ok: false, error: 'not-github' });
    expect(parseTeamInput('git@gitlab.com:acme/ds.git')).toEqual({ ok: false, error: 'not-github' });
    expect(parseTeamInput('-acme/ds')).toEqual({ ok: false, error: 'invalid' });
    expect(parseTeamInput('acme/d s')).toEqual({ ok: false, error: 'invalid' });
    expect(parseTeamInput('acme/..')).toEqual({ ok: false, error: 'invalid' });
    expect(parseTeamInput('acme--x/<script>')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('teamHref and the reserved paths', () => {
  const reserved = reservedFromFiles(['index.html', 'changes/index.html', 'brands/new/index.html', 'components/docs/button/index.html', 'versions/data.json', 'library-files.json']);

  it('derives first segments and pairs from the built files', () => {
    expect(reserved.firsts).toEqual(['brands', 'changes', 'components', 'library-files.json', 'versions']);
    expect(reserved.pairs).toEqual(['brands/new', 'changes/index.html', 'components/docs', 'versions/data.json']);
  });

  it('opens a team on its own address, and on the escape form when a Studio file takes the pair', () => {
    expect(teamHref('acme', 'ds', reserved)).toBe('/studio/acme/ds/');
    expect(teamHref('brands', 'kit', reserved)).toBe('/studio/brands/kit/');
    expect(teamHref('brands', 'new', reserved)).toBe('/studio/~/brands/new/');
    expect(teamHref('Components', 'Docs', reserved)).toBe('/studio/~/Components/Docs/');
    expect(isReservedTeam('versions', 'data.json', reserved)).toBe(true);
  });

  it('falls back to the escape form without the list', () => {
    expect(teamHref('acme', 'ds', null)).toBe('/studio/~/acme/ds/');
  });
});

describe('pageTeamFromPath', () => {
  it('never guesses a team from a Studio page of this site', () => {
    expect(pageTeamFromPath('/studio/brands/new/', false)).toBeNull();
    expect(pageTeamFromPath('/studio/components/docs/', false)).toBeNull();
  });
  it('reads the team on a team shell, the escape form included', () => {
    expect(pageTeamFromPath('/studio/acme/ds/changes/', true)).toEqual({ owner: 'acme', repo: 'ds' });
    expect(pageTeamFromPath('/studio/~/brands/new/', true)).toEqual({ owner: 'brands', repo: 'new' });
describe('teams made in Bridge, no repository yet', () => {
  it('go by a key no GitHub owner can take, and open on the workspace page', () => {
    expect(teamKeyOf('C0FFEE0000000017')).toBe('_team/c0ffee0000000017');
    expect(teamKeyId('_team/c0ffee0000000017')).toBe('c0ffee0000000017');
    expect(isTeamKey('_team/c0ffee0000000017')).toBe(true);
    for (const k of ['acme/ds', '_team/short', 'team/c0ffee0000000017', '_team/c0ffee0000000017x']) expect(isTeamKey(k)).toBe(false);
    expect(isTeamName('_team', 'c0ffee0000000017')).toBe(false);
    expect(teamHref('_team', 'c0ffee0000000017', null)).toBe('/studio/workspace/?team=c0ffee0000000017');
  });
});

describe('canonicalTeamPath', () => {
  const reserved = { firsts: ['brands', 'changes'], pairs: ['brands/new'] };
  it('drops the escape when no Studio file takes the pair', () => {
    expect(canonicalTeamPath('/studio/~/acme/ds/tokens/', reserved)).toBe('/studio/acme/ds/tokens/');
  });
  it('keeps it for a reserved pair, an unknown list, a plain address or another page', () => {
    expect(canonicalTeamPath('/studio/~/brands/new/', reserved)).toBeNull();
    expect(canonicalTeamPath('/studio/~/acme/ds/', null)).toBeNull();
    expect(canonicalTeamPath('/studio/acme/ds/', reserved)).toBeNull();
    expect(canonicalTeamPath('/studio/changes/', reserved)).toBeNull();
  });
});
