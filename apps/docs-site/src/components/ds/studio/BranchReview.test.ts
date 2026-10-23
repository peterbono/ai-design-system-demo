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

  const work = {
    kind: 'exploration' as const,
    product: 'Account app',
    purpose: 'Try the new profile page with customers.',
    useCase: 'Prototype for a user test',
    experimental: ['Account app: profile page'],
    previews: [{ label: 'Component sandbox', url: 'https://sandbox.example/' }],
    tryUrl: 'https://admin.example/?bridge=36',
    previewState: 'missing' as const,
  };
  const code = { files: ['apps/account/src/pages/Profile.tsx'], branch: 'explore/profile-page', url: 'https://github.com/o/r/pull/36', number: 36, install: null };

  it('shows a designer an exploration: why, Try it in the product, its previews and Share, the code folded', () => {
    render(createElement(BranchReview, { ...base, productWork: work, code }));
    expect(screen.getByRole('heading', { name: /See it/ })).toBeTruthy();
    expect(screen.getByText(/An exploration in Account app/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try it in the product' }).getAttribute('href')).toBe('https://admin.example/?bridge=36');
    expect(screen.getByRole('link', { name: 'Open in Component sandbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'For developers' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/the changes are code/);
  });

  it('says why there is nothing to try yet', () => {
    render(createElement(BranchReview, { ...base, productWork: { ...work, previews: [], tryUrl: null, previewState: 'none' }, code }));
    expect(screen.getByText(/No preview of it yet\. Once Account app publishes a preview/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Try it in the product' })).toBeNull();
  });
});
