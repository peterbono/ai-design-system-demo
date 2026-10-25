// Tier 1 publish by leads (docs/GOVERNANCE.md, "Tier 1 publish by leads"), the server copy of @bridge-ds/core
// tier1-publish.ts and of the Tier 1 part of core risk.ts classifyRisk, for api/ship. The /api functions load no
// workspace package at runtime; src/lib/tier1-publish-parity.test.ts runs both on the same fixtures and fails the
// moment they disagree.

import { isGuardrail, type ShipConfig, type TokenChange } from './figma-ship.js';

/** core leadsPublishTier1On over bridge.config.json as parsed: absent counts as on. */
export function leadsPublishTier1On(raw: unknown): boolean {
  const c = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  return c.governance?.leadsPublishTier1 !== false;
}

export type Tier1Domain = 'design' | 'tech';
const CODE_TIER1 = [/\.stories\.[cm]?[jt]sx?$/, /\.test\.[cm]?[jt]sx?$/];

/** core tier1Domain. */
export function tier1Domain(paths: readonly string[]): Tier1Domain {
  return paths.some((p) => CODE_TIER1.some((r) => r.test(p))) ? 'tech' : 'design';
}

/** core risk.ts LOW: docs, stories, tests, changesets. */
const LOW = [/\.md$/, /^docs\//, /\.stories\.tsx?$/, /\.docs\.json$/, /\.test\.tsx?$/, /^\.changeset\//];

/**
 * core classifyRisk(...).tier === 1, for the files of a pull request: every file is docs, a story, a test or a
 * changeset, never a guardrail, and a token file only when every token change is a description edit (`tokenChanges`
 * read from the token files; null when they could not be read, which is not Tier 1).
 */
export function isTier1(files: readonly { path: string }[], tokenChanges: readonly TokenChange[] | null, cfg: ShipConfig): boolean {
  for (const f of files) {
    const p = f.path.replace(/^\/+/, '');
    if (p.endsWith('.tokens.json')) {
      if (!tokenChanges) return false;
      continue;
    }
    if (isGuardrail(p, cfg)) return false;
    if (!LOW.some((r) => r.test(p))) return false;
  }
  return (tokenChanges ?? []).every((c) => c.kind === 'changed' && c.descriptionOnly === true);
}

const norm = (x: string) => x.trim().replace(/^@/, '').toLowerCase();

/** core canPublishTier1, once the tier is known to be 1 and the setting on. `approvers`: the domain's list, teams expanded. */
export function isLead(login: string, x: { admin: boolean; approvers: readonly string[] }): boolean {
  if (x.admin) return true;
  return x.approvers.some((l) => !l.includes('/') && norm(l) === norm(login));
}

/** core TIER1_PUBLISH_HEADING. */
export const TIER1_PUBLISH_HEADING = '**Bridge: published without review (Tier 1)**';

/** core publishedWithoutReview. */
export const publishedWithoutReview = (name: string): string => `Published by ${name.trim() || 'a lead'} without review (Tier 1).`;

/** core tier1PublishReviewBody. */
export function tier1PublishReviewBody(name: string, login: string): string {
  return `${TIER1_PUBLISH_HEADING}\n\n${publishedWithoutReview(name)} @${norm(login)} leads this part of the design system and the team lets leads publish Tier 1 changes (governance.leadsPublishTier1). It merges once the automatic checks pass; a failing check sends it to review instead.`;
}
