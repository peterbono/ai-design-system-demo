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
  ownOpenWork,
  ownWorkHref,
  quietParts,
  quietSentence,
  recentExplorations,
  RECENT_CARDS,
  SCREEN_SKETCH,
  cardTag,
  type ExplorationPull,
} from './home-explorations';
import { person } from './home-model';
import { folderLine } from './product-page';

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
    // Done exploring said but the exploration label could not be removed: with the developers, not running.
    const done = '<!-- bridge-exploration {"name":"Profile page","doneAt":"2026-10-31T13:35:11.487Z","doneSha":"aaa"} -->';
    expect(explorationStage({ ...profile, body: done, head: { ref: 'explore/profile-page', sha: 'aaa' } })).toEqual({ stage: 'with-devs', state: 'Waiting to be picked up' });
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

  it('keeps the explored screen when known, else a plate with the product and the changed screen: never a generic icon', () => {
    const shot = { kind: 'screen', src: '/sample/explorations/profile-page.png' } as const;
    const cards = homeExplorations([profile, billing], { products, author: who, preview: (p) => (p.number === 36 ? shot : null) });
    // The capture keeps what the plate would say (it comes back if the image fails); the card's key picks the drawing.
    expect(cards.map((c) => c.preview)).toEqual([
      { ...shot, product: 'Account', screen: null, seed: '36' },
      { ...SCREEN_SKETCH, product: 'Account', screen: null, seed: '45' },
    ]);
    expect(cards.every((c) => c.preview.kind === 'screen')).toBe(true);
    // Its files read: the plate names the screen it changed.
    const named = homeExplorations([profile], { products, author: who, files: () => ['apps/account/src/pages/ProfilePage.tsx'] });
    expect(named[0]!.preview).toMatchObject({ kind: 'screen', src: null, product: 'Account' });
    expect((named[0]!.preview as { screen: string | null }).screen).toBe('Profile page');
  });

  it('tags each state with the tone of the exploration page', () => {
    expect(cardTag('exploring', 'Not started')).toEqual({ tone: 'neutral', dot: false });
    expect(cardTag('exploring', 'Exploring')).toEqual({ tone: 'info', dot: true });
    expect(cardTag('found', '2 new pieces found')).toEqual({ tone: 'info', dot: true });
    expect(cardTag('with-devs', 'Waiting to be picked up')).toEqual({ tone: 'warning', dot: false });
    expect(cardTag('with-devs', 'Being built')).toEqual({ tone: 'info', dot: true });
    expect(cardTag('kept', 'Shipped')).toEqual({ tone: 'success', dot: false });
    expect(cardTag('kept', 'Kept in the library')).toEqual({ tone: 'success', dot: false });
    expect(cardTag('in-review', 'In review')).toEqual({ tone: 'info', dot: false });
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

  it("keeps a member's own: asked for or started by them, else opened by them", () => {
    const ann = pull(60, { ...profile, number: 60, user: { login: 'claude-bot' }, body: `${block('Checkout', 'ann')}` });
    expect(isOwnExploration(ann, 'Ann')).toBe(true);
    expect(isOwnExploration(pull(61, { body: 'Requested by Ann Leroy (@ann).' }), 'ann')).toBe(true);
    // Nobody named: the account that opened it.
    expect(isOwnExploration(pull(62, { head: { ref: 'explore/x' }, body: block('X') }), 'peterbono')).toBe(true);
    // "Requested by Ann Leroy.": Ann's, even opened with peterbono's account.
    expect(isOwnExploration(profile, 'peterbono')).toBe(false);
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
    expect(explorationsFor(cards, false)).toMatchObject({ title: 'Recent explorations', seeAll: '/studio/changes/' });
    expect(explorationsFor(cards, false).cards).toHaveLength(2);
  });

  it('counts the library changes left to Changes in one sentence', () => {
    expect(libraryChangesLine(0)).toBeNull();
    expect(libraryChangesLine(1)).toBe('You have 1 library change in progress.');
    expect(libraryChangesLine(3)).toBe('You have 3 library changes in progress.');
  });
});

