// New brand flow (Studio): the draft, what it becomes for the core planner, and where it is kept. Pure, so the
// docs tests cover it; the island (components/ds/studio/NewBrandFlow.tsx) renders it.
import { BRAND_FONTS, LayeredTokenSet, RADIUS_PRESETS, type BrandSource, type NewBrandInput, type NewBrandPlan, fromHex, oklch, planNewBrand, slugify, toHex, toOklch } from '@bridge-ds/core';

export const STEPS = [
  { id: 'start', label: 'Start from' },
  { id: 'colors', label: 'Colors' },
  { id: 'shape', label: 'Shape and type' },
  { id: 'review', label: 'Review' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

export interface BrandDraft {
  v: 1;
  step: number;
  name: string;
  /** Set when the slug was edited by hand; otherwise it follows the name. */
  slug?: string;
  from: string;
  primary: string;
  neutral: string;
  /** "More colors": empty means "same as primary". */
  accent: string;
  link: string;
  radius: string;
  /** Advanced radius per role, px; empty means the preset. */
  radiusRoles: Partial<Record<'inset' | 'control' | 'container' | 'overlay', number>>;
  heading: string;
  text: string;
}

export interface BrandFacts {
  slug: string;
  /** Radius preset whose roles match the brand, else the closest by control radius. */
  radius: string;
  radiusPx: { inset: number; control: number; container: number; overlay: number };
  heading: string;
  text: string;
  /** "Fraunces and Instrument Sans". */
  fonts: string;
  /** Primary action color and default text color: the seeds of a draft started from this brand. */
  primary: string;
  neutral: string;
}

/** What a starting brand brings: its corners and fonts, so the draft starts from them. */
export function brandFacts(source: BrandSource, slug: string): BrandFacts {
  const files = source.files instanceof Map ? source.files : new Map(Object.entries(source.files));
  const set = new LayeredTokenSet(source.config, files);
  const combo = set.normalizeCombo({ brand: slug });
  const px = (path: string) => parseFloat(set.resolve(path, combo).css) || 0;
  const radiusPx = { inset: px('radius.inset'), control: px('radius.control'), container: px('radius.container'), overlay: px('radius.overlay') };
  const exact = RADIUS_PRESETS.find((p) => (Object.keys(radiusPx) as (keyof typeof radiusPx)[]).every((k) => p.radius[k] === radiusPx[k]));
  const closest = [...RADIUS_PRESETS].sort((a, b) => Math.abs(a.radius.control - radiusPx.control) - Math.abs(b.radius.control - radiusPx.control))[0]!;
  const font = (path: string, fallback: string) => {
    const chain = set.resolve(path, combo).chain;
    return BRAND_FONTS.find((f) => chain.includes(f.token))?.id ?? fallback;
  };
  const heading = font('font.family.display', 'instrument-sans');
  const text = font('font.family.sans', 'instrument-sans');
  const label = (id: string) => BRAND_FONTS.find((f) => f.id === id)?.label ?? id;
  const hex = (path: string) => normalizeHex(set.resolve(path, combo).css) ?? '';
  return { slug, radius: (exact ?? closest).id, radiusPx, heading, text, fonts: heading === text ? label(text) : `${label(heading)} and ${label(text)}`, primary: hex('color.action.primary.bg'), neutral: hex('color.text.default') };
}

export const DRAFT_KEY = 'bridge.brand-draft';

/** Where a draft is kept: one per team on team pages ("owner/repo", lower case), the plain key on the self-hosted Studio. */
export const draftKey = (scope?: string | null): string => (scope ? `${DRAFT_KEY}:${scope.toLowerCase()}` : DRAFT_KEY);

export function emptyDraft(from = 'bridge', facts?: Partial<Pick<BrandFacts, 'radius' | 'heading' | 'text' | 'primary' | 'neutral'>>): BrandDraft {
  return { v: 1, step: 0, name: '', from, primary: facts?.primary ?? '', neutral: facts?.neutral ?? '', accent: '', link: '', radius: facts?.radius ?? 'soft', radiusRoles: {}, heading: facts?.heading ?? 'fraunces', text: facts?.text ?? 'instrument-sans' };
}

/** The slug: typed by hand, else derived from the name ("North Star" -> "north-star"). */
export function draftSlug(d: Pick<BrandDraft, 'name' | 'slug'>): string {
  if (d.slug !== undefined) return d.slug.trim();
  return d.name.trim() ? slugify(d.name, 24) : '';
}

export function radiusOf(d: BrandDraft) {
  const preset = RADIUS_PRESETS.find((p) => p.id === d.radius) ?? RADIUS_PRESETS[0]!;
  return { ...preset.radius, ...Object.fromEntries(Object.entries(d.radiusRoles).filter(([, v]) => typeof v === 'number')) };
}

export function draftInput(d: BrandDraft): NewBrandInput {
  const colors: NonNullable<NewBrandInput['colors']> = {};
  const accent = normalizeHex(d.accent);
  const link = normalizeHex(d.link);
  if (accent) colors.accent = accent;
  if (link) colors.link = link;
  return {
    slug: draftSlug(d),
    name: d.name.trim() || draftSlug(d),
    from: d.from,
    // A half-typed color keeps the starting brand's ramp until it is a full hex.
    ...(normalizeHex(d.primary) ? { primaryHue: normalizeHex(d.primary)! } : {}),
    ...(normalizeHex(d.neutral) ? { neutralHue: normalizeHex(d.neutral)! } : {}),
    ...(Object.keys(colors).length ? { colors } : {}),
    radius: radiusOf(d),
    fonts: { heading: d.heading, text: d.text },
  };
}

/** Plans the draft. A slug still empty plans under a placeholder so the colors can be previewed before naming. */
export function planDraft(source: BrandSource, d: BrandDraft): NewBrandPlan {
  const input = draftInput(d);
  const named = Boolean(input.slug);
  return planNewBrand(source, named ? input : { ...input, slug: 'new-brand', name: 'New brand' });
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Reads a stored draft; anything unreadable gives null. */
export function parseDraft(text: string | null, brands: string[]): BrandDraft | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text) as unknown;
    if (!isObj(d) || d.v !== 1) return null;
    const base = emptyDraft(typeof d.from === 'string' && brands.includes(d.from) ? d.from : brands[0]);
    const str = (k: keyof BrandDraft) => (typeof d[k] === 'string' ? (d[k] as string) : (base[k] as string));
    return {
      ...base,
      step: typeof d.step === 'number' && d.step >= 0 && d.step < STEPS.length ? Math.floor(d.step) : 0,
      name: str('name'),
      ...(typeof d.slug === 'string' ? { slug: d.slug } : {}),
      primary: str('primary'),
      neutral: str('neutral'),
      accent: str('accent'),
      link: str('link'),
      radius: RADIUS_PRESETS.some((p) => p.id === d.radius) ? (d.radius as string) : base.radius,
      radiusRoles: isObj(d.radiusRoles) ? (Object.fromEntries(Object.entries(d.radiusRoles).filter(([, v]) => typeof v === 'number')) as BrandDraft['radiusRoles']) : {},
      heading: BRAND_FONTS.some((f) => f.id === d.heading) ? (d.heading as string) : base.heading,
      text: BRAND_FONTS.some((f) => f.id === d.text && f.use === 'both') ? (d.text as string) : base.text,
    };
  } catch {
    return null;
  }
}

