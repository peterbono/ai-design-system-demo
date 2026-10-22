// @vitest-environment jsdom
// The component pages (Components index, one component) are functions of a repo model: Bridge's own pages render them
// at build time, a team's Library in the browser. Same tabs and sections for both; previews from the Storybook; a
// team's links stay in its Library and its Studio; no axe violation.
import '../../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../../packages/react/src/test/axe';
import { repoModel } from '../../../../lib/model';
import { loadComponents } from '../../../../lib/library/components';
import type { LibraryData } from '../library-data';
import ComponentView from './ComponentView';
import ComponentsView from './ComponentsView';

const SB = 'https://storybook.example.com';
const own: LibraryData = { model: repoModel, team: null, extras: { storybook: SB, sourceBase: 'https://github.com/o/r/blob/main/' } };
const team: LibraryData = { model: repoModel, team: { owner: 'acme', repo: 'ds' }, extras: { canEdit: true, storybook: SB, sourceBase: 'https://github.com/acme/ds/blob/main/' } };
const button = loadComponents(repoModel).find((c) => c.name === 'Button')!;

const page = (data: LibraryData, c = button) => render(createElement(ComponentView, { data, component: c })).container;
const index = (data: LibraryData) => render(createElement(ComponentsView, { data })).container;
const headings = (el: HTMLElement) => [...el.querySelectorAll('h1, h2, h3')].map((h) => `${h.tagName} ${h.textContent?.trim()}`);

describe('component page', () => {
  it('gives a team the same tabs and sections as Bridge', () => {
    const mine = page(own);
    const theirs = page(team);
    expect([...theirs.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Usage', 'Tokens', 'Code', 'Changelog']);
    expect(headings(theirs)).toEqual(headings(mine));
    expect(headings(mine)).toEqual(expect.arrayContaining(['H2 Anatomy and tokens', 'H2 Motion and interaction', 'H2 Props', 'H2 Playground', 'H2 Changelog']));
  });

  it('previews the component with its story from the Storybook, in light and dark', () => {
    const frames = [...page(team).querySelectorAll<HTMLIFrameElement>('.hero-stage iframe')].map((f) => f.getAttribute('src'));
    expect(frames).toEqual([
      `${SB}/iframe.html?id=${button.stories[0]!.id}&viewMode=story&globals=theme:light`,
      `${SB}/iframe.html?id=${button.stories[0]!.id}&viewMode=story&globals=theme:dark`,
    ]);
  });

  it('says how to add a Storybook when the team has none', () => {
    const el = page({ ...team, extras: { canEdit: false } });
    expect(el.querySelector('.hero-stage')).toBeNull();
    expect(el.textContent).toContain('Set storybook.url in bridge.config.json');
  });

  it('keeps a team in its Library and its Studio', () => {
    const el = page(team);
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) expect(a.getAttribute('href')).toMatch(/^\/(library\/acme\/ds|studio\/~\/acme\/ds)\//);
    expect(el.querySelector<HTMLAnchorElement>('[data-le-edit]')?.getAttribute('href')).toBe('/studio/~/acme/ds/components/docs/button/');
    expect(page({ ...team, extras: { ...team.extras, canEdit: false } }).querySelector('[data-le-edit]')).toBeNull();
    expect(page(own).querySelector<HTMLAnchorElement>('[data-le-edit]')?.getAttribute('href')).toBe('/components/button/?edit=1');
  });

  it('lists the release notes that name the component', () => {
    const releases = [{ name: 'v2.0.0', date: '2026-10-20', packages: [], entries: [{ kind: 'Fix', title: 'Fix `Button` focus ring', packages: ['@acme/react'] }, { kind: 'New', title: 'Add Card', packages: [] }] }];
    const el = page({ ...team, extras: { ...team.extras, releases: releases as unknown as NonNullable<LibraryData['extras']['releases']> } });
    expect([...el.querySelectorAll('.cp-changes li')].map((li) => li.textContent)).toEqual(['FixFix Button focus ringv2.0.0, Oct 20, 2026']);
    expect(el.querySelector('.cp-changes code')?.textContent).toBe('Button');
  });

  it('has no axe violation', async () => {
    const el = page(team);
    // axe cannot enter a frame under jsdom: every Storybook frame has a title, then the page is checked without them.
    const frames = [...el.querySelectorAll('iframe')];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f.getAttribute('title')).toBeTruthy();
      f.remove();
    }
    await expectNoAxeViolations(el);
  });
});

describe('Components page', () => {
  it('gives a team the same families, cards and counts as Bridge', () => {
    const mine = index(own);
    const theirs = index(team);
    expect(headings(theirs).filter((h) => !h.startsWith('H1'))).toEqual(headings(mine).filter((h) => !h.startsWith('H1')));
    expect(theirs.querySelectorAll('[data-ccard]').length).toBe(loadComponents(repoModel).length);
    expect(theirs.querySelector('.gallery-stats')?.textContent).toBe(mine.querySelector('.gallery-stats')?.textContent);
    expect(theirs.querySelector<HTMLAnchorElement>('[data-ccard] h3 a')?.getAttribute('href')).toMatch(/^\/library\/acme\/ds\/components\/[a-z0-9-]+\/$/);
  });

  it('has no axe violation', async () => {
    await expectNoAxeViolations(index(team));
  });
});
