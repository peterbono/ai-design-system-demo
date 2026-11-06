// Figma gaps: what differs between a component built in Figma and its story. bridge_figma_gaps lists the components and
// bridge_get_gap_case gives one gap case, read only. The MCP server proposes no fix: tryFigmaFixOp and proposeFigmaFixesOp
// are the CLI's (`bridge fix --try`, `--propose`). The pixel referee (the story shot against the real Figma render) runs
// in the plugin's Check fidelity.
import {
  applyFixes,
  baseBranchOf,
  DEFAULT_FIDELITY_RUN_FILE,
  DEFAULT_GOVERNANCE,
  DEFAULT_FIGMA_FIXES_FILE,
  DEFAULT_MEASURED_SPECS_FILE,
  FIGMA_FIXES_LABEL as CORE_FIGMA_FIXES_LABEL,
  FIX_LOOP_MAX_ROUNDS,
  FIX_SCHEMA_SUMMARY,
  figmaFixesProposal,
  findMeasure,
  MeasureMissingError,
  MEASURE_MISSING_TEXT,
  measureFromWords,
  figmaGaps,
  FigmaFixesError,
  gapCaseFor,
  parseFidelityRun,
  runSourceNote,
  parseFigmaFixes,
  parseMeasuredSpecsFile,
  protectedBranchesOf,
  REQUESTS_BRANCH,
  storiesOfComponent,
  tryFigmaFixes,
  type BridgeConfig,
  type FigmaFidelityRun,
  type GapCase,
  type FigmaFixesFile,
  type MeasuredSpecsFile,
} from '@bridge-ds/core';
import { branchExists, commitToNewLocalBranch, currentBranch } from '@bridge-ds/core/node';
import type { BridgeContext } from './context.js';
import { readOnlyPreview, say, sourceOf, toolName, toolTag } from './say.js';

/** Where `bridge specs --measure` writes, from the repo root. */
export const MEASURED_SPECS_FILE = DEFAULT_MEASURED_SPECS_FILE;
/** The label every figma-fixes.json change carries, next to drafted-by-claude. */
export const FIGMA_FIXES_LABEL = CORE_FIGMA_FIXES_LABEL;

export interface FixFilesArgs {
  /** measured-specs.json path in the repo. */
  measured?: string | undefined;
  /** The fidelity run: a path in the repo, or the report itself (pasted from the plugin's "Copy the report"). */
  fidelity?: string | Record<string, unknown> | undefined;
  /** figma-fixes.json path in the repo. */
  fixesFile?: string | undefined;
}

export interface FixFiles {
  measured: MeasuredSpecsFile;
  measuredPath: string;
  /** Where the measure came from, in words: "measured-specs.json", or "measured-specs.json on bridge-requests". */
  measuredFrom: string;
  fixes?: FigmaFixesFile | undefined;
  fixesPath: string;
  run?: FigmaFidelityRun | undefined;
  /** Where the run came from, in words. */
  runFrom?: string | undefined;
}

/**
 * Reads the measure (the repo, else the measure branch the automatic measure publishes to), the team's fixes and the
 * fidelity run (the repo, else the requests branch the plugin writes to). No measure: MeasureMissingError, whose
 * message is the designer sentence and the steps to turn the automatic measure on.
 */
