import { describe, expect, it } from 'vitest';
import { productProblems, type ProductConfig } from '@bridge-ds/core';
import { addProductProblem, addProductProposal, ADD_PRODUCT_WORDS, copyRepoFor, nameFromRepo, newProductEntry, previewsFromStatuses, productKeyFor, withNewProduct } from './add-product';

const SHOP: ProductConfig = { key: 'admin-app', name: 'Art print shop', repo: 'acme/shop', design: { repo: 'acme/shop-design' }, framework: 'react' };

const CONFIG = `{
  "version": 1,
  "products": [
    { "key": "admin-app", "name": "Art print shop", "repo": "acme/shop", "framework": "react" },
    { "key": "library", "name": "Library", "path": "packages", "framework": "react", "default": true }
  ],
  "tooling": { "paths": ["apps/"] }
}
`;

describe('add a product', () => {
  it('names and keys a product from its code name', () => {
    expect(nameFromRepo('art-print-shop')).toBe('Art print shop');
    expect(nameFromRepo('my_App.web')).toBe('My App web');
    expect(productKeyFor('Art-Print-Shop', [])).toBe('art-print-shop');
    expect(productKeyFor('shop', ['shop', 'shop-2'])).toBe('shop-3');
    expect(productKeyFor('***', [])).toBe('product');
  });

  it('says what is missing in one sentence', () => {
    expect(addProductProblem({ name: 'Shop', repo: null }, [])).toBe('Pick the product.');
    expect(addProductProblem({ name: 'x', repo: 'acme/shop' }, [SHOP])).toBe('Bridge already lists this product.');
    expect(addProductProblem({ name: 'x', repo: 'ACME/shop-design' }, [SHOP])).toBe('Bridge already lists this product.');
    expect(addProductProblem({ name: '  ', repo: 'acme/new' }, [SHOP])).toBe('Type a name for the product.');
    expect(addProductProblem({ name: 'art print SHOP', repo: 'acme/new' }, [SHOP])).toMatch(/Another product/);
    expect(addProductProblem({ name: 'Back office', repo: 'acme/new' }, [SHOP])).toBeNull();
  });

  it('reads the previews from the Vercel statuses, project and team from the inspector link', () => {
    expect(previewsFromStatuses([])).toBeNull();
    expect(previewsFromStatuses([{ context: 'ci/build', target_url: 'https://vercel.com/team/x/abc' }])).toBeNull();
    expect(previewsFromStatuses([{ context: 'Vercel', state: 'success', target_url: 'https://vercel.com/peterbonos-projects/bridge-product-admin/AbC123' }])).toEqual({
      preview: 'https://bridge-product-admin-git-{branch}-peterbonos-projects.vercel.app',
      production: 'https://bridge-product-admin.vercel.app',
    });
    expect(previewsFromStatuses([{ context: 'Vercel – shop-web', target_url: 'https://vercel.com/acme/shop-web/9Zx' }])?.preview).toBe('https://shop-web-git-{branch}-acme.vercel.app');
  });

  it('builds a valid entry, with the copy when asked', () => {
    const e = newProductEntry({ key: 'back-office', name: ' Back  office ', repo: 'acme/bo', copy: true, previews: { preview: 'https://bo-git-{branch}-acme.vercel.app', production: 'https://bo.vercel.app' } });
    expect(e).toEqual({ key: 'back-office', name: 'Back office', repo: 'acme/bo', design: { repo: 'acme/bo-design' }, preview: 'https://bo-git-{branch}-acme.vercel.app', production: 'https://bo.vercel.app', framework: 'react' });
    expect(Object.keys(e)).toEqual(['key', 'name', 'repo', 'design', 'preview', 'production', 'framework']);
    expect(newProductEntry({ key: 'k', name: 'K', repo: 'a/k', copy: false })).toEqual({ key: 'k', name: 'K', repo: 'a/k', framework: 'react' });
    expect(copyRepoFor('acme/bo')).toBe('acme/bo-design');
  });

  it('adds the product before the default one, one line like the others, the rest byte for byte', () => {
    const out = withNewProduct(CONFIG, newProductEntry({ key: 'bo', name: 'Back office', repo: 'acme/bo', copy: true }));
    expect(out).toBe(`{
  "version": 1,
  "products": [
    { "key": "admin-app", "name": "Art print shop", "repo": "acme/shop", "framework": "react" },
    { "key": "bo", "name": "Back office", "repo": "acme/bo", "design": { "repo": "acme/bo-design" }, "framework": "react" },
    { "key": "library", "name": "Library", "path": "packages", "framework": "react", "default": true }
  ],
  "tooling": { "paths": ["apps/"] }
}
`);
    const products = (JSON.parse(out) as { products: ProductConfig[] }).products;
    expect(productProblems(products)).toEqual([]);
  });

  it('gives a file without products the new one and the library', () => {
    const out = withNewProduct('{\n  "version": 1\n}\n', newProductEntry({ key: 'bo', name: 'Back office', repo: 'acme/bo', copy: false }));
    const products = (JSON.parse(out) as { products: ProductConfig[] }).products;
    expect(products.map((p) => p.key)).toEqual(['bo', 'library']);
    expect(products[1]!.default).toBe(true);
    expect(productProblems(products)).toEqual([]);
  });

  it('proposes it as a configuration change, in words a reviewer reads', () => {
    const p = addProductProposal(newProductEntry({ key: 'bo', name: 'Back office', repo: 'acme/bo', copy: true }), { date: new Date('2026-11-01T10:00:00Z'), tierLabel: 'Tier 1' });
    expect(p.branch).toBe('product-add-bo-20261101');
    expect(p.title).toBe('chore(config): add the product "Back office"');
    expect(p.body).toContain('acme/bo-design');
    expect(p.body).toContain('found after the first change');
  });

  it('never says repository, fork or config to designers', () => {
    for (const w of Object.values(ADD_PRODUCT_WORDS)) expect(w).not.toMatch(/repositor|fork|config|branch/i);
  });
});
