// @vitest-environment jsdom
// The Library views (Foundations, All tokens, Home) are functions of a repo model: Bridge's own pages render them at
// build time, a team's Library in the browser. Same sections for both; a team's links stay in the team's Library and
// its Studio; no axe violation.
import '../../../../../../../packages/react/src/test/setup';
import { createElement, type ComponentType } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../../packages/react/src/test/axe';
import { repoModel } from '../../../../lib/model';
import { libraryLink, pageHref, studioLink, type LibraryData } from '../library-data';
import AccessibilityView from './AccessibilityView';
import AllTokensView from './AllTokensView';
import ColorView from './ColorView';
import ElevationView from './ElevationView';
import LandingView from './LandingView';
import RadiusView from './RadiusView';
import SpacingView from './SpacingView';
import TypographyView from './TypographyView';

const own: LibraryData = { model: repoModel, team: null, extras: {} };
const team: LibraryData = { model: repoModel, team: { owner: 'acme', repo: 'ds' }, extras: { canEdit: true } };
const VIEWS: [string, ComponentType<{ data: LibraryData }>][] = [
  ['Color', ColorView],
  ['Typography', TypographyView],
  ['Spacing', SpacingView],
  ['Radius', RadiusView],
  ['Elevation', ElevationView],
  ['Accessibility', AccessibilityView],
  ['All tokens', AllTokensView],
  ['Home', LandingView],
];

const draw = (view: ComponentType<{ data: LibraryData }>, data: LibraryData) => render(createElement(view, { data })).container;
const headings = (el: HTMLElement) => [...el.querySelectorAll('h1, h2, h3')].map((h) => `${h.tagName} ${h.textContent?.trim()}`);
// Bridge's own Accessibility page also says what every Bridge component guarantees: never claimed for a team's.
const OWN_ONLY = ['H2 What every component guarantees'];

describe('Library views', () => {
  it.each(VIEWS)('%s: a team gets the same sections as Bridge', (_, view) => {
    const mine = headings(draw(view, own));
    const theirs = headings(draw(view, team));
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.filter((h) => !h.startsWith('H1'))).toEqual(mine.filter((h) => !h.startsWith('H1') && !OWN_ONLY.includes(h)));
  });

  it.each(VIEWS.filter(([n]) => n !== 'Home' && n !== 'All tokens'))('%s: keeps a team in its Library and its Studio', (_, view) => {
    const el = draw(view, team);
    const edit = el.querySelector<HTMLAnchorElement>('.lib-studio a');
    expect(edit?.getAttribute('href')).toMatch(/^\/studio\/~\/acme\/ds\//);
    expect(el.querySelector('.lib-studio')?.hasAttribute('data-maintainer-only')).toBe(false);
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) expect(a.getAttribute('href')).toMatch(/^\/(library\/acme\/ds|studio\/~\/acme\/ds)\//);
  });

  it('shows Bridge\'s own Edit in Studio to maintainers only, and hides it from a signed-out team reader', () => {
    expect(draw(ColorView, own).querySelector('.lib-studio')?.hasAttribute('data-maintainer-only')).toBe(true);
    expect(draw(ColorView, { ...team, extras: { canEdit: false } }).querySelector('.lib-studio')).toBeNull();
  });

  it.each(VIEWS.filter(([n]) => n !== 'Color'))('%s: no axe violation', async (_, view) => {
    const el = draw(view, team);
    // All tokens: the page script fills the side panel with the first token on load (scripts/all-tokens.ts).
    const name = el.querySelector('[data-at-p-name]');
    if (name) name.textContent = '--color-bg-default';
    await expectNoAxeViolations(el);
  });
});

describe('library links', () => {
  it('points the own Library links at the team', () => {
    expect(pageHref(own, 'tokens/')).toBe('/tokens/');
    expect(pageHref(team, 'foundations/color/#focus-ring-color')).toBe('/library/acme/ds/foundations/color/#focus-ring-color');
    expect(libraryLink(team, '/components/button/')).toBe('/library/acme/ds/components/?c=button');
    expect(libraryLink(team, '/foundations/radius/#radius-control')).toBe('/library/acme/ds/foundations/radius/#radius-control');
    expect(libraryLink(team, 'https://example.com/')).toBe('https://example.com/');
    expect(libraryLink(own, '/components/button/')).toBe('/components/button/');
    expect(studioLink(own, 'quality/')).toBe('/studio/quality/');
    expect(studioLink(team, 'tokens/?focus=color')).toBe('/studio/~/acme/ds/tokens/?focus=color');
  });
});
