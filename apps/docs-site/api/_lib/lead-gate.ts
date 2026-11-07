// What only a design lead may write in an exploration's block, for a member who is not one (api/contribute's policy,
// on every pull request body and label the proxy sends for them). Read from the body as it is on GitHub and the body
// sent, never from what the browser says about itself. The server copy of the block's words (core explorations.ts):
// the API does not import core; a test holds the kinds equal.
import { explorationBlockOf } from './exploration-member.js';

/** The decisions only a lead takes. The designer's own word is `answer`. */
export const LEAD_KINDS: ReadonlySet<string> = new Set(['looks-right', 'changes', 'question', 'not-doing', 'take-back', 'asked-someone', 'handed', 'archived']);

export const LEAD_ONLY = 'Only a design lead can say this.';

const leadWords = (block: Record<string, unknown> | null): string[] => {
  const all = block?.decisions;
  return Array.isArray(all) ? all.filter((d) => LEAD_KINDS.has(String(d?.kind))).map((d) => JSON.stringify([d.kind, d.at, d.by, d.byName])) : [];
};

/**
 * True when `after` adds what only a lead may add to `before`: a decision of theirs, their yes, or Done exploring on a
 * team with design leads (it goes through them: the yes, then Bridge's own write by the lead). Removing is allowed:
 * Back to exploring takes the done marker off, and history is the lead's to keep through these same rules.
 */
export function addsLeadWords(before: unknown, after: unknown, team: { hasLeads: boolean }): boolean {
  const was = explorationBlockOf(before);
  const now = explorationBlockOf(after);
  if (!now) return false;
  const known = new Set(leadWords(was));
  if (leadWords(now).some((w) => !known.has(w))) return true;
  if (now.leadOkBy !== undefined && now.leadOkBy !== was?.leadOkBy) return true;
  // "I'll look" is a reviewer's word too.
  if (now.leadTakenAt !== undefined && now.leadTakenAt !== was?.leadTakenAt) return true;
  return team.hasLeads && Boolean(now.doneAt) && !was?.doneAt;
}

/** The label that hands an exploration to the developers: a lead's to add, on a team with design leads. */
export const handsOff = (labels: unknown, readyLabel: string): boolean => Array.isArray(labels) && labels.includes(readyLabel);