describe("a designer's exploration opened by Bridge's app (designers write through Bridge)", () => {
  const shop: ProductConfig[] = [...products, { key: 'admin-app', name: 'Art print shop', repo: 'art-print-shop-co/art-print-shop' }];
  const app = { login: 'bridge-design-studio[bot]', type: 'Bot' };
  // art-print-shop-co/art-print-shop-design#4, as GitHub lists it: opened by the app for an email member, handed off.
  const dino = pull(4, {
    product: 'admin-app',
    draft: true,
    title: 'Exploration: add a toast alert',
    user: app,
    labels: [{ name: 'exploration' }, { name: 'product: admin-app' }],
    head: { ref: 'explore/add-a-toast-alert' },
    body: `<!-- bridge-exploration ${JSON.stringify({ name: 'add a toast alert', slug: 'add-a-toast-alert', author: 'dinosolo@yopmail.com', doneAt: '2026-11-02T01:40:45.516Z', task: 'https://github.com/art-print-shop-co/art-print-shop/issues/12' })} -->\n\nRequested by Dino through Bridge.`,
  });
  // A GitHub designer's, opened by the app with their login on the line.
  const ann = pull(5, { product: 'admin-app', draft: true, user: app, labels: [{ name: 'exploration' }], head: { ref: 'explore/badges' }, body: `${block('Badges')}\n\nRequested by Ann Leroy (@ann) through Bridge.` });
  // Automation the app opens for nobody stays off the home.
  const bot = pull(6, { product: 'admin-app', user: app, labels: [{ name: 'exploration' }], head: { ref: 'explore/sync' } });

  it('lists it on the home, for the team and as the designer\'s own', () => {
    expect(isHomeExploration(dino, shop)).toBe(true);
    expect(isHomeExploration(ann, shop)).toBe(true);
    expect(isHomeExploration(bot, shop)).toBe(false);
    const cards = homeExplorations([dino, ann, bot], { products: shop, author: who, viewer: 'dinosolo@yopmail.com', taskStage: (p) => (p.number === 4 ? 'waiting-for-code' : null) });
    expect(cards.map((c) => c.number)).toEqual([5, 4]);
    expect(cards.find((c) => c.number === 4)).toMatchObject({ own: true, stage: 'with-devs', state: 'Waiting to be picked up' });
    expect(explorationsFor(cards, true).cards.map((c) => c.number)).toEqual([4]);
    expect(quietSentence(ownOpenWork(cards))).toBe('Nothing needs you. 1 of your explorations waits for a developer to pick it up.');
    // The product card counts the team's: Dino's handed-off one is no longer left out.
    const team = homeExplorations([dino, ann, bot, pull(1, { product: 'admin-app', draft: true, labels: [{ name: 'exploration' }], head: { ref: 'explore/dashboard' }, body: `<!-- bridge-exploration ${JSON.stringify({ name: 'Dashboard', slug: 'dashboard', doneAt: '2026-10-31T10:00:00Z', task: 'https://github.com/art-print-shop-co/art-print-shop/issues/7' })} -->\n\nRequested by Florian.` })], { products: shop, author: who, taskStage: (p) => (p.number === 4 || p.number === 1 ? 'waiting-for-code' : null) });
    expect(team.map((c) => c.number).sort()).toEqual([1, 4, 5]);
    expect(folderLine(team)).toBe('1 exploring · 2 waiting to be picked up');
    // The GitHub designer finds theirs by login.
    const forAnn = homeExplorations([dino, ann], { products: shop, author: who, viewer: 'ann' });
    expect(explorationsFor(forAnn, true).cards.map((c) => c.number)).toEqual([5]);
  });

  it("keeps a member's exploration theirs when Bridge opened it with the lead's account", () => {
    // As art-print-shop-design#4 reads live: opened by peterbono, asked for by Dino (an email member), task shipped.
    const asLead = pull(4, { ...dino, user: { login: 'peterbono' }, body: `<!-- bridge-exploration ${JSON.stringify({ name: 'add a toast alert', slug: 'add-a-toast-alert', doneAt: '2026-11-02T01:40:45.516Z', task: 'https://github.com/art-print-shop-co/art-print-shop/issues/12', member: '254dfac3665d4d07', memberName: 'Dino' })} -->\n\nRequested by Dino through Bridge.` });
    const florians = pull(1, { product: 'admin-app', draft: true, user: { login: 'peterbono' }, labels: [{ name: 'ready-for-devs' }, { name: 'product: admin-app' }], head: { ref: 'explore/dashboard' }, body: `<!-- bridge-exploration ${JSON.stringify({ name: 'Dashboard', slug: 'dashboard', doneAt: '2026-10-31T10:00:00Z', task: 'https://github.com/art-print-shop-co/art-print-shop/issues/7' })} -->` });
    expect(isOwnExploration(asLead, 'peterbono')).toBe(false);
    expect(isOwnExploration(asLead, null, '254dfac3665d4d07')).toBe(true);
    expect(isOwnExploration(florians, 'peterbono')).toBe(true);
    const cards = homeExplorations([asLead, florians], { products: shop, author: who, viewer: 'peterbono', taskStage: (p) => (p.number === 4 ? 'shipped' : 'waiting-for-code') });
    expect(cards.map((c) => [c.number, c.own, c.state])).toEqual(expect.arrayContaining([[4, false, 'Shipped'], [1, true, 'Waiting to be picked up']]));
    // "2 waiting to be picked up" on the live Home: one shipped, and Dino's. Only Florian's own counts.
    expect(quietSentence(ownOpenWork(cards))).toBe('Nothing needs you. 1 of your explorations waits for a developer to pick it up.');
  });
});

