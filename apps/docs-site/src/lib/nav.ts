// The one navigation data file. Both spaces, their side nav, breadcrumbs, the search index pages and the page
// title of every route read from here.
//
// The Library is the site; the Studio is a space inside it:
//   Library  the public site, reads the latest release of main. No token needed. No space switch: one quiet
//            "Open Studio" button in the header is the team entry.
//   Studio   changes it: tokens, changes (in progress and shipped), being built, quality, settings. Its own header (Bridge Studio) and
//            nav; "Library, view published library" at the bottom of its nav is the way back.
//
// Side nav rules (apps/docs-site/DESIGN.md): at most 7 top-level entries per space, no group headings, one count
// (the reviews waiting on Changes), two levels at most. A top-level entry is either a page (href) or a group of pages (children); only the group you
// are in starts expanded. Deeper levels (each component) live as cards on their group page, not in the nav.
import type { IconName } from '../brand/icons';
import { loadComponents } from './components';
import { VOCAB } from './vocabulary';
import { START_PAGE, WORKSPACE_HOME, WORKSPACE_SETTINGS } from './start';
import { LIBRARY_FOUNDATION_PAGES, LIBRARY_USE_PAGES } from './library-shells';

// Studio links in both modes (self-hosted /studio/, team shells /studio/<owner>/<repo>/). Browser code imports it from
// lib/team-path directly: this module reads the repository at build time.
export { studioHref } from './team-path';

export type Space = 'library' | 'studio';

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  /** Sits slightly apart from the pages above it (All tokens under the foundations). */
  apart?: boolean;
  /** Studio pages that can show the library as an open change (?change=N, lib/view-scope): "Viewing" in the top bar. */
  branchAware?: boolean;
  /** One line for search, llms.txt and the group pages. */
  meta?: string;
}

/** A top-level side nav entry: a page, or a group of pages that expands in place. */
export interface NavEntry {
  label: string;
  icon: IconName;
  /** Page entry. */
  href?: string;
  meta?: string;
  /** Group entry: its pages, shown when the group is expanded. */
  children?: NavItem[];
  /** Live count filled in the browser: open pull requests waiting for a review. The one number the nav shows. */
  badge?: 'reviews';
  /** Page entry that can show the library as an open change (see NavItem). */
  branchAware?: boolean;
}

/** The Library home. "/" is the product landing (pages/index.astro), with its own header and footer. */
export const LIBRARY_HOME = '/library/';
export const LANDING = '/';
export const COMPARE = '/compare/';
/** The product pages around the landing, with the same light header (layouts/Landing.astro). */
export const ABOUT = '/about/';
/** The product documentation (layouts/Docs.astro): an early version, to grow into a full guide. */
export const DOCS_HOME = '/docs/';
export const DOCS_FIGMA_PLUGIN = '/docs/figma-plugin/';
/** The automatic measure: what lets Claude fix what differs in Figma, and how a developer turns it on. */
export const DOCS_AUTOMATIC_MEASURE = '/docs/automatic-measure/';
/** Security and data, for IT and security teams reviewing Bridge (pages/docs/security.astro). */
export const DOCS_SECURITY = '/docs/security/';
/** Docs in Confluence: Copy for Confluence on each Library page, the Markdown export, the planned live sync. */
export const DOCS_CONFLUENCE = '/docs/confluence/';
export const STUDIO_HOME = '/studio/';
/** The read-only demo ("Open the demo" on /start/ and the team menu): the hosted Studio of the dedicated demo repo (lib/demo DEMO_REPOS). */
export const DEMO = '/studio/peterbono/bridge-demo-ds/';
/** "Get started": how do you want to start, while this browser remembers no workspace (lib/start.ts). */
export const START = START_PAGE;
/** The browser workspace: a Studio home with nothing connected yet (lib/start.ts). */
export const WORKSPACE = WORKSPACE_HOME;
export const SETTINGS_HOME = '/studio/settings/';

/** The Foundations pages: one list with a team's Library (lib/library-shells.ts), at this site's root. */
export const FOUNDATIONS: NavItem[] = LIBRARY_FOUNDATION_PAGES.map((p) => ({ href: `/${p.route}`, label: p.label, icon: p.icon as IconName, ...(p.apart ? { apart: true } : {}), meta: p.meta }));

/** The Use pages: one list with a team's Library (lib/library-shells.ts), at this site's root. */
export const LIBRARY_USE: NavItem[] = LIBRARY_USE_PAGES.map((p) => ({ href: `/${p.route}`, label: p.label, icon: p.icon as IconName, meta: p.meta }));

/** Changes is one page, its tabs from in progress to Shipped; the old Drafts, Branches, Reviews and Visual impact pages
 * redirect to it, Versions and History to the Library changelog or the Shipped tab (lib/redirects.ts,
 * lib/history-moved). */
export const STUDIO_CHANGES_HREF = '/studio/changes/';

/** Being built: the build requests sent from Figma (docs/BUILD-REQUESTS.md), read only, and on top the next release
 * for whoever may publish it. */
export const STUDIO_BUILDING_HREF = '/studio/building/';

/** Quality is one page: the contrast gate, token validation, docs completeness and adoption. The old Checks and
 * Adoption pages redirect to it (lib/redirects.ts); each audit report opens under /studio/quality/audits/. */
export const STUDIO_QUALITY_HREF = '/studio/quality/';

