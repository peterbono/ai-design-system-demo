// The component pages of a Library (Components index and one component), for any repo model: what the shared views
// (components/ds/library/views/ComponentsView.tsx, ComponentView.tsx) show on top of the component scan. The release
// notes that name a component, its token counts, the story its previews play, and the Storybook addresses of those
// previews (decision D2: every Library previews a component with the team's own Storybook, Bridge's included).
// Pure and browser-safe: model data and releases come in as arguments.
import { motionDocs, storybookIframeUrl, type ChangelogReleaseRow, type ComponentDocs, type GuidanceItem, type MotionDocs, type RepoModel } from '@bridge-ds/core';
import { loadComponents, type ComponentInfo } from './components';
import { DENSITY_LABEL, tokenAxes } from './tokens';

/** The tabs of a component page, in order. Motion sits in Tokens, as "Motion and interaction". */
export const COMPONENT_TABS = [
  { id: 'usage', label: 'Usage' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'code', label: 'Code' },
  { id: 'changelog', label: 'Changelog' },
] as const;

/** Section anchors from before the tabs, and the tab that now holds each. */
export const LEGACY_ANCHORS: Readonly<Record<string, string>> = {
  anatomy: 'tokens',
  motion: 'tokens',
  props: 'code',
  playground: 'code',
  live: 'code',
  'do-dont': 'usage',
  accessibility: 'usage',
  changes: 'changelog',
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/i;

/** The component slug of a team Library component address, /library/<owner>/<repo>/components/<slug>/; else null. */
export function componentSlugFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'library' || parts[3] !== 'components' || !parts[4] || parts.length > 5) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(parts[4]);
  } catch {
    return null;
  }
  return SLUG.test(slug) ? slug.toLowerCase() : null;
}

/** The component of a model by slug, case-insensitive. */
export const componentBySlug = (model: RepoModel, slug: string): ComponentInfo | undefined => {
  const s = slug.toLowerCase();
  return loadComponents(model).find((c) => c.slug.toLowerCase() === s);
};

export type ComponentStatus = 'stable' | 'beta' | 'deprecated';

export const statusOf = (c: Pick<ComponentInfo, 'docs'>): ComponentStatus => c.docs?.status ?? 'stable';
export const STATUS_TONE: Record<ComponentStatus, 'success' | 'info' | 'warning'> = { stable: 'success', beta: 'info', deprecated: 'warning' };
export const STATUS_LABEL: Record<ComponentStatus, string> = { stable: 'Stable', beta: 'Beta', deprecated: 'Deprecated' };

