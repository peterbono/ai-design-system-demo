// Product branches and their library branches on GitHub, shared by Bridge Studio (in the browser, with the viewer's
// token), the MCP server and the CLI: read what a product branch changes, record its missing pieces, open the library
// branch of a piece and link both ways, let the product branch use the library branch's preview (Bridge merges the
// library branch in), read where each linked library branch stands, and switch to the published version once it
// ships. In suggest mode the library side is an issue (a suggestion or a request), never a branch. The pure rules are
// in prod-branch.ts; finding the pieces (the audit) is in audit/missing-pieces.ts.

import type { ChangesMode } from './config';
import { EXPLORATION_NOTES_DIR, EXPLORATION_PREFIX, isExplorationBranch } from './explorations';
import { startExplorationOnGitHub, type ExplorationSettings } from './explorations-github';
import { GitHubError, type GitHubClient, type PullRequestSummary } from './github-client';
import { defaultProduct, productOfBranch, productOfRepo, type ProductConfig } from './products';
import {
  libraryBranchPlan,
  linkStatus,
  mergePiecesRecord,
  NEEDED_BY_LABEL,
  parsePiecesRecord,
  pieceRequest,
  libraryPreviewState,
  productBranchSentence,
  withLink,
  withNeededBy,
  withPiecesRecord,
  type LibraryBranchPlan,
  type LibraryLink,
  type LinkStatus,
  type MissingPiece,
  type PiecesRecord,
  type LibraryPreviewState,
  type ProductBranchRef,
} from './prod-branch';
import { composeRequestIssue, type RequestSource } from './requests';
import { suggestionStateFromLabels, suggestionStatus } from './suggestions';

/** Files the audit reads (styles, scripts, markup). Kept here so this module never loads the audit. */
const PRODUCT_FILE = /\.(css|scss|sass|less|tsx|jsx|ts|js|mjs|cjs|mts|cts|astro|vue|svelte)$/;
const SKIP_FILE = /\.d\.[cm]?ts$|\.(test|spec|stories|story)\.[cm]?[jt]sx?$|\.min\.(css|js)$/;
/** At most this many product files are read per check (two reads each). */
export const PIECES_FILE_LIMIT = 40;

type Pull = PullRequestSummary & { body: string; mergeable: boolean | null; requestedReviewers: string[] };

export interface ProductBranchRead {
  pull: Pull;
  product: ProductConfig;
  /** The product's changed files, their texts at the branch start (merge base with main) and at its head. */
  files: { path: string; before: string | null; after: string | null }[];
  /** Product files left unread past the limit. */
  skipped: number;
  record: PiecesRecord | undefined;
}

const cleanPath = (p: string) => p.trim().replace(/^\.?\/+|\/+$/g, '');

/** The product whose own repository the client reads, never the library. */
function ownProduct(products: readonly ProductConfig[], repo: string | undefined): ProductConfig | undefined {
  const p = repo ? productOfRepo(products, repo) : undefined;
  return p && p.key !== defaultProduct(products).key ? p : undefined;
}

/** "owner/name" of a product branch read in the product's own repository, else undefined (the design system one). */
const repoOfProductBranch = (gh: GitHubClient, lib: GitHubClient | undefined): string | undefined => (lib && lib.fullName.toLowerCase() !== gh.fullName.toLowerCase() ? gh.fullName : undefined);

/**
 * The product of a branch, refusing the library itself: missing pieces are about a product built on the library. A
 * branch read in a product's own repository (`repo`, the client's "owner/name") belongs to that product.
 */
function productOf(products: readonly ProductConfig[], pull: Pick<Pull, 'labels'>, files: string[], repo?: string): ProductConfig {
  const own = ownProduct(products, repo);
  if (own) return own;
  const product = productOfBranch(products, { labels: pull.labels, files });
  if (product.key === defaultProduct(products).key) throw new GitHubError(422, `This branch is a library branch (${product.name}), not a product branch: missing pieces are checked on a branch started for a product.`);
  return product;
}

/**
 * Reads a product branch for the check: the pull request, its product, and the product files it changes with their
 * text before and after (two reads per file, up to PIECES_FILE_LIMIT files).
 */
