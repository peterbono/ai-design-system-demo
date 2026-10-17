import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allPages, locate, navFor, spaceOf } from './nav';
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
    expect(spaceOf('/studio/settings/governance/')).toBe('studio');
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
    expect(locate('/studio/settings/integrations/')).toMatchObject({ space: 'studio', group: 'Settings', item: { label: 'Integrations' } });
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
});

describe('redirects', () => {
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
