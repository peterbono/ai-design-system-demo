// "Done exploring" on GitHub (decision 2026-10-30), shared by Studio (with the viewer's token), the MCP server and the
// CLI: the end of an exploration that keeps it alive. The pieces the designer ticks go to the DS lead as requests
// (prod-branch-github.ts proposePiecesOnGitHub), the exploration note leaves the branch, the `exploration` label gives
// way to `ready-for-devs`, and the body says how developers take it. Nothing is closed, merged or marked ready: the
// draft pull request, and so its preview link, stay open for the designer, the DS lead, stakeholders and developers.
// The pure rules are in explorations.ts (doneExploringPlan, explorationStatus).

import {
  EXPLORATION_ARCHIVED_LABEL,
  EXPLORATION_LABEL,
  EXPLORATION_PREFIX,
  EXPLORATION_READY_LABEL,
  DESIGN_COPY_STARTING_POINT,
  designCopyTakeCommands,
  doneExploringPlan,
  explorationNotePath,
  explorationStartingPoint,
  explorationStatus,
  isGuardedExploration,
  isWaitingForLead,
  openDecisionOf,
  parseExplorationBody,
  startPageOf,
  withDoneExploring,
  withDecision,
  withKeeper,
  withLeadAsked,
  withLeadAskedTo,
  withoutDoneExploring,
  withoutLeadAsked,
  type Decision,
  type DoneExploringPlan,
  type ExplorationChecks,
  type ExplorationStatus,
} from './explorations';
import { findExplorationOnGitHub } from './explorations-github';
import { GitHubError, type GitHubClient } from './github-client';
import { proposePiecesOnGitHub, type ProposedPieces } from './prod-branch-github';
import { branchPreviewUrl } from './previews';
import { liveAddressOf, productCodeRepoOf, productOfDesignCopy, type ProductConfig } from './products';
import { addressTaskBody, designTaskBody, designTaskTitle, githubLoginOf, FROM_DESIGN_LABEL, FROM_DESIGN_LABEL_COLOR, FROM_DESIGN_LABEL_DESCRIPTION } from './design-copy-github';
import type { RequestSource } from './requests';
import { notesSpec, parseExplorationNotes } from './exploration-notes';
import { NOTES_BACK_COMMIT_MESSAGE } from './exploration-resume';

const DONE_COMMIT_MESSAGE = 'chore(explore): done exploring, remove the exploration note';

