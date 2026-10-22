// A team's Library (multi-team PR 4a): what its pages show, from the team's repo model. Pure: the island components
// (components/ds/library/*) paint it. Every string here comes from a repository Bridge does not control: it is
// coerced to plain text and reaches the page as React text only; values for inline styles go through
// safeSpecimenValue (lib/token-specimens.ts).
import { SNAPSHOT_BRANCH, SNAPSHOT_FILE, SNAPSHOT_LLMS_FILE, type RepoModel, type TokenRow } from '@bridge-ds/core';
import { safeSpecimenValue, tokenSpecimens, type SpecimenSet } from './token-specimens';
import { teamComponentRows, type TeamComponentRow } from './team-components';
import { LIBRARY_TEAM_NAV, libraryHref } from './library-shells';
import type { SearchItem } from './search';

const gh = (s: string) => encodeURIComponent(s);

/** A file on the team's bridge-data branch: the raw file for a public repository, the GitHub page for a private one
 * (the raw host answers 404 to anyone without access, and a signed-in reader's browser has no cookie there). */
export function bridgeDataUrl(owner: string, repo: string, file: string, isPrivate: boolean): string {
  return isPrivate ? `https://github.com/${gh(owner)}/${gh(repo)}/blob/${SNAPSHOT_BRANCH}/${file}` : `https://raw.githubusercontent.com/${gh(owner)}/${gh(repo)}/${SNAPSHOT_BRANCH}/${file}`;
}

/** The team's llms.txt, published next to its snapshot by `bridge snapshot`. */
export const llmsTxtUrl = (owner: string, repo: string, isPrivate: boolean) => bridgeDataUrl(owner, repo, SNAPSHOT_LLMS_FILE, isPrivate);

/** The team's snapshot.json. */
export const snapshotJsonUrl = (owner: string, repo: string, isPrivate: boolean) => bridgeDataUrl(owner, repo, SNAPSHOT_FILE, isPrivate);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- Home ------------------------------------------------------------------------------------------------------------

export interface LibraryHome {
  tokens: number;
  semantic: number;
  components: number;
  /** Components with written guidance (a docs.json). */
  documented: number;
  themes: string[];
  /** "24 components, 180 tokens, light and dark." */
  lead: string;
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function libraryHome(model: Pick<RepoModel, 'tokens' | 'components'>): LibraryHome {
  const rows = model.tokens.rows;
  const comps = model.components?.list ?? [];
  const tokens = rows.all.length;
  const semantic = rows.semantic.length;
  const documented = comps.filter((c) => c.docs).length;
  const parts = [comps.length ? plural(comps.length, 'component') : null, tokens ? plural(tokens, 'token') : null].filter(Boolean);
  const lead = parts.length ? `${list(parts as string[])}${rows.themes.length > 1 ? `, in ${list(rows.themes)}` : ''}.` : 'No tokens or components were found yet.';
  return { tokens, semantic, components: comps.length, documented, themes: rows.themes, lead };
}

// --- Foundations -----------------------------------------------------------------------------------------------------

/** The Foundations page draws more than the Studio band's glimpse; the Tokens page still has every token. */
export const FOUNDATION_LIMITS = { color: 48, type: 12, radius: 10, space: 16, shadow: 8 } as const;

export const libraryFoundations = (model: Pick<RepoModel, 'tokens'>): SpecimenSet => tokenSpecimens(model, FOUNDATION_LIMITS);

// --- Components ------------------------------------------------------------------------------------------------------

/** A guidance item ({ title, text }) as text, or null when it has no title. */
export interface LibraryGuidance {
  title: string;
  text: string;
}

/** docs.json as the Library reads it: every field coerced to text, missing lists empty. */
export interface LibraryDocs {
  summary: string;
  status: 'stable' | 'beta' | 'deprecated';
  whenToUse: string[];
  whenNotToUse: string[];
  dos: LibraryGuidance[];
  donts: LibraryGuidance[];
  accessibility: string[];
  contentGuidelines: string[];
}

const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
const texts = (x: unknown): string[] => (Array.isArray(x) ? x.map(text).filter(Boolean) : []);
const guidance = (x: unknown): LibraryGuidance[] =>
  Array.isArray(x)
    ? x.flatMap((g) => {
        const title = text((g as { title?: unknown } | null)?.title);
        return title ? [{ title, text: text((g as { text?: unknown }).text) }] : [];
      })
    : [];

/** Normalizes a docs.json read from a repository (any shape) into LibraryDocs; null when it is not an object. */
export function libraryDocs(raw: unknown): LibraryDocs | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const status = d.status === 'beta' || d.status === 'deprecated' ? d.status : 'stable';
  return {
    summary: text(d.summary),
    status,
    whenToUse: texts(d.whenToUse),
    whenNotToUse: texts(d.whenNotToUse),
    dos: guidance(d.dos),
    donts: guidance(d.donts),
    accessibility: texts(d.accessibility),
    contentGuidelines: texts(d.contentGuidelines),
  };
}

/** True when a docs.json has guidance beyond its summary. */
export const hasGuidance = (d: LibraryDocs | null): boolean =>
  !!d && d.whenToUse.length + d.whenNotToUse.length + d.dos.length + d.donts.length + d.accessibility.length + d.contentGuidelines.length > 0;

export interface LibraryComponent extends TeamComponentRow {
  docs: LibraryDocs | null;
}

/** Every component of the team, by family, with its docs. */
export function libraryComponents(model: Pick<RepoModel, 'components'>): LibraryComponent[] {
  const bySlug = new Map((model.components?.list ?? []).map((c) => [c.slug, c]));
  return teamComponentRows(model).map((r) => ({ ...r, docs: libraryDocs(bySlug.get(r.slug)?.docs) }));
}

