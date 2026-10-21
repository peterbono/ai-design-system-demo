// A token change proposal: token edits checked like every Bridge write (no new validation error, no contrast pair that
// starts failing), tiered by the shared classifier, with the designer-friendly body and a changeset; then, on GitHub,
// either a new branch with one commit and a pull request (a draft from tier 2), labelled ("direct" mode), or a
// suggestion: an issue holding the exact edits that owners approve and a developer applies ("suggest" mode, see
// suggestions.ts). The MCP server (bridge_propose_token_change), the CLI (`bridge propose`) and Studio (a library
// branch for a product branch's missing token) all write it through these functions.
import type { BridgeConfig } from './config';
import type { GitHubClient } from './github-client';
import type { NeededBy } from './prod-branch';
import type { RequestSource } from './requests';
import { createSuggestionOnGitHub } from './suggestions-github';
import { gitBlobSha, SUGGESTION_SCHEMA, type SuggestionPayloadV1 } from './suggestions';
import { branchWithJiraKey, titleWithJiraKey } from './jira';
import { LayeredTokenSet, validateLayered, type LayerIssue } from './layered';
import { classifyLayered, composeProposalBody, contrastDelta, diffLayered, layeredImpact, runLayeredContrast, type ChangeTier, type ContrastDelta, type ImpactEntry, type LayeredChange } from './layered-review';
import { slugify } from './pr-composer';
import { applyTokenEdits, type TokenEdit } from './token-edits';
import type { ContrastPair } from './wcag';
import { formatChangeset } from './changeset';

export interface TokenProposalPlan {
  title: string;
  summary: string;
  /** The token edits the plan applied: what a suggestion stores and re-applies on the current tokens. */
  edits: TokenEdit[];
  before: LayeredTokenSet;
  after: LayeredTokenSet;
  changes: LayeredChange[];
  tier: ChangeTier;
  contrast: ContrastDelta[];
  newFailures: ContrastDelta[];
  newErrors: LayerIssue[];
  impact: { total: number; entries: ImpactEntry[] };
  notes: string[];
  /** Token files edited, as repo paths. */
  touched: string[];
  /** Every file the commit writes: the token files and the changeset. */
  files: { path: string; content: string | null }[];
  body: string;
  /** Branch slug from the title. */
  slug: string;
  /** Why it cannot be opened (new validation errors, failing contrast pairs), or null. */
  blocked: string | null;
}

const issueKey = (i: LayerIssue) => `${i.code}|${i.path ?? ''}|${i.file ?? ''}|${i.message}`;

/**
 * What a token change would do, without writing: the token diff, validation and contrast against `before`, the tier,
 * the body and the files. `blocked` says why it must not be opened. Null when the edits change nothing.
 */
export function planTokenProposal(input: {
  before: LayeredTokenSet;
  pairs: ContrastPair[];
  edits: TokenEdit[];
  title: string;
  summary?: string | undefined;
  config: BridgeConfig;
  /** "Bridge MCP", "Bridge Studio". */
  tool?: string | undefined;
  /** More body paragraphs, after the generated body (the product line, "Needed by"). */
  bodyExtra?: string[] | undefined;
}): TokenProposalPlan | null {
  const { before, config } = input;
  const r = applyTokenEdits(before, input.edits);
  const after = new LayeredTokenSet(before.config, r.files);
  const changes = diffLayered(before, after);
  if (!changes.length) return null;
  const prevErrors = new Set(validateLayered(before).map(issueKey));
  const newErrors = validateLayered(after).filter((i) => i.level === 'error' && !prevErrors.has(issueKey(i)));
  const modes = config.contrast?.modes;
  const contrast = input.pairs.length ? contrastDelta(runLayeredContrast(before, input.pairs, modes), runLayeredContrast(after, input.pairs, modes)) : [];
  const newFailures = contrast.filter((d) => d.passBefore && !d.passAfter);
  const impact = layeredImpact(before, after, changes);
  const tier = classifyLayered(changes, [], config);
  const summary = input.summary?.trim() || input.title;
  const body = [composeProposalBody({ summary, changes, contrast, impact, tier, validationErrors: newErrors.length, tool: input.tool ?? 'Bridge MCP' }), ...(input.bodyExtra ?? [])].filter(Boolean).join('\n\n');
  const slug = slugify(input.title, 48) || 'change';
  const changesetPath = `${config.changesets?.dir ?? '.changeset'}/bridge-${slug}.md`;
  const touched = r.touched.map((f) => after.repoPath(f));
  const files = [
    ...r.touched.map((f) => ({ path: after.repoPath(f), content: after.files.get(f)! as string | null })),
    ...(config.changesets ? [{ path: changesetPath, content: formatChangeset(config.changesets.package, tier.bump, summary) as string | null }] : []),
  ];
  const blocked = newErrors.length || newFailures.length ? [newErrors.length ? `${newErrors.length} new validation error(s)` : '', newFailures.length ? `${newFailures.length} contrast pair(s) would fail` : ''].filter(Boolean).join(' and ') : null;
  return { title: input.title, summary, edits: input.edits, before, after, changes, tier, contrast, newFailures, newErrors, impact, notes: r.notes, touched, files, body, slug, blocked };
}

