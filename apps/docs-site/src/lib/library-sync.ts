// Update from main: how far a change is behind the library it started from, whether it conflicts, and how
// a designer resolves token conflicts ("Keep mine" or "Use the library's", the Tokens Studio yours/theirs model in
// designer words). Pure rules from GitHub API shapes (compare, pull request, rulesets) and token sets: no fetch, no
// DOM. scripts/reviews/library-sync.ts reads and writes; components/ds/studio/LibraryCatchUp.tsx paints the flow.
import { VOCAB } from './vocabulary';
import {
  type Freshness,
  COMPARE_FILE_LIMIT,
  conflictRoute,
  dismissStaleFrom,
  overlap,
  resolutionMessage,
  type BranchRuleLike,
  type CompareFile,
  type ConflictRoute,
} from '@bridge-ds/core';
import { choiceFor, formatValue, isAlias, aliasTarget, modeDisplayName, parseColor, rgbaToHex, type FlatToken, type MergeChoices, type MergeSide, type TokenMergeConflict, type TokenSet } from '@bridge-ds/core';
import { shown, type ShownValue, type TokenReview } from './token-review';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The compare, conflict-route and resolution-message rules live in @bridge-ds/core (library-update.ts), shared with
// the MCP server and the CLI.
export { COMPARE_FILE_LIMIT, conflictRoute, dismissStaleFrom, overlap, resolutionMessage, type BranchRuleLike, type CompareFile, type ConflictRoute };

// ---------------------------------------------------------------------------------------------------------------
// Behind and conflict, from the compare API and the pull request

/** GET /repos/{o}/{r}/compare/{library}...{change}: the parts Bridge reads. */
export interface CompareLike {
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  merge_base_commit?: { sha: string } | null;
  base_commit?: { sha: string; commit?: { tree?: { sha: string } } } | null;
  files?: CompareFile[];
}

// How a change stands against main: one rule with the MCP server and the CLI (@bridge-ds/core library-update).
export { freshness, type Freshness, type LibraryState } from '@bridge-ds/core';

/** "The library has moved on: 3 updates since this change started." Null when there is nothing to say. */
export function libraryLine(f: Freshness): string | null {
  if (!f.behindBy || (f.state !== 'behind' && f.state !== 'conflict')) return null;
  return `${VOCAB.Main} has moved on: ${plural(f.behindBy, 'update')} since this ${VOCAB.branch} started.`;
}

/** The row tag of the Changes list, in the words of the detail line: "The library moved on: 12 updates". Null when up to date or unknown. */
export function behindTag(behindBy: number | null | undefined): string | null {
  return behindBy && behindBy > 0 ? `${VOCAB.Main} moved on: ${plural(behindBy, 'update')}` : null;
}

/** The conflict row sentence, in designer words. `conflicts` is null while the tokens are being read. */
export function conflictLine(route: ConflictRoute, conflicts: number | null): string {
  if (route.kind === 'code') return route.alsoTokens ? `This ${VOCAB.branch} also conflicts in code. A developer resolves that part.` : `This ${VOCAB.branch} conflicts with ${VOCAB.main} in code. A developer resolves it.`;
  if (conflicts === null) return `It conflicts with ${VOCAB.main}. Reading which tokens.`;
  if (conflicts === 0) return `The same token files changed here and in ${VOCAB.main}, but no token changed on both sides. Bridge can combine them.`;
  return `${plural(conflicts, 'token')} changed here and in ${VOCAB.main}. Pick which value to keep.`;
}

/** The button of the conflict row: what the designer does next. */
export const resolveLabel = (conflicts: number) => (conflicts > 0 ? `Resolve ${plural(conflicts, 'conflict')}` : VOCAB.updateFromMain);

// ---------------------------------------------------------------------------------------------------------------
// What happens next: checks run again, approvals may need renewing

/**
 * What bringing in the library does to this change, from real data: the checks that run on it, the visual comparison
 * when it has one, and the approvals it holds against the dismissal rule. "Checks run again. GitHub dismisses
 * approvals on new commits, so the 2 approvals need renewing."
 */
