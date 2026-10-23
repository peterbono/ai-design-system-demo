// Suggestions from Claude or the terminal: file one, list them, read one with its approvals, review it (approve,
// request changes, decline), apply it on today's code and record the pull request that applies it. A suggestion is a
// GitHub issue holding an exact, machine-applicable change (bridge.suggestion/1, @bridge-ds/core suggestions.ts): the
// design system owner only needs Issues write, and a developer applies it with their own access. The same core
// functions Studio calls; applying runs on the local checkout (applySuggestionLocally) or, on a remote repo, returns
// the files to write.
import {
  approverLists,
  soloOwnerOf,
  soloOwnerSentence,
  baseBranchOf,
  changesMode,
  closingIssueNumbers,
  CONFIG_FILE,
  composeSuggestionIssue,
  createSuggestionOnGitHub,
  declineSuggestionOnGitHub,
  getSuggestionOnGitHub,
  gitBlobSha,
  githubSuggestionWorkspace,
  stalenessStatus,
  suggestionStalenessOnGitHub,
  linkSuggestionPrOnGitHub,
  listSuggestionsOnGitHub,
  loadConfig,
  pendingApprovals,
  planSuggestionApply,
  reviewSuggestionOnGitHub,
  SUGGESTION_KINDS,
  SUGGESTION_LABEL,
  SUGGESTION_SCHEMA,
  SUGGESTION_STATUS_LABEL,
  suggestionApplyTable,
  suggestionPathProblems,
  suggestionShapeProblems,
  syncSuggestionStateLabel,
  TeamDirectory,
  type ApprovalRole,
  type BridgeConfig,
  type ChangesMode,
  type GitHubClient,
  type RequestSource,
  type SuggestionApplyPlan,
  type SuggestionGovernance,
  type SuggestionKind,
  type PullRequestSummary,
  type SuggestionDetail,
  type SuggestionPayloadV1,
  type SuggestionStaleness,
  type SuggestionStatus,
  type SuggestionWorkspace,
} from '@bridge-ds/core';
import { applySuggestionLocally, git, type LocalApplyMode } from '@bridge-ds/core/node';
import { reader, viewerOf, writer } from './branches.js';
import type { BridgeContext } from './context.js';
import { addToken, say } from './say.js';

/** Rights a suggestion needs: an issue, never code. */
export const SUGGEST_RIGHTS = 'Issues: read and write (Contents: read is enough)';

/**
 * How a write reaches the code for this call: the explicit choice (a tool's `changes`, the CLI's --suggest or
 * --direct), else `changes` in bridge.config.json, else "suggest".
 */
export async function changesFor(ctx: BridgeContext, explicit?: ChangesMode | undefined): Promise<ChangesMode> {
  if (explicit === 'suggest' || explicit === 'direct') return explicit;
  const { config } = await ctx.config();
  return changesMode(config);
}

/** What to do next once a suggestion is filed. The wording matches the issue's "How to apply". */
export const appliedNext = (n: number, ctx: { surface: 'mcp' | 'cli' } = { surface: 'mcp' }) =>
  say(
    ctx,
    `The owners review it on the issue (bridge_review_suggestion, or Bridge Studio). Once approved, a developer applies it: \`bridge apply ${n}\` in the repo, or in Claude Code with the Bridge MCP server, "Apply Bridge suggestion #${n}" (bridge_apply_suggestion).`,
    `The owners review it on the issue (\`bridge review ${n} --approve\`, or Bridge Studio). Once approved, a developer applies it: \`bridge apply ${n}\` in the repo.`,
  );

/** Why nothing was filed: no GitHub repo, or no token that can write issues. */
export function noSuggestionAccess(ctx: BridgeContext, gh: GitHubClient | null): string {
  const local = ctx.mode === 'local' && ctx.isGit ? `, or ${say(ctx, 'pass changes "direct"', 'add --direct')} to commit it on a new local branch instead` : '';
  if (!gh) return `Nothing sent: a suggestion is a GitHub issue and no GitHub repo is known. Set "repo" in ${CONFIG_FILE} or add an origin remote${local}.`;
  return `Nothing sent: a suggestion is a GitHub issue, which needs a GitHub token with ${SUGGEST_RIGHTS} on ${gh.fullName}: ${addToken(ctx)}${local}.`;
}

/**
 * The commit a suggestion is planned on: the local HEAD when the server reads a checkout (that is what the plan read),
 * else the head of the ref the server reads on GitHub.
 */