/** Settings is one page, its sections in page order: General (the team, first: the account is the account menu's
 * dialog, board D9), the Repository facts (the "For developers" fold of How changes reach your code), Roles,
 * Approvals, Figma and Claude (tools), Integrations. No developer section: settings speak designer words, each with
 * its "For developers" fold. The old Repository, Governance and Integrations pages redirect to these anchors
 * (lib/redirects.ts); the governance prose lives in the Library (How review works). */
export const SETTINGS_SECTIONS = ['general', 'repository', 'roles', 'approvals', 'tools', 'integrations'] as const;
export const HOW_REVIEW_WORKS = '/how-review-works/';

/** Component families for the catalog page (cards), from the optional `category` in <Name>.docs.json. */
export function componentFamilies() {
  const groups = new Map<string, NavItem[]>();
  for (const c of loadComponents()) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category)!.push({ href: `/components/${c.slug}/`, label: c.name });
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

export function libraryNav(): NavEntry[] {
  return [
    { href: LIBRARY_HOME, label: 'Home', icon: 'home', meta: "What's new and where to start" },
    { label: 'Foundations', icon: 'layers', children: FOUNDATIONS },
    { href: '/components/', label: 'Components', icon: 'diamonds', meta: 'Every component with its guidance' },
    { label: 'Use', icon: 'book', children: LIBRARY_USE },
  ];
}

export function studioNav(): NavEntry[] {
  return [
    { href: STUDIO_HOME, label: 'Home', icon: 'gauge', meta: 'What waits for you, suggestions and activity' },
    { href: STUDIO_CHANGES_HREF, label: VOCAB.Branches, icon: 'branch', badge: 'reviews', meta: 'Changes in review, explorations, and everything that shipped, by month' },
    { href: STUDIO_BUILDING_HREF, label: 'Being built', icon: 'wrench', meta: 'Changes sent from Figma that developers are building, where each one stands, and the next release' },
    { href: '/studio/components/', label: 'Components', icon: 'diamonds', branchAware: true, meta: 'Status, tokens, code and Figma links per component' },
    { href: '/studio/tokens/', label: 'Tokens', icon: 'grid', branchAware: true, meta: 'Edit tokens into a draft, with live preview and guardrails' },
    { href: STUDIO_QUALITY_HREF, label: 'Quality', icon: 'shield', branchAware: true, meta: 'Contrast gate, token validation, docs completeness and adoption, most severe first' },
    { href: SETTINGS_HOME, label: 'Settings', icon: 'sliders', meta: 'GitHub connection, the repository this workspace reads, and who approves what' },
  ];
}

export { WORKSPACE_SETTINGS };

/**
 * The browser workspace (pages/studio/workspace.astro): nothing is connected yet, so the rail has its own pages only:
 * Home, and the team's Settings once a team exists (scripts/workspace-nav.ts shows it and carries ?team=<id> on both).
 * Branches, Components, Tokens, Quality and Bridge's Settings would open Bridge's own design system, another context.
 */
export function workspaceNav(): NavEntry[] {
  return [
    { href: WORKSPACE_HOME, label: 'Home', icon: 'gauge', meta: 'Your workspace: create your team and connect your design system' },
    { href: WORKSPACE_SETTINGS, label: 'Settings', icon: 'sliders', meta: "Your team's name and people" },
  ];
}

export const navFor = (space: Space) => (space === 'studio' ? studioNav() : libraryNav());

const norm = (path: string) => path.replace(/\/?$/, '/');

export function spaceOf(path: string): Space {
  return norm(path).startsWith(STUDIO_HOME) ? 'studio' : 'library';
}

/** Every page entry of one top-level entry: itself when it is a page, else its children. */
const pagesOf = (e: NavEntry): NavItem[] => (e.children ?? (e.href ? [{ href: e.href, label: e.label, icon: e.icon, meta: e.meta, branchAware: e.branchAware }] : []));

/** Pages outside the nav that belong to an entry: the review queue opens from the Overview's "Review all"; the
 * browser workspace is a Studio home. */
const BELONGS_TO: Record<string, string> = { '/studio/review/': STUDIO_HOME, [WORKSPACE_HOME]: STUDIO_HOME };

/**
 * Where a page sits: its top-level entry and page, for breadcrumbs, the expanded group and the current link.
 * `group` is the label of a group entry (Foundations, Changes); page entries have none.
 */
export function locate(path: string): { space: Space; entry?: NavEntry; group?: string; item?: NavItem } {
  const p = BELONGS_TO[norm(path)] ?? norm(path);
  const space = spaceOf(p);
  const nav = navFor(space);
  const found = (entry: NavEntry, item: NavItem) => ({ space, entry, group: entry.children ? entry.label : undefined, item });
  for (const e of nav) {
    const exact = pagesOf(e).find((i) => i.href === p);
    if (exact) return found(e, exact);
  }
  // Nested pages (a component page) belong to the closest parent entry.
  let best: { entry: NavEntry; item: NavItem } | undefined;
  for (const e of nav) {
    for (const i of pagesOf(e)) {
      if (i.href === LIBRARY_HOME || i.href === STUDIO_HOME || !p.startsWith(i.href)) continue;
      if (!best || i.href.length > best.item.href.length) best = { entry: e, item: i };
    }
  }
  return best ? found(best.entry, best.item) : { space };
}

/** Every page entry of both spaces, for the command palette and llms.txt. */
export function allPages(): (NavItem & { space: Space })[] {
  const spaces: Space[] = ['library', 'studio'];
  return spaces.flatMap((space) => navFor(space).flatMap((e) => pagesOf(e).map((i) => ({ ...i, space }))));
}

export const SPACE_LABEL: Record<Space, string> = { library: 'Library', studio: 'Studio' };
