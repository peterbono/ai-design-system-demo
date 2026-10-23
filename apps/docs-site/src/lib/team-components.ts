// Team pages (multi-team PR 3b): the Studio Components list of a team, from its repo model. Pure: the rows, the lead
// sentence, the family filter and which Storybook story a drawer previews. TeamComponents.tsx paints them.
import { figmaCell, storybookIframeUrl, storybookManagerUrl, type RepoModel, type ScannedComponent } from '@bridge-ds/core';
import type { ComponentListRow } from '../components/ds/studio/ComponentsList';
import { productUsage, type ProductAudit } from './components-studio';
import { safeUrl } from './html';

export type TeamGuidance = 'ok' | 'review' | 'missing';

export interface TeamComponentRow {
  slug: string;
  name: string;
  family: string;
  /** docs.json summary, when the component has one. */
  summary: string | undefined;
  status: 'stable' | 'beta' | 'deprecated';
  guidance: TeamGuidance;
  stories: { name: string; id: string }[];
  /** Tokens it paints with, own and inherited. */
  tokens: number;
  /** Repo-relative folder and source file. */
  dir: string;
  file: string;
}

export const guidanceOf = (c: Pick<ScannedComponent, 'docs'>): TeamGuidance => (!c.docs ? 'missing' : c.docs.needsReview ? 'review' : 'ok');

/** The rows, by family in the barrel file's order (then alphabetical for the rest), by name inside a family. */
export function teamComponentRows(model: Pick<RepoModel, 'components'>): TeamComponentRow[] {
  const scan = model.components;
  if (!scan) return [];
  const order = new Map(scan.families.map((f, i) => [f.name, i]));
  const rank = (f: string) => order.get(f) ?? scan.families.length;
  return scan.list
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      family: c.category || 'Other',
      summary: c.docs?.summary?.trim() || undefined,
      status: c.docs?.status ?? 'stable',
      guidance: guidanceOf(c),
      stories: c.stories,
      tokens: c.allTokenPaths.length,
      dir: c.dir,
      file: c.files.tsx,
    }))
    .sort((a, b) => rank(a.family) - rank(b.family) || a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
}

/** Families in row order, with their counts. */
export function teamFamilies(rows: Pick<TeamComponentRow, 'family'>[]): { name: string; n: number }[] {
  const out: { name: string; n: number }[] = [];
  for (const r of rows) {
    const f = out.find((x) => x.name === r.family);
    if (f) f.n++;
    else out.push({ name: r.family, n: 1 });
  }
  return out;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "53 components in 9 families. 4 need guidance." */
export function teamComponentsLead(rows: Pick<TeamComponentRow, 'family' | 'guidance'>[]): string {
  const families = teamFamilies(rows).length;
  const head = `${count(rows.length, 'component')} in ${count(families, 'family', 'families')}.`;
  const missing = rows.filter((r) => r.guidance === 'missing').length;
  const review = rows.filter((r) => r.guidance === 'review').length;
  if (!missing && !review) return `${head} Every one has usage guidance.`;
  const parts = [missing ? `${missing} ${missing === 1 ? 'needs' : 'need'} guidance` : '', review ? `${count(review, 'draft')} to review` : ''].filter(Boolean);
  return `${head} ${parts.join(', ')}.`;
}

/** Rows matching a search (name, family, summary) and a family ('' is every family). */
export function filterTeamRows<T extends Pick<TeamComponentRow, 'name' | 'family' | 'summary'>>(rows: T[], query: string, family: string): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!family || r.family === family) && (!q || r.name.toLowerCase().includes(q) || r.family.toLowerCase().includes(q) || (r.summary ?? '').toLowerCase().includes(q)));
}

/** The badges of a row: only what waits for someone or is not stable. */
export function rowExceptions(r: Pick<TeamComponentRow, 'guidance' | 'status'>): { label: string; tone: 'neutral' | 'info' }[] {
  const out: { label: string; tone: 'neutral' | 'info' }[] = [];
  if (r.guidance === 'missing') out.push({ label: 'No guidance', tone: 'neutral' });
  if (r.guidance === 'review') out.push({ label: 'Draft to review', tone: 'info' });
  if (r.status === 'beta') out.push({ label: 'Beta', tone: 'neutral' });
  if (r.status === 'deprecated') out.push({ label: 'Deprecated', tone: 'neutral' });
  return out;
}

/** An https Storybook address (no trailing slash), or undefined: anything else never reaches an iframe. */
export function httpsStorybook(url: string | null | undefined): string | undefined {
  const safe = safeUrl(url ?? '');
  if (!/^https:\/\/[^\s/]+/i.test(safe)) return undefined;
  return safe.replace(/\/+$/, '');
}

/** The team's Storybook: bridge.config.json first, else the one added in this browser (quick start). */
export const pickStorybook = (fromConfig: string | undefined, fromBrowser: string | undefined): string | undefined => httpsStorybook(fromConfig) ?? httpsStorybook(fromBrowser);

/** The drawer preview of a row: its first story in an iframe, and the same story in the full Storybook. */
export function storyPreview(base: string | undefined, row: Pick<TeamComponentRow, 'stories'>): { base: string; id: string; src: string; manager: string; story: string } | null {
  const sb = httpsStorybook(base);
  const first = row.stories[0];
  if (!sb || !first) return null;
  return { base: sb, id: first.id, src: storybookIframeUrl(sb, first.id), manager: storybookManagerUrl(sb, first.id), story: first.name };
}

/**
 * The rows of the Components catalog (components/ds/studio/ComponentsList, the same list as the self-hosted Studio),
 * in `rows` order: the docs.json preview for the thumbnail, examples (stories) and tokens, the products that render
 * it from the team's adoption reports (`audits` null: no "Used in" column) and its Figma coverage from the specs file.
 */
export function teamCatalogRows(model: Pick<RepoModel, 'components' | 'specs'>, rows: TeamComponentRow[], audits: ProductAudit[] | null): ComponentListRow[] {
  const bySlug = new Map((model.components?.list ?? []).map((c) => [c.slug, c]));
  const coverage = new Map((model.specs?.coverage ?? []).map((c) => [c.name, c]));
  const used = audits?.length ? productUsage(audits, rows.map((r) => r.name)) : null;
  return rows.map((r) => {
    const c = bySlug.get(r.slug);
    return {
      slug: r.slug,
      name: r.name,
      family: r.family,
      status: r.status,
      guidance: r.guidance,
      tokensTotal: r.tokens,
      examples: r.stories.length,
      preview: c?.docs?.preview,
      usedIn: used ? (used.get(r.name) ?? []) : undefined,
      figma: figmaCell(coverage.get(r.name) ?? (c ? coverage.get(c.name) : undefined)),
    };
  });
}