export async function readProductBranchOnGitHub(gh: GitHubClient, pr: number, opts: { products: readonly ProductConfig[] }): Promise<ProductBranchRead> {
  const pull = await gh.getPullRequest(pr);
  const cmp = await gh.compareDetailed(pull.baseRef, pull.headSha);
  const product = productOf(opts.products, pull, cmp.files.map((f) => f.filename), gh.fullName);
  // In the product's own repository every file is the product's: `path` is a folder of the design system repository.
  const dir = product.path && !ownProduct(opts.products, gh.fullName) ? `${cleanPath(product.path)}/` : '';
  const changed = cmp.files.filter((f) => f.status !== 'removed' && (!dir || f.filename.startsWith(dir)) && PRODUCT_FILE.test(f.filename) && !SKIP_FILE.test(f.filename) && !f.filename.split('/').includes('node_modules'));
  const read = changed.slice(0, PIECES_FILE_LIMIT);
  const start = cmp.mergeBase ?? pull.baseRef;
  const files = await Promise.all(
    read.map(async (f) => {
      const [before, after] = await Promise.all([f.status === 'added' ? Promise.resolve(undefined) : gh.getFileText(f.previous_filename ?? f.filename, start), gh.getFileText(f.filename, pull.headSha)]);
      return { path: f.filename, before: before ?? null, after: after ?? null };
    }),
  );
  return { pull, product, files, skipped: changed.length - read.length, record: parsePiecesRecord(pull.body) };
}

/** Saves a check in the product branch body, keeping the library branches already opened for its pieces. */
export async function recordPiecesOnGitHub(gh: GitHubClient, pr: number, check: { pieces: MissingPiece[]; fixes: number; headSha?: string | undefined; checkedAt?: string | undefined }): Promise<PiecesRecord> {
  const pull = await gh.getPullRequest(pr);
  const record = mergePiecesRecord(parsePiecesRecord(pull.body), { checkedAt: check.checkedAt ?? new Date().toISOString(), headSha: check.headSha ?? pull.headSha, pieces: check.pieces, fixes: check.fixes });
  await gh.updatePullRequest(pr, { body: withPiecesRecord(pull.body, record) });
  return record;
}

/** The client that may write a product branch: explorations need the `explore/` prefix. */
const productWriter = (gh: GitHubClient, branch: string) => (isExplorationBranch(branch) ? gh.withBranchPrefix(EXPLORATION_PREFIX) : gh);

export interface PreviewMerge {
  status: 'merged' | 'up-to-date' | 'conflict';
  sha: string | null;
  said: string;
}

/**
 * The product branch uses the library branch's preview: Bridge merges the library branch into it, so the product
 * preview deploy and anyone working on the branch get the real library change. A conflict is left to a developer.
 */
export async function useLibraryPreviewOnGitHub(gh: GitHubClient, input: { productBranch: string; libraryBranch: string; libraryNumber: number }): Promise<PreviewMerge> {
  const message = `chore(bridge): use the preview of ${input.libraryBranch} (#${input.libraryNumber})\n\nThe product branch takes the library branch before it ships. Switch to the published version once it does.`;
  try {
    const r = await productWriter(gh, input.productBranch).mergeIntoBranch(input.productBranch, input.libraryBranch, message);
    return { ...r, said: r.status === 'merged' ? 'Your branch now uses the preview of the library branch.' : 'Your branch already has the latest preview.' };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 409) return { status: 'conflict', sha: null, said: `Your branch and the library branch change the same lines. A developer merges ${input.libraryBranch} into ${input.productBranch} by hand.` };
    throw err;
  }
}

