// Everything the Overview dashboard shows, computed from the repo at build time. No sample data:
// if a number is on screen, it is derived here from token files, component sources, contrast pairs or git.
import { loadComponents } from './components';
import { contrastPairs } from './contrast';
import { tokenUsage, type TokenUsage } from '@bridge-ds/core';
import { repoModel } from './model';
import { git } from './repo';
import { BRANDS, DENSITIES, loadTokens, MODES, hrefForVar, type Primitive, type Semantic } from './tokens';
import { studioHref } from './team-path';

export interface Slice {
  key: string;
  label: string;
  value: number;
}

const TYPE_LABEL: Record<string, string> = {
  color: 'Color',
  dimension: 'Dimension',
  shadow: 'Shadow',
  fontFamily: 'Font family',
  fontWeight: 'Font weight',
  number: 'Number',
  duration: 'Duration',
  cubicBezier: 'Easing',
  string: 'Text',
};

const CATEGORY: { key: string; label: string; match: (segments: string[]) => boolean }[] = [
  { key: 'color', label: 'Color', match: (s) => s[0] === 'color' },
  { key: 'type', label: 'Typography', match: (s) => s[0] === 'font' },
  { key: 'space', label: 'Spacing', match: (s) => s[0] === 'space' },
  { key: 'shape', label: 'Radius and borders', match: (s) => s[0] === 'radius' || s[0] === 'border' },
  { key: 'depth', label: 'Elevation', match: (s) => s[0] === 'shadow' || s[0] === 'elevation' },
  { key: 'focus', label: 'Focus', match: (s) => s[0] === 'focus' },
  { key: 'motion', label: 'Motion', match: (s) => s[0] === 'motion' || s[0] === 'duration' || s[0] === 'easing' },
  { key: 'size', label: 'Sizes and layers', match: (s) => ['size', 'icon', 'layer', 'z', 'breakpoint'].includes(s[0]!) },
];

export const categoryOf = (segments: string[]) => CATEGORY.find((c) => c.match(segments))?.key ?? 'other';
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

/** What a validation finding is about, so Studio Quality can group it (lib/quality.ts). */
export type IssueKind = 'contrast' | 'unknown-ref' | 'deprecated' | 'guidance' | 'unused';

export interface Issue {
  kind: IssueKind;
  severity: 'fail' | 'warn' | 'info';
  title: string;
  detail: string;
  href: string;
}

/**
 * Global stylesheet -> CSS custom properties it reads (base styles, theme), for tokenUsage and the Library rows. From
 * the repo model (components.styles in bridge.config.json, default styles/ and theme/ next to the components), the
 * same list a team page reads from GitHub.
 */
export function globalStyleVars(): Record<string, string[]> {
  return repoModel.styles.vars;
}

let usageCache: TokenUsage | null = null;
/** Which tokens are in use: read by component CSS or the library's global stylesheets, or aliased by a token in use. */
export function libraryTokenUsage(): TokenUsage {
  if (usageCache) return usageCache;
  const { primitives, all } = loadTokens();
  const byVar: Record<string, string[]> = {};
  for (const c of loadComponents()) for (const t of c.tokensUsed) (byVar[t.name] ??= []).push(c.name);
  const globalVars = globalStyleVars();
  const refs = (t: Semantic) =>
    BRANDS.flatMap((b) => MODES.flatMap((m) => t.brands[b][m].chain)).concat(t.densities ? Object.values(t.densities).flatMap((d) => d.chain) : []);
  usageCache = tokenUsage(
    [...primitives.map((p) => ({ path: p.path, cssVar: p.cssVar, refs: [] })), ...all.map((t) => ({ path: t.path, cssVar: t.cssVar, refs: refs(t) }))],
    { byVar, globalVars },
  );
  return usageCache;
}

let cache: ReturnType<typeof compute> | null = null;
export const dashboard = () => (cache ??= compute());

