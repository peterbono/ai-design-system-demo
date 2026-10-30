// Explorations for Claude and the CLI: start one (`explore/<slug>` + a draft pull request labeled exploration), list
// them with their previews, snapshot install command and linked requests, say "Done exploring" on one (its pieces to
// the DS lead as requests, the branch to the developers, nothing closed), archive one, close one. And the
// "target branch" of the write tools: token edits, docs drafts and request briefs aimed at an exploration branch
// instead of a new pull request to main. The rules and the GitHub calls are @bridge-ds/core's (explorations.ts,
// explorations-github.ts); this file shapes them for the MCP tools and the CLI.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  archiveExplorationOnGitHub,
  baseBranchOf,
  doneExploringOnGitHub,
  parsePiecesRecord,
  productsOf,
  closeExplorationOnGitHub,
  EXPLORATION_LABEL,
  EXPLORATION_PREFIX,
  EXPLORATION_USE_CASES,
  explorationBranch,
  explorationNote,
  explorationNotePath,
  explorationPrBody,
  explorationPrTitle,
  explorationProblems,
  explorationRules,
  explorationStartMessage,
  productRepoAccess,
  productRepoOf,
  explorationSlug,
  explorationTestBuildOnGitHub,
  explorationRefLabel,
  findExplorationOnGitHub,
  branchPreviewUrls,
  previewLinksOf,
  productPreviewOnGitHub,
  listProductExplorationsOnGitHub,
  isExplorationBranch,
  listExplorationsOnGitHub,
  parseRequestIssue,
  protectedBranchesOf,
  startExplorationOnGitHub,
  type BridgeConfig,
  type Exploration,
  type ExplorationSource,
  type ExplorationTryIt,
  type ExplorationUseCase,
  type GitHubClient,
  type ProductConfig,
  continueLines,
  actorName,
  explorationActivity,
  explorationStage,
  explorationStatus,
  isArchivedExploration,
  parseExplorationBody,
  productOfBranch,
  shortAgo,
  whereItStands,
  EXPLORATION_STATUS_LABEL,
} from '@bridge-ds/core';
import { branchExists, commitToNewLocalBranch, currentBranch, git } from '@bridge-ds/core/node';
import { BridgeContext } from './context.js';
import { productMarks, resolveProduct, viewerOf } from './branches.js';
import { addToken, readOnlyPreview, say } from './say.js';
import { locate, productClient, type Located } from './product-repos.js';

const USE_CASES = new Set<string>(EXPLORATION_USE_CASES.map((u) => u.value));

export const settingsOf = (config: BridgeConfig) => ({ base: baseBranchOf(config), packages: config.previews?.packages ?? [], apps: config.previews?.apps ?? {} });

async function requireGitHub(ctx: BridgeContext): Promise<GitHubClient> {
  const gh = await ctx.github();
  if (!gh) throw new Error('No GitHub repo known: set "repo" in bridge.config.json or add an origin remote. Explorations are draft pull requests.');
  return gh;
}