export interface DoneExploringInput {
  /** Piece ids the designer ticked: each becomes a request for the DS lead. Unticked ones are not proposed. */
  pieces?: readonly string[] | undefined;
  /** bridge.config.json products, to name the product the pieces are needed by. */
  products?: readonly ProductConfig[] | undefined;
  /** The exploration's preview, linked from each request so the DS lead sees the piece in context. */
  previewUrl?: string | null | undefined;
  /** Who said it, and the AI agent behind it ("claude"). */
  openedBy?: string | undefined;
  /** Who said it when they have no GitHub account (an email member): their display name. Never an email. */
  openedByName?: string | undefined;
  agent?: string | undefined;
  source?: RequestSource | undefined;
  date?: Date | undefined;
  dryRun?: boolean | undefined;
  /**
   * The design system repository, when the exploration lives in a product's own repository (`gh` reads that one): the
   * requests for the ticked pieces are filed there, where the DS lead works, linking back to the product pull request.
   */
  library?: GitHubClient | undefined;
  /** The design lead who validated it, when one did: the hand-off names them. */
  leadOkBy?: string | undefined;
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
  /** From a design copy: the developers' task opened in the product's own repository. */
  task?: { number: number; url: string; repo: string } | undefined;
  /** The design spec handed to developers from the exploration's notes (decisions, edge cases, open questions), when any. */
  spec?: string | undefined;
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
  // In the design team's copy of a product: the developers get a task in their own repository, never a branch.
  const copyOf = productOfDesignCopy(input.products ?? [], gh.fullName);
  // A product added from its address (no developers' code Bridge can reach): what the team keeps becomes a task in the
  // design team's own code, from its copy or from that code itself. Never a branch to take.
  const addressOf = addressProductOf(input.products ?? [], copyOf, gh.fullName);
  const codeRepo = copyOf ? productCodeRepoOf(copyOf, null) : addressOf ? gh.fullName : null;
  const files = fresh ? await gh.listPullRequestFiles(p.number) : [];
  const plan = fresh
    ? doneExploringPlan({ body: p.body, branch: p.headRef, files: files.map((f) => ({ path: f.filename, status: f.status })), date: input.date, doneBy: doneByOfInput(input), ...(codeRepo ? { copy: gh.fullName } : {}) })
    : null;
  const take = plan?.take ?? (codeRepo ? designCopyTakeCommands(gh.fullName, p.headRef) : (['git fetch origin', `git checkout ${p.headRef}`] as [string, string]));
  // The checks of the head the developers start from, so the note says truthfully whether anything ran or passed.
  const checks: ExplorationChecks | null = p.headSha ? await Promise.resolve(p.headSha).then((sha) => gh.getChecks(sha, { exploration: isGuardedExploration({ state: p.state, draft: p.draft, labels: p.labels, headRef: p.headRef, body: p.body }) })).then((c) => c.state, () => null) : null;
  // "Where it stands": the notes leave the branch with the note file, so their decisions and edge cases go to the
  // developers as the spec first. Read before anything is removed; a note that cannot be read hands nothing on.
  const spec = plan?.removeFiles.length ? await notesSpecOnBranch(gh, plan.removeFiles, p.headRef) : null;
  const out: DoneExploring = { number: p.number, url: p.url, branch: p.headRef, status: fresh ? 'ready' : status, handedOff: fresh, plan, pieces: { proposed: [], already: [], unknown: [], warnings: [] }, take, checks, note: codeRepo ? DESIGN_COPY_STARTING_POINT : explorationStartingPoint(checks), warnings: [], ...(spec ? { spec } : {}) };
  const products = input.products ?? [];
  const ask = { pieces: input.pieces ?? [], products, previewUrl: input.previewUrl, openedBy: doneByOfInput(input), agent: input.agent, source: input.source, library: input.library };
  if (input.dryRun) {
    out.pieces = await proposePiecesOnGitHub(gh, p.number, { ...ask, dryRun: true }).catch((e: Error) => ({ proposed: [], already: [], unknown: [], warnings: [e.message] }));
    return out;
  }
  if (!gh.canWrite) throw new GitHubError(401, 'Saying "Done exploring" needs a GitHub token (contents, pull requests and issues: write).');
  // The library side first: a refused request leaves the exploration running, so nothing is half handed off.
  out.pieces = await proposePiecesOnGitHub(gh, p.number, ask);
  out.warnings.push(...out.pieces.warnings);
  if (!plan) return out;
  // From a design copy: the task in the developers' repository first, so a refusal leaves the exploration running.
  let task: string | undefined;
  if (codeRepo) {
    const dev = gh.withBranchPrefix(undefined).forRepo(codeRepo);
    await dev.ensureLabel(FROM_DESIGN_LABEL, FROM_DESIGN_LABEL_COLOR, FROM_DESIGN_LABEL_DESCRIPTION).catch(() => undefined);
    const e = parseExplorationBody(p.body);
    const name = e?.name ?? p.title.replace(/^Exploration:\s*/i, '');
    const taskBody = addressOf
      ? addressTaskBody({
          name,
          product: addressOf.name,
          address: liveAddressOf(addressOf)!,
          startPage: startPageOf(e),
          purpose: e?.purpose,
          previewUrl: input.previewUrl ?? branchPreviewUrl(copyOf ? copyOf.design?.preview : addressOf.preview, p.headRef),
          pieces: out.pieces.proposed.map((x) => ({ title: x.title, url: x.url })),
          pr: { number: p.number, url: p.url },
          doneBy: input.openedBy,
          doneByName: input.openedByName,
          spec,
        })
      : designTaskBody({
        name,
        purpose: e?.purpose,
        // The copy's own preview of this branch when Studio did not pass one: a real link, not a pointer to a comment.
        previewUrl: input.previewUrl ?? branchPreviewUrl(copyOf?.design?.preview, p.headRef),
        changes: files.filter((f) => !plan.removeFiles.includes(f.filename)).map((f) => f.filename),
        pieces: out.pieces.proposed.map((x) => ({ title: x.title, url: x.url })),
        copy: gh.fullName,
        branch: p.headRef,
        pr: { number: p.number, url: p.url },
        doneBy: input.openedBy,
        doneByName: input.openedByName,
        spec,
      });
    // Said again after Back to exploring: the same task comes back, never a second one next to it.
    const earlier = designTaskRef(e?.task, codeRepo);
    const issue = earlier
      ? await dev.updateIssue(earlier.number, { state: 'open', state_reason: 'reopened', body: taskBody })
      : await dev.createIssue({ title: designTaskTitle(name), body: taskBody, labels: [FROM_DESIGN_LABEL] });
    task = issue.url;
    out.task = { number: issue.number, url: issue.url, repo: codeRepo };
  }
  const x = gh.withBranchPrefix(EXPLORATION_PREFIX);
  let doneSha = p.headSha;
  // A design copy never merges: its notes stay, so the page keeps them and Back to exploring finds them. Only a branch
  // that can reach main loses its note.
  if (codeRepo) out.plan = { ...plan, removeFiles: [] };
  else if (plan.removeFiles.length) {
    const c = await x.commitToBranch({ branch: p.headRef, message: DONE_COMMIT_MESSAGE, files: plan.removeFiles.map((path) => ({ path, content: null })) }).catch((e: Error) => {
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
  await x.updatePullRequest(p.number, { body: withDoneExploring(latest.body, { branch: p.headRef, doneAt, doneBy: doneByOfInput(input), doneSha, checks, ...(githubLoginOf(input.leadOkBy) ? { leadOkBy: githubLoginOf(input.leadOkBy)! } : {}), ...(codeRepo ? { copy: gh.fullName } : {}), ...(task ? { task } : {}), ...(spec && !codeRepo ? { spec } : {}) }) });
  return out;
}

export interface BackToExploring {
  number: number;
  url: string;
  branch: string;
  /** Labels that could not be changed (a token without the right to edit labels): the body still says it runs. */
  warnings: string[];
}

/**
 * "Back to exploring": undoes Done exploring while no developer has pushed since (status ready, not building). The
 * body loses the developer section and the done marker first, which is enough on its own (explorationStatus reads it);
 * then the `exploration` label comes back and `ready-for-devs` goes. A refused label write is a warning, never a
 * failure. Pieces already sent to the library stay sent.
 */
export async function reopenExplorationOnGitHub(gh: GitHubClient, ref: string | number, opts: { date?: Date | undefined; by?: string | null | undefined; reason?: string | undefined; decision?: Omit<Decision, 'round' | 'sha'> | undefined } = {}): Promise<BackToExploring> {
  if (!gh.canWrite) throw new GitHubError(401, 'Going back to exploring needs a GitHub token (pull requests: write).');
  const p = await findExplorationOnGitHub(gh, ref);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body, headSha: p.headSha, draft: p.draft });
  if (status === 'active') throw new GitHubError(422, `#${p.number} is still being explored.`);
  if (status === 'building') throw new GitHubError(422, `Developers already work on #${p.number}: it stays with them.`);
  if (status !== 'ready') throw new GitHubError(422, `#${p.number} is ${status === 'shipped' ? 'shipped' : status === 'closed' ? 'closed' : 'in review'}: only an exploration waiting for code goes back to exploring.`);
  const out: BackToExploring = { number: p.number, url: p.url, branch: p.headRef, warnings: [] };
  // From a design copy: the developers' task leaves their list first (closed as not planned, with a word), so nobody
  // picks up what the design team took back. Done exploring said again reopens that same task.
  const task = designTaskRef(parseExplorationBody(p.body)?.task, null);
  if (task) {
    const dev = gh.withBranchPrefix(undefined).forRepo(task.repo);
    try {
      await dev.createIssueComment(task.number, opts.reason?.trim() ? `${DESIGN_TASK_BACK_COMMENT}\n\n${opts.reason.trim()}` : DESIGN_TASK_BACK_COMMENT);
      await dev.updateIssue(task.number, { state: 'closed', state_reason: 'not_planned' });
    } catch (e) {
      out.warnings.push(`The developers' task stays open (${(e as Error).message}). Close ${task.url} on GitHub.`);
    }
  }
  const running = withoutDoneExploring(p.body, (opts.date ?? new Date()).toISOString(), githubLoginOf(opts.by));
  await gh.updatePullRequest(p.number, { body: opts.decision ? withDecision(running, { ...opts.decision, sha: p.headSha }) : running });
  const x = gh.withBranchPrefix(EXPLORATION_PREFIX);
  // The body already says it runs: the notes and the labels follow side by side, the label added before the other leaves.
  const notes = restoreNotes(gh, x, p).catch((e: Error) => out.warnings.push(`The exploration notes did not come back (${e.message}).`));
  const labels = (async () => {
    if (!(await x.addLabels(p.number, [EXPLORATION_LABEL]))) out.warnings.push(`The ${EXPLORATION_LABEL} label could not be added back.`);
    await x.removeLabel(p.number, EXPLORATION_READY_LABEL).catch((e: Error) => {
      if (!(e instanceof GitHubError && e.status === 404)) out.warnings.push(`The ${EXPLORATION_READY_LABEL} label is still on (${e.message}).`);
    });
  })();
  await Promise.all([notes, labels]);
  return out;
}

export interface LeadAsked {
  number: number;
  url: string;
  branch: string;
}

/**
 * "Done exploring" where a design lead validates first: only the body changes. The exploration keeps running, so its
 * label, note and preview stay and no developer sees anything until the lead says it looks right.
 */
export async function askLeadOnGitHub(gh: GitHubClient, ref: string | number, input: { pieces?: readonly string[] | undefined; openedBy?: string | undefined; openedByName?: string | undefined; date?: Date | undefined; leads?: readonly string[] | undefined } = {}): Promise<LeadAsked> {
  if (!gh.canWrite) throw new GitHubError(401, 'Saying "Done exploring" needs a GitHub token (pull requests: write).');
  const p = await findExplorationOnGitHub(gh, ref);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body, headSha: p.headSha, draft: p.draft });
  if (status !== 'active') throw new GitHubError(422, `#${p.number} is no longer being explored.`);
  const at = (input.date ?? new Date()).toISOString();
  await gh.updatePullRequest(p.number, { body: withLeadAskedTo(withLeadAsked(p.body, { at, by: doneByOfInput(input), byName: input.openedByName, pieces: input.pieces, sha: p.headSha }), (input.leads ?? []).map(githubLoginOf).filter((l): l is string => Boolean(l))) });
  // GitHub tells the leads; a refused comment changes nothing, the exploration already waits for them in Studio.
  const leads = (input.leads ?? []).map(githubLoginOf).filter((l): l is string => Boolean(l));
  if (leads.length) await gh.createIssueComment(p.number, `${leads.map((l) => `@${l}`).join(' ')} ready for your validation in Bridge. Nothing goes to the developers until you answer.`).catch(() => undefined);
  return { number: p.number, url: p.url, branch: p.headRef };
}

