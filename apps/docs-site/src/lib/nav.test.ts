import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { allPages, HOW_REVIEW_WORKS, locate, navFor, SETTINGS_HOME, SETTINGS_SECTIONS, spaceOf } from './nav';
import { REDIRECTS, redirectScript, redirectTarget } from './redirects';
import { ROOT } from './repo';

const PAGES = join(ROOT, 'apps/docs-site/src/pages');

/** The page file that serves a route, if any (static pages only; component pages come from [slug].astro). */
function pageFile(href: string): string | null {
  const route = href.replace(/^\/|\/$/g, '');
  const candidates = route === '' ? ['index.astro'] : [`${route}.astro`, `${route}/index.astro`];
  if (route.startsWith('components/') && route !== 'components') candidates.push('components/[slug].astro');
  return candidates.map((c) => join(PAGES, c)).find((f) => existsSync(f)) ?? null;
}

describe('navigation data', () => {
  it('links every nav entry to a page that exists', () => {
    const missing = allPages().filter((p) => !pageFile(p.href));
    expect(missing.map((p) => p.href)).toEqual([]);
  });

  it('lists each page once per space', () => {
    for (const space of ['library', 'studio'] as const) {
      const hrefs = navFor(space).flatMap((e) => (e.children ?? []).map((i) => i.href).concat(e.href ?? []));
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it('puts routes in the right space', () => {
    expect(spaceOf('/')).toBe('library');
    expect(spaceOf('/components/button/')).toBe('library');
    expect(spaceOf('/studio/changes')).toBe('studio');
    expect(spaceOf('/studio/settings/')).toBe('studio');
    expect(spaceOf(HOW_REVIEW_WORKS)).toBe('library');
  });

  it('keeps the side nav short: at most 7 top-level entries, two levels', () => {
    for (const space of ['library', 'studio'] as const) {
      const nav = navFor(space);
      expect(nav.length).toBeLessThanOrEqual(7);
      for (const e of nav) expect(Boolean(e.href) !== Boolean(e.children), e.label).toBe(true);
    }
  });

  it('finds the group and entry for breadcrumbs, nested pages included', () => {
    expect(locate('/foundations/accessibility/')).toMatchObject({ space: 'library', group: 'Foundations', item: { label: 'Accessibility' } });
    expect(locate('/tokens/')).toMatchObject({ space: 'library', group: 'Foundations', item: { label: 'All tokens' } });
    expect(locate('/studio/changes/')).toMatchObject({ space: 'studio', item: { label: 'Changes' } });
    expect(locate('/components/button/').entry?.label).toBe('Components');
    expect(locate('/studio/settings/')).toMatchObject({ space: 'studio', item: { label: 'Settings' } });
    expect(locate(HOW_REVIEW_WORKS)).toMatchObject({ space: 'library', group: 'Use', item: { label: 'How review works' } });
  });
});

describe('navigation shape', () => {
  it('keeps the Library to Home, Foundations, Components and Use, with All tokens last under Foundations', () => {
    expect(navFor('library').map((e) => e.label)).toEqual(['Home', 'Foundations', 'Components', 'Use']);
    const found = navFor('library').find((e) => e.label === 'Foundations')!.children!;
    expect(found.at(-1)).toMatchObject({ href: '/tokens/', label: 'All tokens', apart: true });
  });

  it('shows one count in the Studio nav: reviews, on Changes', () => {
    const counted = navFor('studio').filter((e) => e.badge);
    expect(counted.map((e) => [e.label, e.badge])).toEqual([['Changes', 'reviews']]);
  });
});

describe('studio nav', () => {
  it('lists Overview, Tokens, Components, Changes, Quality, Settings', () => {
    expect(navFor('studio').map((e) => e.label)).toEqual(['Overview', 'Tokens', 'Components', 'Changes', 'Quality', 'Settings']);
  });

  it('makes Changes one page with the review count, and drops the pages it replaced', () => {
    const changes = navFor('studio').find((e) => e.label === 'Changes')!;
    expect(changes).toMatchObject({ href: '/studio/changes/', badge: 'reviews' });
    expect(changes.children).toBeUndefined();
    const hrefs = allPages().map((p) => p.href);
    for (const gone of ['/studio/drafts/', '/studio/branches/', '/studio/reviews/', '/studio/versions/', '/studio/visual-impact/']) expect(hrefs).not.toContain(gone);
  });

  it('makes Quality one page without a chevron, and drops Checks and Adoption', () => {
    const quality = navFor('studio').find((e) => e.label === 'Quality')!;
    expect(quality).toMatchObject({ href: '/studio/quality/' });
    expect(quality.children).toBeUndefined();
    const hrefs = allPages().map((p) => p.href);
    for (const gone of ['/studio/checks/', '/studio/adoption/']) expect(hrefs).not.toContain(gone);
    expect(locate('/studio/quality/audits/admin-after/').entry?.label).toBe('Quality');
  });
});

describe('settings', () => {
  const page = readFileSync(join(PAGES, 'studio/settings/index.astro'), 'utf8');

  it('is one page in the nav, without a group or chevron', () => {
    const settings = navFor('studio').find((e) => e.label === 'Settings')!;
    expect(settings).toMatchObject({ href: SETTINGS_HOME });
    expect(settings.children).toBeUndefined();
    const hrefs = allPages().map((p) => p.href);
    for (const gone of ['/studio/settings/governance/', '/studio/settings/integrations/']) expect(hrefs).not.toContain(gone);
  });

  it('has its sections in order, Repository inside the collapsed For developers section', () => {
    const at = SETTINGS_SECTIONS.map((id) => page.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(SETTINGS_SECTIONS).toEqual(['connection', 'roles', 'approvals', 'tools', 'integrations', 'developer', 'repository']);
    const dev = page.indexOf('data-dev-fold');
    expect(page.indexOf('id="repository"')).toBeGreaterThan(dev);
    expect(page.indexOf('id="tiers-and-modes"')).toBeGreaterThan(dev);
  });

  it('opens Connection with one action per state, keeps developer details in one collapsed section', () => {
    expect(page).toContain('Read only. Connect GitHub to approve, propose and undo.');
    // At rest one primary (Connect GitHub). Roles' "Propose changes" is the primary of its edit mode only, inside
    // the save bar that shows after Edit.
    expect(page.match(/variant="primary"/g)).toHaveLength(2);
    expect(page).toMatch(/<div class="set-savebar" data-edit>\s*<div class="rq-actions">\s*<Button variant="primary" type="submit" data-roles-submit/);
    expect(page.match(/For developers<\/span>/g)).toHaveLength(1);
    expect(page).toMatch(/<details class="set-more set-dev" id="for-developers" data-dev-fold>/);
    expect(page).not.toMatch(/<details[^>]* open/);
    expect(page).not.toContain('<Badge');
  });

  it('links Approvals to the Library guide and each tier to the Changes filter', () => {
    expect(page).toContain('href={HOW_REVIEW_WORKS}');
    expect(page).toContain('/studio/changes/?tier=${t.tier}');
  });
});

describe('redirects', () => {
  it('sends the old Settings pages to the sections of the one page', () => {
    expect(redirectTarget(REDIRECTS['/studio/settings/repository']!, '', '')).toBe('/studio/settings/#repository');
    expect(redirectTarget(REDIRECTS['/studio/settings/governance']!, '', '')).toBe('/studio/settings/#approvals');
    expect(redirectTarget(REDIRECTS['/studio/settings/integrations']!, '', '')).toBe('/studio/settings/#integrations');
    expect(redirectTarget(REDIRECTS['/governance']!, '', '')).toBe(HOW_REVIEW_WORKS);
    for (const [from, to] of Object.entries(REDIRECTS).filter(([f]) => f.startsWith(SETTINGS_HOME))) {
      expect(SETTINGS_SECTIONS as readonly string[], from).toContain(to.split('#')[1]);
    }
  });

  it('sends every old URL to a page that exists', () => {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      expect(pageFile(to.replace(/[?#].*$/, '')), `${from} -> ${to}`).not.toBeNull();
    }
  });

  it('sends the old Changes pages to the right view', () => {
    expect(redirectTarget(REDIRECTS['/studio/drafts']!, '', '')).toBe('/studio/changes/');
    expect(redirectTarget(REDIRECTS['/studio/reviews']!, '?pr=3', '')).toBe('/studio/changes/?pr=3');
    expect(redirectTarget(REDIRECTS['/studio/branches']!, '', '')).toBe('/studio/changes/#other-branches');
    expect(redirectTarget(REDIRECTS['/studio/visual-impact']!, '', '')).toBe('/studio/changes/');
    expect(redirectTarget(REDIRECTS['/studio/versions']!, '', '')).toBe('/studio/changes/?view=history');
    expect(redirectTarget(REDIRECTS['/studio/versions']!, '?token=color.text.muted', '')).toBe('/studio/changes/?view=history&token=color.text.muted');
    expect(redirectTarget(REDIRECTS['/reviews']!, '?pr=12', '')).toBe('/studio/changes/?pr=12');
  });

  it('keeps the old hash over the target one', () => {
    expect(redirectTarget('/studio/changes/#other-branches', '', '#top')).toBe('/studio/changes/#top');
    expect(redirectTarget('/studio/changes/#other-branches', '?branch=x', '')).toBe('/studio/changes/?branch=x#other-branches');
  });

  it('inlines the same rules in the redirect page script', () => {
    const script = redirectScript('/studio/changes/?view=history');
    const body = script.replace(/^<script>|<\/script>$/g, '');
    let landed = '';
    const fakeLocation = { search: '?entry=abc', hash: '', replace: (u: string) => (landed = u) };
    new Function('location', body)(fakeLocation);
    expect(landed).toBe(redirectTarget('/studio/changes/?view=history', '?entry=abc', ''));
  });

  it('never shadows a real page', () => {
    const shadowed = Object.keys(REDIRECTS).filter((from) => pageFile(from));
    expect(shadowed).toEqual([]);
  });
});
