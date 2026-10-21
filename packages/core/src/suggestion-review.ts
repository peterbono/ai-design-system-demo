// Reviews on a suggestion. Issues have no native reviews, so a review is a comment with a hidden record
// (`<!-- bridge-suggestion-review {...} -->`) plus a sentence people read. The truth is the comment author, which GitHub
// authenticates, checked against the owners in the config read from the default branch (never from the payload), and
// the payload sha the reviewer saw: an approval of an older payload no longer counts, like a stale pull request review.
// Pure; posting lives in suggestions-github.ts.

import type { Owners } from './config';
import { pendingApprovals, summarizeApprovals, type ApprovalRole, type ApprovalSummary, type ReviewLike } from './review-gate';
import { approverLists, type Rights } from './rights';
import type { RiskTier } from './risk';
import type { TeamStates } from './teams';

export const SUGGESTION_REVIEW_MARK = 'bridge-suggestion-review';
export const SUGGESTION_APPLIED_MARK = 'bridge-suggestion-applied';

export type SuggestionReviewEvent = 'approve' | 'request-changes' | 'comment';

export interface SuggestionReviewRecord {
  event: SuggestionReviewEvent;
  /** The role the reviewer approved for. Informative: what counts is the author against the owner lists. */
  role?: ApprovalRole | undefined;
  /** sha256 of the payload the reviewer saw (suggestionPayloadSha). */
  payloadSha: string;
  /** ISO date. */
  at: string;
}

const EVENTS: readonly SuggestionReviewEvent[] = ['approve', 'request-changes', 'comment'];
const ROLE_TEXT: Record<ApprovalRole, string> = { design: 'for design', tech: 'for tech', approval: '' };

/** The comment a review posts: a sentence, the reviewer's message quoted, and the hidden record. */
export function composeSuggestionReviewComment(r: SuggestionReviewRecord & { by?: string | null | undefined; message?: string | undefined }): string {
  const who = r.by ? ` by @${r.by.replace(/^@/, '')}` : '';
  const role = r.role ? ROLE_TEXT[r.role] : '';
  const head =
    r.event === 'approve'
      ? `Approved${role ? ` ${role}` : ''}${who} in Bridge.`
      : r.event === 'request-changes'
        ? `Changes requested${who} in Bridge.`
        : `Comment${who} in Bridge.`;
  const quote = r.message?.trim()
    ? r.message
        .trim()
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n')
    : '';
  const record: SuggestionReviewRecord = { event: r.event, ...(r.role ? { role: r.role } : {}), payloadSha: r.payloadSha, at: r.at };
  return [head, ...(quote ? ['', quote] : []), '', `<sub>Applies to version \`${r.payloadSha.slice(0, 7)}\` of this suggestion.</sub>`, '', `<!-- ${SUGGESTION_REVIEW_MARK} ${JSON.stringify(record)} -->`].join('\n');
}

/** The review record in a comment, or null when the comment is not a Bridge review. */
export function parseSuggestionReviewComment(body: string | null | undefined): SuggestionReviewRecord | null {
  const m = new RegExp(`<!-- ${SUGGESTION_REVIEW_MARK} (\\{[^\\n]*?\\}) -->`).exec(body ?? '');
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]!) as Partial<SuggestionReviewRecord>;
    if (!r || !(EVENTS as readonly unknown[]).includes(r.event) || typeof r.payloadSha !== 'string' || !/^[0-9a-f]{64}$/.test(r.payloadSha)) return null;
    return {
      event: r.event as SuggestionReviewEvent,
      ...(r.role === 'design' || r.role === 'tech' || r.role === 'approval' ? { role: r.role } : {}),
      payloadSha: r.payloadSha,
      at: typeof r.at === 'string' ? r.at : '',
    };
  } catch {
    return null;
  }
}

/** A developer applied the suggestion: where, and on which payload. */
export interface SuggestionAppliedRecord {
  by?: string | undefined;
  branch?: string | undefined;
  commit?: string | undefined;
  pr?: number | undefined;
  payloadSha: string;
  at: string;
  /** Applied without the approvals (`--force-unapproved`). */
  forced?: boolean | undefined;
}

/** The comment recording that a suggestion is being applied (a branch or a pull request exists). */
export function composeSuggestionAppliedComment(r: SuggestionAppliedRecord): string {
  const where = r.pr ? `in pull request #${r.pr}` : r.branch ? `on \`${r.branch}\`` : r.commit ? `in commit ${r.commit.slice(0, 7)}` : 'locally';
  const record = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
  return [
    `Being applied ${where}${r.by ? ` by @${r.by.replace(/^@/, '')}` : ''}.${r.forced ? ' Applied before every approval was in.' : ''}`,
    '',
    `<!-- ${SUGGESTION_APPLIED_MARK} ${JSON.stringify(record)} -->`,
  ].join('\n');
}

