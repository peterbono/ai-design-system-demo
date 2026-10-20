import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ConfigError, defineConfig, loadConfig, toConfigJson } from '../src/config';
import {
  DEFAULT_PRODUCTS,
  defaultProduct,
  findProduct,
  PRODUCT_LABEL_PREFIX,
  productForPlace,
  productLabel,
  productMarks,
  productOfBranch,
  productProblems,
  productsOf,
  type ProductConfig,
} from '../src/products';
import { realConfig } from './helpers';

const CUSTOM: ProductConfig[] = [
  { key: 'library', name: 'Library', path: 'packages', default: true },
  { key: 'shop', name: 'Shop', path: 'apps/shop', framework: 'vue' },
  { key: 'mobile', name: 'Mobile app', repo: 'acme/mobile', preview: 'https://mobile-{pr}.example.com' },
  { key: 'shop-admin', name: 'Shop admin', path: 'apps/shop/admin' },
];

test('defaults are the Admin demo then the library, the library being the default', () => {
  assert.deepEqual(
    DEFAULT_PRODUCTS.map((p) => p.key),
    ['admin', 'library'],
  );
  assert.equal(defaultProduct(DEFAULT_PRODUCTS).key, 'library');
  assert.equal(productsOf(undefined), DEFAULT_PRODUCTS);
  assert.equal(productsOf(null), DEFAULT_PRODUCTS);
  assert.equal(productsOf({}), DEFAULT_PRODUCTS);
  assert.equal(productsOf({ products: [] }), DEFAULT_PRODUCTS);
  assert.equal(productsOf({ products: CUSTOM }), CUSTOM);
});

test('without a default, the last product is the fallback', () => {
  assert.equal(defaultProduct([{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }]).key, 'b');
  assert.equal(defaultProduct(CUSTOM).key, 'library');
});

test('product labels and lookup by key or name', () => {
  assert.equal(PRODUCT_LABEL_PREFIX, 'product: ');
  assert.equal(productLabel('admin'), 'product: admin');
  assert.equal(findProduct(CUSTOM, 'SHOP')?.key, 'shop');
  assert.equal(findProduct(CUSTOM, 'mobile app')?.key, 'mobile');
  assert.equal(findProduct(CUSTOM, 'nope'), undefined);
  assert.equal(findProduct(CUSTOM, ''), undefined);
});

test('productOfBranch reproduces the old rule for the defaults', () => {
  const of = (files: string[] | null) => productOfBranch(DEFAULT_PRODUCTS, { files }).key;
  assert.equal(of(['apps/admin/src/Billing.tsx', 'packages/react/src/Badge.tsx']), 'admin');
  assert.equal(of(['packages/tokens/src/semantic/light.tokens.json']), 'library');
  assert.equal(of(null), 'library');
  assert.equal(of(['apps/administration/x.ts']), 'library');
  assert.equal(productOfBranch(DEFAULT_PRODUCTS, {}).key, 'library');
});

test('the repo config keeps the same grouping although the library has a path', () => {
  const products = realConfig().products;
  assert.deepEqual(
    products.map((p) => p.key),
    ['admin', 'library'],
  );
  const of = (files: string[] | null) => productOfBranch(products, { files }).key;
  assert.equal(of(['packages/react/src/Badge.tsx', 'apps/admin/src/App.tsx']), 'admin');
  assert.equal(of(['docs/GOVERNANCE.md']), 'library');
  assert.equal(of(null), 'library');
});

test('a product label wins over files, unknown labels are ignored', () => {
  assert.equal(productOfBranch(DEFAULT_PRODUCTS, { files: ['packages/x.ts'], labels: ['product: admin'] }).key, 'admin');
  assert.equal(productOfBranch(DEFAULT_PRODUCTS, { files: ['apps/admin/x.ts'], labels: [{ name: 'Product: Library' }] }).key, 'library');
  assert.equal(productOfBranch(DEFAULT_PRODUCTS, { files: ['apps/admin/x.ts'], labels: [{ name: 'product: ghost' }, 'tier: 1'] }).key, 'admin');
  assert.equal(productOfBranch(CUSTOM, { labels: ['product: mobile'] }).key, 'mobile');
});

test('custom products: first non-default folder match, else the default', () => {
  assert.equal(productOfBranch(CUSTOM, { files: ['apps/shop/src/Cart.vue'] }).key, 'shop');
  assert.equal(productOfBranch(CUSTOM, { files: ['apps/shop/admin/x.ts'] }).key, 'shop');
  assert.equal(productOfBranch(CUSTOM, { files: ['packages/react/x.ts'] }).key, 'library');
  assert.equal(productOfBranch(CUSTOM, { files: ['README.md'] }).key, 'library');
});