/** `explore/<slug>` from a branch, a slug or a name; throws with how to fix it when it cannot be one. */
export function toExplorationBranch(ref: string): string {
  const raw = ref.trim().replace(/^refs\/heads\//, '');
  if ((raw.includes('/') && !raw.startsWith(EXPLORATION_PREFIX)) || ['main', 'master', 'head'].includes(raw.toLowerCase())) throw new Error(`"${raw}" is not an exploration branch. Exploration branches are named explore/<name>; other changes open their own pull request, never on main.`);
  const branch = raw.startsWith(EXPLORATION_PREFIX) ? raw : explorationBranch(raw);
  if (!isExplorationBranch(branch)) throw new Error(`"${raw}" is not an exploration branch. Use explore/<name>, lowercase letters, digits and dashes.`);
  return branch;
}

export interface StartExplorationInput {
  name: string;
  /** What the designer wants to learn. Optional: nobody is asked for a brief; Claude passes their first sentence when it has one. */
  purpose?: string | undefined;
  useCase?: string | undefined;
  experimental?: string[] | undefined;
  author?: string | undefined;
  /** Where it is started from (the MCP tool says mcp, the CLI says cli), and the AI agent behind it when known. */
  source?: ExplorationSource | undefined;
  agent?: string | undefined;
  /** The product it is tried in (key or name, bridge.config.json "products"). Default: the product of the current folder or repo. */
  product?: string | undefined;
  /**
   * Where the branch is created. `product` (the default): in the product's own repository when the team connected one
   * (bridge.config.json products[].repo), else in the design system repository. `library`: always in the design system
   * repository, the fallback when the person chooses it because Bridge cannot reach the product repository.
   */
  where?: 'product' | 'library' | undefined;
  dryRun?: boolean | undefined;
}

/** What Claude says when Bridge cannot reach a product's own repository: the admin action first, the fallback on request. */
export function productRepoBlocked(ctx: BridgeContext, product: string, repo: string, reason: 'not-connected' | 'read-only' | 'no-token'): string {
  const why =
    reason === 'read-only'
      ? `You can read ${repo} but not create branches there.`
      : reason === 'no-token'
        ? `Starting it in ${repo} needs a GitHub token that reaches it (${addToken(ctx)}).`
        : `Bridge is not connected to ${repo} yet, or this token does not reach it.`;
  return `${product} explorations are created in its own repository (${repo}). ${why} Ask an admin to connect ${product} to Bridge (install the Bridge GitHub App on ${repo}, or give the token access to it). Or, only if the person chooses it, start it in the design system repository for now (${say(ctx, 'where: "library"', '--in-library')}).`;
}

/**
 * bridge_start_exploration / `bridge explore start`. With a GitHub token: the branch on GitHub from the default branch
 * and a draft pull request labeled exploration. Without one, in a local git repo: a local branch with the note,
 * nothing pushed, and the commands to push it and open the draft pull request.
 */
export async function startExploration(ctx: BridgeContext, a: StartExplorationInput) {
  const problems = explorationProblems({ name: a.name, purpose: a.purpose ?? '' });
  if (problems.length) throw new Error(problems.join(' '));
  if (a.useCase && !USE_CASES.has(a.useCase)) throw new Error(`Unknown use case "${a.useCase}". Use one of: ${[...USE_CASES].join(', ')}.`);
  const { config } = await ctx.config();
  const s = settingsOf(config);
  const slug = explorationSlug(a.name);
  const branch = `${EXPLORATION_PREFIX}${slug}`;
  const e: Exploration = {
    name: a.name.trim(),
    purpose: (a.purpose ?? '').trim(),
    slug,
    ...(a.useCase ? { useCase: a.useCase as ExplorationUseCase } : {}),
    ...(a.experimental?.length ? { experimental: a.experimental } : {}),
    ...(a.author ? { author: a.author } : {}),
    ...(a.source ? { source: a.source } : {}),
    ...(a.agent ? { agent: a.agent } : {}),
    startedAt: new Date().toISOString(),
  };
  const gh = await ctx.github().catch(() => null);
  const product = await resolveProduct(ctx, a.product);
  const marks = productMarks(productsOf(config), product);
  const dsRepo = gh?.fullName ?? (config.repo ? `${config.repo.owner}/${config.repo.name}` : null);
  // A product with its own repository: the exploration is created there, the library comes as the npm package.
  const productRepo = a.where === 'library' ? null : productRepoOf(product, dsRepo);
  if (productRepo) return startInProductRepo(ctx, { e, product, repo: productRepo, library: dsRepo ?? 'the design system repository', labels: marks.labels, dryRun: a.dryRun });
  const preview = {
    branch,
    product: product.name,
    repo: dsRepo,
    inProductRepo: false,
    slug,
    base: s.base,
    title: explorationPrTitle(e),
    label: EXPLORATION_LABEL,
    note: { path: explorationNotePath(slug), content: explorationNote(e) },
    prBody: explorationPrBody(e, { owner: gh?.owner ?? config.repo?.owner ?? 'owner', repo: gh?.name ?? config.repo?.name ?? 'repo', packages: s.packages, apps: s.apps }),
  };
  if (a.dryRun) return { status: 'dry-run' as const, ...preview };
  const work = `Work on it: \`git fetch origin && git switch ${branch}\`. ${say(
    ctx,
    `Token edits: bridge_propose_token_change with "branch": "${branch}". Requests: bridge_create_request with "exploration": "${branch}", then bridge_get_request with "branch": "${branch}".`,
    `Token edits: \`bridge propose --branch ${branch} ...\`. Requests: \`bridge request create --exploration ${branch} ...\`, then \`bridge request implement <n> --branch ${branch}\`.`,
  )} It is never merged as is: say it is done exploring (\`bridge explore done ${slug}\`) to hand it to developers; it stays open.`;
  if (gh && ctx.canWriteRemote) {
    const r = await startExplorationOnGitHub(gh, e, { ...s, labels: marks.labels });
    return {
      status: 'started' as const,
      ...preview,
      pr: r.pr,
      url: r.url,
      commit: r.commit,
      install: installOf(r.tryIt),
      previews: r.previews,
      next: `${work} The install command and the preview links appear on the pull request a few minutes after each push: \`bridge explore list\` reads them.`,
    };
  }
  if (ctx.mode === 'local' && ctx.isGit) {
    if (await branchExists(ctx.root!, branch)) throw new Error(`Branch ${branch} already exists here. Pick another name, or continue it with \`git switch ${branch}\`.`);
    const base = (await branchExists(ctx.root!, s.base)) ? s.base : 'HEAD';
    const protectedBranches = [...new Set([...protectedBranchesOf(config), s.base])];
    const res = await commitToNewLocalBranch(ctx.root!, {
      base,
      branch,
      message: explorationStartMessage(e),
      files: [preview.note],
      protectedBranches,
      branchPrefix: EXPLORATION_PREFIX,
    });
    return {
      status: 'branch-created' as const,
      ...preview,
      commit: res.sha,
      next: `Local branch only, nothing pushed, your working tree is untouched. To share it: \`git push -u origin ${branch}\`, then \`gh pr create --draft --base ${s.base} --head ${branch} --label ${EXPLORATION_LABEL} --title "${preview.title}"\` with ${say(ctx, 'prBody', 'the pull request text from --dry-run')} as the body (or ${addToken(ctx)} and start it again under another name). ${work}`,
    };
  }
  throw new Error(`Starting an exploration needs a GitHub token (contents and pull requests: write), or a local git repo: ${addToken(ctx)}. Without them Bridge is read-only. ${say(ctx, 'Use dryRun', 'Add --dry-run')} to preview it.`);
}

