import { describe, expect, it } from 'vitest';
import { declineNoteOf, designReviewComment, designReviewOf, devPullOfTimeline, devQuestionOf, plainText, taskDeclined, taskStage, explorationLifecycle, explorationNameOf, lastSays, LIFECYCLE_LABEL, needsReviewRead, pullLifecycle, reviewAsked, reviewersAsked, reviewLine, reviewsFromStatus, reviewStateOf, reviewVerdictOf, waitsOnViewer, type LifecyclePull } from './review-state';
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

describe("the developers' version of a design task", () => {
  const xref = (number: number, repo: string, state = 'open', extra: Record<string, unknown> = {}) => ({
    event: 'cross-referenced',
    source: { type: 'issue', issue: { number, html_url: `https://github.com/${repo}/pull/${number}`, state, pull_request: { merged_at: null }, repository: { full_name: repo }, ...extra } },
  });

  it('finds the newest open pull request of the developers that links the task', () => {
    const events = [
      { event: 'labeled' },
      xref(5, 'acme/shop'),
      { event: 'cross-referenced', source: { type: 'issue', issue: { number: 6, html_url: 'https://github.com/acme/shop/issues/6', state: 'open', repository: { full_name: 'acme/shop' } } } },
      xref(7, 'acme/shop-design'),
      xref(8, 'acme/shop', 'closed'),
      xref(9, 'Acme/Shop', 'open', { draft: true }),
    ];
    expect(devPullOfTimeline(events, 'acme/shop')).toEqual({ number: 9, url: 'https://github.com/Acme/Shop/pull/9', draft: true });
    expect(devPullOfTimeline(events.slice(0, 4), 'acme/shop')).toEqual({ number: 5, url: 'https://github.com/acme/shop/pull/5' });
    expect(devPullOfTimeline([xref(10, 'acme/shop', 'open', { pull_request: { merged_at: '2026-10-31T00:00:00Z' } })], 'acme/shop')).toBeNull();
    expect(devPullOfTimeline([], 'acme/shop')).toBeNull();
  });

  it('reads the stage from the task and that pull request', () => {
    const open = { assignees: [], state: 'open', stateReason: null, closedAt: null };
    expect(taskStage(open)).toBe('waiting-for-code');
    expect(taskStage({ ...open, assignees: [{ login: 'sam' }] })).toBe('being-built');
    expect(taskStage({ ...open, devPull: { number: 9, url: 'u' } })).toBe('in-review');
    expect(taskStage({ ...open, devPull: { number: 9, url: 'u', draft: true } })).toBe('being-built');
    expect(taskStage({ ...open, state: 'closed', stateReason: 'completed', devPull: { number: 9, url: 'u' } })).toBe('shipped');
    // Closed without being built: Not planned (every caller reads an exploration taken back as running first).
    expect(taskStage({ ...open, state: 'closed', stateReason: 'not_planned' })).toBe('not-planned');
    expect(taskDeclined({ state: 'closed', stateReason: 'not_planned' })).toBe(true);
    expect(taskDeclined({ state: 'closed', stateReason: 'completed' })).toBe(false);
    expect(taskDeclined({ state: 'open', stateReason: null })).toBe(false);
    // The designer said it looks right on their version: the next state, not In review.
    expect(taskStage({ ...open, devPull: { number: 9, url: 'u', answer: { kind: 'looks-right', login: 'ann' } } })).toBe('approved');
    expect(taskStage({ ...open, devPull: { number: 9, url: 'u', answer: { kind: 'changes', login: 'ann' } } })).toBe('in-review');
    expect(LIFECYCLE_LABEL.approved).toBe('Approved, waiting to ship');
    expect(LIFECYCLE_LABEL['not-planned']).toBe('Not planned');
  });

  it('finds the pull request that shipped a task, for who said it looks right', () => {
    const merged = xref(12, 'acme/shop', 'closed', { pull_request: { merged_at: '2026-10-31T00:00:00Z' } });
    expect(devPullOfTimeline([merged], 'acme/shop')).toBeNull();
    expect(devPullOfTimeline([xref(11, 'acme/shop'), merged], 'acme/shop', { merged: true })).toEqual({ number: 12, url: 'https://github.com/acme/shop/pull/12' });
  });
  it('posts the answer in developer words and finds the last one again', () => {
    expect(designReviewComment({ kind: 'looks-right' })).toBe('Design review from Bridge: looks right.');
    expect(designReviewComment({ kind: 'changes', text: ' Bigger title.  ' })).toBe('Design review from Bridge: needs changes: Bigger title.');
    const comments = [
      { body: designReviewComment({ kind: 'changes', text: 'Bigger title.' }), user: { login: 'ann' }, created_at: '2026-10-31T09:00:00Z' },
      { body: 'Done, have another look.', user: { login: 'sam' }, created_at: '2026-10-31T10:00:00Z' },
    ];
    expect(designReviewOf(comments)).toEqual({ kind: 'changes', login: 'ann', text: 'Bigger title.', at: '2026-10-31T09:00:00Z' });
    expect(designReviewOf([...comments, { body: designReviewComment({ kind: 'looks-right' }), user: { login: 'ann' }, created_at: '2026-10-31T11:00:00Z' }])).toMatchObject({ kind: 'looks-right', text: null });
    expect(designReviewOf([{ body: 'Looks right to me', user: { login: 'x' } }])).toBeNull();
  });
});

