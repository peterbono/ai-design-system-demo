// Reverse lookup index: for every primitive, which semantic tokens point to it (per theme) and which components
// end up using it. Published as /lookup-index.json for the lookup page's small client script.
import { loadComponents } from './components';
import { hrefForVar, loadTokens, MODES } from './tokens';

export function lookupIndex() {
  const { primitives, semantic } = loadTokens();
  const components = loadComponents();
  const usersOf = (cssVar: string) => components.filter((c) => c.tokensUsed.some((t) => t.name === cssVar)).map((c) => ({ name: c.name, href: `/components/${c.slug}/` }));
  return primitives.map((p) => {
    const sem = semantic
      .map((s) => ({ s, modes: MODES.filter((m) => s.modes[m].chain.includes(p.path)) }))
      .filter((x) => x.modes.length)
      .map(({ s, modes }) => ({ path: s.path, cssVar: s.cssVar, href: hrefForVar(s.cssVar, s.type), modes, components: usersOf(s.cssVar) }));
    return {
      path: p.path,
      cssVar: p.cssVar,
      figma: p.figma,
      type: p.type,
      value: p.css,
      hex: p.type === 'color' ? p.hex ?? null : null,
      href: hrefForVar(p.cssVar, p.type),
      semantic: sem,
      components: usersOf(p.cssVar),
    };
  });
}
