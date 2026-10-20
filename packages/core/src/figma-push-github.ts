// Components pushed from Figma, on GitHub: open the library branch a component change goes to (a token change through
// the shared token proposal write, or a Claude draft branch carrying the spec), list them with where each stands, read
// one back as Claude's brief, and say when Claude has drafted the code. Shared by the DS Bridge Figma plugin, the MCP
// server and the CLI. The routing rules are in figma-push.ts.

import { GitHubError, type GitHubClient } from './github-client';
import { REQUEST_LABEL } from './requests';
import type { TokenEdit } from './token-edits';
import {
  DRAFTED_BY_CLAUDE_LABEL,
  FIGMA_SPEC_DIR,
  FROM_FIGMA_LABEL,
  WAITING_FOR_CLAUDE_LABEL,
  figmaBranchTitle,
  figmaDraftBody,
  figmaDraftBrief,
  figmaOriginSection,
  figmaPushStatus,
  figmaSpecPath,
  figmaSpecSlug,
  formatFigmaSpec,
  parseFigmaOrigin,
  parseFigmaSpec,
  planComponentPush,
  withFigmaOrigin,
  type ComponentPushDiff,
  type ComponentPushPlan,
  type FigmaOrigin,
  type FigmaPushStatus,
  type PushTokenContext,
} from './figma-push';

/** Opens the token change of an exact push: the caller plans it on the library's token files (planTokenProposal). */
export type FigmaTokenWriter = (input: { edits: TokenEdit[]; title: string; summary: string; bodyExtra: string[] }) => Promise<{ number: number; url: string; branch: string }>;

export interface OpenComponentPushInput {
  diff: ComponentPushDiff;
  /** Token facts to route it (planComponentPush), or the route already planned with every component of the file. */
  tokens?: PushTokenContext | undefined;
  plan?: ComponentPushPlan | undefined;
  /** Branch library work starts from (the default branch). */
  base: string;
  /** governance.branchPrefix ("bridge/"). */
  branchPrefix: string;
  /** Labels the repo adds to every Bridge branch (governance.labels), before the Figma ones. */
  labels?: string[] | undefined;
  /** The token change of an exact push (planTokenProposal + writeTokenProposalOnGitHub where the token files are read). */
  writeTokens?: FigmaTokenWriter | undefined;
  /** "the DS Bridge Figma plugin", "Bridge MCP". */
  tool?: string | undefined;
  dryRun?: boolean | undefined;
}

export interface OpenedComponentPush {
  status: 'opened' | 'dry-run' | 'not-sent';
  plan: ComponentPushPlan;
  /** The library branch: a token change or a Claude draft branch (a draft pull request). */
  link: { route: 'token-change' | 'claude-draft'; number: number; url: string; branch: string } | null;
}

/**
 * Opens the library branch of a component change from Figma, linked to its origin (the Figma component): an exact token
 * swap opens a token change (the shared proposal write: contrast gate, tier, changeset); anything that needs code opens
 * a draft pull request carrying the spec (`.bridge/figma/<slug>.json`), labelled waiting for Claude. A manual change
 * opens nothing: its issues say what to do in Figma.
 */
export async function openComponentPushOnGitHub(gh: GitHubClient, input: OpenComponentPushInput): Promise<OpenedComponentPush> {
  const d = input.diff;
  if (!input.plan && !input.tokens) throw new Error('Route the change first: pass the token facts or the plan.');
  const plan = input.plan ?? planComponentPush(d, input.tokens!);
  if (plan.route === 'manual') return { status: 'not-sent', plan, link: null };
  if (input.dryRun) return { status: 'dry-run', plan, link: null };
  if (!gh.canWrite) throw new GitHubError(401, 'Sending a component change needs a GitHub token (contents and pull requests: write).');
  const origin: FigmaOrigin = {
    component: d.component,
    figmaName: d.figmaName,
    route: plan.route,
    kind: d.kind,
    ...(d.figma?.nodeId ? { nodeId: d.figma.nodeId } : {}),
    ...(d.figma?.fileKey ? { fileKey: d.figma.fileKey } : {}),
    ...(d.figma?.url ? { url: d.figma.url } : {}),
    ...(d.requestedBy ? { requestedBy: d.requestedBy } : {}),
  };
  if (plan.route === 'token-change') {
    if (!input.writeTokens) throw new GitHubError(422, 'This change is a token change: send it where the token files are read (the DS Bridge plugin, bridge_push_figma_component or `bridge figma push`).');
    const r = await input.writeTokens({ edits: plan.edits, title: figmaBranchTitle(d), summary: d.summary.trim() || d.title, bodyExtra: [figmaOriginSection(origin)] });
    await gh.addLabels(r.number, [FROM_FIGMA_LABEL]);
    return { status: 'opened', plan, link: { route: 'token-change', number: r.number, url: r.url, branch: r.branch } };
  }
  const spec = figmaSpecPath(d);
  const o: FigmaOrigin = { ...origin, spec, status: 'spec' };
  let branch = `${input.branchPrefix}figma-${figmaSpecSlug(d)}`;
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = `${input.branchPrefix}figma-${figmaSpecSlug(d)}-${i}`;
  await gh.commitToNewBranch({
    base: input.base,
    branch,
    message: `chore(figma): spec for ${figmaBranchTitle(d)}\n\nSent from Figma with ${input.tool ?? 'the DS Bridge Figma plugin'}. Claude AI drafts the code on this branch; a person reviews it.`,
    files: [{ path: spec, content: formatFigmaSpec(d, plan) }],
  });
  const pr = await gh.createPullRequest({ base: input.base, head: branch, title: figmaBranchTitle(d), body: figmaDraftBody(d, plan, o), draft: true });
  await gh.addLabels(pr.number, [...new Set([...(input.labels ?? []), FROM_FIGMA_LABEL, REQUEST_LABEL, WAITING_FOR_CLAUDE_LABEL])]);
  return { status: 'opened', plan, link: { route: 'claude-draft', number: pr.number, url: pr.url, branch } };
}