describe('the state of a running exploration card, from its files', () => {
  const opts = (files: Record<number, string[] | null | undefined>) => ({ products, author: who, files: (p: ExplorationPull) => files[p.number] });

  it('says "Not started" while only the Bridge note changed, as its page', () => {
    const [c] = homeExplorations([profile], opts({ 36: ['.bridge/explorations/profile-page.md'] }));
    expect(c!.state).toBe('Not started');
    expect(c!.stage).toBe('exploring');
  });

  it('says "Exploring" once something else changed, or when the files cannot be read', () => {
    expect(homeExplorations([profile], opts({ 36: ['.bridge/explorations/profile-page.md', 'apps/account/src/Profile.tsx'] }))[0]!.state).toBe('Exploring');
    expect(homeExplorations([profile], opts({ 36: null }))[0]!.state).toBe('Exploring');
  });

  it('says nothing while the files are read, and "Exploring" when the caller reads none', () => {
    expect(homeExplorations([profile], opts({}))[0]!.state).toBe('');
    expect(homeExplorations([profile], { products, author: who })[0]!.state).toBe('Exploring');
  });

  it('leaves the other stages as they are', () => {
    expect(explorationStage({ ...billing, draft: false }, () => ['.bridge/x.md']).state).toBe('In review');
  });
});