export async function suggestionBase(ctx: BridgeContext, gh: GitHubClient, config: BridgeConfig): Promise<{ ref: string; sha: string }> {
  const ref = ctx.ref ?? baseBranchOf(config);
  if (ctx.mode === 'local' && ctx.isGit && ctx.root) {
    const sha = (await git(ctx.root, ['rev-parse', 'HEAD']).catch(() => '')).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return { ref: baseBranchOf(config), sha };
  }
  const sha = await gh.getBranchSha(ref);
  if (!sha) throw new Error(`Branch ${ref} not found on ${gh.fullName}. Check the default branch in ${CONFIG_FILE}.`);
  return { ref, sha };
}

/**
 * The payload of a whole-file change (brand, revert, config): each file with the git blob sha it has where the plan
 * read it (null: new) and its new content (null: deleted).
 */
export async function filesSuggestionPayload(
  ctx: BridgeContext,
  input: {
    kind: Extract<SuggestionKind, 'brand' | 'revert' | 'config'>;
    title: string;
    summary: string;
    files: { path: string; content: string | null }[];
    tier: SuggestionPayloadV1['tier'];
    base: { ref: string; sha: string };
    source: RequestSource;
    suggestedBy?: string | null | undefined;
    checks?: Partial<SuggestionPayloadV1['checks']> | undefined;
  },
): Promise<SuggestionPayloadV1> {
  const files = await Promise.all(
    input.files.map(async (f) => {
      const now = await ctx.source.read(f.path);
      return { path: f.path, beforeSha: now === null ? null : gitBlobSha(now), afterSha: f.content === null ? null : gitBlobSha(f.content), content: f.content };
    }),
  );
  return {
    schema: SUGGESTION_SCHEMA,
    kind: input.kind,
    title: input.title,
    summary: input.summary.trim() || input.title,
    source: input.source,
    ...(input.suggestedBy ? { suggestedBy: input.suggestedBy.replace(/^@/, '') } : {}),
    createdAt: new Date().toISOString(),
    base: input.base,
    tier: input.tier,
    files,
    checks: { newErrors: 0, contrast: [], blocked: null, impact: 0, ...input.checks },
  };
}

/**
 * Files a planned whole-file change as a suggestion (bridge_propose_brand, bridge_propose_revert in suggest mode).
 * The caller already checked the plan is not blocked.
 */
export async function fileSuggestion(
  ctx: BridgeContext,
  build: (base: { ref: string; sha: string }, suggestedBy: string | null) => Promise<SuggestionPayloadV1>,
  opts: { labels?: string[] | undefined; details?: string | undefined; dryRun?: boolean | undefined } = {},
): Promise<
  | { status: 'dry-run'; suggestion: { title: string; labels: string[]; body: string; parts: number } }
  | { status: 'preview'; message: string }
  | { status: 'suggested'; number: number; url: string; sha: string; labels: string[]; warnings: string[]; next: string }
> {
  const { config } = await ctx.config();
  const gh = await ctx.github();
  if (opts.dryRun) {
    const base = gh ? await suggestionBase(ctx, gh, config).catch(() => ({ ref: baseBranchOf(config), sha: '0000000' })) : { ref: baseBranchOf(config), sha: '0000000' };
    const payload = await build(base, null);
    const issue = composeSuggestionIssue(payload, { labels: [...config.governance.labels, ...(opts.labels ?? [])], details: opts.details, repo: gh?.fullName });
    return { status: 'dry-run', suggestion: { title: issue.title, labels: issue.labels, body: issue.body, parts: issue.parts.length } };
  }
  if (!gh || !ctx.canWriteRemote) return { status: 'preview', message: noSuggestionAccess(ctx, gh) };
  const base = await suggestionBase(ctx, gh, config);
  const viewer = await viewerOf(ctx, gh);
  const payload = await build(base, viewer);
  const problems = suggestionPathProblems(payload, config);
  if (problems.length) throw new Error(`Not suggested: ${problems.join(' ')}`);
  const labels = [...new Set([...config.governance.labels, ...(opts.labels ?? [])])];
  const created = await createSuggestionOnGitHub(gh, payload, { labels, details: opts.details, assignees: config.integrations?.requests?.assignees ?? [] });
  return { status: 'suggested', number: created.number, url: created.url, sha: created.sha, labels, warnings: created.warnings, next: appliedNext(created.number, ctx) };
}

/** 42, "#42" or an issue link: the suggestion number. Throws how to fix it otherwise. */
export function suggestionNumber(input: number | string): number {
  if (typeof input === 'number' && Number.isInteger(input) && input > 0) return input;
  const m = /^#?(\d+)$/.exec(String(input).trim()) ?? /\/issues\/(\d+)/.exec(String(input));
  if (!m) throw new Error(`"${input}" is not a suggestion number. Pass the issue number (42 or "#42") or its link.`);
  return Number(m[1]);
}

