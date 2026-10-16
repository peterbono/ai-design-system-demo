import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allPages, locate, navFor, spaceOf } from './nav';
import { REDIRECTS } from './redirects';
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
    for (const space of ['library', 'studio', 'settings'] as const) {
      const hrefs = navFor(space).flatMap((g) => g.items.map((i) => i.href));
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  it('puts routes in the right space', () => {
    expect(spaceOf('/')).toBe('library');
    expect(spaceOf('/components/button/')).toBe('library');
    expect(spaceOf('/studio/reviews')).toBe('studio');
    expect(spaceOf('/studio/settings/governance/')).toBe('settings');
  });

  it('finds the group and entry for breadcrumbs, nested pages included', () => {
    expect(locate('/foundations/accessibility/')).toMatchObject({ space: 'library', group: 'Foundations', item: { label: 'Accessibility' } });
    expect(locate('/studio/drafts/')).toMatchObject({ space: 'studio', group: 'Changes', item: { label: 'Drafts' } });
    expect(locate('/components/button/').group).toBe('Components');
  });
});

describe('redirects', () => {
  it('sends every old URL to a page that exists', () => {
    for (const [from, to] of Object.entries(REDIRECTS)) {
      expect(pageFile(to), `${from} -> ${to}`).not.toBeNull();
    }
  });

  it('never shadows a real page', () => {
    const shadowed = Object.keys(REDIRECTS).filter((from) => pageFile(from));
    expect(shadowed).toEqual([]);
  });
});