/** The component a Library page opens (?c=<slug>), case-insensitive; undefined when there is none. */
export function componentFromQuery(list: LibraryComponent[], search: string): LibraryComponent | undefined {
  const slug = new URLSearchParams(search).get('c')?.trim().toLowerCase();
  return slug ? list.find((c) => c.slug.toLowerCase() === slug) : undefined;
}

// --- Tokens ----------------------------------------------------------------------------------------------------------

export type LibraryTier = 'semantic' | 'brand' | 'density' | 'component' | 'primitive';

export interface LibraryTokenRow {
  path: string;
  cssVar: string;
  tier: LibraryTier;
  type: string;
  description: string;
  deprecated: boolean;
  /** Values per theme (or one "value" for a primitive), each safe for an inline style or null. */
  values: { label: string; text: string; swatch: string | null }[];
}

export const TIER_LABEL: Record<LibraryTier, string> = { semantic: 'Semantic', brand: 'Brand', density: 'Density', component: 'Component', primitive: 'Primitive' };

/** Tiers in reading order: what product code uses first, the raw palette last. */
export const TIER_ORDER: LibraryTier[] = ['semantic', 'component', 'brand', 'density', 'primitive'];

const swatch = (type: string, css: string): string | null => (type === 'color' ? safeSpecimenValue(css) : null);

function roleRow(t: TokenRow): LibraryTokenRow {
  const values = Object.entries(t.densities && Object.keys(t.modes).length === 0 ? t.densities : t.modes).map(([label, v]) => ({ label, text: v.css, swatch: swatch(t.type, v.css) }));
  return { path: t.path, cssVar: t.cssVar, tier: t.tier, type: t.type, description: text(t.description), deprecated: Boolean(t.deprecated), values };
}

/** Every token of the team, tier by tier (semantic first, primitives last). */
export function libraryTokenRows(model: Pick<RepoModel, 'tokens'>): LibraryTokenRow[] {
  const rows = model.tokens.rows;
  const roles = rows.all.map(roleRow);
  const prims: LibraryTokenRow[] = rows.primitives.map((p) => ({
    path: p.path,
    cssVar: p.cssVar,
    tier: 'primitive',
    type: p.type,
    description: text(p.description),
    deprecated: false,
    values: [{ label: 'value', text: p.css, swatch: swatch(p.type, p.css) }],
  }));
  const rank = (t: LibraryTier) => TIER_ORDER.indexOf(t);
  return [...roles, ...prims].sort((a, b) => rank(a.tier) - rank(b.tier));
}

/** Tiers present in `rows`, in reading order, with their counts. */
export function tierCounts(rows: Pick<LibraryTokenRow, 'tier'>[]): { tier: LibraryTier; n: number }[] {
  return TIER_ORDER.map((tier) => ({ tier, n: rows.filter((r) => r.tier === tier).length })).filter((t) => t.n > 0);
}

/** Rows matching a search (path, CSS variable, description, value) and a tier ('' for every tier). */
export function filterTokenRows(rows: LibraryTokenRow[], query: string, tier: LibraryTier | ''): LibraryTokenRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!tier || r.tier === tier) &&
      (!q || r.path.toLowerCase().includes(q) || r.cssVar.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.values.some((v) => v.text.toLowerCase().includes(q))),
  );
}

/** The token a Tokens link opens (?t=<path>, as the search links say it), '' when there is none. */
export const tokenFromQuery = (search: string): string => new URLSearchParams(search).get('t')?.trim() ?? '';

// --- Search ----------------------------------------------------------------------------------------------------------

/**
 * The header search of a team's Library (Cmd+K, scripts/shell.ts): its four places, every component and every token,
 * from the model the page already read (no extra request). Same shape as Bridge's own /search-index.json, so the
 * palette ranks and paints both the same way. Swatches come from libraryTokenRows (safeSpecimenValue).
 */
export function librarySearchIndex(model: Pick<RepoModel, 'tokens' | 'components'>, owner: string, repo: string): SearchItem[] {
  const href = (route: string) => libraryHref(owner, repo, route);
  const pages: SearchItem[] = LIBRARY_TEAM_NAV.map((e) => ({ kind: 'page', title: e.label, href: href(e.route), meta: e.meta, keys: 'library' }));
  const components: SearchItem[] = libraryComponents(model).map((c) => ({
    kind: 'component',
    title: c.name,
    href: href(`components/?c=${encodeURIComponent(c.slug)}`),
    meta: c.summary ?? c.family,
    keys: `${c.slug} ${c.family}`,
  }));
  const tokens: SearchItem[] = libraryTokenRows(model).map((r) => {
    const swatch = r.values.find((v) => v.swatch)?.swatch ?? undefined;
    return {
      kind: 'token',
      title: r.path,
      href: href(`tokens/?t=${encodeURIComponent(r.path)}`),
      meta: `${TIER_LABEL[r.tier]}, ${r.values.map((v) => v.text).join(' / ')}`,
      keys: `${r.cssVar} ${r.values.map((v) => v.text).join(' ')}`,
      ...(swatch ? { swatch } : {}),
    };
  });
  return [...pages, ...components, ...tokens];
}

/** Above this, the Tokens table shows the first rows and a "Show all" button (a long table costs the first paint). */
export const TOKEN_PAGE = 200;

// --- Where the page was read from ------------------------------------------------------------------------------------

/** "Published Oct 20, 2026 from a1b2c3d on main." for a snapshot read as published, else null. */
export function publishedLine(input: { published?: string | undefined; sha: string; branch: string }): string | null {
  if (!input.published) return null;
  const d = new Date(input.published);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
  return `Published ${date} from ${input.sha.slice(0, 7)} on ${input.branch}.`;
}
