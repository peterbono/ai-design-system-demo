// @vitest-environment jsdom
// The Use pages (Install, Agents, How review works, Changelog) are functions of { model, team, extras }: Bridge's own
// pages render them at build time, a team's Library in the browser with what the team publishes. A team gets the same
// sections, minus what only Bridge's own build knows; its links stay in its Library and its Studio; no axe violation.
import '../../../../../../../packages/react/src/test/setup';
import { createElement, type ComponentType } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../../packages/react/src/test/axe';
import { repoModel } from '../../../../lib/model';
import { releases } from '../../../../lib/changelog';
import { bridgeTools, siteUseExtras } from '../../../../lib/library-use';
import type { LibraryData } from '../library-data';
import AgentsView from './AgentsView';
import ChangelogView from './ChangelogView';
import InstallView from './InstallView';
import ReviewView from './ReviewView';

const ownUse = siteUseExtras();
const own: LibraryData = { model: repoModel, team: null, extras: { releases: releases(), use: ownUse } };
const team: LibraryData = {
  model: repoModel,
  team: { owner: 'acme', repo: 'ds' },
  extras: {
    canEdit: true,
    releases: releases(),
    use: {
      bridge: bridgeTools(),
      packages: [
        { name: '@acme/react', version: '2.0.0' },
        { name: '@acme/tokens', version: '2.0.0' },
      ],
      llms: { text: ownUse.llms!.text, href: 'https://raw.githubusercontent.com/acme/ds/bridge-data/llms.txt' },
      governance: ownUse.governance!,
    },
  },
};
const VIEWS: [string, ComponentType<{ data: LibraryData }>][] = [
  ['Install', InstallView],
  ['Agents', AgentsView],
  ['How review works', ReviewView],
  ['Changelog', ChangelogView],
];
// What only Bridge's own build carries: its React setup, its pages without React.
const OWN_ONLY = ['H2 Use the components', 'H3 Pages without React'];

const draw = (view: ComponentType<{ data: LibraryData }>, data: LibraryData) => render(createElement(view, { data })).container;
const headings = (el: HTMLElement) => [...el.querySelectorAll('h1, h2, h3')].map((h) => `${h.tagName} ${h.textContent?.trim()}`);

describe('Use pages', () => {
  it.each(VIEWS)('%s: a team gets the same sections as Bridge', (_, view) => {
    const mine = headings(draw(view, own));
    expect(mine.length).toBeGreaterThan(1);
    expect(headings(draw(view, team))).toEqual(mine.filter((h) => !OWN_ONLY.includes(h)));
  });

  it.each(VIEWS)('%s: keeps a team in its Library and its Studio', (_, view) => {
    for (const a of draw(view, team).querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) expect(a.getAttribute('href')).toMatch(/^\/(library\/acme\/ds|studio\/~\/acme\/ds)\//);
  });

  it('installs the team\'s own packages and points the MCP server at its repository', () => {
    expect(draw(InstallView, team).textContent).toContain('npm install @acme/react @acme/tokens');
    expect(draw(AgentsView, team).textContent).toContain('--repo acme/ds');
  });

  it('says how to publish what a team has not published yet', () => {
    const bare: LibraryData = { ...team, extras: { canEdit: true, use: { bridge: bridgeTools(), llms: null, governance: {} } } };
    expect(draw(InstallView, bare).textContent).toContain('does not list its packages yet');
    expect(draw(AgentsView, bare).textContent).toContain('No llms.txt published yet');
    expect(draw(ChangelogView, bare).textContent).toContain('no release notes yet');
    // Without its own governance files, a team's review page reads its bridge.config.json governance.
    const review = draw(ReviewView, bare);
    expect(headings(review)).toEqual(expect.arrayContaining(['H2 Risk tiers', 'H2 Review gates', 'H2 Who approves by area', 'H2 Owner override']));
  });

  it.each(VIEWS)('%s: no axe violation', async (_, view) => {
    await expectNoAxeViolations(draw(view, team));
  });
});
