// Pull and push orchestration, independent of the DOM and of figma.* (the UI wires it to both).

import type { FigmaSnapshot, PullPlan, RepoSettings, SyncState, VariableTag } from '../shared/messages';
import { type AcceptedChange, composeFiles } from './compose';
import { type ConflictChoice, type DiffEntry, type ThreeWayResult, threeWayDiff, toMap } from './diff-engine';
import { type CompareResult, GitHubClient, GitHubError, type PullRequest, type RepoFiles, loadRepoFiles } from './github-client';
import { type RenameSuggestion, applyConfirmedRenames, reconcileIds } from './id-map';
import { type FigmaReadResult, type Unmappable, buildPullPlan, isUnmappable, snapshotToTokens, tokenToPlanned } from './mapping';
import { branchName, commitMessage, composeChangeset, composePrBody, defaultTitle } from './pr-composer';
import { type TokenSet, buildTokenSet } from './token-set';
import type { LogicalToken, TokenMap } from './types';
import { type ProposalValidation, type TypeChange, validateProposal } from './validators';
import { type ContrastPair, parseContrastPairs } from './wcag';

export interface Analysis {
  settings: RepoSettings;
  headSha: string;
  headFiles: RepoFiles;
  head: TokenSet;
  baseSha: string | undefined;
  base: TokenSet | undefined;
  compare: CompareResult | undefined;
  figma: FigmaReadResult;
  figmaTokens: LogicalToken[];
  suggestions: RenameSuggestion[];
  diff: ThreeWayResult;
  pairs: ContrastPair[];
  /** Git tokens Figma variables cannot represent (shadows...). They are never touched. */
  codeOnly: Unmappable[];
  warnings: string[];
}

/** Tokens a Figma variable can represent. Others are left alone by both pull and push. */
export function mappableTokens(set: TokenSet): { map: TokenMap; codeOnly: Unmappable[] } {
  const map: TokenMap = new Map();
  const codeOnly: Unmappable[] = [];
  for (const t of set.tokens.values()) {
    const p = tokenToPlanned(t, set);
    if (isUnmappable(p)) codeOnly.push(p);
    else map.set(t.id, t);
  }
  return { map, codeOnly };
}

export async function analyze(
  client: GitHubClient,
  settings: RepoSettings,
  sync: SyncState,
  snapshot: FigmaSnapshot,
  confirmedRenames: RenameSuggestion[] = [],
): Promise<Analysis> {
  const warnings: string[] = [];
  const headSha = await client.getBranchSha(settings.branch);
  if (!headSha) throw new Error(`Branch "${settings.branch}" was not found in ${settings.repo}.`);
  const headFiles = await loadRepoFiles(client, headSha, settings.tokensPath);
  const head = buildTokenSet(headFiles.files);

  let base: TokenSet | undefined;
  let compare: CompareResult | undefined;
  const baseSha = sync.baseSha;
  if (baseSha && baseSha === headSha) {
    base = head;
  } else if (baseSha) {
    try {
      base = buildTokenSet((await loadRepoFiles(client, baseSha, settings.tokensPath)).files);
      compare = await client.compare(baseSha, headSha).catch(() => undefined);
    } catch (err) {
      if (!(err instanceof GitHubError && (err.status === 404 || err.status === 422))) throw err;
      warnings.push(`The commit this file was last pulled from (${baseSha.slice(0, 7)}) is gone from GitHub. Every difference is treated as a conflict until the next pull.`);
    }
  }

  const figma = snapshotToTokens(snapshot, head.layout, head);
  const headMappable = mappableTokens(head);
  const baseMappable = base ? mappableTokens(base) : undefined;
  const reconciled = reconcileIds(figma.tokens, [...(baseMappable?.map.values() ?? []), ...headMappable.map.values()]);
  const figmaTokens = applyConfirmedRenames(reconciled.tokens, confirmedRenames);
  // Variable ids follow the token ids the user confirmed or that were matched by name.
  const remapIds = new Map<string, string>();
  figma.tokens.forEach((t, i) => {
    const after = figmaTokens[i]!;
    if (after.id !== t.id) remapIds.set(t.id, after.id);
  });
  for (const [from, to] of remapIds) {
    const ids = figma.variableIds.get(from);
    if (ids) {
      figma.variableIds.delete(from);
      figma.variableIds.set(to, ids);
    }
  }
  const confirmedIds = new Set(confirmedRenames.map((s) => s.figmaId));
  const suggestions = reconciled.suggestions.filter((s) => !confirmedIds.has(s.figmaId));

  const diff = threeWayDiff(baseMappable?.map, toMap(figmaTokens), headMappable.map);
  return {
    settings,
    headSha,
    headFiles,
    head,
    baseSha: base ? baseSha : undefined,
    base,
    compare,
    figma,
    figmaTokens,
    suggestions,
    diff,
    pairs: parseContrastPairs(headFiles.contrastPairs),
    codeOnly: headMappable.codeOnly,
    warnings: [...warnings, ...figma.warnings, ...head.problems],
  };
}

