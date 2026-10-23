// The change detail, designer first: what each failing check means in plain words and who acts on it, the one-line
// status of the change, and why an approval is blocked. Pure: no DOM, no fetch (scripts/reviews reads the check
// steps and annotations from GitHub and the token review from the repo). Unit tested in check-explain.test.ts.
//
// Two kinds of checks:
//   design     a design rule: contrast, token tiers and aliases (the token build and `bridge check`), visual impact.
//              The designer who made the change fixes it.
//   developer  tests, typechecks, builds, the release note. A developer fixes it; the design is not the problem.

import { VOCAB } from './vocabulary';

export type CheckKind = 'design' | 'developer';
export type CheckTopic = 'token-rules' | 'visual' | 'tests' | 'build' | 'release-note' | 'other';

/** A failing check as GitHub reports it, with what the job run says when it was read. */
export interface CheckFacts {
  name: string;
  url?: string;
  /** Name of the first failing step of the job, when the job was read. */
  step?: string | null;
  /** Failure annotations of the run (failing test cases), when read. */
  failures?: { path?: string; title?: string; message?: string }[];
}

export interface ClassifiedCheck extends CheckFacts {
  kind: CheckKind;
  topic: CheckTopic;
  /** Failing test cases named by the annotations (runner messages left out). */
  cases: { file: string; title: string; message: string }[];
}

const TOKEN_RULES = /contrast|build tokens|tokens:build|token validation|bridge check|token rules/i;
const VISUAL = /visual impact/i;
const RELEASE_NOTE = /changeset/i;
const TESTS = /\btests?\b|vitest|jest|playwright|a11y/i;
const BUILD = /typecheck|\bbuild\b|lint|compile|stylelint|eslint|package scope/i;

