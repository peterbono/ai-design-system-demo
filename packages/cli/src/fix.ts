// bridge gaps / bridge fix: Fix with Claude from the terminal. The same operations as the MCP tools (packages/mcp/src/
// figma-fixes.ts): the components that differ in Figma, one gap case, the values referee on proposed fixes, and the
// change for review. `bridge fix <component> --with-claude` runs the loop with the team's own API key
// (ANTHROPIC_API_KEY), on core's loop steps (figma-fix-run.ts). Without a key it says how to run the same loop from Claude Code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { anthropicReplyText, anthropicRequest, FIX_LOOP_MAX_ROUNDS, FIX_LOOP_MODEL, fixLoopOutcome, fixLoopRound, startFixLoop, type FixLoopRound as CoreRound, type GapCase } from '@bridge-ds/core';
import { figmaFixes, type BridgeContext } from '@bridge-ds/mcp';
import { cliContext, TOKEN_HELP, type Access } from './auth.js';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export const FIX_HELP = `bridge gaps / bridge fix: Fix with Claude, for components whose Figma build differs from their story

Usage:
  bridge gaps [--json]
      The components that differ (Differs) or cannot be checked (Can't check, with the reason), from the
      plugin's latest Check fidelity run, else from the measure's own check.
  bridge fix <component> --case [--json]
      Its gap case (each difference with the part, expected code value, Figma value and delta) and the
      figma-fixes.json schema: the brief a Claude writes fixes from.
  bridge fix <component> --try <fixes.json> [--json]
      The values referee, offline: validates the fixes, lays them on the measure, rebuilds the set and
      compares each differing variant with the code, before and after (closer, same or worse).
  bridge fix <component> --propose <fixes.json> --summary "..." [--dry-run] [--json]
      figma-fixes.json with the fixes on a new branch, opened for review (a draft pull request labelled
      drafted-by-claude with a token; a local bridge/* branch otherwise, never pushed).
  bridge fix <component> --with-claude [--model ${FIX_LOOP_MODEL}] [--dry-run] [--json]
      The loop with your own Anthropic API key (ANTHROPIC_API_KEY): Claude proposes fixes from the gap case,
      Bridge tries them, Claude revises with the deltas, up to ${FIX_LOOP_MAX_ROUNDS} rounds; then the closest fixes are
      proposed, or a status fix (Differs, with the reason) when none came closer.

Files (all optional): --measured measured-specs.json, --fidelity figma-fidelity.json (the plugin's Check
fidelity run; default: in the repo, else on the bridge-requests branch), --fixes-file figma-fixes.json.
The pixel check (the story shot against the real Figma render) runs in the plugin after the next pull.
${TOKEN_HELP}
Exit codes: 0 ok, 1 not closer, blocked or no API key, 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => {
  const v = a.flags[k]?.[a.flags[k]!.length - 1];
  return v === 'true' ? undefined : v;
};
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

const files = (a: RequestArgs) => ({
  ...(flag(a, 'measured') ? { measured: flag(a, 'measured') } : {}),
  ...(flag(a, 'fidelity') ? { fidelity: flag(a, 'fidelity') } : {}),
  ...(flag(a, 'fixes-file') ? { fixesFile: flag(a, 'fixes-file') } : {}),
});

function readFixes(root: string, path: string | undefined, what: string): unknown[] {
  if (!path) throw new RequestUsageError(`${what} needs a JSON file of fix objects.\n\n${FIX_HELP}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  } catch (e) {
    throw new RequestUsageError(`${path}: ${(e as Error).message}`);
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { fixes?: unknown }).fixes)) return (data as { fixes: unknown[] }).fixes;
  throw new RequestUsageError(`${path} is not a list of fix objects (or a figma-fixes.json with "fixes").`);
}

/** Asks Claude one prompt, returns the reply text. The CLI's default uses the team's key; tests pass a fake. */
export type FixModel = (prompt: string) => Promise<string>;