export interface OpenLibraryBranchInput {
  /** The product branch (pull request number). */
  pr: number;
  /** The piece id, from the recorded check. */
  piece: string;
  /** Branch library work starts from (the default branch). */
  base: string;
  products: readonly ProductConfig[];
  /** Previews and snapshot packages for a library exploration. */
  exploration: Pick<ExplorationSettings, 'packages' | 'apps'>;
  /**
   * Opens the token change of a token piece (planTokenProposal + writeTokenProposalOnGitHub where the caller has the
   * token files and contrast pairs). Without it a token piece is refused. In suggest mode (`ctx.mode`), it files a
   * suggestion instead (suggestTokenProposalOnGitHub with `neededBy: plan.neededBy`) and returns its result: a result
   * with `status: 'suggested'` is linked as a suggestion, anything else as a token change pull request.
   */
  writeTokens?: ((plan: Extract<LibraryBranchPlan, { kind: 'token-change' }>, ctx: { mode: ChangesMode }) => Promise<LibraryTokenWrite>) | undefined;
  /** Who opens it, and the AI agent behind it ("claude"). */
  openedBy?: string | undefined;
  agent?: string | undefined;
  source?: RequestSource | undefined;
  /** Merge the new library branch into the product branch when it already changes something (default true). */
  usePreview?: boolean | undefined;
  dryRun?: boolean | undefined;
  /**
   * "direct" (default here, so existing callers keep their behaviour): a token piece opens a pull request, a variant
   * an exploration branch. "suggest": a token piece is filed as a suggestion and a variant as a component request, so
   * the token only needs Issues write. Callers pass changesMode(config), or an explicit choice.
   */
  mode?: ChangesMode | undefined;
  /**
   * The design system repository, when the product branch lives in the product's own repository (`gh` reads that
   * one): the library side (request, suggestion, library exploration) is opened here, and the product branch keeps the
   * link. Its preview cannot be merged across repositories, so `usePreview` does nothing then.
   */
  library?: GitHubClient | undefined;
}

/** What writeTokens returns: the pull request it opened, or the suggestion it filed. */
export type LibraryTokenWrite = { number: number; url: string; branch: string; status?: undefined } | { status: 'suggested'; number: number; url: string };

export interface OpenedLibraryBranch {
  /** "suggested": the library side is a suggestion (`link.kind` 'suggestion', `link.number` its issue). */
  status: 'opened' | 'suggested' | 'already-linked' | 'dry-run';
  plan: LibraryBranchPlan;
  link: LibraryLink | null;
  preview: PreviewMerge | null;
  warnings: string[];
}

/** The product branch as the library side names it. */
export function productBranchRef(pull: Pick<Pull, 'number' | 'title' | 'headRef' | 'url' | 'author' | 'body'>, product: ProductConfig, repo?: string): ProductBranchRef {
  const name = /<!-- bridge-exploration (\{[\s\S]*?\}) -->/.exec(pull.body ?? '');
  let title = pull.title.replace(/^[A-Z][A-Z0-9_]*-\d+\s+/, '').replace(/^Exploration:\s*/i, '');
  let author = pull.author;
  if (name) {
    try {
      const e = JSON.parse(name[1]!) as { name?: string; author?: string };
      if (e.name) title = e.name;
      if (e.author) author = e.author;
    } catch {
      // The pull request title is enough.
    }
  }
  return { pr: pull.number, title: title.charAt(0).toUpperCase() + title.slice(1), branch: pull.headRef, url: pull.url, productKey: product.key, productName: product.name, ...(author ? { author } : {}), ...(repo ? { repo } : {}) };
}

/**
 * Opens the library side of a missing piece and links both ways: the library branch (or request) says "Needed by" the
 * product branch and carries the `needed-by-product` label; the product branch records the link. A token piece opens a
 * token change (through `writeTokens`), a variant a library exploration, a new component a request. When the new
 * library branch already changes something (a token change), the product branch takes its preview.
 * In suggest mode nothing is a branch: a token piece is a suggestion (through `writeTokens`), a variant and a new
 * component are requests; recording the link on the product branch is best effort (a warning when refused).
 */