/**
 * The design lead's "Looks right": what Done exploring always did, under the name of the person who asked, with the
 * pieces they ticked. A refused step leaves the ask in place, so the lead can say it again.
 */
export async function leadApproveOnGitHub(gh: GitHubClient, ref: string | number, input: Omit<DoneExploringInput, 'pieces' | 'openedBy' | 'openedByName'> & { lead?: string | undefined; leadName?: string | undefined; note?: string | undefined }): Promise<DoneExploring> {
  const p = await findExplorationOnGitHub(gh, ref);
  const e = parseExplorationBody(p.body);
  if (!isWaitingForLead(p.body)) throw new GitHubError(422, ALREADY_ANSWERED);
  const { lead, leadName, note, ...rest } = input;
  const done = await doneExploringOnGitHub(gh, p.number, { ...rest, pieces: e?.leadPieces ?? [], ...(e?.leadAskedBy ? { openedBy: e.leadAskedBy } : {}), ...(e?.leadAskedByName ? { openedByName: e.leadAskedByName } : {}), ...(lead ? { leadOkBy: lead } : {}) });
  if (input.dryRun) return done;
  // The yes goes in the history, and its words to the developers: they build from them.
  const now = await findExplorationOnGitHub(gh, p.number);
  await gh.updatePullRequest(p.number, { body: withDecision(now.body, { kind: 'looks-right', ...sayer({ by: lead, byName: leadName, date: input.date }), ...(note?.trim() ? { text: note.trim() } : {}), sha: now.headSha }) });
  if (note?.trim()) await tellDevelopersOnGitHub(gh, p.number, { text: note, byName: leadName ?? githubLoginOf(lead) ?? undefined }).catch(() => undefined);
  return done;
}

