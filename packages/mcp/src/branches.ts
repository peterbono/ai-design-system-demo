// Branches in review, from Claude or the terminal: the same actions as Bridge Studio (send for review, back to draft,
// review, comment and reply, merge, owner override, close, reopen, update from main with token conflicts, try it in a
// product, share with a product team, combine 2 to 4 token branches, what needs me) over the same @bridge-ds/core
// functions Studio calls: review-gate (who may merge, what blocks), branch-actions (the writes), library-update,
// share-branch, try-in-product, combine-branches and products. Reads work without a token on a public repo; every
// write needs a GitHub token with the rights it needs in Studio, and GitHub's own branch rules still apply.
import { relative } from 'node:path';
import {
  addedComment,
  productRepoAccess,
  productRepos,
  askOthersToReviewOnGitHub,
  commentOnGitHub,
  reviewersToAsk,
  approverLists,
  baseBranchOf,
  DEFAULT_OVERRIDE,
  canAddTo,
  canOverride,
  closeOnGitHub,
  combineChanges,
  commitLibraryResolution,
  defaultProduct,
  effectiveTier,
  lookAgainReviewers,
  findProduct,
  freshness,
  hasWriteAccess,
  isActiveExploration,
  isGuardedExploration,
  MAX_TOGETHER,
  mergeOnGitHub,
  markSuggestionsAppliedOnGitHub,
  MIN_TOGETHER,
  missingChoices,
  OverrideMergeError,
  overrideMergeOnGitHub,
  overrideReasonProblem,
  previewUrl,
  productForPlace,
  productOfBranch,
  productsOf,
  pullState,
  readCombineBranch,
  readLibraryConflicts,
  reopenEligibility,
  reopenOnGitHub,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_ORDER,
  CI_STATE_LABEL,
  reviewOnGitHub,
  reviewQueue,
  shareMessage,
  shareState,
  shipPolicy,
  stateSentence,
  summarizeApprovals,
  soloApprover,
  soloOwnerSentence,
  publishedWithoutReview,
  tier1PublishOf,
  summarizeCi,
  TeamDirectory,
  localTryCommand,
  noOnlinePreview,
  tryInProductUrl,
  tryTogetherUrl,
  branchPreviewUrls,
  allowedMergeMethods,
  approvedSuggestionOnGitHub,
  branchVerdict,
  closingIssueNumbers,
  eligibleReviewers,
  figmaPushOf,
  isTokenPath,
  isTokenValueChange,
  mayBeTokenValueChange,
  isBuildRequestIssue,
  isFigmaPush,
  SOURCE_FIGMA_LABEL,
  tokenFileChanges,
  type FigmaPush,
  type PullRequestFile,
  hasOwnerApproval,
  overrideReasonMin,
  type SuggestionGovernance,
  type BridgeConfig,
  type ChangeLifecycle,
  type GitHubClient,
  type MergeChoices,
  type ProductConfig,
  type ReviewEvent,
  type ReviewStatusKind,
} from '@bridge-ds/core';
import { originRepo } from '@bridge-ds/core/node';
import { productClient } from './product-repos.js';
import type { BridgeContext } from './context.js';
import { addToken, BlockedError, say } from './say.js';

/** What a write needs from the token, per action, in the words GitHub's token settings use. */
export const RIGHTS = {
  review: 'Pull requests: read and write',
  comment: 'Pull requests (or Issues): read and write',
  merge: 'Contents and Pull requests: read and write, and the right to ship in bridge.config.json (governance.rights)',
  update: 'Contents and Pull requests: read and write',
  draft: 'Pull requests: read and write (you must be the author, as in Studio)',
  docs: 'Contents and Pull requests: read and write',
} as const;

const NO_REPO = 'No GitHub repo known: set "repo" in bridge.config.json or add an origin remote.';

export async function reader(ctx: BridgeContext): Promise<GitHubClient> {
  const gh = await ctx.github();
  if (!gh) throw new Error(NO_REPO);
  return gh;
}

/**
 * A client for writes on a branch someone already opened (any name, never a protected branch): the token is required,
 * with the rights `need` names, so the error says exactly what to add.
 */
export async function writer(ctx: BridgeContext, what: string, need: string): Promise<GitHubClient> {
  const gh = await reader(ctx);
  if (!ctx.canWriteRemote) throw new Error(`${what} needs a GitHub token with ${need} on ${gh.fullName}: ${addToken(ctx)}, or do it in Bridge Studio.`);
  return gh.withBranchPrefix(undefined);
}

/** 12, "#12" or a pull request link: the branch number. Throws how to fix it otherwise. */
export function branchNumber(input: number | string): number {
  if (typeof input === 'number' && Number.isInteger(input) && input > 0) return input;
  const m = /^#?(\d+)$/.exec(String(input).trim()) ?? /\/pull\/(\d+)/.exec(String(input));
  if (!m) throw new Error(`"${input}" is not a branch number. Pass the number Studio shows (#12) or the link of the branch on GitHub.`);
  return Number(m[1]);
}

const lifecycleOf = (state: string, draft: boolean): ChangeLifecycle => (state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : draft ? 'draft' : 'open');

/** Owners as people: GitHub teams expanded, plus who may ship, the same lists Studio reads. */
async function people(gh: GitHubClient, config: BridgeConfig) {
  const { owners, rights } = config.governance;
  const teams = await new TeamDirectory(gh).resolve(owners).catch(() => undefined);
  // The approver lists as Studio reads them (core approverLists: rights applied, teams expanded once read).
  const lists = approverLists(owners, rights, teams ?? null);
  // The governance a suggestion's approvals are counted with, as Studio reads it (an approved suggestion's approvals
  // carry to the pull request that applies it).
  const gov: SuggestionGovernance = { owners, rights: rights ?? null, ...(teams ? { teams } : {}), ...(config.governance.soloOwnerCanApproveBoth ? { soloOwnerCanApproveBoth: true } : {}), ...(config.governance.override ? { override: config.governance.override } : {}) };
  return { lists, gov, ship: shipPolicy(owners, rights, teams), solo: config.governance.soloOwnerCanApproveBoth ? soloApprover(lists) : null };
}

/** The viewer of the token, or null without one (or when GitHub does not say). */
export async function viewerOf(ctx: BridgeContext, gh: GitHubClient): Promise<string | null> {
  if (!ctx.canWriteRemote) return null;
  return gh.getViewer().then((v) => v.login, () => null);
}

type PullForTokens = { labels: string[]; body: string; baseRef: string; headSha: string };

/**
 * The token changes of a pull request, from its token files at the base and the head (never from its body). A renamed
 * token file, or a read that fails, leaves them unknown (null): the tech approval is then still needed.
 */
