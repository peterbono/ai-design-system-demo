// Product branches and the library, from Claude or the terminal: what a product branch invents outside the library
// (missing pieces), the library branch each piece opens (linked both ways), the library preview the product branch
// uses, and the switch to the published version. The same @bridge-ds/core functions Studio calls; finding the pieces
// runs the adoption audit on the branch diff against main, which Studio cannot do in the browser.
import {
  baseBranchOf,
  NEEDED_BY_LABEL,
  openLibraryBranchOnGitHub,
  planTokenProposal,
  productBranchViewOnGitHub,
  productsOf,
  readProductBranchOnGitHub,
  recordPiecesOnGitHub,
  switchToPublishedOnGitHub,
  useLibraryPreviewOnGitHub,
  suggestTokenProposalOnGitHub,
  writeTokenProposalOnGitHub,
  type ChangesMode,
  type GitHubClient,
  type LibraryBranchPlan,
  type LibraryTokenWrite,
  type MissingPiece,
} from '@bridge-ds/core';
import { missingPieces } from '@bridge-ds/core/audit';
import { branchNumber, reader, viewerOf, writer } from './branches.js';
import type { BridgeContext } from './context.js';
import { core } from './core-adapter.js';
import { settingsOf } from './explorations.js';
import { appliedNext, changesFor, SUGGEST_RIGHTS, suggestionBase } from './suggestions.js';
import { designSystemIndex } from './ops.js';

const NEED = 'Contents, Pull requests and Issues: read and write';

/** Who opens library branches from here: the MCP server speaks for an AI agent, the CLI for the person. */
export type PiecesSource = 'mcp' | 'cli';

const short = (p: MissingPiece) => ({
  id: p.id,
  kind: p.kind,
  title: p.title,
  summary: p.summary,
  ...(p.component ? { component: p.component } : {}),
  ...(p.nearest ? { nearest: `${p.nearest.label} (${p.nearest.token}, ${p.nearest.value})` } : {}),
  ...(p.token ? { token: p.token.path } : {}),
  where: p.where.map((w) => `${w.file}:${w.line}`),
  opens: p.kind === 'token' ? 'a token change' : p.kind === 'variant' ? 'a library exploration' : 'a component request',
});

/**
 * bridge_missing_pieces / `bridge pieces <n>`: the audit on each product file the branch changes, at its start and at its
 * head, keeping what the branch added that the library lacks. With `record`, saves the result in the branch body
 * (Studio's product branch page reads it there), keeping the library branches already opened.
 */
