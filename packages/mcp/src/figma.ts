// Components pushed from Figma, from Claude or the terminal: the library branches the DS Bridge plugin opens for a
// component changed in Figma (an exact token change, or a branch carrying the spec for Claude AI to draft), the brief to
// draft one, the "drafted by Claude AI" mark once the code is there, and the same push from a structured diff (what the
// Figma MCP server shows of a component). The same @bridge-ds/core functions the plugin calls.
import {
  aliasOf,
  baseBranchOf,
  componentContrastPairs,
  DEFAULT_COMPONENT_SPECS_FILE,
  figmaChangeOnGitHub,
  listFigmaChangesOnGitHub,
  markFigmaChangeDraftedOnGitHub,
  openComponentPushOnGitHub,
  parseComponentSpecs,
  planTokenProposal,
  specsUsage,
  suggestTokenProposalOnGitHub,
  writeTokenProposalOnGitHub,
  type ChangesMode,
  type ComponentPushDiff,
  type PushTokenContext,
} from '@bridge-ds/core';
import { branchNumber, reader, viewerOf, writer } from './branches.js';
import { appliedNext, changesFor, SUGGEST_RIGHTS, suggestionBase } from './suggestions.js';
import type { BridgeContext } from './context.js';
import { core, type TokenSet } from './core-adapter.js';
import { say } from './say.js';

const NEED = 'Contents and Pull requests: read and write';

/** Who sends from here: the MCP server speaks for an AI agent, the CLI for the person. */
export type FigmaSource = 'mcp' | 'cli';

/** Tier and usage of tokens as the code has them: the token files and component-specs.json. */
async function tokenFacts(ctx: BridgeContext, set: TokenSet, component: string): Promise<PushTokenContext> {
  const { config } = await ctx.config();
  const text = await ctx.source.read(config.components?.specs ?? DEFAULT_COMPONENT_SPECS_FILE).catch(() => undefined);
  const usage: PushTokenContext['usedElsewhere'] = text ? specsUsage(parseComponentSpecs(text), component) : () => ({ variants: [], components: [] });
  return { tierOf: (p) => set.tierOf(p), usedElsewhere: usage };
}

/** bridge_figma_changes / `bridge figma`: the library branches opened from Figma components, and where each stands. */
export async function figmaChangesOp(ctx: BridgeContext, a: { state?: 'open' | 'closed' | 'all' | undefined } = {}) {
  const gh = await reader(ctx);
  const rows = await listFigmaChangesOnGitHub(gh, { state: a.state ?? 'open' });
  return {
    changes: rows.map((r) => ({ pr: r.number, title: r.title, url: r.url, branch: r.branch, component: r.origin.component, route: r.origin.route === 'token-change' ? 'exact token change' : 'Claude AI drafts', status: r.status.label, said: r.status.sentence })),
    next: rows.some((r) => r.status.key === 'waiting-for-claude')
      ? say(ctx, 'Draft one: bridge_get_figma_change { pr } gives the spec and the steps.', 'Draft one: `bridge figma show <n>` gives the spec and the steps (--draft runs Claude Code on it).')
      : rows.length
        ? 'Owners review them on GitHub or in Bridge Studio.'
        : 'Nothing sent from Figma is open.',
  };
}