export async function tokenChangesOf(gh: GitHubClient, config: BridgeConfig, pr: PullForTokens, files: PullRequestFile[], base: string | null | undefined): Promise<ReturnType<typeof tokenFileChanges> | null> {
  const tokenFiles = files.filter((f) => isTokenPath(f.filename, config));
  if (tokenFiles.some((f) => f.status === 'renamed')) return null;
  try {
    const from = base ?? pr.baseRef;
    const pairs = await Promise.all(
      tokenFiles.map(async (f) => ({
        before: f.status === 'added' ? null : ((await gh.getFileText(f.filename, from)) ?? null),
        after: f.status === 'removed' ? null : ((await gh.getFileText(f.filename, pr.headSha)) ?? null),
      })),
    );
    return tokenFileChanges(pairs);
  } catch {
    return null;
  }
}

/**
 * The Figma push facts of a pull request (docs/BUILD-REQUESTS.md), read the way Studio reads them: only for a push
 * from the Figma plugin (labels or the "From Figma" block) or the pull request of a build request sent from Figma
 * (its body closes one labeled source: figma). The token changes come from tokenChangesOf (`read`, when the caller
 * already reads them).
 */
export async function figmaPushFacts(
  gh: GitHubClient,
  config: BridgeConfig,
  pr: PullForTokens,
  files: PullRequestFile[],
  base: string | null | undefined,
  read: () => Promise<ReturnType<typeof tokenFileChanges> | null> = () => tokenChangesOf(gh, config, pr, files, base),
): Promise<FigmaPush | null> {
  let closesFigmaBuildRequest = false;
  if (!isFigmaPush(pr)) {
    for (const k of closingIssueNumbers(pr.body).slice(0, 3)) {
      const issue = await gh.getIssue(k).catch(() => null);
      if (issue && isBuildRequestIssue(issue.labels) && issue.labels.includes(SOURCE_FIGMA_LABEL)) {
        closesFigmaBuildRequest = true;
        break;
      }
    }
    if (!closesFigmaBuildRequest) return null;
  }
  const tokenChanges = await read();
  return figmaPushOf({ labels: pr.labels, body: pr.body }, { files: files.map((f) => ({ path: f.filename, status: f.status })), tokenChanges, config, closesFigmaBuildRequest });
}

/**
 * Whether a pull request only changes token values (core isTokenValueChange, decision TV-1), whoever opened it: the
 * design approval is then all it needs, as in Studio. Reads the token files only when its files could be one.
 */
export async function tokenValuesFact(
  config: BridgeConfig,
  pr: Pick<PullForTokens, 'labels'>,
  files: PullRequestFile[],
  read: () => Promise<ReturnType<typeof tokenFileChanges> | null>,
): Promise<boolean> {
  const changed = files.map((f) => ({ path: f.filename, status: f.status }));
  if (!mayBeTokenValueChange(changed, config)) return false;
  return isTokenValueChange({ files: changed, tokenChanges: await read(), config, labels: pr.labels });
}

/** Everything Studio reads about one branch to paint its header and decide its actions. */
export async function branchFacts(ctx: BridgeContext, gh: GitHubClient, n: number, viewer: string | null) {
  const { config } = await ctx.config();
  const pr = await gh.getPullRequest(n);
  const [files, reviews, runs, statuses, who, compare, repo] = await Promise.all([
    gh.listPullRequestFiles(n),
    gh.listReviews(n).catch(() => []),
    gh.listCheckRuns(pr.headSha).catch(() => []),
    gh.listCommitStatuses(pr.headSha).catch(() => []),
    people(gh, config),
    pr.state === 'open' ? gh.compareDetailed(pr.baseRef, pr.headSha).catch(() => null) : Promise.resolve(null),
    viewer ? gh.getMergeSettings().catch(() => null) : Promise.resolve(null),
  ]);
  const labels = pr.labels.map((name) => ({ name }));
  const ci = summarizeCi(
    runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, ...(r.url ? { html_url: r.url } : {}) })),
    statuses.map((s) => ({ context: s.context, state: s.state, target_url: s.target_url, description: s.description })),
    // An exploration's guard check fails by design: never a failing test (core isGuardedExploration).
    { exploration: isGuardedExploration({ state: pr.state, draft: pr.draft, labels: pr.labels, headRef: pr.headRef, body: pr.body }) },
  );
  const reviewLikes = reviews.map((r) => ({ user: r.user ? { login: r.user } : null, state: r.state, submitted_at: r.submittedAt ?? null, commit_id: r.commitId ?? null }));
  // Updated after every changes request: the reviewers who asked look again (core lookAgainReviewers, as in Studio).
  const lookAgain = pr.state === 'open' ? lookAgainReviewers(reviewLikes, pr.headSha, pr.author) : [];
  const own = summarizeApprovals(
    reviewLikes,
    who.lists,
    pr.author,
    { soloOwnerCanApproveBoth: config.governance.soloOwnerCanApproveBoth === true },
  );
  const tier = effectiveTier(labels, pr.body, files);
  const merged = pr.state === 'merged';
  const pullLike = { state: merged ? 'closed' : pr.state, draft: pr.draft, labels: pr.labels, merged_at: merged ? 'merged' : null };
  const exploration = isActiveExploration(pr.labels);
  // The pull request that applies an approved suggestion ("Closes #n") carries its approvals, as in Studio.
  const suggestion = closingIssueNumbers(pr.body).length ? await approvedSuggestionOnGitHub(gh, pr.body, who.gov) : null;
  // A push from the Figma plugin is design-approved, token values only tech-approved too (core withFigmaPushApprovals).
  let tokenRead: ReturnType<typeof tokenChangesOf> | null = null;
  const readTokens = () => (tokenRead ??= tokenChangesOf(gh, config, pr, files, compare?.mergeBase));
  const figmaPush = pr.state === 'open' ? await figmaPushFacts(gh, config, pr, files, compare?.mergeBase, readTokens).catch(() => null) : null;
  // Token values only, whoever opened it: the design approval is all it needs (core withTokenValueApprovals, TV-1).
  const tokenValues = pr.state === 'open' ? await tokenValuesFact(config, pr, files, readTokens).catch(() => false) : false;
  // Tier 1 published by a lead without review (core tier1PublishOf: the app's approving review on the head commit,
  // docs/GOVERNANCE.md "Tier 1 publish by leads"): on its way while the checks do not fail, as in Studio.
  const publishedBy = tier1PublishOf(reviews.map((r) => ({ state: r.state, body: r.body, commit_id: r.commitId ?? null })), pr.headSha);
  // One verdict (core branchVerdict), the one Studio's branch page and status chips read: Tier 1 needs one owner
  // approval, the override is for its owner holders only, an applied suggestion's approvals carry.
  const verdict = branchVerdict({ tier, ci, approvals: own, suggestion, owners: who.lists, override: config.governance.override ?? DEFAULT_OVERRIDE, mergeable: pr.mergeable, ...pullLike, viewer, exploration, ship: who.ship, figmaPush, tokenValues, autoMerge: pr.autoMerge, tier1Published: Boolean(publishedBy), lookAgain });
  const approvals = verdict.approvals!;
  const gate = verdict.gate!;
  const status: ReviewStatusKind = verdict.status;
  const override = verdict.override ?? DEFAULT_OVERRIDE;
  const fresh = freshness({ compare: compare ? { behind_by: compare.behindBy, merge_base_commit: compare.mergeBase ? { sha: compare.mergeBase } : null } : null, mergeable: pr.mergeable, open: pr.state === 'open' });
  const product = productOfBranch(productsOf(config), { files: files.map((f) => f.filename), labels: pr.labels });
  return { config, pr, files, ci, approvals, tier, gate, status, override, suggestion, fresh, compare, exploration, product, lookAgain, lifecycle: pullState(pullLike), write: repo ? hasWriteAccess(repo.permissions) : null, repo, solo: who.solo, lists: who.lists, figmaPush, tokenValues, autoShip: verdict.autoShip, statusLabel: verdict.label, publishedBy };
}

