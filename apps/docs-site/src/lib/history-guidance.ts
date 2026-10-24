// Usage guidance changes in History. The token history (core history.ts) diffs token files only, so a merged change
// that only edits a component's usage guidance (a docs/ branch from the Library editor, or a pull request whose files
// are all docs.json) would never show. A team's History reads its merged pull requests once and lists those too, as
// entries without token changes, marked here. Pure: no DOM, no fetch. Unit tested in history-guidance.test.ts.
import type { HistoryEntry, PullRequestSummary } from '@bridge-ds/core';

/** The reason that marks an entry as usage guidance only (it has no token change to diff or undo). */
export const GUIDANCE_REASON = 'Usage guidance only';

/** The tag of a guidance row in History, where token rows say what approval they needed. */
export const GUIDANCE_TAG = 'Usage guidance';

/** Whether a History entry is a usage guidance change (guidanceHistoryEntry). */
export const isGuidanceEntry = (e: Pick<HistoryEntry, 'reasons' | 'changes'>): boolean => e.changes.length === 0 && e.reasons.includes(GUIDANCE_REASON);

/** A merged branch the Library editor opened for usage guidance (core docs-proposal: docs/<slug>-<date>-<id>). */
export const isGuidanceBranch = (ref: string): boolean => ref.startsWith('docs/');

/**
 * The guidance changes among a team's recent pull requests: merged into `base`, from a guidance branch, and not
 * already in the token history (`known`: pull request numbers its entries carry).
 */
export function guidancePulls(pulls: readonly PullRequestSummary[], base: string, known: ReadonlySet<number>): PullRequestSummary[] {
  return pulls.filter((p) => p.mergedAt && p.baseRef === base && isGuidanceBranch(p.headRef) && !known.has(p.number));
}

/** A History entry for a merged usage guidance change: who asked, when it landed, no token change. */
export function guidanceHistoryEntry(p: PullRequestSummary, author: string): HistoryEntry {
  const date = p.mergedAt ?? p.updatedAt;
  return {
    id: `pr-${p.number}`,
    sha: p.headSha,
    date,
    author,
    title: p.title,
    why: p.title,
    pr: { number: p.number, title: p.title, url: p.url, author: p.author, mergedAt: date, ...(p.body ? { body: p.body } : {}) },
    changes: [],
    counts: { added: 0, changed: 0, removed: 0, renamed: 0, total: 0 },
    tier: 1,
    bump: 'patch',
    breaking: false,
    reasons: [GUIDANCE_REASON],
    changesets: [],
  };
}

/** "2 token changes, 1 guidance change": what a release group of History holds. */
export function groupCountLine(items: readonly Pick<HistoryEntry, 'reasons' | 'changes'>[]): string {
  const guidance = items.filter(isGuidanceEntry).length;
  const tokens = items.length - guidance;
  const n = (count: number, what: string) => `${count} ${what} ${count === 1 ? 'change' : 'changes'}`;
  return [tokens ? n(tokens, 'token') : '', guidance ? n(guidance, 'guidance') : ''].filter(Boolean).join(', ') || n(0, 'token');
}
