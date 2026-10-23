// Governance rules for the Reviews section, as pure functions so they are unit tested and shared by the page
// script. Same rules as docs/GOVERNANCE.md: the highest tier wins, Tier 2 and 3 need a design and a tech approval,
// nothing merges while CI fails. Who may ship (merge, which publishes to the products) comes from
// `governance.rights` in bridge.config.json (@bridge-ds/core rights.ts); GitHub write access is checked as well.

import type { StatusTone } from './changes';
import {
  allowedMergeMethods,
  approverLists,
  branchVerdict,
  isActiveExploration,
  canOverride,
  canShip,
  CONFLICT_REASON,
  DEFAULT_OVERRIDE,
  hasWriteAccess,
  holdersOf,
  mergeGate,
  openPulls,
  OVERRIDE_HEADING,
  overrideComment,
  overrideReasonProblem,
  overrideRefusedComment,
  parseOverrideComment,
  parseTier,
  pullState,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_ORDER,
  reviewStatusKind,
  shipPolicy,
  summarizeApprovals,
  summarizeCi,
  whoCanShipSentence,
  type ApprovalSummary,
  type BranchVerdict,
  type CiRunLike,
  type CiState,
  type CiStatusLike,
  type CiSummary,
  type LabelLike,
  type MergeGate,
  type MergeMethod,
  type MissingApproval,
  type OverridePolicy,
  type OverrideRecord,
  type PullState,
  type PullStateLike,
  type ReviewLike,
  type ReviewStatusKind,
  type RiskTier,
  type ShipPolicy,
  type SiteRepo,
  type TeamStates,
} from '@bridge-ds/core';

// Shared with Reviews, Settings and the PR status chips: who approves, who ships, and the sentence a blocked viewer reads.
export { approverLists, canShip, holdersOf, shipPolicy, whoCanShipSentence, type ShipPolicy };

export type Tier = RiskTier;

// The rules themselves live in @bridge-ds/core (review-gate.ts), shared with the MCP server and the CLI, so a merge
// from Claude or the terminal passes the same gate as the Merge button.
export {
  allowedMergeMethods,
  canOverride,
  CONFLICT_REASON,
  hasWriteAccess as canWrite,
  mergeGate,
  openPulls,
  OVERRIDE_HEADING,
  overrideComment,
  overrideReasonProblem,
  overrideRefusedComment,
  parseOverrideComment,
  parseTier,
  pullState,
  summarizeApprovals,
  summarizeCi,
  DEFAULT_OVERRIDE as NO_OVERRIDE,
};
export type {
  ApprovalSummary,
  CiRunLike as CheckRunLike,
  CiState,
  CiStatusLike as StatusLike,
  CiSummary,
  LabelLike,
  MergeGate,
  MergeMethod,
  MissingApproval,
  OverridePolicy,
  OverrideRecord,
  PullState,
  PullStateLike,
  ReviewLike,
};

/** Label and pill tone of each state, for list and detail views. */
export const PULL_STATE_PILL: Record<PullState, { label: string; cls: string }> = {
  merged: { label: 'Merged', cls: '' },
  closed: { label: 'Closed', cls: '' },
  draft: { label: 'Draft', cls: '' },
  open: { label: 'Open', cls: '' },
};

