// Tier 1 publish by leads (docs/GOVERNANCE.md, "Tier 1 publish by leads"). A Tier 1 change (docs, guidance, a token
// description with no value change, story or test fixes: classifyRisk) may skip review when the person who made it
// leads that part of the design system: a team admin, or a reviewer of the matching domain (a design reviewer for docs
// and guidance, a tech reviewer for code-only Tier 1). Bridge opens the pull request as usual, waits for the checks and
// merges it with its app; a failing check sends it to review instead. The pull request and History record who
// published it. The team turns it off with governance.leadsPublishTier1: false (absent counts as on).
//
// The server copy of these rules lives in apps/docs-site/api/_lib/tier1-publish.ts (the /api functions load no
// workspace package); apps/docs-site/src/lib/tier1-publish-parity.test.ts runs both on the same fixtures.

import type { Owners } from './config';
import type { RiskTier } from './risk';

/** The setting, absent counting as on. */
export const leadsPublishTier1On = (gov: { leadsPublishTier1?: boolean | undefined } | null | undefined): boolean => gov?.leadsPublishTier1 !== false;

/** Which reviewers lead a Tier 1 change: tech when it touches stories or tests (code-only Tier 1), else design. */
export type Tier1Domain = 'design' | 'tech';

const CODE_TIER1 = [/\.stories\.[cm]?[jt]sx?$/, /\.test\.[cm]?[jt]sx?$/];

export function tier1Domain(paths: readonly string[]): Tier1Domain {
  return paths.some((p) => CODE_TIER1.some((r) => r.test(p))) ? 'tech' : 'design';
}

const norm = (x: string) => x.trim().replace(/^@/, '').toLowerCase();

export interface Tier1PublishInput {
  /** Login of the person publishing (the pull request's author). */
  viewer: string | null | undefined;
  /** classifyRisk over the change. Only Tier 1 publishes without review. */
  tier: RiskTier | null | undefined;
  domain: Tier1Domain;
  /** The approver lists (approverLists: rights applied, teams expanded). */
  approvers: Owners;
  /** The viewer is an admin of the team in Bridge. */
  admin: boolean;
  /** governance.leadsPublishTier1 (leadsPublishTier1On). */
  enabled: boolean;
}

/** Whether this person may publish this change without review. */
export function canPublishTier1(x: Tier1PublishInput): boolean {
  if (!x.enabled || x.tier !== 1 || !x.viewer) return false;
  if (x.admin) return true;
  const list = x.domain === 'design' ? x.approvers.design : x.approvers.tech;
  return list.some((l) => !l.includes('/') && norm(l) === norm(x.viewer!));
}

/** The button that replaces "Send for review" for someone who may publish. */
export const PUBLISH_LABEL = 'Publish';

/** The first line of the app's review on the pull request: how History and the readers recognise it. */
export const TIER1_PUBLISH_HEADING = '**Bridge: published without review (Tier 1)**';

/** The record, on the pull request and in History. */
export const publishedWithoutReview = (name: string): string => `Published by ${name.trim() || 'a lead'} without review (Tier 1).`;

/** The app's review body: the heading, then the record and why it needed no review. */
export function tier1PublishReviewBody(name: string, login: string): string {
  return `${TIER1_PUBLISH_HEADING}\n\n${publishedWithoutReview(name)} @${norm(login)} leads this part of the design system and the team lets leads publish Tier 1 changes (governance.leadsPublishTier1). It merges once the automatic checks pass; a failing check sends it to review instead.`;
}

/** Who published it, read back from the app's review body, or null when the body is not one. */
export function tier1PublishedBy(body: string | null | undefined): string | null {
  if (!body || !body.trimStart().startsWith(TIER1_PUBLISH_HEADING)) return null;
  const m = /Published by (.+?) without review \(Tier 1\)\./.exec(body);
  return m ? m[1]! : null;
}

/**
 * Who published this pull request without review, read from its reviews: the app's approving review with the heading,
 * on the head commit when the head is known (an older one was dismissed by the push after it). Null when none.
 */
export function tier1PublishOf(reviews: readonly { state: string; body?: string | null | undefined; commit_id?: string | null | undefined }[] | null | undefined, headSha?: string | null | undefined): string | null {
  for (const r of [...(reviews ?? [])].reverse()) {
    if (r.state !== 'APPROVED') continue;
    if (headSha && r.commit_id && r.commit_id !== headSha) continue;
    const by = tier1PublishedBy(r.body);
    if (by) return by;
  }
  return null;
}

/**
 * Who may publish without review, in one sentence, for the CLI, the MCP server and Settings. Admins are a Bridge
 * team role, so the sentence names the role, not people.
 */
export function tier1PublishSentence(enabled: boolean): string {
  return enabled
    ? 'Tier 1 (docs, guidance, token descriptions, story and test fixes): team admins and the reviewers of that part publish it without review; Bridge merges it once the checks pass.'
    : 'Tier 1 needs one owner approval: leads publishing small changes without review is off.';
}