/** The Messages API with the team's own key. The key goes to api.anthropic.com only. */
export function anthropicModel(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): FixModel {
  return async (prompt) => {
    const req = anthropicRequest({ apiKey, prompt, model, maxTokens: 4000 });
    const res = await fetchImpl(req.url, req.init);
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${body.error?.message ?? 'request failed'}`);
    return anthropicReplyText(body);
  };
}

export const NO_KEY = `bridge fix --with-claude uses your own Anthropic API key and none is set (ANTHROPIC_API_KEY).
Run the same loop from Claude Code instead, with the Bridge MCP server (bridge init writes .mcp.json):
  ask Claude "Fix <component> in Figma with Bridge". It calls bridge_figma_gaps, bridge_get_gap_case,
  bridge_try_figma_fix (up to ${FIX_LOOP_MAX_ROUNDS} rounds) and bridge_propose_figma_fixes, on your Claude plan.
Or set ANTHROPIC_API_KEY and run this command again.`;

export type FixLoopRound = CoreRound;

/**
 * The loop for API-key setups: Claude proposes fixes from the gap case and the schema, Bridge tries them, Claude revises
 * with the problems or the deltas, up to FIX_LOOP_MAX_ROUNDS; then the closest fixes are proposed, else a status fix.
 * The rounds are core's (fixLoopRound), the same steps Bridge's server runs with a team's connected Claude.
 */
export async function fixLoop(ctx: BridgeContext, a: { component: string; ask: FixModel; dryRun?: boolean | undefined; files?: Record<string, string | undefined> | undefined; onRound?: ((r: FixLoopRound) => void) | undefined }) {
  const f = a.files ?? {};
  const kase = await figmaFixes.getGapCaseOp(ctx, { component: a.component, ...f });
  const gap: GapCase = kase.gap;
  if (!gap.variants.length) return { status: 'nothing-to-fix' as const, summary: gap.summary, rounds: [] as FixLoopRound[] };
  const files = await figmaFixes.loadFixFiles(ctx, f);
  const input = { component: a.component, measured: files.measured, fixes: files.fixes, run: files.run };
  const rounds: FixLoopRound[] = [];
  let state = startFixLoop(a.component);
  while (!state.done) {
    const step = await fixLoopRound(input, state, a.ask, gap);
    state = step.state;
    rounds.push(step.round);
    a.onRound?.(step.round);
  }
  const outcome = fixLoopOutcome(gap, state, kase.fixIds);
  const proposed = await figmaFixes.proposeFigmaFixesOp(ctx, { component: a.component, fixes: outcome.fixes, summary: outcome.summary, dryRun: a.dryRun, source: 'cli', ...f });
  return outcome.kind === 'fixes' ? { status: 'proposed' as const, rounds, proposed } : { status: 'status-proposed' as const, rounds, proposed };
}

export async function runGaps(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  if (has(a, 'help')) return io.print(FIX_HELP), 0;
  const ctx = await cliContext(root, io, a, 'read');
  const r = await figmaFixes.figmaGapsOp(ctx, files(a));
  if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
  if ('note' in r) io.print(r.note);
  for (const g of r.gaps) io.print(`${g.component}: ${g.status === 'differs' ? 'Differs' : "Can't check"}. ${g.summary}`);
  io.print(`Next: ${r.next}`);
  return 0;
}

export async function runFix(a: RequestArgs, root: string, io: RequestIO = defaultIO(), model?: FixModel): Promise<number> {
  const component = a._[1];
  if (has(a, 'help') || component === 'help') return io.print(FIX_HELP), 0;
  if (!component) throw new RequestUsageError(`bridge fix needs a component name.\n\n${FIX_HELP}`);
  const json = has(a, 'json');
  const out = (r: unknown, text: () => void) => (json ? io.print(JSON.stringify(r, null, 2)) : text());
  const f = files(a);
  const writes = (has(a, 'propose') || has(a, 'with-claude')) && !has(a, 'dry-run');
  const access: Access = writes ? 'write' : 'read';

  if (has(a, 'with-claude')) {
    let ask = model;
    if (!ask) {
      const key = io.env.ANTHROPIC_API_KEY;
      if (!key) return io.print(NO_KEY), 1;
      ask = anthropicModel(key, flag(a, 'model') ?? FIX_LOOP_MODEL, io.fetch ?? fetch);
    }
    const ctx = await cliContext(root, io, a, access);
    const r = await fixLoop(ctx, { component, ask, dryRun: has(a, 'dry-run'), files: f, onRound: json ? undefined : (x) => io.print(`Round ${x.round}: ${x.verdict ?? 'no fixes'}. ${x.summary}`) });
    if (json) return io.print(JSON.stringify(r, null, 2)), 0;
    if (r.status === 'nothing-to-fix') return io.print(r.summary), 0;
    printProposed(io, r.proposed as Record<string, unknown>);
    return r.proposed.status === 'blocked' ? 1 : 0;
  }

  const ctx = await cliContext(root, io, a, access);
  if (has(a, 'try')) {
    const r = await figmaFixes.tryFigmaFixOp(ctx, { component, fixes: readFixes(root, flag(a, 'try'), 'bridge fix --try'), ...f });
    out(r, () => {
      io.print(r.summary);
      if (r.detail) io.print(r.detail);
      io.print(`Next: ${r.next}`);
    });
    return r.status === 'checked' && r.verdict === 'closer' ? 0 : 1;
  }
  if (has(a, 'propose')) {
    const summary = flag(a, 'summary');
    if (!summary) throw new RequestUsageError('bridge fix --propose needs --summary "...": one or two sentences for the reviewer.');
    const r = await figmaFixes.proposeFigmaFixesOp(ctx, { component, fixes: readFixes(root, flag(a, 'propose'), 'bridge fix --propose'), summary, dryRun: has(a, 'dry-run'), source: 'cli', ...f });
    if (json) return io.print(JSON.stringify(r, null, 2)), r.status === 'blocked' ? 1 : 0;
    printProposed(io, r as Record<string, unknown>);
    return r.status === 'blocked' ? 1 : 0;
  }
  // --case, or nothing: the gap case and the schema.
  const r = await figmaFixes.getGapCaseOp(ctx, { component, ...f });
  out(r, () => {
    io.print(r.gap.summary);
    if (r.gap.variants.length) io.print(`\n${r.gap.detail}`);
    if ('note' in r) io.print(`\n${r.note}`);
    io.print(`\n${r.schema}`);
    io.print(`\nNext: ${r.next}`);
  });
  return 0;
}

function printProposed(io: RequestIO, r: Record<string, unknown>) {
  if (r.status === 'blocked') {
    io.print(`Not proposed: ${String(r.why)}`);
    if (r.hint) io.print(String(r.hint));
    return;
  }
  if (r.summary) io.print(String(r.summary));
  if (r.status === 'pr-opened') io.print(`pull request: #${String(r.pr)} ${String(r.url)}`);
  if (r.branch) io.print(`branch: ${String(r.branch)}`);
  if (r.message) io.print(String(r.message));
  if (r.status === 'dry-run' || r.status === 'preview') io.print(`\n${String(r.prBody)}`);
  if (r.next) io.print(String(r.next));
}