/**
 * An exploration for a product that has its own repository: the branch and the draft pull request there, so developers
 * check it out in their own environment. The library arrives as the npm package (a library branch's snapshot when
 * they try unreleased library changes). Without access, a plain error naming the admin action and the fallback.
 */
async function startInProductRepo(ctx: BridgeContext, x: { e: Exploration; product: ProductConfig; repo: string; library: string; labels: string[]; dryRun?: boolean | undefined }) {
  const { e, product, repo } = x;
  const slug = e.slug!;
  const branch = `${EXPLORATION_PREFIX}${slug}`;
  const inProduct = { name: product.name, library: x.library, ...(product.preview ? { preview: product.preview } : {}) };
  const [owner, name] = repo.split('/') as [string, string];
  const pgh = ctx.githubFor(repo, { protectedBranches: ['main', 'master'], branchPrefix: EXPLORATION_PREFIX });
  const access = ctx.canWriteRemote ? await productRepoAccess(pgh) : null;
  const base = access?.ok ? access.base : 'main';
  const preview = {
    branch,
    product: product.name,
    repo,
    inProductRepo: true,
    slug,
    base,
    title: explorationPrTitle(e),
    label: EXPLORATION_LABEL,
    note: { path: explorationNotePath(slug), content: explorationNote(e) },
    prBody: explorationPrBody(e, { owner, repo: name, packages: [], apps: {}, inProduct }),
  };
  if (x.dryRun) return { status: 'dry-run' as const, ...preview, ...(access && !access.ok ? { blocked: productRepoBlocked(ctx, product.name, repo, access.reason) } : {}) };
  if (!access) throw new Error(productRepoBlocked(ctx, product.name, repo, 'no-token'));
  if (!access.ok) throw new Error(productRepoBlocked(ctx, product.name, repo, access.reason));
  const client = ctx.githubFor(repo, { protectedBranches: [...new Set(['main', 'master', base])], branchPrefix: EXPLORATION_PREFIX });
  const r = await startExplorationOnGitHub(client, e, { base, packages: [], apps: {}, labels: x.labels, inProduct });
  return {
    status: 'started' as const,
    ...preview,
    pr: r.pr,
    url: r.url,
    commit: r.commit,
    next: `It lives in ${repo}: in a checkout of ${product.name}, \`git fetch origin && git switch ${branch}\`, then run ${product.name} as usual and build the screens with the library components. The library comes from npm as on main; to try a library change that is not released yet, install its snapshot (\`npm i @bridge-ds/react@<snapshot>\`, the command is on that library branch). Changes the library needs go to ${x.library} (${say(ctx, 'bridge_propose_token_change or bridge_create_request', '`bridge propose` or `bridge request create`')}), never on this branch.`,
  };
}

