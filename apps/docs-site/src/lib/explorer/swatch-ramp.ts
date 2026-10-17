// The visual value picker of the Studio cell editor, as pure data: the tokens a cell may point to, grouped into
// families (palette.neutral, palette.primary...) with their steps in ramp order, the family tabs to show, and where
// the current value sits. The DOM side is scripts/explorer/inline-edit.ts.

export interface SwatchInput {
  /** Token path the cell may alias, like "palette.neutral.50". */
  path: string;
  /** Resolved color in the cell's context, when the token is a color. */
  hex?: string;
  /** Resolved value as text (non-color tokens: "16px", "150ms"). */
  value?: string;
}

export interface Swatch extends SwatchInput {
  family: string;
  step: string;
  /** Short name shown on hover and in the cell: "neutral.50". */
  label: string;
}

export interface RampFamily {
  /** Family path: "palette.neutral". */
  key: string;
  /** Tab label: "Neutral". */
  label: string;
  swatches: Swatch[];
}

/** Families shown first, in this order. Others follow alphabetically. */
const ORDER = ['neutral', 'primary', 'accent', 'success', 'warning', 'danger', 'info', 'link', 'categorical'];

const familyOf = (path: string) => path.slice(0, path.lastIndexOf('.'));
const stepOf = (path: string) => path.slice(path.lastIndexOf('.') + 1);
const lastName = (key: string) => key.slice(key.lastIndexOf('.') + 1);

/** "palette.neutral.50" -> "neutral.50"; paths with two segments stay whole. */
export function swatchLabel(path: string): string {
  const parts = path.split('.');
  return parts.length >= 3 ? parts.slice(1).join('.') : path;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

function stepCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b, 'en', { numeric: true });
}

function familyRank(key: string): number {
  const i = ORDER.indexOf(lastName(key));
  return i === -1 ? ORDER.length : i;
}

/** Groups candidate tokens into families, each with its steps in ramp order (numeric steps first, ascending). */
export function rampFamilies(candidates: SwatchInput[]): RampFamily[] {
  const groups = new Map<string, Swatch[]>();
  for (const c of candidates) {
    if (!c.path.includes('.')) continue;
    const family = familyOf(c.path);
    const list = groups.get(family) ?? groups.set(family, []).get(family)!;
    list.push({ ...c, family, step: stepOf(c.path), label: swatchLabel(c.path) });
  }
  return [...groups.entries()]
    .map(([key, swatches]) => ({ key, label: capital(lastName(key)), swatches: swatches.sort((a, b) => stepCompare(a.step, b.step)) }))
    .sort((a, b) => familyRank(a.key) - familyRank(b.key) || a.key.localeCompare(b.key));
}

/** Where a value sits in the families: the alias target path, or null for a raw value or an unknown target. */
export function locateSwatch(families: RampFamily[], target: string | undefined): { family: number; index: number } | null {
  if (!target) return null;
  for (let f = 0; f < families.length; f++) {
    const index = families[f]!.swatches.findIndex((s) => s.path === target);
    if (index !== -1) return { family: f, index };
  }
  return null;
}

/**
 * Family tabs: the first `visible` families as tabs, the rest behind "More". The current family is always a tab: when
 * it lives under More, it takes the last visible slot.
 */
export function familyTabs(families: RampFamily[], current: number, visible = 3): { tabs: number[]; more: number[] } {
  const all = families.map((_, i) => i);
  const tabs = all.slice(0, visible);
  if (current >= visible && current < families.length) tabs[tabs.length - 1] = current;
  return { tabs, more: all.filter((i) => !tabs.includes(i)) };
}

/** Step labels under the ramp: the first, the 500 step (or the middle one) and the last. Empty strings elsewhere. */
export function rampTicks(swatches: Swatch[]): string[] {
  if (!swatches.length) return [];
  const mid = swatches.findIndex((s) => s.step === '500');
  const middle = mid === -1 ? Math.floor((swatches.length - 1) / 2) : mid;
  return swatches.map((s, i) => (i === 0 || i === swatches.length - 1 || i === middle ? s.step : ''));
}
