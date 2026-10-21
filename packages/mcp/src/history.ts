// History and rollback for the MCP server and the CLI: read the token history (local git or GitHub), the
// changes of one token, and plan or propose a revert (inverse edits against the current base branch, with
// conflicts) or the restore of one token to an older value. Writes go through the same guarded paths as
// bridge_propose_token_change: a new local bridge/* branch, or a PR on a new bridge/* branch. Never main.
import {
  type ChangePlan,
  type ChangesMode,
  type HistoryEntry,
  type HistoryReport,
  type RevertResolution,
  baseBranchOf,
  filterHistory,
  loadGitHubHistory,
  planRestore,
  planRevert,
  protectedBranchesOf,
  tokenHistory,
} from '@bridge-ds/core';
import { branchExists, commitToNewLocalBranch, currentBranch, loadLocalHistory } from '@bridge-ds/core/node';
import type { BridgeContext } from './context.js';
import { core, type TokenSet } from './core-adapter.js';
import { normalizeTokenPath } from './ops.js';
import { GitRefSource } from './source.js';
import { changesFor, fileSuggestion, filesSuggestionPayload } from './suggestions.js';

const cache = new WeakMap<BridgeContext, { at: number; limit: number; report: HistoryReport }>();

/** The history report for this context: local git (first parent of HEAD) or GitHub (the ref, PRs folded). */
export async function loadHistory(ctx: BridgeContext, limit = 40): Promise<HistoryReport> {
  const hit = cache.get(ctx);
  if (hit && hit.limit >= limit && Date.now() - hit.at < 60_000) return hit.report;
  const { config } = await ctx.config();
  let report: HistoryReport;
  if (ctx.mode === 'local' && ctx.isGit) report = await loadLocalHistory(ctx.root!, config, { ref: 'HEAD', limit });
  else {
    const gh = await ctx.github();
    if (!gh) throw new Error(ctx.mode === 'local' ? 'Not a git repo and no GitHub repo known: history needs one of them (set "repo" in bridge.config.json).' : 'No GitHub repo known.');
    report = await loadGitHubHistory(gh, config, { ...(ctx.ref ? { ref: ctx.ref } : {}), limit });
  }
  cache.set(ctx, { at: Date.now(), limit, report });
  return report;
}

/** The token set the base branch has now: HEAD locally (what a proposal branch builds on), the ref remotely. */
async function currentSet(ctx: BridgeContext): Promise<TokenSet> {
  if (ctx.mode === 'local' && ctx.isGit) {
    const { config } = await ctx.config();
    return core.loadTokenSet(new GitRefSource(ctx.root!, 'HEAD'), config);
  }
  return ctx.tokens();
}

const summarizeEntry = (e: HistoryEntry, withChanges: boolean, limit = 25) => ({
  id: e.id,
  sha: e.sha.slice(0, 10),
  date: e.date,
  author: e.author,
  title: e.title,
  why: e.why,
  ...(e.pr ? { pr: e.pr.number, ...(e.pr.url ? { url: e.pr.url } : {}) } : {}),
  version: e.version,
  tier: e.tier,
  bump: e.bump,
  breaking: e.breaking,
  counts: e.counts,
  ...(e.bulk ? { bulk: true } : {}),
  ...(withChanges
    ? {
        changes: e.changes.slice(0, limit).map((c) => ({ kind: c.kind, path: c.path, ...(c.from ? { from: c.from } : {}), file: c.file, ...(c.beforeCss !== undefined ? { before: c.beforeCss } : {}), ...(c.afterCss !== undefined ? { after: c.afterCss } : {}), ...(c.fields.length ? { fields: c.fields } : {}) })),
        ...(e.changes.length > limit ? { moreChanges: e.changes.length - limit } : {}),
      }
    : {}),
});

export interface HistoryArgs {
  token?: string;
  author?: string;
  tier?: 1 | 2 | 3;
  version?: string;
  breaking?: boolean;
  since?: string;
  until?: string;
  query?: string;
  limit?: number;
  includeChanges?: boolean;
}

