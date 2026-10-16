// Data-driven navigation. Components are grouped by the optional `category` in <Name>.docs.json, so adding a
// component folder adds it to the rail, the components index and the command palette without touching this file.
import type { IconName } from '../brand/icons';
import { loadComponents } from './components';

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  badge?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
  /** Nested groups (component categories). */
  groups?: { label: string; items: NavItem[] }[];
}

export const FOUNDATIONS: NavItem[] = [
  { href: '/tokens/', label: 'Token explorer', icon: 'grid' },
  { href: '/foundations/color/', label: 'Color', icon: 'palette' },
  { href: '/foundations/contrast/', label: 'Contrast', icon: 'contrast' },
  { href: '/foundations/typography/', label: 'Typography', icon: 'type' },
  { href: '/foundations/spacing/', label: 'Spacing', icon: 'spacing' },
  { href: '/foundations/radius/', label: 'Radius and borders', icon: 'radius' },
  { href: '/foundations/elevation/', label: 'Elevation', icon: 'elevation' },
  { href: '/foundations/lookup/', label: 'Token lookup', icon: 'target' },
];

export const PROCESS: NavItem[] = [
  { href: '/reviews/', label: 'Reviews', icon: 'review' },
  { href: '/history/', label: 'History', icon: 'merge' },
  { href: '/governance/', label: 'Governance', icon: 'shield' },
  { href: '/changelog/', label: 'Changelog', icon: 'clock' },
  { href: '/for-ai-agents/', label: 'For AI agents', icon: 'agent' },
];

export const CONNECT: NavItem[] = [{ href: '/connect/mcp/', label: 'AI / MCP', icon: 'agent' }];

export function componentGroups() {
  const groups = new Map<string, NavItem[]>();
  for (const c of loadComponents()) {
    const cat = c.category;
    if (!groups.has(cat)) groups.set(cat, []);
    const status = c.docs?.status;
    groups.get(cat)!.push({ href: `/components/${c.slug}/`, label: c.name, badge: status && status !== 'stable' ? status : undefined });
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

export function navigation(): NavSection[] {
  return [
    {
      label: 'Workspace',
      items: [
        { href: '/', label: 'Overview', icon: 'home' },
        { href: '/playground/', label: 'Theme playground', icon: 'play' },
      ],
    },
    { label: 'Foundations', items: FOUNDATIONS },
    { label: 'Components', items: [{ href: '/components/', label: 'All components', icon: 'components' }], groups: componentGroups() },
    { label: 'Process', items: PROCESS },
    { label: 'Connect', items: CONNECT },
  ];
}
