// The Library token drawer's summary, as pure functions: the description split into what a designer reads first and
// the developer note left out (install notes live on the Install page), the one plain sentence under the value ("Primitive. 9 brand
// tokens point to it, used by 36 components."), the rows of "Used by" and the files a token is defined in.
// No DOM: unit tested in detail-summary.test.ts.
import type { Tier } from '@bridge-ds/core';
import type { ComponentLink } from './model';

/** Developer sentences: package names, imports, stylesheet or JSON files, CSS variables, install commands. */
const DEV_SENTENCE = /@[\w-]+\/[\w-]|\bimport\b|\.css\b|\.json\b|\bnpm\b|var\(--|fontsource/i;

/**
 * Splits a token description into the designer lead (shown under the name) and the developer note (left
 * out of the drawer: install notes belong to the Install page). "Self-hosted via @fontsource-variable/ibm-plex-sans (import @bridge-ds/tokens/fonts.css)." is
 * all developer; "Display serif of the bridge brand. Self-hosted via ..." keeps its first sentence as the lead.
 */
export function splitDescription(text: string | undefined): { lead?: string; developer?: string } {
  const t = text?.trim();
  if (!t) return {};
  // Sentence ends: a period, ! or ? followed by a space and a capital letter (keeps "v1.2" and "fonts.css" whole).
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z(])/);
  const lead = sentences.filter((s) => !DEV_SENTENCE.test(s)).join(' ');
  const developer = sentences.filter((s) => DEV_SENTENCE.test(s)).join(' ');
  return { ...(lead ? { lead } : {}), ...(developer ? { developer } : {}) };
}

/** What the token is, in a word or two: "Primitive", "Semantic token". */
export const TIER_SINGULAR: Record<Tier, string> = {
  primitive: 'Primitive',
  brand: 'Brand token',
  base: 'Base token',
  semantic: 'Semantic token',
  density: 'Density token',
  component: 'Component token',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface SummaryInput {
  tier: Tier;
  /** Tiers of the tokens that alias this one directly, one entry per token. */
  aliasedBy: Tier[];
  components: number;
  styles: number;
  /** Brand whose brand x theme override gives the value shown, when one does. */
  overriddenBy?: string | undefined;
}

/**
 * One plain sentence: what the token is, how many tokens point to it, what uses it.
 * "Primitive. 9 brand tokens point to it, used by 36 components."
 * "Semantic token. No token points to it, used by 1 component and 1 global style."
 * "Component token. No token points to it and nothing uses it yet."
 */
export function summarySentence(s: SummaryInput): string {
  const n = s.aliasedBy.length;
  const tiers = [...new Set(s.aliasedBy)];
  const noun = tiers.length === 1 ? `${tiers[0]} token` : 'token';
  const aliases = n === 0 ? 'No token points to it' : `${plural(n, noun)} ${n === 1 ? 'points' : 'point'} to it`;
  const users = [s.components ? plural(s.components, 'component') : '', s.styles ? plural(s.styles, 'global style') : ''].filter(Boolean);
  const used = users.length ? `, used by ${users.join(' and ')}.` : n ? ', no component uses it.' : ' and nothing uses it yet.';
  const override = s.overriddenBy ? ` The ${s.overriddenBy} brand overrides its value here.` : '';
  return `${TIER_SINGULAR[s.tier]}. ${aliases}${used}${override}`;
}

export interface UsedByRow {
  name: string;
  /** Component page; undefined for a global stylesheet. */
  href?: string | undefined;
  /** The token the component reads (this one or an alias of it), or "Global style". */
  via: string;
}

/**
 * Rows of "Used by": each component with the token it actually reads (this token, or the nearest alias of it that
 * the component's CSS names), then the global stylesheets. `reads` maps a component name to the token paths its
 * CSS reads; without it, or when none matches, the row says the component reads it through an alias.
 */
export function usedByRows(path: string, dependents: string[], components: ComponentLink[], styles: string[], reads: Record<string, string[]> = {}): UsedByRow[] {
  const order = [path, ...dependents];
  const rows: UsedByRow[] = components.map((c) => {
    const own = new Set(reads[c.name] ?? []);
    const via = order.find((p) => own.has(p));
    return { name: c.name, href: c.href, via: via ?? 'Through an alias' };
  });
  return [...rows, ...styles.map((f) => ({ name: f, via: 'Global style' }))];
}

/** Component name -> token paths its CSS reads, from the components index the explorer data embeds. */
export function readsByComponent(index: Record<string, { name: string; paths: string[] }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of Object.values(index)) out[c.name] = [...(out[c.name] ?? []), ...c.paths];
  return out;
}

/** Repository paths of the files a token is defined in (one per mode, deduplicated), under the tokens root. */
export function definedIn(files: Record<string, string>, root: string): string[] {
  const prefix = root && root !== '.' ? `${root.replace(/\/$/, '')}/` : '';
  return [...new Set(Object.values(files))].map((f) => `${prefix}${f}`);
}

/** "Contrast" meta: "3 pairs, all pass", "3 pairs, 1 failing", "Not checked". */
export function contrastMeta(pairs: number, failing: number): string {
  if (!pairs) return 'Not checked';
  return `${plural(pairs, 'pair')}, ${failing ? `${failing} failing` : pairs === 1 ? 'passes' : 'all pass'}`;
}
