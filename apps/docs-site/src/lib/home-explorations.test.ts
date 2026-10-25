import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTS, type ProductConfig } from '@bridge-ds/core';
import {
  explorationProduct,
  explorationsFor,
  explorationStage,
  explorationTitle,
  homeExplorations,
  isHomeExploration,
  isOwnExploration,
  libraryChangesLine,
  libraryChangesOf,
  SCREEN_SKETCH,
  type ExplorationPull,
} from './home-explorations';
import { person } from './home-model';

const products: ProductConfig[] = [
  { key: 'account', name: 'Account', path: 'apps/account' },
  { key: 'library', name: 'Library', default: true },
];

const block = (name: string, author?: string) => `<!-- bridge-exploration ${JSON.stringify({ name, purpose: 'Try it', slug: 'x', ...(author ? { author } : {}) })} -->`;
const pieces = (n: number) =>
  `<!-- bridge-pieces ${JSON.stringify({ checkedAt: '2026-10-21T22:50:22.497Z', headSha: 'abc', pieces: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'token', title: `Piece ${i}`, values: [] })), fixes: 0, links: [] })} -->`;

const pull = (n: number, extra: Partial<ExplorationPull> = {}): ExplorationPull => ({
  number: n,
  title: `feat(tokens): change ${n}`,
  user: { login: 'peterbono' },
  updated_at: `2026-10-2${n % 10}T10:00:00Z`,
  head: { ref: `bridge/change-${n}` },
  labels: [],
  ...extra,
});

// The sample team's open pull requests, as GitHub lists them (peterbono/bridge-demo-ds).
const profile = pull(36, {
  draft: true,
  title: 'Exploration: profile page',
  labels: [{ name: 'product: account' }, { name: 'exploration' }],
  head: { ref: 'explore/profile-page' },
  body: `${block('Profile page')}\n${pieces(0)}\nRequested by Ann Leroy.`,
});
const billing = pull(45, { title: 'Billing: invoice status as badges', labels: [{ name: 'tier: 1' }, { name: 'product: account' }], head: { ref: 'agent/billing-invoice-status' }, body: 'Requested by Sofia Reyes.' });
const card = pull(24, { draft: true, title: 'Card: subtle tone for secondary groups', labels: [{ name: 'tier: 2' }], head: { ref: 'agent/request-card-subtle' } });
const corners = pull(15, { draft: true, title: 'feat(tokens): Tighter card and panel corners', labels: [{ name: 'tokens' }, { name: 'tier: 3' }], head: { ref: 'bridge/tighter-card-and-panel-corners' } });
const guidance = pull(28, { title: 'Slider: usage guidance drafted by Claude', labels: [{ name: 'docs' }], head: { ref: 'docs/slider-20261021-fu6k' } });
const release = pull(9, { title: 'Version packages', user: { login: 'github-actions[bot]', type: 'Bot' }, labels: [{ name: 'product: account' }] });

const who = (p: ExplorationPull) => person(p.user!.login, null, null);

