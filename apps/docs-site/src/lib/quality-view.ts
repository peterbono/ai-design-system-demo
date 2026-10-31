// Studio Quality, the view: what the redesigned page shows, from the numbers both versions of the page already compute
// (the self-hosted page from lib/stats.ts at build time, the team page from lib/team-quality.ts in the browser).
// One story first: a verdict with a mood for the lighthouse drawing (clear, haze, fog) and at most one action, then
// three pillars of the same shape (accessibility, adoption, documentation), then adoption per product with the
// earlier runs kept aside. Pure: quality-view.test.ts covers the grouping and the verdict.
import { deltaPhrase, type Finding } from './quality';
import { HEALTH_SECTION, type HealthFigure } from './library-health';

/** The weather around the lighthouse: clear when nothing needs you, haze when something needs a look, fog when it blocks. */
export type Mood = 'clear' | 'haze' | 'fog';

export interface Verdict {
  mood: Mood;
  /** The one display line (Fraunces). */
  title: string;
  /** One plain sentence under it. */
  sentence: string;
  /** The one primary action of the page: only when something needs the viewer. */
  action: { label: string; href: string } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The verdict, from the open findings (fail or warn, most severe first). Contrast failures block the token build:
 * fog, and the action takes the viewer to the failing pairs. Other open findings: haze, and the action is the first
 * one's. Nothing open: clear and no action, because nothing needs the viewer.
 */
export function qualityVerdict(input: { contrastFail: number; findings: Finding[] }): Verdict {
  const open = input.findings.filter((f) => f.severity === 'fail' || f.severity === 'warn');
  const blocking = open.filter((f) => f.severity === 'fail');
  if (input.contrastFail) {
    return {
      mood: 'fog',
      title: 'Something blocks the library',
      sentence: `${plural(input.contrastFail, 'color pair fails', 'color pairs fail')} contrast, so the token build waits until ${input.contrastFail === 1 ? 'it passes' : 'they pass'}.`,
      action: { label: 'See the failing pairs', href: `#${HEALTH_SECTION.contrast}` },
    };
  }
  if (blocking.length) {
    const first = blocking[0]!;
    return {
      mood: 'fog',
      title: 'Something blocks the library',
      sentence: blocking.length === 1 ? `${first.title.replace(/\.$/, '')}.` : `${plural(blocking.length, 'problem')} to fix, starting with ${first.title.replace(/\.$/, '')}.`,
      action: first.action ? { label: 'Fix it', href: first.action.href } : null,
    };
  }
  if (open.length) {
    const first = open[0]!;
    const label = first.action?.label === 'Review' ? 'Review guidance' : (first.action?.label ?? null);
    return {
      mood: 'haze',
      title: 'The library is healthy',
      sentence: open.length === 1 ? `Nothing blocks it. ${first.title.replace(/\.$/, '')}.` : `Nothing blocks it. ${plural(open.length, 'thing needs', 'things need')} a look, starting with ${first.title.replace(/\.$/, '')}.`,
      action: first.action && label ? { label: open.length === 1 ? label : 'Start with the first', href: first.action.href } : null,
    };
  }
  return { mood: 'clear', title: 'The library is healthy', sentence: 'Nothing blocks it and nothing needs you. Bridge checks again with every change.', action: null };
}

// ---------------------------------------------------------------------------------------------------------------
// The three pillars: the same card for each (name, one big number, a meter when the number is a ratio, one sentence,
// where to look next).

export interface Pillar {
  id: 'contrast' | 'adoption' | 'guidance';
  /** The pillar's name, the card's title. */
  name: string;
  /** The big honest number: "304 of 304", "98.9%", or words when there is nothing to count. */
  value: string;
  /** What the number counts. */
  label: string;
  /** 0 to 100 when the number is a ratio; null leaves the meter out. */
  meter: number | null;
  /** One plain sentence. */
  sentence: string;
  /** Danger only when something fails. */
  tone: 'fail' | null;
  /** Where to look next: its section further down. */
  next: { label: string; href: string };
  /**
   * The pillar's own picture, so the card shows what the number is made of instead of a meter that is full on every
   * card: the brand and theme tiles, each product's share, one dot per component. Null keeps the meter and sentence.
   */
  viz: PillarViz | null;
  /** The adoption gain since before Bridge, in points ("+90.2 pts"), next to the number. */
  delta: string | null;
}

export type PillarViz =
  | { kind: 'combos'; items: { label: string; pass: number; total: number }[] }
  | { kind: 'products'; items: { name: string; pct: number }[] }
  | { kind: 'docs'; reviewed: number; drafted: number; total: number };

export interface PillarInput {
  figures: HealthFigure[];
  contrast: { total: number; fail: number; hasChecks?: boolean };
  /** Combined component adoption now (0 to 100), null without an audit. */
  adoption: number | null;
  /** Combined adoption before Bridge, for the gain next to the number. */
  adoptionBefore?: number | null | undefined;
  /** Each product's latest component adoption, for the adoption card's rows. */
  products?: { name: string; pct: number | null }[] | undefined;
  /** The contrast checks per brand and theme, for the accessibility card's tiles. */
  combos?: { label: string; pass: number; total: number }[] | undefined;
  guidance: { total: number; reviewed: number; drafted?: number | undefined };
}

/** The pillars, in the page's order: accessibility, adoption, documentation. Each reuses its health figure's sentence. */
export function qualityPillars(input: PillarInput): Pillar[] {
  const fig = (id: HealthFigure['id']) => input.figures.find((f) => f.id === id);
  const c = input.contrast;
  const contrastFig = fig('contrast');
  const adoptionFig = fig('adoption');
  const guidanceFig = fig('guidance');
  const checks = c.hasChecks !== false && c.total > 0;
  const pass = c.total - c.fail;
  const g = input.guidance;
  const combos = checks && input.combos?.length ? input.combos : null;
  const products = (input.products ?? []).filter((p): p is { name: string; pct: number } => p.pct !== null);
  const before = input.adoption !== null && input.adoptionBefore != null ? input.adoption - input.adoptionBefore : null;
  return [
    {
      id: 'contrast',
      name: 'Accessibility',
      value: checks ? `${pass} of ${c.total}` : (contrastFig?.value ?? 'No checks yet'),
      label: checks ? 'color pairs pass contrast' : 'contrast checks',
      meter: checks ? (pass / c.total) * 100 : null,
      sentence: checks ? (contrastFig?.detail ?? '') : (contrastFig?.detail ?? 'No contrast checks are set up yet.'),
      tone: c.fail ? 'fail' : null,
      next: { label: c.fail ? 'See the failing pairs' : 'See each brand and theme', href: `#${HEALTH_SECTION.contrast}` },
      viz: combos ? { kind: 'combos', items: combos } : null,
      delta: null,
    },
    {
      id: 'adoption',
      name: 'Adoption',
      value: input.adoption === null ? (adoptionFig?.value ?? 'No audit yet') : (adoptionFig?.value ?? ''),
      label: input.adoption === null ? 'adoption in products' : 'of components come from the design system',
      meter: input.adoption,
      sentence: adoptionFig?.detail ?? 'No adoption audit has been published yet.',
      tone: null,
      next: { label: input.adoption === null ? 'How adoption is measured' : 'See each product', href: `#${HEALTH_SECTION.adoption}` },
      viz: input.adoption !== null && products.length ? { kind: 'products', items: products } : null,
      delta: before !== null && Math.abs(before) >= 0.1 ? `${before > 0 ? '+' : '−'}${Math.round(Math.abs(before) * 10) / 10} pts since Bridge` : null,
    },
    {
      id: 'guidance',
      name: 'Documentation',
      value: guidanceFig?.value ?? `${g.reviewed} of ${g.total}`,
      label: g.total ? 'components have reviewed guidance' : 'components to document',
      meter: g.total ? (g.reviewed / g.total) * 100 : null,
      sentence: guidanceFig?.detail ?? '',
      tone: null,
      next: { label: g.reviewed < g.total ? 'See what is left' : 'See the guidance', href: `#${HEALTH_SECTION.guidance}` },
      viz: g.total ? { kind: 'docs', reviewed: g.reviewed, drafted: g.drafted ?? 0, total: g.total } : null,
      delta: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Adoption per product: the latest run of each product leads, with its trend when an earlier run exists; every other
// run (the before and after of a migration, a product no longer audited) waits under Earlier runs.

export interface AdoptionRun {
  id: string;
  /** The run's own label ("Bridge admin, after migration"). */
  label: string;
  /** What groups runs into one product: the audited folder, or the app id on the self-hosted page. */
  product: string;
  /** The product's name when the caller knows it; otherwise it comes from the label. */
  productName?: string;
  /** ISO date of the run. */
  generatedAt: string;
  token: number | null;
  component: number | null;
  /** Component instances from the design system, and every UI component instance. */
  ds: number;
  ui: number;
  /** The full report. */
  href: string;
  /** The run before the product moved to Bridge (the self-hosted page knows it): the trend says so instead of a date. */
  baseline?: boolean;
}

export interface ProductAdoption {
  product: string;
  name: string;
  latest: AdoptionRun;
  /** The run before the latest, for the trend; null with one run. */
  previous: AdoptionRun | null;
  /** The first run, for the combined figure's starting point; null with one run. */
  first: AdoptionRun | null;
  /** How many runs this product has. */
  runs: number;
}

export interface AdoptionView {
  products: ProductAdoption[];
  /** Every other run, newest first. */
  earlier: AdoptionRun[];
}

/** A product's name from a run label: "Bridge admin, main" is "Bridge admin"; a label without a comma is the name. */
export function productName(label: string): string {
  const i = label.lastIndexOf(', ');
  return i > 0 ? label.slice(0, i) : label;
}

/** Runs taken by one snapshot land within seconds; an hour of slack keeps a slow workflow's runs together. */
const SAME_SNAPSHOT_MS = 60 * 60 * 1000;

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Groups runs by product. `liveSince` is when the snapshot was written: when some runs come from it, only the products
 * those runs audit are current, and a product no longer audited (a migration's original source) moves to the
 * earlier runs. Without live runs (reports carried as files), each product's latest run is current.
 */
export function adoptionView(runs: readonly AdoptionRun[], opts: { liveSince?: string } = {}): AdoptionView {
  const byProduct = new Map<string, AdoptionRun[]>();
  for (const r of runs) byProduct.set(r.product, [...(byProduct.get(r.product) ?? []), r]);
  const groups = [...byProduct.values()].map((list) => [...list].sort((a, b) => time(a.generatedAt) - time(b.generatedAt)));
  const since = opts.liveSince ? time(opts.liveSince) - SAME_SNAPSHOT_MS : null;
  const isLive = (r: AdoptionRun) => since !== null && time(r.generatedAt) >= since;
  const anyLive = runs.some(isLive);
  const current = groups.filter((g) => !anyLive || isLive(g[g.length - 1]!));
  const products: ProductAdoption[] = current
    .map((g) => {
      const latest = g[g.length - 1]!;
      return {
        product: latest.product,
        name: latest.productName ?? productName(latest.label),
        latest,
        previous: g.length > 1 ? g[g.length - 2]! : null,
        first: g.length > 1 ? g[0]! : null,
        runs: g.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = new Set(products.map((p) => p.latest));
  const earlier = runs.filter((r) => !shown.has(r)).sort((a, b) => time(b.generatedAt) - time(a.generatedAt));
  return { products, earlier };
}

/** The current products in the shape of the combined health figure: the latest run now, the first run before. */
export function adoptionFigureInput(view: AdoptionView): { now: { dsComponentInstances: number; uiComponentInstances: number }; before: { dsComponentInstances: number; uiComponentInstances: number } | null }[] {
  const m = (r: AdoptionRun) => ({ dsComponentInstances: r.ds, uiComponentInstances: r.ui });
  return view.products.map((p) => ({ now: m(p.latest), before: p.first ? m(p.first) : null }));
}

/** A run's date as the page shows it: "Oct 16, 2026". */
export const runDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
};

/** The trend of a product's components since its run before: "Up 1 point since Oct 16, 2026." Null with one run. */
export function productTrend(p: ProductAdoption): string | null {
  if (!p.previous || p.previous.component === null || p.latest.component === null) return null;
  return deltaPhrase(p.latest.component - p.previous.component, p.previous.baseline ? 'before the move to Bridge' : runDate(p.previous.generatedAt));
}

/** A percentage as the page shows it: one decimal, "n/a" when the audit has nothing to count. */
export const pctLabel = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 10) / 10}%`);

/** The calm token note: "99 tokens are not in use yet", or that every token is in use. */
export const unusedLine = (n: number) => (n === 0 ? 'Every token is in use' : `${n} ${n === 1 ? 'token is' : 'tokens are'} not in use yet`);