/**
 * The owners who approve suggestions, from bridge.config.json on the default branch (never from the payload, never
 * from a branch someone could edit), with GitHub team members read when owners name teams.
 */
export async function suggestionGovernance(ctx: BridgeContext, gh: GitHubClient): Promise<{ config: BridgeConfig; gov: SuggestionGovernance }> {
  const { config: here } = await ctx.config();
  let config = here;
  try {
    const text = await gh.readFile(CONFIG_FILE, baseBranchOf(here));
    if (text) config = loadConfig(text);
  } catch {
    // Not readable on GitHub (no access, no file): the config the server reads is the best there is.
  }
  const { owners, rights } = config.governance;
  const hasTeams = [...owners.design, ...owners.tech].some((o) => o.includes('/'));
  const teams = hasTeams ? await new TeamDirectory(gh).resolve(owners).catch(() => undefined) : undefined;
  return { config, gov: { owners, rights: rights ?? null, ...(teams ? { teams } : {}), ...(config.governance.soloOwnerCanApproveBoth ? { soloOwnerCanApproveBoth: true } : {}) } };
}

export type SuggestionStatusFilter = SuggestionStatus | 'all';
const OPEN_STATUSES: readonly SuggestionStatus[] = ['needs-review', 'changes-requested', 'approved', 'applying', 'outdated'];

/** Open statuses that main moving can turn into Outdated (withOutdated in core). */
const REVIEW_STATUSES: readonly SuggestionStatus[] = ['needs-review', 'changes-requested', 'approved'];
/** Open suggestions checked against main per list, the most recent first. */
const MAX_STALENESS_READS = 30;

/** The ref suggestions are checked against: the one the server reads, else the default branch. */
const mainRef = (ctx: BridgeContext, config: BridgeConfig) => ctx.ref ?? baseBranchOf(config);

/** Whether an open suggestion still applies to main (core suggestionStalenessOnGitHub, the rule Studio uses). */
async function stalenessOf(ctx: BridgeContext, gh: GitHubClient, d: SuggestionDetail, config: BridgeConfig, gov: SuggestionGovernance): Promise<SuggestionStaleness | null> {
  if (d.issue.state !== 'open' || !REVIEW_STATUSES.includes(d.status)) return null;
  return suggestionStalenessOnGitHub(gh, d, { config, governance: gov, ref: mainRef(ctx, config) }).catch(() => null);
}

/** bridge_list_suggestions / `bridge suggestions list`. */
export async function listSuggestionsOp(ctx: BridgeContext, a: { status?: SuggestionStatusFilter | undefined; state?: 'open' | 'closed' | 'all' | undefined; kind?: SuggestionKind | undefined; limit?: number | undefined } = {}) {
  const gh = await reader(ctx);
  const status = a.status ?? 'all';
  const state = a.state ?? (status === 'all' ? 'open' : OPEN_STATUSES.includes(status) ? 'open' : 'closed');
  const pulls = await gh.listPullRequests('all').catch(() => [] as PullRequestSummary[]);
  let rows = await listSuggestionsOnGitHub(gh, { state, perPage: 100, pulls });
  // Main may have moved under an open suggestion: Outdated, the same rule as bridge_get_suggestion and Studio.
  const open = rows.filter((r) => r.state === 'open' && REVIEW_STATUSES.includes(r.status)).slice(0, MAX_STALENESS_READS);
  if (open.length) {
    const { config, gov } = await suggestionGovernance(ctx, gh);
    const outdated = new Set<number>();
    await Promise.all(
      open.map(async (r) => {
        const d = await getSuggestionOnGitHub(gh, r.number, gov, { pulls }).catch(() => null);
        if (!d?.parsed.ok) return;
        const st = await suggestionStalenessOnGitHub(gh, d, { config, governance: gov, ref: mainRef(ctx, config) }).catch(() => null);
        if (st?.outdated) outdated.add(r.number);
      }),
    );
    rows = rows.map((r) => (outdated.has(r.number) ? { ...r, status: stalenessStatus(r.status, { outdated: true }) } : r));
  }
  if (status !== 'all') rows = rows.filter((r) => r.status === status);
  if (a.kind) rows = rows.filter((r) => r.kind === a.kind);
  const total = rows.length;
  rows = rows.slice(0, a.limit ?? 100);
  const approved = rows.filter((r) => r.status === 'approved');
  return {
    repo: gh.fullName,
    label: SUGGESTION_LABEL,
    state,
    status,
    total,
    suggestions: rows.map((r) => ({
      number: r.number,
      title: r.title,
      kind: r.kind ?? null,
      tier: r.tier ?? null,
      status: r.status,
      said: SUGGESTION_STATUS_LABEL[r.status],
      author: r.author,
      url: r.url,
      linkedPrs: r.linkedPrs,
    })),
    next: approved.length
      ? `Ready to apply: ${approved.map((r) => `#${r.number}`).join(', ')}. Apply one with ${say(ctx, 'bridge_apply_suggestion { number } (dry run first), or `bridge apply <n>`', '`bridge apply <n> --dry-run` first, then `bridge apply <n>`')}.`
      : rows.length
        ? say(ctx, 'Read one with bridge_get_suggestion { number }: its change, checks and who still has to approve it. Statuses come from labels here; bridge_get_suggestion counts the approvals.', 'Read one with `bridge suggestions show <n>`: its change, checks and who still has to approve it. Statuses come from labels here; `bridge suggestions show` counts the approvals.')
        : 'No suggestion matches.',
  };
}

