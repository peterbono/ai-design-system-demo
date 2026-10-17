// The Accessibility page's view of the contrast gate: pairs grouped by what they are used for, one status per pair
// and per brand x theme combo, group counts and the one-sentence summary the page opens with. Pure functions over
// the results of lib/contrast.ts, so the grouping and status rules are unit tested without reading the repo.

export interface CheckResult {
  ratio: number;
  fgHex: string;
  bgHex: string;
  aa: boolean;
  aaa: boolean | null;
}

export interface CheckPair {
  fg: string;
  bg: string;
  usage: 'text' | 'ui';
  min: number;
  /** Results per brand, then per theme. */
  brands: Record<string, Record<string, CheckResult>>;
}

export interface Combo {
  brand: string;
  mode: string;
  /** `bridge-light`: the value the page script and the markup share. */
  key: string;
  /** `Bridge light`. */
  label: string;
}

export type Status = 'aaa' | 'aa' | 'fail';

export type GroupId = 'text' | 'controls' | 'ui' | 'focus' | 'feedback' | 'charts';

/** Groups in page order. A new pair lands in a group by its token names, so the page needs no edit. */
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'text', label: 'Text on surfaces' },
  { id: 'controls', label: 'Buttons and controls' },
  { id: 'ui', label: 'UI and borders' },
  { id: 'focus', label: 'Focus' },
  { id: 'feedback', label: 'Feedback and status' },
  { id: 'charts', label: 'Charts' },
];

export function combos(brands: readonly string[], modes: readonly string[], brandLabel: Record<string, string>): Combo[] {
  return brands.flatMap((brand) => modes.map((mode) => ({ brand, mode, key: `${brand}-${mode}`, label: `${brandLabel[brand] ?? brand} ${mode}` })));
}

/** Which use a pair documents, read from its token names. */
export function groupOf(pair: Pick<CheckPair, 'fg' | 'bg' | 'usage'>): GroupId {
  const { fg } = pair;
  if (fg.startsWith('focus.')) return 'focus';
  if (fg.startsWith('color.chart.')) return 'charts';
  if (fg.startsWith('color.feedback.') || fg === 'color.text.on-solid') return 'feedback';
  if (fg.startsWith('color.action.') || fg.startsWith('color.control.')) return 'controls';
  if (fg.startsWith('color.text.')) return 'text';
  return pair.usage === 'text' ? 'text' : 'ui';
}

/** One status per result: AAA for text that reaches 7:1, AA for a pass, fail below the pair's minimum. */
export function statusOf(r: Pick<CheckResult, 'aa' | 'aaa'>): Status {
  if (!r.aa) return 'fail';
  return r.aaa ? 'aaa' : 'aa';
}

/** The chip text. The minimum shows only when it fails. */
export function statusLabel(status: Status, min: number): string {
  if (status === 'fail') return `Fails, needs ${min}`;
  return status === 'aaa' ? 'AAA' : 'AA';
}

/** Token path without the `color.` prefix, as rows show it: `text.default`. */
export function shortName(path: string): string {
  return path.replace(/^color\./, '');
}

export const resultFor = (p: CheckPair, c: Combo): CheckResult => p.brands[c.brand]![c.mode]!;

export interface GroupView {
  id: GroupId;
  label: string;
  pairs: CheckPair[];
  /** Failing pairs per combo key, and across every combo under `all`. */
  failing: Record<string, number>;
  /** Open on load: any failure, or the first group when nothing fails in it. */
  open: boolean;
}

export function buildGroups(pairs: CheckPair[], list: Combo[]): GroupView[] {
  const views = GROUPS.map((g) => {
    const mine = pairs.filter((p) => groupOf(p) === g.id);
    const failing: Record<string, number> = {};
    for (const c of list) failing[c.key] = mine.filter((p) => !resultFor(p, c).aa).length;
    failing.all = mine.filter((p) => list.some((c) => !resultFor(p, c).aa)).length;
    return { ...g, pairs: mine, failing, open: false };
  }).filter((g) => g.pairs.length > 0);
  views.forEach((g, i) => (g.open = i === 0 || g.failing.all! > 0));
  return views;
}

/** "12 pairs, all pass" or "12 pairs, 2 fail". */
export function groupStatus(count: number, failing: number): string {
  const n = `${count} ${count === 1 ? 'pair' : 'pairs'}`;
  if (failing === 0) return count === 1 ? `${n}, passes` : `${n}, all pass`;
  return `${n}, ${failing} ${failing === 1 ? 'fails' : 'fail'}`;
}

export interface Summary {
  checks: number;
  failing: number;
  brands: number;
  themes: number;
  first: { pair: CheckPair; combo: Combo; result: CheckResult } | null;
}

export function summarize(pairs: CheckPair[], list: Combo[]): Summary {
  let failing = 0;
  let first: Summary['first'] = null;
  // Page order, so the pair the sentence names is the first one the reader meets in the list.
  for (const g of GROUPS) {
    for (const p of pairs.filter((x) => groupOf(x) === g.id)) {
      for (const c of list) {
        const r = resultFor(p, c);
        if (r.aa) continue;
        failing++;
        first ??= { pair: p, combo: c, result: r };
      }
    }
  }
  return { checks: pairs.length * list.length, failing, brands: new Set(list.map((c) => c.brand)).size, themes: new Set(list.map((c) => c.mode)).size, first };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The opening sentence, from real data. */
export function statusSentence(s: Summary): string {
  const scope = `${plural(s.brands, 'brand')} and ${plural(s.themes, 'theme')}`;
  if (s.checks === 0) return 'No contrast pairs are gated yet.';
  if (!s.first) return `All ${s.checks} contrast checks pass across ${scope}.`;
  const { pair, combo, result } = s.first;
  const what = `${shortName(pair.fg)} on ${shortName(pair.bg)} in ${combo.label}, ${result.ratio.toFixed(2)}:1 where ${pair.min}:1 is needed`;
  return `${s.failing} of ${s.checks} contrast checks fail across ${scope}. First: ${what}.`;
}

/** Tooltip of a row: the hex values and what the pair needs. */
export function rowTitle(p: CheckPair, r: CheckResult): string {
  return `${r.fgHex} on ${r.bgHex}. Needs ${p.min}:1${p.usage === 'text' ? ', 7:1 for AAA' : ''}.`;
}