/** A lead answered first: the second one reads this and the page shows the first answer. */
export const ALREADY_ANSWERED = 'Someone already answered this one.';

/** Who says something, for a decision: a GitHub login, or the display name of a member without one. */
type Sayer = { by?: string | null | undefined; byName?: string | null | undefined; date?: Date | undefined };
const sayer = (s: Sayer) => ({ at: (s.date ?? new Date()).toISOString(), ...(githubLoginOf(s.by) ? { by: githubLoginOf(s.by)! } : {}), ...(s.byName ? { byName: s.byName } : {}) });

/** The design lead's "Needs changes": back to the designer with the lead's words, nothing reached developers. */
export async function leadChangesOnGitHub(gh: GitHubClient, ref: string | number, input: { note: string; lead?: string | undefined; leadName?: string | undefined; date?: Date | undefined }): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  if (!isWaitingForLead(p.body)) throw new GitHubError(422, ALREADY_ANSWERED);
  await gh.updatePullRequest(p.number, { body: withDecision(withoutLeadAsked(p.body), { kind: 'changes', ...sayer({ by: input.lead, byName: input.leadName, date: input.date }), text: input.note, sha: p.headSha }) });
}

/** A lead's question, no verdict: it keeps waiting, now on the designer's answer. */
export async function leadQuestionOnGitHub(gh: GitHubClient, ref: string | number, input: { text: string; lead?: string | undefined; leadName?: string | undefined; date?: Date | undefined }): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  if (!isWaitingForLead(p.body)) throw new GitHubError(422, ALREADY_ANSWERED);
  await gh.updatePullRequest(p.number, { body: withDecision(p.body, { kind: 'question', ...sayer({ by: input.lead, byName: input.leadName, date: input.date }), text: input.text, sha: p.headSha }) });
}