export async function openLibraryBranchOnGitHub(gh: GitHubClient, input: OpenLibraryBranchInput): Promise<OpenedLibraryBranch> {
  const pull = await gh.getPullRequest(input.pr);
  const record = parsePiecesRecord(pull.body);
  const piece = record?.pieces.find((p) => p.id === input.piece);
  if (!record || !piece) throw new GitHubError(404, record ? `No piece "${input.piece}" on #${input.pr}. Pieces: ${record.pieces.map((p) => p.id).join(', ') || 'none'}.` : `#${input.pr} was not checked yet: find its missing pieces first (bridge_missing_pieces with record, or \`bridge pieces ${input.pr} --record\`).`);
  const product = productOf(input.products, pull, await gh.listPullRequestFiles(input.pr).then((f) => f.map((x) => x.filename), () => []), gh.fullName);
  const mode: ChangesMode = input.mode ?? 'direct';
  // A product branch in the product's own repository: the library side lives in the design system repository.
  const lib = input.library ?? gh;
  const repo = repoOfProductBranch(gh, input.library);
  const plan = libraryBranchPlan(piece, productBranchRef(pull, product, repo), { source: input.source, requestedBy: input.openedBy, mode });
  const existing = record.links.find((l) => l.piece === piece.id);
  if (existing) return { status: 'already-linked', plan, link: existing, preview: null, warnings: [] };
  if (input.dryRun) return { status: 'dry-run', plan, link: null, preview: null, warnings: [] };
  if (!gh.canWrite || !lib.canWrite) throw new GitHubError(401, mode === 'suggest' ? 'Suggesting a library change needs a GitHub token (issues: write).' : 'Opening a library branch needs a GitHub token (contents, pull requests and issues: write).');
  const warnings: string[] = [];
  const at = new Date().toISOString();
  const who = { ...(input.openedBy ? { openedBy: input.openedBy } : {}), ...(input.agent ? { agent: input.agent } : {}), ...(repo ? { repo: lib.fullName } : {}) };
  let link: LibraryLink;
  if (plan.kind === 'token-change') {
    if (!input.writeTokens) throw new GitHubError(422, 'This piece is a token: open it where the token files are read (Bridge Studio, bridge_open_library_branch or `bridge pieces open`).');
    const r = await input.writeTokens(plan, { mode });
    link = r.status === 'suggested' ? { piece: piece.id, kind: 'suggestion', number: r.number, url: r.url, title: plan.title, at, ...who } : { piece: piece.id, kind: 'token-change', number: r.number, url: r.url, title: plan.title, branch: r.branch, at, ...who };
  } else if (plan.kind === 'exploration') {
    const r = await startExplorationOnGitHub(lib, { ...plan.exploration, ...(input.openedBy ? { author: input.openedBy } : {}), ...(input.agent ? { agent: input.agent } : {}) }, { base: input.base, ...input.exploration, labels: [NEEDED_BY_LABEL] });
    link = { piece: piece.id, kind: 'exploration', number: r.pr, url: r.url, title: plan.title, branch: r.branch, at, ...who };
  } else {
    const issue = composeRequestIssue(plan.request, { labels: [NEEDED_BY_LABEL] });
    const r = await lib.createIssue(issue);
    link = { piece: piece.id, kind: 'request', number: r.number, url: r.url, title: plan.title, at, ...who };
  }
  // The library side says who needs it; the product side records the link.
  try {
    if (link.kind === 'request' || link.kind === 'suggestion') {
      const issue = await lib.getIssue(link.number);
      await lib.updateIssue(link.number, { body: withNeededBy(issue.body, plan.neededBy) });
      if (link.kind === 'suggestion' && !issue.labels.includes(NEEDED_BY_LABEL)) await lib.addLabels(link.number, [NEEDED_BY_LABEL]);
    } else {
      const libPull = await lib.getPullRequest(link.number);
      await lib.updatePullRequest(link.number, { body: withNeededBy(libPull.body, plan.neededBy) });
      await lib.addLabels(link.number, [NEEDED_BY_LABEL]);
    }
  } catch (err) {
    if (err instanceof GitHubError && err.auth === 'rejected') throw err;
    warnings.push(`The library side does not say who needs it yet (${(err as Error).message}). Add "Needed by ${repo ?? ''}#${input.pr}" to #${link.number} on GitHub.`);
  }
  try {
    const fresh = await gh.getPullRequest(input.pr);
    const next = withLink(parsePiecesRecord(fresh.body) ?? record, link);
    await gh.updatePullRequest(input.pr, { body: withPiecesRecord(fresh.body, next) });
  } catch (err) {
    // Direct mode needs the record (the token can write pull requests); a suggest-mode token may not.
    if (mode !== 'suggest') throw err;
    warnings.push(`#${input.pr} does not list #${link.number} yet (${(err as Error).message}). Add "Library: ${repo ? lib.fullName : ''}#${link.number}" to #${input.pr} on GitHub, so this piece is not sent twice.`);
  }
  let preview: PreviewMerge | null = null;
  // Across repositories the product gets the library from npm: there is no branch to merge in.
  if (!repo && (input.usePreview ?? true) && link.kind === 'token-change' && link.branch) {
    preview = await useLibraryPreviewOnGitHub(gh, { productBranch: pull.headRef, libraryBranch: link.branch, libraryNumber: link.number }).catch((err: Error) => {
      warnings.push(`Your branch does not use the preview yet: ${err.message}`);
      return null;
    });
  }
  return { status: link.kind === 'suggestion' ? 'suggested' : 'opened', plan, link, preview, warnings };
}

