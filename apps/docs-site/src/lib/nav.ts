// The one navigation data file. Both spaces, their groups, the Settings view, breadcrumbs, the search index pages
// and the page title of every route read from here. Components are grouped by the optional `category` in
// <Name>.docs.json, so adding a component folder adds it to the catalog, the rail and search without touching this file.
//
// Two spaces, one door:
//   Library  reads the latest release of main. No token needed.
//   Studio   changes it: drafts, branches, reviews, versions, checks. Needs a GitHub token to act, browsable without.
// Scope (release in Library, branch in Studio) lives in the header and the URL, never in this list.
import type { IconName } from '../brand/icons';
import { loadComponents } from './components';

export type Space = 'library' | 'studio' | 'settings';

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  /** Status badge (beta, deprecated) for component entries. */
  badge?: string;
  /** Live count filled in the browser: drafts from localStorage, reviews from GitHub. */
  count?: 'drafts' | 'reviews';
  /** Studio pages that read the branch chosen in the header (?branch=). Others show main and say so. */
  branchAware?: boolean;
  /** One line for search and the home shortcuts. */
  meta?: string;
}

export interface NavGroup {
  /** Uppercase group label in the rail. No label: items sit at the top of the rail. */
  label?: string;
  items: NavItem[];
  /** Collapsible sub-groups (component families). */
  families?: { label: string; items: NavItem[] }[];
}

export const LIBRARY_HOME = '/';
export const STUDIO_HOME = '/studio/';
export const SETTINGS_HOME = '/studio/settings/';

export const FOUNDATIONS: NavItem[] = [
  { href: '/foundations/color/', label: 'Color', icon: 'palette', meta: 'Palette ramps and the semantic roles in both themes' },
  { href: '/foundations/typography/', label: 'Typography', icon: 'type', meta: 'Type scale, weights and samples' },
  { href: '/foundations/spacing/', label: 'Spacing', icon: 'spacing', meta: 'The space scale' },
  { href: '/foundations/radius/', label: 'Radius and borders', icon: 'radius', meta: 'Radius roles and border widths' },
  { href: '/foundations/elevation/', label: 'Elevation', icon: 'elevation', meta: 'Shadows for floating layers' },
  { href: '/foundations/accessibility/', label: 'Accessibility', icon: 'contrast', meta: 'Contrast grid of every gated color pair, in every brand and theme' },
];

export const LIBRARY_TOKENS: NavItem[] = [
  { href: '/tokens/', label: 'Explorer', icon: 'grid', meta: 'Every token with its alias chain, values, contrast and usage' },
  { href: '/playground/', label: 'Theme playground', icon: 'play', meta: 'A sample product screen in every brand, theme and density' },
];

export const LIBRARY_USE: NavItem[] = [
  { href: '/install/', label: 'Install', icon: 'box', meta: 'Packages, fonts and the DS Bridge Figma plugin' },
  { href: '/agents/', label: 'Agents', icon: 'agent', meta: 'MCP server, bridge CLI and llms.txt for AI agents' },
  { href: '/changelog/', label: 'Changelog', icon: 'tag', meta: 'Release notes, ready to post' },
];

export const STUDIO_DATA: NavItem[] = [
  { href: '/studio/tokens/', label: 'Tokens', icon: 'grid', meta: 'Edit tokens into a draft, with live preview and guardrails' },
  { href: '/studio/components/', label: 'Components', icon: 'components', meta: 'Status, tokens, code and Figma links per component' },
];

export const STUDIO_CHANGES: NavItem[] = [
  { href: '/studio/drafts/', label: 'Drafts', icon: 'draft', count: 'drafts', meta: 'Token edits waiting in this browser' },
  { href: '/studio/branches/', label: 'Branches', icon: 'merge', branchAware: true, meta: 'Open branches with previews and snapshot packages' },
  { href: '/studio/reviews/', label: 'Reviews', icon: 'review', count: 'reviews', branchAware: true, meta: 'Open pull requests with token diffs and contrast' },
  { href: '/studio/versions/', label: 'Versions', icon: 'clock', meta: 'Releases and merged token changes, with revert' },
];