/**
 * The designer answers. To a question: it waits on the lead again. To changes or a take back: the answer, then the same
 * ask as Done exploring, with the pieces they ticked before.
 */
export async function answerLeadOnGitHub(gh: GitHubClient, ref: string | number, input: { text?: string | undefined; by?: string | undefined; byName?: string | undefined; date?: Date | undefined; leads?: readonly string[] | undefined }): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  const open = openDecisionOf(p.body);
  if (!open || open.kind === 'not-doing') throw new GitHubError(422, 'Nothing waits for your answer here.');
  const said = input.text?.trim();
  const body = said ? withDecision(p.body, { kind: 'answer', ...sayer(input), text: said, sha: p.headSha }) : p.body;
  if (open.kind === 'question') {
    await gh.updatePullRequest(p.number, { body });
    return;
  }
  const leads = (input.leads ?? []).map(githubLoginOf).filter((l): l is string => Boolean(l));
  await gh.updatePullRequest(p.number, { body: withLeadAskedTo(withLeadAsked(body, { at: sayer(input).at, by: githubLoginOf(input.by), byName: input.byName, sha: p.headSha }), leads) });
  if (leads.length) await gh.createIssueComment(p.number, `${leads.map((l) => `@${l}`).join(' ')} ready for your validation in Bridge again.`).catch(() => undefined);
}