/** "Forms" -> "forms": the anchor of a family on the Components page (#fam-forms). */
export const familySlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every component by family, in scan order (the barrel file's), with how many have usage guidance. */
export function componentGroups(model: RepoModel): { groups: { family: string; list: ComponentInfo[] }[]; total: number; documented: number } {
  const list = loadComponents(model);
  const groups: { family: string; list: ComponentInfo[] }[] = [];
  for (const c of list) {
    const family = c.category || 'Other';
    const g = groups.find((x) => x.family === family);
    if (g) g.list.push(c);
    else groups.push({ family, list: [c] });
  }
  return { groups, total: list.length, documented: list.filter((c) => c.docs).length };
}

/** The tokens a component reads, by tier: what changes with theme and brand, with density, and the shared scales. */
export function tokenKindCounts(c: Pick<ComponentInfo, 'tokensUsed'>): { semantic: number; density: number; primitive: number } {
  const n = (kinds: string[]) => c.tokensUsed.filter((t) => t.kind !== undefined && kinds.includes(t.kind)).length;
  return { semantic: n(['semantic', 'component']), density: n(['density']), primitive: n(['primitive', 'brand']) };
}

export interface ComponentNote {
  kind: string;
  title: string;
  /** The release it shipped in ("@bridge-ds/react 1.6.0", "Coming in the next release"). */
  release: string;
  date?: string | undefined;
}

/** Release notes that name a component (in their title or a package), newest first. */
export function componentNotes(name: string, releases: readonly Pick<ChangelogReleaseRow, 'name' | 'date' | 'entries'>[]): ComponentNote[] {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return releases.flatMap((r) =>
    r.entries.filter((e) => re.test(e.title) || e.packages.some((p) => re.test(p))).map((e) => ({ kind: e.kind, title: e.title, release: r.name, date: e.date ?? r.date })),
  );
}

/**
 * The "Motion and interaction" rows of a component: the snapshot's when it carries them, else read from the model's
 * specs file (the same reading the snapshot makes). Null when the specs have an unexpected shape.
 */
export function componentMotion(model: RepoModel, c: Pick<ComponentInfo, 'name' | 'tokenPaths'>, fromSnapshot?: Record<string, MotionDocs>): MotionDocs | null {
  const snap = fromSnapshot?.[c.name];
  if (snap) return snap;
  try {
    return motionDocs(c.name, model.specs?.file?.components ?? [], model.specs?.coverage.find((x) => x.name === c.name), c.tokenPaths);
  } catch {
    return null;
  }
}

/** The story a component's previews play: its first story. */
export const mainStory = (c: Pick<ComponentInfo, 'stories'>) => c.stories[0];

/** Values a Storybook `args=` address accepts as they are; anything else is left out (Storybook would drop it). */
const ARG_VALUE = /^[A-Za-z0-9 _-]*$/;

/**
 * Playground values as Storybook story args: booleans as `!true` / `!false`, plain strings as they are. Strings
 * Storybook refuses in an address (punctuation, accents) are left out: the story keeps its own value for them.
 */
export function storyArgs(values: Readonly<Record<string, string | boolean>>, children?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    if (typeof v === 'boolean') out[k] = v ? '!true' : '!false';
    else if (v !== '' && ARG_VALUE.test(v)) out[k] = v;
  }
  if (children && ARG_VALUE.test(children)) out.children = children;
  return out;
}

export interface PreviewScope {
  theme: string;
  brand?: string | undefined;
  density?: string | undefined;
}

/** A story rendered alone in one theme (and brand and density, when known), with optional args. */
export function previewUrl(storybook: string, storyId: string, scope: PreviewScope, args?: Record<string, string>): string {
  const globals: Record<string, string> = { theme: scope.theme };
  if (scope.brand) globals.brand = scope.brand;
  if (scope.density) globals.density = scope.density;
  return storybookIframeUrl(storybook, storyId, { globals, ...(args && Object.keys(args).length ? { args } : {}) });
}

const texts = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []);
const items = (x: unknown): GuidanceItem[] =>
  Array.isArray(x)
    ? x.flatMap((g) => {
        const o = (g && typeof g === 'object' ? g : {}) as Partial<GuidanceItem>;
        if (typeof o.title !== 'string' || !o.title.trim()) return [];
        return [{ title: o.title, text: typeof o.text === 'string' ? o.text : '', ...(o.example !== undefined ? { example: o.example } : {}) }];
      })
    : [];

/**
 * A docs.json as a page can show it: every prose field text (a repository Bridge does not control may write any
 * shape), lists empty when missing. Well-formed docs come back with the same content. Null without docs.
 */
export function readableDocs(docs: ComponentDocs | null | undefined): ComponentDocs | null {
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return null;
  const status = docs.status === 'beta' || docs.status === 'deprecated' ? docs.status : 'stable';
  return {
    ...docs,
    summary: typeof docs.summary === 'string' ? docs.summary : '',
    status,
    whenToUse: texts(docs.whenToUse),
    whenNotToUse: texts(docs.whenNotToUse),
    dos: items(docs.dos),
    donts: items(docs.donts),
    accessibility: texts(docs.accessibility),
    contentGuidelines: texts(docs.contentGuidelines),
  };
}

/** The brands and densities a preview can switch between, the default first, with their labels. */
export function previewScopes(model: RepoModel): { brands: { value: string; label: string }[]; densities: { value: string; label: string }[] } {
  const { brands, brandLabels, densities } = tokenAxes(model);
  const first = model.tokens.rows.defaultBrand;
  const ordered = [...brands].sort((a, b) => Number(b === first) - Number(a === first));
  return {
    brands: ordered.map((b) => ({ value: b, label: brandLabels[b] ?? b })),
    densities: densities.map((d) => ({ value: d, label: DENSITY_LABEL[d] ?? d })),
  };
}
