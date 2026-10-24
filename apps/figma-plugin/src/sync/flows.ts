// Pull and push orchestration for the Figma plugin: @bridge-ds/core logic plus the Figma mapping.
// Independent of the DOM and of figma.* (the UI wires it to both).

import type { FigmaSnapshot, PullPlan, RepoSettings, SyncState, VariableTag } from '../shared/messages';
import { type AcceptedChange, composeFiles } from '@bridge-ds/core';
import { type ConflictChoice, type DiffEntry, type ThreeWayResult, threeWayDiff, toMap } from '@bridge-ds/core';
import { type CompareResult, GitHubClient, GitHubError, type PullRequest, type RepoFiles, loadRepoFiles } from '@bridge-ds/core';
import { type RenameSuggestion, applyConfirmedRenames, reconcileIds, remoteRenames } from '@bridge-ds/core';
import { type FigmaReadResult, type Unmappable, buildPullPlan, isUnmappable, snapshotToTokens, tokenToPlanned } from './mapping';
import { branchName, changedModes, commitMessage, composeChangeset, composePrBody, defaultTitle } from '@bridge-ds/core';
import { type TokenSet, buildTokenSet, layoutOptions, loadConfig } from '@bridge-ds/core';
import { type LogicalToken, SINGLE_MODE, type ThemeOverride, type TokenMap, isMultiMode } from '@bridge-ds/core';
import { type ProposalValidation, type TypeChange, shadowedEdits, validateProposal } from '@bridge-ds/core';
import { CONTRAST_CHECKS_FILE, type ContrastPair, parseContrastChecks } from '@bridge-ds/core';
import { aliasTarget, isAlias } from '@bridge-ds/core';
import { type Issue, type NewBrandPlan, composeNewBrandBody, newBrandSection, planNewBrand, slugify } from '@bridge-ds/core';
import { type ChangesMode, type SuggestionPayloadV1, type TokenEdit, SUGGESTION_SCHEMA, changesMode, createSuggestionOnGitHub, gitBlobSha, planTokenProposal, suggestTokenProposalOnGitHub } from '@bridge-ds/core';
import { libraryTokens } from './component-push';

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
  /** Brand x theme overrides of semantic tokens. Figma has no brand x theme mode: they stay code-only. */
  overrides: ThemeOverride[];
  /** Brand modes in Figma with no brand file in Git: each can become a new brand in the pull request. */
  newBrands: NewBrandCandidate[];
  warnings: string[];
}

export interface NewBrandCandidate {
  /** Figma mode name ("Acme"). */
  name: string;
  /** Brand slug the file would get ("acme" -> brands/acme.tokens.json). */
  slug: string;
  modeKey: string;
  /** Brand token path -> value in that mode, as planNewBrand overrides. */
  values: Record<string, unknown>;
  /** Why it cannot be created from here (no bridge.config.json). Undefined when it can. */
  blocked?: string | undefined;
}

/** A new brand candidate in a push: included or not, and the core plan when included. */
export interface PushBrand {
  candidate: NewBrandCandidate;
  included: boolean;
  plan?: NewBrandPlan | undefined;
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
  // bridge.config.json in the repo (when present) decides the tokens root, tier folders and mode order.
  const headFiles = await loadRepoFiles(client, headSha, settings.tokensPath);
  warnings.push(...headFiles.warnings);
  const layout = headFiles.config ? layoutOptions(headFiles.config) : {};
  const head = buildTokenSet(headFiles.files, layout);