/** "Ask someone else to review": the other leads get it, the one who asks is off it. */
export async function askOtherLeadOnGitHub(gh: GitHubClient, ref: string | number, input: { to: readonly string[]; lead?: string | undefined; leadName?: string | undefined; date?: Date | undefined }): Promise<void> {
  if (!input.to.length) throw new GitHubError(422, 'There is nobody else to ask.');
  const p = await findExplorationOnGitHub(gh, ref);
  if (!isWaitingForLead(p.body)) throw new GitHubError(422, ALREADY_ANSWERED);
  await gh.updatePullRequest(p.number, { body: withDecision(withLeadAskedTo(p.body, input.to), { kind: 'asked-someone', ...sayer({ by: input.lead, byName: input.leadName, date: input.date }), to: [...input.to] }) });
  await gh.createIssueComment(p.number, `${input.to.map((l) => `@${l}`).join(' ')} ready for your validation in Bridge.`).catch(() => undefined);
}

/**
 * "Not doing this": the exploration ends, the reason stays with it. Archived, not closed: its preview and notes stay.
 * Handed to developers already: their task leaves their list first.
 */
export async function notDoingOnGitHub(gh: GitHubClient, ref: string | number, input: { reason: string; lead?: string | undefined; leadName?: string | undefined; date?: Date | undefined }): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  const status = explorationStatus({ state: p.state, labels: p.labels, headRef: p.headRef, body: p.body, headSha: p.headSha, draft: p.draft });
  if (status === 'building') throw new GitHubError(422, 'Developers already work on it: it stays with them.');
  if (status !== 'active' && status !== 'ready') throw new GitHubError(422, ALREADY_ANSWERED);
  if (status === 'ready') await reopenExplorationOnGitHub(gh, p.number, { by: input.lead, date: input.date, reason: input.reason });
  const now = status === 'ready' ? await findExplorationOnGitHub(gh, p.number) : p;
  await gh.updatePullRequest(p.number, { body: withDecision(withoutLeadAsked(now.body), { kind: 'not-doing', ...sayer({ by: input.lead, byName: input.leadName, date: input.date }), text: input.reason, sha: p.headSha }) });
  await gh.addLabels(p.number, [EXPLORATION_ARCHIVED_LABEL]);
}

/** "Take it back": a lead takes the exploration back from the developers' list, with the reason for its designer. */
export async function takeBackOnGitHub(gh: GitHubClient, ref: string | number, input: { reason: string; lead?: string | undefined; leadName?: string | undefined; date?: Date | undefined }): Promise<BackToExploring> {
  return reopenExplorationOnGitHub(gh, ref, { by: input.lead, date: input.date, reason: input.reason, decision: { kind: 'take-back', ...sayer({ by: input.lead, byName: input.leadName, date: input.date }), text: input.reason } });
}

/** A word to the developers who already started: on their task, else on the exploration itself. */
export async function tellDevelopersOnGitHub(gh: GitHubClient, ref: string | number, input: { text: string; byName?: string | undefined }): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  const task = designTaskRef(parseExplorationBody(p.body)?.task, null);
  const words = input.byName ? `**${input.byName}** (design lead):\n\n${input.text.trim()}` : input.text.trim();
  if (task) await gh.withBranchPrefix(undefined).forRepo(task.repo).createIssueComment(task.number, words);
  else await gh.createIssueComment(p.number, words);
}