/** Job id of a check run from its GitHub URL (".../actions/runs/1/job/42"): the check run id. */
export function jobIdFromUrl(url: string | undefined): number | null {
  const m = url?.match(/\/job\/(\d+)(?:[/?#]|$)/);
  return m ? Number(m[1]) : null;
}

/** Failing test cases from the annotations: the runner's own lines (".github", "Process completed") are not tests. */
function casesOf(failures: CheckFacts['failures']): ClassifiedCheck['cases'] {
  return (failures ?? [])
    .filter((f) => f.path && f.path !== '.github' && !/^Process completed/.test(f.message ?? ''))
    .map((f) => {
      const title = (f.title ?? '').split(' > ').slice(1).join(' > ') || f.title || f.path!;
      return { file: f.path!, title, message: (f.message ?? '').split('\n')[0]!.trim() };
    });
}

/**
 * Design rule or developer check. The failing step decides when the job was read (a job that builds tokens before
 * its tests fails on the design rule if that step fails); otherwise the check name.
 */
export function classifyCheck(c: CheckFacts): ClassifiedCheck {
  const cases = casesOf(c.failures);
  const on = (re: RegExp) => (c.step ? re.test(c.step) : false) || (!c.step && re.test(c.name));
  let kind: CheckKind = 'developer';
  let topic: CheckTopic = 'other';
  if (on(TOKEN_RULES)) [kind, topic] = ['design', 'token-rules'];
  else if (VISUAL.test(c.name)) [kind, topic] = ['design', 'visual'];
  else if (RELEASE_NOTE.test(c.name) || on(RELEASE_NOTE)) topic = 'release-note';
  else if (on(TESTS) || cases.length) topic = 'tests';
  else if (on(BUILD)) topic = 'build';
  else if (TESTS.test(c.name)) topic = 'tests';
  return { ...c, kind, topic, cases };
}

/**
 * Every failing check is a developer check (by its name, the only fact a list row has): a developer fixes them, never
 * the designer who made the change. False when none failed or one of them is a design rule.
 */
export function developerOnlyFailures(names: string[] | null | undefined): boolean {
  return Boolean(names?.length) && names!.every((name) => classifyCheck({ name }).kind === 'developer');
}

/** What the token review says about design rules (lib/token-review), reduced to what the sentences need. */
export interface DesignFacts {
  /** Contrast checks evaluated after the change, and how many pass. */
  checked: number;
  passing: number;
  /** Failing pairs that run through a changed token, worst first. */
  failingPairs: { fg: string; bg: string; where: string; after: number; min: number }[];
  /** Token paths the change edits. */
  changedTokens: string[];
  /** Every changed token is a color. */
  colorsOnly: boolean;
  /** Broken aliases, tier or type problems in the changed token files. */
  problems: string[];
}

export interface CheckLine {
  state: 'pass' | 'fail' | 'pending';
  text: string;
}

export interface CheckStory {
  /** The design rules row, or null when nothing design-related was checked (no token review, no design check). */
  design: CheckLine | null;
  /** The developer row, or null when there are no developer checks. */
  developer: CheckLine | null;
  /** A design rule fails: the author's to fix. */
  designFails: boolean;
  /** Failing developer checks. */
  developerFailing: number;
  /** The developer failures are value checks on a token-only change: they expect the old value. */
  oldValue: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ratio = (n: number) => `${n.toFixed(2)}:1`;

/**
 * The design rules row and the developer row of the change, in plain words. `tokenOnly`: the change edits tokens and
 * nothing a developer wrote (only token files and release notes), so failing developer tests check the old value.
 */
export function checkStory(input: {
  failed: ClassifiedCheck[];
  pending: number;
  /** Checks that pass, all kinds. */
  passed: number;
  design: DesignFacts | null;
  tokenOnly: boolean;
}): CheckStory {
  const { failed, design } = input;
  const designChecks = failed.filter((c) => c.kind === 'design');
  const dev = failed.filter((c) => c.kind === 'developer');

  let designLine: CheckLine | null = null;
  const pairs = design?.failingPairs ?? [];
  if (pairs.length) {
    const w = pairs[0]!;
    const token = design!.changedTokens.length === 1 ? design!.changedTokens[0]! : 'the changed tokens';
    const more = pairs.length > 1 ? ` ${plural(pairs.length - 1, 'more pair')} ${pairs.length === 2 ? 'fails' : 'fail'} too.` : '';
    designLine = {
      state: 'fail',
      text: `${w.fg} on ${w.bg} drops to ${ratio(w.after)} in ${w.where}, below ${ratio(w.min)}.${more} Change ${token} so ${pairs.length === 1 ? 'it passes' : 'they pass'}.`,
    };
  } else if (design?.problems.length) {
    const n = design.problems.length;
    designLine = { state: 'fail', text: `${design.problems[0]}${n > 1 ? ` And ${plural(n - 1, 'more token problem')}.` : ''} Fix it in the token editor.` };
  } else if (designChecks.length) {
    const visual = designChecks.every((c) => c.topic === 'visual');
    designLine = {
      state: 'fail',
      text: visual
        ? 'The before and after could not be captured. A developer can run it again.'
        : `${designChecks.map((c) => c.name).join(' and ')} ${designChecks.length === 1 ? 'fails' : 'fail'} on a design rule. Open it on GitHub to see what it found.`,
    };
  } else if (design) {
    designLine = { state: 'pass', text: design.checked ? `${plural(design.passing, 'contrast check')} still pass.` : 'No contrast check depends on these tokens.' };
    if (design.checked && design.passing === 1) designLine.text = '1 contrast check still passes.';
  }

  let devLine: CheckLine | null = null;
  let oldValue = false;
  const n = dev.length;
  if (n) {
    const tests = dev.every((c) => c.topic === 'tests');
    const notes = dev.every((c) => c.topic === 'release-note');
    const allCases = dev.flatMap((c) => c.cases);
    // Only said when the runs were read: every failing case is an assertion (a value check), none a crash.
    const assertions = allCases.length > 0 && allCases.every((c) => /^AssertionError/.test(c.message));
    const old = design?.colorsOnly ? 'color' : 'value';
    oldValue = !notes && input.tokenOnly && designLine?.state === 'pass' && tests && assertions;
    if (notes) devLine = { state: 'fail', text: `The release note for this ${VOCAB.branch} is missing. A developer adds it.` };
    else if (oldValue)
      devLine = { state: 'fail', text: `${plural(n, 'developer test')} ${n === 1 ? 'expects' : 'expect'} the old ${old}. A developer needs to update ${n === 1 ? 'it' : 'them'}.` };
    else if (input.tokenOnly && designLine?.state === 'pass')
      devLine = { state: 'fail', text: `${plural(n, tests ? 'developer test' : 'developer check')} ${n === 1 ? 'fails' : 'fail'} on this ${VOCAB.branch}. A developer needs to look at ${n === 1 ? 'it' : 'them'}.` };
    else devLine = { state: 'fail', text: `${plural(n, tests ? 'developer test' : 'developer check')} ${n === 1 ? 'fails' : 'fail'}. A developer fixes ${n === 1 ? 'it' : 'them'}.` };
  } else if (input.pending) devLine = { state: 'pending', text: `${plural(input.pending, 'check')} still running.` };
  else if (input.passed) devLine = { state: 'pass', text: 'All pass.' };

  return { design: designLine, developer: devLine, designFails: designLine?.state === 'fail', developerFailing: n, oldValue };
}

/**
 * The one status sentence of the header while checks fail. Replaces "Your turn: fix 3 failing checks": a design
 * failure is the author's to fix; developer failures go to a developer, and design review goes on meanwhile.
 */
export function failingSentence(input: {
  story: CheckStory;
  author: string;
  viewerIsAuthor: boolean;
  /** The viewer can approve the design now. */
  viewerApprovesDesign: boolean;
  /** Approvals are still missing. */
  approvalsMissing: boolean;
  /** A designer reads who acts on failing developer checks, never which tests fail. */
  forDesigner?: boolean;
}): { sentence: string; yourTurn: boolean } {
  const { story } = input;
  if (story.designFails) {
    return input.viewerIsAuthor
      ? { sentence: 'Your turn: a design rule fails. Fix it before this can merge.', yourTurn: true }
      : { sentence: `Waiting for @${input.author} to fix a design rule.`, yourTurn: false };
  }
  const tests = plural(story.developerFailing, 'test');
  const fix = story.oldValue ? 'update' : 'fix';
  const designPasses = story.design?.state === 'pass';
  if (input.forDesigner) {
    if (input.viewerApprovesDesign) return { sentence: 'Your turn: approve the design. A developer is on the code checks meanwhile.', yourTurn: true };
    const after = input.viewerIsAuthor && input.approvalsMissing ? ' Approvals come next.' : '';
    const mine = designPasses ? (input.viewerIsAuthor ? ' Your design is not the problem.' : ' The design checks pass.') : '';
    return { sentence: `A developer is on the code checks.${mine}${after}`, yourTurn: false };
  }
  if (input.viewerApprovesDesign) return { sentence: `Your turn: approve the design. Merging waits for a developer to ${fix} ${tests}.`, yourTurn: true };
  if (input.viewerIsAuthor)
    return {
      sentence: `Waiting for a developer to ${fix} ${tests}${input.approvalsMissing ? ', and for approvals' : ''}.${designPasses ? ' Your design is not the problem.' : ''}`,
      yourTurn: false,
    };
  return { sentence: `Waiting for a developer to ${fix} ${tests}.${designPasses ? ' The design checks pass.' : ''}`, yourTurn: false };
}

/** Why an approval row waits and what the viewer can do, when the viewer is the author. */
export interface ApprovalHelp {
  /** Row text for each blocked role ("Waiting for another design owner"). */
  rowText: Partial<Record<'design' | 'tech' | 'approval', string>>;
  /** One sentence under the rows: why, then what to do. */
  why: string;
  /** Others who can approve, as "@a or @b"; empty when the author is the only owner. */
  others: string[];
}

const ROLE = { design: 'design owner', tech: 'tech owner', approval: 'reviewer' } as const;

/**
 * The author's view of a waiting approval: GitHub never lets authors approve their own change, so say so, name who
 * else can, and point at the owner override when the viewer holds it. Null when the viewer is not the author or
 * nothing waits.
 */
export function approvalHelp(input: {
  viewerIsAuthor: boolean;
  waiting: ('design' | 'tech' | 'approval')[];
  /** Who else can give each role (listed owners minus the author and anyone who approved). */
  eligible: Partial<Record<'design' | 'tech' | 'approval', string[]>>;
  /** The viewer is allowed the owner override (governance.override.allowed). */
  viewerHoldsOverride: boolean;
  /** Tests pass now, so the override is available. */
  testsPass: boolean;
}): ApprovalHelp | null {
  if (!input.viewerIsAuthor || !input.waiting.length) return null;
  const rowText: ApprovalHelp['rowText'] = {};
  const others = [...new Set(input.waiting.flatMap((r) => input.eligible[r] ?? []))];
  for (const r of input.waiting) {
    const e = input.eligible[r] ?? [];
    rowText[r] = e.length ? `Waiting for ${e.map((l) => `@${l}`).join(' or ')}` : `Waiting for another ${ROLE[r]}`;
  }
  const roles = input.waiting.length > 1 ? 'owner' : ROLE[input.waiting[0]!];
  const ask = others.length ? `Ask another ${roles}` : `No one else is ${/^[aeiou]/.test(roles) ? 'an' : 'a'} ${roles} yet: add one in Settings and ask them`;
  const override = input.viewerHoldsOverride ? (input.testsPass ? ', or merge it yourself with the owner override' : ', or merge it yourself with the owner override once tests pass') : '';
  return { rowText, why: `You made this ${VOCAB.branch}, and GitHub does not let authors approve their own. ${ask}${override}.`, others };
}

/** The message "Ask for review" copies: who it is for, what to look at, the link. */
export function reviewAskMessage(input: { title: string; number: number; url: string; roles: ('design' | 'tech' | 'approval')[]; others: string[] }): string {
  const to = input.others.length ? `${input.others.map((l) => `@${l}`).join(' ')} ` : '';
  const need = input.roles.includes('design') && input.roles.includes('tech') ? 'a design and a tech approval' : input.roles.includes('design') ? 'a design approval' : input.roles.includes('tech') ? 'a tech approval' : 'an approval';
  return `${to}Could you review "${input.title}" (#${input.number})? It needs ${need}. Bridge shows the before and after and the contrast checks: ${input.url}`;
}

/** "Merge unlocks once tests pass and the approvals are in." Plain words, no check names (they are on GitHub). */
export function shipWhen(s: { draft?: boolean; ciFail?: boolean; ciPending?: boolean; changesRequested?: boolean; missingApprovals?: number; conflict?: boolean }): string | null {
  const parts = [
    s.draft ? 'a review is requested' : '',
    s.ciFail ? 'tests pass' : s.ciPending ? 'tests finish' : '',
    s.changesRequested ? 'the requested changes are answered' : '',
    s.missingApprovals ? (s.missingApprovals > 1 ? 'the approvals are in' : 'the approval is in') : '',
    s.conflict ? 'the conflict is resolved' : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Merge unlocks once ${list}.`;
}
