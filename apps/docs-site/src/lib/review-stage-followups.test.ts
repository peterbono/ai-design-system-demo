import { describe, expect, it } from 'vitest';
import { branchPreviewUrl } from '@bridge-ds/core';
import { askerRole, devReviewLine, devVersionUrl, DEV_VERSION_READY, questionLine } from './review-state';
import { withTaskRow } from './explorations-view';
import { cardTag, withTaskStage } from './home-explorations';
import { changedScreenOf, clipQuote, explorationTag, libraryTodayRoute, questionWords, todayLinkLabel } from './exploration-page';
import { badgeRows, devQuestionNeed, type Person } from './home-model';
import { jargonIn } from './vocabulary';
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
  it('Approved, waiting to ship and Not planned, in designer words', () => {
    expect(withTaskRow(row, 'approved')).toMatchObject({ status: 'building', statusLabel: 'Approved, waiting to ship' });
    // Declined while still handed off: listed, under its own words, never dropped.
    expect(withTaskRow(row, 'not-planned')).toMatchObject({ status: 'ready', statusLabel: 'Not planned' });
    // Taken back by Bridge's Back to exploring: the exploration runs again, its own words stay.
    expect(withTaskRow({ ...row, status: 'active' as const, statusLabel: 'Exploring' }, 'not-planned')).toMatchObject({ status: 'active', statusLabel: 'Exploring' });
    const handed = { stage: 'with-devs' as const, state: 'Waiting to be picked up' };
    expect(withTaskStage(handed, 'not-planned').state).toBe('Not planned');
    expect(withTaskStage(handed, 'approved').state).toBe('Approved, waiting to ship');
    expect(cardTag('with-devs', 'Not planned')).toEqual({ tone: 'neutral', dot: false });
    expect(cardTag('with-devs', 'Approved, waiting to ship')).toEqual({ tone: 'info', dot: false });
    expect(explorationTag('ready', { stage: 'not-planned' })).toEqual({ label: 'Not planned', tone: 'neutral', dot: false });
    expect(explorationTag('building', { stage: 'approved' })).toEqual({ label: 'Approved, waiting to ship', tone: 'info', dot: false });
  });
});

describe("a developers' question quoted on the page", () => {
  it('shows short words whole, and cuts long ones at a word with Show more', () => {
    expect(clipQuote('  Red or orange?  ')).toEqual({ short: 'Red or orange?', clipped: false });
    const long = `${'word '.repeat(80)}end`;
    const cut = clipQuote(long, 100);
    expect(cut.clipped).toBe(true);
    expect(cut.short.length).toBeLessThanOrEqual(101);
    expect(cut.short.endsWith('word…')).toBe(true);
  });
});

describe('the Needs you row for a question', () => {
  const sam = { login: 'sam', name: 'Sam', avatar: null } as unknown as Person;
  it('asks the explorer to answer, waits on them, and counts in the badge', () => {
    const row = devQuestionNeed({ key: 'shop#12', name: 'Checkout flow', href: '/studio/changes/?exploration=12&product=shop', asker: sam, since: null, thumb: { kind: 'icon', icon: 'branch' } }, Date.now());
    expect(row).toMatchObject({ key: 'dev-question-shop#12', kind: 'own', title: 'Checkout flow', line: 'Sam asked a question', waitsOnYou: true, action: 'Answer', question: true });
    expect(badgeRows([row, { ...row, key: 'x', question: false }])).toBe(1);
    expect(jargonIn(`${row.title} ${row.line}`)).toEqual([]);
  });

  it("names a lead who asks with their part, and nobody when only the label asks: never 'the developers' by default", () => {
    const florian = { login: 'peterbono', name: 'Florian', avatar: null } as unknown as Person;
    const row = devQuestionNeed({ key: 'shop#4', name: 'Add a toast alert', href: '/x', asker: florian, role: 'design lead', since: null, thumb: { kind: 'icon', icon: 'branch' } }, Date.now());
    expect(row.line).toBe('Florian, design lead, asked a question');
    expect(devQuestionNeed({ key: 'shop#4', name: 'x', href: '/x', asker: null, since: null, thumb: { kind: 'icon', icon: 'branch' } }, Date.now()).line).toBe('Your input is needed');
  });
});

describe("who asked a question, and their part on the team", () => {
  const owners = { design: ['peterbono', 'acme/design-team'], tech: ['PeterBono', 'ana'] };
  it('a design owner is the design lead, a tech owner the tech lead, anyone else has no part said', () => {
    expect(askerRole('peterbono', owners)).toBe('design lead');
    expect(askerRole('@Ana', owners)).toBe('tech lead');
    expect(askerRole('sam', owners)).toBeNull();
    // A GitHub team entry never matches a login; nothing known, nothing said.
    expect(askerRole('design-team', owners)).toBeNull();
    expect(askerRole(null, owners)).toBeNull();
    expect(askerRole('peterbono', null)).toBeNull();
  });

  it('the line names the person, with their part only when Bridge knows it', () => {
    expect(questionLine({ name: 'Florian' }, 'design lead')).toBe('Florian, design lead, asked a question');
    expect(questionLine({ name: 'Florian' })).toBe('Florian asked a question');
    expect(questionLine(null)).toBe('Your input is needed');
  });

  it('the reply words are neutral about where the answer goes, and name the asker', () => {
    expect(questionWords({ name: 'Florian Gouloubi' })).toMatchObject({ hint: 'They read your answer where they work.', send: 'Send to Florian', sent: 'Sent to Florian Gouloubi.' });
    expect(questionWords(null)).toMatchObject({ send: 'Send your answer', sent: 'Your answer is sent.' });
    const all = JSON.stringify([questionWords({ name: 'Florian' }), questionWords(null)]);
    expect(all).not.toMatch(/developers|—/i);
    expect(jargonIn(all)).toEqual([]);
  });
});

describe('the screen an exploration plate names', () => {
  it("a screen the exploration changed, else the product alone: a component or a translation is no screen", () => {
    expect(changedScreenOf(['src/i18n/en.ts', 'src/resources/orders/OrderList.tsx'])).toBe('Order list');
    expect(changedScreenOf(['apps/shop/src/pages/ProfilePage.tsx'])).toBe('Profile page');
    expect(changedScreenOf(['src/components/Toast.tsx', 'src/i18n/fr.ts'])).toBeNull();
    // A library exploration explores its components.
    expect(changedScreenOf(['packages/react/src/components/Toast/Toast.tsx'], { library: true })).toBe('Toast');
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