export async function getHistory(ctx: BridgeContext, a: HistoryArgs = {}) {
  const report = await loadHistory(ctx, Math.max(40, a.limit ?? 40));
  const set = a.token ? await ctx.tokens() : undefined;
  const token = a.token && set ? normalizeTokenPath(set, a.token) : undefined;
  const entries = filterHistory(report.entries, { ...a, ...(token ? { token } : {}) });
  const shown = entries.slice(0, a.limit ?? 20);
  return {
    source: report.label,
    currentVersion: report.currentVersion ?? null,
    ...(report.truncated ? { truncated: 'Older commits exist: pass a larger limit to read further back.' } : {}),
    versions: report.timeline.map((v) => ({ version: v.version, date: v.date, pending: v.pending, prs: v.prs, entries: v.entries.length, tokenChanges: v.tokenChanges, breaking: v.breaking, bump: v.bump })),
    total: entries.length,
    entries: shown.map((e) => summarizeEntry(e, Boolean(a.includeChanges || token), token ? 50 : 25)),
    ...(report.entries.length ? {} : { note: 'No commit in the history Bridge can read changed a token yet.' }),
    hint: 'bridge_get_token_history for one token; bridge_plan_revert { target: "<id, #PR or sha>" } to see what undoing a change takes.',
  };
}

export async function getTokenHistory(ctx: BridgeContext, a: { path: string; limit?: number }) {
  const set = await ctx.tokens();
  const path = normalizeTokenPath(set, a.path);
  const report = await loadHistory(ctx, Math.max(40, a.limit ?? 40));
  const items = tokenHistory(report.entries, path, set.config);
  return {
    path,
    exists: set.defsOf(path).length > 0,
    source: report.label,
    total: items.length,
    changes: items.slice(0, a.limit ?? 50).map((i) => ({
      entry: i.entryId,
      date: i.date,
      author: i.author,
      title: i.title,
      why: i.why,
      ...(i.pr ? { pr: i.pr.number } : {}),
      version: i.version,
      kind: i.kind,
      ...(i.from ? { from: i.from } : {}),
      ...(i.path !== path ? { pathThen: i.path } : {}),
      file: set.repoPath(i.file),
      mode: i.modeLabel,
      ...(i.before !== undefined ? { before: i.before, beforeCss: i.beforeCss } : {}),
      ...(i.after !== undefined ? { after: i.after, afterCss: i.afterCss } : {}),
      ...(i.fields.includes('description') ? { descriptionBefore: i.descriptionBefore, descriptionAfter: i.descriptionAfter } : {}),
    })),
    ...(items.length ? { hint: 'Restore an older value with bridge_plan_revert { restore: { path, entry, mode } }.' } : { note: `No recorded change of ${path} in the history Bridge can read.` }),
  };
}