const roleText = (m: ApprovalRole) => (m === 'approval' ? 'one approval' : `${m} approval`);

/** bridge_get_suggestion / `bridge suggestions show <n>`: one suggestion, with its approvals on the current version. */
export async function getSuggestionOp(ctx: BridgeContext, a: { number: number | string }) {
  const n = suggestionNumber(a.number);
  const gh = await reader(ctx);
  const { config, gov } = await suggestionGovernance(ctx, gh);
  const d = await getSuggestionOnGitHub(gh, n, gov);
  // Main moved and the change no longer applies as suggested: Outdated (core staleness, the rule Studio uses).
  const stale = d.parsed.ok ? await stalenessOf(ctx, gh, d, config, gov) : null;
  d.status = stalenessStatus(d.status, stale);
  const base = { number: n, url: d.issue.url, title: d.issue.title, state: d.issue.state, status: d.status, said: SUGGESTION_STATUS_LABEL[d.status], author: d.issue.author, labels: d.issue.labels, linkedPrs: d.linkedPrs };
  if (!d.parsed.ok) {
    if (!d.issue.labels.includes(SUGGESTION_LABEL) && d.parsed.reason === 'no-block') throw new Error(`Issue #${n} is not a Bridge suggestion: it has no "${SUGGESTION_LABEL}" label and no suggestion block.`);
    return { ...base, problem: d.parsed.message, next: 'Ask the author to send it again from Bridge.' };
  }
  const p = d.parsed.payload;
  const approvals = d.approvals!;
  const missing = pendingApprovals(p.tier.tier, approvals);
  const solo = soloOwnerOf(gov, gov.teams);
  return {
    ...base,
    kind: p.kind,
    summary: p.summary,
    source: p.source,
    ...(p.suggestedBy ? { suggestedBy: p.suggestedBy } : {}),
    createdAt: p.createdAt,
    base: p.base,
    tier: p.tier.tier,
    bump: p.tier.bump,
    version: d.parsed.sha.slice(0, 7),
    payloadSha: d.parsed.sha,
    ...(d.parsed.edited ? { edited: 'The machine-readable block was edited by hand after Bridge wrote it. Applying it needs acceptEdited (the CLI: --accept-edited) once you checked it.' } : {}),
    change: {
      ...(p.tokens ? { tokens: p.tokens.changes.length ? p.tokens.changes.map((c) => ({ kind: c.kind, path: c.path, ...(c.from ? { from: c.from } : {}), file: c.file, before: c.beforeCss ?? c.before, after: c.afterCss ?? c.after })) : p.tokens.edits } : {}),
      ...(p.docs ? { docs: p.docs.map((x) => ({ component: x.component, path: x.path })) } : {}),
      ...(p.componentSpec ? { componentSpec: { component: p.componentSpec.component, specPath: p.componentSpec.specPath } } : {}),
      ...(p.files?.length ? { files: p.files.map((f) => ({ path: f.path, change: f.beforeSha === null ? 'new' : f.afterSha === null ? 'deleted' : 'changed' })) } : {}),
    },
    checks: p.checks,
    ...(p.links ? { links: p.links } : {}),
    ...(p.previews?.length ? { previews: p.previews } : {}),
    approvals: {
      approvedBy: approvals.approvers,
      missing: missing.map(roleText),
      changesRequestedBy: approvals.changesRequested,
      ...(approvals.stale.length ? { staleReviews: approvals.stale } : {}),
      ...(approvals.ignored.length ? { notCounted: approvals.ignored } : {}),
      ...(solo && p.tier.tier > 1 ? { soloOwner: soloOwnerSentence(solo) } : {}),
    },
    applied: d.applied,
    ...(stale?.outdated ? { outdated: { mainSha: stale.mainSha, conflicts: stale.conflicts.map((c) => ({ path: c.path, detail: c.detail })) } } : {}),
    ...(p.componentSpec ? { brief: p.componentSpec.brief } : {}),
    next:
      d.status === 'approved'
        ? `Approved. Apply it: ${say(ctx, `bridge_apply_suggestion { number: ${n}, mode: "dry-run" } first, then mode "branch" (or \`bridge apply ${n}\`)`, `\`bridge apply ${n} --dry-run\` first, then \`bridge apply ${n}\``)}. The pull request must say "Closes #${n}".`
        : d.status === 'needs-review'
          ? `Waiting for ${missing.map(roleText).join(' and ') || 'a review'} from the owners in ${CONFIG_FILE}: ${say(ctx, `bridge_review_suggestion { number: ${n}, event: "approve" }`, `\`bridge review ${n} --approve\``)}.`
          : d.status === 'changes-requested'
            ? 'Changes requested: the author sends a new version (approvals then start again).'
            : d.status === 'applying'
              ? `Being applied${d.linkedPrs.length ? ` in ${d.linkedPrs.map((x) => `#${x.number}`).join(', ')}` : ''}. It closes when the pull request merges.`
              : d.status === 'outdated'
                ? `Outdated: ${stale?.conflicts[0] ? stale.conflicts[0].detail.replace(/\.$/, '') : 'main changed what it changes since it was suggested'}. Ask the author to send it again on today's code.`
                : `${SUGGESTION_STATUS_LABEL[d.status]}: nothing to do.`,
  };
}

