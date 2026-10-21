// @vitest-environment jsdom
// The build-time Studio links of a team shell follow the team in the address; nothing changes elsewhere.
import { afterEach, describe, expect, it } from 'vitest';
import { fillTeamShell, pointLinksAtTeam } from './team-links';

const page = (path: string, hosted: boolean) => {
  document.documentElement.toggleAttribute('data-hosted', hosted);
  history.replaceState(null, '', path);
  document.body.innerHTML = `
    <a id="home" href="/studio/">Home</a>
    <a id="pr" href="/studio/changes/?pr=12">PR</a>
    <a id="brand" href="/studio/brands/new/">New brand</a>
    <a id="cb" href="/studio/auth/callback/">Callback</a>
    <a id="lib" href="/library/">Library</a>
    <a id="libopen" class="lib-open" href="/library/">Library</a>
    <a id="island" href="/studio/acme/ds/quality/">Quality</a>
    <a id="demo" href="/studio/tokens/" data-demo-link>Demo</a>
    <span data-team-name>owner/repo</span>
    <a id="gh" href="https://github.com/" data-team-github>GitHub</a>`;
};
const href = (id: string) => document.getElementById(id)!.getAttribute('href');

describe('pointLinksAtTeam', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-hosted');
    history.replaceState(null, '', '/');
  });

  it('keeps the team on every build-time Studio link of a team shell', () => {
    page('/studio/acme/ds/tokens/', true);
    expect(pointLinksAtTeam()).toBe(3);
    expect(href('home')).toBe('/studio/acme/ds/');
    expect(href('pr')).toBe('/studio/acme/ds/changes/?pr=12');
    expect(href('brand')).toBe('/studio/acme/ds/brands/new/');
    expect(href('cb')).toBe('/studio/auth/callback/');
    expect(href('lib')).toBe('/library/');
    // The header's Library button opens the team's Library.
    expect(href('libopen')).toBe('/library/acme/ds/');
    expect(href('island')).toBe('/studio/acme/ds/quality/');
    expect(href('demo')).toBe('/studio/tokens/');
    // Twice is the same as once.
    expect(pointLinksAtTeam()).toBe(0);
  });

  it('uses the escape form when the page is on it', () => {
    page('/studio/~/brands/new/', true);
    pointLinksAtTeam();
    expect(href('brand')).toBe('/studio/~/brands/new/brands/new/');
  });

  it('changes nothing in self-hosted mode', () => {
    page('/studio/tokens/', false);
    expect(pointLinksAtTeam()).toBe(0);
    page('/studio/acme/ds/', false);
    expect(pointLinksAtTeam()).toBe(0);
    expect(href('pr')).toBe('/studio/changes/?pr=12');
    expect(href('libopen')).toBe('/library/');
  });

  it('names the team and links its repository on the empty state', () => {
    page('/studio/~/brands/new/changes/', true);
    fillTeamShell();
    expect(document.querySelector('[data-team-name]')!.textContent).toBe('brands/new');
    expect(href('gh')).toBe('https://github.com/brands/new');
  });
});