// The status words Studio shows too (core REVIEW_STATUS_LABEL, and reviewStatusLabel's "Updated, look again" through
// branchVerdict): one derivation (reviewStatusKind), one vocabulary.
const STATUS_WORDS = REVIEW_STATUS_LABEL;

// --- reads -------------------------------------------------------------------------------------------------

/** One branch, the way Studio shows it: status, what blocks the merge and who acts, how it stands against main. */
export async function branchStatus(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await reader(ctx);
  const viewer = await viewerOf(ctx, gh);
  const f = await branchFacts(ctx, gh, n, viewer);
  return {
    pr: n,
    title: f.pr.title,
    url: f.pr.url,
    author: f.pr.author,
    product: { key: f.product.key, name: f.product.name },
    lifecycle: f.lifecycle,
    status: { kind: f.status, label: f.statusLabel },
    // A merged or closed branch needs nothing more: null, never a list of approvals it no longer waits for.
    approvalNeeded: f.lifecycle === 'merged' || f.lifecycle === 'closed' ? null : f.tier === 1 ? 'One owner approval' : f.approvals.valuesOnly ? 'Design approval (token values ship after the checks)' : 'Design and tech approval',
    approvals: { approvedBy: f.approvals.approvers, changesRequestedBy: f.approvals.changesRequested, ...(f.lookAgain.length ? { lookAgain: f.lookAgain } : {}), design: f.approvals.design, tech: f.approvals.tech, owner: hasOwnerApproval(f.approvals), ...(f.suggestion ? { carriedFrom: `Suggestion #${f.suggestion.number}: its approvals count here (it applies that approved suggestion).` } : {}), ...(f.solo && (f.tier ?? 3) > 1 ? { soloOwner: soloOwnerSentence(f.solo, Boolean(viewer && viewer.toLowerCase() === f.solo)) } : {}) },
    tests: { state: f.ci.state, label: CI_STATE_LABEL[f.ci.state], failing: f.ci.failed.map((x) => x.name), running: f.ci.pending.map((x) => x.name) },
    main: { state: f.fresh.state, behindBy: f.fresh.behindBy },
    merge: {
      allowed: f.gate.allowed,
      blockedBy: f.gate.reasons,
      ...(viewer ? { you: viewer, youCanShip: f.gate.canShip, ownerOverride: f.gate.overridable } : { you: null, note: 'Without a GitHub token Bridge cannot tell whether you may merge.' }),
    },
    ...(f.publishedBy ? { published: publishedWithoutReview(f.publishedBy) } : {}),
    ...(f.figmaPush ? { fromFigma: { scope: f.figmaPush.scope, shipsByItself: f.autoShip, said: figmaSaid(f.figmaPush, f.autoShip) } } : {}),
    next: nextStep(ctx, f, viewer),
  };
}

/** One sentence on what a push from Figma means for this branch (docs/BUILD-REQUESTS.md). */
function figmaSaid(push: FigmaPush, autoShip: boolean): string {
  if (autoShip) return 'Pushed from Figma, token values only: Bridge merges it by itself once the automatic checks pass. Nobody needs to review it.';
  if (push.scope === 'outside') return 'Pushed from Figma, but it changes a guardrail file: it is reviewed like any branch.';
  return 'Pushed from Figma, so the design is approved. It still needs the tech approval: it renames or removes a token, changes code, or its token changes could not be read.';
}