export type SuggestionReviewEventArg = 'approve' | 'request-changes' | 'comment' | 'decline';

/**
 * bridge_review_suggestion / `bridge review <n>`: approve, request changes, comment on or decline a suggestion, as the
 * token's user. Approvals count only from the owners in bridge.config.json and only on the version reviewed
 * (`payloadSha`, the version bridge_get_suggestion showed): a newer version is never approved by mistake.
 */
export async function reviewSuggestionOp(ctx: BridgeContext, a: { number: number | string; event: SuggestionReviewEventArg; message?: string | undefined; role?: ApprovalRole | undefined; payloadSha?: string | undefined }) {
  const n = suggestionNumber(a.number);
  const gh = await writer(ctx, 'Reviewing a suggestion', 'Issues: read and write');
  const { gov } = await suggestionGovernance(ctx, gh);
  const viewer = await viewerOf(ctx, gh);
  if (a.event === 'decline') {
    if (!a.message?.trim()) throw new Error('Say why it is declined, in a sentence: the author reads it.');
    if (a.payloadSha) {
      const d = await getSuggestionOnGitHub(gh, n, gov);
      if (d.parsed.ok && !d.parsed.sha.startsWith(a.payloadSha)) throw new Error(`#${n} changed since you read it. Read it again (${say(ctx, 'bridge_get_suggestion', `\`bridge suggestions show ${n}\``)}) before declining.`);
    }
    const r = await declineSuggestionOnGitHub(gh, n, a.message.trim(), viewer);
    return { number: n, status: 'declined' as SuggestionStatus, said: SUGGESTION_STATUS_LABEL.declined, ...(r.warnings.length ? { warnings: r.warnings } : {}), next: 'Closed as not planned, with your reason. Reopen it on GitHub to look at it again.' };
  }
  if (a.event !== 'comment' && viewer) {
    const lists = approverLists(gov.owners, gov.rights ?? null, gov.teams ?? undefined);
    const owners = [...lists.design, ...lists.tech].map((l) => l.toLowerCase().replace(/^@/, ''));
    if (owners.length && !owners.includes(viewer.toLowerCase())) {
      throw new Error(`Only the owners in ${CONFIG_FILE} approve or request changes on suggestions, and @${viewer} is not one. Comment instead (event "comment"), or ask an owner.`);
    }
  }
  const payloadSha = a.payloadSha && /^[0-9a-f]{64}$/.test(a.payloadSha) ? a.payloadSha : undefined;
  if (a.payloadSha && !payloadSha) {
    const d = await getSuggestionOnGitHub(gh, n, gov);
    if (d.parsed.ok && !d.parsed.sha.startsWith(a.payloadSha)) throw new Error(`#${n} changed since you read it. Read it again (${say(ctx, 'bridge_get_suggestion', `\`bridge suggestions show ${n}\``)}) and review the new version.`);
  }
  const r = await reviewSuggestionOnGitHub(gh, n, { event: a.event, role: a.role, message: a.message, payloadSha, ...(viewer ? { by: viewer } : {}) }, gov);
  return {
    number: n,
    event: a.event,
    counts: r.counts,
    version: r.payloadSha.slice(0, 7),
    status: r.status,
    said: SUGGESTION_STATUS_LABEL[r.status],
    comment: r.commentUrl,
    ...(r.warnings.length ? { warnings: r.warnings } : {}),
    next: r.status === 'approved' ? `Approved: a developer applies it with \`bridge apply ${n}\`${say(ctx, ' or bridge_apply_suggestion', '')}.` : r.status === 'changes-requested' ? 'The author sends a new version; approvals start again on it.' : 'Waiting for the other approvals.',
  };
}