export function parseSuggestionAppliedComment(body: string | null | undefined): SuggestionAppliedRecord | null {
  const m = new RegExp(`<!-- ${SUGGESTION_APPLIED_MARK} (\\{[^\\n]*?\\}) -->`).exec(body ?? '');
  if (!m) return null;
  try {
    const r = JSON.parse(m[1]!) as Partial<SuggestionAppliedRecord>;
    return r && typeof r.payloadSha === 'string' ? ({ ...r, payloadSha: r.payloadSha, at: typeof r.at === 'string' ? r.at : '' } as SuggestionAppliedRecord) : null;
  } catch {
    return null;
  }
}

/** A comment as read from GitHub (listIssueComments), oldest first. */
export interface SuggestionCommentLike {
  author: string;
  body: string;
  createdAt?: string | undefined;
  /** GitHub's author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE... */
  authorAssociation?: string | undefined;
}

export interface SuggestionGovernance {
  owners: Owners;
  rights?: Rights | null | undefined;
  /** Team members once read (teams.ts). Undefined: owner entries are used as listed. */
  teams?: TeamStates | null | undefined;
}

export interface SuggestionApprovals extends ApprovalSummary {
  /** People whose latest review is on an older payload: it no longer counts. */
  stale: string[];
  /** People whose review does not count because they are not owners (or not collaborators when no owner is set). */
  ignored: string[];
}

const norm = (l: string) => l.trim().replace(/^@/, '').toLowerCase();
const COLLABORATOR = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/**
 * Approvals on a suggestion, as summarizeApprovals counts them on a pull request, from the review comments: only
 * comments by people in the approver lists (governance owners and rights) count; with no owner configured at all, only
 * repository owners, members and collaborators (GitHub's author association). Only reviews of the current payload
 * sha count; the suggestion's author never approves their own suggestion.
 */
export function summarizeSuggestionApprovals(comments: readonly SuggestionCommentLike[], gov: SuggestionGovernance, opts: { payloadSha: string; author?: string | null | undefined }): SuggestionApprovals {
  const lists = approverLists(gov.owners, gov.rights ?? null, gov.teams);
  const owners = new Set([...lists.design, ...lists.tech].map(norm));
  const anyOwner = owners.size > 0;
  const reviews: ReviewLike[] = [];
  const latestOld = new Map<string, SuggestionReviewEvent>();
  const ignored = new Set<string>();
  const ordered = comments.map((c, i) => ({ c, i })).sort((a, b) => String(a.c.createdAt ?? '').localeCompare(String(b.c.createdAt ?? '')) || a.i - b.i);
  ordered.forEach(({ c }, i) => {
    const r = parseSuggestionReviewComment(c.body);
    if (!r || r.event === 'comment' || !c.author) return;
    const login = norm(c.author);
    if (opts.author && login === norm(opts.author)) return;
    const counts = anyOwner ? owners.has(login) : COLLABORATOR.includes((c.authorAssociation ?? '').toUpperCase());
    if (!counts) {
      ignored.add(c.author);
      return;
    }
    const at = String(i).padStart(6, '0');
    if (r.payloadSha !== opts.payloadSha) {
      latestOld.set(c.author, r.event);
      // An older review is dismissed: it neither approves nor blocks the current payload.
      reviews.push({ user: { login: c.author }, state: 'DISMISSED', submitted_at: at });
      return;
    }
    latestOld.delete(c.author);
    reviews.push({ user: { login: c.author }, state: r.event === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED', submitted_at: at });
  });
  const summary = summarizeApprovals(reviews, lists, opts.author ?? undefined);
  const stale = [...latestOld.keys()].filter((l) => !summary.approvers.includes(l) && !summary.changesRequested.includes(l));
  return { ...summary, stale, ignored: [...ignored].filter((l) => !summary.approvers.includes(l)) };
}

/** The review state for the status machine: changes requested beats approved; approved when no approval is missing. */
export function suggestionReviewState(tier: RiskTier, approvals: ApprovalSummary): 'needs-review' | 'changes-requested' | 'approved' {
  if (approvals.changesRequested.length) return 'changes-requested';
  return pendingApprovals(tier, approvals).length ? 'needs-review' : 'approved';
}
