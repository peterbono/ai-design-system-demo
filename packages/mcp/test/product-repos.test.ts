// Explorations that live in a product's own repository (bridge.config.json products[].repo), over two in-memory GitHub
// repositories: listed with the design system's ones (shop#1), checked for missing pieces where they live, "Done
// exploring" files the requests in the design system repository with a link back, Archive works there, the status
// follows the product pull request, and a product repository Bridge cannot reach is left out of the lists.
import { describe, expect, it } from 'vitest';
import { BridgeContext, branches, explorations, pieces } from '../dist/lib.js';
import { explorationPrBody, parseNeededBy, parsePiecesRecord } from '@bridge-ds/core';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const TSX = "import { Badge } from '@bridge-ds/react';\nimport styles from './billing.module.css';\nexport function Row() {\n  return <Badge className={styles.overdue}>Overdue</Badge>;\n}\n";
const CSS = '.overdue {\n  background: #fdecec;\n  color: #a3123a;\n}\n';

function setup() {
  const tree = readTree(REPO, [...REAL_PATHS, 'packages/react/src/components/Badge']);
  const cfg = JSON.parse(tree['bridge.config.json']!);
  cfg.products = [
    { key: 'shop', name: 'Shop', repo: 'acme/shop', preview: 'https://shop-git-{branch}-acme.vercel.app' },
    { key: 'gone', name: 'Gone', repo: 'acme/gone' },
    { key: 'library', name: 'Library', default: true },
  ];
  const ds = fakeGitHub('acme', 'ds', { ...tree, 'bridge.config.json': `${JSON.stringify(cfg, null, 2)}\n` });
  const shop = fakeGitHub('acme', 'shop', { 'package.json': '{"name":"shop"}' });
  // acme/gone: Bridge is not installed there, GitHub hides it.
  const fetch = ((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/repos/acme/gone')) return Promise.resolve(new Response('{"message":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    return u.includes('/repos/acme/shop') ? shop.fetch(url, init) : ds.fetch(url, init);
  }) as typeof globalThis.fetch;
  const ro = () => BridgeContext.create({ repo: 'acme/ds', fetch });
  const rw = () => BridgeContext.create({ repo: 'acme/ds', token: 't', fetch });
  /** The exploration Studio or Claude started in the shop repository: explore/billing-overdue, its draft, labels. */
  const start = (slug = 'billing-overdue') => {
    const main = shop.refs.get('main')!;
    const files = new Map(shop.commits.get(main)!.files);
    files.set('src/billing/Billing.tsx', TSX);
    files.set('src/billing/billing.module.css', CSS);
    files.set(`.bridge/explorations/${slug}.md`, '# Exploration: Billing screen\n');
    const c = shop.id();
    shop.commits.set(c, { files, parents: [main] });
    shop.refs.set(`explore/${slug}`, c);
    const body = `## Exploration: Billing screen with overdue invoices\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Billing screen with overdue invoices', purpose: '', slug, author: 'ann' })} -->`;
    shop.pulls.push({ number: 1, node_id: 'PR_shop_1', title: 'Exploration: billing screen with overdue invoices', body, state: 'open', draft: true, user: { login: 'ann' }, head: { ref: `explore/${slug}`, sha: c }, base: { ref: 'main' }, labels: [{ name: 'exploration' }, { name: 'product: shop' }], html_url: 'https://github.com/acme/shop/pull/1', updated_at: '2026-10-29T00:00:00Z' });
  };
  return { ds, shop, ro, rw, start };
}

describe('explorations in a product repository', () => {
  it('are listed with a product ref, read without a token; an unreachable product repository is left out silently', async () => {
    const { ro, start } = setup();
    start();
    const list = await explorations.listExplorations(await ro(), {});
    expect(list).toMatchObject({ running: 1, total: 1, summary: '1 exploration running.' });
    expect(list.explorations[0]).toMatchObject({ ref: 'shop#1', repo: 'acme/shop', product: 'shop', number: 1, status: 'active', branch: 'explore/billing-overdue', install: null });
    expect(list.explorations[0]!.previews).toEqual([{ app: 'shop', label: 'Shop', url: 'https://shop-git-explore-billing-overdue-acme.vercel.app/' }]);
    expect(JSON.stringify(list)).not.toContain('acme/gone');

    // Where connections live: bridge_list_products says which product repository Bridge reaches.
    const products = await branches.listProducts(await ro());
    const by = Object.fromEntries(products.products.map((p: any) => [p.key, p]));
    expect(by.shop).toMatchObject({ repo: 'acme/shop', connection: 'read-only' });
    expect(by.gone).toMatchObject({ repo: 'acme/gone', connection: 'not-connected' });
    expect(by.gone.connect).toMatch(/Install the Bridge GitHub App on acme\/gone/);
    expect(by.library.connection).toBeUndefined();
    expect((await branches.listProducts(await (await setup()).rw())).products.find((p: any) => p.key === 'shop')).toMatchObject({ connection: 'connected' });
  });

  it('missing pieces run on the product branch; Done exploring files the requests in the design system repository', async () => {
    const { ds, shop, rw, start } = setup();
    start();
    const ctx = await rw();
    const found = await pieces.missingPiecesOp(ctx, { pr: 'shop#1', record: true });
    expect(found).toMatchObject({ pr: 1, ref: 'shop#1', repo: 'acme/shop', product: 'Shop', recorded: true });
    expect(found.pieces.map((p: any) => p.id)).toContain('badge-overdue-tone');
    expect(found.next).toContain('bridge_promote_exploration');
    expect(parsePiecesRecord(shop.pulls[0]!.body)!.pieces.length).toBeGreaterThan(0);
    expect(ds.pulls).toHaveLength(0);

    const view = await pieces.productBranchOp(ctx, { pr: 'https://github.com/acme/shop/pull/1' });
    expect(view).toMatchObject({ pr: 1, ref: 'shop#1', product: 'Shop', library: 'acme/ds' });

    const done = (await explorations.doneExploring(ctx, { ref: 'shop#1', pieces: ['badge-overdue-tone'] })) as any;
    expect(done).toMatchObject({ status: 'done-exploring', ref: 'shop#1', repo: 'acme/shop', requestsIn: 'acme/ds', exploration: 'ready' });
    // The request is in the design system repository, where the DS lead works, and links back across repositories.
    expect(shop.issues).toHaveLength(0);
    expect(ds.issues).toHaveLength(1);
    const req = ds.issues[0]!;
    expect(req.labels.map((l: any) => l.name)).toContain('needed-by-product');
    expect(req.body).toContain('(acme/shop#1) in Shop');
    expect(req.body).toContain('https://shop-git-explore-billing-overdue-acme.vercel.app/');
    expect(parseNeededBy(req.body)).toMatchObject({ pr: 1, repo: 'acme/shop', product: 'shop' });
    // The product pull request: handed to developers, its record links the request in the design system repository.
    const pr = shop.pulls[0]!;
    expect(pr.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['ready-for-devs', 'product: shop']));
    expect(pr.labels.map((l: any) => l.name)).not.toContain('exploration');
    expect(pr.state).toBe('open');
    expect(pr.body).toContain('### For developers');
    expect(pr.body).toContain(`acme/ds#${req.number}`);
    expect(parsePiecesRecord(pr.body)!.links[0]).toMatchObject({ piece: 'badge-overdue-tone', number: req.number, repo: 'acme/ds' });
    expect(shop.fileAt('explore/billing-overdue', '.bridge/explorations/billing-overdue.md')).toBeUndefined();

    // Linked requests are read in the design system repository.
    const after = await pieces.productBranchOp(ctx, { pr: 'shop#1' });
    expect(after.linked[0]).toMatchObject({ library: { kind: 'request', number: req.number } });

    // A merge of library branches is impossible across repositories: said plainly.
    await expect(pieces.useLibraryPreviewOp(ctx, { pr: 'shop#1', piece: 'badge-overdue-tone' })).rejects.toThrow(/npm package/);
  });

  it('the status follows the product pull request; Archive works there; a name is found in the product repository', async () => {
    const { shop, rw, start } = setup();
    start();
    const ctx = await rw();
    await explorations.doneExploring(ctx, { ref: 'billing-overdue' });
    expect((await explorations.listExplorations(ctx, {})).explorations[0]).toMatchObject({ ref: 'shop#1', status: 'ready' });
    // A developer pushes: being built.
    const head = shop.refs.get('explore/billing-overdue')!;
    const pushed = shop.id();
    shop.commits.set(pushed, { files: new Map(shop.commits.get(head)!.files).set('src/billing/Real.tsx', 'export {};\n'), parents: [head] });
    shop.refs.set('explore/billing-overdue', pushed);
    shop.pulls[0]!.head.sha = pushed;
    expect((await explorations.listExplorations(ctx, {})).explorations[0]).toMatchObject({ status: 'building' });
    // Archived: hidden from the default list, under archived.
    const a = await explorations.archiveExploration(ctx, { ref: 'shop#1' });
    expect(a).toMatchObject({ status: 'archived', ref: 'shop#1', repo: 'acme/shop' });
    expect((await explorations.listExplorations(ctx, {})).explorations).toHaveLength(0);
    expect((await explorations.listExplorations(ctx, { archived: true })).explorations[0]).toMatchObject({ ref: 'shop#1' });
    await explorations.archiveExploration(ctx, { ref: 'shop#1', archived: false });
    // Merged: shipped.
    Object.assign(shop.pulls[0]!, { state: 'closed', merged: true, merged_at: '2026-10-30T00:00:00Z' });
    expect((await explorations.listExplorations(ctx, { state: 'all' })).explorations[0]).toMatchObject({ ref: 'shop#1', status: 'shipped' });
    await expect(explorations.doneExploring(ctx, { ref: 'nope#1' })).rejects.toThrow(/Unknown product "nope"/);
  });

  it('a long branch name: the request, Continue and the body use the preview Vercel reported, never the guessed one', async () => {
    const { ds, shop, rw, start } = setup();
    const slug = 'wishlist-button-on-product-cards';
    start(slug);
    // Vercel shortens an alias over 63 characters with a hash: only its comment on the pull request knows it.
    const reported = 'https://shop-git-explore-wishlis-f9937d-acme.vercel.app/';
    const vc = btoa(JSON.stringify({ projects: [{ name: 'shop', previewUrl: reported.replace(/^https:\/\//, '').replace(/\/$/, ''), nextCommitStatus: 'DEPLOYED' }] }));
    shop.comments.set(1, [`[vc]: #abc:${vc}\nThe latest updates on your projects.`]);
    const ctx = await rw();

    const resumed = (await explorations.continueExploration(ctx, { ref: 'shop#1', checkout: false })) as any;
    expect(resumed.previews).toEqual([{ app: 'shop', label: 'Shop', url: reported }]);
    // The next step stays in the product repository: no token proposal on a branch the design system does not have.
    expect(resumed.next).toContain(`in a checkout of acme/shop`);
    expect(resumed.next).toContain('bridge_missing_pieces');
    expect(resumed.next).not.toContain('bridge_propose');

    await pieces.missingPiecesOp(ctx, { pr: 'shop#1', record: true });
    await explorations.doneExploring(ctx, { ref: 'shop#1', pieces: ['badge-overdue-tone'] });
    expect(ds.issues[0]!.body).toContain(reported);
    expect(ds.issues[0]!.body).not.toContain('shop-git-explore-wishlist-button');
  });

  it('the draft body of a product exploration: the preview row says where the link is, closing does not talk about prereleases', () => {
    const body = explorationPrBody(
      { name: 'Wishlist button on product cards', slug: 'wishlist-button-on-product-cards', purpose: '' },
      { owner: 'acme', repo: 'shop', pr: 1, packages: [], apps: {}, inProduct: { name: 'Shop', library: 'acme/ds', preview: 'https://shop-git-{branch}-acmes-long-team-projects.vercel.app' } },
    );
    expect(body).toContain('| Shop | Link in the Vercel comment on this pull request |');
    expect(body).not.toContain('prerelease');
  });
});