/** The planner's workspace over the GitHub API at a ref (remote mode: nothing is written, the files come back). */
export function githubWorkspace(gh: GitHubClient, ref: string): SuggestionWorkspace {
  return githubSuggestionWorkspace(gh, ref);
}

export type ApplyModeArg = 'dry-run' | LocalApplyMode;

const MAX_DIFF = 12_000;
const cut = (s: string | undefined) => (s && s.length > MAX_DIFF ? `${s.slice(0, MAX_DIFF)}\n... (truncated)` : s);

function planFacts(plan: SuggestionApplyPlan) {
  return {
    outcome: plan.outcome,
    exitCode: plan.exitCode,
    version: plan.payloadSha.slice(0, 7),
    table: suggestionApplyTable(plan),
    ...(plan.problems.length ? { problems: plan.problems } : {}),
    ...(plan.notes.length ? { notes: plan.notes } : {}),
    ...(plan.gate ? { approvals: { review: plan.gate.review, missing: plan.gate.missing.map(roleText), forced: plan.gate.forced, edited: plan.gate.edited } } : {}),
    ...(plan.checks
      ? {
          checks: {
            tier: plan.checks.tier.tier,
            tierWhenSuggested: plan.checks.tierWhenSuggested,
            tierIncreased: plan.checks.tierIncreased,
            newErrors: plan.checks.newErrors.length,
            newContrastFailures: plan.checks.newFailures.map((f) => `${f.fg} on ${f.bg}${f.modes ? ` (${f.modes})` : ''}`),
          },
        }
      : {}),
    ...(plan.brief ? { brief: plan.brief } : {}),
  };
}

/**
 * bridge_apply_suggestion / `bridge apply <n>`: plans the suggestion on today's code and hands it over.
 *   - local checkout: "branch" (default, one commit on a new local branch, working tree untouched, nothing pushed),
 *     "write" (into the working tree), "patch" (a git format-patch text), or "dry-run" (the plan and the diff);
 *   - remote repo: always a plan, with the files to write yourself on a branch.
 * Refused, blocked, conflicting or already applied: nothing written. Once a branch or files exist, the applied record
 * is posted on the issue (best effort, needs Issues write) and the issue is labelled "being applied".
 */
