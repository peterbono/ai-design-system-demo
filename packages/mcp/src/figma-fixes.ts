// Fix with Claude: the team's own Claude (Claude Code or Claude Desktop here, through the MCP server; or the CLI loop
// with the team's API key, or Bridge's server with the key the team connected) fixes components whose Figma build
// differs from their story. Here Bridge holds no key: it gives the tools and is the referee. bridge_figma_gaps lists what differs, bridge_get_gap_case gives one component's
// gap case and the fix schema, bridge_try_figma_fix runs the values referee offline (core tryFigmaFixes), and
// bridge_propose_figma_fixes opens figma-fixes.json for review like any Bridge change. The pixel referee (the story shot
// against the real Figma render) runs in the plugin's Check fidelity after the next pull.
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
  figmaGaps,
  FigmaFixesError,
  gapCaseFor,
  parseFidelityRun,
  parseFigmaFixes,
  parseMeasuredSpecsFile,
  protectedBranchesOf,
  REQUESTS_BRANCH,
  tryFigmaFixes,
  type BridgeConfig,
  type FigmaFidelityRun,
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
  fixes?: FigmaFixesFile | undefined;
  fixesPath: string;
  run?: FigmaFidelityRun | undefined;
  /** Where the run came from, in words. */
  runFrom?: string | undefined;
}

/** Reads the measure, the team's fixes and the fidelity run (the repo, else the requests branch the plugin writes to). */
export async function loadFixFiles(ctx: BridgeContext, a: FixFilesArgs): Promise<FixFiles> {
  const measuredPath = a.measured ?? MEASURED_SPECS_FILE;
  const text = await ctx.source.read(measuredPath);
  if (text === null || text === undefined)
    throw new Error(`No ${measuredPath} in the repo: measure the stories first (\`bridge specs --measure --variants --shots --storybook <url>\`), then pull in the DS Bridge Figma plugin and run Check fidelity.`);
  let measured: MeasuredSpecsFile;
  try {
    measured = parseMeasuredSpecsFile(text);
  } catch (e) {
    throw new Error(`${measuredPath}: ${(e as Error).message}. Measure again with bridge specs --measure.`);
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
      const gh = await ctx.github().catch(() => null);
      const remote = gh ? await gh.getFileText(DEFAULT_FIDELITY_RUN_FILE, REQUESTS_BRANCH).catch(() => undefined) : undefined;
      if (remote) {
        run = parseFidelityRun(remote);
        runFrom = `${DEFAULT_FIDELITY_RUN_FILE} on ${REQUESTS_BRANCH}`;
      }
    }
  }
  return { measured, measuredPath, fixes, fixesPath, run, runFrom };
}

const NO_RUN = `No Check fidelity report found (${DEFAULT_FIDELITY_RUN_FILE} in the repo or on ${REQUESTS_BRANCH}): the list comes from the measure's own check. In the DS Bridge Figma plugin, pull, run Check fidelity, then Fix with Claude (or Copy the report and pass it).`;

/** bridge_figma_gaps / `bridge gaps`: the components whose Figma build differs from their story, or cannot be checked. */
export async function figmaGapsOp(ctx: BridgeContext, a: FixFilesArgs = {}) {
  const files = await loadFixFiles(ctx, a);
  const fixed = files.fixes ? applyFixes(files.measured, files.fixes).file : files.measured;
  const gaps = figmaGaps(fixed, files.run);
  const differs = gaps.filter((g) => g.status === 'differs').length;
  return {
    referee: files.run ? 'shots' : 'values',
    ...(files.runFrom ? { report: files.runFrom, checkedAt: files.run!.report.checkedAt || undefined } : { note: NO_RUN }),
    measured: files.measuredPath,
    gaps,
    next: differs
      ? say(ctx, `Fix one: bridge_get_gap_case { component: "${gaps[0]!.component}" }, then bridge_try_figma_fix (at most ${FIX_LOOP_MAX_ROUNDS} rounds), then bridge_propose_figma_fixes.`, `Fix one: \`bridge fix ${gaps[0]!.component} --with-claude\`, or \`bridge fix ${gaps[0]!.component} --case\` to read its gap case.`)
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

/** bridge_get_gap_case / `bridge fix <component> --case`: one component's gap case and the fix schema. */
export async function getGapCaseOp(ctx: BridgeContext, a: FixFilesArgs & { component: string }) {
  const files = await loadFixFiles(ctx, a);
  const { gap, spec } = gapCaseFor({ component: a.component, measured: files.measured, fixes: files.fixes, run: files.run });
  if (!spec && !files.measured.stories.some((s) => lc(s.title.split('/').at(-1)!) === lc(a.component)))
    throw new Error(`No measured story of ${a.component} in ${files.measuredPath}. Measure it with \`bridge specs --measure --variants --shots --only ${a.component}\`.`);
  const used = roundsOf(ctx).get(lc(a.component)) ?? 0;
  return {
    gap,
    ...(files.runFrom ? { report: files.runFrom } : { note: NO_RUN }),
    schema: FIX_SCHEMA_SUMMARY,
    docs: 'docs/FIGMA-FIXES.md',
    rounds: { used, max: FIX_LOOP_MAX_ROUNDS },
    /** Ids already in figma-fixes.json: a new fix takes another id, or the same id to replace that fix. */
    fixIds: (files.fixes?.fixes ?? []).map((f) => f.id),
    next: gap.variants.length
      ? say(
          ctx,
          `Write fixes for ${gap.component} only, from the part ids and deltas above, then bridge_try_figma_fix { component, fixes }. Keep a fix only when the try says closer; after ${FIX_LOOP_MAX_ROUNDS} rounds without closer, propose a status fix (Differs or Can't check, with the reason) instead.`,
          `Write the fixes to a JSON file, then \`bridge fix ${gap.component} --try fixes.json\`; or let Claude do the rounds: \`bridge fix ${gap.component} --with-claude\`.`,
        )
      : 'Nothing differs on this component: there is nothing to fix.',
  };
}

/** bridge_try_figma_fix / `bridge fix <component> --try fixes.json`: the values referee on proposed fixes. */
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
        ? say(ctx, `Closer: propose it with bridge_propose_figma_fixes { component, fixes, summary }, or try once more to close the rest${last ? '' : ` (round ${round} of ${FIX_LOOP_MAX_ROUNDS})`}.`, `Closer: open it for review with \`bridge fix ${a.component} --propose <file> --summary "..."\`.`)
        : last
          ? say(ctx, `No closer after ${round} rounds: propose a status fix instead (kind "status", status "differs" or "cant-check", the reason in a sentence) with bridge_propose_figma_fixes.`, `No closer after ${round} rounds: propose a status fix instead (kind "status", status "differs" or "cant-check", the reason in a sentence).`)
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
 * bridge_propose_figma_fixes / `bridge fix <component> --propose fixes.json`: the accepted fixes in figma-fixes.json on
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
      hint: say(ctx, 'Try other fixes with bridge_try_figma_fix, or propose a status fix (kind "status", status "differs" or "cant-check", the reason) instead.', 'Try other fixes with `bridge fix <component> --try`, or propose a status fix (kind "status", status "differs" or "cant-check", the reason) instead.'),
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
