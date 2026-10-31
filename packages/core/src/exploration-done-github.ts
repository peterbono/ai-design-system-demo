// "Done exploring" on GitHub (decision 2026-10-30), shared by Studio (with the viewer's token), the MCP server and the
// CLI: the end of an exploration that keeps it alive. The pieces the designer ticks go to the DS lead as requests
// (prod-branch-github.ts proposePiecesOnGitHub), the exploration note leaves the branch, the `exploration` label gives
// way to `ready-for-devs`, and the body says how developers take it. Nothing is closed, merged or marked ready: the
// draft pull request, and so its preview link, stay open for the designer, the DS lead, stakeholders and developers.
// The pure rules are in explorations.ts (doneExploringPlan, explorationStatus).

import {
  EXPLORATION_PREFIX,
  doneExploringPlan,
  explorationStartingPoint,
  explorationStatus,
  isGuardedExploration,
  parseExplorationBody,
  withDoneExploring,
  type DoneExploringPlan,
  type ExplorationChecks,
  type ExplorationStatus,
} from './explorations';
import { findExplorationOnGitHub } from './explorations-github';
import { GitHubError, type GitHubClient } from './github-client';
import { proposePiecesOnGitHub, type ProposedPieces } from './prod-branch-github';
import type { ProductConfig } from './products';
import type { RequestSource } from './requests';

export interface DoneExploringInput {
  /** Piece ids the designer ticked: each becomes a request for the DS lead. Unticked ones are not proposed. */
  pieces?: readonly string[] | undefined;
  /** bridge.config.json products, to name the product the pieces are needed by. */
  products?: readonly ProductConfig[] | undefined;
  /** The exploration's preview, linked from each request so the DS lead sees the piece in context. */
  previewUrl?: string | null | undefined;
  /** Who said it, and the AI agent behind it ("claude"). */
  openedBy?: string | undefined;
  agent?: string | undefined;
  source?: RequestSource | undefined;
  date?: Date | undefined;
  dryRun?: boolean | undefined;
  /**
   * The design system repository, when the exploration lives in a product's own repository (`gh` reads that one): the
   * requests for the ticked pieces are filed there, where the DS lead works, linking back to the product pull request.
   */
  library?: GitHubClient | undefined;
}

export interface DoneExploring {
  number: number;
  url: string;
  branch: string;
  /** Where it stands after: ready (waiting for code), or what it already was when said again. */
  status: ExplorationStatus;
  /** False when it was already done exploring: only the newly ticked pieces were sent. */
  handedOff: boolean;
  plan: DoneExploringPlan | null;
  pieces: ProposedPieces;
  /** The two commands a developer runs to take it. */
  take: [string, string];
  /** The branch checks at the head developers start from, when GitHub said; null when it could not be read. */
  checks: ExplorationChecks | null;
  /** What developers read next to the commands, true to those checks. */
  note: string;
  /** Steps that did not go through, with what to do on GitHub instead. */
  warnings: string[];
}

/**
 * Says "Done exploring" on an exploration: requests for the ticked pieces first, then the note removed, the labels
 * swapped and the body rewritten for developers (with the head they start from, so their pushes read "Being built").
 * Said again on an exploration already handed off, it only sends the newly ticked pieces. Refused on a closed or
 * shipped one. Never closes, merges or marks the draft ready.
 */
export async function doneExploringOnGitHub(gh: GitHubClient, ref: string | number, input: DoneExploringInput = {}): Promise<DoneExploring> {
  const p = await findExplorationOnGitHub(gh, ref);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body, headSha: p.headSha, draft: p.draft });
  if (status === 'closed') throw new GitHubError(422, `Exploration #${p.number} is closed. Reopen it on GitHub first: its preview comes back with it.`);
  if (status === 'shipped') throw new GitHubError(422, `#${p.number} is already shipped.`);
  if (status === 'promoted') throw new GitHubError(422, `#${p.number} was already sent to review.`);
  const fresh = status === 'active';
  const files = fresh ? await gh.listPullRequestFiles(p.number) : [];
  const plan = fresh ? doneExploringPlan({ body: p.body, branch: p.headRef, files: files.map((f) => ({ path: f.filename, status: f.status })), date: input.date, doneBy: input.openedBy }) : null;
  const take = plan?.take ?? (['git fetch origin', `git checkout ${p.headRef}`] as [string, string]);
  // The checks of the head the developers start from, so the note says truthfully whether anything ran or passed.
  const checks: ExplorationChecks | null = p.headSha ? await Promise.resolve(p.headSha).then((sha) => gh.getChecks(sha, { exploration: isGuardedExploration({ state: p.state, draft: p.draft, labels: p.labels, headRef: p.headRef, body: p.body }) })).then((c) => c.state, () => null) : null;
  const out: DoneExploring = { number: p.number, url: p.url, branch: p.headRef, status: fresh ? 'ready' : status, handedOff: fresh, plan, pieces: { proposed: [], already: [], unknown: [], warnings: [] }, take, checks, note: explorationStartingPoint(checks), warnings: [] };
  const products = input.products ?? [];
  const ask = { pieces: input.pieces ?? [], products, previewUrl: input.previewUrl, openedBy: input.openedBy, agent: input.agent, source: input.source, library: input.library };
  if (input.dryRun) {
    out.pieces = await proposePiecesOnGitHub(gh, p.number, { ...ask, dryRun: true }).catch((e: Error) => ({ proposed: [], already: [], unknown: [], warnings: [e.message] }));
    return out;
  }
  if (!gh.canWrite) throw new GitHubError(401, 'Saying "Done exploring" needs a GitHub token (contents, pull requests and issues: write).');
  // The library side first: a refused request leaves the exploration running, so nothing is half handed off.
  out.pieces = await proposePiecesOnGitHub(gh, p.number, ask);
  out.warnings.push(...out.pieces.warnings);
  if (!plan) return out;
  const x = gh.withBranchPrefix(EXPLORATION_PREFIX);
  let doneSha = p.headSha;
  if (plan.removeFiles.length) {
    const c = await x.commitToBranch({ branch: p.headRef, message: 'chore(explore): done exploring, remove the exploration note', files: plan.removeFiles.map((path) => ({ path, content: null })) }).catch((e: Error) => {
      if (e instanceof GitHubError && e.auth === 'rejected') throw e;
      out.warnings.push(`The exploration note stays on the branch (${e.message}). Delete ${plan.removeFiles.join(', ')} before merging.`);
      return null;
    });
    if (c) doneSha = c.sha;
  }
  await x.addLabels(p.number, plan.addLabels);
  await x.removeLabel(p.number, plan.removeLabels[0]!).catch((e: Error) => {
    if (!(e instanceof GitHubError && e.status === 404)) out.warnings.push(`The exploration label is still on (${e.message}). Remove it on GitHub so developers can ship it later.`);
  });
  // The pieces wrote their links into the body: read it again before the developer section goes in.
  const latest = await gh.getPullRequest(p.number).catch(() => p);
  const doneAt = parseExplorationBody(plan.body)?.doneAt ?? (input.date ?? new Date()).toISOString();
  await x.updatePullRequest(p.number, { body: withDoneExploring(latest.body, { branch: p.headRef, doneAt, doneBy: input.openedBy, doneSha, checks }) });
  return out;
}