function nextStep(ctx: BridgeContext, f: Awaited<ReturnType<typeof branchFacts>>, viewer: string | null): string {
  const n = f.pr.number;
  if (f.lifecycle === 'merged') return 'Merged. It goes out with the next library release.';
  if (f.lifecycle === 'closed') return `Closed without merging. ${say(ctx, 'bridge_reopen_branch reopens it', `\`bridge branch reopen ${n}\` reopens it`)} when its work is still there.`;
  if (f.exploration) return `It is an exploration: when the idea is ready, say it is done exploring with ${say(ctx, 'bridge_promote_exploration', `\`bridge explore done #${n}\``)}; it stays open for the developers.`;
  if (f.autoShip && f.ci.state !== 'fail' && f.fresh.state !== 'conflict' && !f.approvals.changesRequested.length && (!f.gate.allowed || !f.figmaPush))
    return f.figmaPush ? 'Pushed from Figma, token values only: it merges by itself once the automatic checks pass.' : 'Token values, design approved: Bridge merges it by itself once the automatic checks pass (decision TV-1).';
  if (f.lifecycle === 'draft') return `Draft: ${say(ctx, 'bridge_send_for_review', `\`bridge branch ready ${n}\``)} asks for review when it is ready.`;
  if (f.approvals.changesRequested.length && f.lookAgain.length) return `Updated after the changes request: waiting for @${f.lookAgain.join(', @')} to look again and approve.`;
  if (f.fresh.state === 'conflict') return `It conflicts with main: ${say(ctx, 'bridge_update_from_main', `\`bridge branch update ${n}\``)} shows the token conflicts to pick (code conflicts stay with a developer).`;
  if (f.gate.allowed) return viewer ? `Ready: ${say(ctx, 'bridge_merge_branch merges it when the person asks', `\`bridge branch merge ${n}\` merges it`)}.` : 'Ready to merge by someone who may ship.';
  const min = overrideReasonMin(f.override);
  if (f.gate.overridable) return `Only approvals are missing and you may use the owner override: ${say(ctx, `bridge_merge_branch with a reason (overrideReason) of at least ${min} characters`, `\`bridge branch merge ${n} --override "why"\` with a reason of at least ${min} characters`)}.`;
  return f.gate.reasons[0] ?? 'Waiting.';
}

/** Whether the viewer can give the missing Tier 1 approval: an owner who has not approved yet (core eligibleReviewers). */
function canGiveApproval(f: Awaited<ReturnType<typeof branchFacts>>, viewer: string): boolean {
  const e = eligibleReviewers('approval', { owners: f.lists, author: f.pr.author, approvers: f.approvals.approvers });
  const v = viewer.toLowerCase();
  if (f.approvals.approvers.some((x) => x.toLowerCase() === v) || f.pr.author.toLowerCase() === v) return false;
  return e.open || e.logins.some((l) => l.toLowerCase() === v);
}

/**
 * What needs me: the review queue (open branches minus running explorations and release automation), each with its
 * status, and the ones where the viewer acts now first: approvals they can give, their own branches blocked or ready.
 */
export async function whatNeedsMe(ctx: BridgeContext, a: { limit?: number | undefined } = {}) {
  const gh = await reader(ctx);
  const { config } = await ctx.config();
  const viewer = await viewerOf(ctx, gh);
  const pulls = await gh.listPullRequests('open');
  const queue = reviewQueue(pulls.map((p) => ({ ...p, state: p.state, head: { ref: p.headRef }, user: { login: p.author }, labels: p.labels.map((name) => ({ name })) }))).slice(0, a.limit ?? 20);
  const who = await people(gh, config);
  const same = (x: string, y: string | null) => Boolean(y && x.toLowerCase() === y.toLowerCase());
  const listed = await Promise.all(
    queue.map(async (p) => {
      const f = await branchFacts(ctx, gh, p.number, viewer).catch(() => null);
      if (!f) return { pr: p.number, title: p.title, url: p.url, author: p.author, status: 'unknown' as ReviewStatusKind, statusLabel: STATUS_WORDS.unknown, yours: same(p.author, viewer), needsYou: null as string | null };
      // A token push from Figma ships by itself: it needs nobody until something holds it (core autoShip).
      if (f.autoShip && f.status !== 'ci-failing' && f.status !== 'conflict' && f.status !== 'changes-requested') return null;
      const mine = same(p.author, viewer);
      const inDesign = viewer ? who.lists.design.some((x) => same(x, viewer)) : false;
      const inTech = viewer ? who.lists.tech.some((x) => same(x, viewer)) : false;
      let needsYou: string | null = null;
      if (viewer && !mine) {
        if (f.status === 'changes-requested' && f.lookAgain.some((x) => same(x, viewer))) needsYou = 'Look again: updated after your changes';
        else if (f.status === 'needs-design' && inDesign) needsYou = 'Your design approval';
        else if (f.status === 'needs-tech' && inTech) needsYou = 'Your tech approval';
        else if (f.status === 'needs-approval' && canGiveApproval(f, viewer)) needsYou = 'Your approval';
        else if (f.status === 'ready' && f.gate.canShip) needsYou = 'Ready for you to merge';
      }
      if (viewer && mine) {
        // Updated after the request: it waits on the reviewers now, not on the author.
        if (f.status === 'changes-requested') needsYou = f.lookAgain.length ? null : 'Changes requested on your branch';
        else if (f.status === 'ci-failing') needsYou = 'Tests fail on your branch';
        else if (f.status === 'conflict') needsYou = 'Your branch conflicts with main';
        else if (f.status === 'ready' && f.gate.canShip) needsYou = 'Your branch is ready to merge';
      }
      // Nobody else can give the missing approvals and the viewer may use the owner override: Studio says "Your turn:
      // owner override" on the same branch.
      if (viewer && !needsYou && f.gate.overridable && !reviewersToAsk({ tier: f.tier, approvals: f.approvals, owners: who.lists, author: p.author, viewer }).length) needsYou = 'Only the owner override can merge it';
      return { pr: p.number, title: p.title, url: p.url, author: p.author, product: f.product.name, status: f.status, statusLabel: f.statusLabel, yours: mine, needsYou };
    }),
  );
  const rows = listed.filter((r): r is NonNullable<typeof r> => r !== null);
  rows.sort((x, y) => Number(Boolean(y.needsYou)) - Number(Boolean(x.needsYou)) || REVIEW_STATUS_ORDER[x.status] - REVIEW_STATUS_ORDER[y.status]);
  const mineCount = rows.filter((r) => r.needsYou).length;
  return {
    viewer,
    summary: viewer
    ? `${mineCount ? `${mineCount} ${mineCount === 1 ? 'branch needs' : 'branches need'} you` : 'Nothing needs you right now'}; ${rows.length} in review.`
      : `${rows.length} in review. Set a GitHub token so Bridge knows which ones need you.`,
    branches: rows,
  };
}

/**
 * Whether Bridge reaches a product's own repository with this token: connected (may create explorations there),
 * read-only, not-connected (GitHub hides it: the Bridge app is not installed there, or the token does not reach it),
 * or unknown (GitHub did not answer). Lists leave an unreachable product repository out silently; this is where it is said.
 */
async function productConnection(ctx: BridgeContext, repo: string): Promise<'connected' | 'read-only' | 'not-connected' | 'unknown'> {
  try {
    const a = await productRepoAccess(productClient(ctx, repo));
    return a.ok ? (ctx.canWriteRemote ? 'connected' : 'read-only') : a.reason;
  } catch {
    return 'unknown';
  }
}

/** The configured products, and the one the current folder or repo belongs to (the default for new work). */
export async function listProducts(ctx: BridgeContext) {
  const { config } = await ctx.config();
  const products = productsOf(config);
  const here = await productHere(ctx, config);
  const ds = (await ctx.github().catch(() => null))?.fullName ?? (config.repo ? `${config.repo.owner}/${config.repo.name}` : null);
  // One read per product with its own repository: whether its explorations show up in the lists.
  const own = new Map(await Promise.all(productRepos(products, ds).map(async (x) => [x.product.key, await productConnection(ctx, x.repo)] as const)));
  return {
    products: products.map((p) => ({
      key: p.key,
      name: p.name,
      ...(p.repo ? { repo: p.repo } : {}),
      ...(own.has(p.key) ? { connection: own.get(p.key)!, ...(own.get(p.key) === 'not-connected' ? { connect: `Install the Bridge GitHub App on ${p.repo} (or give the token access to it): until then its explorations are left out of the lists.` } : {}) } : {}),
      ...(p.path ? { path: p.path } : {}),
      ...(p.preview ? { preview: p.preview } : {}),
      ...(p.framework ? { framework: p.framework } : {}),
      default: p === defaultProduct(products),
    })),
    current: { key: here.product.key, name: here.product.name, how: here.how },
    howToPick: 'Pass "product" (key or name) to the tools that start work. Without it Bridge uses the product of the current folder or repo, else the default product. Ask the person when it is not obvious.',
  };
}

/** The product of the folder the server or the CLI runs in: a product repo, a product folder, else the default. */
async function productHere(ctx: BridgeContext, config: BridgeConfig) {
  const products = productsOf(config);
  if (ctx.mode !== 'local' || !ctx.root) return productForPlace(products, {});
  const cwd = process.cwd();
  const rel = relative(ctx.root, cwd);
  const repo = await originRepo(cwd).catch(() => undefined);
  const ds = config.repo ? `${config.repo.owner}/${config.repo.name}` : await originRepo(ctx.root).catch(() => undefined);
  return productForPlace(products, { relPath: rel.startsWith('..') ? null : rel, repo: repo ?? null, designSystemRepo: ds ?? null });
}

/**
 * The product new work belongs to: the one named (key or name), else the product of the current folder or repo.
 * Throws with the list when the name is unknown.
 */
export async function resolveProduct(ctx: BridgeContext, name?: string | undefined): Promise<ProductConfig> {
  const { config } = await ctx.config();
  const products = productsOf(config);
  if (name?.trim()) {
    const p = findProduct(products, name);
    if (!p) throw new Error(`Unknown product "${name}". Pick one of: ${products.map((x) => `${x.key} (${x.name})`).join(', ')}. Products are listed in bridge.config.json "products".`);
    return p;
  }
  // Inside a connected product repository (.bridge/product.json): that product.
  const linked = ctx.product ? findProduct(products, ctx.product) : undefined;
  if (ctx.product && !linked) throw new Error(`.bridge/product.json names the product "${ctx.product}", which ${products.length ? `is not in the design system's bridge.config.json "products" (${products.map((x) => x.key).join(', ')})` : 'the design system does not list'}. Run \`bridge connect --product <key>\` again with one of them.`);
  if (linked) return linked;
  return (await productHere(ctx, config)).product;
}