export async function applySuggestionOp(
  ctx: BridgeContext,
  a: { number: number | string; mode?: ApplyModeArg | undefined; dryRun?: boolean | undefined; acceptEdited?: boolean | undefined; forceUnapproved?: boolean | undefined; base?: string | undefined; branch?: string | undefined },
) {
  const n = suggestionNumber(a.number);
  const gh = await reader(ctx);
  const { config, gov } = await suggestionGovernance(ctx, gh);
  const d = await getSuggestionOnGitHub(gh, n, gov);
  if (!d.parsed.ok) {
    if (!d.issue.labels.includes(SUGGESTION_LABEL) && d.parsed.reason === 'no-block') throw new Error(`Issue #${n} is not a Bridge suggestion: it has no "${SUGGESTION_LABEL}" label and no suggestion block.`);
    return { number: n, status: 'refused', outcome: 'refused', exitCode: 1, message: `Not applied: ${d.parsed.message}` };
  }
  if (d.status === 'declined') return { number: n, status: 'refused', outcome: 'refused', exitCode: 1, message: `Not applied: #${n} was declined. Reopen it on GitHub first if it should go in after all.` };
  if (d.status === 'applied') {
    // Applied and closed: nothing to write; the issue keeps the final label only (no "needs review", no "applying").
    const warnings: string[] = [];
    if (ctx.canWriteRemote) {
      const w = await syncSuggestionStateLabel(gh, n, d.issue.labels, 'applied').catch((e: Error) => `The status label on #${n} could not be updated (${e.message}).`);
      if (w) warnings.push(w);
    }
    return { number: n, status: 'already-applied', outcome: 'already-applied', exitCode: 0, message: `#${n} is already applied and closed: nothing to write.`, ...(warnings.length ? { warnings } : {}) };
  }
  const parsed = d.parsed;
  const dryRun = a.dryRun || a.mode === 'dry-run';
  const mode: LocalApplyMode = a.mode && a.mode !== 'dry-run' ? a.mode : 'branch';
  const common = { parsed, comments: d.comments, governance: gov, author: d.issue.author || null, acceptEdited: a.acceptEdited, forceUnapproved: a.forceUnapproved };

  if (ctx.mode !== 'local' || !ctx.isGit || !ctx.root) {
    // Remote (or not a git checkout): plan against the code on GitHub and return the files to write.
    const ref = ctx.ref ?? baseBranchOf(config);
    const plan = await planSuggestionApply({ ...common, config, workspace: githubWorkspace(gh, ref) });
    return {
      number: n,
      status: plan.outcome === 'ready' ? 'planned' : plan.outcome,
      message: plan.message,
      ...planFacts(plan),
      ...(plan.outcome === 'ready' ? { files: plan.writes } : {}),
      next:
        plan.outcome === 'ready'
          ? `Bridge reads ${gh.fullName} over the API and writes nothing here. Write these files on a new branch, commit, push, and open a pull request whose body says "Closes #${n}", then ${say(ctx, `bridge_link_suggestion { number: ${n}, pr }`, `\`bridge suggestions link ${n} --pr <number>\``)}.`
          : plan.message,
    };
  }

  const viewer = await viewerOf(ctx, gh);
  const r = await applySuggestionLocally({
    ...common,
    root: ctx.root,
    number: n,
    mode,
    dryRun,
    ...(a.base ? { base: a.base } : {}),
    ...(a.branch ? { branch: a.branch } : {}),
    ...(viewer ? { by: viewer } : {}),
    readBase: async (path, sha) => (await gh.readFile(path, sha).catch(() => undefined)) ?? null,
  });
  let recorded = false;
  const warnings: string[] = [];
  if (r.appliedComment && !dryRun && (r.status === 'branch-created' || r.status === 'written' || r.status === 'branch-exists')) {
    if (ctx.canWriteRemote) {
      try {
        await gh.addComment(n, r.appliedComment);
        recorded = true;
        const w = await syncSuggestionStateLabel(gh, n, d.issue.labels, 'applying');
        if (w) warnings.push(w);
      } catch (e) {
        warnings.push(`#${n} does not say it is being applied yet (${(e as Error).message}). It will once the pull request says "Closes #${n}".`);
      }
    } else warnings.push(`#${n} does not say it is being applied: that needs a GitHub token with Issues write. It will once the pull request says "Closes #${n}".`);
  }
  const next =
    r.status === 'dry-run'
      ? `Nothing written. Apply it: ${say(ctx, `bridge_apply_suggestion { number: ${n}, mode: "branch" } (or "write" for the working tree, "patch" for a patch)`, `\`bridge apply ${n}\` (or --write for the working tree, --patch for a patch)`)}.`
      : r.status === 'branch-created' || r.status === 'branch-exists'
        ? `Push ${r.branch} (git push -u origin ${r.branch}) and open a pull request whose body says "Closes #${n}", then ${say(ctx, `bridge_link_suggestion { number: ${n}, pr }`, `\`bridge suggestions link ${n} --pr <number>\``)}.`
        : r.status === 'written'
          ? `Review the files, commit them on a branch, push, and open a pull request whose body says "Closes #${n}", then ${say(ctx, `bridge_link_suggestion { number: ${n}, pr }`, `\`bridge suggestions link ${n} --pr <number>\``)}.`
          : r.status === 'patch'
            ? `Apply the patch with \`git am\` on a branch, then open a pull request whose body says "Closes #${n}".`
            : r.message;
  return {
    number: n,
    status: r.status,
    mode: dryRun ? 'dry-run' : mode,
    message: r.message,
    ...planFacts(r.plan),
    exitCode: r.exitCode,
    ...(r.branch ? { branch: r.branch } : {}),
    ...(r.commit ? { commit: r.commit } : {}),
    ...(r.written ? { written: r.written } : {}),
    ...(r.patch ? { patch: r.patch } : {}),
    ...(r.diff ? { diff: cut(r.diff) } : {}),
    recorded,
    ...(warnings.length ? { warnings } : {}),
    next,
  };
}

/**
 * bridge_link_suggestion / `bridge suggestions link <n> --pr <m>`: records the pull request (or branch) that applies a
 * suggestion, with the applied comment, and labels it "being applied". A pull request that does not say "Closes #n"
 * is linked with a warning: the suggestion only closes when it says so.
 */
