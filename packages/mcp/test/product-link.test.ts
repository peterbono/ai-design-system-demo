// A product repository connected to Bridge (`bridge connect`, .bridge/product.json): the design system it names is
// read from GitHub, "#1" means the product's own exploration, new work defaults to that product, and continuing one
// switches the product checkout (never over uncommitted changes).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BridgeContext, branches, explorations, findProductLink, linkedOptions, parseProductPointer, PRODUCT_POINTER } from '../dist/lib.js';
import { fakeGitHub, git, readTree, REAL_PATHS, REPO } from './helpers.js';

const BRANCH = 'explore/wishlist-button-on-product-cards';

function setup() {
  const tree = readTree(REPO, REAL_PATHS);
  const cfg = JSON.parse(tree['bridge.config.json']!);
  cfg.products = [
    { key: 'shop', name: 'Shop', repo: 'acme/shop' },
    { key: 'library', name: 'Library', default: true },
  ];
  const ds = fakeGitHub('acme', 'ds', { ...tree, 'bridge.config.json': `${JSON.stringify(cfg, null, 2)}\n` });
  const shop = fakeGitHub('acme', 'shop', { 'package.json': '{"name":"shop"}' });
  const main = shop.refs.get('main')!;
  const files = new Map(shop.commits.get(main)!.files);
  files.set('src/ProductCard.tsx', 'export const Card = () => null;\n');
  const c = shop.id();
  shop.commits.set(c, { files, parents: [main] });
  shop.refs.set(BRANCH, c);
  const body = `## Exploration: Wishlist button on product cards\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Wishlist button on product cards', purpose: '', slug: 'wishlist-button-on-product-cards', author: 'ann' })} -->`;
  shop.pulls.push({ number: 1, node_id: 'PR_shop_1', title: 'Exploration: Wishlist button on product cards', body, state: 'open', draft: true, user: { login: 'ann' }, head: { ref: BRANCH, sha: c }, base: { ref: 'main' }, labels: [{ name: 'exploration' }, { name: 'product: shop' }], html_url: 'https://github.com/acme/shop/pull/1', updated_at: '2026-10-29T00:00:00Z' });
  const fetch = ((url: string, init?: RequestInit) => (String(url).includes('/repos/acme/shop') ? shop.fetch(url, init) : ds.fetch(url, init))) as typeof globalThis.fetch;

  // The product checkout: a clone of a bare "acme/shop.git" with main and the exploration branch.
  const base = mkdtempSync(join(tmpdir(), 'bridge-test-'));
  const bare = join(base, 'acme', 'shop.git');
  mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = join(base, 'seed');
  mkdirSync(seed);
  const g = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g(seed, 'init', '-q', '-b', 'main');
  g(seed, 'config', 'user.name', 'Test');
  g(seed, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(seed, 'package.json'), '{"name":"shop"}\n');
  g(seed, 'add', '-A');
  g(seed, 'commit', '-q', '-m', 'init');
  g(seed, 'switch', '-q', '-c', BRANCH);
  writeFileSync(join(seed, 'ProductCard.tsx'), 'export const Card = () => null;\n');
  g(seed, 'add', '-A');
  g(seed, 'commit', '-q', '-m', 'wishlist');
  g(seed, 'remote', 'add', 'origin', bare);
  g(seed, 'push', '-q', 'origin', 'main', BRANCH);
  const checkout = join(base, 'shop');
  execFileSync('git', ['clone', '-q', bare, checkout]);
  mkdirSync(join(checkout, '.bridge'));
  writeFileSync(join(checkout, PRODUCT_POINTER), `${JSON.stringify({ version: 1, designSystem: 'acme/ds', product: 'shop' })}\n`);
  g(checkout, 'config', 'user.name', 'Test');
  g(checkout, 'config', 'user.email', 'test@example.com');
  g(checkout, 'add', '-A');
  g(checkout, 'commit', '-q', '-m', 'Connect to Bridge');
  return { ds, shop, fetch, checkout };
}