export async function loadFixFiles(ctx: BridgeContext, a: FixFilesArgs): Promise<FixFiles> {
  const measuredPath = a.measured ?? MEASURED_SPECS_FILE;
  const gh = await ctx.github().catch(() => null);
  const found = await findMeasure(
    {
      repo: (path) => ctx.source.read(path),
      // getRawText: a measure of every variant is over the 1 MB the contents API inlines.
      ...(gh ? { branch: (path: string, branch: string) => gh.getRawText(path, branch) } : {}),
    },
    measuredPath,
  );
  if (!found) throw new MeasureMissingError(gh ? `${gh.owner}/${gh.name}` : undefined, [`Until then, measure by hand: bridge specs --measure --storybook <url> --variants --shots, then commit ${measuredPath}.`]);
  const measuredFrom = measureFromWords(found);
  let measured: MeasuredSpecsFile;
  try {
    measured = parseMeasuredSpecsFile(found.text);
  } catch (e) {
    throw new Error(`${measuredFrom}: ${(e as Error).message}. Measure again with bridge specs --measure.`);
  }
  const fixesPath = a.fixesFile ?? DEFAULT_FIGMA_FIXES_FILE;
  const fixesText = await ctx.source.read(fixesPath);
  let fixes: FigmaFixesFile | undefined;
  if (fixesText) {
    try {
      fixes = parseFigmaFixes(fixesText);
    } catch (e) {
      if (e instanceof FigmaFixesError) throw new Error(`${e.message}. Fix ${fixesPath} first (${say(ctx, 'its problems are listed above', '`bridge fixes check`')}).`);
      throw e;
    }
  }
  let run: FigmaFidelityRun | undefined;
  let runFrom: string | undefined;
  if (a.fidelity && typeof a.fidelity === 'object') {
    run = parseFidelityRun(a.fidelity);
    runFrom = 'the report passed in';
  } else {
    const path = typeof a.fidelity === 'string' ? a.fidelity : DEFAULT_FIDELITY_RUN_FILE;
    const local = await ctx.source.read(path);
    if (local) {
      run = parseFidelityRun(local);
      runFrom = path;
    } else if (typeof a.fidelity === 'string') throw new Error(`No fidelity report at ${path}.`);
    else {
      // The plugin saves its Check fidelity run on the requests branch, where the designer's Claude reads it.
      const remote = gh ? await gh.getFileText(DEFAULT_FIDELITY_RUN_FILE, REQUESTS_BRANCH).catch(() => undefined) : undefined;
      if (remote) {
        run = parseFidelityRun(remote);
        runFrom = `${DEFAULT_FIDELITY_RUN_FILE} on ${REQUESTS_BRANCH}`;
      }
    }
  }
  return { measured, measuredPath, measuredFrom, fixes, fixesPath, run, runFrom };
}

const NO_RUN = `No Check fidelity report found (${DEFAULT_FIDELITY_RUN_FILE} in the repo or on ${REQUESTS_BRANCH}): the list comes from the measure's own check. In the DS Bridge Figma plugin, pull, run Check fidelity, then Fix with Claude (or Copy the report and pass it).`;

/** bridge_figma_gaps / `bridge gaps`: the components whose Figma build differs from their story, or cannot be checked. */
export async function figmaGapsOp(ctx: BridgeContext, a: FixFilesArgs = {}) {
  let files: FixFiles;
  try {
    files = await loadFixFiles(ctx, a);
  } catch (e) {
    // No measure yet: not an error to the person, a step a developer takes once. Say it as is.
    if (e instanceof MeasureMissingError) return { status: 'no-measure', say: MEASURE_MISSING_TEXT, steps: e.steps, gaps: [] };
    throw e;
  }
  const fixed = files.fixes ? applyFixes(files.measured, files.fixes).file : files.measured;
  const gaps = figmaGaps(fixed, files.run);
  const differs = gaps.filter((g) => g.status === 'differs').length;
  const sourceNote = runSourceNote(files.run);
  if (sourceNote) return { referee: 'shots', report: files.runFrom, measured: files.measuredFrom, status: 'other-source', say: sourceNote, gaps, next: sourceNote };
  return {
    referee: files.run ? 'shots' : 'values',
    ...(files.runFrom ? { report: files.runFrom, checkedAt: files.run!.report.checkedAt || undefined } : { note: NO_RUN }),
    measured: files.measuredFrom,
    gaps,
    next: differs
      ? say(ctx, `Read one: bridge_get_gap_case { component: \"${gaps[0]!.component}\" }, then say what differs in plain words.`, `Fix one: \`bridge fix ${gaps[0]!.component} --with-claude\`, or \`bridge fix ${gaps[0]!.component} --case\` to read its gap case.`)
      : gaps.length
        ? 'Nothing differs that a fix can move: the rest cannot be checked, each with its reason.'
        : 'Every checked component matches its story.',
  };
}