describe("the developers' question on a design task", () => {
  const DONE = '2026-10-30T10:00:00Z';
  const c = (login: string, body: string, at: string, type?: string) => ({ body, user: { login, ...(type ? { type } : {}) }, created_at: at });
  const open = { state: 'open', labels: [] as string[] };

  it('takes the latest comment after Done exploring by someone who is neither Bridge nor the designer', () => {
    const comments = [
      c('sam', 'Old question, before Done exploring', '2026-10-29T10:00:00Z'),
      c('sam', 'Should the badge be **red** or <b>orange</b>?', '2026-10-31T09:00:00Z'),
      c('bridge-ds[bot]', 'Done exploring again.', '2026-10-31T09:30:00Z', 'Bot'),
    ];
    const q = devQuestionOf({ ...open, comments }, { doneAt: DONE, designers: ['ann'] });
    expect(q).toEqual({ text: 'Should the badge be red or orange?', login: 'sam', at: '2026-10-31T09:00:00Z', answered: true });
    // Bridge's own words never ask: its app, a reply posted for a member, a design review, taking it back.
    const only = devQuestionOf({ ...open, comments: [comments[1]!] }, { doneAt: DONE, designers: ['ann'] });
    expect(only?.answered).toBe(false);
  });

  it('reads as answered once the designer (or Bridge for them) wrote after it', () => {
    const asked = c('sam', 'Which icon?', '2026-10-31T09:00:00Z');
    expect(devQuestionOf({ ...open, comments: [asked, c('Ann', 'The outline one.', '2026-10-31T10:00:00Z')] }, { doneAt: DONE, designers: ['ann'] })?.answered).toBe(true);
    expect(devQuestionOf({ ...open, comments: [asked, c('bridge-ds[bot]', '**Ann Leroy** (via Bridge):\n\nThe outline one.', '2026-10-31T10:00:00Z')] }, { doneAt: DONE })?.answered).toBe(true);
    // A designer's own comment alone is never a question; Bridge's are not either.
    expect(devQuestionOf({ ...open, comments: [c('ann', 'Note to self', '2026-10-31T09:00:00Z')] }, { doneAt: DONE, designers: ['ann'] })).toBeNull();
    expect(devQuestionOf({ ...open, comments: [c('lee', 'Design review from Bridge: looks right.', '2026-10-31T09:00:00Z'), c('lee', 'The design team took this back to exploring. It comes back here when they say Done exploring again.', '2026-10-31T09:10:00Z')] }, { doneAt: DONE })).toBeNull();
  });

  it('honours a needs-design label as a question without words, and nothing on a closed task', () => {
    expect(devQuestionOf({ state: 'open', labels: ['Needs-Design'], comments: null }, { doneAt: DONE })).toEqual({ text: null, login: null, at: null, answered: false });
    expect(devQuestionOf({ state: 'open', labels: ['needs-design'], comments: [c('ann', 'See the preview', '2026-10-31T09:00:00Z')] }, { doneAt: DONE, designers: ['ann'] })?.answered).toBe(true);
    expect(devQuestionOf({ state: 'closed', labels: ['needs-design'], comments: [c('sam', 'Hm?', '2026-10-31T09:00:00Z')] }, { doneAt: DONE })).toBeNull();
    expect(devQuestionOf({ state: 'open', labels: [], comments: [] }, { doneAt: DONE })).toBeNull();
  });

  it("keeps the developers' last word when they close it without building it", () => {
    const comments = [c('sam', 'We are not doing this quarter.', '2026-10-31T09:00:00Z'), c('bridge-ds[bot]', 'x', '2026-10-31T09:10:00Z', 'Bot')];
    expect(declineNoteOf({ comments }, { designers: ['ann'] })).toEqual({ text: 'We are not doing this quarter.', login: 'sam', at: '2026-10-31T09:00:00Z' });
    expect(declineNoteOf({ comments: [] })).toBeNull();
  });

  it('turns a comment into plain words: no HTML, no images, links as their words', () => {
    expect(plainText('<!-- hidden --><script>alert(1)</script>Hi ![x](http://a/b.png)[the spec](https://x.y) `code`\n\n\n\nBye')).toBe('alert(1)Hi the spec code\n\nBye');
  });
});

describe('the lifecycle words stay designer words', () => {
  it('never uses tech words for the new states', () => {
    for (const s of [LIFECYCLE_LABEL.approved, LIFECYCLE_LABEL['not-planned']]) expect(jargonIn(s)).toEqual([]);
  });

});