function compute() {
  const { primitives, semantic, brand, density, component, all } = loadTokens();
  const components = loadComponents();
  const pairs = contrastPairs();
  const total = primitives.length + all.length;

  // Donut: every token by DTCG $type.
  const typeCounts = new Map<string, number>();
  for (const t of [...primitives, ...all]) typeCounts.set(t.type, (typeCounts.get(t.type) ?? 0) + 1);
  const byType: Slice[] = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: typeLabel(key), value }));

  // Stacked bars: category x layer.
  const byCategory = CATEGORY.map((c) => ({
    key: c.key,
    label: c.label,
    primitive: primitives.filter((p) => c.match(p.segments)).length,
    semantic: semantic.filter((s) => c.match(s.segments)).length,
  })).filter((c) => c.primitive + c.semantic > 0);

  // Contrast: one check per pair per brand x theme, like the build gate.
  const checks = pairs.flatMap((p) => BRANDS.flatMap((b) => MODES.map((m) => ({ pair: p, brand: b, mode: m, result: p.brands[b][m] }))));
  const failing = checks.filter((c) => !c.result.aa);
  const aaa = checks.filter((c) => c.result.aaa === true).length;
  const contrast = {
    total: checks.length,
    pass: checks.length - failing.length,
    fail: failing.length,
    aaa,
    rate: checks.length ? (checks.length - failing.length) / checks.length : 1,
    failing,
    byMode: MODES.map((m) => ({
      mode: m,
      pass: checks.filter((c) => c.mode === m && c.result.aa).length,
      total: checks.filter((c) => c.mode === m).length,
    })),
    byCombo: BRANDS.flatMap((b) =>
      MODES.map((m) => ({
        brand: b,
        mode: m,
        pass: checks.filter((c) => c.brand === b && c.mode === m && c.result.aa).length,
        total: checks.filter((c) => c.brand === b && c.mode === m).length,
      })),
    ),
  };

  // Usage: one definition with the token explorer (@bridge-ds/core tokenUsage). A token is in use when a component
  // stylesheet or a global stylesheet of the library (base styles) reads it, or when a token in use aliases it.
  const usedVars = new Set(components.flatMap((c) => c.tokensUsed.map((t) => t.name)));
  const usage = libraryTokenUsage();
  const unusedSemantic: Semantic[] = semantic.filter((s) => !usage.used.has(s.path));
  const orphanPrimitives: Primitive[] = primitives.filter((p) => !usage.used.has(p.path));
  const deprecated = [...primitives, ...all].filter((t) => t.deprecated);
  const unknownRefs = components.flatMap((c) => c.tokensUsed.filter((t) => !t.known).map((t) => ({ component: c, name: t.name })));
  const undocumented = components.filter((c) => !c.docs);

  const issues: Issue[] = [
    ...pairs
      .filter((p) => BRANDS.some((b) => MODES.some((m) => !p.brands[b][m].aa)))
      .map((p) => {
        const bad = BRANDS.flatMap((b) => MODES.filter((m) => !p.brands[b][m].aa).map((m) => ({ b, m })));
        return {
          kind: 'contrast' as const,
          severity: 'fail' as const,
          title: `${p.fg} on ${p.bg}`,
          detail: `${bad.map(({ b, m }) => `${p.brands[b][m].ratio.toFixed(2)}:1 in ${b} ${m}`).join(', ')}. Needs ${p.min}:1 (${p.usage === 'text' ? 'text' : 'UI'}).`,
          href: studioHref('quality/'),
        };
      }),
    ...unknownRefs.map((u) => ({
      kind: 'unknown-ref' as const,
      severity: 'fail' as const,
      title: `${u.component.name} reads ${u.name}`,
      detail: 'This variable is not defined in the token sources and renders as nothing.',
      href: `/components/${u.component.slug}/#anatomy`,
    })),
    ...deprecated.map((t) => ({
      kind: 'deprecated' as const,
      severity: 'warn' as const,
      title: `${t.path} is deprecated`,
      detail: typeof t.deprecated === 'string' ? t.deprecated : 'Marked $deprecated in the token sources.',
      href: hrefForVar(t.cssVar, t.type),
    })),
    ...undocumented.map((c) => ({
      kind: 'guidance' as const,
      severity: 'warn' as const,
      title: `${c.name} has no usage guidance`,
      detail: `Add ${c.files.docs} to fill its page.`,
      href: `/components/${c.slug}/`,
    })),
    ...(unusedSemantic.length
      ? [
          {
            kind: 'unused' as const,
            severity: 'info' as const,
            title: `${unusedSemantic.length} semantic tokens not in use`,
            detail: unusedSemantic
              .slice(0, 6)
              .map((s) => s.path)
              .join(', ') + (unusedSemantic.length > 6 ? ` and ${unusedSemantic.length - 6} more` : ''),
            href: '/tokens/?layer=semantic&usage=unused',
          },
        ]
      : []),
    ...(orphanPrimitives.length
      ? [
          {
            kind: 'unused' as const,
            severity: 'info' as const,
            title: `${orphanPrimitives.length} primitives not in use`,
            detail: 'No stylesheet reads them, directly or through an alias. Candidates for cleanup, or values waiting for a job.',
            href: '/tokens/?layer=primitive&usage=unused',
          },
        ]
      : []),
  ];

  return {
    total,
    primitives: primitives.length,
    semantic: semantic.length,
    brandTokens: brand.length,
    densityTokens: density.length,
    componentTokens: component.length,
    brands: BRANDS.length,
    densities: DENSITIES.length,
    themes: MODES.length,
    themeNames: MODES,
    components: components.length,
    documented: components.length - undocumented.length,
    byType,
    byCategory,
    contrast,
    unusedSemantic,
    orphanPrimitives,
    deprecated,
    issues,
    usedVars,
  };
}

export interface RepoStatus {
  branch: string;
  sha: string;
  lastChange: string | null;
  commits: number;
}

export function repoStatus(): RepoStatus {
  const branch = process.env.VERCEL_GIT_COMMIT_REF || git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || git(['rev-parse', 'HEAD'])).slice(0, 7) || 'unknown';
  const lastChange = git(['log', '-1', '--format=%cs']) || null;
  const commits = Number(git(['rev-list', '--count', 'HEAD'])) || 0;
  return { branch, sha, lastChange, commits };
}

/** Format a YYYY-MM-DD date for humans, in English, without timezone surprises. */
export function humanDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
}
