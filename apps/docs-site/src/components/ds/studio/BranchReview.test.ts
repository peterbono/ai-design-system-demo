// @vitest-environment jsdom
// The branch page, designer first: the approvals it needs are in view, and the technical side (failing developer
// tests, the branch on GitHub) folds under "For developers" for tech owners only.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BranchReview, type BranchReviewProps } from './BranchReview';

const base: BranchReviewProps = {
  pr: 17,
  crumbs: [{ label: 'Branches', href: '/studio/changes/' }, { label: 'Add a highlight surface' }],
  title: 'Add a highlight surface',
  jira: null,
  status: { label: 'Blocked by tests', tone: 'danger', lifecycle: 'ready' },
  who: { person: null, lead: null, rest: 'A developer is on the code checks.' },
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
  checks: { state: 'fail', text: 'Code checks fail: a developer is on it.', rows: [{ label: 'Code checks', state: 'fail', text: 'A developer is on it.' }] },
  approvals: [
    { label: 'Design approval', state: 'waiting', text: 'Waiting for Dana' },
    { label: 'Tech approval', state: 'waiting', text: 'Waiting for Malik' },
  ],
  update: null,
  actions: { primary: null, comment: false, suggest: false, menu: { override: null, share: false, draft: false, close: false } },
  onAct: async () => undefined,
  onOverride: () => undefined,
  onDraft: async () => undefined,
  onClose: async () => undefined,
  links: { review: 'https://bridge.example/r/17', developer: 'https://github.com/o/r/pull/17' },
  share: null,
};

describe('BranchReview', () => {
  it('shows a designer the approvals it needs and who acts, never the technical side', () => {
    render(createElement(BranchReview, base));
    expect(screen.getByText('Design approval')).toBeTruthy();
    expect(screen.getByText('Waiting for Malik')).toBeTruthy();
    expect(screen.queryByText('For developers')).toBeNull();
    expect(document.body.textContent).not.toMatch(/#17|developer tests?|GitHub/);
  });

  it('folds the technical side under For developers for a developer', () => {
    render(createElement(BranchReview, { ...base, developer: { tests: '2 developer tests fail. A developer fixes them.', failing: ['Unit tests'], url: 'https://github.com/o/r/pull/17', number: 17 } }));
    expect(screen.getByRole('button', { name: 'For developers' })).toBeTruthy();
  });
});
