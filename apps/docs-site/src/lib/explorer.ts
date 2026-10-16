// Token explorer data: one record per token (primitives and semantic), with everything the cards and the
// detail drawer show. Computed at build time from the token sources, component CSS and contrast pairs, and
// embedded in the page as JSON. "Unused" uses the same definitions as the Overview dashboard (lib/stats.ts).
import { loadComponents } from './components';
import { contrastPairs } from './contrast';
import { dashboard, typeLabel } from './stats';
import { hrefForVar, loadTokens, MODES, type Mode } from './tokens';

export interface ExplorerLink {
  name: string;
  href: string;
}

export interface ExplorerMode {
  chain: string[];
  css: string;
  hex?: string;
}

export interface ExplorerContrast {
  other: string;
  role: 'fg' | 'bg';
  fgVar: string;
  bgVar: string;
  usage: 'text' | 'ui';
  modes: Record<Mode, { ratio: number; aa: boolean }>;
}

export interface ExplorerToken {
  path: string;
  cssVar: string;
  figma: string;
  type: string;
  typeLabel: string;
  layer: 'primitive' | 'semantic';
  description?: string;
  deprecated?: boolean | string;
  /** Primitive: resolved CSS value. Semantic: light value (see modes). */
  value: string;
  hex?: string;
  modes?: Record<Mode, ExplorerMode>;
  used: boolean;
  usedBy: ExplorerLink[];
  /** Primitives only: semantic tokens that resolve through this primitive, per theme. */
  referencedBy?: { path: string; modes: Mode[] }[];
  contrast: ExplorerContrast[];
  href: string;
  file?: string;
}

export function explorerTokens(): ExplorerToken[] {
  const { primitives, semantic } = loadTokens();
  const components = loadComponents();
  const stats = dashboard();
  const unusedSemantic = new Set(stats.unusedSemantic.map((s) => s.path));
  const orphan = new Set(stats.orphanPrimitives.map((p) => p.path));
  const pairs = contrastPairs();
  const usersOf = (cssVar: string): ExplorerLink[] =>
    components.filter((c) => c.tokensUsed.some((t) => t.name === cssVar)).map((c) => ({ name: c.name, href: `/components/${c.slug}/` }));

  const contrastFor = (path: string): ExplorerContrast[] =>
    pairs
      .filter((p) => p.fg === path || p.bg === path)
      .map((p) => ({
        other: p.fg === path ? p.bg : p.fg,
        role: p.fg === path ? 'fg' : 'bg',
        fgVar: p.fgToken.cssVar,
        bgVar: p.bgToken.cssVar,
        usage: p.usage,
        modes: Object.fromEntries(MODES.map((m) => [m, { ratio: p.modes[m].ratio, aa: p.modes[m].aa }])) as ExplorerContrast['modes'],
      }));

  const sem: ExplorerToken[] = semantic.map((s) => ({
    path: s.path,
    cssVar: s.cssVar,
    figma: s.figma,
    type: s.type,
    typeLabel: typeLabel(s.type),
    layer: 'semantic',
    description: s.description,
    deprecated: s.deprecated,
    value: s.modes.light.css,
    hex: s.modes.light.hex,
    modes: Object.fromEntries(MODES.map((m) => [m, { chain: s.modes[m].chain, css: s.modes[m].css, hex: s.modes[m].hex }])) as Record<Mode, ExplorerMode>,
    used: !unusedSemantic.has(s.path),
    usedBy: usersOf(s.cssVar),
    contrast: contrastFor(s.path),
    href: hrefForVar(s.cssVar, s.type),
  }));

  const prim: ExplorerToken[] = primitives.map((p) => {
    const referencedBy = semantic
      .map((s) => ({ path: s.path, modes: MODES.filter((m) => s.modes[m].chain.includes(p.path)) }))
      .filter((x) => x.modes.length);
    // Components reached through a semantic alias count as users too, so the blast radius is complete.
    const via = semantic.filter((s) => referencedBy.some((r) => r.path === s.path)).flatMap((s) => usersOf(s.cssVar));
    const direct = usersOf(p.cssVar);
    const usedBy = [...new Map([...direct, ...via].map((l) => [l.name, l])).values()].sort((a, b) => a.name.localeCompare(b.name));
    return {
      path: p.path,
      cssVar: p.cssVar,
      figma: p.figma,
      type: p.type,
      typeLabel: typeLabel(p.type),
      layer: 'primitive',
      description: p.description,
      deprecated: p.deprecated,
      value: p.css,
      hex: p.type === 'color' ? p.hex : undefined,
      used: !orphan.has(p.path),
      usedBy,
      referencedBy,
      contrast: [],
      href: hrefForVar(p.cssVar, p.type),
      file: p.file,
    };
  });

  return [...sem, ...prim];
}

/** Which visual preview a token card gets. */
export function previewKind(t: Pick<ExplorerToken, 'path' | 'type'>): string {
  if (t.type === 'color') return 'color';
  if (t.type === 'shadow') return 'shadow';
  if (t.type === 'fontFamily') return 'family';
  if (t.type === 'fontWeight') return 'weight';
  if (t.type === 'number') return 'number';
  if (t.path.startsWith('radius.')) return 'radius';
  if (t.path.startsWith('border.') || t.path.startsWith('focus.')) return 'stroke';
  if (t.path.startsWith('font.size')) return 'size';
  return 'space';
}
