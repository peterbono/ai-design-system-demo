import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ABOUT, allPages, COMPARE, DEMO, DOCS_AUTOMATIC_MEASURE, DOCS_CONFLUENCE, DOCS_FIGMA_PLUGIN, DOCS_HOME, DOCS_SECURITY, HOW_REVIEW_WORKS, LANDING, LIBRARY_HOME, locate, navFor, SETTINGS_HOME, SETTINGS_SECTIONS, spaceOf, WORKSPACE_SETTINGS, workspaceNav } from './nav';
import { WORKSPACE_HOME } from './start';
import { DEMO_REPOS } from './demo';
import { REDIRECT_SCRIPT_BODY, REDIRECTS, redirectScript, redirectTarget } from './redirects';
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
    expect(locate('/studio/review/')).toMatchObject({ space: 'studio', item: { label: 'Home' } });
    expect(locate('/components/button/').entry?.label).toBe('Components');
    expect(locate('/studio/settings/')).toMatchObject({ space: 'studio', item: { label: 'Settings' } });
    expect(locate(HOW_REVIEW_WORKS)).toMatchObject({ space: 'library', group: 'Use', item: { label: 'How review works' } });
  });
});

describe('routing: the landing at /, the Library home at /library/', () => {
  it('serves the landing and the comparison outside the side nav', () => {
    expect(LANDING).toBe('/');
    expect(COMPARE).toBe('/compare/');
    expect(pageFile(LANDING)).toMatch(/pages\/index\.astro$/);
    expect(pageFile(COMPARE)).toMatch(/pages\/compare\.astro$/);
    expect(allPages().map((p) => p.href)).not.toContain(LANDING);
  });

  it('serves About and the docs pages the header and footer link to, outside the side nav', () => {
    expect(pageFile(ABOUT)).toMatch(/pages\/about\.astro$/);
    expect(pageFile(DOCS_HOME)).toMatch(/pages\/docs\/index\.astro$/);
    expect(pageFile(DOCS_FIGMA_PLUGIN)).toMatch(/pages\/docs\/figma-plugin\.astro$/);
    expect(pageFile(DOCS_AUTOMATIC_MEASURE)).toMatch(/pages\/docs\/automatic-measure\.astro$/);
    expect(pageFile(DOCS_SECURITY)).toMatch(/pages\/docs\/security\.astro$/);
    expect(pageFile(DOCS_CONFLUENCE)).toMatch(/pages\/docs\/confluence\.astro$/);
    const hrefs = allPages().map((p) => p.href);
    for (const href of [ABOUT, DOCS_HOME, DOCS_FIGMA_PLUGIN, DOCS_SECURITY]) expect(hrefs).not.toContain(href);
  });

  it('points the header and the homepage at routes that exist', () => {
    const header = readFileSync(join(ROOT, 'apps/docs-site/src/components/site/SiteHeader.astro'), 'utf8');
    const footer = readFileSync(join(ROOT, 'apps/docs-site/src/components/site/SiteFooter.astro'), 'utf8');
    for (const name of ['ABOUT', 'DOCS_HOME', 'DOCS_FIGMA_PLUGIN', 'STUDIO_HOME']) expect(header).toContain(name);
    for (const name of ['ABOUT', 'DOCS_HOME', 'DOCS_FIGMA_PLUGIN', 'DOCS_SECURITY', 'STUDIO_HOME']) expect(footer).toContain(name);
    // The comparison lives on the homepage: the footer does not link it again.
    expect(footer).not.toContain('COMPARE');
    // The demo is the hosted Studio of the dedicated demo repo, served by the team shell rewrite.
    expect(DEMO).toBe(`/studio/${DEMO_REPOS[1]}/`);
    expect(pageFile('/team-shell/')).not.toBeNull();
  });

  it('moves only the Library home: its entry, breadcrumbs and deep links stay', () => {
    expect(LIBRARY_HOME).toBe('/library/');
    expect(pageFile(LIBRARY_HOME)).toMatch(/pages\/library\/index\.astro$/);
    expect(navFor('library')[0]).toMatchObject({ href: '/library/', label: 'Home' });
    expect(locate('/library/')).toMatchObject({ space: 'library', item: { label: 'Home' } });
    expect(locate('/components/button/').entry?.label).toBe('Components');
    expect(pageFile('/foundations/color/')).not.toBeNull();
  });

  it('sends the old playground to the Library home', () => {
    expect(REDIRECTS['/playground']).toBe(LIBRARY_HOME);
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
  it('lists Home, Branches, Being built, Components, Tokens, Quality, Settings', () => {
    expect(navFor('studio').map((e) => e.label)).toEqual(['Home', 'Changes', 'Being built', 'Components', 'Tokens', 'Quality', 'Settings']);
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

  it('has its sections in order, the team first, the Repository facts in a For developers fold', () => {
    const at = SETTINGS_SECTIONS.map((id) => page.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(SETTINGS_SECTIONS).toEqual(['general', 'repository', 'roles', 'approvals', 'tools', 'integrations']);
    // The account is the account menu's dialog (board D9): no Account band, no GitHub connection here.
    expect(page).not.toContain('SettingsAccount');
    expect(page).not.toContain('AccountSettings');
    expect(page.match(/<DevFold/g)).toHaveLength(2);
  });

  it('keeps one primary per edit mode and a GitHub link in the developer facts', () => {
    // Review rules and Safety each request a review from a save bar that shows only after Edit or Change.
    expect(page.match(/variant="primary"/g)).toHaveLength(2);
    expect(page.match(/<div class="set-savebar[^"]*" data-edit>\s*<div class="rq-actions">\s*<Button variant="primary" type="submit" data-roles-submit/g)).toHaveLength(2);
    expect(page).toContain('{VOCAB.howOnGitHub}');
    expect(page).toContain('{VOCAB.openOnGitHub}');
    expect(page).not.toMatch(/<details[^>]* open/);
    // No summary sentence repeating the role rows; badges only for a status.
    expect(page).not.toContain('rolesSummary');
    expect(page.match(/<Badge/g)).toHaveLength(2);
  });

  it('puts every band in the 1200px page, General (the team name) first, then the team rules, and Appearance (this browser) last', () => {
    const order = ['id="general"', 'id="team"', 'id="library-access"', 'id="team-claude"', 'id="changes"', 'id="roles"', 'id="safety"', 'id="tools"', 'id="integrations"', 'id="products"', 'id="ai-tools"', 'id="appearance"'].map((x) => page.indexOf(x));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(page.match(/<section class="set-band"/g)).toHaveLength(12);
    expect(page.indexOf('<div class="set-page">')).toBeLessThan(order[0]!);
  });

  it('links Approvals to the Library guide, without the tier table', () => {
    expect(page).toContain('href={HOW_REVIEW_WORKS}');
    expect(page).not.toContain('ApprovalsTable');
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
    // Versions and History are the Library changelog's token changes now (lib/history-moved).
    expect(redirectTarget(REDIRECTS['/studio/versions']!, '', '')).toBe('/changelog/#token-changes');
    expect(redirectTarget(REDIRECTS['/studio/versions']!, '?token=color.text.muted', '')).toBe('/changelog/?token=color.text.muted#token-changes');
    expect(redirectTarget(REDIRECTS['/history']!, '?entry=pr-1', '')).toBe('/changelog/?entry=pr-1#token-changes');
    expect(redirectTarget(REDIRECTS['/reviews']!, '?pr=12', '')).toBe('/studio/changes/?pr=12');
  });

  it('keeps the old hash over the target one', () => {
    expect(redirectTarget('/studio/changes/#other-branches', '', '#top')).toBe('/studio/changes/#top');
    expect(redirectTarget('/studio/changes/#other-branches', '?branch=x', '')).toBe('/studio/changes/?branch=x#other-branches');
  });

  it('inlines the same rules in the redirect page script', () => {
    const script = redirectScript('/studio/changes/?state=shipped');
    const m = script.match(/^<script data-to="([^"]*)">(.*)<\/script>$/)!;
    expect(m[2]).toBe(REDIRECT_SCRIPT_BODY);
    const to = m[1]!.replace(/&amp;/g, '&');
    let landed = '';
    const fakeLocation = { search: '?entry=abc', hash: '', replace: (u: string) => (landed = u) };
    const fakeDocument = { currentScript: { getAttribute: () => to } };
    new Function('location', 'document', m[2]!)(fakeLocation, fakeDocument);
    expect(landed).toBe(redirectTarget('/studio/changes/?state=shipped', '?entry=abc', ''));
  });

  it('never shadows a real page', () => {
    const shadowed = Object.keys(REDIRECTS).filter((from) => pageFile(from));
    expect(shadowed).toEqual([]);
  });
});

describe('the browser workspace rail', () => {
  it('links only to the workspace home and its team Settings, never to the pages of Bridge\'s own design system', () => {
    const hrefs = workspaceNav().map((e) => e.href);
    expect(hrefs).toEqual([WORKSPACE_HOME, WORKSPACE_SETTINGS]);
    for (const own of navFor('studio').slice(1)) expect(hrefs).not.toContain(own.href);
  });

  it('marks the workspace home as the current page of Studio', () => {
    expect(locate(WORKSPACE_HOME).space).toBe('studio');
  });
});