/** Labels and a body line for a branch that starts work for a product: the core rule Studio writes too. */
export { productMarks } from '@bridge-ds/core';

/**
 * Try it in a product and share it with a product team: the preview of each product Vercel reported for this branch
 * (opened with the Bridge toolbar on it), and the install command product teams use in a staging branch, with a
 * ready-to-paste message. Nothing is written.
 */
export async function tryBranch(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await reader(ctx);
  const { config } = await ctx.config();
  const pr = await gh.getPullRequest(n);
  const [files, comments] = await Promise.all([gh.listPullRequestFiles(n), gh.listIssueComments(n).catch(() => [])]);
  const previews = await branchPreviewUrls(gh, n, config, { branch: pr.headRef, sha: pr.headSha, comments }).catch(() => []);
  const apps = config.previews?.apps ?? {};
  const products = productsOf(config).map((p) => {
    // A product whose preview pattern is a configured app takes the URL Vercel reported for that app (never the
    // template: Vercel shortens long branch aliases), the product's own app with the Bridge toolbar on, as in Studio.
    const app = (Object.entries(apps) as [string, string | undefined][]).find(([, t]) => t && t === p.preview)?.[0];
    const hit = app ? previews.find((x) => x.app === app && x.url && x.source !== 'template' && x.state !== 'failed') : undefined;
    const reported = hit?.url ?? null;
    const pattern = !app && p.preview ? previewUrl(p.preview, { branch: pr.headRef, pr: n, sha: pr.headSha }) : null;
    const url = reported ? (app === p.key ? tryInProductUrl(reported, n, null) : reported) : pattern;
    return { key: p.key, name: p.name, url, how: reported ? 'reported by Vercel' : pattern ? 'from the preview pattern in bridge.config.json (it may not exist yet)' : 'no preview reported yet' };
  });
  const lifecycle = lifecycleOf(pr.state, pr.draft);
  const packages = config.previews?.packages ?? [];
  const share = shareState({ lifecycle, files: files.map((f) => f.filename), packages, comment: comments.find((c) => c.body.includes('<!-- bridge-branch-preview -->'))?.body, headSha: pr.headSha });
  const tryUrl = products.find((p) => p.url && p.how === 'reported by Vercel')?.url ?? null;
  const message = shareMessage({ title: pr.title, state: share, packages, tryUrl, url: pr.url });
  // Nothing online reported (explorations and library branches are not deployed): try it on a developer's machine.
  const local = noOnlinePreview(previews) ? { branch: pr.headRef, command: localTryCommand(pr.headRef) } : null;
  return {
    pr: n,
    title: pr.title,
    tryInProduct: products,
    local,
    previews: previews.map((p) => ({ app: p.app, label: p.label, url: p.url, state: p.state })),
    share: {
      state: share.kind,
      install: share.kind === 'ready' ? share.command : null,
      sentence: stateSentence(share) ?? 'Product teams can install this change in their app before it is in the library, and remove it any time.',
      ...(message ? { message } : {}),
    },
  };
}

/**
 * Combined preview of 2 to 4 token branches: the conflicts to pick ("use #118's"), how many tokens change, and the
 * links that open the combination (the product with the Bridge toolbar, the library views). Nothing is written.
 */
