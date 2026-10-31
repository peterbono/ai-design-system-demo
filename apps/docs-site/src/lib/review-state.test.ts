import { describe, expect, it } from 'vitest';
import { explorationLifecycle, explorationNameOf, lastSays, LIFECYCLE_LABEL, needsReviewRead, pullLifecycle, reviewAsked, reviewersAsked, reviewLine, reviewsFromStatus, reviewStateOf, reviewVerdictOf, waitsOnViewer, type LifecyclePull } from './review-state';
import { jargonIn } from './vocabulary';

const r = (login: string, state: string) => ({ user: { login }, state });
const names = (l: string) => ({ florian: 'Florian', lee: 'Lee', dana: 'Dana', ann: 'Ann' })[l] ?? l;

describe('the review read from the pull request', () => {
  it('keeps each reviewer last say that counts: a comment changes nothing, a dismissal clears it, bots never count', () => {
    const says = lastSays([r('lee', 'CHANGES_REQUESTED'), r('lee', 'COMMENTED'), r('Dana', 'APPROVED'), r('dana', 'DISMISSED'), r('bot[bot]', 'APPROVED')]);
    expect([...says.entries()].map(([k, v]) => `${k}:${v.state}`)).toEqual(['lee:CHANGES_REQUESTED']);
  });

  it('lets changes requested win over an approval, the latest approval otherwise, null before anyone decides', () => {
    expect(reviewVerdictOf([r('lee', 'APPROVED'), r('dana', 'CHANGES_REQUESTED')])).toEqual({ kind: 'changes', login: 'dana' });
    expect(reviewVerdictOf([r('lee', 'CHANGES_REQUESTED'), r('lee', 'APPROVED')])).toEqual({ kind: 'approved', login: 'lee' });
    expect(reviewVerdictOf([r('lee', 'COMMENTED')])).toBeNull();
    expect(reviewVerdictOf([])).toBeNull();
  });

  it('asks the requested reviewers, else the design approvers, never the builder, a bot or an unexpanded team', () => {
    expect(reviewersAsked({ requested: [{ login: 'lee' }, { login: 'Lee' }, { login: 'ci[bot]' }], approvers: ['dana'] })).toEqual(['lee']);
    expect(reviewersAsked({ requested: [], approvers: ['dana', 'theo', 'acme/design', '@Ann'], builders: ['theo'] })).toEqual(['dana', 'Ann']);
    expect(reviewersAsked({ approvers: [] })).toEqual([]);
  });

  it('reads the review state: draft, asked, requested, verdict', () => {
    const s = reviewStateOf({ draft: false, requested: [{ login: 'lee' }], approvers: ['dana'], reviews: [r('dana', 'APPROVED')] });
    expect(s).toMatchObject({ draft: false, asked: ['lee'], requested: ['lee'], verdict: { kind: 'approved', login: 'dana' } });
    expect(reviewStateOf({ approvers: [] }).draft).toBe(true);
    expect(reviewAsked(reviewStateOf({ draft: true, approvers: [] }))).toBe(false);
    expect(reviewAsked(reviewStateOf({ draft: true, requested: [{ login: 'lee' }], approvers: [] }))).toBe(true);
    expect(reviewAsked(reviewStateOf({ draft: false, approvers: [] }))).toBe(true);
  });

  it('reads who approved and who asked for changes from a status already read', () => {
    expect(reviewVerdictOf(reviewsFromStatus({ approvers: ['dana'], changesRequested: ['lee'] }))).toEqual({ kind: 'changes', login: 'lee' });
    expect(reviewsFromStatus(null)).toEqual([]);
  });
});

describe('whether the review waits on the viewer', () => {
  const state = (x: Parameters<typeof reviewStateOf>[0]) => reviewStateOf(x);

  it('waits on a reviewer GitHub asks by name, even after their changes request when asked again', () => {
    expect(waitsOnViewer(state({ draft: false, requested: [{ login: 'Florian' }], approvers: [] }), 'florian')).toBe(true);
    expect(waitsOnViewer(state({ draft: false, requested: [{ login: 'florian' }], approvers: [], reviews: [r('florian', 'CHANGES_REQUESTED')] }), 'florian')).toBe(true);
  });

  it('waits on a design approver who has not decided when nobody is asked by name', () => {
    expect(waitsOnViewer(state({ draft: false, approvers: ['florian', 'dana'] }), 'florian')).toBe(true);
    expect(waitsOnViewer(state({ draft: false, approvers: ['florian'], reviews: [r('florian', 'APPROVED')] }), 'florian')).toBe(false);
    expect(waitsOnViewer(state({ draft: false, approvers: ['florian'], reviews: [r('florian', 'CHANGES_REQUESTED')] }), 'florian')).toBe(false);
    // Someone else asked for changes: it waits on the developers.
    expect(waitsOnViewer(state({ draft: false, approvers: ['florian'], reviews: [r('lee', 'CHANGES_REQUESTED')] }), 'florian')).toBe(false);
  });

  it('never waits on someone else, on an approver when others are asked by name, before review is asked, or signed out', () => {
    expect(waitsOnViewer(state({ draft: false, requested: [{ login: 'lee' }], approvers: ['florian'] }), 'florian')).toBe(false);
    expect(waitsOnViewer(state({ draft: true, approvers: ['florian'] }), 'florian')).toBe(false);
    expect(waitsOnViewer(state({ draft: false, approvers: ['florian'] }), null)).toBe(false);
    expect(waitsOnViewer(state({ draft: false, approvers: ['dana'] }), 'florian')).toBe(false);
  });
});