export async function linkSuggestionOp(ctx: BridgeContext, a: { number: number | string; pr?: number | undefined; branch?: string | undefined; commit?: string | undefined; forced?: boolean | undefined }) {
  const n = suggestionNumber(a.number);
  const gh = await writer(ctx, 'Linking a suggestion', 'Issues: read and write');
  if (!a.pr && !a.branch && !a.commit) throw new Error('Say where it is applied: pr (the pull request number), branch or commit.');
  const { gov } = await suggestionGovernance(ctx, gh);
  const d = await getSuggestionOnGitHub(gh, n, gov);
  if (!d.parsed.ok) throw new Error(`#${n} cannot be linked: ${d.parsed.message}`);
  const warnings: string[] = [];
  let branch = a.branch;
  let merged = false;
  if (a.pr) {
    const pr = await gh.getPullRequest(a.pr);
    branch ??= pr.headRef;
    merged = pr.state === 'merged';
    if (!merged && !closingIssueNumbers(pr.body).includes(n)) warnings.push(`#${a.pr} does not say "Closes #${n}": add it to the pull request description, so the suggestion closes when it merges.`);
  }
  const viewer = await viewerOf(ctx, gh);
  const r = await linkSuggestionPrOnGitHub(gh, n, { pr: a.pr, branch, commit: a.commit, by: viewer ?? undefined, payloadSha: d.parsed.sha, forced: a.forced, merged });
  warnings.push(...r.warnings);
  const status: SuggestionStatus = r.status;
  return { number: n, status, said: SUGGESTION_STATUS_LABEL[status], ...(a.pr ? { pr: a.pr } : {}), ...(branch ? { branch } : {}), ...(warnings.length ? { warnings } : {}), next: status === 'applied' ? 'Applied: nothing left to do.' : 'It closes when the pull request merges.' };
}

/**
 * bridge_create_suggestion: files any change as a suggestion from its payload (bridge.suggestion/1), for example the
 * payload a dry run returned. Missing schema, source, date, base and checks are filled; the shape and the paths are
 * checked against the kind's folders and the guardrails before anything is sent.
 */
export async function createSuggestionOp(ctx: BridgeContext, a: { payload: Record<string, unknown>; labels?: string[] | undefined; dryRun?: boolean | undefined; source?: RequestSource | undefined }) {
  const { config } = await ctx.config();
  const gh = await ctx.github();
  const raw = a.payload ?? {};
  if (!SUGGESTION_KINDS.includes(raw.kind as SuggestionKind)) throw new Error(`"kind" must be one of ${SUGGESTION_KINDS.join(', ')}.`);
  const needsBase = !raw.base;
  const base = needsBase ? (gh ? await suggestionBase(ctx, gh, config).catch(() => null) : null) : (raw.base as { ref: string; sha: string });
  if (!base) throw new Error(`No base commit: pass "base" { "ref", "sha" }, or set "repo" in ${CONFIG_FILE} so Bridge reads it.`);
  const viewer = gh && !a.dryRun ? await viewerOf(ctx, gh) : null;
  const payload = {
    schema: SUGGESTION_SCHEMA,
    source: a.source ?? 'mcp',
    createdAt: new Date().toISOString(),
    checks: { newErrors: 0, contrast: [], blocked: null, impact: 0 },
    ...(viewer ? { suggestedBy: viewer } : {}),
    ...raw,
    base,
  } as unknown as SuggestionPayloadV1;
  const shape = suggestionShapeProblems(payload);
  if (shape.length) throw new Error(`The payload is not a suggestion: ${shape.join(' ')}`);
  if (payload.checks.blocked) throw new Error(`Not suggested: ${payload.checks.blocked}. Bridge never suggests a change that breaks the gate.`);
  const paths = suggestionPathProblems(payload, config);
  if (paths.length) throw new Error(`Not suggested: ${paths.join(' ')}`);
  const labels = [...new Set([...config.governance.labels, ...(a.labels ?? [])])];
  if (a.dryRun) {
    const issue = composeSuggestionIssue(payload, { labels, repo: gh?.fullName });
    return { status: 'dry-run', title: issue.title, labels: issue.labels, body: issue.body, parts: issue.parts.length, version: issue.sha.slice(0, 7) };
  }
  if (!gh || !ctx.canWriteRemote) return { status: 'preview', message: noSuggestionAccess(ctx, gh), payload };
  const created = await createSuggestionOnGitHub(gh, payload, { labels, repo: gh.fullName, assignees: config.integrations?.requests?.assignees ?? [] });
  return { status: 'suggested', number: created.number, url: created.url, version: created.sha.slice(0, 7), ...(created.warnings.length ? { warnings: created.warnings } : {}), next: appliedNext(created.number) };
}