export interface LinkedLibraryBranch {
  link: LibraryLink;
  piece: MissingPiece | undefined;
  status: LinkStatus;
  preview: LibraryPreviewState;
  /** Requested reviewers of a library pull request, or assignees of a request. */
  people: string[];
}

export interface ProductBranchView {
  pull: Pull;
  product: ProductConfig;
  record: PiecesRecord | undefined;
  sentence: ReturnType<typeof productBranchSentence>;
  linked: LinkedLibraryBranch[];
  /** Pieces with no library branch yet. */
  open: MissingPiece[];
}

/**
 * Across repositories nothing is merged into the product branch: no "use the preview" or "switch" action, and a
 * shipped library change reads as a package update in the product.
 */
function acrossRepos(p: LibraryPreviewState, lifecycle: string, across: boolean | undefined): LibraryPreviewState {
  if (!across || !p.action) return p;
  if (lifecycle === 'merged') return { ...p, sentence: 'The library published it. Update @bridge-ds/react in your product to use it.', action: null };
  return { ...p, action: null };
}

const isNote = (path: string) => path.startsWith(`${EXPLORATION_NOTES_DIR}/`);

/**
 * Where one linked library branch stands, and what its preview means for the product branch. `gh` reads the library
 * side. `opts.across`: the product branch lives in the product's own repository, so the library change reaches it as
 * an npm release, never by a merge: nothing is compared across the two repositories.
 */
export async function linkedLibraryBranchOnGitHub(gh: GitHubClient, link: LibraryLink, product: { headSha: string; baseRef: string }, piece?: MissingPiece, opts: { across?: boolean } = {}): Promise<LinkedLibraryBranch> {
  const nearest = piece?.nearest?.label;
  const behind = () => (opts.across ? Promise.resolve(null) : gh.compare(product.baseRef, product.headSha).then((c) => c.behindBy, () => null));
  if (link.kind === 'suggestion') {
    const issue = await gh.getIssue(link.number);
    // Status from the issue and its state label (a cache): the review comments are read on the suggestion itself.
    const cached = suggestionStateFromLabels(issue.labels);
    const s = suggestionStatus({ state: issue.state, stateReason: issue.stateReason, applied: cached === 'applying', review: cached === 'applying' ? undefined : cached });
    const status = linkStatus({ kind: 'suggestion', status: s });
    const lifecycle = s === 'applied' ? 'merged' : issue.state === 'closed' ? 'closed' : 'open';
    const behindMain = lifecycle === 'merged' ? await behind() : null;
    const preview = libraryPreviewState({ kind: 'suggestion', lifecycle, hasChanges: false, missing: null, total: null, behindMain, nearest });
    return { link, piece, status, preview: acrossRepos(preview, lifecycle, opts.across), people: status.people };
  }
  if (link.kind === 'request') {
    const issue = await gh.getIssue(link.number);
    const status = linkStatus({ kind: 'request', state: issue.state, stateReason: issue.stateReason });
    const lifecycle = issue.state === 'closed' ? (issue.stateReason === 'not_planned' ? 'closed' : 'merged') : 'open';
    const behindMain = lifecycle === 'merged' ? await behind() : null;
    const preview = libraryPreviewState({ kind: 'request', lifecycle, hasChanges: false, missing: null, total: null, behindMain, nearest });
    return { link, piece, status, preview: acrossRepos(preview, lifecycle, opts.across), people: status.people };
  }
  const lib = await gh.getPullRequest(link.number);
  const reviews = await gh.listReviews(link.number).catch(() => []);
  const status = linkStatus({ kind: link.kind, state: lib.state, draft: lib.draft, labels: lib.labels, requestedReviewers: lib.requestedReviewers, reviews: reviews.map((r) => ({ user: r.user, state: r.state })) });
  const lifecycle = lib.state === 'merged' ? 'merged' : lib.state === 'open' ? 'open' : 'closed';
  let missing: number | null = null;
  let total: number | null = null;
  let behindMain: number | null = null;
  let hasChanges = true;
  if (lifecycle === 'open') {
    const [files, own, inProduct] = await Promise.all([
      gh.listPullRequestFiles(link.number).catch(() => null),
      gh.compare(lib.baseRef, lib.headSha).catch(() => null),
      opts.across ? Promise.resolve(null) : gh.compare(product.headSha, lib.headSha).catch(() => null),
    ]);
    hasChanges = files ? files.some((f) => !isNote(f.filename)) : true;
    total = own?.aheadBy ?? null;
    missing = inProduct?.aheadBy ?? null;
  } else if (lifecycle === 'merged') {
    behindMain = await behind();
  }
  const preview = libraryPreviewState({ kind: link.kind, lifecycle, hasChanges, missing, total, behindMain, nearest });
  return { link, piece, status, preview: acrossRepos(preview, lifecycle, opts.across), people: status.people };
}