export async function combineBranches(ctx: BridgeContext, a: { prs: (number | string)[]; picks?: Record<string, number> | undefined }) {
  const numbers = [...new Set(a.prs.map(branchNumber))];
  if (numbers.length < MIN_TOGETHER || numbers.length > MAX_TOGETHER) throw new Error(`Pick ${MIN_TOGETHER} to ${MAX_TOGETHER} branches to try together (you gave ${numbers.length}).`);
  const gh = await reader(ctx);
  const { config } = await ctx.config();
  const base = baseBranchOf(config);
  const root = config.tokens.root;
  const pulls = await Promise.all(numbers.map((n) => gh.getPullRequest(n)));
  const branches = await Promise.all(pulls.map((p) => readCombineBranch(gh, { number: p.number, title: p.title, headSha: p.headSha }, { base, tokensRoot: root })));
  const code = branches.filter((b) => !b.tokens);
  if (code.length) throw new Error(`#${code.map((b) => b.number).join(', #')} ${code.length === 1 ? 'changes' : 'change'} code, so ${code.length === 1 ? 'it' : 'they'} can't be combined here. Pick branches that only change tokens.`);
  const latest: Record<string, string> = {};
  const files = (await gh.listFiles(base)).filter((f) => f.startsWith(`${root}/`) && f.endsWith('.tokens.json'));
  await Promise.all(files.map(async (f) => (latest[f.slice(root.length + 1)] = (await gh.readFile(f, base)) ?? '')));
  const picks = a.picks ?? {};
  const combo = combineChanges(latest, branches.map((b) => b.edits!), picks);
  const titles = new Map(pulls.map((p) => [p.number, p.title]));
  const admin = config.previews?.production?.admin;
  const docs = config.previews?.production?.docs;
  return {
    branches: pulls.map((p) => ({ pr: p.number, title: p.title })),
    tokens: combo.tokens,
    conflicts: combo.conflicts.map((c) => ({ key: c.key, token: c.path, file: c.file, options: c.options.map((o) => ({ use: o.changes[0], titles: o.changes.map((x) => titles.get(x) ?? `#${x}`) })), picked: picks[c.key] ?? null })),
    missingPicks: combo.missing.length,
    problems: combo.problems,
    open: {
      ...(admin ? { product: tryTogetherUrl(admin, numbers, picks) } : {}),
      ...(docs ? { library: `${docs.replace(/\/$/, '')}/?change=${numbers.join(',')}` } : {}),
    },
    next: combo.missing.length ? `Pick a value for ${combo.missing.length} token${combo.missing.length === 1 ? '' : 's'}: pass picks {"<key>": <branch number>}.` : 'Open the links to see them together. Nothing was written.',
  };
}

// --- writes ------------------------------------------------------------------------------------------------

/** Ask for review: a draft branch becomes ready for review (Studio "Mark as ready"). Its author only, as in Studio. */
export async function sendForReview(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Sending a branch for review', RIGHTS.draft);
  const [pr, viewer] = await Promise.all([gh.getPullRequest(n), gh.getViewer()]);
  if (pr.author.toLowerCase() !== viewer.login.toLowerCase()) throw new Error(`Only its author (@${pr.author}) sends #${n} for review, as in Studio. Ask them, or comment with ${say(ctx, 'bridge_comment', `\`bridge branch comment ${n} "text"\``)}.`);
  if (isActiveExploration(pr.labels)) throw new Error(`#${n} is an exploration: say it is done exploring with ${say(ctx, 'bridge_promote_exploration', `\`bridge explore done #${n}\``)} instead.`);
  if (pr.state !== 'open') throw new Error(`#${n} is ${pr.state}: reopen it first with ${say(ctx, 'bridge_reopen_branch', `\`bridge branch reopen ${n}\``)}.`);
  if (!pr.draft) return { pr: n, status: 'already-in-review' as const, said: 'It is already in review. Reviewers can see it.' };
  await gh.markReadyForReview(n);
  return { pr: n, status: 'in-review' as const, said: 'Review requested. Reviewers can see it now.', url: pr.url };
}

/** Back to draft: the author takes a branch out of review (Studio More menu). */
export async function backToDraft(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Taking a branch back to draft', RIGHTS.draft);
  const [pr, viewer] = await Promise.all([gh.getPullRequest(n), gh.getViewer()]);
  if (pr.author.toLowerCase() !== viewer.login.toLowerCase()) throw new Error(`Only its author (@${pr.author}) takes #${n} back to draft, as in Studio.`);
  if (isActiveExploration(pr.labels)) throw new Error(`#${n} is an exploration: it is a draft until promoted.`);
  await gh.convertToDraft(n);
  return { pr: n, status: 'draft' as const, said: 'Back to draft. Reviewers are not asked until you send it for review again.' };
}

