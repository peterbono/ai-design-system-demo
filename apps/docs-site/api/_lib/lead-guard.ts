// The guard behind Studio's lead bar: someone with write access on GitHub could edit an exploration's description on
// github.com and write a lead's decision there (Looks right, I'll look...), past every check Studio and the proxy
// make. The Bridge GitHub App's webhook sees every edit (pull_request edited, with the body before): when it adds a
// lead's words and the person who did it may not decide (api/_lib/review-mode.ts), Bridge puts the description back
// as it was and says why in one comment.
//   Allowed: a design owner of the team (bridge.config.json), an admin of the repository, never on their own
//   exploration. Bridge's own writes (its app, for email members and GitHub designers through the proxy) were checked
//   by the proxy already: a bot is never reverted.
import { explorationBlockOf } from './exploration-member.js';
import { addsLeadWords } from './lead-gate.js';

export const GUARD_COMMENT = 'Only a design lead can decide this, in Bridge. Bridge put the description back as it was.';

export interface GuardCase {
  repo: string;
  number: number;
  before: string;
  sender: string;
  /** Who started the exploration on GitHub (the pull request's author, or the block's), lower case. */
  authors: string[];
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

/** The edit to look at: a person's edit of a pull request description that adds a lead's words. Null otherwise. */
export function guardCaseOf(event: string, payload: unknown): GuardCase | null {
  if (event !== 'pull_request') return null;
  const p = obj(payload);
  if (p.action !== 'edited') return null;
  const before = obj(obj(p.changes).body).from;
  const pr = obj(p.pull_request);
  const sender = obj(p.sender);
  const repo = obj(p.repository).full_name;
  if (typeof before !== 'string' || typeof pr.body !== 'string' || !Number.isSafeInteger(pr.number) || typeof repo !== 'string') return null;
  if (sender.type !== 'User' || typeof sender.login !== 'string') return null;
  // Done exploring is not a lead's word here: whether it needed one is the proxy's and Studio's call.
  if (!addsLeadWords(before, pr.body, { hasLeads: false })) return null;
  const block = explorationBlockOf(before) ?? {};
  const authors = [...new Set([obj(pr.user).login, block.author, block.leadAskedBy].filter((v): v is string => typeof v === 'string' && v.length > 0).map((v) => v.replace(/^@/, '').toLowerCase()))];
  return {
    repo: repo.toLowerCase(),
    number: pr.number as number,
    before,
    sender: sender.login.toLowerCase(),
    authors,
  };
}

/** Whether the sender may decide: a design owner or an admin of the repository, never on their own exploration. */
export function senderDecides(g: GuardCase, who: { designOwners: readonly string[]; admin: boolean }): boolean {
  if (g.authors.includes(g.sender)) return false;
  return who.admin || who.designOwners.some((l) => l.replace(/^@/, '').toLowerCase() === g.sender);
}

export interface GuardDeps {
  /** A GitHub call as the Bridge app on `repo`; null when the app is not installed there. */
  call: (repo: string, method: string, path: string, body?: unknown) => Promise<{ status: number; data: any } | null>;
  /** The design owners of the team that repository belongs to. */
  designOwners: (repo: string) => Promise<string[]>;
}

/** Runs the guard for one delivery. True when it put a description back. */
export async function runLeadGuard(event: string, payload: unknown, d: GuardDeps): Promise<boolean> {
  const g = guardCaseOf(event, payload);
  if (!g) return false;
  const [owners, perm] = await Promise.all([d.designOwners(g.repo), d.call(g.repo, 'GET', `/repos/${g.repo}/collaborators/${encodeURIComponent(g.sender)}/permission`)]);
  if (!perm || perm.status !== 200) return false;
  if (
    senderDecides(g, {
      designOwners: owners,
      admin: perm.data?.permission === 'admin',
    })
  )
    return false;
  const back = await d.call(g.repo, 'PATCH', `/repos/${g.repo}/pulls/${g.number}`, { body: g.before });
  if (!back || back.status !== 200) return false;
  await d.call(g.repo, 'POST', `/repos/${g.repo}/issues/${g.number}/comments`, {
    body: `@${g.sender} ${GUARD_COMMENT}`,
  });
  return true;
}
