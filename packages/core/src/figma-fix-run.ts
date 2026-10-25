// The Claude fix loop as steps, shared by every runner: the CLI (`bridge fix --with-claude`, all rounds in one process),
// and Bridge's server (api/claude: one round per request, the state kept between requests, the team's own key). Each
// round asks Claude for fixes from the gap case and the earlier rounds, and the values referee (tryFigmaFixes) judges
// them; the outcome is the closest fixes, or an honest status fix when none came closer. The change for review
// (figmaFixesProposal) is the same for the MCP server, the CLI and the server: the referee runs again, fixes that move
// the component further from the code are refused, and figma-fixes.json goes on a bridge/figma-fixes-<component> branch
// as a draft pull request labelled drafted-by-claude and figma-fixes.
//
// Pure and browser safe, like figma-fix-loop.ts: the caller reads the files, asks Claude and writes to GitHub.

import { baseBranchOf, type BridgeConfig } from './config';
import { FIX_LOOP_MAX_ROUNDS, figmaFixesPrBody, fixPrompt, gapCaseFor, parseFixReply, statusFixFor, touchesLayout, tryFigmaFixes, type FixAttempt, type FixVerdict, type GapCaseForInput, type TriedVariant } from './figma-fix-loop';
import type { FigmaFix } from './figma-fixes';
import { DRAFTED_BY_CLAUDE_LABEL } from './figma-push';
import type { GapCase } from './gap-case';
import { classifyRisk } from './risk';

/** Where `bridge specs --measure` writes, from the repo root. */
export const DEFAULT_MEASURED_SPECS_FILE = 'measured-specs.json';
/** The label every figma-fixes.json change carries, next to drafted-by-claude. */
export const FIGMA_FIXES_LABEL = 'figma-fixes';

/** Asks Claude one prompt, returns the reply text. Runners pass the team's key; tests pass a fake. */
export type FixAsk = (prompt: string) => Promise<string>;

/** Where a loop stands between rounds: plain JSON, so a server can keep it between requests. */
export interface FixLoopState {
  component: string;
  /** Rounds done. */
  round: number;
  attempts: FixAttempt[];
  /** The closest fixes so far (verdict closer), with their score and the referee's summary. */
  best?: { fixes: unknown[]; score: number; summary: string } | undefined;
  /** No round left, or every difference resolved. */
  done: boolean;
}

export interface FixLoopRound {
  round: number;
  fixes: unknown[];
  /** invalid: the fixes broke the schema; undefined: no fixes could be read from the reply. */
  verdict?: FixVerdict | 'invalid' | undefined;
  summary: string;
}

export const startFixLoop = (component: string): FixLoopState => ({ component, round: 0, attempts: [], done: false });

/**
 * One round: Claude proposes fixes from the gap case and what the earlier rounds gave, the values referee tries them,
 * and the state keeps the closest. `ask` may throw (the network, the key): the state is then unchanged.
 */
export async function fixLoopRound(input: GapCaseForInput, state: FixLoopState, ask: FixAsk, gap: GapCase = gapCaseFor(input).gap): Promise<{ state: FixLoopState; round: FixLoopRound }> {
  if (state.done || state.round >= FIX_LOOP_MAX_ROUNDS) return { state: { ...state, done: true }, round: { round: state.round, fixes: [], summary: 'No round left.' } };
  const round = state.round + 1;
  const reply = await ask(fixPrompt(gap, state.attempts));
  const next = (attempt: FixAttempt, r: FixLoopRound, extra: Partial<FixLoopState> = {}) => {
    const s: FixLoopState = { ...state, ...extra, round, attempts: [...state.attempts, attempt] };
    if (s.round >= FIX_LOOP_MAX_ROUNDS) s.done = true;
    return { state: s, round: r };
  };
  let fixes: unknown[];
  try {
    fixes = parseFixReply(reply);
  } catch (e) {
    const msg = (e as Error).message;
    return next({ fixes: [], feedback: `${msg} Answer with a JSON array of fix objects only.` }, { round, fixes: [], summary: msg });
  }
  const tried = tryFigmaFixes({ ...input, proposed: fixes });
  if (tried.status === 'invalid') return next({ fixes, feedback: `Invalid, fix these problems:\n${tried.problems.join('\n')}` }, { round, fixes, verdict: 'invalid', summary: tried.summary });
  const r: FixLoopRound = { round, fixes, verdict: tried.verdict, summary: tried.summary };
  const attempt: FixAttempt = { fixes, feedback: `${tried.summary}\n${tried.detail}`, verdict: tried.verdict };
  if (tried.verdict !== 'closer') return next(attempt, r);
  const all = tried.variants.flatMap((v) => v.differences);
  const score = all.filter((d) => d.result === 'resolved').length * 2 + all.filter((d) => d.result === 'closer').length - tried.variants.reduce((n, v) => n + v.regressions.length, 0);
  const best = !state.best || score > state.best.score ? { fixes, score, summary: tried.summary } : state.best;
  const resolved = all.every((d) => d.result === 'resolved');
  return next(attempt, r, { best, ...(resolved ? { done: true } : {}) });
}