export const STUDIO_QUALITY: NavItem[] = [
  { href: '/studio/checks/', label: 'Checks', icon: 'shield', meta: 'Contrast gate and token validation' },
  { href: '/studio/visual-impact/', label: 'Visual impact', icon: 'eye', branchAware: true, meta: 'Screens and stories each pull request changes' },
  { href: '/studio/adoption/', label: 'Adoption', icon: 'target', meta: 'How much product code uses the design system' },
];

export const SETTINGS_NAV: NavItem[] = [
  { href: '/studio/settings/', label: 'Repository', icon: 'github', meta: 'The repository and bridge.config.json this workspace reads' },
  { href: '/studio/settings/governance/', label: 'Governance', icon: 'shield', meta: 'Risk tiers, approvals and agent rules' },
  { href: '/studio/settings/integrations/', label: 'Integrations', icon: 'link', meta: 'GitHub token, Figma plugin, MCP server' },
];

export function componentFamilies() {
  const groups = new Map<string, NavItem[]>();
  for (const c of loadComponents()) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    const status = c.docs?.status;
    groups.get(c.category)!.push({ href: `/components/${c.slug}/`, label: c.name, badge: status && status !== 'stable' ? status : undefined });
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

export function libraryNav(): NavGroup[] {
  return [
    { items: [{ href: LIBRARY_HOME, label: 'Home', icon: 'home', meta: "What's new and where to start" }] },
    { label: 'Foundations', items: FOUNDATIONS },
    { label: 'Tokens', items: LIBRARY_TOKENS },
    {
      label: 'Components',
      items: [{ href: '/components/', label: 'Catalog', icon: 'components', meta: 'Every component with its guidance' }],
      families: componentFamilies(),
    },
    { label: 'Use', items: LIBRARY_USE },
  ];
}

export function studioNav(): NavGroup[] {
  return [
    { items: [{ href: STUDIO_HOME, label: 'Overview', icon: 'home', meta: 'To review, health and activity' }] },
    { label: 'Data', items: STUDIO_DATA },
    { label: 'Changes', items: STUDIO_CHANGES },
    { label: 'Quality', items: STUDIO_QUALITY },
  ];
}

export function settingsNav(): NavGroup[] {
  return [{ label: 'Settings', items: SETTINGS_NAV }];
}

export const navFor = (space: Space) => (space === 'studio' ? studioNav() : space === 'settings' ? settingsNav() : libraryNav());

const norm = (path: string) => path.replace(/\/?$/, '/');

export function spaceOf(path: string): Space {
  const p = norm(path);
  if (p.startsWith(SETTINGS_HOME)) return 'settings';
  if (p.startsWith(STUDIO_HOME)) return 'studio';
  return 'library';
}

/** Where a page sits: its group label and item, for breadcrumbs and the active rail entry. */
export function locate(path: string): { space: Space; group?: string; item?: NavItem } {
  const p = norm(path);
  const space = spaceOf(p);
  for (const g of navFor(space)) {
    const exact = g.items.find((i) => i.href === p) ?? g.families?.flatMap((f) => f.items).find((i) => i.href === p);
    if (exact) return { space, group: g.label, item: exact };
  }
  // Nested pages (a component page) belong to the closest parent entry.
  for (const g of navFor(space)) {
    const parent = g.items.filter((i) => i.href !== '/' && i.href !== STUDIO_HOME && p.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
    if (parent) return { space, group: g.label, item: parent };
  }
  return { space };
}

/** Every page entry of both spaces and Settings, for the command palette. */
export function allPages(): (NavItem & { space: Space })[] {
  const spaces: Space[] = ['library', 'studio', 'settings'];
  return spaces.flatMap((space) => navFor(space).flatMap((g) => g.items.map((i) => ({ ...i, space }))));
}

export const SPACE_LABEL: Record<Space, string> = { library: 'Library', studio: 'Studio', settings: 'Settings' };