/**
 * Everything a product branch page shows: the record, the sentence, and each linked library branch with its status,
 * its reviewers and what its preview means for the product branch. A few reads per linked branch.
 */
export async function productBranchViewOnGitHub(
  gh: GitHubClient,
  pr: number,
  opts: { products: readonly ProductConfig[]; viewer?: string | null | undefined; agentName?: string | undefined; /** The design system repository, when `gh` reads a product's own one: its requests and library branches are read there. */ library?: GitHubClient | undefined },
): Promise<ProductBranchView> {
  const pull = await gh.getPullRequest(pr);
  const files = await gh.listPullRequestFiles(pr).then((f) => f.map((x) => x.filename), () => []);
  const product = productOf(opts.products, pull, files, gh.fullName);
  const record = parsePiecesRecord(pull.body);
  const across = Boolean(repoOfProductBranch(gh, opts.library));
  const lib = opts.library ?? gh;
  const linked = await Promise.all(
    (record?.links ?? []).map((l) => linkedLibraryBranchOnGitHub(lib, l, { headSha: pull.headSha, baseRef: pull.baseRef }, record?.pieces.find((p) => p.id === l.piece), { across })),
  );
  const open = (record?.pieces ?? []).filter((p) => !record!.links.some((l) => l.piece === p.id));
  return { pull, product, record, sentence: productBranchSentence(record, { viewer: opts.viewer, agentName: opts.agentName }), linked, open };
}

/**
 * "Switch to the published version": once the library branch shipped, main comes into the product branch (GitHub's
 * update branch), so the product branch stops carrying the library change and uses the shipped one. Conflicts are
 * left to bridge_update_from_main or a developer.
 */
export async function switchToPublishedOnGitHub(gh: GitHubClient, pr: number): Promise<{ status: 'switched' | 'up-to-date'; said: string }> {
  if (!gh.canWrite) throw new GitHubError(401, 'Switching needs a GitHub token (contents and pull requests: write).');
  const pull = await gh.getPullRequest(pr);
  if (pull.state !== 'open') throw new GitHubError(422, `#${pr} is ${pull.state}: only an open branch switches.`);
  const cmp = await gh.compare(pull.baseRef, pull.headSha);
  if (cmp.behindBy === 0) return { status: 'up-to-date', said: 'Your branch already uses the published version.' };
  try {
    await gh.updatePullRequestBranch(pr, pull.headSha);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422) throw new GitHubError(422, `Your branch and ${pull.baseRef} change the same lines, so Bridge cannot switch it alone. Use "Update from main" to pick the token values, or ask a developer.`, err.detail);
    throw err;
  }
  return { status: 'switched', said: `Your branch now uses the published version from ${pull.baseRef}.` };
}

export interface ProposedPieces {
  /** Requests filed now, one per ticked piece (number 0 in a dry run). */
  proposed: { piece: string; title: string; number: number; url: string }[];
  /** Ticked pieces that already have a library side: never sent twice. */
  already: { piece: string; number: number }[];
  /** Ticked ids the record does not know. */
  unknown: string[];
  warnings: string[];
}

