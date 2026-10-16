// Command palette index: pages, components and every token. Served as /search-index.json and fetched on first open.
import { loadComponents } from './components';
import { SPACE_LABEL, allPages } from './nav';
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
  // Every page of both spaces and Settings, from the one nav file. Old pages (Token lookup, Contrast, History...)
  // redirect, so their names stay findable as extra keys on the page that replaced them.
  const formerly: Record<string, string> = {
    '/tokens/': 'token lookup hex reverse lookup',
    '/foundations/accessibility/': 'contrast matrix wcag',
    '/agents/': 'for ai agents connect mcp claude',
    '/studio/versions/': 'history releases revert undo',
    '/studio/settings/governance/': 'governance risk tiers approvals',
    '/studio/checks/': 'contrast gate validation',
  };
  const seen = new Set<string>();
  const pages: SearchItem[] = [
    ...allPages()
      .filter((p) => !seen.has(p.href) && seen.add(p.href))
      .map((p) => ({
        kind: 'page' as const,
        title: p.space === 'library' ? p.label : `${p.label} (${SPACE_LABEL[p.space]})`,
        href: p.href,
        meta: p.meta,
        keys: `${SPACE_LABEL[p.space]} ${formerly[p.href] ?? ''}`.trim(),
      })),
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