// ---------------------------------------------------------------------------------------------
// Push

export interface PushProposal {
  changes: AcceptedChange[];
  /** Changed token files (relative to the tokens path). */
  files: Record<string, string>;
  proposed: TokenSet;
  validation: ProposalValidation;
  unresolvedConflicts: DiffEntry[];
  resolvedConflicts: { path: string; choice: ConflictChoice }[];
}

export function buildPush(a: Analysis, choices: Map<string, ConflictChoice>): PushProposal {
  const changes: AcceptedChange[] = [];
  const typeChanges: TypeChange[] = [];
  const unresolvedConflicts: DiffEntry[] = [];
  const resolvedConflicts: PushProposal['resolvedConflicts'] = [];
  const take = (e: DiffEntry) => {
    changes.push({ target: e.figma, current: e.head });
    const before = e.head ?? e.base;
    if (e.figma && before && e.figma.type !== before.type) typeChanges.push({ path: e.figma.path, from: before.type, to: e.figma.type });
  };
  a.diff.local.forEach(take);
  for (const c of a.diff.conflicts) {
    const choice = choices.get(c.id);
    if (!choice) unresolvedConflicts.push(c);
    else {
      resolvedConflicts.push({ path: c.path, choice });
      if (choice === 'figma') take(c);
    }
  }
  const { files, allFiles } = composeFiles(a.head, a.headFiles.files, changes);
  const proposed = buildTokenSet(allFiles);
  const validation = validateProposal(proposed, a.head, a.pairs, typeChanges);
  return { changes, files, proposed, validation, unresolvedConflicts, resolvedConflicts };
}

export interface PushOptions {
  title: string;
  notes: string;
  fileName: string;
  /** Append a commit to this open PR's branch instead of creating a new branch. */
  appendTo?: PullRequest | undefined;
  now?: Date;
}

export interface PushResult {
  pr: PullRequest;
  branch: string;
  commitSha: string;
  appended: boolean;
  /** Plugin data to store on variables so the next diff matches them by id. */
  tags: VariableTag[];
}

