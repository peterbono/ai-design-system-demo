// The one contrast line of the Studio cell editor and the Contrast count of the review sheet, as pure functions:
// every checked pair the edited token takes part in (directly, or through a token that aliases it), counted once per
// foreground and background, failing when any brand and theme in scope drops below the pair's minimum.

export interface PairCheck {
  fg: string;
  bg: string;
  /** Ratio after the edit; undefined when a side does not resolve. */
  ratio: number | undefined;
  min: number;
}

export interface PairSummary {
  fg: string;
  bg: string;
  /** Lowest ratio across the contexts in scope. */
  ratio: number | undefined;
  min: number;
  passes: boolean;
}

export interface ContrastSummary {
  tone: 'pass' | 'fail' | 'none';
  /** Distinct pairs counted. */
  pairs: number;
  failing: number;
  /** The failing pair to name: text pairs before UI pairs, then the one furthest below its minimum. */
  worst?: PairSummary;
  /** The sentence the editor shows (plain text, no markup). */
  text: string;
}

/** Short name of a token in a sentence: "color.text.muted" -> "text.muted". */
export const shortName = (path: string) => path.replace(/^color\./, '');

const fmt = (n: number) => `${(Math.floor(n * 100) / 100).toFixed(2)}:1`;

/** One row per distinct foreground and background pair, with its lowest ratio across contexts. */
export function summarizePairs(checks: PairCheck[]): PairSummary[] {
  const by = new Map<string, PairSummary>();
  for (const c of checks) {
    const key = `${c.fg}|${c.bg}`;
    const prev = by.get(key);
    const ratio = prev === undefined ? c.ratio : prev.ratio === undefined || c.ratio === undefined ? undefined : Math.min(prev.ratio, c.ratio);
    const min = Math.max(prev?.min ?? 0, c.min);
    by.set(key, { fg: c.fg, bg: c.bg, ratio, min, passes: ratio !== undefined && ratio >= min });
  }
  return [...by.values()];
}

/**
 * The contrast line for an edit of `self`. Pass: "Contrast stays AA on all 13 pairs." Fail, worst pair first:
 * "text.muted on it drops to 3.71:1 (needs 4.5). 4 more pairs fail." When the edited token is the foreground:
 * "On bg.subtle it drops to ...". No pair: says so.
 */
export function contrastSummary(checks: PairCheck[], self: string): ContrastSummary {
  const pairs = summarizePairs(checks);
  if (!pairs.length) return { tone: 'none', pairs: 0, failing: 0, text: 'No checked contrast pair uses this token.' };
  const failing = pairs.filter((p) => !p.passes);
  if (!failing.length) {
    return { tone: 'pass', pairs: pairs.length, failing: 0, text: pairs.length === 1 ? 'Contrast stays AA on its 1 pair.' : `Contrast stays AA on all ${pairs.length} pairs.` };
  }
  const gap = (p: PairSummary) => (p.ratio === undefined ? -Infinity : p.ratio / p.min);
  // Text pairs first (the higher minimum), then the one furthest below its minimum.
  const worst = [...failing].sort((a, b) => b.min - a.min || gap(a) - gap(b))[0]!;
  const drop = worst.ratio === undefined ? 'no longer resolves' : `drops to ${fmt(worst.ratio)} (needs ${worst.min})`;
  const lead =
    worst.bg === self ? `${shortName(worst.fg)} on it ${drop}.` : worst.fg === self ? `On ${shortName(worst.bg)} it ${drop}.` : `${shortName(worst.fg)} on ${shortName(worst.bg)} ${drop}.`;
  const rest = failing.length - 1;
  const more = rest ? ` ${rest} more pair${rest > 1 ? 's' : ''} fail${rest > 1 ? '' : 's'}.` : '';
  return { tone: 'fail', pairs: pairs.length, failing: failing.length, worst, text: `${lead}${more}` };
}

/** The review sheet's Contrast meta: "13 pairs, all pass" or "2 of 13 pairs fail". */
export function contrastCountLine(s: Pick<ContrastSummary, 'pairs' | 'failing'>): string {
  if (!s.pairs) return 'No checked pair';
  const n = `${s.pairs} pair${s.pairs > 1 ? 's' : ''}`;
  return s.failing ? `${s.failing} of ${n} fail${s.failing > 1 ? '' : 's'}` : s.pairs === 1 ? '1 pair, passes' : `${n}, all pass`;
}

/**
 * Why the review sheet cannot send the draft, for its footer note and its button: "7 contrast pairs fail. Fix them to
 * send for review." and "Fix contrast to send". Null when nothing blocks (the button may then ask to connect GitHub).
 */
export function sendBlocked(blocking: readonly { code: string; path?: string | undefined }[], goal = 'send for review'): { note: string; button: string; contrast: boolean } | null {
  if (!blocking.length) return null;
  // One issue per pair and mode: count each pair once, as the Contrast section does.
  const contrast = blocking.filter((i) => i.code === 'contrast');
  const pairs = new Set(contrast.map((i, n) => i.path ?? String(n))).size;
  const other = blocking.length - contrast.length;
  if (pairs && !other) return { note: `${pairs} contrast ${pairs === 1 ? 'pair fails' : 'pairs fail'}. Fix ${pairs === 1 ? 'it' : 'them'} to ${goal}.`, button: 'Fix contrast to send', contrast: true };
  const n = other + pairs;
  return { note: `${n} ${n === 1 ? 'check fails' : 'checks fail'}${pairs ? `, ${pairs} of them contrast` : ''}. Fix ${n === 1 ? 'it' : 'them'} to ${goal}.`, button: 'Fix the checks to send', contrast: pairs > 0 };
}