/** Changeset files in a PR (`.changeset/*.md`, not the README) with their bump lines. */
export function parseChangeset(text: string): { bumps: { pkg: string; bump: string }[]; summary: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { bumps: [], summary: text.trim() };
  const bumps = [...m[1]!.matchAll(/["']?([@\w/.-]+)["']?\s*:\s*(major|minor|patch)/g)].map((x) => ({ pkg: x[1]!, bump: x[2]! }));
  return { bumps, summary: m[2]!.trim() };
}

export type { ReviewStatusKind };
export { REVIEW_STATUS_ORDER };

export interface ReviewStatus {
  kind: ReviewStatusKind;
  label: string;
  /** DS Badge tone (lib/changes status groups). */
  tone: StatusTone;
}

/**
 * Label (core REVIEW_STATUS_LABEL, the words the MCP server and the CLI use too) and tone of each status. Color means status only (lib/changes.ts): red when something blocks the merge,
 * violet while it waits for an approval, green when it is ready, grey for drafts, running checks, unknown, merged
 * and closed. Risk tiers never take a color.
 */
export const REVIEW_STATUS: Record<ReviewStatusKind, { label: string; tone: StatusTone }> = {
  merged: { label: REVIEW_STATUS_LABEL.merged, tone: 'neutral' },
  closed: { label: REVIEW_STATUS_LABEL.closed, tone: 'neutral' },
  draft: { label: REVIEW_STATUS_LABEL.draft, tone: 'neutral' },
  'ci-failing': { label: REVIEW_STATUS_LABEL['ci-failing'], tone: 'danger' },
  'changes-requested': { label: REVIEW_STATUS_LABEL['changes-requested'], tone: 'danger' },
  'ci-running': { label: REVIEW_STATUS_LABEL['ci-running'], tone: 'neutral' },
  'needs-design': { label: REVIEW_STATUS_LABEL['needs-design'], tone: 'info' },
  'needs-tech': { label: REVIEW_STATUS_LABEL['needs-tech'], tone: 'info' },
  'needs-approval': { label: REVIEW_STATUS_LABEL['needs-approval'], tone: 'info' },
  conflict: { label: REVIEW_STATUS_LABEL.conflict, tone: 'danger' },
  checking: { label: REVIEW_STATUS_LABEL.checking, tone: 'neutral' },
  ready: { label: REVIEW_STATUS_LABEL.ready, tone: 'success' },
  unknown: { label: REVIEW_STATUS_LABEL.unknown, tone: 'neutral' },
};

/** One status chip for a pull request, from real data (core reviewStatusKind, the same rules as the merge gate), with its DS Badge tone. */
export function reviewStatus(input: Parameters<typeof reviewStatusKind>[0]): ReviewStatus {
  const kind = reviewStatusKind(input);
  return { kind, ...REVIEW_STATUS[kind] };
}

/**
 * Studio's verdict on one pull request: the repository settings as the site embeds them (core siteRepoFromConfig:
 * owners, rights, soloOwnerCanApproveBoth, override), the GitHub teams read so far, and what GitHub says about the pull
 * request (its reviews, tests, whether it merges cleanly) and the approved suggestion it applies. The branch page
 * (scripts/reviews.ts) and the status chips (scripts/pr-status.ts) read it; it is core branchVerdict over core
 * approverLists and summarizeApprovals, the composition the MCP server and the CLI read too (packages/mcp
 * branches.ts). packages/mcp/test/gate-parity.test.ts feeds both the same fixtures.
 */
export function studioVerdict(input: {
  site: Pick<SiteRepo, 'owners' | 'rights' | 'soloOwnerCanApproveBoth'> & { override?: OverridePolicy | null | undefined };
  teams?: TeamStates | null | undefined;
  pull: { state?: string | undefined; draft?: boolean | undefined; merged_at?: string | null | undefined; labels?: LabelLike[] | undefined; user: { login: string } };
  tier: Tier | null;
  ci: CiSummary | null;
  reviews: ReviewLike[] | null;
  suggestion?: { approvals: ApprovalSummary; tier: Tier } | null | undefined;
  mergeable?: boolean | null | undefined;
  viewer?: string | null | undefined;
  ship?: ShipPolicy | null | undefined;
}): BranchVerdict {
  const { site, pull } = input;
  const owners = approverLists(site.owners, site.rights, input.teams ?? null);
  const own = input.reviews ? summarizeApprovals(input.reviews, owners, pull.user.login, { soloOwnerCanApproveBoth: site.soloOwnerCanApproveBoth }) : null;
  return branchVerdict({
    tier: input.tier,
    ci: input.ci,
    approvals: own,
    suggestion: input.suggestion,
    owners,
    override: site.override ?? null,
    draft: pull.draft,
    mergeable: input.mergeable,
    state: pull.state,
    merged_at: pull.merged_at,
    viewer: input.viewer,
    exploration: isActiveExploration(pull.labels ?? []),
    ship: input.ship,
  });
}
