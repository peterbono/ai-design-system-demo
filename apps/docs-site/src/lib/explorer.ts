// Token explorer data: one record per token (primitives and semantic), with everything the cards and the
// detail drawer show. Computed at build time from the token sources, component CSS and contrast pairs, and
// embedded in the page as JSON. "Unused" uses the same definition as the Overview dashboard (lib/stats.ts).
import { loadComponents } from './components';
import { contrastPairs } from './contrast';
import { globalStyleVars, libraryTokenUsage, typeLabel } from './stats';
import { repoModel } from './model';
import { BRANDS, hrefForVar, loadTokens, MODES, type Brand, type Mode, type Semantic, type Tier } from './tokens';

/** Token files of this build, keyed by path relative to tokens.root, as the explorer and @bridge-ds/core buildTokenSet read them. */
export const tokenFiles = (): Record<string, string> => repoModel.tokens.files;

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
  layer: Tier;
  description?: string;
  deprecated?: boolean | string;
  /** Primitive: resolved CSS value. Semantic: light value (see modes). */
  value: string;
  hex?: string;
  modes?: Record<Mode, ExplorerMode>;
  /** Values per brand x theme, when a brand changes this token. */
  brands?: Record<Brand, Record<Mode, ExplorerMode>>;
  /** Density tokens: value per density. */
  densities?: Record<string, string>;
  used: boolean;
  usedBy: ExplorerLink[];
  /** Global stylesheets (base styles, theme) that read this token's variable directly, by file name: "base.css". */
  globalStyles: string[];
  /** Primitives only: semantic tokens that resolve through this primitive, per theme. */
  referencedBy?: { path: string; modes: Mode[] }[];
  contrast: ExplorerContrast[];
  href: string;
  file?: string;
}

export function explorerTokens(): ExplorerToken[] {
  const { primitives, all } = loadTokens();
  const semantic = all;
  const components = loadComponents();
  // One definition of "in use" with the Overview and Checks (lib/stats.ts, @bridge-ds/core tokenUsage).
  const { used } = libraryTokenUsage();
  const pairs = contrastPairs();
  // Global stylesheets count as users too (tokenUsage already does): color.bg.default is read by base.css only.
  const globals = Object.entries(globalStyleVars());
  const stylesOf = (cssVar: string): string[] =>
    globals
      .filter(([, vars]) => vars.includes(cssVar))
      .map(([file]) => file.slice(file.lastIndexOf('/') + 1))
      .sort();
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

  const modesOf = (r: Record<Mode, { chain: string[]; css: string; hex?: string }>) =>
    Object.fromEntries(MODES.map((m) => [m, { chain: r[m].chain, css: r[m].css, hex: r[m].hex }])) as Record<Mode, ExplorerMode>;

  const sem: ExplorerToken[] = semantic.map((s) => ({
    path: s.path,
    cssVar: s.cssVar,
    figma: s.figma,
    type: s.type,
    typeLabel: typeLabel(s.type),
    layer: s.tier,
    description: s.description,
    deprecated: s.deprecated,
    value: s.modes.light.css,
    hex: s.modes.light.hex,
    modes: modesOf(s.modes),
    brands: s.brandSpecific
      ? (Object.fromEntries(BRANDS.map((b) => [b, modesOf(s.brands[b])])) as Record<Brand, Record<Mode, ExplorerMode>>)
      : undefined,
    densities: s.densities ? Object.fromEntries(Object.entries(s.densities).map(([d, v]) => [d, v.css])) : undefined,
    used: used.has(s.path),
    usedBy: usersOf(s.cssVar),
    globalStyles: stylesOf(s.cssVar),
    contrast: contrastFor(s.path),
    href: hrefForVar(s.cssVar, s.type),
  }));

  const prim: ExplorerToken[] = primitives.map((p) => {
    const referencedBy = semantic
      .map((s) => ({
        path: s.path,
        modes: MODES.filter((m) => BRANDS.some((b) => s.brands[b][m].chain.includes(p.path)) || s.densities?.comfortable.chain.includes(p.path) || s.densities?.compact.chain.includes(p.path)),
      }))
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
      used: used.has(p.path),
      usedBy,
      globalStyles: stylesOf(p.cssVar),
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
