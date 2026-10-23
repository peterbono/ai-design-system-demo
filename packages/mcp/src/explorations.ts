// Explorations for Claude and the CLI: start one (`explore/<slug>` + a draft pull request labeled exploration), list
// them with their previews, snapshot install command and linked requests, promote one to review, close one. And the
// "target branch" of the write tools: token edits, docs drafts and request briefs aimed at an exploration branch
// instead of a new pull request to main. The rules and the GitHub calls are @bridge-ds/core's (explorations.ts,
// explorations-github.ts); this file shapes them for the MCP tools and the CLI.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  baseBranchOf,
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
  explorationSlug,
  explorationTestBuildOnGitHub,
  findExplorationOnGitHub,
  isExplorationBranch,
  listExplorationsOnGitHub,
  parseRequestIssue,
  promoteExplorationOnGitHub,
  protectedBranchesOf,
  startExplorationOnGitHub,
  type BridgeConfig,
  type Exploration,
  type ExplorationSource,
  type ExplorationTryIt,
  type ExplorationUseCase,
  type GitHubClient,
} from '@bridge-ds/core';
import { branchExists, commitToNewLocalBranch, currentBranch, git } from '@bridge-ds/core/node';
import { BridgeContext } from './context.js';
import { productMarks, resolveProduct } from './branches.js';
import { addToken, readOnlyPreview, say } from './say.js';

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
  purpose: string;
  useCase?: string | undefined;
  experimental?: string[] | undefined;
  author?: string | undefined;
  /** Where it is started from (the MCP tool says mcp, the CLI says cli), and the AI agent behind it when known. */
  source?: ExplorationSource | undefined;
  agent?: string | undefined;
  /** The product it is tried in (key or name, bridge.config.json "products"). Default: the product of the current folder or repo. */
  product?: string | undefined;
  dryRun?: boolean | undefined;
}

/**
 * bridge_start_exploration / `bridge explore start`. With a GitHub token: the branch on GitHub from the default branch
 * and a draft pull request labeled exploration. Without one, in a local git repo: a local branch with the note,
 * nothing pushed, and the commands to push it and open the draft pull request.
 */
export async function startExploration(ctx: BridgeContext, a: StartExplorationInput) {
  const problems = explorationProblems({ name: a.name, purpose: a.purpose });
  if (problems.length) throw new Error(problems.join(' '));
  if (a.useCase && !USE_CASES.has(a.useCase)) throw new Error(`Unknown use case "${a.useCase}". Use one of: ${[...USE_CASES].join(', ')}.`);
  const { config } = await ctx.config();
  const s = settingsOf(config);
  const slug = explorationSlug(a.name);
  const branch = `${EXPLORATION_PREFIX}${slug}`;
  const e: Exploration = {
    name: a.name.trim(),
    purpose: a.purpose.trim(),
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
  const preview = {
    branch,
    product: product.name,
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
  )} It is never merged as is: promote it (\`bridge explore promote ${slug}\`) or close it.`;
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
      message: `chore(explore): start ${e.name}\n\n${e.purpose}\n\nExploration: never merged as is. Promote it to review or close it.`,
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
export async function listExplorations(ctx: BridgeContext, a: { state?: 'open' | 'closed' | 'all' } = {}) {
  const { config } = await ctx.config();
  const gh = await requireGitHub(ctx);
  const [list, linked] = await Promise.all([listExplorationsOnGitHub(gh, settingsOf(config), { state: a.state ?? 'open' }), requestsByExploration(gh)]);
  // Running ones: the real preview URLs (Vercel shortens long branch aliases) and the published install command.
  const explorations = await Promise.all(
    list.map(async (x) => {
      const requests = linked.get(x.branch) ?? [];
      if (x.status !== 'active') return { ...x, install: null, requests };
      const t = await explorationTestBuildOnGitHub(gh, { number: x.number, branch: x.branch }, config).catch(() => null);
      if (!t) return { ...x, install: installOf({ state: 'building' }), requests };
      return { ...x, previews: t.previews.map((p) => ({ app: p.app, label: p.label, url: p.url, state: p.state })), install: installOf(t.tryIt), requests };
    }),
  );
  let localBranches: string[] = [];
  if (ctx.mode === 'local' && ctx.isGit) {
    const refs = (await git(ctx.root!, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${EXPLORATION_PREFIX}`]).catch(() => '')).split('\n').filter(Boolean);
    localBranches = refs.filter((b) => !explorations.some((x) => x.branch === b));
  }
  const running = explorations.filter((x) => x.status === 'active').length;
  return {
    repo: gh.fullName,
    label: EXPLORATION_LABEL,
    running,
    total: explorations.length,
    summary: running ? `${running} ${running === 1 ? 'exploration' : 'explorations'} running.` : 'No exploration running.',
    explorations,
    ...(localBranches.length ? { localBranches, localHint: 'Local exploration branches without a pull request: push them and open a draft pull request labeled exploration to share them.' } : {}),
  };
}

/** `bridge explore promote`: ready for review, tier labels, exploration label and note removed, linked requests closed on merge. */
export async function promoteExploration(ctx: BridgeContext, a: { ref: string; dryRun?: boolean | undefined }) {
  const { config } = await ctx.config();
  const gh = await requireGitHub(ctx);
  if (!a.dryRun && !ctx.canWriteRemote) throw new Error(`Promoting an exploration needs a GitHub token (contents and pull requests: write): ${addToken(ctx)}. Or use "Ready for review" on GitHub and remove the exploration label.`);
  const ref = /^#?\d+$/.test(a.ref.trim()) ? Number(a.ref.trim().replace(/^#/, '')) : toExplorationBranch(a.ref);
  const p = await findExplorationOnGitHub(gh, ref);
  const requests = ((await requestsByExploration(gh)).get(p.headRef) ?? []).filter((r) => r.state === 'open').map((r) => r.number);
  const r = await promoteExplorationOnGitHub(gh, p.number, { config, requests, dryRun: a.dryRun });
  return { status: a.dryRun ? ('dry-run' as const) : ('promoted' as const), ...r, closes: requests };
}

export async function closeExploration(ctx: BridgeContext, a: { ref: string }) {
  const gh = await requireGitHub(ctx);
  if (!ctx.canWriteRemote) throw new Error(`Closing an exploration needs a GitHub token (pull requests: write): ${addToken(ctx)}. Or close the pull request on GitHub.`);
  const ref = /^#?\d+$/.test(a.ref.trim()) ? Number(a.ref.trim().replace(/^#/, '')) : toExplorationBranch(a.ref);
  return { status: 'closed' as const, ...(await closeExplorationOnGitHub(gh, ref)) };
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