/**
 * The install command of an exploration as tools show it: the one the preview workflow published (its sticky comment
 * on the pull request), or why there is none yet. Never a guessed pkg.pr.new URL.
 */
export function installOf(t: ExplorationTryIt): { state: ExplorationTryIt['state']; command: string | null; note: string } {
  if (t.state === 'ready') return { state: 'ready', command: t.command, note: `Snapshot of ${t.sha7 ?? 'the latest commit'}, ${t.source === 'release' ? 'tarballs from the preview prerelease' : t.source === 'pkg.pr.new' ? 'pkg.pr.new' : 'from the preview comment'}. Install it in a product branch that deploys to staging.` };
  if (t.state === 'failed') return { state: 'failed', command: null, note: 'The test build did not finish for the latest commit. The Preview packages run on the pull request says why.' };
  return { state: 'building', command: null, note: 'The test build is being prepared, a few minutes after each push. The command then appears in the "Try this exploration in your product" comment.' };
}

/** Open request issues (label exploration) by exploration branch. A failed listing links nothing. */
async function requestsByExploration(gh: GitHubClient): Promise<Map<string, { number: number; title: string; url: string; state: string }[]>> {
  const out = new Map<string, { number: number; title: string; url: string; state: string }[]>();
  try {
    for (const i of await gh.listIssues({ label: EXPLORATION_LABEL, state: 'all', perPage: 100 })) {
      const branch = parseRequestIssue(i.body)?.exploration;
      if (!branch) continue;
      out.set(branch, [...(out.get(branch) ?? []), { number: i.number, title: i.title, url: i.url, state: i.state }]);
    }
  } catch {
    /* no requests linked */
  }
  return out;
}