export function nextSteps(input: { checks: number; visual: boolean; approvals: number; dismissStale: boolean | null }): string {
  const run = input.checks > 0 && input.visual ? 'Checks and the visual comparison run again' : input.checks > 0 ? 'Checks run again' : input.visual ? 'The visual comparison runs again' : 'Checks run on the new version';
  if (!input.approvals) return `${run}.`;
  const one = input.approvals === 1;
  if (input.dismissStale === true) return `${run}, and ${one ? 'the approval needs' : `the ${input.approvals} approvals need`} renewing.`;
  if (input.dismissStale === false) return `${run}. ${one ? 'The approval stays' : `The ${input.approvals} approvals stay`}.`;
  return `${run}. Approvals may need renewing.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Conflict rows

export interface ConflictRow {
  key: string;
  /** Token name. */
  name: string;
  /** Mode the file holds ("Light", "Ocean dark"); empty for a single-mode file. */
  context: string;
  /** Value in the latest library; null when the library removed the token. */
  library: ShownValue | null;
  /** Value in this change; null when this change removed it. */
  mine: ShownValue | null;
  /** Value before either side changed it; null when both sides added it. */
  base: ShownValue | null;
  /** Removed on one side and changed on the other: no default, the designer must pick. */
  mustPick: boolean;
  defaultChoice: MergeSide | null;
  /** Why the row looks the way it does, when the values alone do not say: "Removed in the latest library." */
  note: string | null;
}

/** Mode of a token file in a set's layout: "Light", "Ocean", "Compact", "Ocean dark", or '' for a single-mode file. */
export function fileContext(set: Pick<TokenSet, 'layout'>, file: string): string {
  const l = set.layout;
  const mode = [...l.themes, ...l.brands, ...l.densities].find((m) => m.file === file);
  if (mode) return modeDisplayName(mode.mode);
  const o = l.overrides.find((x) => x.file === file);
  return o ? `${modeDisplayName(o.brand)} ${o.theme}` : '';
}

const modeOf = (set: Pick<TokenSet, 'layout'>, file: string): string | null => {
  const l = set.layout;
  return [...l.themes, ...l.brands, ...l.densities].find((m) => m.file === file)?.mode ?? null;
};

/** A token as one side has it in one file, resolved through that side's whole set when it can be (swatch, alias). */
export function sideValue(set: TokenSet | null, file: string, flat: FlatToken | undefined): ShownValue | null {
  if (!flat) return null;
  const t = set?.byPath.get(flat.path);
  if (set && t) {
    const mode = modeOf(set, file) ?? Object.keys(t.files).find((m) => t.files[m] === file);
    if (mode && t.values[mode] !== undefined) return shown(set, t, mode);
  }
  // An override file, or a set that could not be built: the raw value as written.
  const color = flat.type === 'color' && !isAlias(flat.value) ? parseColor(flat.value) : undefined;
  return { alias: isAlias(flat.value) ? aliasTarget(flat.value) : null, css: isAlias(flat.value) ? null : formatValue(flat.type ?? 'unknown', flat.value), hex: color ? rgbaToHex(color) : null };
}

const sameShown = (a: ShownValue | null, b: ShownValue | null) => Boolean(a && b && a.alias === b.alias && a.css === b.css);

/** One row per conflicting token, values resolved in each side's set: the library, this change, and the start. */
export function conflictRows(conflicts: TokenMergeConflict[], sets: { base: TokenSet | null; mine: TokenSet | null; theirs: TokenSet | null }): ConflictRow[] {
  return conflicts.map((c) => {
    const library = sideValue(sets.theirs, c.file, c.theirs);
    const mine = sideValue(sets.mine, c.file, c.mine);
    const renamed = c.mine && c.theirs && c.mine.path !== c.theirs.path;
    const note =
      c.removedOn === 'theirs'
        ? `Removed from ${VOCAB.main}: pick one.`
        : c.removedOn === 'mine'
          ? `Removed in this ${VOCAB.branch}: pick one.`
          : renamed
            ? `Renamed to ${c.theirs!.path} in ${VOCAB.main}.`
            : sameShown(library, mine)
              ? 'Same value, different description or settings.'
              : null;
    return {
      key: c.key,
      name: c.path,
      context: sets.theirs ? fileContext(sets.theirs, c.file) : sets.mine ? fileContext(sets.mine, c.file) : '',
      library,
      mine,
      base: sideValue(sets.base, c.file, c.base),
      mustPick: c.defaultChoice === null,
      defaultChoice: c.defaultChoice,
      note,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The resolution plan

export interface Resolution {
  /** Conflicts still to pick (removed on one side, changed on the other). */
  missing: number;
  /** Conflicts that keep this change's value, and that use the library's. */
  mine: number;
  theirs: number;
  ready: boolean;
  /** "Keeps yours for 2 tokens and the library's for 1 token." or "Pick a value for 1 more token." */
  sentence: string;
}

export function resolution(conflicts: TokenMergeConflict[], choices: MergeChoices): Resolution {
  let mine = 0;
  let theirs = 0;
  let missing = 0;
  for (const c of conflicts) {
    const side = choiceFor(c, choices);
    if (side === 'mine') mine++;
    else if (side === 'theirs') theirs++;
    else missing++;
  }
  if (missing) return { missing, mine, theirs, ready: false, sentence: `Pick a value for ${plural(missing, 'more token')}.` };
  if (!conflicts.length) return { missing, mine, theirs, ready: true, sentence: 'Combines both sides: no token changed on both.' };
  const parts = [mine ? `yours for ${plural(mine, 'token')}` : '', theirs ? `${VOCAB.main}'s for ${plural(theirs, 'token')}` : ''].filter(Boolean);
  return { missing, mine, theirs, ready: true, sentence: `Keeps ${parts.join(' and ')}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// Guardrails after resolving

export interface Guardrail {
  ok: boolean;
  /** "All 296 contrast checks pass with these choices." */
  sentence: string;
  /** Failing pairs, worst first, at most `max`. */
  failing: { pair: string; where: string; ratio: string; min: string }[];
}

/** The contrast checks of the resolved tokens against the latest library, in one sentence and the failing pairs. */
export function guardrail(review: Pick<TokenReview, 'contrast' | 'checked' | 'passing' | 'problems'>, max = 4): Guardrail {
  const fails = review.contrast.filter((p) => p.after < p.min);
  const failing = fails.slice(0, max).map((p) => ({ pair: `${p.fg} on ${p.bg}`, where: p.where, ratio: `${p.after.toFixed(2)}:1`, min: `${p.min}:1` }));
  if (review.problems.length) return { ok: false, sentence: `The tokens do not build with these choices: ${review.problems[0]}`, failing };
  if (fails.length) return { ok: false, sentence: `${plural(fails.length, 'contrast check')} ${fails.length === 1 ? 'fails' : 'fail'} with these choices. The token build blocks ${fails.length === 1 ? 'it' : 'them'}: use the library's value, or fix ${fails.length === 1 ? 'it' : 'them'} in Tokens after.`, failing };
  const checked = review.checked ?? 0;
  return { ok: true, sentence: checked ? `All ${checked} contrast checks pass with these choices.` : 'No contrast check depends on these tokens.', failing };
}