export interface OpenedTokenProposal {
  branch: string;
  commit: string;
  pr: number;
  url: string;
  labels: string[];
  draft: boolean;
}

/**
 * Opens a planned token change on GitHub: a new branch from `base` (the agent prefix, the Jira key, -2, -3 when the name
 * is taken), one commit, a pull request (a draft from tier 2, until design review) and its labels. Refuses a blocked plan.
 */
export async function writeTokenProposalOnGitHub(
  gh: GitHubClient,
  plan: TokenProposalPlan,
  opts: {
    base: string;
    branchPrefix: string;
    jira?: string | null | undefined;
    /** Labels before the tier ones (governance.labels), and after them (the product label). */
    labels?: string[] | undefined;
    labelsAfter?: string[] | undefined;
    /** Who proposes it, in the commit message: "Bridge MCP (source: mcp)". */
    tool?: string | undefined;
  },
): Promise<OpenedTokenProposal> {
  if (plan.blocked) throw new Error(`Not opened: ${plan.blocked}. Bridge never opens a branch that breaks the gate.`);
  const jira = opts.jira ?? null;
  let branch = branchWithJiraKey(`${opts.branchPrefix}${plan.slug}`, jira);
  for (let i = 2; await gh.getBranchSha(branch).then(Boolean, () => false); i++) branch = branchWithJiraKey(`${opts.branchPrefix}${plan.slug}-${i}`, jira);
  const commit = await gh.commitToNewBranch({ base: opts.base, branch, message: `feat(tokens): ${plan.title}\n\nProposed through ${opts.tool ?? 'Bridge MCP'}. Tier ${plan.tier.tier}.`, files: plan.files });
  const labels = tokenLabels(plan, opts.labels, opts.labelsAfter);
  const draft = plan.tier.tier >= 2;
  const pr = await gh.createPullRequest({ base: opts.base, head: branch, title: titleWithJiraKey(`feat(tokens): ${plan.title}`, jira), body: plan.body, draft });
  await gh.addLabels(pr.number, labels);
  return { branch, commit: commit.sha, pr: pr.number, url: pr.url, labels, draft };
}

export interface SuggestedTokenProposal {
  status: 'suggested';
  /** The suggestion issue. */
  number: number;
  url: string;
  /** sha256 of the payload: what approvals bind to. */
  sha: string;
  labels: string[];
  /** Sentences about parts that did not go through (labels refused). The suggestion itself holds. */
  warnings: string[];
}

/** The labels of a token change, before and after the tier ones: the same on a pull request and a suggestion. */
const tokenLabels = (plan: Pick<TokenProposalPlan, 'tier'>, before: string[] = [], after: string[] = []) => [
  ...new Set([...before, `tier: ${plan.tier.tier}`, ...(plan.tier.tier === 3 ? ['tokens'] : []), ...(plan.tier.bump === 'major' ? ['breaking'] : []), ...after]),
];