describe('the product pointer', () => {
  it('is found from the repository or a subfolder; a design system repository or another repository stops the search', async () => {
    const { checkout } = setup();
    const sub = join(checkout, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    expect(await findProductLink(sub)).toMatchObject({ root: checkout, designSystem: 'acme/ds', product: 'shop' });
    const ds = mkdtempSync(join(tmpdir(), 'bridge-test-'));
    writeFileSync(join(ds, 'bridge.config.json'), '{}');
    expect(await findProductLink(ds)).toBeNull();
    const plain = mkdtempSync(join(tmpdir(), 'bridge-test-'));
    mkdirSync(join(plain, '.git'));
    expect(await findProductLink(plain)).toBeNull();

    expect(await linkedOptions(checkout, { token: 't' })).toMatchObject({ repo: 'acme/ds', workTree: checkout, product: 'shop', token: 't' });
    expect(await linkedOptions(plain)).toEqual({ root: plain });
    // The MCP server's --repo: kept; the checkout only when the pointer names the same design system.
    expect(await linkedOptions(checkout, { repo: 'ACME/ds' })).toMatchObject({ repo: 'ACME/ds', workTree: checkout, product: 'shop' });
    expect(await linkedOptions(checkout, { repo: 'other/ds' })).toEqual({ repo: 'other/ds' });
  });

  it('a branch made before the setup (no pointer file) still finds the link in the clone git config', async () => {
    const { checkout } = setup();
    execFileSync('git', ['switch', '-q', BRANCH], { cwd: checkout });
    expect(await findProductLink(checkout)).toBeNull();
    execFileSync('git', ['config', '--local', 'bridge.designSystem', 'acme/ds'], { cwd: checkout });
    execFileSync('git', ['config', '--local', 'bridge.product', 'shop'], { cwd: checkout });
    expect(await findProductLink(join(checkout))).toEqual({ version: 1, designSystem: 'acme/ds', product: 'shop', root: checkout });
  });

  it('says how to fix a broken pointer', () => {
    expect(() => parseProductPointer('{')).toThrow(/not valid JSON/);
    expect(() => parseProductPointer('{"designSystem":"nope","product":"shop"}')).toThrow(/"designSystem": "owner\/name"/);
    expect(() => parseProductPointer('{"designSystem":"acme/ds"}')).toThrow(/needs "product"/);
  });
});

describe('explorations from a connected product repository', () => {
  it('"#1" is the product exploration; continue checks out its branch; new work is for that product', async () => {
    const { fetch, checkout } = setup();
    const ctx = await BridgeContext.create({ ...(await linkedOptions(checkout, { token: 't', fetch })) });
    expect(ctx.mode).toBe('remote');
    expect(ctx.product).toBe('shop');
    expect(ctx.describe()).toContain(`from the shop checkout ${checkout}`);

    const r = (await explorations.continueExploration(ctx, { ref: '#1' })) as any;
    expect(r).toMatchObject({ ref: 'shop#1', repo: 'acme/shop', branch: BRANCH, checkout: { status: 'switched' } });
    expect(git(checkout, 'branch', '--show-current').trim()).toBe(BRANCH);
    const again = (await explorations.continueExploration(ctx, { ref: '1' })) as any;
    expect(again.checkout.status).toBe('already-on-it');

    expect((await branches.resolveProduct(ctx)).key).toBe('shop');
    const dry = (await explorations.startExploration(ctx, { name: 'Sticky cart', dryRun: true })) as any;
    expect(dry).toMatchObject({ repo: 'acme/shop', inProductRepo: true });
    const list = await explorations.listExplorations(ctx, {});
    expect(list.explorations.map((x: any) => x.ref)).toEqual(['shop#1']);
  });

  it('never switches over uncommitted changes, and says so plainly', async () => {
    const { fetch, checkout } = setup();
    writeFileSync(join(checkout, 'package.json'), '{"name":"shop","dirty":true}\n');
    const ctx = await BridgeContext.create(await linkedOptions(checkout, { fetch }));
    const r = (await explorations.continueExploration(ctx, { ref: '#1' })) as any;
    expect(r.checkout.status).toBe('not-switched');
    expect(r.checkout.note).toMatch(/^Not switched: 1 file has uncommitted changes in .*, and switching could lose them\. Commit or stash them, then `git fetch origin explore\/wishlist-button-on-product-cards && git switch explore\/wishlist-button-on-product-cards`\.$/);
    expect(git(checkout, 'branch', '--show-current').trim()).toBe('main');
  });

  it('a pointer to a product the design system does not list says how to fix it', async () => {
    const { fetch, checkout } = setup();
    const ctx = await BridgeContext.create({ ...(await linkedOptions(checkout, { fetch })), product: 'nope' });
    await expect(branches.resolveProduct(ctx)).rejects.toThrow(/names the product "nope".*bridge connect --product <key>/);
  });
});