export function loadDraft(brands: string[], scope?: string | null): BrandDraft | null {
  try {
    return parseDraft(localStorage.getItem(draftKey(scope)), brands);
  } catch {
    return null;
  }
}

export function saveDraft(d: BrandDraft | null, scope?: string | null) {
  try {
    if (d) localStorage.setItem(draftKey(scope), JSON.stringify(d));
    else localStorage.removeItem(draftKey(scope));
  } catch {
    /* private mode: the draft lives as long as the page */
  }
}

/** A normalized #RRGGBB, or null. Accepts "1f5f3a" and "#1F5F3A". */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#?/, '#');
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : null;
}

/** OKLCH hue of a hex, rounded, for the hue slider. */
export const hueOf = (hex: string) => {
  const n = normalizeHex(hex);
  return n ? Math.round(toOklch(fromHex(n)).h) : 0;
};

/** The same color turned to another hue: lightness and chroma kept (gamut-mapped by the ramp engine). */
export function withHue(hex: string, hue: number): string {
  const n = normalizeHex(hex);
  if (!n) return hex;
  const { L, C } = toOklch(fromHex(n));
  return toHex(oklch(L, C, hue)).toUpperCase();
}

/** "All 148 checks pass" or "6 pairs fail": the one contrast line. */
export function contrastLine(plan: Pick<NewBrandPlan, 'contrast'>): { ok: boolean; text: string } {
  const c = plan.contrast;
  if (!c.checks) return { ok: false, text: 'Contrast not checked yet' };
  return c.failing.length ? { ok: false, text: `${c.failing.length} ${c.failing.length === 1 ? 'pair fails' : 'pairs fail'}` } : { ok: true, text: `All ${c.checks} checks pass` };
}

/** Readable name of a gated pair: "Primary button text on primary button, dark". */
export function pairLabel(fg: string, bg: string): string {
  const name = (p: string) => p.replace(/^color\./, '').replace(/^focus\.ring\.color$/, 'focus ring').split('.').join(' ');
  return `${name(fg)} on ${name(bg)}`;
}