test('productForPlace: another repo, then the deepest folder, then the default', () => {
  assert.deepEqual(productForPlace(CUSTOM, { repo: 'Acme/Mobile', designSystemRepo: 'acme/ds' }), { product: CUSTOM[2], how: 'repo' });
  assert.equal(productForPlace(CUSTOM, { repo: 'acme/ds', designSystemRepo: 'acme/ds', relPath: 'apps/shop/src' }).how, 'path');
  assert.equal(productForPlace(CUSTOM, { relPath: 'apps/shop/src' }).product.key, 'shop');
  assert.equal(productForPlace(CUSTOM, { relPath: 'apps/shop/admin/pages' }).product.key, 'shop-admin');
  assert.equal(productForPlace(CUSTOM, { relPath: 'apps/shop' }).product.key, 'shop');
  assert.equal(productForPlace(CUSTOM, { relPath: 'apps/shopping' }).how, 'default');
  assert.deepEqual(productForPlace(CUSTOM, { relPath: '' }), { product: CUSTOM[0], how: 'default' });
  assert.equal(productForPlace(CUSTOM, { relPath: '.' }).how, 'default');
  assert.equal(productForPlace(CUSTOM, { relPath: 'packages/react' }).product.key, 'library');
  assert.equal(productForPlace(DEFAULT_PRODUCTS, { relPath: 'apps/admin/src' }).product.key, 'admin');
  assert.equal(productForPlace(DEFAULT_PRODUCTS, { repo: 'acme/other', designSystemRepo: 'acme/ds' }).how, 'default');
});

test('productProblems says how to fix each mistake', () => {
  assert.deepEqual(productProblems(undefined), []);
  assert.deepEqual(productProblems(CUSTOM), []);
  assert.deepEqual(productProblems(DEFAULT_PRODUCTS), []);
  assert.equal(productProblems({}).length, 1);
  assert.match(productProblems([])[0]!, /at least one/);
  const p = productProblems([
    { key: 'Admin', name: '' },
    { key: 'a', name: 'A', repo: 'nope', path: '/abs', preview: 'ftp://x', default: true, extra: 1 },
    { key: 'a', name: 'B', path: '../up', default: true },
    'x',
  ]);
  const has = (re: RegExp) => assert.ok(p.some((m) => re.test(m)), `${re} in ${p.join(' | ')}`);
  has(/products\[0\]\.key.*lowercase/);
  has(/products\[0\]\.name/);
  has(/products\[1\]\.repo.*owner\/name/);
  has(/products\[1\]\.path.*leading/);
  has(/products\[1\]\.preview.*http/);
  has(/products\[1\]\.extra.*not a known field/);
  has(/products\[2\]\.key.*used twice/);
  has(/products\[2\]\.path/);
  has(/products\[3\].*object/);
  has(/more than one product as default/);
});

test('config: products default, custom list, errors and toConfigJson', () => {
  const plain = defineConfig({ repo: 'acme/ds' });
  assert.deepEqual(plain.products, DEFAULT_PRODUCTS);
  assert.ok(!('products' in toConfigJson(plain)));

  const custom = loadConfig({ repo: 'acme/ds', products: CUSTOM });
  assert.deepEqual(custom.products, CUSTOM);
  assert.deepEqual(toConfigJson(custom).products, CUSTOM);
  assert.deepEqual(productProblems(toConfigJson(custom).products), []);

  const explicitDefaults = loadConfig({ products: DEFAULT_PRODUCTS.map((p) => ({ ...p })) });
  assert.ok(!('products' in toConfigJson(explicitDefaults)));

  assert.throws(() => loadConfig({ products: [{ key: 'x' }] }), (err: unknown) => err instanceof ConfigError && err.problems.some((m) => m.includes('"products[0].name"')));
  assert.throws(() => loadConfig({ products: 'admin' }), ConfigError);

  // The repo config lists both products explicitly (with a preview and a library path), so it is written out.
  assert.equal((toConfigJson(realConfig()).products as ProductConfig[]).length, 2);
});

test('productMarks: a label and a body line for a non-default product, nothing for the default', () => {
  const shop = findProduct(CUSTOM, 'shop')!;
  assert.deepEqual(productMarks(CUSTOM, shop), { labels: ['product: shop'], line: '**Product:** Shop' });
  assert.deepEqual(productMarks(CUSTOM, defaultProduct(CUSTOM)), { labels: [], line: '' });
  // What it writes, productOfBranch reads back.
  assert.equal(productOfBranch(CUSTOM, { files: [], labels: productMarks(CUSTOM, shop).labels }).key, 'shop');
});