/** bridge_list_explorations / `bridge explore list`. */
export async function listExplorations(ctx: BridgeContext, a: { state?: 'open' | 'closed' | 'all'; archived?: boolean | undefined; mine?: boolean | undefined } = {}) {
  const { config } = await ctx.config();
  const gh = await requireGitHub(ctx);
  const opts = { state: a.state ?? 'open', archived: a.archived ? ('only' as const) : ('exclude' as const) };
  // One more read per product with its own repository; one Bridge cannot reach is left out (bridge_list_products says it).
  const [list, linked, inProducts] = await Promise.all([
    listExplorationsOnGitHub(gh, settingsOf(config), opts),
    requestsByExploration(gh),
    listProductExplorationsOnGitHub((repo) => productClient(ctx, repo), productsOf(config), gh.fullName, opts),
  ]);
  const productOnes = inProducts.explorations.map((x) => ({ ...x, ref: explorationRefLabel(x), install: null, requests: [] as { number: number; title: string; url: string; state: string }[], note: `In ${x.repo}: the library comes from npm there, and developers run it in their usual environment.` }));
  // Running ones and the ones with the developers (a living prototype): the real preview URLs (Vercel shortens long
  // branch aliases) and the published install command.
  const dsOnes = await Promise.all(
    list.map(async (summary) => {
      const x = { ...summary, ref: explorationRefLabel(summary) };
      const requests = linked.get(x.branch) ?? [];
      if (x.status !== 'active' && x.status !== 'ready' && x.status !== 'building') return { ...x, install: null, requests };
      const t = await explorationTestBuildOnGitHub(gh, { number: x.number, branch: x.branch }, config).catch(() => null);
      if (!t) return { ...x, install: installOf({ state: 'building' }), requests };
      return { ...x, previews: t.previews.map((p) => ({ app: p.app, label: p.label, url: p.url, state: p.state })), install: installOf(t.tryIt), requests };
    }),
  );
  // mine: the ones the viewer started (the token's account); none when Bridge cannot tell who that is.
  const me = a.mine ? await viewerOf(ctx, gh) : null;
  const explorations = [...dsOnes, ...productOnes].filter((x) => !a.mine || (me !== null && x.author.toLowerCase() === me.toLowerCase()));
  let localBranches: string[] = [];
  if (ctx.mode === 'local' && ctx.isGit) {
    const refs = (await git(ctx.root!, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${EXPLORATION_PREFIX}`]).catch(() => '')).split('\n').filter(Boolean);
    localBranches = refs.filter((b) => !explorations.some((x) => x.branch === b));
  }
  const running = explorations.filter((x) => x.status === 'active').length;
  const handed = explorations.filter((x) => x.status === 'ready' || x.status === 'building').length;
  const first = a.archived ? `${explorations.length} archived ${explorations.length === 1 ? 'exploration' : 'explorations'}` : running ? `${running} ${running === 1 ? 'exploration' : 'explorations'} running` : 'No exploration running';
  return {
    repo: gh.fullName,
    label: EXPLORATION_LABEL,
    running,
    total: explorations.length,
    summary: `${first}${!a.archived && handed ? `, ${handed} with the developers` : ''}.`,
    explorations,
    ...(localBranches.length ? { localBranches, localHint: 'Local exploration branches without a pull request: push them and open a draft pull request labeled exploration to share them.' } : {}),
  };
}

const refOf = (ref: string | number) => (typeof ref === 'number' ? ref : /^#?\d+$/.test(ref.trim()) ? Number(ref.trim().replace(/^#/, '')) : toExplorationBranch(ref));

/** The exploration a reference names, in the design system repository or a product's own one (product-repos.ts). */
async function located(ctx: BridgeContext, ref: string): Promise<Located & { gh: GitHubClient }> {
  return locate(ctx, ref, await requireGitHub(ctx));
}

/**
 * bridge_promote_exploration (kept name) / `bridge explore done` (`promote` is an alias): "Done exploring". The pieces
 * named in `pieces` (ids from bridge_missing_pieces) go to the DS lead as requests with the preview link; the
 * exploration label and note go, `ready-for-devs` comes, and developers take the branch from there. Nothing is closed,
 * merged or marked ready for review, so the preview link stays alive. Without `pieces`, the result lists the pieces
 * still unsent so the person can pick.
 */
export async function doneExploring(ctx: BridgeContext, a: { ref: string; pieces?: string[] | undefined; dryRun?: boolean | undefined; source?: ExplorationSource | undefined; agent?: string | undefined }) {
  const { config } = await ctx.config();
  const ds = await requireGitHub(ctx);
  const at = await locate(ctx, a.ref, ds);
  const gh = at.gh;
  if (!a.dryRun && !ctx.canWriteRemote) throw new Error(`Saying "Done exploring" needs a GitHub token (contents, pull requests and issues: write): ${addToken(ctx)}. Or on GitHub: remove the exploration label and add ready-for-devs, keeping the pull request open.`);
  const p = await findExplorationOnGitHub(gh, refOf(at.ref));
  // The preview the requests link: the first one Vercel reported (the product's preview template in its own
  // repository), else the pull request (pieceRequest says so).
  let previewUrl: string | null;
  if (at.product && at.repo) {
    // The URL Vercel reported in the product repository: a long branch name gets a shortened alias the template misses.
    const pv = await productPreviewOnGitHub(gh, at.product, { number: p.number, branch: p.headRef, sha: p.headSha }).catch(() => null);
    previewUrl = pv?.url && pv.state !== 'failed' && !pv.skipped ? pv.url : null;
  } else {
    const build = await explorationTestBuildOnGitHub(gh, { number: p.number, branch: p.headRef }, config).catch(() => null);
    previewUrl = build?.previews.find((v) => v.url && v.state !== 'failed')?.url ?? null;
  }
  const viewer = await viewerOf(ctx, ds);
  const r = await doneExploringOnGitHub(gh, p.number, {
    // In a product's own repository the requests are filed in the design system repository, where the DS lead works.
    ...(at.repo ? { library: ds.withBranchPrefix(undefined) } : {}),
    pieces: a.pieces ?? [],
    products: productsOf(config),
    previewUrl,
    ...(viewer ? { openedBy: viewer } : {}),
    ...(a.agent ? { agent: a.agent } : {}),
    source: a.source ?? 'mcp',
    dryRun: a.dryRun,
  });
  const record = parsePiecesRecord(p.body);
  const sent = new Set([...(record?.links ?? []).map((l) => l.piece), ...r.pieces.proposed.map((x) => x.piece)]);
  const unsent = (record?.pieces ?? []).filter((x) => !sent.has(x.id)).map((x) => ({ id: x.id, title: x.title, summary: x.summary }));
  const status = a.dryRun ? ('dry-run' as const) : r.handedOff ? ('done-exploring' as const) : ('already-done' as const);
  return {
    status,
    number: r.number,
    ref: explorationRefLabel({ number: r.number, product: at.product?.key, repo: at.repo }),
    ...(at.repo ? { repo: at.repo, product: at.product!.key, requestsIn: ds.fullName } : {}),
    url: r.url,
    branch: r.branch,
    exploration: r.status,
    labels: r.plan ? { add: r.plan.addLabels, remove: r.plan.removeLabels } : null,
    removeFiles: r.plan?.removeFiles ?? [],
    requests: r.pieces.proposed,
    alreadySent: r.pieces.already,
    ...(r.pieces.unknown.length ? { unknownPieces: r.pieces.unknown } : {}),
    notProposed: unsent,
    // Whether the exploration was checked against the library (bridge pieces --record) before saying it.
    checked: Boolean(record),
    forDevelopers: { take: r.take, note: r.note },
    warnings: r.warnings,
    next: [
      record ? (unsent.length ? `${unsent.length} piece${unsent.length === 1 ? ' was' : 's were'} not sent to the DS lead: pass their ids in pieces to send them later.` : '') : `The exploration was not checked against the library: ${say(ctx, `bridge_missing_pieces { pr: "${explorationRefLabel({ number: r.number, product: at.product?.key, repo: at.repo })}", record: true }`, `\`bridge pieces ${explorationRefLabel({ number: r.number, product: at.product?.key, repo: at.repo })} --record\``)} finds the pieces to propose.`,
      `Developers take it with \`${r.take[0]}\` then \`${r.take[1]}\`, as a starting point. The pull request stays open so the preview keeps working; ${say(ctx, 'bridge_archive_exploration', '`bridge explore archive`')} hides it from the lists later.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/**
 * The local working tree when it is a checkout of `repo` (its origin remote names it), else null: Claude only switches
 * branches in the repository the exploration lives in.
 */
async function checkoutOf(ctx: BridgeContext, repo: string): Promise<string | null> {
  // Local mode: the repo Bridge runs on. A connected product repository (.bridge/product.json): its checkout.
  const root = ctx.checkout;
  if (!root) return null;
  const origin = (await git(root, ['remote', 'get-url', 'origin']).catch(() => '')).trim().replace(/\.git$/, '');
  return origin.toLowerCase().endsWith(repo.toLowerCase()) ? root : null;
}

/**
 * Switches the working tree to the exploration branch when that is safe: the checkout of its repository, nothing
 * uncommitted. Otherwise it says what to run, and nothing is touched.
 */
async function switchTo(ctx: BridgeContext, repo: string, branch: string): Promise<{ status: 'already-on-it' | 'switched' | 'not-switched'; note: string }> {
  const root = await checkoutOf(ctx, repo);
  const run = `git fetch origin ${branch} && git switch ${branch}`;
  if (!root) return { status: 'not-switched', note: ctx.mode === 'remote' && !ctx.checkout ? `Work on it through Bridge: pass "branch": "${branch}" to the write tools.` : `This folder is not a checkout of ${repo}. In one: \`${run}\`.` };
  if ((await currentBranch(root).catch(() => '')) === branch) return { status: 'already-on-it', note: `The working tree is on ${branch}.` };
  const dirty = (await git(root, ['status', '--porcelain']).catch(() => 'unknown')).trim();
  if (dirty) {
    const n = dirty.split('\n').length;
    return { status: 'not-switched', note: `Not switched: ${n} ${n === 1 ? 'file has' : 'files have'} uncommitted changes in ${root}, and switching could lose them. Commit or stash them, then \`${run}\`.` };
  }
  try {
    await git(root, ['fetch', 'origin', branch]);
    if (await branchExists(root, branch)) {
      await git(root, ['switch', branch]);
      await git(root, ['merge', '--ff-only', `origin/${branch}`]).catch(() => '');
    } else await git(root, ['switch', '-c', branch, '--track', `origin/${branch}`]);
    return { status: 'switched', note: `Switched the working tree to ${branch}, up to date with GitHub.` };
  } catch (err) {
    return { status: 'not-switched', note: `Bridge could not switch (${(err as Error).message.split('\n')[0]}). Run \`${run}\`.` };
  }
}

/**
 * bridge_continue_exploration / "Continue Bridge exploration #12" (or shop#12): resolves the exploration, switches the
 * local checkout of its repository to its branch when that is safe, and returns where it stands in plain words (what
 * changed, the last activity) for Claude to say first, with the previews and the missing pieces when recorded.
 * One read of the pull request, its files and its commits.
 */
export async function continueExploration(ctx: BridgeContext, a: { ref: string; checkout?: boolean | undefined }) {
  const { config } = await ctx.config();
  const ds = await requireGitHub(ctx);
  const at = await locate(ctx, a.ref.replace(/^\s*continue\s+bridge\s+exploration\s+/i, '').replace(/\s+".*$/, '').trim(), ds);
  const gh = at.gh;
  const p = await findExplorationOnGitHub(gh, refOf(at.ref));
  const [files, commits] = await Promise.all([gh.listPullRequestFiles(p.number).then((f) => f.map((x) => x.filename)).catch(() => null), gh.listPullRequestCommits(p.number).catch(() => [])]);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body });
  const archived = isArchivedExploration(p.labels);
  const stage = explorationStage({ status, archived, files });
  const e = parseExplorationBody(p.body);
  const name = e?.name ?? p.title.replace(/^Exploration:\s*/i, '');
  const products = productsOf(config);
  const product = at.product ?? productOfBranch(products, { labels: p.labels, files: null });
  const repo = at.repo ?? gh.fullName;
  const events = explorationActivity({ commits, author: p.author, startedAt: p.createdAt ?? e?.startedAt ?? null, limit: 3 });
  const ref = explorationRefLabel({ number: p.number, product: at.product?.key, repo: at.repo });
  const checkout = a.checkout === false ? { status: 'not-switched' as const, note: `Not switched. \`git fetch origin ${p.headRef} && git switch ${p.headRef}\`.` } : await switchTo(ctx, repo, p.headRef);
  const record = parsePiecesRecord(p.body);
  // Where to see it: the product's preview Vercel reported in its repository, else the library's apps.
  const previews = at.product
    ? [await productPreviewOnGitHub(gh, at.product, { number: p.number, branch: p.headRef, sha: p.headSha }).catch(() => null)].filter((x) => x !== null)
    : await branchPreviewUrls(gh, p.number, config, { branch: p.headRef, sha: p.headSha }).catch(() => []);
  const keepWorking = at.repo
    ? `Keep working on ${p.headRef} in a checkout of ${at.repo}: build the screens with the library components (bridge_get_component, bridge_search_tokens), commit and push there. What the library lacks goes to the DS lead in ${ds.fullName} with ${say(ctx, `bridge_missing_pieces { pr: "${ref}" }`, `\`bridge pieces ${ref} --record\``)} then Done exploring, never on this branch.`
    : `Keep working on ${p.headRef}: ${say(ctx, `write tools take "branch": "${p.headRef}"`, `\`bridge propose --branch ${p.headRef}\``)}. Build screens with the library components (bridge_search_tokens, bridge_get_token).`;
  return {
    ref,
    number: p.number,
    name,
    product: product.name,
    repo,
    branch: p.headRef,
    url: p.url,
    status,
    statusLabel: EXPLORATION_STATUS_LABEL[status],
    archived,
    stage,
    whereItStands: whereItStands({ name, stage, statusLabel: EXPLORATION_STATUS_LABEL[status], events, files }),
    activity: events.map((x) => ({ who: actorName(x), what: x.text, when: shortAgo(x.at) })),
    changedFiles: files,
    previews: previewLinksOf(previews),
    ...(record ? { missingPieces: record.pieces.map((x) => ({ id: x.id, title: x.title })) } : {}),
    checkout,
    continueLines: continueLines({ number: p.number, name, productName: product.name, product: at.product?.key, repo: at.repo }),
    next: [
      'Start by telling the designer where it stands, in one or two sentences from whereItStands and activity, without technical words, then ask what they want to do next.',
      stage === 'handed' ? 'It is no longer being explored: say so, and only change it if they ask.' : `${keepWorking} Never open a pull request to main from it.`,
    ].join(' '),
  };
}

/** @deprecated The old name: "Promote to review" became "Done exploring" (doneExploring). */
export const promoteExploration = doneExploring;

/** bridge_archive_exploration / `bridge explore archive|unarchive`: the archived label on the still open pull request. */
export async function archiveExploration(ctx: BridgeContext, a: { ref: string; archived?: boolean | undefined }) {
  const at = await located(ctx, a.ref);
  if (!ctx.canWriteRemote) throw new Error(`Archiving an exploration needs a GitHub token (pull requests or issues: write): ${addToken(ctx)}. Or add the archived label on GitHub.`);
  const r = await archiveExplorationOnGitHub(at.gh, refOf(at.ref), { archived: a.archived ?? true });
  return {
    status: r.archived ? ('archived' as const) : ('unarchived' as const),
    ...r,
    ref: explorationRefLabel({ number: r.number, product: at.product?.key, repo: at.repo }),
    ...(at.repo ? { repo: at.repo } : {}),
    next: r.archived ? 'Hidden from the default lists. Its pull request stays open, so the preview link keeps working.' : 'Back in the lists.',
  };
}

export async function closeExploration(ctx: BridgeContext, a: { ref: string }) {
  const at = await located(ctx, a.ref);
  if (!ctx.canWriteRemote) throw new Error(`Closing an exploration needs a GitHub token (pull requests: write): ${addToken(ctx)}. Or close the pull request on GitHub.`);
  return { status: 'closed' as const, ...(await closeExplorationOnGitHub(at.gh, refOf(at.ref))), ...(at.repo ? { repo: at.repo } : {}), note: 'Closing removes its preview. To keep the link alive and only hide it, archive it instead.' };
}

// --- target branch of the write tools ------------------------------------------------------------------------------

/**
 * The context a write aimed at an exploration branch reads from. Remote: the same repo at that branch (it must
 * exist). Local: the working tree, which must have that branch checked out, so Claude works where the designer is.
 */
export async function explorationContext(ctx: BridgeContext, ref: string, opts: { requireCheckout?: boolean } = {}): Promise<{ ctx: BridgeContext; branch: string }> {
  const branch = toExplorationBranch(ref);
  if (ctx.mode === 'remote') {
    const gh = await requireGitHub(ctx);
    if (!(await gh.getBranchSha(branch))) throw new Error(`Branch ${branch} not found on ${gh.fullName}. Start it first with ${say(ctx, 'bridge_start_exploration', '`bridge explore start`')}.`);
    return { ctx: await BridgeContext.create({ ...ctx.opts, ref: branch }), branch };
  }
  if (opts.requireCheckout !== false) {
    if (!ctx.isGit) throw new Error('Not a git repo: an exploration branch needs git.');
    const here = await currentBranch(ctx.root!).catch(() => '');
    if (here !== branch) throw new Error(`Switch to the exploration first: \`git fetch origin && git switch ${branch}\` (you are on ${here || 'a detached HEAD'}). Bridge writes the edits to that working tree.`);
  }
  return { ctx, branch };
}