/**
 * "Done exploring", the library side: each piece the designer ticks becomes a request for the DS lead (the request
 * mechanism of requests.ts, labeled `needed-by-product`, with the "Needed by" block and the exploration's preview
 * link), and the exploration records the link so it is never sent twice. Unticked pieces are not proposed. A branch
 * outside any product (a library exploration) is named after the library.
 */
export async function proposePiecesOnGitHub(
  gh: GitHubClient,
  pr: number,
  input: {
    pieces: readonly string[];
    products: readonly ProductConfig[];
    previewUrl?: string | null | undefined;
    openedBy?: string | undefined;
    agent?: string | undefined;
    source?: RequestSource | undefined;
    dryRun?: boolean | undefined;
    /**
     * The design system repository, when the exploration lives in a product's own repository (`gh` reads that one):
     * the requests are filed there, where the DS lead works, and link back to the product pull request as owner/name#n.
     */
    library?: GitHubClient | undefined;
  },
): Promise<ProposedPieces> {
  const out: ProposedPieces = { proposed: [], already: [], unknown: [], warnings: [] };
  const ids = [...new Set(input.pieces.map((p) => p.trim()).filter(Boolean))];
  if (!ids.length) return out;
  const pull = await gh.getPullRequest(pr);
  const record = parsePiecesRecord(pull.body);
  if (!record) throw new GitHubError(404, `#${pr} was not checked against the library yet: find its missing pieces first (bridge_missing_pieces with record, or \`bridge pieces ${pr} --record\`).`);
  const files = await gh.listPullRequestFiles(pr).then((f) => f.map((x) => x.filename), () => []);
  const lib = input.library ?? gh;
  const repo = repoOfProductBranch(gh, input.library);
  const ref = productBranchRef(pull, ownProduct(input.products, repo) ?? productOfBranch(input.products, { labels: pull.labels, files }), repo);
  const todo: { piece: MissingPiece; ask: ReturnType<typeof pieceRequest> }[] = [];
  for (const id of ids) {
    const piece = record.pieces.find((p) => p.id === id);
    const link = record.links.find((l) => l.piece === id);
    if (!piece) out.unknown.push(id);
    else if (link) out.already.push({ piece: id, number: link.number });
    else todo.push({ piece, ask: pieceRequest(piece, ref, { previewUrl: input.previewUrl, source: input.source, requestedBy: input.openedBy }) });
  }
  if (input.dryRun) return { ...out, proposed: todo.map((t) => ({ piece: t.piece.id, title: t.ask.request.title, number: 0, url: '' })) };
  if (!todo.length) return out;
  if (!lib.canWrite) throw new GitHubError(401, 'Sending pieces to the library needs a GitHub token (issues: write).');
  const at = new Date().toISOString();
  const who = { ...(input.openedBy ? { openedBy: input.openedBy } : {}), ...(input.agent ? { agent: input.agent } : {}), ...(repo ? { repo: lib.fullName } : {}) };
  const links: LibraryLink[] = [];
  for (const t of todo) {
    const issue = composeRequestIssue(t.ask.request, { labels: [NEEDED_BY_LABEL] });
    const r = await lib.createIssue({ ...issue, body: withNeededBy(issue.body, t.ask.neededBy) });
    links.push({ piece: t.piece.id, kind: 'request', number: r.number, url: r.url, title: t.ask.request.title, at, ...who });
    out.proposed.push({ piece: t.piece.id, title: t.ask.request.title, number: r.number, url: r.url });
  }
  try {
    const fresh = await gh.getPullRequest(pr);
    const next = links.reduce((rec, l) => withLink(rec, l), parsePiecesRecord(fresh.body) ?? record);
    await gh.updatePullRequest(pr, { body: withPiecesRecord(fresh.body, next) });
  } catch (err) {
    if (err instanceof GitHubError && err.auth === 'rejected') throw err;
    out.warnings.push(`#${pr} does not list the requests yet (${(err as Error).message}). Add "Library: ${links.map((l) => `${repo ? lib.fullName : ''}#${l.number}`).join(', ')}" to #${pr} on GitHub, so they are not sent twice.`);
  }
  return out;
}
