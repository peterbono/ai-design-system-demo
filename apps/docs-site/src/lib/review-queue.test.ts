import { describe, expect, it } from 'vitest';
import {
  approvalNeedLabel,
  approvalNeedLong,
  effectiveTier,
  isAutomationPull,
  isReleasePull,
  queueBuckets,
  queueCountLine,
  queueSentence,
  releasePull,
  reviewQueue,
} from './review-queue';
import { jargonIn } from './vocabulary';

const pr = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, state: 'open', draft: false, labels: [] as { name: string }[], head: { ref: `agent/x-${n}` }, user: { login: 'pat' }, ...extra });

// The open pull requests at the audit: three changes, the release pull request and a running exploration.
const audit = [
  pr(1),
  pr(2),
  pr(3),
  pr(58, { head: { ref: 'changeset-release/main' }, user: { login: 'github-actions[bot]' }, title: 'chore: version packages' }),
  pr(64, { draft: true, labels: [{ name: 'exploration' }], head: { ref: 'explore/button-normal-again' } }),
];

describe('review queue', () => {
  it('leaves out the release pull request and running explorations', () => {
    expect(reviewQueue(audit).map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it('leaves out merged and closed pull requests', () => {
    expect(reviewQueue([pr(1, { state: 'closed' }), pr(2, { state: 'closed', merged_at: '2026-10-01' }), pr(3)]).map((p) => p.number)).toEqual([3]);
  });

  it('keeps a promoted exploration (label removed) and a plain draft', () => {
    expect(reviewQueue([pr(5, { head: { ref: 'explore/pill' } }), pr(6, { draft: true })]).map((p) => p.number)).toEqual([5, 6]);
  });

  it('spots automation by branch or by bot author', () => {
    expect(isReleasePull({ head: { ref: 'changeset-release/main' } })).toBe(true);
    expect(isAutomationPull({ head: { ref: 'chore/deps' }, user: { login: 'github-actions[bot]' } })).toBe(true);
    expect(isAutomationPull({ head: { ref: 'chore/deps' }, user: { login: 'app/github-actions' } })).toBe(true);
    expect(isAutomationPull({ head: { ref: 'agent/x' }, user: { login: 'peterbono' } })).toBe(false);
  });

  it('finds the open release pull request', () => {
    expect(releasePull(audit)?.number).toBe(58);
    expect(releasePull([pr(1)])).toBeNull();
    expect(releasePull([pr(58, { head: { ref: 'changeset-release/main' }, state: 'closed' })])).toBeNull();
  });
});

describe('effective tier: the list and the detail use the same rule', () => {
  const tokens = [{ filename: 'packages/tokens/src/semantic/light.tokens.json', status: 'modified' }];
  const component = [{ filename: 'packages/react/src/components/Card/Card.module.css', status: 'modified' }];

  it('computes the tier from the files when no label is set', () => {
    expect(effectiveTier([], null, tokens)).toBe(3);
    expect(effectiveTier([], null, component)).toBe(2);
  });

  it('keeps the highest of the label and the files', () => {
    expect(effectiveTier([{ name: 'tier-3' }], null, component)).toBe(3);
    expect(effectiveTier([{ name: 'tier-1' }], null, tokens)).toBe(3);
  });

  it('without files, only a label counts', () => {
    expect(effectiveTier([{ name: 'tier-2' }], null, null)).toBe(2);
    expect(effectiveTier([], null, null)).toBeNull();
  });

  it('says what approval is needed in plain words, no tier number', () => {
    expect(approvalNeedLabel(3)).toBe('Design + tech');
    expect(approvalNeedLabel(2)).toBe('Design + tech');
    expect(approvalNeedLabel(1)).toBe('One approval');
    expect(approvalNeedLabel(null)).toBe('');
    expect(approvalNeedLong(3)).not.toMatch(/tier/i);
  });
});

describe('queue sentence', () => {
  it('reads like the audit asks: design approvals first, then the developer side', () => {
    expect(queueSentence(['needs-design', 'needs-design', 'needs-design', 'ci-failing'])).toBe('3 branches wait for design approval. 1 is blocked on the developer side.');
  });

  it('counts a merge conflict on the developer side too', () => {
    expect(queueSentence(['conflict', 'ci-failing'])).toBe('2 branches are blocked on the developer side.');
  });

  it('says one change in the singular', () => {
    expect(queueSentence(['ready'])).toBe('1 branch is ready to merge.');
  });

  it('counts unread statuses as still being checked', () => {
    expect(queueSentence(['needs-approval', null, 'unknown'])).toBe('1 branch waits for one approval. 2 are still being checked.');
  });

  it('folds anything past three groups into one sentence', () => {
    const s = queueSentence(['needs-design', 'needs-tech', 'ready', 'ci-failing', 'draft']);
    expect(s).toBe('1 branch waits for design approval. 1 waits for tech approval. 3 more are on the way.');
  });

  it('adds up to the queue length', () => {
    const kinds = ['needs-design', 'ci-failing', null, 'ready'] as const;
    expect(queueBuckets([...kinds]).reduce((n, b) => n + b.n, 0)).toBe(kinds.length);
  });

  it('never uses developer words', () => {
    const s = queueSentence(['needs-design', 'ci-failing', 'conflict', 'ready', 'changes-requested']);
    expect(jargonIn(s)).toEqual([]);
    expect(s).not.toMatch(/\btier\b/i);
  });

  it('has a count line for empty and filled queues', () => {
    expect(queueCountLine(0)).toBe('Nothing waits for a review.');
    expect(queueCountLine(1)).toBe('1 branch in review.');
    expect(queueCountLine(4)).toBe('4 branches in review.');
    expect(queueSentence([])).toBe('Nothing waits for a review.');
  });
});
