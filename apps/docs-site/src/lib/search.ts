// Command palette index: pages, components and every token. Served as /search-index.json and fetched on first open.
import { loadComponents } from './components';
import { FOUNDATIONS, PROCESS } from './nav';
import { loadTokens } from './tokens';

export interface SearchItem {
  kind: 'page' | 'component' | 'token';
  title: string;
  href: string;
  /** Secondary line: description, value or layer. */
  meta?: string;
  /** Extra words that should match (CSS var, Figma name, hex). */
  keys?: string;
  swatch?: string;
}

export function searchIndex(): SearchItem[] {
  const { primitives, semantic } = loadTokens();
  const pages: SearchItem[] = [
    { kind: 'page', title: 'Overview', href: '/', meta: 'System health, stats and recent changes' },
    { kind: 'page', title: 'Theme playground', href: '/playground/', meta: 'A sample product screen in light and dark' },
    { kind: 'page', title: 'All components', href: '/components/', meta: 'Every component with its guidance' },
    ...[...FOUNDATIONS, ...PROCESS].map((i) => ({ kind: 'page' as const, title: i.label, href: i.href })),
    { kind: 'page', title: 'llms.txt', href: '/llms.txt', meta: 'The docs as plain text for agents' },
  ];
  const components: SearchItem[] = loadComponents().map((c) => ({
    kind: 'component',
    title: c.name,
    href: `/components/${c.slug}/`,
    meta: c.docs?.summary ?? c.description,
    keys: c.subcomponents.join(' '),
  }));
  const tokens: SearchItem[] = [
    ...semantic.map((s) => ({
      kind: 'token' as const,
      title: s.path,
      href: `/tokens/?t=${encodeURIComponent(s.path)}`,
      meta: `Semantic, ${s.modes.light.css} / ${s.modes.dark.css}`,
      keys: `${s.cssVar} ${s.figma} ${s.modes.light.hex ?? ''} ${s.modes.dark.hex ?? ''}`,
      swatch: s.type === 'color' ? s.modes.light.hex : undefined,
    })),
    ...primitives.map((p) => ({
      kind: 'token' as const,
      title: p.path,
      href: `/tokens/?t=${encodeURIComponent(p.path)}`,
      meta: `Primitive, ${p.css}`,
      keys: `${p.cssVar} ${p.figma} ${p.hex ?? ''}`,
      swatch: p.type === 'color' ? p.hex : undefined,
    })),
  ];
  return [...pages, ...components, ...tokens];
}
