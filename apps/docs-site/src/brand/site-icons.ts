// The site's own glyphs (src/brand/icons.ts) as Lucide-compatible components, so pages draw them through the DS
// Icon: `<Icon icon={siteIcon('home')} size="md" />`. Each inner SVG string is parsed once into [tag, attrs] nodes.
import { createLucideIcon, type IconNode, type LucideIcon } from 'lucide-react';
import { ICONS, type IconName } from './icons';

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Parses self-closing SVG elements (`<path d="..."/>`) into Lucide icon nodes. */
export function parseIconNode(markup: string): IconNode {
  const nodes: IconNode = [];
  const element = /<([a-z]+)\b([^>]*?)\/>/g;
  for (const [, tag, rawAttrs] of markup.matchAll(element)) {
    const attrs: Record<string, string> = { key: `${tag}-${nodes.length}` };
    for (const [, name, value] of rawAttrs!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[camel(name!)] = value!;
    nodes.push([tag as IconNode[number][0], attrs]);
  }
  return nodes;
}

const toKebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Every site glyph as a Lucide icon component, keyed by its IconName. */
export const SITE_ICONS = Object.fromEntries(
  (Object.keys(ICONS) as IconName[]).map((name) => [name, createLucideIcon(`site-${toKebab(name)}`, parseIconNode(ICONS[name]))]),
) as Record<IconName, LucideIcon>;

/** The site glyph `name` as a Lucide icon component, for the DS Icon's `icon` prop. */
export const siteIcon = (name: IconName): LucideIcon => SITE_ICONS[name];