export interface FigmaChangeRow {
  number: number;
  title: string;
  url: string;
  branch: string;
  origin: FigmaOrigin;
  status: FigmaPushStatus;
}

/** Library branches opened from Figma components (label from-figma), newest first, with where each stands. */
export async function listFigmaChangesOnGitHub(gh: GitHubClient, opts: { state?: 'open' | 'closed' | 'all' } = {}): Promise<FigmaChangeRow[]> {
  const pulls = await gh.listPullRequests(opts.state ?? 'open');
  const out: FigmaChangeRow[] = [];
  for (const p of pulls) {
    if (!p.labels.includes(FROM_FIGMA_LABEL)) continue;
    const origin = parseFigmaOrigin(p.body);
    if (!origin) continue;
    out.push({ number: p.number, title: p.title, url: p.url, branch: p.headRef, origin, status: figmaPushStatus({ state: p.state, draft: p.draft, labels: p.labels, route: origin.route }) });
  }
  return out;
}

/** One library branch from Figma, its spec and Claude's brief to draft the code. */
export async function figmaChangeOnGitHub(gh: GitHubClient, n: number, opts: { componentsDir?: string | undefined } = {}) {
  const pull = await gh.getPullRequest(n);
  const origin = parseFigmaOrigin(pull.body);
  if (!origin) throw new GitHubError(404, `#${n} was not sent from Figma (no "From Figma" block in its description).`);
  const status = figmaPushStatus({ state: pull.state, draft: pull.draft, labels: pull.labels, route: origin.route });
  if (origin.route === 'token-change') return { pull, origin, status, spec: undefined, brief: undefined };
  const text = origin.spec ? await gh.getFileText(origin.spec, pull.headSha).catch(() => undefined) : undefined;
  const spec = parseFigmaSpec(text);
  if (!spec) throw new GitHubError(404, `The spec ${origin.spec ?? FIGMA_SPEC_DIR} is missing from ${pull.headRef}. Send the component from Figma again.`);
  const brief = figmaDraftBrief(spec, { pr: n, branch: pull.headRef, specPath: origin.spec!, componentsDir: opts.componentsDir });
  return { pull, origin, status, spec, brief };
}

/**
 * Claude wrote the code: the branch is labelled drafted by Claude AI (no longer waiting) and its description says so.
 * Refused while the branch only carries the spec, so the label never claims code that is not there.
 */
export async function markFigmaChangeDraftedOnGitHub(gh: GitHubClient, n: number): Promise<{ status: FigmaPushStatus; files: string[] }> {
  if (!gh.canWrite) throw new GitHubError(401, 'Marking a branch drafted needs a GitHub token (pull requests: write).');
  const pull = await gh.getPullRequest(n);
  const origin = parseFigmaOrigin(pull.body);
  if (!origin || origin.route !== 'claude-draft') throw new GitHubError(422, `#${n} is not a Claude draft branch from Figma.`);
  if (pull.state !== 'open') throw new GitHubError(422, `#${n} is ${pull.state}: only an open branch is marked drafted.`);
  const files = (await gh.listPullRequestFiles(n)).map((f) => f.filename).filter((f) => !f.startsWith(`${FIGMA_SPEC_DIR}/`));
  if (!files.length) throw new GitHubError(422, `${pull.headRef} only carries the spec: write the component code there first, push it, then mark it drafted.`);
  await gh.updatePullRequest(n, { body: withFigmaOrigin(pull.body, { ...origin, status: 'drafted' }) });
  await gh.removeLabel(n, WAITING_FOR_CLAUDE_LABEL).catch(() => undefined);
  await gh.addLabels(n, [DRAFTED_BY_CLAUDE_LABEL]);
  const labels = [...pull.labels.filter((l) => l !== WAITING_FOR_CLAUDE_LABEL), DRAFTED_BY_CLAUDE_LABEL];
  return { status: figmaPushStatus({ state: pull.state, labels, route: origin.route }), files };
}

/** Where each pushed Figma component's library branch stands (by pull request number), for the plugin's Pull. */
export async function figmaPushStatusesOnGitHub(gh: GitHubClient, numbers: number[]): Promise<Map<number, FigmaPushStatus>> {
  const out = new Map<number, FigmaPushStatus>();
  await Promise.all(
    [...new Set(numbers)].map(async (n) => {
      try {
        const p = await gh.getPullRequest(n);
        out.set(n, figmaPushStatus({ state: p.state, draft: p.draft, labels: p.labels, route: parseFigmaOrigin(p.body)?.route }));
      } catch {
        // Unreadable: the component keeps its Figma version until the next pull reads it.
      }
    }),
  );
  return out;
}
