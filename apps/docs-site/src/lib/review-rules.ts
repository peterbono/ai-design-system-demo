// Governance rules for the Reviews section, as pure functions so they are unit tested and shared by the page
// script. Same rules as docs/GOVERNANCE.md: the highest tier wins, Tier 2 and 3 need a design and a tech approval,
// nothing merges while CI fails. Who may ship (merge, which publishes to the products) comes from
// `governance.rights` in bridge.config.json (@bridge-ds/core rights.ts); GitHub write access is checked as well.

import type { StatusTone } from './changes';
import {
  allowedMergeMethods,
  approverLists,
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
  REVIEW_STATUS_ORDER,
  reviewStatusKind,
  shipPolicy,
  summarizeApprovals,
  summarizeCi,
  whoCanShipSentence,
  type ApprovalSummary,
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
 * Label and tone of each status. Color means status only (lib/changes.ts): red when something blocks the merge,
 * violet while it waits for an approval, green when it is ready, grey for drafts, running checks, unknown, merged
 * and closed. Risk tiers never take a color.
 */
export const REVIEW_STATUS: Record<ReviewStatusKind, { label: string; tone: StatusTone }> = {
  merged: { label: 'Merged', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'neutral' },
  'ci-failing': { label: 'Blocked by tests', tone: 'danger' },
  'changes-requested': { label: 'Changes requested', tone: 'danger' },
  'ci-running': { label: 'Tests running', tone: 'neutral' },
  'needs-design': { label: 'Needs design approval', tone: 'info' },
  'needs-tech': { label: 'Needs tech approval', tone: 'info' },
  'needs-approval': { label: 'Needs approval', tone: 'info' },
  conflict: { label: 'Conflict', tone: 'danger' },
  checking: { label: 'Checking', tone: 'neutral' },
  ready: { label: 'Ready to merge', tone: 'success' },
  unknown: { label: 'Status unknown', tone: 'neutral' },
};

/** One status chip for a pull request, from real data (core reviewStatusKind, the same rules as the merge gate), with its DS Badge tone. */
export function reviewStatus(input: Parameters<typeof reviewStatusKind>[0]): ReviewStatus {
  const kind = reviewStatusKind(input);
  return { kind, ...REVIEW_STATUS[kind] };
}