const sessionRounds = new WeakMap<BridgeContext, Map<string, number>>();
const roundsOf = (ctx: BridgeContext) => {
  let m = sessionRounds.get(ctx);
  if (!m) sessionRounds.set(ctx, (m = new Map()));
  return m;
};
const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The parts a gap case says are missing in Figma, in words, once each: no fix can draw them, the designer does. */
export function missingParts(gap: Pick<GapCase, 'variants'>): string[] {
  return [...new Set(gap.variants.flatMap((v) => v.differences.filter((d) => d.property === 'presence' && d.actual === 'missing').map((d) => d.partName)))];
}

/** The status fix's reason for parts missing in Figma, in designer words (the plugin shows it after "Claude can't fix this one: "). */
export function missingPartsReason(parts: readonly string[]): string {
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `The ${list} ${parts.length === 1 ? 'is' : 'are'} missing in Figma: draw ${parts.length === 1 ? 'it' : 'them'} in the component, then compare with code again.`;
}

/** bridge_get_gap_case / `bridge fix <component> --case`: one component's gap case and the fix schema. */
export async function getGapCaseOp(ctx: BridgeContext, a: FixFilesArgs & { component: string }) {
  const files = await loadFixFiles(ctx, a);
  const { gap, spec } = gapCaseFor({ component: a.component, measured: files.measured, fixes: files.fixes, run: files.run });
  if (!spec && !storiesOfComponent(files.measured, a.component).length)
    throw new Error(`No measured story of ${a.component} in ${files.measuredFrom}. Measure it with \`bridge specs --measure --variants --shots --only ${a.component}\`.`);
  const used = roundsOf(ctx).get(lc(a.component)) ?? 0;
  // A file pulled from another source than the measure: its layers are not what the case rebuilds, so no part reads as
  // missing and no fix is asked for. The sentence says how the designer moves the file onto the measure.
  const sourceNote = runSourceNote(files.run);
  const missing = sourceNote ? [] : missingParts(gap);
  return {
    gap,
    ...(sourceNote ? { status: 'other-source' as const, say: sourceNote } : {}),
    ...(files.runFrom ? { report: files.runFrom } : { note: NO_RUN }),
    ...(ctx.surface === 'cli' ? { schema: FIX_SCHEMA_SUMMARY } : {}),
    docs: 'docs/FIGMA-FIXES.md',
    rounds: { used, max: FIX_LOOP_MAX_ROUNDS },
    /** Ids already in figma-fixes.json: a new fix takes another id, or the same id to replace that fix. */
    fixIds: (files.fixes?.fixes ?? []).map((f) => f.id),
    next: sourceNote
      ? sourceNote
      : gap.variants.length
      ? say(
          ctx,
          `Say what differs on ${gap.component} in plain words, from the parts and deltas above.${missing.length ? ` Missing in Figma: ${missing.join(', ')}.` : ''}`,
          `Write the fixes to a JSON file, then \`bridge fix ${gap.component} --try fixes.json\`; or let Claude do the rounds: \`bridge fix ${gap.component} --with-claude\`.`,
        )
      : 'Nothing differs on this component: there is nothing to fix.',
  };
}

/** `bridge fix <component> --try fixes.json`: the values referee on proposed fixes. */
export async function tryFigmaFixOp(ctx: BridgeContext, a: FixFilesArgs & { component: string; fixes: unknown[] }) {
  const files = await loadFixFiles(ctx, a);
  const r = tryFigmaFixes({ component: a.component, measured: files.measured, fixes: files.fixes, run: files.run, proposed: a.fixes });
  const rounds = roundsOf(ctx);
  const round = (rounds.get(lc(a.component)) ?? 0) + 1;
  rounds.set(lc(a.component), round);
  const { file, ...result } = r;
  const last = round >= FIX_LOOP_MAX_ROUNDS;
  const next =
    r.status === 'invalid'
      ? `Fix the problems and try again (round ${round} of ${FIX_LOOP_MAX_ROUNDS}).`
      : r.verdict === 'closer'
        ? `Closer: open it for review with \`bridge fix ${a.component} --propose <file> --summary "..."\`.`
        : last
          ? `No closer after ${round} rounds: propose a status fix instead (kind "status", status "differs" or "cant-check", the reason in a sentence).`
          : `Not closer: revise with the deltas above and try again (round ${round} of ${FIX_LOOP_MAX_ROUNDS}).`;
  return {
    ...result,
    round,
    roundsLeft: Math.max(0, FIX_LOOP_MAX_ROUNDS - round),
    pixelCheck: 'Not run here: the plugin compares the story shot with the real Figma render (Check fidelity) after the next pull.',
    ...(files.runFrom ? { report: files.runFrom } : { note: NO_RUN }),
    ...(file && r.status === 'checked' ? { fixesFile: file } : {}),
    next,
  };
}