describe('the review in one line', () => {
  const line = (x: Parameters<typeof reviewStateOf>[0], viewer: string | null = null) => reviewLine(reviewStateOf(x), { viewer, nameOf: names });

  it('says who must review, the viewer in their own words', () => {
    expect(line({ draft: false, requested: [{ login: 'florian' }], approvers: [] })).toBe("Waiting for Florian's review");
    expect(line({ draft: false, requested: [{ login: 'florian' }], approvers: [] }, 'florian')).toBe('Waiting for your review');
    expect(line({ draft: false, requested: [{ login: 'florian' }, { login: 'lee' }], approvers: [] })).toBe('Waiting for a review from Florian and Lee');
    expect(line({ draft: false, requested: [{ login: 'florian' }, { login: 'lee' }, { login: 'dana' }], approvers: [] })).toBe('Waiting for a review from Florian and 2 more');
    expect(line({ draft: false, approvers: ['dana'] })).toBe("Waiting for Dana's review");
    expect(line({ draft: false, approvers: [] })).toBe('Waiting for a reviewer');
  });

  it('says the decision: changes requested first, then approved', () => {
    expect(line({ draft: false, approvers: ['dana'], reviews: [r('lee', 'CHANGES_REQUESTED')] })).toBe('Changes requested by Lee');
    expect(line({ draft: false, approvers: ['dana'], reviews: [r('dana', 'APPROVED')] })).toBe('Approved by Dana');
    // Approved by one, another still asked by name: it still waits on them.
    expect(line({ draft: false, requested: [{ login: 'lee' }], approvers: [], reviews: [r('dana', 'APPROVED')] })).toBe("Waiting for Lee's review");
  });

  it('uses designer words, never an em dash', () => {
    for (const t of [line({ draft: false, approvers: [] }), line({ draft: false, approvers: ['dana'], reviews: [r('lee', 'CHANGES_REQUESTED')] }), ...Object.values(LIFECYCLE_LABEL)]) {
      expect(jargonIn(t)).toEqual([]);
      expect(t).not.toContain('—');
    }
  });
});

describe('the lifecycle', () => {
  it('maps every exploration status to its stage', () => {
    const asked = { draft: false, requested: [], verdict: null };
    expect(explorationLifecycle({ status: 'active' })).toBe('exploring');
    expect(explorationLifecycle({ status: 'ready' })).toBe('waiting-for-code');
    expect(explorationLifecycle({ status: 'building' })).toBe('being-built');
    expect(explorationLifecycle({ status: 'building', review: { draft: true, requested: [], verdict: null } })).toBe('being-built');
    expect(explorationLifecycle({ status: 'building', review: asked })).toBe('in-review');
    expect(explorationLifecycle({ status: 'building', review: { draft: true, requested: ['lee'], verdict: null } })).toBe('in-review');
    expect(explorationLifecycle({ status: 'building', review: { draft: true, requested: [], verdict: { kind: 'changes', login: 'lee' } } })).toBe('in-review');
    expect(explorationLifecycle({ status: 'shipped' })).toBe('shipped');
    expect(explorationLifecycle({ status: 'shipped', nextRelease: true })).toBe('next-release');
    expect(explorationLifecycle({ status: 'ready', archived: true })).toBe('archived');
    expect(explorationLifecycle({ status: 'shipped', archived: true })).toBe('shipped');
    expect(explorationLifecycle({ status: 'closed' })).toBe('closed');
  });

  const block = (x: Record<string, unknown>) => `<!-- bridge-exploration ${JSON.stringify({ name: 'Denser tables', purpose: '', ...x })} -->`;
  const pull = (x: Partial<LifecyclePull>): LifecyclePull => ({ state: 'open', draft: true, labels: ['ready-for-devs'], head: { ref: 'explore/denser-tables', sha: 'h2' }, body: block({ doneAt: '2026-10-30T10:00:00Z', doneSha: 'h1' }), ...x });

  it('reads the reviews only for an open exploration handed to developers that is no longer a draft', () => {
    expect(needsReviewRead(pull({ draft: false }))).toBe(true);
    expect(needsReviewRead(pull({ draft: true }))).toBe(false);
    expect(needsReviewRead(pull({ draft: false, state: 'closed', merged_at: '2026-10-31T00:00:00Z' }))).toBe(false);
    expect(needsReviewRead(pull({ draft: false, labels: ['ready-for-devs', 'archived'] }))).toBe(false);
    expect(needsReviewRead(pull({ draft: false, labels: ['exploration'], body: block({}) }))).toBe(false);
    expect(needsReviewRead({ state: 'open', draft: false, labels: [], head: { ref: 'fix/x' }, body: 'Fixes it' })).toBe(false);
  });

  it('reads the stage of a pull request with its reviews', () => {
    expect(pullLifecycle(pull({ draft: false }), { approvers: ['dana'] })).toMatchObject({ stage: 'in-review', review: { asked: ['dana'] } });
    expect(pullLifecycle(pull({})).stage).toBe('being-built');
    expect(pullLifecycle(pull({ head: { ref: 'explore/denser-tables', sha: 'h1' } })).stage).toBe('waiting-for-code');
    expect(pullLifecycle(pull({ state: 'closed', merged_at: '2026-10-31T00:00:00Z' }), { nextRelease: true }).stage).toBe('next-release');
    expect(pullLifecycle(pull({ draft: false }), { reviews: [r('lee', 'CHANGES_REQUESTED')] }).review.verdict).toEqual({ kind: 'changes', login: 'lee' });
  });

  it('names an exploration from its block, else its title', () => {
    expect(explorationNameOf({ number: 3, body: block({ name: 'denser tables' }) })).toBe('Denser tables');
    expect(explorationNameOf({ number: 3, title: 'Exploration: billing screen' })).toBe('Billing screen');
    expect(explorationNameOf({ number: 3 })).toBe('Exploration #3');
  });
});