/** bridge_get_figma_change / `bridge figma show <n>`: one library branch from Figma, its spec and the brief to draft it. */
export async function getFigmaChangeOp(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await reader(ctx);
  const { config } = await ctx.config();
  const r = await figmaChangeOnGitHub(gh, n, { componentsDir: config.components?.dir });
  return {
    pr: n,
    title: r.pull.title,
    url: r.pull.url,
    branch: r.pull.headRef,
    component: r.origin.component,
    route: r.origin.route === 'token-change' ? 'exact token change' : 'Claude AI drafts',
    status: r.status.label,
    said: r.status.sentence,
    ...(r.spec ? { spec: { path: r.origin.spec, changes: r.spec.changes, variantAxes: r.spec.variantAxes, properties: r.spec.properties, tokenEdits: r.spec.tokenEdits ?? [], reasons: r.spec.reasons ?? [] } } : {}),
    ...(r.brief ? { brief: r.brief } : {}),
    next: r.brief && r.status.key === 'waiting-for-claude' ? `Follow the brief, push the code to the branch, then ${say(ctx, 'bridge_mark_figma_change_drafted', `\`bridge figma drafted ${n}\``)}.` : r.status.sentence,
  };
}

/** bridge_mark_figma_change_drafted / `bridge figma drafted <n>`: the code is on the branch, ready for review and labelled drafted by Claude AI. */
export async function markFigmaDraftedOp(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Marking a Figma change drafted', NEED);
  const r = await markFigmaChangeDraftedOnGitHub(gh, n);
  return { pr: n, status: r.status.label, said: r.status.sentence, readyForReview: r.ready, files: r.files, next: 'It is ready for review now: tell the designer it is ready to look at.' };
}

/**
 * bridge_push_figma_component / `bridge figma push <diff.json>`: the plugin's push from a structured diff. An exact token
 * swap opens a token change (same plan, contrast gate and body as bridge_propose_token_change, plus the component pairs
 * the swap moves); anything that needs code opens a draft branch with the spec for Claude AI; what cannot be read is
 * listed with what to do. dryRun shows the route.
 */
export async function pushFigmaComponentOp(ctx: BridgeContext, a: { diff: ComponentPushDiff; dryRun?: boolean | undefined; source?: FigmaSource | undefined; changes?: ChangesMode | undefined }) {
  const d = a.diff;
  if (!d || d.v !== 1 || typeof d.component !== 'string' || !Array.isArray(d.changes)) throw new Error(`The diff is not a Bridge component diff (v 1): see the spec of a branch from ${say(ctx, 'bridge_get_figma_change', '`bridge figma show <n> --json`')} for its shape.`);
  const source = a.source ?? 'mcp';
  const tool = source === 'mcp' ? 'Bridge MCP' : 'the bridge CLI';
  const { config } = await ctx.config();
  const set = await ctx.tokens();
  const tokens = await tokenFacts(ctx, set, d.component);
  const mode = await changesFor(ctx, a.changes);
  const gh = a.dryRun ? await reader(ctx) : mode === 'suggest' ? await writer(ctx, 'Suggesting a component change from Figma', SUGGEST_RIGHTS) : await writer(ctx, 'Sending a component change from Figma', NEED);
  const viewer = a.dryRun ? null : await viewerOf(ctx, gh);
  const base = a.dryRun || mode !== 'suggest' ? null : await suggestionBase(ctx, gh, config);
  const pairs = await core.readContrastPairs(ctx.source, config).catch(() => []);
  const aliasOfPath = (p: string) => aliasOf(set.defsOf(p)[0]?.value) ?? undefined;
  const r = await openComponentPushOnGitHub(gh, {
    diff: { ...d, source: d.source ?? source },
    tokens,
    base: baseBranchOf(config),
    branchPrefix: config.governance.branchPrefix,
    labels: [...config.governance.labels, `source: ${source}`],
    tool,
    dryRun: a.dryRun,
    mode,
    ...(viewer ? { suggestedBy: viewer } : {}),
    ...(base ? { base: base.ref, baseSha: base.sha } : {}),
    writeTokens: async ({ edits, title, summary, bodyExtra, mode: how, figma }) => {
      const all = [...pairs, ...componentContrastPairs(edits, pairs, { aliasOf: aliasOfPath, paths: set.allPaths() })];
      const p = planTokenProposal({ before: set, pairs: all, edits, title, summary, config, tool, bodyExtra });
      if (!p) throw new Error('The library already paints it this way: nothing to send.');
      if (p.blocked) throw new Error(`Not sent: ${p.blocked}. Pick another variable.`);
      if (how === 'suggest') {
        const b = base ?? (await suggestionBase(ctx, gh, config));
        const s = await suggestTokenProposalOnGitHub(gh, p, { base: b.ref, baseSha: b.sha, source, ...(viewer ? { suggestedBy: viewer } : {}), labels: config.governance.labels, labelsAfter: [`source: ${source}`], links: { figma } });
        return { status: 'suggested' as const, number: s.number, url: s.url };
      }
      const opened = await writeTokenProposalOnGitHub(gh, p, { base: baseBranchOf(config), branchPrefix: config.governance.branchPrefix, labels: config.governance.labels, labelsAfter: [`source: ${source}`], tool: `${tool} (source: ${source})` });
      return { number: opened.pr, url: opened.url, branch: opened.branch };
    },
  });
  const plan = r.plan;
  return {
    status: r.status,
    component: d.component,
    route: plan.route === 'token-change' ? 'exact token change' : plan.route === 'claude-draft' ? 'Claude AI drafts' : 'fix in Figma',
    said: plan.said,
    ...(plan.edits.length ? { edits: plan.edits } : {}),
    ...(plan.reasons.length ? { reasons: plan.reasons } : {}),
    ...(plan.issues.length ? { fixInFigma: plan.issues } : {}),
    changesMode: mode,
    ...(r.link ? { library: r.link } : {}),
    ...(r.suggestion ? { suggestion: r.suggestion } : {}),
    next:
      r.status === 'dry-run'
        ? `Run it without ${say(ctx, 'dryRun', '--dry-run')} to ${mode === 'suggest' ? 'file the suggestion' : 'open the library branch'}.`
        : r.status === 'not-sent'
          ? 'Nothing was sent: fix these in Figma, then push again.'
          : r.suggestion
            ? `${r.suggestion.route === 'claude-draft' ? 'A component spec suggestion: Claude AI drafts the code from it once a developer applies it (' + say(ctx, 'bridge_apply_suggestion', '`bridge apply`') + ' writes the spec file and returns the brief). ' : ''}${appliedNext(r.suggestion.number, ctx)}`
          : plan.route === 'claude-draft'
            ? `Draft the code: ${say(ctx, `bridge_get_figma_change { pr: ${r.link!.number} }`, `\`bridge figma show ${r.link!.number} --draft\``)}.`
            : 'Design and tech owners review the token change. Once it ships, a pull in the DS Bridge plugin rebuilds the component.',
  };
}