/**
 * `bridge fix <component> --propose fixes.json`: the accepted fixes in figma-fixes.json on
 * a new branch, opened for review like other Bridge changes (a draft pull request labelled drafted-by-claude and its
 * tier; locally, a bridge/* branch never pushed). The values referee runs again first: a fix that moves the component
 * further from the code is refused, and part or story fixes that move nothing are refused (propose a status fix),
 * unless they size, place or lay out a part: the values referee can't judge layout, Check fidelity decides.
 */
export async function proposeFigmaFixesOp(ctx: BridgeContext, a: FixFilesArgs & { component: string; fixes: unknown[]; summary: string; dryRun?: boolean | undefined; source?: 'mcp' | 'cli' | undefined }) {
  // A Storybook-only design system (measured, no token files) may have no bridge.config.json: Bridge's defaults then.
  const config = await ctx.config().then((c) => c.config, () => ({ governance: DEFAULT_GOVERNANCE }) as unknown as BridgeConfig);
  const files = await loadFixFiles(ctx, a);
  const source = sourceOf(ctx, a.source);
  const p = figmaFixesProposal({ component: a.component, measured: files.measured, fixes: files.fixes, run: files.run, proposed: a.fixes, summary: a.summary, config, fixesPath: files.fixesPath, tool: toolTag(source), source });
  if (p.status === 'blocked') {
    return {
      status: 'blocked',
      verdict: p.verdict,
      why: p.why,
      detail: p.detail,
      hint: 'Try other fixes with `bridge fix <component> --try`, or propose a status fix (kind "status", status "differs" or "cant-check", the reason) instead.',
    };
  }
  const { report, labels, prBody, fileContents, title, message, draft } = p;
  const after = 'Pull this branch in the DS Bridge Figma plugin and run Check fidelity: the story shot decides. A person approves the pull request.';
  if (a.dryRun) return { status: 'dry-run', ...report, labels, prBody, fileContents };

  const prefix = config.governance.branchPrefix;
  const stem = p.branchStem;
  let branch = stem;
  if (ctx.mode === 'local') {
    if (!ctx.isGit) return { status: 'preview', message: 'Not a git repo: nothing written. Write fileContents yourself.', ...report, prBody, fileContents };
    for (let i = 2; await branchExists(ctx.root!, branch); i++) branch = `${stem}-${i}`;
    const base = await currentBranch(ctx.root!);
    const protectedBranches = [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])];
    const res = await commitToNewLocalBranch(ctx.root!, { base: 'HEAD', branch, message, files: fileContents, protectedBranches, branchPrefix: prefix });
    return {
      status: 'branch-created',
      ...report,
      branch,
      base,
      commit: res.sha,
      prBody,
      labels,
      next: `Your working tree is untouched. Push ${branch} and open a draft pull request with the body above and the labels ${labels.join(', ')}. ${after}`,
    };
  }
  if (!ctx.canWriteRemote) return { status: 'preview', message: readOnlyPreview(ctx), ...report, prBody, labels, fileContents };
  const gh = (await ctx.github())!;
  const base = ctx.ref ?? baseBranchOf(config);
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = `${stem}-${i}`;
  const commit = await gh.commitToNewBranch({ base, branch, message, files: fileContents });
  const pr = await gh.createPullRequest({ base, head: branch, title, body: prBody, draft });
  await gh.addLabels(pr.number, labels);
  return { status: 'pr-opened', ...report, branch, commit: commit.sha, pr: pr.number, url: pr.url, labels, draft, next: `${after} Opened through ${toolName(source)}.` };
}
