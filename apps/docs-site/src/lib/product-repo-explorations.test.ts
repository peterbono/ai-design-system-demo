// Explorations that live in a product's own repository (bridge.config.json products[].repo), as Studio lists, keys,
// addresses and nests them: lib/explorations-view.ts, lib/home-explorations.ts, lib/product-branch.ts,
// lib/team-branches.ts and Settings > Products (lib/settings-view.ts).
import { describe, expect, it } from 'vitest';
import { explorationPrBody, withNeededBy, type ProductConfig } from '@bridge-ds/core';
import {
  explorationHref,
  explorationKey,
  explorationParam,
  explorationRows,
  mergeExplorationRows,
  productPreviews,
  productPullsPath,
  productReposOf,
  tagProductPulls,
  type ExplorationPullLike,
} from './explorations-view';
import { homeExplorations } from './home-explorations';
import { person } from './home-model';
import { developerLines, nestLinked, productContextOf } from './product-branch';
import { teamBranchesRoute } from './team-branches';
import { productConnectionRow } from './settings-view';
import { askAdmin } from './create-branch';
import { productKeeperLine } from './write-route';
import { jargonIn } from './vocabulary';

const cfg = { owner: 'acme', repo: 'ds', defaultBranch: 'main', apps: { docs: 'https://docs-git-{branch}-acme.vercel.app' }, packages: [] };
const shop: ProductConfig = { key: 'shop', name: 'Shop', repo: 'acme/shop', preview: 'https://shop-git-{branch}-acme.vercel.app' };
const products: ProductConfig[] = [shop, { key: 'admin', name: 'Admin demo', path: 'apps/admin' }, { key: 'library', name: 'Library', default: true }];
const at = { product: shop, repo: 'acme/shop' };

function pull(n: number, name: string, over: Partial<ExplorationPullLike> = {}): ExplorationPullLike {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    number: n,
    title: `Exploration: ${name.toLowerCase()}`,
    body: explorationPrBody({ name, purpose: '', author: 'ann' }, { owner: 'acme', repo: 'shop', pr: n, packages: [], apps: {}, inProduct: { name: 'Shop', library: 'acme/ds' } }),
    state: 'open',
    draft: true,
    labels: [{ name: 'exploration' }, { name: 'product: shop' }],
    head: { ref: `explore/${slug}`, sha: 'a'.repeat(40) },
    user: { login: 'ann' },
    updated_at: '2026-10-20T10:00:00Z',
    html_url: `https://github.com/acme/shop/pull/${n}`,
    ...over,
  };
}

describe('keys and addresses', () => {
  it('a product repository exploration has its own key and address; the design system keeps its own', () => {
    expect(explorationKey({ number: 12 })).toBe('12');
    expect(explorationKey({ number: 12, product: 'shop' })).toBe('shop#12');
    expect(explorationHref({ number: 12 })).toBe('?exploration=12');
    expect(explorationHref({ number: 12, product: 'shop' })).toBe('?exploration=12&product=shop');
    expect(explorationParam('?exploration=12&product=shop')).toEqual({ number: 12, product: 'shop' });
    expect(explorationParam('?exploration=12')).toEqual({ number: 12, product: null });
    expect(explorationParam('?exploration=12&product=../x')).toEqual({ number: 12, product: null });
    expect(explorationParam('?pr=12')).toBeNull();
  });

  it('lists the products with their own repository, never the design system', () => {
    expect(productReposOf(products, cfg)).toEqual([at]);
    expect(productReposOf([...products, { key: 'self', name: 'Self', repo: 'acme/ds' }], cfg)).toEqual([at]);
    expect(productPullsPath('acme/shop')).toBe('/repos/acme/shop/pulls?state=open&per_page=100');
  });
});

describe('rows across repositories', () => {
  it('keeps only explorations of a product repository, tagged with the product', () => {
    const other = { ...pull(3, 'x'), title: 'fix: checkout', body: '', labels: [], head: { ref: 'fix/checkout', sha: 'b' } };
    const tagged = tagProductPulls([pull(12, 'Checkout flow'), other], at);
    expect(tagged.map((p) => [p.number, p.product, p.repo])).toEqual([[12, 'shop', 'acme/shop']]);
  });

  it('a product row carries its repository, product and preview; the design system #12 and the shop #12 both stay', () => {
    const ds = explorationRows([{ ...pull(12, 'Pill buttons'), html_url: 'https://github.com/acme/ds/pull/12', labels: [{ name: 'exploration' }] }], cfg);
    const own = explorationRows(tagProductPulls([pull(12, 'Checkout flow', { draft: false, labels: [{ name: 'ready-for-devs' }] })], at), cfg, { inProduct: at });
    expect(own[0]).toMatchObject({ number: 12, product: 'shop', repo: 'acme/shop', status: 'building', previews: [{ app: 'shop', label: 'Shop', url: 'https://shop-git-explore-checkout-flow-acme.vercel.app/' }], requests: [] });
    const merged = mergeExplorationRows(ds, own, own);
    expect(merged.map(explorationKey)).toEqual(['12', 'shop#12']);
  });

  it("names the product's preview after the product, with what Vercel reports there", () => {
    const r = { branch: 'explore/checkout-flow', number: 12, headSha: 'a'.repeat(40) };
    expect(productPreviews(r, shop)).toEqual([{ app: 'shop', label: 'Shop', url: 'https://shop-git-explore-checkout-flow-acme.vercel.app/', state: 'unknown', source: 'template' }]);
    const reported = productPreviews(r, shop, { statuses: [{ context: 'Vercel – shop', state: 'success', target_url: 'https://shop-abc123-acme.vercel.app' }] });
    expect(reported[0]).toMatchObject({ label: 'Shop', url: 'https://shop-abc123-acme.vercel.app/', state: 'ready', source: 'status' });
    expect(productPreviews(r, { ...shop, preview: undefined } as ProductConfig)).toEqual([]);
  });
});