/** Approve, request changes or comment as a review, on the head the reviewer saw (Studio review box). */
export async function reviewBranch(ctx: BridgeContext, a: { pr: number | string; decision: 'approve' | 'request_changes' | 'comment'; body?: string | undefined }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Reviewing a branch', RIGHTS.review);
  const pr = await gh.getPullRequest(n);
  const event = ({ approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' } as const)[a.decision] as ReviewEvent;
  const r = await reviewOnGitHub(gh, { number: n, event, body: a.body, headSha: pr.headSha });
  const said = { APPROVE: 'Approved.', REQUEST_CHANGES: 'Changes requested.', COMMENT: 'Comment posted.' }[event];
  return { pr: n, decision: a.decision, id: r.id, said, note: event === 'APPROVE' ? 'Recorded under your GitHub account, on the version you saw.' : undefined };
}

/**
 * "Ask someone else to review" (the review queue): asks the other people who can give the missing approvals, and
 * takes the viewer off the requested reviewers. Studio's rule (core reviewersToAsk): never the viewer or the author.
 */
export async function askSomeoneElse(ctx: BridgeContext, a: { pr: number | string; dryRun?: boolean | undefined }) {
  const n = branchNumber(a.pr);
  const gh = a.dryRun ? await reader(ctx) : await writer(ctx, 'Asking someone else to review', RIGHTS.review);
  const viewer = await viewerOf(ctx, gh);
  const f = await branchFacts(ctx, gh, n, viewer);
  if (f.lifecycle !== 'open') throw new Error(`#${n} is ${f.lifecycle === 'draft' ? 'a draft: send it for review first' : f.lifecycle}, so there is no review to ask for.`);
  const { lists } = await people(gh, f.config);
  const others = reviewersToAsk({ tier: f.tier, approvals: f.approvals, owners: lists, author: f.pr.author, viewer });
  if (!others.length) throw new Error('Nobody else can give the missing approval. Review it, or ask an owner in Settings to add a reviewer.');
  if (a.dryRun) return { pr: n, status: 'would-ask' as const, asks: others.map((l) => `@${l}`), said: `Would ask ${others.map((l) => `@${l}`).join(', ')} to review.` };
  await askOthersToReviewOnGitHub(gh, { number: n, others, viewer, viewerRequested: Boolean(viewer && f.pr.requestedReviewers.some((r) => r.toLowerCase() === viewer.toLowerCase())) });
  return { pr: n, status: 'asked' as const, asked: others.map((l) => `@${l}`), said: `Asked ${others.map((l) => `@${l}`).join(', ')} to review.` };
}

/** A comment on the branch, or a reply in the thread of a line comment. */
export async function commentOnBranch(ctx: BridgeContext, a: { pr: number | string; body: string; replyTo?: number | undefined }) {
  const n = branchNumber(a.pr);
  const text = a.body.trim();
  if (!text) throw new Error('Write the comment first.');
  const gh = await writer(ctx, 'Commenting on a branch', RIGHTS.comment);
  if (a.replyTo) {
    const r = await gh.replyToReviewComment(n, a.replyTo, text);
    return { pr: n, replied: a.replyTo, url: r.url, said: 'Reply posted in the thread.' };
  }
  const r = await commentOnGitHub(gh, n, text);
  return { pr: n, url: r.url, said: 'Comment posted.' };
}

/** The comments of a branch: the conversation and the line threads (ids to reply to). */
export async function listComments(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await reader(ctx);
  const [conversation, lines] = await Promise.all([gh.listIssueComments(n), gh.listReviewComments(n).catch(() => [])]);
  return {
    pr: n,
    conversation: conversation.filter((c) => !c.body.includes('<!-- bridge-branch-preview -->')).map((c) => ({ id: c.id, author: c.author, body: c.body, at: c.updatedAt })),
    threads: lines.filter((c) => !c.inReplyTo).map((c) => ({ id: c.id, author: c.author, file: c.path, line: c.line, body: c.body, url: c.url, replies: lines.filter((r) => r.inReplyTo === c.id).map((r) => ({ id: r.id, author: r.author, body: r.body })) })),
    howToReply: say(ctx, 'bridge_comment with replyTo: the thread id.', `bridge branch comment ${n} "text" --reply-to <thread id>`),
  };
}

/** " Suggestion #8 is marked applied." after a merge that closes suggestions. */
const appliedLine = (ns: number[]) => (ns.length ? ` ${ns.length === 1 ? 'Suggestion' : 'Suggestions'} ${ns.map((x) => `#${x}`).join(', ')} ${ns.length === 1 ? 'is' : 'are'} marked applied.` : '');

/**
 * Merge, through the same gate as Studio's Merge button (tests, approvals for the tier, who may ship, conflicts,
 * drafts and explorations; core branchVerdict). With `overrideReason`, the owner override: only missing approvals are
 * skipped, the reason (always required, at least `minReasonLength` characters, 20 by default) is posted on the branch
 * first, and only the owners governance.override.allowed names may use it.
 */
export async function mergeBranch(ctx: BridgeContext, a: { pr: number | string; overrideReason?: string | undefined; dryRun?: boolean | undefined }) {
  const n = branchNumber(a.pr);
  // A dry run only reads: without a token it checks every rule but who you are (who may ship, the override).
  if (a.dryRun && !ctx.canWriteRemote) {
    const gh = await reader(ctx);
    const f = await branchFacts(ctx, gh, n, null);
    // Without a viewer the gate leaves out who may ship and the override (core mergeGate), like Studio signed out.
    const note = `Without a GitHub token Bridge cannot tell whether you may merge (who ships, the owner override): ${addToken(ctx)} to check that too.`;
    if (f.gate.allowed) return { pr: n, status: 'would-merge' as const, said: `Every rule Bridge can check without a token passes. ${note}`, note };
    return { pr: n, status: 'blocked' as const, blockedBy: f.gate.reasons, said: `#${n} cannot be merged yet: ${f.gate.reasons.join(' ')}`, note };
  }
  const gh = await writer(ctx, 'Merging a branch', RIGHTS.merge);
  const viewer = (await gh.getViewer()).login;
  const f = await branchFacts(ctx, gh, n, viewer);
  // The override as the gate reads it: its owner holders only (core ownerOverridePolicy, through branchVerdict).
  const policy = f.override;
  const min = overrideReasonMin(policy);
  const reason = a.overrideReason?.trim();
  if (f.write === false) throw new BlockedError(`@${viewer} cannot write to ${gh.fullName}, so GitHub refuses the merge. Ask someone with write access.`);
  if (f.gate.allowed) {
    if (a.dryRun) return { pr: n, status: 'would-merge' as const, said: 'Every rule passes: it can be merged.' };
    const r = await mergeOnGitHub(gh, { number: n, headSha: f.pr.headSha, method: 'squash', draft: f.pr.draft });
    const s = await markSuggestionsAppliedOnGitHub(gh, f.pr);
    return { pr: n, status: 'merged' as const, sha: r.sha, said: `Merged. It goes out with the next library release.${appliedLine(s.applied)}`, ...(s.warnings.length ? { warnings: s.warnings } : {}) };
  }
  if (!reason) {
    const how = say(ctx, `pass overrideReason (at least ${min} characters)`, `run \`bridge branch merge ${n} --override "why"\` (a reason of at least ${min} characters)`);
    const hint = f.gate.overridable ? ` Only approvals are missing and @${viewer} may use the owner override: ${how}, it is posted on the branch.` : '';
    const said = `#${n} cannot be merged yet: ${f.gate.reasons.join(' ')}${hint}`;
    if (a.dryRun) return { pr: n, status: 'blocked' as const, blockedBy: f.gate.reasons, said };
    throw new BlockedError(said);
  }
  if (!canOverride(viewer, policy)) throw new BlockedError(`@${viewer} is not allowed to use the owner override: only the owners governance.override.allowed names in bridge.config.json may use it. It still needs: ${f.gate.missing.join(', ') || f.gate.reasons.join(' ')}`);
  if (!f.gate.overridable) throw new BlockedError(`The owner override only skips missing approvals. #${n} is blocked by: ${f.gate.reasons.join(' ')}`);
  const problem = overrideReasonProblem(reason, policy);
  if (problem) throw new Error(problem);
  if (a.dryRun) return { pr: n, status: 'would-override' as const, skips: f.gate.missing, said: 'The override would post your reason on the branch, then merge.' };
  const method = allowedMergeMethods(f.repo)[0] ?? 'squash';
  try {
    const r = await overrideMergeOnGitHub(gh, { number: n, headSha: f.pr.headSha, login: viewer, reason, missing: f.gate.missing, method, draft: f.pr.draft });
    const s = await markSuggestionsAppliedOnGitHub(gh, f.pr);
    return { pr: n, status: 'merged' as const, override: true, sha: r.sha, reasonUrl: r.commentUrl, said: `Merged as owner override. The reason is on #${n}.${appliedLine(s.applied)}`, ...(s.warnings.length ? { warnings: s.warnings } : {}) };
  } catch (err) {
    if (err instanceof OverrideMergeError) throw new Error(err.message);
    throw err;
  }
}

/** Close without merging (Studio More menu). The work stays on GitHub and the branch can be reopened. */
export async function closeBranch(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Closing a branch', RIGHTS.review);
  const pr = await gh.getPullRequest(n);
  if (isActiveExploration(pr.labels)) throw new Error(`#${n} is an exploration: close it with ${say(ctx, 'bridge_close_exploration', `\`bridge explore close #${n}\``)}.`);
  if (pr.state !== 'open') return { pr: n, status: pr.state, said: `It is already ${pr.state}.` };
  await closeOnGitHub(gh, n);
  return { pr: n, status: 'closed' as const, said: 'Closed. It can be reopened while its work is still there.' };
}

/** Reopen a closed branch: its author or an owner, with write access, while its work is still there (Studio rule). */
export async function reopenBranch(ctx: BridgeContext, a: { pr: number | string }) {
  const n = branchNumber(a.pr);
  const gh = await writer(ctx, 'Reopening a branch', RIGHTS.review);
  const { config } = await ctx.config();
  const [pr, viewer, repo] = await Promise.all([gh.getPullRequest(n), gh.getViewer(), gh.getMergeSettings().catch(() => null)]);
  if (pr.state === 'merged') throw new Error(`#${n} is merged: it cannot be reopened. Undo it with ${say(ctx, 'bridge_plan_revert and bridge_propose_revert', `\`bridge revert ${n} --dry-run\`, then \`bridge revert ${n}\``)}.`);
  const exists = await gh.getBranchSha(pr.headRef).then((s) => (s ? 'exists' : 'gone'), () => 'unknown' as const);
  const owners = [...config.governance.owners.design, ...config.governance.owners.tech];
  const ok = reopenEligibility({ state: pr.state === 'closed' ? 'closed' : 'open', viewer: viewer.login, author: pr.author, owners, canWrite: hasWriteAccess(repo?.permissions), branch: exists as 'exists' | 'gone' | 'unknown' });
  if (pr.state === 'open') return { pr: n, status: 'open' as const, said: 'It is already open.' };
  if (ok.kind === 'gone') throw new Error(`#${n} can't be reopened: its work was removed. Start a new branch with its token edits (${say(ctx, 'bridge_propose_token_change', '`bridge propose`')}).`);
  if (ok.kind !== 'reopen') throw new Error(`Only its author (@${pr.author}) or an owner with write access reopens #${n}, as in Studio.`);
  await reopenOnGitHub(gh, n);
  return { pr: n, status: 'open' as const, said: 'Reopened. It is back in review with its earlier approvals and checks.' };
}

/**
 * Update from main: when nothing conflicts, GitHub's update-branch. When only token files conflict, the conflicts to
 * pick ("mine": keep the branch's value, "theirs": use main's) and, once every one is picked, a merge commit with those
 * choices. Code conflicts stay with a developer on GitHub, as in Studio.
 */
export async function updateFromMain(ctx: BridgeContext, a: { pr: number | string; choices?: MergeChoices | undefined; dryRun?: boolean | undefined }) {
  const n = branchNumber(a.pr);
  const gh = a.dryRun ? await reader(ctx) : await writer(ctx, 'Updating a branch from main', RIGHTS.update);
  const { config } = await ctx.config();
  const pr = await gh.getPullRequest(n);
  if (pr.state !== 'open') throw new Error(`#${n} is ${pr.state}: only an open branch is updated from main.`);
  const compare = await gh.compareDetailed(pr.baseRef, pr.headSha);
  const fresh = freshness({ compare: { behind_by: compare.behindBy, merge_base_commit: compare.mergeBase ? { sha: compare.mergeBase } : null }, mergeable: pr.mergeable, open: true });
  if (fresh.state === 'current') return { pr: n, status: 'up-to-date' as const, said: `It already has the latest ${pr.baseRef}.` };
  if (fresh.state === 'behind') {
    if (a.dryRun) return { pr: n, status: 'would-update' as const, behindBy: fresh.behindBy, said: `${pr.baseRef} has ${fresh.behindBy} new update${fresh.behindBy === 1 ? '' : 's'}; nothing conflicts.` };
    await gh.updatePullRequestBranch(n, pr.headSha);
    return { pr: n, status: 'updated' as const, said: `Updated from ${pr.baseRef}. Checks run again; approvals may need renewing.` };
  }
  if (fresh.state === 'unknown') throw new Error(`GitHub has not said yet whether #${n} merges cleanly. Try again in a minute.`);
  const data = await readLibraryConflicts(gh, compare, pr.headSha, { tokensRoot: config.tokens.root });
  if (data.route.kind === 'code' || !data.tokens) {
    throw new Error(`#${n} conflicts with ${pr.baseRef} in code${data.route.files.length ? ` (${data.route.files.slice(0, 5).join(', ')})` : ''}. A developer resolves that on GitHub: ${pr.url}`);
  }
  const conflicts = data.tokens.plan.conflicts.map((c) => ({ key: c.key, token: c.path, file: c.file, mine: c.mine ?? null, theirs: c.theirs ?? null, default: c.defaultChoice }));
  const choices = a.choices ?? {};
  const missing = missingChoices(data.tokens.plan, choices);
  if (a.dryRun || missing.length) {
    return {
      pr: n,
      status: 'token-conflicts' as const,
      conflicts,
      missing: missing.map((c) => c.key),
      said: missing.length ? `${missing.length} token${missing.length === 1 ? '' : 's'} changed here and on ${pr.baseRef} without a default: pick "mine" or "theirs" for each key in choices.` : `${conflicts.length} token conflict${conflicts.length === 1 ? '' : 's'}; pass choices ("mine" keeps this branch, "theirs" uses ${pr.baseRef}) or run without dryRun to keep the defaults.`,
    };
  }
  const viewer = await gh.getViewer().then((v) => v.login, () => null);
  const sha = await commitLibraryResolution(gh, { head: { ref: pr.headRef, sha: pr.headSha }, base: { ref: pr.baseRef } }, data, choices, viewer);
  return { pr: n, status: 'resolved' as const, commit: sha, said: `Brought in the latest ${pr.baseRef} with your token choices. Checks run again.` };
}

/** Who may add edits to a branch, and its head, for bridge_propose_token_change with `pr` (Studio "Edit tokens in this branch"). */
export async function addableBranch(ctx: BridgeContext, n: number) {
  const gh = await writer(ctx, 'Adding edits to a branch', RIGHTS.update);
  const [pr, viewer, repo] = await Promise.all([gh.getPullRequest(n), gh.getViewer(), gh.getMergeSettings().catch(() => null)]);
  if (pr.state !== 'open') throw new Error(`#${n} is ${pr.state}: only an open branch takes more edits. Start a new one instead.`);
  if (isActiveExploration(pr.labels)) throw new Error(`#${n} is an exploration: pass branch "${pr.headRef}" instead of pr.`);
  if (!canAddTo({ user: { login: pr.author } }, viewer.login, hasWriteAccess(repo?.permissions))) throw new Error(`Only its author (@${pr.author}) or someone with write access adds edits to #${n}.`);
  return { gh, pr, viewer: viewer.login, comment: (paths: string[]) => addedComment(paths, viewer.login, 'an AI tool through the Bridge MCP server') };
}