/** Finds an entry by id ("pr-12"), PR number ("#12", "12"), or sha (7 characters or more). */
export function findEntry(entries: HistoryEntry[], target: string): HistoryEntry {
  const t = target.trim().replace(/^#/, '');
  const hit =
    entries.find((e) => e.id === t) ??
    (/^\d+$/.test(t) ? entries.find((e) => e.pr?.number === Number(t)) : undefined) ??
    (/^[0-9a-f]{7,40}$/i.test(t) ? entries.find((e) => e.sha.startsWith(t.toLowerCase())) : undefined);
  if (!hit) throw new Error(`No token change "${target}" in the history Bridge can read. Use bridge_get_history to list entries (ids, PR numbers, shas).`);
  return hit;
}

export interface RestoreArg {
  path: string;
  /** History entry whose value to restore (its value AFTER that change), or use `value`. */
  entry?: string;
  /** "before": the value from before `entry` instead of after it. */
  side?: 'before' | 'after';
  value?: unknown;
  file?: string;
  mode?: Record<string, string>;
}

export interface PlanArgs {
  target?: string;
  restore?: RestoreArg;
  /** Conflict key (path@file) -> keep-current | use-before. */
  resolutions?: Record<string, RevertResolution>;
  /** Shortcut: every conflict uses the value from before the change. */
  restoreConflicts?: boolean;
}

async function buildPlan(ctx: BridgeContext, a: PlanArgs, tool: string): Promise<ChangePlan> {
  if (!a.target && !a.restore) throw new Error('Pass target (a history entry id, #PR or sha) to revert, or restore { path, entry | value } for one token.');
  const { config } = await ctx.config();
  const current = await currentSet(ctx);
  const pairs = await core.readContrastPairs(ctx.source, config).catch(() => []);
  const report = await loadHistory(ctx);
  if (a.restore) {
    const r = a.restore;
    const path = normalizeTokenPath(current, r.path);
    let file = r.file;
    if (!file && r.mode) {
      const combo = current.normalizeCombo(r.mode);
      const v = current.view(combo).get(path);
      if (!v) throw new Error(`"${path}" is not defined for ${JSON.stringify(combo)}.`);
      file = v[v.length - 1]!.file;
    }
    let value = r.value;
    let item;
    if (value === undefined) {
      if (!r.entry) throw new Error('restore needs value, or entry (the history entry whose value to put back).');
      const e = findEntry(report.entries, r.entry);
      const items = tokenHistory([e], path, config).filter((i) => !file || i.file === file);
      if (!items.length) throw new Error(`${e.id} did not change ${path}${file ? ` in ${file}` : ''}. bridge_get_token_history lists the changes of a token.`);
      if (items.length > 1 && !file) throw new Error(`${e.id} changed ${path} in ${items.map((i) => i.file).join(', ')}. Pass mode (for example {"theme":"dark"}) or file.`);
      item = items[0]!;
      file ??= item.file;
      value = r.side === 'before' ? item.before : item.after;
      if (value === undefined) throw new Error(`${path} has no ${r.side ?? 'after'} value in ${e.id} (it was ${item.kind}).`);
    }
    return planRestore({ current, path, ...(file ? { file } : {}), value, ...(item ? { item, label: item.pr ? `#${item.pr.number}` : item.entryId } : {}), pairs, tool });
  }
  const entry = findEntry(report.entries, a.target!);
  const later = report.entries.filter((e) => e.id !== entry.id && Date.parse(e.date) >= Date.parse(entry.date));
  const draft = planRevert({ current, entry, later, pairs, tool });
  const resolutions: Record<string, RevertResolution> = { ...(a.restoreConflicts ? Object.fromEntries(draft.conflicts.map((c) => [c.key, 'use-before' as const])) : {}), ...(a.resolutions ?? {}) };
  return Object.keys(resolutions).length ? planRevert({ current, entry, later, pairs, resolutions, tool }) : draft;
}

const planReport = (plan: ChangePlan) => ({
  status: plan.status,
  ...(plan.why ? { why: plan.why } : {}),
  kind: plan.kind,
  title: plan.prTitle,
  ...(plan.source ? { reverts: { id: plan.source.id, title: plan.source.title, date: plan.source.date, author: plan.source.author, ...(plan.source.pr ? { pr: plan.source.pr.number } : {}) } } : {}),
  tier: plan.tier.tier,
  bump: plan.tier.bump,
  reasons: plan.tier.reasons,
  edits: plan.planned.map((p) => p.summary),
  conflicts: plan.conflicts.map((c) => ({ key: c.key, path: c.path, file: c.file, reason: c.reason, message: c.message, later: c.later.map((l) => (l.pr ? `#${l.pr} ${l.title}` : `${l.id} ${l.title}`)), resolution: c.resolution, ...(c.current ? { now: c.current.css || c.current.value } : {}), ...(c.original.beforeCss ? { before: c.original.beforeCss } : {}) })),
  skipped: plan.skipped.map((s) => `${s.path} (${s.file}): ${s.reason}`),
  changes: plan.changes.map((c) => ({ kind: c.kind, path: c.path, file: c.file, before: c.beforeCss, after: c.afterCss })),
  contrast: { moved: plan.contrast.length, newFailures: plan.newFailures, sample: plan.contrast.slice(0, 8) },
  newErrors: plan.newErrors,
  branch: plan.branch,
  files: plan.files.map((f) => f.path),
  notes: plan.notes,
});

/** Dry run: what undoing a change (or restoring a token) takes, conflicts included. Writes nothing. */
export async function planRevertOp(ctx: BridgeContext, a: PlanArgs & { includeBody?: boolean }) {
  const plan = await buildPlan(ctx, a, 'Bridge MCP');
  return {
    ...planReport(plan),
    ...(a.includeBody !== false && plan.status !== 'nothing-to-do' ? { prBody: plan.prBody } : {}),
    next:
      plan.status === 'ready'
        ? plan.conflicts.length
          ? 'Conflicts are kept at their current value. To restore one anyway pass resolutions { "<key>": "use-before" } (or restoreConflicts: true), then bridge_propose_revert with the same arguments.'
          : 'bridge_propose_revert with the same arguments opens it as a branch or PR (never main).'
        : plan.status === 'blocked'
          ? 'Blocked: it would add validation errors or break a contrast pair. Bridge does not open it.'
          : 'Nothing to propose.',
  };
}

/** Plans, then commits to a new local bridge/* branch or opens a PR on a new bridge/* branch. Never main. */
export async function proposeRevert(ctx: BridgeContext, a: PlanArgs & { dryRun?: boolean; changes?: ChangesMode | undefined; source?: 'mcp' | 'cli' | undefined }) {
  const { config } = await ctx.config();
  const plan = await buildPlan(ctx, a, ctx.mode === 'local' ? 'the bridge CLI' : 'Bridge MCP');
  const report = planReport(plan);
  if (plan.status !== 'ready') return { ...report, hint: plan.status === 'blocked' ? 'Bridge never opens a change that breaks the gate.' : 'Nothing to propose.' };
  // Suggest mode: the revert's files in one suggestion issue, applied by a developer once approved.
  if ((await changesFor(ctx, a.changes)) === 'suggest') {
    const summary = plan.commitMessage.split('\n').slice(1).join('\n').trim() || plan.prTitle;
    const r = await fileSuggestion(
      ctx,
      (base, by) => filesSuggestionPayload(ctx, { kind: 'revert', title: plan.prTitle, summary, files: plan.files, tier: { tier: plan.tier.tier, bump: plan.tier.bump }, base, source: a.source ?? 'mcp', suggestedBy: by, checks: { newErrors: plan.newErrors.length } }),
      { labels: [plan.kind === 'revert' ? 'revert' : 'restore', ...(plan.tier.tier === 3 ? ['tokens'] : []), ...(plan.tier.bump === 'major' ? ['breaking'] : [])], details: plan.prBody, dryRun: a.dryRun },
    );
    if (r.status === 'dry-run') return { ...report, status: 'dry-run', changesMode: 'suggest', suggestion: r.suggestion, fileContents: plan.files };
    if (r.status === 'preview') return { ...report, status: 'preview', message: r.message, changesMode: 'suggest', fileContents: plan.files };
    return { ...report, status: 'suggested', changesMode: 'suggest', number: r.number, url: r.url, version: r.sha.slice(0, 7), labels: r.labels, ...(r.warnings.length ? { warnings: r.warnings } : {}), next: r.next };
  }
  if (a.dryRun) return { ...report, status: 'dry-run', prBody: plan.prBody, fileContents: plan.files };
  const prefix = config.governance.branchPrefix;
  let branch = plan.branch;
  if (ctx.mode === 'local') {
    if (!ctx.isGit) return { ...report, status: 'preview', message: 'Not a git repo: nothing written. Apply fileContents yourself.', prBody: plan.prBody, fileContents: plan.files };
    const protectedBranches = [...new Set([...protectedBranchesOf(config), baseBranchOf(config)])];
    for (let i = 2; await branchExists(ctx.root!, branch); i++) branch = `${plan.branch}-${i}`;
    const base = await currentBranch(ctx.root!);
    const res = await commitToNewLocalBranch(ctx.root!, { base: 'HEAD', branch, message: plan.commitMessage, files: plan.files, protectedBranches, branchPrefix: prefix });
    return {
      ...report,
      status: 'branch-created',
      branch,
      base,
      commit: res.sha,
      prBody: plan.prBody,
      next: `Your working tree is untouched. Review with \`git diff ${base}...${branch}\`; push it and open the PR with the body above when the design owner agrees.`,
    };
  }
  const gh = (await ctx.github())!;
  if (!ctx.canWriteRemote) return { ...report, status: 'preview', message: 'Read-only: set GITHUB_TOKEN to open this as a pull request.', prBody: plan.prBody, fileContents: plan.files };
  const base = ctx.ref ?? baseBranchOf(config);
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = `${plan.branch}-${i}`;
  const commit = await gh.commitToNewBranch({ base, branch, message: plan.commitMessage, files: plan.files });
  const draft = plan.tier.tier >= 2;
  const pr = await gh.createPullRequest({ base, head: branch, title: plan.prTitle, body: plan.prBody, draft });
  const labels = [...config.governance.labels, `tier: ${plan.tier.tier}`, plan.kind === 'revert' ? 'revert' : 'restore', ...(plan.tier.tier === 3 ? ['tokens'] : []), ...(plan.tier.bump === 'major' ? ['breaking'] : [])];
  await gh.addLabels(pr.number, labels);
  return { ...report, status: 'pr-opened', branch, commit: commit.sha, pr: pr.number, url: pr.url, labels, draft };
}