/** The suggestion payload (bridge.suggestion/1) of a planned token change, computed on `base`. Pure. */
export function tokenSuggestionPayload(
  plan: TokenProposalPlan,
  ctx: {
    base: { ref: string; sha: string };
    source: RequestSource;
    suggestedBy?: string | undefined;
    createdAt?: string | undefined;
    links?: SuggestionPayloadV1['links'];
    previews?: SuggestionPayloadV1['previews'];
  },
): SuggestionPayloadV1 {
  // Token files are re-derived from the edits at apply time; only the other files (the changeset) are stored whole.
  const tokenFiles = new Set(plan.touched);
  const files = plan.files.filter((f) => !tokenFiles.has(f.path)).map((f) => ({ path: f.path, beforeSha: null, afterSha: f.content === null ? null : gitBlobSha(f.content), content: f.content }));
  return {
    schema: SUGGESTION_SCHEMA,
    kind: 'token-change',
    title: plan.title,
    summary: plan.summary,
    source: ctx.source,
    ...(ctx.suggestedBy ? { suggestedBy: ctx.suggestedBy.replace(/^@/, '') } : {}),
    createdAt: ctx.createdAt ?? new Date().toISOString(),
    base: ctx.base,
    tier: { tier: plan.tier.tier, bump: plan.tier.bump },
    tokens: {
      edits: plan.edits,
      changes: plan.changes.map((c) => ({ kind: c.kind, path: c.path, from: c.from, file: c.file, before: c.before, after: c.after, beforeCss: c.beforeCss, afterCss: c.afterCss })),
    },
    ...(files.length ? { files } : {}),
    checks: {
      newErrors: plan.newErrors.length,
      contrast: plan.contrast.map((d) => ({ pair: `${d.fg} on ${d.bg}`, mode: d.modes || undefined, before: d.before ?? 0, after: d.after ?? 0, min: d.min, pass: d.passAfter })),
      blocked: plan.blocked,
      impact: plan.impact.total,
    },
    ...(ctx.links ? { links: ctx.links } : {}),
    ...(ctx.previews?.length ? { previews: ctx.previews } : {}),
  };
}

/**
 * Files a planned token change as a suggestion (suggest mode): one issue with the readable change, the checks and the
 * exact edits, labelled like the pull request would be (tier, tokens, breaking), plus the suggestion labels. Needs
 * Issues write only: no branch, no commit, no pull request. Refuses a blocked plan, like writeTokenProposalOnGitHub.
 */
export async function suggestTokenProposalOnGitHub(
  gh: GitHubClient,
  plan: TokenProposalPlan,
  opts: {
    /** Default branch the plan was computed on. Its head commit is recorded as the suggestion's base. */
    base: string;
    source: RequestSource;
    /** GitHub login of who suggests it. */
    suggestedBy?: string | undefined;
    /** Labels before the tier ones (governance.labels), and after them (the product label). */
    labels?: string[] | undefined;
    labelsAfter?: string[] | undefined;
    /** The product branch that needs it (a missing piece). */
    neededBy?: NeededBy | undefined;
    /** The Figma origin, a suggestion it replaces. */
    links?: SuggestionPayloadV1['links'];
    previews?: SuggestionPayloadV1['previews'];
    assignees?: string[] | undefined;
    /** Commit sha of `base`, when the caller already read it (saves a call). */
    baseSha?: string | undefined;
  },
): Promise<SuggestedTokenProposal> {
  if (plan.blocked) throw new Error(`Not suggested: ${plan.blocked}. Bridge never suggests a change that breaks the gate.`);
  const sha = opts.baseSha ?? (await gh.getBranchSha(opts.base));
  if (!sha) throw new Error(`Branch ${opts.base} not found. Check the default branch in bridge.config.json.`);
  const links = opts.neededBy || opts.links ? { ...opts.links, ...(opts.neededBy ? { neededBy: opts.neededBy } : {}) } : undefined;
  const payload = tokenSuggestionPayload(plan, { base: { ref: opts.base, sha }, source: opts.source, suggestedBy: opts.suggestedBy, links, previews: opts.previews });
  const labels = tokenLabels(plan, opts.labels, opts.labelsAfter);
  const created = await createSuggestionOnGitHub(gh, payload, { labels, assignees: opts.assignees, details: plan.body });
  return { status: 'suggested', number: created.number, url: created.url, sha: created.sha, labels, warnings: created.warnings };
}