/** Writes proposal files on an exploration: a commit on the GitHub branch (remote) or the checked-out working tree (local). */
export async function writeToExploration(ctx: BridgeContext, branch: string, input: { message: string; files: { path: string; content: string | null }[] }) {
  if (ctx.mode === 'remote') {
    const gh = await requireGitHub(ctx);
    if (!ctx.canWriteRemote) return { status: 'preview' as const, message: readOnlyPreview(ctx, `commit this to ${branch}`) };
    const res = await gh.withBranchPrefix(EXPLORATION_PREFIX).commitToBranch({ branch, message: input.message, files: input.files });
    const pr = await gh.findOpenPullRequest(branch).catch(() => undefined);
    return {
      status: 'committed' as const,
      branch,
      commit: res.sha,
      ...(pr ? { pr: pr.number, url: pr.url } : {}),
      next: `Committed to ${branch}. Its draft pull request rebuilds the previews and the snapshot packages. No pull request to main was opened.`,
    };
  }
  for (const f of input.files) {
    const abs = join(ctx.root!, f.path);
    if (f.content === null) await rm(abs, { force: true });
    else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, f.content);
    }
  }
  const paths = input.files.map((f) => f.path);
  return {
    status: 'written' as const,
    branch,
    next: `Written to your working tree on ${branch}. Commit and push them there: \`git add ${paths.join(' ')} && git commit -m "${input.message.split('\n')[0]!.replace(/"/g, "'")}" && git push\`. Do not open a pull request to main: the exploration's draft pull request is the place.`,
  };
}

export { explorationRules };
