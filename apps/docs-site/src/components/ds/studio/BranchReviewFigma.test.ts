// @vitest-environment jsdom
// The branch page of a change sent from the Figma plugin (decision RT-1), composed as scripts/reviews.ts composes it:
// the status line (scripts/change-status detailStatus), the who line (lib/review-page whoLine), the decision bar
// (reviewActions), rendered by BranchReview. Before the draft it waits on a developer and the designer has nothing to
// send; after the draft (drafted-by-claude) it is ready for review even while GitHub still calls it a draft.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BranchReview, type BranchReviewProps } from './BranchReview';
import { detailStatus, type StatusPull } from '../../../scripts/change-status';
import { reviewActions, whoLine } from '../../../lib/review-page';
import { claudeStage } from '../../../lib/review-rules';

const none = { approvers: [], changesRequested: [], design: false, tech: false, owner: false };

const pull = (label: string): StatusPull => ({
  number: 17,
  title: 'Button: add a lg size',
  state: 'open',
  draft: true,
  labels: [{ name: 'from-figma' }, { name: label }],
  user: { login: 'ann' },
  head: { ref: 'figma/button-lg', sha: 'h', repo: { full_name: 'o/r' } },
  base: { ref: 'main', sha: 'b' },
});

/** The page as the designer who sent it sees it (`isAuthor`), or as the design owner (`asked`). */
function page(label: string, viewer: { isAuthor: boolean; asked?: boolean; canApprove?: boolean }): BranchReviewProps {
  const p = pull(label);
  const status = detailStatus({
    pull: p,
    tier: 2,
    approvals: none as never,
    story: { developerFailing: 0 } as never,
    checks: [],
    files: ['packages/react/src/Button/Button.tsx'],
    exploration: false,
    isAuthor: viewer.isAuthor,
    sentence: 'Waiting for the design owner (@dana) to approve.',
    yourTurn: Boolean(viewer.canApprove),
  });
  const line = whoLine({ author: 'Ann', agent: false, guidanceOnly: false, canEdit: false, asked: Boolean(viewer.asked), lifecycle: status.lifecycle, sentence: status.sentence });
  const actions = reviewActions({
    lifecycle: status.lifecycle,
    connected: true,
    canWrite: true,
    isAuthor: viewer.isAuthor,
    canApprove: Boolean(viewer.canApprove),
    canMerge: false,
    mergeAfterApprove: false,
    overrideOnly: false,
    visual: false,
    shareable: false,
    exploration: false,
    statusAction: null,
    claudeWaiting: claudeStage(p.labels) === 'waiting',
  });
  return {
    pr: 17,
    crumbs: [{ label: 'Branches', href: '/studio/changes/' }, { label: p.title }],
    title: p.title,
    jira: null,
    status: { label: status.label, tone: status.tone, lifecycle: status.lifecycle },
    who: { person: { login: 'ann', name: 'Ann', avatarUrl: null, agent: false }, lead: line.lead, rest: line.rest },
    changes: [],
    looked: [],
    onLooked: () => undefined,
    tokens: null,
    guidance: {},
    canEditGuidance: false,
    onSaveGuidance: async () => undefined,
    visual: null,
    product: 'Admin demo',
    tryUrl: null,
    people: {},
    conversation: { count: 0, latest: null, earlier: [] },
    fileComments: [],
    checks: { state: 'pass', text: 'All checks pass', rows: [] },
    approvals: [{ label: 'Design approval', state: 'waiting', text: 'Waiting for Dana' }],
    update: null,
    actions,
    onAct: async () => undefined,
    onOverride: () => undefined,
    onDraft: async () => undefined,
    onClose: async () => undefined,
    links: { review: 'https://bridge.example/r/17', developer: 'https://github.com/o/r/pull/17' },
    share: null,
  };
}

describe('BranchReview: a change sent from Figma (RT-1)', () => {
  it('before the draft: a developer builds it with Claude, the designer is never asked to request a review', () => {
    render(createElement(BranchReview, page('waiting-for-claude', { isAuthor: true })));
    expect(screen.getByText('A developer builds it with Claude. You will see the code here.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/to request a review|Request a review when|to send (it|this draft) for review|Send it for review when/);
    expect(screen.queryByRole('button', { name: 'Send for review' })).toBeNull();
  });

  it('after the draft: ready for review though GitHub still calls it a draft, waiting for the owners', () => {
    const props = page('drafted-by-claude', { isAuthor: true });
    expect(props.status.lifecycle).toBe('ready');
    render(createElement(BranchReview, props));
    expect(screen.getByText('Ready for review. Claude drafted the code from your Figma change. Waiting for the design system owners.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/to request a review|to send (it|this draft) for review/);
    expect(screen.queryByRole('button', { name: 'Send for review' })).toBeNull();
  });

  it('after the draft: the design owner can approve it', () => {
    render(createElement(BranchReview, page('drafted-by-claude', { isAuthor: false, asked: true, canApprove: true })));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });
});