export async function openPullRequest(client: GitHubClient, a: Analysis, p: PushProposal, opts: PushOptions): Promise<PushResult> {
  if (p.unresolvedConflicts.length) throw new Error('Resolve every conflict before opening a pull request.');
  if (p.validation.blocking.length) throw new Error('Fix the blocking problems before opening a pull request.');
  if (!Object.keys(p.files).length) throw new Error('Nothing to send: the Figma variables match main.');
  const title = opts.title.trim() || defaultTitle(p.changes);
  const prefix = a.settings.tokensPath.replace(/^\/+|\/+$/g, '');
  const appended = !!opts.appendTo;
  const branch = opts.appendTo?.headRef ?? branchName(title, opts.now ?? new Date());
  const changeset = composeChangeset(p.changes, title, branch);
  const repoFiles = [
    ...Object.entries(p.files).map(([rel, content]) => ({ path: `${prefix}/${rel}`, content })),
    changeset,
  ];

  const parent = appended ? await client.getBranchSha(branch) : a.headSha;
  if (!parent) throw new Error(`Branch ${branch} no longer exists.`);
  const baseTree = await client.getCommitTree(parent);
  const blobs = [];
  for (const f of repoFiles) blobs.push({ path: f.path, sha: await client.createBlob(f.content) });
  const tree = await client.createTree(baseTree, blobs);
  const commitSha = await client.createCommit(commitMessage(title, p.changes), tree, [parent]);

  let pr: PullRequest;
  if (appended) {
    await client.updateBranch(branch, commitSha);
    pr = opts.appendTo!;
    await client.addComment(pr.number, `DS Bridge added a commit from Figma:\n\n${p.changes.map((c) => `- ${(c.target ?? c.current)!.path}`).join('\n')}`).catch(() => undefined);
  } else {
    await client.createBranch(branch, commitSha);
    const body = composePrBody({
      changes: p.changes,
      head: a.head,
      proposed: p.proposed,
      validation: p.validation,
      baseBranch: a.settings.branch,
      headSha: a.headSha,
      baseSha: a.baseSha,
      figmaFileName: opts.fileName,
      title,
      notes: opts.notes,
      upstreamPaths: a.diff.remote.map((e) => e.path),
      resolvedConflicts: p.resolvedConflicts,
    });
    try {
      pr = await client.createPullRequest({ title, head: branch, base: a.settings.branch, body, draft: true });
    } catch (err) {
      // Draft PRs are not available on every plan; fall back to a regular PR.
      if (err instanceof GitHubError && err.status === 422 && /draft/i.test(err.detail ?? '')) {
        pr = await client.createPullRequest({ title, head: branch, base: a.settings.branch, body, draft: false });
      } else throw err;
    }
    await client.addLabels(pr.number, ['tokens']);
  }

  const tags: VariableTag[] = [];
  for (const c of p.changes) {
    if (!c.target) continue;
    for (const variableId of a.figma.variableIds.get(c.target.id) ?? []) {
      tags.push({ variableId, pluginData: { id: c.target.id, dtcgType: c.target.type, file: c.target.tier === 'primitive' ? c.target.files.value : undefined } });
    }
  }
  return { pr, branch, commitSha, appended, tags };
}

// ---------------------------------------------------------------------------------------------
// Pull

export interface PullProposal {
  plan: PullPlan;
  skipped: Unmappable[];
  /** Local Figma edits a pull leaves in place (they are not on main yet). */
  kept: DiffEntry[];
  unresolvedConflicts: DiffEntry[];
}

export function buildPull(a: Analysis, choices: Map<string, ConflictChoice>): PullProposal {
  const keep = new Set(a.diff.local.map((e) => e.id));
  const unresolvedConflicts: DiffEntry[] = [];
  const orphans: string[] = [];
  for (const e of a.diff.remote) if (!e.head && e.figma) orphans.push(e.id);
  for (const c of a.diff.conflicts) {
    const choice = choices.get(c.id);
    if (!choice) {
      unresolvedConflicts.push(c);
      keep.add(c.id);
    } else if (choice === 'figma') keep.add(c.id);
    else if (!c.head && c.figma) orphans.push(c.id);
  }
  const apply = [...mappableTokens(a.head).map.keys()].filter((id) => !keep.has(id));
  const { plan, skipped } = buildPullPlan({
    head: a.head,
    headSha: a.headSha,
    apply,
    orphans,
    variableIds: a.figma.variableIds,
    variableNames: a.figma.variableNames,
  });
  return { plan, skipped, kept: a.diff.local, unresolvedConflicts };
}