describe('home cards', () => {
  it('a product repository exploration is a card of its product, opening its own address', () => {
    const own = { ...pull(12, 'Checkout flow'), product: 'shop', labels: [{ name: 'exploration' }] };
    const ds = { ...pull(12, 'Pill buttons'), labels: [{ name: 'exploration' }] };
    const cards = homeExplorations([ds, own].map((p) => ({ ...p, user: { login: 'ann' } })), { products, author: () => person('ann', null, '') });
    expect(cards.map((c) => [c.key, c.product, c.href])).toEqual(
      expect.arrayContaining([
        ['12', null, expect.stringMatching(/changes\/\?exploration=12$/)],
        ['shop#12', 'Shop', expect.stringMatching(/changes\/\?exploration=12&product=shop$/)],
      ]),
    );
  });

  it("leaves a product repository's other branches out", () => {
    const fix = { ...pull(3, 'x'), title: 'fix: checkout', body: '', labels: [], head: { ref: 'fix/checkout', sha: 'b' }, product: 'shop', user: { login: 'ann' } };
    expect(homeExplorations([fix], { products, author: () => person('ann', null, '') })).toEqual([]);
  });
});

describe('product branch page and library review', () => {
  it('a library branch needed by the shop #12 nests under the shop #12, never under the design system #12', () => {
    const row = (number: number, extra: Record<string, unknown> = {}) => ({ r: { number, ...extra } });
    const groups = [
      { key: 'shop', label: 'Shop', rows: [row(12, { product: 'shop' })] },
      { key: 'library', label: 'Library', rows: [row(12), row(40, { neededBy: 12, neededByProduct: 'shop' })] },
    ];
    const out = nestLinked(groups);
    expect(out.find((g) => g.key === 'shop')!.rows.map((x) => [x.r.number, x.child])).toEqual([
      [12, false],
      [40, true],
    ]);
    expect(out.find((g) => g.key === 'library')!.rows.map((x) => x.r.number)).toEqual([12]);
  });

  it('the review of a library branch links back to the product exploration with its product', () => {
    const body = withNeededBy('Body', { pr: 12, title: 'Checkout flow', branch: 'explore/checkout-flow', url: 'https://github.com/acme/shop/pull/12', product: 'shop', productName: 'Shop', piece: 'p1', pieceTitle: 'Badge: sale tone', repo: 'acme/shop' });
    expect(productContextOf(body)?.productHref).toBe('?exploration=12&product=shop');
    const local = withNeededBy('Body', { pr: 12, title: 'Billing', branch: 'explore/billing', url: 'https://github.com/acme/ds/pull/12', product: 'admin', productName: 'Admin demo', piece: 'p1', pieceTitle: 'x' });
    expect(productContextOf(local)?.productHref).toBe('?exploration=12');
  });

  it('the developer fold names the product branch with its repository and the tools with shop#12', () => {
    const lines = developerLines({ number: 12, branch: 'explore/checkout-flow', links: [{ kind: 'request', number: 40 }], product: 'shop', repo: 'acme/shop' });
    expect(lines.map((l) => l.value)).toEqual(['explore/checkout-flow (acme/shop#12)', '#40', 'bridge pieces shop#12 --record', 'bridge_missing_pieces { pr: "shop#12", record: true }']);
  });
});

describe('team shell address', () => {
  it('opens every exploration on the exploration page, in a product repository or the design system one', () => {
    expect(teamBranchesRoute('?exploration=12&product=shop')).toEqual({ view: 'exploration', n: 12, product: 'shop' });
    expect(teamBranchesRoute('?exploration=12')).toEqual({ view: 'exploration', n: 12, product: null });
  });
});

describe('Settings > Products', () => {
  const row = (state: Parameters<typeof productConnectionRow>[0]['state']) => productConnectionRow({ product: 'Shop', repo: 'acme/shop', state, installLink: 'https://github.com/apps/bridge/installations/new' }, askAdmin);

  it('says per product whether Bridge reaches its repository, with the admin action when not', () => {
    expect(row('connected')).toMatchObject({ label: 'Shop', badge: { text: 'Connected', tone: 'success' }, ask: null });
    expect(row('not-connected')).toMatchObject({ badge: { text: 'Not connected', tone: 'warning' }, ask: { label: 'Ask an admin to connect Shop' } });
    expect(row('read-only')).toMatchObject({ badge: { text: 'Read only' }, ask: { label: 'Ask an admin for access' } });
    expect(row('checking').badge.text).toBe('Checking');
    expect(row('unavailable').ask).toBeNull();
  });

  it('no em dash anywhere', () => {
    for (const s of ['connected', 'not-connected', 'read-only', 'checking', 'unavailable'] as const) expect(row(s).value).not.toMatch(/\u2014/);
  });
});

describe('designer words', () => {
  it('the line an email member reads in place of Done exploring says who takes it, without jargon', () => {
    const line = productKeeperLine('Shop');
    expect(line).toBe('Someone on Shop who signs in with GitHub says it is done exploring or archives it.');
    expect(jargonIn(line)).toEqual([]);
  });
});