/** Take over or hand over: a new keeper, with who decided and why. Who it was given to reads in its Decisions. */
export async function handOverOnGitHub(gh: GitHubClient, ref: string | number, input: { to: { login: string } | { member: string; name: string }; toName: string; reason: string; by?: string | undefined; byName?: string | undefined; date?: Date | undefined }): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  await gh.updatePullRequest(p.number, { body: withDecision(withKeeper(p.body, input.to), { kind: 'handed', ...sayer(input), text: input.reason, to: [input.toName], sha: p.headSha }) });
}

/** The designer keeps exploring while the lead has not answered. */
export async function cancelLeadAskOnGitHub(gh: GitHubClient, ref: string | number): Promise<void> {
  const p = await findExplorationOnGitHub(gh, ref);
  if (isWaitingForLead(p.body)) await gh.updatePullRequest(p.number, { body: withoutLeadAsked(p.body) });
}

/**
 * The notes Done exploring removed, back on the branch, from the commit just before it removed them. Explorations of a
 * design copy handed off before their notes stayed (doneExploringOnGitHub) come back here too.
 */
async function restoreNotes(gh: GitHubClient, x: GitHubClient, p: { number: number; headRef: string; body: string }): Promise<void> {
  const slug = parseExplorationBody(p.body)?.slug ?? p.headRef.slice(EXPLORATION_PREFIX.length);
  const path = explorationNotePath(slug);
  if (await gh.getFileText(path, p.headRef).catch(() => undefined)) return;
  const commits = await gh.listPullRequestCommits(p.number).catch(() => []);
  const at = commits.map((c) => c.commit.message).lastIndexOf(DONE_COMMIT_MESSAGE);
  if (at < 1) return;
  const content = await gh.getFileText(path, commits[at - 1]!.sha).catch(() => undefined);
  if (content) await x.commitToBranch({ branch: p.headRef, message: NOTES_BACK_COMMIT_MESSAGE, files: [{ path, content }] });
}

/** The design spec from the exploration's note files on the branch (exploration-notes.ts), or null when they hold none. */
async function notesSpecOnBranch(gh: GitHubClient, paths: readonly string[], branch: string): Promise<string | null> {
  const texts = await Promise.all(paths.map((path) => gh.getFileText(path, branch).catch(() => undefined)));
  const md = texts.filter((t): t is string => typeof t === 'string').join('\n\n');
  return md ? notesSpec(parseExplorationNotes(md)) : null;
}

/** What the developers' task says when the design team takes the exploration back. */
export const DESIGN_TASK_BACK_COMMENT = 'The design team took this back to exploring. It comes back here when they say Done exploring again.';

/** The developers' task from its issue URL; null for anything else, or for another repository than `repo` when given. */
export function designTaskRef(url: string | null | undefined, repo: string | null): { repo: string; number: number; url: string } | null {
  const m = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)\/?$/.exec((url ?? '').trim());
  if (!m) return null;
  if (repo && m[1]!.toLowerCase() !== repo.toLowerCase()) return null;
  return { repo: m[1]!, number: Number(m[2]), url: url!.trim() };
}

/**
 * The product added from its address (ProductConfig.address) whose explorations live in `repo`: through its designers'
 * copy (`copyOf`), or in the design team's own code itself (its `repo`). Null for every other product.
 */
export function addressProductOf(products: readonly ProductConfig[], copyOf: ProductConfig | null | undefined, repo: string): ProductConfig | null {
  if (copyOf) return liveAddressOf(copyOf) ? copyOf : null;
  const r = repo.trim().toLowerCase();
  return products.find((p) => liveAddressOf(p) && productCodeRepoOf(p, null)?.toLowerCase() === r) ?? null;
}

/**
 * Who said Done exploring, as GitHub content may record it (the exploration's note, the library requests): a GitHub
 * login only. A member without GitHub is named by Bridge's own attribution line and their commits, never by an email
 * and never by a bare name that could @mention someone else on GitHub.
 */
function doneByOfInput(input: { openedBy?: string | undefined }): string | undefined {
  return githubLoginOf(input.openedBy) ?? undefined;
}