export async function missingPiecesOp(ctx: BridgeContext, a: { pr: number | string; record?: boolean | undefined }) {
  const n = branchNumber(a.pr);
  const gh = a.record ? await writer(ctx, 'Recording the missing pieces', NEED) : await reader(ctx);
  const { config } = await ctx.config();
  const read = await readProductBranchOnGitHub(gh, n, { products: productsOf(config) });
  const [ds, set] = await Promise.all([designSystemIndex(ctx), ctx.tokens()]);
  const r = missingPieces({ files: read.files, ds, set });
  const recorded = a.record ? await recordPiecesOnGitHub(gh, n, { pieces: r.pieces, fixes: r.fixes.length, headSha: read.pull.headSha }) : null;
  const linked = recorded?.links ?? read.record?.links ?? [];
  return {
    pr: n,
    branch: read.pull.headRef,
    product: read.product.name,
    files: r.files,
    ...(read.skipped ? { skipped: `${read.skipped} more product files were not read (limit ${r.files}).` } : {}),
    pieces: r.pieces.map((p) => ({ ...short(p), ...(linked.some((l) => l.piece === p.id) ? { linked: linked.find((l) => l.piece === p.id)!.number } : {}) })),
    fixes: { count: r.fixes.length, sample: r.fixes.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.what} -> use ${f.use}`) },
    recorded: Boolean(recorded),
    next: r.pieces.length
      ? `${a.record ? '' : 'Record them (record: true) so Studio shows them, then '}open a library branch for each with bridge_open_library_branch { pr: ${n}, piece: "<id>" }. Fixes are values and components the library already has: use them in the product code instead.`
      : 'Nothing is missing from the library. Fix the values that equal a token, if any.',
  };
}

/**
 * The token change of a token piece, from the library's token files on the default branch: the same write as
 * bridge_propose_token_change. Suggest mode files it as a suggestion that says which product branch needs it.
 */
function tokenWriter(ctx: BridgeContext, gh: GitHubClient, source: PiecesSource, viewer: string | null) {
  return async (plan: Extract<LibraryBranchPlan, { kind: 'token-change' }>, how: { mode: ChangesMode }): Promise<LibraryTokenWrite> => {
    const { config } = await ctx.config();
    const [before, pairs] = await Promise.all([ctx.tokens(), core.readContrastPairs(ctx.source, config).catch(() => [])]);
    const p = planTokenProposal({ before, pairs, edits: plan.edits, title: plan.title, summary: plan.summary, config, tool: source === 'mcp' ? 'Bridge MCP' : 'the bridge CLI' });
    if (!p) throw new Error('The token already exists with that value: nothing to add.');
    if (p.blocked) throw new Error(`The library ${how.mode === 'suggest' ? 'suggestion was not sent' : 'branch was not opened'}: ${p.blocked}. Change the value (bridge_propose_token_change with dryRun shows why).`);
    if (how.mode === 'suggest') {
      const base = await suggestionBase(ctx, gh, config);
      const s = await suggestTokenProposalOnGitHub(gh, p, { base: base.ref, baseSha: base.sha, source, ...(viewer ? { suggestedBy: viewer } : {}), labels: config.governance.labels, labelsAfter: [NEEDED_BY_LABEL], neededBy: plan.neededBy });
      return { status: 'suggested', number: s.number, url: s.url };
    }
    const opened = await writeTokenProposalOnGitHub(gh, p, { base: baseBranchOf(config), branchPrefix: config.governance.branchPrefix, labels: config.governance.labels, labelsAfter: [NEEDED_BY_LABEL], tool: source === 'mcp' ? 'Bridge MCP (source: mcp)' : 'the bridge CLI' });
    return { number: opened.pr, url: opened.url, branch: opened.branch };
  };
}

/**
 * bridge_open_library_branch / `bridge pieces open <n> <piece>`: the library side of one recorded piece, linked both
 * ways. A token opens a token change (and the product branch takes its preview), a variant a library exploration with
 * the brief to build it, a new component a request.
 */
export async function openLibraryBranchOp(
  ctx: BridgeContext,
  a: { pr: number | string; piece: string; usePreview?: boolean | undefined; dryRun?: boolean | undefined; source?: PiecesSource | undefined; changes?: ChangesMode | undefined },
) {
  const n = branchNumber(a.pr);
  const source = a.source ?? 'mcp';
  const mode = await changesFor(ctx, a.changes);
  const gh = a.dryRun ? await reader(ctx) : mode === 'suggest' ? await writer(ctx, 'Suggesting a library change', SUGGEST_RIGHTS) : await writer(ctx, 'Opening a library branch', NEED);
  const { config } = await ctx.config();
  const viewer = await viewerOf(ctx, gh);
  const s = settingsOf(config);
  const r = await openLibraryBranchOnGitHub(gh, {
    pr: n,
    piece: a.piece,
    base: s.base,
    products: productsOf(config),
    exploration: { packages: s.packages, apps: s.apps },
    writeTokens: tokenWriter(ctx, gh, source, viewer),
    mode,
    ...(viewer ? { openedBy: viewer } : {}),
    ...(source === 'mcp' ? { agent: 'claude' } : {}),
    source,
    usePreview: a.usePreview,
    dryRun: a.dryRun,
  });
  const plan = r.plan;
  const what = plan.kind === 'token-change' ? (mode === 'suggest' ? 'token suggestion' : 'token change') : plan.kind === 'exploration' ? 'library exploration' : 'component request';
  const next =
    r.status === 'dry-run'
      ? `Run it without dryRun to open the ${what}.`
      : r.status === 'suggested' && r.link
        ? appliedNext(r.link.number)
      : plan.kind === 'exploration'
        ? `Build it on ${r.link?.branch}: ${plan.brief} Then bridge_use_library_preview { pr: ${n}, piece: "${a.piece}" } so the product branch shows it.`
        : plan.kind === 'request'
          ? 'A person or Claude builds the component from the request (bridge_get_request). The product branch keeps its own version until it ships.'
          : r.preview?.status === 'conflict'
            ? r.preview.said
            : 'Design and tech owners review the token change. Once it ships, bridge_switch_to_published moves the product branch to the real version.';
  return {
    status: r.status,
    pr: n,
    piece: a.piece,
    opens: what,
    title: plan.title,
    ...(plan.kind === 'token-change' ? { edits: plan.edits } : {}),
    ...(plan.kind === 'exploration' ? { exploration: plan.exploration.name, brief: plan.brief } : {}),
    ...(plan.kind === 'request' ? { request: plan.request.title } : {}),
    changesMode: mode,
    neededBy: `${plan.neededBy.title} (#${plan.neededBy.pr}) in ${plan.neededBy.productName}`,
    ...(r.link ? { library: { kind: r.link.kind, number: r.link.number, url: r.link.url, ...(r.link.branch ? { branch: r.link.branch } : {}) } } : {}),
    ...(r.preview ? { preview: r.preview } : {}),
    ...(r.warnings.length ? { warnings: r.warnings } : {}),
    next,
  };
}

/** bridge_product_branch / `bridge pieces status <n>`: the product branch page, as Studio shows it. */
export async function productBranchOp(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await reader(ctx);
  const { config } = await ctx.config();
  const viewer = await viewerOf(ctx, gh);
  const v = await productBranchViewOnGitHub(gh, n, { products: productsOf(config), viewer });
  return {
    pr: n,
    title: v.pull.title,
    product: v.product.name,
    said: `${v.sentence.lead}${v.sentence.strong}${v.sentence.rest}`,
    checked: v.record ? v.record.checkedAt : null,
    linked: v.linked.map((l) => ({
      piece: l.piece?.title ?? l.link.piece,
      library: { kind: l.link.kind, number: l.link.number, url: l.link.url },
      status: l.status.line,
      preview: l.preview.sentence,
      ...(l.preview.action ? { action: l.preview.action.label, tool: l.preview.action.kind === 'switch' ? `bridge_switch_to_published { pr: ${n} }` : `bridge_use_library_preview { pr: ${n}, piece: "${l.link.piece}" }` } : {}),
    })),
    notLinked: v.open.map(short),
    ...(v.record ? {} : { next: `Find its missing pieces: bridge_missing_pieces { pr: ${n}, record: true }.` }),
  };
}

/** bridge_use_library_preview: the product branch takes (again) the library branch of a piece, merged in. */
export async function useLibraryPreviewOp(ctx: BridgeContext, a: { pr: number | string; piece: string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Using a library preview', 'Contents: read and write');
  const { config } = await ctx.config();
  const v = await productBranchViewOnGitHub(gh, n, { products: productsOf(config) });
  const l = v.linked.find((x) => x.link.piece === a.piece);
  if (!l) throw new Error(`No library branch for "${a.piece}" on #${n}. Open one first: bridge_open_library_branch.`);
  if (l.link.kind === 'request' || !l.link.branch) throw new Error(`"${l.link.title}" is a request: there is nothing to preview until it is built.`);
  if (l.status.key === 'shipped') throw new Error('The library already shipped it: use bridge_switch_to_published instead.');
  if (l.status.key === 'closed') throw new Error('The library branch is closed: there is nothing to preview.');
  const r = await useLibraryPreviewOnGitHub(gh, { productBranch: v.pull.headRef, libraryBranch: l.link.branch, libraryNumber: l.link.number });
  return { pr: n, piece: a.piece, library: l.link.number, ...r };
}

/** bridge_switch_to_published: main into the product branch once its library branches shipped. */
export async function switchToPublishedOp(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Switching to the published version', 'Contents and Pull requests: read and write');
  return { pr: n, ...(await switchToPublishedOnGitHub(gh, n)) };
}