/** What the loop proposes once done: the closest fixes, or a status fix (Differs, with the reason) when none came closer. */
export function fixLoopOutcome(gap: GapCase, state: FixLoopState, existingIds: string[] = []): { kind: 'fixes' | 'status'; fixes: unknown[]; summary: string } {
  if (state.best) return { kind: 'fixes', fixes: state.best.fixes, summary: `Claude's fixes bring ${gap.component} closer to its story. ${state.best.summary}` };
  return {
    kind: 'status',
    fixes: [statusFixFor(gap, existingIds)],
    summary: `No fix brought ${gap.component} closer to its story in ${FIX_LOOP_MAX_ROUNDS} rounds: it keeps an honest Differs status with the reason.`,
  };
}

const slug = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'component';

/** The branch a component's fixes go on (a number is added when it is taken): bridge/figma-fixes-text-input. */
export const figmaFixesBranchStem = (config: BridgeConfig, component: string) => `${config.governance.branchPrefix}figma-fixes-${slug(component)}`;

export interface FigmaFixesProposalInput extends GapCaseForInput {
  /** The fixes to propose (fix objects; the repo's fixes with the same ids are replaced). */
  proposed: unknown[];
  /** One or two sentences a reviewer reads first. */
  summary: string;
  config: BridgeConfig;
  /** figma-fixes.json path in the repo. */
  fixesPath: string;
  /** Who drafted it, for the body and the commit: "Bridge MCP (source: mcp)". */
  tool: string;
  /** The `source:` label: mcp, cli, studio. */
  source: string;
}

export interface FigmaFixesReport {
  component: string;
  verdict: FixVerdict;
  summary: string;
  variants: TriedVariant[];
  fixes: string[];
  tier: number;
  prTitle: string;
}

export type FigmaFixesProposal =
  | { status: 'blocked'; verdict: FixVerdict; why: string; detail: string; component: string }
  | {
      status: 'ready';
      report: FigmaFixesReport;
      /** The accepted fixes as validated. */
      fixes: FigmaFix[];
      labels: string[];
      prBody: string;
      fileContents: { path: string; content: string }[];
      title: string;
      message: string;
      /** Tier 2 and above open as a draft. */
      draft: boolean;
      /** The default branch it targets. */
      base: string;
      branchStem: string;
    };

/**
 * The change for review of proposed fixes. The values referee runs again first: a fix that moves the component further
 * from the code is refused, and part or story fixes that move nothing are refused (propose a status fix), unless they
 * size, place or lay out a part: the values referee can't judge layout, Check fidelity decides. Throws a sentence when
 * the fixes are invalid or the summary is not one.
 */
export function figmaFixesProposal(input: FigmaFixesProposalInput): FigmaFixesProposal {
  const { config } = input;
  const tried = tryFigmaFixes(input);
  if (tried.status === 'invalid') throw new Error(`Not proposed: ${tried.problems.join('; ')}.`);
  const summary = (input.summary ?? '').trim();
  if (summary.length < 8) throw new Error('Not proposed: summary is one or two sentences a reviewer reads first (what the fixes do for the designer).');
  if (/—/.test(summary)) throw new Error('Not proposed: the summary uses an em dash: use a colon or a comma.');
  const ids = new Set((input.proposed as { id?: string }[]).map((f) => f.id));
  const proposed = tried.file!.fixes.filter((f) => ids.has(f.id));
  const { gap } = gapCaseFor(input);
  const drawing = proposed.some((f) => f.kind === 'part' || f.kind === 'story' || (f.kind === 'axis' && f.action !== 'map'));
  const measurable = gap.variants.some((v) => v.differences.length);
  if (tried.verdict === 'worse' || (drawing && measurable && tried.verdict === 'same' && !proposed.some(touchesLayout))) {
    return {
      status: 'blocked',
      verdict: tried.verdict,
      why: `${tried.summary} Bridge does not open fixes that move ${gap.component} ${tried.verdict === 'worse' ? 'further from' : 'no closer to'} the code.`,
      detail: tried.detail,
      component: gap.component,
    };
  }
  const content = `${JSON.stringify(tried.file, null, 2)}\n`;
  const fileContents = [{ path: input.fixesPath, content }];
  const risk = classifyRisk({ files: [{ path: input.fixesPath, status: input.fixes ? 'modified' : 'added' }], config });
  const prBody = `${figmaFixesPrBody({ component: gap.component, summary, gap, tried, fixes: proposed, tool: input.tool })}\n\nRisk: ${risk.label}.`;
  const title = `fix(figma): ${gap.component} drawn closer to its story`;
  const message = `${title}\n\n${summary}\n\nFixes: ${proposed.map((f) => f.id).join(', ')}. Drafted by Claude through ${input.tool}.`;
  const labels = [...new Set([...config.governance.labels, `tier: ${risk.tier}`, `source: ${input.source}`, FIGMA_FIXES_LABEL, DRAFTED_BY_CLAUDE_LABEL])];
  const report: FigmaFixesReport = { component: gap.component, verdict: tried.verdict, summary: tried.summary, variants: tried.variants, fixes: proposed.map((f) => f.id), tier: risk.tier, prTitle: title };
  return { status: 'ready', report, fixes: proposed, labels, prBody, fileContents, title, message, draft: risk.tier >= 2, base: baseBranchOf(config), branchStem: figmaFixesBranchStem(config, gap.component) };
}
