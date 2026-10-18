// The one navigation data file. Both spaces, their side nav, breadcrumbs, the search index pages and the page
// title of every route read from here.
//
// The Library is the site; the Studio is a space inside it:
//   Library  the public site, reads the latest release of main. No token needed. No space switch: one quiet
//            "Open Studio" button in the header is the team entry.
//   Studio   changes it: tokens, changes (in review and history), quality, settings. Its own header (Bridge Studio) and
//            nav; "Library, view published library" at the bottom of its nav is the way back.
//
// Side nav rules (apps/docs-site/DESIGN.md): at most 7 top-level entries per space, no group headings, one count
// (the reviews waiting on Changes), two levels at most. A top-level entry is either a page (href) or a group of pages (children); only the group you
// are in starts expanded. Deeper levels (each component) live as cards on their group page, not in the nav.
import type { IconName } from '../brand/icons';
import { loadComponents } from './components';

export type Space = 'library' | 'studio';

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  /** Sits slightly apart from the pages above it (All tokens under the foundations). */
  apart?: boolean;
  /** Studio pages that read the branch chosen next to the page title (?branch=). Others show main and say so. */
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
}

export const LIBRARY_HOME = '/';
export const STUDIO_HOME = '/studio/';
export const SETTINGS_HOME = '/studio/settings/';

export const FOUNDATIONS: NavItem[] = [
  { href: '/foundations/color/', label: 'Color', icon: 'palette', meta: 'Palette ramps and the semantic roles in both themes' },
  { href: '/foundations/typography/', label: 'Typography', icon: 'type', meta: 'Type roles, the scale and samples' },
  { href: '/foundations/spacing/', label: 'Spacing', icon: 'spacing', meta: 'The space scale' },
  { href: '/foundations/radius/', label: 'Radius and borders', icon: 'radius', meta: 'Radius roles and border widths' },
  { href: '/foundations/elevation/', label: 'Elevation', icon: 'elevation', meta: 'Shadows for floating layers' },
  { href: '/foundations/accessibility/', label: 'Accessibility', icon: 'contrast', meta: 'Contrast grid of every gated color pair, in every brand and theme' },
  { href: '/tokens/', label: 'All tokens', icon: 'grid', apart: true, meta: 'Every semantic token with its light and dark value, ready to copy' },
];

export const LIBRARY_USE: NavItem[] = [
  { href: '/install/', label: 'Install', icon: 'box', meta: 'Packages, fonts and the DS Bridge Figma plugin' },
  { href: '/agents/', label: 'Agents', icon: 'agent', meta: 'MCP server, bridge CLI and llms.txt for AI agents' },
  { href: '/how-review-works/', label: 'How review works', icon: 'review', meta: 'Risk tiers, review gates, the owner override and the rules the AI agent follows' },
  { href: '/changelog/', label: 'Changelog', icon: 'tag', meta: 'Release notes, ready to post' },
];

/** Changes is one page with two views (In review, History); the old Drafts, Branches, Reviews, Versions and Visual
 * impact pages redirect to the right view (lib/redirects.ts). */
export const STUDIO_CHANGES_HREF = '/studio/changes/';

/** Quality is one page: the contrast gate, token validation, docs completeness and adoption. The old Checks and
 * Adoption pages redirect to it (lib/redirects.ts); each audit report opens under /studio/quality/audits/. */
export const STUDIO_QUALITY_HREF = '/studio/quality/';

/** Settings is one page, its sections in page order: Connection, Roles, Approvals, Figma and Claude (tools),
 * Integrations, then the collapsed For developers section (developer) that holds Repository. The old Repository,
 * Governance and Integrations pages redirect to these anchors (lib/redirects.ts); the governance prose lives in the
 * Library (How review works). */
export const SETTINGS_SECTIONS = ['connection', 'roles', 'approvals', 'tools', 'integrations', 'developer', 'repository'] as const;
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
    { href: STUDIO_HOME, label: 'Overview', icon: 'gauge', meta: 'What waits for you, suggestions and activity' },
    { href: '/studio/tokens/', label: 'Tokens', icon: 'grid', meta: 'Edit tokens into a draft, with live preview and guardrails' },
    { href: '/studio/components/', label: 'Components', icon: 'diamonds', meta: 'Status, tokens, code and Figma links per component' },
    { href: STUDIO_CHANGES_HREF, label: 'Changes', icon: 'branch', badge: 'reviews', meta: 'Changes to review, requests, explorations and the history of shipped token changes, with undo' },
    { href: STUDIO_QUALITY_HREF, label: 'Quality', icon: 'shield', meta: 'Contrast gate, token validation, docs completeness and adoption, most severe first' },
    { href: SETTINGS_HOME, label: 'Settings', icon: 'sliders', meta: 'GitHub connection, the repository this workspace reads, and who approves what' },
  ];
}

export const navFor = (space: Space) => (space === 'studio' ? studioNav() : libraryNav());

const norm = (path: string) => path.replace(/\/?$/, '/');

export function spaceOf(path: string): Space {
  return norm(path).startsWith(STUDIO_HOME) ? 'studio' : 'library';
}

/** Every page entry of one top-level entry: itself when it is a page, else its children. */
const pagesOf = (e: NavEntry): NavItem[] => (e.children ?? (e.href ? [{ href: e.href, label: e.label, icon: e.icon, meta: e.meta }] : []));

/**
 * Where a page sits: its top-level entry and page, for breadcrumbs, the expanded group and the current link.
 * `group` is the label of a group entry (Foundations, Changes); page entries have none.
 */
export function locate(path: string): { space: Space; entry?: NavEntry; group?: string; item?: NavItem } {
  const p = norm(path);
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