describe('the quiet team Home', () => {
  const c = (n: number, over: Record<string, unknown> = {}) =>
    ({ number: n, key: String(n), title: `S${n}`, href: '#', product: null, author: person('ann', 'Ann', null), stage: 'exploring', state: 'Exploring', updated: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`, preview: SCREEN_SKETCH, own: false, ...over }) as Parameters<typeof recentExplorations>[0][number];

  it('keeps the four newest explorations, whatever their stage, and how many there are in all', () => {
    const cards = [c(1), c(2, { stage: 'kept', state: 'Shipped' }), c(3), c(4, { stage: 'with-devs', state: 'Waiting to be picked up' }), c(5), c(6)];
    const r = recentExplorations(cards);
    expect(RECENT_CARDS).toBe(4);
    expect(r.cards.map((x) => x.number)).toEqual([6, 5, 4, 3]);
    expect(r.total).toBe(6);
  });

  const say = (...a: Parameters<typeof ownOpenWork>) => quietSentence(ownOpenWork(...a));

  it("says what is open of the viewer's own work and who it waits on, in designer words", () => {
    expect(say([c(1, { own: true, stage: 'with-devs', state: 'Waiting to be picked up' })])).toBe('Nothing needs you. 1 of your explorations waits for a developer to pick it up.');
    expect(say([c(1, { own: true, stage: 'with-devs', state: 'Waiting to be picked up' }), c(2, { own: true, stage: 'with-devs', state: 'Waiting to be picked up' })])).toBe('Nothing needs you. 2 of your explorations wait for a developer to pick them up.');
    expect(say([c(1, { own: true, stage: 'with-devs', state: 'Being built' })])).toBe('Nothing needs you. 1 of your explorations is being built.');
    expect(say([c(1, { own: true, stage: 'in-review', state: 'In review' }), c(2, { own: true, stage: 'in-review', state: 'In review' })])).toBe('Nothing needs you. 2 of your explorations are in review.');
    expect(say([c(1, { own: true }), c(2, { own: true, stage: 'found', state: '1 new piece found' }), c(3, { own: true, stage: 'with-devs', state: 'Being built' }), c(4, { own: true, stage: 'in-review', state: 'In review' })])).toBe(
      'Nothing needs you. 2 of your explorations are still being explored, 1 is being built and 1 is in review.',
    );
    expect(say([c(1, { own: true }), c(2, { own: true, stage: 'with-devs', state: 'Waiting to be picked up' })])).toBe('Nothing needs you. 1 of your explorations is still being explored and 1 waits for a developer to pick it up.');
  });

  it('counts only what is still open and the viewer\'s own: never shipped, not planned, archived or someone else\'s', () => {
    // A handed-off one its task shipped stays "with the developers" as a stage, but it is done (art-print-shop-design#4).
    expect(ownOpenWork([c(1, { own: true, stage: 'with-devs', state: 'Shipped' }), c(2, { own: true, stage: 'with-devs', state: 'Not planned' }), c(3, { own: true, stage: 'with-devs', state: 'Approved, waiting to ship' })])).toBeNull();
    expect(ownOpenWork([c(1), c(2, { own: true, stage: 'kept', state: 'Shipped' }), c(3, { own: true, state: 'Archived' })])).toBeNull();
    // Its task in review: the exploration is in review.
    expect(say([c(1, { own: true, stage: 'with-devs', state: 'In review' })])).toBe('Nothing needs you. 1 of your explorations is in review.');
  });

  it('says the library changes apart, in the same words', () => {
    expect(say([], [{ stage: 'draft' }, { stage: 'waiting' }, { stage: 'ready' }])).toBe('Nothing needs you. 1 of your library changes waits for a developer to pick it up, 1 is being built and 1 is in review.');
    expect(say([c(1, { own: true, stage: 'with-devs', state: 'Being built' })], [{ stage: 'ready' }, { stage: 'ready' }])).toBe('Nothing needs you. 1 of your explorations is being built. 2 of your library changes are in review.');
  });

  it("makes each clause a link to Changes on the viewer's own work at that stage", () => {
    const parts = quietParts(ownOpenWork([c(1, { own: true }), c(2, { own: true, stage: 'with-devs', state: 'Waiting to be picked up' })]));
    expect(parts.filter((p) => p.href).map((p) => [p.text, p.href])).toEqual([
      ['1 of your explorations is still being explored', ownWorkHref('exploring')],
      ['1 waits for a developer to pick it up', ownWorkHref('code')],
    ]);
    expect(ownWorkHref('code')).toMatch(/changes\/\?state=code&people=you$/);
    expect(quietParts(null).some((p) => p.href)).toBe(false);
  });

  it('tells the truth after the greeting', () => {
    expect(quietSentence(null)).toBe('Nothing needs you, and you have nothing in progress.');
    expect(quietSentence(null, true)).toBe('Nothing needs you.');
  });
});