  let base: TokenSet | undefined;
  let compare: CompareResult | undefined;
  const baseSha = sync.baseSha;
  if (baseSha && baseSha === headSha) {
    base = head;
  } else if (baseSha) {
    try {
      base = buildTokenSet((await loadRepoFiles(client, baseSha, settings.tokensPath)).files, layout);
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

  // Tokens the code renamed since the last pull: their Figma variable is the renamed token, so the pull renames it in
  // place and everything bound to it keeps its binding (instead of an orphan and a new variable).
  let baseForDiff = baseMappable?.map;
  if (baseForDiff) {
    for (const { from, to } of remoteRenames(baseForDiff, headMappable.map)) {
      const i = figmaTokens.findIndex((t) => t.id === from.id);
      if (i < 0) continue;
      figmaTokens[i] = { ...figmaTokens[i]!, id: to.id };
      baseForDiff = new Map(baseForDiff);
      baseForDiff.delete(from.id);
      baseForDiff.set(to.id, { ...from, id: to.id });
      const ids = figma.variableIds.get(from.id);
      if (ids) {
        figma.variableIds.delete(from.id);
        figma.variableIds.set(to.id, ids);
      }
    }
  }
  const diff = threeWayDiff(baseForDiff, toMap(figmaTokens), headMappable.map);
  const pairs = parseContrastChecks(headFiles.contrastChecks);
  if (!pairs.length) {
    const checks = headFiles.config?.tokens.contrastChecks ?? CONTRAST_CHECKS_FILE;
    warnings.push(`${checks} is missing from ${headFiles.tokensPath} or lists no pairs, so contrast is not checked.`);
  }
  if (head.overrides.length) {
    const files = [...new Set(head.overrides.map((o) => o.file))].join(', ');
    warnings.push(
      `${head.overrides.length} brand theme override(s) (${files}) stay code-only: Figma shows the shared semantic value for every brand. Contrast checks still use them.`,
    );
  }
  const newBrands: NewBrandCandidate[] = figma.extraBrandModes.map((m) => ({
    name: m.name,
    slug: slugify(m.name, 24),
    modeKey: m.modeKey,
    values: m.values,
    blocked: headFiles.config ? undefined : `This repo has no bridge.config.json, so Bridge cannot list a new brand in it. Add the config (bridge init), or create brands/${slugify(m.name, 24)}.tokens.json in code.`,
  }));
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
    pairs,
    codeOnly: headMappable.codeOnly,
    overrides: head.overrides,
    newBrands,
    warnings: [...warnings, ...figma.warnings, ...head.problems],
  };
}

// ---------------------------------------------------------------------------------------------
// Push

export interface PushProposal {
  changes: AcceptedChange[];
  /** Changed token files (relative to the tokens path). */
  files: Record<string, string>;
  /** New brand candidates and, for included ones, their plan. */
  brands: PushBrand[];
  /** Repo-relative files new brands add or modify (brand files, bridge.config.json, their changesets). */
  brandFiles: { path: string; content: string }[];
  proposed: TokenSet;
  validation: ProposalValidation;
  unresolvedConflicts: DiffEntry[];
  resolvedConflicts: { path: string; choice: ConflictChoice }[];
  /** Figma edits the designer unchecked: not in the pull request, kept in Figma for a later push. */
  held: DiffEntry[];
}

/**
 * Plans the included new brands with the same core planner as the CLI, the MCP server and the Studio. A new
 * brand is Tier 3 and edits bridge.config.json (a guardrail), so it is opt-in: a designer adding a mode to try
 * an idea must not turn every push into a brand proposal. Excluded candidates only leave a warning.
 */
export function planBrands(a: Analysis, included: ReadonlySet<string>): { brands: PushBrand[]; files: { path: string; content: string }[]; blocking: Issue[]; warnings: Issue[] } {
  const brands: PushBrand[] = [];
  const files = new Map<string, string>();
  const blocking: Issue[] = [];
  const warnings: Issue[] = [];
  let configText = a.headFiles.configText;
  let config = a.headFiles.config;
  let tokenFiles: Record<string, string> = a.headFiles.files;
  for (const candidate of a.newBrands) {
    const on = included.has(candidate.slug) && !candidate.blocked;
    if (!on || !config) {
      brands.push({ candidate, included: false });
      warnings.push({ code: 'file-problem', severity: 'warning', message: candidate.blocked ?? `Mode "${candidate.name}" in the Brand collection has no brand file in Git. It stays in Figma until you create it as a new brand.` });
      continue;
    }
    // Several new brands in one push stack: each plans on top of the previous one's config and files.
    const plan = planNewBrand(
      { config, configText, files: tokenFiles, contrastText: a.headFiles.contrastChecks },
      { slug: candidate.slug, name: candidate.name, from: config.modes.defaults.brand ?? config.modes.brands[0] ?? 'blank', overrides: candidate.values },
    );
    brands.push({ candidate, included: true, plan });
    for (const i of plan.issues) (i.level === 'error' ? blocking : warnings).push({ code: 'file-problem', severity: i.level, message: `New brand ${candidate.name}: ${i.message}`, path: i.path });
    for (const r of plan.contrast.failing.slice(0, 10)) {
      const theme = /theme=([^,]+)/.exec(r.modes)?.[1] ?? r.modes;
      blocking.push({ code: 'contrast', severity: 'error', message: `New brand ${candidate.name}, ${theme}: ${r.fg} on ${r.bg} is ${r.ratio ?? 'n/a'}:1, needs ${r.min}:1.`, path: r.fg });
    }
    if (plan.contrast.failing.length > 10) blocking.push({ code: 'contrast', severity: 'error', message: `New brand ${candidate.name}: ${plan.contrast.failing.length - 10} more pairs fail.` });
    for (const f of plan.files) files.set(f.path, f.content);
    configText = plan.configText;
    tokenFiles = plan.tokenFiles;
    try {
      config = loadConfig(plan.configText);
    } catch {
      /* the plan already reports config problems */
    }
  }
  return { brands, files: [...files].map(([path, content]) => ({ path, content })), blocking, warnings };
}

/** `hold`: token ids the designer unchecked in the Changes list. They stay in Figma and out of the pull request. */
export function buildPush(a: Analysis, choices: Map<string, ConflictChoice>, includeBrands: ReadonlySet<string> = new Set(), hold: ReadonlySet<string> = new Set()): PushProposal {
  const changes: AcceptedChange[] = [];
  const held: DiffEntry[] = [];
  const typeChanges: TypeChange[] = [];
  const unresolvedConflicts: DiffEntry[] = [];
  const resolvedConflicts: PushProposal['resolvedConflicts'] = [];
  const take = (e: DiffEntry) => {
    changes.push({ target: e.figma, current: e.head });
    const before = e.head ?? e.base;
    if (e.figma && before && e.figma.type !== before.type) typeChanges.push({ path: e.figma.path, from: before.type, to: e.figma.type });
  };
  for (const e of a.diff.local) (hold.has(e.id) ? held.push(e) : take(e));
  for (const c of a.diff.conflicts) {
    if (hold.has(c.id)) {
      held.push(c);
      continue;
    }
    const choice = choices.get(c.id);
    if (!choice) unresolvedConflicts.push(c);
    else {
      resolvedConflicts.push({ path: c.path, choice });
      if (choice === 'figma') take(c);
    }
  }
  const { files, allFiles } = composeFiles(a.head, a.headFiles.files, changes);
  const proposed = buildTokenSet(allFiles, a.head.options);
  const validation = validateProposal(proposed, a.head, a.pairs, typeChanges);
  const edits = changes
    .filter((c) => c.target)
    .map((c) => ({ path: c.target!.path, tier: c.target!.tier, modes: [...(changedModes(c) ?? Object.keys(c.target!.values))] }));
  validation.warnings.push(...shadowedEdits(proposed, edits));
  const nb = planBrands(a, includeBrands);
  validation.blocking.push(...nb.blocking);
  validation.warnings.push(...nb.warnings);
  return { changes, files, brands: nb.brands, brandFiles: nb.files, proposed, validation, unresolvedConflicts, resolvedConflicts, held };
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
  if (p.unresolvedConflicts.length) throw new Error('Resolve every conflict before you request review.');
  if (p.validation.blocking.length) throw new Error('Fix the blocking problems before you request review.');
  if (!Object.keys(p.files).length && !p.brandFiles.length) throw new Error('Nothing to send: the Figma variables match main.');
  const plans = p.brands.flatMap((b) => (b.plan ? [b.plan] : []));
  const title = opts.title.trim() || (p.changes.length ? defaultTitle(p.changes) : plans.map((x) => x.title).join(', '));
  const prefix = a.headFiles.tokensPath;
  const appended = !!opts.appendTo;
  const branch = opts.appendTo?.headRef ?? branchName(title, opts.now ?? new Date());
  // A changeset only when the repo's bridge.config.json names the package to bump.
  const pkg = a.headFiles.config?.changeset?.package;
  // Token edits get their changeset; each new brand brings its own (minor) one, under another name.
  const changeset = pkg && p.changes.length ? composeChangeset(p.changes, { title, branch, packageName: pkg, source: 'from Figma via Bridge' }) : undefined;
  const repoFiles = [...Object.entries(p.files).map(([rel, content]) => ({ path: `${prefix}/${rel}`, content })), ...(changeset ? [changeset] : []), ...p.brandFiles];

  const parent = appended ? await client.getBranchSha(branch) : a.headSha;
  if (!parent) throw new Error(`Branch ${branch} no longer exists.`);
  const baseTree = await client.getCommitTree(parent);
  const blobs = [];
  for (const f of repoFiles) blobs.push({ path: f.path, sha: await client.createBlob(f.content) });
  const tree = await client.createTree(baseTree, blobs);
  const message = p.changes.length ? commitMessage(title, p.changes, 'Exported from Figma with Bridge.') : `${title}\n\n${plans.map((x) => `New brand ${x.name} (${x.slug}) from a Figma Brand mode.`).join('\n')}\n\nExported from Figma with Bridge.`;
  const commitSha = await client.createCommit(message, tree, [parent]);

  let pr: PullRequest;
  if (appended) {
    await client.updateBranch(branch, commitSha);
    pr = opts.appendTo!;
    const lines = [...p.changes.map((c) => `- ${(c.target ?? c.current)!.path}`), ...plans.map((x) => `- New brand ${x.name} (\`${x.slug}\`)`)];
    await client.addComment(pr.number, `Bridge added a commit from Figma:\n\n${lines.join('\n')}`).catch(() => undefined);
  } else {
    await client.createBranch(branch, commitSha);
    const origin = {
      tool: 'the Bridge Figma plugin',
      surface: 'Figma',
      location: opts.fileName,
      authoredBy: 'Human designer in Figma, via the Bridge plugin (no AI involved in the values)',
    };
    const tokenBody = () => composePrBody({
      changes: p.changes,
      head: a.head,
      proposed: p.proposed,
      validation: p.validation,
      baseBranch: a.settings.branch,
      headSha: a.headSha,
      baseSha: a.baseSha,
      origin,
      title,
      notes: opts.notes,
      upstreamPaths: a.diff.remote.map((e) => e.path),
      resolvedConflicts: p.resolvedConflicts,
    });
    // A push that only adds brands gets the brand body; token edits plus brands get one New brand section each.
    const body = p.changes.length
      ? [tokenBody(), ...plans.map(newBrandSection)].join('\n\n')
      : plans.map((x, i) => (i === 0 ? composeNewBrandBody(x, { tool: `${origin.tool} (${origin.location})`, notes: opts.notes }) : newBrandSection(x))).join('\n\n');
    // Token values from Figma count as design-approved (docs/BUILD-REQUESTS.md): ready for review, so they ship once the
    // checks pass. A new brand (Tier 3) still opens as a draft for its reviews.
    try {
      pr = await client.createPullRequest({ title, head: branch, base: a.settings.branch, body, draft: plans.length > 0 });
    } catch (err) {
      // Draft PRs are not available on every plan; fall back to a regular PR.
      if (err instanceof GitHubError && err.status === 422 && /draft/i.test(err.detail ?? '')) {
        pr = await client.createPullRequest({ title, head: branch, base: a.settings.branch, body, draft: false });
      } else throw err;
    }
    await client.addLabels(pr.number, plans.length ? ['tokens', 'tier: 3', 'source: figma'] : ['tokens', 'source: figma']);
  }

  const tags: VariableTag[] = [];
  for (const c of p.changes) {
    if (!c.target) continue;
    for (const variableId of a.figma.variableIds.get(c.target.id) ?? []) {
      tags.push({ variableId, pluginData: { id: c.target.id, dtcgType: c.target.type, file: isMultiMode(c.target.tier) ? undefined : c.target.files[SINGLE_MODE] } });
    }
  }
  return { pr, branch, commitSha, appended, tags };
}

// ---------------------------------------------------------------------------------------------
// Push to an exploration: the checked variable edits as one commit on `explore/<slug>` (its draft pull request is the
// place, never a new pull request to main). The edits are composed again on the exploration's own token files, so
// earlier commits there are kept, and files that already hold the same content are left alone.

export interface ExplorationTarget {
  /** `explore/<slug>`. */
  branch: string;
  /** Its draft pull request. */
  pr: PullRequest;
}

export interface ExplorationPushResult extends PushResult {
  /** The exploration already had these edits: nothing was committed. */
  unchanged: boolean;
}

export async function commitToExploration(client: GitHubClient, a: Analysis, p: PushProposal, opts: { target: ExplorationTarget; title: string; notes: string; now?: Date }): Promise<ExplorationPushResult> {
  if (p.unresolvedConflicts.length) throw new Error('Resolve every conflict before sending.');
  if (p.validation.blocking.length) throw new Error('Fix the blocking problems before sending.');
  const { branch, pr } = opts.target;
  const tip = await client.getBranchSha(branch);
  if (!tip) throw new Error(`The exploration ${branch} is gone. Pick another one, or start a new one.`);
  const there = await loadRepoFiles(client, tip, a.settings.tokensPath);
  const config = there.config ?? a.headFiles.config;
  const set = buildTokenSet(there.files, config ? layoutOptions(config) : a.head.options);
  const onBranch = (t: LogicalToken | undefined) => (t ? (set.tokens.get(t.id) ?? set.byPath.get(t.path)) : undefined);
  const changes: AcceptedChange[] = [];
  for (const c of p.changes) {
    const current = onBranch(c.current) ?? onBranch(c.target);
    if (!c.target && !current) continue; // already removed there
    changes.push({ target: c.target, current });
  }
  const { files } = composeFiles(set, there.files, changes);
  const prefix = there.tokensPath;
  const plans = p.brands.flatMap((b) => (b.plan ? [b.plan] : []));
  const title = opts.title.trim() || (p.changes.length ? defaultTitle(p.changes) : plans.map((x) => x.title).join(', '));
  const tokenFiles = Object.entries(files)
    .filter(([rel, content]) => there.files[rel] !== content)
    .map(([rel, content]) => ({ path: `${prefix}/${rel}`, content }));
  const pkg = config?.changeset?.package;
  const changeset = pkg && tokenFiles.length && p.changes.length ? composeChangeset(p.changes, { title, branch, packageName: pkg, source: 'from Figma via Bridge' }) : undefined;
  const repoFiles = [...tokenFiles, ...(changeset ? [changeset] : []), ...p.brandFiles];
  const tags: VariableTag[] = [];
  for (const c of p.changes) {
    if (!c.target) continue;
    for (const variableId of a.figma.variableIds.get(c.target.id) ?? []) {
      tags.push({ variableId, pluginData: { id: c.target.id, dtcgType: c.target.type, file: isMultiMode(c.target.tier) ? undefined : c.target.files[SINGLE_MODE] } });
    }
  }
  if (!tokenFiles.length && !p.brandFiles.length) return { pr, branch, commitSha: tip, appended: true, tags, unchanged: true };
  const baseTree = await client.getCommitTree(tip);
  const blobs = [];
  for (const f of repoFiles) blobs.push({ path: f.path, sha: await client.createBlob(f.content) });
  const tree = await client.createTree(baseTree, blobs);
  const message = `${p.changes.length ? commitMessage(title, p.changes, 'Exported from Figma with Bridge.') : title}\n\nExploration ${branch}: not merged as is.`;
  const commitSha = await client.createCommit(message, tree, [tip]);
  await client.updateBranch(branch, commitSha);
  const lines = [...p.changes.map((c) => `- ${(c.target ?? c.current)!.path}`), ...plans.map((x) => `- New brand ${x.name} (\`${x.slug}\`)`)];
  const why = opts.notes.trim();
  await client.addComment(pr.number, `Bridge added a commit from Figma to this exploration:\n\n${lines.join('\n')}${why ? `\n\n${why}` : ''}`).catch(() => undefined);
  return { pr, branch, commitSha, appended: true, tags, unchanged: false };
}

// ---------------------------------------------------------------------------------------------
// Pull

export interface PullProposal {
  plan: PullPlan;
  skipped: Unmappable[];
  /** Local Figma edits a pull leaves in place (they are not on main yet). */
  kept: DiffEntry[];
  /** Variables deleted in Figma that a pull recreates: other tokens still point to them, so the deletion cannot stand. */
  restored: DiffEntry[];
  unresolvedConflicts: DiffEntry[];
}

/** Ids of tokens that another token aliases, in any mode. */
function aliasTargetIds(set: TokenSet): Set<string> {
  const out = new Set<string>();
  for (const t of set.tokens.values())
    for (const v of Object.values(t.values)) {
      if (!isAlias(v)) continue;
      const target = set.byPath.get(aliasTarget(v));
      if (target) out.add(target.id);
    }
  return out;
}

/**
 * Commits on the branch since the file's last pull: 0 when the file is at the branch head (or was never pulled). When
 * GitHub could not compare the two, at least 1, since the head moved.
 */
export function commitsBehind(a: Pick<Analysis, 'baseSha' | 'headSha' | 'compare'>): number {
  if (!a.baseSha || a.baseSha === a.headSha) return 0;
  return Math.max(1, a.compare?.aheadBy ?? 0);
}

/**
 * The Pull headline. "Already up to date" only when the file was pulled from the branch head: commits on main that
 * change nothing in Figma still say how many there are, and the screen offers the pull so the file catches up.
 */
export function pullHeadline(o: { baseSha: string | undefined; variablesUpToDate: boolean; behind: number; status: string[] }): string {
  // Designer words: "the design system", never the branch name or a commit.
  const changes = o.behind ? `${o.behind} new ${o.behind === 1 ? 'change' : 'changes'} in the design system` : '';
  if (!o.baseSha) return 'First time in this file';
  if (!o.variablesUpToDate) return o.status.join(', ') || changes || 'Already up to date';
  if (o.behind) return [changes, ...o.status].join(', ');
  return o.status.length ? `Up to date with the design system. ${o.status.join(', ')}.` : 'Already up to date';
}

/** `overwrite`: main wins over every Figma edit to a token that exists on main (Figma-only variables stay). */
export function buildPull(a: Analysis, choices: Map<string, ConflictChoice>, opts: { overwrite?: boolean } = {}): PullProposal {
  // A variable deleted in Figma stays deleted (a push proposes it) unless other tokens still alias it: keeping that
  // deletion leaves aliases with no target and a push that would break them. Those are recreated.
  // A file with no synced variable left (collections deleted) starts over like a first pull.
  const referenced = aliasTargetIds(a.head);
  const inFigma = new Set(a.figmaTokens.map((t) => t.path));
  const emptied = a.figmaTokens.length === 0;
  const brokenAlias = (t: LogicalToken | undefined) => !!t && Object.values(t.values).some((v) => isAlias(v) && !inFigma.has(aliasTarget(v)));
  // A mode with no value in Figma that has one in Git: an alias that could not be set (or whose target is gone).
  const lostValue = (e: DiffEntry) => !!e.figma && !!e.base && Object.keys(e.base.values).some((m) => e.figma!.values[m] === undefined);
  const restored = a.diff.local.filter((e) => e.head && (emptied || opts.overwrite || (!e.figma && referenced.has(e.id)) || brokenAlias(e.figma) || lostValue(e)));
  const restoredIds = new Set(restored.map((e) => e.id));
  const kept = a.diff.local.filter((e) => !restoredIds.has(e.id));
  const keep = new Set(kept.map((e) => e.id));
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
  return { plan, skipped, kept, restored, unresolvedConflicts };
}

// ---------------------------------------------------------------------------------------------
// Push as a suggestion ("changes": "suggest" in bridge.config.json, the default): the checked variable edits become a
// token suggestion (an issue holding the exact edits, owners approve, a developer applies), new brands a brand
// suggestion. Issues write only: no branch, no commit, no pull request.

/**
 * How this repo takes changes: bridge.config.json "changes" (absent: "suggest"). A repo with no bridge.config.json
 * stays "direct": a suggestion is applied against the config, so there would be nothing to apply it with.
 */
export function changesModeOf(a: Pick<Analysis, 'headFiles'>): ChangesMode {
  return a.headFiles.config ? changesMode(a.headFiles.config) : 'direct';
}

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/**
 * The checked variable edits as semantic token edits (set, add, remove, rename per token file), what a suggestion
 * stores and a developer re-applies on the current tokens. Pure.
 */
export function tokenEditsOf(changes: AcceptedChange[]): TokenEdit[] {
  const out: TokenEdit[] = [];
  for (const { target, current } of changes) {
    if (!target && current) {
      for (const file of new Set(Object.values(current.files))) out.push({ op: 'remove', path: current.path, file });
      continue;
    }
    if (!target) continue;
    if (!current) {
      const byFile = new Map<string, string>();
      for (const m of Object.keys(target.values)) byFile.set(target.files[m] ?? '', m);
      for (const [file, m] of byFile) out.push({ op: 'add', path: target.path, value: target.values[m], type: target.type, ...(target.description ? { description: target.description } : {}), ...(file ? { file } : {}) });
      continue;
    }
    if (current.path !== target.path) out.push({ op: 'rename', path: current.path, newPath: target.path });
    const described = (target.description ?? '') !== (current.description ?? '');
    const typed = target.type !== current.type;
    const done = new Set<string>();
    for (const m of Object.keys(target.values)) {
      const file = current.files[m] ?? target.files[m];
      if (!file || done.has(file)) continue;
      const known = Object.values(current.files).includes(file);
      if (!known) {
        done.add(file);
        out.push({ op: 'add', path: target.path, value: target.values[m], type: target.type, ...(target.description ? { description: target.description } : {}), file });
        continue;
      }
      if (!same(target.values[m], current.values[m]) || described || typed) {
        done.add(file);
        out.push({ op: 'set', path: target.path, value: target.values[m], ...(typed ? { type: target.type } : {}), ...(described ? { description: target.description ?? '' } : {}), file });
      }
    }
    for (const [m, file] of Object.entries(current.files)) if (!(m in target.values) && !done.has(file)) out.push({ op: 'remove', path: target.path, file });
  }
  return out;
}

export interface SuggestOptions {
  title: string;
  notes: string;
  fileName: string;
  fileKey?: string | undefined;
  /** GitHub login of the designer. */
  suggestedBy?: string | undefined;
  now?: Date | undefined;
}

export interface SentSuggestion {
  kind: 'token-change' | 'brand';
  number: number;
  url: string;
  title: string;
}

export interface SuggestResult {
  suggestions: SentSuggestion[];
  /** Plugin data to store on variables so the next diff matches them by id. */
  tags: VariableTag[];
}

function variableTags(a: Analysis, p: PushProposal): VariableTag[] {
  const tags: VariableTag[] = [];
  for (const c of p.changes) {
    if (!c.target) continue;
    for (const variableId of a.figma.variableIds.get(c.target.id) ?? []) {
      tags.push({ variableId, pluginData: { id: c.target.id, dtcgType: c.target.type, file: isMultiMode(c.target.tier) ? undefined : c.target.files[SINGLE_MODE] } });
    }
  }
  return tags;
}

/** The Figma file, for a suggestion's links (no node: variables live in the file, not on a node). */
const fileLink = (opts: Pick<SuggestOptions, 'fileKey'>) => (opts.fileKey ? { figma: { fileKey: opts.fileKey, url: `https://www.figma.com/design/${opts.fileKey}/` } } : undefined);

/** The checked variable edits as a token suggestion, and each included new brand as a brand suggestion. */
export async function sendSuggestion(client: GitHubClient, a: Analysis, p: PushProposal, opts: SuggestOptions): Promise<SuggestResult> {
  if (p.unresolvedConflicts.length) throw new Error('Resolve every conflict before you send a suggestion.');
  if (p.validation.blocking.length) throw new Error('Fix the blocking problems before you send a suggestion.');
  if (!Object.keys(p.files).length && !p.brandFiles.length) throw new Error('Nothing to send: the Figma variables match main.');
  const lib = libraryTokens(a.headFiles);
  if (!lib) throw new Error('This repo has no bridge.config.json, so Bridge cannot send a suggestion. Add the config (bridge init).');
  const plans = p.brands.flatMap((b) => (b.plan ? [b.plan] : []));
  const title = opts.title.trim() || (p.changes.length ? defaultTitle(p.changes) : plans.map((x) => x.title).join(', '));
  const origin = `Sent from Figma (${opts.fileName || 'a Figma file'}) with the Bridge plugin. A human designer set these values; no AI involved.`;
  const out: SentSuggestion[] = [];
  if (p.changes.length) {
    const plan = planTokenProposal({ before: lib.before, pairs: a.pairs, edits: tokenEditsOf(p.changes), title, summary: opts.notes, config: lib.config, tool: 'the Bridge Figma plugin', bodyExtra: [origin] });
    if (plan) {
      const links = fileLink(opts);
      const r = await suggestTokenProposalOnGitHub(client, plan, { base: a.settings.branch, baseSha: a.headSha, source: 'figma', suggestedBy: opts.suggestedBy, labelsAfter: ['source: figma'], ...(links ? { links } : {}) });
      out.push({ kind: 'token-change', number: r.number, url: r.url, title });
    }
  }
  for (const plan of plans) {
    const files = brandFilesOf(a, p, plan);
    const links = fileLink(opts);
    const payload: SuggestionPayloadV1 = {
      schema: SUGGESTION_SCHEMA,
      kind: 'brand',
      title: plan.title,
      summary: opts.notes.trim() || `New brand ${plan.name} (${plan.slug}) from a Figma Brand mode.`,
      source: 'figma',
      ...(opts.suggestedBy ? { suggestedBy: opts.suggestedBy.replace(/^@/, '') } : {}),
      createdAt: (opts.now ?? new Date()).toISOString(),
      base: { ref: a.settings.branch, sha: a.headSha },
      tier: { tier: 3, bump: 'minor' },
      files,
      checks: { newErrors: plan.issues.filter((i) => i.level === 'error').length, contrast: [], blocked: null, impact: 0 },
      ...(links ? { links } : {}),
    };
    const r = await createSuggestionOnGitHub(client, payload, { labels: ['tokens'], details: newBrandSection(plan) });
    out.push({ kind: 'brand', number: r.number, url: r.url, title: plan.title });
  }
  if (!out.length) throw new Error('Nothing to send: the Figma variables match main.');
  return { suggestions: out, tags: variableTags(a, p) };
}

/** The whole files of one new brand, with the git blob sha of each file on main (null: a new file). */
function brandFilesOf(a: Analysis, p: PushProposal, plan: NewBrandPlan): SuggestionPayloadV1['files'] {
  const prefix = `${a.headFiles.tokensPath}/`;
  const mine = new Set(plan.files.map((f) => f.path));
  return p.brandFiles
    .filter((f) => mine.has(f.path))
    .map((f) => {
      const before = f.path === 'bridge.config.json' ? a.headFiles.configText : f.path.startsWith(prefix) ? a.headFiles.files[f.path.slice(prefix.length)] : undefined;
      return { path: f.path, beforeSha: before === undefined ? null : gitBlobSha(before), afterSha: gitBlobSha(f.content), content: f.content };
    });
}

