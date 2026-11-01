import { describe, expect, it } from 'vitest';
import { branchPreviewUrl } from '@bridge-ds/core';
import { devReviewLine, devVersionUrl, DEV_VERSION_READY } from './review-state';
import { withTaskRow } from './explorations-view';
import { withTaskStage } from './home-explorations';
import { libraryTodayRoute, todayLinkLabel } from './exploration-page';
import { COPY_WORDS } from './design-copy';

const PRODUCT = 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app';

describe('the developers version', () => {
  it('opens the product preview of their branch, never the copy', () => {
    expect(devVersionUrl({ headRef: 'dev/dashboard-orders' }, PRODUCT, branchPreviewUrl)).toBe('https://bridge-product-admin-git-dev-dashboa-1ae1b9-peterbonos-projects.vercel.app/');
  });
  it('prefers the deployment GitHub lists for their head', () => {
    expect(devVersionUrl({ headRef: 'dev/x', deployedUrl: 'https://bridge-product-admin-abc123-peterbonos-projects.vercel.app' }, PRODUCT, branchPreviewUrl)).toBe('https://bridge-product-admin-abc123-peterbonos-projects.vercel.app');
  });
  it('is null without a branch or a pattern', () => {
    expect(devVersionUrl({ headRef: null }, PRODUCT, branchPreviewUrl)).toBeNull();
    expect(devVersionUrl({ headRef: 'dev/x' }, undefined, branchPreviewUrl)).toBeNull();
  });
});

describe('the Review line in lists', () => {
  const nameOf = (l: string) => (l === 'peterbono' ? 'Florian' : l);
  it('waits for the designer until they answer', () => expect(devReviewLine({ answer: null }, nameOf)).toBe(DEV_VERSION_READY));
  it('says who answered what', () => {
    expect(devReviewLine({ answer: { kind: 'looks-right', login: 'peterbono' } }, nameOf)).toBe('Florian said it looks right');
    expect(devReviewLine({ answer: { kind: 'changes', login: 'peterbono' } }, nameOf)).toBe('Florian asked for changes');
  });
});

describe('lists take the task words', () => {
  const row = { status: 'ready' as const, statusLabel: 'Waiting to be picked up', archived: false };
  it('Changes rows', () => {
    expect(withTaskRow(row, 'in-review')).toMatchObject({ status: 'building', statusLabel: 'In review' });
    expect(withTaskRow(row, 'being-built')).toMatchObject({ status: 'building', statusLabel: 'Being built' });
    expect(withTaskRow(row, 'shipped')).toMatchObject({ status: 'shipped', statusLabel: 'Shipped' });
    expect(withTaskRow(row, null)).toBe(row);
    expect(withTaskRow({ ...row, status: 'active' as const }, 'in-review').status).toBe('active');
    expect(withTaskRow({ ...row, archived: true }, 'in-review')).toMatchObject({ statusLabel: 'Waiting to be picked up' });
  });
  it('Home and product cards', () => {
    const handed = { stage: 'with-devs' as const, state: 'Waiting to be picked up' };
    expect(withTaskStage(handed, 'in-review').state).toBe('In review');
    expect(withTaskStage(handed, 'closed')).toBe(handed);
    expect(withTaskStage({ stage: 'exploring', state: 'Exploring' }, 'in-review').state).toBe('Exploring');
  });
});

describe('a library exploration', () => {
  it('opens the library, on its component when it asks about one', () => {
    expect(libraryTodayRoute('Link')).toBe('components/link/');
    expect(libraryTodayRoute('Icon Button')).toBe('components/icon-button/');
    expect(libraryTodayRoute(null)).toBe('');
    expect(todayLinkLabel(true)).toBe('See the library today');
    expect(todayLinkLabel(false)).toBe('See the product today');
  });
});

describe('bringing the latest into a running exploration', () => {
  it('says it in designer words', () => {
    expect(COPY_WORDS.explorationBehind('Art print shop')).toBe('Art print shop changed since this exploration started.');
    expect(COPY_WORDS.bringConflict).toBe('Bridge could not bring it in on its own. Ask a developer.');
    for (const w of [COPY_WORDS.bringIn, COPY_WORDS.broughtIn, COPY_WORDS.bringConflict, COPY_WORDS.bringFailed]) expect(w).not.toMatch(/branch|merge|fork|repositor/i);
  });
});