describe('the explorations of the Studio home', () => {
  it('shows explorations and branches started for a product, never library changes', () => {
    const cards = homeExplorations([card, profile, corners, billing, guidance, release], { products, author: who });
    expect(cards.map((c) => c.number)).toEqual([36, 45]);
    expect(libraryChangesOf([card, profile, corners, billing, guidance], products).map((p) => p.number)).toEqual([24, 15, 28]);
  });

  it('reads an exploration by its label, its explore/ branch or the Bridge block, product or not', () => {
    expect(isHomeExploration(pull(1, { labels: [{ name: 'exploration' }] }), products)).toBe(true);
    expect(isHomeExploration(pull(2, { head: { ref: 'explore/pill-buttons' } }), products)).toBe(true);
    expect(isHomeExploration(pull(3, { body: block('Pill buttons') }), products)).toBe(true);
    expect(isHomeExploration(pull(4, { labels: ['product: library'] }), products)).toBe(false);
    expect(isHomeExploration(pull(5, { labels: [{ name: 'product: admin' }] }), DEFAULT_PRODUCTS)).toBe(true);
  });

  it('names the product it is tried in, the configured name first', () => {
    expect(explorationProduct(profile, products)).toBe('Account');
    expect(explorationProduct(pull(1, { labels: [{ name: 'product: admin' }] }), DEFAULT_PRODUCTS)).toBe('Admin demo');
    // A product the settings do not list still reads in words.
    expect(explorationProduct(pull(2, { labels: [{ name: 'product: checkout' }] }), products)).toBe('Checkout');
    expect(explorationProduct(pull(3, { labels: [{ name: 'product: library' }] }), products)).toBeNull();
    expect(explorationProduct(card, products)).toBeNull();
  });

  it('says where each one stands in designer words', () => {
    expect(explorationStage(profile)).toEqual({ stage: 'exploring', state: 'Exploring' });
    expect(explorationStage({ ...profile, body: pieces(1) })).toEqual({ stage: 'found', state: '1 new piece found' });
    expect(explorationStage({ ...profile, body: pieces(2) })).toEqual({ stage: 'found', state: '2 new pieces found' });
    expect(explorationStage(billing)).toEqual({ stage: 'in-review', state: 'In review' });
    // Promoted: the label is gone and it waits for its approvals.
    expect(explorationStage({ ...profile, draft: false, labels: [{ name: 'product: account' }] }).state).toBe('In review');
    expect(explorationStage({ ...profile, state: 'closed', merged_at: '2026-10-23T10:00:00Z' })).toEqual({ stage: 'kept', state: 'Kept in the library' });
  });

  it('titles a card with the exploration name, else the title for people', () => {
    expect(explorationTitle(profile)).toBe('Profile page');
    expect(explorationTitle(billing)).toBe('Billing: invoice status as badges');
    expect(explorationTitle(pull(7, { title: 'Exploration: pill buttons' }))).toBe('Pill buttons');
  });

  it('opens the exploration page while it is one, the change page once it is a plain change', () => {
    const [p, b] = homeExplorations([profile, billing], { products, author: who });
    expect(p!.href).toMatch(/changes\/\?exploration=36$/);
    expect(b!.href).toMatch(/changes\/\?pr=45$/);
  });

  it('keeps the explored screen when known, a sketch otherwise: never a generic icon', () => {
    const shot = { kind: 'screen', src: '/sample/explorations/profile-page.png' } as const;
    const cards = homeExplorations([profile, billing], { products, author: who, preview: (p) => (p.number === 36 ? shot : null) });
    expect(cards.map((c) => c.preview)).toEqual([shot, SCREEN_SKETCH]);
    expect(cards.every((c) => c.preview.kind === 'screen')).toBe(true);
  });

  it('lists the ones still being tried first, newest first inside', () => {
    const older = pull(50, { ...profile, number: 50, updated_at: '2026-10-01T10:00:00Z' });
    const cards = homeExplorations([billing, older, profile], { products, author: who });
    expect(cards.map((c) => [c.number, c.stage])).toEqual([
      [36, 'exploring'],
      [50, 'exploring'],
      [45, 'in-review'],
    ]);
  });

  it("keeps a member's own: opened, asked for, or started by them", () => {
    const ann = pull(60, { ...profile, number: 60, user: { login: 'claude-bot' }, body: `${block('Checkout', 'ann')}` });
    expect(isOwnExploration(ann, 'Ann')).toBe(true);
    expect(isOwnExploration(pull(61, { body: 'Requested by Ann Leroy (@ann).' }), 'ann')).toBe(true);
    expect(isOwnExploration(profile, 'peterbono')).toBe(true);
    expect(isOwnExploration(profile, 'dana')).toBe(false);
    expect(isOwnExploration(profile, null)).toBe(false);
    expect(homeExplorations([profile, ann], { products, author: who, viewer: 'ann', onlyOwn: true }).map((c) => c.number)).toEqual([60]);
    // No viewer given (the demo, from the lead's seat): the whole team's.
    expect(homeExplorations([profile, ann], { products, author: who }).length).toBe(2);
    // A lead's home: the whole team's, each marked whether it is theirs.
    expect(homeExplorations([profile, ann], { products, author: who, viewer: 'ann' }).map((c) => [c.number, c.own])).toEqual([
      [60, true],
      [36, false],
    ]);
  });

  it('reads a merged exploration among the closed ones as kept, and leaves out one closed without merging', () => {
    const kept = pull(48, {
      title: 'Exploration: plan comparison',
      state: 'closed',
      merged_at: '2026-10-25T21:30:52Z',
      labels: [{ name: 'product: account' }, { name: 'tier: 2' }],
      head: { ref: 'explore/plan-comparison' },
      body: block('Plan comparison'),
    });
    const closed = pull(49, { ...kept, number: 49, merged_at: null, head: { ref: 'explore/given-up' } });
    const cards = homeExplorations([profile, billing, kept, closed, profile], { products, author: who });
    expect(cards.map((c) => [c.number, c.state])).toEqual([
      [36, 'Exploring'],
      [45, 'In review'],
      [48, 'Kept in the library'],
    ]);
    // Kept: it is a change of the library now, its page is the change page.
    expect(cards[2]!.href).toMatch(/changes\/\?pr=48$/);
  });

  it('gives a contributor their own only, a lead or reviewer the team', () => {
    const cards = homeExplorations([profile, billing], { products, author: who, viewer: 'peterbono' }).map((c, i) => ({ ...c, own: i === 0 }));
    expect(explorationsFor(cards, true)).toMatchObject({ title: 'Your explorations', seeAll: '/studio/changes/?who=mine' });
    expect(explorationsFor(cards, true).cards.map((c) => c.number)).toEqual([36]);
    expect(explorationsFor(cards, false)).toMatchObject({ title: 'Explorations', seeAll: '/studio/changes/' });
    expect(explorationsFor(cards, false).cards).toHaveLength(2);
  });

  it('counts the library changes left to Changes in one sentence', () => {
    expect(libraryChangesLine(0)).toBeNull();
    expect(libraryChangesLine(1)).toBe('You have 1 library change in progress.');
    expect(libraryChangesLine(3)).toBe('You have 3 library changes in progress.');
  });
});
