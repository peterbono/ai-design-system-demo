// @vitest-environment jsdom
// studioHref (multi-team plan, section 4.1): self-hosted and build-time addresses stay byte for byte what they were;
// a team shell keeps its team. The literal scan lives in no-studio-literals.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { studioBase, studioHref, studioHrefAt } from './team-path';

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
